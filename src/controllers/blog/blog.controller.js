const Blog = require("../../models/blog/Blog");

const slugify = (str) =>
  String(str)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "post";

// returns a slug unique across the collection, ignoring `ignoreId` (for updates)
const uniqueSlug = async (base, ignoreId) => {
  let slug = base;
  let n = 1;
  while (true) {
    const clash = await Blog.findOne({ slug, _id: { $ne: ignoreId || null } });
    if (!clash) return slug;
    n += 1;
    slug = `${base}-${n}`;
  }
};

// admin lists all; the website passes ?status=published
exports.listBlogs = async (req, res) => {
  try {
    const query = {};
    if (req.query.status) query.status = req.query.status;
    // The website list (?status=published) only renders card fields — title,
    // excerpt, category, slug, date. Sending the full HTML `content` of every
    // post made the response huge and the blog page slow. Drop it for the public
    // list; the blog detail page fetches the body per-slug. (.lean() too, for a
    // plain-object response that's cheaper to serialize.)
    let q = Blog.find(query).sort({ createdAt: -1 });
    if (req.query.status === "published") q = q.select("-content");
    // .lean() skips Mongoose's toJSON transform, which is what normally maps
    // _id -> id. The admin panel keys edit/delete on `id`, so add it back here
    // (otherwise editing a blog PATCHes /blogs/undefined and silently fails).
    const blogs = (await q.lean()).map((b) => {
      b.id = String(b._id);
      delete b._id;
      return b;
    });
    return res.json({ success: true, count: blogs.length, data: blogs });
  } catch (err) {
    console.error("listBlogs error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getBlogBySlug = async (req, res) => {
  try {
    const blog = await Blog.findOne({ slug: req.params.slug });
    if (!blog)
      return res.status(404).json({ success: false, message: "Blog not found" });
    return res.json({ success: true, data: blog });
  } catch (err) {
    console.error("getBlogBySlug error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.createBlog = async (req, res) => {
  try {
    const b = req.body || {};
    const title = String(b.title || "").trim();
    if (!title)
      return res.status(400).json({ success: false, message: "Title is required" });

    const slug = await uniqueSlug(slugify(b.slug || title));
    const slNo = (await Blog.countDocuments()) + 1;

    const blog = await Blog.create({
      slNo,
      title,
      slug,
      category: b.category || "Passport",
      excerpt: b.excerpt || "",
      image: b.image || "",
      metaTitle: b.metaTitle || "",
      metaDescription: b.metaDescription || "",
      content: b.content || "",
      readTime: b.readTime || "",
      status: b.status === "published" ? "published" : "draft",
    });

    return res
      .status(201)
      .json({ success: true, message: "Blog created", data: blog });
  } catch (err) {
    console.error("createBlog error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.updateBlog = async (req, res) => {
  try {
    const b = req.body || {};
    const blog = await Blog.findById(req.params.id);
    if (!blog)
      return res.status(404).json({ success: false, message: "Blog not found" });

    // Track a title change so the URL slug can follow it.
    let titleChanged = false;
    if (b.title !== undefined) {
      const newTitle = String(b.title).trim();
      titleChanged = newTitle !== blog.title;
      blog.title = newTitle;
    }
    if (b.category !== undefined) blog.category = b.category;
    if (b.excerpt !== undefined) blog.excerpt = b.excerpt;
    if (b.image !== undefined) blog.image = b.image;
    if (b.metaTitle !== undefined) blog.metaTitle = b.metaTitle;
    if (b.metaDescription !== undefined) blog.metaDescription = b.metaDescription;
    if (b.content !== undefined) blog.content = b.content;
    if (b.readTime !== undefined) blog.readTime = b.readTime;
    if (b.status !== undefined)
      blog.status = b.status === "published" ? "published" : "draft";
    // An explicit slug wins. Otherwise, when the title changes, regenerate the
    // URL slug from the new title so the blog's URL stays in sync with it.
    if (b.slug !== undefined && b.slug)
      blog.slug = await uniqueSlug(slugify(b.slug), blog._id);
    else if (titleChanged)
      blog.slug = await uniqueSlug(slugify(blog.title), blog._id);

    await blog.save();
    return res.json({ success: true, message: "Blog updated", data: blog });
  } catch (err) {
    console.error("updateBlog error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.deleteBlog = async (req, res) => {
  try {
    const blog = await Blog.findByIdAndDelete(req.params.id);
    if (!blog)
      return res.status(404).json({ success: false, message: "Blog not found" });
    return res.json({ success: true, message: "Blog deleted" });
  } catch (err) {
    console.error("deleteBlog error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
