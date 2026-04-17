// Backend API client + 共通ラッパ
const API_BASE =
  window.API_BASE_URL || window.location?.origin || "http://localhost:8787";

// 管理トークンを localStorage に保存し、書き込み系で自動付与
function getAdminToken() {
  try {
    return localStorage.getItem("ADMIN_TOKEN") || "";
  } catch {
    return "";
  }
}

let __specialPostPreferred = null; // "GET" or path string like "/api/specials"
try {
  // 1) 前回成功ルートを復元（永続化）
  const saved = (typeof localStorage !== 'undefined') ? localStorage.getItem('SPECIAL_POST_PREFERRED') : null;
  if (saved === 'GET' || (saved && saved.startsWith('/api/'))) {
    __specialPostPreferred = saved;
  }
  // 2) 明示フラグがあれば優先（開発/運用で切替）
  if (typeof window !== "undefined" && window.API_PREFER_GET_TUNNEL) {
    __specialPostPreferred = "GET";
  }
  // 3) 本番ドメインでは初期値を GET 優先（WAF対策）
  if (!__specialPostPreferred) {
    try {
      const host = String(location?.hostname || "");
      if (/matugen-kaimono-app\.com$/i.test(host)) {
        __specialPostPreferred = 'GET';
      }
    } catch {}
  }
} catch {}

async function apiFetch(
  path,
  { method = "GET", headers = {}, body, admin = false } = {}
) {
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
  const finalHeaders = Object.assign({}, headers);
  try {
    // 同一オリジンの /api/ リクエストに AJAX 識別ヘッダを付与（WAF の誤検知回避によく使われる）
    const u = new URL(url, location.origin);
    if (u.origin === location.origin && u.pathname.startsWith("/api/")) {
      if (!finalHeaders["X-Requested-With"]) finalHeaders["X-Requested-With"] = "XMLHttpRequest";
    }
    // スタッフ画面からの操作であることを示すヘッダーを付与（リファラやCookieが届かない環境対策）
    const herePath = String(location?.pathname || "");
    if (herePath.startsWith("/staff")) {
      if (!finalHeaders["x-staff-page"]) finalHeaders["x-staff-page"] = "1";
    }
  } catch {}
  if (admin) {
    const token = getAdminToken();
    if (token) finalHeaders["x-admin-token"] = token;
  }
  if (body && !finalHeaders["Content-Type"])
    finalHeaders["Content-Type"] = "application/json";
  const res = await fetch(url, { method, headers: finalHeaders, body, credentials: 'include', cache: 'no-store' });
    if (!res.ok) {
      // 特に rate limit (429) はユーザーにやさしい案内を表示
      if (res.status === 429) {
        try {
          const j = await res.json().catch(() => null);
          const retry = j && (j.retryAfterMs || j.retry_after_ms || j.retryAfter || null);
          showRateLimitBanner(retry);
        } catch {}
        throw new Error(`API error: 429 - rate_limited`);
      }
      let detail = "";
      try {
        const j = await res.json();
        detail = j?.detail || j?.error || "";
      } catch {}
      throw new Error(`API error: ${res.status}${detail ? " - " + detail : ""}`);
    }
  // 204 などは空
  if (res.status === 204) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

// 顧客ページ向けに rate-limited を分かりやすく表示するバナー
function showRateLimitBanner(retryAfterMs) {
  try {
    if (typeof document === 'undefined') return;
    const existing = document.getElementById('rate-limit-banner');
    if (existing) return; // 既に表示済み
    const banner = document.createElement('div');
    banner.id = 'rate-limit-banner';
    banner.setAttribute('role', 'status');
    banner.style.zIndex = 9999;
    banner.style.position = 'fixed';
    banner.style.left = '0';
    banner.style.right = '0';
    banner.style.top = '0';
    banner.style.background = '#fff4e6';
    banner.style.color = '#5a2b00';
    banner.style.borderBottom = '1px solid #ffd9b3';
    banner.style.padding = '12px 16px';
    banner.style.display = 'flex';
    banner.style.alignItems = 'center';
    banner.style.justifyContent = 'center';
    banner.style.fontWeight = 700;
    const msg = document.createElement('div');
    msg.innerText = '読み込み回数の制限を超えました。恐れ入りますが時間を空けて再度お試しください。';
    banner.appendChild(msg);
    const close = document.createElement('button');
    close.type = 'button';
    close.innerText = '閉じる';
    close.style.marginLeft = '12px';
    close.style.background = 'transparent';
    close.style.border = '1px solid rgba(0,0,0,0.06)';
    close.style.padding = '6px 8px';
    close.style.borderRadius = '6px';
    close.onclick = () => { try { banner.remove(); document.documentElement.classList.remove('rate-limited'); const body = document.body; if (body && banner.dataset.prevPaddingTop !== undefined) body.style.paddingTop = banner.dataset.prevPaddingTop; } catch {} };
    banner.appendChild(close);
    // 既に body のコンテンツが header 等でマージンを取っている想定だが
    // 固定表示なので、ページ内容がトップに隠れないよう少し下げる
    const body = document.body;
    if (body) {
      const prev = body.style.paddingTop || '';
      banner.dataset.prevPaddingTop = prev;
      body.style.paddingTop = '56px';
    }
    // rate-limited モードを有効化してページ本文を非表示にする
    try { document.documentElement.classList.add('rate-limited'); } catch(e){}
    document.documentElement.appendChild(banner);
    // 自動で閉じる（retryAfterMs がある場合はそこまで、無ければ 60s）
    const timeout = Number(retryAfterMs) || 60000;
    setTimeout(() => { try { banner.remove(); document.documentElement.classList.remove('rate-limited'); if (body && banner.dataset.prevPaddingTop !== undefined) body.style.paddingTop = banner.dataset.prevPaddingTop; } catch {} }, Math.min(timeout, 5 * 60 * 1000));
  } catch (e) {}
}
// テスト/デバッグ用にグローバルに公開（コンソールから手動で呼べる）
try { if (typeof window !== 'undefined') window.showRateLimitBanner = showRateLimitBanner; } catch(e) {}

export async function apiImproveMessage(payload) {
  const data = await apiFetch("/api/improve-message", {
    method: "POST",
    body: JSON.stringify(payload),
    admin: true,
  });
  return data?.text;
}

export async function apiSpecialDescription(payload) {
  const data = await apiFetch("/api/special/description", {
    method: "POST",
    body: JSON.stringify(payload),
    admin: true,
  });
  return data?.text;
}

export async function apiSpecialRecipe(payload) {
  const data = await apiFetch("/api/special/recipe", {
    method: "POST",
    body: JSON.stringify(payload),
    admin: true,
  });
  return data?.text;
}

export async function apiGetMessages() {
  const data = await apiFetch("/api/messages");
  return data?.items || [];
}

export async function apiAddMessage(payload) {
  const data = await apiFetch("/api/messages", {
    method: "POST",
    body: JSON.stringify(payload),
    // 管理トークン不要（スタッフ許可）
  });
  return data?.item;
}

export async function apiGetPublishedMessages() {
  const data = await apiFetch("/api/messages?published=1");
  return data?.items || [];
    // 成功したら以後は最初から GET を使う
    __specialPostPreferred = "GET";
}

export async function apiDeleteMessage(id) {
  const data = await apiFetch(`/api/messages/${id}`, {
    method: "DELETE",
    // 管理トークン不要（スタッフ許可）
  });
  return data?.item;
}

// Events API
export async function apiGetEvents() {
  const data = await apiFetch("/api/events");
  return data?.items || [];
}

export async function apiGetActiveEvents() {
  const data = await apiFetch("/api/events?active=1");
  return data?.items || [];
}
export async function apiAddEvent(payload) {
  // 1) もし以前に GET (トンネル) が最適と学習済みなら、最初から GET で送信する
  //    (これで 403 エラーログが出なくなります)
  if (__specialPostPreferred === "GET") {
    return await _apiAddEventFallback(payload);
  }

  // 2) まずは通常の POST を試す
  try {
    const data = await apiFetch("/api/events", {
      method: "POST",
      body: JSON.stringify(payload),
      admin: !!getAdminToken(),
    });
    // 成功したらそのまま返す
    return data?.item;
  } catch (e) {
    const msg = String(e?.message || e || "").toLowerCase();
    // クライアント側の入力ミス(400)などはフォールバックせずエラーにする
    if (msg.includes("400") || msg.includes("invalid") || msg.includes("required")) {
      throw e;
    }

    // 3) POST が失敗 (403/404/5xx) した場合、GET トンネルへフォールバック
    try {
      try { console.info("apiAddEvent: POST failed, attempting GET-tunnel fallback..."); } catch {}

      const item = await _apiAddEventFallback(payload);

      // 成功したら「次回からは最初から GET を使う」ように記録する
      __specialPostPreferred = "GET";
      try { localStorage.setItem('SPECIAL_POST_PREFERRED', 'GET'); } catch {}

      try { console.info("apiAddEvent: GET-tunnel succeeded. Switched preference to GET."); } catch {}
      return item;
    } catch (e2) {
      // フォールバックも失敗したら、最初の POST エラーを投げる
      try { console.warn("apiAddEvent: Fallback also failed:", e2); } catch {}
      throw e;
    }
  }
}

// 内部用: GETトンネルでの送信処理
async function _apiAddEventFallback(payload) {
  const payloadStr = JSON.stringify(payload);
  // 日本語対応のためのエンコード処理
  const b64 = btoa(unescape(encodeURIComponent(payloadStr)));
  const path = `/api/add-item?t=e&p=${encodeURIComponent(b64)}`;

  const data = await apiFetch(path, { method: "GET", admin: !!getAdminToken() });
  return data?.item;
}


export async function apiDeleteEvent(id) {
  const data = await apiFetch(`/api/events/${id}`, {
    method: "DELETE",
    // 管理トークン不要（スタッフ許可）
  });
  return data?.item;
}

// Specials API
export async function apiGetSpecials(params = undefined) {
  let path = "/api/specials";
  if (params && typeof params === "object") {
    const qs = new URLSearchParams();
    if (params.active) qs.set("active", "1");
    if (params.start) qs.set("start", String(params.start));
    if (params.end) qs.set("end", String(params.end));
    const s = qs.toString();
    if (s) path += `?${s}`;
  }
  const data = await apiFetch(path);
  return data?.items || [];
}

export async function apiGetActiveSpecials() {
  const data = await apiFetch("/api/specials?active=1");
  return data?.items || [];
}

export async function apiAddSpecial(payload) {
  const opts = {
    method: "POST",
    body: JSON.stringify(payload),
    admin: true,
  };
  const baseCandidates = [
    "/api/specials",
    "/api/events/specials",
    "/api/messages/specials",
    "/api/special",
  ];
  let candidates = baseCandidates.slice();
  if (__specialPostPreferred && __specialPostPreferred !== "GET") {
    candidates = [
      __specialPostPreferred,
      ...baseCandidates.filter((p) => p !== __specialPostPreferred),
    ];
  }
  let lastErr = null;

  // GET トンネル固定なら先に試す
  if (__specialPostPreferred === "GET") {
    try {
      const payloadStr = JSON.stringify(payload);
      const b64 = btoa(unescape(encodeURIComponent(payloadStr)));
      const path = `/api/add-item?t=s&p=${encodeURIComponent(b64)}`;
      const data = await apiFetch(path, { method: "GET", admin: true });
      return data?.item;
    } catch (e) {
      lastErr = e;
    }
  }

  for (const p of candidates) {
    try {
      const data = await apiFetch(p, opts);
      __specialPostPreferred = p; // 成功ルートを記憶
      try { localStorage.setItem('SPECIAL_POST_PREFERRED', p); } catch {}
      return data?.item;
    } catch (e) {
      lastErr = e;
      const msg = String(e?.message || e || "").toLowerCase();
      if (msg.includes("403") || msg.includes("404")) continue;
      throw e;
    }
  }
  // 最終フォールバック: GET トンネル（/api/add-item）
  try {
    const payloadStr = JSON.stringify(payload);
    const b64 = btoa(unescape(encodeURIComponent(payloadStr)));
    const path = `/api/add-item?t=s&p=${encodeURIComponent(b64)}`;
    const data = await apiFetch(path, { method: "GET", admin: true });
    __specialPostPreferred = "GET"; // 以後は最初から GET
    try { localStorage.setItem('SPECIAL_POST_PREFERRED', 'GET'); } catch {}
    return data?.item;
  } catch (e) {
    lastErr = e || lastErr;
  }
  throw lastErr || new Error("API error: failed to add special");
}

export async function apiDeleteSpecial(id) {
  const data = await apiFetch(`/api/specials/${id}`, {
    method: "DELETE",
    // 管理トークン不要（スタッフ許可）
  });
  return data?.item;
}

export async function apiReorderSpecials(orderArray) {
  const data = await apiFetch(`/api/specials/reorder`, {
    method: "POST",
    body: JSON.stringify({ order: orderArray }),
    admin: true,
  });
  return data;
}

// 顧客要望 (comments/requests 互換)
export async function apiGetComments() {
  const data = await apiFetch("/api/comments");
  return data?.items || [];
}
export async function apiAddComment(payload) {
  const data = await apiFetch("/api/comments", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return data?.item;
}
export async function apiUpdateCommentStatus(id, status) {
  const data = await apiFetch(`/api/comments/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
  return data?.item;
}
export async function apiDeleteComment(id) {
  const data = await apiFetch(`/api/comments/${id}`, {
    method: "DELETE",
  });
  return data?.item;
}
// 互換（既存 staff.js が requests 名称で呼ぶ場合へのフォールバック）
export const apiGetRequests = apiGetComments;
export const apiUpdateRequestStatus = apiUpdateCommentStatus;
export const apiDeleteRequest = apiDeleteComment;

// ==== Login logs API ====
export async function apiLogLogin(payload) {
  // 失敗してもサイト表示に影響しないよう投げっぱなしを推奨
  try {
    await apiFetch("/api/log-login", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  } catch (_) {}
}

export async function apiGetLoginLogs({
  limit = 50,
  page = 1,
  userId,
  since,
  until,
} = {}) {
  const qs = new URLSearchParams();
  if (limit) qs.set("limit", String(limit));
  if (page) qs.set("page", String(page));
  if (userId) qs.set("userId", String(userId));
  if (since) qs.set("since", String(since));
  if (until) qs.set("until", String(until));
  const data = await apiFetch(`/api/login-logs?${qs.toString()}`, {
    admin: true,
  });
  return data || { items: [], total: 0, page: 1, limit: 50 };
}

export async function apiDeleteLoginLog(id) {
  const data = await apiFetch(`/api/login-logs/${id}`, {
    method: "DELETE",
    admin: true,
  });
  return data?.ok;
}

// ==== Events log API ====
export async function apiLogEvent(payload) {
  try {
    await apiFetch("/api/event-logs", { method: "POST", body: JSON.stringify(payload) });
  } catch (_) {}
}
export async function apiGetEventsLog({ limit = 50, page = 1, type, userId, sessionId, since, until } = {}) {
  const qs = new URLSearchParams();
  if (limit) qs.set("limit", String(limit));
  if (page) qs.set("page", String(page));
  if (type) qs.set("type", String(type));
  if (userId) qs.set("userId", String(userId));
  if (sessionId) qs.set("sessionId", String(sessionId));
  if (since) qs.set("since", String(since));
  if (until) qs.set("until", String(until));
  const data = await apiFetch(`/api/event-logs?${qs.toString()}`, { admin: true });
  return data || { items: [], total: 0, page: 1, limit: 50 };
}
export async function apiDeleteEventLog(id) {
  const data = await apiFetch(`/api/event-logs/${id}`, { method: "DELETE", admin: true });
  return data?.ok;
}
