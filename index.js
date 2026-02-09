const express = require("express");

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware to parse JSON
app.use(express.json());

// Health check endpoint
app.get("/", (req, res) => {
  res.send("🚀 Mavuno API is running");
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "mavuno-api",
    time: new Date().toISOString()
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Mavuno API listening on port ${PORT}`);
});
