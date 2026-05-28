// The 11 canonical service categories offered on the website. Country-specific
// visas roll up under "Tourist Visa" and the health/life/vehicle plans roll up
// under "Insurance". Kept as a plain list for reference and light validation —
// the Lead.service field stays a free string so new offerings never get rejected.
const SERVICES = [
  "Passport",
  "PAN Card",
  "Tourist Visa",
  "Senior Citizen Card",
  "Rental Agreement",
  "Lease Agreement",
  "MSME Registration",
  "Insurance",
  "Police Clearance Certificate (PCC)",
  "Police Verification Certificate (PVC)",
  "Affidavits / Annexure",
];

const LEAD_STATUSES = [
  "new",
  "overdue",
  "today",
  "followup",
  "inprocess",
  "converted",
  "dead",
];

const PAYMENT_STATUSES = ["paid", "unpaid"];

const LEAD_TYPES = ["website", "manual"];

module.exports = { SERVICES, LEAD_STATUSES, PAYMENT_STATUSES, LEAD_TYPES };
