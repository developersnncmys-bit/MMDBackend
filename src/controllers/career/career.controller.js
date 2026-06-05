const Career = require("../../models/career/Career");

const slugify = (str) =>
  String(str)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "role";

const uniqueSlug = async (base, ignoreId) => {
  let slug = base;
  let n = 1;
  while (true) {
    const clash = await Career.findOne({ slug, _id: { $ne: ignoreId || null } });
    if (!clash) return slug;
    n += 1;
    slug = `${base}-${n}`;
  }
};

const normaliseTags = (raw) => {
  if (Array.isArray(raw)) return raw.map((t) => String(t).trim()).filter(Boolean);
  if (typeof raw === "string")
    return raw.split(",").map((t) => t.trim()).filter(Boolean);
  return [];
};

// admin lists all; the website passes ?status=open
exports.listCareers = async (req, res) => {
  try {
    const query = {};
    if (req.query.status) query.status = req.query.status;
    const careers = await Career.find(query).sort({ createdAt: -1 });
    return res.json({ success: true, count: careers.length, data: careers });
  } catch (err) {
    console.error("listCareers error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getCareerBySlug = async (req, res) => {
  try {
    const career = await Career.findOne({ slug: req.params.slug });
    if (!career)
      return res.status(404).json({ success: false, message: "Career not found" });
    return res.json({ success: true, data: career });
  } catch (err) {
    console.error("getCareerBySlug error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.createCareer = async (req, res) => {
  try {
    const b = req.body || {};
    const title = String(b.title || "").trim();
    if (!title)
      return res.status(400).json({ success: false, message: "Title is required" });

    const slug = await uniqueSlug(slugify(b.slug || title));
    const slNo = (await Career.countDocuments()) + 1;
    const career = await Career.create({
      slNo,
      title,
      slug,
      department: b.department || "General",
      type: ["Full-time", "Part-time", "Internship", "Contract"].includes(b.type)
        ? b.type
        : "Full-time",
      location: b.location || "Bangalore",
      experience: b.experience || "",
      description: b.description || "",
      tags: normaliseTags(b.tags),
      status: b.status === "closed" ? "closed" : "open",
    });

    return res
      .status(201)
      .json({ success: true, message: "Career created", data: career });
  } catch (err) {
    console.error("createCareer error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.updateCareer = async (req, res) => {
  try {
    const b = req.body || {};
    const career = await Career.findById(req.params.id);
    if (!career)
      return res.status(404).json({ success: false, message: "Career not found" });

    if (b.title !== undefined) career.title = String(b.title).trim();
    if (b.department !== undefined) career.department = b.department;
    if (b.type !== undefined &&
        ["Full-time", "Part-time", "Internship", "Contract"].includes(b.type)) {
      career.type = b.type;
    }
    if (b.location !== undefined) career.location = b.location;
    if (b.experience !== undefined) career.experience = b.experience;
    if (b.description !== undefined) career.description = b.description;
    if (b.tags !== undefined) career.tags = normaliseTags(b.tags);
    if (b.status !== undefined)
      career.status = b.status === "closed" ? "closed" : "open";
    if (b.slug !== undefined && b.slug)
      career.slug = await uniqueSlug(slugify(b.slug), career._id);

    await career.save();
    return res.json({ success: true, message: "Career updated", data: career });
  } catch (err) {
    console.error("updateCareer error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.deleteCareer = async (req, res) => {
  try {
    const career = await Career.findByIdAndDelete(req.params.id);
    if (!career)
      return res.status(404).json({ success: false, message: "Career not found" });
    return res.json({ success: true, message: "Career deleted" });
  } catch (err) {
    console.error("deleteCareer error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
