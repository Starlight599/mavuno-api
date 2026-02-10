const express = require("express");
const twilio = require("twilio");
const crypto = require("crypto");

// Node 18+ has fetch built-in (DigitalOcean App Platform supports this)
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
// 🔐 WAVE WEBHOOK (TEMP – INSPECTION MODE)
// MUST BE BEFORE express.json()
// ================================
app.post(
  "/webhooks/wave",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const signatureHeader = req.headers["wave-signature"];

    console.log("🔍 Wave-Signature header:", signatureHeader);

    if (!signatureHeader) {
      console.error("❌ Missing Wave signature header");
      return res.sendStatus(401);
    }

    // TEMP: accept webhook to inspect payload + signature format
    const event = JSON.parse(req.body.toString());

    console.log("🧪 TEMP webhook payload accepted");
    console.log(JSON.stringify(event, null, 2));

    res.sendStatus(200);
  }
);

// ================================
// 🔧 GLOBAL JSON MIDDLEWARE
// ================================
app.use(express.json());

// ================================
// ROOT ENDPOINT
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
// ORDER ACCEPTED ENDPOINT
// ================================
app.post("/orders/accepted", async (req, res) => {
  const { orderId, amount, phone } = req.body;

  console.log("📦 Order accepted", { orderId, amount, phone });

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
      return res.status(500).json({
        error: "Wave payment creation failed",
        details: waveData
      });
    }

    console.log("💳 Wave payment created", {
      orderId,
      payment_url: waveData.wave_launch_url
    });

    let smsSent = false;

    try {
      await twilioClient.messages.create({
        body: `Kafe Zola: Your order ${orderId} is ready for payment.\nPay here: ${waveData.wave_launch_url}`,
        from: process.env.TWILIO_FROM_NUMBER,
        to: phone
      });

      smsSent = true;
      console.log("📩 SMS sent to", phone);
    } catch (smsError) {
      console.error("❌ SMS failed", smsError.message);
    }

    return res.json({
      status: "payment_created",
      orderId,
      payment_url: waveData.wave_launch_url,
      sms_sent: smsSent
    });

  } catch (error) {
    console.error("❌ Wave error", error);
    return res.status(500).json({
      error: "Failed to create Wave payment"
    });
  }
});

// ================================
// START SERVER
// ================================
app.listen(PORT, () => {
  console.log(`🚀 Mavuno API listening on port ${PORT}`);
});
