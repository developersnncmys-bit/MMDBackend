const express = require("express");
const router = express.Router();

const leadRoutes = require("./lead/lead.routes");

router.use("/leads", leadRoutes);

router.get("/health", (req, res) => {
  res.json({ success: true, message: "ok" });
});

module.exports = router;
