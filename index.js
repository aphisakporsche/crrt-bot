require("dotenv").config();
const express = require("express");
const line    = require("@line/bot-sdk");
const axios   = require("axios");

const app = express();
const LINE_CFG = {
  channelSecret:      process.env.LINE_CHANNEL_SECRET,
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
};
const client = new line.Client(LINE_CFG);

// ── SANITIZE lone surrogates — ป้องกัน 400 Bad Request จาก LINE ──────────────
// สาเหตุ: emoji surrogate pair ที่ถูก split กลางคัน ทำให้ JSON invalid
function _san(obj) {
  if (typeof obj === 'string') {
    return obj.replace(/[\uD800-\uDFFF]/g, function(ch, offset, str) {
      const code = ch.charCodeAt(0);
      if (code >= 0xD800 && code <= 0xDBFF) {
        const next = str.charCodeAt(offset + 1);
        if (next >= 0xDC00 && next <= 0xDFFF) return ch;
        return '';
      } else {
        const prev = str.charCodeAt(offset - 1);
        if (prev >= 0xD800 && prev <= 0xDBFF) return ch;
        return '';
      }
    });
  }
  if (Array.isArray(obj)) return obj.map(_san);
  if (obj && typeof obj === 'object') {
    const r = {};
    for (const [k, v] of Object.entries(obj)) r[k] = _san(v);
    return r;
  }
  return obj;
}
const _reply = client.replyMessage.bind(client);
client.replyMessage = (token, msg) => _reply(token, _san(msg));
const _push = client.pushMessage.bind(client);
client.pushMessage = (uid, msg) => _push(uid, _san(msg));


// ── SMART LABEL — ย่อ label ปุ่มไม่เกิน 20 chars โดยไม่ตัดกลางคำ ─────────────
function _lbl(s, max = 20) {
  if (!s) return String(s || '');
  const str = _san(String(s));
  if (str.length <= max) return str;
  // หา word break ที่ใกล้สุด
  let cut = str.slice(0, max - 2);
  const sp = Math.max(cut.lastIndexOf(' '), cut.lastIndexOf('/'), cut.lastIndexOf('('));
  if (sp > max * 0.5) cut = cut.slice(0, sp);
  return cut.trim() + '..';
}

const GEMINI_KEY  = process.env.GEMINI_API_KEY;
const SHEET_ID    = process.env.GOOGLE_SHEET_ID;
const SHEET_KEY   = process.env.GOOGLE_API_KEY;
const OLD_WEBHOOK = process.env.OLD_WEBHOOK_URL || "";
const LOGO_URL    = "https://drive.google.com/uc?export=view&id=1Iiih5zuOol80ZfhUEJZaBXzDODDgVlsY";
const MACHINE_URL = "https://drive.google.com/uc?export=view&id=14s4gUf4HPN-8ge9sUqiOfkDsZzBxUcTq";

// ── FIX EMOJI encode แปลกจาก Google Sheet ────────────────────────────────────
function F(s) {
  if (!s) return "";
  return String(s)
    .replace(/ð\u009f\u0094\u008d/g,"🔍").replace(/ð\u009f\u009a\u0080/g,"🚀")
    .replace(/ð\u009f\u0094´/g,"🔴").replace(/ð\u009f\u009a¨/g,"🚨")
    .replace(/ð\u009f\u0094µ/g,"🔵").replace(/ð\u009f\u009f¢/g,"🟢")
    .replace(/ð\u009f\u009f£/g,"🟣").replace(/ð\u009f\u009f¡/g,"🟡")
    .replace(/ð\u009f\u009f\u0020/g,"🟠 ").replace(/ð\u009f\u009f\u00a0/g,"🟠")
    .replace(/ð\u009f\u009f©/g,"🟩").replace(/ð\u009f\u009f¤/g,"🟤")
    .replace(/ð\u009f\u0093\u009e/g,"📞").replace(/ð\u009f\u0094\u0084/g,"🔄")
    .replace(/ð\u009f\u0093\u008c/g,"📌").replace(/ð\u009f\u009a¿/g,"🚿")
    .replace(/ð\u009f\u0092\u0089/g,"💉").replace(/ð\u009f\u0094\u008b/g,"🔋")
    .replace(/ð\u009f\u0094¼/g,"🔼").replace(/ð\u009f\u0094\u008c/g,"🔌")
    .replace(/ð\u009f\u0093\u0088/g,"📈").replace(/ð\u009f\u009b¢/g,"🛢")
    .replace(/ð\u009f\u008e\u0089/g,"🎉").replace(/ð\u009f\u0091\u0087/g,"👇")
    .replace(/ð\u009f\u0099\u008f/g,"🙏").replace(/ð\u009f\u0092¡/g,"💡")
    .replace(/ð\u009f\u0093±/g,"📱").replace(/ð\u009f\u0095\u0090/g,"🕐")
    .replace(/ð\u009f\u0093\u008b/g,"📋").replace(/ð\u009f\u0093\u0090/g,"📐")
    .replace(/ð\u009f\u0093¡/g,"📡").replace(/ð\u009f\u008e¬/g,"🎬")
    .replace(/ð\u009f\u009b\u008d/g,"🛍").replace(/ð\u009f\u0092\u008a/g,"💊")
    .replace(/ð\u009f\u0094§/g,"🔧").replace(/ð\u009f\u0092ª/g,"💪")
    .replace(/ð\u009f\u0093º/g,"📺").replace(/ð\u009f\u0093\u0096/g,"📖")
    .replace(/ð\u009f\u008f¥/g,"🏥").replace(/ð\u009f\u0091¨/g,"👨")
    .replace(/ð\u009f\u0092§/g,"💧").replace(/ð\u009f\u009aª/g,"🚪")
    .replace(/ð\u009f\u008f\u0020/g,"🏠 ").replace(/ð\u009f\u0093\u009d/g,"📝")
    .replace(/ð\u009f\u0093¸/g,"📸").replace(/ð\u009f\u0094¬/g,"🔬")
    .replace(/ð\u009f\u009a\u0082/g,"🚂").replace(/ð\u009f\u0094\u008a/g,"🔊")
    .replace(/ð\u009f\u009b\u0086/g,"🛆").replace(/ð\u009f\u0092\u009a/g,"💚")
    .replace(/ð\u009f\u009f©ï¸/g,"🟩").replace(/ð\u009f\u0094°/g,"🔰")
    .replace(/ð\u009f\u0091¤/g,"👤").replace(/ð\u009f\u0092\u0088/g,"💈")
    .replace(/ð\u009f\u009a¹/g,"🚹").replace(/ð\u009f\u009b¢ï¸/g,"🛢")
    .replace(/ð\u009f\u0093¦/g,"📦").replace(/ð\u009f\u0091\u008b/g,"👋")
    .replace(/ð\u009f\u009f\u009f/g,"").replace(/ð\u009f\u008f\u0000/g,"🏠")
    .replace(/ð[\u0080-\u00bf][\u0080-\u00bf][\u0080-\u00bf]/g,"")
    .replace(/ð[\u0080-\u00bf][\u0080-\u00bf]/g,"")
    .replace(/ð[\u0080-\u00bf]/g,"");
}

// ── DB ────────────────────────────────────────────────────────────────────────
let DB_MAIN = [], DB_SUB = [], DB_LAST = 0;
const TTL = 5*60*1000;

async function loadDB() {
  if (Date.now()-DB_LAST < TTL) return;
  try {
    const get = async (sheet) => {
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(sheet)}?key=${SHEET_KEY}`;
      const r = await axios.get(url);
      const rows = r.data.values||[];
      if (rows.length<2) return [];
      const h = rows[0].map(x=>x.trim());
      return rows.slice(1).map(row=>{const o={};h.forEach((k,i)=>{o[k]=(row[i]||"").trim()});return o});
    };
    [DB_MAIN, DB_SUB] = await Promise.all([get("Main_Database"), get("Sub_Flows")]);
    DB_LAST = Date.now();
    console.log(`DB ok Main=${DB_MAIN.length} Sub=${DB_SUB.length}`);
  } catch(e) { console.error("DB error", e.message); }
}

// ── SESSION ───────────────────────────────────────────────────────────────────
const sessions = new Map();
const S_TTL = 30*60*1000;
function isActive(uid){const s=sessions.get(uid);if(!s?.crrtActive)return false;if(Date.now()-s.lastActive>S_TTL){sessions.delete(uid);return false;}return true;}
function activate(uid){sessions.set(uid,{crrtActive:true,lastActive:Date.now()});}
function touch(uid){const s=sessions.get(uid);if(s)s.lastActive=Date.now();}
function deactivate(uid){sessions.delete(uid);}

function findAlarm(text){
  const q=text.toLowerCase().trim();
  return DB_MAIN.find(r=>r.alarm_title?.toLowerCase()===q)||
    DB_MAIN.find(r=>r.keywords?.toLowerCase().split(",").some(k=>{const kw=k.trim();return q.includes(kw)||kw.includes(q)}))||null;
}
function getSub(trigger){return DB_SUB.filter(r=>r.trigger_word===trigger);}

const T2T = {
  "Return Blood":"return_blood","Blood Recirculation":"nss_recirculation",
  "NSS Recirculation":"nss_recirculation","Cardiac Arrest":"cardiac_arrest",
  "Hypotension":"hypotension","Air Detected":"air_detected",
  "Access Extremely Negative":"access_neg","Return Extremely Positive":"return_pos",
  "Blood Leak Detected":"blood_leak","Filter Clotted / Filter Pressure High":"filter_clotted",
  "System Error / Self-Test Failed":"system_error","TMP Too High":"tmp_high",
  "Bag Empty / Effluent Bag Full":"bag_empty","Flow Error / Weight Incorrect":"flow_error",
  "Syringe Empty / Syringe not loaded":"syringe_empty","Battery Low / No AC Power":"battery_low",
  "Access Extremely Positive":"access_pos","Disconnect Detected":"disconnect",
  "Check Access":"check_access","Scale Open":"scale_open","Self-Test Failed":"self_test_failed",
  "Communication Loss":"comm_loss","PBP / Replacement / Dialysate Line Clamped":"line_clamped",
  "Effluent Scale Overload":"effluent_overload",
};

const NAV = new Set(["main_menu","alarm_menu","alarm_menu_2","alarm_menu_3","how_to_use","show_hotline","fallback","update_status","exit_crrt","how_to_return","how_to_closeloop","how_to_swap_dlc","how_to_swap_dlc_2","how_to_flush_dlc","restart_crrt_flow","end_crrt_flow","ask_doctor_plan","show_cleanup","show_non_citrate","show_with_citrate","crrt_knowledge","crrt_mode_info","crrt_pressure_info"]);

const AC = {
  "cardiac_arrest":    {color:"#B71C1C",light:"#FFF5F5",emoji:"❤️", tag:"วิกฤต",   lv:"🔴 CRITICAL"},
  "blood_leak":        {color:"#C62828",light:"#FFF5F5",emoji:"🩸", tag:"วิกฤต",   lv:"🔴 CRITICAL"},
  "disconnect":        {color:"#880E4F",light:"#FFF0F5",emoji:"🔌", tag:"วิกฤต",   lv:"🔴 CRITICAL"},
  "air_detected":      {color:"#E53935",light:"#FFF3E0",emoji:"🫧", tag:"เร่งด่วน",lv:"🔴 CRITICAL"},
  "system_error":      {color:"#4527A0",light:"#F3F0FF",emoji:"⚙️", tag:"ระบบ",    lv:"🔴 CRITICAL"},
  "tmp_high":          {color:"#E65100",light:"#FFF8F0",emoji:"📊", tag:"เร่งด่วน",lv:"🟡 WARNING"},
  "filter_clotted":    {color:"#BF360C",light:"#FFF3EE",emoji:"🔧", tag:"เร่งด่วน",lv:"🟡 WARNING"},
  "access_neg":        {color:"#1A237E",light:"#EEF0FF",emoji:"📉", tag:"เตือน",   lv:"🟡 WARNING"},
  "return_pos":        {color:"#0D47A1",light:"#EEF5FF",emoji:"📈", tag:"เตือน",   lv:"🟡 WARNING"},
  "access_pos":        {color:"#006064",light:"#EEFFFE",emoji:"📈", tag:"เตือน",   lv:"🟡 WARNING"},
  "hypotension":       {color:"#B71C1C",light:"#FFF5F5",emoji:"📉", tag:"เร่งด่วน",lv:"🔴 CRITICAL"},
  "battery_low":       {color:"#E65100",light:"#FFF8F0",emoji:"⚡", tag:"เร่งด่วน",lv:"🟡 WARNING"},
  "comm_loss":         {color:"#37474F",light:"#F4F6F7",emoji:"📡", tag:"ระบบ",    lv:"🟡 WARNING"},
  "bag_empty":         {color:"#00695C",light:"#EEFFFE",emoji:"💧", tag:"เตือน",   lv:"🟢 ADVISORY"},
  "flow_error":        {color:"#2E7D32",light:"#EEFFF2",emoji:"⚖️", tag:"เตือน",   lv:"🟢 ADVISORY"},
  "syringe_empty":     {color:"#6A1B9A",light:"#F6EEFF",emoji:"💉", tag:"เตือน",   lv:"🟢 ADVISORY"},
  "scale_open":        {color:"#F57F17",light:"#FFFCEE",emoji:"⚖️", tag:"ระวัง",   lv:"🟢 ADVISORY"},
  "check_access":      {color:"#827717",light:"#FDFFF0",emoji:"🔍", tag:"ระวัง",   lv:"🟢 ADVISORY"},
  "line_clamped":      {color:"#1B5E20",light:"#EEFFF2",emoji:"🟢", tag:"เตือน",   lv:"🟢 ADVISORY"},
  "effluent_overload": {color:"#E65100",light:"#FFF8F0",emoji:"⚖️", tag:"เร่งด่วน",lv:"🟡 WARNING"},
  "return_blood":      {color:"#C62828",light:"#FFF5F5",emoji:"🩸", tag:"เร่งด่วน",lv:"🟢 ADVISORY"},
  "nss_recirculation": {color:"#0277BD",light:"#EEF7FF",emoji:"💧", tag:"เตือน",   lv:"🟢 ADVISORY"},
  "self_test_failed":  {color:"#4527A0",light:"#F3F0FF",emoji:"⚙️", tag:"ระบบ",    lv:"🟡 WARNING"},
};
function ac(t){return AC[t]||{color:"#1A237E",light:"#EEF0FF",emoji:"🚨",tag:"Alarm",lv:"⚪ ALARM"};}

// ── SECTION STYLES ────────────────────────────────────────────────────────────
const SS = {
  goal:  {bar:"#1565C0", bg:"#E3F2FD", hc:"#0D47A1", icon:"🎯"},
  cause: {bar:"#E65100", bg:"#FFF3E0", hc:"#BF360C", icon:"🔍"},
  step:  {bar:"#2E7D32", bg:"#E8F5E9", hc:"#1B5E20", icon:"🚀"},
  warn:  {bar:"#C62828", bg:"#FFEBEE", hc:"#B71C1C", icon:"⚠️"},
  info:  {bar:"#6A1B9A", bg:"#F3E5F5", hc:"#4A148C", icon:"💡"},
};

// ── PARSER ────────────────────────────────────────────────────────────────────
// instruction ใน Sheet เป็น 1 บรรทัดยาว แยก section ด้วย emoji headers
function parse(rawInput) {
  if (!rawInput) return [{s:SS.step, head:"ไม่มีข้อมูลขั้นตอน", items:[]}];

  // Fix emoji + clean
  const text = F(rawInput)
    .replace(/【[^】]*】/g,"")
    .replace(/\\\[/g,"[").replace(/\\\]/g,"]")
    .replace(/\\>/g,">").replace(/\\</g,"<")
    .replace(/\\!/g,"!").replace(/\\_/g,"_")
    .trim();

  if (!text) return [{s:SS.step, head:"ไม่มีข้อมูลขั้นตอน", items:[]}];

  // แยก sections ด้วย lookahead ก่อน section emoji
  const parts = text.split(/(?=🔍\s|⏱️\s|🚀\s|▶️\s*(?:ขั้น|Step)|⚠️\s*(?:ข้อ|Nursing))/)
    .map(s=>s.trim()).filter(Boolean);

  const sections = [];
  for (const part of parts) {
    if (/^⚠️\s*(ข้อมูลนี้|ข้อมูล นี้)/.test(part)) continue;

    let skey = "step";
    if (/^🔍/.test(part))      skey = "cause";
    else if (/^⏱️/.test(part)) skey = "goal";
    else if (/^🚀/.test(part)) skey = "step";
    else if (/^▶️/.test(part)) skey = "step";
    else if (/^⚠️/.test(part)) skey = "warn";

    // แยก items ด้วย emoji number 1️⃣2️⃣3️⃣
    const sub = part.split(/(?=1️⃣|2️⃣|3️⃣|4️⃣|5️⃣|6️⃣|7️⃣|8️⃣|9️⃣)/)
      .map(s=>s.trim()).filter(Boolean);

    const head = (sub[0]||"")
      .replace(/^[🔍⏱️🚀⚠️💡🔄📌]\s*/,"")
      .replace(/^▶️\s*/,"")
      .trim();

    const items = sub.slice(1)
      .map(x=>x.replace(/^[1-9]️⃣\s*/,"").trim())
      .filter(Boolean);

    // ถ้า head ยาวมาก (ข้อมูลฝังใน head) ให้แสดงเป็น item
    if (items.length===0 && head.length>100) {
      // แยกด้วยเครื่องหมายจุลภาคหรือช่องว่างหลายอัน
      const subItems = head.split(/[,，]\s*|\s{2,}/).filter(s=>s.length>3).slice(0,6);
      sections.push({s:SS[skey], head: head, items: subItems.length>1?subItems.slice(1):[]});
    } else {
      sections.push({s:SS[skey], head, items});
    }
  }

  // Fallback
  if (sections.length===0) {
    const items = text
      .split(/▶️\s*[^1️⃣2️⃣3️⃣]*|[1-9]️⃣\s*/)
      .map(s=>s.trim())
      .filter(s=>s.length>3 && !/^⚠️\s*ข้อมูลนี้/.test(s))
      ;
    return [{s:SS.step, head:"ขั้นตอน", items: items.length>0?items:[text.slice(0,200)]}];
  }
  return sections;
}

// สร้าง Flex blocks สีสวยแยก Part
function mkBlocks(sections) {
  const out = [];
  for (const sec of sections) {
    const s = sec.s;
    // Head box พร้อมสี
    if (sec.head) {
      out.push({
        type:"box", layout:"horizontal", margin:"md", spacing:"sm",
        backgroundColor:s.bg, paddingAll:"8px", cornerRadius:"8px",
        contents:[
          {type:"box",layout:"vertical",width:"4px",backgroundColor:s.bar,cornerRadius:"4px",contents:[]},
          {type:"text",text:s.icon+" "+sec.head,weight:"bold",size:"sm",color:s.hc,wrap:true,flex:1,margin:"sm"}
        ]
      });
    }
    // Items ด้วย bullet ▶ ไม่มีเลข
    for (const item of sec.items) {
      const warn = ["ห้าม","ทันที","วิกฤต","เด็ดขาด","ห้ามรอ","ห้ามฝืน","ห้ามกด","ห้ามคืน","ห้ามต่อ","ห้ามให้"].some(w=>item.includes(w));
      out.push({
        type:"box", layout:"horizontal", margin:"xs", spacing:"sm",
        paddingStart:sec.head?"8px":"0px",
        contents:[
          {type:"text",text:"▶",color:s.bar,size:"xxs",flex:0,gravity:"top",margin:"xs"},
          {type:"text",text:item,size:"sm",color:warn?"#C62828":"#333333",weight:warn?"bold":"regular",wrap:true,flex:1}
        ]
      });
    }
  }
  return out;
}

// ── ALARM FLEX ────────────────────────────────────────────────────────────────
function alarmFlex(alarm, subRows, trigger) {
  const c = ac(trigger);
  const secs = parse(alarm.instruction);
  const bs = mkBlocks(secs);

  const body = [
    {type:"box",layout:"horizontal",spacing:"sm",contents:[
      {type:"box",layout:"baseline",flex:0,paddingAll:"4px",paddingStart:"10px",paddingEnd:"10px",backgroundColor:c.color,cornerRadius:"20px",
       contents:[{type:"text",text:c.lv+" • ALARM",color:"#FFFFFF",size:"xxs",weight:"bold"}]},
      {type:"filler"},
      {type:"text",text:c.tag,color:c.color,size:"xs",weight:"bold",flex:0}
    ]},
    {type:"text",text:alarm.alarm_title||"Alarm",weight:"bold",size:"xl",color:c.color,wrap:true,margin:"sm"},
    {type:"separator",margin:"sm",color:c.color},
    ...(bs.length>0 ? bs : [{type:"text",text:"กรุณาดูข้อมูลในระบบครับ",size:"sm",color:"#555555",wrap:true,margin:"sm"}]),
    {type:"separator",margin:"lg",color:"#EEEEEE"},
    {type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#FFF8E1",paddingAll:"8px",cornerRadius:"8px",spacing:"sm",
     contents:[
       {type:"text",text:"⚠️",size:"sm",flex:0},
       {type:"text",text:"ใช้วิจารณญาณทางคลินิกประกอบเสมอ",size:"xxs",color:"#795548",wrap:true,flex:1}
     ]}
  ];

  // Buttons
  const btns = [];
  for (let n=1;n<=6;n++) {
    const lbl = F((alarm[`btn_${n}_label`]||"").trim());
    const act = (alarm[`btn_${n}_action`]||"").trim();
    if (!lbl||lbl==="nan"||!act||act==="nan") continue;
    btns.push({type:"button",
      action:act.startsWith("http")?{type:"uri",label:_lbl(lbl),uri:act}:{type:"message",label:_lbl(lbl),text:act},
      style:btns.length===0?"primary":"secondary",color:btns.length===0?c.color:undefined,height:"sm",margin:"xs"});
  }
  if (btns.length===0) {
    subRows.filter(r=>r.next_step_label).slice(0,4).forEach((r,i)=>{
      const lbl=F(r.next_step_label||"");
      btns.push({type:"button",
        action:r.next_step_action?.startsWith("http")?{type:"uri",label:_lbl(lbl),uri:r.next_step_action}:{type:"message",label:_lbl(lbl),text:r.next_step_action},
        style:i===0?"primary":"secondary",color:i===0?c.color:undefined,height:"sm",margin:"xs"});
    });
  }
  if (!btns.some(b=>b.action?.text==="main_menu"))
    btns.push({type:"button",action:{type:"message",label:"🏠 Main Menu",text:"main_menu"},style:"secondary",height:"sm",margin:"xs"});

  return {type:"flex",altText:alarm.alarm_title||"CRRT Alarm",contents:{type:"bubble",
    hero:{type:"box",layout:"horizontal",backgroundColor:c.color,paddingAll:"12px",spacing:"sm",contents:[
      {type:"image",url:LOGO_URL,size:"xxs",flex:0,aspectMode:"fit",aspectRatio:"124:100"},
      {type:"box",layout:"vertical",flex:1,justifyContent:"center",contents:[
        {type:"text",text:"RA5IC · RAMATHIBODI",color:"#FFFFFF",size:"xxs"},
        {type:"text",text:"CRRT ALARM BOT",color:"#FFD700",size:"sm",weight:"bold"}
      ]},
      {type:"text",text:c.emoji,size:"xxl",flex:0,align:"center",gravity:"center"}
    ]},
    body:{type:"box",layout:"vertical",paddingAll:"14px",backgroundColor:c.light,contents:body},
    footer:{type:"box",layout:"vertical",paddingAll:"10px",spacing:"xs",backgroundColor:"#FAFAFA",contents:btns}
  }};
}

// ── SUB FLOW FLEX ──────────────────────────────────────────────────────────────
function subFlex(subRows, trigger) {
  const first = subRows.find(r=>r.follow_up_msg&&r.follow_up_msg!=="nan");
  const msg = first?.follow_up_msg||"เลือกตัวเลือกด้านล่างครับ";

  const MAP={
    "show_hotline":      {color:"#1B5E20",emoji:"📞",title:"Hotline CRRT",     bg:"#EEFFF4"},
    "show_non_citrate":  {color:"#004D40",emoji:"🔵",title:"Preset No Citrate",bg:"#EEFFFE"},
    "show_with_citrate": {color:"#E65100",emoji:"🟠",title:"Preset Citrate",   bg:"#FFF8F0"},
    "crrt_knowledge":    {color:"#1565C0",emoji:"📚",title:"CRRT Knowledge",   bg:"#EFF7FF"},
    "crrt_mode_info":    {color:"#0D47A1",emoji:"🔄",title:"CRRT Mode",        bg:"#EEF5FF"},
    "crrt_pressure_info":{color:"#880E4F",emoji:"📊",title:"ค่า Pressure",     bg:"#FFF0F5"},
    "how_to_return":     {color:"#C62828",emoji:"🩸",title:"การคืนเลือด",      bg:"#FFF5F5"},
    "how_to_flush_dlc":  {color:"#00695C",emoji:"💉",title:"หล่อเส้น DLC",     bg:"#EEFFFE"},
    "show_cleanup":      {color:"#2E7D32",emoji:"✅",title:"เก็บเครื่อง",      bg:"#EEFFF2"},
    "alarm_menu":        {color:"#B71C1C",emoji:"🚨",title:"เมนู Alarm",       bg:"#FFF5F5"},
    "alarm_menu_2":      {color:"#B71C1C",emoji:"🚨",title:"เมนู Alarm 2/3",   bg:"#FFF5F5"},
    "alarm_menu_3":      {color:"#B71C1C",emoji:"🚨",title:"เมนู Alarm 3/3",   bg:"#FFF5F5"},
    "update_status":     {color:"#4527A0",emoji:"📋",title:"สถานะเครื่อง",    bg:"#F3F0FF"},
    "how_to_closeloop":  {color:"#0277BD",emoji:"💧",title:"NSS Recirculation",bg:"#EEF7FF"},
    "fallback":          {color:"#546E7A",emoji:"❓",title:"ไม่พบข้อมูล",      bg:"#F4F6F7"},
    "restart_crrt_flow": {color:"#1565C0",emoji:"▶️",title:"Start CRRT",       bg:"#EFF7FF"},
    "end_crrt_flow":     {color:"#C62828",emoji:"⏹️",title:"End CRRT",         bg:"#FFF5F5"},
    "ask_doctor_plan":   {color:"#1B5E20",emoji:"👨",title:"ปรึกษาแพทย์",     bg:"#EEFFF4"},
    "how_to_swap_dlc":   {color:"#00695C",emoji:"🔄",title:"สลับสาย DLC",      bg:"#EEFFFE"},
    "how_to_swap_dlc_2": {color:"#00695C",emoji:"🔄",title:"สลับสาย DLC",      bg:"#EEFFFE"},
    "flow_air_fail":     {color:"#1565C0",emoji:"💨",title:"Air Detected",     bg:"#EFF7FF"},
    "how_to_use":        {color:"#37474F",emoji:"📖",title:"วิธีใช้งาน",        bg:"#F4F6F7"},
    "exit_crrt":         {color:"#546E7A",emoji:"🚪",title:"ออกจากระบบ",       bg:"#F4F6F7"},
  };
  const m=MAP[trigger]||{color:"#1A237E",emoji:"📋",title:"CRRT Bot",bg:"#EEF0FF"};

  const secs = parse(msg);
  const bs = mkBlocks(secs);
  const body = bs.length>0 ? bs : F(msg).replace(/【[^】]*】/g,"").split(/\s{3,}|\n/).map(s=>s.trim()).filter(s=>s.length>2).map(line=>({type:"text",text:line,size:"sm",color:"#333333",wrap:true,margin:"xs"}));

  const btns = subRows.filter(r=>r.next_step_label).slice(0,5).map((r,i)=>{
    const lbl=F(r.next_step_label||"");
    return {type:"button",
      action:r.next_step_action?.startsWith("http")?{type:"uri",label:_lbl(lbl),uri:r.next_step_action}:{type:"message",label:_lbl(lbl),text:r.next_step_action},
      style:i===0?"primary":"secondary",color:i===0?m.color:undefined,height:"sm",margin:"xs"};
  });
  if (!["main_menu","exit_crrt"].includes(trigger)&&!btns.some(b=>b.action?.text==="main_menu"))
    btns.push({type:"button",action:{type:"message",label:"🏠 Main Menu",text:"main_menu"},style:"secondary",height:"sm",margin:"xs"});

  return {type:"flex",altText:m.emoji+" "+m.title,contents:{type:"bubble",
    hero:{type:"box",layout:"horizontal",backgroundColor:m.color,paddingAll:"10px",spacing:"sm",contents:[
      {type:"image",url:LOGO_URL,size:"xxs",flex:0,aspectMode:"fit",aspectRatio:"124:100"},
      {type:"box",layout:"vertical",flex:1,justifyContent:"center",contents:[
        {type:"text",text:"RA5IC · RAMATHIBODI",color:"#FFFFFF",size:"xxs"},
        {type:"text",text:m.emoji+" "+m.title,color:"#FFFFFF",size:"sm",weight:"bold",wrap:true}
      ]}
    ]},
    body:{type:"box",layout:"vertical",paddingAll:"14px",spacing:"xs",backgroundColor:m.bg,
      contents:body.length>0?body:[{type:"text",text:"เลือกตัวเลือกด้านล่างครับ",size:"sm",color:"#888888"}]},
    footer:btns.length>0?{type:"box",layout:"vertical",paddingAll:"10px",spacing:"xs",backgroundColor:"#FAFAFA",contents:btns}:undefined
  }};
}

// ── ALARM MENU ────────────────────────────────────────────────────────────────
const PAGES=[
  {title:"🚨 เมนู Alarm (1/3)",sub:"วิกฤต / เร่งด่วน",color:"#B71C1C",
   items:[
     {label:"🫧 Air Detected",text:"air_detected",color:"#E53935"},
     {label:"🩸 Blood Leak Detected",text:"blood_leak",color:"#C62828"},
     {label:"📉 Access Neg.",text:"access_neg",color:"#1A237E"},
     {label:"📈 Return Pos.",text:"return_pos",color:"#0D47A1"},
     {label:"❌ Filter Clotted",text:"filter_clotted",color:"#BF360C"},
     {label:"⚙️ System Error",text:"system_error",color:"#4527A0"},
     {label:"📊 TMP Too High",text:"tmp_high",color:"#E65100"},
     {label:"⚡ Battery Low",text:"battery_low",color:"#E65100"},
   ],next:"alarm_menu_2"},
  {title:"🚨 เมนู Alarm (2/3)",sub:"วิกฤต / สาย / อุปกรณ์",color:"#C62828",
   items:[
     {label:"📈 Access Pos.",text:"access_pos",color:"#006064"},
     {label:"🔌 Disconnect",text:"disconnect",color:"#880E4F"},
     {label:"📡 Comm. Loss",text:"comm_loss",color:"#37474F"},
     {label:"💧 Bag Empty",text:"bag_empty",color:"#00695C"},
     {label:"⚖️ Flow Error",text:"flow_error",color:"#2E7D32"},
     {label:"💉 Syringe Empty",text:"syringe_empty",color:"#6A1B9A"},
     {label:"📉 Hypotension",text:"hypotension",color:"#B71C1C"},
     {label:"❤️ Cardiac Arrest",text:"cardiac_arrest",color:"#B71C1C"},
   ],prev:"alarm_menu",next:"alarm_menu_3"},
  {title:"🚨 เมนู Alarm (3/3)",sub:"อุปกรณ์ / Procedure",color:"#D32F2F",
   items:[
     {label:"⚖️ Scale Open",text:"scale_open",color:"#F57F17"},
     {label:"🔍 Check Access",text:"check_access",color:"#827717"},
     {label:"🟢 Line Clamped",text:"line_clamped",color:"#1B5E20"},
     {label:"⚖️ Effluent OL",text:"effluent_overload",color:"#E65100"},
     {label:"🩸 Return Blood",text:"return_blood",color:"#C62828"},
     {label:"💧 NSS Recirc",text:"nss_recirculation",color:"#0277BD"},
     {label:"⚙️ Self-Test",text:"self_test_failed",color:"#4527A0"},
   ],prev:"alarm_menu_2"}
];

function menuFlex(idx){
  const p=PAGES[idx];
  const btns=p.items.map(item=>({type:"button",action:{type:"message",label:_lbl(item.label),text:item.text},style:"primary",color:item.color,height:"sm",margin:"xs"}));
  const nav=[];
  if(p.prev)nav.push({type:"button",action:{type:"message",label:"⬅️ หน้าก่อน",text:p.prev},style:"secondary",height:"sm",flex:1});
  if(p.next)nav.push({type:"button",action:{type:"message",label:"➡️ หน้าถัดไป",text:p.next},style:"primary",color:p.color,height:"sm",flex:1});
  nav.push({type:"button",action:{type:"message",label:"🏠 Main Menu",text:"main_menu"},style:"secondary",height:"sm",flex:1});
  return {type:"flex",altText:p.title,contents:{type:"bubble",
    hero:{type:"box",layout:"horizontal",backgroundColor:p.color,paddingAll:"10px",spacing:"sm",contents:[
      {type:"image",url:LOGO_URL,size:"xxs",flex:0,aspectMode:"fit",aspectRatio:"124:100"},
      {type:"box",layout:"vertical",flex:1,contents:[
        {type:"text",text:p.title,color:"#FFFFFF",size:"sm",weight:"bold"},
        {type:"text",text:p.sub,color:"#FFCCCC",size:"xs"}
      ]}
    ]},
    body:{type:"box",layout:"vertical",paddingAll:"10px",spacing:"xs",contents:btns},
    footer:{type:"box",layout:"horizontal",paddingAll:"10px",spacing:"xs",contents:nav}
  }};
}

// ── MAIN MENU ─────────────────────────────────────────────────────────────────
function mainMenu(){
  return {type:"flex",altText:"🏥 CRRT Bot RA5IC",contents:{type:"bubble",
    hero:{type:"box",layout:"vertical",backgroundColor:"#030303",paddingAll:"14px",
      contents:[{type:"box",layout:"horizontal",spacing:"sm",contents:[
        {type:"image",url:LOGO_URL,size:"xxs",flex:0,aspectMode:"fit",aspectRatio:"124:100"},
        {type:"box",layout:"vertical",flex:1,justifyContent:"center",contents:[
          {type:"text",text:"RA5IC · RAMATHIBODI",color:"#FFC800",size:"xxs"},
          {type:"text",text:"CRRT ALARM BOT",color:"#FFD700",size:"md",weight:"bold"},
          {type:"text",text:"หอผู้ป่วยวิกฤตศัลยกรรม",color:"#FFECB3",size:"xxs"}
        ]},
        {type:"image",url:MACHINE_URL,size:"xxs",flex:0,aspectMode:"fit",aspectRatio:"1:1"}
      ]}]},
    body:{type:"box",layout:"vertical",paddingAll:"12px",spacing:"sm",contents:[
      {type:"text",text:"👋 สวัสดีครับ! ยินดีต้อนรับ",weight:"bold",size:"md",color:"#1A237E"},
      {type:"box",layout:"vertical",margin:"sm",backgroundColor:"#EEF2FF",cornerRadius:"8px",paddingAll:"10px",
       contents:[
         {type:"text",text:"📖 วิธีใช้งาน",weight:"bold",size:"xs",color:"#3F51B5"},
         {type:"text",text:"1. พิมพ์ชื่อ Alarm ที่เห็นบนหน้าจอ",size:"xs",color:"#555555",margin:"xs"},
         {type:"text",text:"2. ถ่ายรูป Alarm ส่งมาได้เลย",size:"xs",color:"#555555",margin:"xs"},
         {type:"text",text:"3. กดปุ่มเมนูด้านล่างครับ 👇",size:"xs",color:"#555555",margin:"xs"}
       ]},
      {type:"box",layout:"vertical",margin:"sm",backgroundColor:"#FFF8E1",cornerRadius:"8px",paddingAll:"8px",
       contents:[{type:"text",text:"⚠️ ข้อมูลนี้เป็นแนวทางช่วยตัดสินใจเท่านั้น โปรดใช้วิจารณญาณทางคลินิกเสมอ",size:"xxs",color:"#795548",wrap:true}]}
    ]},
    footer:{type:"box",layout:"vertical",paddingAll:"10px",spacing:"xs",backgroundColor:"#FAFAFA",contents:[
      {type:"box",layout:"horizontal",spacing:"xs",contents:[
        {type:"button",action:{type:"message",label:"🚨 แก้ Alarm",text:"alarm_menu"},style:"primary",color:"#B71C1C",height:"sm",flex:1},
        {type:"button",action:{type:"message",label:"📞 Hotline",text:"show_hotline"},style:"primary",color:"#1B5E20",height:"sm",flex:1}
      ]},
      {type:"box",layout:"horizontal",spacing:"xs",margin:"xs",contents:[
        {type:"button",action:{type:"message",label:"❤️ CPR",text:"cardiac_arrest"},style:"primary",color:"#B71C1C",height:"sm",flex:1},
        {type:"button",action:{type:"message",label:"📉 Hypotension",text:"hypotension"},style:"primary",color:"#C62828",height:"sm",flex:1}
      ]},
      {type:"box",layout:"horizontal",spacing:"xs",margin:"xs",contents:[
        {type:"button",action:{type:"message",label:"🔵 No Citrate",text:"show_non_citrate"},style:"primary",color:"#004D40",height:"sm",flex:1},
        {type:"button",action:{type:"message",label:"🟠 Citrate",text:"show_with_citrate"},style:"primary",color:"#E65100",height:"sm",flex:1}
      ]},
      {type:"box",layout:"horizontal",spacing:"xs",margin:"xs",contents:[
        {type:"button",action:{type:"message",label:"🩸 คืนเลือด",text:"how_to_return"},style:"secondary",height:"sm",flex:1},
        {type:"button",action:{type:"message",label:"💧 NSS Recirc",text:"nss_recirculation"},style:"secondary",height:"sm",flex:1}
      ]},
      {type:"box",layout:"horizontal",spacing:"xs",margin:"xs",contents:[
        {type:"button",action:{type:"message",label:"💉 หล่อเส้น DLC",text:"how_to_flush_dlc"},style:"secondary",height:"sm",flex:1},
        {type:"button",action:{type:"message",label:"✅ เก็บเครื่อง",text:"show_cleanup"},style:"secondary",height:"sm",flex:1}
      ]},
      {type:"box",layout:"horizontal",spacing:"xs",margin:"xs",contents:[
        {type:"button",action:{type:"message",label:"📚 Knowledge",text:"crrt_knowledge"},style:"secondary",height:"sm",flex:1},
        {type:"button",action:{type:"message",label:"📋 สถานะ",text:"update_status"},style:"secondary",height:"sm",flex:1},
        {type:"button",action:{type:"message",label:"🚪 ออก",text:"exit_crrt"},style:"secondary",height:"sm",flex:1}
      ]}
    ]}
  }};
}

// ── GEMINI ────────────────────────────────────────────────────────────────────
const GPROMPT=`คุณคือผู้เชี่ยวชาญ CRRT วิเคราะห์รูปภาพ:
ALARM_NAME: [ชื่อ alarm ภาษาอังกฤษ หรือ unknown]
---
⏱️ เป้าหมาย: [เป้าหมาย]
🔍 สาเหตุที่พบบ่อย
1️⃣[สาเหตุ 1]
2️⃣[สาเหตุ 2]
🚀 ขั้นตอนการแก้ไข
▶️ ขั้นที่ 1: จัดการเบื้องต้น
1️⃣[ขั้นตอน 1]
2️⃣[ขั้นตอน 2]
⚠️ ข้อควรระวัง
1️⃣[ระวัง 1]
⚠️ ข้อมูลนี้เป็นแนวทางช่วยตัดสินใจเท่านั้น`;

async function analyzeImg(b64){
  const r=await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`,
    {contents:[{parts:[{text:GPROMPT},{inline_data:{mime_type:"image/jpeg",data:b64}}]}]},
    {headers:{"Content-Type":"application/json"}});
  return r.data.candidates[0].content.parts[0].text;
}
async function imgB64(msgId){
  const stream=await client.getMessageContent(msgId);
  const chunks=[];for await(const c of stream)chunks.push(c);
  return Buffer.concat(chunks).toString("base64");
}
function extractName(text){const m=text.match(/ALARM_NAME:\s*(.+)/i);return m?m[1].trim():null;}

// ── EVENT ─────────────────────────────────────────────────────────────────────
async function handleEvent(event) {
  await loadDB();
  if (OLD_WEBHOOK) axios.post(OLD_WEBHOOK,{events:[event]}).catch(()=>{});

  if(event.source?.type==="group"||event.source?.type==="room") return;
  const uid=event.source?.userId;
  if(event.type==="follow") return;
  if(event.type!=="message") return;

  const{replyToken,message}=event;

  // Image
  if(message.type==="image"){
    if(!isActive(uid))return;
    touch(uid);
    await client.replyMessage(replyToken,{type:"text",text:"🔍 กำลังวิเคราะห์ภาพ Alarm...\nรอสักครู่ครับ ⏳"});
    try{
      const b64=await imgB64(message.id);
      const result=await analyzeImg(b64);
      const name=extractName(result);
      const clean=result.replace(/^ALARM_NAME:.+\n*/i,"").trim();
      const fakeT = name&&T2T[name]?T2T[name]:"fallback";
      await client.pushMessage(uid,alarmFlex({alarm_title:"🤖 AI วิเคราะห์ Alarm",instruction:clean},[],fakeT));
      if(name&&name!=="unknown"){
        const row=findAlarm(name);
        if(row){const t=T2T[row.alarm_title];await client.pushMessage(uid,alarmFlex(row,t?getSub(t):[],t));}
      }
    }catch(e){
      console.error("img err",e.message);
      await client.pushMessage(uid,{type:"text",text:"❌ วิเคราะห์รูปไม่ได้ กรุณาพิมพ์ชื่อ Alarm ครับ"});
    }
    return;
  }

  if(message.type!=="text") return;
  const text=message.text.trim();

  // Reset
  if(["รีเซ็ต","/reset"].includes(text.toLowerCase())){deactivate(uid);await client.replyMessage(replyToken,{type:"text",text:"✅ ล้างประวัติแล้วครับ"});return;}

  // Fixed nav
  if(text==="main_menu")   {activate(uid);  await client.replyMessage(replyToken,mainMenu());return;}
  if(text==="exit_crrt")   {deactivate(uid);await client.replyMessage(replyToken,{type:"text",text:"👋 ออกจาก CRRT Bot แล้วครับ กด Rich Menu เพื่อใช้งานอีกครั้งครับ"});return;}
  if(text==="alarm_menu")  {activate(uid);  await client.replyMessage(replyToken,menuFlex(0));return;}
  if(text==="alarm_menu_2"){if(!isActive(uid))return;touch(uid);await client.replyMessage(replyToken,menuFlex(1));return;}
  if(text==="alarm_menu_3"){if(!isActive(uid))return;touch(uid);await client.replyMessage(replyToken,menuFlex(2));return;}

  if(!isActive(uid))return;
  touch(uid);

  // Sub flows
  const subRows=getSub(text);
  if(subRows.length>0){
    if(!NAV.has(text)){
      const row=DB_MAIN.find(r=>T2T[r.alarm_title]===text||r.alarm_title?.toLowerCase()===text.toLowerCase());
      if(row){const t=T2T[row.alarm_title]||text;await client.replyMessage(replyToken,alarmFlex(row,subRows,t));return;}
    }
    await client.replyMessage(replyToken,subFlex(subRows,text));
    return;
  }

  // Button responses
  const respRow=DB_MAIN.find(r=>[1,2,3,4,5,6].some(n=>r[`btn_${n}_action`]===text));
  if(respRow){
    let rt="";
    for(let n=1;n<=6;n++){if(respRow[`btn_${n}_action`]===text){rt=respRow[`btn_${n}_response`]||"";break;}}
    const t=T2T[respRow.alarm_title];
    const ns=t?getSub(t):getSub("main_menu");
    const qr=ns.filter(r=>r.next_step_label).slice(0,13).map(r=>({type:"action",action:r.next_step_action?.startsWith("http")?{type:"uri",label:_lbl(F(r.next_step_label)),uri:r.next_step_action}:{type:"message",label:_lbl(F(r.next_step_label)),text:r.next_step_action}}));
    const msg={type:"text",text:F(rt)||"✅ ดำเนินการเรียบร้อยครับ"};
    if(qr.length>0)msg.quickReply={items:qr};
    await client.replyMessage(replyToken,msg);
    return;
  }

  // Keyword search
  const row=findAlarm(text);
  if(row){const t=T2T[row.alarm_title];await client.replyMessage(replyToken,alarmFlex(row,t?getSub(t):[],t));return;}

  // Fallback
  await client.replyMessage(replyToken,subFlex(getSub("fallback"),"fallback"));
}

app.post("/webhook",line.middleware(LINE_CFG),async(req,res)=>{
  try{await Promise.all(req.body.events.map(handleEvent));res.status(200).end();}
  catch(e){console.error(e);res.status(500).end();}
});

app.get("/",(_, res)=>res.json({status:"CRRT Bot v13.0 — RA5IC",alarms:Object.keys(T2T).length}));

loadDB().then(()=>{
  const PORT=process.env.PORT||3000;
  app.listen(PORT,()=>console.log(`CRRT Bot v13.0 :${PORT}`));
});
