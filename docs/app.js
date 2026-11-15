(function () {
  const $ = (s) => document.querySelector(s);
  const main = $("#main");
  const S = { view: "record", date: App.today(), slot: null, rec: {}, records: [], me: null };
  const REQUIRED = ["overall", "headache"];

  function defaultSlot() {
    const h = new Date().getHours();
    return h < 11 ? "朝" : h < 17 ? "昼" : "夜";
  }

  // ---------------- 起動 ----------------
  (async function start() {
    try {
      S.me = await App.init();
    } catch (e) {
      main.innerHTML = `<div class="card">起動できませんでした：${App.esc(e.message)}</div>`;
      return;
    }
    const p = new URLSearchParams(location.search);
    S.slot = (window.SLOTS.includes(p.get("slot")) && p.get("slot")) || defaultSlot();
    if (!S.me.role) return renderRegister();
    S.view = p.get("view") || (S.me.role === "family" ? "history" : "record");
    if (S.me.role !== "patient" && S.view === "record") S.view = "history";
    $("#who").textContent = `${S.me.patientName || ""}さん${S.me.role === "family" ? "（家族として閲覧）" : ""}`;
    $("#nav").hidden = false;
    $("#navRecord").hidden = S.me.role !== "patient";
    document.querySelectorAll("#nav button").forEach((b) => b.addEventListener("click", () => go(b.dataset.view)));
    await loadRecords();
    go(S.view);
  })();

  async function loadRecords() {
    const r = await App.call("list", { from: App.addDays(App.today(), -60), to: App.today() });
    S.records = r.records || [];
  }

  function go(view) {
    if (view === "report") {
      location.href = "report.html" + (App.DEMO ? "?demo=1" : "");
      return;
    }
    S.view = view;
    document.querySelectorAll("#nav button").forEach((b) => b.classList.toggle("on", b.dataset.view === view));
    $("#saveBar").hidden = view !== "record";
    window.scrollTo(0, 0);
    if (view === "record") loadForm(); else renderHistory();
  }

  function demoBanner() {
    return App.DEMO ? `<div class="demo-banner">デモモードです（サンプルデータ・保存されません）。config.js を設定すると本番モードになります。</div>` : "";
  }

  // ---------------- 登録 ----------------
  function renderRegister() {
    main.innerHTML = `${demoBanner()}
      <div class="card reg">
        <h2>はじめに登録してください</h2>
        <p>お知らせされた「合言葉」を入力してください。<br><span class="muted">本人用（P-で始まる）／家族用（F-で始まる）</span></p>
        <input id="code" placeholder="P-XXXXXX" autocomplete="off">
        <p><button class="btn" id="regBtn" style="width:100%">登録する</button></p>
        <p class="muted" id="regMsg"></p>
      </div>`;
    $("#regBtn").onclick = async () => {
      $("#regBtn").disabled = true;
      try {
        await App.call("register", { code: $("#code").value.trim().toUpperCase() });
        location.reload();
      } catch (e) {
        $("#regMsg").textContent = e.message; $("#regBtn").disabled = false;
      }
    };
  }

  // ---------------- 記録フォーム ----------------
  function findRec(date, slot) { return S.records.find((r) => r.date === date && r.slot === slot); }

  function loadForm() {
    const ex = findRec(S.date, S.slot);
    S.rec = ex ? JSON.parse(JSON.stringify(ex.record)) : {};
    renderForm();
  }

  function renderForm() {
    const t = App.today(), y = App.addDays(t, -1);
    const dateOpts = [t, y, App.addDays(t, -2)].map((d, i) =>
      `<option value="${d}" ${d === S.date ? "selected" : ""}>${["今日", "昨日", "おととい"][i]} ${App.mdw(d)}</option>`).join("");
    const slotBtns = window.SLOTS.map((s) => {
      const done = !!findRec(S.date, s);
      return `<button data-slot="${s}" class="${s === S.slot ? "on" : ""}">${s}<span class="${done ? "done" : "todo"}">${done ? "✓記録済み" : "未記録"}</span></button>`;
    }).join("");

    let html = demoBanner() + `<div class="bar"><select id="dateSel">${dateOpts}</select>
      <span class="muted" style="font-size:13px">${findRec(S.date, S.slot) ? "記録済み：上書き保存されます" : ""}</span></div>
      <div class="slots">${slotBtns}</div>
      <div class="period">この記録の対象期間：<b>${App.periodText(S.slot)}</b><br><span>前回の記録時刻から今回の記録時刻までの状態を記録します</span></div>`;

    window.FIELD_GROUPS.forEach((g, gi) => {
      if (g.slotsOnly && !g.slotsOnly.includes(S.slot)) return;
      const fs = g.fields.filter((f) => window.fieldVisible(f, S.slot, S.rec));
      if (!fs.length) return;
      html += `<section class="card ${g.danger ? "danger" : ""}"><h2>${g.title}</h2>`;
      fs.forEach((f) => { html += renderField(f); });
      if (g.danger && (S.rec.redflags || []).length) {
        html += `<div class="alertbox">すぐに医療機関へ連絡してください。<br>
          迷ったら <a href="tel:%237119">#7119（救急安心センター）</a>、緊急時は <a href="tel:119">119</a> へ。<br>
          <span style="font-weight:normal">保存すると家族にもすぐ通知されます。</span></div>`;
      }
      html += `</section>`;
    });
    main.innerHTML = html;

    $("#dateSel").onchange = (e) => { S.date = e.target.value; loadForm(); };
    main.querySelectorAll(".slots button").forEach((b) => b.onclick = () => { S.slot = b.dataset.slot; loadForm(); });
    main.querySelectorAll("[data-k]").forEach((b) => b.onclick = () => onChip(b.dataset.k, b.dataset.v));
    main.querySelectorAll("textarea[data-text]").forEach((t) => t.oninput = (e) => { S.rec[e.target.dataset.text] = e.target.value; });
  }

  function renderField(f) {
    const v = S.rec[f.key];
    const req = REQUIRED.includes(f.key) ? `<span class="req">必須</span>` : "";
    const multi = f.type === "multi" ? `<span class="muted" style="font-weight:normal;font-size:12px">（複数可）</span>` : "";
    let body = "";
    const on = (o) => (Array.isArray(v) ? v.includes(o) : String(v) === String(o)) ? "on" : "";
    if (f.type === "scale5") {
      body = `<div class="scale5">${f.options.map((o, i) =>
        `<button class="chip ${on(i + 1)}" data-k="${f.key}" data-v="${i + 1}"><b>${i + 1}</b>${o}</button>`).join("")}</div>`;
    } else if (f.type === "nrs") {
      body = `<div class="nrs">${[...Array(11).keys()].map((n) =>
        `<button class="chip ${on(n)}" data-k="${f.key}" data-v="${n}" style="${on(n) ? "" : `background:${nrsBg(n)}`}">${n}</button>`).join("")}</div>
        <div class="nrs-legend"><span>痛みなし</span><span>想像できる最悪の痛み</span></div>`;
    } else if (f.type === "minutes") {
      body = `<div class="chips grid4">${f.options.map((o, i) =>
        `<button class="chip ${on(o)}" data-k="${f.key}" data-v="${o}">${window.fmtMin(o, i === f.options.length - 1)}</button>`).join("")}</div>`;
    } else if (f.type === "text") {
      body = `<textarea data-text="${f.key}" placeholder="${App.esc(f.placeholder || "自由にどうぞ（空欄でもOK）")}">${App.esc(v || "")}</textarea>`;
    } else {
      body = `<div class="chips">${f.options.map((o) =>
        `<button class="chip ${on(o)}" data-k="${f.key}" data-v="${App.esc(o)}">${App.esc(o)}</button>`).join("")}</div>`;
    }
    const label = f.label.replace("{meal}", { 朝: "朝食", 昼: "昼食", 夜: "夕食" }[S.slot] || "食事");
    return `<div class="field"><div class="q">${label}${req}${multi}</div>${body}</div>`;
  }

  function nrsBg(n) {
    const a = [0, .04, .08, .12, .16, .2, .26, .32, .38, .44, .5][n];
    return `rgba(198,40,40,${a})`;
  }

  function onChip(key, val) {
    const f = window.ALL_FIELDS.find((x) => x.key === key);
    if (f.type === "scale5" || f.type === "nrs" || f.type === "minutes") {
      S.rec[key] = String(S.rec[key]) === val ? undefined : Number(val);
    } else if (f.type === "multi") {
      let a = Array.isArray(S.rec[key]) ? S.rec[key].slice() : [];
      if (a.includes(val)) a = a.filter((x) => x !== val);
      else if (f.exclusive && val === f.exclusive) a = [val];
      else { a = a.filter((x) => x !== f.exclusive); a.push(val); }
      S.rec[key] = a;
    } else {
      S.rec[key] = S.rec[key] === val ? undefined : val;
    }
    const y = window.scrollY;
    renderForm();
    window.scrollTo(0, y);
  }

  $("#copyPrev").onclick = () => {
    const key = (r) => r.date + String(window.SLOTS.indexOf(r.slot));
    const cur = S.date + String(window.SLOTS.indexOf(S.slot));
    const prev = S.records.filter((r) => key(r) < cur).sort((a, b) => key(b).localeCompare(key(a)))[0];
    if (!prev) return App.toast("前回の記録がありません");
    const copy = JSON.parse(JSON.stringify(prev.record));
    delete copy.memo; delete copy.redflags; delete copy.activity_other;
    S.rec = Object.assign({}, S.rec, copy);
    renderForm();
    App.toast(`${App.mdw(prev.date)} ${prev.slot}の内容をコピーしました。違う所だけ直してください`);
  };

  $("#saveBtn").onclick = async () => {
    const missing = REQUIRED.filter((k) => S.rec[k] === undefined || S.rec[k] === null || S.rec[k] === "");
    if (missing.length) {
      const names = missing.map((k) => window.ALL_FIELDS.find((f) => f.key === k).label.replace(/（.*）/, ""));
      return App.toast(`「${names.join("」「")}」を選んでください`);
    }
    // 表示されている項目だけ保存
    const rec = {}, labels = {};
    window.FIELD_GROUPS.forEach((g) => {
      if (g.slotsOnly && !g.slotsOnly.includes(S.slot)) return;
      g.fields.forEach((f) => {
        if (!window.fieldVisible(f, S.slot, S.rec)) return;
        const v = S.rec[f.key];
        if (v === undefined || v === null || (Array.isArray(v) && !v.length) || v === "") return;
        rec[f.key] = v; labels[f.key] = f.short || f.label;
      });
    });
    const btn = $("#saveBtn");
    btn.disabled = true; btn.textContent = "保存中…";
    try {
      const r = await App.call("submit", { date: S.date, slot: S.slot, record: rec, labels });
      const i = S.records.findIndex((x) => x.id === r.saved.id);
      if (i >= 0) S.records[i] = r.saved; else S.records.push(r.saved);
      App.toast("保存しました。おつかれさまでした");
      renderForm();
    } catch (e) {
      App.toast("保存できませんでした：" + e.message);
    } finally {
      btn.disabled = false; btn.textContent = "保存する";
    }
  };

  // ---------------- 履歴・グラフ ----------------
  function renderHistory() {
    const days = Number(S.histDays || 14);
    const to = App.today(), from = App.addDays(to, -(days - 1));
    const range = App.dateRange(from, to);
    const labels = range.map((d) => { const x = App.parseYmd(d); return `${x.getMonth() + 1}/${x.getDate()}`; });
    const get = (d, s) => findRec(d, s);

    main.innerHTML = demoBanner() + `
      <div class="bar"><select id="days">
        ${[7, 14, 30, 60].map((n) => `<option value="${n}" ${n === days ? "selected" : ""}>直近${n}日</option>`).join("")}
      </select></div>
      <section class="card"><h2>頭痛の強さ（0〜10）</h2>
        <div class="legend">${window.SLOTS.map((s) => `<span><i style="background:${App.SLOT_COLORS[s]}"></i>${s}</span>`).join("")}</div>
        <div class="chart" id="c1"></div></section>
      <section class="card"><h2>めまいの回数（1日合計・目安）</h2><div class="chart" id="c2"></div></section>
      <div id="list"></div>`;

    $("#days").onchange = (e) => { S.histDays = e.target.value; renderHistory(); };

    App.lineChart($("#c1"), {
      labels,
      series: window.SLOTS.map((s) => ({ name: s, color: App.SLOT_COLORS[s], values: range.map((d) => { const r = get(d, s); return r && r.record.headache !== undefined ? Number(r.record.headache) : null; }) })),
    });
    const vv = range.map((d) => window.SLOTS.reduce((a, s) => { const r = get(d, s); return a + (r ? App.vertigoNum(r.record) : 0); }, 0));
    App.barChart($("#c2"), { labels, values: vv, unit: "回", color: "var(--s1)" });

    const list = range.slice().reverse().map((d) => {
      const rows = window.SLOTS.map((s) => {
        const r = get(d, s);
        if (!r) return `<div class="row"><span class="slotdot" style="color:${App.SLOT_COLORS[s]}">${s}</span><span class="muted">未記録</span></div>`;
        return `<div class="row"><span class="slotdot" style="color:${App.SLOT_COLORS[s]}">${s}</span><span>${summarize(r.record)}</span></div>`;
      }).join("");
      return `<div class="day"><h3>${App.mdw(d)}</h3>${rows}</div>`;
    }).join("");
    $("#list").innerHTML = list;
  }

  function summarize(r) {
    const t = [];
    const F = (k) => window.ALL_FIELDS.find((f) => f.key === k);
    if (App.isAlert(r)) t.push(`<span class="tag red">注意</span>`);
    if (r.overall) t.push(`<span class="tag">体調 ${F("overall").options[r.overall - 1]}</span>`);
    if (r.headache !== undefined) t.push(`<span class="tag">頭痛 ${r.headache}/10</span>`);
    if (r.orthostatic && r.orthostatic !== "変化なし") t.push(`<span class="tag">起立後 ${App.esc(r.orthostatic)}で悪化</span>`);
    if (App.vertigoNum(r) > 0) t.push(`<span class="tag">めまい ${App.esc(r.vertigo_count || "")} ${App.esc((r.vertigo || []).join("・"))}</span>`);
    if (r.fall && r.fall !== "なし") t.push(`<span class="tag ${r.fall === "転倒した" ? "red" : ""}">${App.esc(r.fall)}</span>`);
    (r.redflags || []).forEach((x) => t.push(`<span class="tag red">${App.esc(x)}</span>`));
    if (r.meal) t.push(`<span class="tag ${r.meal === "食べられなかった" ? "red" : ""}">食事 ${App.esc(r.meal)}</span>`);
    const act = App.activityText(r);
    if (act) t.push(`<span class="tag">${App.esc(act)}</span>`);
    if (r.upright_time) t.push(`<span class="tag">起きていた ${App.esc(r.upright_time)}</span>`);
    if (r.symptoms && r.symptoms.length) t.push(`<br><span class="muted" style="font-size:13px">${App.esc(r.symptoms.join("・"))}</span>`);
    if (r.memo) t.push(`<br><span style="font-size:13px">📝 ${App.esc(r.memo)}</span>`);
    return t.join("");
  }
})();
