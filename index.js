const express = require("express");
const twilio = require("twilio");

const app = express();
const PORT = process.env.PORT || 8080;

// ================================
// 📩 TWILIO CLIENT
// ================================
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// ================================
// 🔐 WAVE WEBHOOK (TEMP – NO VERIFICATION)
// ================================
app.post(
  "/webhooks/wave",
  express.raw({ type: "application/json" }),
  (req, res) => {
    console.log("🧪 TEMP WEBHOOK HIT");
    console.log("Wave-Signature:", req.headers["wave-signature"]);
    console.log("Raw body:", req.body.toString());
    res.sendStatus(200);
  }
);

// ================================
// GLOBAL JSON MIDDLEWARE
// ================================
app.use(express.json());

// ================================
// ROOT
// ================================
app.get("/", (req, res) => {
  res.send("🚀 Mavuno API is running");
});

// ================================
// HEALTH CHECK
// ================================
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "mavuno-api",
    time: new Date().toISOString()
  });
});

// ================================
// ORDER ACCEPTED
// ================================
app.post("/orders/accepted", async (req, res) => {
  const { orderId, amount, phone } = req.body;

  if (!orderId || !amount || !phone) {
    return res.status(400).json({
      error: "orderId, amount, and phone are required"
    });
  }

  try {
    const waveResponse = await fetch(
      "https://api.wave.com/v1/checkout/sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.WAVE_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          amount,
          currency: "GMD",
          client_reference: orderId,
          success_url: "https://your-site.com/payment-success",
          error_url: "https://your-site.com/payment-failed"
        })
      }
    );

    const waveData = await waveResponse.json();

    if (!waveResponse.ok) {
      return res.status(500).json({ error: "Wave error", details: waveData });
    }

    await twilioClient.messages.create({
      body: `Kafe Zola: Pay for order ${orderId}\n${waveData.wave_launch_url}`,
      from: process.env.TWILIO_FROM_NUMBER,
      to: phone
    });

    res.json({
      status: "payment_created",
      orderId,
      payment_url: waveData.wave_launch_url
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ================================
app.listen(PORT, () => {
  console.log(`🚀 Mavuno API listening on port ${PORT}`);
});
