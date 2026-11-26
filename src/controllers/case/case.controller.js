const Case = require("../../models/case/Case");
const { CASE_STATUSES, canonicalService } = require("../../constants/operations");

// Fields the panel may set on a case.
const EDITABLE = [
  "date", "service", "serviceDetail", "source", "city", "handledBy",
  "appType", "scheme", "category", "name", "phone", "email", "status",
  "portalLoginId", "portalPassword", "appointmentDate", "applicationNo",
  "amount", "extraAmount", "paymentMode", "remarks",
];

const IST_OFFSET = "+05:30";
const MONTH_RE = /^\d{4}-\d{2}$/;

// Start/end of a calendar month in India time, as Dates.
function monthRange(month) {
  const [y, m] = month.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return {
    start: new Date(`${month}-01T00:00:00${IST_OFFSET}`),
    end: new Date(`${next}-01T00:00:00${IST_OFFSET}`),
  };
}

// "YYYY-MM" of a Date in India time.
const istMonth = (d) =>
  new Date(new Date(d).getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 7);

const currentMonth = () => istMonth(new Date());

function pickUpdates(body) {
  const u = {};
  for (const k of EDITABLE) if (body[k] !== undefined) u[k] = body[k];
  if (u.amount !== undefined) u.amount = Number(u.amount) || 0;
  if (u.extraAmount !== undefined) u.extraAmount = Number(u.extraAmount) || 0;
  if (u.date !== undefined) u.date = u.date ? new Date(u.date) : new Date();
  if (u.service !== undefined) u.service = canonicalService(u.service);
  // "Appointment" and "Applied" were folded into "In process".
  if (u.status === "appointment" || u.status === "applied") u.status = "processing";
  if (u.status !== undefined && !CASE_STATUSES.includes(u.status)) delete u.status;
  if (u.portalPassword !== undefined) u.hasPortalPassword = !!String(u.portalPassword);
  return u;
}

async function nextCaseNo() {
  const last = await Case.findOne({}, { caseNo: 1 }).sort({ caseNo: -1 }).lean();
  return (last?.caseNo || 0) + 1;
}

// ---------------------------------------------------------------------------
// Converted lead -> operations case (called from the lead controller)
// ---------------------------------------------------------------------------

// Business rules for cases that come from a converted lead:
//  - "Handled by" is the person the lead was assigned to when it converted,
//    and cannot be edited.
//  - PAN Card needs no further operations work: converted = completed, and
//    the status cannot be changed.
const AUTO_COMPLETE_SERVICES = ["PAN Card"];
const leadOwner = (lead) => {
  const a = String(lead?.assignedTo || "").trim();
  return a && a.toLowerCase() !== "unassigned" ? a : "";
};
const isAutoComplete = (service) => AUTO_COMPLETE_SERVICES.includes(service);

// Creates the case for a converted lead, pre-filled from the lead. Does
// nothing if the lead already has one, so converting twice is harmless.
async function ensureCaseForLead(lead) {
  if (!lead) return null;
  const leadId = String(lead._id || lead.id);
  const existing = await Case.findOne({ leadId }).lean();
  if (existing) return existing;

  const fd = lead.formData || {};
  const service = canonicalService(lead.service);
  const date = lead.status === "converted" && lead.updatedAt ? new Date(lead.updatedAt) : new Date();
  const autoDone = isAutoComplete(service);
  try {
    return await Case.create({
      handledBy: leadOwner(lead),
      ...(autoDone ? { completedAt: date } : {}),
      caseNo: await nextCaseNo(),
      leadId,
      orderId: lead.orderId || "",
      // When the lead converted (its last update) — so leads converted
      // before Operations existed land in the right month, not today.
      date,
      service,
      serviceDetail: lead.service && lead.service !== service ? lead.service : "",
      source: lead.source || (lead.leadType === "website" ? "Website" : ""),
      city: lead.district || fd.district || lead.state || "",
      appType: String(fd.serviceType || fd.applicationType || fd.typeOfApplication || "").toUpperCase(),
      scheme: String(fd.scheme || fd.passportScheme || "").toUpperCase(),
      name: lead.name,
      phone: lead.mobileNumber || "",
      email: lead.email || "",
      amount: Number(lead.amount) || 0,
      paymentMode: lead.paymentStatus === "paid" ? "Online (Paytm)" : "",
      status: autoDone ? "completed" : "new",
      createdBy: "Auto - lead converted",
    });
  } catch (err) {
    // Two conversions racing: the unique index kept one — return it.
    if (err && err.code === 11000) return Case.findOne({ leadId }).lean();
    throw err;
  }
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

// GET /cases?month=YYYY-MM&service=&status=&handledBy=&search=
// Cases created from leads before the rules above existed: fill "Handled by"
// from the lead's owner and complete PAN Card cases. Runs once per server start.
let leadRulesApplied = null;
function applyLeadRulesOnce() {
  if (!leadRulesApplied) {
    leadRulesApplied = (async () => {
      const Lead = require("../../models/lead/Lead");
      // Statuses removed from the pipeline -> "In process".
      await Case.updateMany({ status: { $in: ["appointment", "applied"] } }, { $set: { status: "processing" } });
      const cases = await Case.find({
        leadId: { $type: "string" },
        $or: [{ handledBy: "" }, { handledBy: { $exists: false } }, { service: { $in: AUTO_COMPLETE_SERVICES }, status: { $ne: "completed" } }],
      });
      for (const c of cases) {
        if (!c.handledBy) {
          const lead = /^[a-f0-9]{24}$/i.test(c.leadId) ? await Lead.findById(c.leadId, "assignedTo").lean() : null;
          c.handledBy = leadOwner(lead);
        }
        if (isAutoComplete(c.service) && c.status !== "completed") {
          c.status = "completed";
          c.completedAt = c.completedAt || c.date;
        }
        await c.save();
      }
    })().catch((err) => { console.error("applyLeadRulesOnce error:", err); leadRulesApplied = null; });
  }
  return leadRulesApplied;
}

exports.listCases = async (req, res) => {
  try {
    await applyLeadRulesOnce();
    const { month, service, status, handledBy, search, open } = req.query;
    const q = {};
    if (month && MONTH_RE.test(month)) {
      const { start, end } = monthRange(month);
      q.date = { $gte: start, $lt: end };
    }
    if (service) q.service = service;
    if (status) q.status = status;
    if (open === "1") q.status = { $nin: ["completed", "cancelled"] };
    if (handledBy) q.handledBy = handledBy;
    if (search) {
      const rx = new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      q.$or = [{ name: rx }, { phone: rx }, { email: rx }, { applicationNo: rx }, { orderId: rx }, { city: rx }];
    }
    const rows = await Case.find(q).sort({ date: -1, caseNo: -1 }).limit(2000);
    return res.json({ success: true, data: rows.map((r) => r.toJSON()) });
  } catch (err) {
    console.error("listCases error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getCase = async (req, res) => {
  try {
    const c = await Case.findById(req.params.id);
    if (!c) return res.status(404).json({ success: false, message: "Case not found" });
    return res.json({ success: true, data: c.toJSON() });
  } catch (err) {
    return res.status(400).json({ success: false, message: "Invalid case id" });
  }
};

// Case for a lead (lead view shows "Operations: <status>").
exports.getCaseByLead = async (req, res) => {
  const c = await Case.findOne({ leadId: req.params.leadId });
  return res.json({ success: true, data: c ? c.toJSON() : null });
};

// Portal password, only when someone clicks "show".
exports.getCaseSecret = async (req, res) => {
  try {
    const c = await Case.findById(req.params.id).select("+portalPassword");
    if (!c) return res.status(404).json({ success: false, message: "Case not found" });
    return res.json({ success: true, data: { portalPassword: c.portalPassword || "" } });
  } catch (err) {
    return res.status(400).json({ success: false, message: "Invalid case id" });
  }
};

exports.updateCase = async (req, res) => {
  try {
    const c = await Case.findById(req.params.id);
    if (!c) return res.status(404).json({ success: false, message: "Case not found" });
    const u = pickUpdates(req.body);
    // Locked on cases from a converted lead: who handled it (the lead's owner)
    // and the service; PAN Card cases also keep their automatic "completed".
    if (c.leadId) {
      delete u.handledBy;
      delete u.service;
      if (isAutoComplete(c.service)) delete u.status;
    }
    // Stamp the completion date the first time a case is completed; clear it
    // if the case is reopened, so monthly "completed" counts stay honest.
    if (u.status === "completed" && c.status !== "completed") u.completedAt = new Date();
    if (u.status && u.status !== "completed") u.completedAt = undefined;
    Object.assign(c, u);
    await c.save();
    return res.json({ success: true, message: "Case updated", data: c.toJSON() });
  } catch (err) {
    console.error("updateCase error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.deleteCase = async (req, res) => {
  try {
    const c = await Case.findByIdAndDelete(req.params.id);
    if (!c) return res.status(404).json({ success: false, message: "Case not found" });
    return res.json({ success: true, message: "Case deleted" });
  } catch (err) {
    return res.status(400).json({ success: false, message: "Invalid case id" });
  }
};

// ---------------------------------------------------------------------------
// Stats for the Operations overview
// ---------------------------------------------------------------------------

const money = (c) => (Number(c.amount) || 0) + (Number(c.extraAmount) || 0);

function summarize(rows) {
  const byStatus = Object.fromEntries(CASE_STATUSES.map((s) => [s, 0]));
  let amount = 0, completedAmount = 0;
  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    amount += money(r);
    if (r.status === "completed") completedAmount += money(r);
  }
  const total = rows.length;
  const completed = byStatus.completed || 0;
  const cancelled = byStatus.cancelled || 0;
  const live = total - cancelled; // cancelled cases don't count against completion
  return {
    total, completed, cancelled,
    open: total - completed - cancelled,
    completionPct: live > 0 ? Math.round((completed / live) * 100) : 0,
    amount, completedAmount, byStatus,
  };
}

function groupBy(rows, key) {
  const m = new Map();
  for (const r of rows) {
    const k = String(r[key] || "").trim() || "Not set";
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
}

// GET /cases/stats?month=YYYY-MM  (defaults to the current month, India time)
exports.getCaseStats = async (req, res) => {
  try {
    await applyLeadRulesOnce();
    const month = MONTH_RE.test(String(req.query.month || "")) ? req.query.month : currentMonth();
    const fields = "date status service appType scheme handledBy amount extraAmount";

    // Selected month
    const { start, end } = monthRange(month);
    const rows = await Case.find({ date: { $gte: start, $lt: end } }, fields).lean();

    const byService = [...groupBy(rows, "service")].map(([service, list]) => ({
      service,
      ...summarize(list),
      byType: [...groupBy(list, "appType")].map(([type, l]) => ({ type, ...summarize(l) }))
        .sort((a, b) => b.total - a.total),
    })).sort((a, b) => b.total - a.total);

    const byHandler = [...groupBy(rows, "handledBy")].map(([handledBy, list]) => ({ handledBy, ...summarize(list) }))
      .sort((a, b) => b.total - a.total);

    // Six-month trend ending at the selected month
    const [y, m] = month.split("-").map(Number);
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(Date.UTC(y, m - 1 - i, 1));
      months.push(d.toISOString().slice(0, 7));
    }
    const trendRows = await Case.find(
      { date: { $gte: monthRange(months[0]).start, $lt: end } },
      "date status amount extraAmount"
    ).lean();
    const trendGroups = new Map(months.map((mo) => [mo, []]));
    for (const r of trendRows) trendGroups.get(istMonth(r.date))?.push(r);
    const trend = months.map((mo) => {
      const s = summarize(trendGroups.get(mo));
      return { month: mo, total: s.total, completed: s.completed, completionPct: s.completionPct, amount: s.amount };
    });

    // Everything still open, whatever month it started in (the real backlog)
    const backlog = await Case.countDocuments({ status: { $nin: ["completed", "cancelled"] } });

    return res.json({
      success: true,
      data: { month, summary: summarize(rows), byService, byHandler, trend, backlog },
    });
  } catch (err) {
    console.error("getCaseStats error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// ---------------------------------------------------------------------------
// Handover of converted leads that have no case yet (e.g. converted before the
// Operations module existed) and bulk import from the team's old sheets
// ---------------------------------------------------------------------------

// GET /cases/pending-leads?search=  — converted leads still waiting for a case
exports.listPendingLeads = async (req, res) => {
  try {
    const Lead = require("../../models/lead/Lead");
    const withCase = await Case.distinct("leadId", { leadId: { $type: "string" } });
    const q = { status: "converted", _id: { $nin: withCase.filter((id) => /^[a-f0-9]{24}$/i.test(id)) } };
    const s = String(req.query.search || "").trim();
    if (s) {
      const rx = new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      q.$or = [{ name: rx }, { mobileNumber: rx }, { orderId: rx }, { email: rx }];
    }
    const leads = await Lead.find(q, "name mobileNumber service district state amount source orderId updatedAt createdAt")
      .sort({ updatedAt: -1 }).limit(200).lean();
    const total = await Lead.countDocuments({ status: "converted", _id: q._id });
    return res.json({
      success: true,
      total,
      data: leads.map((l) => ({
        id: String(l._id), name: l.name, mobileNumber: l.mobileNumber, service: l.service,
        city: l.district || l.state || "", amount: l.amount || 0, source: l.source || "",
        orderId: l.orderId || "", convertedAt: l.updatedAt,
      })),
    });
  } catch (err) {
    console.error("listPendingLeads error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// POST /cases/from-lead/:leadId  — hand a converted lead over as a case
exports.createCaseFromLead = async (req, res) => {
  try {
    const Lead = require("../../models/lead/Lead");
    const lead = await Lead.findById(req.params.leadId).lean();
    if (!lead) return res.status(404).json({ success: false, message: "Lead not found" });
    if (lead.status !== "converted") {
      return res.status(400).json({ success: false, message: "Only converted leads can be handed over to operations" });
    }
    const c = await ensureCaseForLead(lead);
    const full = await Case.findById(c._id || c.id);
    return res.status(201).json({ success: true, message: "Case created", data: full.toJSON() });
  } catch (err) {
    console.error("createCaseFromLead error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// POST /cases/from-leads/all  — hand over every converted lead still waiting
exports.handOverAllPending = async (req, res) => {
  try {
    const Lead = require("../../models/lead/Lead");
    const withCase = await Case.distinct("leadId", { leadId: { $type: "string" } });
    const leads = await Lead.find({
      status: "converted",
      _id: { $nin: withCase.filter((id) => /^[a-f0-9]{24}$/i.test(id)) },
    }).sort({ updatedAt: 1 }).lean(); // oldest first, so case numbers follow conversion order
    let created = 0, failed = 0;
    for (const lead of leads) {
      try { await ensureCaseForLead(lead); created++; } catch (e) { failed++; console.error("handOverAll item:", e.message); }
    }
    return res.json({ success: true, message: `${created} case(s) created`, data: { created, failed } });
  } catch (err) {
    console.error("handOverAllPending error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// POST /cases/import  { rows: [...] }  — rows from the team's old Google Sheet.
// Skips rows without a name and rows already imported (same name + phone +
// service + day), so importing the same sheet twice is safe.
exports.importCases = async (req, res) => {
  try {
    const rows = Array.isArray(req.body.rows) ? req.body.rows.slice(0, 3000) : [];
    if (!rows.length) return res.status(400).json({ success: false, message: "No rows to import" });
    const by = String(req.body.createdBy || "Import");

    const Lead = require("../../models/lead/Lead");
    let caseNo = await nextCaseNo();
    let created = 0, duplicates = 0, linked = 0, merged = 0;
    const errors = [];
    for (let i = 0; i < rows.length; i++) {
      const u = pickUpdates(rows[i] || {});
      if (!u.name || !String(u.name).trim()) { errors.push({ row: i + 1, reason: "No customer name" }); continue; }
      if (!u.service) u.service = "Other";
      if (!u.date || isNaN(u.date.getTime())) u.date = new Date();
      if (u.status === "completed") u.completedAt = u.date;

      // Same customer as a converted lead (same mobile + service)? Then this row
      // IS that lead's case: link it (so it leaves "Hand over lead"), or — if
      // the lead already has a case — fill that case's blanks instead of
      // creating a second one.
      const mobile = String(u.phone || "").replace(/\D/g, "").slice(-10);
      if (mobile.length === 10) {
        const leads = await Lead.find({ status: "converted", mobileNumber: new RegExp(`${mobile}$`) }).lean();
        const lead = leads.find((l) => canonicalService(l.service) === u.service);
        if (lead) {
          const leadId = String(lead._id);
          const existing = await Case.findOne({ leadId }).select("+portalPassword");
          if (existing) {
            let changed = false;
            for (const [k, v] of Object.entries(u)) {
              if (["handledBy", "service", "status", "completedAt", "date"].includes(k)) continue;
              const cur = existing[k];
              if ((cur === "" || cur === undefined || cur === null || cur === 0) && v !== "" && v !== 0 && v !== undefined) {
                existing[k] = v; changed = true;
              }
            }
            if (existing.portalPassword) existing.hasPortalPassword = true;
            if (changed) await existing.save();
            merged++;
            continue;
          }
          try {
            const autoDone = isAutoComplete(u.service);
            await Case.create({
              ...u,
              caseNo: caseNo++,
              leadId,
              orderId: lead.orderId || "",
              handledBy: leadOwner(lead) || u.handledBy || "",
              ...(autoDone ? { status: "completed", completedAt: u.completedAt || u.date } : {}),
              createdBy: by,
            });
            linked++;
          } catch (e) {
            if (e && e.code === 11000) merged++;
            else errors.push({ row: i + 1, reason: e.message || "Could not save" });
          }
          continue;
        }
      }

      const dayStart = new Date(u.date); dayStart.setUTCHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart.getTime() + 36 * 3600 * 1000); // covers the IST day either side
      const dupe = await Case.findOne({
        name: String(u.name).trim(), service: u.service, phone: u.phone || "",
        date: { $gte: new Date(dayStart.getTime() - 12 * 3600 * 1000), $lt: dayEnd },
      }, { _id: 1 }).lean();
      if (dupe) { duplicates++; continue; }

      try {
        await Case.create({ ...u, caseNo: caseNo++, createdBy: by });
        created++;
      } catch (e) {
        errors.push({ row: i + 1, reason: e.message || "Could not save" });
      }
    }
    return res.json({
      success: true,
      message: `Imported ${created + linked} case(s)`,
      data: { created, linked, merged, duplicates, errors },
    });
  } catch (err) {
    console.error("importCases error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.ensureCaseForLead = ensureCaseForLead;
