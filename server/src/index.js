import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import os from "os";
import { GoogleGenerativeAI } from "@google/generative-ai";
import https from "https";
import crypto from "crypto";
import mysql from "mysql2/promise";
import * as XLSX from "xlsx";

// .env の値で既存の OS 環境変数を必ず上書きする
dotenv.config({ override: true });

// 最低限のフェイルセーフ（致命的例外でプロセスごと落ち続けないためのログ）
process.on("uncaughtException", (err) => {
  try {
    console.error("[fatal uncaughtException]", err);
  } catch {}
});
process.on("unhandledRejection", (reason) => {
  try {
    console.error("[fatal unhandledRejection]", reason);
  } catch {}
});

const app = express();
const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || "0.0.0.0"; // 0.0.0.0 で LAN も listen

// MySQL 接続設定
const DB_CONFIG = {
  host: process.env.MYSQL_HOST || process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.MYSQL_PORT || process.env.DB_PORT) || 3306,
  user: process.env.MYSQL_USER || process.env.DB_USER || "root",
  password: process.env.MYSQL_PASSWORD || process.env.DB_PASSWORD || "",
  database: process.env.MYSQL_DATABASE || process.env.DB_NAME || "matugen",
  waitForConnections: true,
  connectionLimit: Number(process.env.MYSQL_POOL_SIZE) || 10,
  queueLimit: 0,
  timezone: "Z",
};

const pool = mysql.createPool(DB_CONFIG);

async function ensureDatabaseConnection() {
  try {
    const conn = await pool.getConnection();
    await conn.ping();
    conn.release();
    console.log(`[db] connected to ${DB_CONFIG.host}:${DB_CONFIG.port}/${DB_CONFIG.database}`);
  } catch (err) {
    console.error("[db] connection failed:", err);
    throw err;
  }
}

ensureDatabaseConnection().catch((err) => {
  console.error("Failed to initialize database connection. Exiting.");
  process.exit(1);
});

// ===== ログ用テーブル（存在しなければ作成） =====
async function ensureLoginLogsTable() {
  const sql = `
    CREATE TABLE IF NOT EXISTS login_logs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      ts DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP()),
      userId VARCHAR(100) NULL,
      ip VARCHAR(64) NULL,
      ua TEXT NULL,
      referer TEXT NULL,
      page VARCHAR(255) NULL,
      PRIMARY KEY (id),
      KEY idx_ts (ts),
      KEY idx_userId (userId)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;
  try {
    await pool.query(sql);
    console.log("[db] ensured table 'login_logs'");
  } catch (e) {
    console.error("[db] failed ensuring table 'login_logs':", e);
  }
}

async function ensureEventsLogTable() {
  const sql = `
    CREATE TABLE IF NOT EXISTS events_log (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      ts DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP()),
      anonUserId VARCHAR(100) NULL,
      sessionId VARCHAR(64) NULL,
      page VARCHAR(255) NULL,
      type VARCHAR(50) NOT NULL,
      props TEXT NULL,
      ip VARCHAR(64) NULL,
      ua TEXT NULL,
      referer TEXT NULL,
      PRIMARY KEY (id),
      KEY idx_ts (ts),
      KEY idx_user (anonUserId),
      KEY idx_type (type)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;
  try {
    await pool.query(sql);
    console.log("[db] ensured table 'events_log'");
  } catch (e) {
    console.error("[db] failed ensuring table 'events_log':", e);
  }
}

ensureLoginLogsTable();
ensureEventsLogTable();

// specials テーブルに displayOrder カラムが無ければ追加する
async function ensureSpecialsDisplayOrder() {
  try {
    const [rows] = await pool.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'specials' AND COLUMN_NAME = 'displayOrder'`,
      [DB_CONFIG.database]
    );
    if (!rows || rows.length === 0) {
      try {
        await pool.query("ALTER TABLE specials ADD COLUMN displayOrder INT DEFAULT 0");
        console.log('[db] added column displayOrder to specials');
      } catch (e) {
        console.warn('[db] failed adding displayOrder column (ignored):', e?.message || e);
      }
    } else {
      // already exists
    }
  } catch (e) {
    console.warn('[db] could not verify specials.displayOrder column:', e?.message || e);
  }
}

ensureSpecialsDisplayOrder();

// specials.unit を NULL 許容に（任意入力のため）
async function ensureSpecialsUnitNullable() {
  try {
    const [rows] = await pool.query(
      `SELECT IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'specials' AND COLUMN_NAME = 'unit'`,
      [DB_CONFIG.database]
    );
    const col = rows && rows[0];
    const isNullable = String(col?.IS_NULLABLE || '').toUpperCase() === 'YES';
    if (!isNullable) {
      try {
        await pool.query("ALTER TABLE specials MODIFY unit VARCHAR(50) NULL");
        console.log('[db] modified specials.unit to be NULL-able');
      } catch (e) {
        console.warn('[db] failed modifying specials.unit nullable (ignored):', e?.message || e);
      }
    }
  } catch (e) {
    console.warn('[db] could not verify specials.unit nullable:', e?.message || e);
  }
}

ensureSpecialsUnitNullable();

// 許可オリジン (複数カンマ区切り) 例: https://example.pages.dev,https://foo.example.com
const ALLOW_ORIGINS = (process.env.ALLOW_ORIGINS || "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const ALLOW_ANY = ALLOW_ORIGINS.includes("*");

// 簡易レート制限 (IP 毎に固定窓でカウント) —— 低依存実装
const RATE_WINDOW_MS = Number(process.env.RATE_WINDOW_MS) || 60_000; // 1分
const RATE_MAX = Number(process.env.RATE_MAX) || 120; // 1 分あたり 120 リクエスト
const rateMap = new Map(); // ip -> {count, start}
// 起動時に現在のレート制限設定を出力（デバッグ用）
try {
  console.log(`[rate] RATE_MAX=${RATE_MAX}, RATE_WINDOW_MS=${RATE_WINDOW_MS}ms`);
} catch (e) {}
function rateLimit(req, res, next) {
  // favicon 等の超軽量静的リクエストや画像/CSS/JS、ヘルスチェックはレート制限除外
  const p = String(req.path || req.url || "").toLowerCase();
  if (
    p === "/favicon.ico" ||
    p.startsWith("/images/") ||
    p.startsWith("/css/") ||
    p.startsWith("/js/") ||
    p.startsWith("/ad/") ||
    p.startsWith("/product/") ||
    p === "/api/health" ||
    p.startsWith("/api/health") ||
    p.startsWith("/api/config")
  )
    return next();
  const ip =
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.socket.remoteAddress ||
    "unknown";
  let rec = rateMap.get(ip);
  const now = Date.now();
  if (!rec || now - rec.start >= RATE_WINDOW_MS) {
    rec = { count: 0, start: now };
  }
  rec.count++;
  rateMap.set(ip, rec);
  if (rec.count > RATE_MAX) {
    const retryAfterMs = RATE_WINDOW_MS - (now - rec.start);
      try {
        console.warn(`[rate] limited ip=${ip} count=${rec.count} start=${rec.start} retryAfterMs=${retryAfterMs}`);
      } catch (e) {}
    // HTML を要求している場合はユーザー向けの簡易ページを返す
    try {
      const accept = String(req.headers.accept || "").toLowerCase();
      // ブラウザのナビゲーションや静的ページ要求は HTML 応答を返す
      if (
        accept.includes("text/html") ||
        req.path.endsWith(".html") ||
        req.path === "/" ||
        (req.method === 'GET' && !String(req.path || '').startsWith('/api'))
      ) {
        const seconds = Math.ceil(Math.max(0, retryAfterMs) / 1000);
        return res.status(429).send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>読み込み制限</title><style>body{font-family: system-ui,-apple-system,Segoe UI,Roboto,'Hiragino Kaku Gothic ProN',meiryo,Arial;background:#fff4e6;color:#5a2b00;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;padding:24px} .card{background:#fff;border:1px solid #ffd9b3;padding:20px;border-radius:8px;max-width:720px;text-align:center} .btn{display:inline-block;margin-top:12px;padding:8px 12px;border-radius:6px;border:1px solid rgba(0,0,0,0.08);background:transparent;color:#5a2b00}</style></head><body><div class="card"><h1>読み込み回数の制限を超えました</h1><p>恐れ入りますが時間を空けて再度お試しください。</p><p>しばらく待つと自動的に再読み込みします（約 ${seconds} 秒）</p><button class="btn" onclick="location.reload()">今すぐ再読み込み</button><script>setTimeout(()=>location.reload(),${Math.min(Math.max(0,retryAfterMs),5*60*1000)});</script></div></body></html>`);
      }
    } catch (e) {
      /* ignore and fall back to JSON */
    }
    return res.status(429).json({
      error: "rate_limited",
      retryAfterMs,
    });
  }
  next();
}

// CORS 設定
const corsMiddleware = cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true); // 同一オリジン/CLI
    if (ALLOW_ANY) return callback(null, true);
    if (ALLOW_ORIGINS.some((o) => o === origin)) return callback(null, true);
    return callback(new Error("CORS_NOT_ALLOWED: " + origin));
  },
  credentials: false,
});

app.use(corsMiddleware);
app.use(rateLimit);
app.use(express.json({ limit: "1mb" }));

// ===== スタッフページ用 簡易Basic認証 (/staff/*) =====
// .env に STAFF_BASIC_USER / STAFF_BASIC_PASS を設定すると有効化されます
// STAFF_BASIC_USER が未設定の場合は「任意のユーザー名 + 正しいパスワード」で通過可能です
const STAFF_USER = process.env.STAFF_BASIC_USER || process.env.STAFF_USER || "";
const STAFF_PASS = process.env.STAFF_BASIC_PASS || process.env.STAFF_PASSWORD || "";

function secureEqual(a, b) {
  try {
    const ab = Buffer.from(String(a || ""));
    const bb = Buffer.from(String(b || ""));
    if (ab.length !== bb.length) return false;
    return crypto.timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

function staffBasicAuth(req, res, next) {
  try {
    // パスが /staff 以外なら何もしない
    const p = req.path || req.url || "";
    if (!p.startsWith("/staff")) return next();
    // パスワード未設定なら認証は無効（=通過）
    if (!STAFF_PASS) return next();

    const auth = req.headers["authorization"] || "";
    if (String(auth).startsWith("Basic ")) {
      const b64 = String(auth).slice(6);
      let user = "";
      let pass = "";
      try {
        const decoded = Buffer.from(b64, "base64").toString("utf8");
        const idx = decoded.indexOf(":");
        if (idx >= 0) {
          user = decoded.slice(0, idx);
          pass = decoded.slice(idx + 1);
        } else {
          // ユーザー名だけの形式は未対応 → 認証失敗へ
          user = decoded;
          pass = "";
        }
      } catch {}

      const userOk = STAFF_USER ? secureEqual(user, STAFF_USER) : true;
      const passOk = secureEqual(pass, STAFF_PASS);
      if (userOk && passOk) {
        try {
          const maxAge = 60 * 60 * 12; // 12h
          res.setHeader(
            "Set-Cookie",
            `staff_auth=1; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`
          );
        } catch {}
        return next();
      }
    }

    // ブラウザにBasic認証ダイアログを表示させる
    res.setHeader("WWW-Authenticate", 'Basic realm="staff", charset="UTF-8"');
    return res.status(401).end("Authentication required.");
  } catch (e) {
    return res.status(500).json({ error: "auth_error", detail: String(e?.message || e) });
  }
}

app.use(staffBasicAuth);

// フロントエンド静的配信（file:// を避けるため http で提供）
// サーバーを server/ から起動する想定で、プロジェクトルートを静的配信
const staticRoot = path.resolve(process.cwd(), "..");
app.use(express.static(staticRoot));
console.log("Serving static files from:", staticRoot);

// favicon 404 を抑止（必要なら実ファイルに置き換え可）
app.get("/favicon.ico", (_req, res) => {
  // 明示的にキャッシュさせ 429 再発生を避ける
  res.setHeader("Cache-Control", "public, max-age=86400, immutable");
  // 透明1px GIF (最小レスポンス)。必要なら画像に差し替え可能。
  const gif = Buffer.from(
    "R0lGODlhAQABAIAAAP///////yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
    "base64"
  );
  res.setHeader("Content-Type", "image/gif");
  res.status(200).end(gif);
});

// ヘルスチェック
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// 設定確認用（開発用）
app.get("/api/config", (_req, res) => {
  const preferred = (process.env.GOOGLE_MODEL || "").trim();
  const fallbacksEnv = (process.env.GOOGLE_MODEL_FALLBACKS || "").trim();
  const fallbackList = fallbacksEnv
    ? fallbacksEnv
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  const defaultCandidates = [
    // 新しめの順に配置。環境によって未提供でも後続にフォールバック
    "gemini-2.0-flash",
    "gemini-1.5-flash-latest",
    "gemini-1.5-pro-latest",
    "gemini-1.5-flash-8b-latest",
    // 互換系（最後の保険）
    "gemini-1.5-flash",
    "gemini-1.5-pro",
    "gemini-pro",
  ];
  const modelCandidates = Array.from(
    new Set(
      [preferred || undefined, ...fallbackList, ...defaultCandidates].filter(
        Boolean
      )
    )
  );
  res.json({
    ok: true,
    port: PORT,
    // Gemini のみ
    hasGeminiKey: Boolean(process.env.GOOGLE_API_KEY),
    googleKeyFingerprint: process.env.GOOGLE_API_KEY
      ? `****${String(process.env.GOOGLE_API_KEY).slice(-4)}`
      : null,
    geminiModel: preferred || "gemini-pro",
    geminiModelCandidates: modelCandidates,
    provider: "gemini",
  });
});

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

function normalizeDateInput(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const str = String(value).trim();
  if (!str) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  const parsed = new Date(str);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function normalizeDateTimeInput(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 19).replace("T", " ");
  }
  const str = String(value).trim();
  if (!str) return null;
  const parsed = new Date(str.endsWith("Z") || str.includes("T") ? str : str.replace(" ", "T"));
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 19).replace("T", " ");
}

function toIsoDateTime(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  const str = String(value).trim();
  if (!str) return null;
  const hasTz = /Z|[+-]\d{2}:?\d{2}$/.test(str);
  const isoCandidate = str.includes("T") ? str : str.replace(" ", "T");
  const normalized = hasTz ? isoCandidate : `${isoCandidate}Z`;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function toDateOnlyString(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const str = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  const parsed = new Date(str);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

// base64 らしければ UTF-8 文字列にデコード（失敗時は元の値を返す）
function decodeIfBase64(value) {
  try {
    if (!value || typeof value !== "string") return value || "";
    const compact = value.replace(/\s+/g, "");
    if (!/^[A-Za-z0-9+/=]+$/.test(compact)) return value;
    const buf = Buffer.from(compact, "base64");
    // 再エンコード一致で妥当性確認（末尾の=は無視）
    const reenc = buf.toString("base64").replace(/=+$/, "");
    const norm = compact.replace(/=+$/, "");
    if (reenc !== norm) return value;
    return buf.toString("utf8");
  } catch {
    return value;
  }
}

const mapMessageRow = (row) => ({
  id: row.id,
  author: row.author,
  authorName: row.authorName,
  title: row.title,
  content: row.content,
  datetime: toIsoDateTime(row.datetime),
});

const mapEventRow = (row) => ({
  id: row.id,
  startDate: toDateOnlyString(row.startDate),
  endDate: toDateOnlyString(row.endDate),
  type: row.type,
  text: row.text,
  description: row.description || "",
  image: row.image,
});

const mapSpecialRow = (row) => ({
  id: row.id,
  name: row.name,
  originalPrice: Number(row.originalPrice),
  salePrice: Number(row.salePrice),
  unit: row.unit,
  description: row.description || "",
  recipeIdea: row.recipeIdea || "",
  recipeName: row.recipeName || "",
  recipeDetails: row.recipeDetails || "",
  startDate: toDateOnlyString(row.startDate),
  endDate: toDateOnlyString(row.endDate),
  image: row.image,
  displayOrder: Number(row.displayOrder || 0),
});

const mapCommentRow = (row) => ({
  id: row.id,
  category: row.category,
  title: row.title || null,
  message: row.message,
  name: row.name || null,
  status: row.status,
  submitDate: toIsoDateTime(row.submitDate),
});

// 生成テキストの前置きや余計な接頭辞を除去
function sanitizeAIText(text) {
  try {
    if (!text) return text;
    let s = String(text).trim();
    // 全体先頭の接頭辞を除去
    s = s
      .replace(/^(改善(後|版)?|提案|案|ご提案|ご案内)[:：]\s*/u, "")
      .replace(/^(はい|承知|了解|かしこまり|分かりました)[、。】)]*\s*/u, "");

    const lines = s.split(/\r?\n/).map((l) => l.trim());
    const prefaceRe =
      /^(はい|承知|了解|かしこまり|分かりました|以下|改善案|ご提案|ご案内|お知らせ|ご連絡)\b/u;
    // 先頭から連続する前置き行を削除
    while (lines.length && prefaceRe.test(lines[0])) {
      lines.shift();
    }
    // 見出し的な不要行をさらに除去
    const cleaned = lines
      .filter(
        (l, idx) => !(idx === 0 && /^(改善(後|版)?|提案|案)[:：]/u.test(l))
      )
      .join("\n")
      .trim();
    return cleaned || String(text).trim();
  } catch {
    return text;
  }
}

// メッセージ取得
app.get(
  "/api/messages",
  asyncHandler(async (req, res) => {
    const { published } = req.query || {};
    let sql =
      "SELECT id, author, authorName, title, content, datetime FROM messages";
    if (published) {
      sql += " WHERE datetime <= UTC_TIMESTAMP()";
    }
    sql += " ORDER BY datetime ASC, id ASC";
    const [rows] = await pool.query(sql);
    res.json({ items: rows.map(mapMessageRow) });
  })
);

function requireAdmin(req, res, next) {
  try {
    const token = process.env.ADMIN_TOKEN;
    if (!token) return next(); // 未設定なら許可（開発用途）
    const got = req.headers["x-admin-token"];
    if (got && String(got) === String(token)) return next();
    return res.status(401).json({ error: "unauthorized" });
  } catch (e) {
    return res.status(500).json({ error: "server_error", detail: String(e?.message || e) });
  }
}

function requireAdminIfConfigured(req, res, next) {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return next();
  const got = req.headers["x-admin-token"];
  if (got && String(got) === String(token)) return next();
  return res.status(401).json({ error: "unauthorized" });
}

// スタッフ または 管理者を許可
function requireStaffOrAdmin(req, res, next) {
  try {
    const adminToken = process.env.ADMIN_TOKEN;
    // まずスタッフページ由来の判定を優先します。
    // 管理トークンが設定されている場合でも、スタッフ画面からの操作は許可したい
    try {
      const xstaff = String(req.headers["x-staff-page"] || "").toLowerCase();
      if (xstaff === "1" || xstaff === "true" || xstaff === "yes") return next();
    } catch {}
    try {
      const ref = req.headers["referer"] || req.headers["referrer"];
      if (ref) {
        try {
          const u = new URL(String(ref));
          if (String(u.pathname || "").startsWith("/staff")) return next();
        } catch {
          if (String(ref).includes("/staff")) return next();
        }
      }
    } catch {}
    // staff_basic 認証を通過したユーザーへ付与した Cookie を確認
    const cookies = String(req.headers["cookie"] || "");
    // 正規表現のエスケープが二重になっていてマッチしていなかったため修正
    if (/\bstaff_auth=1\b/.test(cookies)) return next();

    // 上記いずれにも当てはまらない場合は管理トークンでのアクセスを確認
    const got = req.headers["x-admin-token"];
    if (!adminToken) return next();
    if (got && String(got) === String(adminToken)) return next();
    return res.status(401).json({ error: "unauthorized" });
  } catch (e) {
    return res.status(500).json({ error: "server_error", detail: String(e?.message || e) });
  }
}

// メッセージ保存（追加）
app.post(
  "/api/messages",
  requireStaffOrAdmin,
  asyncHandler(async (req, res) => {
    const { author, authorName, title, content, datetime } = req.body || {};
    if (!author || !title || !content || !datetime) {
      return res.status(400).json({
        error: "author, title, content, datetime are required",
      });
    }
    const normalizedDatetime = normalizeDateTimeInput(datetime);
    if (!normalizedDatetime) {
      return res.status(400).json({ error: "invalid datetime" });
    }
    const [result] = await pool.execute(
      `INSERT INTO messages (author, authorName, title, content, datetime)
       VALUES (?, ?, ?, ?, ?)`,
      [author, authorName || null, title, content, normalizedDatetime]
    );
    const [rows] = await pool.query(
      "SELECT id, author, authorName, title, content, datetime FROM messages WHERE id = ?",
      [result.insertId]
    );
    res.status(201).json({ item: mapMessageRow(rows[0]) });
  })
);

// メッセージ削除
app.delete(
  "/api/messages/:id",
  requireStaffOrAdmin,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "invalid id" });
    }
    const [rows] = await pool.query(
      "SELECT id, author, authorName, title, content, datetime FROM messages WHERE id = ?",
      [id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "not_found" });
    }
    await pool.execute("DELETE FROM messages WHERE id = ?", [id]);
    res.json({ ok: true, item: mapMessageRow(rows[0]) });
  })
);

// イベント取得（?active=1 で本日有効分のみ）
app.get(
  "/api/events",
  asyncHandler(async (req, res) => {
    const { active } = req.query || {};
    let sql =
      "SELECT id, startDate, endDate, type, text, description, image FROM events";
    if (active) {
      sql +=
        " WHERE startDate <= CURRENT_DATE() AND (endDate IS NULL OR endDate >= CURRENT_DATE())";
    }
    sql += " ORDER BY startDate ASC, id ASC";
    const [rows] = await pool.query(sql);
    res.json({ items: rows.map(mapEventRow) });
  })
);

// イベント追加
app.post(
  "/api/events",
  requireStaffOrAdmin,
  asyncHandler(async (req, res) => {
    const { startDate, endDate, type, text, description, image } = req.body || {};
    const normalizedStart = normalizeDateInput(startDate);
    if (!normalizedStart || !type || !text) {
      return res
        .status(400)
        .json({ error: "startDate, type, text are required" });
    }
    const normalizedEnd = endDate ? normalizeDateInput(endDate) : null;
    if (endDate && !normalizedEnd) {
      return res.status(400).json({ error: "invalid endDate" });
    }
    const [result] = await pool.execute(
      `INSERT INTO events (startDate, endDate, type, text, description, image)
       VALUES (?, ?, ?, ?, ?, ?)` ,
      [
        normalizedStart,
        normalizedEnd,
        type,
        text,
        description || "",
        image || null,
      ]
    );
    const [rows] = await pool.query(
      "SELECT id, startDate, endDate, type, text, description, image FROM events WHERE id = ?",
      [result.insertId]
    );
    res.status(201).json({ item: mapEventRow(rows[0]) });
  })
);

// イベント削除
app.delete(
  "/api/events/:id",
  requireStaffOrAdmin,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "invalid id" });
    }
    const [rows] = await pool.query(
      "SELECT id, startDate, endDate, type, text, description, image FROM events WHERE id = ?",
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "not_found" });
    await pool.execute("DELETE FROM events WHERE id = ?", [id]);
    res.json({ ok: true, item: mapEventRow(rows[0]) });
  })
);

// 特価（specials）取得（?active=1 で本日有効分のみ）
app.get(
  "/api/specials",
  asyncHandler(async (req, res) => {
    const { active, start, end } = req.query || {};
    const conds = [];
    const args = [];

    if (active) {
      // Use explicit JST (Asia/Tokyo) date string instead of DB CURRENT_DATE()
      // to avoid visibility problems when the DB server timezone is UTC.
      // Compute JST by adding 9 hours to UTC time and taking YYYY-MM-DD.
      try {
        const jstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
        const todayJst = jstNow.toISOString().slice(0, 10);
        conds.push("startDate <= ? AND (endDate IS NULL OR endDate >= ?)");
        args.push(todayJst, todayJst);
      } catch (e) {
        // Fallback to DB CURRENT_DATE() if JS date computation fails for any reason
        conds.push(
          "startDate <= CURRENT_DATE() AND (endDate IS NULL OR endDate >= CURRENT_DATE())"
        );
      }
    }

    // 期間フィルタ（重なり判定）
    // 指定: start<=endDate && (endDate is null || end>=startDate)
    const startNorm = normalizeDateInput(start);
    const endNorm = normalizeDateInput(end);
    if (startNorm && endNorm) {
      conds.push("startDate <= ? AND (endDate IS NULL OR endDate >= ?)");
      args.push(endNorm, startNorm);
    } else if (startNorm && !endNorm) {
      // 単日指定扱い
      conds.push("startDate <= ? AND (endDate IS NULL OR endDate >= ?)");
      args.push(startNorm, startNorm);
    } else if (!startNorm && endNorm) {
      // 終了日のみ → 期間開始の下限を最小にして重なりとみなす
      conds.push("startDate <= ?");
      args.push(endNorm);
    }

    const where = conds.length ? ` WHERE ${conds.join(" AND ")}` : "";
    const sqlWithOrder =
      "SELECT id, name, originalPrice, salePrice, unit, description, recipeIdea, recipeName, recipeDetails, startDate, endDate, image, IFNULL(displayOrder,0) AS displayOrder FROM specials" +
      where +
      " ORDER BY COALESCE(displayOrder, 999999), startDate ASC, id ASC";
    try {
      const [rows] = await pool.query(sqlWithOrder, args);
      return res.json({ items: rows.map(mapSpecialRow) });
    } catch (err) {
      // displayOrder カラムが存在しないと ER_BAD_FIELD_ERROR が発生する
      if (err && err.code === 'ER_BAD_FIELD_ERROR' && String(err.sqlMessage || '').includes('displayOrder')) {
        // フォールバック：displayOrder を使わないクエリで再試行
        try {
          const sqlFallback =
            "SELECT id, name, originalPrice, salePrice, unit, description, recipeIdea, recipeName, recipeDetails, startDate, endDate, image FROM specials" +
            where +
            " ORDER BY startDate ASC, id ASC";
          const [rows2] = await pool.query(sqlFallback, args);
          // 別スレッドでカラム追加を試みる（非同期）
          ensureSpecialsDisplayOrder().catch(()=>{});
          return res.json({ items: rows2.map(mapSpecialRow) });
        } catch (e2) {
          throw e2;
        }
      }
      throw err;
    }
  })
);

// 特価（specials）追加
app.post(
  "/api/specials",
  requireStaffOrAdmin,
  asyncHandler(async (req, res) => {
    const {
      name,
      originalPrice,
      salePrice,
      unit,
      description,
      recipeIdea,
      recipeName,
      recipeDetails,
      startDate,
      endDate,
      image,
      imageUrl,
    } = req.body || {};
    const sale = Number(salePrice);
    let orig = Number(originalPrice);
    if (Number.isNaN(orig)) orig = sale;
    const normalizedStart = normalizeDateInput(startDate);
    const normalizedEnd = endDate ? normalizeDateInput(endDate) : null;
    // unit は任意。name, salePrice, startDate のみ必須
    if (!name || Number.isNaN(sale) || !normalizedStart) {
      return res.status(400).json({
        error: "name, salePrice, startDate are required",
      });
    }
    if (endDate && !normalizedEnd) {
      return res.status(400).json({ error: "invalid endDate" });
    }
    const [result] = await pool.execute(
      `INSERT INTO specials (name, originalPrice, salePrice, unit, description, recipeIdea, recipeName, recipeDetails, startDate, endDate, image)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
      [
        name,
        orig,
        sale,
        (unit && String(unit).trim()) ? String(unit).trim() : null,
        description || "",
        recipeIdea || "",
        recipeName || recipeIdea || "",
        decodeIfBase64(recipeDetails || ""),
        normalizedStart,
        normalizedEnd,
        imageUrl || image || null,
      ]
    );
    const [rows] = await pool.query(
      "SELECT id, name, originalPrice, salePrice, unit, description, recipeIdea, recipeName, recipeDetails, startDate, endDate, image, IFNULL(displayOrder,0) AS displayOrder FROM specials WHERE id = ?",
      [result.insertId]
    );
    res.status(201).json({ item: mapSpecialRow(rows[0]) });
  })
);

// 特価（specials）追加のエイリアス（ALBパスルール回避: /api/events 配下）
app.post(
  "/api/events/specials",
  requireStaffOrAdmin,
  asyncHandler(async (req, res) => {
    const {
      name,
      originalPrice,
      salePrice,
      unit,
      description,
      recipeIdea,
      recipeName,
      recipeDetails,
      startDate,
      endDate,
      image,
      imageUrl,
    } = req.body || {};
    const sale = Number(salePrice);
    let orig = Number(originalPrice);
    if (Number.isNaN(orig)) orig = sale;
    const normalizedStart = normalizeDateInput(startDate);
    const normalizedEnd = endDate ? normalizeDateInput(endDate) : null;
    if (!name || Number.isNaN(sale) || !normalizedStart) {
      return res.status(400).json({
        error: "name, salePrice, startDate are required",
      });
    }
    if (endDate && !normalizedEnd) {
      return res.status(400).json({ error: "invalid endDate" });
    }
    const [result] = await pool.execute(
      `INSERT INTO specials (name, originalPrice, salePrice, unit, description, recipeIdea, recipeName, recipeDetails, startDate, endDate, image)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name,
        orig,
        sale,
        (unit && String(unit).trim()) ? String(unit).trim() : null,
        description || "",
        recipeIdea || "",
        recipeName || recipeIdea || "",
        decodeIfBase64(recipeDetails || ""),
        normalizedStart,
        normalizedEnd,
        imageUrl || image || null,
      ]
    );
    const [rows] = await pool.query(
      "SELECT id, name, originalPrice, salePrice, unit, description, recipeIdea, recipeName, recipeDetails, startDate, endDate, image, IFNULL(displayOrder,0) AS displayOrder FROM specials WHERE id = ?",
      [result.insertId]
    );
    res.status(201).json({ item: mapSpecialRow(rows[0]) });
  })
);

// 特価（specials）追加のエイリアス（ALBパスルール回避: /api/messages 配下）
app.post(
  "/api/messages/specials",
  requireStaffOrAdmin,
  asyncHandler(async (req, res) => {
    const {
      name,
      originalPrice,
      salePrice,
      unit,
      description,
      recipeIdea,
      recipeName,
      recipeDetails,
      startDate,
      endDate,
      image,
      imageUrl,
    } = req.body || {};
    const sale = Number(salePrice);
    let orig = Number(originalPrice);
    if (Number.isNaN(orig)) orig = sale;
    const normalizedStart = normalizeDateInput(startDate);
    const normalizedEnd = endDate ? normalizeDateInput(endDate) : null;
    if (!name || Number.isNaN(sale) || !normalizedStart) {
      return res.status(400).json({
        error: "name, salePrice, startDate are required",
      });
    }
    if (endDate && !normalizedEnd) {
      return res.status(400).json({ error: "invalid endDate" });
    }
    const [result] = await pool.execute(
      `INSERT INTO specials (name, originalPrice, salePrice, unit, description, recipeIdea, recipeName, recipeDetails, startDate, endDate, image)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name,
        orig,
        sale,
        (unit && String(unit).trim()) ? String(unit).trim() : null,
        description || "",
        recipeIdea || "",
        recipeName || recipeIdea || "",
        decodeIfBase64(recipeDetails || ""),
        normalizedStart,
        normalizedEnd,
        imageUrl || image || null,
      ]
    );
    const [rows] = await pool.query(
      "SELECT id, name, originalPrice, salePrice, unit, description, recipeIdea, recipeName, recipeDetails, startDate, endDate, image, IFNULL(displayOrder,0) AS displayOrder FROM specials WHERE id = ?",
      [result.insertId]
    );
    res.status(201).json({ item: mapSpecialRow(rows[0]) });
  })
);
// 特価（specials）追加のエイリアス（ALBのパスルール対策: singular でも受ける）
app.post(
  "/api/special",
  requireStaffOrAdmin,
  asyncHandler(async (req, res) => {
    const {
      name,
      originalPrice,
      salePrice,
      unit,
      description,
      recipeIdea,
      recipeName,
      recipeDetails,
      startDate,
      endDate,
      image,
      imageUrl,
    } = req.body || {};
    const sale = Number(salePrice);
    let orig = Number(originalPrice);
    if (Number.isNaN(orig)) orig = sale;
    const normalizedStart = normalizeDateInput(startDate);
    const normalizedEnd = endDate ? normalizeDateInput(endDate) : null;
    if (!name || !unit || Number.isNaN(sale) || !normalizedStart) {
      return res.status(400).json({
        error: "name, salePrice, unit, startDate are required",
      });
    }
    if (endDate && !normalizedEnd) {
      return res.status(400).json({ error: "invalid endDate" });
    }
    const [result] = await pool.execute(
      `INSERT INTO specials (name, originalPrice, salePrice, unit, description, recipeIdea, recipeName, recipeDetails, startDate, endDate, image)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
      [
        name,
        orig,
        sale,
        unit,
        description || "",
        recipeIdea || "",
        recipeName || recipeIdea || "",
        decodeIfBase64(recipeDetails || ""),
        normalizedStart,
        normalizedEnd,
        imageUrl || image || null,
      ]
    );
    const [rows] = await pool.query(
      "SELECT id, name, originalPrice, salePrice, unit, description, recipeIdea, recipeName, recipeDetails, startDate, endDate, image, IFNULL(displayOrder,0) AS displayOrder FROM specials WHERE id = ?",
      [result.insertId]
    );
    res.status(201).json({ item: mapSpecialRow(rows[0]) });
  })
);

// 特価（specials）追加の最終フォールバック（GETトンネル）
// 目的: WAF/ALB が特定の POST パスを403で遮断する環境での暫定回避
// 仕様: /api/add-item?t=s&p=<base64(JSON)>
//       t=s のみ受理（specials の追加）。p は UTF-8 JSON の base64。
// 認可: requireStaffOrAdmin（スタッフ/管理者のみ）
app.get(
  "/api/add-item",
  requireStaffOrAdmin,
  asyncHandler(async (req, res) => {
    try {
      const t = String(req.query.t || "");
      if (t !== "s" && t !== "e") return res.status(400).json({ error: "invalid_type" });
      const p = String(req.query.p || "");
      if (!p) return res.status(400).json({ error: "missing_payload" });
      let obj = null;
      try {
        const buf = Buffer.from(p, "base64");
        obj = JSON.parse(buf.toString("utf8"));
      } catch (e) {
        return res.status(400).json({ error: "bad_payload" });
      }

      if (t === "s") {
        const {
          name,
          originalPrice,
          salePrice,
          unit,
          description,
          recipeIdea,
          recipeName,
          recipeDetails,
          startDate,
          endDate,
          image,
          imageUrl,
        } = obj || {};

        const sale = Number(salePrice);
        let orig = Number(originalPrice);
        if (Number.isNaN(orig)) orig = sale;
        const normalizedStart = normalizeDateInput(startDate);
        const normalizedEnd = endDate ? normalizeDateInput(endDate) : null;
        if (!name || Number.isNaN(sale) || !normalizedStart) {
          return res.status(400).json({
            error: "name, salePrice, startDate are required",
          });
        }
        if (endDate && !normalizedEnd) {
          return res.status(400).json({ error: "invalid endDate" });
        }

        const [result] = await pool.execute(
          `INSERT INTO specials (name, originalPrice, salePrice, unit, description, recipeIdea, recipeName, recipeDetails, startDate, endDate, image)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
          [
            name,
            orig,
            sale,
            (unit && String(unit).trim()) ? String(unit).trim() : null,
            description || "",
            recipeIdea || "",
            recipeName || recipeIdea || "",
            decodeIfBase64(recipeDetails || ""),
            normalizedStart,
            normalizedEnd,
            imageUrl || image || null,
          ]
        );
        const [rows] = await pool.query(
          "SELECT id, name, originalPrice, salePrice, unit, description, recipeIdea, recipeName, recipeDetails, startDate, endDate, image, IFNULL(displayOrder,0) AS displayOrder FROM specials WHERE id = ?",
          [result.insertId]
        );
        res.status(201).json({ item: mapSpecialRow(rows[0]) });
        return;
      }

      // t === 'e' : events 追加（GETトンネル）
      if (t === "e") {
        const { startDate, endDate, type, text, description, image } = obj || {};
        const normalizedStart = normalizeDateInput(startDate);
        const normalizedEnd = endDate ? normalizeDateInput(endDate) : null;
        if (!normalizedStart || !type || !text) {
          return res.status(400).json({ error: "startDate, type, text are required" });
        }
        if (endDate && !normalizedEnd) {
          return res.status(400).json({ error: "invalid endDate" });
        }
        const [result] = await pool.execute(
          `INSERT INTO events (startDate, endDate, type, text, description, image)
           VALUES (?, ?, ?, ?, ?, ?)` ,
          [
            normalizedStart,
            normalizedEnd,
            type,
            text,
            description || "",
            image || null,
          ]
        );
        const [rows] = await pool.query(
          "SELECT id, startDate, endDate, type, text, description, image FROM events WHERE id = ?",
          [result.insertId]
        );
        res.status(201).json({ item: mapEventRow(rows[0]) });
        return;
      }
    } catch (e) {
      res.status(500).json({ error: "server_error", detail: String(e?.message || e) });
    }
  })
);

// 特価（specials）削除
app.delete(
  "/api/specials/:id",
  requireStaffOrAdmin,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "invalid id" });
    }
    const [rows] = await pool.query(
      "SELECT id, name, originalPrice, salePrice, unit, description, recipeIdea, recipeName, recipeDetails, startDate, endDate, image FROM specials WHERE id = ?",
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: "not_found" });
    await pool.execute("DELETE FROM specials WHERE id = ?", [id]);
    res.json({ ok: true, item: mapSpecialRow(rows[0]) });
  })
);

// 特価（specials）並び替えの保存
app.post(
  "/api/specials/reorder",
  requireStaffOrAdmin,
  asyncHandler(async (req, res) => {
    const { order } = req.body || {};
    if (!Array.isArray(order)) return res.status(400).json({ error: "order array required" });
    try {
      // カラムがなければ追加を試みる（権限エラー等は考慮）
      try {
        await pool.execute("ALTER TABLE specials ADD COLUMN displayOrder INT DEFAULT 0");
        console.log('[db] ensured displayOrder column via ALTER');
      } catch (e) {
        // Duplicate column などは OK、それ以外は権限不足の可能性がある
        const msg = String(e?.message || e || '');
        if (msg.includes('Duplicate column') || msg.includes('Duplicate column name')) {
          // 無視
        } else {
          console.warn('[db] ALTER TABLE displayOrder may have failed:', msg);
        }
      }

      // カラムが本当に存在するか確認
      let colExists = false;
      try {
        const [cols] = await pool.query(
          `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'specials' AND COLUMN_NAME = 'displayOrder'`,
          [DB_CONFIG.database]
        );
        colExists = Array.isArray(cols) && cols.length > 0;
      } catch (e) {
        console.warn('[db] could not verify displayOrder column after ALTER:', e?.message || e);
      }
      if (!colExists) {
        return res.status(500).json({ error: 'displayOrder_missing', message: 'DB column displayOrder not present; cannot save order. Run ALTER TABLE specials ADD COLUMN displayOrder INT DEFAULT 0 or grant DB permissions.' });
      }

      // トランザクションで順序を更新
      await pool.query("START TRANSACTION");
      let idx = 0;
      for (const idRaw of order) {
        const id = Number(idRaw);
        if (!Number.isFinite(id)) continue;
        await pool.execute("UPDATE specials SET displayOrder = ? WHERE id = ?", [idx, id]);
        idx++;
      }
      await pool.query("COMMIT");
      res.json({ ok: true });
    } catch (e) {
      try { await pool.query("ROLLBACK"); } catch(_){}
      res.status(500).json({ error: "server_error", detail: String(e?.message || e) });
    }
  })
);

// =============================
// 顧客要望 (comments / requests)
// =============================
// 基本スキーマ: { id, category, title, message, name, status, submitDate }
// status: pending | in-progress | completed

function sanitizeStatus(st) {
  return ["pending", "in-progress", "completed"].includes(st) ? st : "pending";
}

// コメント一覧
const listCommentsHandler = asyncHandler(async (_req, res) => {
  const [rows] = await pool.query(
    "SELECT id, category, title, message, name, status, submitDate FROM comments ORDER BY id ASC"
  );
  res.json({ items: rows.map(mapCommentRow) });
});

app.get("/api/comments", listCommentsHandler);
app.get("/api/requests", listCommentsHandler);

// 追加
const createCommentHandler = asyncHandler(async (req, res) => {
  const { category, message, title, name } = req.body || {};
  if (!category || !message) {
    return res
      .status(400)
      .json({ error: "category and message are required" });
  }
  const now = normalizeDateTimeInput(new Date());
  const [result] = await pool.execute(
    `INSERT INTO comments (category, title, message, name, status, submitDate)
     VALUES (?, ?, ?, ?, 'pending', ?)` ,
    [category, title || null, message, name || null, now]
  );
  const [rows] = await pool.query(
    "SELECT id, category, title, message, name, status, submitDate FROM comments WHERE id = ?",
    [result.insertId]
  );
  res.status(201).json({ item: mapCommentRow(rows[0]) });
});

app.post("/api/comments", createCommentHandler);
app.post("/api/requests", createCommentHandler);

// ステータス更新 (patch)
const updateCommentStatusHandler = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id))
    return res.status(400).json({ error: "invalid id" });
  const { status } = req.body || {};
  const sanitized = sanitizeStatus(status);
  const [rows] = await pool.query(
    "SELECT id, category, title, message, name, status, submitDate FROM comments WHERE id = ?",
    [id]
  );
  if (!rows.length) return res.status(404).json({ error: "not_found" });
  await pool.execute("UPDATE comments SET status = ? WHERE id = ?", [sanitized, id]);
  res.json({ item: { ...mapCommentRow(rows[0]), status: sanitized } });
});

app.patch("/api/comments/:id/status", updateCommentStatusHandler);
app.post("/api/requests/:id/status", updateCommentStatusHandler);

// 削除
const deleteCommentHandler = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id))
    return res.status(400).json({ error: "invalid id" });
  const [rows] = await pool.query(
    "SELECT id, category, title, message, name, status, submitDate FROM comments WHERE id = ?",
    [id]
  );
  if (!rows.length) return res.status(404).json({ error: "not_found" });
  await pool.execute("DELETE FROM comments WHERE id = ?", [id]);
  res.json({ ok: true, item: mapCommentRow(rows[0]) });
});

app.delete("/api/comments/:id", deleteCommentHandler);
app.delete("/api/requests/:id", deleteCommentHandler);

// Google Gemini (Generative AI SDK - モデル自動フォールバック付き)
async function geminiTextGeneration(prompt) {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_API_KEY is not set");
  const preferred = (process.env.GOOGLE_MODEL || "").trim();
  const fallbacksEnv = (process.env.GOOGLE_MODEL_FALLBACKS || "").trim();
  const fallbackList = fallbacksEnv
    ? fallbacksEnv
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  const baseCandidates = [
    // 優先: .env で指定されたモデル
    preferred || undefined,
    // 次に .env のフォールバック一覧（カンマ区切り）
    ...fallbackList,
    // 既定の候補（新しめ → 互換）
    "gemini-2.0-flash",
    "gemini-1.5-flash-latest",
    "gemini-1.5-pro-latest",
    "gemini-1.5-flash-8b-latest",
    "gemini-1.5-flash",
    "gemini-1.5-pro",
    "gemini-pro",
  ].filter(Boolean);

  const expandLatest = (name) => {
    if (!name) return [];
    if (/-latest$/.test(name)) return [name];
    if (/^gemini-(1|2)\.\d+-/.test(name)) return [name, `${name}-latest`];
    if (name === "gemini-pro") return [name, "gemini-1.5-pro-latest"];
    return [name];
  };
  const expand25 = (list) => {
    const has25 = list.some((n) => /gemini-2\.5-/.test(n));
    if (!has25) return list;
    return [
      ...list,
      "gemini-2.0-flash",
      "gemini-1.5-flash-latest",
      "gemini-1.5-pro-latest",
    ];
  };

  const candidates = Array.from(
    new Set(expand25(baseCandidates).flatMap((n) => expandLatest(n)))
  );

  const genAI = new GoogleGenerativeAI(apiKey);
  const generationConfig = {
    temperature: 0.7,
    maxOutputTokens: 400,
  };

  const tried = [];
  let lastErr = null;
  for (const modelName of candidates) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig,
      });
      const response = await result.response;
      const text = response.text();
      if (!text) throw new Error("Gemini SDK response missing content");
      if (tried.length > 0) {
        console.warn(
          `[gemini] succeeded with fallback model '${modelName}' after failures: ${tried
            .map((t) => t.model)
            .join(", ")}`
        );
      } else {
        console.log(`[gemini] succeeded with model '${modelName}'`);
      }
      return text;
    } catch (error) {
      const msg = String(error?.message || error || "");
      tried.push({ model: modelName, error: msg });
      // 404 や not found/unsupported などは次候補へフォールバック
      const lower = msg.toLowerCase();
      const isNotFound =
        lower.includes("404") ||
        lower.includes("not found") ||
        lower.includes("unsupported") ||
        lower.includes("not supported") ||
        lower.includes("unknown model");
      const isPermission =
        lower.includes("permission") || lower.includes("403");
      const isQuota = lower.includes("quota") || lower.includes("429");
      // permission/quota でも別モデルで通る場合があるため、まずは次に進む
      console.warn(`[gemini] model '${modelName}' failed: ${msg}`);
      lastErr = error;
      // 次の候補へ（ループ継続）
      continue;
    }
  }

  // すべて失敗した場合
  const triedStr = tried.map((t) => `${t.model}: ${t.error}`).join(" | ");
  throw new Error(
    `Gemini text generation failed with all candidates. Tried: ${tried
      .map((t) => t.model)
      .join(", ")}. Hint: try models with '-latest' suffix. Last error: ${
      lastErr?.message || lastErr
    }. Details: ${triedStr}`
  );
}

// 文章改善 API
app.post("/api/improve-message", requireStaffOrAdmin, async (req, res) => {
  try {
    const { title, content, author } = req.body || {};
    if (!title || !content) {
      return res.status(400).json({ error: "title and content are required" });
    }
    const prompt = `あなたはスーパーマーケットの店員です。店舗からのメッセージを、来店意識を高める内容に改善してください。200字程度で絵文字は1〜2個。事実のみを記述。
敬語や前置きや謝罪や同意や承諾や挨拶の文は一切書かない。『はい、承知いたしました』『以下、改善案です』などの前置きは禁止。出力は本文のみ。
スーパーの名前は松源です。
タイトル: ${title}
内容: ${content}
投稿者: ${author || ""}
改善されたメッセージのみを出力。`;

    const text = await geminiTextGeneration(prompt);
    const cleaned = sanitizeAIText(text);
    res.json({ text: cleaned });
  } catch (err) {
    console.error("/api/improve-message error:", err);
    res
      .status(500)
      .json({ error: "server_error", detail: err?.message || String(err) });
  }
});

// 特価商品 説明生成
app.post("/api/special/description", requireStaffOrAdmin, async (req, res) => {
  try {
    const {
      name,
      salePrice,
      unit,
      description,
      recipeIdea,
      startDate,
      endDate,
    } = req.body || {};
    if (!name || !salePrice || !unit) {
      return res.status(400).json({ error: "name, salePrice, unit are required" });
    }
    // 期間判定
    const singleDay = startDate && (!endDate || endDate === startDate);
    // プロンプト内で『本日限り』ルールを明示
    const prompt = `以下の特価商品について、店内POP風に「お客様がすぐ理解できる」端的な説明を作成。50字程度（最大60字）で、絵文字は1個まで。前置き/同意/謝罪/挨拶/「おすすめです」等の汎用表現は禁止。具体的価値と差別化ポイントを1つ含める。
    重要な出力禁止ルール:
    - 『通常価格』や『割引率』、『〜より◯円引き』、『◯%OFF』など、価格の比較表現を一切出力してはいけません。
    - 価格差や割引額・割引率を示す表現を含めないでください。代わりに商品の魅力や価値を述べてください。
    期間表現ルール:
    - 特価期間が1日(開始日と終了日が同じ又は終了日なし)なら文中に必ず『本日限り』を自然に1回だけ入れる。
    - 2日以上の期間がある場合は『本日限り』という語を絶対に含めない。
    商品名: ${name}
    特価: ${salePrice}円
    単位: ${unit}
    開始日: ${startDate || "不明"}
    終了日: ${endDate || startDate || "不明"}
    ${description ? `既存説明: ${description}` : ""}
    ${recipeIdea ? `レシピ案: ${recipeIdea}` : ""}
    出力は説明文1行のみ。`;

    let text = await geminiTextGeneration(prompt);
    // サニタイズ + 期間ルールの最終補正
    try {
      text = sanitizeAIText(text) || text;
      if (singleDay) {
        if (!/本日限り/.test(text)) {
          text = text.replace(/。?$/, "") + " 本日限り。";
        }
        // 重複した場合は1回に正規化
        text = text.replace(/(本日限り){2,}/g, "本日限り");
      } else {
        // 複数日 → 『本日限り』除去
        text = text.replace(/本日限り。?/g, "");
      }
      // 60字上限をかるく超えそうならトリム（句点で終わるように）
      const max = 60;
      if (text.length > max) {
        text = text.slice(0, max).replace(/[、。,!.！]*$/u, "") + "。";
      }
    } catch {}
    res.json({ text });
  } catch (err) {
    console.error("/api/special/description error:", err);
    res
      .status(500)
      .json({ error: "server_error", detail: err?.message || String(err) });
  }
});

// 特価商品 レシピ生成
app.post("/api/special/recipe", requireStaffOrAdmin, async (req, res) => {
  try {
    const { name, salePrice, recipeIdea, onlyName } = req.body || {};
    if (!name || !salePrice) {
      return res.status(400).json({ error: "name and salePrice are required" });
    }
        const prompt = onlyName
      ? `次の条件で日本語のレシピ名だけを1つ考えてください。条件: 15分以内で作れる・材料5個以内・家庭的・敬語/前置き/同意/謝罪/挨拶は禁止・出力はレシピ名のみ1行・接頭辞「レシピ名:」などは禁止。
    対象食材: ${name}
    ${recipeIdea ? `ヒント: ${recipeIdea}` : ""}
    重要: レシピ名や説明に『通常価格』や『割引』、『◯円引き』、『%OFF』等の価格比較表現を含めないでください。`
      : `次の制約で日本語のレシピを1つ作成してください。
    制約: 15分以内で作れる・材料5個以内・家庭的で美味しい・敬語や前置きや謝罪や同意の文は一切書かない・出力は次の3行のみ・余計な行を出さない・1行目は必ずレシピ名だけを書く。
    出力形式（厳守・先頭からこの順で3行のみ）:
    レシピ名: <料理名>
    材料: <材料を「,」区切りで列挙>
    作り方: <手順を簡潔に1行で>
    対象食材: ${name}
    ${recipeIdea ? `ヒント: ${recipeIdea}` : ""}
    重要: レシピ内で『通常価格』や『割引率』、『◯円引き』、『%OFF』などの価格比較表現を一切出力しないでください。`;

    const text = await geminiTextGeneration(prompt);
    if (onlyName) {
      // レシピ名のみの応答を厳格に1行へサニタイズ
      const lines = String(text || "")
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      const pickTitle = () => {
        let first = lines[0] || "";
        first = first
          .replace(/^(レシピ名[:：]\s*|Recipe\s*Name[:：]\s*)/i, "")
          .replace(/^[-*・\d]+[\.)】]*/u, "")
          .replace(/^["'「『（(]+/, "")
          .replace(/["'」』）)]+$/, "")
          .trim();
        if (/^(はい|承知|了解|かしこまり|分かりました)/.test(first)) first = "";
        if (first) return first;
        const candidate = lines.find(
          (l) =>
            l.length > 0 &&
            l.length <= 30 &&
            !/材料|作り方|Ingredients|Directions|[:：]/.test(l)
        );
        if (candidate) return candidate;
        return `${name}の簡単おかず`;
      };
      return res.json({ text: pickTitle() });
    }
    res.json({ text });
  } catch (err) {
    console.error("/api/special/recipe error:", err);
    res
      .status(500)
      .json({ error: "server_error", detail: err?.message || String(err) });
  }
});

// ===== ログ API =====
// ログインログ記録（失敗しても機能に影響しない設計）
app.post("/api/log-login", async (req, res) => {
  try {
    const ip = (req.headers["x-forwarded-for"]?.split(",")[0]?.trim()) || req.socket.remoteAddress || null;
    const ua = req.headers["user-agent"] || null;
    const referer = req.headers["referer"] || req.headers["referrer"] || null;
    const { userId, page } = req.body || {};
    await pool.execute(
      `INSERT INTO login_logs (userId, ip, ua, referer, page) VALUES (?, ?, ?, ?, ?)`,
      [userId || null, ip || null, ua || null, referer || null, page || null]
    );
    res.json({ ok: true });
  } catch (e) {
    console.warn("/api/log-login failed:", e?.message || e);
    res.status(200).json({ ok: false });
  }
});

// ログインログ一覧
app.get("/api/login-logs", requireAdminIfConfigured, async (req, res) => {
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 50));
  const page = Math.max(1, Number(req.query.page) || 1);
  const userId = (req.query.userId || "").trim();
  const since = (req.query.since || "").trim();
  const until = (req.query.until || "").trim();

  const conds = [];
  const args = [];
  if (userId) { conds.push("userId = ?"); args.push(userId); }
  if (since) { conds.push("ts >= ?"); args.push(normalizeDateTimeInput(since + " 00:00:00")); }
  if (until) { conds.push("ts <= ?"); args.push(normalizeDateTimeInput(until + " 23:59:59")); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const offset = (page - 1) * limit;
  const [[{ cnt }]] = await pool.query(`SELECT COUNT(*) AS cnt FROM login_logs ${where}`, args);
  const [rows] = await pool.query(
    `SELECT id, ts, userId, ip, ua, referer, page FROM login_logs ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...args, limit, offset]
  );
  res.json({ items: rows, total: Number(cnt) || 0, page, limit });
});

// ログインログ削除
app.delete("/api/login-logs/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid id" });
  await pool.execute("DELETE FROM login_logs WHERE id = ?", [id]);
  res.json({ ok: true });
});

// 行動イベント記録
app.post("/api/event-logs", async (req, res) => {
  try {
    // Do NOT record events that originate from the staff UI.
// ===== アクセス推移（日次） =====
// login_logs を JST 日付で集計し、指定範囲の欠損日は 0 で補完して返す
app.get(
  "/api/stats/access-trend",
  requireAdminIfConfigured,
  asyncHandler(async (req, res) => {
    const sinceStr = String(req.query.since || "").trim();
    const untilStr = String(req.query.until || "").trim();

    // 入力がなければ直近14日間
    const nowJst = new Date(
      new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })
    );
    const defaultUntil = new Date(nowJst.getFullYear(), nowJst.getMonth(), nowJst.getDate());
    const defaultSince = new Date(defaultUntil);
    defaultSince.setDate(defaultSince.getDate() - 13);

    const since = normalizeDateInput(sinceStr) || defaultSince.toISOString().slice(0, 10);
    const until = normalizeDateInput(untilStr) || defaultUntil.toISOString().slice(0, 10);

    // SQL 集計（UTC→JST に変換して日付抽出）
    const sql = `
      SELECT DATE(CONVERT_TZ(ts, '+00:00', '+09:00')) AS d, COUNT(*) AS c
      FROM login_logs
      WHERE ts >= CONVERT_TZ(?, '+09:00', '+00:00')
        AND ts <  DATE_ADD(CONVERT_TZ(?, '+09:00', '+00:00'), INTERVAL 1 DAY)
      GROUP BY d
      ORDER BY d
    `;
    const params = [since + " 00:00:00", until + " 00:00:00"];
    const [rows] = await pool.query(sql, params);
    const map = new Map();
    for (const r of rows) {
      const d = toDateOnlyString(r.d);
      const c = Number(r.c) || 0;
      map.set(d, c);
    }

    const begin = new Date(since + "T00:00:00+09:00");
    const end = new Date(until + "T00:00:00+09:00");
    const items = [];
    if (isFinite(begin.getTime()) && isFinite(end.getTime())) {
      for (
        let cur = new Date(begin);
        cur <= end;
        cur.setDate(cur.getDate() + 1)
      ) {
        const y = cur.toISOString().slice(0, 10);
        items.push({ date: y, count: map.get(y) || 0 });
      }
    }
    res.json({ ok: true, items });
  })
);

    // Detection: either a referer containing '/staff' or the special header 'x-staff-page' set by the staff client.
    const referer = req.headers["referer"] || req.headers["referrer"] || "";
    const fromStaffHeader = (req.headers["x-staff-page"] || "").toString();
    if (referer.includes("/staff") || fromStaffHeader === "1" || fromStaffHeader === "true") {
      // Acknowledge but do not persist
      return res.status(204).end();
    }

    const ip = (req.headers["x-forwarded-for"]?.split(",")[0]?.trim()) || req.socket.remoteAddress || null;
    const ua = req.headers["user-agent"] || null;
    const { type, props, page, anonUserId, sessionId } = req.body || {};
    if (!type) return res.status(400).json({ error: "type is required" });

    // Basic sanitization: drop obvious PII keys if present in props
    let safeProps = props || null;
    try {
      if (safeProps && typeof safeProps === "object") {
        const clone = JSON.parse(JSON.stringify(safeProps));
        const piiKeys = ["email", "phone", "tel", "name", "fullname", "account", "password"];
        for (const k of piiKeys) {
          if (k in clone) clone[k] = "[REDACTED]";
        }
        safeProps = clone;
      }
    } catch (e) {
      safeProps = props;
    }

    const propsStr = safeProps ? (typeof safeProps === "string" ? safeProps : JSON.stringify(safeProps)) : null;
    await pool.execute(
      `INSERT INTO events_log (anonUserId, sessionId, page, type, props, ip, ua, referer)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [anonUserId || null, sessionId || null, page || null, type, propsStr, ip || null, ua || null, referer || null]
    );
    res.json({ ok: true });
  } catch (e) {
    console.warn("/api/event-logs failed:", e?.message || e);
    res.status(200).json({ ok: false });
  }
});

// バッチ受信: 複数イベントをまとめて挿入する (client-side batching)
app.post("/api/event-logs/batch", async (req, res) => {
  try {
    const referer = req.headers["referer"] || req.headers["referrer"] || "";
    const fromStaffHeader = (req.headers["x-staff-page"] || "").toString();
    if (referer.includes("/staff") || fromStaffHeader === "1" || fromStaffHeader === "true") {
      return res.status(204).end();
    }

    const rows = Array.isArray(req.body && req.body.events) ? req.body.events : null;
    if (!rows || !rows.length) return res.status(400).json({ error: "events array required" });

    const ip = (req.headers["x-forwarded-for"]?.split(",")[0]?.trim()) || req.socket.remoteAddress || null;
    const ua = req.headers["user-agent"] || null;

    const insertPromises = [];
    for (const ev of rows) {
      try {
        const { type, props, page, anonUserId, sessionId } = ev || {};
        if (!type) continue;
        // sanitize props
        let safeProps = props || null;
        try {
          if (safeProps && typeof safeProps === "object") {
            const clone = JSON.parse(JSON.stringify(safeProps));
            const piiKeys = ["email", "phone", "tel", "name", "fullname", "account", "password"];
            for (const k of piiKeys) {
              if (k in clone) clone[k] = "[REDACTED]";
            }
            safeProps = clone;
          }
        } catch (e) { safeProps = props; }
        const propsStr = safeProps ? (typeof safeProps === "string" ? safeProps : JSON.stringify(safeProps)) : null;
        insertPromises.push(
          pool.execute(
            `INSERT INTO events_log (anonUserId, sessionId, page, type, props, ip, ua, referer) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [anonUserId || null, sessionId || null, page || null, type, propsStr, ip || null, ua || null, referer || null]
          )
        );
      } catch (e) {
        // swallow per-event error
      }
    }
    await Promise.all(insertPromises);
    res.json({ ok: true, inserted: insertPromises.length });
  } catch (e) {
    console.warn("/api/event-logs/batch failed:", e?.message || e);
    res.status(200).json({ ok: false });
  }
});

// 行動イベント一覧
app.get("/api/event-logs", requireAdminIfConfigured, async (req, res) => {
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 50));
  const page = Math.max(1, Number(req.query.page) || 1);
  const type = (req.query.type || "").trim();
  const userId = (req.query.userId || "").trim();
  const sessionId = (req.query.sessionId || "").trim();
  const since = (req.query.since || "").trim();
  const until = (req.query.until || "").trim();

  const conds = [];
  const args = [];
  if (type) { conds.push("type = ?"); args.push(type); }
  if (userId) { conds.push("anonUserId = ?"); args.push(userId); }
  if (sessionId) { conds.push("sessionId = ?"); args.push(sessionId); }
  if (since) { conds.push("ts >= ?"); args.push(normalizeDateTimeInput(since + " 00:00:00")); }
  if (until) { conds.push("ts <= ?"); args.push(normalizeDateTimeInput(until + " 23:59:59")); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const offset = (page - 1) * limit;
  const [[{ cnt }]] = await pool.query(`SELECT COUNT(*) AS cnt FROM events_log ${where}`, args);
  const [rows] = await pool.query(
    `SELECT id, ts, anonUserId, sessionId, page, type, props, ip, ua, referer FROM events_log ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...args, limit, offset]
  );
  const items = rows.map((r) => {
    let p = r.props;
    try { if (typeof p === "string" && p) p = JSON.parse(p); } catch {}
    return { ...r, props: p };
  });
  res.json({ items, total: Number(cnt) || 0, page, limit });
});

// 集計サマリ: ?group=type|page|feature  ?since ?until
app.get("/api/event-summary", requireAdminIfConfigured, async (req, res) => {
  try {
    const group = (req.query.group || 'type').toString();
    const since = (req.query.since || '').toString();
    const until = (req.query.until || '').toString();
    const conds = [];
    const args = [];
    if (since) { conds.push('ts >= ?'); args.push(normalizeDateTimeInput(since + ' 00:00:00')); }
    if (until) { conds.push('ts <= ?'); args.push(normalizeDateTimeInput(until + ' 23:59:59')); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

    let selectSql = '';
    if (group === 'page') {
      selectSql = `SELECT page AS label, COUNT(*) AS cnt FROM events_log ${where} GROUP BY page ORDER BY cnt DESC`;
    } else if (group === 'feature') {
      // attempt to extract props.feature (JSON) if present
      selectSql = `SELECT IFNULL(JSON_UNQUOTE(JSON_EXTRACT(props, '$.feature')), '[unknown]') AS label, COUNT(*) AS cnt FROM events_log ${where} GROUP BY label ORDER BY cnt DESC`;
    } else {
      selectSql = `SELECT type AS label, COUNT(*) AS cnt FROM events_log ${where} GROUP BY type ORDER BY cnt DESC`;
    }

    const [rows] = await pool.query(selectSql, args);
    res.json({ items: rows.map(r => ({ label: r.label, count: Number(r.cnt) })) });
  } catch (e) {
    console.error('/api/event-summary failed', e);
    res.status(500).json({ error: 'server_error', detail: String(e?.message || e) });
  }
});

// 行動イベント削除
app.delete("/api/event-logs/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid id" });
  await pool.execute("DELETE FROM events_log WHERE id = ?", [id]);
  res.json({ ok: true });
});

// ===== 顧客ページ累計利用人数 =====
// 顧客側イベントログ(events_log)に記録される anonUserId の DISTINCT 件数を返す
// スタッフ画面由来のイベントは server 側で除外済みのため、そのまま集計可能
app.get("/api/stats/customer-users", requireAdminIfConfigured, async (req, res) => {
  try {
    const since = (req.query.since || '').toString();
    const until = (req.query.until || '').toString();
    const conds = [];
    const args = [];
    // スタッフ画面由来は events_log への記録段階で除外済み
    if (since) { conds.push('ts >= ?'); args.push(normalizeDateTimeInput(since + ' 00:00:00')); }
    if (until) { conds.push('ts <= ?'); args.push(normalizeDateTimeInput(until + ' 23:59:59')); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    // anonUserId が無い場合は (ip, ua) の組み合わせでユニーク化し重複を除外
    const sql = `SELECT COUNT(DISTINCT COALESCE(NULLIF(anonUserId,''), CONCAT(IFNULL(ip,''),'|',IFNULL(ua,'')))) AS cnt FROM events_log ${where}`;
    const [[{ cnt }]] = await pool.query(sql, args);
    res.json({ ok: true, totalUsers: Number(cnt) || 0, generatedAt: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: "server_error", detail: String(e?.message || e) });
  }
});

// 最大ユーザーID（login_logs.userId の数値最大値を返す。非数値は無視）
app.get('/api/stats/max-user-id', requireAdminIfConfigured, async (req, res) => {
  try {
    const since = (req.query.since || '').toString();
    const until = (req.query.until || '').toString();
    const conds = [];
    const args = [];
    if (since) { conds.push('ts >= ?'); args.push(normalizeDateTimeInput(since + ' 00:00:00')); }
    if (until) { conds.push('ts <= ?'); args.push(normalizeDateTimeInput(until + ' 23:59:59')); }
    // 削除済みデータはテーブルから消えるため自然に除外される。空文字/NULLは除外。
    conds.push('userId IS NOT NULL');
    conds.push("userId <> ''");
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const sql = `SELECT COUNT(DISTINCT userId) AS maxBadge FROM login_logs ${where}`;
    const [[{ maxBadge }]] = await pool.query(sql, args);
    const n = Number(maxBadge) || 0;
    res.json({ ok: true, maxUserId: n, generatedAt: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: 'server_error', detail: String(e?.message || e) });
  }
});

// ===== ログエクスポート (JSON / Excel) =====
// 共通: クエリ ?kind=login|event  limit / since / until / userId / type など既存パラメータを再利用
app.get("/api/log-export", requireAdmin, async (req, res) => {
  try {
    const kind = (req.query.kind || "login").toString();
    const format = (req.query.format || "json").toString().toLowerCase();
    const summary = String(req.query.summary || "").toLowerCase(); // for kind=event: export simplified columns
    const detailsOnly = String(req.query.detailsOnly || "").toLowerCase(); // for kind=event summary: single-column '詳細' only
    const limitRaw = (req.query.limit || "").toString();
    const limitAll = limitRaw === "all"; // 'all' 指定
    const limit = limitAll ? 5000 : Math.min(5000, Math.max(1, Number(limitRaw) || 1000));
    const userId = (req.query.userId || "").trim();
    const type = (req.query.type || "").trim();
    const since = (req.query.since || "").trim();
    const until = (req.query.until || "").trim();

    // 共通: 条件構築用関数
    const buildConds = (isEvent) => {
      const conds = [];
      const args = [];
      if (isEvent) {
        if (userId) { conds.push("anonUserId = ?"); args.push(userId); }
        if (type) { conds.push("type = ?"); args.push(type); }
      } else {
        if (userId) { conds.push("userId = ?"); args.push(userId); }
      }
      if (since) { conds.push("ts >= ?"); args.push(normalizeDateTimeInput(since + " 00:00:00")); }
      if (until) { conds.push("ts <= ?"); args.push(normalizeDateTimeInput(until + " 23:59:59")); }
      return { conds, args };
    };

    // kind=all: ログイン + イベント両方を含む Excel (2シート) / JSON
    if (kind === "all") {
      const { conds: loginConds, args: loginArgs } = buildConds(false);
      const loginWhere = loginConds.length ? `WHERE ${loginConds.join(" AND ")}` : "";
      const { conds: eventConds, args: eventArgs } = buildConds(true);
      const eventWhere = eventConds.length ? `WHERE ${eventConds.join(" AND ")}` : "";

      // 取得（limitAll の場合は最大 5000 件、無ければ LIMIT 指定）
      const loginSql = `SELECT id, ts, userId, ip, ua, referer, page FROM login_logs ${loginWhere} ORDER BY id DESC ${limitAll ? '' : 'LIMIT ?'}`;
      const eventSql = `SELECT id, ts, anonUserId, sessionId, page, type, props, ip, ua, referer FROM events_log ${eventWhere} ORDER BY id DESC ${limitAll ? '' : 'LIMIT ?'}`;
      const [loginRows] = await pool.query(loginSql, limitAll ? loginArgs : [...loginArgs, limit]);
      const [eventRows] = await pool.query(eventSql, limitAll ? eventArgs : [...eventArgs, limit]);

      if (format === "xlsx" || format === "excel") {
        // props の JSON をパース（イベントのみ）
        const normalizedEvents = eventRows.map(r => {
          if (r.props && typeof r.props === 'string') { try { r.props = JSON.parse(r.props); } catch {} }
          return r;
        });
        const wb = XLSX.utils.book_new();
        const shLogin = XLSX.utils.json_to_sheet(loginRows);
        const shEvent = XLSX.utils.json_to_sheet(normalizedEvents);
        XLSX.utils.book_append_sheet(wb, shLogin, 'login');
        XLSX.utils.book_append_sheet(wb, shEvent, 'events');
        const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        const filename = `all-logs-${Date.now()}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
        return res.status(200).end(buf);
      }
      // JSON: 両配列を返す
      return res.json({ ok: true, kind: 'all', login: loginRows, events: eventRows, loginCount: loginRows.length, eventCount: eventRows.length });
    }

    // 既存: 単一 kind (login または event)
    let table, selectCols;
    const isEvent = kind === 'event';
    if (isEvent) {
      table = 'events_log';
      selectCols = 'id, ts, anonUserId, sessionId, page, type, props, ip, ua, referer';
    } else {
      table = 'login_logs';
      selectCols = 'id, ts, userId, ip, ua, referer, page';
    }
    const { conds, args } = buildConds(isEvent);
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const sql = `SELECT ${selectCols} FROM ${table} ${where} ORDER BY id DESC ${limitAll ? '' : 'LIMIT ?'}`;
    const [rows] = await pool.query(sql, limitAll ? args : [...args, limit]);

    if (format === 'xlsx' || format === 'excel') {
      const normalized = rows.map(r => {
        if (r.props && typeof r.props === 'string') { try { r.props = JSON.parse(r.props); } catch {} }
        return r;
      });
      // summary=1 の場合、イベント用に『種類・セッションID・詳細』のみを出力
      let sheet;
      if (isEvent && (summary === '1' || summary === 'true' || summary === 'yes')) {
        const toTypeLabel = (t) => {
          const s = String(t || '');
          switch (s) {
            case 'page_view': return 'ページ閲覧';
            case 'page_loaded': return 'ページ読み込み';
            case 'view': return '表示（領域）';
            case 'click': return 'クリック';
            case 'scroll': return 'スクロール';
            case 'form_submit': return 'フォーム送信';
            default: return s.replace(/_/g, ' ');
          }
        };
        const simple = normalized.map(ev => {
          const p = ev.props || {};
          const typeLabel = toTypeLabel(ev.type);
          const feature = p && (p.feature || ev.page || '');
          const details = [];
          if (p && p.elementId) details.push(`要素ID:${p.elementId}`);
          if (p && p.element) details.push(`要素:${p.element}`);
          if (p && p.text) details.push(`テキスト:"${String(p.text).slice(0,120)}"`);
          if (p && p.durationMs) details.push(`滞在:${Math.round(Number(p.durationMs)/1000)}秒`);
          if (p && (p.maxScrollPct != null)) details.push(`スクロール:${p.maxScrollPct}%`);
          if (p && p.utm) { try { details.push(`utm:${JSON.stringify(p.utm)}`); } catch {} }
          const op = `${typeLabel}${feature ? '（' + feature + '）' : ''}${details.length ? ' — ' + details.join('; ') : ''}`;
          if (detailsOnly === '1' || detailsOnly === 'true' || detailsOnly === 'yes') {
            // 単一列: 詳細 のみ
            return { '詳細': op };
          }
          // 日本語キーへ変換した JSON
          const jpKeyMap = {
            feature: '機能',
            page: 'ページ',
            elementId: '要素ID',
            element: '要素',
            text: 'テキスト',
            durationMs: '滞在ミリ秒',
            maxScrollPct: '最大スクロール率',
            utm: 'utm',
            value: '値'
          };
          const localizedProps = (() => {
            if (!p || typeof p !== 'object') return p;
            const out = {};
            for (const k of Object.keys(p)) {
              const jk = jpKeyMap[k] || k; // 未対応キーはそのまま
              out[jk] = p[k];
            }
            return out;
          })();
          const prettyText = (() => {
            try {
              return JSON.stringify(p || {}, null, 2);
            } catch (e) {
              // 文字列 props の場合そのまま返す
              return typeof ev.props === 'string' ? ev.props : '';
            }
          })();
          return {
            '種類': `${typeLabel}${feature ? '（' + feature + '）' : ''}`,
            'セッションID': ev.sessionId || '',
            '詳細': op,
            // 要望: JSON全文を別列に出力
            '詳細JSON': (() => {
              try {
                // 既にオブジェクト化されている props をそのまま stringify。未定義なら空オブジェクト。
                return JSON.stringify(p || {});
              } catch (e) {
                return typeof ev.props === 'string' ? ev.props : '';
              }
            })(),
            '詳細JSON_JP': (() => {
              try {
                return JSON.stringify(localizedProps || {});
              } catch (e) {
                return '';
              }
            })(),
            '詳細表示テキスト': prettyText,
          };
        });
        sheet = XLSX.utils.json_to_sheet(simple);
      } else {
        // 非サマリーの events 出力で props がオブジェクトのままだとセルが空/不明になる場合があるため文字列化
        const normalizedFlat = normalized.map(r => {
          const obj = { ...r };
          try {
            if (obj && typeof obj.props === 'object' && obj.props !== null) {
              obj.props = JSON.stringify(obj.props);
            }
          } catch {}
          return obj;
        });
        sheet = XLSX.utils.json_to_sheet(normalizedFlat);
      }
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, sheet, isEvent ? 'events' : 'login');
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      const filename = `${kind}-logs-${Date.now()}.xlsx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
      return res.status(200).end(buf);
    } else if (format === 'csv') {
      const cols = rows.length ? Object.keys(rows[0]) : [];
      const esc = (v) => {
        if (v == null) return '';
        const s = String(typeof v === 'object' ? JSON.stringify(v) : v);
        if (/[,"\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
        return s;
      };
      const csv = [cols.join(',')].concat(rows.map(r => cols.map(c => esc(r[c])).join(','))).join('\n');
      const filename = `${kind}-logs-${Date.now()}.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
      return res.status(200).send(csv);
    }
    return res.json({ ok: true, items: rows, kind, count: rows.length });
  } catch (e) {
    res.status(500).json({ error: 'export_failed', detail: String(e?.message || e) });
  }
});

app.use((err, _req, res, _next) => {
  console.error("[error]", err);
  const status = Number.isInteger(err?.status) ? err.status : 500;
  res
    .status(status)
    .json({ error: err?.code || "server_error", detail: err?.message || String(err) });
});

const server = app.listen(PORT, HOST, () => {
  const addrs = [];
  for (const ni of Object.values(os.networkInterfaces())) {
    if (!ni) continue;
    for (const info of ni) {
      if (info.family === "IPv4" && !info.internal) {
        addrs.push(`http://${info.address}:${PORT}`);
      }
    }
  }
  console.log(`Server listening on: host=${HOST} port=${PORT}`);
  if (addrs.length) console.log("LAN addresses:", addrs.join(", "));
  if (!ALLOW_ANY) console.log("Allowed origins:", ALLOW_ORIGINS.join(", "));
});

// SIGTERM/SIGINT を受けたら優雅に停止（ポート解放の確実化）
async function gracefulShutdown(signal) {
  try {
    console.log(`[shutdown] received ${signal}, closing server...`);
    await new Promise((resolve) => {
      try {
        server.close((err) => {
          if (err) console.error("[shutdown] server close error:", err);
          resolve();
        });
      } catch (e) {
        console.error("[shutdown] server close throw:", e);
        resolve();
      }
    });
    try {
      await pool.end();
      console.log("[shutdown] db pool closed");
    } catch (e) {
      console.error("[shutdown] db pool close error:", e);
    }
  } finally {
    process.exit(0);
  }
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// 診断: 利用可能モデル一覧（Google ListModels）
app.get("/api/ai/models", async (_req, res) => {
  try {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) return res.status(400).json({ error: "missing_api_key" });
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(
      apiKey
    )}`;

    const fetchJson = (url) =>
      new Promise((resolve, reject) => {
        if (typeof fetch === "function") {
          fetch(url)
            .then((r) =>
              r.ok
                ? r.json()
                : r
                    .text()
                    .then((t) => Promise.reject(new Error(`${r.status} ${t}`)))
            )
            .then(resolve)
            .catch(reject);
          return;
        }
        https
          .get(url, (r) => {
            let d = "";
            r.on("data", (c) => (d += c));
            r.on("end", () => {
              try {
                if (r.statusCode && r.statusCode >= 200 && r.statusCode < 300) {
                  resolve(JSON.parse(d));
                } else {
                  reject(new Error(`${r.statusCode} ${d}`));
                }
              } catch (e) {
                reject(e);
              }
            });
          })
          .on("error", reject);
      });

    const data = await fetchJson(url);
    const models = Array.isArray(data?.models) ? data.models : [];
    const simplified = models.map((m) => ({
      name: m?.name,
      displayName: m?.displayName,
      supportedGenerationMethods: m?.supportedGenerationMethods,
      inputTokenLimit: m?.inputTokenLimit,
      outputTokenLimit: m?.outputTokenLimit,
    }));
    res.json({ ok: true, count: simplified.length, models: simplified });
  } catch (e) {
    res
      .status(500)
      .json({ error: "list_models_failed", detail: String(e?.message || e) });
  }
});