require("dotenv").config();
const express = require("express");
const line    = require("@line/bot-sdk");
const axios   = require("axios");

const app = express();

// ── LINE Config ───────────────────────────────────────────────────────────────
const LINE_CFG = {
  channelSecret:      process.env.LINE_CHANNEL_SECRET,
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
};
const lineClient = new line.Client(LINE_CFG);

// ── Keys ──────────────────────────────────────────────────────────────────────
const GEMINI_KEY  = process.env.GEMINI_API_KEY;
const SHEET_ID    = process.env.GOOGLE_SHEET_ID;
const SHEET_KEY   = process.env.GOOGLE_API_KEY;
const OLD_WEBHOOK = process.env.OLD_WEBHOOK_URL ||
  "https://script.google.com/macros/s/AKfycbxzRLSgcMCW7QOruEsDTMoPwidZDx7szWEqZaL-2SKj1fFQHEmYk6EBMGa5b51kQ9g4Nw/exec";

// ── DB Cache ──────────────────────────────────────────────────────────────────
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
    console.log(`✅ DB loaded Main=${DB_MAIN.length} Sub=${DB_SUB.length}`);
  } catch (e) { console.error("DB error:", e.message); }
}

// ── Session ───────────────────────────────────────────────────────────────────
// crrtActive = true เมื่อกด Rich Menu
// หมดอายุใน 30 นาที
const sessions = new Map();
const SESSION_TTL = 30 * 60 * 1000;

function isActive(uid) {
  const s = sessions.get(uid);
  if (!s?.crrtActive) return false;
  if (Date.now() - s.lastActive > SESSION_TTL) {
    sessions.delete(uid);
    return false;
  }
  return true;
}

function activate(uid)   { sessions.set(uid, { crrtActive: true, lastActive: Date.now() }); }
function touch(uid)      { const s = sessions.get(uid); if (s) s.lastActive = Date.now(); }
function deactivate(uid) { sessions.delete(uid); }

// ── Lookup ────────────────────────────────────────────────────────────────────
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
]);

// ── Builders ──────────────────────────────────────────────────────────────────
function buildQR(subRows) {
  const items = subRows.filter(r => r.next_step_label).slice(0, 13).map(r => ({
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

function alarmMsgs(alarm, subRows) {
  const msgs = [{ type: "text", text: alarm.instruction || "(ไม่มีข้อมูล)" }];
  if (alarm.image_url?.startsWith("http")) {
    const img = driveUrl(alarm.image_url);
    msgs.push({ type: "image", originalContentUrl: img, previewImageUrl: img });
  }
  const btnItems = [];
  for (let n = 1; n <= 6; n++) {
    const lbl = (alarm[`btn_${n}_label`] || "").trim();
    const act = (alarm[`btn_${n}_action`] || "").trim();
    if (!lbl || lbl === "nan" || !act || act === "nan") continue;
    btnItems.push({ type: "action", action: act.startsWith("http")
      ? { type: "uri",     label: lbl.slice(0,20), uri: act }
      : { type: "message", label: lbl.slice(0,20), text: act }
    });
  }
  const qr = btnItems.length ? { items: btnItems.slice(0,13) } : buildQR(subRows);
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

// ── Gemini Vision ─────────────────────────────────────────────────────────────
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
  const url = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`;

  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { text: IMG_PROMPT },
          {
            inlineData: {
              mimeType: "image/jpeg",
              data: b64
            }
          }
        ]
      }
    ]
  };

  const res = await axios.post(url, body, {
    headers: { "Content-Type": "application/json" }
  });

  return res.data?.candidates?.[0]?.content?.parts?.[0]?.text || "unknown";
}

async function getImageB64(msgId) {
  try {
    const res = await axios.get(
      `https://api-data.line.me/v2/bot/message/${msgId}/content`,
      {
        headers: {
          Authorization: `Bearer ${LINE_CFG.channelAccessToken}`
        },
        responseType: "arraybuffer"
      }
    );

    return Buffer.from(res.data).toString("base64");
  } catch (err) {
    console.error("❌ GET IMAGE FAIL:", err.response?.status, err.message);
    throw err;
  }
}

function extractAlarmName(text) {
  const m = text.match(/ALARM_NAME:\s*(.+)/i);
  return m ? m[1].trim() : null;
}

// ── Event Handler ─────────────────────────────────────────────────────────────
async function handleEvent(event) {
  await loadDB();

  // ── Forward ไปยัง Bot เดิม (Google Apps Script) เสมอ ────────────────────
  axios.post(OLD_WEBHOOK, { events: [event] }).catch(() => {});

  // ── 1. ไม่ตอบในกลุ่มหรือ room ทุกกรณี ──────────────────────────────────
  const srcType = event.source?.type;
  if (srcType === "group" || srcType === "room") return;

  const uid = event.source?.userId;
  if (event.type === "follow") return;
  if (event.type !== "message") return;

  const { replyToken, message } = event;

  // ── IMAGE ─────────────────────────────────────────────────────────────────
  if (message.type === "image") {
    // 2. ตอบรูปเฉพาะเมื่อ session active
    if (!isActive(uid)) return;
    touch(uid);

    const b64 = await getImageB64(message.id); // 🔥 ดึงก่อนเลย

await lineClient.replyMessage(replyToken, {
  type: "text", text: "🔍 กำลังวิเคราะห์ภาพ Alarm ด้วย Gemini AI...\nรอสักครู่ครับ ⏳",
});
      const result = await analyzeImage(b64);
      const name   = extractAlarmName(result);
      const clean  = result.replace(/^ALARM_NAME:.+\n*/i, "").trim();
      await lineClient.pushMessage(uid, { type: "text", text: clean });

      const alarmRow = name && name !== "unknown" ? findAlarm(name) : null;
      if (alarmRow) {
        const trigger = TITLE_TO_TRIGGER[alarmRow.alarm_title];
        const sub     = trigger ? getSubRows(trigger) : [];
        const qr      = buildQR(sub);
        const msg     = { type: "text", text: `📋 พบ Protocol: ${alarmRow.alarm_title}\nกดปุ่มด้านล่างเพื่อดำเนินการต่อ` };
        if (qr) msg.quickReply = qr;
        await lineClient.pushMessage(uid, msg);
      } else {
        const fb = buildQR(getSubRows("fallback"));
        const msg = { type: "text", text: "📞 หากต้องการความช่วยเหลือเพิ่มเติม:" };
        if (fb) msg.quickReply = fb;
        await lineClient.pushMessage(uid, msg);
      }
    } catch (e) {
      console.error("Image error:", e.message);
      await lineClient.pushMessage(uid, { type: "text", text: "❌ วิเคราะห์รูปไม่ได้ กรุณาพิมพ์ชื่อ Alarm ครับ" });
    }
    return;
  }

  if (message.type !== "text") return;
  const text = message.text.trim();

  // ── Reset ─────────────────────────────────────────────────────────────────
  if (["รีเซ็ต", "/reset"].includes(text.toLowerCase())) {
    deactivate(uid);
    await lineClient.replyMessage(replyToken, { type: "text", text: "✅ ล้างประวัติแล้วครับ" });
    return;
  }

  // ── 2. เปิด session เมื่อกด main_menu (Rich Menu) ────────────────────────
  if (text === "main_menu") {
    activate(uid);
  }

  // ── 3. ปุ่มออกจาก CRRT Bot ───────────────────────────────────────────────
  if (text === "exit_crrt") {
    deactivate(uid);
    await lineClient.replyMessage(replyToken, {
      type: "text",
      text: "👋 ออกจากระบบ CRRT Bot แล้วครับ\nหากต้องการใช้งานอีกครั้ง กด Rich Menu ได้เลยครับ",
    });
    return;
  }

  // ── 2. ถ้า session ไม่ active → เงียบ ────────────────────────────────────
  if (!isActive(uid)) return;
  touch(uid);

  // ── Sub_Flows trigger ─────────────────────────────────────────────────────
  const subRows = getSubRows(text);
  if (subRows.length > 0) {
    const isNav = NAV_TRIGGERS.has(text);
    if (!isNav) {
      const alarmRow = DB_MAIN.find(r =>
        TITLE_TO_TRIGGER[r.alarm_title] === text || r.alarm_title?.toLowerCase() === text.toLowerCase()
      );
      if (alarmRow) {
        const msgs = alarmMsgs(alarmRow, subRows);
        await lineClient.replyMessage(replyToken, msgs.length === 1 ? msgs[0] : msgs.slice(0,5));
        return;
      }
    }
    await lineClient.replyMessage(replyToken, subMsg(subRows));
    return;
  }

  // ── btn_X_response ────────────────────────────────────────────────────────
  const respRow = DB_MAIN.find(r => [1,2,3,4,5,6].some(n => r[`btn_${n}_action`] === text));
  if (respRow) {
    let respText = "";
    for (let n = 1; n <= 6; n++) {
      if (respRow[`btn_${n}_action`] === text) { respText = respRow[`btn_${n}_response`] || ""; break; }
    }
    const trigger = TITLE_TO_TRIGGER[respRow.alarm_title];
    const nextSub = trigger ? getSubRows(trigger) : getSubRows("main_menu");
    const qr      = buildQR(nextSub);
    const msg     = { type: "text", text: respText || "✅ ดำเนินการเรียบร้อยครับ" };
    if (qr) msg.quickReply = qr;
    await lineClient.replyMessage(replyToken, msg);
    return;
  }

  // ── Keyword search ────────────────────────────────────────────────────────
  const alarmRow = findAlarm(text);
  if (alarmRow) {
    const trigger = TITLE_TO_TRIGGER[alarmRow.alarm_title];
    const sub     = trigger ? getSubRows(trigger) : [];
    const msgs    = alarmMsgs(alarmRow, sub);
    await lineClient.replyMessage(replyToken, msgs.length === 1 ? msgs[0] : msgs.slice(0,5));
    return;
  }

  // ── Fallback ──────────────────────────────────────────────────────────────
  const fbRows = getSubRows("fallback");
  const fbMsg  = subMsg(fbRows);
  fbMsg.text   = `ขออภัยครับ ไม่พบข้อมูล "${text}"\n\n` + (fbMsg.text || "");
  await lineClient.replyMessage(replyToken, fbMsg);
}

// ── Webhook ───────────────────────────────────────────────────────────────────
app.post("/webhook", line.middleware(LINE_CFG), async (req, res) => {
  try {
    await Promise.all(req.body.events.map(handleEvent));
    res.status(200).end();
  } catch (e) { console.error(e); res.status(500).end(); }
});

app.get("/", (_, res) => res.json({
  status: "🏥 CRRT Bot RA5IC",
  rules: [
    "1. ไม่ตอบในกลุ่ม LINE",
    "2. ตอบ 1:1 เมื่อกด Rich Menu เท่านั้น",
    "3. มีปุ่มออกจาก CRRT Bot เสมอ",
    "4. Session หมดใน 30 นาที"
  ]
}));

loadDB().then(() => {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`✅ CRRT Bot :${PORT}`));
});
