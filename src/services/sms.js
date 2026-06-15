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

  // FLAT MSG91 flow payload — this is the structure the working (old) system
  // used: flow_id + top-level name/var1/var2 (NOT a recipients[] array). The
  // recipients form wasn't filling the template's link variable. Send the link
  // in both var1 and var2 so whichever the template references gets it.
  const payload = {
    flow_id: template_id,
    sender: process.env.MSG91_SENDER_ID,
    mobiles,
    name: safeName,
    var1: safeLink,
    var2: safeLink,
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
        mobiles, flow_id: template_id, sender: process.env.MSG91_SENDER_ID,
        response: data,
      });
    }
  } catch (err) {
    console.error("SMS SEND ERROR:", err.message);
  }
};
