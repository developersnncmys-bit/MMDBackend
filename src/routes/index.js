const express = require("express");
const router = express.Router();

const leadRoutes = require("./lead/lead.routes");
const userRoutes = require("./user/user.routes");
const blogRoutes = require("./blog/blog.routes");
const careerRoutes = require("./career/career.routes");
const otpRoutes = require("./otp/otp.routes");

router.use("/leads", leadRoutes);
router.use("/users", userRoutes);
router.use("/blogs", blogRoutes);
router.use("/careers", careerRoutes);
router.use("/otp", otpRoutes);

router.get("/health", (req, res) => {
  res.json({ success: true, message: "ok" });
});

module.exports = router;
