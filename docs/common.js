// =============================================================
// 共通処理：LIFF初期化・API呼び出し・デモデータ・グラフ描画
// =============================================================
(function () {
  const C = window.APP_CONFIG || {};
  const params = new URLSearchParams(location.search);
  const DEMO = params.get("demo") === "1" || !C.LIFF_ID || !C.GAS_URL;
  const SLOT_COLORS = { 朝: "var(--s1)", 昼: "var(--s2)", 夜: "var(--s3)" };

  // ---------- 日付 ----------
  const pad = (n) => String(n).padStart(2, "0");
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
  const parseYmd = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const mdw = (s) => { const d = parseYmd(s); return `${d.getMonth() + 1}/${d.getDate()}(${"日月火水木金土"[d.getDay()]})`; };
  const today = () => ymd(new Date());
  const dateRange = (from, to) => { const a = []; for (let d = from; d <= to; d = addDays(d, 1)) a.push(d); return a; };

  // ---------- デモデータ ----------
  function demoRecords() {
    const out = [];
    const rnd = mulberry32(7);
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
    const end = today();
    for (let i = 27; i >= 0; i--) {
      const date = addDays(end, -i);
      const wave = Math.sin(i / 4) * 2;
      ["朝", "昼", "夜"].forEach((slot, si) => {
        if (i === 0 && si > 0) return;
        if (rnd() < 0.08) return; // たまに未記録
        const base = Math.max(0, Math.min(10, Math.round(3 + wave + si * 1.3 + (rnd() - 0.5) * 3)));
        const vert = rnd() < 0.45;
        const r = {
          overall: Math.max(1, Math.min(5, 4 - Math.round(base / 3))),
          headache: base,
          headache_site: base ? [pick(["後頭部", "頭全体", "首の付け根"])] : [],
          orthostatic: base >= 5 ? pick(["15分以内", "15〜30分"]) : base > 0 ? pick(["30分〜1時間", "1時間以上"]) : "変化なし",
          lying_relief: base ? pick(["すぐ楽になる", "30分ほどで楽", "少し楽"]) : "横になっていない",
          symptoms: base >= 4 ? ["首・肩の痛み", pick(["耳鳴り", "吐き気", "強いだるさ", "頭がぼんやり"])] : [],
          vertigo: vert ? [pick(["ぐるぐる回る", "ぐるぐる回る", "ふわふわする"])] : ["なし"],
          fall: vert && rnd() < 0.15 ? "ふらついた" : "なし",
          redflags: [],
        };
        if (vert) Object.assign(r, {
          vertigo_count: pick(["1回", "2〜3回", "2〜3回", "4〜5回"]),
          vertigo_duration: pick(["1分以内", "1分以内", "1〜5分"]),
          vertigo_trigger: [pick(["右向きに寝返り", "起き上がる時", "上を向く"])],
          vertigo_strength: pick(["軽い", "中くらい"]),
        });
        if (slot === "朝") Object.assign(r, { sleep_quality: pick(["よく眠れた", "まあまあ", "あまり眠れず"]), sleep_hours: pick(["4〜6時間", "6〜8時間"]) });
        if (slot === "夜") Object.assign(r, {
          upright_time: base >= 6 ? "1〜3時間" : pick(["3〜6時間", "6〜9時間"]),
          activity: base >= 6 ? "少しだけ" : pick(["半分くらい", "普段どおり"]),
          water: pick(["1.5〜2L", "2L以上", "1〜1.5L"]),
          meds: "すべて飲んだ",
          prn: base >= 6 ? ["痛み止め"] : ["なし"],
          care: i === 10 ? ["通院"] : ["安静・横になる"],
          weather: pick(["晴れ", "くもり", "雨"]),
          mood: Math.max(1, Math.min(5, 4 - Math.round(base / 4))),
        });
        if (i === 10 && slot === "夜") r.memo = "通院日。先生に起立時の頭痛が続くと相談。";
        out.push({ id: `${date}_${slot}`, date, slot, created: `${date} ${["08:10", "13:05", "21:20"][si]}`, updated: "",
          pressure: Math.round(1012 + Math.sin(i / 3) * 8 + (rnd() - 0.5) * 3), record: r });
      });
    }
    return out;
  }
  function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  let demoStore = null;

  // ---------- API ----------
  const App = {
    DEMO, params, me: null, idToken: null,
    ymd, addDays, parseYmd, mdw, today, dateRange, SLOT_COLORS,

    async init() {
      if (DEMO) {
        demoStore = demoRecords();
        const role = params.get("role") === "family" ? "family" : "patient";
        App.me = { role, name: "デモユーザー", patientName: "本人（デモ）", slots: window.SLOTS };
        return App.me;
      }
      await liff.init({ liffId: C.LIFF_ID });
      if (!liff.isLoggedIn()) { liff.login({ redirectUri: location.href }); return new Promise(() => {}); }
      App.idToken = liff.getIDToken();
      App.me = await App.call("me");
      return App.me;
    },

    async call(action, payload = {}) {
      if (DEMO) return demoCall(action, payload);
      const res = await fetch(C.GAS_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" }, // プリフライト回避
        body: JSON.stringify(Object.assign({ action, idToken: App.idToken }, payload)),
      });
      const j = await res.json();
      if (!j.ok) {
        if (j.error === "token_invalid") { liff.logout(); liff.login({ redirectUri: location.href }); }
        throw new Error(j.error || "通信エラー");
      }
      return j;
    },

    inClient() { return !DEMO && window.liff && liff.isInClient(); },
    openExternal(url) {
      if (App.inClient()) liff.openWindow({ url, external: true });
      else window.open(url, "_blank");
    },
    toast(msg) {
      let t = document.querySelector(".toast");
      if (!t) { t = document.createElement("div"); t.className = "toast"; document.body.appendChild(t); }
      t.textContent = msg; t.classList.add("show");
      clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), 2200);
    },
    esc(s) { return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); },
  };

  function demoCall(action, p) {
    if (action === "list") {
      return { records: demoStore.filter((r) => (!p.from || r.date >= p.from) && (!p.to || r.date <= p.to)), patientName: App.me.patientName };
    }
    if (action === "submit") {
      const id = `${p.date}_${p.slot}`;
      const rec = { id, date: p.date, slot: p.slot, created: new Date().toLocaleString(), updated: "", pressure: 1010, record: p.record };
      const i = demoStore.findIndex((r) => r.id === id);
      if (i >= 0) demoStore[i] = rec; else demoStore.push(rec);
      return { saved: rec };
    }
    return App.me;
  }

  // ---------- 数値化（グラフ・集計用） ----------
  App.vertigoNum = (r) => {
    if (!Array.isArray(r.vertigo) || !r.vertigo.length || r.vertigo.includes("なし")) return 0;
    return { "1回": 1, "2〜3回": 2.5, "4〜5回": 4.5, "6回以上": 6 }[r.vertigo_count] ?? 1;
  };
  App.isAlert = (r, th = 8) =>
    (Array.isArray(r.redflags) && r.redflags.length > 0) || Number(r.headache) >= th ||
    r.fall === "転倒した" || String(r.vertigo_strength || "").startsWith("強い");

  // ---------- グラフ（SVG） ----------
  // series: [{name, color, values:[number|null]}], labels:[string]
  App.lineChart = function (el, { labels, series, yMax = 10, yTicks = [0, 2, 4, 6, 8, 10], height = 200, unit = "", yMin = 0, tipFmt }) {
    const W = Math.max(280, Math.round(el.clientWidth || 640)), H = height, L = 30, R = 10, T = 10, B = 26;
    const pw = W - L - R, ph = H - T - B, n = labels.length;
    const x = (i) => L + (n <= 1 ? pw / 2 : (pw * i) / (n - 1));
    const y = (v) => T + ph - (ph * (v - yMin)) / (yMax - yMin);
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img">`;
    yTicks.forEach((t) => {
      s += `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" stroke="#e6e4de" stroke-width="1"/>`;
      s += `<text x="${L - 6}" y="${y(t) + 4}" font-size="11" text-anchor="end" fill="#8a8983">${t}</text>`;
    });
    const step = Math.max(1, Math.ceil(n / 10));
    labels.forEach((lb, i) => { if (i % step === 0 || i === n - 1) s += `<text x="${x(i)}" y="${H - 8}" font-size="11" text-anchor="middle" fill="#8a8983">${lb}</text>`; });
    series.forEach((se) => {
      let d = "", pen = false;
      se.values.forEach((v, i) => { if (v === null || v === undefined) { pen = false; return; } d += `${pen ? "L" : "M"}${x(i)},${y(v)} `; pen = true; });
      s += `<path d="${d}" fill="none" stroke="${se.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
      se.values.forEach((v, i) => { if (v !== null && v !== undefined) s += `<circle cx="${x(i)}" cy="${y(v)}" r="3" fill="${se.color}" stroke="#fff" stroke-width="1.5"/>`; });
    });
    s += `<line class="xh" x1="0" x2="0" y1="${T}" y2="${T + ph}" stroke="#8a8983" stroke-width="1" stroke-dasharray="3 3" visibility="hidden"/>`;
    s += `<rect x="${L}" y="${T}" width="${pw}" height="${ph}" fill="transparent" class="hit"/></svg><div class="tip"></div>`;
    el.innerHTML = s;
    attachTip(el, n, x, W, (i) => tipFmt ? tipFmt(i) :
      `<b>${labels[i]}</b><br>` + series.map((se) => `<span style="color:${se.color}">●</span> ${se.name}: ${se.values[i] ?? "—"}${unit}`).join("<br>"));
  };

  App.barChart = function (el, { labels, values, color = "var(--s1)", height = 140, unit = "", yMax, tipFmt }) {
    const W = Math.max(280, Math.round(el.clientWidth || 640)), H = height, L = 30, R = 10, T = 10, B = 26;
    const pw = W - L - R, ph = H - T - B, n = labels.length;
    const max = yMax || Math.max(2, Math.ceil(Math.max(...values, 0)));
    const bw = Math.max(3, Math.min(18, (pw / n) * 0.6));
    const x = (i) => L + (pw * (i + 0.5)) / n;
    const y = (v) => T + ph - (ph * v) / max;
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img">`;
    [0, Math.round(max / 2), max].forEach((t) => {
      s += `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" stroke="#e6e4de"/>`;
      s += `<text x="${L - 6}" y="${y(t) + 4}" font-size="11" text-anchor="end" fill="#8a8983">${t}</text>`;
    });
    const step = Math.max(1, Math.ceil(n / 10));
    values.forEach((v, i) => {
      if (v > 0) {
        const h = y(0) - y(v), r = Math.min(4, bw / 2, h);
        s += `<path d="M${x(i) - bw / 2},${y(0)} V${y(v) + r} Q${x(i) - bw / 2},${y(v)} ${x(i) - bw / 2 + r},${y(v)} H${x(i) + bw / 2 - r} Q${x(i) + bw / 2},${y(v)} ${x(i) + bw / 2},${y(v) + r} V${y(0)} Z" fill="${color}"/>`;
      }
      if (i % step === 0 || i === n - 1) s += `<text x="${x(i)}" y="${H - 8}" font-size="11" text-anchor="middle" fill="#8a8983">${labels[i]}</text>`;
    });
    s += `<line class="xh" x1="0" x2="0" y1="${T}" y2="${T + ph}" stroke="#8a8983" stroke-dasharray="3 3" visibility="hidden"/>`;
    s += `<rect x="${L}" y="${T}" width="${pw}" height="${ph}" fill="transparent" class="hit"/></svg><div class="tip"></div>`;
    el.innerHTML = s;
    attachTip(el, n, x, W, (i) => tipFmt ? tipFmt(i) : `<b>${labels[i]}</b><br>${values[i]}${unit}`, true);
  };

  function attachTip(el, n, x, W, html, isBar) {
    const svg = el.querySelector("svg"), tip = el.querySelector(".tip"), xh = el.querySelector(".xh");
    const move = (ev) => {
      const r = svg.getBoundingClientRect();
      const px = ((ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left) * (W / r.width);
      let best = 0, bd = Infinity;
      for (let i = 0; i < n; i++) { const d = Math.abs(x(i) - px); if (d < bd) { bd = d; best = i; } }
      xh.setAttribute("x1", x(best)); xh.setAttribute("x2", x(best)); xh.setAttribute("visibility", "visible");
      tip.innerHTML = html(best); tip.style.display = "block";
      const left = (x(best) / W) * r.width;
      tip.style.left = Math.min(Math.max(0, left - tip.offsetWidth / 2), r.width - tip.offsetWidth) + "px";
      tip.style.top = "0px";
    };
    const out = () => { tip.style.display = "none"; xh.setAttribute("visibility", "hidden"); };
    svg.addEventListener("pointermove", move);
    svg.addEventListener("pointerdown", move);
    svg.addEventListener("pointerleave", out);
  }

  window.App = App;
})();
