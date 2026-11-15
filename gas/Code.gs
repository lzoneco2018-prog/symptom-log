/**
 * 体調記録システム バックエンド（Google Apps Script）
 *
 * 役割:
 *   1. LIFF画面からのAPI（登録・記録保存・記録取得）
 *   2. LINE Webhook（友だち追加時の案内・メッセージへの返信）
 *   3. 定時リマインド（朝・昼・夜）と、家族への1日まとめ通知・悪化時の即時通知
 *
 * スクリプトプロパティ（プロジェクトの設定 → スクリプト プロパティ）に以下を登録:
 *   LINE_CHANNEL_ACCESS_TOKEN … Messaging API チャネルの長期アクセストークン
 *   LINE_LOGIN_CHANNEL_ID     … LIFFを作成した LINEログイン チャネルの「チャネルID」
 *
 * 初回は関数「setup」を一度だけ実行してください（シート作成・トリガー登録）。
 */

const TZ = 'Asia/Tokyo';
const SHEET = { SETTINGS: '設定', USERS: 'ユーザー', RECORDS: '記録', LOG: '送信ログ' };
const FIXED_COLS = ['記録ID', '日付', '時間帯', '記録者', '登録日時', '更新日時', '気圧(hPa)', 'JSON'];

const DEFAULT_SETTINGS = [
  ['PATIENT_NAME', '本人', '本人の呼び名（通知文・レポートに使用）'],
  ['PATIENT_CODE', '', '本人登録用の合言葉（setupで自動生成）'],
  ['FAMILY_CODE', '', '家族登録用の合言葉（setupで自動生成）'],
  ['SLOTS', '朝,昼,夜', '時間帯の名前（カンマ区切り）'],
  ['REMIND_TIMES', '08:00,13:00,21:00', 'リマインド時刻（SLOTSと同じ順番）'],
  ['RENOTIFY_MINUTES', '0', '未記録時の再通知（分後）。0で再通知なし ※通数に注意'],
  ['FAMILY_SUMMARY_TIME', '22:00', '家族へ1日まとめを送る時刻'],
  ['ALERT_HEADACHE', '8', 'この値以上の頭痛で家族へ即時通知'],
  ['APP_URL', '', 'LIFF URL（https://liff.line.me/xxxx）'],
  ['LATITUDE', '35.68', '気圧取得用の緯度（空欄で取得しない）'],
  ['LONGITUDE', '139.76', '気圧取得用の経度'],
];

// ================================================================
// 初期設定
// ================================================================
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let s = ss.getSheetByName(SHEET.SETTINGS) || ss.insertSheet(SHEET.SETTINGS);
  if (s.getLastRow() === 0) {
    s.appendRow(['項目', '値', '説明']);
    DEFAULT_SETTINGS.forEach((r) => s.appendRow(r));
    s.setFrozenRows(1);
    s.setColumnWidth(3, 380);
  }
  const conf = getSettings_();
  if (!conf.PATIENT_CODE) setSetting_('PATIENT_CODE', 'P-' + randomCode_());
  if (!conf.FAMILY_CODE) setSetting_('FAMILY_CODE', 'F-' + randomCode_());

  const u = ss.getSheetByName(SHEET.USERS) || ss.insertSheet(SHEET.USERS);
  if (u.getLastRow() === 0) { u.appendRow(['userId', '表示名', '役割', '登録日時', '有効']); u.setFrozenRows(1); }
  const r = ss.getSheetByName(SHEET.RECORDS) || ss.insertSheet(SHEET.RECORDS);
  if (r.getLastRow() === 0) { r.appendRow(FIXED_COLS); r.setFrozenRows(1); r.hideColumns(8); }
  const l = ss.getSheetByName(SHEET.LOG) || ss.insertSheet(SHEET.LOG);
  if (l.getLastRow() === 0) { l.appendRow(['日時', '種類', '宛先数', '結果']); l.setFrozenRows(1); }

  // 10分ごとの見回りトリガー（重複登録しない）
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'tick')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('tick').timeBased().everyMinutes(10).create();

  const c = getSettings_();
  Logger.log('セットアップ完了\n本人用の合言葉: ' + c.PATIENT_CODE + '\n家族用の合言葉: ' + c.FAMILY_CODE);
}

// ================================================================
// HTTP 入口
// ================================================================
function doGet() {
  return json_({ ok: true, message: 'symptom-log API is running' });
}

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad_request' }); }

  // LINE Webhook
  if (body && Array.isArray(body.events)) {
    try { handleWebhook_(body.events); } catch (err) { log_('webhook_error', 0, String(err)); }
    return json_({ ok: true });
  }

  // LIFF からの API
  try {
    const me = verifyIdToken_(body.idToken);
    const res = route_(body.action, body, me);
    return json_(Object.assign({ ok: true }, res));
  } catch (err) {
    return json_({ ok: false, error: err.message || String(err) });
  }
}

function route_(action, body, me) {
  const user = findUser_(me.userId);
  const conf = getSettings_();
  const base = { patientName: conf.PATIENT_NAME, slots: slots_(conf), remindTimes: remindTimes_(conf) };

  if (action === 'me') {
    return Object.assign(base, { role: user ? user.role : null, name: me.name });
  }
  if (action === 'register') {
    const code = String(body.code || '').trim();
    let role = null;
    if (code && code === conf.PATIENT_CODE) role = 'patient';
    if (code && code === conf.FAMILY_CODE) role = 'family';
    if (!role) throw new Error('合言葉が違います');
    upsertUser_(me.userId, me.name, role);
    return Object.assign(base, { role: role, name: me.name });
  }

  if (!user) throw new Error('not_registered');

  if (action === 'list') {
    return Object.assign(base, { role: user.role, records: listRecords_(body.from, body.to) });
  }
  if (action === 'submit') {
    if (user.role !== 'patient') throw new Error('記録できるのは本人のみです');
    const saved = saveRecord_(body.date, body.slot, body.record || {}, body.labels || {}, me.name);
    checkAlert_(saved, conf);
    return { saved: saved };
  }
  throw new Error('unknown_action');
}

// ================================================================
// 認証（LIFF IDトークンをLINEで検証）
// ================================================================
function verifyIdToken_(idToken) {
  if (!idToken) throw new Error('no_token');
  const cache = CacheService.getScriptCache();
  const key = 'tk_' + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken)).slice(0, 40);
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);

  const channelId = prop_('LINE_LOGIN_CHANNEL_ID');
  const res = UrlFetchApp.fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'post', payload: { id_token: idToken, client_id: channelId }, muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) throw new Error('token_invalid');
  const j = JSON.parse(res.getContentText());
  const me = { userId: j.sub, name: j.name || '' };
  cache.put(key, JSON.stringify(me), 1800);
  return me;
}

// ================================================================
// ユーザー
// ================================================================
function usersSheet_() { return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET.USERS); }

function allUsers_() {
  const v = usersSheet_().getDataRange().getValues();
  return v.slice(1).map((r, i) => ({ row: i + 2, userId: r[0], name: r[1], role: r[2], active: r[4] !== false }))
    .filter((u) => u.userId && u.active);
}
function findUser_(userId) { return allUsers_().find((u) => u.userId === userId) || null; }
function usersByRole_(role) { return allUsers_().filter((u) => u.role === role).map((u) => u.userId); }

function upsertUser_(userId, name, role) {
  const sh = usersSheet_();
  const found = sh.getDataRange().getValues().findIndex((r, i) => i > 0 && r[0] === userId);
  const now = fmt_(new Date(), 'yyyy-MM-dd HH:mm');
  if (found > 0) sh.getRange(found + 1, 1, 1, 5).setValues([[userId, name, role, now, true]]);
  else sh.appendRow([userId, name, role, now, true]);
}

// ================================================================
// 記録
// ================================================================
function recordsSheet_() { return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET.RECORDS); }

function saveRecord_(date, slot, record, labels, author) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('日付が不正です');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = recordsSheet_();
    let header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];

    // 新しい項目があれば列を追加
    const keys = Object.keys(record);
    keys.forEach((k) => {
      const label = labels[k] || k;
      if (header.indexOf(label) < 0) {
        sh.getRange(1, header.length + 1).setValue(label);
        header.push(label);
      }
    });

    const id = date + '_' + slot;
    const data = sh.getDataRange().getValues();
    const rowIdx = data.findIndex((r, i) => i > 0 && r[0] === id);
    const now = fmt_(new Date(), 'yyyy-MM-dd HH:mm');
    const pressure = fetchPressure_();

    const row = header.map(() => '');
    row[0] = id; row[1] = date; row[2] = slot; row[3] = author;
    row[4] = rowIdx > 0 ? data[rowIdx][4] : now;
    row[5] = now;
    row[6] = pressure !== null ? pressure : (rowIdx > 0 ? data[rowIdx][6] : '');
    row[7] = JSON.stringify(record);
    keys.forEach((k) => {
      const v = record[k];
      row[header.indexOf(labels[k] || k)] = Array.isArray(v) ? v.join('・') : v;
    });

    if (rowIdx > 0) sh.getRange(rowIdx + 1, 1, 1, row.length).setValues([row]);
    else sh.appendRow(row);

    return { id: id, date: date, slot: slot, created: row[4], updated: now, pressure: row[6], record: record };
  } finally {
    lock.releaseLock();
  }
}

function listRecords_(from, to) {
  const sh = recordsSheet_();
  const v = sh.getDataRange().getValues();
  const out = [];
  for (let i = 1; i < v.length; i++) {
    const d = v[i][1] instanceof Date ? fmt_(v[i][1], 'yyyy-MM-dd') : String(v[i][1]);
    if (from && d < from) continue;
    if (to && d > to) continue;
    let rec = {};
    try { rec = JSON.parse(v[i][7] || '{}'); } catch (e) { /* skip */ }
    out.push({
      id: v[i][0], date: d, slot: v[i][2],
      created: String(v[i][4]), updated: String(v[i][5]),
      pressure: v[i][6] === '' ? null : Number(v[i][6]), record: rec,
    });
  }
  return out;
}

function recordExists_(date, slot) {
  const id = date + '_' + slot;
  return recordsSheet_().getRange('A:A').getValues().some((r) => r[0] === id);
}

function fetchPressure_() {
  const c = getSettings_();
  if (!c.LATITUDE || !c.LONGITUDE) return null;
  try {
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + c.LATITUDE + '&longitude=' + c.LONGITUDE +
      '&current=pressure_msl&timezone=Asia%2FTokyo';
    const j = JSON.parse(UrlFetchApp.fetch(url, { muteHttpExceptions: true }).getContentText());
    return j.current && j.current.pressure_msl ? Math.round(j.current.pressure_msl) : null;
  } catch (e) { return null; }
}

// ================================================================
// 悪化時の即時通知（家族へ）
// ================================================================
function alertReasons_(rec, threshold) {
  const reasons = [];
  if (Array.isArray(rec.redflags) && rec.redflags.length) reasons.push('危険なサイン: ' + rec.redflags.join('・'));
  if (Number(rec.headache) >= Number(threshold || 8)) reasons.push('強い頭痛（' + rec.headache + '/10）');
  if (rec.fall === '転倒した') reasons.push('転倒した');
  if (String(rec.vertigo_strength || '').indexOf('強い') === 0) reasons.push('強いめまい');
  return reasons;
}

function checkAlert_(saved, conf) {
  const reasons = alertReasons_(saved.record, conf.ALERT_HEADACHE);
  if (!reasons.length) return;
  const text = '【注意】' + conf.PATIENT_NAME + 'さんの記録（' + mdLabel_(saved.date) + ' ' + saved.slot + '）\n' +
    reasons.map((r) => '・' + r).join('\n') +
    (saved.record.memo ? '\nメモ: ' + saved.record.memo : '') +
    '\n\n様子を確認してあげてください。';
  pushTo_(usersByRole_('family'), [linkMessage_(text, '記録を見る', appUrl_('history'))], 'alert');
}

// ================================================================
// 定時処理（10分ごと）
// ================================================================
function tick() {
  const conf = getSettings_();
  const now = new Date();
  const today = fmt_(now, 'yyyy-MM-dd');
  const nowMin = toMin_(fmt_(now, 'HH:mm'));
  const props = PropertiesService.getScriptProperties();
  const slots = slots_(conf);
  const times = String(conf.REMIND_TIMES).split(',').map((s) => s.trim());
  const renotify = Number(conf.RENOTIFY_MINUTES || 0);

  slots.forEach((slot, i) => {
    const t = toMin_(times[i]);
    if (t === null) return;
    // 通常リマインド（時刻から60分以内に1回）
    sendOnce_(props, 'rm_' + today + '_' + i, nowMin >= t && nowMin < t + 60, () => {
      if (!recordExists_(today, slot)) {
        pushTo_(usersByRole_('patient'), [linkMessage_(
          slot + 'の体調記録の時間です。\n対象期間：' + periodText_(conf, i) + '\n選ぶだけで1分ほどで終わります。', '記録する', appUrl_('record', slot))], 'remind');
      }
    });
    // 再通知
    if (renotify > 0) {
      sendOnce_(props, 'rn_' + today + '_' + i, nowMin >= t + renotify && nowMin < t + renotify + 60, () => {
        if (!recordExists_(today, slot)) {
          pushTo_(usersByRole_('patient'), [linkMessage_(
            slot + 'の記録がまだのようです。体調がつらい時は「体調」と「頭痛」だけでも大丈夫です。', '記録する',
            appUrl_('record', slot))], 'renotify');
        }
      });
    }
  });

  // 家族への1日まとめ
  const st = toMin_(conf.FAMILY_SUMMARY_TIME);
  if (st !== null) {
    sendOnce_(props, 'sum_' + today, nowMin >= st && nowMin < st + 60, () => sendFamilySummary_(today));
  }

  cleanupProps_(props, today);
}

function sendOnce_(props, key, cond, fn) {
  if (!cond || props.getProperty(key)) return;
  props.setProperty(key, '1');
  fn();
}

function cleanupProps_(props, today) {
  const all = props.getProperties();
  Object.keys(all).forEach((k) => {
    const m = k.match(/^(rm|rn|sum)_(\d{4}-\d{2}-\d{2})/);
    if (m && m[2] < today) props.deleteProperty(k);
  });
}

function buildSummaryText_(date, conf) {
  const recs = listRecords_(date, date);
  const lines = ['【' + mdLabel_(date) + ' ' + conf.PATIENT_NAME + 'さんの体調まとめ】'];
  let alert = false;
  slots_(conf).forEach((slot) => {
    const r = recs.find((x) => x.slot === slot);
    if (!r) { lines.push('■' + slot + '：未記録'); return; }
    const d = r.record;
    const parts = [];
    if (d.overall) parts.push('体調 ' + ['', 'とても悪い', '悪い', 'ふつう', '良い', 'とても良い'][d.overall]);
    if (d.headache !== undefined && d.headache !== '') parts.push('頭痛 ' + d.headache + '/10');
    if (Array.isArray(d.vertigo) && d.vertigo.length && d.vertigo.indexOf('なし') < 0) {
      parts.push('めまい ' + (d.vertigo_count || 'あり'));
    } else if (Array.isArray(d.vertigo)) parts.push('めまいなし');
    if (d.fall && d.fall !== 'なし') parts.push(d.fall);
    if (d.meal) parts.push('食事 ' + d.meal);
    const act = [['walk_min', '徒歩'], ['stretch_min', '施術'], ['desk_stand_min', '立位事務'], ['desk_sit_min', '座位事務']]
      .filter((a) => Number(d[a[0]]) > 0).map((a) => a[1] + d[a[0]] + '分');
    if (d.activity_other) act.push(d.activity_other);
    if (alertReasons_(d, conf.ALERT_HEADACHE).length) alert = true;
    lines.push('■' + slot + '：' + parts.join('／'));
    if (act.length) lines.push('　活動：' + act.join('・'));
    if (d.upright_time) lines.push('　起きて過ごせた時間 ' + d.upright_time + '／水分 ' + (d.water || '-'));
    if (d.memo) lines.push('　メモ：' + d.memo);
  });
  if (alert) lines.push('\n※今日は注意が必要な記録がありました。');
  return lines.join('\n');
}

function sendFamilySummary_(date) {
  const conf = getSettings_();
  const fam = usersByRole_('family');
  if (!fam.length) return;
  pushTo_(fam, [linkMessage_(buildSummaryText_(date, conf), 'グラフ・履歴を見る', appUrl_('history'))], 'summary');
}

// ================================================================
// LINE Webhook
// ================================================================
function handleWebhook_(events) {
  events.forEach((ev) => {
    if (!ev.replyToken) return;
    if (ev.type === 'follow') {
      reply_(ev.replyToken, [linkMessage_(
        '友だち追加ありがとうございます。\n最初に下のボタンから画面を開き、お知らせされた「合言葉」を入力して登録してください。',
        '登録・記録画面を開く', appUrl_('record'))]);
    } else if (ev.type === 'message') {
      reply_(ev.replyToken, [linkMessage_('メニューを開きます。', '記録・履歴を開く', appUrl_('record'))]);
    }
  });
}

// ================================================================
// LINE Messaging API
// ================================================================
function linkMessage_(text, label, uri) {
  // 本文＋ボタン1つのFlexメッセージ（1通としてカウント）
  if (!uri) return { type: 'text', text: text };
  return {
    type: 'flex', altText: text.slice(0, 380),
    contents: {
      type: 'bubble',
      body: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: text, wrap: true, size: 'sm' }] },
      footer: { type: 'box', layout: 'vertical', contents: [
        { type: 'button', style: 'primary', color: '#2a78d6', action: { type: 'uri', label: label, uri: uri } },
      ] },
    },
  };
}

function pushTo_(userIds, messages, kind) {
  if (!userIds.length) return;
  const token = prop_('LINE_CHANNEL_ACCESS_TOKEN');
  const url = userIds.length === 1 ? 'https://api.line.me/v2/bot/message/push' : 'https://api.line.me/v2/bot/message/multicast';
  const payload = userIds.length === 1 ? { to: userIds[0], messages: messages } : { to: userIds, messages: messages };
  const res = UrlFetchApp.fetch(url, {
    method: 'post', contentType: 'application/json', headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify(payload), muteHttpExceptions: true,
  });
  log_(kind, userIds.length, res.getResponseCode() + ' ' + res.getContentText().slice(0, 200));
}

function reply_(replyToken, messages) {
  UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'post', contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + prop_('LINE_CHANNEL_ACCESS_TOKEN') },
    payload: JSON.stringify({ replyToken: replyToken, messages: messages }), muteHttpExceptions: true,
  });
}

// ================================================================
// 手動テスト用
// ================================================================
function testFamilySummaryToday() { sendFamilySummary_(fmt_(new Date(), 'yyyy-MM-dd')); }
function testReminder() {
  pushTo_(usersByRole_('patient'), [linkMessage_('テスト：記録の時間です。', '記録する', appUrl_('record'))], 'test');
}

// ================================================================
// ユーティリティ
// ================================================================
function getSettings_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET.SETTINGS);
  const o = {};
  if (!sh) return o;
  sh.getDataRange().getValues().slice(1).forEach((r) => {
    let v = r[1];
    if (v instanceof Date) v = fmt_(v, 'HH:mm'); // 時刻セルが日付型に変換された場合の対策
    o[r[0]] = String(v).trim();
  });
  return o;
}
function setSetting_(key, value) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET.SETTINGS);
  const v = sh.getDataRange().getValues();
  const i = v.findIndex((r) => r[0] === key);
  if (i > 0) sh.getRange(i + 1, 2).setValue(value); else sh.appendRow([key, value, '']);
}
function remindTimes_(conf) { return String(conf.REMIND_TIMES || '08:00,13:00,21:00').split(',').map((s) => s.trim()); }
// 記録の対象期間：前の時間帯の記録時刻 〜 この時間帯の記録時刻（先頭の時間帯は前夜から）
function periodText_(conf, i) {
  const t = remindTimes_(conf), n = t.length;
  const h = (x) => { const m = String(x).match(/^(\d{1,2}):(\d{2})/); return m ? Number(m[1]) + '時' + (m[2] !== '00' ? Number(m[2]) + '分' : '') : x; };
  const s = slots_(conf), p = (i - 1 + n) % n;
  return (i === 0 ? '前日' : '') + (s[p] || '') + h(t[p]) + ' 〜 ' + (s[i] || '') + h(t[i]);
}
function slots_(conf) { return String(conf.SLOTS || '朝,昼,夜').split(',').map((s) => s.trim()).filter(String); }
function appUrl_(view, slot) {
  const base = getSettings_().APP_URL;
  if (!base) return '';
  const q = ['view=' + view];
  if (slot) q.push('slot=' + encodeURIComponent(slot));
  return base + (base.indexOf('?') >= 0 ? '&' : '?') + q.join('&');
}
function prop_(k) {
  const v = PropertiesService.getScriptProperties().getProperty(k);
  if (!v) throw new Error('スクリプトプロパティ ' + k + ' が未設定です');
  return v;
}
function fmt_(d, p) { return Utilities.formatDate(d, TZ, p); }
function toMin_(hhmm) {
  const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
function mdLabel_(date) {
  const p = date.split('-');
  const d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  return Number(p[1]) + '/' + Number(p[2]) + '(' + '日月火水木金土'[d.getDay()] + ')';
}
function randomCode_() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += c[Math.floor(Math.random() * c.length)];
  return s;
}
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function log_(kind, n, result) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET.LOG);
  if (sh) sh.appendRow([fmt_(new Date(), 'yyyy-MM-dd HH:mm:ss'), kind, n, result]);
}
