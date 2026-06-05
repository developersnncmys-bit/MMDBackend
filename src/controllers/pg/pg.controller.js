// Paytm checkout glue. The website calls /initiate with the order details,
// gets back a signed paramList, then auto-POSTs to PAYTM_TRANSACTION_URL.
// Paytm calls /callback with the result; we verify the checksum, update the
// lead's payment status, fire-and-forget email + SMS, and redirect to
// /requestsuccess/<service> (or /failure/<service>).

const PaytmChecksum = require("paytmchecksum");
const Lead = require("../../models/lead/Lead");
const { sendPaymentEmail } = require("../../services/email");
const { sendPaymentSms } = require("../../services/sms");

const paytm = () => ({
  MID:               process.env.PAYTM_MID,
  MERCHANT_KEY:      process.env.PAYTM_MERCHANT_KEY,
  WEBSITE:           process.env.PAYTM_WEBSITE || "DEFAULT",
  INDUSTRY_TYPE_ID:  process.env.PAYTM_INDUSTRY_TYPE || "Retail",
  CHANNEL_ID:        process.env.PAYTM_CHANNEL_ID || "WEB",
  CALLBACK_URL:      process.env.PAYTM_CALLBACK_URL,
  TRANSACTION_URL:   process.env.PAYTM_TRANSACTION_URL,
});

// URL-safe slug. "Police Clearance Certificate (PCC)" → "policeclearancecertificatepcc".
// The /requestsuccess/[service] page on the website declares these exact slugs
// in generateStaticParams, so normalization must agree on both sides.
const normalizeService = (s = "") =>
  String(s).toLowerCase().replace(/[^a-z0-9]+/g, "");

// POST /api/PG/paytm/initiate
// Body: { CUST_ID, TXN_AMOUNT, SERVICE, ORDER_ID }
// → { status, ORDER_ID, paramList (with CHECKSUMHASH), txnUrl }
exports.initiate = async (req, res) => {
  try {
    const { CUST_ID, TXN_AMOUNT, SERVICE, ORDER_ID } = req.body || {};
    if (!CUST_ID || !TXN_AMOUNT || !SERVICE || !ORDER_ID) {
      return res
        .status(400)
        .json({ status: "error", message: "Missing required parameters" });
    }
    const cfg = paytm();
    if (!cfg.MID || !cfg.MERCHANT_KEY) {
      return res
        .status(500)
        .json({ status: "error", message: "Paytm is not configured." });
    }

    const paramList = {
      MID: cfg.MID,
      ORDER_ID: String(ORDER_ID),
      CUST_ID: String(CUST_ID),
      INDUSTRY_TYPE_ID: cfg.INDUSTRY_TYPE_ID,
      CHANNEL_ID: cfg.CHANNEL_ID,
      TXN_AMOUNT: String(TXN_AMOUNT),
      WEBSITE: cfg.WEBSITE,
      // Service is round-tripped on the callback so the redirect knows which
      // /requestsuccess/<service> URL to land on.
      CALLBACK_URL: `${cfg.CALLBACK_URL}?orderid=${encodeURIComponent(ORDER_ID)}&service=${encodeURIComponent(SERVICE)}`,
    };

    const CHECKSUMHASH = await PaytmChecksum.generateSignature(
      paramList,
      cfg.MERCHANT_KEY
    );
    return res.json({
      status: "success",
      ORDER_ID,
      txnUrl: cfg.TRANSACTION_URL,
      paramList: { ...paramList, CHECKSUMHASH },
    });
  } catch (err) {
    console.error("PG initiate error:", err);
    return res.status(500).json({ status: "error", message: "Server error" });
  }
};

// POST /api/PG/paytm/callback (called by Paytm with form-urlencoded body)
exports.callback = async (req, res) => {
  try {
    if (!req.body || Object.keys(req.body).length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "Empty callback body" });
    }
    const { CHECKSUMHASH, ...paramList } = req.body;
    const orderid = paramList.ORDERID;
    const service = normalizeService(req.query.service);
    const cfg = paytm();

    if (!CHECKSUMHASH || !cfg.MERCHANT_KEY) {
      return res
        .status(400)
        .json({ success: false, message: "Missing checksum or config" });
    }

    const isValid = await PaytmChecksum.verifySignature(
      paramList,
      cfg.MERCHANT_KEY,
      CHECKSUMHASH
    );
    if (!isValid) {
      console.error("Paytm callback: checksum verify failed");
      return res
        .status(400)
        .json({ success: false, message: "Checksum verification failed" });
    }

    const paid = paramList.STATUS === "TXN_SUCCESS";
    const paymentStatus = paid ? "paid" : "unpaid";

    // Update the lead (must exist — created at the OTP-success step).
    const lead = await Lead.findOneAndUpdate(
      { orderId: orderid },
      { paymentStatus },
      { new: true }
    );

    // Fire-and-forget email + SMS on success.
    if (paid && lead) {
      sendPaymentEmail({ to: lead.email, name: lead.name, service: lead.service })
        .catch((e) => console.error("email:", e));
      sendPaymentSms({
        mobile: lead.mobileNumber,
        name: lead.name,
        service: lead.service,
        link: "https://wa.me/919980097315",
      }).catch((e) => console.error("sms:", e));
    }

    const websiteBase = process.env.WEBSITE_URL || "http://localhost:3000";
    const target = paid
      ? `${websiteBase}/requestsuccess/${service || "general"}`
      : `${websiteBase}/failure/${service || "general"}`;
    return res.redirect(target);
  } catch (err) {
    console.error("PG callback error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
