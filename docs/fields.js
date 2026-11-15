// =============================================================
// 記録項目の定義（ここを編集すると入力画面・CSV・レポートすべてに反映）
//   type: scale5 / nrs(0-10) / single / multi / text
//   slots: 表示する時間帯（省略時は全時間帯）
//   showIf: 表示条件（他の項目の値で出し分け）
// =============================================================
window.SLOTS = ["朝", "昼", "夜"];

window.FIELD_GROUPS = [
  {
    title: "全体",
    fields: [
      { key: "overall", short: "体調(1-5)", label: "今の体調", type: "scale5",
        options: ["とても悪い", "悪い", "ふつう", "良い", "とても良い"] },
      { key: "sleep_quality", short: "睡眠の質", label: "昨夜の睡眠", type: "single", slots: ["朝"],
        options: ["よく眠れた", "まあまあ", "あまり眠れず", "ほぼ眠れず"] },
      { key: "sleep_hours", short: "睡眠時間", label: "睡眠時間", type: "single", slots: ["朝"],
        options: ["4時間未満", "4〜6時間", "6〜8時間", "8時間以上"] },
    ],
  },
  {
    title: "頭痛・起立時の症状（脳脊髄液減少症）",
    fields: [
      { key: "headache", short: "頭痛(0-10)", label: "頭痛の強さ（0=なし／10=最悪）", type: "nrs" },
      { key: "headache_site", short: "頭痛の部位", label: "痛む場所", type: "multi",
        showIf: (r) => Number(r.headache) > 0,
        options: ["後頭部", "おでこ", "こめかみ", "頭全体", "首の付け根"] },
      { key: "orthostatic", short: "起立後に悪化するまで", label: "立つ・座ると症状が強くなるまでの時間", type: "single",
        options: ["変化なし", "15分以内", "15〜30分", "30分〜1時間", "1時間以上", "起き上がれない"] },
      { key: "lying_relief", short: "横になると", label: "横になると楽になるか", type: "single",
        options: ["すぐ楽になる", "30分ほどで楽", "少し楽", "変わらない", "横になっていない"] },
      { key: "symptoms", short: "随伴症状", label: "その他の症状（あてはまるもの全部）", type: "multi",
        options: ["首・肩の痛み", "背中・腰の痛み", "耳鳴り", "耳のつまり感", "聞こえにくい",
                  "吐き気", "嘔吐", "まぶしい", "かすみ・二重に見える", "手足のしびれ",
                  "強いだるさ", "頭がぼんやり", "動悸", "食欲がない"] },
    ],
  },
  {
    title: "めまい（良性発作性頭位めまい症）",
    fields: [
      { key: "vertigo", short: "めまいの種類", label: "めまいの種類", type: "multi", exclusive: "なし",
        options: ["なし", "ぐるぐる回る", "ふわふわする", "立ちくらみ"] },
      { key: "vertigo_count", short: "めまい回数", label: "回数（前回の記録から）", type: "single",
        showIf: (r) => hasVertigo(r),
        options: ["1回", "2〜3回", "4〜5回", "6回以上"] },
      { key: "vertigo_duration", short: "めまいの長さ", label: "1回の長さ", type: "single",
        showIf: (r) => hasVertigo(r),
        options: ["1分以内", "1〜5分", "5分〜1時間", "1時間以上続く"] },
      { key: "vertigo_trigger", short: "めまいのきっかけ", label: "きっかけ", type: "multi",
        showIf: (r) => hasVertigo(r),
        options: ["右向きに寝返り", "左向きに寝返り", "起き上がる時", "横になる時",
                  "上を向く", "下を向く・かがむ", "立ち上がる時", "歩いている時", "きっかけなし"] },
      { key: "vertigo_strength", short: "めまいの強さ", label: "強さ", type: "single",
        showIf: (r) => hasVertigo(r),
        options: ["軽い", "中くらい", "強い（動けない）"] },
      { key: "fall", short: "ふらつき・転倒", label: "ふらつき・転倒", type: "single",
        options: ["なし", "ふらついた", "転びそうになった", "転倒した"] },
    ],
  },
  {
    title: "食事",
    fields: [
      { key: "meal", short: "食事量", label: "{meal}は食べられましたか", type: "single",
        options: ["しっかり食べた", "半分くらい", "少しだけ", "食べられなかった"] },
      { key: "meal_items", short: "食べたもの", label: "食べたもの", type: "multi",
        showIf: (r) => r.meal && r.meal !== "食べられなかった",
        options: ["ごはん・パン・麺", "肉・魚・卵", "豆腐・納豆", "野菜・海藻", "汁物・スープ",
                  "果物", "乳製品", "ゼリー・栄養補助食品", "お菓子・間食", "コーヒー・お茶"] },
      { key: "meal_reason", short: "食べられなかった理由", label: "食べられなかった理由", type: "multi",
        showIf: (r) => r.meal && r.meal !== "しっかり食べた",
        options: ["吐き気", "食欲がない", "起き上がれない", "めまいがつらい", "時間がなかった", "その他"] },
    ],
  },
  {
    title: "活動（前回の記録から今まで）",
    fields: [
      { key: "walk_min", short: "徒歩(分)", label: "徒歩", type: "minutes",
        options: [0, 10, 20, 30, 45, 60, 90, 120] },
      { key: "stretch_min", short: "ストレッチ施術(分)", label: "ストレッチ施術", type: "minutes",
        options: [0, 10, 20, 30, 40, 50, 60, 90] },
      { key: "desk_stand_min", short: "立位での事務(分)", label: "立って行う事務", type: "minutes",
        options: [0, 15, 30, 60, 90, 120, 180, 240] },
      { key: "desk_sit_min", short: "座位での事務(分)", label: "座って行う事務", type: "minutes",
        options: [0, 15, 30, 60, 90, 120, 180, 240] },
      { key: "activity_other", short: "その他の活動", label: "その他の活動（任意）", type: "text",
        placeholder: "例：買い物30分、家事20分、車の運転15分" },
    ],
  },
  {
    title: "1日のふりかえり",
    slotsOnly: ["夜"],
    fields: [
      { key: "upright_time", short: "起きて過ごせた時間", label: "横にならずに過ごせた時間（合計）", type: "single", slots: ["夜"],
        options: ["1時間未満", "1〜3時間", "3〜6時間", "6〜9時間", "9時間以上"] },
      { key: "activity", short: "活動", label: "今日の活動", type: "single", slots: ["夜"],
        options: ["普段どおり", "半分くらい", "少しだけ", "ほぼ寝ていた"] },
      { key: "water", short: "水分量", label: "水分をとった量", type: "single", slots: ["夜"],
        options: ["1L未満", "1〜1.5L", "1.5〜2L", "2L以上"] },
      { key: "meds", short: "定期薬", label: "いつもの薬", type: "single", slots: ["夜"],
        options: ["すべて飲んだ", "一部飲み忘れ", "飲まなかった", "定期薬なし"] },
      { key: "prn", short: "頓服", label: "頓服（追加で飲んだ薬）", type: "multi", slots: ["夜"], exclusive: "なし",
        options: ["なし", "痛み止め", "吐き気止め", "めまい止め", "その他"] },
      { key: "care", short: "処置・ケア", label: "した処置・ケア", type: "multi", slots: ["夜"], exclusive: "なし",
        options: ["なし", "安静・横になる", "めまい体操・耳石を戻す体操", "通院", "点滴",
                  "ブラッドパッチ", "その他"] },
      { key: "weather", short: "天気", label: "天気", type: "single", slots: ["夜"],
        options: ["晴れ", "くもり", "雨", "台風・低気圧"] },
      { key: "mood", short: "気分(1-5)", label: "気分", type: "scale5", slots: ["夜"],
        options: ["とてもつらい", "つらい", "ふつう", "良い", "とても良い"] },
    ],
  },
  {
    title: "危険なサイン（あれば必ずチェック）",
    danger: true,
    fields: [
      { key: "redflags", short: "危険なサイン", label: "あてはまるもの", type: "multi",
        options: ["突然の激しい頭痛", "意識がもうろう", "手足が動かしにくい", "ろれつが回らない",
                  "高熱と首の硬さ", "嘔吐が止まらない"] },
    ],
  },
  {
    title: "メモ（任意）",
    fields: [
      { key: "memo", short: "メモ", label: "医師や家族に伝えたいこと", type: "text" },
    ],
  },
];

function hasVertigo(r) {
  const v = r.vertigo;
  return Array.isArray(v) && v.length > 0 && !v.includes("なし");
}

window.ALL_FIELDS = window.FIELD_GROUPS.flatMap((g) => g.fields);

window.fieldVisible = function (f, slot, rec) {
  if (f.slots && !f.slots.includes(slot)) return false;
  if (f.showIf && !f.showIf(rec)) return false;
  return true;
};

window.fmtMin = function (n, last) {
  n = Number(n);
  if (!n) return "0分";
  const h = Math.floor(n / 60), m = n % 60;
  return (h ? h + "時間" : "") + (m ? m + "分" : "") + (last ? "以上" : "");
};

window.fmtValue = function (f, v) {
  if (v === undefined || v === null || v === "") return "";
  if (Array.isArray(v)) return v.join("・");
  if (f.type === "scale5") return `${v}（${f.options[Number(v) - 1] || ""}）`;
  return String(v);
};
