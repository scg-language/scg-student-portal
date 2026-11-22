/* 学生ポータルについてのお知らせの文 — 1か所で管理（2026-11-22・11-23 に2点だけに絞った）
 * 学生の画面（index.html）と見本（policy-preview.html）が、同じこのファイルを読む。
 *
 * ・同意を取るものではなく、お知らせ。ボタンは「よみました」1つ（docs/yakusoku.md 4-2）
 * ・入れるのは2点だけ：情報を保存する場所（日本の外のサーバー）と、AI の利用。節を足さない
 *   （学生ポータルについてのお知らせで、個人情報の取り扱い全体の同意書ではない。そちらは入学前の契約の話）
 * ・言語はお知らせの画面だけで切り替える（ポータルのほかの画面は日本語か英語のまま）。
 *   下の T に訳が入っている言語だけが、言語えらびに出る。無い言語は日本語に落ちる
 * ・訳は docs/yakusoku.md 4-2 の決まりで作る（Sonnet が訳す → Opus が直す → Fable が確かめる）
 * ・ready が false の間、学生の画面はお知らせを出さずにホームへ進む。きあが文を確かめてから true にする
 *   （【　】＝まだ決まっていない所、が1つでも残っている間は true にしない。検査が見張る）
 * ・version は DB の notice_versions のいまの版と同じ数にする。
 *   文の意味を変えたら：ここを直して version を上げる → 画面を先に出す → DB に次の版を足す。誤字の直しでは上げない
 * ・言語を足すとき：LANGS と T の両方。DB 側は notice_acks_lang_check と ack_notice の中の一覧
 */
(function () {
  "use strict";
  const LANGS = [["ja", "日本語"], ["en", "English"], ["zh", "中文"], ["ne", "नेपाली"], ["my", "မြန်မာ"], ["si", "සිංහල"], ["bn", "বাংলা"], ["vi", "Tiếng Việt"], ["uz", "Oʻzbekcha"]];
  // T:BEGIN（キーごとに、言語のコード→文。1キー1行）
  const T = {
    title: {"ja": "学校からの 大事な お知らせ", "en": "Important notice from the school", "zh": "学校的重要通知", "ne": "विद्यालयबाट महत्त्वपूर्ण सूचना", "my": "ကျောင်းမှ အရေးကြီးသော အသိပေးချက်", "si": "පාසලෙන් වැදගත් දැනුම්දීමක්", "bn": "স্কুলের পক্ষ থেকে গুরুত্বপূর্ণ নোটিশ", "vi": "Thông báo quan trọng từ nhà trường", "uz": "Maktabdan muhim e'lon"},
    s1_h: {"ja": "1. 情報を 保存 する 場所", "en": "1. Where information is stored", "zh": "1. 信息的保存位置", "ne": "1. जानकारी राख्ने ठाउँ", "my": "1. အချက်အလက်များ သိမ်းဆည်းသည့်နေရာ", "si": "1. තොරතුරු ගබඩා කරන තැන", "bn": "1. তথ্য কোথায় রাখা হয়", "vi": "1. Nơi lưu trữ thông tin", "uz": "1. Ma'lumotlar saqlanadigan joy"},
    s1_p1: {"ja": "学校は、インターネットの サービスを つかって、あなたの 情報を 保存 しています。", "en": "The school stores your information using internet services.", "zh": "学校使用互联网服务来保存你的信息。", "ne": "विद्यालयले इन्टरनेट सेवाहरू प्रयोग गरेर तपाईंको जानकारी राख्छ।", "my": "ကျောင်းသည် အင်တာနက်ဝန်ဆောင်မှုများကို အသုံးပြု၍ သင်၏ အချက်အလက်များကို သိမ်းဆည်းထားပါသည်။", "si": "පාසල ඉන්ටර්නෙට් සේවා පාවිච්චි කරලා ඔබේ තොරතුරු ගබඩා කරනවා.", "bn": "স্কুল ইন্টারনেট সার্ভিস ব্যবহার করে আপনার তথ্য রাখে।", "vi": "Nhà trường sử dụng các dịch vụ trên internet để lưu trữ thông tin của bạn.", "uz": "Maktab internet xizmatlaridan foydalanib, sizning ma'lumotlaringizni saqlaydi."},
    s1_p2: {"ja": "これらの サービスでは、情報が 日本の 外に ある コンピューターに 保存される ことが あります。", "en": "With these services, information may be stored on computers outside Japan.", "zh": "使用这些服务时，信息有可能保存在日本境外的计算机中。", "ne": "यी सेवाहरूमा जानकारी जापानबाहिर रहेका कम्प्युटरहरूमा राखिन सक्छ।", "my": "ဤဝန်ဆောင်မှုများတွင် အချက်အလက်များကို ဂျပန်နိုင်ငံပြင်ပရှိ ကွန်ပျူတာများတွင် သိမ်းဆည်းထားခြင်း ရှိနိုင်ပါသည်။", "si": "මේ සේවාවලදී තොරතුරු ජපානයෙන් පිටත තියෙන කම්පියුටර්වල ගබඩා වෙන්න පුළුවන්.", "bn": "এই সার্ভিসগুলোতে তথ্য জাপানের বাইরে থাকা কম্পিউটারে রাখা হতে পারে।", "vi": "Với các dịch vụ này, thông tin có thể được lưu trên máy tính đặt ở ngoài Nhật Bản.", "uz": "Bu xizmatlarda ma'lumotlar Yaponiyadan tashqarida joylashgan kompyuterlarda saqlanishi mumkin."},
    s1_p3: {"ja": "学校は、サービスの 会社と 契約を して、情報を 安全に あつかう ことを 決めて います。", "en": "The school has contracts with these companies that set out how to handle information safely.", "zh": "学校与这些服务公司签订了合同，约定要安全地处理信息。", "ne": "विद्यालयले सेवा दिने कम्पनीहरूसँग सम्झौता गरेर जानकारी सुरक्षित रूपमा सम्हाल्ने कुरा तय गरेको छ।", "my": "ကျောင်းသည် ဝန်ဆောင်မှုကုမ္ပဏီများနှင့် စာချုပ်ချုပ်ဆိုပြီး အချက်အလက်များကို လုံခြုံစွာ ကိုင်တွယ်ရန် သတ်မှတ်ထားပါသည်။", "si": "පාසල සේවා සපයන සමාගම් එක්ක ගිවිසුම් අත්සන් කරලා, තොරතුරු ආරක්ෂිතව හසුරුවන විදිහ තීරණය කරලා තියෙනවා.", "bn": "স্কুল সার্ভিস কোম্পানিগুলোর সাথে চুক্তি করেছে এবং তথ্য যাতে নিরাপদে সামলানো হয় সেটা ঠিক করে রেখেছে।", "vi": "Nhà trường đã ký hợp đồng với các công ty cung cấp dịch vụ, trong đó quy định việc xử lý thông tin một cách an toàn.", "uz": "Maktab xizmat ko'rsatuvchi kompaniyalar bilan shartnoma tuzgan va unda ma'lumotlar bilan xavfsiz ishlash belgilab qo'yilgan."},
    s2_h: {"ja": "2. AI の 利用", "en": "2. Use of AI", "zh": "2. AI 的使用", "ne": "2. AI को प्रयोग", "my": "2. AI အသုံးပြုခြင်း", "si": "2. AI භාවිතය", "bn": "2. AI ব্যবহার", "vi": "2. Việc sử dụng AI", "uz": "2. AI-dan foydalanish"},
    s2_lead: {"ja": "学校は、仕事や、あなたの 学習を 手伝う ために、AI を つかう ことが あります。たとえば、つぎの ような ことです。", "en": "The school sometimes uses AI for its work and to support your learning. For example:", "zh": "学校有时会使用 AI 来协助工作，并帮助你学习。例如下面这些情况：", "ne": "विद्यालयले कहिलेकाहीँ काममा र तपाईंको पढाइमा सहयोग गर्न AI प्रयोग गर्छ। उदाहरणका लागि:", "my": "ကျောင်းသည် အလုပ်အတွက်ရော သင်၏ လေ့လာမှုကို ကူညီရန်ပါ AI ကို တစ်ခါတစ်ရံ အသုံးပြုပါသည်။ ဥပမာ အောက်ပါအတိုင်း ဖြစ်ပါသည်။", "si": "පාසල සමහර වෙලාවට වැඩවලටත්, ඔබේ ඉගෙනීමට උදව් කරන්නත් AI පාවිච්චි කරනවා. උදාහරණ විදිහට:", "bn": "স্কুল মাঝে মাঝে কাজে এবং আপনার পড়াশোনায় সাহায্য করার জন্য AI ব্যবহার করে। যেমন:", "vi": "Nhà trường đôi khi sử dụng AI để hỗ trợ công việc và việc học của bạn. Ví dụ như sau:", "uz": "Maktab ba'zan ish jarayonida va o'qishingizga yordam berish uchun AI-dan foydalanadi. Masalan:"},
    s2_use1: {"ja": "名簿や 記録の 整理・集計", "en": "Organizing and counting rosters and records", "zh": "整理、统计学生名单和记录", "ne": "विद्यार्थीहरूको नामावली र अभिलेख मिलाउने र गन्ती गर्ने", "my": "ကျောင်းသားစာရင်းနှင့် မှတ်တမ်းများကို စီစဉ်ခြင်း၊ ပေါင်းချုပ်ခြင်း", "si": "සිසුන්ගේ නම් ලැයිස්තු සහ වාර්තා පිළිවෙළට සකස් කිරීම සහ ගණන් කිරීම", "bn": "ছাত্রছাত্রীদের তালিকা ও রেকর্ড গুছিয়ে রাখা এবং হিসাব করা", "vi": "Sắp xếp và tổng hợp danh sách học viên và các hồ sơ", "uz": "Talabalar ro'yxatlari va yozuvlarini tartibga solish va hisoblash"},
    s2_use2: {"ja": "あなたが 出した もの（作文・会話の テスト など）を 読んで、先生の 仕事を 手伝う", "en": "Reading what you submit (such as essays and speaking tests) to help teachers with their work", "zh": "阅读你提交的内容（作文、口语测试等），协助老师工作", "ne": "तपाईंले बुझाएका कुराहरू (निबन्ध, मौखिक परीक्षा आदि) पढेर शिक्षकको कामलाई सघाउने", "my": "သင် တင်သွင်းသည့် အရာများ (စာစီစာကုံး၊ စကားပြောစာမေးပွဲ စသည်) ကို ဖတ်ပြီး ဆရာ/ဆရာမများ၏ အလုပ်ကို ကူညီခြင်း", "si": "ඔබ බාරදුන් දේවල් (රචනා, කතා කිරීමේ පරීක්ෂණ වගේ) කියවලා, ගුරුවරුන්ගේ වැඩට උදව් කිරීම", "bn": "আপনি যা জমা দেন (রচনা, কথা বলার পরীক্ষা ইত্যাদি) তা পড়ে শিক্ষকদের কাজে সাহায্য করা", "vi": "Đọc những bài bạn nộp (bài viết, bài thi nói, v.v.) để hỗ trợ công việc của giáo viên", "uz": "Siz topshirgan ishlarni (insho, so'zlashuv testi va h.k.) o'qib, o'qituvchilarning ishiga yordam berish"},
    s2_use3: {"ja": "手続きの 書類や 証明書を つくる ときの 手伝い", "en": "Helping to prepare procedure documents and certificates", "zh": "协助制作办理手续的文件和证明书", "ne": "विभिन्न प्रक्रियाका लागि चाहिने कागजात र प्रमाणपत्र बनाउँदा सहयोग गर्ने", "my": "လုပ်ထုံးလုပ်နည်းဆိုင်ရာ စာရွက်စာတမ်းများနှင့် အထောက်အထားလက်မှတ်များ ပြုလုပ်ရာတွင် ကူညီခြင်း", "si": "කටයුතු සඳහා ලියකියවිලි සහ සහතික හදද්දී උදව් කිරීම", "bn": "অফিসিয়াল কাজের কাগজপত্র ও সার্টিফিকেট বানানোর সময় সাহায্য করা", "vi": "Hỗ trợ khi làm giấy tờ thủ tục và giấy chứng nhận", "uz": "Rasmiy jarayonlar uchun hujjatlar va ma'lumotnomalar tayyorlashda yordam berish"},
    s2_rule1: {"ja": "AI だけで、あなたの 成績・進級・進路を 決める ことは ありません。さいごは かならず 先生と 職員が 決めます。", "en": "AI alone never decides your grades, promotion, or future path. Teachers and staff always make the final decision.", "zh": "你的成绩、升班和毕业后的去向，不会只由 AI 来决定。最后一定由老师和职员来决定。", "ne": "तपाईंको नतिजा, माथिल्लो कक्षामा जाने कुरा र भविष्यको बाटो AI ले मात्र तय गर्दैन। अन्तिम निर्णय सधैं शिक्षक र कर्मचारीले गर्छन्।", "my": "သင်၏ ရလဒ်၊ အတန်းတက်ခြင်းနှင့် အနာဂတ်လမ်းကြောင်းကို AI တစ်ခုတည်းက ဆုံးဖြတ်ခြင်း မရှိပါ။ နောက်ဆုံးဆုံးဖြတ်ချက်ကို ဆရာ/ဆရာမများနှင့် ဝန်ထမ်းများက အမြဲ ချမှတ်ပါသည်။", "si": "ඔබේ ප්‍රතිඵල, ඊළඟ මට්ටමට යාම, අනාගත මාර්ගය AI එකෙන් විතරක් තීරණය කරන්නේ නැහැ. අවසාන තීරණය හැම වෙලේම ගන්නේ ගුරුවරු සහ කාර්ය මණ්ඩලය.", "bn": "আপনার রেজাল্ট, পরের লেভেলে ওঠা আর ভবিষ্যতের পথ কখনো শুধু AI ঠিক করে না। শেষ সিদ্ধান্ত সবসময় শিক্ষক ও স্টাফরাই নেন।", "vi": "AI sẽ không bao giờ tự mình quyết định điểm số, việc lên lớp hay con đường sau khi tốt nghiệp của bạn. Người quyết định cuối cùng luôn là giáo viên và nhân viên nhà trường.", "uz": "Baholaringiz, keyingi bosqichga o'tishingiz va kelajakdagi yo'lingizni faqat AI hal qilmaydi. Yakuniy qarorni har doim o'qituvchilar va xodimlar qabul qiladi."},
    s2_rule2: {"ja": "学校が つかう AI は、学校が 契約 している もの だけ です。AI の 会社は、あなたの 情報を AI の 学習に つかいません。", "en": "The school only uses AI services it has a contract with. The AI company does not use your information to train its AI.", "zh": "学校只使用已签订合同的 AI。AI 公司不会把你的信息用来训练 AI。", "ne": "विद्यालयले सम्झौता गरेको AI मात्र प्रयोग गर्छ। AI कम्पनीले तपाईंको जानकारी AI लाई सिकाउन प्रयोग गर्दैन।", "my": "ကျောင်းအသုံးပြုသော AI သည် ကျောင်းက စာချုပ်ချုပ်ဆိုထားသော AI များသာ ဖြစ်ပါသည်။ AI ကုမ္ပဏီသည် သင်၏ အချက်အလက်များကို AI လေ့ကျင့်ရန်အတွက် အသုံးမပြုပါ။", "si": "පාසල පාවිච්චි කරන්නේ පාසල ගිවිසුමක් අත්සන් කරලා තියෙන AI විතරයි. AI සමාගම ඔබේ තොරතුරු AI එක පුහුණු කරන්න පාවිච්චි කරන්නේ නැහැ.", "bn": "স্কুল শুধু সেই AI-ই ব্যবহার করে যার সাথে স্কুলের চুক্তি আছে। AI কোম্পানি আপনার তথ্য AI-কে শেখানোর কাজে ব্যবহার করে না।", "vi": "Nhà trường chỉ sử dụng AI mà trường đã ký hợp đồng sử dụng. Công ty AI không dùng thông tin của bạn để huấn luyện AI.", "uz": "Maktab faqat o'zi shartnoma tuzgan AI-dan foydalanadi. AI kompaniyasi sizning ma'lumotlaringizni AI-ni o'rgatish uchun ishlatmaydi."},
    s2_worry: {"ja": "しんぱいな ことが ある ときは、先生に 言って ください。", "en": "If you are worried about anything, please tell your teacher.", "zh": "如果有担心的事，请告诉老师。", "ne": "केही चिन्ता लागेमा शिक्षकलाई भन्नुहोस्।", "my": "စိုးရိမ်စရာ ရှိလျှင် ဆရာ/ဆရာမကို ပြောပါ။", "si": "මොකක් හරි කනස්සල්ලක් තියෙනවා නම් ගුරුවරයාට කියන්න.", "bn": "কোনো চিন্তা থাকলে শিক্ষককে বলুন।", "vi": "Nếu bạn có điều gì lo lắng, hãy nói với giáo viên.", "uz": "Xavotiringiz bo'lsa, o'qituvchiga ayting."},
    ui_read: {"ja": "よみました", "en": "I have read this", "zh": "我已阅读", "ne": "मैले पढेँ", "my": "ဖတ်ပြီးပါပြီ", "si": "කියෙව්වා", "bn": "পড়েছি", "vi": "Tôi đã đọc", "uz": "O'qidim"},
    ui_busy: {"ja": "おくっています…", "en": "Sending…", "zh": "正在发送…", "ne": "पठाउँदै छ…", "my": "ပို့နေပါသည်…", "si": "යවනවා…", "bn": "পাঠানো হচ্ছে…", "vi": "Đang gửi…", "uz": "Yuborilmoqda…"},
    ui_changed: {"ja": "まえに よんだ ときから、かわった ところが あります。もういちど よんで ください。", "en": "Something has changed since you last read this. Please read it again.", "zh": "和你上次阅读时相比，内容有变化。请再读一遍。", "ne": "तपाईंले पहिले पढेपछि केही कुरा बदलिएको छ। कृपया फेरि पढ्नुहोस्।", "my": "ယခင် ဖတ်ခဲ့ပြီးနောက် ပြောင်းလဲထားသည်များ ရှိပါသည်။ ထပ်ဖတ်ပါ။", "si": "ඔබ කලින් කියවපු වෙලාවෙන් පස්සේ වෙනස් වෙලා තියෙන දේවල් තියෙනවා. කරුණාකර ආයෙත් කියවන්න.", "bn": "আগেরবার পড়ার পর থেকে কিছু বদলেছে। দয়া করে আবার পড়ুন।", "vi": "Nội dung đã thay đổi so với lần bạn đọc trước. Vui lòng đọc lại.", "uz": "Oxirgi marta o'qiganingizdan beri o'zgarishlar bor. Iltimos, yana o'qing."},
    ui_readon: {"ja": "✓ よみました（{d}）", "en": "✓ Read ({d})", "zh": "✓ 已阅读（{d}）", "ne": "✓ पढेँ ({d})", "my": "✓ ဖတ်ပြီးပါပြီ ({d})", "si": "✓ කියෙව්වා ({d})", "bn": "✓ পড়েছি ({d})", "vi": "✓ Đã đọc ({d})", "uz": "✓ O'qidim ({d})"},
    ui_err_reload: {"ja": "お知らせが あたらしく なりました。ページを よみこみなおして ください。", "en": "The notice has been updated. Please reload the page.", "zh": "通知已更新。请刷新页面。", "ne": "सूचना नयाँ भएको छ। कृपया पेज रिलोड गर्नुहोस्।", "my": "အသိပေးချက် အသစ်ဖြစ်သွားပါပြီ။ စာမျက်နှာကို ပြန်ဖွင့်ပါ။", "si": "දැනුම්දීම අලුත් වෙලා. කරුණාකර පිටුව ආයෙත් ලෝඩ් කරන්න.", "bn": "নোটিশটি আপডেট হয়েছে। দয়া করে পেজটি রিলোড করুন।", "vi": "Thông báo đã được cập nhật. Vui lòng tải lại trang.", "uz": "E'lon yangilandi. Iltimos, sahifani qayta yuklang."},
    ui_err_other: {"ja": "おくれませんでした。もういちど おして ください。", "en": "Could not send. Please press again.", "zh": "发送失败。请再按一次。", "ne": "पठाउन सकिएन। कृपया फेरि थिच्नुहोस्।", "my": "မပို့နိုင်ပါ။ ထပ်နှိပ်ပါ။", "si": "යවන්න බැරි වුණා. කරුණාකර ආයෙත් ඔබන්න.", "bn": "পাঠানো যায়নি। দয়া করে আবার চাপুন।", "vi": "Không gửi được. Vui lòng bấm lại.", "uz": "Yuborib bo'lmadi. Iltimos, yana bosing."},
    ui_back: {"ja": "もどる", "en": "Back", "zh": "返回", "ne": "पछाडि", "my": "နောက်သို့", "si": "ආපසු", "bn": "ফিরে যান", "vi": "Quay lại", "uz": "Orqaga"},
    ui_logout: {"ja": "ログアウト", "en": "Log out", "zh": "退出登录", "ne": "लगआउट", "my": "အကောင့်မှ ထွက်ရန်", "si": "ලොග් අවුට්", "bn": "লগ আউট", "vi": "Đăng xuất", "uz": "Chiqish"},
  };
  // T:END
  const NOTICE = {
    key: "student_privacy",
    version: 1,
    ready: false,
    title: T.title,
    // body の中身：文字の組＝段落／配列＝箇条書き
    sections: [
      { id: "s1", h: T.s1_h, body: [T.s1_p1, T.s1_p2, T.s1_p3] },
      // AI は同意を取らず、ここで広く知らせる。使い道は例として書く
      { id: "s2", h: T.s2_h, body: [T.s2_lead, [T.s2_use1, T.s2_use2, T.s2_use3], T.s2_rule1, T.s2_rule2, T.s2_worry] },
    ],
    // お知らせの画面のボタンと知らせ（ポータルの言語ではなく、お知らせの言語で出す）
    ui: { read: T.ui_read, busy: T.ui_busy, changed: T.ui_changed, readon: T.ui_readon,
          errReload: T.ui_err_reload, errOther: T.ui_err_other, back: T.ui_back, logout: T.ui_logout },
  };
  /* その言語の訳が入っているか（題名で見る） */
  NOTICE.has = code => Boolean(T.title[code]);
  /* 言語えらびに出す言語＝訳が入っているものだけ。[[コード, その言語での名前], …] */
  NOTICE.langs = () => LANGS.filter(l => NOTICE.has(l[0]));
  /* 文字の組から、その言語の文を取る。無ければ日本語 */
  NOTICE.tx = (o, lang) => o[lang] || o.ja;

  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  // 【…】に、まだ決まっていない印を付けて入れる。文字は必ず textContent／createTextNode で入れる
  function fill(node, text) {
    String(text).split(/(【[^】]*】)/).forEach(part => { if (!part) return; node.appendChild(part.charAt(0) === "【" ? el("span", "pn-todo", part) : document.createTextNode(part)); });
    return node;
  }
  /* parent の中に文を描く。lang＝言語のコード。opts.extra＝{ s2: {ja,en} } のように、その節の箇条書きの最後に足す行（見本が版2を見せるときだけ使う） */
  NOTICE.render = function (parent, lang, opts) {
    const tx = o => NOTICE.tx(o, lang), extra = (opts && opts.extra) || {};
    NOTICE.sections.forEach(sec => {
      const h = el("h3", "pn-h", tx(sec.h)); h.dataset.sec = sec.id; parent.appendChild(h);
      let added = false;
      sec.body.forEach(item => {
        if (Array.isArray(item)) {
          const ul = el("ul", "pn-ul"); item.forEach(li => ul.appendChild(fill(el("li"), tx(li))));
          if (extra[sec.id] && !added) { ul.appendChild(fill(el("li", "pn-new"), tx(extra[sec.id]))); added = true; }
          parent.appendChild(ul);
        } else parent.appendChild(fill(el("p", "pn-p"), tx(item)));
      });
    });
  };
  /* 文の中に【　】が残っているか（残っている間は ready にしない） */
  NOTICE.hasTodo = function () {
    return Object.keys(T).some(k => Object.keys(T[k]).some(c => /【/.test(T[k][c])));
  };
  /* 訳の抜けを数える（検査用）。{ 言語のコード: 抜けているキーの数 } */
  NOTICE.missing = function () {
    const out = {};
    NOTICE.langs().forEach(l => { const n = Object.keys(T).filter(k => !T[k][l[0]]).length; if (n) out[l[0]] = n; });
    return out;
  };
  window.POLICY_NOTICE = NOTICE;
})();
