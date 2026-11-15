(function () {
  const $ = (s) => document.querySelector(s);
  const E = App.esc;
  const F = (k) => window.ALL_FIELDS.find((f) => f.key === k);
  let ALL = [], me = null, cur = null;

  (async function () {
    try { me = await App.init(); } catch (e) { $("#paper").textContent = "起動できませんでした：" + e.message; return; }
    if (!me.role) { $("#paper").textContent = "先に記録画面から登録してください。"; return; }
    if (App.inClient()) {
      $("#ext").hidden = false;
      $("#note").textContent = "LINEの中では印刷・ダウンロードができない場合があります。「ブラウザで開く」を押してSafari/Chromeで操作してください。";
    }
    const r = await App.call("list", { from: App.addDays(App.today(), -400), to: App.today() });
    ALL = r.records || [];
    render();
  })();

  $("#back").onclick = () => { location.href = "index.html?view=history" + (App.DEMO ? "&demo=1" : ""); };
  $("#period").onchange = () => { $("#custom").hidden = $("#period").value !== "custom"; render(); };
  $("#from").onchange = $("#to").onchange = render;
  $("#print").onclick = () => window.print();
  $("#csv").onclick = () => downloadCsv();
  $("#ext").onclick = () => App.openExternal(location.href);

  function period() {
    const v = $("#period").value, t = App.today(), d = new Date();
    if (v === "thism") return [App.ymd(new Date(d.getFullYear(), d.getMonth(), 1)), t];
    if (v === "lastm") return [App.ymd(new Date(d.getFullYear(), d.getMonth() - 1, 1)), App.ymd(new Date(d.getFullYear(), d.getMonth(), 0))];
    if (v === "custom") {
      const f = $("#from").value || App.addDays(t, -27), to = $("#to").value || t;
      return f <= to ? [f, to] : [to, f];
    }
    return [App.addDays(t, -(Number(v) - 1)), t];
  }

  // 集計ヘルパー
  function count(recs, key) {
    const m = new Map();
    recs.forEach((r) => {
      const v = r.record[key];
      (Array.isArray(v) ? v : v !== undefined && v !== "" ? [v] : []).forEach((x) => m.set(x, (m.get(x) || 0) + 1));
    });
    return m;
  }
  function countStr(m, opts, exclude = []) {
    const keys = opts ? opts.filter((o) => m.has(o)) : [...m.keys()].sort((a, b) => m.get(b) - m.get(a));
    const s = keys.filter((k) => !exclude.includes(k)).map((k) => `${E(k)} <b>${m.get(k)}</b>`).join("、");
    return s || "—";
  }
  const avg = (a) => a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : "—";

  function render() {
    const [from, to] = period();
    cur = { from, to };
    const days = App.dateRange(from, to);
    const recs = ALL.filter((r) => r.date >= from && r.date <= to).sort((a, b) => (a.date + a.slot).localeCompare(b.date + b.slot));
    const slots = window.SLOTS;
    const get = (d, s) => recs.find((r) => r.date === d && r.slot === s);
    const night = recs.filter((r) => r.slot === "夜");

    // 頭痛
    const hs = (s) => recs.filter((r) => r.slot === s && r.record.headache !== undefined).map((r) => Number(r.record.headache));
    const allH = recs.filter((r) => r.record.headache !== undefined);
    const maxH = allH.reduce((m, r) => (Number(r.record.headache) > (m ? Number(m.record.headache) : -1) ? r : m), null);
    const hDays = days.filter((d) => slots.some((s) => { const r = get(d, s); return r && Number(r.record.headache) > 0; })).length;
    const h7Days = days.filter((d) => slots.some((s) => { const r = get(d, s); return r && Number(r.record.headache) >= 7; })).length;
    // めまい
    const vDays = days.filter((d) => slots.some((s) => { const r = get(d, s); return r && App.vertigoNum(r.record) > 0; })).length;
    const vTotal = recs.reduce((a, r) => a + App.vertigoNum(r.record), 0);
    const vRecs = recs.filter((r) => App.vertigoNum(r.record) > 0);
    // 処置（通院・点滴・ブラッドパッチ）
    const events = night.filter((r) => (r.record.care || []).some((c) => ["通院", "点滴", "ブラッドパッチ"].includes(c)))
      .map((r) => `${App.mdw(r.date)} ${(r.record.care || []).filter((c) => ["通院", "点滴", "ブラッドパッチ"].includes(c)).join("・")}`);
    const alerts = recs.filter((r) => App.isAlert(r.record));
    const memos = recs.filter((r) => r.record.memo);

    let h = `
      <h1>体調記録レポート <small>作成日 ${App.mdw(App.today())}</small></h1>
      <div class="meta">
        <span><b>氏名</b>${E(me.patientName || "")}</span>
        <span><b>期間</b>${App.mdw(from)} 〜 ${App.mdw(to)}（${days.length}日間）</span>
        <span><b>記録数</b>${recs.length} / ${days.length * slots.length}回（${Math.round((recs.length / (days.length * slots.length)) * 100)}%）</span>
        <span><b>記録時間帯</b>${slots.join("・")}</span>
      </div>
      <div class="meta"><span><b>診断名（本人申告）</b>脳脊髄液減少症／良性発作性頭位めまい症</span></div>

      <h2>概要</h2>
      <table class="kv">
        <tr><th>頭痛（0-10）</th><td>平均 ${slots.map((s) => `${s} <b>${avg(hs(s))}</b>`).join("／")}　最大 <b>${maxH ? maxH.record.headache : "—"}</b>${maxH ? `（${App.mdw(maxH.date)} ${maxH.slot}）` : ""}<br>
          頭痛のあった日 <b>${hDays}</b>日／7以上の日 <b>${h7Days}</b>日　部位：${countStr(count(recs, "headache_site"))}</td></tr>
        <tr><th>起立後に悪化</th><td>${countStr(count(recs, "orthostatic"), F("orthostatic").options)}</td></tr>
        <tr><th>横になると</th><td>${countStr(count(recs, "lying_relief"), F("lying_relief").options)}</td></tr>
        <tr><th>随伴症状</th><td>${countStr(count(recs, "symptoms"))}</td></tr>
        <tr><th>めまい</th><td>あった日 <b>${vDays}</b>日／回数合計（目安）<b>${Math.round(vTotal)}</b>回<br>
          種類：${countStr(count(vRecs, "vertigo"), null, ["なし"])}<br>
          長さ：${countStr(count(vRecs, "vertigo_duration"), F("vertigo_duration").options)}<br>
          きっかけ：${countStr(count(vRecs, "vertigo_trigger"))}<br>
          強さ：${countStr(count(vRecs, "vertigo_strength"), F("vertigo_strength").options)}</td></tr>
        <tr><th>ふらつき・転倒</th><td>${countStr(count(recs, "fall"), F("fall").options, ["なし"])}</td></tr>
        <tr><th>起きて過ごせた時間</th><td>${countStr(count(night, "upright_time"), F("upright_time").options)}　（活動：${countStr(count(night, "activity"), F("activity").options)}）</td></tr>
        <tr><th>睡眠</th><td>${countStr(count(recs, "sleep_quality"), F("sleep_quality").options)}／${countStr(count(recs, "sleep_hours"), F("sleep_hours").options)}</td></tr>
        <tr><th>食事</th><td>${slots.map((s) => `${s}：${countStr(count(recs.filter((r) => r.slot === s), "meal"), F("meal").options)}`).join("<br>")}<br>
          食べたもの：${countStr(count(recs, "meal_items"))}<br>食べられなかった理由：${countStr(count(recs, "meal_reason"))}</td></tr>
        <tr><th>活動（1日平均）</th><td>${actSummary(recs, days)}</td></tr>
        <tr><th>水分量</th><td>${countStr(count(night, "water"), F("water").options)}</td></tr>
        <tr><th>服薬</th><td>定期薬：${countStr(count(night, "meds"), F("meds").options)}<br>頓服：${countStr(count(night, "prn"), null, ["なし"])}</td></tr>
        <tr><th>通院・処置</th><td>${events.length ? events.map(E).join("、") : "—"}　ケア：${countStr(count(night, "care"), null, ["なし", "通院", "点滴", "ブラッドパッチ"])}</td></tr>
        <tr><th>注意が必要な記録</th><td>${alerts.length ? alerts.map((r) => `<span class="hi">${App.mdw(r.date)} ${r.slot}</span>：${E(alertText(r.record))}`).join("<br>") : "なし"}</td></tr>
      </table>

      <h2>推移</h2>
      <div class="grid2">
        <div class="chartbox"><h3>頭痛の強さ（0〜10）</h3>
          <div class="legend">${slots.map((s) => `<span><i style="background:${App.SLOT_COLORS[s]}"></i>${s}</span>`).join("")}</div>
          <div class="chart" id="c1"></div></div>
        <div class="chartbox"><h3>めまいの回数（1日合計・目安）</h3><div class="legend">&nbsp;</div><div class="chart" id="c2"></div></div>
        <div class="chartbox"><h3>横にならずに過ごせた時間（時間・目安）</h3><div class="chart" id="c3"></div></div>
        <div class="chartbox"><h3>気圧（hPa・記録時点）</h3><div class="chart" id="c4"></div></div>
      </div>

      <h2 class="pb">日別一覧</h2>
      ${dailyTable(days, get, slots)}

      <h2>メモ</h2>
      ${memos.length ? `<ul class="memo">${memos.map((r) => `<li>${App.mdw(r.date)} ${r.slot}：${E(r.record.memo)}</li>`).join("")}</ul>` : "<p>—</p>"}
      <p class="foot">※本人がスマートフォンで選択式に記録した自己申告データです。活動は 徒=徒歩／施=ストレッチ施術／立=立位での事務／座=座位での事務 の1日合計（分）。食事は ◎しっかり ○半分 △少し ×食べられず。めまい回数は選択肢（1回／2〜3回／4〜5回／6回以上）を 1／2.5／4.5／6 として合計した目安です。気圧は記録時点の推計値（Open-Meteo）。</p>`;
    $("#paper").innerHTML = h;

    const labels = days.map((d) => { const x = App.parseYmd(d); return `${x.getMonth() + 1}/${x.getDate()}`; });
    App.lineChart($("#c1"), { labels, height: 115,
      series: slots.map((s) => ({ name: s, color: App.SLOT_COLORS[s], values: days.map((d) => { const r = get(d, s); return r && r.record.headache !== undefined ? Number(r.record.headache) : null; }) })) });
    App.barChart($("#c2"), { labels, height: 115, unit: "回", values: days.map((d) => slots.reduce((a, s) => { const r = get(d, s); return a + (r ? App.vertigoNum(r.record) : 0); }, 0)) });
    const upMap = { "1時間未満": 0.5, "1〜3時間": 2, "3〜6時間": 4.5, "6〜9時間": 7.5, "9時間以上": 10 };
    App.barChart($("#c3"), { labels, height: 95, unit: "時間", yMax: 10, color: "var(--s3)",
      values: days.map((d) => { const r = get(d, "夜"); return r && upMap[r.record.upright_time] || 0; }),
      tipFmt: (i) => { const r = get(days[i], "夜"); return `<b>${labels[i]}</b><br>${r && r.record.upright_time ? r.record.upright_time : "未記録"}`; } });
    const pv = days.map((d) => { const ps = recs.filter((r) => r.date === d && r.pressure).map((r) => r.pressure); return ps.length ? Math.round(ps.reduce((a, b) => a + b) / ps.length) : null; });
    const pvv = pv.filter((x) => x !== null);
    const pmin = pvv.length ? Math.floor((Math.min(...pvv) - 3) / 5) * 5 : 990, pmax = pvv.length ? Math.ceil((Math.max(...pvv) + 3) / 5) * 5 : 1030;
    App.lineChart($("#c4"), { labels, height: 95, yMin: pmin, yMax: pmax, yTicks: [pmin, Math.round((pmin + pmax) / 2), pmax], unit: "hPa",
      series: [{ name: "気圧", color: "var(--ink2)", values: pv }] });
  }

  function actSummary(recs, days) {
    const recDays = new Set(recs.map((r) => r.date)).size || 1;
    const parts = App.ACT_KEYS.map(([k, n]) => {
      const tot = recs.reduce((a, r) => a + (Number(r.record[k]) || 0), 0);
      const d = new Set(recs.filter((r) => Number(r.record[k]) > 0).map((r) => r.date)).size;
      return `${n} <b>${window.fmtMin(Math.round(tot / recDays))}</b>（実施${d}日）`;
    });
    const others = recs.filter((r) => r.record.activity_other).map((r) => `${App.mdw(r.date)} ${E(r.record.activity_other)}`);
    return parts.join("／") + (others.length ? `<br>その他：${others.join("、")}` : "");
  }

  function alertText(r) {
    const a = [];
    if ((r.redflags || []).length) a.push(r.redflags.join("・"));
    if (Number(r.headache) >= 8) a.push(`頭痛${r.headache}`);
    if (r.fall === "転倒した") a.push("転倒");
    if (String(r.vertigo_strength || "").startsWith("強い")) a.push("強いめまい");
    return a.join("、");
  }

  const MEAL_MARK = { "しっかり食べた": "◎", "半分くらい": "○", "少しだけ": "△", "食べられなかった": "×" };
  function actCell(any) {
    if (!any.length) return "";
    const has = any.some((r) => App.ACT_KEYS.some(([k]) => r.record[k] !== undefined));
    if (!has) return "";
    const sums = App.ACT_KEYS.map(([k]) => any.reduce((a, r) => a + (Number(r.record[k]) || 0), 0));
    const other = any.map((r) => r.record.activity_other).filter(Boolean).join("・");
    const t = App.ACT_KEYS.map(([, n], i) => `${n[0]}${sums[i]}`);
    return `${t[0]} ${t[1]}<br>${t[2]} ${t[3]}` + (other ? `<br>${E(other)}` : "");
  }
  function dailyTable(days, get, slots) {
    const ordOpt = F("orthostatic").options;
    let rows = "";
    days.forEach((d) => {
      const rs = slots.map((s) => get(d, s));
      const any = rs.filter(Boolean);
      const n = rs.find((r) => r && r.slot === "夜");
      const m = rs.find((r) => r && r.slot === "朝");
      const uni = (k) => [...new Set(any.flatMap((r) => r.record[k] || []))].filter((x) => x !== "なし");
      const orth = any.map((r) => r.record.orthostatic).filter((x) => x && x !== "変化なし")
        .sort((a, b) => ordOpt.indexOf(a) - ordOpt.indexOf(b))[0] || (any.length ? "—" : "");
      const vt = any.reduce((a, r) => a + App.vertigoNum(r.record), 0);
      const vtxt = vt ? `${Math.round(vt * 10) / 10}回 ${uni("vertigo").join("・")}${uni("vertigo_trigger").length ? "<br>" + uni("vertigo_trigger").join("・") : ""}` : any.length ? "なし" : "";
      const fall = any.map((r) => r.record.fall).filter((x) => x && x !== "なし").join("・");
      const alert = any.some((r) => App.isAlert(r.record));
      const cell = (r, k) => r && r.record[k] !== undefined ? `${Number(r.record[k]) >= 7 && k === "headache" ? `<span class="hi">${r.record[k]}</span>` : r.record[k]}` : "";
      rows += `<tr class="${alert ? "alert" : ""}">
        <td class="n">${App.mdw(d)}</td>
        ${rs.map((r) => `<td class="n">${cell(r, "headache")}</td>`).join("")}
        ${rs.map((r) => `<td class="n">${cell(r, "overall")}</td>`).join("")}
        ${rs.map((r) => `<td class="n">${r && r.record.meal ? MEAL_MARK[r.record.meal] || "" : ""}</td>`).join("")}
        <td>${E(orth)}</td>
        <td>${vtxt}</td>
        <td>${E(fall)}${(uni("redflags").length ? `<br><span class="hi">${E(uni("redflags").join("・"))}</span>` : "")}</td>
        <td>${E(uni("symptoms").join("・"))}</td>
        <td>${actCell(any)}</td>
        <td>${n ? E([n.record.upright_time, n.record.water && "水" + n.record.water].filter(Boolean).join("<br>")).replace(/&lt;br&gt;/g, "<br>") : ""}</td>
        <td>${n ? E([...(n.record.prn || []).filter((x) => x !== "なし"), ...(n.record.care || []).filter((x) => !["なし", "安静・横になる"].includes(x))].join("・")) : ""}</td>
        <td>${m ? E(m.record.sleep_quality || "") : ""}</td>
      </tr>`;
    });
    const cg = `<colgroup><col style="width:15mm">${'<col style="width:4.5mm">'.repeat(slots.length * 3)}<col style="width:12mm"><col style="width:28mm"><col style="width:10mm"><col><col style="width:18mm"><col style="width:15mm"><col style="width:14mm"><col style="width:11mm"></colgroup>`;
    return `<table class="daily" style="table-layout:fixed">${cg}
      <thead>
        <tr><th rowspan="2">日付</th><th colspan="${slots.length}">頭痛(0-10)</th><th colspan="${slots.length}">体調(1-5)</th><th colspan="${slots.length}">食事</th>
          <th rowspan="2">起立後<br>悪化(最短)</th><th rowspan="2">めまい（回数目安・種類・きっかけ）</th><th rowspan="2">転倒/危険</th>
          <th rowspan="2">随伴症状</th><th rowspan="2">活動(分)</th><th rowspan="2">起きていた<br>時間・水分</th><th rowspan="2">頓服・処置</th><th rowspan="2">睡眠</th></tr>
        <tr>${slots.map((s) => `<th>${s}</th>`).join("").repeat(3)}</tr>
      </thead><tbody>${rows}</tbody></table>`;
  }

  // ---------- CSV ----------
  function downloadCsv() {
    const { from, to } = cur;
    const recs = ALL.filter((r) => r.date >= from && r.date <= to)
      .sort((a, b) => (a.date + window.SLOTS.indexOf(a.slot)).localeCompare(b.date + window.SLOTS.indexOf(b.slot)));
    const fields = window.ALL_FIELDS;
    const head = ["日付", "曜日", "時間帯", "記録日時", "気圧(hPa)", ...fields.map((f) => f.short || f.label)];
    const q = (v) => { const s = String(v ?? ""); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = [head.map(q).join(",")];
    recs.forEach((r) => {
      const d = App.parseYmd(r.date);
      lines.push([r.date, "日月火水木金土"[d.getDay()], r.slot, r.created, r.pressure ?? "",
        ...fields.map((f) => { const v = r.record[f.key]; return Array.isArray(v) ? v.join("・") : v ?? ""; })].map(q).join(","));
    });
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `体調記録_${from}_${to}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
})();
