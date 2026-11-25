// Operations (post-conversion) cases — what the backend team does after a lead
// converts: verify documents, book the appointment, apply, follow up, deliver.
// Replaces the per-service Google Sheet tabs (PASSPORT, PAN CARD, PVC/PCC, …).

const { SERVICES } = require("./services");

// Pipeline of a case, in order. Labels live in the admin panel (lib/opsConfig.ts).
const CASE_STATUSES = [
  "new",         // just handed over, nothing done yet
  "documents",   // documents being collected / verified   (sheet: "IN DOC VEF")
  "appointment", // appointment booked                     (sheet: "IN APPT")
  "applied",     // application submitted
  "processing",  // with the authority (police verification, dispatch, …)
  "completed",   // delivered / done
  "cancelled",   // dropped, refunded, not proceeding
];

const OPEN_CASE_STATUSES = CASE_STATUSES.filter((s) => s !== "completed" && s !== "cancelled");

// Services the operations team tracks — the website's services plus work that
// only exists on the operations side (sheet tab "COMPLAINT COPY").
const OPS_SERVICES = [...SERVICES, "Complaint Copy", "Other"];

// Map a lead's free-text service ("Dubai Tourist Visa", "Passport Renewal", …)
// onto one of OPS_SERVICES so cases group under the right tab.
function canonicalService(raw) {
  const s = String(raw || "").trim();
  if (!s) return "Other";
  const exact = OPS_SERVICES.find((x) => x.toLowerCase() === s.toLowerCase());
  if (exact) return exact;
  const t = s.toLowerCase();
  if (/tourist\s*visa|visa$/.test(t)) return "Tourist Visa";
  if (/\bpcc\b|clearance/.test(t)) return "Police Clearance Certificate (PCC)";
  if (/\bpvc\b|police\s*verification/.test(t)) return "Police Verification Certificate (PVC)";
  if (/affidavit|annexure/.test(t)) return "Affidavits / Annexure";
  if (/senior/.test(t)) return "Senior Citizen Card";
  if (/passport/.test(t)) return "Passport";
  if (/\bpan\b/.test(t)) return "PAN Card";
  if (/rental/.test(t)) return "Rental Agreement";
  if (/lease/.test(t)) return "Lease Agreement";
  if (/msme|udyam/.test(t)) return "MSME Registration";
  if (/insurance/.test(t)) return "Insurance";
  if (/complaint/.test(t)) return "Complaint Copy";
  return "Other";
}

module.exports = { CASE_STATUSES, OPEN_CASE_STATUSES, OPS_SERVICES, canonicalService };
