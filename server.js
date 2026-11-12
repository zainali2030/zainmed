/* ============================================================
   ZainMed — MULTI-CLINIC BACKEND SERVER
   Node.js + Express + MySQL
   Software developed by Zain Ali — 03702906075

   Run:  node server.js   ->  http://localhost:4000
   Master panel (clinics banane ke liye):  http://localhost:4000/master.html
   Settings: config.json (server.js ke saath wali file)
============================================================ */
const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");

/* ---------- CONFIG: config.json ya environment variables ---------- */
let CFG = {};
try { CFG = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8")); } catch (e) { /* config.json optional */ }
const pick = (envName, key, def) => process.env[envName] || CFG[key] || def;

const PORT        = pick("PORT", "port", 4000);
const DB = {
  host:     pick("DB_HOST", "dbHost", "127.0.0.1"),
  user:     pick("DB_USER", "dbUser", "root"),
  password: pick("DB_PASS", "dbPass", ""),
  database: pick("DB_NAME", "dbName", "abraj_medical_center"),
  port:     Number(pick("DB_PORT", "dbPort", 3306)),
  ssl:      ["1","true","yes"].includes(String(pick("DB_SSL", "dbSsl", "")).toLowerCase()) ? { minVersion: "TLSv1.2", rejectUnauthorized: true } : undefined
};
const IS_VERCEL = !!process.env.VERCEL;   /* Vercel par server.listen() nahi chalta, app export hoti hai */
const MASTER_KEY  = pick("MASTER_KEY", "masterKey", "ChangeMe@123");   /* master panel ka password */
const MASTER_USER = pick("MASTER_USER", "masterUser", "owner");                  /* owner ka naam */
const WEBHOOK_KEY = pick("WEBHOOK_KEY", "webhookKey", "");               /* WhatsApp / n8n webhook ki key */
const GEMINI_KEY  = pick("GEMINI_API_KEY", "geminiKey", "");
const GEMINI_MODEL= pick("GEMINI_MODEL", "geminiModel", "gemini-2.5-flash");
const CLAUDE_KEY  = pick("ANTHROPIC_API_KEY", "anthropicKey", "");
const CLAUDE_MODEL= pick("ANTHROPIC_MODEL", "anthropicModel", "claude-haiku-5-5");
const TZ          = pick("CLINIC_TZ", "timezone", "Asia/Karachi");
const DEV_CONTACT = "Zain Ali — 03702906075";

const STORES = ["patients","visits","doctors","tests","payments","expenses","users","settings","audit","counters",
                "appointments","leads","inventory","staff","usreports"];
const ALL_PERMS = ["dashboard","newvisit","patients","emr","doctors","lab","ultrasound","injection","billing","expenses","reports",
                   "appointments","leads","inventory","staff","agent","users","settings","backup","delete"];
const DEFAULT_CLINIC = "abraj";
const ADMIN_ID = "usr_faheem_admin";

let pool = null;

/* ---------- helpers ---------- */
const todayStr = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ });
const parseRow = r => { try { return JSON.parse(r.data); } catch (e) { return null; } };
const recId = obj => String(obj && obj.id !== undefined ? obj.id : (obj && obj.key !== undefined ? obj.key : ""));
const errMsg = e => String((e && e.message) || e);
const cleanCode = s => String(s || "").trim().toLowerCase();
const validCode = s => /^[a-z0-9_-]{2,30}$/.test(s);
const ckey = (req, key) => (req.clinic === DEFAULT_CLINIC ? key : req.clinic + ":" + key);

/* ---------- Database + tables + purani data ki migration ---------- */
async function initDB() {
  /* Cloud MySQL par CREATE DATABASE ki ijazat aksar nahi hoti — wahan database pehle se bana hota hai, isliye error ignore */
  try {
    const conn = await mysql.createConnection({ host: DB.host, port: DB.port, user: DB.user, password: DB.password, ssl: DB.ssl });
    try { await conn.query("CREATE DATABASE IF NOT EXISTS `" + DB.database + "` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"); }
    catch (e) { console.log("CREATE DATABASE skip:", e.message); }
    await conn.end();
  } catch (e) { if (!IS_VERCEL) throw e; /* Vercel par neeche pool se hi asli error milega */ }
  pool = mysql.createPool({ host: DB.host, port: DB.port, user: DB.user, password: DB.password, database: DB.database, ssl: DB.ssl,
                            connectionLimit: IS_VERCEL ? 3 : 10, charset: "utf8mb4_unicode_ci", connectTimeout: 15000 });
  await pool.query("SELECT 1");

  await pool.query(
    "CREATE TABLE IF NOT EXISTS records (" +
    "clinic VARCHAR(40) NOT NULL DEFAULT '" + DEFAULT_CLINIC + "', " +
    "store VARCHAR(32) NOT NULL, " +
    "id VARCHAR(64) NOT NULL, " +
    "data LONGTEXT NOT NULL, " +
    "updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, " +
    "PRIMARY KEY (clinic,store,id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

  /* Agar records table purani (bina clinic column) hai to khud upgrade ho jayegi — purana data 'abraj' clinic ka ban jayega */
  const [cols] = await pool.query(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='records' AND COLUMN_NAME='clinic'",
    [DB.database]);
  if (!cols.length) {
    await pool.query("ALTER TABLE records ADD COLUMN clinic VARCHAR(40) NOT NULL DEFAULT '" + DEFAULT_CLINIC + "' FIRST, " +
                     "DROP PRIMARY KEY, ADD PRIMARY KEY (clinic,store,id)");
    console.log(" Purani database upgrade ho gayi (multi-clinic). Purana data clinic 'abraj' mein hai.");
  }

  await pool.query(
    "CREATE TABLE IF NOT EXISTS counters (" +
    "ckey VARCHAR(64) NOT NULL PRIMARY KEY, " +
    "cval BIGINT NOT NULL DEFAULT 1) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

  await pool.query(
    "CREATE TABLE IF NOT EXISTS clinics (" +
    "code VARCHAR(40) NOT NULL PRIMARY KEY, " +
    "name VARCHAR(200) NOT NULL, " +
    "address VARCHAR(300) NOT NULL DEFAULT '', " +
    "phone VARCHAR(60) NOT NULL DEFAULT '', " +
    "admin_user VARCHAR(60) NOT NULL, " +
    "admin_pass VARCHAR(100) NOT NULL, " +
    "active TINYINT NOT NULL DEFAULT 1, " +
    "expiry DATE NULL, " +
    "note VARCHAR(300) NOT NULL DEFAULT '', " +
    "clinic_type VARCHAR(20) NOT NULL DEFAULT 'clinic', " +
    "created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

  const [typeCols] = await pool.query(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='clinics' AND COLUMN_NAME='clinic_type'",
    [DB.database]);
  if (!typeCols.length) {
    await pool.query("ALTER TABLE clinics ADD COLUMN clinic_type VARCHAR(20) NOT NULL DEFAULT 'clinic' AFTER note");
    console.log("Clinic type field add ho gaya; purane accounts Clinic ke taur par rahenge.");
  }

  /* Naye server par koi default clinic (known password ke saath) nahi banti. Sirf config.json mein "seedDefaultClinic": true likhne par. */
  if (pick("SEED_DEFAULT_CLINIC", "seedDefaultClinic", false))
    await pool.query(
      "INSERT IGNORE INTO clinics (code,name,address,phone,admin_user,admin_pass) VALUES (?,?,?,?,?,?)",
      [DEFAULT_CLINIC, "Default Clinic", "", "", "admin", "Change-" + Math.random().toString(36).slice(2, 10)]);

  const [all] = await pool.query("SELECT * FROM clinics");
  for (const c of all) await syncAdmin(c);
}

/* Har clinic ka admin account server khud bana/update kar deta hai */
async function syncAdmin(c) {
  const user = {
    id: ADMIN_ID, username: c.admin_user, password: c.admin_pass,
    fullName: c.admin_user + " (Administrator)", role: "admin",
    permissions: ALL_PERMS.filter(p => p !== "users" && p !== "settings"), active: true, createdAt: "2025-01-01T00:00:00.000Z"
  };
  await pool.query(
    "INSERT INTO records (clinic,store,id,data) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE data=VALUES(data)",
    [c.code, "users", ADMIN_ID, JSON.stringify(user)]);
}

/* ---------- clinic lookup (10 sec cache) ---------- */
const clinicCache = new Map();
async function getClinic(code) {
  const hit = clinicCache.get(code);
  if (hit && Date.now() - hit.t < 10000) return hit.v;
  const [rows] = await pool.query(
    "SELECT code,name,address,phone,admin_user,admin_pass,active,DATE_FORMAT(expiry,'%Y-%m-%d') AS expiry,note,clinic_type FROM clinics WHERE code=?", [code]);
  const v = rows.length ? rows[0] : null;
  clinicCache.set(code, { t: Date.now(), v });
  return v;
}
function clinicProblem(c) {
  if (!c) return { status: 404, msg: "Clinic ID galat hai. Dobara check karein." };
  if (!c.active) return { status: 403, msg: "Is clinic ka account band hai. Software provider se rabta karein: " + DEV_CONTACT };
  if (c.expiry && c.expiry < todayStr())
    return { status: 403, msg: "Software license " + c.expiry + " ko expire ho gaya. Renew ke liye rabta karein: " + DEV_CONTACT };
  return null;
}

/* ---------- express app ---------- */
const app = express();
app.use(cors());
app.use((req, res, next) => { res.setHeader("Permissions-Policy", "camera=(self), microphone=()"); next(); });
app.use(express.json({ limit: "25mb" }));
/* SECURITY: sirf ye files browser ko milengi (config.json, server.js waghera kabhi nahi) */
const PUBLIC_FILES = new Set(["index.html","master.html","login-bg.jpg","manifest.json","sw.js","icon-192.png","icon-512.png"]);
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/:f", (req, res, next) => PUBLIC_FILES.has(req.params.f) ? res.sendFile(path.join(__dirname, req.params.f)) : next());

/* ---------- PUBLIC routes (clinic ID ki zaroorat nahi) ---------- */
/* AI check: browser mein /api/ai-test kholein — AI key chal rahi hai ya nahi, saaf pata chal jata hai */
app.get("/api/ai-test", async (req, res) => {
  /* /api/ai-test?list=1  -> is key se kaun kaun se Gemini models milte hain
     /api/ai-test?model=gemini-2.5-flash -> koi bhi model seedha test karein */
  if (req.query.list || req.query.model) {
    const t1 = Date.now();
    try {
      if (!GEMINI_KEY) return res.json({ ok: false, error: "GEMINI_API_KEY server ko nahi mili" });
      if (req.query.list) {
        const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": GEMINI_KEY }, signal: AbortSignal.timeout(15000) });
        const j = await r.json();
        if (!r.ok) return res.json({ ok: false, status: r.status, ms: Date.now() - t1, error: (j.error && j.error.message) || "error" });
        return res.json({ ok: true, ms: Date.now() - t1, models: (j.models || []).filter(m => /generateContent/.test((m.supportedGenerationMethods || []).join())).map(m => String(m.name).replace("models/", "")).filter(n => /flash|pro/.test(n)) });
      }
      const mdl = String(req.query.model).replace(/[^a-zA-Z0-9._-]/g, "");
      const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + mdl + ":generateContent", {
        method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_KEY }, signal: AbortSignal.timeout(25000),
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "Reply with the single word OK." }] }] })
      });
      const j = await r.json();
      const t = j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts;
      return res.json({ ok: r.ok, model: mdl, status: r.status, ms: Date.now() - t1, reply: t ? t.map(p => p.text || "").join("").slice(0, 40) : null, error: r.ok ? undefined : ((j.error && j.error.message) || "error") });
    } catch (e) { return res.json({ ok: false, ms: Date.now() - t1, error: errMsg(e) }); }
  }
  const t0 = Date.now();
  const prov = GEMINI_KEY ? "Gemini (" + GEMINI_MODEL + ")" : CLAUDE_KEY ? "Claude" : "none";
  try {
    const out = await askLLM("Reply with the single word OK.", [], "ping");
    res.json({ ok: true, provider: prov, ms: Date.now() - t0, reply: String(out || "").slice(0, 40) });
  } catch (e) { res.json({ ok: false, provider: prov, ms: Date.now() - t0, error: errMsg(e) }); }
});
app.get("/api/ping", (req, res) => res.json({ ok: true, service: "ZainMed API", time: new Date().toISOString() }));

/* Database ek hi baar connect hoti hai (pehli request par). Fail ho to server crash nahi hota — saaf error milta hai */
let readyP = null;
function ensureReady() {
  if (pool) return Promise.resolve();
  if (!readyP) readyP = initDB().catch(e => { readyP = null; pool = null; throw e; });
  return readyP;
}
app.get("/api/health", async (req, res) => {
  try { await ensureReady(); res.json({ ok: true, db: "connected", host: DB.host, port: DB.port, ssl: !!DB.ssl, database: DB.database }); }
  catch (e) { res.status(503).json({ ok: false, db: "FAILED", error: errMsg(e), host: DB.host, port: DB.port, ssl: !!DB.ssl, database: DB.database, user: DB.user }); }
});
app.use("/api", async (req, res, next) => {
  try { await ensureReady(); next(); }
  catch (e) { res.status(503).json({ error: "Database connect nahi ho rahi: " + errMsg(e) }); }
});

app.get("/api/clinic/:code", async (req, res) => {
  try {
    const code = cleanCode(req.params.code);
    if (!validCode(code)) return res.status(404).json({ error: "Clinic ID galat hai. Dobara check karein." });
    const c = await getClinic(code);
    const p = clinicProblem(c);
    if (p) return res.status(p.status).json({ error: p.msg });
    res.json({ code: c.code, name: c.name, address: c.address, phone: c.phone, adminUser: c.admin_user, expiry: c.expiry, type: c.clinic_type || "clinic" });
  } catch (e) { res.status(500).json({ error: errMsg(e) }); }
});

/* ---------- MASTER panel API (sirf Zain Ali ke liye) ---------- */
function masterAuth(req, res, next) {
  const u = String(req.get("x-master-user") || "").trim().toLowerCase();
  if (u !== String(MASTER_USER).toLowerCase() || req.get("x-master-key") !== MASTER_KEY)
    return res.status(401).json({ error: "Owner name ya password galat hai" });
  next();
}
app.get("/api/master/clinics", masterAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT code,name,address,phone,admin_user,admin_pass,active,DATE_FORMAT(expiry,'%Y-%m-%d') AS expiry,note,clinic_type," +
      "DATE_FORMAT(created_at,'%Y-%m-%d') AS created FROM clinics ORDER BY created_at");
    const [cnt] = await pool.query("SELECT clinic, store, COUNT(*) AS n FROM records WHERE store IN ('patients','visits') GROUP BY clinic, store");
    rows.forEach(r => {
      r.patients = 0; r.visits = 0;
      cnt.forEach(x => { if (x.clinic === r.code) r[x.store] = Number(x.n); });
    });
    res.json(rows);
  } catch (e) { res.status(500).json({ error: errMsg(e) }); }
});
app.post("/api/master/clinics", masterAuth, async (req, res) => {
  try {
    const b = req.body || {};
    const code = cleanCode(b.code);
    if (!validCode(code)) return res.status(400).json({ error: "Clinic ID sirf english letters/numbers (2-30), e.g. cityclinic" });
    if (!String(b.name || "").trim()) return res.status(400).json({ error: "Clinic / Medical Store ka naam likhein" });
    const clinicType = b.type === "medicalstore" ? "medicalstore" : "clinic";
    if (!String(b.adminUser || "").trim() || !String(b.adminPass || "").trim())
      return res.status(400).json({ error: "Admin username aur password likhein" });
    const [ex] = await pool.query("SELECT code FROM clinics WHERE code=?", [code]);
    if (ex.length) return res.status(409).json({ error: "Ye Clinic ID pehle se maujood hai" });
    await pool.query(
      "INSERT INTO clinics (code,name,address,phone,admin_user,admin_pass,active,expiry,note,clinic_type) VALUES (?,?,?,?,?,?,1,?,?,?)",
      [code, String(b.name).trim(), String(b.address || "").trim(), String(b.phone || "").trim(),
       String(b.adminUser).trim(), String(b.adminPass).trim(), b.expiry || null, String(b.note || "").trim(), clinicType]);
    clinicCache.delete(code);
    await syncAdmin(await getClinic(code).then(c => ({ code: c.code, admin_user: c.admin_user, admin_pass: c.admin_pass })));
    res.json({ ok: true, code });
  } catch (e) { res.status(500).json({ error: errMsg(e) }); }
});
app.put("/api/master/clinics/:code", masterAuth, async (req, res) => {
  try {
    const code = cleanCode(req.params.code);
    const b = req.body || {};
    const [ex] = await pool.query("SELECT * FROM clinics WHERE code=?", [code]);
    if (!ex.length) return res.status(404).json({ error: "Clinic nahi mila" });
    const c = ex[0];
    const name = b.name !== undefined ? String(b.name).trim() || c.name : c.name;
    const address = b.address !== undefined ? String(b.address).trim() : c.address;
    const phone = b.phone !== undefined ? String(b.phone).trim() : c.phone;
    const adminUser = b.adminUser ? String(b.adminUser).trim() : c.admin_user;
    const adminPass = b.adminPass ? String(b.adminPass).trim() : c.admin_pass;
    const active = b.active !== undefined ? (b.active ? 1 : 0) : c.active;
    const note = b.note !== undefined ? String(b.note).trim() : c.note;
    const clinicType = b.type === "medicalstore" ? "medicalstore" : (b.type === "clinic" ? "clinic" : (c.clinic_type || "clinic"));
    const expiry = b.expiry !== undefined ? (b.expiry || null) : null;
    if (b.expiry !== undefined)
      await pool.query("UPDATE clinics SET name=?,address=?,phone=?,admin_user=?,admin_pass=?,active=?,note=?,expiry=?,clinic_type=? WHERE code=?",
        [name, address, phone, adminUser, adminPass, active, note, expiry, clinicType, code]);
    else
      await pool.query("UPDATE clinics SET name=?,address=?,phone=?,admin_user=?,admin_pass=?,active=?,note=?,clinic_type=? WHERE code=?",
        [name, address, phone, adminUser, adminPass, active, note, clinicType, code]);
    clinicCache.delete(code);
    await syncAdmin({ code, admin_user: adminUser, admin_pass: adminPass });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: errMsg(e) }); }
});

/* Clinic / Medical Store ko hamesha ke liye delete karna (data samet). Confirm ke liye body mein clinic ka ID likhna zaroori hai */
app.delete("/api/master/clinics/:code", masterAuth, async (req, res) => {
  try {
    const code = cleanCode(req.params.code);
    const b = req.body || {};
    const [ex] = await pool.query("SELECT code FROM clinics WHERE code=?", [code]);
    if (!ex.length) return res.status(404).json({ error: "Clinic nahi mila" });
    if (cleanCode(b.confirm) !== code) return res.status(400).json({ error: "Delete confirm karne ke liye Clinic ID bilkul sahi likhein" });
    const [r] = await pool.query("DELETE FROM records WHERE clinic=?", [code]);
    await pool.query("DELETE FROM counters WHERE ckey LIKE ?", [code + ":%"]);
    await pool.query("DELETE FROM clinics WHERE code=?", [code]);
    clinicCache.delete(code);
    res.json({ ok: true, deletedRecords: r.affectedRows || 0 });
  } catch (e) { res.status(500).json({ error: errMsg(e) }); }
});

/* ---------- OWNER GUARD: users aur settings sirf owner badal sakta hai ---------- */
function isOwnerReq(req) {
  const u = String(req.get("x-master-user") || "").trim().toLowerCase();
  return u === String(MASTER_USER).toLowerCase() && req.get("x-master-key") === MASTER_KEY;
}
/* ============================================================
   AI AGENT
   - Clinic ka data (sirf usi clinic ka) snapshot ban kar AI ko diya jata hai
   - Agar Gemini / Claude key hai to AI jawab deta hai
   - Key na ho to "offline mode" mein seedhe database se jawab milta hai
============================================================ */
async function loadStore(clinic, store) {
  const [rows] = await pool.query("SELECT data FROM records WHERE clinic=? AND store=?", [clinic, store]);
  return rows.map(parseRow).filter(Boolean);
}
const sum = (arr, f) => arr.reduce((t, x) => t + (Number(f(x)) || 0), 0);

async function buildSnapshot(code) {
  const [visitsAll, payments, expenses, doctors, tests, settingsArr, leads, appts, inv, staff, patients] = await Promise.all(
    ["visits","payments","expenses","doctors","tests","settings","leads","appointments","inventory","staff","patients"].map(s => loadStore(code, s)));
  const st = settingsArr.find(x => x.key === "app") || {};
  const cur = st.currency || "Rs.";
  const visits = visitsAll.filter(v => v.status !== "Cancelled");
  const today = todayStr(), month = today.slice(0, 7);
  const per = (from, to) => {
    const v = visits.filter(x => x.date >= from && x.date <= to);
    const ex = expenses.filter(x => x.date >= from && x.date <= to);
    const pay = payments.filter(x => x.date >= from && x.date <= to);
    const received = sum(v, x => x.received) + sum(pay, x => x.amount);
    return {
      patients: v.length, billed: sum(v, x => x.total), received, due: sum(v, x => x.due),
      opd: sum(v, x => x.opdFee), lab: sum(v, x => x.labTotal), ultrasound: sum(v, x => x.ultraTotal),
      other: sum(v, x => x.otherTotal), discount: sum(v, x => x.discount),
      expenses: sum(ex, x => x.amount), net: received - sum(ex, x => x.amount)
    };
  };
  const last7 = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toLocaleDateString("en-CA", { timeZone: TZ });
    const p = per(d, d); last7.push({ date: d, patients: p.patients, received: p.received });
  }
  const docStats = {};
  visits.filter(v => v.date >= month + "-01" && v.date <= today).forEach(v => {
    const n = v.doctorName || "No Doctor";
    docStats[n] = docStats[n] || { doctor: n, monthPatients: 0, monthBilled: 0, todayPatients: 0 };
    docStats[n].monthPatients++; docStats[n].monthBilled += Number(v.total) || 0;
    if (v.date === today) docStats[n].todayPatients++;
  });
  const expCats = {};
  expenses.filter(e => e.date >= month + "-01" && e.date <= today).forEach(e => { expCats[e.category] = (expCats[e.category] || 0) + (Number(e.amount) || 0); });
  const dues = visits.filter(v => Number(v.due) > 0).sort((a, b) => b.due - a.due).slice(0, 15)
    .map(v => ({ patient: v.patientName, mr: v.patientId, mobile: v.mobile || "", date: v.date, due: v.due }));
  const todayVisits = visits.filter(v => v.date === today).sort((a, b) => (a.token || 0) - (b.token || 0)).slice(0, 60)
    .map(v => ({ token: v.token, patient: v.patientName, doctor: v.doctorName || "-", total: v.total, received: v.received, due: v.due, status: v.status, time: v.time }));
  const lowStock = inv.filter(i => Number(i.stock) <= Number(i.reorder || 0)).map(i => ({ item: i.item, stock: i.stock, reorder: i.reorder }));
  return {
    clinic: { name: st.clinicName || code, address: st.address || "", phone: st.phone || "", timing: st.timing || "", currency: cur },
    today, month,
    todaySummary: per(today, today), monthSummary: per(month + "-01", today), last7Days: last7,
    totals: { patientsRegistered: patients.length, visitsAllTime: visits.length },
    doctors: doctors.map(d => ({ name: d.name, speciality: d.speciality || d.specialty || "", fee: d.opdFee || d.fee || "" })),
    doctorStats: Object.values(docStats), expensesThisMonthByCategory: expCats,
    topDues: dues, todayVisits,
    appointmentsToday: appts.filter(a => a.date === today).map(a => ({ time: a.time, patient: a.patientName, doctor: a.doctor, status: a.status })),
    leads: { total: leads.length, byStatus: leads.reduce((m, l) => (m[l.status] = (m[l.status] || 0) + 1, m), {}) },
    inventory: { items: inv.length, lowStock },
    staff: { count: staff.filter(s => s.status !== "Left").length, monthlyPayroll: sum(staff.filter(s => s.status === "Active"), s => s.salary) },
    labTests: tests.filter(t => t.active !== false).slice(0, 80).map(t => ({ name: t.name, type: t.type, price: t.price }))
  };
}

/* ---- offline mode: bina AI key ke seedhe jawab ---- */
function localAnswer(q, S) {
  const t = String(q || "").toLowerCase();
  const C = S.clinic.currency, M = n => C + " " + Math.round(n || 0).toLocaleString("en-US");
  const has = (...w) => w.some(x => t.includes(x));
  const T = S.todaySummary, Mo = S.monthSummary;
  if (has("due", "baqaya", "baaki", "udhaar", "udhar", "outstanding", "pending")) {
    if (!S.topDues.length) return "Koi due / baqaya raqam nahi hai. ✅";
    return "**Sab se zyada due (top " + S.topDues.length + "):**\n" +
      S.topDues.map(d => "- " + d.patient + " (" + d.mr + ") — **" + M(d.due) + "** — " + d.date + (d.mobile ? " — " + d.mobile : "")).join("\n") +
      "\n\nKul due (is list ka): **" + M(S.topDues.reduce((a, b) => a + b.due, 0)) + "**";
  }
  if (has("low stock", "stock", "dawai", "medicine", "inventory")) {
    return S.inventory.lowStock.length
      ? "**Kam stock wali cheezein:**\n" + S.inventory.lowStock.map(i => "- " + i.item + " — stock **" + i.stock + "** (reorder " + i.reorder + ")").join("\n")
      : "Inventory mein " + S.inventory.items + " items hain, koi bhi low stock nahi. ✅";
  }
  if (has("doctor", "dr.", "dr ")) {
    if (!S.doctorStats.length) return "Is mahine abhi tak kisi doctor ka koi patient record nahi hai.";
    return "**Doctor-wise (is mahine):**\n| Doctor | Aaj | Is mahine | Billing |\n|---|---|---|---|\n" +
      S.doctorStats.map(d => "| " + d.doctor + " | " + d.todayPatients + " | " + d.monthPatients + " | " + M(d.monthBilled) + " |").join("\n");
  }
  if (has("expense", "kharcha", "kharch", "akhrajat")) {
    const e = Object.entries(S.expensesThisMonthByCategory);
    return "**Is mahine ka kharcha: " + M(Mo.expenses) + "**" + (e.length ? "\n" + e.map(x => "- " + x[0] + ": " + M(x[1])).join("\n") : "");
  }
  if (has("profit", "munafa", "net", "faida")) {
    return "**Aaj ka net:** " + M(T.net) + "\n**Is mahine ka net:** " + M(Mo.net) + "\n(Received − Expenses)";
  }
  if (has("lead", "whatsapp", "inquiry")) {
    return "Kul leads: **" + S.leads.total + "**\n" + Object.entries(S.leads.byStatus).map(x => "- " + x[0] + ": " + x[1]).join("\n");
  }
  if (has("appointment", "apointment")) {
    return S.appointmentsToday.length
      ? "**Aaj ki appointments:**\n" + S.appointmentsToday.map(a => "- " + (a.time || "") + " " + a.patient + " → " + (a.doctor || "-") + " (" + a.status + ")").join("\n")
      : "Aaj koi appointment darj nahi.";
  }
  if (has("staff", "salary", "payroll", "tankhwah")) {
    return "Active staff: **" + S.staff.count + "**\nMonthly payroll: **" + M(S.staff.monthlyPayroll) + "**";
  }
  if (has("last 7", "7 din", "hafta", "week")) {
    return "**Pichle 7 din:**\n| Date | Patients | Received |\n|---|---|---|\n" + S.last7Days.map(d => "| " + d.date + " | " + d.patients + " | " + M(d.received) + " |").join("\n");
  }
  if (has("month", "mahina", "mahine", "monthly")) {
    return "**Is mahine ka khulasa:**\n- Patients: **" + Mo.patients + "**\n- Billing: **" + M(Mo.billed) + "**\n- Received: **" + M(Mo.received) + "**\n- Due: **" + M(Mo.due) + "**\n- Expenses: **" + M(Mo.expenses) + "**\n- Net: **" + M(Mo.net) + "**";
  }
  if (has("token", "visit", "patient", "mareez", "aaj", "today", "collection", "wasool", "amdan", "income", "received", "kitne")) {
    let out = "**Aaj (" + S.today + ") ka khulasa:**\n- Patients: **" + T.patients + "**\n- Billing: **" + M(T.billed) + "**\n- Received: **" + M(T.received) + "**\n- Due: **" + M(T.due) + "**\n- OPD " + M(T.opd) + " • Lab " + M(T.lab) + " • Ultrasound " + M(T.ultrasound) + "\n- Expenses: **" + M(T.expenses) + "** → Net **" + M(T.net) + "**";
    if (S.todayVisits.length && has("patient", "mareez", "token", "visit", "list"))
      out += "\n\n| Token | Patient | Doctor | Total | Status |\n|---|---|---|---|---|\n" + S.todayVisits.slice(0, 25).map(v => "| " + v.token + " | " + v.patient + " | " + v.doctor + " | " + M(v.total) + " | " + v.status + " |").join("\n");
    return out;
  }
  return "Main aap ke clinic ke database se jawab deta hoon. Aise poochein:\n- **Aaj kitni collection hui?**\n- **Aaj ke patients dikhao**\n- **Kis ka due baqaya hai?**\n- **Doctor-wise report**\n- **Is mahine ka kharcha / net**\n- **Low stock dawaiyan**\n- **Pichle 7 din**\n\n_(Offline mode — poori AI chat ke liye config.json mein Gemini ya Claude key lagayein.)_";
}

/* Gemini: ek model busy ho (503 "high demand", 429, timeout) to khud agla model try karta hai */
const GEMINI_FALLBACKS = ["gemini-3.5-flash-lite", "gemini-3.5-flash", "gemini-3.1-flash-lite", "gemini-3-flash", "gemini-flash-lite-latest", "gemini-flash-latest", "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash"];
const geminiBad = new Map();            /* band / ghalat model: naam -> kab tak skip karna hai */
let geminiList = { at: 0, models: [] }; /* Google se mili chalne wali models ki list (cache) */
const geminiVer = n => { const m = /gemini-(\d+(?:\.\d+)?)/.exec(n); return m ? parseFloat(m[1]) : 0; };
async function discoverGeminiModels() {
  if (Date.now() - geminiList.at < 6 * 3600 * 1000 && geminiList.models.length) return geminiList.models;
  try {
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": GEMINI_KEY }, signal: AbortSignal.timeout(6000) });
    const j = await r.json().catch(() => ({}));
    if (r.ok && Array.isArray(j.models)) {
      const list = j.models
        .filter(m => (m.supportedGenerationMethods || []).includes("generateContent"))
        .map(m => String(m.name || "").replace(/^models\//, ""))
        .filter(n => /^gemini-/.test(n) && /flash/.test(n) && !/image|tts|live|audio|embed|thinking|robotics|computer|-exp|vision-only|8b/.test(n))
        .sort((x, y) => (geminiVer(y) - geminiVer(x)) || ((/lite/.test(y) ? 1 : 0) - (/lite/.test(x) ? 1 : 0)) || (/preview/.test(x) ? 1 : 0) - (/preview/.test(y) ? 1 : 0));
      if (list.length) geminiList = { at: Date.now(), models: list };
    }
  } catch (e) { /* list na mili to static list chalegi */ }
  return geminiList.models;
}
async function geminiGenerate(body, opt) {
  opt = opt || {};
  const found = await discoverGeminiModels();
  const now = Date.now();
  const models = [GEMINI_MODEL].concat(found.slice(0, 6), GEMINI_FALLBACKS).filter((m, i, a) => m && a.indexOf(m) === i && !(geminiBad.get(m) > now)).slice(0, opt.maxModels || 6);
  if (!models.length) { geminiBad.clear(); models.push(GEMINI_MODEL, "gemini-flash-latest"); }
  let lastErr = "Gemini jawab nahi de saka";
  for (const model of models) {
    try {
      let b = body;
      /* photo padhne ke liye "thinking" ki zaroorat nahi — band karne se jawab tez aata hai */
      if (opt.fast && /^gemini-2\.5-flash/.test(model)) b = Object.assign({}, body, { generationConfig: Object.assign({}, body.generationConfig, { thinkingConfig: { thinkingBudget: 0 } }) });
      const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent", {
        method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_KEY },
        signal: AbortSignal.timeout(opt.timeoutMs || 14000), body: JSON.stringify(b)
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        const em = (j.error && j.error.message) || String(r.status);
        lastErr = "Gemini(" + model + "): " + em; console.error(lastErr);
        if (r.status === 404 || r.status === 400 || /no longer available|not found|not supported|deprecated/i.test(em)) geminiBad.set(model, Date.now() + 6 * 3600 * 1000);   /* band model 6 ghante skip */
        else if (r.status === 429 || r.status === 503) geminiBad.set(model, Date.now() + 60 * 1000);
        continue;
      }
      const ps = j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts;
      const t = ps && ps.map(p => p.text || "").join("");
      if (t) return t;
      lastErr = "Gemini(" + model + ") ne khali jawab diya"; console.error(lastErr);
    } catch (e) { lastErr = "Gemini(" + model + "): " + (e && (e.name === "TimeoutError" || e.name === "AbortError") ? "der lag gayi" : errMsg(e)); console.error(lastErr); }
  }
  throw new Error(lastErr);
}
async function askLLM(system, history, message) {
  const turns = (history || []).slice(-8).filter(h => h && h.text).map(h => ({ role: h.role === "assistant" ? "assistant" : "user", text: String(h.text).slice(0, 3000) }));
  if (GEMINI_KEY) {
    const contents = turns.map(h => ({ role: h.role === "assistant" ? "model" : "user", parts: [{ text: h.text }] }));
    contents.push({ role: "user", parts: [{ text: message }] });
    return await geminiGenerate({ systemInstruction: { parts: [{ text: system }] }, contents });
  }
  if (CLAUDE_KEY) {
    const messages = turns.map(h => ({ role: h.role, content: h.text }));
    messages.push({ role: "user", content: message });
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", headers: { "Content-Type": "application/json", "x-api-key": CLAUDE_KEY, "anthropic-version": "2023-06-01" },
      signal: AbortSignal.timeout(40000),
      body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 1200, system, messages })
    });
    const j = await r.json();
    if (!r.ok) throw new Error("Claude: " + ((j.error && j.error.message) || r.status));
    return (j.content || []).map(b => b.text || "").join("");
  }
  return null;
}

const SOFTWARE_GUIDE = [
  "Login: Clinic ID + username + password. Admin account clinic ke owner (Zain Ali) ne banaya hota hai.",
  "New Visit: patient ka naam, age, gender, mobile likhein, doctor chunein; Token No AUTOMATIC banta hai (har din, har doctor ka alag). Lab test / ultrasound add karke bill, discount aur received amount likhein, phir Save ya Save & Print.",
  "Patients: purane patient MR number / naam / mobile se search karein; EMR mein visit history aur clinical notes hain.",
  "Doctors: Doctors page par Add Doctor se naam, specialization, qualification, fee, shift aur PHOTO lagayein. Commission % bhi set ho sakta hai.",
  "Lab / Ultrasound: worklists aur test prices (Tests). Billing: bills, dues, cancel/delete (permission ke saath). Expenses: rozana kharcha. Reports: daily/monthly collection, doctor-wise, due reports, CSV aur Print.",
  "Users (sirf Admin): naye users (reception, doctor) banayein aur har module ki permission dein ya hatayein. Settings: clinic ka naam, address, timing, slip size, currency. Backup: data download/restore.",
  "Appointments, Leads, Inventory (low stock), Staff modules bhi hain. AI Agent clinic ke data se sawalon ke jawab deta hai.",
  "Software developer: " + DEV_CONTACT
].join("\n");
const SYSTEM_PROMPT = S =>
  "You are the AI assistant of " + S.clinic.name + " (a medical clinic management system built by Zain Ali). " +
  "You can ALSO explain how to use this software using the SOFTWARE GUIDE below. " +
  "For data questions answer ONLY from the CLINIC DATA JSON below. Never invent numbers, patients or names; if the data does not contain the answer, say so. " +
  "Reply in the same language/script the user writes in (English, Urdu, or Roman Urdu). Be short and clear. " +
  "Use Markdown: **bold** for key numbers, bullet lists, and tables with | when listing rows. Currency is " + S.clinic.currency + ". " +
  "Do NOT give medical diagnosis or treatment advice; for clinical questions say the attending doctor must decide.\n\nCLINIC DATA:\n" + JSON.stringify(S) + "\n\nSOFTWARE GUIDE:\n" + SOFTWARE_GUIDE;

/* ---- WhatsApp / n8n webhook (sirf public info, maali data nahi) ---- */
async function publicInfo(code) {
  const [doctors, tests, settingsArr] = await Promise.all(["doctors", "tests", "settings"].map(s => loadStore(code, s)));
  const st = settingsArr.find(x => x.key === "app") || {};
  return {
    clinic: { name: st.clinicName, address: st.address, phone: st.phone, timing: st.timing, email: st.email },
    doctors: doctors.filter(d => d.active !== false).map(d => ({ name: d.name, speciality: d.speciality || d.specialty || "", fee: d.opdFee || d.fee || "" })),
    tests: tests.filter(t => t.active !== false).map(t => ({ name: t.name, type: t.type, price: t.price })),
    currency: st.currency || "Rs."
  };
}
app.post("/api/agent/public", async (req, res) => {
  try {
    if (!WEBHOOK_KEY || req.get("x-webhook-key") !== WEBHOOK_KEY)
      return res.status(401).json({ error: "Webhook key galat ya set nahi (config.json mein webhookKey likhein)" });
    const code = cleanCode(req.get("x-clinic") || req.body.clinic);
    const c = await getClinic(code); const p = clinicProblem(c);
    if (p) return res.status(p.status).json({ error: p.msg });
    const message = String((req.body && req.body.message) || "").slice(0, 1500);
    if (!message) return res.status(400).json({ error: "message likhein" });
    const info = await publicInfo(code);
    const sys = "You are the WhatsApp front-desk assistant of " + info.clinic.name + ". Use ONLY this data: " + JSON.stringify(info) +
      ". Answer timing, address, doctors, test prices politely and briefly in the patient's language (English/Urdu/Roman Urdu). " +
      "Never share patient or financial data. To book an appointment, ask for name, phone, preferred doctor and time. No medical diagnosis.";
    let reply = null;
    try { reply = await askLLM(sys, req.body.history, message); } catch (e) { console.error("agent/public:", errMsg(e)); }
    if (!reply) reply = "Assalam o Alaikum! " + info.clinic.name + " — Address: " + info.clinic.address + " — Timing: " + info.clinic.timing + " — Phone: " + info.clinic.phone;
    res.json({ reply });
  } catch (e) { res.status(500).json({ error: errMsg(e) }); }
});

/* ============================================================
   Is line ke baad har API ke liye Clinic ID (X-Clinic header) zaroori hai
============================================================ */
app.use("/api", async (req, res, next) => {
  try {
    const code = cleanCode(req.get("x-clinic") || req.query.clinic);
    if (!validCode(code)) return res.status(403).json({ error: "Clinic ID missing. Dobara login karein." });
    const c = await getClinic(code);
    const p = clinicProblem(c);
    if (p) return res.status(p.status).json({ error: p.msg });
    req.clinic = code;
    const gm = req.path.match(/^\/(users|settings)(\/|$)/);
    if (gm && req.method !== "GET" && !isOwnerReq(req)) {
      let allow = false;
      if (gm[1] === "settings" && req.method === "PUT") {            /* sirf pehli dafa default settings banne dein */
        const [ex] = await pool.query("SELECT 1 FROM records WHERE clinic=? AND store='settings' LIMIT 1", [code]);
        allow = ex.length === 0;
      }
      if (!allow) return res.status(403).json({ error: "Users aur Settings sirf Owner badal sakta hai. Software provider se rabta karein: " + DEV_CONTACT });
    }
    next();
  } catch (e) { res.status(500).json({ error: errMsg(e) }); }
});


/* ---------- MEDICINE SCAN (camera photo -> auto-fill) ---------- */
async function askVision(system, images, prompt, opt) {
  opt = opt || {};
  const imgs = (images || []).slice(0, 3).map(i => ({ mime: String(i.mime || "image/jpeg"), data: String(i.data || "").replace(/^data:[^,]*,/, "") })).filter(i => i.data);
  if (!imgs.length) throw new Error("Photo nahi mili");
  let gemErr = null;
  if (GEMINI_KEY) {
    const parts = imgs.map(i => ({ inlineData: { mimeType: i.mime, data: i.data } })); parts.push({ text: prompt });
    try { return await geminiGenerate({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts }], generationConfig: { responseMimeType: "application/json" } }, { fast: true, timeoutMs: opt.timeoutMs, maxModels: Math.max(opt.maxModels || 0, 6) }); }
    catch (e) { if (!CLAUDE_KEY) throw e; gemErr = e; console.error("Gemini fail, Claude try:", errMsg(e)); }
  }
  if (CLAUDE_KEY) {
    const content = imgs.map(i => ({ type: "image", source: { type: "base64", media_type: i.mime, data: i.data } })); content.push({ type: "text", text: prompt });
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", headers: { "Content-Type": "application/json", "x-api-key": CLAUDE_KEY, "anthropic-version": "2023-06-01" },
      signal: AbortSignal.timeout(opt.timeoutMs ? opt.timeoutMs * 2 : 40000),
      body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: opt.maxTokens || 800, system, messages: [{ role: "user", content }] })
    });
    const j = await r.json();
    if (!r.ok) throw new Error("Claude: " + ((j.error && j.error.message) || r.status));
    return (j.content || []).map(b => b.text || "").join("");
  }
  throw new Error(IS_VERCEL
    ? "AI key set nahi hai. Vercel → Project → Settings → Environment Variables mein GEMINI_API_KEY (ya ANTHROPIC_API_KEY) daalein, phir Redeploy karein."
    : "AI key set nahi hai. config.json mein geminiKey ya anthropicKey likhein, phir server restart karein.");
}
function parseJsonLoose(raw) {
  let data = null;
  const t = String(raw || "").replace(/```json|```/g, "").trim();
  try { data = JSON.parse(t); } catch (e) { const m = t.match(/[\[{][\s\S]*[\]}]/); if (m) data = JSON.parse(m[0]); }
  return data;
}
const aiErrMsg = e => (e && (e.name === "TimeoutError" || e.name === "AbortError")) ? "AI abhi busy hai. 1 minute baad dobara try karein." : errMsg(e);

app.post("/api/scan-medicine", async (req, res) => {
  try {
    const cats = Array.isArray(req.body.categories) ? req.body.categories.slice(0, 80).map(x => String(x).slice(0, 60)) : [];
    const imgs = (Array.isArray(req.body.images) ? req.body.images : []).slice(0, 3);
    if (!imgs.length) throw new Error("Photo nahi mili");
    const sys = "You read ONE photo of medicine packaging (it may be the front, back, side flap, strip or bottle; often Pakistani products with English and Urdu text). " +
      "Extract the printed facts and reply with ONE JSON object only, no markdown. Use null for anything not clearly visible in THIS photo; never guess prices, batch or dates.";
    const prompt = "Return JSON with keys: " +
      "name (brand name exactly as printed, e.g. 'Dexpril 20mg'), " +
      "generic (active ingredient/formula with strength, e.g. 'Piroxicam-beta-cyclodextrin 20mg'), " +
      "category (pick EXACTLY one from this list, the closest dosage form: " + JSON.stringify(cats) + "), " +
      "company (manufacturer / marketed by), " +
      "batch (the value after 'Batch No.', 'B.No', 'B. No.', 'Batch', 'Lot' or 'LOT'; usually inkjet-printed on the side flap or bottom of the box; copy the letters and digits exactly), " +
      "mfgDate (value after 'Mfg.', 'Mfd', 'Mfg. Date', 'Manufacturing Date', 'M.D.'), " +
      "expiry (value after 'Exp.', 'Expiry', 'Exp. Date', 'Use before', 'E.D.'), " +
      "mfgDate and expiry must be YYYY-MM-DD; dates are often printed like 03/2027, 03-27, MAR 2027, 2027-03 or 03.2027 - if only month and year are printed use the LAST day of that month, " +
      "mrp (number: price after 'M.R.P.', 'MRP', 'Retail Price', 'Rs.' for the whole pack; digits only), " +
      "packUnits (integer, total tablets/capsules/ml-units in the pack, e.g. '20 Tablets' -> 20, '3x10' -> 30; for a bottle use the ml), " +
      "barcode (digits printed under a 1D barcode or next to a 2D DataMatrix/QR code as GTIN / EAN, digits only). " +
      "The batch/mfg/expiry/MRP labels may be on one line and the values on the next line or in a separate column next to the labels: match them in order. " +
      "If the labels are there but the print is too blurry or cut off, return null for that key.";
    const results = await Promise.all(imgs.map(async img => {
      try { return { d: parseJsonLoose(await askVision(sys, [img], prompt, { timeoutMs: 18000, maxModels: 3 })) }; }
      catch (e) { return { err: e }; }
    }));
    const okr = results.filter(r => r.d && typeof r.d === "object" && !Array.isArray(r.d));
    if (!okr.length) throw (results.find(r => r.err) || {}).err || new Error("Scan result samajh nahi aaya, dobara photo lein");
    const data = {};
    for (const r of okr) for (const k of Object.keys(r.d)) { const v = r.d[k]; if ((data[k] === undefined || data[k] === null || data[k] === "") && v !== null && v !== undefined && v !== "") data[k] = v; }
    res.json({ ok: true, data, photos: imgs.length, failed: results.length - okr.length });
  } catch (e) {
    const m = aiErrMsg(e);
    console.error("scan-medicine:", m);
    res.status(500).json({ error: m });
  }
});

/* ---------- BILL SCAN (supplier invoice photo -> lines) ---------- */
app.post("/api/scan-bill", async (req, res) => {
  try {
    const cats = Array.isArray(req.body.categories) ? req.body.categories.slice(0, 80).map(x => String(x).slice(0, 60)) : [];
    const img = req.body.image;
    if (!img || !img.data) throw new Error("Photo nahi mili");
    const sys = "You read ONE photograph, screenshot or scan of a purchase bill / invoice / challan / handwritten stock list that a pharmacy or medical store received from a supplier in Pakistan. " +
      "Bills come in MANY different layouts: thermal receipts, computer invoices, handwritten slips, English or Urdu, with or without batch / expiry / discount / tax columns. The photo may be slightly curved or tilted, with fingers or clutter around it. " +
      "Your job: work out what each column means (use the column headings when there are any, otherwise the position and the numbers), then read every product row. Reply with ONE JSON object only, no markdown. Use null for anything not clearly visible. Never invent numbers.";
    const prompt = "Return JSON with keys: " +
      "supplier (name of the SELLER shop / distributor / company, usually the big title at the top; the 'Customer' / 'Buyer' / 'Bill to' lines are the store receiving the goods, NOT the supplier; null if this photo has no header), " +
      "invoiceNo (invoice / bill / challan / 'Number' value; null if absent), " +
      "date (YYYY-MM-DD; dates in Pakistan are normally DAY/MONTH/YEAR; null if absent), " +
      "grandTotal (final net payable total as a number, only if visible in this photo, else null), " +
      "items (array, ONE entry per product row, in printed order). Each item has: " +
      "name (product name with strength / form as printed, without the manufacturer word; e.g. 'GEN-M 20/120 TAB'), " +
      "company (manufacturer or brand-owner word if printed, else null), " +
      "generic (formula if printed, else null), " +
      "category (EXACTLY one from this list, the closest dosage form, else null: " + JSON.stringify(cats) + "), " +
      "qty (THE MOST IMPORTANT FIELD: how many units/packs of this product the buyer received, from the Qty / Pcs / Packs / Box / Carton / Unit column; whole packs only; if both cartons and pieces are given, give the total in pieces and put the unit word in 'unit'), " +
      "bonus (free / bonus / scheme quantity, including notations like '2+1' or '2, +1' where the number after + is free, else 0), " +
      "loose (loose single units when the quantity is written as 'packs,units' without a plus sign, e.g. '0,1' means 0 packs and 1 loose unit; else 0), " +
      "qtyText (the exact text printed in the quantity cell, copied as is), " +
      "unit (unit word printed for the quantity such as pcs, box, strip, carton, bottle, else null), " +
      "rate (price of ONE pack before discount: columns like Rate, T.P, Trade Price, Price, Unit Price), " +
      "mrp (retail price of ONE pack: columns like MRP, M.R.P, Retail, R.P), " +
      "disc (discount percent of that row as a number, 0 if none), " +
      "amount (net amount of that row: Amount, Net, Value, Total of the row), " +
      "packUnits (tablets / capsules / ml in ONE pack ONLY if explicitly printed, else null), " +
      "batch (only if a batch / lot column exists, else null), " +
      "expiry (YYYY-MM-DD only if an expiry column exists; if only month and year, use the LAST day of that month; else null). " +
      "Rules: include medicines AND other goods (sprays, condoms, supplements, devices, baby items). Skip header rows, sub-totals, tax / discount summary rows, signatures and stray handwriting. " +
      "Numbers must be plain numbers without commas or currency symbols. A row's numbers sit on the same line or on the line(s) directly under its name; never mix them with the next row. " +
      "Read every row down to the bottom edge; skip a row only if it is physically cut off. If the photo is a continuation without the header, set supplier / invoiceNo / date to null. " +
      "If you are unsure about the layout, still return every product with at least name and qty.";
    const raw = await askVision(sys, [img], prompt, { timeoutMs: 28000, maxModels: 2, maxTokens: 6000 });
    const d = parseJsonLoose(raw);
    if (!d || typeof d !== "object") throw new Error("Bill samajh nahi aaya, dobara saaf photo lein");
    const items = (Array.isArray(d.items) ? d.items : []).slice(0, 80).filter(x => x && x.name).map(x => ({
      name: String(x.name).slice(0, 120), generic: x.generic ? String(x.generic).slice(0, 120) : null, category: x.category ? String(x.category).slice(0, 60) : null,
      company: x.company ? String(x.company).slice(0, 60) : null, qtyText: x.qtyText ? String(x.qtyText).slice(0, 30) : null, unit: x.unit ? String(x.unit).slice(0, 20) : null, qty: x.qty, loose: x.loose, bonus: x.bonus, packUnits: x.packUnits, rate: x.rate, mrp: x.mrp, disc: x.disc, amount: x.amount,
      batch: x.batch ? String(x.batch).slice(0, 40) : null, expiry: x.expiry ? String(x.expiry).slice(0, 10) : null
    }));
    res.json({ ok: true, data: { supplier: d.supplier || null, invoiceNo: d.invoiceNo || null, date: d.date || null, grandTotal: d.grandTotal, items } });
  } catch (e) {
    const m = aiErrMsg(e);
    console.error("scan-bill:", m);
    res.status(500).json({ error: m });
  }
});

app.post("/api/agent", async (req, res) => {
  try {
    const message = String((req.body && req.body.message) || "").slice(0, 1500).trim();
    if (!message) return res.status(400).json({ error: "Sawal likhein" });
    const S = await buildSnapshot(req.clinic);
    let reply = null, mode = "local", note = "";
    if (GEMINI_KEY || CLAUDE_KEY) {
      try { reply = await askLLM(SYSTEM_PROMPT(S), req.body.history, message); mode = "ai"; }
      catch (e) { note = errMsg(e); console.error("AI error:", note); }
    }
    if (!reply) reply = localAnswer(message, S);
    res.json({ reply, mode, note });
  } catch (e) { res.status(500).json({ error: errMsg(e) }); }
});
app.get("/api/agent/status", (req, res) => res.json({ ai: !!(GEMINI_KEY || CLAUDE_KEY), provider: GEMINI_KEY ? "Gemini" : CLAUDE_KEY ? "Claude" : "none" }));

/* ---------- full data ---------- */
app.get("/api/stores", async (req, res) => {
  try {
    const out = {};
    for (const s of STORES) out[s] = await loadStore(req.clinic, s);
    res.json(out);
  } catch (e) { res.status(500).json({ error: errMsg(e) }); }
});

/* ---------- MR / token sequence (atomic, har clinic ka alag) ---------- */
app.get("/api/seq/:key", async (req, res) => {
  try {
    const start = parseInt(req.query.start || "1", 10) || 1;
    const [rows] = await pool.query("SELECT cval FROM counters WHERE ckey=?", [ckey(req, req.params.key)]);
    res.json({ value: rows.length ? rows[0].cval + 1 : start });
  } catch (e) { res.status(500).json({ error: errMsg(e) }); }
});
app.post("/api/seq/:key", async (req, res) => {
  try {
    const start = parseInt((req.body && req.body.start) || "1", 10) || 1;
    const k = ckey(req, req.params.key);
    /* OFFLINE SYNC: device ne offline rehte hue "last" tak number diye — server counter ko kam az kam wahan tak le jao (number issue nahi hota) */
    if (req.body && req.body.last !== undefined) {
      const last = parseInt(req.body.last, 10) || 0;
      await pool.query("INSERT INTO counters (ckey,cval) VALUES (?,?) ON DUPLICATE KEY UPDATE cval=GREATEST(cval,VALUES(cval))", [k, last]);
      const [r2] = await pool.query("SELECT cval FROM counters WHERE ckey=?", [k]);
      return res.json({ value: r2[0].cval });
    }
    await pool.query("INSERT INTO counters (ckey,cval) VALUES (?,?) ON DUPLICATE KEY UPDATE cval=cval+1", [k, start]);
    const [rows] = await pool.query("SELECT cval FROM counters WHERE ckey=?", [k]);
    res.json({ value: rows[0].cval });
  } catch (e) { res.status(500).json({ error: errMsg(e) }); }
});

/* ---------- generic store APIs ---------- */
const okStore = (req, res) => { if (STORES.indexOf(req.params.store) < 0) { res.status(404).json({ error: "Unknown store" }); return false; } return true; };

app.get("/api/:store", async (req, res) => {
  if (!okStore(req, res)) return;
  try { res.json(await loadStore(req.clinic, req.params.store)); }
  catch (e) { res.status(500).json({ error: errMsg(e) }); }
});
app.get("/api/:store/:id", async (req, res) => {
  if (!okStore(req, res)) return;
  try {
    const [rows] = await pool.query("SELECT data FROM records WHERE clinic=? AND store=? AND id=?", [req.clinic, req.params.store, req.params.id]);
    res.json(rows.length ? parseRow(rows[0]) : null);
  } catch (e) { res.status(500).json({ error: errMsg(e) }); }
});
app.put("/api/:store", async (req, res) => {
  if (!okStore(req, res)) return;
  const id = recId(req.body);
  if (!id) return res.status(400).json({ error: "Record needs id or key" });
  try {
    await pool.query("INSERT INTO records (clinic,store,id,data) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE data=VALUES(data)",
      [req.clinic, req.params.store, id, JSON.stringify(req.body)]);
    res.json(req.body);
  } catch (e) { res.status(500).json({ error: errMsg(e) }); }
});
app.post("/api/:store/bulk", async (req, res) => {
  if (!okStore(req, res)) return;
  const arr = Array.isArray(req.body) ? req.body : [];
  try {
    for (const obj of arr) {
      const id = recId(obj); if (!id) continue;
      await pool.query("INSERT INTO records (clinic,store,id,data) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE data=VALUES(data)",
        [req.clinic, req.params.store, id, JSON.stringify(obj)]);
    }
    res.json({ saved: arr.length });
  } catch (e) { res.status(500).json({ error: errMsg(e) }); }
});
app.delete("/api/:store/:id", async (req, res) => {
  if (!okStore(req, res)) return;
  try {
    if (req.params.store === "users" && req.params.id === ADMIN_ID) return res.json({ ok: true });
    await pool.query("DELETE FROM records WHERE clinic=? AND store=? AND id=?", [req.clinic, req.params.store, req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: errMsg(e) }); }
});
app.delete("/api/:store", async (req, res) => {
  if (!okStore(req, res)) return;
  try {
    if (req.params.store === "users")
      await pool.query("DELETE FROM records WHERE clinic=? AND store='users' AND id<>?", [req.clinic, ADMIN_ID]);
    else
      await pool.query("DELETE FROM records WHERE clinic=? AND store=?", [req.clinic, req.params.store]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: errMsg(e) }); }
});

/* ---------- start ---------- */
if (IS_VERCEL || require.main !== module) {
  module.exports = app;            /* Vercel / serverless: app export, DB pehli request par connect hogi */
} else {
  (async () => {
    try {
      await initDB();
      app.listen(PORT, () => {
        console.log("==================================================");
        console.log(" ZainMed (Multi-Clinic) server RUNNING");
        console.log(" Frontend     : http://localhost:" + PORT + "/");
        console.log(" Master panel : http://localhost:" + PORT + "/master.html");
        console.log(" Database     : MySQL -> " + DB.database);
        console.log(" AI Agent     : " + (GEMINI_KEY ? "Gemini (" + GEMINI_MODEL + ")" : CLAUDE_KEY ? "Claude (" + CLAUDE_MODEL + ")" : "OFFLINE mode (AI key nahi lagi)"));
        if (MASTER_KEY === "ChangeMe@123") console.log(" WARNING      : config.json mein masterKey zaroor badal lein!");
        console.log(" Software developed by " + DEV_CONTACT);
        console.log("==================================================");
      });
    } catch (e) {
      console.error("DB CONNECTION FAILED:", e.message);
      console.error("Check karein: MySQL running hai? config.json / server.js mein DB user/password sahi hai?");
      process.exit(1);
    }
  })();
}
