/**
 * CRRT LINE OA Bot — RA5IC Ward v2.1
 * ─────────────────────────────────────────────────────
 * การเปลี่ยนแปลง:
 * • ไม่ส่งข้อความตอนเพิ่มเพื่อน (follow event ถูก ignore)
 * • ข้อความต้อนรับแสดงเมื่อกด Rich Menu (main_menu trigger) เท่านั้น
 * • Gemini Vision วิเคราะห์รูป Alarm → ดึง Protocol จาก Google Sheets
 * • Sub_Flows flow navigation พร้อม quick reply buttons
 */

require("dotenv").config();
const express    = require("express");
const line       = require("@line/bot-sdk");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const axios      = require("axios");

const app = express();

// ── Config ────────────────────────────────────────────────────────────────────
const LINE_CFG = {
  channelSecret:      process.env.LINE_CHANNEL_SECRET,
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
};
const lineClient = new line.Client(LINE_CFG);
const genAI      = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const SHEET_ID  = process.env.GOOGLE_SHEET_ID;
const SHEET_KEY = process.env.GOOGLE_API_KEY;

// ── Cache ─────────────────────────────────────────────────────────────────────
let DB_MAIN = [], DB_SUB = [], DB_LAST = 0;
const TTL = 5 * 60 * 1000;

// ── Session ───────────────────────────────────────────────────────────────────
const sessions = new Map();
const getSession = uid => sessions.get(uid) || {};
const setSession = (uid, d) => sessions.set(uid, { ...getSession(uid), ...d });

// ── CRRT Session: active เมื่อกด Rich Menu เท่านั้น ─────────────────────
// หมดอายุใน 30 นาที หากไม่มีการใช้งาน
const SESSION_TTL_MS = 30 * 60 * 1000;

function isCrrtActive(uid) {
  const s = getSession(uid);
  if (!s.crrtActive) return false;
  if (Date.now() - (s.crrtLastActive || 0) > SESSION_TTL_MS) {
    // หมดอายุ → reset
    setSession(uid, { crrtActive: false });
    return false;
  }
  return true;
}

function activateCrrt(uid) {
  setSession(uid, { crrtActive: true, crrtLastActive: Date.now() });
}

function touchCrrt(uid) {
  setSession(uid, { crrtLastActive: Date.now() });
}

function deactivateCrrt(uid) {
  setSession(uid, { crrtActive: false });
}

// ════════════════════════════════════════════════════════════════════════════
// DATABASE
// ════════════════════════════════════════════════════════════════════════════
async function fetchSheet(name) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(name)}?key=${SHEET_KEY}`;
  const res  = await axios.get(url);
  const rows = res.data.values || [];
  if (rows.length < 2) return [];
  const headers = rows[0].map(h => h.trim());
  return rows.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (row[i] || "").trim(); });
    return obj;
  });
}

async function loadDB() {
  if (Date.now() - DB_LAST < TTL) return;
  try {
    [DB_MAIN, DB_SUB] = await Promise.all([
      fetchSheet("Main_Database"),
      fetchSheet("Sub_Flows"),
    ]);
    DB_LAST = Date.now();
    console.log(`✅ DB loaded Main=${DB_MAIN.length} Sub=${DB_SUB.length}`);
  } catch (e) {
    console.error("❌ DB error:", e.message);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// LOOKUP
// ════════════════════════════════════════════════════════════════════════════
function findAlarm(text) {
  const q = text.toLowerCase().trim();
  return (
    DB_MAIN.find(r => r.alarm_title?.toLowerCase() === q) ||
    DB_MAIN.find(r =>
      r.keywords?.toLowerCase().split(",").some(kw => {
        const k = kw.trim();
        return q.includes(k) || k.includes(q);
      })
    ) || null
  );
}

function getSubRows(trigger) {
  return DB_SUB.filter(r => r.trigger_word === trigger);
}

const TITLE_TO_TRIGGER = {
  "Return Blood": "return_blood", "NSS Recirculation": "nss_recirculation",
  "Cardiac Arrest": "cardiac_arrest", "Hypotension": "hypotension",
  "Air Detected": "air_detected", "Access Extremely Negative": "access_neg",
  "Return Extremely Positive": "return_pos", "Blood Leak Detected": "blood_leak",
  "Filter Clotted / Filter Pressure High": "filter_clotted",
  "System Error / Self-Test Failed": "system_error", "TMP Too High": "tmp_high",
  "Bag Empty / Effluent Bag Full": "bag_empty",
  "Flow Error / Weight Incorrect": "flow_error",
  "Syringe Empty / Syringe not loaded": "syringe_empty",
  "Battery Low / No AC Power": "battery_low",
  "Access Extremely Positive": "access_pos", "Disconnect Detected": "disconnect",
  "Check Access": "check_access", "Scale Open": "scale_open",
  "Self-Test Failed": "self_test_failed", "Communication Loss": "comm_loss",
  "PBP / Replacement / Dialysate Line Clamped": "line_clamped",
  "Effluent Scale Overload": "effluent_overload",
};

// ════════════════════════════════════════════════════════════════════════════
// MESSAGE BUILDERS
// ════════════════════════════════════════════════════════════════════════════
function buildQR(subRows) {
  const items = subRows
    .filter(r => r.next_step_label)
    .slice(0, 13)
    .map(r => ({
      type: "action",
      action: r.next_step_action?.startsWith("http")
        ? { type: "uri",     label: r.next_step_label.slice(0,20), uri: r.next_step_action }
        : { type: "message", label: r.next_step_label.slice(0,20), text: r.next_step_action },
    }));
  return items.length ? { items } : null;
}

function driveUrl(url) {
  const m = url.match(/\/d\/([^/]+)/);
  return m ? `https://drive.google.com/uc?export=view&id=${m[1]}` : url;
}

function alarmMessages(alarm, subRows) {
  const msgs = [];
  const body = alarm.instruction || "(ไม่มีข้อมูล)";
  msgs.push({ type: "text", text: body });

  if (alarm.image_url?.startsWith("http")) {
    const img = driveUrl(alarm.image_url);
    msgs.push({ type: "image", originalContentUrl: img, previewImageUrl: img });
  }

  // ── สร้างปุ่มจาก btn_1 ~ btn_6 ใน Main_Database (flow ตาม sheet) ──
  const btnItems = [];
  for (let n = 1; n <= 6; n++) {
    const lbl = (alarm[`btn_${n}_label`] || "").trim();
    const act = (alarm[`btn_${n}_action`] || "").trim();
    if (!lbl || lbl === "nan" || !act || act === "nan") continue;
    btnItems.push({
      type: "action",
      action: act.startsWith("http")
        ? { type: "uri",     label: lbl.slice(0,20), uri: act }
        : { type: "message", label: lbl.slice(0,20), text: act },
    });
  }

  // ถ้าไม่มีปุ่มจาก Main → fallback ใช้ subRows
  const qr = btnItems.length
    ? { items: btnItems.slice(0, 13) }
    : buildQR(subRows);
  if (qr) msgs[msgs.length - 1].quickReply = qr;
  return msgs;
}

function subMsg(subRows) {
  const first = subRows.find(r => r.follow_up_msg && r.follow_up_msg !== "nan");
  const msg   = { type: "text", text: first?.follow_up_msg || "เลือกตัวเลือกด้านล่างครับ" };
  const qr    = buildQR(subRows);
  if (qr) msg.quickReply = qr;
  return msg;
}

// ════════════════════════════════════════════════════════════════════════════
// GEMINI VISION
// ════════════════════════════════════════════════════════════════════════════
const IMG_PROMPT = `คุณคือผู้เชี่ยวชาญ CRRT ในโรงพยาบาล วิเคราะห์รูปภาพนี้:

ALARM_NAME: [ชื่อ alarm บนหน้าจอ ภาษาอังกฤษ หรือ unknown]

---
🖥️ เครื่อง: [ระบุ]
🚨 Alarm: [ชื่อ + ค่า]
⚡ ระดับ: [🔴 Critical / 🟡 Warning / 🔵 Advisory]

🔍 สาเหตุ:
• [สาเหตุ 1]
• [สาเหตุ 2]
• [สาเหตุ 3]

🛠️ ขั้นตอนทันที:
1️⃣ [ขั้นตอน 1]
2️⃣ [ขั้นตอน 2]
3️⃣ [ขั้นตอน 3]

📞 เรียก CRRT Team: [ใช่/ไม่ใช่] — [เหตุผล]

━━━━━━━━━━━━━━━━━━━━━
⚠️ ข้อมูลนี้เป็นแนวทางช่วยตัดสินใจเท่านั้น
ใช้วิจารณญาณทางคลินิกประกอบเสมอครับ`;

async function analyzeImage(b64) {
  const apiKey = process.env.GEMINI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
  const body = {
    contents: [{
      parts: [
        { text: IMG_PROMPT },
        { inline_data: { mime_type: "image/jpeg", data: b64 } }
      ]
    }]
  };
  const res = await axios.post(url, body, {
    headers: { "Content-Type": "application/json" }
  });
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

// ════════════════════════════════════════════════════════════════════════════
// NAV TRIGGERS (ไม่มี alarm content ใน Main)
// ════════════════════════════════════════════════════════════════════════════
const NAV_TRIGGERS = new Set([
  "main_menu","alarm_menu","alarm_menu_2","how_to_use",
  "show_hotline","fallback","update_status","welcome",
  "how_to_return","how_to_closeloop","how_to_swap_dlc","how_to_swap_dlc_2",
  "how_to_flush_dlc","restart_crrt_flow","end_crrt_flow",
  "ask_doctor_plan","show_cleanup","show_non_citrate","show_with_citrate",
]);

// ════════════════════════════════════════════════════════════════════════════
// EVENT HANDLER
// ════════════════════════════════════════════════════════════════════════════
async function handleEvent(event) {
  await loadDB();

  // ── Forward ทุก event ไปยัง Bot เดิม (Google Apps Script) ──────────────
  // Bot เดิมจะทำงานได้ตามปกติ คู่ขนานกับ CRRT Bot
  const OLD_WEBHOOK = process.env.OLD_WEBHOOK_URL ||
    "https://script.google.com/macros/s/AKfycbxzRLSgcMCW7QOruEsDTMoPwidZDx7szWEqZaL-2SKj1fFQHEmYk6EBMGa5b51kQ9g4Nw/exec";
  axios.post(OLD_WEBHOOK, { events: [event] }).catch(() => {});

  // ── ตอบเฉพาะ Direct Message (1:1) เท่านั้น ─────────────────────────────
  // ถ้าเป็นกลุ่ม (group) หรือห้องแชท (room) → ไม่ตอบ
  const sourceType = event.source?.type;
  if (sourceType === "group" || sourceType === "room") return;

  const uid = event.source?.userId;

  // ── Follow event → IGNORE (ไม่ส่งข้อความ) ───────────────────────────────
  // ข้อความต้อนรับจะแสดงเมื่อกด Rich Menu เท่านั้น
  if (event.type === "follow") return;

  if (event.type !== "message") return;
  const { replyToken, message } = event;

  // ════════════════════════════════════════════════════════════════════════
  // IMAGE → Gemini Vision
  // ════════════════════════════════════════════════════════════════════════
  if (message.type === "image") {
    if (!isCrrtActive(uid)) return;
    touchCrrt(uid);
    await lineClient.replyMessage(replyToken, {
      type: "text",
      text: "🔍 กำลังวิเคราะห์ภาพ Alarm ด้วย Gemini AI...\nรอสักครู่ครับ ⏳",
    });
    try {
      const b64    = await getImageB64(message.id);
      const result = await analyzeImage(b64);
      const name   = extractAlarmName(result);
      const clean  = result.replace(/^ALARM_NAME:.+\n*/i, "").trim();

      // ส่ง Gemini analysis
      await lineClient.pushMessage(uid, { type: "text", text: clean });

      // ถ้าพบใน DB → ส่ง Protocol + ปุ่ม
      const alarmRow = name && name !== "unknown" ? findAlarm(name) : null;
      if (alarmRow) {
        const trigger = TITLE_TO_TRIGGER[alarmRow.alarm_title];
        const sub     = trigger ? getSubRows(trigger) : [];
        setSession(uid, { trigger });
        const qr = buildQR(sub);
        const msg = {
          type: "text",
          text: `📋 พบ Protocol: ${alarmRow.alarm_title}\nกดปุ่มด้านล่างเพื่อดำเนินการต่อ`,
        };
        if (qr) msg.quickReply = qr;
        await lineClient.pushMessage(uid, msg);
      } else {
        const fb = buildQR(getSubRows("fallback"));
        const msg = { type: "text", text: "📞 หากต้องการความช่วยเหลือเพิ่มเติม:" };
        if (fb) msg.quickReply = fb;
        await lineClient.pushMessage(uid, msg);
      }
    } catch (e) {
      console.error("Image error:", e);
      await lineClient.pushMessage(uid, {
        type: "text",
        text: "❌ วิเคราะห์รูปไม่ได้ กรุณาลองใหม่ หรือพิมพ์ชื่อ Alarm ที่เห็นบนหน้าจอครับ",
      });
    }
    return;
  }

  if (message.type !== "text") return;
  const text = message.text.trim();

  // ── Reset ────────────────────────────────────────────────────────────────
  if (["รีเซ็ต","/reset","reset"].includes(text.toLowerCase())) {
    sessions.delete(uid);
    await lineClient.replyMessage(replyToken, {
      type: "text", text: "✅ ล้างประวัติแล้วครับ",
      quickReply: { items: [{
        type: "action",
        action: { type: "message", label: "🏠 เมนูหลัก", text: "main_menu" },
      }]},
    });
    return;
  }

  // ── Activate CRRT Session เมื่อกด Rich Menu (main_menu) ─────────────────
  if (text === "main_menu") {
    activateCrrt(uid);
  }

  // ── ถ้า CRRT ยังไม่ active → ไม่ตอบ (รอให้กด Rich Menu ก่อน) ───────────
  if (!isCrrtActive(uid)) return;

  // ── อัปเดต timestamp ทุกครั้งที่มีการใช้งาน ──────────────────────────────
  touchCrrt(uid);

  // ── STEP 1: Sub_Flows trigger ─────────────────────────────────────────
  const subRows = getSubRows(text);
  if (subRows.length > 0) {
    setSession(uid, { trigger: text });
    const isNav = NAV_TRIGGERS.has(text);

    if (!isNav) {
      // Alias trigger → หา alarm ใน Main แล้วแสดง instruction
      const alarmRow = DB_MAIN.find(r =>
        TITLE_TO_TRIGGER[r.alarm_title] === text ||
        r.alarm_title?.toLowerCase() === text.toLowerCase()
      );
      if (alarmRow) {
        const msgs = alarmMessages(alarmRow, subRows);
        await lineClient.replyMessage(replyToken, msgs.length === 1 ? msgs[0] : msgs.slice(0,5));
        return;
      }
    }
    // Nav trigger หรือ ไม่พบ alarm → แสดง sub flow message
    await lineClient.replyMessage(replyToken, subMsg(subRows));
    return;
  }

  // ── STEP 2: btn_X_response ────────────────────────────────────────────
  const respRow = DB_MAIN.find(r =>
    [1,2,3,4,5,6].some(n => r[`btn_${n}_action`] === text)
  );
  if (respRow) {
    let respText = "";
    for (let n = 1; n <= 6; n++) {
      if (respRow[`btn_${n}_action`] === text) {
        respText = respRow[`btn_${n}_response`] || "";
        break;
      }
    }
    const trigger = TITLE_TO_TRIGGER[respRow.alarm_title];
    const nextSub = trigger ? getSubRows(trigger) : getSubRows("main_menu");
    const qr      = buildQR(nextSub);
    const msg     = { type: "text", text: respText || "✅ ดำเนินการเรียบร้อยครับ" };
    if (qr) msg.quickReply = qr;
    await lineClient.replyMessage(replyToken, msg);
    return;
  }

  // ── STEP 3: keyword search ────────────────────────────────────────────
  const alarmRow = findAlarm(text);
  if (alarmRow) {
    const trigger = TITLE_TO_TRIGGER[alarmRow.alarm_title];
    const sub     = trigger ? getSubRows(trigger) : [];
    setSession(uid, { trigger });
    const msgs = alarmMessages(alarmRow, sub);
    await lineClient.replyMessage(replyToken, msgs.length === 1 ? msgs[0] : msgs.slice(0,5));
    return;
  }

  // ── STEP 4: Fallback ──────────────────────────────────────────────────
  const fbRows = getSubRows("fallback");
  const fbMsg  = subMsg(fbRows);
  fbMsg.text   = `ขออภัยครับ ไม่พบข้อมูล "${text}" ในระบบ\n\n` + (fbMsg.text || "");
  await lineClient.replyMessage(replyToken, fbMsg);
}

// ════════════════════════════════════════════════════════════════════════════
// WEBHOOK + SERVER
// ════════════════════════════════════════════════════════════════════════════
app.post("/webhook", line.middleware(LINE_CFG), async (req, res) => {
  try {
    await Promise.all(req.body.events.map(handleEvent));
    res.status(200).end();
  } catch (e) {
    console.error("Webhook error:", e);
    res.status(500).end();
  }
});

app.get("/", (_, res) => res.json({
  status: "🏥 CRRT Bot RA5IC — Running",
  db: { main: DB_MAIN.length, sub: DB_SUB.length },
  note: "ข้อความต้อนรับแสดงเมื่อกด Rich Menu (main_menu) เท่านั้น",
}));

loadDB().then(() => {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`✅ CRRT Bot :${PORT}`));
});
