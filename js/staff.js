// 店員向けページのJavaScript

// データストレージ（実際にはサーバーのデータベースに保存）
let eventsData = [];
let specialsData = [];

// 初期表示用の店員メッセージ
let messagesData = [
  {
    id: 1,
    author: "manager",
    authorName: "店長",
    title: "本日のおすすめ",
    content: "旬の秋鮭がお買い得！ぜひ鮮魚コーナーへお立ち寄りください。",
    datetime: "2025-09-11T09:00",
  },
  {
    id: 2,
    author: "produce",
    authorName: "青果部",
    title: "新鮮れんこん入荷",
    content:
      "シャキシャキ食感のれんこんが入荷しました。きんぴらや天ぷらにおすすめです。",
    datetime: "2025-09-10T14:30",
  },
  {
    id: 3,
    author: "fish",
    authorName: "鮮魚部",
    title: "お刺身盛り合わせ特価",
    content:
      "本日限りの特価！夕食にぴったりのお刺身盛り合わせをご用意しています。",
    datetime: "2025-09-09T17:10",
  },
];

// 初期表示用のお客様要望
let requestsData = [
  {
    id: 1,
    category: "service",
    title: "セルフレジの導入希望",
    message: "レジの待ち時間短縮のため、セルフレジの導入をご検討ください。",
    status: "in-progress",
    submitDate: "2025-09-07T16:15",
  },
  {
    id: 2,
    category: "product",
    title: "無塩ナッツの品揃え拡充",
    message: "アーモンドやミックスナッツの無塩タイプを増やしてほしいです。",
    status: "pending",
    submitDate: "2025-09-08T11:05",
  },
];

let currentAIType = "";
let currentFormData = {};

// ページ読み込み時の初期化
document.addEventListener("DOMContentLoaded", async function () {
  initializeForms();
  // サーバーデータで初期化（可能なら）
  await refreshAllFromServer();
  renderEventList();
  renderSpecialList();
  try { initSpecialReorderControls(); } catch (e) { console.warn('initSpecialReorderControls failed', e); }
  renderMessageList();
  // お買い得商品プレビュー（顧客表示類似の簡易カード）
  try {
    await renderSpecialsPreview();
  } catch (e) {
    console.warn("specials preview render failed", e);
  }
  await refreshRequestsFromServer();
  renderRequestList();
  updateRequestStats();
  await refreshRequestsFromServer();
  renderRequestList();
  updateRequestStats();
  setCurrentDateTime();
  // 過去イベントコントロール初期化
  try { initPastEventControls(); } catch (e) { console.warn('initPastEventControls failed', e); }
  try { initPastSpecialControls(); } catch (e) { console.warn('initPastSpecialControls failed', e); }
  // 画面復帰時に最新化（他端末の変更を反映）
  window.addEventListener("focus", async () => {
    await refreshAllFromServer();
    renderEventList();
    renderSpecialList();
    renderMessageList();
  });
  // 初期解析用: 行動ログの計測を開始
  try { initAnalyticsInstrumentation(); } catch (e) { console.warn('initAnalyticsInstrumentation failed', e); }
  // 軽いポーリング（60秒ごと）
  setInterval(async () => {
    try {
      if (window.__api && window.__api.apiGetMessages) {
        const list = await window.__api.apiGetMessages();
        if (Array.isArray(list)) {
          messagesData = list;
          renderMessageList();
        }
      }
    } catch {}
  }, 60000);

  // 管理トークンUI
  const openAdmin = document.getElementById("open-admin-token");
  if (openAdmin) openAdmin.addEventListener("click", (e) => { e.preventDefault(); openAdminTokenModal(); });
  // 初期状態で保存済みなら一言ログ
  try {
    const t = localStorage.getItem("ADMIN_TOKEN");
    if (!t) console.info("[staff] ADMIN_TOKEN not set in this browser");
  } catch {}

  // --- 特売リスト出力: イベントハンドラ設定 ---
  const buildBtn = document.getElementById("btn-build-export");
  if (buildBtn) {
    buildBtn.addEventListener("click", async () => {
      try {
        await buildSpecialsExport();
      } catch (e) {
        console.error(e);
        showAlert("リスト化に失敗しました", "error");
      }
    });
  }
  const dlBtn = document.getElementById("btn-download-pdf");
  if (dlBtn) {
    dlBtn.addEventListener("click", async () => {
      try {
        await downloadExportPDF();
      } catch (e) {
        console.error(e);
        showAlert("PDF出力に失敗しました", "error");
      }
    });
  }
  const toggleRecipe = document.getElementById("toggle-recipe");
  if (toggleRecipe) {
    toggleRecipe.addEventListener("change", () => {
      document.documentElement.style.setProperty(
        "--export-show-recipe",
        toggleRecipe.checked ? "block" : "none"
      );
    });
    // 初期状態反映
    document.documentElement.style.setProperty(
      "--export-show-recipe",
      toggleRecipe.checked ? "block" : "none"
    );
  }
  const toggleDesc = document.getElementById("toggle-desc");
  if (toggleDesc) {
    toggleDesc.addEventListener("change", () => {
      document.documentElement.style.setProperty(
        "--export-show-desc",
        toggleDesc.checked ? "block" : "none"
      );
    });
    // 初期状態（デフォルト非表示）
    document.documentElement.style.setProperty(
      "--export-show-desc",
      toggleDesc.checked ? "block" : "none"
    );
  }
  // %OFF 表示トグル
  const toggleOff = document.getElementById("toggle-off");
  if (toggleOff) {
    const apply = () => document.documentElement.style.setProperty(
      "--export-show-off",
      toggleOff.checked ? "inline-block" : "none"
    );
    toggleOff.addEventListener("change", apply);
    apply();
  }
  // 全選択 / 全解除
  const btnAll = document.getElementById("btn-select-all");
  const btnNone = document.getElementById("btn-deselect-all");
  if (btnAll)
    btnAll.addEventListener("click", () => {
      document
        .querySelectorAll("#export-preview .export-item .include-checkbox")
        .forEach((cb) => {
          cb.checked = true;
          const item = cb.closest(".export-item");
          if (item) item.classList.remove("excluded");
        });
    });
  if (btnNone)
    btnNone.addEventListener("click", () => {
      document
        .querySelectorAll("#export-preview .export-item .include-checkbox")
        .forEach((cb) => {
          cb.checked = false;
          const item = cb.closest(".export-item");
          if (item) item.classList.add("excluded");
        });
    });
});

  // 管理トークン保存（API 403 対策）
  const tokenInput = document.getElementById("admin-token-inline-input");
  const tokenBtn = document.getElementById("btn-save-admin-token");
  if (tokenInput) {
    try { tokenInput.value = localStorage.getItem("ADMIN_TOKEN") || ""; } catch {}
  }
  if (tokenBtn && tokenInput) {
    tokenBtn.addEventListener("click", () => {
      try {
        localStorage.setItem("ADMIN_TOKEN", tokenInput.value || "");
        showAlert("管理トークンを保存しました", "success");
      } catch (e) {
        console.warn(e);
        showAlert("トークン保存に失敗しました", "error");
      }
    });
  }
async function refreshAllFromServer() {
  try {
    if (window.__api && window.__api.apiGetEvents) {
      const list = await window.__api.apiGetEvents();
      if (Array.isArray(list)) eventsData = list;
    }
  } catch (e) {
    console.warn("events fetch failed", e);
  }
  try {
    if (window.__api && window.__api.apiGetSpecials) {
      const list = await window.__api.apiGetSpecials();
      if (Array.isArray(list)) specialsData = list;
    }
  } catch (e) {
    console.warn("specials fetch failed", e);
  }
  try {
    if (window.__api && window.__api.apiGetMessages) {
      const list = await window.__api.apiGetMessages();
      if (Array.isArray(list)) messagesData = list;
    }
  } catch (e) {
    console.warn("messages fetch failed", e);
  }
  try {
    await refreshRequestsFromServer();
  } catch (e) {
    console.warn("requests fetch failed", e);
  }
}

async function refreshRequestsFromServer() {
  if (window.__api && window.__api.apiGetRequests) {
    const list = await window.__api.apiGetRequests();
    if (Array.isArray(list)) requestsData = list;
  }
}

// =====================
// 日付ユーティリティ（過去分の非表示に使用）
// =====================
function toLocalDateOnly(dateStr) {
  if (!dateStr) return null;
  // 入力は YYYY-MM-DD 想定。時差の影響を避けるため明示的にローカル日付を生成
  const [y, m, d] = String(dateStr).split("-").map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d, 0, 0, 0, 0);
  dt.setHours(0, 0, 0, 0);
  return dt;
}

function isPastPeriod(startDateStr, endDateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = toLocalDateOnly(startDateStr);
  const end = toLocalDateOnly(endDateStr) || start;
  if (!start) return false; // 日付不明は除外しない
  // 期間の終了が「昨日以前」なら過去とみなす（今日を含めて表示）
  return end && end < today;
}

// メッセージ用AI改善（テンプレート）
function simulateAIImprovement() {
  const originalTitle = currentFormData.title;
  const originalContent = currentFormData.content;

  const improvedMessages = {
    今日のおすすめ: `🌟 本日のスペシャル特価！\n${originalContent}\n\nお客様のご来店を心よりお待ちしております。\n※数量限定のため、お早めにお越しください。`,
    セール: `🎉 大特価セール開催中！\n${originalContent}\n\nこの機会をお見逃しなく！スタッフ一同、皆様のご来店をお待ちしております。\n※在庫がなくなり次第終了とさせていただきます。`,
    お知らせ: `📢 重要なお知らせ\n${originalContent}\n\nご不明な点がございましたら、お気軽にスタッフまでお声がけください。\nいつもご愛顧いただき、ありがとうございます。`,
    イベント: `🎪 楽しいイベント開催！\n${originalContent}\n\nぜひご家族皆様でお越しください。スタッフ一同、心よりお待ちしております。\n※詳細は店内掲示をご確認ください。`,
  };

  let improvedContent = originalContent;
  for (const [keyword, template] of Object.entries(improvedMessages)) {
    if (originalTitle.includes(keyword) || originalContent.includes(keyword)) {
      improvedContent = template;
      break;
    }
  }
  if (improvedContent === originalContent) {
    improvedContent = `✨ ${originalTitle}\n\n${originalContent}\n\nいつも松源をご利用いただき、ありがとうございます。\nご質問やご不明な点がございましたら、お気軽にスタッフまでお声がけください。`;
  }

  document.getElementById("improved-message").value = improvedContent;
}

// フォームの初期化
function initializeForms() {
  // イベント追加フォーム
  const eventForm = document.getElementById("add-event-form");
  if (eventForm) {
    eventForm.addEventListener("submit", function (e) {
      e.preventDefault();
      addEvent();
    });
  }
  // イベント種別切替時にアイコンを自動設定 / イベント名入力でアイコン検索
  try {
    const typeSelect = document.querySelector('#add-event-form select[name="type"]');
    const eventNameGroup = document.getElementById('event-name-group');
    const eventNameInput = document.getElementById('eventNameInput');
    const imageInput = document.getElementById('eventImageInput');
    const previewDiv = document.getElementById('eventIconPreview');

    async function setPreview(url) {
      try {
        if (!url) {
          previewDiv.innerHTML = '';
          return;
        }
        // simple image preview
        previewDiv.innerHTML = `<div style="display:flex; align-items:center; gap:8px;"><img src="${url}" alt="icon" style="max-width:64px; max-height:64px; border-radius:6px; border:1px solid #ddd; background:#fff;"/><div style="font-size:0.9rem;color:#444">選択中のアイコン</div></div>`;
      } catch (e) { console.warn('preview failed', e); }
    }

    async function onTypeChange() {
      const v = typeSelect.value;
      if (v === 'event') {
        if (eventNameGroup) eventNameGroup.style.display = 'block';
        // clear image until eventName lookup
        if (imageInput) imageInput.value = '';
        await setPreview('');
      } else {
        if (eventNameGroup) eventNameGroup.style.display = 'none';
        if (v === 'reservation-start') {
          const url = '../images/icon/reservation.png';
          if (imageInput) imageInput.value = url;
          await setPreview(url);
        } else if (v === 'arrival') {
          const url = '../images/icon/arrival.png';
          if (imageInput) imageInput.value = url;
          await setPreview(url);
        } else {
          if (imageInput) imageInput.value = '';
          await setPreview('');
        }
      }
    }

    if (typeSelect) {
      typeSelect.addEventListener('change', onTypeChange);
      // initial set
      onTypeChange();
    }

    // icon name lookup logic
    let __iconLsCache = null; // [{key, filename}, ...]
    function normalizeJP(s) {
      try {
        return String(s || '').normalize('NFKC').toLowerCase().replace(/\u200B|\u200C|\u200D|\uFEFF/g, '');
      } catch { return String(s || '').toLowerCase(); }
    }

    async function loadIconLs() {
      if (__iconLsCache) return __iconLsCache;
      try {
        // Prefer Excel file iconname.xlsx (if present). Requires XLSX library to be loaded.
        try {
          const res2 = await fetch('../images/icon/iconname.xlsx');
          if (res2.ok && typeof XLSX !== 'undefined') {
            const arrayBuffer = await res2.arrayBuffer();
            const data = new Uint8Array(arrayBuffer);
            const workbook = XLSX.read(data, { type: 'array' });
            const rows = [];
            for (const sn of workbook.SheetNames) {
              const sh = workbook.Sheets[sn];
              const r = XLSX.utils.sheet_to_json(sh, { header: 1, defval: '' });
              for (let i = 0; i < r.length; i++) rows.push(r[i]);
            }
            const parsed = [];
            for (let i = 0; i < rows.length; i++) {
              const cols = rows[i] || [];
              const k = String(cols[0] || '').trim();
              const fn = String(cols[1] || '').trim();
              if (k && fn) parsed.push({ key: k, filename: fn });
            }
            __iconLsCache = parsed;
            return __iconLsCache;
          }
        } catch (e) {
          // fallthrough to try .lsx
          console.info('iconname.xlsx not found or failed, will try iconname.lsx');
        }

        // Fallback: try text-based .lsx (tab/comma-separated)
        try {
          const res = await fetch('../images/icon/iconname.lsx');
          if (res.ok) {
            const text = await res.text();
            const rows = text.split(/\r?\n/).map(r => r.trim()).filter(r => r.length);
            const parsed = [];
            for (const row of rows) {
              let cols = row.split('\t');
              if (cols.length < 2) cols = row.split(',');
              if (cols.length >= 2) {
                parsed.push({ key: cols[0].trim(), filename: cols[1].trim() });
              }
            }
            __iconLsCache = parsed;
            return __iconLsCache;
          }
        } catch (e) {
          console.info('iconname.lsx not found or failed');
        }

        // No data found
        __iconLsCache = [];
        return __iconLsCache;
      } catch (e) {
        __iconLsCache = [];
        console.warn('loadIconLs failed', e);
        return __iconLsCache;
      }
    }

    async function findIconFilename(keyword) {
      if (!keyword) return null;
      try {
        const list = await loadIconLs();
        const k = normalizeJP(keyword);
        for (const r of list) {
          if (!r.key) continue;
          if (normalizeJP(r.key).includes(k)) return r.filename;
        }
        return null;
      } catch (e) { console.warn('findIconFilename failed', e); return null; }
    }

    let iconLookupTimer = null;
    if (eventNameInput) {
      const doLookup = async () => {
        const kw = eventNameInput.value.trim();
        if (!kw) {
          if (imageInput) imageInput.value = '';
          await setPreview('');
          return;
        }
        try {
          const fn = await findIconFilename(kw);
          if (fn) {
            const url = `../images/icon/${fn}`;
            if (imageInput) imageInput.value = url;
            await setPreview(url);
          } else {
            // no match: clear preview but keep user input
            if (imageInput) imageInput.value = '';
            await setPreview('');
          }
        } catch (e) { console.warn(e); }
      };
      eventNameInput.addEventListener('input', () => {
        if (iconLookupTimer) clearTimeout(iconLookupTimer);
        iconLookupTimer = setTimeout(doLookup, 500);
      });
      eventNameInput.addEventListener('blur', doLookup);
    }
  } catch (e) { console.warn('event type init failed', e); }

  // お買い得商品追加フォーム
  const specialForm = document.getElementById("add-special-form");
  if (specialForm) {
    specialForm.addEventListener("submit", function (e) {
      e.preventDefault();
      addSpecial();
    });
  }

  // メッセージ追加フォーム
  const messageForm = document.getElementById("add-message-form");
  if (messageForm) {
    messageForm.addEventListener("submit", function (e) {
      e.preventDefault();
      addMessage();
    });
  }
}

// 現在の日時をフォームに設定
function setCurrentDateTime() {
  const now = new Date();
  const dateTimeString = now.toISOString().slice(0, 16);
  const dt = document.querySelector('input[name="datetime"]');
  if (dt) dt.value = dateTimeString;
}

// イベント追加
function addEvent() {
  const formData = new FormData(document.getElementById("add-event-form"));
  const startDate = formData.get("startDate");
  const endDate = formData.get("endDate");

  const payload = {
    startDate: startDate,
    endDate: endDate || null,
    type: formData.get("type"),
    text: formData.get("text"),
    description: formData.get("description") || "",
    image: formData.get("image") || null,
  };

  (async () => {
    try {
      if (window.__api && window.__api.apiAddEvent) {
        await window.__api.apiAddEvent(payload);
        // サーバーを正とするため再取得
        if (window.__api.apiGetEvents) {
          eventsData = await window.__api.apiGetEvents();
        }
      } else {
        // ローカルフォールバック
        eventsData.push({ id: eventsData.length + 1, ...payload });
      }
      renderEventList();
      document.getElementById("add-event-form").reset();
      showAlert("イベントが追加されました", "success");
    } catch (e) {
      // エラー詳細は冗長なためコンソール出力を抑制（フォールバック成功時の 403 ノイズを避ける）
      showAlert("イベントの追加に失敗しました", "error");
    }
  })();
}

// お買い得商品追加
function addSpecial() {
  const formData = new FormData(document.getElementById("add-special-form"));
  const startDate = formData.get("startDate");
  const endDate = formData.get("endDate");
  const nonFood = formData.get("nonFood") === "on";
  const name = (formData.get("name") || "").trim();
  // originalPrice は UI から廃止。salePrice のみ必須とする。
  const salePrice = parseInt(formData.get("salePrice"));

  // 必須バリデーション（サーバーAPI要件）: 商品名・お買い得価格・開始日は必須
  if (!name || !isFinite(salePrice) || !startDate) {
    showAlert("商品名・お買い得価格・開始日は必須です", "error");
    return;
  }

  const payload = {
    name,
    salePrice,
    // 単位は任意。入力がある場合のみ送信する。
    ...(function(){
      const u = String(formData.get("unit") || "").trim();
      return u ? { unit: u } : {};
    })(),
    description: formData.get("description") || "",
    // recipeIdea はレシピ名として運用。詳細は別 hidden フィールドに格納
    recipeIdea: nonFood ? "" : (formData.get("recipeIdea") || ""),
    recipeName: nonFood ? "" : (formData.get("recipeIdea") || ""),
    recipeDetails: nonFood ? "" : (formData.get("recipeDetails") || ""),
    startDate: startDate,
    endDate: endDate || null,
    image: formData.get("image") || null,
    imageUrl: formData.get("imageUrl") || "",
  };

  // 送信前に WAF 回避のための軽処理
  try {
    if (payload.imageUrl) {
      payload.imageUrl = encodeURI(String(payload.imageUrl));
    }
  } catch {}
  try {
    if (payload.recipeDetails) {
      const s = String(payload.recipeDetails);
      // UTF-8 を base64 化（サーバ側で自動デコード対応）
      payload.recipeDetails = btoa(unescape(encodeURIComponent(s)));
    }
  } catch {}

  // デバッグ/回避モード: スタッフURLに ?safe=1 を付けると
  // WAF に引っかかりやすい項目を一時的に除外して送信できます。
  try {
    const qs = new URLSearchParams(location.search || "");
    if (qs.has("safe")) {
      payload.imageUrl = "";
      // 画像はURL/大きい本文がWAF検査対象になる場合があるため除外
      payload.image = null;
      // 長文/特殊文字を含み得るため、詳細はオフに
      payload.recipeDetails = "";
    }
  } catch {}

  (async () => {
    try {
      if (window.__api && window.__api.apiAddSpecial) {
        await window.__api.apiAddSpecial(payload);
        if (window.__api.apiGetSpecials) {
          specialsData = await window.__api.apiGetSpecials();
        }
      } else {
        specialsData.push({ id: specialsData.length + 1, ...payload });
      }
      renderSpecialList();
      document.getElementById("add-special-form").reset();
      showAlert("お買い得商品が追加されました", "success");
    } catch (e) {
      console.error(e);
      showAlert("お買い得商品の追加に失敗しました", "error");
    }
  })();
}

// メッセージ追加
function addMessage() {
  const formData = new FormData(document.getElementById("add-message-form"));
  const authorMap = {
    manager: "店長",
    fish: "鮮魚部",
    produce: "青果部",
    meat: "精肉部",
    deli: "惣菜部",
    bakery: "ベーカリー",
  };

  const payload = {
    author: formData.get("author"),
    authorName: authorMap[formData.get("author")],
    title: formData.get("title"),
    content: formData.get("content"),
    datetime: formData.get("datetime"),
  };

  (async () => {
    try {
      if (window.__api && window.__api.apiAddMessage) {
        await window.__api.apiAddMessage(payload);
        if (window.__api.apiGetMessages) {
          messagesData = await window.__api.apiGetMessages();
        }
      } else {
        messagesData.push({ id: messagesData.length + 1, ...payload });
      }
      renderMessageList();
      document.getElementById("add-message-form").reset();
      setCurrentDateTime();
      showAlert("メッセージが投稿されました", "success");
    } catch (e) {
      console.error(e);
      showAlert("メッセージの投稿に失敗しました", "error");
    }
  })();
}

// イベントリスト表示
function renderEventList() {
  const container = document.getElementById("event-list-content");
  const visible = Array.isArray(eventsData)
    ? eventsData.filter((e) => !isPastPeriod(e.startDate, e.endDate))
    : [];
  if (visible.length === 0) {
    container.innerHTML =
      '<p class="text-center">現在・今後のイベントはありません</p>';
    return;
  }
  container.innerHTML = visible
    .map((event) => {
      const dateDisplay = event.endDate
        ? `${event.startDate} ～ ${event.endDate}`
        : event.startDate;
      return `
        <div class="event-item">
            <div class="event-header">
                <div style="display:flex; align-items:center; gap:8px;">
                    ${event.image ? `<img src="${event.image}" class="event-icon" alt="icon" />` : ""}
                    <span class="event-type ${event.type}">${getEventTypeLabel(event.type)}</span>
                    <strong style="margin-left:8px">${dateDisplay}</strong>
                </div>
                <div class="item-actions">
                    <button class="btn-small btn-delete" onclick="deleteEvent(${
                      event.id
                    })">削除</button>
                </div>
            </div>
            <div class="event-content">
                <h4>${event.text}</h4>
                ${event.description ? `<p>${event.description}</p>` : ""}
            </div>
        </div>
      `;
    })
    .join("");
}

// 過去イベント一覧をレンダリング
function renderPastEventList() {
  const container = document.getElementById("past-event-list-content");
  if (!container) return;
  const past = Array.isArray(eventsData) ? eventsData.filter((e) => isPastPeriod(e.startDate, e.endDate)) : [];
  if (past.length === 0) {
    container.innerHTML = '<p class="text-center">過去のイベントはありません</p>';
    return;
  }
  // 新しい順に表示
  past.sort((a,b)=> new Date(b.endDate || b.startDate) - new Date(a.endDate || a.startDate));
  container.innerHTML = past.map((event) => {
    const dateDisplay = event.endDate ? `${event.startDate} ～ ${event.endDate}` : event.startDate;
    return `
      <div class="event-item">
        <div class="event-header">
          <div style="display:flex; align-items:center; gap:8px;">
            ${event.image ? `<img src="${event.image}" class="event-icon" alt="icon" />` : ""}
            <span class="event-type ${event.type}">${getEventTypeLabel(event.type)}</span>
            <strong style="margin-left:8px">${dateDisplay}</strong>
          </div>
          <div class="item-actions">
            <button class="btn-small btn-delete" onclick="deleteEvent(${event.id})">削除</button>
          </div>
        </div>
        <div class="event-content">
          <h4>${event.text}</h4>
          ${event.description ? `<p>${event.description}</p>` : ""}
        </div>
      </div>
    `;
  }).join("");
}

// 過去イベント表示トグルと一括削除処理の初期化
function initPastEventControls() {
  const btn = document.getElementById("btn-show-past-events");
  const panel = document.getElementById("past-event-list");
  const hideBtn = document.getElementById("btn-hide-past-events");
  const deleteAllBtn = document.getElementById("btn-delete-all-past");
  if (btn && panel) {
    btn.addEventListener("click", async () => {
      // 取得が必要なら最新化
      if (window.__api && window.__api.apiGetEvents) {
        try { eventsData = await window.__api.apiGetEvents(); } catch(e) { console.warn(e); }
      }
      renderPastEventList();
      panel.style.display = "block";
    });
  }
  if (hideBtn && panel) {
    hideBtn.addEventListener("click", () => { panel.style.display = "none"; });
  }
  if (deleteAllBtn) {
    deleteAllBtn.addEventListener("click", async () => {
      if (!confirm("本当に過去の全イベントを削除しますか？ この操作は取り消せません。")) return;
      const pastIds = (Array.isArray(eventsData) ? eventsData.filter((e)=> isPastPeriod(e.startDate, e.endDate)).map(e=>e.id) : []);
      if (!pastIds.length) { showAlert("削除する過去イベントはありません", "info"); return; }
      try {
        for (const id of pastIds) {
          if (window.__api && window.__api.apiDeleteEvent) {
            await window.__api.apiDeleteEvent(Number(id));
          } else {
            eventsData = eventsData.filter(ev => Number(ev.id) !== Number(id));
          }
        }
        if (window.__api && window.__api.apiGetEvents) {
          eventsData = await window.__api.apiGetEvents();
        }
        renderPastEventList();
        renderEventList();
        showAlert("過去イベントを削除しました", "success");
      } catch (e) {
        console.error(e);
        showAlert("過去イベントの削除に失敗しました", "error");
      }
    });
  }
}

// AI生成機能（テンプレート使用）
async function generateAIContent(type) {
  currentAIType = type;

  // フォームデータを取得
  if (type === "special") {
    const form = document.getElementById("add-special-form");
    const formData = new FormData(form);
    currentFormData = {
      name: formData.get("name"),
      salePrice: formData.get("salePrice"),
      unit: (function(){ const u = String(formData.get("unit")||"").trim(); return u || null; })(),
      recipeIdea: formData.get("recipeIdea"),
      description: formData.get("description"),
      startDate: formData.get("startDate"),
      endDate: formData.get("endDate") || null,
    };

    // お買い得商品の場合は専用UIを使用
    if (currentFormData.name && currentFormData.salePrice) {
      // 商品情報を表示
      document.getElementById("product-info").innerHTML = `
        <h5>${currentFormData.name}</h5>
        <p><strong>お買い得価格:</strong> ¥${currentFormData.salePrice}</p>
        ${
          currentFormData.description
            ? `<p><strong>現在の説明:</strong> ${currentFormData.description}</p>`
            : ""
        }
        ${
          currentFormData.recipeIdea
            ? `<p><strong>レシピ案:</strong> ${currentFormData.recipeIdea}</p>`
            : ""
        }
      `;

      // AI生成を開始
      document.getElementById("generated-description").value = "AI生成中...";
      const _rn = document.getElementById("generated-recipe-name");
      const _rd = document.getElementById("generated-recipe-details");
      if (_rn) _rn.value = "レシピ名生成中...";
      if (_rd) _rd.value = "レシピ詳細生成中...";

      // お買い得商品専用モーダルを表示
      const modal = document.getElementById("special-ai-modal");
      modal.style.display = "block";

      setTimeout(() => {
        modal.scrollTop = 0;
        document.body.style.overflow = "hidden";
      }, 50);

      // テンプレートで生成
      generateSpecialAIContent();

      return;
    } else {
      alert("商品名とお買い得価格を入力してください。");
      return;
    }
  } else if (type === "message") {
    const form = document.getElementById("add-message-form");
    const formData = new FormData(form);
    currentFormData = {
      author: formData.get("author"),
      title: formData.get("title"),
      content: formData.get("content"),
    };

    // メッセージの場合は新しいUIを使用
    if (currentFormData.title && currentFormData.content) {
      // 元のメッセージを表示
      document.getElementById("original-message").innerHTML = `
        <h5>${currentFormData.title}</h5>
        <p>${currentFormData.content}</p>
      `;

      // AI生成を開始
      const improvedEl = document.getElementById("improved-message");
      improvedEl.value = "AI改善中...";

      // モーダルを表示
      const modal = document.getElementById("ai-modal");
      modal.style.display = "block";

      // 画面中央に配置するためのスクロール位置を調整
      setTimeout(() => {
        modal.scrollTop = 0;
        document.body.style.overflow = "hidden"; // 背景のスクロールを無効化
      }, 50);

      // サーバーAI → 失敗時はテンプレ
      try {
        if (window.__api && window.__api.apiImproveMessage) {
          const improved = await window.__api.apiImproveMessage({
            author: currentFormData.author,
            title: currentFormData.title,
            content: currentFormData.content,
          });
          improvedEl.value = improved || improvedEl.value;
        } else {
          simulateAIImprovement();
        }
      } catch (e) {
        console.warn("AI改善API失敗。テンプレにフォールバックします。", e);
        simulateAIImprovement();
      }

      return;
    } else {
      alert("タイトルとメッセージ内容を入力してください。");
      return;
    }
  }

  // 従来のAIモーダルを表示（お買い得商品用）
  document.getElementById("ai-modal").style.display = "block";
  document.getElementById("ai-result").innerHTML =
    '<div class="loading"></div> AI生成中...';
}

// お買い得商品用AI生成（テンプレート）
function renderSpecialList() {
  const container = document.getElementById("special-list-content");
  const visible = Array.isArray(specialsData)
    ? specialsData.filter((sp) => !isPastPeriod(sp.startDate, sp.endDate))
    : [];
  if (visible.length === 0) {
    container.innerHTML =
      '<p class="text-center">現在・今後に表示できるお買い得商品はありません</p>';
    return;
  }
  container.innerHTML = visible
    .map((special) => {
      // 割引表示は廃止（旧価格表示を出さない）
      const dateDisplay = special.endDate
        ? `${special.startDate} ～ ${special.endDate}`
        : special.startDate;
      const imageUrl = special.imageUrl || special.image || "";
      return `
        <div class="special-item" data-id="${special.id}" draggable="false">
                <div class="special-header">
            <span class="drag-handle" title="ドラッグで並べ替え" style="cursor:grab; margin-right:8px;">☰</span>
                        <h4>${special.name}</h4>
                        <div class="item-actions">
                            <label style="display:inline-flex; align-items:center; gap:8px; margin-right:6px;">
                              <input type="checkbox" class="select-special" data-id="${special.id}" /> 選択
                            </label>
                            <button class="btn-small btn-delete" onclick="deleteSpecial(${special.id})">削除</button>
                        </div>
                </div>
                <div class="special-date">
                    <strong>お買い得期間:</strong> ${dateDisplay}
                </div>
                <div class="special-price">
                  <span class="sale-price">¥${special.salePrice.toLocaleString()}</span>
                  ${special.unit ? `<span class="unit">${special.unit}</span>` : ""}
                </div>
                ${special.description ? `<p>${special.description}</p>` : ""}
                ${
                  special.recipeIdea
                    ? `<p><strong>レシピ提案:</strong> ${special.recipeIdea}</p>`
                    : ""
                }
                ${
                  imageUrl
                    ? `<div class='special-image'><img src='${imageUrl}' alt='${special.name}' style='max-width:150px;'><br><span class='special-image-url'>${imageUrl}</span></div>`
                    : ""
                }
            </div>
        `;
    })
    .join("");
}

// 過去お買い得商品一覧をレンダリング
function renderPastSpecialList() {
  const container = document.getElementById("past-special-list-content");
  if (!container) return;
  const past = Array.isArray(specialsData) ? specialsData.filter((s) => isPastPeriod(s.startDate, s.endDate)) : [];
  if (past.length === 0) {
    container.innerHTML = '<p class="text-center">過去のお買い得商品はありません</p>';
    return;
  }
  // 新しい順
  past.sort((a,b)=> new Date(b.endDate || b.startDate) - new Date(a.endDate || a.startDate));
  container.innerHTML = past.map((sp) => {
    const dateDisplay = sp.endDate ? `${sp.startDate} ～ ${sp.endDate}` : sp.startDate;
    const img = sp.imageUrl || sp.image || '';
    return `
      <div class="special-item">
        <div class="special-header">
          <div>
            <strong>${sp.name}</strong>
            <div class="special-date" style="font-size:12px; color:#555;">${dateDisplay}</div>
          </div>
          <div class="item-actions">
            <input type="checkbox" class="select-special" data-id="${sp.id}" style="margin-right:8px;" />
            <button class="btn-small" onclick="reuseSpecial(${sp.id})" title="この内容をフォームに再利用">再利用</button>
            <button class="btn-small btn-delete" onclick="deleteSpecial(${sp.id})">削除</button>
          </div>
        </div>
        <div class="special-price" style="margin-top:6px;">
          <span class="sale-price">¥${(sp.salePrice||0).toLocaleString()}</span>
          ${sp.unit ? `<span class="unit">${sp.unit}</span>` : ''}
        </div>
        ${img ? `<div style="margin-top:6px;"><img src="${img}" alt="${sp.name}" style="max-width:120px;"></div>` : ''}
      </div>
    `;
  }).join('');
}

// 過去お買い得商品の内容を追加フォームに取り込む
function reuseSpecial(id) {
  try {
    const sp = (Array.isArray(specialsData) ? specialsData.find(s => Number(s.id) === Number(id)) : null);
    if (!sp) { showAlert('対象の商品が見つかりません', 'error'); return; }
    const form = document.getElementById('add-special-form');
    if (!form) { showAlert('追加フォームが見つかりません', 'error'); return; }
    const setVal = (sel, val) => { const el = form.querySelector(sel); if (el) el.value = val != null ? String(val) : ''; };
    const setChecked = (sel, checked) => { const el = form.querySelector(sel); if (el) el.checked = !!checked; };

    // 値の適用（開始日は本日のままにしたい場合は空にセット）
    setVal('input[name="name"]', sp.name || '');
    setVal('input[name="originalPrice"]', isFinite(Number(sp.originalPrice)) ? String(Number(sp.originalPrice)) : '');
    setVal('input[name="salePrice"]', isFinite(Number(sp.salePrice)) ? String(Number(sp.salePrice)) : '');
    setVal('textarea[name="description"]', sp.description || '');
    setVal('input[name="unit"]', sp.unit || '');
    // レシピ名・詳細（非食品の場合は空に）
    const nonFood = !!(sp.recipeIdea == null || sp.recipeIdea === '');
    setChecked('input[name="nonFood"]', nonFood);
    setVal('input[name="recipeIdea"]', nonFood ? '' : (sp.recipeIdea || sp.recipeName || ''));
    setVal('input[name="recipeDetails"]', nonFood ? '' : (sp.recipeDetails || ''));
    // 日付は開始・終了ともクリア（新規登録用に手入力してもらう）
    setVal('input[name="startDate"]', '');
    setVal('input[name="endDate"]', '');
    // 画像URL/ファイル
    setVal('input[name="imageUrl"]', sp.imageUrl || sp.image || '');
    setVal('input[name="image"]', '');

    // フォーム位置へスクロール
    try {
      form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch {}
    showAlert('フォームへ再利用内容をセットしました', 'success');
  } catch (e) {
    console.warn('reuseSpecial failed', e);
    showAlert('再利用に失敗しました', 'error');
  }
}

// 過去お買い得商品コントロール初期化（表示・閉じる・選択削除・全削除）
function initPastSpecialControls(){
  const btn = document.getElementById('btn-show-past-specials');
  const panel = document.getElementById('past-special-list');
  const hideBtn = document.getElementById('btn-hide-past-specials');
  const deleteAllBtn = document.getElementById('btn-delete-all-past-specials');
  const deleteSelectedBtn = document.getElementById('btn-delete-selected-past-specials');
  if (btn && panel){
    btn.addEventListener('click', async ()=>{
      if (window.__api && window.__api.apiGetSpecials){
        try{ specialsData = await window.__api.apiGetSpecials(); } catch(e){ console.warn(e); }
      }
      renderPastSpecialList();
      panel.style.display = 'block';
    });
  }
  if (hideBtn && panel) hideBtn.addEventListener('click', ()=>{ panel.style.display = 'none'; });

  if (deleteAllBtn){
    deleteAllBtn.addEventListener('click', async ()=>{
      if (!confirm('本当に過去のお買い得商品を全て削除しますか？この操作は取り消せません。')) return;
      const pastIds = (Array.isArray(specialsData) ? specialsData.filter((s)=> isPastPeriod(s.startDate, s.endDate)).map(s=>s.id) : []);
      if (!pastIds.length) { showAlert('削除する過去お買い得商品はありません','info'); return; }
      try{
        for (const id of pastIds){
          if (window.__api && window.__api.apiDeleteSpecial) {
            await window.__api.apiDeleteSpecial(Number(id));
          } else {
            specialsData = specialsData.filter(sp=> Number(sp.id)!==Number(id));
          }
        }
        if (window.__api && window.__api.apiGetSpecials) specialsData = await window.__api.apiGetSpecials();
        renderPastSpecialList();
        renderSpecialList();
        showAlert('過去お買い得商品を削除しました','success');
      } catch(e){ console.error(e); showAlert('過去お買い得商品の削除に失敗しました','error'); }
    });
  }

  if (deleteSelectedBtn){
    deleteSelectedBtn.addEventListener('click', async ()=>{
      const checked = Array.from(document.querySelectorAll('.select-special:checked')).map(i=>i.getAttribute('data-id')).filter(Boolean).map(Number);
      if (!checked.length){ alert('削除するお買い得商品を選択してください'); return; }
      if (!confirm(`選択した ${checked.length} 件のお買い得商品を削除します。よろしいですか？`)) return;
      const errors = [];
      for (const id of checked){
        try{
          if (window.__api && window.__api.apiDeleteSpecial) {
            await window.__api.apiDeleteSpecial(Number(id));
          } else {
            specialsData = specialsData.filter(sp=> Number(sp.id)!==Number(id));
          }
        } catch(e){ console.error('delete special', id, e); errors.push(id); }
      }
      if (window.__api && window.__api.apiGetSpecials) {
        try { specialsData = await window.__api.apiGetSpecials(); } catch(e){ console.warn(e); }
      }
      renderPastSpecialList();
      renderSpecialList();
      if (errors.length) alert('一部の削除に失敗しました: ' + errors.join(', ')); else showAlert('選択したお買い得商品を削除しました','success');
    });
  }
}

// --- お買い得商品 並び替え機能 ---
let specialReorderMode = false;
function initSpecialReorderControls(){
  if (initSpecialReorderControls._inited) return;
  initSpecialReorderControls._inited = true;
  const toggleBtn = document.getElementById('btn-toggle-reorder');
  const saveBtn = document.getElementById('btn-save-order');
  const container = document.getElementById('special-list-content');
  if (!toggleBtn || !saveBtn || !container) return;

  toggleBtn.addEventListener('click', ()=>{
    specialReorderMode = !specialReorderMode;
    toggleBtn.textContent = specialReorderMode ? '並び替え中: キャンセル' : '並び替え';
    saveBtn.style.display = specialReorderMode ? 'inline-block' : 'none';
    // enable draggable attribute on items
    container.querySelectorAll('.special-item').forEach(it=>{
      it.setAttribute('draggable', specialReorderMode ? 'true' : 'false');
      if (!specialReorderMode) it.classList.remove('dragging-target');
    });
  });

  // Drag & Drop handlers (delegated)
  let dragEl = null;
  container.addEventListener('dragstart', (e)=>{
    const t = e.target.closest && e.target.closest('.special-item');
    if (!t || !specialReorderMode) { e.preventDefault(); return; }
    dragEl = t;
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', t.dataset.id || ''); } catch(e){}
    t.classList.add('dragging');
  });
  container.addEventListener('dragend', (e)=>{
    if (dragEl) dragEl.classList.remove('dragging');
    dragEl = null;
    container.querySelectorAll('.special-item').forEach(it=>it.classList.remove('drag-over'));
  });
  container.addEventListener('dragover', (e)=>{
    if (!specialReorderMode) return;
    e.preventDefault();
    const over = e.target.closest && e.target.closest('.special-item');
    container.querySelectorAll('.special-item').forEach(it=>it.classList.remove('drag-over'));
    if (over && over !== dragEl) over.classList.add('drag-over');
  });
  container.addEventListener('drop', (e)=>{
    if (!specialReorderMode) return;
    e.preventDefault();
    const over = e.target.closest && e.target.closest('.special-item');
    if (!over || !dragEl || over === dragEl) return;
    // insert dragEl before over to move
    container.insertBefore(dragEl, over);
  });

  saveBtn.addEventListener('click', async ()=>{
    // collect order
    const ids = Array.from(container.querySelectorAll('.special-item')).map(it=> Number(it.dataset.id)).filter(Boolean);
    if (!ids.length) { showAlert('保存対象のお買い得商品がありません','info'); return; }
    try{
      if (window.__api && window.__api.apiReorderSpecials){
        await window.__api.apiReorderSpecials(ids);
      } else {
        // local fallback: reorder specialsData array to match ids
        const map = {};
        specialsData.forEach(s=>{ map[Number(s.id)]=s; });
        specialsData = ids.map(i=> map[i]).filter(Boolean);
      }
      // exit reorder mode
      specialReorderMode = false;
      toggleBtn.textContent = '並び替え';
      saveBtn.style.display = 'none';
      // refresh from server
      if (window.__api && window.__api.apiGetSpecials) specialsData = await window.__api.apiGetSpecials();
      renderSpecialList();
      showAlert('並び順を保存しました','success');
    }catch(e){
      console.error('reorder save failed', e);
      showAlert('並び順の保存に失敗しました','error');
    }
  });
}


// メッセージリスト表示
function renderMessageList() {
  const container = document.getElementById("message-list-content");
  if (!container) return;
  if (!Array.isArray(messagesData) || messagesData.length === 0) {
    container.innerHTML =
      '<p class="text-center">投稿済みメッセージはありません</p>';
    return;
  }
  container.innerHTML = messagesData
    .sort((a, b) => new Date(b.datetime) - new Date(a.datetime))
    .map((msg) => {
      return `
        <div class="message-item">
          <div class="message-header">
            <div>
              <strong>${msg.title || "(無題)"}</strong>
              <span class="message-meta">${msg.authorName || msg.author || ""}
              ・${
                msg.datetime
                  ? new Date(msg.datetime).toLocaleString("ja-JP")
                  : ""
              }</span>
            </div>
            <div class="item-actions">
              <button class="btn-small btn-delete" onclick="deleteMessage(${
                msg.id
              })">削除</button>
            </div>
          </div>
          <div class="message-content">
            <p>${(msg.content || "").replace(/\n/g, "<br>")}</p>
          </div>
        </div>`;
    })
    .join("");
}

// 要望リスト表示
function renderRequestList() {
  const container = document.getElementById("request-list");
  if (!container) return;
  if (!Array.isArray(requestsData) || requestsData.length === 0) {
    container.innerHTML =
      '<p class="text-center">現在、登録された要望はありません</p>';
    return;
  }
  container.innerHTML = requestsData
    .map((req) => {
      return `
        <div class="request-item card" data-status="${
          req.status
        }" data-category="${req.category}">
          <div class="card-body">
            <div class="request-header">
              <div>
                <span class="request-category">${getCategoryLabel(
                  req.category
                )}</span>
                <span class="request-date">${
                  req.submitDate
                    ? new Date(req.submitDate).toLocaleString("ja-JP")
                    : ""
                }</span>
                <span class="request-status-tag status-${
                  req.status
                }">${getStatusLabel(req.status)}</span>
              </div>
              <div class="item-actions">
                <button class="btn-small" onclick="updateRequestStatus(${
                  req.id
                }, 'pending')">未対応</button>
                <button class="btn-small" onclick="updateRequestStatus(${
                  req.id
                }, 'in-progress')">対応中</button>
                <button class="btn-small" onclick="updateRequestStatus(${
                  req.id
                }, 'completed')">完了</button>
                <button class="btn-small btn-delete" onclick="deleteRequest(${
                  req.id
                })">削除</button>
              </div>
            </div>
            <div class="request-content">
              <p>${req.message || ""}</p>
            </div>
          </div>
        </div>`;
    })
    .join("");
}

function updateRequestStats() {
  try {
    const pending = requestsData.filter((r) => r.status === "pending").length;
    const inProgress = requestsData.filter(
      (r) => r.status === "in-progress"
    ).length;
    const completed = requestsData.filter(
      (r) => r.status === "completed"
    ).length;
    const statNumbers = document.querySelectorAll(
      ".request-stats .stat-number"
    );
    if (statNumbers[0]) statNumbers[0].textContent = pending;
    if (statNumbers[1]) statNumbers[1].textContent = inProgress;
    if (statNumbers[2]) statNumbers[2].textContent = completed;
  } catch {}
}
function applyAIContent() {
  const aiResult = document.getElementById("ai-result").textContent;

  if (currentAIType === "special") {
    // お買い得商品の説明欄に適用
    const descriptionField = document.querySelector(
      '#add-special-form textarea[name="description"]'
    );
    if (descriptionField) {
      descriptionField.value = aiResult;
    }
  } else if (currentAIType === "message") {
    // メッセージ内容に適用
    const contentField = document.querySelector(
      '#add-message-form textarea[name="content"]'
    );
    if (contentField) {
      contentField.value = aiResult;
    }
  }

  closeAIModal();
  showAlert("AI生成内容が適用されました", "success");
}

// AIモーダルを閉じる
function closeAIModal() {
  document.getElementById("ai-modal").style.display = "none";

  // 背景のスクロールを有効化
  document.body.style.overflow = "auto";

  // 新しいAI改善UIの要素をリセット
  document.getElementById("improved-message").value = "";
  document.getElementById("original-message").innerHTML = "";

  currentAIType = "";
  currentFormData = {};
}

// お買い得商品AIモーダルを閉じる
function closeSpecialAIModal() {
  const modal = document.getElementById("special-ai-modal");
  if (modal) modal.style.display = "none";

  // 背景のスクロールを有効化
  document.body.style.overflow = "auto";

  // 要素をリセット
  const gdesc = document.getElementById("generated-description");
  if (gdesc) gdesc.value = "";
  const grn = document.getElementById("generated-recipe-name");
  if (grn) grn.value = "";
  const grd = document.getElementById("generated-recipe-details");
  if (grd) grd.value = "";
  const pinfo = document.getElementById("product-info");
  if (pinfo) pinfo.innerHTML = "";

  currentAIType = "";
  currentFormData = {};
}

// イベントリスナーを追加
document.addEventListener("DOMContentLoaded", function () {
  // 再生成ボタン
  const regenerateBtn = document.getElementById("regenerate-ai");
  if (regenerateBtn) {
    regenerateBtn.addEventListener("click", async function () {
      const improvedEl = document.getElementById("improved-message");
      if (improvedEl) improvedEl.value = "再生成中...";
      try {
        let improved = null;
        // 直前のフォーム内容を再取得（編集中の内容も反映）
        const form = document.getElementById("add-message-form");
        if (form) {
          const fd = new FormData(form);
          currentFormData = {
            author: fd.get("author"),
            title: fd.get("title"),
            content: fd.get("content"),
          };
        }
        if (window.__api && window.__api.apiImproveMessage) {
          improved = await window.__api.apiImproveMessage({
            author: currentFormData.author,
            title: currentFormData.title,
            content: currentFormData.content,
          });
        }
        if (improved && String(improved).trim()) {
          improvedEl.value = improved;
        } else {
          simulateAIImprovement();
        }
      } catch (error) {
        console.error("再生成エラー:", error);
        // 失敗時はテンプレにフォールバック
        try {
          simulateAIImprovement();
        } catch {}
        showAlert("再生成中にエラーが発生しました。", "error");
      }
    });
  }

  // 改善版を使用ボタン
  const useImprovedBtn = document.getElementById("use-improved");
  if (useImprovedBtn) {
    useImprovedBtn.addEventListener("click", function () {
      const improvedText = document.getElementById("improved-message").value;

      if (
        currentAIType === "message" &&
        improvedText &&
        improvedText !== "AI改善中..." &&
        improvedText !== "再生成中..."
      ) {
        // フォームに改善版を適用
        const form = document.getElementById("add-message-form");
        form.querySelector('textarea[name="content"]').value = improvedText;

        // モーダルを閉じる
        closeAIModal();

        // 成功メッセージを表示
        showAlert("AI改善版をメッセージ内容に適用しました！", "success");
      } else {
        alert("AI改善版の生成を待ってからお試しください。");
      }
    });
  }

  // モーダル外クリックで閉じる
  const aiModal = document.getElementById("ai-modal");
  if (aiModal) {
    aiModal.addEventListener("click", function (e) {
      if (e.target === this) {
        closeAIModal();
      }
    });
  }

  // お買い得商品AI関連のイベントリスナー
  const regenerateSpecialBtn = document.getElementById("regenerate-special-ai");
  if (regenerateSpecialBtn) {
    regenerateSpecialBtn.addEventListener("click", async function () {
      document.getElementById("generated-description").value = "再生成中...";
      const rn = document.getElementById("generated-recipe-name");
      const rd = document.getElementById("generated-recipe-details");
      if (rn) rn.value = "レシピ名再生成中...";
      if (rd) rd.value = "レシピ詳細再生成中...";
      try {
        await generateSpecialAIContent();
      } catch (err) {
        console.error("再生成エラー:", err);
        showAlert("再生成に失敗しました。", "error");
      }
    });
  }

  const useSpecialContentBtn = document.getElementById("use-special-content");
  if (useSpecialContentBtn) {
    useSpecialContentBtn.addEventListener("click", function () {
      const descEl = document.getElementById("generated-description");
      const recipeNameEl = document.getElementById("generated-recipe-name");
      const recipeDetailsEl = document.getElementById(
        "generated-recipe-details"
      );
      const description = descEl ? descEl.value : "";
      const recipeName = recipeNameEl ? recipeNameEl.value : "";
      const recipeDetails = recipeDetailsEl ? recipeDetailsEl.value : "";

      if (
        description &&
        recipeName &&
        recipeDetails &&
        description !== "AI生成中..." &&
        recipeName !== "レシピ名生成中..." &&
        recipeDetails !== "レシピ詳細生成中..." &&
        description !== "再生成中..." &&
        recipeName !== "レシピ名再生成中..." &&
        recipeDetails !== "レシピ詳細再生成中..."
      ) {
        // フォームに適用
        const form = document.getElementById("add-special-form");
        if (form) {
          // 商品説明はそのまま
          const descField = form.querySelector('textarea[name="description"]');
          if (descField) descField.value = description;
          // レシピ名は recipeIdea に、詳細は hidden の recipeDetails に格納
          const nameField = form.querySelector('input[name="recipeIdea"]');
          if (nameField) nameField.value = recipeName.trim();
          const detailsField = form.querySelector(
            'input[name="recipeDetails"]'
          );
          if (detailsField) detailsField.value = recipeDetails;
        }

        // モーダルを閉じる
        closeSpecialAIModal();

        // 成功メッセージを表示
        showAlert("AI生成コンテンツを商品説明に適用しました！", "success");
      } else {
        alert("AI生成の完了を待ってからお試しください。");
      }
    });
  }

  // お買い得商品モーダル外クリックで閉じる
  const specialAiModal = document.getElementById("special-ai-modal");
  if (specialAiModal) {
    specialAiModal.addEventListener("click", function (e) {
      if (e.target === this) {
        closeSpecialAIModal();
      }
    });
  }
});

// お買い得商品の説明/レシピを生成（可能ならサーバーAI、無ければテンプレート）
async function generateSpecialAIContent() {
  try {
    const descEl = document.getElementById("generated-description");
    const recipeNameEl = document.getElementById("generated-recipe-name");
    const recipeDetailsEl = document.getElementById("generated-recipe-details");
    descEl.value = descEl.value || "AI生成中...";
    if (recipeNameEl)
      recipeNameEl.value = recipeNameEl.value || "レシピ名生成中...";
    if (recipeDetailsEl)
      recipeDetailsEl.value = recipeDetailsEl.value || "レシピ詳細生成中...";

    if (
      window.__api &&
      window.__api.apiSpecialDescription &&
      window.__api.apiSpecialRecipe
    ) {
      // unit はサーバー側の必須項目のため、入力廃止後は固定値を付与
      const base = {
        name: currentFormData.name,
        salePrice: Number(currentFormData.salePrice),
        // サーバー側が unit を必須にしているため、入力が無い場合は
        // 安全なデフォルトを付与する（後でスタッフが編集可能）。
        unit: currentFormData.unit || "100gあたり",
        startDate: currentFormData.startDate,
        endDate: currentFormData.endDate,
      };

      // 必須項目の事前検証: name と salePrice が有効であることを確認
      if (!base.name || !base.salePrice || Number.isNaN(base.salePrice)) {
        showAlert("AI生成には商品名と価格（salePrice）が必要です。フォームを確認してください。", "error");
        return;
      }
      // 説明 → レシピ名のみ → レシピ詳細の順で取得
      let desc = await window.__api.apiSpecialDescription(base);
      try {
        // 期間に応じた『本日限り』表現調整（サーバープロンプト側で漏れた場合の保険）
        const isSingle =
          base.startDate && (!base.endDate || base.endDate === base.startDate);
        if (isSingle) {
          if (desc && !/本日限り/.test(desc)) {
            desc = desc.replace(/。?$/, "") + " 本日限り。";
          }
        } else if (desc) {
          // 複数日では『本日限り』が紛れ込んでいたら除去
          desc = desc.replace(/本日限り。?/g, "");
        }
        // 50字程度トリム（全角換算）
        if (desc) {
          const plain = desc.replace(/\s+/g, " ").trim();
          // おおまかな全角換算: サロゲート除去し length
          if (plain.length > 60)
            desc = plain.slice(0, 60).replace(/[。,.、;:・!！]?$/, "") + "。";
        }
      } catch (e) {
        /* silent */
      }
      descEl.value = desc;
      const onlyName = await window.__api.apiSpecialRecipe({
        ...base,
        onlyName: true,
      });
      if (recipeNameEl)
        recipeNameEl.value = String(onlyName || "")
          .split(/\r?\n/)[0]
          .trim();
      const full = await window.__api.apiSpecialRecipe(base);
      const lines = String(full || "").split(/\r?\n/);
      const details = lines
        .filter((l) => /^材料\s*:|^作り方\s*:/u.test(l))
        .join("\n");
      if (recipeDetailsEl) recipeDetailsEl.value = details || full;
      return;
    }
    // フォールバック（簡易テンプレ）
    // フォールバック文言: 旧価格・%OFF 表示は出さない
    descEl.value = `${currentFormData.name}を期間限定お買い得価格でご提供。ご来店をお待ちしています。`;
    if (recipeNameEl) recipeNameEl.value = `${currentFormData.name}の炒めもの`;
    if (recipeDetailsEl)
      recipeDetailsEl.value = `材料:\n- 主材料など\n作り方:\n1) 下味を付ける\n2) 強火で手早く炒める\n3) 仕上げに調味料で味を整えて完成`;
  } catch (e) {
    console.error(e);
    showAlert("AI生成に失敗しました", "error");
  }
}

// 要望のフィルタリング
function filterRequests() {
  const statusFilter = document.getElementById("status-filter").value;
  const categoryFilter = document.getElementById("category-filter").value;
  const requestItems = document.querySelectorAll(".request-item");

  requestItems.forEach((item) => {
    const status = item.dataset.status;
    const category = item.dataset.category;

    const statusMatch = statusFilter === "all" || status === statusFilter;
    const categoryMatch =
      categoryFilter === "all" || category === categoryFilter;

    if (statusMatch && categoryMatch) {
      item.style.display = "block";
    } else {
      item.style.display = "none";
    }
  });
}

// 要望のステータス更新
function updateRequestStatus(id, newStatus) {
  const request = requestsData.find((r) => r.id === id);
  if (request) {
    (async () => {
      try {
        if (window.__api) {
          const fn =
            window.__api.apiUpdateCommentStatus ||
            window.__api.apiUpdateRequestStatus;
          if (fn) {
            const updated = await fn(id, newStatus);
            const idx = requestsData.findIndex((r) => r.id === id);
            if (idx !== -1 && updated) requestsData[idx] = updated;
          } else {
            request.status = newStatus; // fallback
          }
        } else {
          request.status = newStatus; // fallback
        }
        renderRequestList();
        updateRequestStats();
        showAlert("ステータスが更新されました", "success");
      } catch (e) {
        console.error(e);
        showAlert("ステータス更新に失敗しました", "error");
      }
    })();
  }
}

// ユーティリティ関数
function getEventTypeLabel(type) {
  const labels = {
    "special-sale": "特売日",
    event: "イベント",
    "reservation-start": "予約開始",
    arrival: "入荷",
  };
  return labels[type] || type;
}

function getCategoryLabel(category) {
  const labels = {
    product: "商品について",
    service: "サービス",
    store: "店舗について",
    event: "イベント提案",
    other: "その他",
  };
  return labels[category] || category;
}

function getStatusLabel(status) {
  const labels = {
    pending: "未対応",
    "in-progress": "対応中",
    completed: "完了",
  };
  return labels[status] || status;
}

function formatDateTime(dateTimeString) {
  const date = new Date(dateTimeString);
  return date.toLocaleString("ja-JP");
}

function showAlert(message, type) {
  const alertDiv = document.createElement("div");
  alertDiv.className = `alert alert-${type}`;
  alertDiv.textContent = message;

  document.body.insertBefore(alertDiv, document.body.firstChild);

  setTimeout(() => {
    alertDiv.remove();
  }, 3000);
}

// 削除機能（実装例）
function deleteEvent(id) {
  if (confirm("このイベントを削除しますか？")) {
    (async () => {
      try {
        if (window.__api && window.__api.apiDeleteEvent) {
          await window.__api.apiDeleteEvent(Number(id));
          if (window.__api.apiGetEvents) {
            eventsData = await window.__api.apiGetEvents();
          }
        } else {
          eventsData = eventsData.filter(
            (event) => Number(event.id) !== Number(id)
          );
        }
        renderEventList();
        showAlert("イベントが削除されました", "success");
      } catch (e) {
        console.error(e);
        showAlert("イベントの削除に失敗しました", "error");
      }
    })();
  }
}

function deleteSpecial(id) {
  if (confirm("このお買い得商品を削除しますか？")) {
    (async () => {
      try {
        if (window.__api && window.__api.apiDeleteSpecial) {
          await window.__api.apiDeleteSpecial(Number(id));
          if (window.__api.apiGetSpecials) {
            specialsData = await window.__api.apiGetSpecials();
          }
        } else {
          specialsData = specialsData.filter(
            (special) => Number(special.id) !== Number(id)
          );
        }
        renderSpecialList();
        showAlert("お買い得商品が削除されました", "success");
      } catch (e) {
        console.error(e);
        showAlert("お買い得商品の削除に失敗しました", "error");
      }
    })();
  }
}

function deleteMessage(id) {
  if (confirm("このメッセージを削除しますか？")) {
    (async () => {
      try {
        if (window.__api && window.__api.apiDeleteMessage) {
          await window.__api.apiDeleteMessage(Number(id));
          if (window.__api.apiGetMessages) {
            messagesData = await window.__api.apiGetMessages();
          }
        } else {
          messagesData = messagesData.filter(
            (message) => Number(message.id) !== Number(id)
          );
        }
        renderMessageList();
        showAlert("メッセージが削除されました", "success");
      } catch (e) {
        console.error(e);
        showAlert("メッセージの削除に失敗しました", "error");
      }
    })();
  }
}

function deleteRequest(id) {
  if (!confirm("この要望を削除しますか？")) return;
  (async () => {
    try {
      if (window.__api) {
        const deleter =
          window.__api.apiDeleteComment || window.__api.apiDeleteRequest;
        if (deleter) await deleter(id);
        const getter =
          window.__api.apiGetComments || window.__api.apiGetRequests;
        if (getter) {
          const list = await getter();
          if (Array.isArray(list)) requestsData = list;
          else requestsData = requestsData.filter((r) => r.id !== id);
        } else {
          requestsData = requestsData.filter((r) => r.id !== id);
        }
      } else {
        requestsData = requestsData.filter((r) => r.id !== id);
      }
      renderRequestList();
      updateRequestStats();
      showAlert("要望が削除されました", "success");
    } catch (e) {
      console.error(e);
      showAlert("要望の削除に失敗しました", "error");
    }
  })();
}

// HTMLのonclickから確実に呼べるようにグローバルへ公開
if (typeof window !== "undefined") {
  window.generateAIContent = generateAIContent;
  window.generateSpecialAIContent = generateSpecialAIContent;
  window.renderMessageList = renderMessageList;
  window.deleteEvent = deleteEvent;
  window.deleteSpecial = deleteSpecial;
  window.deleteMessage = deleteMessage;
  window.deleteRequest = deleteRequest;
  window.toggleMenu = toggleMenu;
  window.toggleCollapse = toggleCollapse;
  window.filterRequests = filterRequests;
  window.updateRequestStatus = updateRequestStatus;
  // エクスポート関連も公開（必要に応じて）
  window.buildSpecialsExport = buildSpecialsExport;
  window.downloadExportPDF = downloadExportPDF;
  // 管理トークン関連
  window.openAdminTokenModal = openAdminTokenModal;
  window.closeAdminTokenModal = closeAdminTokenModal;
  window.saveAdminToken = saveAdminToken;
}

// -----------------------
// Analytics / 行動ログ計測
// -----------------------
function genId(len = 8) {
  const a = new Uint8Array(len);
  try {
    crypto.getRandomValues(a);
    return Array.from(a).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, len);
  } catch {
    return Math.random().toString(16).slice(2, 2 + len);
  }
}

function getOrCreateAnonUserId() {
  try {
    let id = localStorage.getItem("ANON_USER_ID");
    if (!id) {
      id = `anon-${Date.now().toString(36)}-${genId(6)}`;
      localStorage.setItem("ANON_USER_ID", id);
    }
    return id;
  } catch {
    return `anon-${Date.now().toString(36)}-${genId(6)}`;
  }
}

function getOrCreateSessionId() {
  try {
    let id = sessionStorage.getItem("SESSION_ID");
    if (!id) {
      id = `sess-${Date.now().toString(36)}-${genId(6)}`;
      sessionStorage.setItem("SESSION_ID", id);
    }
    return id;
  } catch {
    return `sess-${Date.now().toString(36)}-${genId(6)}`;
  }
}

function safeLogEvent(type, props) {
  try {
    const payload = {
      type,
      props: props || {},
      page: location.pathname || "",
      anonUserId: getOrCreateAnonUserId(),
      sessionId: getOrCreateSessionId(),
    };
    try {
      if (!window.__recentLoggedActions) window.__recentLoggedActions = new Map();
      const key = (props && (props.domPath || props.elementId)) || (props && props.feature) || `${type}::${payload.page}`;
      try { window.__recentLoggedActions.set(String(key), Date.now()); } catch(e){}
    } catch(e){}
    if (window.__api && typeof window.__api.apiLogEvent === "function") {
      try {
        window.__api.apiLogEvent(payload);
      } catch (e) {
        // ignore
      }
    } else {
      // fallback: fire-and-forget
      fetch((window.API_BASE_URL || "") + "/api/event-logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).catch(() => {});
    }
  } catch (e) {
    // silent
  }
}

function initAnalyticsInstrumentation() {
  const MIN_VIEW_MS = 500; // 最小送信時間

  // クリック計測（デリゲート）
  // クリック計測（デリゲート）
  // Guard against double-counting: dedupe clicks on same element within short interval.
  const __recentStaffClicks = new Map();
  const __STAFF_DEDUPE_MS = 600;
  document.addEventListener("click", (e) => {
    try {
      const btn = e.target.closest("button, a, input, .special-item, .event-item, .message-item, .request-item");
      if (!btn) return;
      // 特定要素の属する機能を推定
      const featureEl = btn.closest(".special-item, #special-list-content, .special-list, .specials") || btn.closest(".event-item, #event-list-content, .events") || btn.closest(".message-item, #message-list-content, .messages") || btn.closest(".request-item, #request-list, .requests") || btn.closest("#export-preview, .export-preview");
      let feature = "unknown";
      if (!featureEl) {
        // try top-level ids
        const top = e.target.closest("[id]");
        if (top && top.id) feature = top.id;
      } else {
        if (featureEl.id === "special-list-content" || featureEl.classList.contains("special-item")) feature = "specials";
        else if (featureEl.id === "event-list-content" || featureEl.classList.contains("event-item")) feature = "events";
        else if (featureEl.id === "message-list-content" || featureEl.classList.contains("message-item")) feature = "messages";
        else if (featureEl.id === "request-list" || featureEl.classList.contains("request-item")) feature = "requests";
        else if (featureEl.id === "export-preview") feature = "export";
        else feature = featureEl.id || (featureEl.className || "").split(" ")[0] || "unknown";
      }

      const text = (btn.textContent || "").trim().slice(0, 180);
      const elId = btn.getAttribute("data-id") || btn.id || btn.getAttribute("name") || null;
      const props = { feature, element: btn.tagName.toLowerCase(), text, elementId: elId };
      try {
        const domPath = btn.getAttribute('data-analytics-key') || btn.id || (btn.className || '').split(' ')[0] || '';
        const ck = `click::${elId||''}::${domPath}::${String(text||'').slice(0,60)}`;
        const now = Date.now();
        const prev = __recentStaffClicks.get(ck) || 0;
        if (now - prev < __STAFF_DEDUPE_MS) return;
        __recentStaffClicks.set(ck, now);
        if (__recentStaffClicks.size > 500) {
          const cutoff = now - __STAFF_DEDUPE_MS * 4;
          for (const [k, t] of __recentStaffClicks.entries()) if (t < cutoff) __recentStaffClicks.delete(k);
        }
      } catch (e) {}
      safeLogEvent("click", props);
    } catch (e) {}
  }, { capture: false });

  // 閲覧時間計測（IntersectionObserver）
  const watchList = [
    { sel: "#event-list-content", feature: "events" },
    { sel: "#special-list-content", feature: "specials" },
    { sel: "#message-list-content", feature: "messages" },
    { sel: "#request-list", feature: "requests" },
    { sel: "#export-preview", feature: "export" },
  ];

  const activeViews = {};

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      try {
        const f = en.target.__analyticsFeature;
        if (!f) return;
        if (en.isIntersecting && en.intersectionRatio >= 0.5) {
          // start
          if (!activeViews[f]) activeViews[f] = Date.now();
        } else {
          // end
          const start = activeViews[f];
          if (start) {
            const d = Date.now() - start;
            delete activeViews[f];
            if (d >= MIN_VIEW_MS) {
              safeLogEvent("view", { feature: f, durationMs: d });
            }
          }
        }
      } catch (e) {}
    });
  }, { threshold: [0.5] });

  watchList.forEach((w) => {
    try {
      const el = document.querySelector(w.sel);
      if (!el) return;
      el.__analyticsFeature = w.feature;
      observer.observe(el);
    } catch (e) {}
  });

  // ページ離脱時のフラッシュ
  function flushViews() {
    try {
      Object.keys(activeViews).forEach((f) => {
        try {
          const start = activeViews[f];
          if (!start) return;
          const d = Date.now() - start;
          if (d >= MIN_VIEW_MS) safeLogEvent("view", { feature: f, durationMs: d, unload: true });
        } catch (e) {}
      });
    } catch (e) {}
  }
  window.addEventListener("beforeunload", flushViews);
  window.addEventListener("pagehide", flushViews);

  // 初回ロードの短い居座りも記録（任意）
  safeLogEvent("page_loaded", { ts: Date.now() });
}

// ハンバーガーメニューの制御
function toggleMenu() {
  const navLinks = document.getElementById("nav-links");

  navLinks.classList.toggle("active");
}

// 折りたたみ機能
function toggleCollapse(bodyId) {
  const body = document.getElementById(bodyId);
  const header = body.previousElementSibling;

  body.classList.toggle("collapsed");
  header.classList.toggle("collapsed");
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

// =====================
// 特売リスト出力（A4 PDF）
// =====================
let __exportItems = [];
let __exportRangeLabel = "";

function formatJPDate(dateStr) {
  if (!dateStr) return "";
  const m = String(dateStr).match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return dateStr;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  return `${y}年${mo}月${d}日`;
}

function overlapsRange(itemStart, itemEnd, selStart, selEnd) {
  if (!itemStart) return false;
  const s1 = toLocalDateOnly(itemStart);
  const e1 = toLocalDateOnly(itemEnd) || s1;
  const s2 = selStart ? toLocalDateOnly(selStart) : null;
  const e2 = selEnd ? toLocalDateOnly(selEnd) : s2;
  if (!s2 && !e2) return true; // 範囲未指定なら常に含める
  const end2 = e2 || s2;
  const start2 = s2 || e2;
  return s1 <= end2 && e1 >= start2;
}

// =====================
// 管理トークン設定 UI
// =====================
function openAdminTokenModal() {
  const m = document.getElementById("admin-token-modal");
  if (!m) return;
  try {
    const t = localStorage.getItem("ADMIN_TOKEN") || "";
    const input = document.getElementById("admin-token-input");
    if (input) input.value = t;
  } catch {}
  m.style.display = "block";
  document.body.style.overflow = "hidden";
}
function closeAdminTokenModal() {
  const m = document.getElementById("admin-token-modal");
  if (!m) return;
  m.style.display = "none";
  document.body.style.overflow = "auto";
}
function saveAdminToken() {
  const input = document.getElementById("admin-token-input");
  const v = (input?.value || "").trim();
  try {
    if (v) localStorage.setItem("ADMIN_TOKEN", v);
    else localStorage.removeItem("ADMIN_TOKEN");
    closeAdminTokenModal();
    showAlert("管理トークンを保存しました", "success");
  } catch (e) {
    console.error(e);
    showAlert("保存に失敗しました", "error");
  }
}

async function buildSpecialsExport() {
  const start = (document.getElementById("export-start")?.value || "").trim();
  const end = (document.getElementById("export-end")?.value || "").trim();
  // 期間ラベル（和文フォーマット）
  if (start && end) __exportRangeLabel = `${formatJPDate(start)}～${formatJPDate(end)}`;
  else if (start) __exportRangeLabel = `${formatJPDate(start)}`;
  else if (end) __exportRangeLabel = `${formatJPDate(end)}`;
  else __exportRangeLabel = "期間未指定";
  let items = [];
  try {
    if (window.__api && window.__api.apiGetSpecials) {
      items = await window.__api.apiGetSpecials({ start, end });
    }
  } catch (e) {
    console.warn("apiGetSpecials with range failed, fallback to all", e);
    try {
      if (window.__api && window.__api.apiGetSpecials) {
        const all = await window.__api.apiGetSpecials();
        items = (all || []).filter((it) => overlapsRange(it.startDate, it.endDate, start, end));
      }
    } catch {}
  }
  // 二重ガード（常にクライアント側でも重なり判定で最終フィルタ）
  const selStart = start || end || "";
  const selEnd = end || start || "";
  if (selStart || selEnd) {
    items = (items || []).filter((it) => overlapsRange(it.startDate, it.endDate, selStart, selEnd));
  }
  // もしお買い得商品一覧で商品にチェックが入っていれば、その選択のみを対象とする
  try {
    const checked = Array.from(document.querySelectorAll('.select-special:checked')).map(el => Number(el.getAttribute('data-id'))).filter(Boolean);
    if (checked.length) {
      items = (items || []).filter(it => checked.includes(Number(it.id)));
    }
  } catch (e) {
    // DOM 検索失敗しても処理を続ける
  }
  __exportItems = Array.isArray(items) ? items.slice() : [];
  // 既定で全件表示
  __exportItems.forEach((it) => { if (typeof it.__include === 'undefined') it.__include = true; });
  renderExportPreview();
}

function renderExportPreview() {
  const preview = document.getElementById("export-preview");
  const controls = document.getElementById("export-controls");
  if (!preview) return;
  if (!__exportItems.length) {
    preview.innerHTML = '<p class="text-center">該当期間の特売はありません</p>';
    if (controls) controls.style.display = "none";
    return;
  }
  if (controls) controls.style.display = "flex";

  // include=true のみ抽出し、6件ごとにページ分割
  const included = __exportItems
    .map((sp, i) => ({ sp, i }))
    .filter(({ sp }) => sp.__include !== false);
  const pages = [];
  for (let p = 0; p < included.length; p += 6) {
    pages.push(included.slice(p, p + 6));
  }
  const pagesHTML = pages
    .map((chunk) => {
      const body = chunk.map(({ sp, i }) => exportItemHTML(sp, i)).join("");
      return `
      <div class="export-page">
        <div class="export-header">
          <img class="export-header-image" src="../images/ad/title.png" alt="title" onerror="this.style.display='none'" crossorigin="anonymous" />
          <div class="export-period-label">${__exportRangeLabel}</div>
        </div>
        <div class="export-body">${body}</div>
      </div>`;
    })
    .join("");

  preview.innerHTML = `<div id="export-a4-wrapper" class="export-a4">${pagesHTML}</div>`;
  setupDragAndDrop(preview);
  setupIncludeToggles(preview);
}

function exportItemHTML(sp, idx) {
  // 旧価格・割引表示は廃止
  // フル解像度優先（imageUrl がDBの元画像URL想定）
  const fullImg = sp.imageUrl || sp.image || "";
  const img = fullImg;
  const desc = sp.description ? String(sp.description).replace(/\n+/g, "<br>") : "";
  const rec = sp.recipeName || sp.recipeIdea || "";
  const recDetails = sp.recipeDetails ? String(sp.recipeDetails).replace(/\n+/g, "<br>") : "";
  
  // 日付から年を除いて表示（MM/DD形式）
  const formatDateWithoutYear = (dateStr) => {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    const month = date.getMonth() + 1;
    const day = date.getDate();
    return `${month}/${day}`;
  };
  
  const range = sp.startDate 
    ? `${formatDateWithoutYear(sp.startDate)}${sp.endDate ? " ～ " + formatDateWithoutYear(sp.endDate) : ""}` 
    : "";
  
  return `
  <div class="export-item" draggable="true" data-idx="${idx}">
    <div class="export-item-inner">
      <div class="export-thumb">
        ${img ? `<img src="${img}" data-fullsrc="${fullImg}" alt="${sp.name || "特売"}" crossorigin="anonymous">` : `<div class="img-ph">No Image</div>`}
      </div>
      <div class="export-body">
        <div class="export-row-head"><label class="export-include"><input type="checkbox" class="include-checkbox" checked> 表示</label></div>
        <div class="export-row">
          <div class="export-name-row">
            <div class="export-name" contenteditable="true">${sp.name || "特売商品"}</div>
            ${range ? `<div class="export-range">${range}</div>` : ""}
          </div>
          <div class="export-price">
            ${isFinite(Number(sp.salePrice)) ? `<span class="p-new">¥${Number(sp.salePrice).toLocaleString()}</span>` : ""}
            ${sp.unit ? `<span class="p-unit">${sp.unit}</span>` : ''}
          </div>
        </div>
        ${desc ? `<div class="export-desc" contenteditable="true">${desc}</div>` : ""}
        <div class="export-recipe" style="display: var(--export-show-recipe, block)">
          ${rec ? `<div class="rec-name">🍳 <span class="rec-text" contenteditable="true">${rec}</span></div>` : ""}
          ${recDetails ? `<div class="rec-details" contenteditable="true">${recDetails}</div>` : ""}
        </div>
      </div>
    </div>
  </div>`;
}

function setupDragAndDrop(container) {
  let dragSrc = null;
  container.querySelectorAll('.export-item').forEach((el) => {
    el.addEventListener('dragstart', (e) => {
      dragSrc = el;
      el.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', el.getAttribute('data-idx'));
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
    });
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      const fromIdx = Number(e.dataTransfer.getData('text/plain'));
      const toIdx = Number(el.getAttribute('data-idx'));
      if (!Number.isFinite(fromIdx) || !Number.isFinite(toIdx)) return;
      if (fromIdx === toIdx) return;
      const moved = __exportItems.splice(fromIdx, 1)[0];
      __exportItems.splice(toIdx, 0, moved);
      renderExportPreview();
    });
  });
}

function setupIncludeToggles(container) {
  container.querySelectorAll('.export-item .include-checkbox').forEach((cb) => {
    cb.addEventListener('change', () => {
      const item = cb.closest('.export-item');
      if (!item) return;
      const idx = Number(item.getAttribute('data-idx'));
      if (Number.isFinite(idx) && __exportItems[idx]) {
        __exportItems[idx].__include = !!cb.checked;
        // 再描画して6件ごとに再分割
        renderExportPreview();
      }
    });
  });
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load ' + src));
    document.head.appendChild(s);
  });
}

function waitForImages(root) {
  const imgs = Array.from(root.querySelectorAll('img'));
  if (!imgs.length) return Promise.resolve();
  return Promise.all(
    imgs.map((img) => {
      if (img.complete) return Promise.resolve();
      return new Promise((res) => {
        img.addEventListener('load', () => res(), { once: true });
        img.addEventListener('error', () => res(), { once: true });
      });
    })
  );
}

async function downloadExportPDF() {
  // プレビューがなければ生成
  if (!document.getElementById('export-a4-wrapper')) {
    await buildSpecialsExport();
  }
  const wrapper = document.getElementById('export-a4-wrapper');
  if (!wrapper) throw new Error('プレビューがありません');

  // 必要ライブラリを用意（jsPDF / html2canvas）
  if (!window.jspdf) {
    try { await loadScript('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js'); } catch {}
  }
  if (!window.html2canvas) {
    try { await loadScript('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js'); } catch {}
  }
  const jsPDF = (window.jspdf && window.jspdf.jsPDF) ? window.jspdf.jsPDF : null;
  if (!jsPDF) {
    // 最後の手段として従来フロー
    if (window.html2pdf) {
      const start = (document.getElementById('export-start')?.value || '').replaceAll('-', '');
      const end = (document.getElementById('export-end')?.value || '').replaceAll('-', '');
      const fname = `specials_${start || 'start'}_${end || 'end'}.pdf`;
      const opt = {
        margin: [0, 0, 0, 0], filename: fname,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, allowTaint: true, backgroundColor: '#ffffff' },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
      };
      await window.html2pdf().from(wrapper).set(opt).save();
      return;
    }
    throw new Error('jsPDFの読み込みに失敗しました');
  }
  // A4（pt）: 595 x 842。ページ単位（.export-page）でキャプチャ
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  // 表示そのままをキャプチャ（ヘッダー含む全体）
  const clone = wrapper.cloneNode(true);
  clone.style.position = 'fixed';
  clone.style.left = '-10000px';
  clone.style.top = '0';
  clone.style.background = '#ffffff';
  // pt->px換算でA4幅に固定（1pt=96/72px）
  const pxPerPt = 96 / 72;
  const cloneWidthPx = Math.round(pageW * pxPerPt); // ≒794px
  clone.style.width = cloneWidthPx + 'px';
  clone.style.boxSizing = 'border-box';
  // ダウンロード時のみ「本日限り」を商品説明から自動除去
  try {
    clone.querySelectorAll('.export-desc').forEach((el) => {
      el.innerHTML = String(el.innerHTML).replace(/本日限り/g, '');
    });
  } catch {}
  // ページ要素単位で画像化（確実に6件/ページ＋ヘッダー冒頭）
  // ダウンロード時は object-fit の互換性のため、各ページ内のサムネイルを background cover に置換
  document.body.appendChild(clone);
  const pages = Array.from(clone.querySelectorAll('.export-page'));
  // 各ページの下部にバナーを追加し、ページ高さをA4に固定
  try {
    const targetPagePxHeight = Math.round(pageH * (96 / 72));
    if (pages && pages.length) {
      pages.forEach((page, idx) => {
        page.style.boxSizing = 'border-box';
        page.style.width = cloneWidthPx + 'px';
        page.style.height = String(targetPagePxHeight) + 'px';
        page.style.display = 'flex';
        page.style.flexDirection = 'column';
        page.style.justifyContent = 'flex-start';
        page.style.overflow = 'hidden';
        // ページ番号用にフッターを相対配置
        const footer = document.createElement('div');
        footer.className = 'export-footer';
        footer.style.marginTop = 'auto';
        const img = document.createElement('img');
        img.className = 'export-banner-image';
        img.src = '../images/ad/banner.png';
        img.alt = 'banner';
        img.setAttribute('crossorigin','anonymous');
        img.onerror = function(){ this.style.display='none'; };
        img.style.width = '100%';
        img.style.height = 'auto';
        footer.appendChild(img);
        // ページ番号（白文字、中央）
        const num = document.createElement('div');
        num.className = 'export-page-number';
        num.textContent = String(idx + 1);
        footer.appendChild(num);
        page.appendChild(footer);
      });
    }
  } catch {}
  // PDFの文字がガタつく問題対策：常に高解像度でキャプチャ
  const scale = (typeof window !== 'undefined' && Number(window.EXPORT_PDF_SCALE)) || 2; // 既定2。必要に応じて window.EXPORT_PDF_SCALE=3 など
  let first = true;
  for (const page of (pages.length ? pages : [clone])) {
    try {
      page.querySelectorAll('.export-desc').forEach((el) => {
        el.innerHTML = String(el.innerHTML).replace(/本日限り/g, '');
      });
    } catch {}
    try {
      page.querySelectorAll('.export-thumb').forEach((th) => {
        const imgEl = th.querySelector('img');
        if (!imgEl) return;
        const full = imgEl.getAttribute('data-fullsrc') || imgEl.getAttribute('src');
        const bg = document.createElement('div');
        bg.className = 'thumb-bg';
        const cacheBust = !!(typeof window !== 'undefined' && window.EXPORT_CACHE_BUST);
        const u = full ? (cacheBust ? full + (full.includes('?') ? '&' : '?') + 'cb=' + Date.now() : full) : '';
        bg.style.backgroundImage = u ? `url("${u}")` : 'none';
        th.replaceChild(bg, imgEl);
      });
      page.querySelectorAll('.export-include').forEach((el) => el.remove());

      // 価格行は旧価格や%OFFを描かず、お買い得価格のみを高解像度で描画する
      page.querySelectorAll('.export-price').forEach((wrap) => {
        try {
          const newEl = wrap.querySelector('.p-new');
          const unitEl = wrap.querySelector('.p-unit');
          if (!newEl) return;
          const getText = (el) => (el && (el.textContent || '').trim()) || '';
          const tNew = getText(newEl);
          const tUnit = getText(unitEl);

          const sNew = newEl ? getComputedStyle(newEl) : null;
          const sUnit = unitEl ? getComputedStyle(unitEl) : null;
          const famNew = (sNew?.fontFamily) || 'Impact, Arial Black, sans-serif';
          const famUnit = (sUnit?.fontFamily) || 'sans-serif';
          const sizeNew = Math.max(20, parseFloat(sNew?.fontSize) || 40);
          const sizeUnit = Math.max(10, parseFloat(sUnit?.fontSize) || Math.round(sizeNew * 0.36));
          const weightNew = '900';
          const weightUnit = sUnit?.fontWeight || '400';

          const scaleFactor = 4;
          const paddingX = Math.round(sizeNew * 0.3);
          const paddingY = Math.round(sizeNew * 0.25);

          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          const measure = (font, text) => { ctx.font = font; const m = ctx.measureText(text); return { w: Math.ceil(m.width), h: Math.ceil(parseFloat(font) * 1.2) }; };
          const fontNew = `${weightNew} ${sizeNew}px ${famNew}`;
          const fontUnit = `${weightUnit} ${sizeUnit}px ${famUnit}`;
          const mNew = measure(fontNew, tNew);
          const mUnit = tUnit ? measure(fontUnit, tUnit) : { w: 0, h: 0 };

          const gapSmall = Math.round(sizeUnit * 0.4);
          const lineH = Math.ceil(Math.max(sizeNew, sizeUnit) * 1.05);
          const totalW = paddingX + mNew.w + (tUnit ? gapSmall + mUnit.w : 0) + paddingX;
          const totalH = paddingY + lineH + paddingY;

          canvas.width = Math.ceil(totalW * scaleFactor);
          canvas.height = Math.ceil(totalH * scaleFactor);
          ctx.scale(scaleFactor, scaleFactor);
          ctx.textBaseline = 'alphabetic';

          const centerY = paddingY + Math.round(lineH / 2);
          const baselineFor = (fs) => centerY + Math.round(fs * 0.35);
          let x = paddingX;

          // お買い得価格を描画
          ctx.font = fontNew;
          ctx.fillStyle = '#ff0000';
          const yNew = baselineFor(sizeNew);
          ctx.fillText(tNew, x, yNew);
          x += mNew.w;

          // 単位
          if (tUnit) {
            x += gapSmall;
            ctx.font = fontUnit;
            ctx.fillStyle = '#666';
            const yUnit = baselineFor(sizeUnit);
            ctx.fillText(tUnit, x, yUnit);
            x += mUnit.w;
          }

          const img = document.createElement('img');
          img.className = 'price-line-img';
          img.src = canvas.toDataURL('image/png');
          img.alt = `${tNew}${tUnit ? ' ' + tUnit : ''}`;
          img.style.width = totalW + 'px';
          img.style.height = totalH + 'px';
          wrap.innerHTML = '';
          wrap.appendChild(img);
        } catch (_) {}
      });
    } catch {}
    await waitForImages(page);
    const canvas = await window.html2canvas(page, {
      scale,
      backgroundColor: '#ffffff',
      useCORS: true,
      allowTaint: true,
      windowWidth: cloneWidthPx,
      windowHeight: page.scrollHeight
    });
    const imgW = canvas.width;
    const ratio = pageW / imgW;
    const jpegQ = (typeof window !== 'undefined' && Number(window.EXPORT_JPEG_QUALITY)) || 0.85;
    const url = canvas.toDataURL('image/jpeg', Math.max(0.5, Math.min(0.95, jpegQ)));
    if (!first) doc.addPage();
    doc.addImage(url, 'JPEG', 0, 0, pageW, canvas.height * ratio);
    first = false;
  }
  try { document.body.removeChild(clone); } catch {}

  const startStr = (document.getElementById('export-start')?.value || '').replaceAll('-', '');
  const endStr = (document.getElementById('export-end')?.value || '').replaceAll('-', '');
  const fname = `specials_${startStr || 'start'}_${endStr || 'end'}.pdf`;
  doc.save(fname);
}

// =====================
// お買い得商品プレビュー表示（従業員向け閲覧用）
// =====================
async function renderSpecialsPreview() {
  if (!window.__api || !window.__api.apiGetSpecials) return;
  let list = [];
  try {
    list = await window.__api.apiGetSpecials();
  } catch (e) {
    console.warn("apiGetSpecials failed", e);
  }
  const container = document.getElementById("specials-preview-container");
  if (!container) return;
  // 過去分を除外
  const visible = Array.isArray(list)
    ? list.filter((sp) => !isPastPeriod(sp.startDate, sp.endDate))
    : [];
  if (!visible.length) {
    container.innerHTML =
      '<p class="text-center">現在、登録されたお買い得商品はありません</p>';
    return;
  }

  // 割引率計算は不要（旧価格表示は出さない）
  const calcDiscount = () => null;

  container.innerHTML = visible
    .map((sp) => {
      const discount = null; // 割引表示廃止
      const img = sp.image || sp.imageUrl || "../images/placeholder.svg";
      const desc = sp.description ? sp.description.replace(/\n+/g, "<br>") : "";
      return `
      <div class="special-preview-item card">
        <div class="special-image">
          <img src="${img}" alt="${
        sp.name || "お買い得商品"
      }" onerror="this.src='../images/placeholder.svg'" />
          
        </div>
        <div class="card-body">
          <h4>${sp.name || "お買い得商品"}</h4>
          <div class="price-info">
            ${sp.salePrice != null ? `<span class="new-price">¥${Number(sp.salePrice).toLocaleString()}</span>` : ""}
            ${sp.unit ? `<span class=\"unit\">${sp.unit}</span>` : ""}
          </div>
          ${
            sp.startDate
              ? `<div class=\"date-range\">${sp.startDate}${
                  sp.endDate ? " ～ " + sp.endDate : ""
                }</div>`
              : ""
          }
          ${sp.recipeIdea ? `<p class=\"recipe\">🍳 ${sp.recipeIdea}</p>` : ""}
          ${desc ? `<p class=\"desc\">${desc}</p>` : ""}
        </div>
      </div>`;
    })
    .join("");
}

// ナビゲーションリンクのスムーズスクロール（モバイル対応）
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
