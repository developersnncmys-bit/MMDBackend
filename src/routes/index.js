const express = require("express");
const router = express.Router();

const leadRoutes = require("./lead/lead.routes");
const userRoutes = require("./user/user.routes");

router.use("/leads", leadRoutes);
router.use("/users", userRoutes);

router.get("/health", (req, res) => {
  res.json({ success: true, message: "ok" });
});

module.exports = router;
