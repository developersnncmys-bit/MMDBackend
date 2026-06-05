// Post-payment transactional SMS via MSG91 flow API. The per-service template
// IDs are matched by a substring on the lead's service name (pan / senior /
// default). Called from the Paytm callback when payment is SUCCESS so the
// HTTP response to the user isn't blocked on the upstream call.

const FLOW_URL = "https://api.msg91.com/api/v5/flow/";

const pickTemplate = (service = "") => {
  const s = String(service).toLowerCase().replace(/\s+/g, "");
  if (s.includes("pan")) return process.env.MSG91_TEMPLATE_PAN;
  if (s.includes("senior")) return process.env.MSG91_TEMPLATE_SENIOR;
  return process.env.MSG91_TEMPLATE_DEFAULT;
};

exports.sendPaymentSms = async ({ mobile, name, service, link }) => {
  if (!process.env.MSG91_AUTH_KEY) {
    console.warn("sendPaymentSms: MSG91_AUTH_KEY missing — skipping SMS");
    return;
  }
  const template_id = pickTemplate(service);
  if (!template_id) {
    console.warn(`sendPaymentSms: no template for service="${service}"`);
    return;
  }
  const digits = String(mobile || "").replace(/\D/g, "");
  const mobiles =
    digits.length === 10 ? "91" + digits :
    digits.length === 12 && digits.startsWith("91") ? digits : digits;

  const safeName = name || "Customer";
  const safeLink = link || "https://wa.me/919980097315";

  // MSG91 Flow templates are picky about variable names — they must match
  // EXACTLY what was defined when the flow was created. Without dashboard
  // access we don't know if the template uses `name`/`var1` or `NAME`/`VAR1`
  // or `##name##`/`##link##` style. Send the value under every common name
  // so whichever the template expects gets filled. MSG91 silently ignores
  // variable names the template doesn't reference.
  const recipient = {
    mobiles,
    name: safeName, NAME: safeName,
    var1: safeName, VAR1: safeName,
    customer: safeName, Customer: safeName,
    var2: safeLink, VAR2: safeLink,
    link: safeLink, LINK: safeLink,
    url: safeLink, URL: safeLink,
  };

  const payload = {
    template_id,
    sender: process.env.MSG91_SENDER_ID,
    short_url: "0",
    // Ask MSG91 to return delivery info synchronously so we can see what
    // went wrong without dashboard access.
    realTimeResponse: "1",
    recipients: [recipient],
  };

  try {
    const resp = await fetch(FLOW_URL, {
      method: "POST",
      headers: {
        authkey: process.env.MSG91_AUTH_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || (data && data.type === "error")) {
      console.error("SMS SEND FAILED:", { status: resp.status, body: data, payload });
    } else {
      console.log("SMS SENT:", {
        mobiles, template_id, sender: process.env.MSG91_SENDER_ID,
        response: data,
      });
    }
  } catch (err) {
    console.error("SMS SEND ERROR:", err.message);
  }
};
