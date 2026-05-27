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

function F(s) {
  if (!s) return "";
  return String(s)
    .replace(/ð\x9F\x94/g,"🔍").replace(/ð\x9F\x9A/g,"🚀")
    .replace(/ð´/g,"🔴").replace(/ð¨/g,"🚨")
    .replace(/ðµ/g,"🔵").replace(/ð¢/g,"🟢")
    .replace(/ð£/g,"🟣").replace(/ð¡/g,"🟡")
    .replace(/ð\x9F\xA0/g,"🟠").replace(/ð\x9F\x93\x9E/g,"📞")
    .replace(/ð\x9F\x94\x84/g,"🔄").replace(/ð\x9F\x92\x89/g,"💉")
    .replace(/ð\x9F\x94\x8B/g,"🔋").replace(/ð\x9F\x94\x8C/g,"🔌")
    .replace(/ð\x9F\x93\x88/g,"📈").replace(/ð\x9F\x91\x87/g,"👇")
    .replace(/ð\x9F\x99\x8F/g,"🙏").replace(/ð\x9F\x92\xA1/g,"💡")
    .replace(/ð\x9F\x93\x8B/g,"📋").replace(/ð\x9F\x93\xA1/g,"📡")
    .replace(/ð\x9F\x94\xA7/g,"🔧").replace(/ð\x9F\x93\xA6/g,"📦")
    .replace(/ð\x9F\x91\x8B/g,"👋").replace(/ð\x9F\x8F\xA0/g,"🏠")
    .replace(/ð[-¿][-¿][-¿]/g,"").replace(/ð[-¿][-¿]/g,"").replace(/ð[-¿]/g,"");
}

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

const NAV = new Set(["main_menu","alarm_menu","alarm_menu_2","alarm_menu_3","how_to_use","show_hotline","fallback","update_status","exit_crrt","how_to_return","how_to_closeloop","how_to_swap_dlc","how_to_swap_dlc_2","how_to_flush_dlc","restart_crrt_flow","end_crrt_flow","ask_doctor_plan","show_cleanup","show_non_citrate","show_with_citrate","crrt_knowledge","crrt_mode_info","crrt_pressure_info","crrt_prime","crrt_calc","crrt_billing","crrt_supplies","crrt_wound","crrt_knowledge"]);

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

const SS = {
  goal:  {bar:"#1565C0", bg:"#E3F2FD", hc:"#0D47A1", icon:"🎯"},
  cause: {bar:"#E65100", bg:"#FFF3E0", hc:"#BF360C", icon:"🔍"},
  step:  {bar:"#2E7D32", bg:"#E8F5E9", hc:"#1B5E20", icon:"🚀"},
  warn:  {bar:"#C62828", bg:"#FFEBEE", hc:"#B71C1C", icon:"⚠️"},
  info:  {bar:"#6A1B9A", bg:"#F3E5F5", hc:"#4A148C", icon:"💡"},
};

function parse(rawInput) {
  if (!rawInput) return [{s:SS.step, head:"ไม่มีข้อมูลขั้นตอน", items:[]}];
  const text = F(rawInput).replace(/【[^】]*】/g,"").trim();
  if (!text) return [{s:SS.step, head:"ไม่มีข้อมูลขั้นตอน", items:[]}];
  const parts = text.split(/(?=🔍\s|⏱️\s|🚀\s|▶️\s*(?:ขั้น|Step)|⚠️\s*(?:ข้อ|Nursing))/)
    .map(s=>s.trim()).filter(Boolean);
  const sections = [];
  for (const part of parts) {
    if (/^⚠️\s*(ข้อมูลนี้|ข้อมูล นี้)/.test(part)) continue;
    let skey = "step";
    if (/^🔍/.test(part))      skey = "cause";
    else if (/^⏱️/.test(part)) skey = "goal";
    else if (/^⚠️/.test(part)) skey = "warn";
    const sub = part.split(/(?=1️⃣|2️⃣|3️⃣|4️⃣|5️⃣|6️⃣|7️⃣|8️⃣|9️⃣)/).map(s=>s.trim()).filter(Boolean);
    const head = (sub[0]||"").replace(/^[🔍⏱️🚀⚠️💡🔄📌]\s*/,"").replace(/^▶️\s*/,"").trim();
    const items = sub.slice(1).map(x=>x.replace(/^[1-9]️⃣\s*/,"").trim()).filter(Boolean);
    if (items.length===0 && head.length>100) {
      sections.push({s:SS[skey], head, items:[]});
    } else {
      sections.push({s:SS[skey], head, items});
    }
  }
  if (sections.length===0) {
    const items = text.split(/▶️\s*|[1-9]️⃣\s*/).map(s=>s.trim()).filter(s=>s.length>3&&!/^⚠️\s*ข้อมูลนี้/.test(s));
    return [{s:SS.step, head:"ขั้นตอน", items:items.length>0?items:[text.slice(0,200)]}];
  }
  return sections;
}

function mkBlocks(sections) {
  const out = [];
  for (const sec of sections) {
    const s = sec.s;
    if (sec.head) {
      out.push({type:"box",layout:"horizontal",margin:"md",spacing:"sm",backgroundColor:s.bg,paddingAll:"8px",cornerRadius:"8px",
        contents:[
          {type:"box",layout:"vertical",width:"4px",backgroundColor:s.bar,cornerRadius:"4px",contents:[]},
          {type:"text",text:s.icon+" "+sec.head,weight:"bold",size:"sm",color:s.hc,wrap:true,flex:1,margin:"sm"}
        ]});
    }
    for (const item of sec.items) {
      const warn = ["ห้าม","ทันที","วิกฤต","เด็ดขาด"].some(w=>item.includes(w));
      out.push({type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"8px",
        contents:[
          {type:"text",text:"▶",color:s.bar,size:"xxs",flex:0,gravity:"top",margin:"xs"},
          {type:"text",text:item,size:"sm",color:warn?"#C62828":"#333333",weight:warn?"bold":"regular",wrap:true,flex:1}
        ]});
    }
  }
  return out;
}

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
     contents:[{type:"text",text:"⚠️",size:"sm",flex:0},{type:"text",text:"ใช้วิจารณญาณทางคลินิกประกอบเสมอ",size:"xxs",color:"#795548",wrap:true,flex:1}]}
  ];
  const btns = [];
  for (let n=1;n<=6;n++) {
    const lbl = F((alarm[`btn_${n}_label`]||"").trim());
    const act = (alarm[`btn_${n}_action`]||"").trim();
    if (!lbl||lbl==="nan"||!act||act==="nan") continue;
    const lblL=lbl.toLowerCase();
    let bStyle=btns.length===0?"primary":"secondary";
    let bColor=btns.length===0?c.color:undefined;
    if(lblL.includes("✅")||lblL.includes("แก้ไขได้")||lblL.includes("run ต่อ")||lblL.includes("เรียบร้อย")){bColor="#2E7D32";bStyle="primary";}
    else if(lblL.includes("❌")||lblL.includes("ยังไม่ได้")||lblL.includes("ยัง alarm")){bColor="#C62828";bStyle="primary";}
    else if(lblL.includes("⬅")||lblL.includes("ย้อนกลับ")){bColor="#F9A825";bStyle="primary";}
    else if(lblL.includes("hotline")||lblL.includes("สายด่วน")){bColor="#1B5E20";bStyle="primary";}
    else if(bStyle==="secondary" && !bColor){ bColor="#546E7A"; }
    btns.push({type:"button",action:act.startsWith("http")?{type:"uri",label:_san(lbl),uri:act}:{type:"message",label:_san(lbl),text:act},
      style:bStyle,color:bColor,height:"sm",adjustMode:"shrink-to-fit",margin:"xs"});
  }
  if (btns.length===0) {
    subRows.filter(r=>r.next_step_label).slice(0,4).forEach((r,i)=>{
      const lbl=F(r.next_step_label||"");
      btns.push({type:"button",action:r.next_step_action?.startsWith("http")?{type:"uri",label:_san(lbl),uri:r.next_step_action}:{type:"message",label:_san(lbl),text:r.next_step_action},
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

function subFlex(subRows, trigger) {if(!subRows||subRows.length===0){return{type:"flex",altText:"⚠️ กรุณากดใหม่",contents:{type:"bubble",body:{type:"box",layout:"vertical",paddingAll:"16px",spacing:"sm",contents:[{type:"text",text:"⚠️ ระบบกำลังโหลด กรุณากดใหม่ครับ",weight:"bold",size:"md",color:"#E65100",wrap:true},{type:"text",text:"หรือโทร Hotline 086-341-7250",size:"sm",color:"#555",wrap:true}]},footer:{type:"box",layout:"vertical",paddingAll:"10px",spacing:"xs",contents:[{type:"button",action:{type:"message",label:"🏠 Main Menu",text:"main_menu"},style:"primary",color:"#1565C0",height:"sm",adjustMode:"shrink-to-fit"},{type:"button",action:{type:"message",label:"📞 Hotline",text:"show_hotline"},style:"secondary",height:"sm",adjustMode:"shrink-to-fit",margin:"xs"}]}}};}
  
  const first = subRows.find(r=>r.follow_up_msg&&r.follow_up_msg!=="nan");
  const msg = first?.follow_up_msg||"เลือกตัวเลือกด้านล่างครับ";
  const MAP={
    "show_hotline":{color:"#1B5E20",emoji:"📞",title:"Hotline CRRT",bg:"#EEFFF4"},
    "show_non_citrate":{color:"#004D40",emoji:"🔵",title:"Preset No Citrate",bg:"#EEFFFE"},
    "show_with_citrate":{color:"#E65100",emoji:"🟠",title:"Preset Citrate",bg:"#FFF8F0"},
    "crrt_knowledge":{color:"#1565C0",emoji:"📚",title:"CRRT Knowledge Base",bg:"#EFF7FF"},
    "crrt_billing":{color:"#2E7D32",emoji:"💰",title:"การเบิกจ่ายตามสิทธิ์",bg:"#EEFFF2"},
    "crrt_supplies":{color:"#4527A0",emoji:"📦",title:"รหัสอุปกรณ์เบิกจ่าย",bg:"#F3F0FF"},
    "crrt_wound":{color:"#C62828",emoji:"🩹",title:"การทำแผล DLC",bg:"#FFF5F5"},
    "crrt_calc":{color:"#E65100",emoji:"🧮",title:"คำนวณสารน้ำ CRRT",bg:"#FFF8F0"},
    "crrt_mode_info":{color:"#0D47A1",emoji:"🔄",title:"CRRT Mode",bg:"#EEF5FF"},
    "crrt_pressure_info":{color:"#880E4F",emoji:"📊",title:"ค่า Pressure",bg:"#FFF0F5"},
    "how_to_return":{color:"#C62828",emoji:"🩸",title:"การคืนเลือด",bg:"#FFF5F5"},
    "how_to_flush_dlc":{color:"#00695C",emoji:"💉",title:"หล่อเส้น DLC",bg:"#EEFFFE"},
    "show_cleanup":{color:"#2E7D32",emoji:"✅",title:"เก็บเครื่อง",bg:"#EEFFF2"},
    "alarm_menu":{color:"#B71C1C",emoji:"🚨",title:"เมนู Alarm",bg:"#FFF5F5"},
    "alarm_menu_2":{color:"#B71C1C",emoji:"🚨",title:"เมนู Alarm 2/3",bg:"#FFF5F5"},
    "alarm_menu_3":{color:"#B71C1C",emoji:"🚨",title:"เมนู Alarm 3/3",bg:"#FFF5F5"},
    "fallback":{color:"#546E7A",emoji:"❓",title:"ไม่พบข้อมูล",bg:"#F4F6F7"},
    "how_to_closeloop":{color:"#0277BD",emoji:"💧",title:"NSS Recirculation",bg:"#EEF7FF"},
    "restart_crrt_flow":{color:"#1565C0",emoji:"▶️",title:"Start CRRT",bg:"#EFF7FF"},
    "end_crrt_flow":{color:"#C62828",emoji:"⏹️",title:"End CRRT",bg:"#FFF5F5"},
    "ask_doctor_plan":{color:"#1B5E20",emoji:"👨‍⚕️",title:"ปรึกษาแพทย์",bg:"#EEFFF4"},
    "how_to_swap_dlc":{color:"#00695C",emoji:"🔄",title:"สลับสาย DLC",bg:"#EEFFFE"},
    "exit_crrt":{color:"#546E7A",emoji:"🚪",title:"ออกจากระบบ",bg:"#F4F6F7"},
  };
  const m=MAP[trigger]||{color:"#1A237E",emoji:"📋",title:"CRRT Bot",bg:"#EEF0FF"};
  const secs = parse(msg);
  const bs = mkBlocks(secs);
  const body = bs.length>0 ? bs :
    F(msg).replace(/【[^】]*】/g,"").split(/\s{3,}|\n/).map(s=>s.trim()).filter(s=>s.length>2)
    .map(line=>({type:"text",text:line,size:"sm",color:"#333333",wrap:true,margin:"xs"}));
  const btns = subRows.filter(r=>r.next_step_label).slice(0,5).map((r,i)=>{
    const lbl=F(r.next_step_label||"");
    const ll2=lbl.toLowerCase();
    let ss3=(i===0||ll2.includes("⬅")||ll2.includes("ย้อนกลับ"))?"primary":"secondary";
    let sc3=i===0?m.color:undefined;
    if(ll2.includes("ย้อนกลับ")||ll2.includes("⬅")){sc3="#F9A825";ss3="primary";}
    else if(ll2.includes("✅")||ll2.includes("แก้ไขได้")||ll2.includes("run ต่อ")){sc3="#2E7D32";ss3="primary";}
    else if(ll2.includes("❌")||ll2.includes("ยังไม่ได้")||ll2.includes("ยัง alarm")){sc3="#C62828";ss3="primary";}
    else if(ss3==="secondary" && !sc3){ sc3="#546E7A"; }
    return {type:"button",action:r.next_step_action?.startsWith("http")?{type:"uri",label:_san(lbl),uri:r.next_step_action}:{type:"message",label:_san(lbl),text:r.next_step_action},
      style:ss3,color:sc3,height:"sm",adjustMode:"shrink-to-fit",margin:"xs"};
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
  {title:"🚨 เมนู Alarm (2/3)",sub:"สาย / อุปกรณ์",color:"#C62828",
   items:[
     {label:"📈 Access Positive",text:"access_pos",color:"#006064"},
     {label:"🔌 Disconnect",text:"disconnect",color:"#880E4F"},
     {label:"📡 Communication Loss",text:"comm_loss",color:"#37474F"},
     {label:"💧 Bag Empty",text:"bag_empty",color:"#00695C"},
     {label:"⚖️ Flow Error",text:"flow_error",color:"#2E7D32"},
     {label:"💉 Syringe Empty",text:"syringe_empty",color:"#6A1B9A"},
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
       contents:[{type:"text",text:"⚠️ ข้อมูลนี้เป็นแนวทางในการช่วยตัดสินใจเท่านั้น โปรดใช้วิจารณญาณทางคลินิกประกอบเสมอ",size:"xxs",color:"#795548",wrap:true}]}
    ]},
    footer:{type:"box",layout:"vertical",paddingAll:"10px",spacing:"xs",backgroundColor:"#FAFAFA",contents:[
      {type:"box",layout:"horizontal",spacing:"xs",contents:[
        {type:"button",action:{type:"message",label:"🚨 แก้ไข Alarm",text:"alarm_menu"},style:"primary",color:"#B71C1C",height:"sm",adjustMode:"shrink-to-fit",flex:1},
        {type:"button",action:{type:"message",label:"📞 Hotline",text:"show_hotline"},style:"primary",color:"#1B5E20",height:"sm",adjustMode:"shrink-to-fit",flex:1}
      ]},
      {type:"box",layout:"horizontal",spacing:"xs",margin:"xs",contents:[
        {type:"button",action:{type:"message",label:"❤️ Hypotension",text:"hypotension"},style:"primary",color:"#C62828",height:"sm",adjustMode:"shrink-to-fit",flex:1},
        {type:"button",action:{type:"message",label:"🫀 Cardiac Arrest",text:"cardiac_arrest"},style:"primary",color:"#B71C1C",height:"sm",adjustMode:"shrink-to-fit",flex:1}
      ]},
      {type:"box",layout:"horizontal",spacing:"xs",margin:"xs",contents:[
        {type:"button",action:{type:"message",label:"🔵 Prime set c no citrate",text:"show_non_citrate"},style:"primary",color:"#004D40",height:"sm",adjustMode:"shrink-to-fit",flex:1},
        {type:"button",action:{type:"message",label:"🟠 Prime set c citrate",text:"show_with_citrate"},style:"primary",color:"#E65100",height:"sm",adjustMode:"shrink-to-fit",flex:1}
      ]},
      {type:"box",layout:"horizontal",spacing:"xs",margin:"xs",contents:[
        {type:"button",action:{type:"message",label:"🩸 คืนเลือด",text:"how_to_return"},style:"primary",color:"#AD1457",height:"sm",adjustMode:"shrink-to-fit",flex:1},
        {type:"button",action:{type:"uri",label:"📋 Check สถานะเครื่อง",uri:"https://docs.google.com/spreadsheets/d/10vDmEV9SkaDtdsj4QV1j4vbQOqHc75InnSImHGSkM1Q/edit?usp=sharing"},style:"primary",color:"#5C6BC0",height:"sm",adjustMode:"shrink-to-fit",flex:1}
      ]},
      {type:"box",layout:"horizontal",spacing:"xs",margin:"xs",contents:[
        {type:"button",action:{type:"message",label:"💉 วิธีหล่อเส้นด้วย Citrate",text:"how_to_flush_dlc"},style:"primary",color:"#00695C",height:"sm",adjustMode:"shrink-to-fit",flex:1},
        {type:"button",action:{type:"message",label:"✅ วิธีเก็บเครื่อง",text:"show_cleanup"},style:"primary",color:"#2E7D32",height:"sm",adjustMode:"shrink-to-fit",flex:1}
      ]},
      {type:"box",layout:"horizontal",spacing:"xs",margin:"xs",contents:[
        {type:"button",action:{type:"message",label:"📚 Knowledge",text:"crrt_knowledge"},style:"primary",color:"#1565C0",height:"sm",adjustMode:"shrink-to-fit",flex:1},
        {type:"button",action:{type:"message",label:"🚪 ออกจากระบบ",text:"exit_crrt"},style:"primary",color:"#546E7A",height:"sm",adjustMode:"shrink-to-fit",flex:1}
      ]}
    ]}
  }};
}

function extractName(text){const m=text.match(/ALARM_NAME:\s*(.+)/i);return m?m[1].trim():null;}

async function handleEvent(event) {
  await loadDB();
  if (OLD_WEBHOOK) axios.post(OLD_WEBHOOK,{events:[event]}).catch(()=>{});
  if(event.source?.type==="group"||event.source?.type==="room") return;
  const uid=event.source?.userId;
  if(event.type==="follow") return;
  if(event.type!=="message") return;
  const{replyToken,message}=event;

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

  if(["รีเซ็ต","/reset"].includes(text.toLowerCase())){deactivate(uid);await client.replyMessage(replyToken,{type:"text",text:"✅ ล้างประวัติแล้วครับ"});return;}

  if(text==="main_menu")   {activate(uid);  await client.replyMessage(replyToken,mainMenu());return;}
  if(text==="exit_crrt")   {
    deactivate(uid);
    await client.replyMessage(replyToken,{type:"flex",altText:"👋 ออกจากระบบ CRRT Bot",contents:{type:"bubble",
      hero:{type:"box",layout:"vertical",backgroundColor:"#1A237E",paddingAll:"20px",
        contents:[
          {type:"text",text:"👋",size:"5xl",align:"center"},
          {type:"text",text:"ขอบคุณที่ใช้งานระบบครับ",color:"#FFFFFF",size:"lg",weight:"bold",align:"center",margin:"md"},
          {type:"text",text:"CRRT Bot RA5IC · RAMATHIBODI",color:"#FFECB3",size:"xs",align:"center"}
        ]},
      body:{type:"box",layout:"vertical",paddingAll:"16px",spacing:"md",
        contents:[
          {type:"text",text:"✅ ออกจากระบบเรียบร้อยแล้ว",weight:"bold",size:"md",color:"#1B5E20",align:"center"},
          {type:"box",layout:"vertical",backgroundColor:"#EEF2FF",cornerRadius:"8px",paddingAll:"12px",
            contents:[
              {type:"text",text:"📞 Hotline CRRT (24 ชั่วโมง)",weight:"bold",size:"sm",color:"#1A237E"},
              {type:"text",text:"📱 086-341-7250",size:"lg",weight:"bold",color:"#C62828",margin:"sm"},
              {type:"text",text:"พร้อมรับสายตลอด 24 ชั่วโมงครับ",size:"xs",color:"#666666"}
            ]},
          {type:"text",text:"หากต้องการใช้งานอีกครั้ง\nกด Rich Menu ด้านล่างได้เลยครับ 👇",size:"sm",color:"#555555",wrap:true,align:"center"}
        ]},
      footer:{type:"box",layout:"vertical",paddingAll:"10px",
        contents:[
          {type:"button",action:{type:"uri",label:"📞 โทร Hotline 086-341-7250",uri:"tel:0863417250"},style:"primary",color:"#C62828",height:"sm",margin:"xs",adjustMode:"shrink-to-fit"},
          {type:"button",action:{type:"message",label:"🏠 กลับหน้าแรก",text:"main_menu"},style:"secondary",height:"sm",margin:"xs",adjustMode:"shrink-to-fit"}
        ]}
    }});
    return;
  }
  if(text==="alarm_menu")  {activate(uid);  await client.replyMessage(replyToken,menuFlex(0));return;}
  if(text==="alarm_menu_2"){activate(uid);touch(uid);await client.replyMessage(replyToken,menuFlex(1));return;}
  if(text==="alarm_menu_3"){activate(uid);touch(uid);await client.replyMessage(replyToken,menuFlex(2));return;}

  // ── Early alarm trigger + Auto-activate ─────────────────────────────────────
  if(!NAV.has(text)){
    const eDA=DB_MAIN.find(r=>T2T[r.alarm_title]===text);
    if(eDA){activate(uid);const et=T2T[eDA.alarm_title]||text;await client.replyMessage(replyToken,alarmFlex(eDA,getSub(et),et));return;}
    // DB ว่าง → force reload แล้ว retry
    const _T2TV2=new Set(Object.values(T2T));
    if(_T2TV2.has(text)&&DB_MAIN.length===0){DB_LAST=0;await loadDB();const eDA2=DB_MAIN.find(r=>T2T[r.alarm_title]===text);if(eDA2){activate(uid);const et2=T2T[eDA2.alarm_title]||text;await client.replyMessage(replyToken,alarmFlex(eDA2,getSub(et2),et2));return;}}
    if(_T2TV2.has(text))activate(uid);
  }

  const _KB=new Set(["crrt_mode_info","crrt_pressure_info","crrt_billing","crrt_supplies","crrt_wound","crrt_calc","crrt_knowledge","crrt_prime"]);
  if(_KB.has(text))activate(uid);
  const _T2TV=new Set(Object.values(T2T));
  if(_T2TV.has(text)&&DB_MAIN.length===0){DB_LAST=0;await loadDB();}
  if(_T2TV.has(text)||DB_MAIN.some(r=>[1,2,3,4,5,6].some(n=>r[`btn_${n}_action`]===text)))activate(uid);

  if(!isActive(uid))return;
  touch(uid);

  // ── Knowledge sub-topics ─────────────────────────────────────────────────────
  if(text==="crrt_knowledge"){
    const kbBtns=[
      {label:"🔄 CRRT Mode",action:"crrt_mode_info",color:"#0D47A1"},
      {label:"📊 ค่า Pressure",action:"crrt_pressure_info",color:"#880E4F"},
      {label:"💳 การเบิกจ่ายสิทธิ์",action:"crrt_billing",color:"#1565C0"},
      {label:"📦 Solution & อุปกรณ์",action:"crrt_supplies",color:"#4527A0"},
      {label:"🩹 การทำแผล DLC",action:"crrt_wound",color:"#C62828"},
      {label:"🧮 คิดคำนวณสารน้ำ",action:"crrt_calc",color:"#E65100"},
      {label:"💉 วิธีหล่อเส้น Citrate",action:"how_to_flush_dlc",color:"#00695C"},
      {label:"✅ วิธีเก็บเครื่อง",action:"show_cleanup",color:"#2E7D32"},
      {label:"🏠 Main Menu",action:"main_menu",color:"#546E7A"},
    ];
    const kbFlexBtns=kbBtns.map(b=>({type:"button",action:{type:"message",label:b.label,text:b.action},style:"primary",color:b.color,height:"sm",adjustMode:"shrink-to-fit",margin:"xs"}));
    await client.replyMessage(replyToken,{type:"flex",altText:"📚 CRRT Knowledge Base",contents:{type:"bubble",
      hero:{type:"box",layout:"horizontal",backgroundColor:"#1565C0",paddingAll:"12px",spacing:"sm",contents:[
        {type:"image",url:LOGO_URL,size:"xxs",flex:0,aspectMode:"fit",aspectRatio:"124:100"},
        {type:"box",layout:"vertical",flex:1,justifyContent:"center",contents:[
          {type:"text",text:"RA5IC · RAMATHIBODI",color:"#FFFFFF",size:"xxs"},
          {type:"text",text:"📚 CRRT Knowledge Base",color:"#FFD700",size:"sm",weight:"bold"}
        ]}
      ]},
      body:{type:"box",layout:"vertical",paddingAll:"10px",spacing:"xs",contents:kbFlexBtns},
      footer:{type:"box",layout:"vertical",paddingAll:"10px",backgroundColor:"#FAFAFA",
        contents:[{type:"text",text:"เลือกหัวข้อที่ต้องการครับ 👆",size:"xs",color:"#888888",align:"center"}]}
    }});
    return;
  }

  if(text==="crrt_mode_info"){await client.replyMessage(replyToken,{type:"flex",altText:"📋 CRRT Mode",contents:{type:"bubble",hero:{type:"box",layout:"horizontal",backgroundColor:"#0D47A1",paddingAll:"14px",spacing:"sm",contents:[{type:"image",url:LOGO_URL,size:"xxs",flex:0,aspectMode:"fit",aspectRatio:"124:100"},{type:"box",layout:"vertical",flex:1,justifyContent:"center",contents:[{type:"text",text:"RA5IC · RAMATHIBODI",color:"rgba(255,255,255,0.75)",size:"xxs"},{type:"text",text:"📋 CRRT Mode — รูปแบบการฟอกไต",color:"#FFFFFF",size:"sm",weight:"bold",wrap:true}]}]},body:{type:"box",layout:"vertical",paddingAll:"14px",backgroundColor:"#F0F6FF",spacing:"sm",contents:[{type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#E3F2FD",paddingAll:"10px",cornerRadius:"10px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"5px",backgroundColor:"#0D47A1",cornerRadius:"4px",contents:[]},{type:"box",layout:"vertical",flex:1,margin:"sm",contents:[{type:"text",text:"🔵 CRRT vs IHD vs SLED — เปรียบเทียบ",weight:"bold",size:"sm",color:"#0D47A1",wrap:true}]}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#0D47A1",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"IHD: BFR 300-400 ml/min, Dialysate 500-800 ml/min, 3-4 ชม./ครั้ง — Hemodynamic ไม่ดี",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#0D47A1",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"SLED: BFR 200-300, Dialysate 1-2 L/h, 6-12 ชม. — Hemodynamic ดีกว่า",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#0D47A1",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"CRRT: BFR 80-200, Dialysate 2-3 L/h, Continuous — ดีที่สุดสำหรับ ICU วิกฤต",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#0D47A1",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"CRRT ดีกว่า IHD เพราะ: ลด Dialysis-induced hypotension + Osmolality เปลี่ยนช้า",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"separator",margin:"md",color:"#E8ECF4"},
          {type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#E3F2FD",paddingAll:"10px",cornerRadius:"10px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"5px",backgroundColor:"#1565C0",cornerRadius:"4px",contents:[]},{type:"box",layout:"vertical",flex:1,margin:"sm",contents:[{type:"text",text:"📋 4 Mode หลักของ CRRT",weight:"bold",size:"sm",color:"#0D47A1",wrap:true}]}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#1565C0",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"1️⃣ SCUF — ดึงน้ำส่วนเกินอย่างเดียว (UF only) ไม่กำจัดของเสีย ไม่ต้องมี Replacement",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#1565C0",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"   ✅ Case: Volume overload (CHF ดื้อยาขับปัสสาวะ)",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#1565C0",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"2️⃣ CVVH — Convection: กำจัดโมเลกุลกลาง-ใหญ่ ใช้ Replacement fluid ชดเชย",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#1565C0",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"   ✅ Case: Solute + Volume | ดีมากสำหรับ Myoglobin (17.2 kD)",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#1565C0",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"3️⃣ CVVHD — Diffusion: ล้างโมเลกุลเล็ก (Urea, K+, MALA) ใช้ Dialysate ไม่มี Replacement",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#1565C0",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"   ✅ Case: Uremia, Electrolyte imbalance, MALA",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#1565C0",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"4️⃣ CVVHDF — Diffusion + Convection รวมกัน ✅ RA5IC ใช้ Mode นี้เป็นหลัก",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#1565C0",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"   ✅ Case: Hypercatabolic + Volume overload + Cytokine + Toxin removal",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"separator",margin:"md",color:"#E8ECF4"},
          {type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#FFF3E0",paddingAll:"10px",cornerRadius:"10px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"5px",backgroundColor:"#E65100",cornerRadius:"4px",contents:[]},{type:"box",layout:"vertical",flex:1,margin:"sm",contents:[{type:"text",text:"⚙️ Filtration Fraction (FF) — สำคัญมาก",weight:"bold",size:"sm",color:"#BF360C",wrap:true}]}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#E65100",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"FF = QUF ÷ QP | ต้องน้อยกว่า 20-25% เสมอ",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#E65100",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"QP = BFR (ml/h) × (1 - Hct) | BFR 150 ml/min = 9,000 ml/h, Hct 34%",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#E65100",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"ตัวอย่าง CVVHDF Pre 1,200 + Dialysate 600 + FR 100 ml/h:",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#E65100",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"FF = (1,200+100) ÷ (9,000×0.66+1,200) = 1,300÷7,140 = 18% ✅",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#E65100",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"FF สูงเกิน 25% → Hemoconcentration → Filter Clot เร็ว",size:"sm",color:"#B71C1C",weight:"bold",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#E65100",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Pre-dilution: ลด FF แต่ลด Clearance ด้วย | Post-dilution: เพิ่ม FF แต่ Clearance ดีกว่า",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"separator",margin:"md",color:"#E8ECF4"},
          {type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#E8F5E9",paddingAll:"10px",cornerRadius:"10px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"5px",backgroundColor:"#2E7D32",cornerRadius:"4px",contents:[]},{type:"box",layout:"vertical",flex:1,margin:"sm",contents:[{type:"text",text:"📊 ค่าแนะนำ RA5IC (BW 60 kg)",weight:"bold",size:"sm",color:"#1B5E20",wrap:true}]}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#2E7D32",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Prescribed Dose: 25-30 ml/kg/hr | Delivered ≥ 80% = 20-25 ml/kg/hr (KDIGO 2012, 1A)",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#2E7D32",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"BFR ไม่มี Anticoagulation: เริ่ม 150 ml/min | มี Anticoagulation: 80-150 ml/min",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#2E7D32",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Total Effluent = Dialysate + Pre-Rep + Post-Rep + Net Fluid Removal",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#2E7D32",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"ตัวอย่าง 60 kg: 60×25=1,500 ml/hr | Pre 700+Dialysate 800 (ปรับตามสถานการณ์)",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"separator",margin:"md",color:"#E8ECF4"},
          {type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#FFEBEE",paddingAll:"10px",cornerRadius:"10px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"5px",backgroundColor:"#C62828",cornerRadius:"4px",contents:[]},{type:"box",layout:"vertical",flex:1,margin:"sm",contents:[{type:"text",text:"⚠️ Quality Benchmark CRRT (ADQI 2019)",weight:"bold",size:"sm",color:"#B71C1C",wrap:true}]}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#C62828",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Filter life > 60 ชม. ≥ 60% ของ Filter ทั้งหมด",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#C62828",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Delivered Dose ≥ 80% Prescribed | UF removed ≥ 80% Prescribed",size:"sm",color:"#B71C1C",weight:"bold",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#C62828",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Downtime ≤ 10%/วัน (< 2.4 ชม./วัน) | CLABSI = 0 events",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#C62828",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Urea Sieving Coefficient 0.87-1.0 | sCr ไม่เพิ่มขึ้น (≤ 0%)",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#C62828",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Monitor Electrolytes (K, Na, Ca, Mg, Phos) ทุก 6-8 ชั่วโมง",size:"sm",color:"#B71C1C",weight:"bold",wrap:true,flex:1}]}]},footer:{type:"box",layout:"vertical",paddingAll:"10px",spacing:"xs",backgroundColor:"#F8F9FC",contents:[{type:"button",action:{type:"message",label:"📚 กลับ Knowledge",text:"crrt_knowledge"},style:"primary",color:"#1565C0",height:"sm",adjustMode:"shrink-to-fit"},{type:"button",action:{type:"message",label:"🏠 Main Menu",text:"main_menu"},style:"secondary",height:"sm",adjustMode:"shrink-to-fit",margin:"xs"}]}}});return;}

  if(text==="crrt_pressure_info"){await client.replyMessage(replyToken,{type:"flex",altText:"📊 ค่า Pressure CRRT",contents:{type:"bubble",hero:{type:"box",layout:"horizontal",backgroundColor:"#880E4F",paddingAll:"14px",spacing:"sm",contents:[{type:"image",url:LOGO_URL,size:"xxs",flex:0,aspectMode:"fit",aspectRatio:"124:100"},{type:"box",layout:"vertical",flex:1,justifyContent:"center",contents:[{type:"text",text:"RA5IC · RAMATHIBODI",color:"rgba(255,255,255,0.75)",size:"xxs"},{type:"text",text:"📊 ค่า Pressure — Prismaflex Ramathibodi",color:"#FFFFFF",size:"sm",weight:"bold",wrap:true}]}]},body:{type:"box",layout:"vertical",paddingAll:"14px",backgroundColor:"#FFF5FA",spacing:"sm",contents:[{type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#FCE4EC",paddingAll:"10px",cornerRadius:"10px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"5px",backgroundColor:"#880E4F",cornerRadius:"4px",contents:[]},{type:"box",layout:"vertical",flex:1,margin:"sm",contents:[{type:"text",text:"📊 ค่า Pressure 5 จุดหลัก (PDF Ramathibodi 2026)",weight:"bold",size:"sm",color:"#880E4F",wrap:true}]}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#880E4F",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"🔴 Access Pressure (AP): ปกติ -50 ถึง -150 mmHg",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#880E4F",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"   > -150 mmHg → DLC ชิดผนัง/สายพับ/BFR สูงเกิน → ลด BFR, จัดท่า",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#880E4F",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"🔵 Venous/Return Pressure (VP): ปกติ +50 ถึง +150 mmHg",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#880E4F",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"   > +150 mmHg → Clot ใน Return line หรือ Venous chamber",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#880E4F",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"🟠 Filter Pressure (FP): ปกติ +100 ถึง +250 mmHg",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#880E4F",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"   > +250 mmHg → Risk for Clotting ใน Filter",size:"sm",color:"#B71C1C",weight:"bold",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#880E4F",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"🟡 TMP (Trans-Membrane Pressure): ปกติ +170 ถึง +350 mmHg",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#880E4F",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"   สูตร: TMP = (FP + VP) ÷ 2 − EP",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#880E4F",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"   > +200 mmHg = Risk for Clotting | ขึ้นช้าๆ = Clogging | ขึ้นฉับพลัน = Clot",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#880E4F",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"⚫ Effluent Pressure (EP): ปกติ -150 ถึง +50 mmHg",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#880E4F",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"   ลบมาก > -150 → Membrane อุดตัน (Clogging)",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"separator",margin:"md",color:"#E8ECF4"},
          {type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#E3F2FD",paddingAll:"10px",cornerRadius:"10px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"5px",backgroundColor:"#1565C0",cornerRadius:"4px",contents:[]},{type:"box",layout:"vertical",flex:1,margin:"sm",contents:[{type:"text",text:"🔍 วิเคราะห์ปัญหาจาก Pressure Pattern (Prismaflex)",weight:"bold",size:"sm",color:"#0D47A1",wrap:true}]}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#1565C0",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Access line ปัญหา: AP > -150 เท่านั้น | VP, FP, TMP ปกติ",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#1565C0",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Return line ปัญหา: VP > +150, FP > +250 | AP ปกติ",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#1565C0",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Filter Clotting: FP > +250, ΔP เพิ่ม 100+ mmHg จาก baseline | AP VP ปกติ",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#1565C0",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Filter Clogging: FP > +250, EP ลบเพิ่ม > -150 mmHg | ΔP เพิ่ม 150+ mmHg",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#1565C0",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"High TMP + VP ปกติ → Clot อยู่ที่ Filter | High TMP + VP สูง → Clot ที่ Filter หรือ Return line",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"separator",margin:"md",color:"#E8ECF4"},
          {type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#E8F5E9",paddingAll:"10px",cornerRadius:"10px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"5px",backgroundColor:"#2E7D32",cornerRadius:"4px",contents:[]},{type:"box",layout:"vertical",flex:1,margin:"sm",contents:[{type:"text",text:"✅ แนวทางแก้ TMP สูง (จาก PDF)",weight:"bold",size:"sm",color:"#1B5E20",wrap:true}]}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#2E7D32",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"TMP ขึ้นช้าๆ (Clogging): ลด Post-dilution rate → เพิ่ม Pre-dilution rate",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#2E7D32",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"TMP ขึ้นฉับพลัน: ตรวจสาย Effluent/Drain bag ตัน/หัก → Unclamp หรือเปลี่ยนถุง",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#2E7D32",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"ทบทวน Anticoagulation — ปรับ Citrate/Heparin dose ให้เหมาะสม",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#2E7D32",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"เพิ่ม BFR (ไม่เกิน 200 ml/min) | ตรวจ Pressure dome ให้แน่นทุกจุด",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#2E7D32",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"ตรวจ Blood flow/Exchange ratio ให้เหมาะสม",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"separator",margin:"md",color:"#E8ECF4"},
          {type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#FFEBEE",paddingAll:"10px",cornerRadius:"10px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"5px",backgroundColor:"#C62828",cornerRadius:"4px",contents:[]},{type:"box",layout:"vertical",flex:1,margin:"sm",contents:[{type:"text",text:"⚠️ ต้องเตรียมคืนเลือดเมื่อ",weight:"bold",size:"sm",color:"#B71C1C",wrap:true}]}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#C62828",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"FP > +250 + TMP สูงต่อเนื่อง ไม่ลดหลังแก้ไข",size:"sm",color:"#B71C1C",weight:"bold",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#C62828",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Filter ดำสนิท หรือ Clot เห็นชัดใน Venous Chamber",size:"sm",color:"#B71C1C",weight:"bold",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#C62828",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Circuit หยุดบ่อย > 3 ครั้ง/ชั่วโมง โดยไม่มีสาเหตุอื่น",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#C62828",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"แจ้งแพทย์ทันทีก่อนคืนเลือดทุกครั้ง",size:"sm",color:"#B71C1C",weight:"bold",wrap:true,flex:1}]}]},footer:{type:"box",layout:"vertical",paddingAll:"10px",spacing:"xs",backgroundColor:"#F8F9FC",contents:[{type:"button",action:{type:"message",label:"📚 กลับ Knowledge",text:"crrt_knowledge"},style:"primary",color:"#1565C0",height:"sm",adjustMode:"shrink-to-fit"},{type:"button",action:{type:"message",label:"🏠 Main Menu",text:"main_menu"},style:"secondary",height:"sm",adjustMode:"shrink-to-fit",margin:"xs"}]}}});return;}

  if(text==="crrt_billing"){await client.replyMessage(replyToken,{type:"flex",altText:"💳 การเบิกจ่ายสิทธิ์ CRRT",contents:{type:"bubble",hero:{type:"box",layout:"horizontal",backgroundColor:"#1565C0",paddingAll:"14px",spacing:"sm",contents:[{type:"image",url:LOGO_URL,size:"xxs",flex:0,aspectMode:"fit",aspectRatio:"124:100"},{type:"box",layout:"vertical",flex:1,justifyContent:"center",contents:[{type:"text",text:"RA5IC · RAMATHIBODI",color:"rgba(255,255,255,0.75)",size:"xxs"},{type:"text",text:"💳 การเบิกจ่ายสิทธิ์ CRRT — อัปเดต 2569",color:"#FFFFFF",size:"sm",weight:"bold",wrap:true}]}]},body:{type:"box",layout:"vertical",paddingAll:"14px",backgroundColor:"#F0F4FF",spacing:"sm",contents:[{type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#FFEBEE",paddingAll:"10px",cornerRadius:"10px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"5px",backgroundColor:"#C62828",cornerRadius:"4px",contents:[]},{type:"box",layout:"vertical",flex:1,margin:"sm",contents:[{type:"text",text:"⚠️ หมายเหตุสำคัญ — อ่านก่อนเบิกทุกครั้ง",weight:"bold",size:"sm",color:"#B71C1C",wrap:true}]}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#C62828",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"เบิกได้เฉพาะ AKI + Hemodynamic instability (Shock) เท่านั้น",size:"sm",color:"#B71C1C",weight:"bold",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#C62828",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Dx. ESKD → ใช้ MKC6 ตั้งแต่วันแรกทุกสิทธิ์ ร่วมจ่ายเสมอ",size:"sm",color:"#B71C1C",weight:"bold",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#C62828",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Oxiris (ตัวกรอง Cytokine) — ไม่มีเหมารวมทุกกรณี ผู้ป่วยร่วมจ่ายเสมอ",size:"sm",color:"#B71C1C",weight:"bold",wrap:true,flex:1}]},
          {type:"separator",margin:"md",color:"#E8ECF4"},
          {type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#E3F2FD",paddingAll:"10px",cornerRadius:"10px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"5px",backgroundColor:"#1565C0",cornerRadius:"4px",contents:[]},{type:"box",layout:"vertical",flex:1,margin:"sm",contents:[{type:"text",text:"💛 เงินสด / รัฐวิสาหกิจ",weight:"bold",size:"sm",color:"#0D47A1",wrap:true}]}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#1565C0",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"รหัส: MKC6 ตั้งแต่วันแรกเป็นต้นไป",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#1565C0",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"อุปกรณ์และน้ำยา: ซื้อตามการใช้งานจริง ไม่มีเหมารวม",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#1565C0",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"การชำระ: ผู้ป่วยร่วมจ่าย",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"separator",margin:"md",color:"#E8ECF4"},
          {type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#EDE7F6",paddingAll:"10px",cornerRadius:"10px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"5px",backgroundColor:"#5E35B1",cornerRadius:"4px",contents:[]},{type:"box",layout:"vertical",flex:1,margin:"sm",contents:[{type:"text",text:"💜 ประกันสุขภาพ / ประกันสังคม",weight:"bold",size:"sm",color:"#4527A0",wrap:true}]}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#5E35B1",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"วันแรก: รหัส M313 — เหมารวมทุกรายการ ไม่ต้องร่วมจ่าย",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#5E35B1",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"ตั้งแต่วันที่ 2 เป็นต้นไป: รหัส M314 — เหมารวมทุกรายการ ไม่ต้องร่วมจ่าย",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"separator",margin:"md",color:"#E8ECF4"},
          {type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#E3F2FD",paddingAll:"10px",cornerRadius:"10px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"5px",backgroundColor:"#1565C0",cornerRadius:"4px",contents:[]},{type:"box",layout:"vertical",flex:1,margin:"sm",contents:[{type:"text",text:"💙 ข้าราชการ / อปท. / กทม.",weight:"bold",size:"sm",color:"#0D47A1",wrap:true}]}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#1565C0",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"วันแรก: รหัส M313 — เหมารวมทุกรายการ ไม่ต้องร่วมจ่าย",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#1565C0",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"วันที่ 2-5: รหัส M314 — เหมารวมทุกรายการ ไม่ต้องร่วมจ่าย",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#1565C0",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"ตั้งแต่วันที่ 6 เป็นต้นไป: รหัส MKC6 — ซื้อตามจริง ไม่มีเหมารวม ร่วมจ่าย",size:"sm",color:"#B71C1C",weight:"bold",wrap:true,flex:1}]},
          {type:"separator",margin:"md",color:"#E8ECF4"},
          {type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#E8F5E9",paddingAll:"10px",cornerRadius:"10px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"5px",backgroundColor:"#2E7D32",cornerRadius:"4px",contents:[]},{type:"box",layout:"vertical",flex:1,margin:"sm",contents:[{type:"text",text:"📊 สรุปรหัสคิดเงิน",weight:"bold",size:"sm",color:"#1B5E20",wrap:true}]}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#2E7D32",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"M313 = วันแรก (เหมารวม) ใช้กับ ประกันสังคม + ข้าราชการ",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#2E7D32",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"M314 = วันต่อไป (เหมารวม) ใช้กับ ประกันสังคม (ทุกวัน) + ข้าราชการ (วัน 2-5)",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#2E7D32",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"MKC6 = เงินสด/รัฐวิสาหกิจ (ทุกวัน) + ข้าราชการ (วันที่ 6+) + ESKD ทุกสิทธิ์",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#2E7D32",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"RCA (Regional Citrate Anticoagulation) — รวมใน CRRT ทุกสิทธิ์",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"separator",margin:"md",color:"#E8ECF4"},
          {type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#FFF3E0",paddingAll:"10px",cornerRadius:"10px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"5px",backgroundColor:"#E65100",cornerRadius:"4px",contents:[]},{type:"box",layout:"vertical",flex:1,margin:"sm",contents:[{type:"text",text:"🔧 ข้อปฏิบัติ",weight:"bold",size:"sm",color:"#BF360C",wrap:true}]}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#E65100",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"บันทึก Indication ชัดเจน: AKI + Shock ใน Doctor Order + Nursing Note ทุกครั้ง",size:"sm",color:"#B71C1C",weight:"bold",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#E65100",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"เปลี่ยน Filter ก่อนครบ 60 ชม. → บันทึกเหตุผลชัดเจน (Clotted/Clogged)",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#E65100",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Filter Life เป้าหมาย > 60 ชม. ≥ 60% ของ Filter ทั้งหมด (Quality Benchmark)",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#E65100",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"สอบถามเพิ่มเติม: ฝ่ายการเงิน RA5IC หรือ Social Worker",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]}]},footer:{type:"box",layout:"vertical",paddingAll:"10px",spacing:"xs",backgroundColor:"#F8F9FC",contents:[{type:"button",action:{type:"message",label:"📚 กลับ Knowledge",text:"crrt_knowledge"},style:"primary",color:"#1565C0",height:"sm",adjustMode:"shrink-to-fit"},{type:"button",action:{type:"message",label:"🏠 Main Menu",text:"main_menu"},style:"secondary",height:"sm",adjustMode:"shrink-to-fit",margin:"xs"}]}}});return;}

  if(text==="crrt_supplies"){await client.replyMessage(replyToken,{type:"flex",altText:"📦 Solution & อุปกรณ์ CRRT",contents:{type:"bubble",hero:{type:"box",layout:"horizontal",backgroundColor:"#4527A0",paddingAll:"14px",spacing:"sm",contents:[{type:"image",url:LOGO_URL,size:"xxs",flex:0,aspectMode:"fit",aspectRatio:"124:100"},{type:"box",layout:"vertical",flex:1,justifyContent:"center",contents:[{type:"text",text:"RA5IC · RAMATHIBODI",color:"rgba(255,255,255,0.75)",size:"xxs"},{type:"text",text:"📦 CRRT Solution & อุปกรณ์ — ข้อมูลครบถ้วน",color:"#FFFFFF",size:"sm",weight:"bold",wrap:true}]}]},body:{type:"box",layout:"vertical",paddingAll:"14px",backgroundColor:"#F5F0FF",spacing:"sm",contents:[{type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#EDE7F6",paddingAll:"10px",cornerRadius:"10px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"5px",backgroundColor:"#4527A0",cornerRadius:"4px",contents:[]},{type:"box",layout:"vertical",flex:1,margin:"sm",contents:[{type:"text",text:"📦 CRRT Solution ที่ใช้ในไทย (PDF Ramathibodi 2026)",weight:"bold",size:"sm",color:"#4A148C",wrap:true}]}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#4527A0",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Accusol 35: Na 140, Cl 109.5, HCO3 35, Ca 1.75, Mg 0.5 mmol/L — สูตรมาตรฐาน",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#4527A0",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"BICSOL-35-108-K0: Na 138, HCO3 35, Ca 1.5, Mg 0.75, Glucose 5.55 mmol/L",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#4527A0",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Prism0cal B22: Na 140, HCO3 32, Ca 1.75 — ใช้คู่กับ Prismocitrate 18/0",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#4527A0",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Prismasol B0: Na 143, HCO3 35 ไม่มี Ca — ✅ ใช้กับ Citrate anticoagulation",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#4527A0",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"MultiPlus K2: Na 140, K 2, HCO3 35, Phos 1.0 mmol/L — ✅ เหมาะ Hypophosphatemia",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#4527A0",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Prismocitrate 18/0: Citrate 18 mmol/L — Anticoagulant ใส่ Pre-filter",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#4527A0",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Chulasol 35: Na 140, HCO3 35 — ผลิตในไทย ✅ ราคาประหยัด",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"separator",margin:"md",color:"#E8ECF4"},
          {type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#E3F2FD",paddingAll:"10px",cornerRadius:"10px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"5px",backgroundColor:"#1565C0",cornerRadius:"4px",contents:[]},{type:"box",layout:"vertical",flex:1,margin:"sm",contents:[{type:"text",text:"🔬 เลือก Solution ตาม Electrolytes",weight:"bold",size:"sm",color:"#0D47A1",wrap:true}]}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#1565C0",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"K > 5.5 mEq/L → Add K+ 1-2 mEq/L ใน Solution | เพิ่ม Dialysate/Rep flow",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#1565C0",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"K 4.5-5.5 mEq/L → Add K+ 3 mEq/L",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#1565C0",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"K < 4.5 mEq/L → Add K+ 4 mEq/L",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#1565C0",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"⚠️ ห้ามใช้ Zero K+ นานๆ → เสี่ยง Arrhythmia",size:"sm",color:"#B71C1C",weight:"bold",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#1565C0",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Na สูง (Hypernatremia/Cerebral edema) → ใช้ Solution Na ต่ำ (Chulasol 22)",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#1565C0",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Na ต่ำ (Hyponatremia/กำลังได้ Citrate) → ใช้ Solution Na สูงกว่า",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"separator",margin:"md",color:"#E8ECF4"},
          {type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#E8F5E9",paddingAll:"10px",cornerRadius:"10px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"5px",backgroundColor:"#2E7D32",cornerRadius:"4px",contents:[]},{type:"box",layout:"vertical",flex:1,margin:"sm",contents:[{type:"text",text:"💊 จัดการ Hypophosphatemia (พบบ่อยมากหลัง CRRT ≥ 48 ชม.)",weight:"bold",size:"sm",color:"#1B5E20",wrap:true}]}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#2E7D32",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Sodium phosphate (3 mmol/mL): 5 mL ใน NSS 100 mL IV drip 2 ชม. (PO4 < 1.0 mg/dL)",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#2E7D32",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Dipotassium phosphate (K 1, P 0.5 mmol/mL): ผสมใน Dialysate 1-1.2 mmol/L",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#2E7D32",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Esafosfina® (4.6-4.8 mmol/g): 5 g ใน NSS 100 mL IV drip",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#2E7D32",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Glycophos® (1 mmol/mL): 20 mL ใน NSS 100 mL IV drip 6-8 ชม.",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#2E7D32",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Dipotassium phosphate 3 mL ใน Dialysate 1 L → K 3 mEq/L + P 1.5 mmol/L",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#2E7D32",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"ใช้ Solution ที่มี Phosphate: Phoxillum, MultiPlus K2",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"separator",margin:"md",color:"#E8ECF4"},
          {type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#FFF3E0",paddingAll:"10px",cornerRadius:"10px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"5px",backgroundColor:"#E65100",cornerRadius:"4px",contents:[]},{type:"box",layout:"vertical",flex:1,margin:"sm",contents:[{type:"text",text:"🧪 Magnesium Sulfate",weight:"bold",size:"sm",color:"#BF360C",wrap:true}]}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#E65100",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"50% MgSO4: 2-8 g/day IV continuous drip ใน 8 ชม.",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#E65100",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Monitor serum Ca, PO4, Mg ทุก 8-12 ชั่วโมง",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"separator",margin:"md",color:"#E8ECF4"},
          {type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#FFEBEE",paddingAll:"10px",cornerRadius:"10px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"5px",backgroundColor:"#C62828",cornerRadius:"4px",contents:[]},{type:"box",layout:"vertical",flex:1,margin:"sm",contents:[{type:"text",text:"⚠️ ข้อควรระวัง",weight:"bold",size:"sm",color:"#B71C1C",wrap:true}]}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#C62828",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"บันทึกรหัส Lot และวันหมดอายุ Solution ทุกถุงใน Nursing Note",size:"sm",color:"#B71C1C",weight:"bold",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#C62828",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"ถอด Heparin lock (1,000-5,000 units/mL) ออกก่อน Start CRRT ทุกครั้ง",size:"sm",color:"#B71C1C",weight:"bold",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#C62828",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Bicarbonate customized solution: ผสม 7.5% NaHCO3 + Sterile water ตามสูตร",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]}]},footer:{type:"box",layout:"vertical",paddingAll:"10px",spacing:"xs",backgroundColor:"#F8F9FC",contents:[{type:"button",action:{type:"message",label:"📚 กลับ Knowledge",text:"crrt_knowledge"},style:"primary",color:"#1565C0",height:"sm",adjustMode:"shrink-to-fit"},{type:"button",action:{type:"message",label:"🏠 Main Menu",text:"main_menu"},style:"secondary",height:"sm",adjustMode:"shrink-to-fit",margin:"xs"}]}}});return;}

  if(text==="crrt_wound"){await client.replyMessage(replyToken,{type:"flex",altText:"🩹 การทำแผล DLC",contents:{type:"bubble",hero:{type:"box",layout:"horizontal",backgroundColor:"#C62828",paddingAll:"14px",spacing:"sm",contents:[{type:"image",url:LOGO_URL,size:"xxs",flex:0,aspectMode:"fit",aspectRatio:"124:100"},{type:"box",layout:"vertical",flex:1,justifyContent:"center",contents:[{type:"text",text:"RA5IC · RAMATHIBODI",color:"rgba(255,255,255,0.75)",size:"xxs"},{type:"text",text:"🩹 การทำแผล DLC — Aseptic Technique",color:"#FFFFFF",size:"sm",weight:"bold",wrap:true}]}]},body:{type:"box",layout:"vertical",paddingAll:"14px",backgroundColor:"#FFF0F0",spacing:"sm",contents:[{type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#FFEBEE",paddingAll:"10px",cornerRadius:"10px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"5px",backgroundColor:"#C62828",cornerRadius:"4px",contents:[]},{type:"box",layout:"vertical",flex:1,margin:"sm",contents:[{type:"text",text:"📍 ตำแหน่ง DLC ที่แนะนำ (KDIGO 2012)",weight:"bold",size:"sm",color:"#B71C1C",wrap:true}]}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#C62828",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"1️⃣ Right internal jugular vein ✅ อันดับ 1",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#C62828",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"   ขนาด 11-13.5 Fr | ยาว 15 cm | Tip ที่ Right atrium",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#C62828",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"2️⃣ Femoral vein (ทั้ง 2 ข้าง)",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#C62828",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"   ขนาด 13.5 Fr | ยาว 20-25 cm | Tip ที่ Inferior vena cava",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#C62828",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"3️⃣ Left internal jugular vein",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#C62828",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"   ขนาด 11-13.5 Fr | ยาว 20 cm | Tip ที่ Right atrium",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#C62828",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"⛔ Subclavian vein — Precaution (ห้ามเป็น First choice)",size:"sm",color:"#B71C1C",weight:"bold",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#C62828",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"✅ ใช้ Ultrasound guidance ทุกครั้ง (Grade 1A) | CXR หลังใส่ก่อน Start (Grade 1B)",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"separator",margin:"md",color:"#E8ECF4"},
          {type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#FFF3E0",paddingAll:"10px",cornerRadius:"10px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"5px",backgroundColor:"#E65100",cornerRadius:"4px",contents:[]},{type:"box",layout:"vertical",flex:1,margin:"sm",contents:[{type:"text",text:"⏱️ Heparin Lock — การดูแลสาย DLC",weight:"bold",size:"sm",color:"#BF360C",wrap:true}]}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#E65100",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Heparin lock: ผสม Heparin 1,000-5,000 units/mL กับ NSS",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#E65100",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"ใส่ Heparin lock ทุกครั้งที่หยุด CRRT หรือไม่ใช้งานสาย",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#E65100",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"⚠️ ถอด Heparin lock ออกก่อน Start CRRT machine ทุกครั้ง",size:"sm",color:"#B71C1C",weight:"bold",wrap:true,flex:1}]},
          {type:"separator",margin:"md",color:"#E8ECF4"},
          {type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#E3F2FD",paddingAll:"10px",cornerRadius:"10px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"5px",backgroundColor:"#1565C0",cornerRadius:"4px",contents:[]},{type:"box",layout:"vertical",flex:1,margin:"sm",contents:[{type:"text",text:"🚀 7 ขั้นตอนทำแผล DLC — Aseptic Technique",weight:"bold",size:"sm",color:"#0D47A1",wrap:true}]}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#1565C0",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"1️⃣ ล้างมือ 6 ขั้นตอน + ใส่ Sterile Glove + Mask + Face Shield",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#1565C0",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"2️⃣ ค่อยๆ ดึง Dressing เก่าออก ระวัง Suture และสายรั้ง",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#1565C0",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"3️⃣ ตรวจ Exit Site: บวม แดง ร้อน หนอง Discharge ผิดปกติ หรือสายเลื่อน",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#1565C0",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"4️⃣ เช็ด Chlorhexidine 2% วนจากในออกนอก 3 รอบ รอแห้ง 30 วินาที",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#1565C0",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"5️⃣ ปิด Transparent Dressing หรือ Sterile Gauze + Tape ให้แน่น",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#1565C0",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"6️⃣ Fix สายให้แน่น ป้องกันสายพับ/หัก/ดึงรั้ง",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#1565C0",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"7️⃣ บันทึก Exit Site + วันที่ทำแผล + ลักษณะ Discharge ใน Nursing Note",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"separator",margin:"md",color:"#E8ECF4"},
          {type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#E8F5E9",paddingAll:"10px",cornerRadius:"10px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"5px",backgroundColor:"#2E7D32",cornerRadius:"4px",contents:[]},{type:"box",layout:"vertical",flex:1,margin:"sm",contents:[{type:"text",text:"📅 ความถี่ + Quality Benchmark",weight:"bold",size:"sm",color:"#1B5E20",wrap:true}]}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#2E7D32",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"เปลี่ยนแผลทุก 48-72 ชั่วโมง หรือทันทีที่แผลเปียก/สกปรก",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#2E7D32",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"CLABSI = 0 events/catheter-line days (ADQI Quality Benchmark)",size:"sm",color:"#B71C1C",weight:"bold",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#2E7D32",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Catheter dysfunction-free ≥ 80% ของ Catheter ทั้งหมด",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"separator",margin:"md",color:"#E8ECF4"},
          {type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#FFEBEE",paddingAll:"10px",cornerRadius:"10px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"5px",backgroundColor:"#C62828",cornerRadius:"4px",contents:[]},{type:"box",layout:"vertical",flex:1,margin:"sm",contents:[{type:"text",text:"⚠️ ข้อห้ามเด็ดขาด",weight:"bold",size:"sm",color:"#B71C1C",wrap:true}]}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#C62828",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"ห้ามใช้ Povidone-Iodine กับสาย DLC (ทำลาย Polyurethane)",size:"sm",color:"#B71C1C",weight:"bold",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#C62828",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Exit Site แดงมาก/หนองผิดปกติ → แจ้งแพทย์ทันที เตรียมเปลี่ยนสาย",size:"sm",color:"#B71C1C",weight:"bold",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#C62828",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"ห้ามดึง Suture หรือปรับระดับสายเองโดยไม่มี Order",size:"sm",color:"#B71C1C",weight:"bold",wrap:true,flex:1}]}]},footer:{type:"box",layout:"vertical",paddingAll:"10px",spacing:"xs",backgroundColor:"#F8F9FC",contents:[{type:"button",action:{type:"message",label:"📚 กลับ Knowledge",text:"crrt_knowledge"},style:"primary",color:"#1565C0",height:"sm",adjustMode:"shrink-to-fit"},{type:"button",action:{type:"message",label:"🏠 Main Menu",text:"main_menu"},style:"secondary",height:"sm",adjustMode:"shrink-to-fit",margin:"xs"}]}}});return;}

  if(text==="crrt_calc"){await client.replyMessage(replyToken,{type:"flex",altText:"🧮 คำนวณสารน้ำ CRRT",contents:{type:"bubble",hero:{type:"box",layout:"horizontal",backgroundColor:"#E65100",paddingAll:"14px",spacing:"sm",contents:[{type:"image",url:LOGO_URL,size:"xxs",flex:0,aspectMode:"fit",aspectRatio:"124:100"},{type:"box",layout:"vertical",flex:1,justifyContent:"center",contents:[{type:"text",text:"RA5IC · RAMATHIBODI",color:"rgba(255,255,255,0.75)",size:"xxs"},{type:"text",text:"🧮 คิดคำนวณสารน้ำ CRRT — KDIGO 2012",color:"#FFFFFF",size:"sm",weight:"bold",wrap:true}]}]},body:{type:"box",layout:"vertical",paddingAll:"14px",backgroundColor:"#FFF8F2",spacing:"sm",contents:[{type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#FFF3E0",paddingAll:"10px",cornerRadius:"10px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"5px",backgroundColor:"#E65100",cornerRadius:"4px",contents:[]},{type:"box",layout:"vertical",flex:1,margin:"sm",contents:[{type:"text",text:"🎯 CRRT Dose (KDIGO 2012 — Grade 1A)",weight:"bold",size:"sm",color:"#BF360C",wrap:true}]}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#E65100",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Prescribed Dose = 25-30 ml/kg/hr (ใช้ Actual BW หรือ IBW ตามแพทย์กำหนด)",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#E65100",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Delivered Dose จริง ≈ Prescribed × 80% เพราะ Circuit Downtime ~10-20%",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#E65100",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"ตัวอย่าง BW 60 kg: Prescribed = 60×25 = 1,500 ml/hr | Delivered ≥ 1,200 ml/hr",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#E65100",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Total Effluent = Dialysate + Pre-Replacement + Post-Replacement + Net Fluid Removal",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#E65100",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Actual delivered dose = TEV ÷ (BW × 24) × EUN/BUN",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"separator",margin:"md",color:"#E8ECF4"},
          {type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#E3F2FD",paddingAll:"10px",cornerRadius:"10px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"5px",backgroundColor:"#1565C0",cornerRadius:"4px",contents:[]},{type:"box",layout:"vertical",flex:1,margin:"sm",contents:[{type:"text",text:"📐 Filtration Fraction (FF)",weight:"bold",size:"sm",color:"#0D47A1",wrap:true}]}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#1565C0",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"FF = QUF ÷ QP ต้องน้อยกว่า 20-25%",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#1565C0",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"QP = BFR (ml/h) × (1 - Hct) [+Pre-Replacement flow ถ้าใช้]",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#1565C0",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"ตัวอย่าง CVVHDF Pre 1,200 + Dialysate 600 + FR 100 ml/h, BFR 150, Hct 34%:",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#1565C0",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"FF = (1,200+100) ÷ [(9,000×0.66)+1,200] = 1,300÷7,140 = 18.2% ✅",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#1565C0",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"ถ้า Post-dilution 1,800 ml/hr (ไม่มี Pre): FF = 1,800 ÷ 9,000×0.66 = 30% ⚠️",size:"sm",color:"#B71C1C",weight:"bold",wrap:true,flex:1}]},
          {type:"separator",margin:"md",color:"#E8ECF4"},
          {type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#E8F5E9",paddingAll:"10px",cornerRadius:"10px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"5px",backgroundColor:"#2E7D32",cornerRadius:"4px",contents:[]},{type:"box",layout:"vertical",flex:1,margin:"sm",contents:[{type:"text",text:"💧 Fluid Balance (ต่อชั่วโมง)",weight:"bold",size:"sm",color:"#1B5E20",wrap:true}]}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#2E7D32",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"IN: IV Fluid + ยา IV Drip + อาหาร Enteral (EN) + TPN + Oral",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#2E7D32",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"OUT: Urine + Drain (NGT/Chest/JP/Abdominal) + Effluent จาก CRRT",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#2E7D32",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Net Balance (ml/hr) = Total IN − Total OUT",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#2E7D32",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Patient Fluid Removal = ค่าที่ตั้งบนเครื่อง CRRT เพื่อดึงน้ำส่วนเกินออก",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#2E7D32",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"บันทึก Fluid Balance ทุก 1 ชั่วโมงใน Nursing Note",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"separator",margin:"md",color:"#E8ECF4"},
          {type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#EDE7F6",paddingAll:"10px",cornerRadius:"10px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"5px",backgroundColor:"#4527A0",cornerRadius:"4px",contents:[]},{type:"box",layout:"vertical",flex:1,margin:"sm",contents:[{type:"text",text:"🔬 Regional Citrate Anticoagulation (RCA)",weight:"bold",size:"sm",color:"#4A148C",wrap:true}]}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#4527A0",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Prismocitrate 18/0 Pre-filter: เริ่ม 1.5-2× BFR ml/hr",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#4527A0",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"iCa Post-filter target: 0.25-0.35 mmol/L (วัดทุก 6 ชั่วโมง)",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#4527A0",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"10% Ca Gluconate Systemic: ปรับตาม iCa systemic 1.12-1.20 mmol/L",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#4527A0",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Citrate metabolism: Krebs cycle ใน Liver, Skeletal muscle, Renal cortex",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#4527A0",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Half-life ~5 นาที | ให้ 0.59 kcal/mmol ≈ 150-280 kcal/day",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#4527A0",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Ca/iCa ratio = Serum Ca (mg/dL)×0.25 ÷ iCa systemic | > 2.5 = Accumulation",size:"sm",color:"#B71C1C",weight:"bold",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#4527A0",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Signs Citrate Accumulation: Ca/iCa > 2.5, เพิ่ม Ca replacement, HAGMA+Lactate สูง",size:"sm",color:"#B71C1C",weight:"bold",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#4527A0",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Contraindication: Severe lactic acidosis > 7, Liver fail (AST/ALT>1,000, TB>3)",size:"sm",color:"#B71C1C",weight:"bold",wrap:true,flex:1}]},
          {type:"separator",margin:"md",color:"#E8ECF4"},
          {type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#FFEBEE",paddingAll:"10px",cornerRadius:"10px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"5px",backgroundColor:"#C62828",cornerRadius:"4px",contents:[]},{type:"box",layout:"vertical",flex:1,margin:"sm",contents:[{type:"text",text:"⚠️ Heparin (ถ้า Citrate มีข้อห้าม)",weight:"bold",size:"sm",color:"#B71C1C",wrap:true}]}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#C62828",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"Bolus Heparin 1,000 U → Continuous drip 500 U/hr → ปรับตาม aPTT, ACT",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#C62828",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"ข้อห้าม Heparin: Active bleeding, Post-op < 48 ชม., Plt < 50,000, INR > 2",size:"sm",color:"#B71C1C",weight:"bold",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#C62828",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"ระวัง HITT (Heparin-Induced Thrombocytopenia and Thrombosis)",size:"sm",color:"#B71C1C",weight:"bold",wrap:true,flex:1}]},
          {type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"14px",contents:[{type:"text",text:"·",color:"#C62828",size:"sm",flex:0,gravity:"top",margin:"xs"},{type:"text",text:"ปรึกษาแพทย์ Nephro/ICU ก่อนปรับ Anticoagulation ทุกครั้ง",size:"sm",color:"#B71C1C",weight:"bold",wrap:true,flex:1}]}]},footer:{type:"box",layout:"vertical",paddingAll:"10px",spacing:"xs",backgroundColor:"#F8F9FC",contents:[{type:"button",action:{type:"message",label:"📚 กลับ Knowledge",text:"crrt_knowledge"},style:"primary",color:"#1565C0",height:"sm",adjustMode:"shrink-to-fit"},{type:"button",action:{type:"message",label:"🏠 Main Menu",text:"main_menu"},style:"secondary",height:"sm",adjustMode:"shrink-to-fit",margin:"xs"}]}}});return;}

  // ── Button responses (respRow ก่อน subRows ป้องกัน double reply) ─────────────
  const respRow=DB_MAIN.find(r=>[1,2,3,4,5,6].some(n=>r[`btn_${n}_action`]===text));
  if(respRow){
    let rt="";
    for(let n=1;n<=6;n++){if(respRow[`btn_${n}_action`]===text){rt=respRow[`btn_${n}_response`]||"";break;}}
    const alarmT = T2T[respRow.alarm_title]||"";
    const cleanRt=F(rt).replace(/【[^】]*】/g,"").trim();
    if(!cleanRt){const ns=getSub(text);if(ns.length>0){await client.replyMessage(replyToken,subFlex(ns,text));return;}if(alarmT){const ar=DB_MAIN.find(r=>T2T[r.alarm_title]===alarmT);if(ar){await client.replyMessage(replyToken,alarmFlex(ar,getSub(alarmT),alarmT));return;}}}
    const displayText=cleanRt||"✅ ดำเนินการเรียบร้อยครับ";
    const isOk  = displayText.includes("✅")||displayText.includes("เรียบร้อย")||displayText.includes("สำเร็จ")||displayText.includes("ยอดเยี่ยม")||displayText.includes("เยี่ยม");
    const isWarn= displayText.includes("🚨")||displayText.includes("ห้าม")||displayText.includes("วิกฤต")||displayText.includes("รีบ");
    const heroC = isWarn?"#B71C1C":isOk?"#2E7D32":"#1565C0";
    const bodyBg= isWarn?"#FFEBEE":isOk?"#F1F8E9":"#E3F2FD";
    const txtC  = isWarn?"#B71C1C":isOk?"#1B5E20":"#1565C0";
    const footerBtns=[];
    if(alarmT){
      footerBtns.push({type:"button",action:{type:"message",label:"⬅️ ย้อนกลับ",text:alarmT},style:"primary",color:"#F9A825",height:"sm",adjustMode:"shrink-to-fit"});
    }
    footerBtns.push({type:"button",action:{type:"message",label:"🏠 Main Menu",text:"main_menu"},style:"primary",color:"#1565C0",height:"sm",adjustMode:"shrink-to-fit",margin:"xs"});
    footerBtns.push({type:"button",action:{type:"message",label:"🚪 ออกจากระบบ",text:"exit_crrt"},style:"primary",color:"#546E7A",height:"sm",adjustMode:"shrink-to-fit",margin:"xs"});
    await client.replyMessage(replyToken,{type:"flex",altText:displayText.slice(0,40),contents:{type:"bubble",
      hero:{type:"box",layout:"horizontal",backgroundColor:heroC,paddingAll:"10px",spacing:"sm",contents:[
        {type:"image",url:LOGO_URL,size:"xxs",flex:0,aspectMode:"fit",aspectRatio:"124:100"},
        {type:"box",layout:"vertical",flex:1,justifyContent:"center",contents:[
          {type:"text",text:"RA5IC · RAMATHIBODI",color:"#FFFFFF",size:"xxs"},
          {type:"text",text:"CRRT ALARM BOT",color:"#FFD700",size:"sm",weight:"bold"}
        ]}
      ]},
      body:{type:"box",layout:"vertical",paddingAll:"14px",backgroundColor:bodyBg,spacing:"sm",
        contents:[{type:"text",text:displayText,size:"sm",color:txtC,wrap:true,weight:"bold"}]},
      footer:{type:"box",layout:"vertical",paddingAll:"10px",spacing:"xs",backgroundColor:"#FAFAFA",contents:footerBtns}
    }});
    return;
  }

  // ── Sub flows ────────────────────────────────────────────────────────────────
  const isBtnAction=DB_MAIN.some(r=>[1,2,3,4,5,6].some(n=>{if(r[`btn_${n}_action`]!==text)return false;return !!(F(r[`btn_${n}_response`]||"").replace(/【[^】]*】/g,"").trim());}));
  const subRows=getSub(text);
  if(subRows.length>0 && !isBtnAction){
    if(!NAV.has(text)){
      const row=DB_MAIN.find(r=>T2T[r.alarm_title]===text||r.alarm_title?.toLowerCase()===text.toLowerCase());
      if(row){const t=T2T[row.alarm_title]||text;await client.replyMessage(replyToken,alarmFlex(row,subRows,t));return;}
    }
    await client.replyMessage(replyToken,subFlex(subRows,text));
    return;
  }

  // ── Keyword search ───────────────────────────────────────────────────────────
  const row=findAlarm(text);
  if(row){const t=T2T[row.alarm_title];await client.replyMessage(replyToken,alarmFlex(row,t?getSub(t):[],t));return;}

  // ── Fallback ─────────────────────────────────────────────────────────────────
  const fbRows=getSub("fallback");await client.replyMessage(replyToken,fbRows.length>0?subFlex(fbRows,"fallback"):{type:"text",text:"⚠️ ระบบกำลังโหลดข้อมูลครับ กรุณากดอีกครั้ง หรือโทร Hotline 086-341-7250"});
}

app.post("/webhook",line.middleware(LINE_CFG),async(req,res)=>{
  try{await Promise.all(req.body.events.map(handleEvent));res.status(200).end();}
  catch(e){console.error(e);res.status(500).end();}
});

app.get("/",(_, res)=>res.json({status:"CRRT Bot v14.0 — RA5IC",alarms:Object.keys(T2T).length}));

loadDB().then(()=>{
  const PORT=process.env.PORT||3000;
  app.listen(PORT,()=>console.log(`CRRT Bot v14.0 :${PORT}`));
});
