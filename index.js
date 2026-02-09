const express = require("express");
const app = express();

app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "Mavuno API",
    message: "Mavuno is running 🚀"
  });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Mavuno API listening on port ${PORT}`);
});
