// 顧客向けページのJavaScript
// ヘッダー直下に表示するプロモカード: 「イベント2件」と「特価2件」をまとめて表示

// 単位を解決するヘルパー: APIで `unit` が来ない場合、説明文や名前から
// 「100gあたり」等を抽出してフォールバック表示する
function resolveUnit(sp) {
  if (!sp) return "";
  if (sp.unit && String(sp.unit).trim()) return String(sp.unit).trim();
  const src = `${sp.description || ""} ${sp.name || ""}`;
  // 例: "100gあたり", "100 g あたり", "100ｇあたり"
  const m = src.match(/(\d+\s*(?:g|ｇ)\s*(?:あたり)?)/i);
  if (m) return m[1].replace(/\s+/g, "");
  return "";
}
async function renderPromoCard() {
  const el = document.getElementById("promo-card");
  if (!el) return;
  // 本日の日付文字列
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const d = String(today.getDate()).padStart(2, "0");
  const dateStr = `${y}-${m}-${d}`;

  // イベント（本日）
  let todaysEvents = typeof getEventsForDate === "function" ? getEventsForDate(dateStr) : [];
  if (!Array.isArray(todaysEvents)) todaysEvents = [];
  // 当日のイベントのみを表示（補填は行わない）
  todaysEvents = Array.isArray(todaysEvents) ? todaysEvents.slice(0, 2) : [];

  // 特価（サーバーAPIから取得）
  let specials = [];
  try {
    const getter = (window.__api && (window.__api.apiGetActiveSpecials || window.__api.apiGetSpecials));
    if (getter) {
      const list = await getter();
      if (Array.isArray(list) && list.length) {
        // サーバが返すリストはアクティブなお買い得商品の可能性があるが
        // 念のため今日の日付に該当するものだけを抽出して表示する
        const target = new Date(dateStr);
        specials = list.filter((sp) => {
          try {
            const s = sp.startDate ? new Date(sp.startDate) : null;
            const e = sp.endDate ? new Date(sp.endDate) : s;
            if (!s) return false;
            return target >= s && target <= e;
          } catch (err) {
            return false;
          }
        }).slice(0, 2);
      }
    }
  } catch (e) {
    console.warn("promo specials fetch failed", e);
  }

  const evHtml = todaysEvents && todaysEvents.length
    ? todaysEvents.slice(0, 2).map(ev => {
        const text = ev.text || ev.title || 'イベント';
        const img = ev.image ? `<img src="${ev.image}" alt="icon" class="ev-icon"/>` : '';
        return ` <li class="ev-item">${img}<span class="ev-text">${text}</span></li>`;
      }).join("")
    : `<div class="empty-note">本日のイベントはありません</div>`;

  // 特売はカード上では商品画像を表示しない（UI方針）
  const spHtml = specials && specials.length
    ? specials.map(sp => {
        const name = sp.name || 'お買い得商品';
        const saleVal = (typeof sp.salePrice !== 'undefined' && sp.salePrice !== null) ? Number(sp.salePrice) : 0;
        const sale = `¥${saleVal.toLocaleString()}`;
        return ` <li class="sp-item"><span class="sp-name">${name}</span><span class="sp-price">${sale}</span></li>`;
      }).join("")
    : `<div class="empty-note">お買い得商品はありません</div>`;

  el.innerHTML = `
    <div class="composed-card">
      <div class="events-block" aria-hidden="false">
        <div class="block-title">イベント情報</div>
        <ul class="events-list">${evHtml}</ul>
      </div>
      <div class="specials-block">
        <div class="block-title">お買い得商品例</div>
        <ul class="specials-list">${spHtml}</ul>
      </div>
    </div>
  `;
}

// カレンダー関連の変数
let currentDate = new Date();
const today = new Date();

// イベント配列: 初期は空。サーバー取得失敗時のみサンプルを遅延投入してチラつきを避ける。
let eventsData = [];
const __sampleEventsFallback = () => [
  {
    startDate: "2025-09-10",
    endDate: null,
    type: "special-sale",
    text: "肉の日特売",
    image: "images/events/meat_day.jpg",
  },
  { startDate: "2025-09-10", endDate: null, type: "event", text: "新商品入荷" },
  {
    startDate: "2025-09-12",
    endDate: "2025-09-14",
    type: "event",
    text: "秋の味覚フェア",
    image: "images/banners/autumn_fair.jpg",
  },
  {
    startDate: "2025-09-15",
    endDate: "2025-09-17",
    type: "event",
    text: "試食会",
    image: "images/events/tasting_event.jpg",
  },
  {
    startDate: "2025-09-15",
    endDate: null,
    type: "special-sale",
    text: "魚の特売",
    image: "images/events/fish_day.jpg",
  },
  {
    startDate: "2025-09-22",
    endDate: "2025-09-24",
    type: "event",
    text: "地元野菜フェア",
    image: "images/banners/local_products.jpg",
  },
  {
    startDate: "2025-09-25",
    endDate: "2025-09-26",
    type: "event",
    text: "料理教室",
    image: "images/events/tasting_event.jpg",
  },
  {
    startDate: "2025-09-29",
    endDate: null,
    type: "special-sale",
    text: "肉の日特売",
    image: "images/events/meat_day.jpg",
  },
];

// 日付別のイベントを生成する関数
function getEventsForDate(dateString) {
  const result = eventsData.filter((event) => {
    const eventStart = new Date(event.startDate);
    const eventEnd = event.endDate ? new Date(event.endDate) : eventStart;
    const targetDate = new Date(dateString);
    return targetDate >= eventStart && targetDate <= eventEnd;
  });
  // 5のつく日ならポイントデーを追加（重複防止）
  const d = new Date(dateString);
  const day = d.getDate();
  if ([5, 15, 25].includes(day)) {
    const alreadySale = result.some(
      (ev) =>
        ev.type === "special-sale" &&
        ev.text &&
        (ev.text.includes("特売") || ev.text.includes("5のつく日"))
    );
    if (!alreadySale) {
      result.push({
        startDate: dateString,
        endDate: null,
        type: "special-sale",
        text: "5のつく日特売日",
        image: "/images/icon/sale.png",
      });
    }
  }
  return result;
}

// レシピデータ
const recipes = {
  "beef-recipe": {
    title: "牛肉のしぐれ煮",
    ingredients: [
      "牛肉（肩ロース薄切り）300g",
      "しょうが 1片",
      "醤油 大さじ3",
      "みりん 大さじ2",
      "砂糖 大さじ1",
      "酒 大さじ2",
      "水 100ml",
    ],
    steps: [
      "しょうがは千切りにする",
      "鍋に調味料と水を入れて煮立たせる",
      "牛肉としょうがを加えて中火で煮る",
      "汁気がなくなるまで15分程度煮詰める",
      "器に盛り付けて完成",
    ],
  },
  "salmon-recipe": {
    title: "鮭のムニエル",
    ingredients: [
      "秋鮭 2切れ",
      "小麦粉 適量",
      "バター 20g",
      "オリーブオイル 大さじ1",
      "レモン 1/2個",
      "塩・こしょう 適量",
      "パセリ 適量",
    ],
    steps: [
      "鮭に塩・こしょうをふり、10分置く",
      "水気を拭き取り、小麦粉をまぶす",
      "フライパンにオリーブオイルを熱し、鮭を焼く",
      "片面3-4分ずつ焼いて取り出す",
      "バターを加えて溶かし、レモン汁を加える",
      "鮭にかけて、パセリを散らして完成",
    ],
  },
  "renkon-recipe": {
    title: "れんこんのきんぴら",
    ingredients: [
      "れんこん 200g",
      "にんじん 1/2本",
      "ごま油 大さじ1",
      "醤油 大さじ2",
      "みりん 大さじ1",
      "砂糖 小さじ1",
      "唐辛子 1本",
      "ごま 適量",
    ],
    steps: [
      "れんこんは薄切りにして水にさらす",
      "にんじんは細切りにする",
      "フライパンにごま油を熱し、唐辛子を炒める",
      "れんこんとにんじんを加えて炒める",
      "調味料を加えて炒め煮にする",
      "仕上げにごまを振って完成",
    ],
  },
};

// ページ読み込み時の初期化
// =====================
// 初期化: APIクライアント / イベント取得を待ってから一度だけカレンダー生成
// =====================
let __calendarInitialized = false;

async function waitForApiClient(timeoutMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (window.__api && window.__api.apiGetEvents) return true;
    await new Promise((r) => setTimeout(r, 40));
  }
  return false; // タイムアウト（ローカル静的データで進む）
}

async function initCalendarAndData() {
  if (__calendarInitialized) return;
  // API準備待機（失敗しても続行）
  await waitForApiClient();
  try {
    await tryFetchServerEvents();
  } catch (e) {
    console.warn("events fetch failed", e);
    if (!eventsData.length) {
      // サーバー不可時のみサンプル採用
      eventsData = __sampleEventsFallback();
    }
  }
  if (!eventsData.length) {
    // 空配列の場合（サーバーから0件応答）もサンプルは表示しない方針 → 何も表示されないだけにする
  }
  generateCalendar();
  // 2週間カレンダー側（index.html 内スクリプト）が初期描画後にイベントを反映できるよう再描画トリガを送る
  try {
    window.dispatchEvent(new CustomEvent("eventsDataReady"));
    // generate2WeeksCalendar が既に定義されていれば直接再描画
    if (typeof window.generate2WeeksCalendar === "function") {
      window.generate2WeeksCalendar();
    }
  } catch (_) {}
  __calendarInitialized = true;
}

document.addEventListener("DOMContentLoaded", async function () {
  // カレンダー初期化（イベント同期後 1回描画）
  await initCalendarAndData();
  setupFormSubmission();

  // お買い得商品 & メッセージは独立して非同期ロード
  renderServerSpecials().catch((e) => console.warn("specials fetch failed", e));
  renderServerMessages().catch((e) => console.warn("messages fetch failed", e));
  // ヘッダー下のプロモカードを描画（イベント・お買い得商品を合わせた表示）
  try { renderPromoCard().catch((e) => console.warn('promo render failed', e)); } catch (e) {}

  // 簡易ログインログ: URL ?cid=... を拾い localStorage に保存、
  // なければ localStorage の CUSTOMER_ID を使用してアクセスを記録
  try {
    const url = new URL(window.location.href);
    const cid = (
      url.searchParams.get("cid") ||
      url.searchParams.get("customerId") ||
      url.searchParams.get("uid") ||
      ""
    ).trim();
    if (cid) {
      try {
        localStorage.setItem("CUSTOMER_ID", cid);
      } catch {}
    }
    let storedId = (() => {
      try {
        return localStorage.getItem("CUSTOMER_ID") || "";
      } catch {
        return "";
      }
    })();
    // どこからも取得できない場合は匿名IDを生成して保存（安定化のため localStorage）
    if (!storedId) {
      const genAnonId = () => {
        try {
          if (window.crypto && typeof window.crypto.randomUUID === "function") {
            return "anon-" + window.crypto.randomUUID().slice(0, 8);
          }
        } catch {}
        return "anon-" + Math.random().toString(36).slice(2, 10);
      };
      storedId = genAnonId();
      try {
        localStorage.setItem("CUSTOMER_ID", storedId);
      } catch {}
    }
    if (window.__api && window.__api.apiLogLogin) {
      window.__api.apiLogLogin({
        userId: storedId || null,
        page: "/customer/index.html",
      });
    }
  } catch (e) {
    console.warn("log-login failed to start", e);
  }

  // ========= 行動イベント: セッション・PV・スクロール =========
  try {
    // sessionId（ブラウザタブ単位）
    let sessionId = (() => {
      try {
        return sessionStorage.getItem("SESSION_ID") || "";
      } catch {
        return "";
      }
    })();
    if (!sessionId) {
      const makeId = () =>
        window.crypto?.randomUUID
          ? window.crypto.randomUUID().slice(0, 8)
          : Math.random().toString(36).slice(2, 10);
      sessionId = `s-${makeId()}`;
      try {
        sessionStorage.setItem("SESSION_ID", sessionId);
      } catch {}
    }
    // anonUserId
    const anonUserId = (() => {
      try {
        return localStorage.getItem("CUSTOMER_ID") || "";
      } catch {
        return "";
      }
    })();
    // UTM capture（セッション保持）
    const url = new URL(window.location.href);
    const utm = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
    ].reduce((acc, k) => {
      const v = url.searchParams.get(k);
      if (v) acc[k] = v;
      return acc;
    }, {});
    try {
      if (Object.keys(utm).length)
        sessionStorage.setItem("UTM", JSON.stringify(utm));
    } catch {}
    let utmStored = {};
    try {
      utmStored = JSON.parse(sessionStorage.getItem("UTM") || "{}");
    } catch {}
    // device / viewport
    const device = {
      width: window.innerWidth,
      height: window.innerHeight,
      lang: navigator.language || "",
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
    };
    // page_view
    if (window.__api && window.__api.apiLogEvent) {
      window.__api.apiLogEvent({
        type: "page_view",
        page: "/customer/index.html",
        anonUserId,
        sessionId,
        props: { utm: utmStored, device },
      });
    }
    // scroll depth
    let maxScrollPct = 0;
    const updateScroll = () => {
      const scrollTop =
        window.scrollY || document.documentElement.scrollTop || 0;
      const docHeight = Math.max(
        document.body.scrollHeight,
        document.documentElement.scrollHeight,
        document.body.offsetHeight,
        document.documentElement.offsetHeight,
        document.body.clientHeight,
        document.documentElement.clientHeight
      );
      const viewport =
        window.innerHeight || document.documentElement.clientHeight || 0;
      const denom = Math.max(1, docHeight - viewport);
      const pct = Math.min(100, Math.round((scrollTop / denom) * 100));
      if (pct > maxScrollPct) maxScrollPct = pct;
    };
    window.addEventListener("scroll", updateScroll, { passive: true });
    window.addEventListener("beforeunload", () => {
      try {
        if (window.__api && window.__api.apiLogEvent) {
          window.__api.apiLogEvent({
            type: "scroll",
            page: "/customer/index.html",
            anonUserId,
            sessionId,
            props: { maxScrollPct },
          });
        }
      } catch {}
    });
    // ad click（スライド画像のクリック）
    document.addEventListener("click", (e) => {
      const img = e.target.closest("#promo-card img, #adSplide .splide__slide img");
      if (!img) return;
      if (window.__api && window.__api.apiLogEvent) {
        window.__api.apiLogEvent({
          type: "ad_click",
          page: "/customer/index.html",
          anonUserId,
          sessionId,
          props: { alt: img.alt || "", src: img.getAttribute("src") || "" },
        });
      }
    });
    // recipe open（お買い得商品のレシピボタン）: showSpecialRecipe 内でも送る
    const origShowSpecialRecipe = window.showSpecialRecipe;
    window.showSpecialRecipe = function (index) {
      try {
        const data =
          (window.__specialsSliderState && window.__specialsSliderState.data) ||
          [];
        const sp = data[index];
        if (sp && window.__api && window.__api.apiLogEvent) {
          window.__api.apiLogEvent({
            type: "recipe_open",
            page: "/customer/index.html",
            anonUserId,
            sessionId,
            props: { idx: index, name: sp.name || "", id: sp.id || null },
          });
        }
      } catch {}
      return origShowSpecialRecipe.apply(this, arguments);
    };
    // calendar click（2週間カレンダー側が呼べるように）
    window.logEvent = function (type, props) {
      try {
        if (window.__api && window.__api.apiLogEvent) {
          window.__api.apiLogEvent({
            type,
            page: "/customer/index.html",
            anonUserId,
            sessionId,
            props,
          });
        }
      } catch {}
    };

    // recent logged actions map to avoid double-reporting (keyed by domPath or elementId)
    try {
      if (!window.__recentLoggedActions) window.__recentLoggedActions = new Map();
      const RECENT_TTL = 1200; // ms
      const origLogEvent = window.logEvent;
      window.logEvent = function(type, props) {
        try {
          // determine key
          const key = (props && (props.domPath || props.elementId)) || (props && props.feature) || null;
          if (key) {
            window.__recentLoggedActions.set(String(key), Date.now());
          }
        } catch(e){}
        try { return origLogEvent.apply(this, arguments); } catch(e){}
      };
      // periodic cleanup
      setInterval(()=>{
        try{
          const now = Date.now();
          for (const [k,t] of Array.from(window.__recentLoggedActions.entries())) {
            if (now - t > RECENT_TTL*4) window.__recentLoggedActions.delete(k);
          }
        }catch(e){}
      }, RECENT_TTL*2);
    } catch(e){}
  } catch (e) {
    console.warn("event instrumentation failed", e);
  }
});

async function tryFetchServerEvents() {
  if (!window.__api || !window.__api.apiGetEvents) return;
  const list = await window.__api.apiGetEvents();
  if (!Array.isArray(list) || !list.length) return;
  eventsData = list.map((ev) => ({
    startDate: ev.startDate,
    endDate: ev.endDate || null,
    type: ev.type,
    text: ev.text,
    image: ev.image || null,
  }));
}

async function renderServerSpecials() {
  if (!window.__api) return;
  const getter =
    window.__api.apiGetActiveSpecials || window.__api.apiGetSpecials;
  if (!getter) return;
  const list = await getter();
  if (!Array.isArray(list) || !list.length) return; // サーバーに無ければ既存の静的カードのまま
  const grid = document.querySelector("#specials .specials-grid");
  if (!grid) return;
  // Ensure client-side respects displayOrder returned by the API.
  try {
    list.sort((a, b) => {
      const da = Number(a.displayOrder || 0);
      const db = Number(b.displayOrder || 0);
      if (da !== db) return da - db;
      const sa = a.startDate || "";
      const sb = b.startDate || "";
      if (sa !== sb) return sa < sb ? -1 : 1;
      return (Number(a.id) || 0) - (Number(b.id) || 0);
    });
  } catch (e) {}

  grid.innerHTML = list
    .map((sp) => {
      const img = sp.image || "../images/placeholder.svg";
      const unitText = resolveUnit(sp);
      return `
        <div class="special-item card">
          <div class="special-image">
            <img src="${img}" alt="${sp.name || "お買い得商品"}"
                 onerror="this.src='../images/placeholder.svg'" />
          </div>
          <div class="card-body">
            <h3>${sp.name || "お買い得商品"}</h3>
            <div class="price-info">
              ${sp.salePrice != null ? `<span class="new-price">¥${Number(sp.salePrice).toLocaleString()}</span>` : ""}
              ${unitText ? `<span class="unit">${unitText}</span><span class="tax">（税抜）</span>` : `<span class="tax">（税抜）</span>`}
            </div>
            <div class="promotion-text">
              ${sp.description ? `<p>${sp.description}</p>` : ""}
              ${sp.recipeIdea ? `<p>🍳 <strong>おすすめレシピ:</strong> ${sp.recipeIdea}</p>` : ""}
            </div>
          </div>
        </div>
      `;
    })
    .join("");
}

async function renderServerMessages() {
  // APIクライアントを動的に読み込む（type=moduleでないため）
  if (!window.__api || !window.__api.apiGetPublishedMessages) return; // 公開済みのみ取得
  const list = await window.__api.apiGetPublishedMessages();
  const container = document.querySelector("#messages .messages-container");
  if (!container) return;
  if (!list.length) return; // 何もなければ既存のサンプルをそのまま
  // 新しいものが上に来るよう日時降順にソート
  const sorted = [...list].sort(
    (a, b) => new Date(b.datetime) - new Date(a.datetime)
  );
  container.innerHTML = sorted
    .map(
      (msg) => `
    <div class="message-item card">
      <div class="card-header">
        <div class="message-author">
          <span class="author-icon">💬</span>
          <span class="author-name">${
            msg.authorName || msg.author || ""
          }より</span>
          <span class="message-date">${new Date(
            msg.datetime
          ).toLocaleDateString("ja-JP")}</span>
        </div>
      </div>
      <div class="card-body">
        <h3>${msg.title}</h3>
        <p>${(msg.content || "").replace(/\n/g, "<br>")}</p>
      </div>
    </div>
  `
    )
    .join("");
}

// カレンダー生成
function generateCalendar() {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  // 月表示更新
  const headerEl = document.getElementById("current-month");
  if (headerEl) headerEl.textContent = `${year}年${month + 1}月`;

  const grid = document.getElementById("calendar-grid");
  if (!grid) return;
  grid.innerHTML = "";

  // 曜日ヘッダー
  const dayHeaders = ["日", "月", "火", "水", "木", "金", "土"];
  dayHeaders.forEach((d) => {
    const h = document.createElement("div");
    h.className = "calendar-day-header";
    h.textContent = d;
    grid.appendChild(h);
  });

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const firstWeekday = firstDay.getDay();
  const daysInMonth = lastDay.getDate();

  // 前月埋め
  const prevMonth = new Date(year, month, 0); // 前月末
  for (let i = firstWeekday - 1; i >= 0; i--) {
    grid.appendChild(
      createDayElement(prevMonth.getDate() - i, true, year, month - 1)
    );
  }
  // 今月
  for (let d = 1; d <= daysInMonth; d++) {
    grid.appendChild(createDayElement(d, false, year, month));
  }
  // 次月
  const totalCells = 42; // 6週
  const filled = firstWeekday + daysInMonth;
  for (let d = 1; filled + d <= totalCells; d++) {
    grid.appendChild(createDayElement(d, true, year, month + 1));
  }
}

// 日付セル生成
function createDayElement(day, isOtherMonth, year, month) {
  const el = document.createElement("div");
  el.className = "calendar-day";
  if (isOtherMonth) el.classList.add("other-month");
  const dateObj = new Date(year, month, day);
  if (!isOtherMonth) {
    // 正規化した日付 (時刻部分を切り捨て)
    const norm = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate());
    const normToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const normYesterday = new Date(normToday);
    normYesterday.setDate(normToday.getDate() - 1);

    if (norm.getTime() === normToday.getTime()) {
      el.classList.add("today");
    } else if (norm.getTime() <= normYesterday.getTime()) {
      // 昨日を含むそれより以前は past として扱う
      el.classList.add("past");
    }
  }
  const num = document.createElement("div");
  num.className = "day-number";
  num.textContent = day;
  el.appendChild(num);

  if (!isOtherMonth) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, "0");
    const d = String(day).padStart(2, "0");
    const dateStr = `${y}-${m}-${d}`;
    const events = getEventsForDate(dateStr);
    if (events.length) {
      const wrap = document.createElement("div");
      wrap.className = "day-events";
      events.forEach((ev) => {
        const item = document.createElement("div");
        const isPeriod = !!ev.endDate;
        item.className = `day-event ${
          isPeriod ? "period-day-event" : "single-event"
        }`;
        item.innerHTML = `<span class="event-dot ${ev.type}"></span>${ev.text}`;
        wrap.appendChild(item);
      });
      el.appendChild(wrap);
    }
  }
  return el;
}

// バー方式関数は不要のため削除済

// 前月へ
function previousMonth() {
  currentDate.setMonth(currentDate.getMonth() - 1);
  generateCalendar();
}

// 次月へ
function nextMonth() {
  currentDate.setMonth(currentDate.getMonth() + 1);
  generateCalendar();
}

// レシピモーダルを表示
function showRecipe(recipeId) {
  const recipe = recipes[recipeId];
  if (!recipe) return;

  const modal = document.getElementById("recipe-modal");
  const content = document.getElementById("recipe-content");

  content.innerHTML = `
        <h2 class="recipe-title">${recipe.title}</h2>
        <div class="recipe-ingredients">
            <h4>材料：</h4>
            <ul>
                ${recipe.ingredients
                  .map((ingredient) => `<li>${ingredient}</li>`)
                  .join("")}
            </ul>
        </div>
        <div class="recipe-steps">
            <h4>作り方：</h4>
            <ol>
                ${recipe.steps.map((step) => `<li>${step}</li>`).join("")}
            </ol>
        </div>
    `;

  modal.style.display = "block";
}

// モーダルを閉じる
function closeModal() {
  document.getElementById("recipe-modal").style.display = "none";
}

// 特価商品のレシピ表示 (recipeDetails / recipeName / recipeIdea)
function showSpecialRecipe(index) {
  const data = __specialsSliderState.data || [];
  const sp = data[index];
  if (!sp) return;
  const modal = document.getElementById("recipe-modal");
  const content = document.getElementById("recipe-content");
  if (!modal || !content) return;
  const title = sp.recipeName || sp.name || "レシピ";
  const detailsRaw =
    sp.recipeDetails ||
    sp.recipeIdea ||
    sp.description ||
    "詳細情報はありません。";
  const lines = String(detailsRaw)
    .trim()
    .split(/\r?\n+/)
    .filter((l) => l.trim().length);
  let bodyHtml = "";
  if (lines.length <= 1) {
    bodyHtml = `<p>${lines[0] || detailsRaw}</p>`;
  } else {
    bodyHtml = `<ol>${lines.map((l) => `<li>${l}</li>`).join("")}</ol>`;
  }
  content.innerHTML = `
    <h2 class="recipe-title">${title}</h2>
    <div class="recipe-steps">${bodyHtml}</div>
    ${
      sp.image
        ? `<div style='margin-top:12px;'><img src='${sp.image}' alt='${
            sp.name || "商品"
          }' style='max-width:130px;border-radius:8px;box-shadow:0 2px 8px #0002;'/></div>`
        : ""
    }
  `;
  modal.style.display = "block";
}

// モーダル外クリックで閉じる
window.addEventListener("click", function (event) {
  const modal = document.getElementById("recipe-modal");
  if (event.target === modal) {
    closeModal();
  }
});

// フォーム送信の処理
function setupFormSubmission() {
  const form = document.getElementById("customer-request-form");
  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    const formData = new FormData(form);
    // 件名(title)・お名前(name)は送信しない
    const payload = {
      category: formData.get("category"),
      message: formData.get("message"),
    };
    try {
      if (window.__api && window.__api.apiAddComment) {
        await window.__api.apiAddComment(payload);
      } else if (window.__api && window.__api.apiAddRequest) {
        await window.__api.apiAddRequest(payload);
      } else {
        console.warn("comments API not available; request not persisted");
      }
      alert(
        "ご要望をお送りいただき、ありがとうございます。貴重なご意見として参考にさせていただきます。"
      );
      form.reset();
    } catch (err) {
      console.error("request submit failed", err);
      alert("送信に失敗しました。時間をおいて再度お試しください。");
    }
  });
}

// スムーススクロール
document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
  anchor.addEventListener("click", function (e) {
    e.preventDefault();
    const target = document.querySelector(this.getAttribute("href"));
    if (target) {
      target.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
      // モバイルメニューが開いている場合は閉じる
      const navLinks = document.getElementById("nav-links");
      if (navLinks && navLinks.classList.contains("active")) {
        navLinks.classList.remove("active");
      }
    }
  });
});

// --- 詳細顧客向け行動計測の初期化（ページ読み込み時に1回だけ呼ぶ） ---
try {
  initCustomerAnalyticsInstrumentation({ minViewMs: 400, selectorList: [".special-item", ".event-item", ".message-item", ".product-card", "#promo-card"] });
} catch (e) {
  console.warn("initCustomerAnalyticsInstrumentation failed", e);
}

// 顧客ページ用の詳細行動計測
function initCustomerAnalyticsInstrumentation({ minViewMs = 500, selectorList = [] } = {}) {
  // anon/session id reuse from earlier
  const sessionId = sessionStorage.getItem("SESSION_ID") || "";
  const anonUserId = localStorage.getItem("CUSTOMER_ID") || "";

  // safe sender: use apiLogEvent if available, else sendBeacon/fetch
  function sendPayload(payload) {
    try {
      // Buffer events and flush in batches to reduce request volume.
      const final = Object.assign({ page: location.pathname || "", anonUserId: anonUserId || null, sessionId: sessionId || null }, payload);
      // Push to local batch queue and rely on batch flush (always use batching to reduce request volume)
      try {
        if (!window.__eventBatchQueue) {
          window.__eventBatchQueue = [];
          window.__eventBatchTimer = null;
        }
        window.__eventBatchQueue.push(final);

        const FLUSH_INTERVAL = 5000; // ms
        const FLUSH_BATCH_SIZE = 25; // max events per batch

        async function flushBatch() {
          if (!window.__eventBatchQueue || !window.__eventBatchQueue.length) return;
          const toSend = window.__eventBatchQueue.splice(0, FLUSH_BATCH_SIZE);
          const url = (window.API_BASE_URL || "") + "/api/event-logs/batch";
          const body = JSON.stringify({ events: toSend });
          try {
            // try sendBeacon for reliability on pagehide
            if (navigator.sendBeacon) {
              try {
                const ok = navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
                if (ok) return;
              } catch (e) {}
            }
            await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(()=>{});
          } catch (e) {}
        }

        // schedule a flush if not already scheduled
        if (window.__eventBatchTimer) clearTimeout(window.__eventBatchTimer);
        window.__eventBatchTimer = setTimeout(() => {
          window.__eventBatchTimer = null;
          try { flushBatch(); } catch(e){}
        }, FLUSH_INTERVAL);
        // expose flush for pagehide/beforeunload
        try {
          window.__flushEventBatch = async function() { await flushBatch(); };
        } catch (e) {}
      } catch (e) {}
    } catch (e) {}
  }

  // Ensure queued events are attempted to be sent on pagehide / beforeunload
  try {
    const tryFlushNow = () => {
      try {
        if (window.__eventBatchQueue && window.__eventBatchQueue.length) {
          const url = (window.API_BASE_URL || "") + "/api/event-logs/batch";
          const body = JSON.stringify({ events: window.__eventBatchQueue.splice(0, 1000) });
          try {
            if (navigator.sendBeacon) {
              try { navigator.sendBeacon(url, new Blob([body], { type: "application/json" })); return; } catch(e){}
            }
            // best-effort fetch (may be ignored during unload)
            fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(()=>{});
          } catch (e) {}
        }
      } catch (e) {}
    };
    window.addEventListener('pagehide', tryFlushNow);
    window.addEventListener('beforeunload', tryFlushNow);
  } catch (e) {}

  // Click tracking (delegated)
  // Deduplicate quick repeated clicks coming from nested elements or multiple listeners.
  const _recentClicks = new Map(); // key -> timestamp
  const DEDUPE_MS = 600;
  document.addEventListener("click", (e) => {
    try {
      const target = e.target.closest("button, a, img, [data-analytics-click], .special-item, .product-card");
      if (!target) return;
      const tag = target.tagName.toLowerCase();
      const txt = (target.getAttribute("data-label") || target.textContent || "").trim().slice(0, 180);
      const elId = target.id || target.getAttribute("data-id") || null;
      const path = getDomPath(target);
      const props = { element: tag, text: txt, elementId: elId, domPath: path };
      // dedupe key: type + elementId + domPath + text
      const key = `click::${elId || ''}::${path || ''}::${txt}`;
      const now = Date.now();

      // If a recent explicit logEvent was recorded for this domPath/elementId, skip generic click
      try {
        const recentMap = window.__recentLoggedActions;
        const domKey = (path || elId || '').toString();
        if (recentMap && domKey) {
          const t = recentMap.get(domKey);
          if (t && now - t < 1200) return; // skip duplicate because explicit event already logged
        }
      } catch(e){}

      const prev = _recentClicks.get(key) || 0;
      if (now - prev < DEDUPE_MS) {
        // ignore duplicate
        return;
      }
      _recentClicks.set(key, now);
      // cleanup map entries occasionally
      if (_recentClicks.size > 500) {
        const cutoff = now - DEDUPE_MS * 4;
        for (const [k, t] of _recentClicks.entries()) if (t < cutoff) _recentClicks.delete(k);
      }
      sendPayload({ type: "click", props });
    } catch (e) {}
  }, { capture: false });

  // View tracking via IntersectionObserver for provided selectors
  const activeStarts = new Map();
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      try {
        const el = en.target;
        const key = el.__analytics_key || (el.getAttribute("data-analytics-key") || null) || getDomPath(el);
        if (en.isIntersecting && en.intersectionRatio >= 0.5) {
          if (!activeStarts.has(key)) activeStarts.set(key, Date.now());
        } else {
          const start = activeStarts.get(key);
          if (start) {
            const dur = Date.now() - start;
            activeStarts.delete(key);
            if (dur >= minViewMs) {
              const props = { feature: el.getAttribute("data-analytics-feature") || el.className || el.id || "element", durationMs: dur, domPath: key };
              sendPayload({ type: "view", props });
            }
          }
        }
      } catch (e) {}
    });
  }, { threshold: [0.5] });

  selectorList.forEach((sel) => {
    try {
      document.querySelectorAll(sel).forEach((el) => {
        try { io.observe(el); } catch(e) {}
      });
    } catch (e) {}
  });

  // flush on pagehide
  window.addEventListener("pagehide", () => {
    try {
      for (const [key, start] of activeStarts.entries()) {
        const dur = Date.now() - start;
        if (dur >= minViewMs) sendPayload({ type: "view", props: { durationMs: dur, domPath: key, unload: true } });
      }
    } catch (e) {}
  });

  // small helper to compute simple DOM path for identification (no PII)
  function getDomPath(el) {
    try {
      const parts = [];
      let cur = el;
      while (cur && cur.nodeType === 1 && parts.length < 6) {
        let part = cur.tagName.toLowerCase();
        if (cur.id) part += `#${cur.id}`;
        else if (cur.className) {
          const cn = (typeof cur.className === 'string') ? cur.className.split(/\s+/)[0] : null;
          if (cn) part += `.${cn}`;
        }
        parts.push(part);
        cur = cur.parentElement;
      }
      return parts.join(" > ");
    } catch (e) { return null; }
  }
}

// ハンバーガーメニューの制御
function toggleMenu() {
  const navLinks = document.getElementById("nav-links");

  navLinks.classList.toggle("active");
}

// メニュー外をクリックした時にメニューを閉じる
document.addEventListener("click", function (e) {
  const navLinks = document.getElementById("nav-links");
  const menuToggle = document.querySelector(".menu-toggle");
  const nav = document.querySelector("nav");

  if (
    navLinks &&
    navLinks.classList.contains("active") &&
    !nav.contains(e.target) &&
    !menuToggle.contains(e.target)
  ) {
    navLinks.classList.remove("active");
  }
});

// ウィンドウリサイズ時の処理
window.addEventListener("resize", function () {
  const navLinks = document.getElementById("nav-links");
  if (window.innerWidth > 768 && navLinks) {
    navLinks.classList.remove("active");
  }
});

// ========================
// 特価商品スライダー(API連携)
// ========================
let __specialsSliderState = {
  data: [],
  current: 0,
  timer: null,
};

// 本日アクティブな特価商品のみを残す（サーバー側 active=1 の二重保険）
function filterActiveToday(list) {
  if (!Array.isArray(list)) return [];
  const today = new Date();
  const toYMD = (d) => {
    if (!d) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
    const dt = new Date(d);
    if (isNaN(dt)) return null;
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(
      2,
      "0"
    )}-${String(dt.getDate()).padStart(2, "0")}`;
  };
  const todayStr = toYMD(today);
  return list.filter((sp) => {
    const s = toYMD(sp.startDate);
    const e = toYMD(sp.endDate) || s;
    return s && e && s <= todayStr && todayStr <= e;
  });
}

async function initSpecialsSlider() {
  const track = document.getElementById("specials-slider-track");
  const container = document.getElementById("specials-slider");
  if (!track || !container) return; // HTML未配置なら何もしない
  if (!window.__api) return; // APIクライアント未準備

  let list = [];
  try {
    const getter =
      window.__api.apiGetActiveSpecials || window.__api.apiGetSpecials;
    if (!getter) return;
    list = await getter();
    list = filterActiveToday(list); // 念のため再フィルタ
  } catch (e) {
    console.warn("/api/specials fetch failed", e);
    return;
  }
  if (!Array.isArray(list)) return;
  if (!list.length) {
    // 当日対象が0件の場合の明示メッセージ
    track.innerHTML =
      "<div class='no-specials-message' style='padding:24px;text-align:center;color:#555;'>お買い得商品はありません</div>";
    return;
  }

  // 当日分のみなので開始日昇順のみ
  const toYMD = (d) => {
    if (!d) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
    const dt = new Date(d);
    if (isNaN(dt)) return null;
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(
      2,
      "0"
    )}-${String(dt.getDate()).padStart(2, "0")}`;
  };
  // If server returned displayOrder, respect it. Otherwise fall back to startDate.
  try {
    list.sort((a, b) => {
      const da = Number(a.displayOrder != null ? a.displayOrder : 999999);
      const db = Number(b.displayOrder != null ? b.displayOrder : 999999);
      if (da !== db) return da - db;
      const as = toYMD(a.startDate) || "9999-99-99";
      const bs = toYMD(b.startDate) || "9999-99-99";
      if (as !== bs) return as.localeCompare(bs);
      return (Number(a.id) || 0) - (Number(b.id) || 0);
    });
  } catch (e) {}

  // 割引率計算は不要（旧価格表示は出さない）
  const calcDiscount = () => null;

  __specialsSliderState.data = list;
  track.innerHTML = list
    .map((sp, idx) => {
      const img = sp.image || sp.imageUrl || "../images/placeholder.svg";
      // descriptionは複数行の場合整形
      const descHtml = sp.description
        ? sp.description.replace(/\n+/g, "<br>")
        : "";
      const hasRecipeDetail = !!(
        sp.recipeDetails ||
        sp.recipeName ||
        sp.recipeIdea
      );
      const unitText = resolveUnit(sp);
      return `
        <div class="specials-slider-item special-item card" data-idx="${idx}">
          <div class="special-image">
            <img src="${img}" alt="${
        sp.name || "お買い得商品"
      }" onerror="this.src='../images/placeholder.svg'" />
            
          </div>
          <div class="card-body">
            <h3>${sp.name || "お買い得商品"}</h3>
            <div class="price-info">
              ${sp.salePrice != null ? `<span class=\"new-price\">¥${Number(sp.salePrice).toLocaleString()}</span>` : ""}
              ${unitText ? `<span class=\"unit\">${unitText}</span><span class=\"tax\">（税抜）</span>` : `<span class=\"tax\">（税抜）</span>`}
            </div>
            <div class="promotion-text">
              ${descHtml ? `<p>${descHtml}</p>` : ""}
            </div>
            ${
              hasRecipeDetail
                ? `<button class=\"btn-recipe\" data-recipe-idx='${idx}' type='button'>おすすめお手軽レシピを見る</button>`
                : ""
            }
          </div>
        </div>`;
    })
    .join("");

  // フェードイン演出
  try {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting) en.target.classList.add("in-view");
        });
      },
      { threshold: 0.15 }
    );
    track.querySelectorAll(".card").forEach((el) => {
      el.classList.add("reveal");
      io.observe(el);
    });
  } catch {}

  // ナビゲーション
  const btnNext = document.getElementById("specials-next");
  const btnPrev = document.getElementById("specials-prev");
  if (btnNext)
    btnNext.onclick = () => {
      specialsNext();
      startAuto();
      try { if (window.logEvent) window.logEvent('special_navigate', { direction: 'next', toIndex: __specialsSliderState.current, name: (__specialsSliderState.data[__specialsSliderState.current]||{}).name || '' }); } catch {}
    };
  if (btnPrev)
    btnPrev.onclick = () => {
      specialsPrev();
      startAuto();
      try { if (window.logEvent) window.logEvent('special_navigate', { direction: 'prev', toIndex: __specialsSliderState.current, name: (__specialsSliderState.data[__specialsSliderState.current]||{}).name || '' }); } catch {}
    };
  window.addEventListener("resize", () => updateSlider());
  // ドットインジケーターを生成
  function renderDots() {
    let dots = container.querySelector(".specials-slider-dots");
    if (!dots) {
      dots = document.createElement("div");
      dots.className = "specials-slider-dots";
      container.appendChild(dots);
    }
    dots.innerHTML = list
      .map((_, i) => `<button class="dot" data-idx="${i}" aria-label="${i + 1}"></button>`)
      .join("");
    dots.querySelectorAll(".dot").forEach((b) => {
      b.addEventListener("click", (ev) => {
        const idx = Number(b.getAttribute("data-idx"));
        if (Number.isNaN(idx)) return;
        __specialsSliderState.current = idx;
        updateSlider();
        startAuto();
        try { if (window.logEvent) window.logEvent('special_navigate', { direction: 'dot', toIndex: idx, name: (__specialsSliderState.data[idx]||{}).name || '' }); } catch {}
      });
    });
  }

  renderDots();

  updateSlider();
  startAuto();

  // タッチ/ドラッグによる切り替えサポート
  (function attachPointerDrag() {
    let startX = 0;
    let currentX = 0;
    let dragging = false;
    const threshold = 50; // px
    let initialTranslate = 0;
    const getCurrentTranslate = () => {
      try {
        const st = window.getComputedStyle(track).transform;
        if (!st || st === "none") return 0;
        const vals = st.split("(")[1].split(")")[0].split(",");
        return parseFloat(vals[4]) || 0;
      } catch (e) {
        return 0;
      }
    };
    const touchStart = (x) => {
      startX = x;
      currentX = x;
      dragging = true;
      track.classList.add("dragging");
      initialTranslate = getCurrentTranslate();
      if (__specialsSliderState && __specialsSliderState.timer) clearInterval(__specialsSliderState.timer);
    };
    const touchMove = (x) => {
      if (!dragging) return;
      currentX = x;
      const dx = currentX - startX;
      // 軽い視覚フィードバック：translate by dx (relative to initialTranslate)
      track.style.transition = "none";
      const newT = initialTranslate + dx;
      track.style.transform = `translateX(${newT}px)`;
    };
    const touchEnd = () => {
      if (!dragging) return;
      dragging = false;
      track.classList.remove('dragging');
      const dx = currentX - startX;
      track.style.transition = '';
      // 判定
      if (Math.abs(dx) > threshold) {
        if (dx < 0) {
          specialsNext();
        } else {
          specialsPrev();
        }
      }
      updateSlider();
      startAuto();
    };

    // touch events
    track.addEventListener('touchstart', (e) => touchStart(e.touches[0].clientX), {passive:true});
    track.addEventListener('touchmove', (e) => { if (e.touches && e.touches[0]) touchMove(e.touches[0].clientX); }, {passive:true});
    track.addEventListener('touchend', touchEnd);

    // mouse drag for desktop
    let mouseDown = false;
    track.addEventListener('mousedown', (e) => { mouseDown = true; touchStart(e.clientX); e.preventDefault(); });
    window.addEventListener('mousemove', (e) => { if (mouseDown) touchMove(e.clientX); });
    window.addEventListener('mouseup', (e) => { if (mouseDown) { mouseDown = false; touchEnd(); } });
  })();

  // レシピボタンクリック（イベントデリゲーション）
  track.addEventListener("click", (e) => {
    const btn = e.target.closest(".btn-recipe");
    if (!btn) return;
    const idx = Number(btn.getAttribute("data-recipe-idx"));
    if (Number.isNaN(idx)) return;
    showSpecialRecipe(idx);
  });
}

function updateSlider() {
  const container = document.getElementById("specials-slider");
  const track = document.getElementById("specials-slider-track");
  if (!container || !track) return;
  const items = track.querySelectorAll(".specials-slider-item");
  if (!items.length) return;
  const state = __specialsSliderState;
  const idx = Math.max(0, Math.min(state.current, items.length - 1));
  const target = items[idx];
  const containerWidth = container.clientWidth;
  const targetWidth = target.offsetWidth;
  const targetLeft = target.offsetLeft;
  let scrollX = targetLeft - (containerWidth - targetWidth) / 2;
  const maxScroll = Math.max(0, track.scrollWidth - containerWidth);
  scrollX = Math.max(0, Math.min(scrollX, maxScroll));
  track.style.transform = `translateX(${-scrollX}px)`;

  // ドットの active 更新
  try {
    const dots = container.querySelectorAll(".specials-slider-dots .dot");
    if (dots && dots.length) {
      dots.forEach((d) => d.classList.remove("active"));
      if (dots[idx]) dots[idx].classList.add("active");
    }
  } catch (e) {}
}

function specialsNext() {
  const state = __specialsSliderState;
  if (!state.data.length) return;
  state.current = (state.current + 1) % state.data.length;
  updateSlider();
}
function specialsPrev() {
  const state = __specialsSliderState;
  if (!state.data.length) return;
  state.current = (state.current - 1 + state.data.length) % state.data.length;
  updateSlider();
}

function startAuto() {
  const state = __specialsSliderState;
  if (state.timer) clearInterval(state.timer);
  if (!state.data.length) return;
  state.timer = setInterval(() => {
    specialsNext();
  }, 3500);
}

// ページロード時に初期化を試行（既存DOMContentLoaded後でも動くよう setTimeout）
document.addEventListener("DOMContentLoaded", () => {
  // APIクライアント読み込み後に実行されるよう少し遅延
  setTimeout(() => {
    try {
      initSpecialsSlider();
    } catch (e) {
      console.warn("initSpecialsSlider failed", e);
    }
  }, 50);
});

// 顧客ページ: 領域ごとの表示時間計測（calendar/specials/messages/requests）
(function(){
  try{
    const selectors = [
      { sel: '#calendar', feature: 'calendar' },
      { sel: '#specials', feature: 'specials' },
      { sel: '#messages', feature: 'messages' },
      { sel: '#requests', feature: 'requests' }
    ];
    const active = {};
    const MIN_VIEW_MS = 500;
    const obs = new IntersectionObserver((entries)=>{
      entries.forEach(en=>{
        try{
          const f = en.target.__featureName;
          if (!f) return;
          if (en.isIntersecting && en.intersectionRatio >= 0.5) {
            if (!active[f]) active[f] = Date.now();
          } else {
            const start = active[f];
            if (start) {
              const d = Date.now() - start;
              delete active[f];
              if (d >= MIN_VIEW_MS) {
                try{ if (window.logEvent) window.logEvent('view', { feature: f, durationMs: d }); } catch {}
              }
            }
          }
        }catch{}
      });
    }, { threshold: [0.5] });
    selectors.forEach(s=>{
      try{
        const el = document.querySelector(s.sel);
        if (!el) return;
        el.__featureName = s.feature;
        obs.observe(el);
      }catch(e){}
    });
    function flush(){
      try{
        Object.keys(active).forEach(f=>{
          const start = active[f];
          if (!start) return;
          const d = Date.now() - start;
          if (d >= MIN_VIEW_MS) {
            try{ if (window.logEvent) window.logEvent('view', { feature: f, durationMs: d, unload: true }); } catch {}
          }
        });
      }catch(e){}
    }
    window.addEventListener('beforeunload', flush);
    window.addEventListener('pagehide', flush);
  }catch(e){}
})();
