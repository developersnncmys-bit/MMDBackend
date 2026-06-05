// Post-payment confirmation email. Fire-and-forget from the Paytm callback —
// failures here must not block the redirect.
//
// Provider selection:
//   - If RESEND_API_KEY is set → send via Resend's HTTPS API (works on Render
//     free tier, since Render only blocks outbound SMTP ports, not HTTPS).
//   - Else fall back to Zoho SMTP via nodemailer (requires a host that allows
//     outbound port 465/587 — Render free tier does NOT).

const nodemailer = require("nodemailer");

let transporter = null;
const getTransporter = () => {
  if (transporter) return transporter;
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) {
    console.warn("Email: SMTP not configured");
    return null;
  }
  const port = Number(process.env.SMTP_PORT || 465);
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465, // SSL for 465, STARTTLS for 587
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    // Without these, a blocked outbound SMTP just hangs forever on Render and
    // no error ever surfaces. 15s is plenty for a healthy Zoho connection.
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
    tls: { rejectUnauthorized: false },
  });
  console.log("Email transporter ready:", {
    host: process.env.SMTP_HOST, port, user: process.env.SMTP_USER,
  });
  return transporter;
};

// Returns a friendly per-service body + the WhatsApp upload link (if any).
const bodyFor = (service = "") => {
  const s = String(service).toLowerCase().replace(/\s+/g, "");
  const wa = "https://wa.me/919980097315";
  if (s.includes("pan")) {
    return {
      message:
        "We have received your PAN card application. Please upload your documents via WhatsApp for eKYC and eSign to process further.",
      link: wa,
    };
  }
  if (s.includes("senior")) {
    return {
      message:
        "We have received your Senior Citizen Card application. Please upload your documents via WhatsApp for eKYC and eSign to process further.",
      link: wa,
    };
  }
  return {
    message:
      "We have received your request. One of our executives will get back to you shortly. For any queries please call: +91 94296 90973",
    link: "",
  };
};

// EMAIL_FROM is what shows up in the recipient's "From" header. While testing
// without a verified domain on Resend, use "onboarding@resend.dev". Once the
// makemydocuments.com domain is verified in Resend, switch to
// "support@makemydocuments.com".
const fromAddress = () =>
  process.env.EMAIL_FROM || process.env.SMTP_USER || "onboarding@resend.dev";

const sendViaResend = async ({ to, subject, html }) => {
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromAddress(),
      to: [to],
      subject,
      html,
    }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(
      `Resend ${resp.status}: ${data.message || JSON.stringify(data)}`
    );
  }
  return { messageId: data.id, response: "OK (Resend)" };
};

const sendViaSmtp = async ({ to, subject, html }) => {
  const t = getTransporter();
  if (!t) throw new Error("SMTP not configured");
  const info = await t.sendMail({
    from: `"Support Team" <${fromAddress()}>`,
    to,
    subject,
    html,
  });
  return { messageId: info.messageId, response: info.response };
};

exports.sendPaymentEmail = async ({ to, name, service }) => {
  if (!to) { console.warn("Email skipped: no recipient address"); return; }
  const { message, link } = bodyFor(service);
  const html = `
    <h2>Payment Confirmation</h2>
    <p>Dear ${name || "Customer"},</p>
    <p>${message}</p>
    ${link ? `<p><a href="${link}" style="color:#2E68B1;font-weight:bold;">Upload Documents on WhatsApp</a></p>` : ""}
    <p>Thank you for choosing MakeMyDocuments.</p>
    <br>
    <p>Best Regards,<br>MakeMyDocuments Team</p>
  `;
  const subject = "Payment Successful — MakeMyDocuments";
  const useResend = !!process.env.RESEND_API_KEY;
  try {
    const result = useResend
      ? await sendViaResend({ to, subject, html })
      : await sendViaSmtp({ to, subject, html });
    console.log("Email SENT:", {
      to, via: useResend ? "Resend" : "SMTP", ...result,
    });
  } catch (err) {
    console.error("Email SEND FAILED:", {
      to, via: useResend ? "Resend" : "SMTP",
      error: err.message, code: err.code,
    });
  }
};
