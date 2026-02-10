const express = require("express");
const crypto = require("crypto");
const twilio = require("twilio");

const app = express();
const PORT = process.env.PORT || 8080;

/* ================================
   📩 TWILIO CLIENT
================================ */
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

/* ================================
   🔁 IDEMPOTENCY GUARD (REQUIRED)
   Prevents Wave retry / loop
================================ */
const processedOrders = new Set();

/* =====================================================
   🔐 WAVE WEBHOOK — OFFICIAL VERIFIED IMPLEMENTATION
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

      // Split: t=...,v1=...,v1=...
      const parts = signatureHeader.split(",");
      const timestampPart = parts.find(p => p.startsWith("t="));
      const signatureParts = parts.filter(p => p.startsWith("v1="));

      if (!timestampPart || signatureParts.length === 0) {
        console.error("❌ Invalid Wave-Signature format");
        return res.sendStatus(401);
      }

      const timestamp = timestampPart.split("=")[1];
      const rawBody = req.body.toString();

      // ✅ EXACT per Wave docs: timestamp + raw body
      const signedPayload = timestamp + rawBody;

      const expectedSignature = crypto
        .createHmac("sha256", process.env.WAVE_WEBHOOK_SECRET)
        .update(signedPayload)
        .digest("hex");

      const isValid = signatureParts.some(sig => {
        const received = sig.split("=")[1];
        return crypto.timingSafeEqual(
          Buffer.from(received, "hex"),
          Buffer.from(expectedSignature, "hex")
        );
      });

      if (!isValid) {
        console.error("❌ Invalid Wave signature");
        return res.sendStatus(401);
      }

      // ✅ VERIFIED — safe to parse JSON now
      const event = JSON.parse(rawBody);

      console.log("🔐 Wave webhook VERIFIED");
      console.log(JSON.stringify(event, null, 2));

      /* =========================
         PAYMENT CONFIRMATION
      ========================= */
      if (
        (event.type === "checkout.session.completed" ||
         event.type === "merchant.payment_received") &&
        event.data?.payment_status === "succeeded"
      ) {
        const orderId = event.data.client_reference;
        const amount = event.data.amount;

        if (!orderId) {
          console.warn("⚠️ No client_reference — skipping");
          return res.sendStatus(200);
        }

        // 🔁 STOP DUPLICATE PROCESSING
        if (processedOrders.has(orderId)) {
          console.log(`🔁 Duplicate webhook ignored for order ${orderId}`);
          return res.sendStatus(200);
        }

        processedOrders.add(orderId);

        console.log(`✅ PAYMENT CONFIRMED: ${orderId}`);

        await twilioClient.messages.create({
          body: `✅ PAYMENT RECEIVED\nOrder: ${orderId}\nAmount: D${amount}`,
          from: process.env.TWILIO_FROM_NUMBER,
          to: process.env.OWNER_PHONE_NUMBER
        });
      }

      return res.sendStatus(200);

    } catch (err) {
      console.error("❌ Webhook processing error", err);
      return res.sendStatus(500);
    }
  }
);

/* ================================
   🔧 JSON MIDDLEWARE (AFTER WEBHOOK)
================================ */
app.use(express.json());

/* ================================
   ROOT
================================ */
app.get("/", (req, res) => {
  res.send("🚀 Mavuno API is running");
});

/* ================================
   HEALTH CHECK
================================ */
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

/* ================================
   ORDER ACCEPTED (GLORIAFOOD)
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
          amount,
          currency: "GMD",
          client_reference: orderId
        })
      }
    );

    const waveData = await waveResponse.json();

    // ✅ SAFE payment URL resolution (matches Wave responses)
    const paymentUrl =
      waveData.wave_launch_url ||
      waveData.checkout_url ||
      waveData.url;

    if (!paymentUrl) {
      console.error("❌ No payment URL returned from Wave", waveData);
      return res.status(500).json({ error: "No payment URL from Wave" });
    }

    await twilioClient.messages.create({
      body: `Kafe Zola: Pay for order ${orderId}\n${paymentUrl}`,
      from: process.env.TWILIO_FROM_NUMBER,
      to: phone
    });

    return res.json({ status: "payment_created" });

  } catch (err) {
    console.error("❌ Order accepted error", err);
    return res.status(500).json({ error: "Server error" });
  }
});

/* ================================
   START SERVER
================================ */
app.listen(PORT, () => {
  console.log(`🚀 Mavuno API listening on port ${PORT}`);
});
