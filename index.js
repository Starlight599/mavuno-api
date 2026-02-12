const express = require("express");
const crypto = require("crypto");
const twilio = require("twilio");

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
   WAVE WEBHOOK — EXACT DOC IMPLEMENTATION
   MUST BE FIRST — NO express.json() BEFORE THIS
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
   JSON MIDDLEWARE (AFTER WEBHOOK)
================================ */
app.use(express.json());

/* =====================================================
   GLORIAFOOD ACCEPTED ORDER WEBHOOK
===================================================== */
app.post("/gloria/accepted", async (req, res) => {
  try {

     console.log("🔎 Incoming headers:", req.headers)
     
    const authorizationHeader = req.headers["authorization"];

if (!authorizationHeader) {
  console.error("❌ Missing Gloria authorization header");
  return res.sendStatus(401);
}

if (authorizationHeader !== process.env.GLORIA_MASTER_KEY) {
  console.error("❌ Invalid Gloria authentication");
  return res.sendStatus(401);
}

    const order = req.body;

    console.log("📦 Gloria Order Received:", order.order_id);

    // 🔍 DEBUG ORDER TYPE (SAFE — will not break anything)
    console.log("Order type:", order.order_type);

    const orderId = order.order_id;
    const amount = order.total_price;
    const phone = order.customer?.phone;

    if (!orderId || !amount || !phone) {
      console.error("❌ Missing order data");
      return res.sendStatus(400);
    }

    // Create Wave checkout
    const waveResponse = await fetch(
      "https://api.wave.com/v1/checkout/sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.WAVE_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          amount: amount.toString(),
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

    // Send SMS to customer
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
   HEALTH CHECK (REQUIRED FOR DO)
================================ */
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

/* ================================
   ORDER ACCEPTED
================================ */
app.post("/orders/accepted", async (req, res) => {
  const { orderId, amount, phone } = req.body;

  if (!orderId || !amount || !phone) {
    return res.status(400).json({ error: "Missing fields" });
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
          amount: amount.toString(),
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
      return res.status(500).json({ error: "Wave failed" });
    }

    const paymentUrl = waveData.wave_launch_url;

    await twilioClient.messages.create({
      body: `Kafe Zola: Pay for order ${orderId}\n${paymentUrl}`,
      from: process.env.TWILIO_FROM_NUMBER,
      to: phone
    });

    return res.json({ status: "payment_created" });

  } catch (err) {
    console.error("❌ Order error", err);
    return res.status(500).json({ error: "Server error" });
  }
});

/* ================================
   START SERVER
================================ */
app.listen(PORT, () => {
  console.log(`🚀 Mavuno API listening on port ${PORT}`);
});
