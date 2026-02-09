const express = require("express");

// Node 18+ has fetch built-in, no extra install needed
const app = express();
const PORT = process.env.PORT || 8080;

// Middleware to parse JSON
app.use(express.json());

/**
 * ROOT ENDPOINT
 * Used to confirm the app is running
 */
app.get("/", (req, res) => {
  res.send("🚀 Mavuno API is running");
});

/**
 * HEALTH CHECK
 * Used by DigitalOcean and you
 */
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "mavuno-api",
    time: new Date().toISOString()
  });
});

/**
 * ORDER ACCEPTED ENDPOINT
 * Triggered when an order is accepted in GloriaFood
 */
app.post("/orders/accepted", async (req, res) => {
  const { orderId, amount, phone } = req.body;

  console.log("📦 Order accepted", { orderId, amount, phone });

  // Basic validation
  if (!orderId || !amount || !phone) {
    return res.status(400).json({
      error: "orderId, amount, and phone are required"
    });
  }

  try {
    // Create Wave payment session
    const waveResponse = await fetch(
      "https://api.wave.com/v1/checkout/sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.WAVE_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          amount: amount,
          currency: "GMD",
          description: `Order ${orderId}`,
          client_reference: orderId,
          redirect_url: "https://your-site.com/payment-success",
          error_redirect_url: "https://your-site.com/payment-failed"
        })
      }
    );

    const waveData = await waveResponse.json();

    console.log("💳 Wave payment created", waveData);

    if (!waveResponse.ok) {
      return res.status(500).json({
        error: "Wave payment creation failed",
        details: waveData
      });
    }

    // Respond back with payment link
    return res.json({
      status: "payment_created",
      orderId,
      payment_url: waveData.checkout_url
    });

  } catch (error) {
    console.error("❌ Wave error", error);

    return res.status(500).json({
      error: "Failed to create Wave payment"
    });
  }
});

/**
 * START SERVER (ALWAYS LAST)
 */
app.listen(PORT, () => {
  console.log(`🚀 Mavuno API listening on port ${PORT}`);
});
