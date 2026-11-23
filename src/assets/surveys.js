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

/* 進路アンケート（2026年12月）。2026-11-23 きあ・MTG のメモから。
 * 1月の版（shinro_2027_jan_v1）は書きかえない（答えの形が変わるため、新しい key にした）。変えた所：
 *   ・JLPT に N5 を足した／JLPT 以外の試験（級を選ぶ4つ・点数を入れる3つ）を足した。点数は自己申告・「おぼえていない」可
 *   ・②の順番＝やりたい仕事 → 勉強したい分野 → 卒業後の進路（第1〜第3希望）→ 気になっている学校
 *   ・やりたい仕事は複数選べる
 * 級の名前は、各試験の公式サイトの表記（2026-11-23 に確認。合格証そのものの表記は見ていない。NAT-TEST は未確認）。
 * 文が1月の版と同じ質問は、そこから写す（同じ文を2か所に持たない）。 */
(function () {
  const jan = SURVEYS.find(s => s.key === "shinro_2027_jan_v1");
  const from = k => ({ ...jan.q.find(q => q.k === k) });
  const lv = (v, ja, en) => ({ v, ja, en: en || ja });
  const PATHS = [
    { v: "vocational_school", ja: "専門学校", en: "Vocational school" },
    { v: "university", ja: "大学", en: "University" },
    { v: "graduate_school", ja: "大学院", en: "Graduate school" },
    { v: "employment", ja: "就職", en: "Employment" },
  ];
  const score = (k, test, name, max) => ({ k, t: "number", section: "current", required: true, unknown: true, min: 0, max, sl: name + "の点数",
    showWhen: { key: "other_tests", is: test },
    l: { ja: name + "の点数（" + max + "点満点）", en: name + " score (out of " + max + ")" },
    hint: { ja: "おぼえていないときは、「おぼえていない」を選んでください。", en: "If you do not remember your score, choose “I do not remember”." },
    ph: { ja: "数字", en: "Number" } });
  const level = (k, test, name, o) => ({ k, t: "select", section: "current", required: true, sl: name + "の級",
    showWhen: { key: "other_tests", is: test },
    l: { ja: name + "で合格した級（いちばん上のもの）", en: "Highest " + name + " level you have passed" }, o });
  SURVEYS.push({ key: "shinro_2026_dec_v1", schemaVersion: 1,
    studentIdentity: true, sb: "Career", color: "#2f9e44",
    title: { ja: "進路アンケート（2026年12月）", en: "Career survey (December 2026)" },
    desc: { ...jan.desc }, intro: { ...jan.intro },
    sections: jan.sections.map(x => ({ ...x })),
    q: [
      { k: "jlpt_level", t: "select", section: "current", required: true, sl: "JLPT保有資格",
        l: { ja: "現在持っているJLPTの資格", en: "Which JLPT qualification do you currently hold?" },
        o: [lv("n1", "N1"), lv("n2", "N2"), lv("n3", "N3"), lv("n4", "N4"), lv("n5", "N5"),
          { v: "none", ja: "まだ持っていない", en: "I do not hold any yet" }] },
      { k: "other_tests", t: "multi", section: "current", required: true, sl: "JLPT以外の試験",
        l: { ja: "JLPT以外で、合格した・点数を持っている日本語の試験（複数選択可）", en: "Other Japanese tests you have passed or have a score for (select all that apply)" },
        exclusive: ["none"],
        o: [lv("jcert", "J-cert"), lv("jlct", "JLCT"), lv("topj", "TOPJ"), lv("nat", "NAT-TEST"),
          lv("jtest", "J.TEST"), lv("jpt", "JPT"), lv("jft", "JFT-Basic"),
          { v: "none", ja: "持っていない", en: "None" }] },
      level("jcert_level", "jcert", "J-cert", [lv("a1", "A1"), lv("a2_1", "A2.1（初級）", "A2.1"), lv("a2_2", "A2.2（準中級）", "A2.2"),
        lv("b1", "B1（中級）", "B1"), lv("b2", "B2（準上級）", "B2"), lv("c1", "C1（上級）", "C1")]),
      level("jlct_level", "jlct", "JLCT", [lv("jct5", "JCT5"), lv("jct4", "JCT4"), lv("jct3", "JCT3"), lv("jct2", "JCT2"), lv("jct1", "JCT1")]),
      level("topj_level", "topj", "TOPJ", [lv("sho_c", "初級C", "Beginner C"), lv("sho_b", "初級B", "Beginner B"),
        lv("sho_a5", "初級A-5", "Beginner A-5"), lv("sho_a4", "初級A-4", "Beginner A-4"),
        lv("chu_c", "中級C", "Intermediate C"), lv("chu_b", "中級B", "Intermediate B"), lv("chu_a", "中級A", "Intermediate A"),
        lv("jo_c", "上級C", "Advanced C"), lv("jo_b", "上級B", "Advanced B"), lv("jo_a", "上級A", "Advanced A")]),
      level("nat_level", "nat", "NAT-TEST", [lv("k5", "5級", "Level 5"), lv("k4", "4級", "Level 4"), lv("k3", "3級", "Level 3"),
        lv("k2", "2級", "Level 2"), lv("k1", "1級", "Level 1")]),
      { k: "jtest_kind", t: "select", section: "current", required: true, sl: "J.TESTの種類",
        showWhen: { key: "other_tests", is: "jtest" },
        l: { ja: "J.TESTで受けた試験の種類", en: "Which J.TEST did you take?" },
        o: [lv("ac", "A-Cレベル試験", "A-C level test"), lv("de", "D-Eレベル試験", "D-E level test"), lv("fg", "F-Gレベル試験", "F-G level test"),
          { v: "unknown", ja: "おぼえていない", en: "I do not remember" }] },
      score("jtest_score", "jtest", "J.TEST", 1000),
      score("jpt_score", "jpt", "JPT", 990),
      score("jft_score", "jft", "JFT-Basic", 250),
      from("future_exams"), from("future_exams_other"), from("education"), from("education_other"),
      { ...from("job"), t: "multi", exclusive: ["undecided"],
        l: { ja: "将来やってみたい仕事（複数選択可）", en: "What kind of work would you like to do in the future? (Select all that apply.)" } },
      from("job_other"),
      from("field_first"), from("field_first_other"), from("field_second"), from("field_second_other"),
      { k: "path_1", t: "select", section: "plans", required: true, sl: "卒業後の進路・第1希望",
        l: { ja: "卒業後の進路・第1希望", en: "What would you like to do after Japanese language school? First choice" },
        o: PATHS.concat([{ v: "undecided", ja: "まだ決まっていない・悩んでいる", en: "Not decided yet / still considering", flag: "進路未定" }]) },
      { k: "path_2", t: "select", section: "plans", sl: "卒業後の進路・第2希望",
        l: { ja: "卒業後の進路・第2希望（あれば）", en: "Second choice (if any)" }, o: PATHS.map(o => ({ ...o })) },
      { k: "path_3", t: "select", section: "plans", sl: "卒業後の進路・第3希望",
        l: { ja: "卒業後の進路・第3希望（あれば）", en: "Third choice (if any)" }, o: PATHS.map(o => ({ ...o })) },
      from("schools_status"), from("school_1"), from("school_2"), from("school_3"),
      from("areas"), from("oc_status"), from("oc_school"),
      from("funding"), from("family_status"), from("family_talk_by"),
      from("concerns"), from("interview_preference"),
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
