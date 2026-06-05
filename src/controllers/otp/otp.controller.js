// MSG91 OTP proxy — the website never sees the auth key. POST /api/otp/send
// kicks off an SMS to the user's mobile; POST /api/otp/verify checks the code
// the user typed. We use the global fetch (Node 18+).

const SEND_URL    = process.env.MSG91_OTP_URL    || "https://control.msg91.com/api/v5/otp";
const VERIFY_URL  = process.env.MSG91_VERIFY_OTP || "https://control.msg91.com/api/v5/otp/verify";
const AUTH_KEY    = process.env.OTP_AUTH_KEY;
const TEMPLATE_ID = process.env.OTP_TEMPLATE_KEY;

// Accept 10-digit number, "+91XXXXXXXXXX", or "91XXXXXXXXXX"; emit "91XXXXXXXXXX".
const formatMobile = (m) => {
  const digits = String(m || "").replace(/\D/g, "");
  if (digits.length === 10) return "91" + digits;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  return digits;
};

exports.sendOtp = async (req, res) => {
  try {
    const mobile = formatMobile(req.body && req.body.mobile);
    if (!/^91[6-9]\d{9}$/.test(mobile)) {
      return res
        .status(400)
        .json({ success: false, message: "Valid 10-digit Indian mobile required" });
    }
    if (!AUTH_KEY || !TEMPLATE_ID) {
      console.error("OTP misconfigured — set OTP_AUTH_KEY + OTP_TEMPLATE_KEY");
      return res
        .status(500)
        .json({ success: false, message: "OTP service is not configured." });
    }
    const url = `${SEND_URL}?template_id=${encodeURIComponent(TEMPLATE_ID)}&mobile=${mobile}&authkey=${encodeURIComponent(AUTH_KEY)}`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const data = await resp.json().catch(() => ({}));
    if (data && data.type === "success") {
      return res.json({ success: true, requestId: data.request_id });
    }
    return res.status(502).json({
      success: false,
      message: (data && (data.message || data.error_message)) || "Failed to send OTP",
    });
  } catch (err) {
    console.error("sendOtp error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.verifyOtp = async (req, res) => {
  try {
    const mobile = formatMobile(req.body && req.body.mobile);
    const otp = String((req.body && req.body.otp) || "").trim();
    if (!/^91[6-9]\d{9}$/.test(mobile)) {
      return res.status(400).json({ success: false, message: "Invalid mobile" });
    }
    if (!/^\d{4,6}$/.test(otp)) {
      return res.status(400).json({ success: false, message: "Invalid OTP" });
    }
    if (!AUTH_KEY) {
      return res
        .status(500)
        .json({ success: false, message: "OTP service is not configured." });
    }
    const url = `${VERIFY_URL}?otp=${otp}&mobile=${mobile}`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { authkey: AUTH_KEY, "Content-Type": "application/json" },
    });
    const data = await resp.json().catch(() => ({}));
    if (data && data.type === "success") {
      return res.json({ success: true });
    }
    return res.status(401).json({
      success: false,
      message:
        (data && (data.message || data.error_message)) ||
        "OTP verification failed. Please try again.",
    });
  } catch (err) {
    console.error("verifyOtp error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
