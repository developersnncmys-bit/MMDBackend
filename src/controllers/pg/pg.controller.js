// Paytm checkout glue. The website calls /initiate with the order details,
// gets back a signed paramList, then auto-POSTs to PAYTM_TRANSACTION_URL.
// Paytm calls /callback with the result; we verify the checksum, update the
// lead's payment status, fire-and-forget email + SMS, and redirect to
// /request_success/<service> (or /failure/<service>).

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
// The /request_success/[service] page on the website declares these exact slugs
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
      // /request_success/<service> URL to land on.
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

    // Capture the Paytm-side identifiers — we need TXNID to refund later.
    const update = { paymentStatus };
    if (paid) {
      update.paytmTxnId = paramList.TXNID || "";
      update.paytmBankTxnId = paramList.BANKTXNID || "";
      update.paidAt = new Date();
    }
    // Update the lead (must exist — created at the OTP-success step).
    const lead = await Lead.findOneAndUpdate(
      { orderId: orderid },
      update,
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
      ? `${websiteBase}/request_success/${service || "general"}`
      : `${websiteBase}/failure/${service || "general"}`;
    return res.redirect(target);
  } catch (err) {
    return failRedirect(res, service, `exception: ${err.message}`);
  }
};

// POST /api/PG/paytm/refund
// Body: { leadId, amount }
// Refunds the given amount to the original payment source (same UPI/card/etc.
// the customer used — Paytm handles the routing automatically based on the
// original TXNID).
// exports.refund = async (req, res) => {
//   try {
//     const { leadId, amount } = req.body || {};
//     if (!leadId || !amount || Number(amount) <= 0) {
//       return res
//         .status(400)
//         .json({ success: false, message: "leadId and a positive amount are required" });
//     }
//     const cfg = paytm();
//     if (!cfg.MID || !cfg.MERCHANT_KEY) {
//       return res
//         .status(500)
//         .json({ success: false, message: "Paytm is not configured" });
//     }

//     const lead = await Lead.findById(leadId);
//     if (!lead) {
//       console.log("PG refund: lead not found", { leadId });
//       return res.status(404).json({ success: false, message: "Lead not found" });
//     }
//     console.log("PG refund attempt:", {
//       leadId,
//       orderId: lead.orderId,
//       paytmTxnId: lead.paytmTxnId,
//       paymentStatus: lead.paymentStatus,
//       refundStatus: lead.refundStatus,
//       amount: lead.amount,
//       requestedAmount: amount,
//     });
//     if (lead.paymentStatus !== "paid") {
//       return res
//         .status(400)
//         .json({ success: false, message: "Lead is not paid — nothing to refund" });
//     }
//     if (!lead.orderId) {
//       return res
//         .status(400)
//         .json({ success: false, message: "Lead has no order ID — cannot refund" });
//     }
//     if (!lead.paytmTxnId) {
//       return res.status(400).json({
//         success: false,
//         message:
//           "This lead was paid before the refund feature was deployed, so its Paytm transaction ID isn't stored. Only new payments (after today's backend deploy) can be refunded through the panel. For older payments, refund manually via Paytm dashboard.",
//       });
//     }
//     if (lead.refundStatus === "refunded") {
//       return res
//         .status(400)
//         .json({ success: false, message: "This lead has already been refunded" });
//     }
//     if (Number(amount) > Number(lead.amount || 0)) {
//       return res.status(400).json({
//         success: false,
//         message: `Refund amount cannot exceed paid amount (₹${lead.amount})`,
//       });
//     }

//     // Our refund reference id — must be unique per refund attempt.
//     const refId = `REF${Date.now()}${Math.floor(Math.random() * 9000 + 1000)}`;
//     const body = {
//       mid: cfg.MID,
//       txnType: "REFUND",
//       orderId: lead.orderId,
//       txnId: lead.paytmTxnId,
//       refId,
//       refundAmount: Number(amount).toFixed(2),
//     };

//     const signature = await PaytmChecksum.generateSignature(
//       JSON.stringify(body),
//       cfg.MERCHANT_KEY
//     );
//     const head = { signature };

//     // Paytm refund endpoint — production: securegw, staging: securegw-stage.
//     // Use the same base host as the transaction URL so prod/stage stay in sync.
//     const base = (cfg.TRANSACTION_URL || "")
//       .replace("/order/process", "")
//       .replace("/theia/processTransaction", "");
//     const refundUrl = `${base}/refund/apply`;

//     console.log("PG refund request:", { refundUrl, body });

//     const resp = await fetch(refundUrl, {
//       method: "POST",
//       headers: { "Content-Type": "application/json" },
//       body: JSON.stringify({ head, body }),
//     });
//     const data = await resp.json().catch(() => ({}));
//     console.log("PG refund response:", data);

//     const respBody = data.body || {};
//     const respCode = respBody.resultInfo?.resultCode;
//     // Paytm returns resultStatus = TXN_SUCCESS for instant refunds, or
//     // PENDING when the refund is queued for async processing.
//     const status = respBody.resultInfo?.resultStatus;

//     if (status === "TXN_SUCCESS") {
//       lead.refundStatus = "refunded";
//       lead.refundAmount = Number(amount);
//       lead.refundRefId = refId;
//       lead.refundPaytmId = respBody.refundId || "";
//       lead.refundedAt = new Date();
//       lead.refundError = "";
//       lead.notes.push({
//         text: `Refund of ₹${amount} processed via Paytm. RefundId: ${respBody.refundId || refId}`,
//         author: "System",
//       });
//       await lead.save();
//       return res.json({ success: true, message: "Refund processed", lead });
//     }
//     if (status === "PENDING") {
//       lead.refundStatus = "pending";
//       lead.refundAmount = Number(amount);
//       lead.refundRefId = refId;
//       lead.refundPaytmId = respBody.refundId || "";
//       lead.refundError = "";
//       lead.notes.push({
//         text: `Refund of ₹${amount} queued at Paytm (pending). RefId: ${refId}`,
//         author: "System",
//       });
//       await lead.save();
//       return res.json({ success: true, message: "Refund queued (pending)", lead });
//     }

//     // Anything else is a failure. Translate Paytm's terse codes into something
//     // an admin can act on.
//     lead.refundStatus = "failed";
//     // Always surface Paytm's own words — never hide them behind our guesses.
//     const rawMsg = respBody.resultInfo?.resultMsg || "";
//     const codeTxt = respCode ? `code ${respCode}` : "no code";
//     const paytmSays = rawMsg ? `Paytm's reason: "${rawMsg}"` : "Paytm returned no reason text";
//     // Add a short, accurate hint only for codes whose meaning is well-known.
//     const hint = (() => {
//       if (respCode === "601") return " (this transaction was already refunded earlier).";
//       if (respCode === "501") return " (refund amount exceeds the refundable balance — it may be partially refunded already).";
//       return ".";
//     })();
//     const friendly = `Refund rejected by Paytm (${codeTxt}). ${paytmSays}${hint}`;
//     lead.refundError = friendly;
//     lead.notes.push({
//       text: `Refund of ₹${amount} FAILED: ${friendly}`,
//       author: "System",
//     });
//     await lead.save();
//     return res.status(400).json({
//       success: false,
//       message: friendly,
//       paytmResponse: respBody,
//     });
//   } catch (err) {
//     console.error("PG refund error:", err);
//     return res
//       .status(500)
//       .json({ success: false, message: err.message || "Server error" });
//   }
// };
exports.refund = async (req, res) => {
  try {
    const { leadId, amount } = req.body || {};
    const requestedAmount = Number(amount);

    if (
      !leadId ||
      !Number.isFinite(requestedAmount) ||
      requestedAmount <= 0
    ) {
      return res.status(400).json({
        success: false,
        message: "leadId and a positive amount are required",
      });
    }

    const cfg = paytm();

    if (!cfg?.MID || !cfg?.MERCHANT_KEY) {
      return res.status(500).json({
        success: false,
        message: "Paytm is not configured",
      });
    }

    const lead = await Lead.findById(leadId);

    if (!lead) {
      console.log("PG refund: lead not found", { leadId });

      return res.status(404).json({
        success: false,
        message: "Lead not found",
      });
    }

    console.log("PG refund attempt:", {
      leadId,
      orderId: lead.orderId,
      paytmTxnId: lead.paytmTxnId,
      paymentStatus: lead.paymentStatus,
      refundStatus: lead.refundStatus,
      amount: lead.amount,
      requestedAmount,
    });

    if (lead.paymentStatus !== "paid") {
      return res.status(400).json({
        success: false,
        message: "Lead is not paid — nothing to refund",
      });
    }

    if (!lead.orderId) {
      return res.status(400).json({
        success: false,
        message: "Lead has no order ID — cannot refund",
      });
    }

    if (!lead.paytmTxnId) {
      return res.status(400).json({
        success: false,
        message:
          "Paytm transaction ID is not stored. Refund this payment manually through the Paytm dashboard.",
      });
    }

    if (
      lead.refundStatus === "pending" ||
      lead.refundStatus === "processing"
    ) {
      return res.status(409).json({
        success: false,
        message:
          "A refund is already pending. Check its status before trying again.",
      });
    }

    const paidAmount = Number(lead.amount || 0);
    const alreadyRefundedAmount = Number(
      lead.totalRefundedAmount ||
        (lead.refundStatus === "refunded"
          ? lead.refundAmount
          : 0) ||
        0
    );

    const refundableBalance = Math.max(
      0,
      paidAmount - alreadyRefundedAmount
    );

    if (refundableBalance <= 0) {
      return res.status(400).json({
        success: false,
        message: "This payment has already been fully refunded",
      });
    }

    if (requestedAmount > refundableBalance) {
      return res.status(400).json({
        success: false,
        message: `Refund amount cannot exceed refundable balance ₹${refundableBalance.toFixed(
          2
        )}`,
      });
    }

    // Must be unique for every refund attempt.
    const refId = `REF${Date.now()}${Math.floor(
      Math.random() * 9000 + 1000
    )}`;

    const body = {
      mid: String(cfg.MID),
      txnType: "REFUND",
      orderId: String(lead.orderId),
      txnId: String(lead.paytmTxnId),
      refId,
      refundAmount: requestedAmount.toFixed(2),
      comments: `Refund for lead ${lead._id}`,
    };

    const signature = await PaytmChecksum.generateSignature(
      JSON.stringify(body),
      cfg.MERCHANT_KEY
    );

    const payload = {
      head: {
        signature,
      },
      body,
    };

    const isStaging = String(
      cfg.TRANSACTION_URL || ""
    ).includes("securegw-stage.paytm.in");

    const baseUrl = isStaging
      ? "https://securegw-stage.paytm.in"
      : "https://securegw.paytm.in";

    const refundUrl =
      `${baseUrl}/refund/api/v1/async/refund` +
      `?mid=${encodeURIComponent(cfg.MID)}` +
      `&orderId=${encodeURIComponent(lead.orderId)}`;

    console.log("PG refund request:", {
      refundUrl,
      body,
    });

    const resp = await fetch(refundUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
    });

    const responseText = await resp.text();

    let data = {};

    try {
      data = responseText
        ? JSON.parse(responseText)
        : {};
    } catch (parseError) {
      console.error("PG refund invalid response:", {
        httpStatus: resp.status,
        responseText,
      });

      return res.status(502).json({
        success: false,
        message: "Paytm returned an invalid response",
      });
    }

    console.log("PG refund response:", {
      httpStatus: resp.status,
      body: data?.body,
    });

    const respBody = data?.body || {};
    const resultInfo = respBody?.resultInfo || {};

    const respCode = String(
      resultInfo.resultCode || ""
    );

    const status = String(
      resultInfo.resultStatus || ""
    ).toUpperCase();

    const rawMessage =
      resultInfo.resultMsg ||
      "Paytm returned no reason";

    lead.notes = Array.isArray(lead.notes)
      ? lead.notes
      : [];

    /*
     * Async refund submission only means Paytm accepted the request
     * for processing. Do not mark it refunded yet.
     */
    const acceptedStatuses = [
      "PENDING",
      "TXN_SUCCESS",
      "SUCCESS",
      "S",
    ];

    if (
      resp.ok &&
      acceptedStatuses.includes(status)
    ) {
      lead.refundStatus = "pending";
      lead.refundAmount = requestedAmount;
      lead.refundRefId = refId;
      lead.refundPaytmId =
        respBody.refundId || "";
      lead.refundRequestedAt = new Date();
      lead.refundedAt = null;
      lead.refundError = "";

      lead.notes.push({
        text:
          `Refund of ₹${requestedAmount.toFixed(
            2
          )} submitted to Paytm. ` +
          `RefId: ${refId}. Status: ${status}.`,
        author: "System",
      });

      await lead.save();

      return res.status(202).json({
        success: true,
        message:
          "Refund request submitted to Paytm and is pending confirmation.",
        refund: {
          status: "pending",
          amount: requestedAmount,
          refId,
          refundId:
            respBody.refundId || null,
          resultCode: respCode || null,
          paytmMessage: rawMessage,
        },
        lead,
      });
    }

    let hint = "";

    if (respCode === "501") {
      hint =
        " The amount may exceed the remaining refundable balance.";
    } else if (respCode === "600") {
      hint =
        " Verify the original transaction status and refundable balance. If it also fails in the Paytm dashboard, the bank or payment mode is restricting the refund.";
    } else if (respCode === "601") {
      hint =
        " This transaction may already have been refunded.";
    }

    const friendlyMessage =
      `Refund rejected by Paytm` +
      `${respCode ? ` (code ${respCode})` : ""}. ` +
      `Paytm's reason: "${rawMessage}".${hint}`;

    lead.refundStatus = "failed";
    lead.refundAmount = requestedAmount;
    lead.refundRefId = refId;
    lead.refundPaytmId =
      respBody.refundId || "";
    lead.refundError = friendlyMessage;

    lead.notes.push({
      text:
        `Refund of ₹${requestedAmount.toFixed(
          2
        )} FAILED: ${friendlyMessage}`,
      author: "System",
    });

    await lead.save();

    return res.status(400).json({
      success: false,
      message: friendlyMessage,
      paytmResponse: respBody,
    });
  } catch (err) {
    console.error("PG refund error:", err);

    if (
      err?.name === "TimeoutError" ||
      err?.name === "AbortError"
    ) {
      return res.status(504).json({
        success: false,
        message: "Paytm refund request timed out",
      });
    }

    return res.status(500).json({
      success: false,
      message:
        err?.message || "Server error",
    });
  }
};