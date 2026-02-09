const express = require("express");

// Node 18+ has fetch built-in (DigitalOcean App Platform supports this)
const app = express();
const PORT = process.env.PORT || 8080;

// Middleware to parse JSON
app.use(express.json());

/**
 * ROOT ENDPOINT
 * Confirms the API is running
 */
app.get("/", (req, res) => {
  res.send("🚀 Mavuno API is running");
});

/**
 * HEALTH CHECK
 * Used by DigitalOcean + manual checks
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
 * Called after a GloriaFood order is ACCEPTED
 * Automatically creates a Wave payment link
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
    // Create Wave checkout session (Merchant / Business API)
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
          client_reference: orderId,
          success_url: "https://your-site.com/payment-success",
          error_url: "https://your-site.com/payment-failed"
        })
      }
    );

    const waveData = await waveResponse.json();

    console.log("💳 Wave RAW response:\n", JSON.stringify(waveData, null, 2));

    // Handle Wave validation errors cleanly
    if (!waveResponse.ok) {
      return res.status(500).json({
        error: "Wave payment creation failed",
        details: waveData
      });
    }

    // Return payment link
    return res.json({
  status: "payment_created",
  orderId,
  wave: waveData
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
