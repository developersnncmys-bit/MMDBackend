const Lead = require("../../models/lead/Lead");

const generateOrderId = () =>
  "MMD" + Date.now() + Math.floor(Math.random() * 9000 + 1000);

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

    const now = new Date();
    const slNo = (await Lead.countDocuments()) + 1;

    const lead = await Lead.create({
      slNo,
      orderId: b.orderId || generateOrderId(),
      date: b.date || now.toISOString().slice(0, 10),
      time:
        b.time ||
        now.toLocaleTimeString("en-IN", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        }),
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

    return res
      .status(201)
      .json({ success: true, message: "Lead created", data: lead });
  } catch (err) {
    console.error("createLead error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// admin panel list — supports ?status= and ?search=
exports.listLeads = async (req, res) => {
  try {
    const { status, search } = req.query;
    const query = {};

    if (status) query.status = status;
    if (search) {
      const rx = new RegExp(String(search).trim(), "i");
      query.$or = [{ name: rx }, { mobileNumber: rx }, { orderId: rx }];
    }

    const data = await Lead.find(query).sort({ createdAt: -1 });
    return res.json({ success: true, count: data.length, data });
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
    return res.json({ success: true, data: lead });
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
    return res.json({ success: true, message: "Lead updated", data: lead });
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
    return res.json({ success: true, message: "Note added", data: lead });
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
    return res.json({ success: true, message: "Lead deleted" });
  } catch (err) {
    console.error("deleteLead error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// dashboard counts
exports.getStats = async (req, res) => {
  try {
    const grouped = await Lead.aggregate([
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]);

    const stats = {
      new: 0,
      overdue: 0,
      today: 0,
      followup: 0,
      inprocess: 0,
      converted: 0,
      dead: 0,
      total: 0,
    };
    for (const g of grouped) {
      if (g._id in stats) stats[g._id] = g.count;
      stats.total += g.count;
    }

    return res.json({ success: true, data: stats });
  } catch (err) {
    console.error("getStats error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
