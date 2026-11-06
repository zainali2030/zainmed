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
const crypto = require("crypto");

/* ---------- CONFIG: config.json ya environment variables ---------- */
let CFG = {};
try { CFG = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8")); } catch (e) { /* config.json optional */ }
const pick = (envName, key, def) => process.env[envName] || CFG[key] || def;

const PORT        = pick("PORT", "port", 4000);
const DB = {
  host:     pick("DB_HOST", "dbHost", "127.0.0.1"),
  user:     pick("DB_USER", "dbUser", "root"),
  password: pick("DB_PASS", "dbPass", ""),
  database: pick("DB_NAME", "dbName", "abraj_medical_center")
};
/* SSL / TLS: TiDB Cloud, Aiven, PlanetScale jaise online databases bina SSL ke connection nahi lete
   ("Connections using insecure transport are prohibited"). Cloud host ho to SSL khud on ho jata hai.
   Zabardasti on: DB_SSL=1   |   band karne ke liye: DB_SSL=0   (ya config.json mein "dbSsl") */
const _sslPref = String(pick("DB_SSL", "dbSsl", "auto")).toLowerCase();
const DB_USE_SSL = _sslPref === "1" || _sslPref === "true" || _sslPref === "yes" ||
  (_sslPref === "auto" && /(tidbcloud|aivencloud|psdb\.cloud|planetscale|\.rds\.amazonaws|azure\.com|neon\.tech|cockroachlabs)/i.test(DB.host));
/* Port: DB_PORT / config.json "dbPort"; TiDB Cloud ka port 4000 hota hai, baaqi ka 3306 */
const DB_PORT = parseInt(pick("DB_PORT", "dbPort", /tidbcloud/i.test(DB.host) ? "4000" : "3306"), 10) || 3306;
const DB_SSL_OPT = DB_USE_SSL ? { minVersion: "TLSv1.2", rejectUnauthorized: true } : undefined;
const MASTER_KEY  = pick("MASTER_KEY", "masterKey", "ChangeMe@123");   /* master panel ka password */
const MASTER_USER = pick("MASTER_USER", "masterUser", "owner");                  /* owner ka naam */
const WEBHOOK_KEY = pick("WEBHOOK_KEY", "webhookKey", "");               /* WhatsApp / n8n webhook ki key */
const GEMINI_KEY  = pick("GEMINI_API_KEY", "geminiKey", "");
const GEMINI_MODEL= pick("GEMINI_MODEL", "geminiModel", "gemini-flash-latest");
const CLAUDE_KEY  = pick("ANTHROPIC_API_KEY", "anthropicKey", "");
const CLAUDE_MODEL= pick("ANTHROPIC_MODEL", "anthropicModel", "claude-haiku-5-5");
const TZ          = pick("CLINIC_TZ", "timezone", "Asia/Karachi");
const DEV_CONTACT = "Zain Ali — 03702906075 — zainaliofficialtrada343@gmail.com";

const STORES = ["patients","visits","doctors","tests","payments","expenses","users","settings","audit","counters",
                "appointments","leads","inventory","staff","sales"];
const ALL_PERMS = ["dashboard","newvisit","patients","emr","doctors","lab","ultrasound","injection","billing","expenses","reports",
                   "appointments","leads","inventory","staff","agent","users","settings","backup","delete","pharmacy"];
const DEFAULT_CLINIC = "abraj";
const ADMIN_ID = "usr_faheem_admin";

let pool = null;

/* ---------- helpers ---------- */
const todayStr = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ });
const parseRow = r => { try { return JSON.parse(r.data); } catch (e) { return null; } };
const recId = obj => String(obj && obj.id !== undefined ? obj.id : (obj && obj.key !== undefined ? obj.key : ""));
const hashPassword = async password => {
  const salt=crypto.randomBytes(16);
  const key=await new Promise((resolve,reject)=>crypto.scrypt(String(password),salt,64,(e,k)=>e?reject(e):resolve(k)));
  return "scrypt$"+salt.toString("base64url")+"$"+Buffer.from(key).toString("base64url");
};
const verifyPassword = async (password,stored) => {
  const s=String(stored||"");
  if(!s.startsWith("scrypt$"))return s===String(password);
  const parts=s.split("$");if(parts.length!==3)return false;
  try{const salt=Buffer.from(parts[1],"base64url"),expected=Buffer.from(parts[2],"base64url");const actual=await new Promise((resolve,reject)=>crypto.scrypt(String(password),salt,expected.length,(e,k)=>e?reject(e):resolve(k)));return expected.length===actual.length&&crypto.timingSafeEqual(expected,actual)}catch(e){return false}
};

const errMsg = e => String((e && e.message) || e);
const cleanCode = s => String(s || "").trim().toLowerCase();
const validCode = s => /^[a-z0-9_-]{2,30}$/.test(s);
const ckey = (req, key) => (req.clinic === DEFAULT_CLINIC ? key : req.clinic + ":" + key);

/* ---------- Database + tables + purani data ki migration ---------- */
async function initDB() {
  const conn = await mysql.createConnection({ host: DB.host, user: DB.user, password: DB.password, ssl: DB_SSL_OPT, port: DB_PORT });
  await conn.query("CREATE DATABASE IF NOT EXISTS `" + DB.database + "` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
  await conn.end();
  pool = mysql.createPool({ host: DB.host, user: DB.user, password: DB.password, database: DB.database,
                            ssl: DB_SSL_OPT, port: DB_PORT,
                            connectionLimit: 10, charset: "utf8mb4_unicode_ci" });

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

  await pool.query("CREATE TABLE IF NOT EXISTS auth_sessions (token_hash CHAR(64) NOT NULL PRIMARY KEY, clinic VARCHAR(40) NOT NULL, user_id VARCHAR(64) NOT NULL, expires_at DATETIME NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX idx_auth_user (clinic,user_id), INDEX idx_auth_exp (expires_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

  await pool.query(
    "CREATE TABLE IF NOT EXISTS clinics (" +
    "code VARCHAR(40) NOT NULL PRIMARY KEY, " +
    "name VARCHAR(200) NOT NULL, " +
    "address VARCHAR(300) NOT NULL DEFAULT '', " +
    "phone VARCHAR(60) NOT NULL DEFAULT '', " +
    "admin_user VARCHAR(60) NOT NULL, " +
    "admin_pass VARCHAR(255) NOT NULL, " +
    "active TINYINT NOT NULL DEFAULT 1, " +
    "expiry DATE NULL, " +
    "note VARCHAR(300) NOT NULL DEFAULT '', " +
    "created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
  await pool.query("ALTER TABLE clinics MODIFY admin_pass VARCHAR(255) NOT NULL");

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
  let password=String(c.admin_pass||"");
  if(!password.startsWith("scrypt$")){
    password=await hashPassword(password);
    await pool.query("UPDATE clinics SET admin_pass=? WHERE code=?",[password,c.code]);
  }
  const user = {
    id: ADMIN_ID, username: c.admin_user, password,
    fullName: c.admin_user + " (Administrator)", role: "admin",
    permissions: ALL_PERMS.slice(), active: true, createdAt: "2025-01-01T00:00:00.000Z"
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
    "SELECT code,name,address,phone,admin_user,active,DATE_FORMAT(expiry,'%Y-%m-%d') AS expiry,note FROM clinics WHERE code=?", [code]);
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
app.use(express.json({ limit: "25mb" }));
/* SECURITY: sirf ye files browser ko milengi (config.json, server.js waghera kabhi nahi) */
const PUBLIC_FILES = new Set(["index.html","master.html","login-bg.jpg","manifest.json","sw.js","icon-192.png","icon-512.png"]);
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/:f", (req, res, next) => PUBLIC_FILES.has(req.params.f) ? res.sendFile(path.join(__dirname, req.params.f)) : next());

/* ---------- PUBLIC routes (clinic ID ki zaroorat nahi) ---------- */
app.get("/api/ping", (req, res) => res.json({ ok: true, service: "ZainMed API", time: new Date().toISOString() }));

app.get("/api/clinic/:code", async (req, res) => {
  try {
    const code = cleanCode(req.params.code);
    if (!validCode(code)) return res.status(404).json({ error: "Clinic ID galat hai. Dobara check karein." });
    const c = await getClinic(code);
    const p = clinicProblem(c);
    if (p) return res.status(p.status).json({ error: p.msg });
    res.json({ code: c.code, name: c.name, address: c.address, phone: c.phone, adminUser: c.admin_user, expiry: c.expiry });
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
      "SELECT code,name,address,phone,admin_user,active,DATE_FORMAT(expiry,'%Y-%m-%d') AS expiry,note," +
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
    if (!String(b.name || "").trim()) return res.status(400).json({ error: "Clinic ka naam likhein" });
    if (!String(b.adminUser || "").trim() || !String(b.adminPass || "").trim())
      return res.status(400).json({ error: "Admin username aur password likhein" });
    const [ex] = await pool.query("SELECT code FROM clinics WHERE code=?", [code]);
    if (ex.length) return res.status(409).json({ error: "Ye Clinic ID pehle se maujood hai" });
    await pool.query(
      "INSERT INTO clinics (code,name,address,phone,admin_user,admin_pass,active,expiry,note) VALUES (?,?,?,?,?,?,1,?,?)",
      [code, String(b.name).trim(), String(b.address || "").trim(), String(b.phone || "").trim(),
       String(b.adminUser).trim(), await hashPassword(String(b.adminPass).trim()), b.expiry || null, String(b.note || "").trim()]);
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
    const adminPass = b.adminPass ? await hashPassword(String(b.adminPass).trim()) : c.admin_pass;
    const active = b.active !== undefined ? (b.active ? 1 : 0) : c.active;
    const note = b.note !== undefined ? String(b.note).trim() : c.note;
    const expiry = b.expiry !== undefined ? (b.expiry || null) : null;
    if (b.expiry !== undefined)
      await pool.query("UPDATE clinics SET name=?,address=?,phone=?,admin_user=?,admin_pass=?,active=?,note=?,expiry=? WHERE code=?",
        [name, address, phone, adminUser, adminPass, active, note, expiry, code]);
    else
      await pool.query("UPDATE clinics SET name=?,address=?,phone=?,admin_user=?,admin_pass=?,active=?,note=? WHERE code=?",
        [name, address, phone, adminUser, adminPass, active, note, code]);
    clinicCache.delete(code);
    await syncAdmin({ code, admin_user: adminUser, admin_pass: adminPass });
    if(b.adminPass){
      const [ar]=await pool.query("SELECT data FROM records WHERE clinic=? AND store='users' AND id=?",[code,ADMIN_ID]);
      if(ar.length){const au=parseRow(ar[0]);au.password=adminPass;au.username=adminUser;await pool.query("UPDATE records SET data=? WHERE clinic=? AND store='users' AND id=?",[JSON.stringify(au),code,ADMIN_ID]);}
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: errMsg(e) }); }
});

/* ---------- USER AUTHENTICATION + SERVER-SIDE ROLE ENFORCEMENT ---------- */
const ROLE_DEFAULTS = {
  admin: ALL_PERMS,
  doctor: ["dashboard","patients","emr","reports"],
  reception: ["dashboard","newvisit","patients","emr","billing","lab","ultrasound","injection"],
  medical_store: ["dashboard","inventory","pharmacy","billing"]
};
const hashToken = token => crypto.createHash("sha256").update(token).digest("hex");
app.post("/api/auth/login", async (req,res) => {
  try {
    const code=cleanCode(req.get("x-clinic")||req.body.clinic||"");
    const c=await getClinic(code);const problem=clinicProblem(c);
    if(problem)return res.status(problem.status).json({error:problem.msg});
    const username=String(req.body.username||"").trim().toLowerCase();
    const password=String(req.body.password||"");
    if(!username||!password)return res.status(400).json({error:"Username aur password zaroori hain"});
    const [rows]=await pool.query("SELECT data FROM records WHERE clinic=? AND store='users'",[code]);
    const user=rows.map(parseRow).filter(Boolean).find(x=>String(x.username||"").toLowerCase()===username);
    if(!user||user.active===false||!(await verifyPassword(password,user.password)))return res.status(401).json({error:"Username ya password ghalat hai"});
    if(!String(user.password||"").startsWith("scrypt$")){user.password=await hashPassword(password);await pool.query("UPDATE records SET data=? WHERE clinic=? AND store='users' AND id=?",[JSON.stringify(user),code,user.id]);}
    const token=crypto.randomBytes(32).toString("base64url");
    await pool.query("INSERT INTO auth_sessions (token_hash,clinic,user_id,expires_at) VALUES (?,?,?,DATE_ADD(NOW(),INTERVAL 12 HOUR))",[hashToken(token),code,user.id]);
    const permissions=user.role==="admin"?ALL_PERMS:(Array.isArray(user.permissions)?user.permissions:(ROLE_DEFAULTS[user.role]||[]));
    res.json({token,user:{id:user.id,username:user.username,fullName:user.fullName,role:user.role,permissions,active:user.active!==false}});
  } catch(e){res.status(500).json({error:errMsg(e)});}
});
app.post("/api/auth/logout", async(req,res)=>{try{const t=String(req.get("authorization")||"").replace(/^Bearer\s+/i,"");if(t)await pool.query("DELETE FROM auth_sessions WHERE token_hash=?",[hashToken(t)]);res.json({ok:true})}catch(e){res.status(500).json({error:errMsg(e)})}});

app.delete("/api/master/clinics/:code", masterAuth, async (req,res)=>{
  const code=cleanCode(req.params.code);if(!validCode(code))return res.status(400).json({error:"Invalid clinic ID"});
  const conn=await pool.getConnection();try{await conn.beginTransaction();await conn.query("DELETE FROM records WHERE clinic=?",[code]);await conn.query("DELETE FROM auth_sessions WHERE clinic=?",[code]);await conn.query("DELETE FROM clinics WHERE code=?",[code]);await conn.commit();clinicCache.delete(code);res.json({ok:true,deleted:code})}catch(e){await conn.rollback();res.status(500).json({error:errMsg(e)})}finally{conn.release()}
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

async function askLLM(system, history, message) {
  const turns = (history || []).slice(-8).filter(h => h && h.text).map(h => ({ role: h.role === "assistant" ? "assistant" : "user", text: String(h.text).slice(0, 3000) }));
  if (GEMINI_KEY) {
    const contents = turns.map(h => ({ role: h.role === "assistant" ? "model" : "user", parts: [{ text: h.text }] }));
    contents.push({ role: "user", parts: [{ text: message }] });
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(GEMINI_MODEL) + ":generateContent", {
      method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_KEY },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents })
    });
    const j = await r.json();
    if (!r.ok) throw new Error("Gemini: " + ((j.error && j.error.message) || r.status));
    const parts = j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts;
    const text = parts && parts.map(p => p.text || "").join("");
    if (!text) throw new Error("Gemini ne khali jawab diya");
    return text;
  }
  if (CLAUDE_KEY) {
    const messages = turns.map(h => ({ role: h.role, content: h.text }));
    messages.push({ role: "user", content: message });
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", headers: { "Content-Type": "application/json", "x-api-key": CLAUDE_KEY, "anthropic-version": "2023-06-01" },
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
    const isMaster=isOwnerReq(req);
    const bearer=String(req.get("authorization")||"").replace(/^Bearer\s+/i,"");
    if(!isMaster){
      if(!bearer)return res.status(401).json({error:"Login session missing. Dobara login karein."});
      const [ss]=await pool.query("SELECT user_id FROM auth_sessions WHERE token_hash=? AND clinic=? AND expires_at>NOW()",[hashToken(bearer),code]);
      if(!ss.length)return res.status(401).json({error:"Login session expire ho gaya. Dobara login karein."});
      const [ur]=await pool.query("SELECT data FROM records WHERE clinic=? AND store='users' AND id=?",[code,ss[0].user_id]);
      const su=ur.length?parseRow(ur[0]):null;
      if(!su||su.active===false)return res.status(403).json({error:"User account disabled hai"});
      req.sessionUser=su;
      const perms=su.role==="admin"?ALL_PERMS:(Array.isArray(su.permissions)?su.permissions:(ROLE_DEFAULTS[su.role]||[]));
      const route=req.path.split("/").filter(Boolean)[0]||"";
      const map={patients:"patients",visits:"newvisit",doctors:"doctors",tests:"lab",inventory:"inventory",sales:"pharmacy",expenses:"expenses",payments:"billing",appointments:"appointments",leads:"leads",staff:"staff",audit:"users",users:"users",settings:"settings"};
      let needed=map[route];
      if(route==="tests"&&req.body&&(req.body.type==="injection"||/injection|drip/i.test(String(req.body.category||""))))needed="injection";
      if(needed&&req.method!=="GET"&&!perms.includes(needed))return res.status(403).json({error:"Is module ki permission aap ke account mein nahi hai"});
      if(req.method==="DELETE"&&!perms.includes("delete"))return res.status(403).json({error:"Delete permission required"});
      if(req.path.startsWith("/agent")&&!perms.includes("agent"))return res.status(403).json({error:"AI Agent permission required"});
    }
    const gm = req.path.match(/^\/(users|settings)(\/|$)/);
    if (gm && req.method !== "GET" && !isMaster) {
      const perms=req.sessionUser&&req.sessionUser.role==="admin"?ALL_PERMS:(req.sessionUser&&req.sessionUser.permissions||[]);
      if(!perms.includes(gm[1]))return res.status(403).json({error:"Users aur Settings ke liye Admin permission zaroori hai"});
    }
    next();
  } catch (e) { res.status(500).json({ error: errMsg(e) }); }
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
    const su=req.sessionUser;const perms=su&&su.role==="admin"?ALL_PERMS:(su&&su.permissions||[]);
    for (const s of STORES) {
      const rp={patients:"patients",visits:"emr",doctors:"doctors",tests:"lab",payments:"billing",expenses:"expenses",users:"users",settings:"settings",audit:"users",appointments:"appointments",leads:"leads",inventory:"inventory",staff:"staff",sales:"pharmacy"}[s];
      if(rp&&!perms.includes(rp)){out[s]=[];continue;}
      out[s]=await loadStore(req.clinic,s);
      if(s==="users")out[s]=out[s].map(u=>{const v={...u};delete v.password;return v;});
    }
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
  try {
    const store=req.params.store;
    if(!isOwnerReq(req)){
      const su=req.sessionUser;const perms=su&&su.role==="admin"?ALL_PERMS:(su&&su.permissions||[]);
      if(store==="users"&&!perms.includes("users"))return res.json(su?[{id:su.id,username:su.username,fullName:su.fullName,role:su.role,permissions:su.permissions||[],active:su.active!==false}]:[]);
      if(store==="audit"&&!perms.includes("users"))return res.json([]);
      const readPerm={inventory:"inventory",sales:"pharmacy",expenses:"expenses",payments:"billing",appointments:"appointments",leads:"leads",staff:"staff",doctors:"doctors",tests:"lab",patients:"patients",visits:"emr"}[store];
      const workflowRead=(store==="doctors"&&perms.includes("newvisit"))||(store==="tests"&&perms.includes("newvisit"))||(store==="inventory"&&(perms.includes("newvisit")||perms.includes("emr")));
      if(readPerm&&!perms.includes(readPerm)&&!workflowRead&&!(store==="visits"&&perms.includes("newvisit")))return res.json([]);
    }
    const data=await loadStore(req.clinic, store);
    res.json(data);
  } catch (e) { res.status(500).json({ error: errMsg(e) }); }
});
app.get("/api/:store/:id", async (req, res) => {
  if (!okStore(req, res)) return;
  try {
    if(!isOwnerReq(req)&&req.sessionUser){
      const perms=req.sessionUser.role==="admin"?ALL_PERMS:(req.sessionUser.permissions||[]);
      const rp={patients:"patients",visits:"emr",doctors:"doctors",tests:"lab",inventory:"inventory",sales:"pharmacy",expenses:"expenses",payments:"billing",users:"users",settings:"settings"}[req.params.store];
      if(rp&&!perms.includes(rp)&&!(req.params.store==="doctors"&&perms.includes("newvisit"))&&!(req.params.store==="tests"&&perms.includes("newvisit"))&&!(req.params.store==="visits"&&perms.includes("newvisit")))return res.json(null);
      if(req.params.store==="users"&&!perms.includes("users")&&req.sessionUser.id!==req.params.id)return res.json(null);
    }
    const [rows] = await pool.query("SELECT data FROM records WHERE clinic=? AND store=? AND id=?", [req.clinic, req.params.store, req.params.id]);
    const record=rows.length?parseRow(rows[0]):null;if(record&&req.params.store==="users")delete record.password;res.json(record);
  } catch (e) { res.status(500).json({ error: errMsg(e) }); }
});
app.put("/api/:store", async (req, res) => {
  if (!okStore(req, res)) return;
  const id = recId(req.body);
  if (!id) return res.status(400).json({ error: "Record needs id or key" });
  try {
    let record=req.body;
    if(req.params.store==="users"){
      const [old]=await pool.query("SELECT data FROM records WHERE clinic=? AND store='users' AND id=?",[req.clinic,id]);
      const prior=old.length?parseRow(old[0]):{};record={...prior,...req.body};
      if(record.password&&!String(record.password).startsWith("scrypt$"))record.password=await hashPassword(record.password);
      if(!record.password)return res.status(400).json({error:"New user password required"});
    }
    await pool.query("INSERT INTO records (clinic,store,id,data) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE data=VALUES(data)",
      [req.clinic, req.params.store, id, JSON.stringify(record)]);
    if(req.params.store==="users")delete record.password;
    res.json(record);
  } catch (e) { res.status(500).json({ error: errMsg(e) }); }
});
app.post("/api/:store/bulk", async (req, res) => {
  if (!okStore(req, res)) return;
  const arr = Array.isArray(req.body) ? req.body : [];
  try {
    for (const obj of arr) {
      const id = recId(obj); if (!id) continue;
      let record=obj;
      if(req.params.store==="users"){
        const [old]=await pool.query("SELECT data FROM records WHERE clinic=? AND store='users' AND id=?",[req.clinic,id]);
        record={...(old.length?parseRow(old[0]):{}),...obj};
        if(record.password&&!String(record.password).startsWith("scrypt$"))record.password=await hashPassword(record.password);
        if(!record.password)continue;
      }
      await pool.query("INSERT INTO records (clinic,store,id,data) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE data=VALUES(data)",
        [req.clinic, req.params.store, id, JSON.stringify(record)]);
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
