const Lead = require("../../models/lead/Lead");

const generateOrderId = () =>
  "MMD" + Date.now() + Math.floor(Math.random() * 9000 + 1000);

// All date/time strings are stored in IST so they match what the user actually
// entered the form at — Render servers run UTC, which is ~5h30m behind India.
const istDate = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const istTime = () =>
  new Date().toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });

// The three follow-up buckets are derived from followUpDate, not stored as a
// fixed value: a lead scheduled for the future sits in "followup", rolls into
// "today" on the day, and into "overdue" once the date passes. We keep the
// stored status as the admin set it and recompute the display bucket on read.
const SCHEDULED_STATUSES = ["followup", "today", "overdue"];

// "Today" for follow-up bucketing must be India time — the Render server runs
// UTC (~5.5h behind IST), which otherwise pushes a follow-up dated for today
// into the wrong bucket near midnight. Follow-up dates are entered/stored in
// IST, so compare against the IST date.
const localToday = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

// followUpDate may be a real Date (migrated/legacy rows) OR a "YYYY-MM-DD"
// string. Normalize both to an IST calendar date so bucketing is consistent.
const toYMD = (v) => {
  if (!v) return "";
  if (v instanceof Date)
    return v.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  return String(v).slice(0, 10);
};

const effectiveStatus = (status, followUpDate) => {
  if (!followUpDate || !SCHEDULED_STATUSES.includes(status)) return status;
  const fu = toYMD(followUpDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fu)) return status;
  const today = localToday();
  if (fu < today) return "overdue";
  if (fu === today) return "today";
  return "followup";
};

const serializeLead = (doc) => {
  const o = doc && typeof doc.toJSON === "function" ? doc.toJSON() : doc;
  if (o) o.status = effectiveStatus(o.status, o.followUpDate);
  return o;
};

// website submits leads, admin can also add them manually
exports.createLead = async (req, res) => {
  try {
    const b = req.body || {};

    const name = String(b.name || "").trim();
    const mobileNumber = String(b.mobileNumber || b.mobile || "").trim();
    const service = String(b.service || "").trim();

    if (!name) {
      return res
        .status(400)
        .json({ success: false, message: "Name is required" });
    }
    if (!mobileNumber) {
      return res
        .status(400)
        .json({ success: false, message: "Mobile number is required" });
    }
    if (!service) {
      return res
        .status(400)
        .json({ success: false, message: "Service is required" });
    }

    const slNo = (await Lead.countDocuments()) + 1;

    const lead = await Lead.create({
      slNo,
      orderId: b.orderId || generateOrderId(),
      date: b.date || istDate(),
      time: b.time || istTime(),
      name,
      mobileNumber,
      email: b.email || "",
      address: b.address || "",
      district: b.district || "",
      state: b.state || b.addrState || "",
      pinCode: b.pinCode || "",
      service,
      amount: Number(b.amount) || 0,
      paymentStatus: b.paymentStatus || "unpaid",
      status: b.status || "new",
      assignedTo: b.assignedTo || "",
      source: b.source || "Website",
      leadType: b.leadType || "website",
      followUpDate: b.followUpDate,
      applyingFor: b.applyingFor,
      gender: b.gender,
      dateOfBirth: b.dateOfBirth || b.dob,
      placeOfBirth: b.placeOfBirth,
      educationQualification: b.educationQualification || b.education,
      employmentType: b.employmentType || b.employment,
      nearbyPoliceStation: b.nearbyPoliceStation || b.policeStation,
      formData:
        b.formData && typeof b.formData === "object" ? b.formData : {},
    });

    // Add the new lead to the cache so it appears on the next fetch.
    upsertLeadCache(lead);

    return res
      .status(201)
      .json({ success: true, message: "Lead created", data: serializeLead(lead) });
  } catch (err) {
    console.error("createLead error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// admin panel list — supports ?status= and ?search=
// Returns EVERY matching lead but LEAN and with only the fields the list /
// table / search / dashboard actually use. Excluding the heavy `formData`
// blob (and using .lean(), which skips Mongoose hydration) is what keeps an
// 18k-lead response small (~8MB) and fast enough to serve — the previous
// "return full documents" version produced ~52MB and 500/502'd the host,
// blanking the panel. The detail view fetches the full lead (incl. formData)
// separately via getLeadById.
const LEAD_LIST_FIELDS =
  "slNo name mobileNumber email service status assignedTo amount paymentStatus " +
  "district state date time createdAt followUpDate orderId leadType source";

// Run the lean list query and normalize each row (id + derived status bucket).
const buildLeadList = async (query = {}) => {
  const data = await Lead.find(query)
    .select(LEAD_LIST_FIELDS)
    .sort({ createdAt: -1 })
    .lean(); // plain objects — far cheaper than hydrating 18k documents
  return data.map((o) => {
    o.id = String(o._id);
    delete o._id;
    o.status = effectiveStatus(o.status, o.followUpDate);
    return o;
  });
};

// Convert a single Lead doc to the lean list-row shape used in the cache, so a
// create/update can patch the cache directly instead of waiting for the 25s
// background rebuild (which is why a status change "needed many refreshes").
const LEAD_LIST_KEYS = LEAD_LIST_FIELDS.split(/\s+/);
const toLeadListRow = (doc) => {
  const o = typeof doc.toObject === "function" ? doc.toObject() : doc;
  const row = { id: String(o._id) };
  for (const k of LEAD_LIST_KEYS) row[k] = o[k];
  row.status = effectiveStatus(o.status, o.followUpDate);
  return row;
};

// Patch (or insert) one lead in the cached list.
const upsertLeadCache = (doc) => {
  if (!leadListCache.data) return;
  const row = toLeadListRow(doc);
  const idx = leadListCache.data.findIndex((l) => l.id === row.id);
  if (idx !== -1) leadListCache.data[idx] = row;
  else leadListCache.data.unshift(row);
};

// In-memory cache of the FULL (unfiltered) lead list, refreshed in the
// background. The admin panel loads the whole list on startup; querying ~18k
// leads from the (cloud) DB takes several seconds, so without this every page
// load waited on that. With the cache, the panel is served instantly and the
// expensive query runs at most once per interval — no matter how many admins
// are open. Up to ~25s staleness, which is fine for a CRM (and the panel does
// optimistic updates for the user's own actions anyway).
let leadListCache = { data: null, builtAt: 0 };
const refreshLeadCache = async () => {
  try {
    leadListCache = { data: await buildLeadList({}), builtAt: Date.now() };
  } catch (err) {
    console.error("lead cache refresh failed:", err.message);
  }
};
// NOTE: no background setInterval refresh. A periodic rebuild could finish a DB
// query that started BEFORE a delete/update and overwrite the cache with stale
// data — which made deletes/status-changes "sometimes" revert. Every write goes
// through create/update/delete here and patches the cache directly, so it stays
// correct without a background rebuild. (After a direct DB change such as a
// migration/sync script, restart the backend to rebuild the cache.)

exports.listLeads = async (req, res) => {
  try {
    const { status, search, assignedTo } = req.query;

    // No filters → the panel's main load. Serve the cached full list instantly
    // (building it once if the cache is still cold).
    if (!status && !search && !assignedTo) {
      if (!leadListCache.data) await refreshLeadCache();
      const data = leadListCache.data || [];
      return res.json({ success: true, count: data.length, data });
    }

    // Filtered queries are smaller and run directly (not cached).
    const query = {};
    if (status) query.status = status;
    if (assignedTo) query.assignedTo = assignedTo;
    if (search) {
      const rx = new RegExp(
        String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "i"
      );
      query.$or = [{ name: rx }, { mobileNumber: rx }, { orderId: rx }, { email: rx }];
    }

    const out = await buildLeadList(query);
    return res.json({ success: true, count: out.length, data: out });
  } catch (err) {
    console.error("listLeads error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getLeadById = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      return res
        .status(404)
        .json({ success: false, message: "Lead not found" });
    }
    return res.json({ success: true, data: serializeLead(lead) });
  } catch (err) {
    console.error("getLeadById error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// admin updates workflow fields (status, assignee, payment, amount, follow-up)
exports.updateLead = async (req, res) => {
  try {
    const allowed = [
      "status",
      "assignedTo",
      "paymentStatus",
      "amount",
      "followUpDate",
      "service",
      "name",
      "mobileNumber",
      "email",
      "address",
      "district",
      "state",
      "pinCode",
      "source",
      // applicant fields the admin's per-service form can edit
      "applyingFor",
      "gender",
      "dateOfBirth",
      "placeOfBirth",
      "educationQualification",
      "employmentType",
      "nearbyPoliceStation",
      // the admin view edits the per-service form fields and the activity feed,
      // which it sends back as the full formData object / notes array
      "formData",
      "notes",
      "date",
      "time",
    ];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    const lead = await Lead.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
    });
    if (!lead) {
      return res
        .status(404)
        .json({ success: false, message: "Lead not found" });
    }
    // Patch the cache so the new status/assignee/etc. shows on the next fetch
    // (and survives a page refresh) instead of waiting for the 25s rebuild.
    upsertLeadCache(lead);
    return res.json({ success: true, message: "Lead updated", data: serializeLead(lead) });
  } catch (err) {
    console.error("updateLead error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.addNote = async (req, res) => {
  try {
    const text = String(req.body.text || "").trim();
    if (!text) {
      return res
        .status(400)
        .json({ success: false, message: "Note text is required" });
    }

    const lead = await Lead.findByIdAndUpdate(
      req.params.id,
      { $push: { notes: { text, author: req.body.author || "Admin" } } },
      { new: true }
    );
    if (!lead) {
      return res
        .status(404)
        .json({ success: false, message: "Lead not found" });
    }
    return res.json({ success: true, message: "Note added", data: serializeLead(lead) });
  } catch (err) {
    console.error("addNote error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.deleteLead = async (req, res) => {
  try {
    const lead = await Lead.findByIdAndDelete(req.params.id);
    if (!lead) {
      return res
        .status(404)
        .json({ success: false, message: "Lead not found" });
    }
    // Keep the in-memory cache in sync immediately, otherwise the next list
    // fetch returns the cached (still-present) lead and it "reappears" until
    // the 25s background refresh — which is why deletes seemed to need many
    // refreshes to stick.
    if (leadListCache.data) {
      const id = String(req.params.id);
      leadListCache.data = leadListCache.data.filter((l) => l.id !== id);
    }
    return res.json({ success: true, message: "Lead deleted" });
  } catch (err) {
    console.error("deleteLead error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// dashboard counts — uses the derived follow-up buckets so the totals match
// what the admin sees in each list. Computed server-side (aggregation + a
// couple of targeted counts) instead of loading every lead, so it stays cheap
// even at 18k+ and is safe to poll frequently.
exports.getStats = async (req, res) => {
  try {
    // Optional ?assignedTo= scopes the counts to one employee (so an employee's
    // dashboard shows THEIR numbers); omitted = whole pipeline (admin).
    const match = {};
    if (req.query.assignedTo) match.assignedTo = String(req.query.assignedTo);

    // counts per STORED status (server-side group, no documents transferred)
    const grouped = await Lead.aggregate([
      { $match: match },
      { $group: { _id: "$status", n: { $sum: 1 } } },
    ]);
    const byStored = {};
    let total = 0;
    for (const g of grouped) {
      byStored[g._id || ""] = g.n;
      total += g.n;
    }

    // Scheduled leads split into followup/today/overdue by followUpDate. This
    // set is small (only leads in a scheduled status), so bucket them in JS via
    // effectiveStatus — which handles both Date and "YYYY-MM-DD" values. A
    // $regex query would silently miss Date-typed followUpDate values.
    const scheduled = await Lead.find(
      { ...match, status: { $in: SCHEDULED_STATUSES } },
      "status followUpDate"
    ).lean();
    let overdue = 0;
    let todayCount = 0;
    let followup = 0;
    for (const l of scheduled) {
      const eff = effectiveStatus(l.status, l.followUpDate);
      if (eff === "overdue") overdue += 1;
      else if (eff === "today") todayCount += 1;
      else followup += 1;
    }

    const stats = {
      new: byStored.new || 0,
      overdue,
      today: todayCount,
      followup,
      inprocess: byStored.inprocess || 0,
      converted: byStored.converted || 0,
      dead: byStored.dead || 0,
      total,
    };

    return res.json({ success: true, data: stats });
  } catch (err) {
    console.error("getStats error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
