const express = require("express");
const crypto = require("crypto");
const twilio = require("twilio");

const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const { Pool } = require("pg");

const dbPath = path.join(__dirname, "data", "mavuno.db");
const db = new sqlite3.Database(dbPath);
const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
    require: true
  }
});

// create payments table if not exists
db.run(`
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT,
  amount REAL,
  status TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
`);
pgPool.query(`
CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  order_id TEXT,
  amount NUMERIC,
  status TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
`)
.then(() => console.log("✅ PG connected"))
.catch(err => console.error("❌ PG table init error", err));

const app = express();
const PORT = process.env.PORT || 8080;

/* ================================
   TWILIO CLIENT
================================ */
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

/* =====================================================
   WAVE WEBHOOK — VERIFIED + TIMESTAMP PROTECTION
===================================================== */
app.post(
  "/webhooks/wave",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      const signatureHeader = req.headers["wave-signature"];
      if (!signatureHeader) {
        console.error("❌ Missing Wave-Signature header");
        return res.sendStatus(401);
      }

      const parts = signatureHeader.split(",");
      const timestamp = parts.find(p => p.startsWith("t="))?.split("=")[1];
      const receivedSignature = parts.find(p => p.startsWith("v1="))?.split("=")[1];

      if (!timestamp || !receivedSignature) {
        console.error("❌ Invalid Wave-Signature format");
        return res.sendStatus(401);
      }

      // ✅ Anti-replay: reject if older than 5 minutes
      const now = Math.floor(Date.now() / 1000);
      if (Math.abs(now - Number(timestamp)) > 300) {
        console.error("❌ Wave webhook expired");
        return res.sendStatus(401);
      }

      const rawBody = req.body.toString();
      const signedPayload = timestamp + rawBody;

      const expectedSignature = crypto
        .createHmac("sha256", process.env.WAVE_WEBHOOK_SECRET)
        .update(signedPayload)
        .digest("hex");

      if (expectedSignature !== receivedSignature) {
        console.error("❌ Invalid Wave signature");
        return res.sendStatus(401);
      }

      const event = JSON.parse(rawBody);
      console.log("🔐 Wave webhook VERIFIED");

      if (
        (event.type === "checkout.session.completed" ||
         event.type === "merchant.payment_received") &&
        event.data?.payment_status === "succeeded"
      ) {
        const orderId = event.data.client_reference;
const amount = event.data.amount;

console.log(`✅ PAYMENT CONFIRMED: ${orderId}`);

// save payment to SQLite
db.run(
  `INSERT INTO payments (order_id, amount, status)
   VALUES (?, ?, ?)`,
  [orderId, amount, "paid"]
);
        pgPool.query(
  `INSERT INTO payments (order_id, amount, status)
   VALUES ($1, $2, $3)`,
  [orderId, amount, "paid"]
).catch(err => console.error("❌ PG insert error", err));

await twilioClient.messages.create({
  body: `✅ PAYMENT RECEIVED\nOrder: ${orderId}\nAmount: D${amount}`,
  from: process.env.TWILIO_FROM_NUMBER,
  to: process.env.OWNER_PHONE_NUMBER
});
      }

      return res.sendStatus(200);

    } catch (err) {
      console.error("❌ Webhook error", err);
      return res.sendStatus(500);
    }
  }
);

/* ================================
   JSON MIDDLEWARE
================================ */
app.use(express.json());

/* =====================================================
   GLORIA ACCEPTED ORDER — AUTH + SOURCE + VALIDATION
===================================================== */
app.post("/gloria/accepted", async (req, res) => {
  try {

    const authorizationHeader = req.headers["authorization"];

    // ✅ Verify Gloria secret
    if (!authorizationHeader || authorizationHeader !== process.env.GLORIA_MASTER_KEY) {
      console.error("❌ Invalid Gloria authentication");
      return res.sendStatus(401);
    }

    // ✅ Verify request is from Gloria system
    const ua = req.headers["user-agent"] || "";
    if (!ua.includes("GF Accepted Orders")) {
      console.error("❌ Invalid Gloria source");
      return res.sendStatus(401);
    }

    const order = req.body;
    const orderData = order.orders?.[0];

    const orderId = orderData?.id;
    const amount = orderData?.total_price;
    const phone = orderData?.client_phone;

    if (!orderId || !amount || !phone) {
      console.error("❌ Missing order data");
      return res.sendStatus(400);
    }

    // ✅ Phone format validation
    if (!/^\+?\d{7,15}$/.test(phone)) {
      console.error("❌ Invalid phone format");
      return res.sendStatus(400);
    }

    // Create Wave checkout
    const cleanAmount = parseFloat(amount);

    const waveResponse = await fetch(
      "https://api.wave.com/v1/checkout/sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.WAVE_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          amount: cleanAmount.toString(),
          currency: "GMD",
          client_reference: orderId,
          success_url: "https://kafezolagambia.com/",
          error_url: "https://kafezolagambia.com/"
        })
      }
    );

    const waveData = await waveResponse.json();

    if (!waveResponse.ok) {
      console.error("❌ Wave error:", waveData);
      return res.sendStatus(500);
    }

    const paymentUrl = waveData.wave_launch_url;

    await twilioClient.messages.create({
      body: `Kafe Zola: Pay for order ${orderId}\n${paymentUrl}`,
      from: process.env.TWILIO_FROM_NUMBER,
      to: phone
    });

    console.log("📲 Payment link sent to customer");

    return res.sendStatus(200);

  } catch (err) {
    console.error("❌ Gloria webhook error", err);
    return res.sendStatus(500);
  }
});

/* ================================
   ROOT
================================ */
app.get("/", (req, res) => {
  res.send("🚀 Mavuno API is running");
});

/* ================================
   ADMIN PAYMENTS (SECURE)
================================ */
app.get("/admin/payments", async (req, res) => {
  const key = req.query.key;

  if (!key || key !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({ error: "unauthorized" });
  }

  try {
    const result = await pgPool.query(
      "SELECT * FROM payments ORDER BY id DESC"
    );
    res.json(result.rows);
  } catch (err) {
    console.error("❌ Admin PG read error", err);
    res.status(500).json({ error: "db_read_failed" });
  }
});

/* ================================
   HEALTH CHECK
================================ */
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

/* ================================
   START SERVER
================================ */
app.listen(PORT, () => {
  console.log(`🚀 Mavuno API listening on port ${PORT}`);
});
