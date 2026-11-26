/* 学生ポータル アンケート定義（1か所で管理・多言語）
 * index.html（学生の回答画面）と master.html（管理画面の回答一覧）が同じこの配列を読む。
 * 1本足すときは配列に1件追加するだけ。DBの変更は要らない（回答は survey_responses に survey_key で入る）。
 *
 * 項目: key    … 回答の識別子（英小文字・数字・_ のみ。一度公開したら変えない）
 *       sb     … 行の小見出し（英語ラベル）   color … 行の色
 *       title  … 学生に見せる名前 {ja, en}（文体は各アンケートの原稿に合わせる）
 *       desc   … 一覧での説明 {ja, en}   intro … 回答画面の前置き {ja, en}（HTML可）
 *       q[]    … 質問。k=回答キー / t="select"|"text"|"multi"|"date" / l=質問文 {ja,en}
 *                sl=教師画面用の短い見出し（日本語）。multi の回答値は v の配列。
 *                select は o=[{v:保存する値, ja, en}]（保存されるのは v。言語が変わっても同じ値）
 *                text   は ph=入力例 {ja,en}
 *       schemaVersion / sections / studentIdentity … 新形式の設問版・大項目・本人情報表示。
 *       required / showWhen:{key,is} … 必須・条件表示（multi は is が配列に含まれるとき）。
 *       exclusive / exclusiveGroups … 複数選択の排他値・同時選択できない値の組合せ。
 *       previewOnly:true … 確認用の定義。追加だけでは本番の実施回を作らない。
 * 言語を足すときは各 {ja,en} にそのコードを足す。無い言語は日本語に落ちる。
 */
// 既存の field と同じ保存値・分野。今回の原稿は普通の日本語で表示する。
const CAREER_FIELDS_JAN_V1 = [
  { v: "it",       ja: "IT・コンピューター",       en: "IT / computers" },
  { v: "business", ja: "ビジネス・経営",           en: "Business / management" },
  { v: "trans",    ja: "通訳・翻訳",               en: "Interpreting / translation" },
  { v: "hotel",    ja: "観光・ホテル",             en: "Tourism / hotel" },
  { v: "care",     ja: "介護・医療",               en: "Care / medical" },
  { v: "design",   ja: "デザイン・アニメ・アート", en: "Design / anime / art" },
  { v: "cook",     ja: "料理・製菓",               en: "Cooking / confectionery" },
  { v: "auto",     ja: "自動車・機械",             en: "Automobile / machinery" },
  { v: "other",    ja: "その他",                   en: "Other" },
  { v: "unknown",  ja: "未定",                     en: "Not decided yet" },
];

const SURVEYS = [
  { key: "shinro_2026", sb: "Career", color: "#2f9e44",
    title: { ja: "しんろアンケート", en: "Career survey" },
    desc:  { ja: "しごと・ぶんや・まち", en: "Job, field, city" },
    intro: { ja: "しょうらいの ことを おしえてください。<br>まだ きまっていなくても、いま おもっていることで OK です。",
             en: "Tell us about your future plans.<br>It is fine if you have not decided yet — just what you think now." },
    q: [
      { k: "job", t: "text", sl: "しごと",
        l:  { ja: "やってみたい しごと", en: "A job you would like to try" },
        ph: { ja: "れい: つうやく、IT エンジニア、ホテルの しごと", en: "e.g. interpreter, IT engineer, hotel work" } },
      { k: "field", t: "select", sl: "ぶんや",
        l: { ja: "すすみたい ぶんや", en: "Field you want to go into" },
        o: [
          { v: "it",       ja: "IT・コンピューター",        en: "IT / computers" },
          { v: "business", ja: "ビジネス・けいえい",        en: "Business / management" },
          { v: "trans",    ja: "つうやく・ほんやく",        en: "Interpreting / translation" },
          { v: "hotel",    ja: "かんこう・ホテル",          en: "Tourism / hotel" },
          { v: "care",     ja: "かいご・いりょう",          en: "Care / medical" },
          { v: "design",   ja: "デザイン・アニメ・アート",  en: "Design / anime / art" },
          { v: "cook",     ja: "りょうり・せいか",          en: "Cooking / confectionery" },
          { v: "auto",     ja: "じどうしゃ・きかい",        en: "Automobile / machinery" },
          { v: "other",    ja: "そのほか",                  en: "Other" },
          { v: "unknown",  ja: "まだ わからない",           en: "Not sure yet" },
        ] },
      { k: "town", t: "text", sl: "まち",
        l:  { ja: "すみたい まち（はたらきたい まち）", en: "City where you want to live or work" },
        ph: { ja: "れい: 東京、大阪、京都", en: "e.g. Tokyo, Osaka, Kyoto" } },
    ] },

  { key: "seikatsu_sumai_2026", sb: "Life", color: "#7b5cd6",
    title: { ja: "すまいの アンケート", en: "Housing survey" },
    desc:  { ja: "いま すんでいる ところ・がっこうまでの じかん", en: "Where you live, commute time" },
    intro: { ja: "いまの せいかつの ことを おしえてください。", en: "Tell us about your daily life." },
    q: [
      { k: "home", t: "select", sl: "すまい",
        l: { ja: "いま どこに すんでいますか", en: "Where do you live now?" },
        o: [
          { v: "dorm",    ja: "がっこうの りょう",       en: "School dormitory" },
          { v: "alone",   ja: "アパート（ひとりで）",    en: "Apartment (alone)" },
          { v: "share",   ja: "アパート（ともだちと）",  en: "Apartment (with friends)" },
          { v: "relative",ja: "しんせきの いえ",         en: "Relative's house" },
          { v: "other",   ja: "そのほか",                en: "Other" },
        ] },
      { k: "commute", t: "select", sl: "つうがく",
        l: { ja: "がっこうまで どのくらい かかりますか", en: "How long is your trip to school?" },
        o: [
          { v: "u15",  ja: "15ふん いか",   en: "Under 15 min" },
          { v: "15_30",ja: "15〜30ぷん",    en: "15–30 min" },
          { v: "30_60",ja: "30〜60ぷん",    en: "30–60 min" },
          { v: "o60",  ja: "60ぷん いじょう", en: "Over 60 min" },
        ] },
      { k: "trouble", t: "text", sl: "こまりごと",
        l:  { ja: "すまいで こまっていることは ありますか", en: "Any problems with your housing?" },
        ph: { ja: "れい: へやが さむい、となりが うるさい（なければ 空欄で OK）", en: "e.g. room is cold, noisy neighbours (leave blank if none)" } },
    ] },

  { key: "seikatsu_kenko_2026", sb: "Life", color: "#0f9b8e",
    title: { ja: "アルバイトと けんこうの アンケート", en: "Part-time job & health survey" },
    desc:  { ja: "はたらく じかん・からだの ちょうし", en: "Working hours, how you feel" },
    intro: { ja: "むりを していないか、おしえてください。<br>こまっている ときは、せんせいが そうだんに のります。",
             en: "Let us know if things are getting too hard.<br>Teachers are here to help." },
    q: [
      { k: "work", t: "select", sl: "アルバイト",
        l: { ja: "アルバイトを していますか", en: "Do you have a part-time job?" },
        o: [
          { v: "none",  ja: "していない",              en: "No" },
          { v: "u10",   ja: "しゅうに 10じかん いか",  en: "Up to 10 hours a week" },
          { v: "10_20", ja: "しゅうに 10〜20じかん",   en: "10–20 hours a week" },
          { v: "20_28", ja: "しゅうに 20〜28じかん",   en: "20–28 hours a week" },
        ] },
      { k: "health", t: "select", sl: "ちょうし",
        l: { ja: "からだの ちょうしは どうですか", en: "How is your health?" },
        o: [
          { v: "good", ja: "とても いい",    en: "Very good" },
          { v: "ok",   ja: "ふつう",         en: "OK" },
          { v: "bad",  ja: "あまり よくない", en: "Not so good" },
        ] },
      { k: "sleep", t: "select", sl: "すいみん",
        l: { ja: "よる よく ねむれていますか", en: "Do you sleep well at night?" },
        o: [
          { v: "yes",       ja: "はい",              en: "Yes" },
          { v: "sometimes", ja: "ときどき ねむれない", en: "Sometimes I cannot sleep" },
          { v: "no",        ja: "よく ねむれない",     en: "I often cannot sleep" },
        ] },
    ] },

  { key: "gakuhi_2026", sb: "Tuition", color: "#c77700",
    title: { ja: "がくひの アンケート", en: "Tuition survey" },
    desc:  { ja: "つぎの がくひの しはらい", en: "Paying the next tuition" },
    intro: { ja: "つぎの がくひの ことを おしえてください。<br>こまっている ときは、はやめに そうだん できます。",
             en: "Tell us about your next tuition payment.<br>If it is difficult, you can talk to us early." },
    q: [
      { k: "payer", t: "select", sl: "はらう人",
        l: { ja: "つぎの がくひは だれが はらいますか", en: "Who will pay the next tuition?" },
        o: [
          { v: "self",    ja: "じぶん（アルバイトの おかね）", en: "Myself (from my part-time job)" },
          { v: "family",  ja: "かぞく",                     en: "My family" },
          { v: "both",    ja: "じぶんと かぞく",             en: "Myself and my family" },
          { v: "unknown", ja: "まだ わからない",             en: "Not sure yet" },
        ] },
      { k: "worry", t: "select", sl: "しんぱい",
        l: { ja: "しはらいに しんぱいが ありますか", en: "Are you worried about paying?" },
        o: [
          { v: "no",   ja: "ない",       en: "No" },
          { v: "some", ja: "すこし ある", en: "A little" },
          { v: "yes",  ja: "ある",       en: "Yes" },
        ] },
      { k: "consult", t: "select", sl: "そうだん",
        l: { ja: "がっこうに そうだん したいですか", en: "Would you like to talk to the school?" },
        o: [
          { v: "yes",   ja: "はい",             en: "Yes" },
          { v: "no",    ja: "いいえ",           en: "No" },
          { v: "later", ja: "あとで かんがえます", en: "I will think about it later" },
        ] },
    ] },

  // 2027年1月の進路アンケート。旧 shinro_2026 の定義・回答は変更しない。
  // まず日本語・英語で内容を確認し、確定後に母語版とネイティブ確認へ進む。
  // 実施対象の名簿・公開日・締切は実施回で設定する（教師画面 master.html の「回を はじめる」）。
  // 2026-11-15: previewOnly を外し、回を作れば学生のアプリに出るようにした。
  /* flag: "理由" ＝ 管理画面の結果で目立たせる選択肢（オレンジ・面談候補に入る。2026-11-16）。
     ★保存する値（v）は変えていない＝学生の画面と回答には影響しない。どれに付けるかは進路指導部で見直してよい。 */
  { key: "shinro_2027_jan_v1", schemaVersion: 1,
    studentIdentity: true, sb: "Career", color: "#2f9e44",
    title: { ja: "進路アンケート（2027年1月）", en: "Career survey (January 2027)" },
    desc: { ja: "進学・就職の希望、費用、面談について", en: "Your future plans, study costs and guidance needs" },
    intro: {
      ja: "今の考えを回答してください。まだ決まっていない項目は、未定を選べます。このアンケートは進路相談の準備に使います。",
      en: "Please tell us what you are thinking now. You can choose “Not decided yet” where available. This survey will help us prepare for your career guidance.",
    },
    sections: [
      { key: "current", title: { ja: "① あなたのこと・今の状況", en: "1. About you and your current situation" } },
      { key: "plans", title: { ja: "② これからの希望", en: "2. Your future plans" } },
      { key: "finance", title: { ja: "③ お金と家族のこと", en: "3. Study costs and your family" } },
      { key: "support", title: { ja: "④ 心配なことと面談の希望", en: "4. Your concerns and guidance preferences" } },
    ],
    q: [
      { k: "jlpt_level", t: "select", section: "current", required: true, sl: "JLPT保有資格",
        l: { ja: "現在持っているJLPTの資格（N4以上）", en: "Which JLPT qualification do you currently hold (N4 or above)?" },
        o: [
          { v: "n1", ja: "N1", en: "N1" },
          { v: "n2", ja: "N2", en: "N2" },
          { v: "n3", ja: "N3", en: "N3" },
          { v: "n4", ja: "N4", en: "N4" },
          { v: "none", ja: "N4以上はまだ持っていない", en: "I do not hold N4 or above yet" },
        ] },
      { k: "future_exams", t: "multi", section: "current", required: true, sl: "今後の受験予定",
        l: { ja: "これから受ける予定の試験（複数選択可・7月のJLPTは1つの級）", en: "Which exams do you plan to take? (Select all that apply; choose one level for the July JLPT.)" },
        exclusive: ["undecided"], exclusiveGroups: [["jlpt_n1", "jlpt_n2"]],
        o: [
          { v: "jlpt_n1", ja: "7月のJLPT N1", en: "JLPT N1 in July" },
          { v: "jlpt_n2", ja: "7月のJLPT N2", en: "JLPT N2 in July" },
          { v: "eju", ja: "EJU（日本留学試験）", en: "EJU (Examination for Japanese University Admission for International Students)" },
          { v: "other", ja: "その他", en: "Other" },
          { v: "undecided", ja: "まだ決まっていない", en: "Not decided yet" },
        ] },
      { k: "future_exams_other", t: "text", section: "current", required: true, maxLength: 200,
        showWhen: { key: "future_exams", is: "other" }, sl: "その他の受験予定",
        l: { ja: "その他の試験名", en: "Name of the other exam" },
        ph: { ja: "受ける予定の試験名を記入してください", en: "Enter the name of the exam you plan to take" } },
      { k: "education", t: "select", section: "current", required: true, sl: "母国の最終学歴",
        l: { ja: "母国で最後に卒業した学校", en: "What is the highest level of education you completed in your home country?" },
        o: [
          { v: "high_school", ja: "高校卒業", en: "High school" },
          { v: "vocational_or_junior_college", ja: "専門学校・短大卒業", en: "Vocational college / junior college" },
          { v: "university", ja: "大学卒業", en: "University" },
          { v: "other", ja: "その他", en: "Other" },
        ] },
      { k: "education_other", t: "text", section: "current", required: true, maxLength: 200,
        showWhen: { key: "education", is: "other" }, sl: "その他の最終学歴",
        l: { ja: "卒業した学校の種類", en: "Type of school you completed" },
        ph: { ja: "学校の種類を記入してください", en: "Enter the type of school" } },
      { k: "path", t: "select", section: "plans", required: true, sl: "希望進路",
        l: { ja: "希望する進路", en: "What would you like to do after Japanese language school?" },
        o: [
          { v: "vocational_school", ja: "専門学校", en: "Vocational school" },
          { v: "university", ja: "大学", en: "University" },
          { v: "graduate_school", ja: "大学院", en: "Graduate school" },
          { v: "employment", ja: "就職", en: "Employment" },
          { v: "undecided", ja: "まだ決まっていない・悩んでいる", en: "Not decided yet / still considering", flag: "進路未定" },
        ] },
      { k: "job", t: "select", section: "plans", required: true, sl: "希望する仕事",
        l: { ja: "将来やってみたい仕事", en: "What kind of work would you like to do in the future?" },
        o: [
          { v: "it_engineer", ja: "ITエンジニア", en: "IT engineer" },
          { v: "hotel_tourism", ja: "ホテル・観光", en: "Hotel / tourism" },
          { v: "automobile_maintenance", ja: "自動車整備", en: "Automobile maintenance" },
          { v: "trade_interpreting", ja: "貿易・通訳", en: "International trade / interpreting" },
          { v: "design_web", ja: "デザイン・WEB", en: "Design / web" },
          { v: "care", ja: "介護", en: "Care work" },
          { v: "business", ja: "ビジネス", en: "Business" },
          { v: "other", ja: "その他", en: "Other" },
          { v: "undecided", ja: "まだ決まっていない", en: "Not decided yet" },
        ] },
      { k: "job_other", t: "text", section: "plans", required: true, maxLength: 300,
        showWhen: { key: "job", is: "other" }, sl: "その他の希望職種",
        l: { ja: "やってみたい仕事を記入してください", en: "Please describe the work you would like to do" },
        ph: { ja: "仕事の名前や内容", en: "Job title or type of work" } },
      { k: "field_first", t: "select", section: "plans", required: true, sl: "第1希望の分野",
        l: { ja: "勉強したい分野・第1希望", en: "What would you like to study? First choice" },
        o: CAREER_FIELDS_JAN_V1.map(o => ({ ...o })) },
      { k: "field_first_other", t: "text", section: "plans", required: true, maxLength: 200,
        showWhen: { key: "field_first", is: "other" }, sl: "第1希望のその他分野",
        l: { ja: "第1希望の分野を記入してください", en: "Please enter your first-choice field" },
        ph: { ja: "勉強したい分野", en: "Field you would like to study" } },
      { k: "field_second", t: "select", section: "plans", required: true, sl: "第2希望の分野",
        l: { ja: "勉強したい分野・第2希望（未定でも可）", en: "What would you like to study? Second choice (you may choose “Not decided yet”)" },
        o: CAREER_FIELDS_JAN_V1.map(o => ({ ...o })) },
      { k: "field_second_other", t: "text", section: "plans", required: true, maxLength: 200,
        showWhen: { key: "field_second", is: "other" }, sl: "第2希望のその他分野",
        l: { ja: "第2希望の分野を記入してください", en: "Please enter your second-choice field" },
        ph: { ja: "勉強したい分野", en: "Field you would like to study" } },
      { k: "schools_status", t: "select", section: "plans", required: true, sl: "学校の検討状況",
        l: { ja: "気になっている学校はありますか", en: "Are there any schools you are interested in?" },
        o: [
          { v: "decided", ja: "気になっている学校がある", en: "Yes, I have some schools in mind" },
          { v: "undecided", ja: "全く決まっていない", en: "I have not decided on any schools yet" },
        ] },
      { k: "school_1", t: "text", section: "plans", required: true, maxLength: 200,
        showWhen: { key: "schools_status", is: "decided" }, sl: "第1希望の学校",
        l: { ja: "気になっている学校・第1希望", en: "School you are interested in: first choice" },
        ph: { ja: "学校名", en: "School name" } },
      { k: "school_2", t: "text", section: "plans", maxLength: 200,
        showWhen: { key: "schools_status", is: "decided" }, sl: "第2希望の学校",
        l: { ja: "気になっている学校・第2希望（任意）", en: "School you are interested in: second choice (optional)" },
        ph: { ja: "学校名", en: "School name" } },
      { k: "school_3", t: "text", section: "plans", maxLength: 200,
        showWhen: { key: "schools_status", is: "decided" }, sl: "第3希望の学校",
        l: { ja: "気になっている学校・第3希望（任意）", en: "School you are interested in: third choice (optional)" },
        ph: { ja: "学校名", en: "School name" } },
      { k: "areas", t: "multi", section: "plans", required: true, sl: "希望エリア",
        l: { ja: "進学先に希望する場所（複数選択可）", en: "Where would you like to study? (Select all that apply.)" },
        exclusive: ["anywhere"],
        o: [
          { v: "tokyo", ja: "東京都内", en: "Tokyo" },
          { v: "near_tokyo", ja: "神奈川・埼玉・千葉", en: "Kanagawa / Saitama / Chiba" },
          { v: "other_cities", ja: "大阪・京都・名古屋など", en: "Osaka / Kyoto / Nagoya and other cities" },
          { v: "commutable", ja: "今の家から通えるところ", en: "Somewhere I can commute to from my current home" },
          { v: "anywhere", ja: "日本全国どこでもよい", en: "Anywhere in Japan" },
        ] },
      { k: "oc_status", t: "select", section: "plans", required: true, sl: "学校見学の経験",
        l: { ja: "オープンキャンパス（学校見学）に行ったことがありますか", en: "Have you attended an open campus or visited a school?" },
        o: [
          { v: "yes", ja: "行ったことがある", en: "Yes" },
          { v: "no", ja: "まだ行ったことがない", en: "Not yet" },
        ] },
      { k: "oc_school", t: "text", section: "plans", required: true, maxLength: 400,
        showWhen: { key: "oc_status", is: "yes" }, sl: "見学した学校",
        l: { ja: "見学した学校の名前", en: "Name of the school or schools you visited" },
        ph: { ja: "学校名", en: "School name(s)" } },
      { k: "funding", t: "multi", section: "finance", required: true, sl: "学費の準備方法",
        l: { ja: "進学先の1年目の学費（目安80万〜130万円）をどのように準備する予定ですか（複数選択可）", en: "How do you plan to pay for your first year of further study (around JPY 800,000–1,300,000)? (Select all that apply.)" },
        exclusive: ["unknown"],
        o: [
          { v: "family", ja: "母国の家族から送ってもらう", en: "Money sent by my family in my home country" },
          { v: "savings", ja: "自分で貯めたお金から払う", en: "My savings" },
          { v: "part_time_installments", ja: "アルバイト代で分けて払いたい", en: "I would like to pay in installments using my part-time income" },
          { v: "scholarship_needed", ja: "奨学金がないと払えない", en: "I cannot pay without a scholarship", flag: "学費" },
          { v: "unknown", ja: "分からない・相談したい", en: "I am not sure / I would like advice", flag: "学費" },
        ] },
      { k: "family_status", t: "select", section: "finance", required: true, sl: "家族の同意",
        l: { ja: "進学について、家族と相談していますか", en: "Have you discussed your further study plans with your family?" },
        o: [
          { v: "agree", ja: "家族は賛成している", en: "My family agrees with my plans" },
          { v: "discussing", ja: "今、家族と相談している", en: "I am discussing my plans with my family" },
          { v: "not_yet", ja: "まだ家族に話していない", en: "I have not talked to my family yet", flag: "家族にまだ話していない" },
        ] },
      { k: "family_talk_by", t: "date", section: "finance", required: true,
        showWhen: { key: "family_status", is: "not_yet" }, sl: "家族と話す予定日",
        l: { ja: "いつまでに家族と話す予定ですか", en: "By what date do you plan to talk to your family?" } },
      { k: "concerns", t: "multi", section: "support", required: true, sl: "心配なこと",
        l: { ja: "今、心配なこと（いくつでも選べます）", en: "What are you worried about now? (Select all that apply.)" },
        exclusive: ["none"],
        o: [
          { v: "plans", ja: "やりたいことや行きたい学校が見つからない", en: "I cannot find work I want to do or a school I want to attend" },
          { v: "money", ja: "学費や生活費が払えるか心配", en: "I am worried about paying tuition or living costs", flag: "学費" },
          { v: "attendance", ja: "出席率が足りるか心配", en: "I am worried about my attendance rate", flag: "出席率" },
          { v: "japanese", ja: "日本語（面接や作文）に自信がない", en: "I am not confident in my Japanese for interviews or writing" },
          { v: "family_opposes", ja: "家族に反対されている", en: "My family is against my plans", flag: "家族に反対" },
          { v: "none", ja: "特になし", en: "No particular concerns" },
        ] },
      { k: "interview_preference", t: "select", section: "support", required: true, sl: "面談の希望",
        l: { ja: "先生との面談について", en: "When would you like to talk with a teacher?" },
        o: [
          { v: "soon", ja: "できるだけ早く相談したい", en: "I would like to talk as soon as possible", flag: "早く相談したい" },
          { v: "regular", ja: "通常の予定（1〜2月）でよい", en: "The regular schedule (January–February) is fine" },
        ] },
    ] },
];

/* 進路アンケート（2026年12月）。2026-11-23 きあ・MTG のメモから。12/15 の HR で、いちばん下のクラスも答える。
 * 1月の版（shinro_2027_jan_v1）は書きかえない（答えの形が変わるため、新しい key にした）。
 *
 * ■ 文の持ち方（easy:true の定義だけ）
 *   ja … ふつうの日本語。職員の画面・CSV・訳のもと
 *   jy … 学生に見せる やさしい日本語。ルビは ${漢字}(よみ)。日本語の画面では、こちらを出す
 *   en … 英語
 *   🔴 文を直すときは ja と jy の両方を直す（片方だけだと、職員が見ている文と学生が読んだ文がずれる）
 *   title・desc・intro は、一覧など ルビを出せない所にも出るので、ひらがなで書く
 *
 * ■ 1月の版との違い
 *   ・JLPT に N5／JLPT 以外の試験（点数を入れる3つ・級を選ぶ4つ）。任意。点数は自己申告・「おぼえていない」可
 *   ・次の JLPT で受けたい級（N3 を足した）と、ほかに受けたい試験（任意）を分けた
 *   ・②の順番＝やりたい仕事（複数）→ 勉強したい分野 → 卒業後の進路（第1〜第3希望）→ 気になっている学校
 *   ・進学先の場所の選択肢を、京都・大阪・その他関西・東京…に分けた
 * 級の名前は、各試験の公式サイトの表記（2026-11-23 に確認。合格証そのものの表記は見ていない）。 */
(function () {
  const o = (v, ja, jy, en, flag) => { const x = { v, ja, en: en || ja }; if (jy) x.jy = jy; if (flag) x.flag = flag; return x; };
  const OTHER = o("other", "その他", "そのほか", "Other");
  const FIELDS = [
    o("it", "IT・コンピューター", "IT・コンピューター", "IT / computers"),
    o("business", "ビジネス・経営", "ビジネス・${経営}(けいえい)", "Business / management"),
    o("trans", "通訳・翻訳", "${通訳}(つうやく)・${翻訳}(ほんやく)", "Interpreting / translation"),
    o("hotel", "観光・ホテル", "${観光}(かんこう)・ホテル", "Tourism / hotel"),
    o("care", "介護・医療", "${介護}(かいご)・${医療}(いりょう)", "Care / medical"),
    o("design", "デザイン・アニメ・アート", "デザイン・アニメ・アート", "Design / anime / art"),
    o("cook", "料理・製菓", "${料理}(りょうり)・お${菓子}(かし)", "Cooking / confectionery"),
    o("auto", "自動車・機械", "${自動車}(じどうしゃ)・${機械}(きかい)", "Automobile / machinery"),
    o("architecture", "建築", "${建築}(けんちく)", "Architecture / construction"),
    o("electric_cad", "電気・CAD", "${電気}(でんき)・CAD", "Electrical / CAD"),
    o("unknown", "未定", "まだ ${決}(き)まって いない", "Not decided yet"),
    OTHER,
  ];
  const PATHS = [
    o("vocational_school", "専門学校", "${専門学校}(せんもんがっこう)", "Vocational school"),
    o("university", "大学", "${大学}(だいがく)", "University"),
    o("graduate_school", "大学院", "${大学院}(だいがくいん)", "Graduate school"),
    o("employment", "就職", "${就職}(しゅうしょく)（${仕事}(しごと)を する）", "Employment"),
  ];
  const FORGOT_HINT = { ja: "おぼえていないときは、「おぼえていない」を選んでください。", jy: "おぼえていない ときは、「おぼえていない」を えらんで ください。",
    en: "If you do not remember your score, choose “I do not remember”." };
  const score = (k, test, name, max) => ({ k, t: "number", section: "current", unknown: true, min: 0, max, sl: name + "の点数",
    showWhen: { key: "other_tests", is: test },
    l: { ja: name + "の点数（" + max + "点満点）", jy: name + "の ${点数}(てんすう)（${満点}(まんてん)は " + max + "${点}(てん)）", en: name + " score (out of " + max + ")" },
    hint: FORGOT_HINT, ph: { ja: "数字", jy: "すうじ", en: "Number" } });
  const level = (k, test, name, opts) => ({ k, t: "select", section: "current", sl: name + "の級",
    showWhen: { key: "other_tests", is: test },
    l: { ja: name + "で合格した級（いちばん上のもの）", jy: name + "で ${合格}(ごうかく)した ${級}(きゅう)（いちばん ${上}(うえ)の もの）", en: "Highest " + name + " level you have passed" }, o: opts });
  /* 記入の欄は、既定で任意（2026-11-26 きあ：必須にすると「その他」を選ばなくなる・名前を忘れた人が「行っていない」にする）。必須にするときだけ true */
  const text = (k, section, parent, is, sl, ja, jy, en, phJa, phJy, phEn, maxLength, required) => ({ k, t: "text", section, required: required === true, maxLength,
    showWhen: { key: parent, is }, sl, l: { ja, jy, en }, ph: { ja: phJa, jy: phJy, en: phEn } });
  const kyu = n => o("k" + n, n + "級", n + "${級}(きゅう)", "Level " + n);
  const topj = (v, band, yomi, en, c) => o(v, band + c, "${" + band + "}(" + yomi + ")" + c, en + " " + c);

  /* layout:"chips"＝選択肢を丸いチップで詰めて並べる（スマホ向け・2026-11-26 きあが案Cを選んだ）。見た目だけで、答えの値は同じ */
  SURVEYS.push({ key: "shinro_2026_dec_v1", schemaVersion: 1, easy: true, layout: "chips",
    studentIdentity: true, sb: "Career", color: "#2f9e44",
    title: { ja: "しんろアンケート（2026年12月）", en: "Career survey (December 2026)" },
    desc: { ja: "しんがく・しごとの きぼう、おかね、めんだん", en: "Your future plans, study costs and guidance needs" },
    intro: {
      ja: "いまの かんがえを こたえて ください。まだ きまって いない ときは、「まだ きまって いない」を えらべます。<br>この アンケートは、しんろの そうだんの じゅんびに つかいます。しめきりまでは、なんかいでも だしなおせます。",
      en: "Please tell us what you are thinking now. You can choose “Not decided yet” where available.<br>This survey will help us prepare for your career guidance. You can submit again until the deadline.",
    },
    sections: [
      { key: "current", title: { ja: "① あなたのこと・今の状況", jy: "① あなたの こと・${今}(いま)の こと", en: "1. About you and your current situation" } },
      { key: "plans", title: { ja: "② これからの希望", jy: "② これからの ${希望}(きぼう)", en: "2. Your future plans" } },
      { key: "finance", title: { ja: "③ お金と家族のこと", jy: "③ お${金}(かね)と ${家族}(かぞく)の こと", en: "3. Study costs and your family" } },
      { key: "support", title: { ja: "④ 心配なことと面談の希望", jy: "④ ${心配}(しんぱい)な ことと ${面談}(めんだん)", en: "4. Your concerns and guidance preferences" } },
    ],
    q: [
      // ───── ① ─────
      { k: "jlpt_level", t: "select", section: "current", required: true, sl: "JLPT保有資格",
        l: { ja: "現在持っているJLPTの資格", jy: "${今}(いま) ${持}(も)っている JLPTの ${級}(きゅう)", en: "Which JLPT level do you currently hold?" },
        o: [o("n1", "N1"), o("n2", "N2"), o("n3", "N3"), o("n4", "N4"), o("n5", "N5"),
          o("none", "まだ持っていない", "まだ ${持}(も)って いない", "I do not hold any yet")] },
      /* 必須（2026-11-26 校長：持っていない人も「持っていない」を選ぶ） */
      { k: "other_tests", t: "multi", section: "current", required: true, sl: "JLPT以外の試験", exclusive: ["none"],
        l: { ja: "JLPT以外で、合格した・点数を持っている日本語の試験（複数選択可）",
          jy: "JLPTの ほかに ${持}(も)っている ${日本語}(にほんご)の ${試験}(しけん)（${合格}(ごうかく)した もの・${点数}(てんすう)が ある もの）",
          en: "Other Japanese tests you have passed or have a score for (select all that apply)" },
        o: [o("jpt", "JPT"), o("nat", "NAT-TEST"), o("jtest", "J.TEST"), o("jft", "JFT-Basic"), o("jcert", "J-cert"), o("jlct", "JLCT"), o("topj", "TOPJ"),
          o("none", "持っていない", "${持}(も)って いない", "None")] },
      score("jpt_score", "jpt", "JPT", 990),
      level("nat_level", "nat", "NAT-TEST", [kyu(5), kyu(4), kyu(3), kyu(2), kyu(1)]),
      { k: "jtest_kind", t: "select", section: "current", sl: "J.TESTの種類", showWhen: { key: "other_tests", is: "jtest" },
        l: { ja: "J.TESTで受けた試験の種類", jy: "J.TESTで ${受}(う)けた ${試験}(しけん)", en: "Which J.TEST did you take?" },
        o: [o("ac", "A-Cレベル試験", "A-Cレベル", "A-C level test"), o("de", "D-Eレベル試験", "D-Eレベル", "D-E level test"), o("fg", "F-Gレベル試験", "F-Gレベル", "F-G level test"),
          o("unknown", "おぼえていない", "おぼえていない", "I do not remember")] },
      score("jtest_score", "jtest", "J.TEST", 1000),
      score("jft_score", "jft", "JFT-Basic", 250),
      level("jcert_level", "jcert", "J-cert", [o("a1", "A1"), o("a2_1", "A2.1（初級）", "A2.1（${初級}(しょきゅう)）", "A2.1"),
        o("a2_2", "A2.2（準中級）", "A2.2（${準中級}(じゅんちゅうきゅう)）", "A2.2"), o("b1", "B1（中級）", "B1（${中級}(ちゅうきゅう)）", "B1"),
        o("b2", "B2（準上級）", "B2（${準上級}(じゅんじょうきゅう)）", "B2"), o("c1", "C1（上級）", "C1（${上級}(じょうきゅう)）", "C1")]),
      level("jlct_level", "jlct", "JLCT", [o("jct5", "JCT5"), o("jct4", "JCT4"), o("jct3", "JCT3"), o("jct2", "JCT2"), o("jct1", "JCT1")]),
      level("topj_level", "topj", "TOPJ", [
        topj("sho_c", "初級", "しょきゅう", "Beginner", "C"), topj("sho_b", "初級", "しょきゅう", "Beginner", "B"),
        topj("sho_a5", "初級", "しょきゅう", "Beginner", "A-5"), topj("sho_a4", "初級", "しょきゅう", "Beginner", "A-4"),
        topj("chu_c", "中級", "ちゅうきゅう", "Intermediate", "C"), topj("chu_b", "中級", "ちゅうきゅう", "Intermediate", "B"), topj("chu_a", "中級", "ちゅうきゅう", "Intermediate", "A"),
        topj("jo_c", "上級", "じょうきゅう", "Advanced", "C"), topj("jo_b", "上級", "じょうきゅう", "Advanced", "B"), topj("jo_a", "上級", "じょうきゅう", "Advanced", "A")]),
      { k: "other_exams", t: "multi", section: "current", sl: "ほかに受けたい試験",
        l: { ja: "ほかに受けたい試験（複数選択可）", jy: "ほかに ${受}(う)けたい ${試験}(しけん)", en: "Other exams you would like to take (select all that apply)" },
        o: [o("eju", "EJU（日本留学試験）", "EJU（${日本留学試験}(にほんりゅうがくしけん)）", "EJU (Examination for Japanese University Admission for International Students)"),
          o("jpt", "JPT"), OTHER] },   /* JPT は 2026-11-26 きあ */
      text("other_exams_other", "current", "other_exams", "other", "その他の受けたい試験", "その他の試験名", "${試験}(しけん)の ${名前}(なまえ)", "Name of the other exam",
        "受けたい試験名を記入してください", "しけんの なまえを かいて ください", "Enter the name of the exam", 200),
      { k: "education", t: "select", section: "current", required: true, sl: "母国の最終学歴",
        l: { ja: "母国で最後に卒業した学校", jy: "${国}(くに)で ${最後}(さいご)に ${卒業}(そつぎょう)した ${学校}(がっこう)", en: "What is the highest level of education you completed in your home country?" },
        o: [o("high_school", "高校卒業", "${高校}(こうこう)", "High school"),
          o("vocational_or_junior_college", "専門学校・短大卒業", "${専門学校}(せんもんがっこう)・${短期大学}(たんきだいがく)", "Vocational college / junior college"),
          o("university", "大学卒業", "${大学}(だいがく)", "University"), OTHER] },
      text("education_other", "current", "education", "other", "その他の最終学歴", "卒業した学校の種類", "${卒業}(そつぎょう)した ${学校}(がっこう)", "Type of school you completed",
        "学校の種類を記入してください", "どんな がっこうか かいて ください", "Enter the type of school", 200),

      // ───── ② ─────
      { k: "job", t: "multi", section: "plans", required: true, sl: "希望する仕事", exclusive: ["undecided"],
        l: { ja: "将来やってみたい仕事（複数選択可）", jy: "${将来}(しょうらい) やって みたい ${仕事}(しごと)", en: "What kind of work would you like to do in the future? (Select all that apply.)" },
        o: [o("it_engineer", "ITエンジニア", "ITエンジニア", "IT engineer"), o("hotel_tourism", "ホテル・観光", "ホテル・${観光}(かんこう)", "Hotel / tourism"),
          o("automobile_maintenance", "自動車整備", "${自動車}(じどうしゃ)の ${整備}(せいび)", "Automobile maintenance"),
          o("trade_interpreting", "貿易・通訳", "${貿易}(ぼうえき)・${通訳}(つうやく)", "International trade / interpreting"),
          o("design_web", "デザイン・WEB", "デザイン・WEB", "Design / web"), o("care", "介護", "${介護}(かいご)", "Care work"),
          o("business", "ビジネス", "ビジネス", "Business"),
          o("architecture", "建築", "${建築}(けんちく)", "Architecture / construction"),
          o("electric_cad", "電気・CAD", "${電気}(でんき)・CAD", "Electrical / CAD"),
          o("undecided", "まだ決まっていない", "まだ ${決}(き)まって いない", "Not decided yet"), OTHER] },
      text("job_other", "plans", "job", "other", "その他の希望職種", "やってみたい仕事を記入してください", "やって みたい ${仕事}(しごと)を ${書}(か)いて ください", "Please describe the work you would like to do",
        "仕事の名前や内容", "しごとの なまえ", "Job title or type of work", 300),
      { k: "field_first", t: "select", section: "plans", required: true, sl: "第1希望の分野",
        l: { ja: "勉強したい分野・第1希望", jy: "いちばん ${勉強}(べんきょう)したい こと（${第1希望}(だいいちきぼう)）", en: "What would you like to study? First choice" }, o: FIELDS.map(x => ({ ...x })) },
      text("field_first_other", "plans", "field_first", "other", "第1希望のその他分野", "第1希望の分野を記入してください", "${勉強}(べんきょう)したい ことを ${書}(か)いて ください（1ばん）", "Please enter your first-choice field",
        "勉強したい分野", "べんきょう したい こと", "Field you would like to study", 200),
      /* 2ばんは任意（2026-11-26 きあ：1つだけの学生もいる。必須だと困る） */
      { k: "field_second", t: "select", section: "plans", required: false, sl: "第2希望の分野",
        l: { ja: "勉強したい分野・第2希望（あれば）", jy: "2ばんめに ${勉強}(べんきょう)したい こと（${第2希望}(だいにきぼう)・あれば）", en: "What would you like to study? Second choice (you may choose “Not decided yet”)" }, o: FIELDS.map(x => ({ ...x })) },
      text("field_second_other", "plans", "field_second", "other", "第2希望のその他分野", "第2希望の分野を記入してください", "${勉強}(べんきょう)したい ことを ${書}(か)いて ください（2ばん）", "Please enter your second-choice field",
        "勉強したい分野", "べんきょう したい こと", "Field you would like to study", 200),
      { k: "path_1", t: "select", section: "plans", required: true, sl: "卒業後の進路・第1希望",
        l: { ja: "卒業後の進路・第1希望", jy: "この ${学校}(がっこう)を ${卒業}(そつぎょう)した あと、いちばん したい こと（${第1希望}(だいいちきぼう)）", en: "What would you like to do after Japanese language school? First choice" },
        o: PATHS.map(x => ({ ...x })).concat([o("undecided", "まだ決まっていない・悩んでいる", "まだ ${決}(き)まって いない・${考}(かんが)えて いる", "Not decided yet / still considering", "進路未定")]) },
      { k: "path_2", t: "select", section: "plans", sl: "卒業後の進路・第2希望",
        l: { ja: "卒業後の進路・第2希望（あれば）", jy: "この ${学校}(がっこう)を ${卒業}(そつぎょう)した あと、2ばんめに したい こと（${第2希望}(だいにきぼう)・あれば）", en: "Second choice (if any)" }, o: PATHS.map(x => ({ ...x })) },
      { k: "schools_status", t: "select", section: "plans", required: true, sl: "学校の検討状況",
        l: { ja: "気になっている学校はありますか", jy: "${行}(い)きたい ${学校}(がっこう)は ありますか", en: "Are there any schools you are interested in?" },
        o: [o("decided", "気になっている学校がある", "ある", "Yes, I have some schools in mind"),
          o("undecided", "全く決まっていない", "まだ ない", "I have not decided on any schools yet")] },
      text("school_1", "plans", "schools_status", "decided", "第1希望の学校", "気になっている学校・第1希望", "${行}(い)きたい ${学校}(がっこう)・1ばん", "School you are interested in: first choice", "学校名", "がっこうの なまえ", "School name", 200, true),
      text("school_2", "plans", "schools_status", "decided", "第2希望の学校", "気になっている学校・第2希望（任意）", "${行}(い)きたい ${学校}(がっこう)・2ばん（あれば）", "School you are interested in: second choice (optional)", "学校名", "がっこうの なまえ", "School name", 200, false),
      text("school_3", "plans", "schools_status", "decided", "第3希望の学校", "気になっている学校・第3希望（任意）", "${行}(い)きたい ${学校}(がっこう)・3ばん（あれば）", "School you are interested in: third choice (optional)", "学校名", "がっこうの なまえ", "School name", 200, false),
      { k: "areas", t: "multi", section: "plans", required: true, sl: "希望エリア", exclusive: ["anywhere"],
        /* 地図（japan-map.js）。codes＝都道府県コード／at＝札を置く場所（地図の座標・幅400）／label＝札の文。
           地図に無い選択肢（通える所・どこでも）は、下の一覧だけ。「どこでも」を選ぶと、地図の全部に色が付く（mapAll） */
        mapAll: ["anywhere"],
        map: {
          kyoto: { codes: ["26"], at: [128, 258], label: { ja: "京都", jy: "${京都}(きょうと)", en: "Kyoto" } },
          osaka: { codes: ["27"], at: [118, 388], label: { ja: "大阪", jy: "${大阪}(おおさか)", en: "Osaka" } },
          kansai_other: { codes: ["28", "29", "25", "30"], at: [52, 222], to: [143, 306], label: { ja: "関西のほか", jy: "${関西}(かんさい)の ほか", en: "Other Kansai" } },
          tokyo: { codes: ["13"], at: [338, 262], label: { ja: "東京", jy: "${東京}(とうきょう)", en: "Tokyo" } },
          near_tokyo: { codes: ["14", "11", "12"], at: [322, 345], to: [262, 300], label: { ja: "東京の近く", jy: "${東京}(とうきょう)の ${近}(ちか)く", en: "Near Tokyo" } },
          nagoya: { codes: ["23", "21", "24"], at: [212, 392], to: [196, 310], label: { ja: "名古屋", jy: "${名古屋}(なごや)", en: "Nagoya" } },
          fukushima: { codes: ["07"], at: [336, 205], label: { ja: "福島", jy: "${福島}(ふくしま)", en: "Fukushima" } },
          hiroshima: { codes: ["34"], at: [56, 300], label: { ja: "広島", jy: "${広島}(ひろしま)", en: "Hiroshima" } },
          fukuoka: { codes: ["40"], at: [52, 408], label: { ja: "福岡", jy: "${福岡}(ふくおか)", en: "Fukuoka" } },
          okinawa: { codes: ["47"], at: [52, 104], to: [50, 45], label: { ja: "沖縄", jy: "${沖縄}(おきなわ)", en: "Okinawa" } },
        },
        l: { ja: "進学先に希望する場所（複数選択可）", jy: "どこの ${学校}(がっこう)に ${行}(い)きたいですか（${場所}(ばしょ)）", en: "Where would you like to study? (Select all that apply.)" },
        o: [o("kyoto", "京都", "${京都}(きょうと)", "Kyoto"), o("osaka", "大阪", "${大阪}(おおさか)", "Osaka"),
          o("kansai_other", "その他の関西（兵庫・奈良・滋賀など）", "${関西}(かんさい)の ほかの ところ（${兵庫}(ひょうご)・${奈良}(なら)・${滋賀}(しが)など）", "Other parts of Kansai (Hyogo, Nara, Shiga, etc.)"),
          o("tokyo", "東京都内", "${東京}(とうきょう)", "Tokyo"),
          o("near_tokyo", "東京の近く（神奈川・埼玉・千葉など）", "${東京}(とうきょう)の ${近}(ちか)く（${神奈川}(かながわ)・${埼玉}(さいたま)・${千葉}(ちば)など）", "Near Tokyo (Kanagawa, Saitama, Chiba, etc.)"),
          o("nagoya", "名古屋とその近く", "${名古屋}(なごや)と その ${近}(ちか)く", "Nagoya and nearby"),
          o("fukushima", "福島", "${福島}(ふくしま)", "Fukushima"),
          o("hiroshima", "広島", "${広島}(ひろしま)", "Hiroshima"),
          o("fukuoka", "福岡", "${福岡}(ふくおか)", "Fukuoka"),
          o("okinawa", "沖縄", "${沖縄}(おきなわ)", "Okinawa"),
          o("commutable", "今の家から通えるところ", "${今}(いま)の ${家}(いえ)から ${通}(かよ)える ところ", "Somewhere I can commute to from my current home"),
          o("anywhere", "日本のどこでもよい", "${日本}(にほん)の どこでも いい", "Anywhere in Japan")] },
      { k: "oc_status", t: "select", section: "plans", required: true, sl: "学校見学の経験",
        l: { ja: "オープンキャンパス（学校見学）に行ったことがありますか", jy: "オープンキャンパス（${学校}(がっこう)を ${見}(み)に ${行}(い)く こと）に ${行}(い)った ことが ありますか", en: "Have you attended an open campus or visited a school?" },
        o: [o("yes", "行ったことがある", "ある", "Yes"), o("no", "まだ行ったことがない", "まだ ない", "Not yet")] },
      text("oc_school", "plans", "oc_status", "yes", "見学した学校", "見学した学校の名前", "${見}(み)に ${行}(い)った ${学校}(がっこう)の ${名前}(なまえ)", "Name of the school or schools you visited", "学校名", "がっこうの なまえ", "School name(s)", 400),

      // ───── ③ ─────
      { k: "funding", t: "multi", section: "finance", required: true, sl: "学費の準備方法", exclusive: ["unknown"],
        l: { ja: "進学先の1年目の学費（目安80万〜130万円）をどのように準備する予定ですか（複数選択可）",
          jy: "${次}(つぎ)の ${学校}(がっこう)の 1${年目}(ねんめ)の お${金}(かね)（80${万円}(まんえん)〜130${万円}(まんえん)ぐらい）は、どう しますか",
          en: "How do you plan to pay for your first year of further study (around JPY 800,000–1,300,000)? (Select all that apply.)" },
        o: [o("family", "母国の家族から送ってもらう", "${国}(くに)の ${家族}(かぞく)に ${送}(おく)って もらう", "Money sent by my family in my home country"),
          o("savings", "自分で貯めたお金から払う", "${自分}(じぶん)で ためた お${金}(かね)で ${払}(はら)う", "My savings"),
          o("part_time_installments", "アルバイト代で分けて払いたい", "アルバイトの お${金}(かね)で、${少}(すこ)しずつ ${払}(はら)いたい", "I would like to pay in installments using my part-time income"),
          o("scholarship_needed", "奨学金がないと払えない", "${奨学金}(しょうがくきん)が ないと ${払}(はら)えない", "I cannot pay without a scholarship", "学費"),
          o("unknown", "分からない・相談したい", "わからない・${相談}(そうだん)したい", "I am not sure / I would like advice", "学費")] },
      { k: "family_status", t: "select", section: "finance", required: true, sl: "家族の同意",
        l: { ja: "進学について、家族と相談していますか", jy: "${次}(つぎ)の ${学校}(がっこう)の ことを、${家族}(かぞく)と ${話}(はな)して いますか", en: "Have you discussed your further study plans with your family?" },
        o: [o("agree", "家族は賛成している", "${家族}(かぞく)は 「いい」と ${言}(い)って いる", "My family agrees with my plans"),
          o("discussing", "今、家族と相談している", "${今}(いま)、${家族}(かぞく)と ${話}(はな)して いる", "I am discussing my plans with my family"),
          o("not_yet", "まだ家族に話していない", "まだ ${家族}(かぞく)に ${話}(はな)して いない", "I have not talked to my family yet", "家族にまだ話していない")] },
      { k: "family_talk_by", t: "date", section: "finance", required: true, showWhen: { key: "family_status", is: "not_yet" }, sl: "家族と話す予定日",
        l: { ja: "いつまでに家族と話す予定ですか", jy: "いつまでに ${家族}(かぞく)と ${話}(はな)しますか", en: "By what date do you plan to talk to your family?" } },

      // ───── ④ ─────
      { k: "concerns", t: "multi", section: "support", required: true, sl: "心配なこと", exclusive: ["none"],
        l: { ja: "進路のことで、今心配なこと（いくつでも選べます）", jy: "${進路}(しんろ)の ことで、${今}(いま) ${心配}(しんぱい)な こと", en: "What are you worried about now regarding your future plans? (Select all that apply.)" },
        o: [o("plans", "やりたいことや行きたい学校が見つからない", "やりたい ことや ${行}(い)きたい ${学校}(がっこう)が ${見}(み)つからない", "I cannot find work I want to do or a school I want to attend"),
          o("money", "学費や生活費が払えるか心配", "${学校}(がっこう)の お${金}(かね)や ${生活}(せいかつ)の お${金}(かね)が ${払}(はら)えるか ${心配}(しんぱい)", "I am worried about paying tuition or living costs", "学費"),
          o("attendance", "出席率が足りるか心配", "${出席率}(しゅっせきりつ)が ${足}(た)りるか ${心配}(しんぱい)", "I am worried about my attendance rate", "出席率"),
          o("japanese", "日本語（面接や作文）に自信がない", "${日本語}(にほんご)（${面接}(めんせつ)や ${作文}(さくぶん)）が ${心配}(しんぱい)", "I am not confident in my Japanese for interviews or writing"),
          o("family_opposes", "家族に反対されている", "${家族}(かぞく)が 「だめ」と ${言}(い)って いる", "My family is against my plans", "家族に反対"),
          o("none", "特になし", "ない", "No particular concerns")] },
      { k: "interview_preference", t: "select", section: "support", required: true, sl: "面談の希望",
        l: { ja: "先生との面談について", jy: "${先生}(せんせい)との ${面談}(めんだん)（${話}(はな)す こと）", en: "When would you like to talk with a teacher?" },
        o: [o("soon", "できるだけ早く相談したい", "できるだけ ${早}(はや)く ${相談}(そうだん)したい", "I would like to talk as soon as possible", "早く相談したい"),
          o("regular", "通常の予定（1〜2月）でよい", "いつもの ${予定}(よてい)（1${月}(がつ)〜2${月}(がつ)）で いい", "The regular schedule (January–February) is fine")] },
    ] });
})();

/* 教師画面用: 保存された値（v）→ 日本語の選択肢名。昔の回答（日本語の文がそのまま入っている）はそのまま返す */
function optLabel(q, v) {
  if (v == null || v === "") return "";
  if (q.t === "date" && /^\d{4}-\d{2}-\d{2}$/.test(String(v))) {
    const date = new Date(String(v) + "T00:00:00Z");
    if (!Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === v) {
      const parts = String(v).split("-");
      return parts[0] + "年" + Number(parts[1]) + "月" + Number(parts[2]) + "日";
    }
  }
  if (q.t === "number" && v === "unknown") return "おぼえていない";
  if ((q.t !== "select" && q.t !== "multi") || !q.o) return String(v);
  const label = value => {
    const hit = q.o.find(o => o.v === value || o.ja === value || o.en === value);
    return hit ? hit.ja : String(value);
  };
  return Array.isArray(v) ? v.map(label).join("／") : label(v);
}
