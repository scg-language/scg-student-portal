/* 学生ポータル 文言（多言語）— 1か所で管理
 * 画面の文言はここに書き、HTML側は data-i18n="キー" で参照する。JS側は t("キー") / tx({ja,en}) を使う。
 * 言語の追加: ① LANGS に ready:true を付ける ② I18N[コード] を ja と同じキーで埋める
 *            ③ surveys.js の {ja,en} にそのコードを足す。無いキーは日本語に落ちる（画面が空にならない）。
 * 選んだ言語は localStorage "sp_lang" に保存し、次に開いたときもその言語で出る。
 * 翻訳の確認は学校の翻訳確認スタッフ（中国語・ネパール語・ミャンマー語・シンハラ語）に回す前提。
 */
const LANGS = [
  { code: "ja", native: "日本語",   en: "Japanese", ready: true },
  { code: "en", native: "English",  en: "English",  ready: true },
  { code: "zh", native: "中文",     en: "Chinese" },
  { code: "ne", native: "नेपाली",   en: "Nepali" },
  { code: "my", native: "မြန်မာ",   en: "Burmese" },
  { code: "si", native: "සිංහල",   en: "Sinhala" },
  { code: "bn", native: "বাংলা",    en: "Bengali" },
];

const I18N = {
  ja: {
    "app.title": "学生ポータル", "app.for": "for 学生", "app.footer": "SCG 学生ポータル（デモ）",
    "lang.soon": "じゅんびちゅう",
    "login.title": "ログイン", "login.no": "がくせきばんごう（学籍番号）", "login.pw": "パスワード",
    "pw.show": "パスワードを見る", "pw.hide": "パスワードをかくす",
    "login.btn": "ログイン", "login.busy": "ログインしています…", "login.need": "番号とパスワードを入れてください",
    "err.badlogin": "番号かパスワードがちがいます", "err.login": "ログインできませんでした（{s}）",
    "err.noprofile": "プロフィールが見つかりません", "err.read": "読み込みに失敗しました（{s}）",
    "err.send": "送信に失敗しました（{s}）", "err.relogin": "再ログインしてください",
    "my.san": "{name} さん", "my.noclass": "クラス未設定",
    "my.now": "いま動きます", "my.soon": "これから作る画面（イメージ）",
    "my.quiz": "テストを うける", "my.quiz.ds": "せんたくしから えらぶ もんだい。すぐに てんすうが でます",
    "my.survey": "アンケートに こたえる", "my.survey.ds": "しんろ・すまい・アルバイト・がくひ の 4つ",
    "my.grades": "せいせき（成績）", "my.grades.ds": "JLPT・JPT・定期試験・模試・出席率",
    "my.news": "おしらせ", "my.news.ds": "試験の日程・休みの期間・大事な連絡",
    "my.jobs": "アルバイト", "my.jobs.ds": "求人と、28時間ルールの注意",
    "my.schools": "しんがく先の情報", "my.schools.ds": "専門学校・大学の一覧と出願の締切",
    "my.voices": "せんぱいの声", "my.voices.ds": "いま進学先にいる卒業生へのインタビュー",
    "my.logout": "ログアウト",
    "q.back": "もどる", "q.loading": "よみこみ中…", "q.none": "いま うけられるテストは ありません",
    // 実施回（先生が「はじめる」を押した回）には おわる じかんが ある
    "q.left": "あと {n}ふん", "q.timeup": "じかんが おわりました。せんせいに いってください。",
    "q.noq": "もんだいが ありません", "q.prompt": "（　）に なにを いれますか。 ",
    "q.next": "つぎへ", "q.submit": "ていしゅつ する", "sv.submit": "そうしん（送信）", "q.sending": "そうしん中…",
    "q.fail": "そうしんできませんでした。もういちど おしてください。（{msg}）",
    // 2026-11-18: 小テストは1回だけ。出した テストは 一覧で「ずみ」と てんすう を見せる
    "q.done": "ていしゅつ ずみ", "q.done.score": "{s} / {total}もん",
    "q.already": "この テストは もう ていしゅつ しました。",
    // 下書きの保存ぐあい。「ほぞん」と「そうしん（提出）」は べつのことば にする
    "q.sv.saving": "ほぞん中…", "q.sv.saved": "✓ ここまで ほぞんしました",
    "q.sv.pend": "⚠ {n}もん まだ おくれていません（あとで じどうで おくります）",
    "q.sv.resumed": "まえの つづきから はじめます（{n}もん ほぞんずみ）",
    "r.of": "/ {total}もん", "r.check": "もんだいごとの けっか", "r.ans": "せいかい", "r.home": "ホームに もどる",
    "q.prev": "もどる", "q.quit": "やめる", "q.quit.q": "テストを やめますか？",
    "q.quit.body": "こたえは ほぞん して あります。\nあとで つづきから できます。",
    "q.quit.yes": "やめる", "q.quit.no": "つづける",
    "q.sub.q": "ていしゅつ しますか？", "q.sub.all": "{n}もん ぜんぶ こたえました。ていしゅつ したら なおせません。",
    "q.sub.left": "まだ {n}もん こたえて いません。ていしゅつ したら なおせません。",
    "q.sub.goto": "もんだい {n} を みなおす", "q.sub.hint": "ばんごうを おすと その もんだいに もどります", "q.sub.back": "みなおす",
    "r.title": "けっか", "r.tap": "おすと こたえが みられます", "r.ring": "{total}もん中 {s}もん せいかい",
    "r.mk": "もんだい {n}：{w}", "r.ok": "せいかい", "r.ng": "まちがい", "r.qn": "もんだい {n}",
    "r.ok.t": "せいかい！", "r.ng.t": "ざんねん…", "r.mine": "あなたの こたえ", "r.blank": "こたえて いません",
    "r.tip": "ポイント", "r.gotit": "わかった",
    "r.prev.up": "まえの テストより +{n}もん", "r.prev.down": "まえの テストより -{n}もん", "r.prev.same": "まえの テストと おなじ",
    "r.prev.t": "まえの テスト", "r.prev.sub": "{d}：{s} / {total}もん",
    "sv.title": "アンケート", "sv.badge.all": "ぜんぶ ていしゅつ済み", "sv.badge.n": "{n}／{t} ていしゅつ済み",
    "sv.none": "いま こたえられる アンケートは ありません",
    "sv.done": "ていしゅつ済み", "sv.doneds": "{d} に ていしゅつ。なおして もういちど だせます",
    "sv.choose": "えらんで ください", "sv.min1": "1つ以上 こたえてください",
    "sv.prev": "ていしゅつ済みです。なおして もういちど そうしん できます。", "sv.resubmit": "なおして そうしん",
    "sv.received": "「{title}」を うけとりました。ありがとうございます！",
    "sv.close": "とじる", "sv.prevpage": "まえへ", "sv.nextpage": "つぎへ", "sv.step": "{n} / {t}",
    "sv.pageerr": "この ページに まだ こたえて いない ところが あります。",
    "sv.quit.q": "とちゅうで やめますか？",
    "sv.quit.body": "こたえは まだ そうしん して いません。\nあとで つづきから できますが、ログアウトするか ページを とじると きえます。",
    "sv.quit.yes": "やめる", "sv.quit.no": "つづける",
    "sv.done.t": "うけとりました", "sv.done.when": "{d} に そうしん しました",
    "sv.done.note": "ありがとうございます。しめきり までは、いちらんから こたえを なおせます。",
    "sv.done.view": "こたえを みる", "sv.done.list": "アンケートの いちらんへ", "sv.done.home": "ホームへ",
    "sv.copy.t": "あなたの こたえ", "sv.copy.empty": "（こたえて いません）",
    /* しけんの ひ（ログインしなくても見える）。日付は {M}月{D}日（{W}）の形で組む */
    "ex.title": "つぎの しけん", "ex.date": "{M}月{D}日（{W}）",
    "ex.wd": "日,月,火,水,木,金,土", "ex.mn": "1,2,3,4,5,6,7,8,9,10,11,12",
    "ex.days": "あと {n}にち", "ex.today": "きょう です", "ex.tomorrow": "あした です",
    "ex.result": "けっかは {d} に でます", "ex.result.lag": "けっかは あとで でます",
    "ex.inschool": "がっこうで うけます",
    "ex.none": "つぎの しけんは まだ きまっていません",
    "ex.g.1年生": "1ねんせい", "ex.g.2年生": "2ねんせい",
    // 2026-11 新デザイン（ホーム・タブ・下から出るシート・マイ）
    "home.greet.m": "おはよう ございます", "home.greet.a": "こんにちは", "home.greet.e": "こんばんは", "home.sep": "、",
    "hero.todo": "まだ こたえて いません", "hero.start": "はじめる", "hero.due": "しめきり {d}",
    "hero.more": "ほかに {n}つ あります", "hero.alldone": "アンケートは ぜんぶ ていしゅつ済み", "hero.view": "みる",
    "tile.quiz": "テスト", "tile.quiz.n": "{n}つ うけられます", "tile.quiz.none": "いまは ありません", "tile.quiz.go": "ひらく",
    "tile.exam": "つぎの しけん",
    "menu.title": "メニュー", "menu.survey": "アンケート", "menu.quiz": "テスト", "menu.grades": "せいせき",
    "menu.news": "おしらせ", "menu.schools": "しんがく先", "menu.voices": "せんぱいの声", "menu.jobs": "アルバイト",
    "menu.exams": "しけんの ひ", "menu.mock": "イメージ",
    "menu.mocknote": "「イメージ」の ついた がめんは まだ 見本です（データは ダミー）",
    "tab.home": "ホーム", "tab.learn": "まなぶ", "tab.news": "おしらせ", "tab.me": "マイ",
    "set.title": "マイ", "set.section": "せってい", "set.lang": "ことば", "set.size": "もじの おおきさ",
    "set.size.s": "ちいさい", "set.size.m": "ふつう", "set.size.l": "おおきい",
    "set.a2hs": "ホーム画面に ついかする",
    "set.a2hs.ios": "iPhone：Safari の きょうゆう ボタン →「ホーム画面に追加」",
    "set.a2hs.android": "Android：Chrome の ︙ メニュー →「ホーム画面に追加」",
    "set.logout.q": "ログアウト しますか？", "set.logout.body": "つぎは 学籍番号と パスワードで ログインします。",
    "set.cancel": "キャンセル", "sheet.close": "とじる",
    "set.pw": "パスワードを かえる",
    "pw.title": "パスワードを かえる", "pw.title.first": "あたらしい パスワードを きめましょう",
    "pw.lead.first": "いまの パスワードは はじめの パスワードです。じぶんだけの パスワードに かえてください。",
    "pw.rule1": "えいご（a〜z）と すうじ（0〜9）を まぜて 8もじ いじょう",
    "pw.rule2": "たんじょうび・なまえ・学籍番号 だけ は つかわない",
    "pw.new": "あたらしい パスワード", "pw.new2": "もういちど（おなじ パスワード）",
    "pw.save": "きめる", "pw.busy": "かえています…", "pw.back": "もどる",
    "pw.forget": "わすれたら せんせいに いってください。すぐ もどせます。",
    "pw.done": "パスワードを かえました",
    "pw.done.save": "ブラウザが「パスワードを ほぞん しますか？」と きいたら「ほぞん」を おしましょう。つぎから じどうで はいります。\nスクリーンショットは とらないでください（しゃしんを ともだちに みせたとき みえて しまいます）。",
    "pw.err.empty": "あたらしい パスワードを いれてください",
    "pw.err.ascii": "えいごと すうじ だけで いれてください（にほんごの にゅうりょく・スペースは つかえません）",
    "pw.err.len": "8もじ いじょうに してください",
    "pw.err.chars": "えいご と すうじ を りょうほう いれてください",
    "pw.err.initial": "はじめの パスワードとは ちがう パスワードに してください",
    "pw.err.match": "2つの パスワードが ちがいます。もういちど いれてください",
    "pw.err.pwned": "この パスワードは よく つかわれていて、あぶないです（ほかの ひとに しられています）。ちがう パスワードに してください",
    "pw.err.weak": "この パスワードは つかえません。ちがう パスワードに してください",
    "pw.err.same": "いまと おなじ パスワードです。ちがう パスワードに してください",
    "pw.err.reauth": "もういちど ログインしてから、かえてください",
    "pw.err.other": "かえられませんでした（{s}）。せんせいに いってください",
    "sv.sheet.q": "しつもん", "sv.sheet.sec": "まとまり", "sv.sheet.due": "しめきり",
  },
  en: {
    "app.title": "Student Portal", "app.for": "for students", "app.footer": "SCG Student Portal (demo)",
    "lang.soon": "coming soon",
    "login.title": "Log in", "login.no": "Student number", "login.pw": "Password",
    "pw.show": "Show password", "pw.hide": "Hide password",
    "login.btn": "Log in", "login.busy": "Logging in…", "login.need": "Please enter your number and password.",
    "err.badlogin": "Wrong student number or password.", "err.login": "Could not log in ({s})",
    "err.noprofile": "Profile not found.", "err.read": "Could not load ({s})",
    "err.send": "Could not send ({s})", "err.relogin": "Please log in again.",
    "my.san": "{name}", "my.noclass": "No class set",
    "my.now": "Working now", "my.soon": "Coming soon (mock-ups)",
    "my.quiz": "Take a quiz", "my.quiz.ds": "Choose one answer. You get your score right away.",
    "my.survey": "Answer surveys", "my.survey.ds": "Career, housing, part-time job, tuition — 4 surveys",
    "my.grades": "Grades", "my.grades.ds": "JLPT, JPT, term exams, mock exams, attendance",
    "my.news": "News", "my.news.ds": "Exam dates, holidays, important notices",
    "my.jobs": "Part-time jobs", "my.jobs.ds": "Job openings and the 28-hour rule",
    "my.schools": "Schools & courses", "my.schools.ds": "Vocational schools, universities, deadlines",
    "my.voices": "Senior voices", "my.voices.ds": "Interviews with graduates now at their schools",
    "my.logout": "Log out",
    "q.back": "Back", "q.loading": "Loading…", "q.none": "No quiz is open right now.",
    "q.left": "{n} min left", "q.timeup": "Time is up. Please tell your teacher.",
    "q.noq": "This quiz has no questions.", "q.prompt": "What goes in (  )?  ",
    "q.next": "Next", "q.submit": "Submit", "sv.submit": "Submit", "q.sending": "Sending…",
    "q.fail": "Could not send. Please try again. ({msg})",
    "q.done": "Submitted", "q.done.score": "{s} / {total}",
    "q.already": "You have already submitted this quiz.",
    "q.sv.saving": "Saving…", "q.sv.saved": "✓ Saved up to here",
    "q.sv.pend": "⚠ {n} answer(s) not sent yet (will be sent automatically)",
    "q.sv.resumed": "Continuing from where you left off ({n} saved)",
    "r.of": "out of {total}", "r.check": "Each question", "r.ans": "Correct answer", "r.home": "Back to Home",
    "q.prev": "Back", "q.quit": "Quit", "q.quit.q": "Quit this quiz?",
    "q.quit.body": "Your answers are saved.\nYou can continue later.",
    "q.quit.yes": "Quit", "q.quit.no": "Keep going",
    "q.sub.q": "Submit now?", "q.sub.all": "You answered all {n} questions. You cannot change them after you submit.",
    "q.sub.left": "{n} question(s) are not answered yet. You cannot change them after you submit.",
    "q.sub.goto": "Review question {n}", "q.sub.hint": "Tap a number to go back to that question", "q.sub.back": "Review",
    "r.title": "Result", "r.tap": "Tap to see the answer", "r.ring": "{s} of {total} correct",
    "r.mk": "Question {n}: {w}", "r.ok": "correct", "r.ng": "wrong", "r.qn": "Question {n}",
    "r.ok.t": "Correct!", "r.ng.t": "Not quite…", "r.mine": "Your answer", "r.blank": "Not answered",
    "r.tip": "Point", "r.gotit": "Got it",
    "r.prev.up": "+{n} from your last quiz", "r.prev.down": "-{n} from your last quiz", "r.prev.same": "Same as your last quiz",
    "r.prev.t": "Your last quiz", "r.prev.sub": "{d}: {s} / {total}",
    "sv.title": "Surveys", "sv.badge.all": "All submitted", "sv.badge.n": "{n}/{t} submitted",
    "sv.none": "No surveys are open right now.",
    "sv.done": "Submitted", "sv.doneds": "Submitted on {d}. You can edit and send again.",
    "sv.choose": "Please choose", "sv.min1": "Please answer at least one question.",
    "sv.prev": "Already submitted. You can edit and send again.", "sv.resubmit": "Update & submit",
    "sv.received": "Received “{title}”. Thank you!",
    "sv.close": "Close", "sv.prevpage": "Back", "sv.nextpage": "Next", "sv.step": "{n} / {t}",
    "sv.pageerr": "Some questions on this page are not answered yet.",
    "sv.quit.q": "Stop for now?",
    "sv.quit.body": "Your answers have not been sent yet.\nYou can continue later, but they will be lost if you log out or close this page.",
    "sv.quit.yes": "Stop", "sv.quit.no": "Keep going",
    "sv.done.t": "Received", "sv.done.when": "Sent on {d}",
    "sv.done.note": "Thank you. You can change your answers from the survey list until the deadline.",
    "sv.done.view": "See your answers", "sv.done.list": "Back to surveys", "sv.done.home": "Home",
    "sv.copy.t": "Your answers", "sv.copy.empty": "(not answered)",
    "ex.title": "Next exams", "ex.date": "{W}, {M} {D}",
    "ex.wd": "Sun,Mon,Tue,Wed,Thu,Fri,Sat",
    "ex.mn": "Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec",
    "ex.days": "{n} days left", "ex.today": "Today", "ex.tomorrow": "Tomorrow",
    "ex.result": "Results on {d}", "ex.result.lag": "Results come later",
    "ex.inschool": "Held at school",
    "ex.none": "The next exam date has not been decided yet.",
    "ex.g.1年生": "Year 1", "ex.g.2年生": "Year 2",
    "home.greet.m": "Good morning", "home.greet.a": "Hello", "home.greet.e": "Good evening", "home.sep": ", ",
    "hero.todo": "Not answered yet", "hero.start": "Start", "hero.due": "Due {d}",
    "hero.more": "{n} more", "hero.alldone": "All surveys submitted", "hero.view": "View",
    "tile.quiz": "Quizzes", "tile.quiz.n": "{n} open now", "tile.quiz.none": "None right now", "tile.quiz.go": "Open",
    "tile.exam": "Next exam",
    "menu.title": "Menu", "menu.survey": "Surveys", "menu.quiz": "Quizzes", "menu.grades": "Grades",
    "menu.news": "News", "menu.schools": "Schools", "menu.voices": "Senior voices", "menu.jobs": "Part-time jobs",
    "menu.exams": "Exam dates", "menu.mock": "Preview",
    "menu.mocknote": "Screens marked “Preview” are samples (dummy data).",
    "tab.home": "Home", "tab.learn": "Learn", "tab.news": "News", "tab.me": "Me",
    "set.title": "Me", "set.section": "Settings", "set.lang": "Language", "set.size": "Text size",
    "set.size.s": "Small", "set.size.m": "Normal", "set.size.l": "Large",
    "set.a2hs": "Add to Home Screen",
    "set.a2hs.ios": "iPhone: Safari Share button → “Add to Home Screen”",
    "set.a2hs.android": "Android: Chrome ⋮ menu → “Add to Home screen”",
    "set.logout.q": "Log out?", "set.logout.body": "Next time, log in with your student number and password.",
    "set.cancel": "Cancel", "sheet.close": "Close",
    "set.pw": "Change password",
    "pw.title": "Change password", "pw.title.first": "Set your new password",
    "pw.lead.first": "You are using the first password. Please change it to your own password.",
    "pw.rule1": "At least 8 characters, with both letters (a–z) and numbers (0–9)",
    "pw.rule2": "Do not use only your birthday, name, or student number",
    "pw.new": "New password", "pw.new2": "New password again",
    "pw.save": "Save", "pw.busy": "Saving…", "pw.back": "Back",
    "pw.forget": "If you forget it, tell a teacher. They can reset it right away.",
    "pw.done": "Your password has been changed",
    "pw.done.save": "If your browser asks “Save password?”, tap Save. Next time it will fill in automatically.\nPlease do not take a screenshot of it (friends may see it in your photos).",
    "pw.err.empty": "Please enter a new password.",
    "pw.err.ascii": "Use only English letters and numbers (no Japanese input, no spaces).",
    "pw.err.len": "Use at least 8 characters.",
    "pw.err.chars": "Use both letters and numbers.",
    "pw.err.initial": "Please choose a password different from the first password.",
    "pw.err.match": "The two passwords do not match. Please try again.",
    "pw.err.pwned": "This password is too common and is known to others. Please choose a different one.",
    "pw.err.weak": "This password cannot be used. Please choose a different one.",
    "pw.err.same": "This is the same as your current password. Please choose a different one.",
    "pw.err.reauth": "Please log in again, then change your password.",
    "pw.err.other": "Could not change the password ({s}). Please tell a teacher.",
    "sv.sheet.q": "Questions", "sv.sheet.sec": "Parts", "sv.sheet.due": "Due",
  },
};

let LANG = "ja";

/* 文言を返す。無ければ日本語 → キーそのもの。{name} のような穴は vars で埋める */
function t(key, vars) {
  let s = (I18N[LANG] && I18N[LANG][key]);
  if (s == null) s = I18N.ja[key];
  if (s == null) s = key;
  if (vars) Object.keys(vars).forEach(k => { s = s.split("{" + k + "}").join(vars[k]); });
  return s;
}
/* {ja:"…", en:"…"} 型（アンケート定義など）から今の言語の文言を返す。無ければ日本語 */
function tx(obj) {
  if (obj == null) return "";
  if (typeof obj === "string") return obj;
  return obj[LANG] != null ? obj[LANG] : (obj.ja != null ? obj.ja : "");
}
/* 静的なHTMLの文言を貼り替える（data-i18n=テキスト / data-i18n-ph=placeholder） */
function applyI18n(root) {
  const r = root || document;
  r.querySelectorAll("[data-i18n]").forEach(el => { el.textContent = t(el.getAttribute("data-i18n")); });
  r.querySelectorAll("[data-i18n-ph]").forEach(el => { el.placeholder = t(el.getAttribute("data-i18n-ph")); });
  r.querySelectorAll("[data-i18n-aria]").forEach(el => { el.setAttribute("aria-label", t(el.getAttribute("data-i18n-aria"))); });
}
/* 言語を切り替えて保存。画面側は "sp:lang" イベントで動的な部分を描き直す */
function setLang(code, persist) {
  if (!I18N[code]) code = "ja";
  LANG = code;
  document.documentElement.lang = code;
  if (persist !== false) { try { localStorage.setItem("sp_lang", code); } catch (e) {} }
  applyI18n();
  window.dispatchEvent(new CustomEvent("sp:lang", { detail: code }));
}
/* 起動時: 前回選んだ言語があればそれ、無ければ日本語 */
function initLang() {
  let c = null;
  try { c = localStorage.getItem("sp_lang"); } catch (e) {}
  setLang(c && I18N[c] ? c : "ja", false);
}

/* ヘッダー右上の「🌐 言語」ボタン＋メニュー。押すと一覧、選ぶと切替（記憶される） */
function mountLangSwitch(el) {
  if (!el) return;
  el.innerHTML = '<button type="button" class="langbtn" id="langbtn" aria-haspopup="listbox" aria-expanded="false">' +
                 '<span class="ico" aria-hidden="true">🌐</span><span class="cur" id="langcur"></span><span class="car" aria-hidden="true"></span></button>';
  const btn = el.querySelector("#langbtn"), cur = el.querySelector("#langcur");
  const menu = document.createElement("div");
  menu.className = "langmenu"; menu.id = "langmenu"; menu.setAttribute("role", "listbox"); menu.hidden = true;
  document.body.appendChild(menu);           /* ヘッダーの overflow に切られないよう body 直下に置く */
  function paint() {
    const now = LANGS.find(l => l.code === LANG) || LANGS[0];
    cur.textContent = now.native;
    menu.innerHTML = LANGS.map(l =>
      '<button type="button" role="option" data-code="' + l.code + '"' +
      ' class="' + (l.code === LANG ? "cur" : "") + '"' + (l.ready ? "" : " disabled") +
      ' aria-selected="' + (l.code === LANG) + '">' +
      '<span class="nat">' + l.native + '</span>' +
      '<span class="en">' + l.en + (l.ready ? "" : " · " + t("lang.soon")) + '</span></button>').join("");
  }
  function place() {
    const r = btn.getBoundingClientRect();
    menu.style.top = (r.bottom + 8) + "px";
    menu.style.right = Math.max(8, window.innerWidth - r.right) + "px";
  }
  function open() { place(); menu.hidden = false; btn.setAttribute("aria-expanded", "true"); }
  function close() { menu.hidden = true; btn.setAttribute("aria-expanded", "false"); }
  btn.addEventListener("click", e => { e.stopPropagation(); menu.hidden ? open() : close(); });
  menu.addEventListener("click", e => {
    const b = e.target.closest("[data-code]");
    if (!b || b.disabled) return;
    e.stopPropagation();
    setLang(b.getAttribute("data-code"));
    close();
  });
  document.addEventListener("click", close);
  window.addEventListener("scroll", close, { passive: true });
  window.addEventListener("sp:lang", paint);
  paint();
}
