/* 進学先情報の見本（src/shingaku-preview.html）。
   - ダミーだけで動く。API・DB・外部通信・localStorage を使わない。データはこのページのメモリだけ＝再読み込みで元に戻る
   - 学校・学生・URL はすべて架空。進学実績の人数・就職率などの数字は持たない（見せるかが未決のため）
   - 学生の画面は buildStudentPayload() が組み立てた「学生に渡すデータ」だけを読む。
     職員向けの列（STAFF_ONLY_KEYS）とおすすめの理由は、そこに入れない
   - 文字は textContent でだけ入れる（innerHTML を使わない） */
"use strict";
(function(){
const STAFF_NAME="職員A（見本）";
const MAX_WISHES=3;
const REC_GUIDE=10; // おすすめは10校前後まで（クレヨンにする）
const STAFF_ONLY_KEYS=["memo","contact"];

const FIELDS=[
 {k:"it",staff:"IT",stu:"IT・コンピューター"},
 {k:"kaigo",staff:"介護",stu:"かいご"},
 {k:"biz",staff:"ビジネス",stu:"ビジネス"},
 {k:"hotel",staff:"ホテル・観光",stu:"ホテル・かんこう"},
 {k:"car",staff:"自動車",stu:"じどうしゃ"},
 {k:"food",staff:"調理・製菓",stu:"りょうり・おかし"}
];
const PREFS=[
 {k:"tokyo",staff:"東京都",stu:"とうきょう"},
 {k:"kanagawa",staff:"神奈川県",stu:"かながわ"},
 {k:"saitama",staff:"埼玉県",stu:"さいたま"},
 {k:"chiba",staff:"千葉県",stu:"ちば"},
 {k:"aichi",staff:"愛知県",stu:"あいち"},
 {k:"osaka",staff:"大阪府",stu:"おおさか"},
 {k:"fukuoka",staff:"福岡県",stu:"ふくおか"}
];
const fieldOf=k=>FIELDS.find(f=>f.k===k);
const prefOf=k=>PREFS.find(p=>p.k===k);

// 架空の学校。名前は実在しない造語にしてある。memo / contact は職員だけが見る列
const SCHOOLS=[
 ["s01","星波情報専門学校","ほしなみ じょうほう","it","tokyo","2026-12-06","留学生の出願は日本語能力の証明が必要（見本）","入試担当：窓口A（見本）"],
 ["s02","ことのは情報テクノ専門学校","ことのは じょうほう テクノ","it","kanagawa","2026-12-13","面接は日本語のみ（見本）","入試担当：窓口B（見本）"],
 ["s03","あさなぎデジタル専門学校","あさなぎ デジタル","it","saitama","","説明会の日程は未発表（見本）","入試担当：窓口C（見本）"],
 ["s04","銀河坂コンピュータ専門学校","ぎんがざか コンピュータ","it","osaka","2027-01-17","寮あり・家賃は要確認（見本）","入試担当：窓口D（見本）"],
 ["s05","こもれびIT専門学校","こもれび アイティー","it","fukuoka","2026-12-20","夜間部あり（見本）","入試担当：窓口E（見本）"],
 ["s06","そよかぜ野ケア専門学校","そよかぜの ケア","kaigo","kanagawa","2026-12-05","奨学金の説明会あり（見本）","入試担当：窓口F（見本）"],
 ["s07","ひだまり丘介護専門学校","ひだまりおか かいご","kaigo","tokyo","2026-12-12","実習先が多い（見本）","入試担当：窓口G（見本）"],
 ["s08","つむぎ福祉専門学校","つむぎ ふくし","kaigo","chiba","2027-01-10","入学前に日本語の面談あり（見本）","入試担当：窓口H（見本）"],
 ["s09","ゆうなぎ介護福祉専門学校","ゆうなぎ かいご ふくし","kaigo","aichi","","今年度の募集は要確認（見本）","入試担当：窓口I（見本）"],
 ["s10","ももいろ坂ケア専門学校","ももいろざか ケア","kaigo","saitama","2026-12-19","学費の分納可（見本）","入試担当：窓口J（見本）"],
 ["s11","つばさ野ビジネス専門学校","つばさの ビジネス","biz","tokyo","2026-12-06","出願書類が多い。早めに準備（見本）","入試担当：窓口K（見本）"],
 ["s12","ことりばし国際ビジネス専門学校","ことりばし こくさい ビジネス","biz","osaka","2026-12-27","留学生の在籍が多い（見本）","入試担当：窓口L（見本）"],
 ["s13","しろがね町ビジネス専門学校","しろがねちょう ビジネス","biz","chiba","2027-01-24","簿記の授業が中心（見本）","入試担当：窓口M（見本）"],
 ["s14","みつばち実務専門学校","みつばち じつむ","biz","fukuoka","","日程は電話で確認（見本）","入試担当：窓口N（見本）"],
 ["s15","うみねこホテル観光専門学校","うみねこ ホテル かんこう","hotel","osaka","2026-12-13","ホテル実習あり（見本）","入試担当：窓口O（見本）"],
 ["s16","ほたる川ツーリズム専門学校","ほたるがわ ツーリズム","hotel","fukuoka","2027-01-09","英語の授業が多い（見本）","入試担当：窓口P（見本）"],
 ["s17","かざぐるまホテル専門学校","かざぐるま ホテル","hotel","tokyo","2026-12-20","制服代が別途（見本）","入試担当：窓口Q（見本）"],
 ["s18","月見坂観光ビジネス専門学校","つきみざか かんこう ビジネス","hotel","kanagawa","","昨年は説明会なし（見本）","入試担当：窓口R（見本）"],
 ["s19","ぎんやんま自動車整備専門学校","ぎんやんま じどうしゃ せいび","car","aichi","2026-12-05","整備士の資格コース（見本）","入試担当：窓口S（見本）"],
 ["s20","からまつ台モーター専門学校","からまつだい モーター","car","saitama","2026-12-26","運転免許の取得を勧めている（見本）","入試担当：窓口T（見本）"],
 ["s21","てっせん自動車専門学校","てっせん じどうしゃ","car","aichi","2027-01-16","工具代が別途（見本）","入試担当：窓口U（見本）"],
 ["s22","こむぎ畑調理製菓専門学校","こむぎばたけ ちょうり せいか","food","tokyo","2026-12-12","実技の試験あり（見本）","入試担当：窓口V（見本）"],
 ["s23","ゆずの木調理専門学校","ゆずのき ちょうり","food","osaka","2027-01-23","アルバイト先の紹介あり（見本）","入試担当：窓口W（見本）"],
 ["s24","あまぐり製菓専門学校","あまぐり せいか","food","chiba","","募集要項は12月に出る予定（見本）","入試担当：窓口X（見本）"]
].map(([id,name,yomi,field,pref,nextOc,memo,contact])=>({id,name,yomi,field,pref,nextOc,
 links:{home:"https://example.com/schools/"+id+"/",boshu:"https://example.com/schools/"+id+"/boshu",oc:"https://example.com/schools/"+id+"/open-campus"},
 memo,contact}));
const schoolOf=id=>SCHOOLS.find(s=>s.id===id);

const STUDENTS=[
 {no:"2604999",name:"テスト太郎",cls:"見本クラスA"},
 {no:"2604998",name:"テスト花子",cls:"見本クラスA"},
 {no:"2604997",name:"テスト次郎",cls:"見本クラスA"},
 {no:"2604996",name:"テスト桜",cls:"見本クラスA"},
 {no:"2604995",name:"テスト健",cls:"見本クラスB"},
 {no:"2604994",name:"テスト美咲",cls:"見本クラスB"},
 {no:"2604993",name:"テスト翔",cls:"見本クラスB"},
 {no:"2604992",name:"テスト陽菜",cls:"見本クラスB"}
];

// ---- 状態（メモリだけ） ----
const D=s=>new Date(s);
const recs=new Map([
 ["s01",{reason:"IT志望の学生が毎年説明会に参加している",by:"職員B（見本）",at:D("2026-11-12T10:00")}],
 ["s07",{reason:"介護の実習先が多く、日本語の支援がある",by:"職員B（見本）",at:D("2026-11-12T10:05")}],
 ["s06",{reason:"奨学金の説明が丁寧",by:"職員B（見本）",at:D("2026-11-12T10:06")}],
 ["s11",{reason:"留学生向けの出願説明会がある",by:"職員B（見本）",at:D("2026-11-12T10:10")}],
 ["s15",{reason:"ホテル実習が充実している",by:"職員B（見本）",at:D("2026-11-12T10:12")}],
 ["s19",{reason:"整備士の資格まで届いた学生がいる",by:"職員B（見本）",at:D("2026-11-12T10:15")}]
]);
const recLog=[];
const H=(at,kind,slot,from,to)=>({at:D(at),kind,slot,from,to});
const wishes={
 "2604999":{choices:["s01","s03",null],pref:"tokyo",field:"it",updatedAt:D("2026-11-10T16:20"),history:[H("2026-11-10T16:20","school",0,null,"s01"),H("2026-11-10T16:20","school",1,null,"s03"),H("2026-11-10T16:20","pref",null,"","tokyo"),H("2026-11-10T16:20","field",null,"","it")]},
 "2604998":{choices:["s06","s08","s10"],pref:"kanagawa",field:"kaigo",updatedAt:D("2026-11-05T12:10"),history:[H("2026-11-05T12:10","school",0,null,"s06"),H("2026-11-05T12:10","school",1,null,"s08"),H("2026-11-05T12:10","school",2,null,"s10")]},
 "2604997":{choices:["s11","s12",null],pref:"",field:"biz",updatedAt:D("2026-11-15T19:42"),history:[H("2026-11-03T09:30","school",0,null,"s13"),H("2026-11-03T09:30","school",1,null,"s11"),H("2026-11-15T19:42","school",0,"s13","s11"),H("2026-11-15T19:42","school",1,"s11","s12")]},
 "2604996":{choices:[null,null,null],pref:"",field:"",updatedAt:null,history:[]},
 "2604995":{choices:["s15",null,null],pref:"osaka",field:"hotel",updatedAt:D("2026-11-18T21:05"),history:[H("2026-11-01T18:00","school",0,null,"s15"),H("2026-11-01T18:00","school",1,null,"s16"),H("2026-11-18T21:05","school",1,"s16",null)]},
 "2604994":{choices:["s19","s20","s21"],pref:"aichi",field:"car",updatedAt:D("2026-11-08T08:50"),history:[H("2026-11-08T08:50","school",0,null,"s19"),H("2026-11-08T08:50","school",1,null,"s20"),H("2026-11-08T08:50","school",2,null,"s21")]},
 "2604993":{choices:["s22",null,null],pref:"",field:"food",updatedAt:D("2026-11-19T17:30"),history:[H("2026-11-19T17:30","school",0,null,"s22")]},
 "2604992":{choices:["s02","s07",null],pref:"",field:"",updatedAt:D("2026-11-02T13:00"),history:[H("2026-11-02T13:00","school",0,null,"s02"),H("2026-11-02T13:00","school",1,null,"s07")]}
};
// 職員が確認した正式な記録（見本ではダミーの固定値。画面からは変えない）
const official={
 "2604999":{choices:["s01","s03",null],pref:"tokyo",field:"it",by:"職員B（見本）",at:D("2026-11-11T15:00")},
 "2604998":{choices:["s06","s08","s10"],pref:"kanagawa",field:"kaigo",by:"職員B（見本）",at:D("2026-11-06T11:00")},
 "2604997":{choices:["s13","s11",null],pref:"",field:"biz",by:"職員C（見本）",at:D("2026-11-08T14:20")},
 "2604996":null,
 "2604995":{choices:["s15","s16",null],pref:"osaka",field:"hotel",by:"職員C（見本）",at:D("2026-11-04T10:30")},
 "2604994":{choices:["s19","s20","s21"],pref:"aichi",field:"car",by:"職員B（見本）",at:D("2026-11-09T16:00")},
 "2604993":null,
 "2604992":{choices:["s02","s07",null],pref:"",field:"",by:"職員C（見本）",at:D("2026-11-03T12:00")}
};

const ui={mode:"student",me:"2604999",page:"rec",detailId:null,back:"rec",msg:null,
 search:{q:"",field:"",pref:""},staffTab:"students",staffSel:"2604997",pendingRec:null,recErr:""};

// ---- 学生に渡すデータ（職員向けの列・おすすめの理由を入れない） ----
function buildStudentPayload(){
 return {
  schools:SCHOOLS.map(s=>({id:s.id,name:s.name,yomi:s.yomi,field:s.field,pref:s.pref,nextOc:s.nextOc,
   links:{home:s.links.home,boshu:s.links.boshu,oc:s.links.oc},recommended:recs.has(s.id)})),
  fields:FIELDS.map(f=>({k:f.k,label:f.stu})),
  prefs:PREFS.map(p=>({k:p.k,label:p.stu}))
 };
}
function buildMyWish(no){
 const w=wishes[no];
 return {choices:w.choices.slice(),pref:w.pref,field:w.field,updatedAt:w.updatedAt};
}

// ---- 小道具 ----
function el(tag,props,...kids){
 const e=document.createElement(tag);
 if(props)for(const[k,v]of Object.entries(props)){
  if(v==null||v===false)continue;
  if(k==="text")e.textContent=v;
  else if(k==="class")e.className=v;
  else if(k.startsWith("on"))e.addEventListener(k.slice(2),v);
  else e.setAttribute(k,v===true?"":String(v));
 }
 for(const c of kids.flat(Infinity)){if(c==null||c===false)continue;e.append(c instanceof Node?c:document.createTextNode(String(c)));}
 return e;
}
const pad=n=>String(n).padStart(2,"0");
const WD_STU=["にちようび","げつようび","かようび","すいようび","もくようび","きんようび","どようび"];
const WD_STAFF=["日","月","火","水","木","金","土"];
function fmtStaff(d){return d?d.getFullYear()+"/"+pad(d.getMonth()+1)+"/"+pad(d.getDate())+" "+pad(d.getHours())+":"+pad(d.getMinutes()):"—";}
function fmtStu(d){return d.getFullYear()+"ねん "+(d.getMonth()+1)+"がつ "+d.getDate()+"にち "+pad(d.getHours())+":"+pad(d.getMinutes());}
function ocStu(s){if(!s)return "まだ きまって いません";const d=D(s+"T00:00");return (d.getMonth()+1)+"がつ "+d.getDate()+"にち（"+WD_STU[d.getDay()]+"）";}
function ocStaff(s){if(!s)return "未定";const d=D(s+"T00:00");return d.getFullYear()+"/"+pad(d.getMonth()+1)+"/"+pad(d.getDate())+"（"+WD_STAFF[d.getDay()]+"）";}
const norm=s=>String(s||"").normalize("NFKC").toLowerCase().replace(/\s+/g,"");
const SLOT_STAFF=["第1希望","第2希望","第3希望"];
const SLOT_STU=["だい1 きぼう","だい2 きぼう","だい3 きぼう"];
const nameOrDash=id=>id?schoolOf(id).name:"なし";

// ---- 希望を変える（許可は要らない＝その場で反映） ----
function commitWish(no,next){
 const w=wishes[no],at=new Date(),hist=[];
 for(let i=0;i<MAX_WISHES;i++)if((w.choices[i]||null)!==(next.choices[i]||null))hist.push({at,kind:"school",slot:i,from:w.choices[i]||null,to:next.choices[i]||null});
 if(w.pref!==next.pref)hist.push({at,kind:"pref",slot:null,from:w.pref,to:next.pref});
 if(w.field!==next.field)hist.push({at,kind:"field",slot:null,from:w.field,to:next.field});
 if(!hist.length)return false;
 w.choices=next.choices.slice(0,MAX_WISHES);w.pref=next.pref;w.field=next.field;w.updatedAt=at;w.history.push(...hist);
 return true;
}
function addWish(no,id){
 const w=wishes[no];
 if(w.choices.includes(id))return {ok:false,msg:"もう きぼうに はいって います。"};
 const i=w.choices.indexOf(null);
 if(i<0)return {ok:false,msg:"きぼうは 3つ までです。「わたしの きぼう」で どれかを けしてから いれて ください。"};
 const c=w.choices.slice();c[i]=id;commitWish(no,{choices:c,pref:w.pref,field:w.field});
 return {ok:true,msg:SLOT_STU[i]+"に いれました。"};
}
function removeWish(no,i){
 const w=wishes[no],c=w.choices.filter((x,j)=>j!==i&&x);while(c.length<MAX_WISHES)c.push(null);
 commitWish(no,{choices:c,pref:w.pref,field:w.field});
}
function moveUp(no,i){
 const w=wishes[no];if(i<=0||!w.choices[i])return;
 const c=w.choices.slice();[c[i-1],c[i]]=[c[i],c[i-1]];commitWish(no,{choices:c,pref:w.pref,field:w.field});
}

// ---- おすすめ（人が付ける。理由は職員だけが見る） ----
function setRec(id,reason){
 const r=String(reason||"").trim();
 if(!r)return {ok:false,msg:"理由を1行で入力してください。"};
 recs.set(id,{reason:r,by:STAFF_NAME,at:new Date()});recLog.push({at:new Date(),act:"付けた",id,by:STAFF_NAME});
 return {ok:true};
}
function unsetRec(id){if(recs.delete(id))recLog.push({at:new Date(),act:"外した",id,by:STAFF_NAME});}

// ================= 学生の画面 =================
function renderStudent(){
 const root=document.getElementById("student-root");
 const data=buildStudentPayload(),me=STUDENTS.find(s=>s.no===ui.me),wish=buildMyWish(ui.me);
 const fieldL=k=>(data.fields.find(f=>f.k===k)||{}).label||"";
 const prefL=k=>(data.prefs.find(p=>p.k===k)||{}).label||"";
 const sch=id=>data.schools.find(s=>s.id===id);
 const go=(page,extra)=>{Object.assign(ui,{page,msg:null},extra||{});renderStudent();};
 const card=s=>el("button",{type:"button",class:"st-card","data-school":s.id,onclick:()=>go("detail",{detailId:s.id,back:ui.page})},
  el("b",{text:s.name},s.recommended?el("span",{class:"st-badge",text:"おすすめ"}):null),
  el("small",{text:s.yomi}),
  el("small",{text:fieldL(s.field)+" ・ "+prefL(s.pref)}));
 const body=el("div",{class:"st-body",id:"st-body"});
 const msg=ui.msg?el("p",{class:"st-msg"+(ui.msg.ng?" ng":""),id:"st-msg",role:"status",text:ui.msg.text}):null;
 let title="";
 if(ui.page==="rec"){
  title="おすすめの がっこう";
  const list=data.schools.filter(s=>s.recommended);
  body.append(el("p",{class:"st-lead",text:"せんせいが えらんだ がっこう です。まず ここから みて ください。"}));
  if(!list.length)body.append(el("p",{text:"いまは ありません。"}));
  for(const f of data.fields){
   const g=list.filter(s=>s.field===f.k);if(!g.length)continue;
   body.append(el("section",{class:"st-group","data-field":f.k},el("h3",{text:f.label}),g.map(card)));
  }
  body.append(el("button",{type:"button",class:"primary",style:"width:100%;margin-top:14px",onclick:()=>go("search")},"ほかの がっこうも さがす"));
 }else if(ui.page==="search"){
  title="がっこうを さがす";
  const q=el("input",{type:"search",id:"s-q",placeholder:"なまえ で さがす","aria-label":"なまえ で さがす"});q.value=ui.search.q;
  const fs=el("select",{id:"s-field","aria-label":"ぶんや"},el("option",{value:"",text:"ぜんぶの ぶんや"}),data.fields.map(f=>el("option",{value:f.k,text:f.label})));fs.value=ui.search.field;
  const ps=el("select",{id:"s-pref","aria-label":"ばしょ"},el("option",{value:"",text:"ぜんぶの ばしょ"}),data.prefs.map(p=>el("option",{value:p.k,text:p.label})));ps.value=ui.search.pref;
  const count=el("p",{class:"st-count",id:"s-count"}),results=el("div",{id:"s-results"});
  const draw=()=>{
   ui.search={q:q.value,field:fs.value,pref:ps.value};
   const nq=norm(ui.search.q);
   const hit=data.schools.filter(s=>(!nq||norm(s.name).includes(nq)||norm(s.yomi).includes(nq))&&(!ui.search.field||s.field===ui.search.field)&&(!ui.search.pref||s.pref===ui.search.pref));
   count.textContent=hit.length?hit.length+"こ みつかりました":"みつかりませんでした";
   results.replaceChildren(...hit.map(card));
  };
  q.addEventListener("input",draw);fs.addEventListener("change",draw);ps.addEventListener("change",draw);
  body.append(el("div",{class:"st-search"},q,fs,ps),count,results);draw();
 }else if(ui.page==="detail"){
  const s=sch(ui.detailId);title="がっこうの こと";
  const slot=wish.choices.indexOf(s.id);
  body.append(el("button",{type:"button",id:"st-back",onclick:()=>go(ui.back||"search")},"← もどる"),
   el("h3",{id:"d-name",text:s.name},s.recommended?el("span",{class:"st-badge",text:"おすすめ"}):null),
   el("p",{class:"st-lead",text:s.yomi}),
   el("dl",{class:"st-dl"},el("dt",{text:"ぶんや"}),el("dd",{id:"d-field",text:fieldL(s.field)}),
    el("dt",{text:"ばしょ"}),el("dd",{id:"d-pref",text:prefL(s.pref)}),
    el("dt",{text:"つぎの オープンキャンパス"}),el("dd",{id:"d-oc",text:ocStu(s.nextOc)})),
   el("ul",{class:"st-links",id:"d-links"},
    el("li",null,el("a",{href:s.links.home,target:"_blank",rel:"noopener noreferrer",text:"ホームページ"})),
    el("li",null,el("a",{href:s.links.boshu,target:"_blank",rel:"noopener noreferrer",text:"ぼしゅう ようこう"})),
    el("li",null,el("a",{href:s.links.oc,target:"_blank",rel:"noopener noreferrer",text:"オープンキャンパス"}))),
   slot>=0
    ?el("p",{class:"st-lead",id:"d-inwish",text:SLOT_STU[slot]+"に はいって います。"})
    :el("button",{type:"button",class:"primary",id:"d-add",style:"width:100%",onclick:()=>{const r=addWish(ui.me,s.id);ui.msg={text:r.msg,ng:!r.ok};renderStudent();}},"きぼうに いれる"));
 }else{
  title="わたしの きぼう";
  body.append(el("p",{class:"st-lead",text:"きぼうの がっこうを 3つ まで いれられます。いつでも かえられます。せんせいの きょかは いりません。"}));
  wish.choices.forEach((id,i)=>{
   const s=id?sch(id):null;
   body.append(el("div",{class:"st-slot","data-slot":i},
    el("span",{class:"no",text:SLOT_STU[i]}),
    s?el("span",{class:"wname",text:s.name}):el("span",{class:"empty",text:"まだ ありません"}),
    s?el("div",{class:"acts"},
     el("button",{type:"button",class:"w-detail",onclick:()=>go("detail",{detailId:id,back:"wish"})},"みる"),
     i>0?el("button",{type:"button",class:"w-up",onclick:()=>{moveUp(ui.me,i);ui.msg={text:"じゅんばんを かえました。"};renderStudent();}},"うえへ"):null,
     el("button",{type:"button",class:"danger w-del",onclick:()=>{removeWish(ui.me,i);ui.msg={text:"けしました。"};renderStudent();}},"けす")):null));
  });
  if(wish.choices.includes(null))body.append(el("button",{type:"button",style:"width:100%;margin-top:10px",onclick:()=>go("search")},"がっこうを さがして いれる"));
  const pf=el("select",{id:"w-pref"},el("option",{value:"",text:"きめて いない"}),data.prefs.map(p=>el("option",{value:p.k,text:p.label})));pf.value=wish.pref;
  const fd=el("select",{id:"w-field"},el("option",{value:"",text:"きめて いない"}),data.fields.map(f=>el("option",{value:f.k,text:f.label})));fd.value=wish.field;
  const save=()=>{const w=wishes[ui.me];if(commitWish(ui.me,{choices:w.choices,pref:pf.value,field:fd.value}))ui.msg={text:"かえました。"};renderStudent();};
  pf.addEventListener("change",save);fd.addEventListener("change",save);
  body.append(el("label",{class:"st-field"},"すみたい ばしょ（なくても いいです）",pf),
   el("label",{class:"st-field"},"べんきょう したい ぶんや（なくても いいです）",fd),
   el("p",{class:"st-updated",id:"w-updated",text:wish.updatedAt?"さいごに かえた ひ： "+fmtStu(wish.updatedAt):"まだ いれて いません"}));
 }
 if(msg)body.prepend(msg);
 const tab=(page,label)=>el("button",{type:"button",id:"st-tab-"+page,"aria-current":(ui.page===page||(ui.page==="detail"&&ui.back===page))?"page":null,onclick:()=>go(page)},label);
 root.replaceChildren(el("div",{class:"st-phone"},
  el("div",{class:"st-head"},el("small",{text:me.name+" さん"}),el("h2",{text:title})),
  body,
  el("nav",{class:"st-tabs","aria-label":"メニュー"},tab("rec","おすすめ"),tab("search","さがす"),tab("wish","きぼう"))));
}

// ================= 職員の画面 =================
function matchState(no){
 const o=official[no];if(!o)return "none";
 const w=wishes[no];
 const same=w.choices.every((c,i)=>(c||null)===(o.choices[i]||null))&&w.pref===o.pref&&w.field===o.field;
 return same?"same":"diff";
}
const FLAG={same:["一致","ok"],diff:["食い違いあり","ng"],none:["未確認","na"]};
const fieldStaff=k=>k?fieldOf(k).staff:"指定なし";
const prefStaff=k=>k?prefOf(k).staff:"指定なし";
function histText(h){
 if(h.kind==="school")return [SLOT_STAFF[h.slot],nameOrDash(h.from),nameOrDash(h.to)];
 if(h.kind==="pref")return ["場所の希望",prefStaff(h.from),prefStaff(h.to)];
 return ["分野の希望",fieldStaff(h.from),fieldStaff(h.to)];
}
function renderStaff(){
 const root=document.getElementById("staff-root");
 const tab=(k,label)=>el("button",{type:"button",id:"staff-tab-"+k,"aria-current":ui.staffTab===k?"page":null,onclick:()=>{ui.staffTab=k;renderStaff();}},label);
 const kids=[el("div",{class:"sf-tabs"},tab("students","学生の希望"),tab("rec","おすすめの管理"))];
 if(ui.staffTab==="students"){
  const rows=STUDENTS.map(s=>{
   const w=wishes[s.no],m=FLAG[matchState(s.no)];
   return el("tr",{"data-no":s.no,class:ui.staffSel===s.no?"sel":null},
    el("td",{text:s.no}),el("td",null,el("button",{type:"button",class:"sf-open",onclick:()=>{ui.staffSel=s.no;renderStaff();}},s.name)),
    el("td",{text:s.cls}),
    w.choices.map(c=>el("td",{text:c?schoolOf(c).name:"—"})),
    el("td",{text:w.pref?prefOf(w.pref).staff:"—"}),el("td",{text:w.field?fieldOf(w.field).staff:"—"}),
    el("td",{text:fmtStaff(w.updatedAt)}),
    el("td",null,el("span",{class:"sf-flag "+m[1],text:m[0]})));
  });
  kids.push(el("div",{class:"sf-panel"},
   el("h2",{text:"学生ごとの現在の希望"}),
   el("p",{class:"sf-note",text:"学生が自分で入れた希望です（学生はいつでも変更でき、職員の許可は不要）。右端は、職員が確認した正式な記録との比較です。"}),
   el("div",{class:"sf-scroll"},el("table",{class:"sf-table",id:"staff-students"},
    el("thead",null,el("tr",null,["学籍番号","氏名","クラス","第1希望","第2希望","第3希望","場所","分野","最終変更","正式な記録"].map(h=>el("th",{text:h})))),
    el("tbody",null,rows)))));
  const s=STUDENTS.find(x=>x.no===ui.staffSel);
  if(s){
   const w=wishes[s.no],o=official[s.no];
   const line=(label,cur,off,isDiff)=>[el("dt",{text:label}),el("dd",{class:isDiff?"diff":null,text:cur+(isDiff?"（正式な記録と異なる）":"")})];
   const curBox=el("div",{class:"sf-box",id:"staff-current"},el("h3",{text:"学生が入れた希望"}),
    el("dl",null,
     w.choices.map((c,i)=>line(SLOT_STAFF[i],c?schoolOf(c).name:"なし",null,o&&(c||null)!==(o.choices[i]||null))),
     line("場所",prefStaff(w.pref),null,o&&w.pref!==o.pref),
     line("分野",fieldStaff(w.field),null,o&&w.field!==o.field),
     line("最終変更",fmtStaff(w.updatedAt),null,false)));
   const offBox=el("div",{class:"sf-box official",id:"staff-official"},el("h3",{text:"職員が確認した正式な記録"}),
    o?el("dl",null,
      o.choices.flatMap((c,i)=>[el("dt",{text:SLOT_STAFF[i]}),el("dd",{text:c?schoolOf(c).name:"なし"})]),
      el("dt",{text:"場所"}),el("dd",{text:prefStaff(o.pref)}),
      el("dt",{text:"分野"}),el("dd",{text:fieldStaff(o.field)}),
      el("dt",{text:"確認"}),el("dd",{text:o.by+" ・ "+fmtStaff(o.at)}))
     :el("p",{class:"sf-note",text:"まだ確認していません。"}),
    el("p",{class:"sf-note",text:"見本では固定の値です（この画面からは変更できません）。"}));
   const hist=w.history.slice().reverse();
   kids.push(el("div",{class:"sf-panel",id:"staff-detail","data-no":s.no},
    el("h2",{text:s.name+"（"+s.no+"）"}),
    el("p",{class:"sf-flag "+FLAG[matchState(s.no)][1],id:"staff-match",text:"正式な記録との比較："+FLAG[matchState(s.no)][0]}),
    el("div",{class:"sf-compare"},curBox,offBox),
    el("h3",{text:"変更の履歴（新しい順）"}),
    hist.length?el("div",{class:"sf-scroll"},el("table",{class:"sf-table",id:"staff-history"},
     el("thead",null,el("tr",null,["日時","項目","変更前","変更後"].map(h=>el("th",{text:h})))),
     el("tbody",null,hist.map(h=>{const[t,f,to]=histText(h);return el("tr",null,el("td",{text:fmtStaff(h.at)}),el("td",{text:t}),el("td",{text:f}),el("td",{text:to}));}))))
     :el("p",{class:"sf-note",id:"staff-history-empty",text:"変更の履歴はまだありません。"})));
  }
 }else{
  const n=recs.size;
  const rows=SCHOOLS.map(s=>{
   const r=recs.get(s.id),pending=ui.pendingRec===s.id;
   let act;
   if(r)act=el("button",{type:"button",class:"danger rec-off",onclick:()=>{unsetRec(s.id);renderStaff();}},"外す");
   else if(pending){
    const inp=el("input",{type:"text",class:"rec-reason",maxlength:"80",placeholder:"理由（1行・学生には表示しません）","aria-label":"おすすめにする理由"});
    act=el("div",null,el("div",{class:"sf-reason"},inp,
      el("button",{type:"button",class:"primary rec-save",onclick:()=>{const res=setRec(s.id,inp.value);if(!res.ok){ui.recErr=res.msg;renderStaff();return;}ui.pendingRec=null;ui.recErr="";renderStaff();}},"付ける"),
      el("button",{type:"button",class:"rec-cancel",onclick:()=>{ui.pendingRec=null;ui.recErr="";renderStaff();}},"やめる")),
     ui.recErr?el("p",{class:"sf-err",role:"alert",text:ui.recErr}):null);
   }else act=el("button",{type:"button",class:"rec-on",onclick:()=>{ui.pendingRec=s.id;ui.recErr="";renderStaff();}},"おすすめにする");
   return el("tr",{"data-id":s.id},
    el("td",{text:s.name}),el("td",{text:fieldOf(s.field).staff}),el("td",{text:prefOf(s.pref).staff}),el("td",{text:ocStaff(s.nextOc)}),
    el("td",{class:"staff-memo",text:s.memo}),el("td",{class:"staff-contact",text:s.contact}),
    el("td",{class:"rec-state"},r?[el("b",{text:"おすすめ"}),el("div",{class:"rec-why",text:"理由："+r.reason}),el("div",{class:"sf-note",text:r.by+" ・ "+fmtStaff(r.at)})]:"—"),
    el("td",null,act));
  });
  kids.push(el("div",{class:"sf-panel"},
   el("h2",{text:"おすすめの管理"}),
   el("p",{class:"sf-note",text:"おすすめの印は職員が付けます（自動では付きません）。付けるときは理由を1行入力してください。理由・内部メモ・窓口メモは職員だけに表示し、学生の画面には出しません。"}),
   el("p",{class:"sf-count"+(n>REC_GUIDE?" warn":""),id:"rec-count",text:"おすすめ "+n+"校（目安は10校前後まで）"+(n>REC_GUIDE?"。多すぎると学生が選びにくくなります。":"")}),
   el("div",{class:"sf-scroll"},el("table",{class:"sf-table",id:"staff-rec"},
    el("thead",null,el("tr",null,["学校名","分野","所在地","次回オープンキャンパス","内部メモ","窓口メモ","おすすめ","操作"].map(h=>el("th",{text:h})))),
    el("tbody",null,rows))),
   el("h3",{text:"この見本での操作の記録"}),
   recLog.length?el("ol",{class:"sf-log",id:"rec-log"},recLog.map(l=>el("li",{text:fmtStaff(l.at)+" "+l.by+"が「"+schoolOf(l.id).name+"」のおすすめを"+l.act}))):el("p",{class:"sf-note",text:"まだありません。ページを再読み込みすると消えます。"})));
 }
 root.replaceChildren(...kids);
}

// ================= 切り替え =================
function setMode(m){
 ui.mode=m;
 document.getElementById("mode-student").setAttribute("aria-pressed",String(m==="student"));
 document.getElementById("mode-staff").setAttribute("aria-pressed",String(m==="staff"));
 document.getElementById("student-root").hidden=m!=="student";
 document.getElementById("staff-root").hidden=m!=="staff";
 document.getElementById("me-wrap").hidden=m!=="student";
 if(m==="student")renderStudent();else renderStaff();
}
const meSel=document.getElementById("me-select");
meSel.append(...STUDENTS.map(s=>el("option",{value:s.no,text:s.name+"（"+s.no+"）"})));
meSel.value=ui.me;
meSel.addEventListener("change",()=>{ui.me=meSel.value;ui.page="wish";ui.msg=null;renderStudent();});
document.getElementById("mode-student").addEventListener("click",()=>setMode("student"));
document.getElementById("mode-staff").addEventListener("click",()=>setMode("staff"));
setMode("student");

// 検査用の窓口（画面の動きは変えない）
window.shingakuPreview={STAFF_ONLY_KEYS,MAX_WISHES,REC_GUIDE,
 schoolCount:()=>SCHOOLS.length,students:()=>STUDENTS.map(s=>s.no),
 studentPayload:buildStudentPayload,myWish:()=>buildMyWish(ui.me),
 staffOnlyTexts:()=>SCHOOLS.flatMap(s=>STAFF_ONLY_KEYS.map(k=>s[k])).concat([...recs.values()].map(r=>r.reason)),
 history:no=>wishes[no].history.length,matchState,ready:true};
})();
