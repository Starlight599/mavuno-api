const express = require("express");

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware to parse JSON
app.use(express.json());

// Root endpoint
app.get("/", (req, res) => {
  res.send("🚀 Mavuno API is running");
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "mavuno-api",
    time: new Date().toISOString()
  });
});

// ✅ NEW ENDPOINT (THIS IS WHAT WE ADD)
app.post("/orders/accepted", (req, res) => {
  const { orderId, amount, phone } = req.body;

  console.log("📦 Order accepted");
  console.log({ orderId, amount, phone });

  if (!orderId || !amount || !phone) {
    return res.status(400).json({
      error: "orderId, amount, and phone are required"
    });
  }

  res.json({
    status: "received",
    orderId,
    amount,
    phone
  });
});

// Start server (ALWAYS LAST)
app.listen(PORT, () => {
  console.log(`Mavuno API listening on port ${PORT}`);
});
