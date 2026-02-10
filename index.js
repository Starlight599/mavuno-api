const express = require("express");
const twilio = require("twilio");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 8080;

// ================================
// 📩 TWILIO CLIENT
// ================================
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// ======================================================
// 🔐 WAVE WEBHOOK — SIGNED & CORRECT (MUST BE FIRST)
// ======================================================
app.post(
  "/webhooks/wave",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      const signatureHeader = req.headers["wave-signature"];

      if (!signatureHeader) {
        console.error("❌ Missing Wave signature header");
        return res.sendStatus(401);
      }

      // Expected format: t=TIMESTAMP,v1=HEX_SIGNATURE
      const parts = Object.fromEntries(
        signatureHeader.split(",").map(p => p.split("="))
      );

      const timestamp = parts.t;
      const receivedSignature = parts.v1;

      if (!timestamp || !receivedSignature) {
        console.error("❌ Invalid Wave signature format");
        return res.sendStatus(401);
      }

      // Wave signs: `${timestamp}.${rawBody}`
      const payload = `${timestamp}.${req.body.toString()}`;

      const expectedSignature = crypto
        .createHmac("sha256", process.env.WAVE_WEBHOOK_SECRET)
        .update(payload)
        .digest("hex");

      const isValid =
        receivedSignature.length === expectedSignature.length &&
        crypto.timingSafeEqual(
          Buffer.from(receivedSignature, "hex"),
          Buffer.from(expectedSignature, "hex")
        );

      if (!isValid) {
        console.error("❌ Invalid Wave signature");
        return res.sendStatus(401);
      }

      // ✅ VERIFIED
      const event = JSON.parse(req.body.toString());

      console.log("🔐 Wave webhook VERIFIED");
      console.log(JSON.stringify(event, null, 2));

      // =========================
      // PAYMENT CONFIRMATION LOGIC
      // =========================
      const eventType = event.type;
      const data = event.data?.object;

      if (
        (eventType === "checkout.session.completed" ||
         eventType === "merchant.payment_received") &&
        data?.payment_status === "paid"
      ) {
        const orderId = data.client_reference;
        const amount = data.amount;

        console.log(`✅ PAYMENT CONFIRMED for order ${orderId}`);

        try {
          await twilioClient.messages.create({
            body: `✅ PAYMENT RECEIVED\nOrder: ${orderId}\nAmount: D${amount}\nYou may now enter this order into Loyverse.`,
            from: process.env.TWILIO_FROM_NUMBER,
            to: process.env.OWNER_PHONE_NUMBER
          });

          console.log("📩 Payment confirmation SMS sent to owner");
        } catch (smsError) {
          console.error("❌ SMS send failed", smsError.message);
        }
      }

      return res.sendStatus(200);

    } catch (err) {
      console.error("❌ Webhook processing error", err);
      return res.sendStatus(500);
    }
  }
);

// ================================
// 🔧 GLOBAL JSON MIDDLEWARE
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
// ORDER ACCEPTED (GLORIAFOOD)
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
      return res.status(500).json({
        error: "Wave payment creation failed",
        details: waveData
      });
    }

    await twilioClient.messages.create({
      body: `Kafe Zola: Pay for order ${orderId}\n${waveData.wave_launch_url}`,
      from: process.env.TWILIO_FROM_NUMBER,
      to: phone
    });

    return res.json({
      status: "payment_created",
      orderId,
      payment_url: waveData.wave_launch_url
    });

  } catch (err) {
    console.error("❌ Order accepted error", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// ================================
// START SERVER
// ================================
app.listen(PORT, () => {
  console.log(`🚀 Mavuno API listening on port ${PORT}`);
});
