## 松源 Web システム（顧客向け + 店員向け）/ matugen

顧客向けサイト（カレンダー/本日の特価/お知らせ/要望）と、店員向け管理（イベント/特価/メッセージ/要望 + AI 支援）を、最小構成で運用できるよう設計したシステムです。2025-12 最新版では、データは MySQL で運用し、AI は Google Gemini を利用します。429 対応（日本語バナー/HTML 応答）、静的ファイルのレート制限除外、単位表示のフォールバック、スタッフ画面の簡易Basic認証、操作ログ・エクスポート、特価並び替え保存などを追加しています。

---

## 1. リポジトリ構成（抜粋）

```
matugen/
├─ customer/        # 顧客向けUI（静的）
├─ staff/           # 店員向けUI（静的）
├─ js/              # フロントJS（共用）
├─ css/             # 共通/各画面のスタイル
├─ images/          # 画像とExcel台帳
│  ├─ ad/           # 広告・バナー画像
│  ├─ icon/         # カレンダー種別アイコン
│  ├─ product/      # 商品画像（運用その1）
│  │  └─ name.xlsx  # A列=商品名, B列=画像ファイル名（拡張子込み）
│  └─ products/     # 商品画像（運用その2：同上の別フォルダ名）
├─ server/          # Node.js APIサーバー（Express）
│  ├─ src/index.js  # API実装（MySQL / Gemini / CORS / RateLimit / logs / export）
│  └─ package.json  # 依存定義
└─ README.md
```

注: 旧 `server/data/*.json` は廃止しました（MySQL へ移行）。

---

## 2. 主要機能

顧客向け

- 2 週間カレンダー（特売/イベント/ポイントデーの色分け）
- 本日の特価カード（画像、説明、簡易レシピ、単位表示フォールバックあり）
- 店舗メッセージ一覧（公開済みのみ）
- ご要望フォーム（匿名/カテゴリ）

店員向け

- イベント・特価・メッセージの登録/削除、要望の一覧/状態変更
- AI 支援：メッセージ改善、特価 POP 説明、レシピ名/詳細の生成（送信前バリデーションで `name/salePrice/unit` を補完）
- 画像ひも付け：商品名の部分一致サジェスト → 候補クリックで URL/プレビュー自動反映
- アクセス・行動ログの閲覧/削除、Excel/CSV エクスポート、簡易統計（アクセス推移・利用人数・最大ユーザーID・イベント集計）
- 特価の並び順保存（displayOrder）

画像運用（新仕様）

- `images/product/name.xlsx` または `images/products/name.xlsx` を台帳とし、A 列=商品名、B 列=画像ファイル名を登録
- フロント側で xlsx を読込み、NFKC 正規化＋部分一致で候補を提示
- 候補クリックで `../images/(product|products)/<B列ファイル名>` を自動入力し、プレビュー表示
- 欠損画像のプレースホルダとして `images/placeholder.svg` を同梱（404/429 の連発を防止）

---

## 3. サーバー/API 概要

- ランタイム: Node.js (Express)
- 配信: 静的（リポジトリ直下） + API（/api/*）
- DB: MySQL（mysql2/promise・接続プール）
- CORS: ALLOW_ORIGINS で許可（`*` も可）
- レート制限: 単純なメモリ実装（IP 毎・固定窓）
  - 429 時は日本語バナー（フロント）または HTML 応答（ブラウザナビゲーション時）を返します
  - 静的ファイル（images/css/js/ad/product）、`/api/health`、`/api/config` はカウント除外
- AI: Google Generative AI (Gemini) SDK（モデルは自動フォールバック）

主要エンドポイント（要点）

- GET `/api/health` → `{ ok: true }`
- GET `/api/config` → Gemini 設定の確認
- Messages: GET `/api/messages[?published=1]`, POST `/api/messages`, DELETE `/api/messages/:id`
- Events: GET `/api/events[?active=1]`, POST `/api/events`, DELETE `/api/events/:id`
- Specials: GET `/api/specials[?active=1][&start=YYYY-MM-DD&end=YYYY-MM-DD]`, POST `/api/specials`（エイリアス: `/api/events/specials`, `/api/messages/specials`, `/api/special`）, DELETE `/api/specials/:id`, 並び替え保存 POST `/api/specials/reorder`（body: `{ order: [id1,id2,...] }`）
- Comments/Requests: GET `/api/comments`（互換: `/api/requests`）, POST `/api/comments`（互換: `/api/requests`）, PATCH `/api/comments/:id/status`（互換: POST `/api/requests/:id/status`）, DELETE `/api/comments/:id`（互換: `/api/requests/:id`）
- AI: POST `/api/improve-message`, `/api/special/description`, `/api/special/recipe`
- Logs: login logs → GET `/api/login-logs`, DELETE `/api/login-logs/:id`／event logs → POST `/api/event-logs`（バッチ: `/api/event-logs/batch`）, GET `/api/event-logs`, DELETE `/api/event-logs/:id`
- Export: GET `/api/log-export?kind=login|event|all&format=json|xlsx|csv`（`kind=all` は2シートExcel）
- Stats: GET `/api/stats/access-trend?since&until`, GET `/api/stats/customer-users?since&until`, GET `/api/stats/max-user-id?since&until`, GET `/api/event-summary?group=type|page|feature&since&until`

レスポンス形式

- GET は `{ items: [...] }`、登録系は `{ item: {...} }`

当日抽出

- `?active=1` で当日範囲抽出。特価は DB タイムゾーン差異回避のためサーバー側で JST の本日文字列を計算して比較します。

---

## 4. 環境変数（.env）

必須/推奨

```
# 基本
PORT=8787
HOST=0.0.0.0
ALLOW_ORIGINS=https://your-domain.example,https://another.example

# MySQL
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=matugen
MYSQL_PASSWORD=your_password
MYSQL_DATABASE=matugen
# 互換: DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME も可

# Gemini（Google Generative AI）
GOOGLE_API_KEY=your_gemini_api_key
# 任意: 優先・フォールバック
GOOGLE_MODEL=gemini-1.5-flash-latest
GOOGLE_MODEL_FALLBACKS=gemini-2.0-flash,gemini-1.5-pro-latest

# レート制限（任意/既定あり）
RATE_WINDOW_MS=60000
RATE_MAX=120

# 管理者トークン（APIの保護・任意）
# 設定すると一部の一覧/APIでも認可が必要になります。未設定なら開発用途として緩く動作します。
ADMIN_TOKEN=your_admin_token

# スタッフページの簡易Basic認証（/staff/* をブラウザのダイアログで保護）
# STAFF_BASIC_PASS を設定すると有効化。ユーザー名は任意（未設定なら任意の名前でOK）
STAFF_BASIC_USER=staff
STAFF_BASIC_PASS=your_staff_password
```

使い方（スタッフ用認証）

- サーバー再起動後、`/staff/` にアクセスするとブラウザの認証ダイアログが出ます。
- ユーザー名= `STAFF_BASIC_USER`、パスワード= `STAFF_BASIC_PASS` を入力してください。
- `STAFF_BASIC_PASS` を未設定にするとこの認証は無効化されます（開発時など）。

---

## 5. MySQL 初期化（DDL）

データベース/ユーザー

```sql
CREATE DATABASE IF NOT EXISTS matugen CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER IF NOT EXISTS 'matugen'@'%' IDENTIFIED BY 'your_password';
GRANT ALL PRIVILEGES ON matugen.* TO 'matugen'@'%';
FLUSH PRIVILEGES;
```

テーブル

```sql
-- messages
CREATE TABLE IF NOT EXISTS messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  author VARCHAR(255) NOT NULL,
  authorName VARCHAR(255) NULL,
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  datetime DATETIME NOT NULL,
  KEY idx_messages_datetime (datetime)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- events
CREATE TABLE IF NOT EXISTS events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  startDate DATE NOT NULL,
  endDate DATE NULL,
  type VARCHAR(50) NOT NULL,
  text VARCHAR(255) NOT NULL,
  description TEXT NULL,
  image VARCHAR(512) NULL,
  KEY idx_events_range (startDate, endDate)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- specials（unit は NULL 許容。displayOrder による並び保存に対応）
CREATE TABLE IF NOT EXISTS specials (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  originalPrice INT NOT NULL,
  salePrice INT NOT NULL,
  unit VARCHAR(50) NULL,
  description TEXT NULL,
  recipeIdea VARCHAR(255) NULL,
  recipeName VARCHAR(255) NULL,
  recipeDetails TEXT NULL,
  startDate DATE NOT NULL,
  endDate DATE NULL,
  image VARCHAR(512) NULL,
  displayOrder INT DEFAULT 0,
  KEY idx_specials_range (startDate, endDate),
  KEY idx_specials_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- comments / requests
CREATE TABLE IF NOT EXISTS comments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  category VARCHAR(50) NOT NULL,
  title VARCHAR(255) NULL,
  message TEXT NOT NULL,
  name VARCHAR(255) NULL,
  status ENUM('pending','in-progress','completed') NOT NULL DEFAULT 'pending',
  submitDate DATETIME NOT NULL,
  KEY idx_comments_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

注意

- `CURRENT_DATE()` は DB のタイムゾーンに依存。必要なら RDS の time_zone やアプリ側正規化で調整。
- JSON→MySQL の移行は簡易 INSERT で対応（本システムは JSON を参照しません）。
- プロキシ/ALB 配下で正しいクライアント IP を取得するには `X-Forwarded-For` を信頼する設定が必要です（Express の `trust proxy` を有効化するなど）。

---

## 6. ローカル動作（Windows PowerShell 例）

```powershell
cd server
npm install
# ルートの .env ではなく server/.env に上記の環境変数を記載
npm start
# http://localhost:8787/api/health → { ok: true }
```

フロントはサーバーからプロジェクトルートを静的配信します（`server` を起動すれば `customer/` と `staff/` もアクセス可能）。

- 店員向け: `http://localhost:8787/staff/index.html`
- 顧客向け: `http://localhost:8787/customer/index.html`

単位表示のフォールバック（顧客向け）

- API が `unit` を返さない場合でも、商品名や説明から「100gあたり」等を抽出して表示します（`js/customer.js`）。
- 税表示は「（税抜）」を併記します。

---

## 7. 画像台帳と自動ひも付け

- 置き場所: `images/product/name.xlsx`（または `images/products/name.xlsx`）
- 形式: A 列=商品名, B 列=画像ファイル名
- マッチ: 入力中の商品名を NFKC 正規化・小文字化・ゼロ幅文字除去して部分一致検索。全シート対象。
- 反映: 候補クリックで `imageUrl` とプレビューを自動セット。
- 注意: 実ファイルは `images/(product|products)/` 直下に配置（B 列と一致）。

---

## 8. GETトンネルによる送信フォールバック（運用環境のWAF/ALB対策）

- 特価/イベントの登録が一部環境で 403/404 になる場合、クライアントは自動的に GET 経由のトンネル API にフォールバックします。
- 仕様: `/api/add-item?t=s&p=<base64(JSON)>`（特価）または `t=e`（イベント）。成功後は次回から最初から GET を試みます（ローカルストレージで記憶）。
- サーバ側も `/api/add-item` を実装済みで、スタッフ/管理者のみ受理します。

---

## 9. 既知の未実装/要補強

- 編集 UI: 店員画面の「編集」ボタン（イベント/特価）は廃止しました（削除/追加のみ提供）。
- 認証/認可: `ADMIN_TOKEN` 未設定時は変更系 API が緩く動作します。必ず本番では保護を有効にしてください。
- スケール: レート制限はプロセス内。水平スケール時は外部ストア/API Gateway で共有制御を。
- プロキシ: ALB/Nginx 越しの場合は `app.set('trust proxy', true)` の適用を推奨し、`X-Forwarded-For` を用いた正しいクライアントIP取得に切替。
- マイグレーション: DDL 提示のみ。将来はマイグレーションツール（例: Prisma/Migrate, Liquibase）導入推奨。
- モニタリング: ユーザー行動/AB テスト/検索ログ等は未収集（必要に応じて導入）。

---

## 10. トラブルシュート

- `/api/health` が失敗 → サーバー起動/SG/Firewall を確認
- `/api/config` で `hasGeminiKey=false` → GOOGLE_API_KEY 未設定
- CORS エラー → ALLOW_ORIGINS に配信ドメインを追加
- 画像候補が出ない → `images/product(s)/name.xlsx` と B 列ファイル、実ファイル配置・拡張子・大文字小文字を確認
- 当日特価が表示されない → DB の日付/時刻設定（CURRENT_DATE の基準）を確認
- 429 (Too Many Requests) がすぐに出る → 静的ファイル除外が適用されているか確認。`RATE_MAX` を一時的に増やすか、プロキシ越しの場合は `trust proxy` を有効化。ログでは `[rate] limited ip=...` が出力されます。
- 429 時の見え方を日本語化したい → フロント `js/api-client.js` のバナー表示が有効。ブラウザナビゲーション時はサーバが日本語 HTML を返します。

---

## 11. 研究の新規性（要約）

- Excel 台帳 + 共有フォルダの既存運用を活かし、ブラウザ内で日本語正規化/部分一致サジェスト → ワンクリックで画像紐付け。
- 「本日限り」等の期間表現をデータ層（SQL）と生成文（AI）双方で統制する二重ガバナンス。
- 店員/顧客 UI を同一 API で同期し、軽量構成で日次オペの摩擦を削減。

---
