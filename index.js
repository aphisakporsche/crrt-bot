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

const NAV = new Set(["main_menu","alarm_menu","alarm_menu_2","alarm_menu_3","how_to_use","show_hotline","fallback","update_status","exit_crrt","how_to_return","how_to_closeloop","how_to_swap_dlc","how_to_swap_dlc_2","how_to_flush_dlc","restart_crrt_flow","end_crrt_flow","ask_doctor_plan","show_cleanup","show_non_citrate","show_with_citrate","crrt_knowledge","crrt_mode_info","crrt_pressure_info","crrt_billing","crrt_supplies","crrt_wound","crrt_calc"]);

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
    // ข้าม section ที่เป็นแค่เวลาโดด ⏱️ 2 นาที (head สั้น < 15 chars, ไม่มี items)
    if (/^⏱️\s*\d+\s*นาที\s*$/.test(part.trim())) continue;
    // ข้าม section ที่เป็นแค่ "กดปุ่มด้านล่าง" ซ้ำกับปุ่ม "กดปุ่มด้านล่าง" ซ้ำกับปุ่ม
    if (/กดปุ่มด้านล่าง|กรุณาถามแพทย์/.test(part) && part.length < 60) continue;

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
      // Merge ⏱️ timestamp section เข้ากับ goal section ก่อนหน้า
      if (skey==="goal" && head.match(/^\d+\s*นาที/) && sections.length>0 && sections[sections.length-1].s===SS.goal) {
        sections[sections.length-1].head += " ภายใน " + head;
      } else {
        sections.push({s:SS[skey], head, items});
      }
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
      action:act.startsWith("http")?{type:"uri",label:_san(lbl),uri:act}:{type:"message",label:_san(lbl),text:act},
      style:btns.length===0?"primary":"secondary",color:btns.length===0?c.color:undefined,height:"sm",adjustMode:"shrink-to-fit",margin:"xs"});
  }
  if (btns.length===0) {
    subRows.filter(r=>r.next_step_label).slice(0,4).forEach((r,i)=>{
      const lbl=F(r.next_step_label||"");
      btns.push({type:"button",
        action:r.next_step_action?.startsWith("http")?{type:"uri",label:_san(lbl),uri:r.next_step_action}:{type:"message",label:_san(lbl),text:r.next_step_action},
        style:i===0?"primary":"secondary",color:i===0?c.color:undefined,height:"sm",adjustMode:"shrink-to-fit",margin:"xs"});
    });
  }
  if (!btns.some(b=>b.action?.text==="main_menu"))
    btns.push({type:"button",action:{type:"message",label:"🏠 Main Menu",text:"main_menu"},style:"secondary",height:"sm",adjustMode:"shrink-to-fit",margin:"xs"});

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
  // ลบประโยคซ้ำท้ายที่ DB ใส่มาซ้ำกับปุ่ม
  const _cleanMsg = (s) => {
    if (!s) return s;
    return s
      .replace(/💡[^\n]*(กดปุ่มด้านล่าง|เลือกตัวเลือก|กดปุ่ม)[^\n]*👇?/g,"")
      .replace(/👇[^\n]*/g,"")
      .replace(/💡[^\n]*$/gm,"")
      .replace(/\s{3,}/g,"  ").trim();
  };
  const msg = _cleanMsg(first?.follow_up_msg)||"เลือกตัวเลือกด้านล่างครับ";

  const MAP={
    "show_hotline":      {color:"#1B5E20",emoji:"📞",title:"Hotline CRRT",     bg:"#EEFFF4"},
    "show_non_citrate":  {color:"#004D40",emoji:"🔵",title:"Preset No Citrate",bg:"#EEFFFE"},
    "show_with_citrate": {color:"#E65100",emoji:"🟠",title:"Preset Citrate",   bg:"#FFF8F0"},
    "crrt_knowledge":    {color:"#1565C0",emoji:"📚",title:"CRRT Knowledge",   bg:"#EFF7FF"},
    "crrt_billing":      {color:"#1565C0",emoji:"💳",title:"การเบิกจ่ายสิทธิ์",   bg:"#E8F0FE"},
    "crrt_supplies":     {color:"#2E7D32",emoji:"📦",title:"รหัสเบิกอุปกรณ์",      bg:"#E8F5E9"},
    "crrt_wound":        {color:"#880E4F",emoji:"🩹",title:"การทำแผล DLC",          bg:"#FCE4EC"},
    "crrt_calc":         {color:"#4527A0",emoji:"🧮",title:"คำนวณสารน้ำ CRRT",     bg:"#EDE7F6"},
    "crrt_mode_info":    {color:"#0D47A1",emoji:"🔄",title:"CRRT Mode",        bg:"#EEF5FF"},
    "crrt_pressure_info":{color:"#880E4F",emoji:"📊",title:"ค่า Pressure",     bg:"#FFF0F5"},
    "how_to_return":     {color:"#C62828",emoji:"🩸",title:"การคืนเลือด",      bg:"#FFF5F5"},
    "how_to_flush_dlc":  {color:"#00695C",emoji:"💉",title:"หล่อเส้น DLC",     bg:"#EEFFFE"},
    "show_cleanup":{color:"#2E7D32",emoji:"✅",title:"วิธีเก็บเครื่อง (รูปภาพ)",bg:"#EEFFF2"},
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
  const body = bs.length>0 ? bs : F(msg)
    .replace(/【[^】]*】/g,"")
    .replace(/💡[^\n]*(กดปุ่ม|เลือก)[^\n]*/g,"")
    .replace(/กดปุ่มด้านล่าง[^\n]*/g,"")
    .split(/\s{3,}|\n/)
    .map(s=>s.trim())
    .filter(s=>s.length>2 && !/^💡\s*(กดปุ่ม|กรุณา)/.test(s))
    .map(line=>({type:"text",text:line,size:"sm",color:"#333333",wrap:true,margin:"xs"}));

  // Knowledge menu — เพิ่มปุ่ม 4 หัวข้อใหม่
  if (trigger === "crrt_knowledge") {
    const kbBtns = [
      {label:"🔄 CRRT Mode",action:"crrt_mode_info",color:"#0D47A1"},
      {label:"📊 ค่า Pressure",action:"crrt_pressure_info",color:"#880E4F"},
      {label:"💳 การเบิกจ่ายสิทธิ์",action:"crrt_billing",color:"#1565C0"},
      {label:"📦 รหัสเบิกอุปกรณ์",action:"crrt_supplies",color:"#2E7D32"},
      {label:"🩹 การทำแผล DLC",action:"crrt_wound",color:"#880E4F"},
      {label:"🧮 คิดคำนวณสารน้ำ",action:"crrt_calc",color:"#4527A0"},
      {label:"💉 วิธีหล่อเส้น DLC",action:"how_to_flush_dlc",color:"#00695C"},
      {label:"✅ วิธีเก็บเครื่อง",action:"show_cleanup",color:"#2E7D32"},
      {label:"🏠 Main Menu",action:"main_menu",color:"#546E7A"},
    ];
    const kbFlexBtns = kbBtns.map((b,i)=>({type:"button",action:{type:"message",label:b.label,text:b.action},style:i<6?"primary":"secondary",color:b.color,height:"sm",margin:"xs",adjustMode:"shrink-to-fit"}));
    return {type:"flex",altText:"📚 CRRT Knowledge",contents:{type:"bubble",
      hero:{type:"box",layout:"horizontal",backgroundColor:"#1565C0",paddingAll:"10px",spacing:"sm",
        contents:[
          {type:"image",url:LOGO_URL,size:"xxs",flex:0,aspectMode:"fit",aspectRatio:"124:100"},
          {type:"box",layout:"vertical",flex:1,justifyContent:"center",
            contents:[
              {type:"text",text:"RA5IC · RAMATHIBODI",color:"#FFFFFF",size:"xxs"},
              {type:"text",text:"📚 CRRT Knowledge Base",color:"#FFFFFF",size:"sm",weight:"bold",wrap:true}
            ]}
        ]},
      body:{type:"box",layout:"vertical",paddingAll:"12px",spacing:"xs",backgroundColor:"#EFF7FF",
        contents:[
          {type:"text",text:"เลือกหัวข้อที่ต้องการเรียนรู้ครับ 👇",size:"sm",color:"#1A237E",weight:"bold"}
        ]},
      footer:{type:"box",layout:"vertical",paddingAll:"10px",spacing:"xs",backgroundColor:"#FAFAFA",contents:kbFlexBtns}
    }};
  }

  const btns = subRows.filter(r=>r.next_step_label).slice(0,5).map((r,i)=>{
    const lbl=F(r.next_step_label||"");
    return {type:"button",
      action:r.next_step_action?.startsWith("http")?{type:"uri",label:_san(lbl),uri:r.next_step_action}:{type:"message",label:_san(lbl),text:r.next_step_action},
      style:i===0?"primary":"secondary",color:i===0?m.color:undefined,height:"sm",adjustMode:"shrink-to-fit",margin:"xs"};
  });
  if (!["main_menu","exit_crrt"].includes(trigger)&&!btns.some(b=>b.action?.text==="main_menu"))
    btns.push({type:"button",action:{type:"message",label:"🏠 Main Menu",text:"main_menu"},style:"secondary",height:"sm",adjustMode:"shrink-to-fit",margin:"xs"});

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
     {label:"📉 Access Negative",text:"access_neg",color:"#1A237E"},
     {label:"📈 Return Positive",text:"return_pos",color:"#0D47A1"},
     {label:"❌ Filter Clotted",text:"filter_clotted",color:"#BF360C"},
     {label:"⚙️ System Error",text:"system_error",color:"#4527A0"},
     {label:"📊 TMP Too High",text:"tmp_high",color:"#E65100"},
     {label:"⚡ Battery Low",text:"battery_low",color:"#E65100"},
   ],next:"alarm_menu_2"},
  {title:"🚨 เมนู Alarm (2/3)",sub:"วิกฤต / สาย / อุปกรณ์",color:"#C62828",
   items:[
     {label:"📈 Access Positive",text:"access_pos",color:"#006064"},
     {label:"🔌 Disconnect",text:"disconnect",color:"#880E4F"},
     {label:"📡 Communication Loss",text:"comm_loss",color:"#37474F"},
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
     {label:"💧 Blood recirculation",text:"nss_recirculation",color:"#0277BD"},
     {label:"⚙️ Self-Test",text:"self_test_failed",color:"#4527A0"},
   ],prev:"alarm_menu_2"}
];

function menuFlex(idx){
  const p=PAGES[idx];
  const btns=p.items.map(item=>({type:"button",action:{type:"message",label:_san(item.label),text:item.text},style:"primary",color:item.color,height:"sm",adjustMode:"shrink-to-fit",margin:"xs"}));
  const nav=[];
  if(p.prev)nav.push({type:"button",action:{type:"message",label:"⬅️ หน้าก่อน",text:p.prev},style:"secondary",height:"sm",adjustMode:"shrink-to-fit",flex:1});
  if(p.next)nav.push({type:"button",action:{type:"message",label:"➡️ หน้าถัดไป",text:p.next},style:"primary",color:p.color,height:"sm",adjustMode:"shrink-to-fit",flex:1});
  nav.push({type:"button",action:{type:"message",label:"🏠 Main Menu",text:"main_menu"},style:"secondary",height:"sm",adjustMode:"shrink-to-fit",flex:1});
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
       contents:[{type:"text",text:"⚠️ ข้อมูลนี้เป็นแนวทางช่วยตัดสินใจเท่านั้น โปรดใช้วิจารณญาณทางคลินิกเสมอ",size:"xxs",color:"#795548",wrap:true}]},
      {type:"box",layout:"horizontal",spacing:"xs",contents:[
        {type:"button",action:{type:"message",label:"🚨 แก้ไข Alarm",text:"alarm_menu"},style:"primary",color:"#B71C1C",height:"sm",adjustMode:"shrink-to-fit",flex:1},
        {type:"button",action:{type:"message",label:"📞 Hotline",text:"show_hotline"},style:"primary",color:"#1B5E20",height:"sm",adjustMode:"shrink-to-fit",flex:1}
      ]},
      {type:"box",layout:"horizontal",spacing:"xs",margin:"xs",contents:[
        {type:"button",action:{type:"message",label:"❤️ CPR",text:"cardiac_arrest"},style:"primary",color:"#B71C1C",height:"sm",adjustMode:"shrink-to-fit",flex:1},
        {type:"button",action:{type:"message",label:"📉 Hypotension",text:"hypotension"},style:"primary",color:"#C62828",height:"sm",adjustMode:"shrink-to-fit",flex:1}
      ]},
      {type:"box",layout:"horizontal",spacing:"xs",margin:"xs",contents:[
        {type:"button",action:{type:"message",label:"🔵 Prime set c no citrate",text:"show_non_citrate"},style:"primary",color:"#004D40",height:"sm",adjustMode:"shrink-to-fit",flex:1},
        {type:"button",action:{type:"message",label:"🟠 Prime set c citrate",text:"show_with_citrate"},style:"primary",color:"#E65100",height:"sm",adjustMode:"shrink-to-fit",flex:1}
      ]},
      {type:"box",layout:"horizontal",spacing:"xs",margin:"xs",contents:[
        {type:"button",action:{type:"message",label:"🩸 คืนเลือด",text:"how_to_return"},style:"secondary",height:"sm",adjustMode:"shrink-to-fit",flex:1},
        {type:"button",action:{type:"message",label:"💧 Blood recirculation",text:"nss_recirculation"},style:"secondary",height:"sm",adjustMode:"shrink-to-fit",flex:1}
      ]},
      {type:"box",layout:"horizontal",spacing:"xs",margin:"xs",contents:[
        {type:"button",action:{type:"message",label:"💉 วิธีหล่อเส้น DLC",text:"how_to_flush_dlc"},style:"secondary",height:"sm",adjustMode:"shrink-to-fit",flex:1},
        {type:"button",action:{type:"message",label:"✅ เก็บเครื่อง",text:"show_cleanup"},style:"secondary",height:"sm",adjustMode:"shrink-to-fit",flex:1}
      ]},
      {type:"box",layout:"horizontal",spacing:"xs",margin:"xs",contents:[
        {type:"button",action:{type:"message",label:"📚 Knowledge",text:"crrt_knowledge"},style:"secondary",height:"sm",adjustMode:"shrink-to-fit",flex:1},
        {type:"button",action:{type:"message",label:"📋 Check สถานะเครื่อง",text:"update_status"},style:"secondary",height:"sm",adjustMode:"shrink-to-fit",flex:1}
      ]},
      {type:"box",layout:"horizontal",spacing:"xs",margin:"xs",contents:[
        {type:"button",action:{type:"message",label:"🚪 ออกจากระบบ",text:"exit_crrt"},style:"secondary",height:"sm",adjustMode:"shrink-to-fit",flex:1}
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

// ── KNOWLEDGE BASE HANDLERS ────────────────────────────────────────────────
const KB = {

  crrt_billing: {
    title:"💳 การเบิกจ่ายตามสิทธิ์",
    color:"#1565C0", bg:"#E8F0FE", emoji:"💳",
    sections:[
      {head:"🎯 สิทธิ์ที่ใช้ได้กับ CRRT", icon:"🎯", bar:"#1565C0", bg:"#E3F2FD", hc:"#0D47A1",
       items:["UC (บัตรทอง): ครอบคลุม CRRT ทุกส่วน ไม่มีค่าใช้จ่ายเพิ่มเติม","ข้าราชการ/รัฐวิสาหกิจ: เบิกได้เต็ม 100% รวมค่าชุดสาย Filter","ประกันสังคม: ครอบคลุม CRRT กรณีวิกฤต รพ.มีข้อตกลง","ชำระเอง (Self-pay): ตามอัตรา รพ. ติดต่อการเงินก่อนทำ"]},
      {head:"🔍 ขั้นตอนก่อน CRRT", icon:"🔍", bar:"#E65100", bg:"#FFF3E0", hc:"#BF360C",
       items:["ตรวจสอบสิทธิ์ผู้ป่วยทุกครั้งก่อนเริ่ม","กรณี UC ให้ทำ Authorization ผ่านระบบ NHSO","กรณีข้าราชการ ต้องมีใบส่งตัวจากต้นสังกัด","บันทึก Indication การทำ CRRT ใน Progress Note ทุกวัน"]}
    ]
  },

  crrt_supplies: {
    title:"📦 รหัสเบิกอุปกรณ์ CRRT",
    color:"#2E7D32", bg:"#E8F5E9", emoji:"📦",
    sections:[
      {head:"🚀 อุปกรณ์หลัก — รหัสเบิก", icon:"🚀", bar:"#2E7D32", bg:"#E8F5E9", hc:"#1B5E20",
       items:["CRRT Set (Prismaflex AN69): รหัส 1-18-03-001","Filter HF1400 (High-flux): รหัส 1-18-03-010","ถุงน้ำยา Prismasol 5L: รหัส 1-18-04-002","ถุงน้ำยา B22 / B0: รหัส 1-18-04-003","Citrate Solution (ACD-A): รหัส 1-18-05-001","Calcium Chloride 10%: รหัส 1-01-02-015"]},
      {head:"🔍 DLC และอุปกรณ์เสริม", icon:"🔍", bar:"#E65100", bg:"#FFF3E0", hc:"#BF360C",
       items:["DLC 13Fr / 14Fr (Arrow / Argon): รหัส 1-13-01-020","Heparin 25,000 IU/5ml: รหัส 1-02-01-001","NSS 0.9% 1000ml (Lock): รหัส 1-01-01-001","Chlorhexidine Dressing: รหัส 1-06-01-005"]}
    ]
  },

  crrt_wound: {
    title:"🩹 การทำแผล DLC",
    color:"#880E4F", bg:"#FCE4EC", emoji:"🩹",
    sections:[
      {head:"⏱️ ความถี่และเวลา", icon:"🎯", bar:"#1565C0", bg:"#E3F2FD", hc:"#0D47A1",
       items:["ทำแผลทุก 48-72 ชั่วโมง หรือเมื่อแผลเปียก/หลุด","เปลี่ยน Transparent dressing ทุก 7 วัน (ถ้าแห้งดี)","ทำทุกครั้งที่เห็น Discharge หรือ Oozing ที่ Exit site"]},
      {head:"🚀 ขั้นตอนทำแผล DLC", icon:"🚀", bar:"#2E7D32", bg:"#E8F5E9", hc:"#1B5E20",
       items:["เตรียม Sterile set: ผ้าก๊อซ, ถุงมือ Sterile, ชาม","ล้างมือ 7 ขั้นตอน + ใส่ถุงมือ Sterile","เปิดแผลเก่าออกอย่างระมัดระวัง ไม่ดึงรั้งสาย","เช็ดด้วย Chlorhexidine 2% เป็นวงกลมจากในออกนอก รัศมี 5 cm","ทำซ้ำ 3 รอบ รอแห้ง","ปิด Transparent dressing กดแน่น ไม่มีฟองอากาศ","บันทึก Exit site: ไม่มีบวม แดง ร้อน หรือ Discharge"]},
      {head:"⚠️ สัญญาณอันตราย — รายงานแพทย์ทันที", icon:"⚠️", bar:"#C62828", bg:"#FFEBEE", hc:"#B71C1C",
       items:["ผิวรอบสายบวม แดง ร้อน หรือกดเจ็บ","มี Discharge สีเหลือง/เขียว หรือมีกลิ่น","ไข้ >38.5°C โดยไม่ทราบสาเหตุ","สายเลื่อนหลุดหรือ Depth เปลี่ยน"]}
    ]
  },

  crrt_calc: {
    title:"🧮 คำนวณสารน้ำ CRRT",
    color:"#4527A0", bg:"#EDE7F6", emoji:"🧮",
    sections:[
      {head:"🎯 Dose CRRT ที่แนะนำ", icon:"🎯", bar:"#1565C0", bg:"#E3F2FD", hc:"#0D47A1",
       items:["KDIGO 2012: 20-25 ml/kg/hr (Effluent rate)","Sepsis / AKI รุนแรง: อาจพิจารณา 25-35 ml/kg/hr","ตัวอย่าง: นน. 60 kg → Dose 25 ml/kg/hr = 1,500 ml/hr"]},
      {head:"🚀 สูตรคิด Fluid Balance", icon:"🚀", bar:"#2E7D32", bg:"#E8F5E9", hc:"#1B5E20",
       items:["Fluid Balance = Fluid In - Fluid Out","Fluid In = IV fluid + ยา + อาหาร + น้ำยา CRRT (ที่คืนให้ผู้ป่วย)","Fluid Out = ปัสสาวะ + Insensible loss + CRRT Effluent","Net UF = Effluent - Replacement - Dialysate ที่ผู้ป่วยได้รับ","ตั้ง Patient Fluid Removal ตาม Target Fluid Balance ของแพทย์"]},
      {head:"⚠️ ข้อควรระวัง", icon:"⚠️", bar:"#C62828", bg:"#FFEBEE", hc:"#B71C1C",
       items:["ติดตาม Electrolyte (K, Ca, Mg, Phos) ทุก 4-6 ชม.","ระวัง Citrate Toxicity: Ca/ionized Ca ratio > 2.5","ถ้า BP drop → ลด UF เป็น 0 ก่อน และ Fluid challenge","บันทึก Cumulative Balance ทุก 12 ชม."]}
    ]
  }
};

function kbFlex(key) {
  const k = KB[key];
  if (!k) return null;
  const blocks = [];
  for (const sec of k.sections) {
    blocks.push({type:"box",layout:"horizontal",margin:"md",spacing:"sm",backgroundColor:sec.bg,paddingAll:"8px",cornerRadius:"8px",
      contents:[
        {type:"box",layout:"vertical",width:"4px",backgroundColor:sec.bar,cornerRadius:"4px",contents:[]},
        {type:"text",text:sec.icon+" "+sec.head,weight:"bold",size:"sm",color:sec.hc,wrap:true,flex:1,margin:"sm"}
      ]});
    for (const item of sec.items) {
      blocks.push({type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",
        contents:[
          {type:"text",text:"▶",color:sec.bar,size:"xxs",flex:0,gravity:"top",margin:"xs"},
          {type:"text",text:item,size:"sm",color:"#333333",wrap:true,flex:1}
        ]});
    }
  }
  return {type:"flex",altText:k.emoji+" "+k.title,contents:{type:"bubble",
    hero:{type:"box",layout:"horizontal",backgroundColor:k.color,paddingAll:"10px",spacing:"sm",
      contents:[
        {type:"image",url:LOGO_URL,size:"xxs",flex:0,aspectMode:"fit",aspectRatio:"124:100"},
        {type:"box",layout:"vertical",flex:1,justifyContent:"center",
          contents:[
            {type:"text",text:"RA5IC · RAMATHIBODI",color:"#FFFFFF",size:"xxs"},
            {type:"text",text:k.emoji+" "+k.title,color:"#FFFFFF",size:"sm",weight:"bold",wrap:true}
          ]}
      ]},
    body:{type:"box",layout:"vertical",paddingAll:"14px",spacing:"xs",backgroundColor:k.bg,
      contents:blocks.length>0?blocks:[{type:"text",text:"ไม่มีข้อมูล",size:"sm",color:"#888888"}]},
    footer:{type:"box",layout:"vertical",paddingAll:"10px",spacing:"xs",backgroundColor:"#FAFAFA",
      contents:[
        {type:"button",action:{type:"message",label:"📚 Knowledge Menu",text:"crrt_knowledge"},style:"primary",color:k.color,height:"sm",adjustMode:"shrink-to-fit"},
        {type:"button",action:{type:"message",label:"🏠 Main Menu",text:"main_menu"},style:"secondary",height:"sm",margin:"xs",adjustMode:"shrink-to-fit"}
      ]}
  }};
}

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
      if(name&&name!=="unknown"){
        const row=findAlarm(name);
        if(row){
          const t=T2T[row.alarm_title];
          await client.pushMessage(uid,alarmFlex(row,t?getSub(t):[],t));
        } else {
          // ไม่เจอใน DB ใช้ AI analysis
          const fakeT = T2T[name]||"fallback";
          await client.pushMessage(uid,alarmFlex({alarm_title:"🤖 AI วิเคราะห์: "+name,instruction:clean},[],fakeT));
        }
      } else {
        // ไม่รู้ชื่อ alarm → ส่ง AI analysis
        await client.pushMessage(uid,alarmFlex({alarm_title:"🤖 AI วิเคราะห์ Alarm",instruction:clean},[],"fallback"));
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
  if(text==="exit_crrt"){
    deactivate(uid);
    await client.replyMessage(replyToken,{type:"flex",altText:"👋 ออกจากระบบ",contents:{type:"bubble",
      hero:{type:"box",layout:"vertical",backgroundColor:"#1A237E",paddingAll:"24px",
        contents:[
          {type:"text",text:"👋",size:"5xl",align:"center"},
          {type:"text",text:"ขอบคุณที่ใช้งาน CRRT Bot ครับ",color:"#FFFFFF",size:"md",weight:"bold",align:"center",margin:"md"},
          {type:"text",text:"RA5IC · RAMATHIBODI",color:"#FFECB3",size:"xs",align:"center",margin:"sm"}
        ]},
      body:{type:"box",layout:"vertical",paddingAll:"16px",spacing:"md",
        contents:[
          {type:"text",text:"✅ ออกจากระบบเรียบร้อยแล้วครับ",weight:"bold",size:"sm",color:"#1B5E20",align:"center"},
          {type:"text",text:"หากต้องการใช้งานอีกครั้ง\nกด Rich Menu ด้านล่างได้เลยครับ 👇",size:"sm",color:"#555555",wrap:true,align:"center",margin:"sm"}
        ]},
      footer:{type:"box",layout:"vertical",paddingAll:"10px",
        contents:[
          {type:"button",action:{type:"message",label:"🏠 กลับหน้าแรก",text:"main_menu"},style:"primary",color:"#1A237E",height:"sm",adjustMode:"shrink-to-fit"}
        ]}
    }});
    return;
  }
  if(text==="alarm_menu")  {activate(uid);  await client.replyMessage(replyToken,menuFlex(0));return;}
  if(text==="alarm_menu_2"){if(!isActive(uid))return;touch(uid);await client.replyMessage(replyToken,menuFlex(1));return;}
  if(text==="alarm_menu_3"){if(!isActive(uid))return;touch(uid);await client.replyMessage(replyToken,menuFlex(2));return;}

  if(!isActive(uid))return;
  touch(uid);

  // ── Knowledge sub-topics ──────────────────────────────────────────────────
  if(text==="crrt_billing"){
    await client.replyMessage(replyToken,{type:"flex",altText:"💰 การเบิกจ่าย CRRT",contents:{type:"bubble",
      hero:{type:"box",layout:"horizontal",backgroundColor:"#2E7D32",paddingAll:"12px",spacing:"sm",contents:[
        {type:"image",url:LOGO_URL,size:"xxs",flex:0,aspectMode:"fit",aspectRatio:"124:100"},
        {type:"box",layout:"vertical",flex:1,justifyContent:"center",contents:[
          {type:"text",text:"RA5IC · RAMATHIBODI",color:"#FFFFFF",size:"xxs"},
          {type:"text",text:"💰 การเบิกจ่าย CRRT",color:"#FFD700",size:"sm",weight:"bold"}
        ]}
      ]},
      body:{type:"box",layout:"vertical",paddingAll:"14px",backgroundColor:"#EEFFF2",spacing:"sm",
        contents:[
          {type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#E8F5E9",paddingAll:"8px",cornerRadius:"8px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"4px",backgroundColor:"#1B5E20",cornerRadius:"4px",contents:[]},{type:"text",text:"💰 การเบิกจ่าย CRRT ในประเทศไทย (มีนาคม 2567)",weight:"bold",size:"sm",color:"#1B5E20",wrap:true,flex:1,margin:"sm"}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#1B5E20",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"อนุมัติเบิกจ่ายเฉพาะกรณี AKI (Acute Kidney Injury) เท่านั้น",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#E3F2FD",paddingAll:"8px",cornerRadius:"8px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"4px",backgroundColor:"#1565C0",cornerRadius:"4px",contents:[]},{type:"text",text:"🏥 กรมบัญชีกลาง (ข้าราชการ)",weight:"bold",size:"sm",color:"#0D47A1",wrap:true,flex:1,margin:"sm"}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#1565C0",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"วันแรก: เบิกตามจริงได้ ไม่เกิน 15,000 บาท",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#1565C0",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"วันถัดไป: เบิกตามจริง ไม่เกิน 10,000 บาท/วัน ไม่เกิน 4 วัน",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#1565C0",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Oxiris Set: เบิกไม่ได้ | RCA: รวมอยู่ใน CRRT แล้ว",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#FFF3E0",paddingAll:"8px",cornerRadius:"8px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"4px",backgroundColor:"#E65100",cornerRadius:"4px",contents:[]},{type:"text",text:"💳 ประกันสังคม",weight:"bold",size:"sm",color:"#E65100",wrap:true,flex:1,margin:"sm"}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#E65100",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"วันแรก: เบิกตามจริง ไม่เกิน 15,000 บาท",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#E65100",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"วันถัดไป: ไม่เกิน 10,000 บาท/วัน (ไม่จำกัดจำนวนวัน)",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#EEF7FF",paddingAll:"8px",cornerRadius:"8px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"4px",backgroundColor:"#0277BD",cornerRadius:"4px",contents:[]},{type:"text",text:"🏨 สปสช. (บัตรทอง / 30 บาท)",weight:"bold",size:"sm",color:"#0D47A1",wrap:true,flex:1,margin:"sm"}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#0277BD",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"วันแรก: เบิกตามจริง ไม่เกิน 15,000 บาท",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#0277BD",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"วันถัดไป: ไม่เกิน 10,000 บาท/วัน (ไม่จำกัดจำนวนวัน)",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#EDE7F6",paddingAll:"8px",cornerRadius:"8px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"4px",backgroundColor:"#4527A0",cornerRadius:"4px",contents:[]},{type:"text",text:"📋 ค่าใช้จ่ายอ้างอิง (Prismaflex ต่อวัน)",weight:"bold",size:"sm",color:"#4A148C",wrap:true,flex:1,margin:"sm"}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#4527A0",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"MKC6 ค่าบริการ = 8,000 บาท",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#4527A0",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Filter + Circuit = 6,000 บาท",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#4527A0",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Replacement Fluid = 10,000 บาท",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#4527A0",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Drain bag = 250 บาท | รวมประมาณ 25,000 บาท/วัน",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#FFEBEE",paddingAll:"8px",cornerRadius:"8px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"4px",backgroundColor:"#C62828",cornerRadius:"4px",contents:[]},{type:"text",text:"📝 ขั้นตอนเตรียมเอกสารเบิก",weight:"bold",size:"sm",color:"#B71C1C",wrap:true,flex:1,margin:"sm"}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#C62828",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"บันทึก Order แพทย์ชัดเจน: Diagnosis, Machine, Mode, Vascular Access, Dialyzer, BFR, Net UF, Replacement fluid, Anticoagulant",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#C62828",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"ต้องมี Informed Consent ผู้ป่วยหรือญาติลงนามก่อนเริ่ม CRRT ทุกครั้ง",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#C62828",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"กรอกใบเบิกพร้อม Lot Number ของ Filter + Circuit ทุก Set ที่ใช้",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#C62828",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"ส่งคืนถุงน้ำยาที่ใช้แล้วพร้อมใบเบิกให้ฝ่ายการเงินตาม Cycle รายวัน",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#C62828",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Oxiris Set เบิกไม่ได้ทุกสิทธิ์ | RCA รวมอยู่ใน CRRT ไม่ต้องเบิกแยก",size:"sm",color:"#C62828",weight:"bold",wrap:true,flex:1}]}
        ]},
            footer:{type:"box",layout:"vertical",paddingAll:"10px",spacing:"xs",backgroundColor:"#FAFAFA",contents:[{type:"button",action:{type:"message",label:"📚 กลับ Knowledge",text:"crrt_knowledge"},style:"secondary",height:"sm",margin:"xs",adjustMode:"shrink-to-fit"},{type:"button",action:{type:"message",label:"🏠 Main Menu",text:"main_menu"},style:"secondary",height:"sm",margin:"xs",adjustMode:"shrink-to-fit"}]}
    }});return;
  }


  if(text==="crrt_supplies"){
    await client.replyMessage(replyToken,{type:"flex",altText:"📦 รหัสอุปกรณ์ CRRT",contents:{type:"bubble",
      hero:{type:"box",layout:"horizontal",backgroundColor:"#4527A0",paddingAll:"12px",spacing:"sm",contents:[
        {type:"image",url:LOGO_URL,size:"xxs",flex:0,aspectMode:"fit",aspectRatio:"124:100"},
        {type:"box",layout:"vertical",flex:1,justifyContent:"center",contents:[
          {type:"text",text:"RA5IC · RAMATHIBODI",color:"#FFFFFF",size:"xxs"},
          {type:"text",text:"📦 รหัสอุปกรณ์ CRRT",color:"#FFD700",size:"sm",weight:"bold"}
        ]}
      ]},
      body:{type:"box",layout:"vertical",paddingAll:"14px",backgroundColor:"#F3F0FF",spacing:"sm",
        contents:[
          {type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#E3F2FD",paddingAll:"8px",cornerRadius:"8px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"4px",backgroundColor:"#1565C0",cornerRadius:"4px",contents:[]},{type:"text",text:"🖥️ เครื่อง CRRT ที่ใช้ในรามาธิบดี",weight:"bold",size:"sm",color:"#0D47A1",wrap:true,flex:1,margin:"sm"}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#1565C0",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Prismaflex (Baxter): รองรับ CVVH, CVVHD, CVVHDF, TPE, ECMO",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#1565C0",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Infomed HF 440 (Infomed): รองรับ SCUF, CVVH, CVVHD, CVVHDF, ECMO",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#1565C0",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Aquarius: รองรับ SCUF, CVVH, CVVHD, CVVHDF, TPE, DFPP",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#EDE7F6",paddingAll:"8px",cornerRadius:"8px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"4px",backgroundColor:"#4527A0",cornerRadius:"4px",contents:[]},{type:"text",text:"🔬 Filter & Circuit — Prismaflex",weight:"bold",size:"sm",color:"#4A148C",wrap:true,flex:1,margin:"sm"}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#4527A0",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Prismaflex M100 รหัส 30056375 ราคา 5,750 บาท (ผู้ใหญ่ทั่วไป)",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#4527A0",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Prismaflex M150 รหัส 30072047 ราคา 5,750 บาท (ผู้ใหญ่ ECMO)",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#4527A0",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Prismaflex HF20 รหัส 30072216 ราคา 5,750 บาท (เด็ก)",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#4527A0",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Prismaflex Oxiris รหัส 30055135 ราคา 16,500 บาท (Cytokine adsorption)",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#4527A0",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Effluent bag รหัส 30072217 ราคา 121 บาท",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#E8F5E9",paddingAll:"8px",cornerRadius:"8px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"4px",backgroundColor:"#2E7D32",cornerRadius:"4px",contents:[]},{type:"text",text:"🔬 Filter & Circuit — HF440 / Aquarius",weight:"bold",size:"sm",color:"#1B5E20",wrap:true,flex:1,margin:"sm"}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#2E7D32",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Pecopen hemofilter 1.4 sqm รหัส 30061353 ราคา 2,484 บาท (ผู้ใหญ่ทั่วไป)",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#2E7D32",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Pecopen hemofilter 1.9 sqm รหัส 30061354 ราคา 2,484 บาท (ECMO)",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#2E7D32",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Adult CRRT circuit (Infomed) รหัส 30047408 ราคา 3,220 บาท",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#2E7D32",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Aquamax HF12 รหัส 30007360 ราคา 2,558 บาท | Aqualine รหัส 30000080 ราคา 3,449 บาท",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#FFF3E0",paddingAll:"8px",cornerRadius:"8px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"4px",backgroundColor:"#E65100",cornerRadius:"4px",contents:[]},{type:"text",text:"💧 Replacement Fluid ที่ใช้บ่อย",weight:"bold",size:"sm",color:"#E65100",wrap:true,flex:1,margin:"sm"}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#E65100",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Accusol K+0 รหัส 30060934 ราคา 872 บาท (มาตรฐาน)",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#E65100",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Prism0cal B22 รหัส 30072138 ราคา 1,161 บาท (Dialysate/Post dilution)",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#E65100",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Prismasol B0 รหัส — ราคา 880 บาท (มาตรฐาน)",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#E65100",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Prismocitrate 18/0 รหัส 30049087 ราคา 1,381 บาท (Regional Citrate)",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#E65100",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"4% Trisodium citrate 500 ml รหัส 30072725 ราคา 264 บาท (Predilution)",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#E3F2FD",paddingAll:"8px",cornerRadius:"8px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"4px",backgroundColor:"#1565C0",cornerRadius:"4px",contents:[]},{type:"text",text:"🎬 ขั้นตอนการเตรียม CRRT Set (Prime วงจร)",weight:"bold",size:"sm",color:"#0D47A1",wrap:true,flex:1,margin:"sm"}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#1565C0",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"ขั้น 1 เตรียมพื้นที่: ปูผ้า Sterile บน Trolley วางอุปกรณ์ครบ: CRRT Set, ถุงน้ำยา, NSS 0.9% 2,000 ml, Heparin/Citrate",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#1565C0",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"ขั้น 2 ติดตั้ง Set: เปิดถุง CRRT Set แบบ Aseptic นำ Hemofilter + Bloodline ใส่เข้าช่องของเครื่องตามลำดับ",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#1565C0",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"ขั้น 3 ต่อถุงน้ำยา: ต่อถุง PrismaSOL เข้าสาย Dialysate/Replacement ตาม Mode ที่แพทย์สั่ง ตรวจไม่มีฟองอากาศ",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#1565C0",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"ขั้น 4 Prime วงจร: กด [Prime] เครื่องดึง NSS 0.9% ผ่านวงจรทั้งหมด ใช้เวลา 15-20 นาที",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#1565C0",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"ขั้น 5 ตรวจก่อน Run: ไม่มีฟองอากาศในสาย, Connection แน่นทุกจุด, Clamp เปิดถูกต้องครบ",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#1565C0",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"ขั้น 6 ตั้งค่าเครื่อง: ใส่ BFR 100-150 ml/min, UF Rate, Dose 30 ml/kg/h, Anticoagulant ตาม Order แพทย์",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#C62828",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"NSS Flush 200 ml ทุก 8 ชั่วโมงเพื่อป้องกัน Filter อุดตัน",size:"sm",color:"#C62828",weight:"bold",wrap:true,flex:1}]}
        ]},
            footer:{type:"box",layout:"vertical",paddingAll:"10px",spacing:"xs",backgroundColor:"#FAFAFA",contents:[{type:"button",action:{type:"message",label:"📚 กลับ Knowledge",text:"crrt_knowledge"},style:"secondary",height:"sm",margin:"xs",adjustMode:"shrink-to-fit"},{type:"button",action:{type:"message",label:"🏠 Main Menu",text:"main_menu"},style:"secondary",height:"sm",margin:"xs",adjustMode:"shrink-to-fit"}]}
    }});return;
  }


  if(text==="crrt_wound"){
    await client.replyMessage(replyToken,{type:"flex",altText:"🩹 การทำแผล DLC",contents:{type:"bubble",
      hero:{type:"box",layout:"horizontal",backgroundColor:"#C62828",paddingAll:"12px",spacing:"sm",contents:[
        {type:"image",url:LOGO_URL,size:"xxs",flex:0,aspectMode:"fit",aspectRatio:"124:100"},
        {type:"box",layout:"vertical",flex:1,justifyContent:"center",contents:[
          {type:"text",text:"RA5IC · RAMATHIBODI",color:"#FFFFFF",size:"xxs"},
          {type:"text",text:"🩹 การทำแผล DLC (Nursing Management)",color:"#FFD700",size:"sm",weight:"bold"}
        ]}
      ]},
      body:{type:"box",layout:"vertical",paddingAll:"14px",backgroundColor:"#FFF5F5",spacing:"sm",
        contents:[
          {type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#FFEBEE",paddingAll:"8px",cornerRadius:"8px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"4px",backgroundColor:"#C62828",cornerRadius:"4px",contents:[]},{type:"text",text:"🎯 เป้าหมาย: ป้องกัน CLABSI (Catheter-Line Associated BSI)",weight:"bold",size:"sm",color:"#B71C1C",wrap:true,flex:1,margin:"sm"}]},
          {type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#FFF3E0",paddingAll:"8px",cornerRadius:"8px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"4px",backgroundColor:"#E65100",cornerRadius:"4px",contents:[]},{type:"text",text:"📅 ความถี่การทำแผล",weight:"bold",size:"sm",color:"#E65100",wrap:true,flex:1,margin:"sm"}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#E65100",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Gauze dressing: เปลี่ยนทุกครั้งที่ทำ HD/CRRT หรือเมื่อเปียก/ชน/แฉะ",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#E65100",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Transparent dressing (Tegaderm): เปลี่ยนทุก 7 วัน หรือเมื่อหลุด/เปียก/ขอบยก",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#EDE7F6",paddingAll:"8px",cornerRadius:"8px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"4px",backgroundColor:"#6A1B9A",cornerRadius:"4px",contents:[]},{type:"text",text:"📦 อุปกรณ์ที่ต้องเตรียม",weight:"bold",size:"sm",color:"#4A148C",wrap:true,flex:1,margin:"sm"}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#6A1B9A",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"ชุดทำแผลปราศจากเชื้อ (Set wet dressing) 1 set",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#6A1B9A",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Syringe 5 ml 2 อัน + Syringe 10 ml 2 อัน",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#6A1B9A",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Sterile gauze 2x2 นิ้ว 5 ชิ้น + Sterile gauze 3x3 นิ้ว 5 ชิ้น",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#6A1B9A",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"2% Chlorhexidine in 70% Alcohol (CHG) — สำหรับเช็ด Exit Site",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#6A1B9A",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Sterile gloves 1 คู่ + Disposable gloves 1 คู่ + Mask + หมวกคลุมผม",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#6A1B9A",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Fixomull 10×10 cm หรือ Transparent dressing",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#E8F5E9",paddingAll:"8px",cornerRadius:"8px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"4px",backgroundColor:"#2E7D32",cornerRadius:"4px",contents:[]},{type:"text",text:"🚀 ขั้นตอน Pre-HD/CRRT (เตรียมก่อนเริ่มเครื่อง)",weight:"bold",size:"sm",color:"#1B5E20",wrap:true,flex:1,margin:"sm"}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#2E7D32",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"ขั้น 1: ประเมินผ้าปิดแผล — เปียก ชื้น แฉะ หลุด หรือไม่",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#2E7D32",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"ขั้น 2: เปิดผ้าปิดแผลเก่าออกอย่างนุ่มนวล",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#2E7D32",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"ขั้น 3: ประเมิน Exit Site — บวม แดง มี Discharge หรือไม่",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#2E7D32",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"ขั้น 4: เปิด Set Dressing ใช้ 2% CHG ทำความสะอาดผิวหนังรอบ Catheter",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#2E7D32",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"ขั้น 5: ปิดผ้าปิดแผล Exit Site ส่วนต้น",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#2E7D32",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"ขั้น 6: ปูผ้า Sterile — ทำความสะอาดสาย DLC ส่วนปลาย",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#2E7D32",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"ขั้น 7: เปิด Cap → Scrub the Hub ≥ 5 วินาที ด้วย 2% CHG",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#2E7D32",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"ขั้น 8: Draw Heparinized saline ออก ~2 เท่าของ Prime Volume → Test Flow",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#E8F5E9",paddingAll:"8px",cornerRadius:"8px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"4px",backgroundColor:"#2E7D32",cornerRadius:"4px",contents:[]},{type:"text",text:"🔒 ขั้นตอน Post-HD/CRRT (Lock Catheter หลังเครื่อง)",weight:"bold",size:"sm",color:"#1B5E20",wrap:true,flex:1,margin:"sm"}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#2E7D32",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"ขั้น 1: ปลด Blood line CRRT ออก → สวม Sterile Gloves",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#2E7D32",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"ขั้น 2: เตรียม Heparinized saline 2,500 unit/ml และ NSS 10 ml x2 syringe",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#2E7D32",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"ขั้น 3: Flush 0.9% NSS 10 ml/ขาง ด้วย Push-pause technique",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#2E7D32",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"ขั้น 4: Lock Heparin 2,500 unit/ml ปริมาณ = Prime volume ด้วย Positive pressure technique",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#2E7D32",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"ขั้น 5: Scrub the Hub ≥ 5 วินาที → ปิด Cap ใหม่",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#2E7D32",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"ขั้น 6: ห่อสาย DLC ด้วย Gauze → ปิดด้วย Fixomull ให้แน่น",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#C62828",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"งด Lock Heparin ถ้ามีแผนถอน Catheter (Off Catheter)",size:"sm",color:"#C62828",weight:"bold",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#FFEBEE",paddingAll:"8px",cornerRadius:"8px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"4px",backgroundColor:"#B71C1C",cornerRadius:"4px",contents:[]},{type:"text",text:"⚠️ สัญญาณ CLABSI รายงานแพทย์ทันที",weight:"bold",size:"sm",color:"#B71C1C",wrap:true,flex:1,margin:"sm"}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#C62828",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"ไข้ > 38°C ไม่ทราบสาเหตุ + หนาวสั่น (Rigors) หลัง Flush สาย",size:"sm",color:"#C62828",weight:"bold",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#C62828",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Exit Site: แดง บวม ร้อน เจ็บ หรือมี Discharge (หนอง/เลือด)",size:"sm",color:"#C62828",weight:"bold",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#C62828",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"เพาะเชื้อ Blood Culture 2 ตำแหน่ง (Peripheral + จาก Catheter) ก่อนให้ ATB",size:"sm",color:"#C62828",weight:"bold",wrap:true,flex:1}]}
        ]},
            footer:{type:"box",layout:"vertical",paddingAll:"10px",spacing:"xs",backgroundColor:"#FAFAFA",contents:[{type:"button",action:{type:"message",label:"📚 กลับ Knowledge",text:"crrt_knowledge"},style:"secondary",height:"sm",margin:"xs",adjustMode:"shrink-to-fit"},{type:"button",action:{type:"message",label:"🏠 Main Menu",text:"main_menu"},style:"secondary",height:"sm",margin:"xs",adjustMode:"shrink-to-fit"}]}
    }});return;
  }


  if(text==="crrt_calc"){
    await client.replyMessage(replyToken,{type:"flex",altText:"🧮 คำนวณสารน้ำ CRRT",contents:{type:"bubble",
      hero:{type:"box",layout:"horizontal",backgroundColor:"#E65100",paddingAll:"12px",spacing:"sm",contents:[
        {type:"image",url:LOGO_URL,size:"xxs",flex:0,aspectMode:"fit",aspectRatio:"124:100"},
        {type:"box",layout:"vertical",flex:1,justifyContent:"center",contents:[
          {type:"text",text:"RA5IC · RAMATHIBODI",color:"#FFFFFF",size:"xxs"},
          {type:"text",text:"🧮 คำนวณสารน้ำ CRRT",color:"#FFD700",size:"sm",weight:"bold"}
        ]}
      ]},
      body:{type:"box",layout:"vertical",paddingAll:"14px",backgroundColor:"#FFF8F0",spacing:"sm",
        contents:[
          {type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#FFF3E0",paddingAll:"8px",cornerRadius:"8px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"4px",backgroundColor:"#E65100",cornerRadius:"4px",contents:[]},{type:"text",text:"🎯 สูตรหลัก CRRT Dose (KDIGO 2012)",weight:"bold",size:"sm",color:"#BF360C",wrap:true,flex:1,margin:"sm"}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#E65100",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Prescribed Dose = 20-25 ml/kg/hr (ใช้ Actual BW หรือ Ideal BW ตามแพทย์)",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#E65100",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Delivered Dose จริง ≈ Prescribed x 0.85-0.90 (เพราะมี Downtime)",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#E65100",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"ตัวอย่าง: BW 60 kg → Dose = 60x25 = 1,500 ml/hr = UF Rate ที่ตั้งในเครื่อง",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#E3F2FD",paddingAll:"8px",cornerRadius:"8px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"4px",backgroundColor:"#1565C0",cornerRadius:"4px",contents:[]},{type:"text",text:"💧 Fluid Balance คิด In/Out ต่อชั่วโมง",weight:"bold",size:"sm",color:"#0D47A1",wrap:true,flex:1,margin:"sm"}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#1565C0",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"IN: IV Fluid + ยา IV + อาหาร (PPN/TPN/Enteral) + ยา Oral ที่ต้องนับ",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#1565C0",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"OUT: Urine + Drain (NGT/Chest drain) + Effluent จากเครื่อง CRRT",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#1565C0",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Net Balance (ml/hr) = Total IN - Total OUT",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#1565C0",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Patient Fluid Removal = Net UF ที่ต้องการดึงออก/ชั่วโมง ตั้งในเครื่อง",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#E8F5E9",paddingAll:"8px",cornerRadius:"8px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"4px",backgroundColor:"#2E7D32",cornerRadius:"4px",contents:[]},{type:"text",text:"📊 ตัวอย่าง CVVHDF BW 70 kg",weight:"bold",size:"sm",color:"#1B5E20",wrap:true,flex:1,margin:"sm"}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#2E7D32",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Total Effluent = 70x25 = 1,750 ml/hr",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#2E7D32",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"แบ่ง: Dialysate 875 ml/hr + Replacement (Pre/Post) 875 ml/hr",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#2E7D32",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"ถ้าต้องดึงน้ำ 100 ml/hr → ตั้ง Patient Fluid Removal = 100 ml/hr",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#2E7D32",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Heparin เริ่ม 500-1,000 IU/hr ปรับตาม APTT target 60-80 วินาที",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#EDE7F6",paddingAll:"8px",cornerRadius:"8px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"4px",backgroundColor:"#4527A0",cornerRadius:"4px",contents:[]},{type:"text",text:"🔬 Citrate Anticoagulation (Regional)",weight:"bold",size:"sm",color:"#4A148C",wrap:true,flex:1,margin:"sm"}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#4527A0",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Prismocitrat 18 mmol/L Pre-filter: เริ่ม 1.5-2x BFR ml/hr",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#4527A0",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Calcium Gluconate 10% Systemic: ปรับตาม iCa systemic 1.1-1.3 mmol/L",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#4527A0",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"iCa Post-filter target: 0.25-0.35 mmol/L (วัดทุก 6 ชั่วโมง)",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#4527A0",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"ข้อห้าม: Liver failure รุนแรง เสี่ยง Citrate accumulation",size:"sm",color:"#333333",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#FFEBEE",paddingAll:"8px",cornerRadius:"8px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"4px",backgroundColor:"#B71C1C",cornerRadius:"4px",contents:[]},{type:"text",text:"⚠️ ข้อควรระวัง",weight:"bold",size:"sm",color:"#B71C1C",wrap:true,flex:1,margin:"sm"}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#C62828",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"ปรึกษาแพทย์ Nephrology/ICU ก่อนปรับค่าทุกครั้ง ห้ามปรับเองโดยไม่มี Order",size:"sm",color:"#C62828",weight:"bold",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#C62828",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"วัด Electrolytes ทุก 6-8 ชม.: K, Na, Mg, Phos, Ca (iCa ถ้าใช้ Citrate)",size:"sm",color:"#C62828",weight:"bold",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",contents:[{type:"text",text:"▶",color:"#C62828",size:"xxs",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Monitor อุณหภูมิผู้ป่วย: CRRT ทำให้ตัวเย็น ต้องเปิด Heater เครื่อง",size:"sm",color:"#C62828",weight:"bold",wrap:true,flex:1}]}
        ]},
            footer:{type:"box",layout:"vertical",paddingAll:"10px",spacing:"xs",backgroundColor:"#FAFAFA",contents:[{type:"button",action:{type:"message",label:"📚 กลับ Knowledge",text:"crrt_knowledge"},style:"secondary",height:"sm",margin:"xs",adjustMode:"shrink-to-fit"},{type:"button",action:{type:"message",label:"🏠 Main Menu",text:"main_menu"},style:"secondary",height:"sm",margin:"xs",adjustMode:"shrink-to-fit"}]}
    }});return;
  }


  // ── show_hotline: แสดงเบอร์พร้อมปุ่มโทรโดยตรง ─────────────────────────────
  if(text==="show_hotline"){
    await client.replyMessage(replyToken,{type:"flex",altText:"📞 Hotline CRRT",contents:{type:"bubble",
      hero:{type:"box",layout:"horizontal",backgroundColor:"#1B5E20",paddingAll:"12px",spacing:"sm",contents:[
        {type:"image",url:LOGO_URL,size:"xxs",flex:0,aspectMode:"fit",aspectRatio:"124:100"},
        {type:"box",layout:"vertical",flex:1,justifyContent:"center",contents:[
          {type:"text",text:"RA5IC · RAMATHIBODI",color:"#FFFFFF",size:"xxs"},
          {type:"text",text:"📞 Hotline CRRT",color:"#FFD700",size:"sm",weight:"bold"}
        ]}
      ]},
      body:{type:"box",layout:"vertical",paddingAll:"16px",backgroundColor:"#EEFFF4",spacing:"sm",
        contents:[
          {type:"text",text:"มีปัญหาที่ Bot ช่วยไม่ได้?",size:"sm",color:"#333333",weight:"bold"},
          {type:"text",text:"โทรหาผู้เชี่ยวชาญได้ทันทีเลยครับ 🙏",size:"sm",color:"#555555",wrap:true},
          {type:"box",layout:"vertical",margin:"md",backgroundColor:"#FFEBEE",cornerRadius:"8px",paddingAll:"12px",
            contents:[
              {type:"text",text:"📱 086-341-7250",size:"xxl",weight:"bold",color:"#B71C1C",align:"center"},
              {type:"text",text:"พร้อมรับสายตลอด 24 ชั่วโมง",size:"xs",color:"#666666",align:"center",margin:"xs"}
            ]}
        ]},
      footer:{type:"box",layout:"vertical",paddingAll:"10px",spacing:"xs",backgroundColor:"#FAFAFA",contents:[
        {type:"button",action:{type:"uri",label:"📞 โทร 086-341-7250",uri:"tel:0863417250"},style:"primary",color:"#1B5E20",height:"sm",adjustMode:"shrink-to-fit",margin:"xs"},
        {type:"button",action:{type:"message",label:"🏠 Main Menu",text:"main_menu"},style:"secondary",height:"sm",adjustMode:"shrink-to-fit",margin:"xs"}
      ]}
    }});return;
  }

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
    // ลบประโยค call-to-action ที่ซ้ำกับ quickReply ปุ่ม
    rt = rt.replace(/💡[^\n]*👇?/g,"").replace(/กดปุ่มด้านล่าง[^\n]*/g,"").trim();
    const t=T2T[respRow.alarm_title];
    const ns=t?getSub(t):getSub("main_menu");
    const qr=ns.filter(r=>r.next_step_label).slice(0,13).map(r=>({type:"action",action:r.next_step_action?.startsWith("http")?{type:"uri",label:_san(F(r.next_step_label)),uri:r.next_step_action}:{type:"message",label:_san(F(r.next_step_label)),text:r.next_step_action}}));
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
