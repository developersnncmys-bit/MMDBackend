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
    console.log("PG initiate ok:", {
      ORDER_ID, MID: cfg.MID, TXN_AMOUNT: paramList.TXN_AMOUNT,
      keyLen: cfg.MERCHANT_KEY.length,
    });
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

// Lands the user on the website's failure page rather than leaving them on a
// JSON error response when something goes wrong inside the callback.
const failRedirect = (res, service, reason) => {
  console.error("PG callback bailing out:", reason);
  const base = process.env.WEBSITE_URL || "http://localhost:3000";
  const slug = service || "general";
  return res.redirect(`${base}/failure/${slug}`);
};

// POST /api/PG/paytm/callback — Paytm POSTs the result as form-urlencoded.
// We ALSO expose this as GET, because some Paytm flows (and any user who
// refreshes / bookmarks the URL) come back via GET — better to send them to
// the failure page than to show raw JSON.
exports.callback = async (req, res) => {
  const service = normalizeService(req.query.service);
  // Dump everything Paytm sent us — without this we're flying blind when the
  // checksum/body check fails. Visible in Render logs.
  console.log("PG callback hit:", {
    method: req.method,
    contentType: req.headers["content-type"],
    query: req.query,
    body: req.body,
    bodyKeys: Object.keys(req.body || {}),
  });
  try {
    const cfg = paytm();
    if (!cfg.MERCHANT_KEY) {
      // Almost always: PAYTM_MERCHANT_KEY isn't set in the deployed env.
      return failRedirect(res, service, "PAYTM_MERCHANT_KEY env var is not set");
    }

    // GET (or empty POST): can't verify a checksum that isn't there. Treat
    // as a non-success outcome and redirect.
    if (req.method !== "POST" || !req.body || Object.keys(req.body).length === 0) {
      return failRedirect(res, service, `${req.method} with no body`);
    }

    const { CHECKSUMHASH, ...paramList } = req.body;
    const orderid = paramList.ORDERID || req.query.orderid;

    if (!CHECKSUMHASH) {
      return failRedirect(res, service, "callback body has no CHECKSUMHASH");
    }

    const isValid = await PaytmChecksum.verifySignature(
      paramList,
      cfg.MERCHANT_KEY,
      CHECKSUMHASH
    );
    if (!isValid) {
      return failRedirect(res, service, "checksum verify failed");
    }

    const paid = paramList.STATUS === "TXN_SUCCESS";
    const paymentStatus = paid ? "paid" : "unpaid";

    // Update the lead (must exist — created at the OTP-success step).
    const lead = await Lead.findOneAndUpdate(
      { orderId: orderid },
      { paymentStatus },
      { new: true }
    );
    console.log("PG callback lead lookup:", {
      orderid,
      paid,
      leadFound: !!lead,
      leadEmail: lead?.email,
      leadMobile: lead?.mobileNumber,
      leadService: lead?.service,
    });

    // Fire-and-forget email + SMS on success.
    if (paid && lead) {
      console.log("PG sending email + sms for paid lead", lead.orderId);
      sendPaymentEmail({ to: lead.email, name: lead.name, service: lead.service })
        .then(() => console.log("PG email send finished for", lead.email))
        .catch((e) => console.error("PG email error:", e.message));
      sendPaymentSms({
        mobile: lead.mobileNumber,
        name: lead.name,
        service: lead.service,
        link: "https://wa.me/919980097315",
      })
        .then(() => console.log("PG sms send finished for", lead.mobileNumber))
        .catch((e) => console.error("PG sms error:", e.message));
    } else if (paid && !lead) {
      console.error("PG callback: paid but lead NOT FOUND for orderId", orderid);
    }

    const websiteBase = process.env.WEBSITE_URL || "http://localhost:3000";
    const target = paid
      ? `${websiteBase}/requestsuccess/${service || "general"}`
      : `${websiteBase}/failure/${service || "general"}`;
    return res.redirect(target);
  } catch (err) {
    return failRedirect(res, service, `exception: ${err.message}`);
  }
};
