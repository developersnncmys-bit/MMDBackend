// Post-payment confirmation email via Zoho SMTP. Fire-and-forget from the
// Paytm callback — failures here must not block the redirect.

const nodemailer = require("nodemailer");

let transporter = null;
const getTransporter = () => {
  if (transporter) return transporter;
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) {
    console.warn("Email: SMTP not configured");
    return null;
  }
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    secure: Number(process.env.SMTP_PORT || 465) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    tls: { rejectUnauthorized: false },
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

exports.sendPaymentEmail = async ({ to, name, service }) => {
  const t = getTransporter();
  if (!t || !to) return;
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
  try {
    await t.sendMail({
      from: `"Support Team" <${process.env.SMTP_USER}>`,
      to,
      subject: "Payment Successful — MakeMyDocuments",
      html,
    });
  } catch (err) {
    console.error("sendPaymentEmail error:", err.message);
  }
};
