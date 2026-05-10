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

const LOGO_URL    = "https://drive.google.com/uc?export=view&id=1Iiih5zuOol80ZfhUEJZaBXzDODDgVlsY";
const MACHINE_URL = "https://drive.google.com/uc?export=view&id=14s4gUf4HPN-8ge9sUqiOfkDsZzBxUcTq";

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
  "cardiac_arrest":    { color:"#B71C1C", light:"#FFF5F5", emoji:"❤️",  tag:"วิกฤต",    level:"🔴 CRITICAL" },
  "blood_leak":        { color:"#C62828", light:"#FFF5F5", emoji:"🩸",  tag:"วิกฤต",    level:"🔴 CRITICAL" },
  "disconnect":        { color:"#880E4F", light:"#FFF0F5", emoji:"🔌",  tag:"วิกฤต",    level:"🔴 CRITICAL" },
  "air_detected":      { color:"#1565C0", light:"#EFF7FF", emoji:"💨",  tag:"วิกฤต",    level:"🔴 CRITICAL" },
  "system_error":      { color:"#4527A0", light:"#F3F0FF", emoji:"⚙️",  tag:"ระบบ",     level:"🔴 CRITICAL" },
  "tmp_high":          { color:"#E65100", light:"#FFF8F0", emoji:"📊",  tag:"เร่งด่วน", level:"🟡 WARNING"  },
  "filter_clotted":    { color:"#BF360C", light:"#FFF3EE", emoji:"🔧",  tag:"เร่งด่วน", level:"🟡 WARNING"  },
  "access_neg":        { color:"#1A237E", light:"#EEF0FF", emoji:"📉",  tag:"เตือน",    level:"🟡 WARNING"  },
  "return_pos":        { color:"#0D47A1", light:"#EEF5FF", emoji:"📈",  tag:"เตือน",    level:"🟡 WARNING"  },
  "access_pos":        { color:"#006064", light:"#EEFFFE", emoji:"📈",  tag:"เตือน",    level:"🟡 WARNING"  },
  "hypotension":       { color:"#B71C1C", light:"#FFF5F5", emoji:"📉",  tag:"เร่งด่วน", level:"🔴 CRITICAL" },
  "battery_low":       { color:"#E65100", light:"#FFF8F0", emoji:"⚡",  tag:"เร่งด่วน", level:"🟡 WARNING"  },
  "comm_loss":         { color:"#37474F", light:"#F4F6F7", emoji:"📡",  tag:"ระบบ",     level:"🟡 WARNING"  },
  "bag_empty":         { color:"#00695C", light:"#EEFFFE", emoji:"💧",  tag:"เตือน",    level:"🟢 ADVISORY" },
  "flow_error":        { color:"#2E7D32", light:"#EEFFF2", emoji:"⚖️",  tag:"เตือน",    level:"🟢 ADVISORY" },
  "syringe_empty":     { color:"#6A1B9A", light:"#F6EEFF", emoji:"💉",  tag:"เตือน",    level:"🟢 ADVISORY" },
  "scale_open":        { color:"#F57F17", light:"#FFFCEE", emoji:"⚖️",  tag:"ระวัง",    level:"🟢 ADVISORY" },
  "check_access":      { color:"#827717", light:"#FDFFF0", emoji:"🔍",  tag:"ระวัง",    level:"🟢 ADVISORY" },
  "line_clamped":      { color:"#1B5E20", light:"#EEFFF2", emoji:"🟢",  tag:"เตือน",    level:"🟢 ADVISORY" },
  "effluent_overload": { color:"#E65100", light:"#FFF8F0", emoji:"⚖️",  tag:"เร่งด่วน", level:"🟡 WARNING"  },
  "return_blood":      { color:"#C62828", light:"#FFF5F5", emoji:"🩸",  tag:"เร่งด่วน", level:"🟢 ADVISORY" },
  "nss_recirculation": { color:"#0277BD", light:"#EEF7FF", emoji:"💧",  tag:"เตือน",    level:"🟢 ADVISORY" },
  "self_test_failed":  { color:"#4527A0", light:"#F3F0FF", emoji:"⚙️",  tag:"ระบบ",     level:"🟡 WARNING"  },
};
function acfg(t) { return ACFG[t] || { color:"#1A237E", light:"#EEF0FF", emoji:"🚨", tag:"Alarm", level:"⚪ ALARM" }; }

function driveUrl(u) {
  const m = u.match(/\/d\/([^/]+)/);
  return m ? `https://drive.google.com/uc?export=view&id=${m[1]}` : u;
}

// ── SECTION STYLES (สีกล่องแต่ละ part) ────────────────────────────────────────
// Index 0: เป้าหมาย → น้ำเงิน
// Index 1: สาเหตุ/False Alarm → ส้ม
// Index 2: ขั้นตอน → เขียว
// Index 3: ระวัง/ข้อควร → แดง
// Index 4: อื่นๆ → ม่วง
const SEC_STYLES = [
  { bar:"#1A73E8", bg:"#E8F0FE", hColor:"#1A237E", icon:"🎯" },
  { bar:"#F57C00", bg:"#FFF3E0", hColor:"#E65100", icon:"🔍" },
  { bar:"#2E7D32", bg:"#E8F5E9", hColor:"#1B5E20", icon:"🚀" },
  { bar:"#C62828", bg:"#FFEBEE", hColor:"#B71C1C", icon:"⚠️" },
  { bar:"#6A1B9A", bg:"#F3E5F5", hColor:"#4A148C", icon:"💡" },
];

function detectStyle(head) {
  if (!head) return 2; // default = ขั้นตอน (เขียว)
  const h = head.toLowerCase();
  if (h.includes("เป้าหมาย") || h.includes("goal"))                                 return 0;
  if (h.includes("สาเหตุ") || h.includes("false") || h.includes("cause"))           return 1;
  if (h.includes("ขั้นตอน") || h.includes("จัดการ") || h.includes("flow") ||
      h.includes("ขั้นที่") || h.includes("step") || h.includes("วิธี"))            return 2;
  if (h.includes("ระวัง") || h.includes("ข้อควร") || h.includes("warn") ||
      h.includes("alert") || h.includes("ห้าม"))                                    return 3;
  return 4;
}

// parse instruction format จริงใน Sheet:
// 【...】 = header ทิ้ง
// 🔍 สาเหตุที่พบบ่อย = section head
// ⏱️ เป้าหมาย: ... = section head
// 🚀 ขั้นตอนการแก้ไข = section head
// ▶️ ขั้นที่ N: ... = sub-section head
// 1️⃣2️⃣3️⃣ = items
// ⚠️ ข้อมูลนี้... = warning (ทิ้ง เพราะเพิ่มเองใน footer)
function parseInstruction(raw) {
  if (!raw) return [];
  // ทำความสะอาด
  let text = raw
    .replace(/【[^】]*】/g, "")                   // ลบ 【...】
    .replace(/⚠️ ข้อมูลนี้.*$/s, "")             // ลบ warning ท้าย
    .replace(/\\\[/g, "[").replace(/\\\]/g, "]")  // unescape brackets
    .replace(/\\>/g, ">")
    .trim();

  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  const sections = [];
  let cur = null;

  for (const line of lines) {
    // Section heads หลัก
    const isMajorHead =
      /^(🔍|⏱️|🚀|⚠️|📋|🔴|🟡|🟢|ð\u009f\u0094\u008d|ð\u009f\u009a\u0080)/.test(line) ||
      /^(สาเหตุ|เป้าหมาย|ขั้นตอน|ข้อควร|ระวัง|False Alarm)/i.test(line);

    // Sub-section heads: ▶️ ขั้นที่
    const isSubHead = /^(▶️|►|➤)/.test(line) ||
                      /^ขั้นที่\s*\d/i.test(line) ||
                      /^Step\s*\d/i.test(line);

    // Items: ลงต้นด้วย emoji ตัวเลข 1️⃣2️⃣3️⃣ หรือ 1. 2. 3.
    const isItem = /^[1-9]️⃣/.test(line) ||
                   /^[\d]+[.)]\s/.test(line) ||
                   /^[•\-]\s/.test(line);

    if (isMajorHead) {
      cur = { head: line, items: [], styleIdx: detectStyle(line) };
      sections.push(cur);
    } else if (isSubHead) {
      // Sub-head → เพิ่มเป็น sub-section ใน section ปัจจุบัน หรือสร้างใหม่
      if (!cur) {
        cur = { head: null, items: [], styleIdx: 2 };
        sections.push(cur);
      }
      // เพิ่ม sub-head เป็น item แบบ bold
      cur.items.push("__HEAD__" + line);
    } else if (isItem) {
      if (!cur) {
        cur = { head: null, items: [], styleIdx: 2 };
        sections.push(cur);
      }
      // ลบ prefix emoji/number ออก
      const clean = line
        .replace(/^[1-9]️⃣\s*/, "")
        .replace(/^[\d]+[.)]\s*/, "")
        .replace(/^[•\-]\s*/, "")
        .trim();
      cur.items.push(clean);
    } else if (line.length > 0) {
      // ข้อความธรรมดา
      if (!cur) {
        cur = { head: null, items: [], styleIdx: 2 };
        sections.push(cur);
      }
      cur.items.push(line);
    }
  }
  return sections;
}

// highlight คำสำคัญ
const HIGHLIGHT_WORDS = [
  "ห้าม","ทันที","ด่วน","วิกฤต","stop","ห้ามกด","ห้ามคืน","ห้ามให้",
  "2 นาที","3 นาที","5 นาที","10 นาที","ห้ามรอ","ห้ามฝืน","เด็ดขาด"
];

function mkText(text, defColor, defSize) {
  const t = text || "";
  const hasHL = HIGHLIGHT_WORDS.some(kw => t.includes(kw));
  return {
    type: "text", text: t, size: defSize || "sm",
    color: hasHL ? "#C62828" : (defColor || "#333333"),
    weight: hasHL ? "bold" : "regular",
    wrap: true, flex: 1
  };
}

function buildSections(sections, mainColor) {
  const blocks = [];
  if (!sections || sections.length === 0) return blocks;

  let secNum = 0;
  for (const sec of sections) {
    const si = sec.styleIdx !== undefined ? sec.styleIdx : (secNum % SEC_STYLES.length);
    const style = SEC_STYLES[si];
    secNum++;

    if (sec.head) {
      // กล่อง head
      const cleanHead = sec.head
        .replace(/^[🔍⏱️🚀⚠️📋]\s*/, "")
        .replace(/^(ð\u009f[^\s]+\s*)/, "")
        .trim();
      blocks.push({
        type: "box", layout: "horizontal", margin: "md", spacing: "sm",
        backgroundColor: style.bg, paddingAll: "8px", cornerRadius: "8px",
        contents: [
          { type: "box", layout: "vertical", width: "4px", backgroundColor: style.bar, cornerRadius: "4px", contents: [] },
          { type: "text", text: style.icon + " " + cleanHead, weight: "bold", size: "sm", color: style.hColor, wrap: true, flex: 1, margin: "sm" }
        ]
      });
    }

    let itemNum = 0;
    for (const item of sec.items) {
      if (item.startsWith("__HEAD__")) {
        // sub-head เช่น ▶️ ขั้นที่ 1
        const subHead = item.replace("__HEAD__", "").replace(/^(▶️|►|➤)\s*/, "").trim();
        blocks.push({
          type: "box", layout: "horizontal", margin: "sm", spacing: "sm",
          paddingStart: sec.head ? "8px" : "0px",
          contents: [
            { type: "text", text: "📍", size: "sm", flex: 0 },
            { type: "text", text: subHead, weight: "bold", size: "sm", color: style.bar, wrap: true, flex: 1 }
          ]
        });
        itemNum = 0; // reset numbering สำหรับ sub-section
      } else {
        itemNum++;
        const numBox = {
          type: "box", layout: "vertical", flex: 0, justifyContent: "flex-start", paddingTop: "1px",
          contents: [{
            type: "box", layout: "vertical", width: "20px", height: "20px",
            backgroundColor: style.bar, cornerRadius: "10px",
            justifyContent: "center", alignItems: "center",
            contents: [{ type: "text", text: String(itemNum), color: "#FFFFFF", size: "xxs", weight: "bold", align: "center" }]
          }]
        };
        blocks.push({
          type: "box", layout: "horizontal", margin: "xs", spacing: "sm",
          paddingStart: sec.head ? "8px" : "0px",
          contents: [numBox, mkText(item, "#333333", "sm")]
        });
      }
    }
  }
  return blocks;
}

// ── ALARM FLEX ───────────────────────────────────────────────────────────────
function buildAlarmFlex(alarm, subRows, trigger) {
  const c = acfg(trigger);
  const sections = parseInstruction(alarm.instruction);
  const secBlocks = buildSections(sections, c.color);

  const body = [];

  // Badge
  body.push({
    type: "box", layout: "horizontal", spacing: "sm",
    contents: [
      {
        type: "box", layout: "baseline", flex: 0,
        paddingAll: "4px", paddingStart: "10px", paddingEnd: "10px",
        backgroundColor: c.color, cornerRadius: "20px",
        contents: [{ type: "text", text: c.level + " • ALARM", color: "#FFFFFF", size: "xxs", weight: "bold" }]
      },
      { type: "filler" },
      { type: "text", text: c.tag, color: c.color, size: "xs", weight: "bold", flex: 0 }
    ]
  });

  // Title
  body.push({ type: "text", text: alarm.alarm_title || "Alarm", weight: "bold", size: "xl", color: c.color, wrap: true, margin: "sm" });
  body.push({ type: "separator", margin: "sm", color: c.color });

  // Sections
  if (secBlocks.length > 0) {
    secBlocks.forEach(b => body.push(b));
  } else {
    const raw = (alarm.instruction || "").split("\n").filter(l => l.trim());
    for (const l of raw.slice(0, 10)) {
      body.push({ type: "text", text: l.trim(), size: "sm", color: "#333333", wrap: true, margin: "xs" });
    }
  }

  body.push({ type: "separator", margin: "lg", color: "#EEEEEE" });
  body.push({
    type: "box", layout: "horizontal", margin: "sm",
    backgroundColor: "#FFF8E1", paddingAll: "8px", cornerRadius: "8px", spacing: "sm",
    contents: [
      { type: "text", text: "⚠️", size: "sm", flex: 0 },
      { type: "text", text: "ข้อมูลนี้เป็นแนวทางช่วยตัดสินใจเท่านั้น ใช้วิจารณญาณทางคลินิกประกอบเสมอ", size: "xxs", color: "#795548", wrap: true, flex: 1 }
    ]
  });

  // Buttons
  const btns = [];
  for (let n = 1; n <= 6; n++) {
    const lbl = (alarm[`btn_${n}_label`] || "").trim();
    const act = (alarm[`btn_${n}_action`] || "").trim();
    if (!lbl || lbl === "nan" || !act || act === "nan") continue;
    // ลบ emoji prefix เพื่อให้ข้อความสั้นลงแต่ครบ
    const shortLbl = lbl.replace(/^[^\w\sก-๙]+\s*/, "").slice(0, 25) || lbl.slice(0, 25);
    btns.push({
      type: "button",
      action: act.startsWith("http")
        ? { type: "uri", label: shortLbl, uri: act }
        : { type: "message", label: shortLbl, text: act },
      style: btns.length === 0 ? "primary" : "secondary",
      color: btns.length === 0 ? c.color : undefined,
      height: "sm", margin: "xs"
    });
  }
  if (btns.length === 0) {
    subRows.filter(r => r.next_step_label).slice(0, 4).forEach((r, i) => {
      const lbl = (r.next_step_label || "").replace(/^[^\w\sก-๙]+\s*/, "").slice(0, 25) || r.next_step_label.slice(0, 25);
      btns.push({
        type: "button",
        action: r.next_step_action?.startsWith("http")
          ? { type: "uri", label: lbl, uri: r.next_step_action }
          : { type: "message", label: lbl, text: r.next_step_action },
        style: i === 0 ? "primary" : "secondary",
        color: i === 0 ? c.color : undefined,
        height: "sm", margin: "xs"
      });
    });
  }
  if (!btns.some(b => b.action?.text === "main_menu")) {
    btns.push({ type: "button", action: { type: "message", label: "🏠 Main Menu", text: "main_menu" }, style: "secondary", height: "sm", margin: "xs" });
  }

  return {
    type: "flex", altText: alarm.alarm_title || "CRRT Alarm",
    contents: {
      type: "bubble",
      hero: {
        type: "box", layout: "horizontal",
        backgroundColor: c.color, paddingAll: "12px", spacing: "sm",
        contents: [
          { type: "image", url: LOGO_URL, size: "xxs", flex: 0, aspectMode: "fit", aspectRatio: "124:100" },
          {
            type: "box", layout: "vertical", flex: 1, justifyContent: "center",
            contents: [
              { type: "text", text: "RA5IC · RAMATHIBODI", color: "#FFFFFF", size: "xxs" },
              { type: "text", text: "CRRT ALARM BOT", color: "#FFD700", size: "sm", weight: "bold" }
            ]
          },
          { type: "text", text: c.emoji, size: "xxl", flex: 0, align: "center", gravity: "center" }
        ]
      },
      body: {
        type: "box", layout: "vertical", paddingAll: "14px",
        backgroundColor: c.light, contents: body
      },
      footer: {
        type: "box", layout: "vertical", paddingAll: "10px", spacing: "xs",
        backgroundColor: "#FAFAFA", contents: btns
      }
    }
  };
}

// ── SUB FLOW FLEX ─────────────────────────────────────────────────────────────
function buildSubFlex(subRows, trigger) {
  const first = subRows.find(r => r.follow_up_msg && r.follow_up_msg !== "nan");
  const msgText = first?.follow_up_msg || "เลือกตัวเลือกด้านล่างครับ";

  const MAP = {
    "show_hotline":        { color:"#1B5E20", emoji:"📞", title:"Hotline CRRT",       bg:"#EEFFF4" },
    "show_non_citrate":    { color:"#004D40", emoji:"🔵", title:"Preset No Citrate",  bg:"#EEFFFE" },
    "show_with_citrate":   { color:"#E65100", emoji:"🟠", title:"Preset Citrate",     bg:"#FFF8F0" },
    "crrt_knowledge":      { color:"#1565C0", emoji:"📚", title:"CRRT Knowledge",     bg:"#EFF7FF" },
    "crrt_mode_info":      { color:"#0D47A1", emoji:"🔄", title:"CRRT Mode",          bg:"#EEF5FF" },
    "crrt_pressure_info":  { color:"#880E4F", emoji:"📊", title:"ค่า Pressure",       bg:"#FFF0F5" },
    "how_to_return":       { color:"#C62828", emoji:"🩸", title:"การคืนเลือด",        bg:"#FFF5F5" },
    "how_to_flush_dlc":    { color:"#00695C", emoji:"💉", title:"หล่อเส้น DLC",       bg:"#EEFFFE" },
    "show_cleanup":        { color:"#2E7D32", emoji:"✅", title:"เก็บเครื่อง",        bg:"#EEFFF2" },
    "alarm_menu":          { color:"#B71C1C", emoji:"🚨", title:"เมนู Alarm",         bg:"#FFF5F5" },
    "alarm_menu_2":        { color:"#B71C1C", emoji:"🚨", title:"เมนู Alarm 2/3",     bg:"#FFF5F5" },
    "alarm_menu_3":        { color:"#B71C1C", emoji:"🚨", title:"เมนู Alarm 3/3",     bg:"#FFF5F5" },
    "update_status":       { color:"#4527A0", emoji:"📋", title:"สถานะเครื่อง",      bg:"#F3F0FF" },
    "how_to_closeloop":    { color:"#0277BD", emoji:"💧", title:"NSS Recirculation",  bg:"#EEF7FF" },
    "fallback":            { color:"#546E7A", emoji:"❓", title:"ไม่พบข้อมูล",        bg:"#F4F6F7" },
    "restart_crrt_flow":   { color:"#1565C0", emoji:"▶️", title:"Start CRRT",         bg:"#EFF7FF" },
    "end_crrt_flow":       { color:"#C62828", emoji:"⏹️", title:"End CRRT",           bg:"#FFF5F5" },
    "ask_doctor_plan":     { color:"#1B5E20", emoji:"👨", title:"ปรึกษาแพทย์",       bg:"#EEFFF4" },
    "how_to_swap_dlc":     { color:"#00695C", emoji:"🔄", title:"สลับสาย DLC",        bg:"#EEFFFE" },
    "how_to_swap_dlc_2":   { color:"#00695C", emoji:"🔄", title:"สลับสาย DLC 2",      bg:"#EEFFFE" },
    "flow_air_fail":       { color:"#1565C0", emoji:"💨", title:"Air Detected",       bg:"#EFF7FF" },
  };
  const m = MAP[trigger] || { color:"#1A237E", emoji:"📋", title:"CRRT Bot", bg:"#EEF0FF" };

  // parse section
  const sections = parseInstruction(msgText);
  const secBlocks = buildSections(sections, m.color);

  const body = [];
  if (secBlocks.length > 0) {
    secBlocks.forEach(b => body.push(b));
  } else {
    const lines = msgText.split("\n").filter(l => l.trim());
    for (const line of lines.slice(0, 15)) {
      const t = line.trim();
      body.push({
        type: "box", layout: "horizontal", spacing: "sm", margin: "xs",
        contents: [
          { type: "text", text: "›", color: m.color, size: "sm", flex: 0 },
          mkText(t, "#333333", "sm")
        ]
      });
    }
  }

  const btns = subRows.filter(r => r.next_step_label).slice(0, 5).map((r, i) => {
    const lbl = (r.next_step_label || "").replace(/^[^\w\sก-๙]+\s*/, "").slice(0, 25) || r.next_step_label.slice(0, 25);
    return {
      type: "button",
      action: r.next_step_action?.startsWith("http")
        ? { type: "uri", label: lbl, uri: r.next_step_action }
        : { type: "message", label: lbl, text: r.next_step_action },
      style: i === 0 ? "primary" : "secondary",
      color: i === 0 ? m.color : undefined,
      height: "sm", margin: "xs"
    };
  });

  if (!["main_menu", "exit_crrt"].includes(trigger) && !btns.some(b => b.action?.text === "main_menu")) {
    btns.push({ type: "button", action: { type: "message", label: "🏠 Main Menu", text: "main_menu" }, style: "secondary", height: "sm", margin: "xs" });
  }

  return {
    type: "flex", altText: m.emoji + " " + m.title,
    contents: {
      type: "bubble",
      hero: {
        type: "box", layout: "horizontal",
        backgroundColor: m.color, paddingAll: "10px", spacing: "sm",
        contents: [
          { type: "image", url: LOGO_URL, size: "xxs", flex: 0, aspectMode: "fit", aspectRatio: "124:100" },
          {
            type: "box", layout: "vertical", flex: 1, justifyContent: "center",
            contents: [
              { type: "text", text: "RA5IC · RAMATHIBODI", color: "#FFFFFF", size: "xxs" },
              { type: "text", text: m.emoji + " " + m.title, color: "#FFFFFF", size: "sm", weight: "bold", wrap: true }
            ]
          }
        ]
      },
      body: {
        type: "box", layout: "vertical", paddingAll: "14px", spacing: "xs",
        backgroundColor: m.bg,
        contents: body.length > 0 ? body : [{ type: "text", text: "เลือกตัวเลือกด้านล่างครับ", size: "sm", color: "#888888" }]
      },
      footer: btns.length > 0 ? {
        type: "box", layout: "vertical", paddingAll: "10px", spacing: "xs",
        backgroundColor: "#FAFAFA", contents: btns
      } : undefined
    }
  };
}

// ── ALARM MENU ────────────────────────────────────────────────────────────────
const ALARM_PAGES = [
  {
    title: "🚨 เมนู Alarm (1/3)", sub: "วิกฤต / เร่งด่วน", color: "#B71C1C",
    items: [
      { label: "❤️ Cardiac Arrest", text: "cardiac_arrest", color: "#B71C1C" },
      { label: "🩸 Blood Leak Detected", text: "blood_leak", color: "#C62828" },
      { label: "💨 Air Detected", text: "air_detected", color: "#1565C0" },
      { label: "🔌 Disconnect Detected", text: "disconnect", color: "#880E4F" },
      { label: "📉 Hypotension", text: "hypotension", color: "#B71C1C" },
      { label: "📊 TMP Too High", text: "tmp_high", color: "#E65100" },
      { label: "🔧 Filter Clotted", text: "filter_clotted", color: "#BF360C" },
      { label: "⚙️ System Error", text: "system_error", color: "#4527A0" },
    ],
    next: "alarm_menu_2"
  },
  {
    title: "🚨 เมนู Alarm (2/3)", sub: "แรงดัน / สาย / อุปกรณ์", color: "#C62828",
    items: [
      { label: "📉 Access Extremely Neg.", text: "access_neg", color: "#1A237E" },
      { label: "📈 Return Extremely Pos.", text: "return_pos", color: "#0D47A1" },
      { label: "📈 Access Extremely Pos.", text: "access_pos", color: "#006064" },
      { label: "⚡ Battery Low/No AC Power", text: "battery_low", color: "#E65100" },
      { label: "📡 Communication Loss", text: "comm_loss", color: "#37474F" },
      { label: "💧 Bag Empty/Effluent Full", text: "bag_empty", color: "#00695C" },
      { label: "⚖️ Flow Error/Weight Err.", text: "flow_error", color: "#2E7D32" },
      { label: "💉 Syringe Empty", text: "syringe_empty", color: "#6A1B9A" },
    ],
    prev: "alarm_menu", next: "alarm_menu_3"
  },
  {
    title: "🚨 เมนู Alarm (3/3)", sub: "อุปกรณ์ / Procedure / อื่นๆ", color: "#D32F2F",
    items: [
      { label: "⚖️ Scale Open", text: "scale_open", color: "#F57F17" },
      { label: "🔍 Check Access", text: "check_access", color: "#827717" },
      { label: "🟢 Line Clamped", text: "line_clamped", color: "#1B5E20" },
      { label: "⚖️ Effluent Scale Overload", text: "effluent_overload", color: "#E65100" },
      { label: "🩸 Return Blood", text: "return_blood", color: "#C62828" },
      { label: "💧 NSS Recirculation", text: "nss_recirculation", color: "#0277BD" },
      { label: "⚙️ Self-Test Failed", text: "self_test_failed", color: "#4527A0" },
    ],
    prev: "alarm_menu_2"
  }
];

function buildAlarmMenuFlex(idx) {
  const p = ALARM_PAGES[idx];
  const btns = p.items.map(item => ({
    type: "button",
    action: { type: "message", label: item.label.slice(0, 25), text: item.text },
    style: "primary", color: item.color, height: "sm", margin: "xs"
  }));
  const nav = [];
  if (p.prev) nav.push({ type: "button", action: { type: "message", label: "⬅️ หน้าก่อน", text: p.prev }, style: "secondary", height: "sm", flex: 1 });
  if (p.next) nav.push({ type: "button", action: { type: "message", label: "➡️ หน้าถัดไป", text: p.next }, style: "primary", color: p.color, height: "sm", flex: 1 });
  nav.push({ type: "button", action: { type: "message", label: "🏠 Main Menu", text: "main_menu" }, style: "secondary", height: "sm", flex: 1 });

  return {
    type: "flex", altText: p.title,
    contents: {
      type: "bubble",
      hero: {
        type: "box", layout: "horizontal", backgroundColor: p.color, paddingAll: "10px", spacing: "sm",
        contents: [
          { type: "image", url: LOGO_URL, size: "xxs", flex: 0, aspectMode: "fit", aspectRatio: "124:100" },
          {
            type: "box", layout: "vertical", flex: 1,
            contents: [
              { type: "text", text: p.title, color: "#FFFFFF", size: "sm", weight: "bold" },
              { type: "text", text: p.sub, color: "#FFCCCC", size: "xs" }
            ]
          }
        ]
      },
      body: { type: "box", layout: "vertical", paddingAll: "10px", spacing: "xs", contents: btns },
      footer: { type: "box", layout: "horizontal", paddingAll: "10px", spacing: "xs", contents: nav }
    }
  };
}

// ── MAIN MENU ─────────────────────────────────────────────────────────────────
function buildMainMenuFlex() {
  return {
    type: "flex", altText: "🏥 CRRT Bot RA5IC",
    contents: {
      type: "bubble",
      hero: {
        type: "box", layout: "vertical", backgroundColor: "#030303", paddingAll: "14px",
        contents: [{
          type: "box", layout: "horizontal", spacing: "sm",
          contents: [
            { type: "image", url: LOGO_URL, size: "xxs", flex: 0, aspectMode: "fit", aspectRatio: "124:100" },
            {
              type: "box", layout: "vertical", flex: 1, justifyContent: "center",
              contents: [
                { type: "text", text: "RA5IC · RAMATHIBODI", color: "#FFC800", size: "xxs" },
                { type: "text", text: "CRRT ALARM BOT", color: "#FFD700", size: "md", weight: "bold" },
                { type: "text", text: "หอผู้ป่วยวิกฤตศัลยกรรม", color: "#FFECB3", size: "xxs" }
              ]
            },
            { type: "image", url: MACHINE_URL, size: "xxs", flex: 0, aspectMode: "fit", aspectRatio: "1:1" }
          ]
        }]
      },
      body: {
        type: "box", layout: "vertical", paddingAll: "12px", spacing: "sm",
        contents: [
          { type: "text", text: "👋 สวัสดีครับ! ยินดีต้อนรับ", weight: "bold", size: "md", color: "#1A237E" },
          {
            type: "box", layout: "vertical", margin: "sm", backgroundColor: "#EEF2FF", cornerRadius: "8px", paddingAll: "10px",
            contents: [
              { type: "text", text: "📖 วิธีใช้งาน", weight: "bold", size: "xs", color: "#3F51B5" },
              { type: "text", text: "1. พิมพ์ชื่อ Alarm ที่เห็นบนหน้าจอ", size: "xs", color: "#555555", margin: "xs" },
              { type: "text", text: "2. ถ่ายรูป Alarm ส่งมาได้เลย", size: "xs", color: "#555555", margin: "xs" },
              { type: "text", text: "3. กดปุ่มเมนูด้านล่างครับ 👇", size: "xs", color: "#555555", margin: "xs" }
            ]
          },
          {
            type: "box", layout: "vertical", margin: "sm", backgroundColor: "#FFF8E1", cornerRadius: "8px", paddingAll: "8px",
            contents: [{ type: "text", text: "⚠️ ข้อมูลนี้เป็นแนวทางช่วยตัดสินใจเท่านั้น โปรดใช้วิจารณญาณทางคลินิกเสมอ", size: "xxs", color: "#795548", wrap: true }]
          }
        ]
      },
      footer: {
        type: "box", layout: "vertical", paddingAll: "10px", spacing: "xs", backgroundColor: "#FAFAFA",
        contents: [
          { type: "box", layout: "horizontal", spacing: "xs",
            contents: [
              { type: "button", action: { type: "message", label: "🚨 แก้ Alarm", text: "alarm_menu" }, style: "primary", color: "#B71C1C", height: "sm", flex: 1 },
              { type: "button", action: { type: "message", label: "📞 Hotline", text: "show_hotline" }, style: "primary", color: "#1B5E20", height: "sm", flex: 1 },
            ]
          },
          { type: "box", layout: "horizontal", spacing: "xs", margin: "xs",
            contents: [
              { type: "button", action: { type: "message", label: "❤️ CPR", text: "cardiac_arrest" }, style: "primary", color: "#B71C1C", height: "sm", flex: 1 },
              { type: "button", action: { type: "message", label: "📉 Hypotension", text: "hypotension" }, style: "primary", color: "#C62828", height: "sm", flex: 1 },
            ]
          },
          { type: "box", layout: "horizontal", spacing: "xs", margin: "xs",
            contents: [
              { type: "button", action: { type: "message", label: "🔵 No Citrate", text: "show_non_citrate" }, style: "primary", color: "#004D40", height: "sm", flex: 1 },
              { type: "button", action: { type: "message", label: "🟠 Citrate", text: "show_with_citrate" }, style: "primary", color: "#E65100", height: "sm", flex: 1 },
            ]
          },
          { type: "box", layout: "horizontal", spacing: "xs", margin: "xs",
            contents: [
              { type: "button", action: { type: "message", label: "🩸 คืนเลือด", text: "how_to_return" }, style: "secondary", height: "sm", flex: 1 },
              { type: "button", action: { type: "message", label: "💧 NSS Recirc", text: "nss_recirculation" }, style: "secondary", height: "sm", flex: 1 },
            ]
          },
          { type: "box", layout: "horizontal", spacing: "xs", margin: "xs",
            contents: [
              { type: "button", action: { type: "message", label: "💉 หล่อเส้น DLC", text: "how_to_flush_dlc" }, style: "secondary", height: "sm", flex: 1 },
              { type: "button", action: { type: "message", label: "✅ เก็บเครื่อง", text: "show_cleanup" }, style: "secondary", height: "sm", flex: 1 },
            ]
          },
          { type: "box", layout: "horizontal", spacing: "xs", margin: "xs",
            contents: [
              { type: "button", action: { type: "message", label: "📚 Knowledge", text: "crrt_knowledge" }, style: "secondary", height: "sm", flex: 1 },
              { type: "button", action: { type: "message", label: "📋 สถานะ", text: "update_status" }, style: "secondary", height: "sm", flex: 1 },
              { type: "button", action: { type: "message", label: "🚪 ออก", text: "exit_crrt" }, style: "secondary", height: "sm", flex: 1 },
            ]
          }
        ]
      }
    }
  };
}

// ── GEMINI ────────────────────────────────────────────────────────────────────
const IMG_PROMPT = `คุณคือผู้เชี่ยวชาญ CRRT วิเคราะห์รูปภาพนี้:
ALARM_NAME: [ชื่อ alarm ภาษาอังกฤษ หรือ unknown]
---
เป้าหมาย
1. [เป้าหมายหลัก]
สาเหตุที่พบบ่อย
1. [สาเหตุ 1]
2. [สาเหตุ 2]
ขั้นตอนการแก้ไข
▶️ ขั้นที่ 1:
1. [ขั้นตอน 1]
2. [ขั้นตอน 2]
ข้อควรระวัง
1. [ระวัง 1]
⚠️ ข้อมูลนี้เป็นแนวทางช่วยตัดสินใจเท่านั้น`;

async function analyzeImage(b64) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`;
  const body = { contents: [{ parts: [{ text: IMG_PROMPT }, { inline_data: { mime_type: "image/jpeg", data: b64 } }] }] };
  const res = await axios.post(url, body, { headers: { "Content-Type": "application/json" } });
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
  axios.post(OLD_WEBHOOK, { events: [event] }).catch(() => {});

  const srcType = event.source?.type;
  if (srcType === "group" || srcType === "room") return;

  const uid = event.source?.userId;
  if (event.type === "follow") return;
  if (event.type !== "message") return;

  const { replyToken, message } = event;

  if (message.type === "image") {
    if (!isActive(uid)) return;
    touch(uid);
    await lineClient.replyMessage(replyToken, { type: "text", text: "🔍 กำลังวิเคราะห์ภาพ Alarm...\nรอสักครู่ครับ ⏳" });
    try {
      const b64 = await getImageB64(message.id);
      const result = await analyzeImage(b64);
      const name = extractAlarmName(result);
      const clean = result.replace(/^ALARM_NAME:.+\n*/i, "").trim();
      // แสดงผลการวิเคราะห์เป็น Flex
      const fakeAlarm = { alarm_title: "🤖 AI วิเคราะห์ Alarm", instruction: clean };
      await lineClient.pushMessage(uid, buildAlarmFlex(fakeAlarm, [], "fallback"));
      const alarmRow = name && name !== "unknown" ? findAlarm(name) : null;
      if (alarmRow) {
        const trigger = T2T[alarmRow.alarm_title];
        await lineClient.pushMessage(uid, buildAlarmFlex(alarmRow, trigger ? getSubRows(trigger) : [], trigger));
      }
    } catch (e) {
      console.error("Image error:", e.message);
      await lineClient.pushMessage(uid, { type: "text", text: "❌ วิเคราะห์รูปไม่ได้ กรุณาพิมพ์ชื่อ Alarm ครับ" });
    }
    return;
  }

  if (message.type !== "text") return;
  const text = message.text.trim();

  if (["รีเซ็ต", "/reset"].includes(text.toLowerCase())) {
    deactivate(uid);
    await lineClient.replyMessage(replyToken, { type: "text", text: "✅ ล้างประวัติแล้วครับ" });
    return;
  }

  if (text === "main_menu")   { activate(uid); await lineClient.replyMessage(replyToken, buildMainMenuFlex()); return; }
  if (text === "exit_crrt")   { deactivate(uid); await lineClient.replyMessage(replyToken, { type: "text", text: "👋 ออกจาก CRRT Bot แล้วครับ กด Rich Menu เพื่อใช้งานอีกครั้งครับ" }); return; }
  if (text === "alarm_menu")  { activate(uid); await lineClient.replyMessage(replyToken, buildAlarmMenuFlex(0)); return; }
  if (text === "alarm_menu_2"){ if (!isActive(uid)) return; touch(uid); await lineClient.replyMessage(replyToken, buildAlarmMenuFlex(1)); return; }
  if (text === "alarm_menu_3"){ if (!isActive(uid)) return; touch(uid); await lineClient.replyMessage(replyToken, buildAlarmMenuFlex(2)); return; }

  if (!isActive(uid)) return;
  touch(uid);

  const subRows = getSubRows(text);
  if (subRows.length > 0) {
    if (!NAV.has(text)) {
      const alarmRow = DB_MAIN.find(r => T2T[r.alarm_title] === text || r.alarm_title?.toLowerCase() === text.toLowerCase());
      if (alarmRow) {
        const trigger = T2T[alarmRow.alarm_title] || text;
        await lineClient.replyMessage(replyToken, buildAlarmFlex(alarmRow, subRows, trigger));
        return;
      }
    }
    await lineClient.replyMessage(replyToken, buildSubFlex(subRows, text));
    return;
  }

  const respRow = DB_MAIN.find(r => [1,2,3,4,5,6].some(n => r[`btn_${n}_action`] === text));
  if (respRow) {
    let respText = "";
    for (let n = 1; n <= 6; n++) {
      if (respRow[`btn_${n}_action`] === text) { respText = respRow[`btn_${n}_response`] || ""; break; }
    }
    const trigger = T2T[respRow.alarm_title];
    const nextSub = trigger ? getSubRows(trigger) : getSubRows("main_menu");
    const qr = nextSub.filter(r => r.next_step_label).slice(0, 13).map(r => ({
      type: "action",
      action: r.next_step_action?.startsWith("http")
        ? { type: "uri", label: r.next_step_label.slice(0, 20), uri: r.next_step_action }
        : { type: "message", label: r.next_step_label.slice(0, 20), text: r.next_step_action }
    }));
    const msg = { type: "text", text: respText || "✅ ดำเนินการเรียบร้อยครับ" };
    if (qr.length > 0) msg.quickReply = { items: qr };
    await lineClient.replyMessage(replyToken, msg);
    return;
  }

  const alarmRow = findAlarm(text);
  if (alarmRow) {
    const trigger = T2T[alarmRow.alarm_title];
    await lineClient.replyMessage(replyToken, buildAlarmFlex(alarmRow, trigger ? getSubRows(trigger) : [], trigger));
    return;
  }

  await lineClient.replyMessage(replyToken, buildSubFlex(getSubRows("fallback"), "fallback"));
}

app.post("/webhook", line.middleware(LINE_CFG), async (req, res) => {
  try { await Promise.all(req.body.events.map(handleEvent)); res.status(200).end(); }
  catch (e) { console.error(e); res.status(500).end(); }
});

app.get("/", (_, res) => res.json({ status: "CRRT Bot RA5IC v10.0" }));

loadDB().then(() => {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`CRRT Bot v10.0 :${PORT}`));
});
