require("dotenv").config();
const express = require("express");
const line    = require("@line/bot-sdk");
const axios   = require("axios");

const app = express();
const LINE_CFG = {
  channelSecret:      process.env.LINE_CHANNEL_SECRET,
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
};
const lineClient = new line.Client(LINE_CFG);

const GEMINI_KEY  = process.env.GEMINI_API_KEY;
const SHEET_ID    = process.env.GOOGLE_SHEET_ID;
const SHEET_KEY   = process.env.GOOGLE_API_KEY;
const OLD_WEBHOOK = process.env.OLD_WEBHOOK_URL || "https://script.google.com/macros/s/AKfycbxzRLSgcMCW7QOruEsDTMoPwidZDx7szWEqZaL-2SKj1fFQHEmYk6EBMGa5b51kQ9g4Nw/exec";

let DB_MAIN = [], DB_SUB = [], DB_LAST = 0;
const TTL = 5 * 60 * 1000;

async function loadDB() {
  if (Date.now() - DB_LAST < TTL) return;
  try {
    const fetchSheet = async (sheet) => {
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(sheet)}?key=${SHEET_KEY}`;
      const res = await axios.get(url);
      const rows = res.data.values || [];
      if (rows.length < 2) return [];
      const headers = rows[0].map(h => h.trim());
      return rows.slice(1).map(row => {
        const obj = {};
        headers.forEach((h, i) => { obj[h] = (row[i] || "").trim(); });
        return obj;
      });
    };
    [DB_MAIN, DB_SUB] = await Promise.all([fetchSheet("Main_Database"), fetchSheet("Sub_Flows")]);
    DB_LAST = Date.now();
    console.log(`DB loaded Main=${DB_MAIN.length} Sub=${DB_SUB.length}`);
  } catch (e) { console.error("DB error:", e.message); }
}

const sessions = new Map();
const SESSION_TTL = 30 * 60 * 1000;
function isActive(uid) {
  const s = sessions.get(uid);
  if (!s?.crrtActive) return false;
  if (Date.now() - s.lastActive > SESSION_TTL) { sessions.delete(uid); return false; }
  return true;
}
function activate(uid)   { sessions.set(uid, { crrtActive: true, lastActive: Date.now() }); }
function touch(uid)      { const s = sessions.get(uid); if (s) s.lastActive = Date.now(); }
function deactivate(uid) { sessions.delete(uid); }

function findAlarm(text) {
  const q = text.toLowerCase().trim();
  return DB_MAIN.find(r => r.alarm_title?.toLowerCase() === q) ||
    DB_MAIN.find(r => r.keywords?.toLowerCase().split(",").some(k => {
      const kw = k.trim();
      return q.includes(kw) || kw.includes(q);
    })) || null;
}
function getSubRows(trigger) { return DB_SUB.filter(r => r.trigger_word === trigger); }

const T2T = {
  "Return Blood":"return_blood","NSS Recirculation":"nss_recirculation",
  "Cardiac Arrest":"cardiac_arrest","Hypotension":"hypotension",
  "Air Detected":"air_detected","Access Extremely Negative":"access_neg",
  "Return Extremely Positive":"return_pos","Blood Leak Detected":"blood_leak",
  "Filter Clotted / Filter Pressure High":"filter_clotted",
  "System Error / Self-Test Failed":"system_error","TMP Too High":"tmp_high",
  "Bag Empty / Effluent Bag Full":"bag_empty","Flow Error / Weight Incorrect":"flow_error",
  "Syringe Empty / Syringe not loaded":"syringe_empty",
  "Battery Low / No AC Power":"battery_low","Access Extremely Positive":"access_pos",
  "Disconnect Detected":"disconnect","Check Access":"check_access",
  "Scale Open":"scale_open","Self-Test Failed":"self_test_failed",
  "Communication Loss":"comm_loss",
  "PBP / Replacement / Dialysate Line Clamped":"line_clamped",
  "Effluent Scale Overload":"effluent_overload",
};

const NAV = new Set([
  "main_menu","alarm_menu","alarm_menu_2","alarm_menu_3","how_to_use","show_hotline",
  "fallback","update_status","exit_crrt","how_to_return","how_to_closeloop",
  "how_to_swap_dlc","how_to_swap_dlc_2","how_to_flush_dlc","restart_crrt_flow",
  "end_crrt_flow","ask_doctor_plan","show_cleanup","show_non_citrate","show_with_citrate",
  "crrt_knowledge","crrt_mode_info","crrt_pressure_info",
]);

const ACFG = {
  "cardiac_arrest":    { color:"#B71C1C", light:"#FFF5F5", emoji:"❤️",  level:"🔴 CRITICAL", tag:"วิกฤต" },
  "blood_leak":        { color:"#C62828", light:"#FFF5F5", emoji:"🩸",  level:"🔴 CRITICAL", tag:"วิกฤต" },
  "disconnect":        { color:"#880E4F", light:"#FFF0F5", emoji:"🔌",  level:"🔴 CRITICAL", tag:"วิกฤต" },
  "air_detected":      { color:"#1565C0", light:"#F0F7FF", emoji:"💨",  level:"🔴 CRITICAL", tag:"วิกฤต" },
  "system_error":      { color:"#4527A0", light:"#F5F0FF", emoji:"⚙️",  level:"🔴 CRITICAL", tag:"ระบบ"  },
  "tmp_high":          { color:"#E65100", light:"#FFF8F0", emoji:"📊",  level:"🟡 WARNING",  tag:"เร่งด่วน" },
  "filter_clotted":    { color:"#BF360C", light:"#FFF5F0", emoji:"🔧",  level:"🟡 WARNING",  tag:"เร่งด่วน" },
  "access_neg":        { color:"#1A237E", light:"#F0F2FF", emoji:"📉",  level:"🟡 WARNING",  tag:"แจ้งเตือน" },
  "return_pos":        { color:"#0D47A1", light:"#F0F6FF", emoji:"📈",  level:"🟡 WARNING",  tag:"แจ้งเตือน" },
  "access_pos":        { color:"#006064", light:"#F0FFFE", emoji:"📈",  level:"🟡 WARNING",  tag:"แจ้งเตือน" },
  "hypotension":       { color:"#B71C1C", light:"#FFF5F5", emoji:"📉",  level:"🔴 CRITICAL", tag:"เร่งด่วน" },
  "battery_low":       { color:"#E65100", light:"#FFF8F0", emoji:"⚡",  level:"🟡 WARNING",  tag:"เร่งด่วน" },
  "comm_loss":         { color:"#37474F", light:"#F5F7F8", emoji:"📡",  level:"🟡 WARNING",  tag:"ระบบ"  },
  "bag_empty":         { color:"#00695C", light:"#F0FFFE", emoji:"💧",  level:"🟢 ADVISORY", tag:"แจ้งเตือน" },
  "flow_error":        { color:"#2E7D32", light:"#F0FFF2", emoji:"⚖️",  level:"🟢 ADVISORY", tag:"แจ้งเตือน" },
  "syringe_empty":     { color:"#6A1B9A", light:"#F8F0FF", emoji:"💉",  level:"🟢 ADVISORY", tag:"แจ้งเตือน" },
  "scale_open":        { color:"#F57F17", light:"#FFFDF0", emoji:"⚖️",  level:"🟢 ADVISORY", tag:"ระวัง"  },
  "check_access":      { color:"#827717", light:"#FDFFF0", emoji:"🔍",  level:"🟢 ADVISORY", tag:"ระวัง"  },
  "line_clamped":      { color:"#1B5E20", light:"#F0FFF4", emoji:"🟢",  level:"🟢 ADVISORY", tag:"แจ้งเตือน" },
  "effluent_overload": { color:"#E65100", light:"#FFF8F0", emoji:"⚖️",  level:"🟡 WARNING",  tag:"เร่งด่วน" },
  "return_blood":      { color:"#C62828", light:"#FFF5F5", emoji:"🩸↩️", level:"🟢 ADVISORY", tag:"เร่งด่วน" },
  "nss_recirculation": { color:"#0277BD", light:"#F0F8FF", emoji:"💧",  level:"🟢 ADVISORY", tag:"แจ้งเตือน" },
  "self_test_failed":  { color:"#4527A0", light:"#F5F0FF", emoji:"⚙️",  level:"🟡 WARNING",  tag:"ระบบ"  },
};
function acfg(t) { return ACFG[t] || { color:"#1A237E", light:"#F0F2FF", emoji:"🚨", level:"⚪ ALARM", tag:"Alarm" }; }
function driveUrl(u) { const m=u.match(/\/d\/([^/]+)/); return m?`https://drive.google.com/uc?export=view&id=${m[1]}`:u; }

// ── ALARM FLEX ───────────────────────────────────────────────────────────────
function buildAlarmFlex(alarm, subRows, trigger) {
  const c = acfg(trigger);
  const lines = (alarm.instruction||"").split("\n").filter(l=>l.trim());

  // Parse sections from instruction
  const sections = [];
  let cur = null;
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    const isHead = t.match(/^(สาเหตุ|ขั้นตอน|ระวัง|หมาย|เป้าหมาย|False|วิธี|ขั้น|จัด)/);
    if (isHead || (t.length < 40 && !t.match(/^[•\-\d]/) && sections.length === 0)) {
      cur = { head: t, items: [] };
      sections.push(cur);
    } else {
      if (!cur) { cur = { head: null, items: [] }; sections.push(cur); }
      cur.items.push(t);
    }
  }

  const body = [];

  // Level badge row
  body.push({
    type:"box", layout:"horizontal", spacing:"sm",
    contents:[
      { type:"box", layout:"baseline", flex:0, paddingAll:"4px", paddingStart:"10px", paddingEnd:"10px",
        backgroundColor:c.color, cornerRadius:"20px",
        contents:[{ type:"text", text:c.level+" • ALARM", color:"#FFFFFF", size:"xxs", weight:"bold" }]
      },
      { type:"filler" },
      { type:"text", text:c.emoji+" "+c.tag, color:c.color, size:"xs", weight:"bold", align:"end", gravity:"center" }
    ]
  });

  // Title
  body.push({ type:"text", text:alarm.alarm_title||"Alarm", weight:"bold", size:"xl", color:c.color, wrap:true, margin:"sm" });
  body.push({ type:"separator", margin:"sm", color:c.color });

  // Sections
  for (const sec of sections) {
    if (sec.head) {
      body.push({
        type:"box", layout:"horizontal", margin:"md", spacing:"sm",
        contents:[
          { type:"box", layout:"vertical", width:"4px", backgroundColor:c.color, cornerRadius:"4px", contents:[] },
          { type:"text", text:sec.head, weight:"bold", size:"sm", color:c.color, wrap:true, flex:1 }
        ]
      });
    }
    for (const item of sec.items) {
      const isNum = item.match(/^[\d]+[.)]/);
      const isBullet = item.match(/^[•\-]/);
      body.push({
        type:"box", layout:"horizontal", margin:"xs", spacing:"sm",
        paddingStart: sec.head ? "12px" : "0px",
        contents:[
          { type:"text", text: isNum?"→": isBullet?"·":"›", color:c.color, size:"sm", flex:0 },
          { type:"text", text:item.replace(/^[•\-\d.)\s]+/,"").trim(), size:"sm", color:"#333333", wrap:true, flex:1 }
        ]
      });
    }
  }

  if (sections.length === 0 && lines.length > 0) {
    for (const l of lines) {
      body.push({ type:"text", text:l.trim(), size:"sm", color:"#333333", wrap:true, margin:"xs" });
    }
  }

  body.push({ type:"separator", margin:"lg", color:"#EEEEEE" });
  body.push({
    type:"box", layout:"horizontal", margin:"sm", backgroundColor:"#FFF8E1",
    paddingAll:"8px", cornerRadius:"8px", spacing:"xs",
    contents:[
      { type:"text", text:"⚠️", size:"sm", flex:0 },
      { type:"text", text:"ข้อมูลนี้เป็นแนวทางช่วยตัดสินใจเท่านั้น ใช้วิจารณญาณทางคลินิกประกอบเสมอ", size:"xxs", color:"#795548", wrap:true, flex:1 }
    ]
  });

  // Footer buttons
  const btns = [];
  for (let n=1; n<=6; n++) {
    const lbl=(alarm[`btn_${n}_label`]||"").trim();
    const act=(alarm[`btn_${n}_action`]||"").trim();
    if (!lbl||lbl==="nan"||!act||act==="nan") continue;
    btns.push({ type:"button",
      action: act.startsWith("http")
        ? { type:"uri", label:lbl.slice(0,20), uri:act }
        : { type:"message", label:lbl.slice(0,20), text:act },
      style: btns.length===0?"primary":"secondary",
      color: btns.length===0?c.color:undefined,
      height:"sm", margin:"xs"
    });
  }
  if (btns.length===0) {
    subRows.filter(r=>r.next_step_label).slice(0,4).forEach((r,i)=>{
      btns.push({ type:"button",
        action: r.next_step_action?.startsWith("http")
          ? { type:"uri", label:r.next_step_label.slice(0,20), uri:r.next_step_action }
          : { type:"message", label:r.next_step_label.slice(0,20), text:r.next_step_action },
        style:i===0?"primary":"secondary",
        color:i===0?c.color:undefined,
        height:"sm", margin:"xs"
      });
    });
  }
  const hasMain = btns.some(b=>b.action?.text==="main_menu");
  if (!hasMain) btns.push({ type:"button", action:{ type:"message", label:"🏠 Main Menu", text:"main_menu" }, style:"secondary", height:"sm", margin:"xs" });

  const flex = {
    type:"bubble",
    header:{
      type:"box", layout:"vertical", backgroundColor:c.color, paddingAll:"14px",
      contents:[{
        type:"box", layout:"horizontal", spacing:"sm",
        contents:[
          { type:"box", layout:"vertical", flex:0, justifyContent:"center",
            contents:[{ type:"text", text:c.emoji, size:"xxl" }]
          },
          { type:"box", layout:"vertical", flex:1,
            contents:[
              { type:"text", text:"RA5IC · RAMATHIBODI", color:"#FFFFFF", size:"xxs", adjustMode:"shrink-to-fit" },
              { type:"text", text:"CRRT ALARM BOT", color:"#FFD700", size:"md", weight:"bold" }
            ]
          }
        ]
      }]
    },
    body:{ type:"box", layout:"vertical", paddingAll:"14px", backgroundColor:c.light, contents:body },
    footer:{ type:"box", layout:"vertical", paddingAll:"10px", spacing:"xs", backgroundColor:"#FAFAFA", contents:btns }
  };

  if (alarm.image_url?.startsWith("http")) {
    flex.hero = { type:"image", url:driveUrl(alarm.image_url), size:"full", aspectRatio:"20:9", aspectMode:"cover" };
  }
  return { type:"flex", altText:alarm.alarm_title||"CRRT Alarm", contents:flex };
}

// ── SUB FLOW FLEX ────────────────────────────────────────────────────────────
function buildSubFlex(subRows, trigger) {
  const first = subRows.find(r=>r.follow_up_msg&&r.follow_up_msg!=="nan");
  const msgText = first?.follow_up_msg||"เลือกตัวเลือกด้านล่างครับ";

  const MAP = {
    "show_hotline":       { color:"#1B5E20", emoji:"📞", title:"Hotline CRRT" },
    "show_non_citrate":   { color:"#004D40", emoji:"🔵", title:"Preset No Citrate" },
    "show_with_citrate":  { color:"#E65100", emoji:"🟠", title:"Preset Citrate" },
    "crrt_knowledge":     { color:"#1565C0", emoji:"📚", title:"CRRT Knowledge" },
    "crrt_mode_info":     { color:"#0D47A1", emoji:"🔄", title:"CRRT Mode" },
    "crrt_pressure_info": { color:"#880E4F", emoji:"📊", title:"ค่า Pressure" },
    "how_to_return":      { color:"#C62828", emoji:"🩸", title:"การคืนเลือด" },
    "how_to_flush_dlc":   { color:"#00695C", emoji:"💉", title:"หล่อเส้น DLC" },
    "show_cleanup":       { color:"#2E7D32", emoji:"✅", title:"เก็บเครื่อง" },
    "alarm_menu":         { color:"#B71C1C", emoji:"🚨", title:"เมนู Alarm" },
    "alarm_menu_2":       { color:"#B71C1C", emoji:"🚨", title:"เมนู Alarm (2)" },
    "alarm_menu_3":       { color:"#B71C1C", emoji:"🚨", title:"เมนู Alarm (3)" },
    "update_status":      { color:"#4527A0", emoji:"📋", title:"สถานะเครื่อง" },
    "how_to_return":      { color:"#C62828", emoji:"🩸", title:"การคืนเลือด" },
    "how_to_closeloop":   { color:"#0277BD", emoji:"💧", title:"NSS Recirculation" },
    "fallback":           { color:"#546E7A", emoji:"❓", title:"ไม่พบข้อมูล" },
    "restart_crrt_flow":  { color:"#1565C0", emoji:"▶️", title:"Start CRRT" },
    "end_crrt_flow":      { color:"#C62828", emoji:"⏹️", title:"End CRRT" },
    "show_cleanup":       { color:"#2E7D32", emoji:"✅", title:"เก็บเครื่อง" },
  };
  const m = MAP[trigger] || { color:"#1A237E", emoji:"📋", title:"CRRT Bot" };

  const lines = msgText.split("\n").filter(l=>l.trim());
  const body = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    const isHead = t.endsWith(":") || (t.length < 40 && !t.match(/^[•\-\d]/));
    if (isHead && body.length===0) {
      body.push({ type:"text", text:t, weight:"bold", size:"md", color:m.color, wrap:true });
    } else {
      const isBullet = t.match(/^[•\-]/);
      const isNum = t.match(/^[\d]+[.)]/);
      body.push({
        type:"box", layout:"horizontal", margin:"xs", spacing:"sm",
        contents:[
          { type:"text", text:isNum?"›":isBullet?"·":"›", color:m.color, size:"sm", flex:0 },
          { type:"text", text:t.replace(/^[•\-\d.)\s]+/,"").trim()||t, size:"sm", color:"#333333", wrap:true, flex:1 }
        ]
      });
    }
  }

  const btns = subRows.filter(r=>r.next_step_label).slice(0,5).map((r,i)=>({
    type:"button",
    action: r.next_step_action?.startsWith("http")
      ? { type:"uri", label:r.next_step_label.slice(0,20), uri:r.next_step_action }
      : { type:"message", label:r.next_step_label.slice(0,20), text:r.next_step_action },
    style:i===0?"primary":"secondary",
    color:i===0?m.color:undefined,
    height:"sm", margin:"xs"
  }));

  const skip = ["main_menu","exit_crrt"];
  const hasMain = btns.some(b=>b.action?.text==="main_menu");
  if (!skip.includes(trigger)&&!hasMain) {
    btns.push({ type:"button", action:{ type:"message", label:"🏠 Main Menu", text:"main_menu" }, style:"secondary", height:"sm", margin:"xs" });
  }

  return {
    type:"flex", altText:m.emoji+" "+m.title,
    contents:{
      type:"bubble",
      header:{
        type:"box", layout:"vertical", backgroundColor:m.color, paddingAll:"12px",
        contents:[{
          type:"box", layout:"horizontal", spacing:"sm",
          contents:[
            { type:"text", text:m.emoji, size:"xl", flex:0 },
            { type:"box", layout:"vertical", flex:1,
              contents:[
                { type:"text", text:"RA5IC · RAMATHIBODI", color:"#FFFFFF", size:"xxs" },
                { type:"text", text:m.title, color:"#FFFFFF", size:"sm", weight:"bold" }
              ]
            }
          ]
        }]
      },
      body:{
        type:"box", layout:"vertical", paddingAll:"14px", spacing:"xs",
        contents: body.length>0 ? body : [{ type:"text", text:"เลือกตัวเลือกด้านล่างครับ", size:"sm", color:"#888888" }]
      },
      footer: btns.length>0 ? {
        type:"box", layout:"vertical", paddingAll:"10px", spacing:"xs", backgroundColor:"#FAFAFA", contents:btns
      } : undefined
    }
  };
}

// ── ALARM MENU (แบ่ง 3 หน้า) ────────────────────────────────────────────────
const ALARM_PAGES = [
  {
    title:"🚨 เมนู Alarm (1/3)",
    subtitle:"วิกฤต / เร่งด่วน",
    color:"#B71C1C",
    items:[
      { label:"❤️ Cardiac Arrest", text:"cardiac_arrest", color:"#B71C1C" },
      { label:"🩸 Blood Leak", text:"blood_leak", color:"#C62828" },
      { label:"💨 Air Detected", text:"air_detected", color:"#1565C0" },
      { label:"🔌 Disconnect", text:"disconnect", color:"#880E4F" },
      { label:"📉 Hypotension", text:"hypotension", color:"#B71C1C" },
      { label:"📊 TMP Too High", text:"tmp_high", color:"#E65100" },
      { label:"🔧 Filter Clotted", text:"filter_clotted", color:"#BF360C" },
      { label:"⚙️ System Error", text:"system_error", color:"#4527A0" },
    ],
    next:"alarm_menu_2"
  },
  {
    title:"🚨 เมนู Alarm (2/3)",
    subtitle:"แรงดัน / แบตเตอรี่",
    color:"#C62828",
    items:[
      { label:"📉 Access Neg.", text:"access_neg", color:"#1A237E" },
      { label:"📈 Return Pos.", text:"return_pos", color:"#0D47A1" },
      { label:"📈 Access Pos.", text:"access_pos", color:"#006064" },
      { label:"⚡ Battery Low", text:"battery_low", color:"#E65100" },
      { label:"📡 Comm. Loss", text:"comm_loss", color:"#37474F" },
      { label:"💧 Bag Empty", text:"bag_empty", color:"#00695C" },
      { label:"⚖️ Flow Error", text:"flow_error", color:"#2E7D32" },
      { label:"💉 Syringe Empty", text:"syringe_empty", color:"#6A1B9A" },
    ],
    prev:"alarm_menu",
    next:"alarm_menu_3"
  },
  {
    title:"🚨 เมนู Alarm (3/3)",
    subtitle:"อุปกรณ์ / อื่นๆ",
    color:"#D32F2F",
    items:[
      { label:"⚖️ Scale Open", text:"scale_open", color:"#F57F17" },
      { label:"🔍 Check Access", text:"check_access", color:"#827717" },
      { label:"🟢 Line Clamped", text:"line_clamped", color:"#1B5E20" },
      { label:"⚖️ Effluent OL.", text:"effluent_overload", color:"#E65100" },
      { label:"🩸 Return Blood", text:"return_blood", color:"#C62828" },
      { label:"💧 NSS Recirc.", text:"nss_recirculation", color:"#0277BD" },
      { label:"⚙️ Self-Test Fail", text:"self_test_failed", color:"#4527A0" },
    ],
    prev:"alarm_menu_2"
  }
];

function buildAlarmMenuFlex(pageIdx) {
  const page = ALARM_PAGES[pageIdx];
  const btns = page.items.map(item=>({
    type:"button",
    action:{ type:"message", label:item.label.slice(0,20), text:item.text },
    style:"primary", color:item.color, height:"sm", margin:"xs"
  }));

  const navBtns = [];
  if (page.prev) navBtns.push({ type:"button", action:{ type:"message", label:"⬅️ หน้าก่อน", text:page.prev }, style:"secondary", height:"sm", flex:1 });
  if (page.next) navBtns.push({ type:"button", action:{ type:"message", label:"➡️ หน้าถัดไป", text:page.next }, style:"primary", color:page.color, height:"sm", flex:1 });
  navBtns.push({ type:"button", action:{ type:"message", label:"🏠 Main Menu", text:"main_menu" }, style:"secondary", height:"sm", flex:1 });

  return {
    type:"flex", altText:page.title,
    contents:{
      type:"bubble",
      header:{
        type:"box", layout:"vertical", backgroundColor:page.color, paddingAll:"12px",
        contents:[
          { type:"text", text:"RA5IC · CRRT BOT", color:"#FFFFFF", size:"xxs" },
          { type:"text", text:page.title, color:"#FFFFFF", size:"md", weight:"bold" },
          { type:"text", text:page.subtitle, color:"#FFCCCC", size:"xs", margin:"xs" }
        ]
      },
      body:{ type:"box", layout:"vertical", paddingAll:"10px", spacing:"xs", contents:btns },
      footer:{
        type:"box", layout:"horizontal", paddingAll:"10px", spacing:"xs",
        contents:navBtns
      }
    }
  };
}

// ── MAIN MENU ────────────────────────────────────────────────────────────────
function buildMainMenuFlex() {
  return {
    type:"flex", altText:"🏥 CRRT Bot RA5IC",
    contents:{
      type:"bubble",
      header:{
        type:"box", layout:"vertical", backgroundColor:"#0D1B3E", paddingAll:"16px",
        contents:[{
          type:"box", layout:"horizontal", spacing:"md",
          contents:[
            {
              type:"box", layout:"vertical", flex:0, justifyContent:"center",
              contents:[{ type:"text", text:"🏥", size:"xxl" }]
            },
            {
              type:"box", layout:"vertical", flex:1,
              contents:[
                { type:"text", text:"● RA5IC · RAMATHIBODI", color:"#FFC800", size:"xxs" },
                { type:"text", text:"CRRT ALARM BOT", color:"#FFD700", size:"lg", weight:"bold" },
                { type:"text", text:"หอผู้ป่วยวิกฤตศัลยกรรม", color:"#FFECB3", size:"xs" }
              ]
            }
          ]
        }]
      },
      body:{
        type:"box", layout:"vertical", paddingAll:"12px", spacing:"sm",
        contents:[
          { type:"text", text:"👋 สวัสดีครับ! ยินดีต้อนรับ", weight:"bold", size:"md", color:"#1A237E" },
          {
            type:"box", layout:"vertical", margin:"sm",
            backgroundColor:"#EEF2FF", cornerRadius:"8px", paddingAll:"10px",
            contents:[
              { type:"text", text:"📖 วิธีใช้งาน", weight:"bold", size:"xs", color:"#3F51B5" },
              { type:"text", text:"1. พิมพ์ชื่อ Alarm ที่เห็นบนหน้าจอ", size:"xs", color:"#555555", margin:"xs" },
              { type:"text", text:"2. ถ่ายรูป Alarm ส่งมาได้เลย", size:"xs", color:"#555555", margin:"xs" },
              { type:"text", text:"3. กดปุ่มเมนูด้านล่างครับ 👇", size:"xs", color:"#555555", margin:"xs" }
            ]
          },
          {
            type:"box", layout:"vertical", margin:"sm",
            backgroundColor:"#FFF8E1", cornerRadius:"8px", paddingAll:"8px",
            contents:[{
              type:"text", text:"⚠️ ข้อมูลนี้เป็นแนวทางช่วยตัดสินใจเท่านั้น โปรดใช้วิจารณญาณทางคลินิกเสมอ",
              size:"xxs", color:"#795548", wrap:true
            }]
          }
        ]
      },
      footer:{
        type:"box", layout:"vertical", paddingAll:"10px", spacing:"xs", backgroundColor:"#FAFAFA",
        contents:[
          { type:"box", layout:"horizontal", spacing:"xs",
            contents:[
              { type:"button", action:{ type:"message", label:"🚨 แก้ Alarm", text:"alarm_menu" }, style:"primary", color:"#B71C1C", height:"sm", flex:1 },
              { type:"button", action:{ type:"message", label:"📞 Hotline", text:"show_hotline" }, style:"primary", color:"#1B5E20", height:"sm", flex:1 },
            ]
          },
          { type:"box", layout:"horizontal", spacing:"xs", margin:"xs",
            contents:[
              { type:"button", action:{ type:"message", label:"❤️ CPR", text:"cardiac_arrest" }, style:"primary", color:"#B71C1C", height:"sm", flex:1 },
              { type:"button", action:{ type:"message", label:"📉 Hypotension", text:"hypotension" }, style:"primary", color:"#C62828", height:"sm", flex:1 },
            ]
          },
          { type:"box", layout:"horizontal", spacing:"xs", margin:"xs",
            contents:[
              { type:"button", action:{ type:"message", label:"🔵 No Citrate", text:"show_non_citrate" }, style:"primary", color:"#004D40", height:"sm", flex:1 },
              { type:"button", action:{ type:"message", label:"🟠 Citrate", text:"show_with_citrate" }, style:"primary", color:"#E65100", height:"sm", flex:1 },
            ]
          },
          { type:"box", layout:"horizontal", spacing:"xs", margin:"xs",
            contents:[
              { type:"button", action:{ type:"message", label:"🩸 คืนเลือด", text:"how_to_return" }, style:"secondary", height:"sm", flex:1 },
              { type:"button", action:{ type:"message", label:"💧 NSS Recirc", text:"nss_recirculation" }, style:"secondary", height:"sm", flex:1 },
            ]
          },
          { type:"box", layout:"horizontal", spacing:"xs", margin:"xs",
            contents:[
              { type:"button", action:{ type:"message", label:"💉 หล่อเส้น DLC", text:"how_to_flush_dlc" }, style:"secondary", height:"sm", flex:1 },
              { type:"button", action:{ type:"message", label:"✅ เก็บเครื่อง", text:"show_cleanup" }, style:"secondary", height:"sm", flex:1 },
            ]
          },
          { type:"box", layout:"horizontal", spacing:"xs", margin:"xs",
            contents:[
              { type:"button", action:{ type:"message", label:"📚 Knowledge", text:"crrt_knowledge" }, style:"secondary", height:"sm", flex:1 },
              { type:"button", action:{ type:"message", label:"📋 สถานะ", text:"update_status" }, style:"secondary", height:"sm", flex:1 },
              { type:"button", action:{ type:"message", label:"🚪 ออก", text:"exit_crrt" }, style:"secondary", height:"sm", flex:1 },
            ]
          }
        ]
      }
    }
  };
}

// ── GEMINI IMAGE ─────────────────────────────────────────────────────────────
const IMG_PROMPT = `คุณคือผู้เชี่ยวชาญ CRRT วิเคราะห์รูปภาพนี้:
ALARM_NAME: [ชื่อ alarm ภาษาอังกฤษ หรือ unknown]
---
🚨 Alarm: [ชื่อ + ค่า]
⚡ ระดับ: [Critical / Warning / Advisory]
🔍 สาเหตุ: [2-3 ข้อ]
🛠️ ขั้นตอน: [2-3 ข้อ]
⚠️ ข้อมูลนี้เป็นแนวทางช่วยตัดสินใจเท่านั้น`;

async function analyzeImage(b64) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`;
  const body = { contents:[{ parts:[{ text:IMG_PROMPT },{ inline_data:{ mime_type:"image/jpeg", data:b64 } }] }] };
  const res = await axios.post(url, body, { headers:{ "Content-Type":"application/json" } });
  return res.data.candidates[0].content.parts[0].text;
}

async function getImageB64(msgId) {
  const stream = await lineClient.getMessageContent(msgId);
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString("base64");
}

function extractAlarmName(text) {
  const m = text.match(/ALARM_NAME:\s*(.+)/i);
  return m ? m[1].trim() : null;
}

// ── EVENT HANDLER ─────────────────────────────────────────────────────────────
async function handleEvent(event) {
  await loadDB();
  axios.post(OLD_WEBHOOK, { events:[event] }).catch(()=>{});

  const srcType = event.source?.type;
  if (srcType==="group"||srcType==="room") return;

  const uid = event.source?.userId;
  if (event.type==="follow") return;
  if (event.type!=="message") return;

  const { replyToken, message } = event;

  // Image
  if (message.type==="image") {
    if (!isActive(uid)) return;
    touch(uid);
    await lineClient.replyMessage(replyToken, { type:"text", text:"🔍 กำลังวิเคราะห์ภาพ Alarm...\nรอสักครู่ครับ ⏳" });
    try {
      const b64 = await getImageB64(message.id);
      const result = await analyzeImage(b64);
      const name = extractAlarmName(result);
      const clean = result.replace(/^ALARM_NAME:.+\n*/i,"").trim();
      await lineClient.pushMessage(uid, { type:"text", text:clean });
      const alarmRow = name&&name!=="unknown" ? findAlarm(name) : null;
      if (alarmRow) {
        const trigger = T2T[alarmRow.alarm_title];
        await lineClient.pushMessage(uid, buildAlarmFlex(alarmRow, trigger?getSubRows(trigger):[], trigger));
      } else {
        await lineClient.pushMessage(uid, buildSubFlex(getSubRows("fallback"),"fallback"));
      }
    } catch(e) {
      console.error("Image error:", e.message);
      await lineClient.pushMessage(uid, { type:"text", text:"❌ วิเคราะห์รูปไม่ได้ กรุณาพิมพ์ชื่อ Alarm ครับ" });
    }
    return;
  }

  if (message.type!=="text") return;
  const text = message.text.trim();

  if (["รีเซ็ต","/reset"].includes(text.toLowerCase())) {
    deactivate(uid);
    await lineClient.replyMessage(replyToken, { type:"text", text:"✅ ล้างประวัติแล้วครับ" });
    return;
  }

  if (text==="main_menu") {
    activate(uid);
    await lineClient.replyMessage(replyToken, buildMainMenuFlex());
    return;
  }

  if (text==="exit_crrt") {
    deactivate(uid);
    await lineClient.replyMessage(replyToken, { type:"text", text:"👋 ออกจากระบบ CRRT Bot แล้วครับ\nกด Rich Menu เพื่อใช้งานอีกครั้งครับ" });
    return;
  }

  // Alarm menu pages
  if (text==="alarm_menu")   { activate(uid); await lineClient.replyMessage(replyToken, buildAlarmMenuFlex(0)); return; }
  if (text==="alarm_menu_2") { if (!isActive(uid)) return; touch(uid); await lineClient.replyMessage(replyToken, buildAlarmMenuFlex(1)); return; }
  if (text==="alarm_menu_3") { if (!isActive(uid)) return; touch(uid); await lineClient.replyMessage(replyToken, buildAlarmMenuFlex(2)); return; }

  if (!isActive(uid)) return;
  touch(uid);

  // Sub flows
  const subRows = getSubRows(text);
  if (subRows.length>0) {
    if (!NAV.has(text)) {
      const alarmRow = DB_MAIN.find(r => T2T[r.alarm_title]===text || r.alarm_title?.toLowerCase()===text.toLowerCase());
      if (alarmRow) {
        const trigger = T2T[alarmRow.alarm_title]||text;
        await lineClient.replyMessage(replyToken, buildAlarmFlex(alarmRow, subRows, trigger));
        return;
      }
    }
    await lineClient.replyMessage(replyToken, buildSubFlex(subRows, text));
    return;
  }

  // Button responses
  const respRow = DB_MAIN.find(r=>[1,2,3,4,5,6].some(n=>r[`btn_${n}_action`]===text));
  if (respRow) {
    let respText="";
    for (let n=1; n<=6; n++) {
      if (respRow[`btn_${n}_action`]===text) { respText=respRow[`btn_${n}_response`]||""; break; }
    }
    const trigger = T2T[respRow.alarm_title];
    const nextSub = trigger?getSubRows(trigger):getSubRows("main_menu");
    const qr = nextSub.filter(r=>r.next_step_label).slice(0,13).map(r=>({
      type:"action",
      action: r.next_step_action?.startsWith("http")
        ? { type:"uri", label:r.next_step_label.slice(0,20), uri:r.next_step_action }
        : { type:"message", label:r.next_step_label.slice(0,20), text:r.next_step_action }
    }));
    const msg = { type:"text", text:respText||"✅ ดำเนินการเรียบร้อยครับ" };
    if (qr.length>0) msg.quickReply = { items:qr };
    await lineClient.replyMessage(replyToken, msg);
    return;
  }

  // Keyword alarm search
  const alarmRow = findAlarm(text);
  if (alarmRow) {
    const trigger = T2T[alarmRow.alarm_title];
    await lineClient.replyMessage(replyToken, buildAlarmFlex(alarmRow, trigger?getSubRows(trigger):[], trigger));
    return;
  }

  // Fallback
  await lineClient.replyMessage(replyToken, buildSubFlex(getSubRows("fallback"),"fallback"));
}

app.post("/webhook", line.middleware(LINE_CFG), async(req,res)=>{
  try { await Promise.all(req.body.events.map(handleEvent)); res.status(200).end(); }
  catch(e) { console.error(e); res.status(500).end(); }
});

app.get("/", (_,res)=>res.json({ status:"CRRT Bot RA5IC v6.0", alarms:Object.keys(T2T).length }));

loadDB().then(()=>{
  const PORT = process.env.PORT||3000;
  app.listen(PORT, ()=>console.log(`CRRT Bot v6.0 :${PORT}`));
});
