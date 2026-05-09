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

// โลโก้รามา — URL สาธารณะ
const RAMA_LOGO_URL = "https://upload.wikimedia.org/wikipedia/th/4/4a/Rama_logo.png";

let DB_MAIN = [], DB_SUB = [], DB_LAST = 0;
const TTL = 5 * 60 * 1000;

async function loadDB() {
  if (Date.now() - DB_LAST < TTL) return;
  try {
    const fetch = async (sheet) => {
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
    [DB_MAIN, DB_SUB] = await Promise.all([fetch("Main_Database"), fetch("Sub_Flows")]);
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

function getSubRows(trigger) {
  return DB_SUB.filter(r => r.trigger_word === trigger);
}

const TITLE_TO_TRIGGER = {
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

const NAV_TRIGGERS = new Set([
  "main_menu","alarm_menu","alarm_menu_2","how_to_use","show_hotline",
  "fallback","update_status","exit_crrt","how_to_return","how_to_closeloop",
  "how_to_swap_dlc","how_to_swap_dlc_2","how_to_flush_dlc","restart_crrt_flow",
  "end_crrt_flow","ask_doctor_plan","show_cleanup","show_non_citrate","show_with_citrate",
  "crrt_knowledge","crrt_mode_info","crrt_pressure_info",
]);

const ALARM_CONFIG = {
  "cardiac_arrest":    { color: "#B71C1C", light: "#FFEBEE", emoji: "❤️",  level: "CRITICAL" },
  "blood_leak":        { color: "#C62828", light: "#FFEBEE", emoji: "🩸",  level: "CRITICAL" },
  "disconnect":        { color: "#880E4F", light: "#FCE4EC", emoji: "🔌",  level: "CRITICAL" },
  "air_detected":      { color: "#1565C0", light: "#E3F2FD", emoji: "💨",  level: "CRITICAL" },
  "system_error":      { color: "#4527A0", light: "#EDE7F6", emoji: "⚙️",  level: "CRITICAL" },
  "tmp_high":          { color: "#E65100", light: "#FFF3E0", emoji: "📊",  level: "WARNING"  },
  "filter_clotted":    { color: "#BF360C", light: "#FBE9E7", emoji: "🔧",  level: "WARNING"  },
  "access_neg":        { color: "#1A237E", light: "#E8EAF6", emoji: "📉",  level: "WARNING"  },
  "return_pos":        { color: "#0D47A1", light: "#E3F2FD", emoji: "📈",  level: "WARNING"  },
  "access_pos":        { color: "#006064", light: "#E0F7FA", emoji: "📈",  level: "WARNING"  },
  "hypotension":       { color: "#B71C1C", light: "#FFEBEE", emoji: "📉",  level: "WARNING"  },
  "battery_low":       { color: "#E65100", light: "#FFF3E0", emoji: "⚡",  level: "WARNING"  },
  "comm_loss":         { color: "#37474F", light: "#ECEFF1", emoji: "📡",  level: "WARNING"  },
  "bag_empty":         { color: "#00695C", light: "#E0F2F1", emoji: "💧",  level: "ADVISORY" },
  "flow_error":        { color: "#2E7D32", light: "#E8F5E9", emoji: "⚖️",  level: "ADVISORY" },
  "syringe_empty":     { color: "#6A1B9A", light: "#F3E5F5", emoji: "💉",  level: "ADVISORY" },
  "scale_open":        { color: "#F57F17", light: "#FFF8E1", emoji: "⚖️",  level: "ADVISORY" },
  "check_access":      { color: "#827717", light: "#F9FBE7", emoji: "🔍",  level: "ADVISORY" },
  "line_clamped":      { color: "#1B5E20", light: "#E8F5E9", emoji: "🟢",  level: "ADVISORY" },
  "effluent_overload": { color: "#E65100", light: "#FFF3E0", emoji: "⚖️",  level: "ADVISORY" },
  "return_blood":      { color: "#C62828", light: "#FFEBEE", emoji: "🩸",  level: "ADVISORY" },
  "nss_recirculation": { color: "#0277BD", light: "#E1F5FE", emoji: "💧",  level: "ADVISORY" },
  "self_test_failed":  { color: "#4527A0", light: "#EDE7F6", emoji: "⚙️",  level: "WARNING"  },
};

function getAlarmCfg(trigger) {
  return ALARM_CONFIG[trigger] || { color: "#1A237E", light: "#E8EAF6", emoji: "🚨", level: "ALARM" };
}

function driveUrl(url) {
  const m = url.match(/\/d\/([^/]+)/);
  return m ? `https://drive.google.com/uc?export=view&id=${m[1]}` : url;
}

function buildQR(subRows) {
  const items = subRows.filter(r => r.next_step_label).slice(0, 13).map(r => ({
    type: "action",
    action: r.next_step_action?.startsWith("http")
      ? { type: "uri",     label: r.next_step_label.slice(0,20), uri: r.next_step_action }
      : { type: "message", label: r.next_step_label.slice(0,20), text: r.next_step_action },
  }));
  return items.length ? { items } : null;
}

function headerBox(color, title) {
  return {
    type: "box", layout: "horizontal", spacing: "md",
    contents: [
      {
        type: "image", url: RAMA_LOGO_URL,
        size: "xxs", flex: 0, aspectMode: "fit"
      },
      {
        type: "box", layout: "vertical", flex: 1, justifyContent: "center",
        contents: [
          { type: "text", text: "RA5IC · RAMATHIBODI", color: "#FFFFFF", size: "xxs" },
          { type: "text", text: title, color: "#FFFFFF", size: "sm", weight: "bold" }
        ]
      }
    ]
  };
}

function buildAlarmFlex(alarm, subRows, trigger) {
  const cfg = getAlarmCfg(trigger);
  const raw = alarm.instruction || "";
  const lines = raw.split("\n").filter(l => l.trim());

  const bodyContents = [
    {
      type: "box", layout: "horizontal", spacing: "sm",
      contents: [
        {
          type: "box", layout: "baseline", flex: 0,
          paddingAll: "5px", paddingStart: "8px", paddingEnd: "8px",
          backgroundColor: cfg.color, cornerRadius: "12px",
          contents: [{ type: "text", text: cfg.emoji + " " + cfg.level, color: "#FFFFFF", size: "xxs", weight: "bold" }]
        },
        { type: "filler" },
        { type: "text", text: "RA5IC CRRT", color: "#AAAAAA", size: "xxs", align: "end", gravity: "center" }
      ]
    },
    { type: "text", text: alarm.alarm_title || "Alarm", weight: "bold", size: "lg", color: cfg.color, wrap: true, margin: "sm" },
    { type: "separator", margin: "sm" },
    ...lines.map(line => ({
      type: "text", text: line.trim(), size: "sm", color: "#333333", wrap: true, margin: "xs"
    })),
    { type: "separator", margin: "md" },
    {
      type: "box", layout: "vertical", margin: "sm",
      backgroundColor: "#FFF8E1", paddingAll: "8px", cornerRadius: "8px",
      contents: [{ type: "text", text: "⚠️ ใช้วิจารณญาณทางคลินิกประกอบเสมอ", size: "xxs", color: "#795548", wrap: true }]
    }
  ];

  const footerContents = [];
  for (let n = 1; n <= 6; n++) {
    const lbl = (alarm[`btn_${n}_label`] || "").trim();
    const act = (alarm[`btn_${n}_action`] || "").trim();
    if (!lbl || lbl === "nan" || !act || act === "nan") continue;
    footerContents.push({
      type: "button",
      action: act.startsWith("http")
        ? { type: "uri", label: lbl.slice(0,20), uri: act }
        : { type: "message", label: lbl.slice(0,20), text: act },
      style: footerContents.length === 0 ? "primary" : "secondary",
      color: footerContents.length === 0 ? cfg.color : undefined,
      height: "sm", margin: "xs"
    });
  }

  if (footerContents.length === 0) {
    subRows.filter(r => r.next_step_label).slice(0, 4).forEach((r, i) => {
      footerContents.push({
        type: "button",
        action: r.next_step_action?.startsWith("http")
          ? { type: "uri", label: r.next_step_label.slice(0,20), uri: r.next_step_action }
          : { type: "message", label: r.next_step_label.slice(0,20), text: r.next_step_action },
        style: i === 0 ? "primary" : "secondary",
        color: i === 0 ? cfg.color : undefined,
        height: "sm", margin: "xs"
      });
    });
  }

  const hasMain = footerContents.some(b => b.action?.text === "main_menu");
  if (!hasMain) {
    footerContents.push({
      type: "button",
      action: { type: "message", label: "🏠 Main Menu", text: "main_menu" },
      style: "secondary", height: "sm", margin: "xs"
    });
  }

  const flexMsg = {
    type: "bubble",
    header: {
      type: "box", layout: "vertical",
      backgroundColor: cfg.color, paddingAll: "12px",
      contents: [headerBox(cfg.color, "CRRT ALARM BOT")]
    },
    body: {
      type: "box", layout: "vertical", paddingAll: "14px",
      backgroundColor: cfg.light, contents: bodyContents
    },
    footer: {
      type: "box", layout: "vertical", paddingAll: "10px", spacing: "xs",
      backgroundColor: "#FAFAFA", contents: footerContents
    }
  };

  if (alarm.image_url?.startsWith("http")) {
    flexMsg.hero = {
      type: "image", url: driveUrl(alarm.image_url),
      size: "full", aspectRatio: "20:9", aspectMode: "cover"
    };
  }

  return { type: "flex", altText: alarm.alarm_title || "CRRT Alarm", contents: flexMsg };
}

function buildSubFlex(subRows, trigger) {
  const first = subRows.find(r => r.follow_up_msg && r.follow_up_msg !== "nan");
  const msgText = first?.follow_up_msg || "เลือกตัวเลือกด้านล่างครับ";

  let color = "#1A237E", emoji = "📋", title = "CRRT Bot";
  if (trigger === "show_hotline")          { color = "#1B5E20"; emoji = "📞"; title = "Hotline CRRT"; }
  else if (trigger === "show_non_citrate") { color = "#004D40"; emoji = "🔵"; title = "Preset No Citrate"; }
  else if (trigger === "show_with_citrate"){ color = "#E65100"; emoji = "🟠"; title = "Preset Citrate"; }
  else if (trigger === "crrt_knowledge")   { color = "#1565C0"; emoji = "📚"; title = "CRRT Knowledge"; }
  else if (trigger === "crrt_mode_info")   { color = "#0D47A1"; emoji = "🔄"; title = "CRRT Mode"; }
  else if (trigger === "crrt_pressure_info"){ color = "#880E4F"; emoji = "📊"; title = "ค่า Pressure"; }
  else if (trigger === "how_to_return")    { color = "#C62828"; emoji = "🩸"; title = "การคืนเลือด"; }
  else if (trigger === "how_to_flush_dlc") { color = "#00695C"; emoji = "💉"; title = "หล่อเส้น DLC"; }
  else if (trigger === "show_cleanup")     { color = "#2E7D32"; emoji = "✅"; title = "เก็บเครื่อง"; }
  else if (trigger === "alarm_menu")       { color = "#B71C1C"; emoji = "🚨"; title = "เมนู Alarm"; }
  else if (trigger === "update_status")    { color = "#4527A0"; emoji = "📋"; title = "สถานะเครื่อง"; }
  else if (trigger === "fallback")         { color = "#546E7A"; emoji = "❓"; title = "ไม่พบข้อมูล"; }

  const bodyContents = msgText.split("\n").filter(l => l.trim()).map(line => ({
    type: "text", text: line.trim(), size: "sm", color: "#333333", wrap: true, margin: "xs"
  }));

  const footerContents = subRows.filter(r => r.next_step_label).slice(0, 5).map((r, i) => ({
    type: "button",
    action: r.next_step_action?.startsWith("http")
      ? { type: "uri", label: r.next_step_label.slice(0,20), uri: r.next_step_action }
      : { type: "message", label: r.next_step_label.slice(0,20), text: r.next_step_action },
    style: i === 0 ? "primary" : "secondary",
    color: i === 0 ? color : undefined,
    height: "sm", margin: "xs"
  }));

  const skipMain = ["main_menu", "exit_crrt"];
  const hasMain = footerContents.some(b => b.action?.text === "main_menu");
  if (!skipMain.includes(trigger) && !hasMain) {
    footerContents.push({
      type: "button",
      action: { type: "message", label: "🏠 Main Menu", text: "main_menu" },
      style: "secondary", height: "sm", margin: "xs"
    });
  }

  return {
    type: "flex", altText: emoji + " " + title,
    contents: {
      type: "bubble",
      header: {
        type: "box", layout: "vertical",
        backgroundColor: color, paddingAll: "12px",
        contents: [headerBox(color, emoji + " " + title)]
      },
      body: {
        type: "box", layout: "vertical", paddingAll: "14px", spacing: "xs",
        contents: bodyContents.length > 0 ? bodyContents : [
          { type: "text", text: "เลือกตัวเลือกด้านล่างครับ", size: "sm", color: "#888888" }
        ]
      },
      footer: footerContents.length > 0 ? {
        type: "box", layout: "vertical", paddingAll: "10px", spacing: "xs",
        backgroundColor: "#FAFAFA", contents: footerContents
      } : undefined
    }
  };
}

function buildMainMenuFlex() {
  return {
    type: "flex", altText: "🏥 CRRT Bot RA5IC",
    contents: {
      type: "bubble",
      header: {
        type: "box", layout: "vertical",
        backgroundColor: "#030303", paddingAll: "16px",
        contents: [headerBox("#030303", "CRRT ALARM BOT")]
      },
      body: {
        type: "box", layout: "vertical", paddingAll: "14px", spacing: "sm",
        contents: [
          { type: "text", text: "👋 สวัสดีครับ! ยินดีต้อนรับ", weight: "bold", size: "md", color: "#1A237E" },
          {
            type: "box", layout: "vertical", margin: "sm",
            backgroundColor: "#F3F4FF", cornerRadius: "8px", paddingAll: "10px",
            contents: [
              { type: "text", text: "📖 วิธีใช้งาน", weight: "bold", size: "xs", color: "#3F51B5" },
              { type: "text", text: "1. พิมพ์ชื่อ Alarm ที่เห็นบนหน้าจอ", size: "xs", color: "#444444", margin: "xs" },
              { type: "text", text: "2. ถ่ายรูป Alarm ส่งมาได้เลย", size: "xs", color: "#444444", margin: "xs" },
              { type: "text", text: "3. กดปุ่มเมนูด้านล่างครับ", size: "xs", color: "#444444", margin: "xs" }
            ]
          },
          {
            type: "box", layout: "vertical", margin: "sm",
            backgroundColor: "#FFF8E1", cornerRadius: "8px", paddingAll: "8px",
            contents: [{ type: "text", text: "⚠️ ข้อมูลนี้เป็นแนวทางช่วยตัดสินใจเท่านั้น", size: "xxs", color: "#795548", wrap: true }]
          }
        ]
      },
      footer: {
        type: "box", layout: "vertical", paddingAll: "10px", spacing: "xs", backgroundColor: "#FAFAFA",
        contents: [
          {
            type: "box", layout: "horizontal", spacing: "xs",
            contents: [
              { type: "button", action: { type: "message", label: "🚨 แก้ Alarm", text: "alarm_menu" }, style: "primary", color: "#B71C1C", height: "sm", flex: 1 },
              { type: "button", action: { type: "message", label: "📞 Hotline", text: "show_hotline" }, style: "primary", color: "#1B5E20", height: "sm", flex: 1 },
            ]
          },
          {
            type: "box", layout: "horizontal", spacing: "xs", margin: "xs",
            contents: [
              { type: "button", action: { type: "message", label: "❤️ CPR", text: "cardiac_arrest" }, style: "primary", color: "#B71C1C", height: "sm", flex: 1 },
              { type: "button", action: { type: "message", label: "📉 Hypotension", text: "hypotension" }, style: "primary", color: "#C62828", height: "sm", flex: 1 },
            ]
          },
          {
            type: "box", layout: "horizontal", spacing: "xs", margin: "xs",
            contents: [
              { type: "button", action: { type: "message", label: "🔵 No Citrate", text: "show_non_citrate" }, style: "primary", color: "#0D47A1", height: "sm", flex: 1 },
              { type: "button", action: { type: "message", label: "🟠 Citrate", text: "show_with_citrate" }, style: "primary", color: "#E65100", height: "sm", flex: 1 },
            ]
          },
          {
            type: "box", layout: "horizontal", spacing: "xs", margin: "xs",
            contents: [
              { type: "button", action: { type: "message", label: "🩸 คืนเลือด", text: "how_to_return" }, style: "secondary", height: "sm", flex: 1 },
              { type: "button", action: { type: "message", label: "💧 NSS Recirc", text: "nss_recirculation" }, style: "secondary", height: "sm", flex: 1 },
            ]
          },
          {
            type: "box", layout: "horizontal", spacing: "xs", margin: "xs",
            contents: [
              { type: "button", action: { type: "message", label: "💉 หล่อเส้น DLC", text: "how_to_flush_dlc" }, style: "secondary", height: "sm", flex: 1 },
              { type: "button", action: { type: "message", label: "✅ เก็บเครื่อง", text: "show_cleanup" }, style: "secondary", height: "sm", flex: 1 },
            ]
          },
          {
            type: "box", layout: "horizontal", spacing: "xs", margin: "xs",
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

const IMG_PROMPT = `คุณคือผู้เชี่ยวชาญ CRRT วิเคราะห์รูปภาพนี้:
ALARM_NAME: [ชื่อ alarm ภาษาอังกฤษ หรือ unknown]
---
🚨 Alarm: [ชื่อ + ค่า]
⚡ ระดับ: [Critical / Warning / Advisory]
🔍 สาเหตุ: [2-3 ข้อ]
🛠️ ขั้นตอน: [2-3 ข้อ]
⚠️ ข้อมูลนี้เป็นแนวทางช่วยตัดสินใจเท่านั้น`;

async function analyzeImage(b64) {
  const url  = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`;
  const body = { contents: [{ parts: [{ text: IMG_PROMPT }, { inline_data: { mime_type: "image/jpeg", data: b64 } }] }] };
  const res  = await axios.post(url, body, { headers: { "Content-Type": "application/json" } });
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
      const b64    = await getImageB64(message.id);
      const result = await analyzeImage(b64);
      const name   = extractAlarmName(result);
      const clean  = result.replace(/^ALARM_NAME:.+\n*/i, "").trim();
      await lineClient.pushMessage(uid, { type: "text", text: clean });
      const alarmRow = name && name !== "unknown" ? findAlarm(name) : null;
      if (alarmRow) {
        const trigger = TITLE_TO_TRIGGER[alarmRow.alarm_title];
        await lineClient.pushMessage(uid, buildAlarmFlex(alarmRow, trigger ? getSubRows(trigger) : [], trigger));
      } else {
        await lineClient.pushMessage(uid, buildSubFlex(getSubRows("fallback"), "fallback"));
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

  if (text === "main_menu") {
    activate(uid);
    await lineClient.replyMessage(replyToken, buildMainMenuFlex());
    return;
  }

  if (text === "exit_crrt") {
    deactivate(uid);
    await lineClient.replyMessage(replyToken, { type: "text", text: "👋 ออกจากระบบ CRRT Bot แล้วครับ\nกด Rich Menu เพื่อใช้งานอีกครั้งครับ" });
    return;
  }

  if (!isActive(uid)) return;
  touch(uid);

  const subRows = getSubRows(text);
  if (subRows.length > 0) {
    if (!NAV_TRIGGERS.has(text)) {
      const alarmRow = DB_MAIN.find(r =>
        TITLE_TO_TRIGGER[r.alarm_title] === text || r.alarm_title?.toLowerCase() === text.toLowerCase()
      );
      if (alarmRow) {
        const trigger = TITLE_TO_TRIGGER[alarmRow.alarm_title] || text;
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
    const trigger = TITLE_TO_TRIGGER[respRow.alarm_title];
    const nextSub = trigger ? getSubRows(trigger) : getSubRows("main_menu");
    const qr = buildQR(nextSub);
    const msg = { type: "text", text: respText || "✅ ดำเนินการเรียบร้อยครับ" };
    if (qr) msg.quickReply = qr;
    await lineClient.replyMessage(replyToken, msg);
    return;
  }

  const alarmRow = findAlarm(text);
  if (alarmRow) {
    const trigger = TITLE_TO_TRIGGER[alarmRow.alarm_title];
    await lineClient.replyMessage(replyToken, buildAlarmFlex(alarmRow, trigger ? getSubRows(trigger) : [], trigger));
    return;
  }

  await lineClient.replyMessage(replyToken, buildSubFlex(getSubRows("fallback"), "fallback"));
}

app.post("/webhook", line.middleware(LINE_CFG), async (req, res) => {
  try {
    await Promise.all(req.body.events.map(handleEvent));
    res.status(200).end();
  } catch (e) { console.error(e); res.status(500).end(); }
});

app.get("/", (_, res) => res.json({ status: "CRRT Bot RA5IC v5.0" }));

loadDB().then(() => {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`CRRT Bot v5.0 :${PORT}`));
});
