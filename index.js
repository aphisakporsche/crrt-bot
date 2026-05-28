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
    const _rawLbl = F((alarm[`btn_${n}_label`]||"").trim());
    // Map label ยาว → label สั้น (LINE limit 20 chars)
    const _lblMap = {
      "✅ ค่า TMP ลดลง / RUN เครื่องต่อได้":"✅ TMP ลดลง Run ต่อ",
      "✅ ค่า TMP ลดลง / RUN เครื่องต่อ":"✅ TMP ลดลง Run ต่อ",
      "🚨 แก้ไขแล้ว TMP ไม่ลด (> 250 mmHg) ➡️ เตรียม [Return Blood]":"🚨 TMP ไม่ลด ไปต่อ",
      "✅ แก้ไขสำเร็จ / รันต่อได้":"✅ แก้ไขสำเร็จ รันต่อ",
      "🔄 ย้ายจุดต่อแล้วยัง Alarm":"🔄 ย้ายแล้วยัง Alarm",
      "🚨 แรงดันสูงวิกฤต (Stop เครื่อง) ➡️ พิจารณา [Return Blood]":"🚨 แรงดันสูงวิกฤต",
      "✅ ไฟเข้าแล้ว / รันต่อได้":"✅ ไฟเข้าแล้ว รันต่อ",
      "🚨 แก้ไขไม่ได้แล้ว แต่ครื่องยังทำงาน  ➡️ เตรียม [Return Blood] ให้เร็วที่สุด":"🚨 แก้ไม่ได้คืนเลือด",
      "🚨 เครื่องดับไปแล้ว (คืนเลือดไม่ได้)":"🚨 เครื่องดับไปแล้ว",
    };
    const lbl = (_lblMap[_rawLbl] || _rawLbl).slice(0,20);
    const act = (alarm[`btn_${n}_action`]||"").trim();
    if (!lbl||lbl==="nan"||!act||act==="nan") continue;
    const lblL=lbl.toLowerCase();
    let bStyle=btns.length===0?"primary":"secondary";
    let bColor=btns.length===0?c.color:undefined;
    if(lblL.includes("✅")||lblL.includes("แก้ไขได้")||lblL.includes("run ต่อ")||lblL.includes("เรียบร้อย")){bColor="#2E7D32";bStyle="primary";}
    else if(lblL.includes("❌")||lblL.includes("ยังไม่ได้")||lblL.includes("ยัง alarm")){bColor="#C62828";bStyle="primary";}
    else if(lblL.includes("⬅")||lblL.includes("ย้อนกลับ")){continue;}// ลบปุ่มย้อนกลับออก
    else if(lblL.includes("hotline")||lblL.includes("สายด่วน")){bColor="#1B5E20";bStyle="primary";}
    else if(bStyle==="secondary" && !bColor){ bColor="#546E7A"; }
    btns.push({type:"button",action:act.startsWith("http")?{type:"uri",label:_san(lbl),uri:act}:{type:"message",label:_san(lbl),text:act},
      style:bStyle,color:bColor,height:"sm",adjustMode:"shrink-to-fit",margin:"xs"});
  }
  if (btns.length===0) {
    subRows.filter(r=>r.next_step_label).slice(0,4).forEach((r,i)=>{
      const _rawSfLbl=F(r.next_step_label||"");
    const _sfMap={
      "🔄 พักเครื่องไล่ฟองอากาศ":"🔄 พักเครื่องไล่ฟอง",
      "➡️ แจ้งแพทย์/เลือกแผนการรักษาต่อ":"➡️ แจ้งแพทย์เลือกแผน",
      "📌 ขั้นตอนการหล่อเส้น DLC":"📌 หล่อเส้น DLC",
      "🔄 พักเครื่องไล่ฟอง (Close Loop)":"🔄 พักเครื่องไล่ฟอง",
      "✅ ต้องการ RUN CRRT ต่อ":"✅ RUN CRRT ต่อ",
      "❌ ไม่ต้องการ RUN CRRT ต่อ":"❌ ไม่ RUN CRRT ต่อ",
    };
    const lbl=(_sfMap[_rawSfLbl]||_rawSfLbl).slice(0,20);
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

function subFlex(subRows, trigger) {if(!subRows||subRows.length===0){return{type:"flex",altText:"⚠️ กรุณากดใหม่",contents:{type:"bubble",body:{type:"box",layout:"vertical",paddingAll:"16px",contents:[{type:"text",text:"⚠️ ระบบกำลังโหลด กรุณากดใหม่ครับ",weight:"bold",size:"md",color:"#E65100",wrap:true}]},footer:{type:"box",layout:"vertical",paddingAll:"10px",contents:[{type:"button",action:{type:"message",label:"🏠 Main Menu",text:"main_menu"},style:"primary",color:"#1565C0",height:"sm",adjustMode:"shrink-to-fit"}]}}};}
  
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
  // ━━━ subFlex btns: กรอง + จัดกลุ่มสี + เรียงลำดับ ━━━
  const _rawBtns = subRows.filter(r=>{
    if(!r.next_step_label) return false;
    const ll=F(r.next_step_label||"").toLowerCase();
    if(ll.includes("⬅")||ll.includes("ย้อนกลับ")) return false; // ลบย้อนกลับ
    return true;
  }).map(r=>{
    const _rawSfLbl=F(r.next_step_label||"");
    const _sfMap={
      "🔄 พักเครื่องไล่ฟองอากาศ":"🔄 พักเครื่องไล่ฟอง",
      "➡️ แจ้งแพทย์/เลือกแผนการรักษาต่อ":"➡️ แจ้งแพทย์เลือกแผน",
      "📌 ขั้นตอนการหล่อเส้น DLC":"📌 หล่อเส้น DLC",
      "🔄 พักเครื่องไล่ฟอง (Close Loop)":"🔄 พักเครื่องไล่ฟอง",
      "✅ ต้องการ RUN CRRT ต่อ":"✅ RUN CRRT ต่อ",
      "❌ ไม่ต้องการ RUN CRRT ต่อ":"❌ ไม่ RUN CRRT ต่อ",
    };
    const lbl=(_sfMap[_rawSfLbl]||_rawSfLbl).slice(0,20);
    const ll2=lbl.toLowerCase();
    const act=r.next_step_action||"";
    let sc3,order;
    // สีเขียว (order 0): แก้ไขได้/ทำได้/ดำเนินการ
    if(ll2.includes("✅")||ll2.includes("แก้ไขได้")||ll2.includes("run")||
       ll2.includes("คืนเลือด")||ll2.includes("พักเครื่อง")||ll2.includes("หล่อเส้น")||
       ll2.includes("ดำเนินการ")||ll2.includes("สำเร็จ")||ll2.includes("เก็บเครื่อง")||
       ll2.includes("ต้องการต่อ")||ll2.includes("restart")||
       act==="how_to_closeloop"||act==="how_to_flush_dlc"||act==="show_cleanup"||
       act==="restart_crrt_flow"||act==="how_to_return"){
      sc3="#2E7D32"; order=0;
    }
    // สีแดง (order 1): แก้ไม่ได้/ไปต่อ/วิกฤต
    else if(ll2.includes("❌")||ll2.includes("ยังไม่")||ll2.includes("ยัง alarm")||
            ll2.includes("วิกฤต")||ll2.includes("ไม่ต้องการ")||ll2.includes("ไม่ต่อ")||
            ll2.includes("ไปต่อ")||act==="end_crrt_flow"){
      sc3="#C62828"; order=1;
    }
    // สีฟ้า (order 2): Hotline/ดูขั้นตอน/ข้อมูล
    else if(ll2.includes("hotline")||ll2.includes("สายด่วน")||ll2.includes("ดูขั้นตอน")||
            ll2.includes("ดู")||act==="show_hotline"||act.startsWith("crrt_")){
      sc3="#1565C0"; order=2;
    }
    // สีเหลือง (order 3): Main Menu
    else if(ll2.includes("main")||ll2.includes("หน้าแรก")||act==="main_menu"){
      sc3="#F9A825"; order=3;
    }
    // default ฟ้า
    else{ sc3="#0277BD"; order=2; }
    return {_order:order,type:"button",action:act.startsWith("http")?{type:"uri",label:_san(lbl),uri:act}:{type:"message",label:_san(lbl),text:act},
      style:"primary",color:sc3,height:"sm",adjustMode:"shrink-to-fit",margin:"xs"};
  });
  // เรียง: เขียว(0) → แดง(1) → ฟ้า(2) → เหลือง(3)
  _rawBtns.sort((a,b)=>a._order-b._order);
  _rawBtns.forEach(b=>delete b._order);
  const btns=_rawBtns.slice(0,5);
  if (!["main_menu","exit_crrt"].includes(trigger)&&!btns.some(b=>b.action?.text==="main_menu"))
    btns.push({type:"button",action:{type:"message",label:"🏠 Main Menu",text:"main_menu"},style:"primary",color:"#F9A825",height:"sm",adjustMode:"shrink-to-fit",margin:"xs"});
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
     {label:"🩸 Blood Leak",text:"blood_leak",color:"#C62828"},
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
     {label:"📡 Comm Loss",text:"comm_loss",color:"#37474F"},
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
     {label:"💧 Blood Recirc",text:"nss_recirculation",color:"#0277BD"},
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
        {type:"button",action:{type:"message",label:"🔵 Prime No Citrate",text:"show_non_citrate"},style:"primary",color:"#004D40",height:"sm",adjustMode:"shrink-to-fit",flex:1},
        {type:"button",action:{type:"message",label:"🟠 Prime Citrate",text:"show_with_citrate"},style:"primary",color:"#E65100",height:"sm",adjustMode:"shrink-to-fit",flex:1}
      ]},
      {type:"box",layout:"horizontal",spacing:"xs",margin:"xs",contents:[
        {type:"button",action:{type:"message",label:"🩸 คืนเลือด",text:"how_to_return"},style:"primary",color:"#AD1457",height:"sm",adjustMode:"shrink-to-fit",flex:1},
        {type:"button",action:{type:"uri",label:"📋 Check สถานะ",uri:"https://docs.google.com/spreadsheets/d/10vDmEV9SkaDtdsj4QV1j4vbQOqHc75InnSImHGSkM1Q/edit?usp=sharing"},style:"primary",color:"#5C6BC0",height:"sm",adjustMode:"shrink-to-fit",flex:1}
      ]},
      {type:"box",layout:"horizontal",spacing:"xs",margin:"xs",contents:[
        {type:"button",action:{type:"message",label:"💉 หล่อเส้น Citrate",text:"how_to_flush_dlc"},style:"primary",color:"#00695C",height:"sm",adjustMode:"shrink-to-fit",flex:1},
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
      hero:{type:"box",layout:"vertical",backgroundColor:"#1A237E",paddingAll:"0px",contents:[
        {type:"image",url:MACHINE_URL,size:"full",aspectMode:"fit",aspectRatio:"20:13"},
        {type:"box",layout:"horizontal",backgroundColor:"#1A237E",paddingAll:"10px",paddingTop:"8px",paddingBottom:"8px",contents:[
          {type:"image",url:LOGO_URL,size:"xxs",flex:0,aspectMode:"fit",aspectRatio:"124:100"},
          {type:"box",layout:"vertical",flex:1,margin:"sm",justifyContent:"center",contents:[
            {type:"text",text:"RA5IC · RAMATHIBODI",color:"#FFFFFF",size:"xs",weight:"bold"},
            {type:"text",text:"CRRT Alarm Bot",color:"#FFD700",size:"xxs"}
          ]}
        ]}
      ]},
      body:{type:"box",layout:"vertical",paddingAll:"16px",spacing:"sm",
        contents:[
          
          {type:"text",text:"👋 ขอบคุณที่ใช้งานระบบครับ",weight:"bold",size:"md",color:"#1A237E",align:"center",wrap:true},
          {type:"text",text:"✅ ออกจากระบบเรียบร้อยแล้ว",size:"sm",color:"#1B5E20",align:"center",margin:"xs"},
          {type:"separator",margin:"md",color:"#E0E0E0"},
          {type:"text",text:"หากต้องการใช้งานอีกครั้ง\nกด Rich Menu ด้านล่างได้เลยครับ 👇",size:"sm",color:"#555555",wrap:true,align:"center",margin:"sm"}
        ]},
      footer:{type:"box",layout:"vertical",paddingAll:"10px",
        contents:[
          
        ]}
    }});
    return;
  }
  if(text==="alarm_menu")  {activate(uid);  await client.replyMessage(replyToken,menuFlex(0));return;}
  if(text==="alarm_menu_2"){activate(uid);touch(uid);await client.replyMessage(replyToken,menuFlex(1));return;}
  if(text==="alarm_menu_3"){activate(uid);touch(uid);await client.replyMessage(replyToken,menuFlex(2));return;}

  // ━━━ auto-activate: KB + Nav triggers ━━━
  const _KBE=new Set(["crrt_mode_info","crrt_pressure_info","crrt_billing","crrt_supplies","crrt_wound","crrt_calc","crrt_knowledge","how_to_flush_dlc","show_cleanup","show_hotline","how_to_return","show_non_citrate","show_with_citrate","alarm_menu","alarm_menu_2","alarm_menu_3","main_menu"]);
  if(_KBE.has(text))activate(uid);

  // ── Early alarm trigger ──────────────────────────────────────────────────────
  if(!NAV.has(text)){
    const eDA=DB_MAIN.find(r=>T2T[r.alarm_title]===text);
    if(eDA){activate(uid);const et=T2T[eDA.alarm_title]||text;await client.replyMessage(replyToken,alarmFlex(eDA,getSub(et),et));return;}
    if(new Set(Object.values(T2T)).has(text)&&DB_MAIN.length===0){DB_LAST=0;await loadDB();const eDA2=DB_MAIN.find(r=>T2T[r.alarm_title]===text);if(eDA2){activate(uid);const et2=T2T[eDA2.alarm_title]||text;await client.replyMessage(replyToken,alarmFlex(eDA2,getSub(et2),et2));return;}}
  }

  if(!isActive(uid))return;
  touch(uid);

  // ── Knowledge sub-topics ─────────────────────────────────────────────────────
  if(text==="crrt_knowledge"){
    const kbBtns=[
      {label:"📋 CRRT Mode",action:"crrt_mode_info",color:"#0D47A1"},
      {label:"📊 ค่า Pressure",action:"crrt_pressure_info",color:"#880E4F"},
      {label:"💳 สิทธิ์การรักษา",action:"crrt_billing",color:"#1565C0"},
      {label:"📦 รหัสอุปกรณ์",action:"crrt_supplies",color:"#4527A0"},
      {label:"🩹 ทำแผล DLC",action:"crrt_wound",color:"#C62828"},
      {label:"🧮 คำนวณสารน้ำ",action:"crrt_calc",color:"#E65100"},
      {label:"💉 หล่อเส้น Citrate",action:"how_to_flush_dlc",color:"#00695C"},
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
    }});return;
  }

  if(text==="crrt_mode_info"){await client.replyMessage(replyToken,{type:"flex",altText:"📋 CRRT Mode",contents:{type:"bubble",hero:{type:"box",layout:"horizontal",backgroundColor:"#0D47A1",paddingAll:"14px",spacing:"sm",contents:[{type:"image",url:LOGO_URL,size:"xxs",flex:0,aspectMode:"fit",aspectRatio:"124:100"},{type:"box",layout:"vertical",flex:1,justifyContent:"center",contents:[{type:"text",text:"RA5IC · RAMATHIBODI",color:"#BBCFFF",size:"xxs"},{type:"text",text:"📋 CRRT Mode — 4 รูปแบบหลัก",color:"#FFFFFF",size:"sm",weight:"bold",wrap:true}]}]},body:{type:"box",layout:"vertical",paddingAll:"14px",backgroundColor:"#F0F6FF",spacing:"sm",contents:[{type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#E3F2FD",paddingAll:"10px",cornerRadius:"10px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"5px",backgroundColor:"#0D47A1",cornerRadius:"4px",contents:[]},{type:"box",layout:"vertical",flex:1,margin:"sm",contents:[{type:"text",text:"1️⃣ SCUF — Slow Continuous Ultrafiltration",weight:"bold",size:"sm",color:"#0D47A1",wrap:true}]}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#0D47A1",size:"sm",flex:0,gravity:"top"},{type:"text",text:"กลไก: กำจัดน้ำส่วนเกินเท่านั้น (Ultrafiltration) ไม่ฟอกของเสีย",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#0D47A1",size:"sm",flex:0,gravity:"top"},{type:"text",text:"ข้อบ่งชี้: Volume Overload โดยไม่มี Uremia รุนแรง",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#0D47A1",size:"sm",flex:0,gravity:"top"},{type:"text",text:"UF Rate: 2-8 ml/kg/hr | ไม่ต้องใช้ Dialysate หรือ Replacement Fluid",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"separator",margin:"md",color:"#E8ECF4"},{type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#E3F2FD",paddingAll:"10px",cornerRadius:"10px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"5px",backgroundColor:"#1565C0",cornerRadius:"4px",contents:[]},{type:"box",layout:"vertical",flex:1,margin:"sm",contents:[{type:"text",text:"2️⃣ CVVH — Continuous Veno-Venous Hemofiltration",weight:"bold",size:"sm",color:"#0D47A1",wrap:true}]}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#1565C0",size:"sm",flex:0,gravity:"top"},{type:"text",text:"กลไก: Convection — ดึงของเสียผ่านแรงดัน เลียนแบบไตจริง",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#1565C0",size:"sm",flex:0,gravity:"top"},{type:"text",text:"ข้อบ่งชี้: AKI ที่ต้องการกำจัดของเสียขนาดกลาง-ใหญ่ (Middle molecules)",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#1565C0",size:"sm",flex:0,gravity:"top"},{type:"text",text:"Replacement Fluid: Pre หรือ Post-dilution | Dose 20-35 ml/kg/hr",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"separator",margin:"md",color:"#E8ECF4"},{type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#E8F5E9",paddingAll:"10px",cornerRadius:"10px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"5px",backgroundColor:"#2E7D32",cornerRadius:"4px",contents:[]},{type:"box",layout:"vertical",flex:1,margin:"sm",contents:[{type:"text",text:"3️⃣ CVVHD — Continuous Veno-Venous Hemodialysis",weight:"bold",size:"sm",color:"#1B5E20",wrap:true}]}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#2E7D32",size:"sm",flex:0,gravity:"top"},{type:"text",text:"กลไก: Diffusion — ของเสียแพร่ผ่านเมมเบรนเข้าน้ำยา Dialysate",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#2E7D32",size:"sm",flex:0,gravity:"top"},{type:"text",text:"ข้อบ่งชี้: AKI กำจัดของเสียขนาดเล็ก (Urea, Creatinine, K+)",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#2E7D32",size:"sm",flex:0,gravity:"top"},{type:"text",text:"Dialysate ไหลสวนทางกับเลือด (Counter-current) | ไม่ต้อง Replacement Fluid",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"separator",margin:"md",color:"#E8ECF4"},{type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#FFF3E0",paddingAll:"10px",cornerRadius:"10px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"5px",backgroundColor:"#E65100",cornerRadius:"4px",contents:[]},{type:"box",layout:"vertical",flex:1,margin:"sm",contents:[{type:"text",text:"4️⃣ CVVHDF — Continuous Veno-Venous Hemodiafiltration",weight:"bold",size:"sm",color:"#BF360C",wrap:true}]}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#E65100",size:"sm",flex:0,gravity:"top"},{type:"text",text:"กลไก: Diffusion + Convection — กำจัดของเสียได้ทุกขนาด",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#E65100",size:"sm",flex:0,gravity:"top"},{type:"text",text:"ข้อบ่งชี้: AKI รุนแรง | Sepsis/Cytokines ✅ ใช้บ่อยที่สุดใน ICU",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#E65100",size:"sm",flex:0,gravity:"top"},{type:"text",text:"ต้องการทั้ง Dialysate + Replacement Fluid | Dose 25-35 ml/kg/hr",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"separator",margin:"md",color:"#E8ECF4"},{type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#FFEBEE",paddingAll:"10px",cornerRadius:"10px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"5px",backgroundColor:"#C62828",cornerRadius:"4px",contents:[]},{type:"box",layout:"vertical",flex:1,margin:"sm",contents:[{type:"text",text:"⚠️ Quality Benchmark",weight:"bold",size:"sm",color:"#B71C1C",wrap:true}]}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#C62828",size:"sm",flex:0,gravity:"top"},{type:"text",text:"Filter life > 60 ชม. ≥ 60% | Delivered ≥ 80% Prescribed",size:"sm",color:"#B71C1C",weight:"bold",wrap:true,flex:1}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#C62828",size:"sm",flex:0,gravity:"top"},{type:"text",text:"Monitor K, Na, Ca, Mg, PO4 ทุก 6-8 ชม. | CLABSI = 0 events",size:"sm",color:"#B71C1C",weight:"bold",wrap:true,flex:1}]}]},footer:{type:"box",layout:"vertical",paddingAll:"10px",spacing:"xs",backgroundColor:"#F8F9FC",contents:[{type:"button",action:{type:"message",label:"📚 กลับ Knowledge",text:"crrt_knowledge"},style:"primary",color:"#1565C0",height:"sm",adjustMode:"shrink-to-fit"},{type:"button",action:{type:"message",label:"🏠 Main Menu",text:"main_menu"},style:"secondary",height:"sm",adjustMode:"shrink-to-fit",margin:"xs"}]}}});return;}

  if(text==="crrt_pressure_info"){await client.replyMessage(replyToken,{type:"flex",altText:"📊 ค่า Pressure CRRT",contents:{type:"bubble",hero:{type:"box",layout:"horizontal",backgroundColor:"#880E4F",paddingAll:"14px",spacing:"sm",contents:[{type:"image",url:LOGO_URL,size:"xxs",flex:0,aspectMode:"fit",aspectRatio:"124:100"},{type:"box",layout:"vertical",flex:1,justifyContent:"center",contents:[{type:"text",text:"RA5IC · RAMATHIBODI",color:"#BBCFFF",size:"xxs"},{type:"text",text:"📊 ค่า Pressure CRRT — ตัวชี้วัดสำคัญ",color:"#FFFFFF",size:"sm",weight:"bold",wrap:true}]}]},body:{type:"box",layout:"vertical",paddingAll:"14px",backgroundColor:"#FFF5FA",spacing:"sm",contents:[{type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#FCE4EC",paddingAll:"10px",cornerRadius:"10px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"5px",backgroundColor:"#880E4F",cornerRadius:"4px",contents:[]},{type:"box",layout:"vertical",flex:1,margin:"sm",contents:[{type:"text",text:"🔴 Access Pressure (AP) — สายแดง",weight:"bold",size:"sm",color:"#880E4F",wrap:true}]}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#880E4F",size:"sm",flex:0,gravity:"top"},{type:"text",text:"ค่าปกติ: -100 ถึง -250 mmHg (ลบ = ปกติ)",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#880E4F",size:"sm",flex:0,gravity:"top"},{type:"text",text:"ลบมากเกิน (<-250): สาย Access ตัน/พับ หรือ BFR สูงเกิน → Alarm Access Neg",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#880E4F",size:"sm",flex:0,gravity:"top"},{type:"text",text:"บวก (>0): ผิดปกติ — อาจต่อร่วม ECMO Post-pump → Alarm Access Pos",size:"sm",color:"#B71C1C",weight:"bold",wrap:true,flex:1}]},{type:"separator",margin:"md",color:"#E8ECF4"},{type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#E3F2FD",paddingAll:"10px",cornerRadius:"10px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"5px",backgroundColor:"#1565C0",cornerRadius:"4px",contents:[]},{type:"box",layout:"vertical",flex:1,margin:"sm",contents:[{type:"text",text:"🔵 Return Pressure (RP) — สายน้ำเงิน",weight:"bold",size:"sm",color:"#0D47A1",wrap:true}]}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#1565C0",size:"sm",flex:0,gravity:"top"},{type:"text",text:"ค่าปกติ: 0 ถึง +250 mmHg (ค่าบวก = ปกติ)",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#1565C0",size:"sm",flex:0,gravity:"top"},{type:"text",text:"สูงเกิน (>300): สาย Return ตัน/พับ หรือ Clot ใน Chamber → Alarm Return Pos",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"separator",margin:"md",color:"#E8ECF4"},{type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#FFF3E0",paddingAll:"10px",cornerRadius:"10px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"5px",backgroundColor:"#E65100",cornerRadius:"4px",contents:[]},{type:"box",layout:"vertical",flex:1,margin:"sm",contents:[{type:"text",text:"🟡 TMP (Trans Membrane Pressure) — คร่อมตัวกรอง",weight:"bold",size:"sm",color:"#BF360C",wrap:true}]}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#E65100",size:"sm",flex:0,gravity:"top"},{type:"text",text:"ค่าปกติ: 50-200 mmHg",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#E65100",size:"sm",flex:0,gravity:"top"},{type:"text",text:"สูงเกิน (>250-300): Filter เริ่มอุดตัน → Flush NSS และ/หรือเปลี่ยน Filter",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#E65100",size:"sm",flex:0,gravity:"top"},{type:"text",text:"สูงเกิน 400: Filter ใกล้ตัน ห้ามฝืน → คืนเลือดทันที",size:"sm",color:"#B71C1C",weight:"bold",wrap:true,flex:1}]},{type:"separator",margin:"md",color:"#E8ECF4"},{type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#E8F5E9",paddingAll:"10px",cornerRadius:"10px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"5px",backgroundColor:"#2E7D32",cornerRadius:"4px",contents:[]},{type:"box",layout:"vertical",flex:1,margin:"sm",contents:[{type:"text",text:"🟠 Filter Pressure Drop (FP)",weight:"bold",size:"sm",color:"#1B5E20",wrap:true}]}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#2E7D32",size:"sm",flex:0,gravity:"top"},{type:"text",text:"สูตร: FP = AP - Pre-Filter Pressure | ค่าปกติ: 50-150 mmHg",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#2E7D32",size:"sm",flex:0,gravity:"top"},{type:"text",text:"สูงขึ้นเรื่อยๆ → Clot สะสมในตัวกรอง → เพิ่ม Anticoagulation หรือเปลี่ยน Filter",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"separator",margin:"md",color:"#E8ECF4"},{type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#FFEBEE",paddingAll:"10px",cornerRadius:"10px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"5px",backgroundColor:"#C62828",cornerRadius:"4px",contents:[]},{type:"box",layout:"vertical",flex:1,margin:"sm",contents:[{type:"text",text:"⚠️ ต้องคืนเลือดเมื่อ",weight:"bold",size:"sm",color:"#B71C1C",wrap:true}]}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#C62828",size:"sm",flex:0,gravity:"top"},{type:"text",text:"TMP > 400 mmHg | Filter ดำสนิท | Clot เห็นชัดใน Chamber",size:"sm",color:"#B71C1C",weight:"bold",wrap:true,flex:1}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#C62828",size:"sm",flex:0,gravity:"top"},{type:"text",text:"แจ้งแพทย์ก่อนคืนเลือดทุกครั้ง",size:"sm",color:"#B71C1C",weight:"bold",wrap:true,flex:1}]}]},footer:{type:"box",layout:"vertical",paddingAll:"10px",spacing:"xs",backgroundColor:"#F8F9FC",contents:[{type:"button",action:{type:"message",label:"📚 กลับ Knowledge",text:"crrt_knowledge"},style:"primary",color:"#1565C0",height:"sm",adjustMode:"shrink-to-fit"},{type:"button",action:{type:"message",label:"🏠 Main Menu",text:"main_menu"},style:"secondary",height:"sm",adjustMode:"shrink-to-fit",margin:"xs"}]}}});return;}

  if(text==="crrt_billing"){await client.replyMessage(replyToken,{type:"flex",altText:"💳 สิทธิ์การรักษา CRRT",contents:{type:"bubble",hero:{type:"box",layout:"horizontal",backgroundColor:"#1565C0",paddingAll:"14px",spacing:"sm",contents:[{type:"image",url:LOGO_URL,size:"xxs",flex:0,aspectMode:"fit",aspectRatio:"124:100"},{type:"box",layout:"vertical",flex:1,justifyContent:"center",contents:[{type:"text",text:"RA5IC · RAMATHIBODI",color:"#BBCFFF",size:"xxs"},{type:"text",text:"💳 การเบิกจ่าย CRRT (มีนาคม 2567)",color:"#FFFFFF",size:"sm",weight:"bold",wrap:true}]}]},body:{type:"box",layout:"vertical",paddingAll:"14px",backgroundColor:"#F0F4FF",spacing:"sm",contents:[{type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#FFEBEE",paddingAll:"10px",cornerRadius:"10px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"5px",backgroundColor:"#C62828",cornerRadius:"4px",contents:[]},{type:"box",layout:"vertical",flex:1,margin:"sm",contents:[{type:"text",text:"⚠️ อนุมัติเฉพาะ AKI เท่านั้น",weight:"bold",size:"sm",color:"#B71C1C",wrap:true}]}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#C62828",size:"sm",flex:0,gravity:"top"},{type:"text",text:"อนุมัติเบิกจ่ายเฉพาะกรณี AKI (Acute Kidney Injury) เท่านั้น",size:"sm",color:"#B71C1C",weight:"bold",wrap:true,flex:1}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#C62828",size:"sm",flex:0,gravity:"top"},{type:"text",text:"Oxiris Set: เบิกไม่ได้ | RCA: รวมอยู่ใน CRRT แล้ว",size:"sm",color:"#B71C1C",weight:"bold",wrap:true,flex:1}]},{type:"separator",margin:"md",color:"#E8ECF4"},{type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#E3F2FD",paddingAll:"10px",cornerRadius:"10px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"5px",backgroundColor:"#1565C0",cornerRadius:"4px",contents:[]},{type:"box",layout:"vertical",flex:1,margin:"sm",contents:[{type:"text",text:"🏛️ กรมบัญชีกลาง (ข้าราชการ)",weight:"bold",size:"sm",color:"#0D47A1",wrap:true}]}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#1565C0",size:"sm",flex:0,gravity:"top"},{type:"text",text:"วันแรก: เบิกตามจริงได้ ไม่เกิน 15,000 บาท",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#1565C0",size:"sm",flex:0,gravity:"top"},{type:"text",text:"วันถัดไป: เบิกตามจริง ไม่เกิน 10,000 บาท/วัน ไม่เกิน 4 วัน",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"separator",margin:"md",color:"#E8ECF4"},{type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#EDE7F6",paddingAll:"10px",cornerRadius:"10px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"5px",backgroundColor:"#5E35B1",cornerRadius:"4px",contents:[]},{type:"box",layout:"vertical",flex:1,margin:"sm",contents:[{type:"text",text:"🏢 ประกันสังคม",weight:"bold",size:"sm",color:"#4527A0",wrap:true}]}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#5E35B1",size:"sm",flex:0,gravity:"top"},{type:"text",text:"วันแรก: เบิกตามจริง ไม่เกิน 15,000 บาท",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#5E35B1",size:"sm",flex:0,gravity:"top"},{type:"text",text:"วันถัดไป: ไม่เกิน 10,000 บาท/วัน (ไม่จำกัดจำนวนวัน)",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"separator",margin:"md",color:"#E8ECF4"},{type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#E8F5E9",paddingAll:"10px",cornerRadius:"10px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"5px",backgroundColor:"#2E7D32",cornerRadius:"4px",contents:[]},{type:"box",layout:"vertical",flex:1,margin:"sm",contents:[{type:"text",text:"🃏 สปสช. (บัตรทอง / 30 บาท)",weight:"bold",size:"sm",color:"#1B5E20",wrap:true}]}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#2E7D32",size:"sm",flex:0,gravity:"top"},{type:"text",text:"วันแรก: เบิกตามจริง ไม่เกิน 15,000 บาท",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#2E7D32",size:"sm",flex:0,gravity:"top"},{type:"text",text:"วันถัดไป: ไม่เกิน 10,000 บาท/วัน (ไม่จำกัดจำนวนวัน)",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"separator",margin:"md",color:"#E8ECF4"},{type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#FFF3E0",paddingAll:"10px",cornerRadius:"10px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"5px",backgroundColor:"#E65100",cornerRadius:"4px",contents:[]},{type:"box",layout:"vertical",flex:1,margin:"sm",contents:[{type:"text",text:"💰 ค่าใช้จ่ายอ้างอิง (Prismaflex ต่อวัน)",weight:"bold",size:"sm",color:"#BF360C",wrap:true}]}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#E65100",size:"sm",flex:0,gravity:"top"},{type:"text",text:"MKC6 ค่าบริการ = 8,000 บาท",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#E65100",size:"sm",flex:0,gravity:"top"},{type:"text",text:"Filter + Circuit = 6,000 บาท",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#E65100",size:"sm",flex:0,gravity:"top"},{type:"text",text:"Replacement Fluid = 10,000 บาท",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#E65100",size:"sm",flex:0,gravity:"top"},{type:"text",text:"Drain bag = 250 บาท | รวมประมาณ 25,000 บาท/วัน",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]}]},footer:{type:"box",layout:"vertical",paddingAll:"10px",spacing:"xs",backgroundColor:"#F8F9FC",contents:[{type:"button",action:{type:"message",label:"📚 กลับ Knowledge",text:"crrt_knowledge"},style:"primary",color:"#1565C0",height:"sm",adjustMode:"shrink-to-fit"},{type:"button",action:{type:"message",label:"🏠 Main Menu",text:"main_menu"},style:"secondary",height:"sm",adjustMode:"shrink-to-fit",margin:"xs"}]}}});return;}

  if(text==="crrt_supplies"){await client.replyMessage(replyToken,{type:"flex",altText:"📦 รหัสอุปกรณ์ CRRT",contents:{type:"bubble",hero:{type:"box",layout:"horizontal",backgroundColor:"#4527A0",paddingAll:"14px",spacing:"sm",contents:[{type:"image",url:LOGO_URL,size:"xxs",flex:0,aspectMode:"fit",aspectRatio:"124:100"},{type:"box",layout:"vertical",flex:1,justifyContent:"center",contents:[{type:"text",text:"RA5IC · RAMATHIBODI",color:"#BBCFFF",size:"xxs"},{type:"text",text:"📦 รหัสอุปกรณ์ CRRT — ราคาจริง",color:"#FFFFFF",size:"sm",weight:"bold",wrap:true}]}]},body:{type:"box",layout:"vertical",paddingAll:"14px",backgroundColor:"#F5F0FF",spacing:"sm",contents:[{type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#EDE7F6",paddingAll:"10px",cornerRadius:"10px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"5px",backgroundColor:"#4527A0",cornerRadius:"4px",contents:[]},{type:"box",layout:"vertical",flex:1,margin:"sm",contents:[{type:"text",text:"🖥️ เครื่อง CRRT ที่ใช้ในรามาธิบดี",weight:"bold",size:"sm",color:"#4A148C",wrap:true}]}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#4527A0",size:"sm",flex:0,gravity:"top"},{type:"text",text:"Prismaflex (Baxter): รองรับ CVVH, CVVHD, CVVHDF, TPE, ECMO",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#4527A0",size:"sm",flex:0,gravity:"top"},{type:"text",text:"Infomed HF 440: รองรับ SCUF, CVVH, CVVHD, CVVHDF, ECMO",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#4527A0",size:"sm",flex:0,gravity:"top"},{type:"text",text:"Aquarius: รองรับ SCUF, CVVH, CVVHD, CVVHDF, TPE, DFPP",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"separator",margin:"md",color:"#E8ECF4"},{type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#E3F2FD",paddingAll:"10px",cornerRadius:"10px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"5px",backgroundColor:"#1565C0",cornerRadius:"4px",contents:[]},{type:"box",layout:"vertical",flex:1,margin:"sm",contents:[{type:"text",text:"🔩 Filter & Circuit — Prismaflex",weight:"bold",size:"sm",color:"#0D47A1",wrap:true}]}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#1565C0",size:"sm",flex:0,gravity:"top"},{type:"text",text:"M100 รหัส 30056375 ราคา 5,750 บาท ✅ ผู้ใหญ่ทั่วไป",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#1565C0",size:"sm",flex:0,gravity:"top"},{type:"text",text:"M150 รหัส 30072047 ราคา 5,750 บาท (ผู้ใหญ่ ECMO)",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#1565C0",size:"sm",flex:0,gravity:"top"},{type:"text",text:"HF20 รหัส 30072216 (Pediatric)",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#1565C0",size:"sm",flex:0,gravity:"top"},{type:"text",text:"Oxiris รหัส 30055135 ราคา 16,500 บาท (Cytokine adsorption) ⚠️ เบิกไม่ได้",size:"sm",color:"#B71C1C",weight:"bold",wrap:true,flex:1}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#1565C0",size:"sm",flex:0,gravity:"top"},{type:"text",text:"Effluent bag รหัส 30072217 ราคา 121 บาท",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"separator",margin:"md",color:"#E8ECF4"},{type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#FFF3E0",paddingAll:"10px",cornerRadius:"10px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"5px",backgroundColor:"#E65100",cornerRadius:"4px",contents:[]},{type:"box",layout:"vertical",flex:1,margin:"sm",contents:[{type:"text",text:"🔩 Filter & Circuit — HF440/Aquarius",weight:"bold",size:"sm",color:"#BF360C",wrap:true}]}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#E65100",size:"sm",flex:0,gravity:"top"},{type:"text",text:"Pecopen 1.4 sqm รหัส 30061353 ราคา 2,484 บาท (ผู้ใหญ่ทั่วไป)",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#E65100",size:"sm",flex:0,gravity:"top"},{type:"text",text:"Pecopen 1.9 sqm รหัส 30061354 ราคา 2,484 บาท (ECMO)",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#E65100",size:"sm",flex:0,gravity:"top"},{type:"text",text:"Adult CRRT circuit (Infomed) รหัส 30047408 ราคา 3,220 บาท",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#E65100",size:"sm",flex:0,gravity:"top"},{type:"text",text:"Aquamax HF12 รหัส 30007360 ราคา 2,558 บาท | Aqualine รหัส 30000080 ราคา 3,449 บาท",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"separator",margin:"md",color:"#E8ECF4"},{type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#E8F5E9",paddingAll:"10px",cornerRadius:"10px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"5px",backgroundColor:"#2E7D32",cornerRadius:"4px",contents:[]},{type:"box",layout:"vertical",flex:1,margin:"sm",contents:[{type:"text",text:"💧 Replacement Fluid ที่ใช้บ่อย",weight:"bold",size:"sm",color:"#1B5E20",wrap:true}]}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#2E7D32",size:"sm",flex:0,gravity:"top"},{type:"text",text:"Accusol K+0 รหัส 30060934 ราคา 872 บาท ✅ มาตรฐาน",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#2E7D32",size:"sm",flex:0,gravity:"top"},{type:"text",text:"Prismocal B22 รหัส 30072138 ราคา 1,161 บาท (Dialysate/Post dilution)",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#2E7D32",size:"sm",flex:0,gravity:"top"},{type:"text",text:"Prismasol B0 ราคา 880 บาท (มาตรฐาน)",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#2E7D32",size:"sm",flex:0,gravity:"top"},{type:"text",text:"Prismocitrate 18/0 รหัส 30049087 ราคา 1,381 บาท ✅ Regional Citrate",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#2E7D32",size:"sm",flex:0,gravity:"top"},{type:"text",text:"4% Trisodium citrate 500ml รหัส 30072725 ราคา 264 บาท (Predilution)",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]}]},footer:{type:"box",layout:"vertical",paddingAll:"10px",spacing:"xs",backgroundColor:"#F8F9FC",contents:[{type:"button",action:{type:"message",label:"📚 กลับ Knowledge",text:"crrt_knowledge"},style:"primary",color:"#1565C0",height:"sm",adjustMode:"shrink-to-fit"},{type:"button",action:{type:"message",label:"🏠 Main Menu",text:"main_menu"},style:"secondary",height:"sm",adjustMode:"shrink-to-fit",margin:"xs"}]}}});return;}

  if(text==="crrt_wound"){await client.replyMessage(replyToken,{type:"flex",altText:"🩹 การทำแผล DLC",contents:{type:"bubble",hero:{type:"box",layout:"horizontal",backgroundColor:"#C62828",paddingAll:"14px",spacing:"sm",contents:[{type:"image",url:LOGO_URL,size:"xxs",flex:0,aspectMode:"fit",aspectRatio:"124:100"},{type:"box",layout:"vertical",flex:1,justifyContent:"center",contents:[{type:"text",text:"RA5IC · RAMATHIBODI",color:"#BBCFFF",size:"xxs"},{type:"text",text:"🩹 การทำแผล DLC — Nursing Manual",color:"#FFFFFF",size:"sm",weight:"bold",wrap:true}]}]},body:{type:"box",layout:"vertical",paddingAll:"14px",backgroundColor:"#FFF0F0",spacing:"sm",contents:[{type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#FFEBEE",paddingAll:"10px",cornerRadius:"10px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"5px",backgroundColor:"#C62828",cornerRadius:"4px",contents:[]},{type:"box",layout:"vertical",flex:1,margin:"sm",contents:[{type:"text",text:"🎯 เป้าหมาย: ป้องกัน CLABSI",weight:"bold",size:"sm",color:"#B71C1C",wrap:true}]}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#C62828",size:"sm",flex:0,gravity:"top"},{type:"text",text:"ความถี่ Gauze dressing: เปลี่ยนทุกครั้งที่ทำ HD/CRRT หรือเปียก/ชื้น/แฉะ",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#C62828",size:"sm",flex:0,gravity:"top"},{type:"text",text:"ความถี่ Transparent (Tegaderm): เปลี่ยนทุก 7 วัน หรือหลุด/เปียก/ขอบยก",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"separator",margin:"md",color:"#E8ECF4"},{type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#FFF3E0",paddingAll:"10px",cornerRadius:"10px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"5px",backgroundColor:"#E65100",cornerRadius:"4px",contents:[]},{type:"box",layout:"vertical",flex:1,margin:"sm",contents:[{type:"text",text:"🧰 อุปกรณ์ที่ต้องเตรียม",weight:"bold",size:"sm",color:"#BF360C",wrap:true}]}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#E65100",size:"sm",flex:0,gravity:"top"},{type:"text",text:"Set wet dressing 1 set | Syringe 5ml×2 + 10ml×2",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#E65100",size:"sm",flex:0,gravity:"top"},{type:"text",text:"Sterile gauze 2x2นิ้ว 5ชิ้น + 3x3นิ้ว 5ชิ้น",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#E65100",size:"sm",flex:0,gravity:"top"},{type:"text",text:"2% Chlorhexidine in 70% Alcohol | Sterile gloves + Disposable gloves",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#E65100",size:"sm",flex:0,gravity:"top"},{type:"text",text:"Mask + หมวกคลุมผม | Fixomull 10x10cm | Transparent dressing",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"separator",margin:"md",color:"#E8ECF4"},{type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#E3F2FD",paddingAll:"10px",cornerRadius:"10px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"5px",backgroundColor:"#1565C0",cornerRadius:"4px",contents:[]},{type:"box",layout:"vertical",flex:1,margin:"sm",contents:[{type:"text",text:"🚀 ขั้นตอน Pre-HD/CRRT (ก่อนเริ่มเครื่อง)",weight:"bold",size:"sm",color:"#0D47A1",wrap:true}]}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#1565C0",size:"sm",flex:0,gravity:"top"},{type:"text",text:"1️⃣ ประเมินผ้าปิดแผล: เปียก ชื้น แฉะ หลุด หรือไม่",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#1565C0",size:"sm",flex:0,gravity:"top"},{type:"text",text:"2️⃣ เปิดผ้าปิดแผลเก่าออกอย่างนุ่มนวล",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#1565C0",size:"sm",flex:0,gravity:"top"},{type:"text",text:"3️⃣ ประเมิน Exit Site: บวม แดง มี Discharge หรือไม่",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#1565C0",size:"sm",flex:0,gravity:"top"},{type:"text",text:"4️⃣ เปิด Set Dressing ใช้ 2% CHG ทำความสะอาดผิวหนังรอบ Catheter",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#1565C0",size:"sm",flex:0,gravity:"top"},{type:"text",text:"5️⃣ ปิดผ้าปิดแผล Exit Site ส่วนต้น | ปูผ้า Sterile ทำความสะอาดสาย DLC ส่วนปลาย",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#1565C0",size:"sm",flex:0,gravity:"top"},{type:"text",text:"6️⃣ เปิด Cap → Scrub the Hub > 5 วินาที ด้วย 2% CHG",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#1565C0",size:"sm",flex:0,gravity:"top"},{type:"text",text:"7️⃣ Draw Heparinized saline ออก ~2 เท่าของ Prime Volume → Test Flow",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"separator",margin:"md",color:"#E8ECF4"},{type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#EDE7F6",paddingAll:"10px",cornerRadius:"10px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"5px",backgroundColor:"#4527A0",cornerRadius:"4px",contents:[]},{type:"box",layout:"vertical",flex:1,margin:"sm",contents:[{type:"text",text:"🔒 ขั้นตอน Post-HD/CRRT (Lock Catheter)",weight:"bold",size:"sm",color:"#4A148C",wrap:true}]}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#4527A0",size:"sm",flex:0,gravity:"top"},{type:"text",text:"1️⃣ ปลด Blood line CRRT → สวม Sterile Gloves",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#4527A0",size:"sm",flex:0,gravity:"top"},{type:"text",text:"2️⃣ เตรียม Heparinized saline 2,500 unit/ml + NSS 10ml ×2",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#4527A0",size:"sm",flex:0,gravity:"top"},{type:"text",text:"3️⃣ Flush NSS 10ml/ข้าง ด้วย Push-pause technique",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#4527A0",size:"sm",flex:0,gravity:"top"},{type:"text",text:"4️⃣ Lock Heparin 2,500 unit/ml ปริมาณ = Prime volume ด้วย Positive pressure technique",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#4527A0",size:"sm",flex:0,gravity:"top"},{type:"text",text:"5️⃣ Scrub the Hub > 5 วินาที → ปิด Cap ใหม่",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#4527A0",size:"sm",flex:0,gravity:"top"},{type:"text",text:"6️⃣ ห่อสาย DLC ด้วย Gauze → ปิดด้วย Fixomull ให้แน่น",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#4527A0",size:"sm",flex:0,gravity:"top"},{type:"text",text:"⚠️ งด Lock heparin ถ้ามี Plan Off Catheter",size:"sm",color:"#B71C1C",weight:"bold",wrap:true,flex:1}]}]},footer:{type:"box",layout:"vertical",paddingAll:"10px",spacing:"xs",backgroundColor:"#F8F9FC",contents:[{type:"button",action:{type:"message",label:"📚 กลับ Knowledge",text:"crrt_knowledge"},style:"primary",color:"#1565C0",height:"sm",adjustMode:"shrink-to-fit"},{type:"button",action:{type:"message",label:"🏠 Main Menu",text:"main_menu"},style:"secondary",height:"sm",adjustMode:"shrink-to-fit",margin:"xs"}]}}});return;}

  if(text==="crrt_calc"){await client.replyMessage(replyToken,{type:"flex",altText:"🧮 คำนวณสารน้ำ CRRT",contents:{type:"bubble",hero:{type:"box",layout:"horizontal",backgroundColor:"#E65100",paddingAll:"14px",spacing:"sm",contents:[{type:"image",url:LOGO_URL,size:"xxs",flex:0,aspectMode:"fit",aspectRatio:"124:100"},{type:"box",layout:"vertical",flex:1,justifyContent:"center",contents:[{type:"text",text:"RA5IC · RAMATHIBODI",color:"#BBCFFF",size:"xxs"},{type:"text",text:"🧮 คำนวณสารน้ำ CRRT — สูตรหลัก KDIGO",color:"#FFFFFF",size:"sm",weight:"bold",wrap:true}]}]},body:{type:"box",layout:"vertical",paddingAll:"14px",backgroundColor:"#FFF8F2",spacing:"sm",contents:[{type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#FFF3E0",paddingAll:"10px",cornerRadius:"10px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"5px",backgroundColor:"#E65100",cornerRadius:"4px",contents:[]},{type:"box",layout:"vertical",flex:1,margin:"sm",contents:[{type:"text",text:"🎯 สูตรหลัก CRRT Dose (KDIGO 2012)",weight:"bold",size:"sm",color:"#BF360C",wrap:true}]}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#E65100",size:"sm",flex:0,gravity:"top"},{type:"text",text:"Prescribed Dose = 20-25 ml/kg/hr (Actual BW หรือ Ideal BW ตามแพทย์)",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#E65100",size:"sm",flex:0,gravity:"top"},{type:"text",text:"Delivered Dose = Prescribed × 0.85-0.90 (คิด Downtime)",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#E65100",size:"sm",flex:0,gravity:"top"},{type:"text",text:"ตัวอย่าง: BW 60 kg → Dose = 60×25 = 1,500 ml/hr = UF Rate ที่ตั้งในเครื่อง",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"separator",margin:"md",color:"#E8ECF4"},{type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#E3F2FD",paddingAll:"10px",cornerRadius:"10px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"5px",backgroundColor:"#1565C0",cornerRadius:"4px",contents:[]},{type:"box",layout:"vertical",flex:1,margin:"sm",contents:[{type:"text",text:"💧 Fluid Balance คิด In/Out ต่อชั่วโมง",weight:"bold",size:"sm",color:"#0D47A1",wrap:true}]}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#1565C0",size:"sm",flex:0,gravity:"top"},{type:"text",text:"IN: IV Fluid + IV Drug + TPN/Enteral",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#1565C0",size:"sm",flex:0,gravity:"top"},{type:"text",text:"OUT: Urine + Drain (NGT/Chest drain) + Effluent จากเครื่อง CRRT",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#1565C0",size:"sm",flex:0,gravity:"top"},{type:"text",text:"Net Balance (ml/hr) = Total IN - Total OUT",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#1565C0",size:"sm",flex:0,gravity:"top"},{type:"text",text:"Patient Fluid Removal = Net UF ที่ต้องการดึงออก/ชั่วโมง",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"separator",margin:"md",color:"#E8ECF4"},{type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#E8F5E9",paddingAll:"10px",cornerRadius:"10px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"5px",backgroundColor:"#2E7D32",cornerRadius:"4px",contents:[]},{type:"box",layout:"vertical",flex:1,margin:"sm",contents:[{type:"text",text:"📊 ตัวอย่าง CVVHDF น้ำหนัก 70 kg",weight:"bold",size:"sm",color:"#1B5E20",wrap:true}]}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#2E7D32",size:"sm",flex:0,gravity:"top"},{type:"text",text:"Total Effluent: 70×25 = 1,750 ml/hr",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#2E7D32",size:"sm",flex:0,gravity:"top"},{type:"text",text:"Dialysate 875 ml/hr + Replacement (Pre/Post) 875 ml/hr",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#2E7D32",size:"sm",flex:0,gravity:"top"},{type:"text",text:"ดึงน้ำ 100 ml/hr → ตั้ง Patient Fluid Removal 100 ml/hr",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#2E7D32",size:"sm",flex:0,gravity:"top"},{type:"text",text:"Heparin เริ่ม 500-1,000 IU/hr ปรับตาม APTT 60-80 วินาที",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"separator",margin:"md",color:"#E8ECF4"},{type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#EDE7F6",paddingAll:"10px",cornerRadius:"10px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"5px",backgroundColor:"#4527A0",cornerRadius:"4px",contents:[]},{type:"box",layout:"vertical",flex:1,margin:"sm",contents:[{type:"text",text:"⚙️ การตั้งค่าเครื่อง (Prismaflex/HF440)",weight:"bold",size:"sm",color:"#4A148C",wrap:true}]}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#4527A0",size:"sm",flex:0,gravity:"top"},{type:"text",text:"BFR 100-150 ml/min | UF Rate | Dose 30 ml/kg/h",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#4527A0",size:"sm",flex:0,gravity:"top"},{type:"text",text:"Anticoagulant ตาม Order แพทย์",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#4527A0",size:"sm",flex:0,gravity:"top"},{type:"text",text:"NSS Flush 200 ml ทุก 8 ชั่วโมง เพื่อป้องกัน Filter อุดตัน",size:"sm",color:"#2D2D2D",weight:"regular",wrap:true,flex:1}]},{type:"separator",margin:"md",color:"#E8ECF4"},{type:"box",layout:"horizontal",margin:"sm",backgroundColor:"#FFEBEE",paddingAll:"10px",cornerRadius:"10px",spacing:"sm",contents:[{type:"box",layout:"vertical",width:"5px",backgroundColor:"#C62828",cornerRadius:"4px",contents:[]},{type:"box",layout:"vertical",flex:1,margin:"sm",contents:[{type:"text",text:"⚠️ ข้อควรระวัง",weight:"bold",size:"sm",color:"#B71C1C",wrap:true}]}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#C62828",size:"sm",flex:0,gravity:"top"},{type:"text",text:"ปรึกษาแพทย์ก่อนปรับ Dose ทุกครั้ง",size:"sm",color:"#B71C1C",weight:"bold",wrap:true,flex:1}]},{type:"box",layout:"horizontal",margin:"xs",spacing:"sm",paddingStart:"12px",contents:[{type:"text",text:"·",color:"#C62828",size:"sm",flex:0,gravity:"top"},{type:"text",text:"Monitor Electrolytes (K,Na,Ca,Mg,PO4) ทุก 6-8 ชม.",size:"sm",color:"#B71C1C",weight:"bold",wrap:true,flex:1}]}]},footer:{type:"box",layout:"vertical",paddingAll:"10px",spacing:"xs",backgroundColor:"#F8F9FC",contents:[{type:"button",action:{type:"message",label:"📚 กลับ Knowledge",text:"crrt_knowledge"},style:"primary",color:"#1565C0",height:"sm",adjustMode:"shrink-to-fit"},{type:"button",action:{type:"message",label:"🏠 Main Menu",text:"main_menu"},style:"secondary",height:"sm",adjustMode:"shrink-to-fit",margin:"xs"}]}}});return;}

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
  const fbRows=getSub("fallback");await client.replyMessage(replyToken,fbRows.length>0?subFlex(fbRows,"fallback"):{type:"text",text:"⚠️ ระบบกำลังโหลดครับ กรุณากดใหม่ หรือโทร 086-341-7250"});
}

app.post("/webhook",line.middleware(LINE_CFG),async(req,res)=>{
  try{await Promise.all(req.body.events.map(handleEvent));res.status(200).end();}
  catch(e){console.error(e);res.status(500).end();}
});

app.get("/",(_, res)=>res.json({status:"CRRT Bot v24.0 — RA5IC",alarms:Object.keys(T2T).length}));

loadDB().then(()=>{
  const PORT=process.env.PORT||3000;
  app.listen(PORT,()=>console.log(`CRRT Bot v24.0 :${PORT}`));
});
