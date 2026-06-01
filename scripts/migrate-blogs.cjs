// Migrate blog posts from the legacy MakeMyDocuments cluster (test.blogs)
// into the new MMD backend (mmd.blogs). Dry-run by default — pass --write
// to actually upsert. Re-runs are safe (keyed on the source _id).
//
//   node scripts/migrate-blogs.cjs           # dry run, prints planned changes
//   node scripts/migrate-blogs.cjs --write   # actually insert/update
const { MongoClient } = require("mongodb");

const SOURCE_URI =
  process.env.SOURCE_MONGO_URI ||
  "mongodb+srv://MakeMyDocuments:MakeMyDoc@makemydocuments.gr6dy.mongodb.net/?retryWrites=true&w=majority&appName=MakeMyDocuments";
const TARGET_URI =
  process.env.MONGO_URI ||
  "mongodb+srv://mmdnew:mmdnew@cluster0.sootp5d.mongodb.net/mmd?appName=Cluster0";

const WRITE = process.argv.includes("--write");

const titleFromKebab = (s) =>
  String(s || "").replace(/-+/g, " ").replace(/\s+/g, " ").trim();

const slugify = (s) =>
  String(s || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "post";

const stripHtml = (html) =>
  String(html || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

const makeExcerpt = (html, max = 200) => {
  const text = stripHtml(html);
  if (text.length <= max) return text;
  return text.slice(0, max).replace(/\s+\S*$/, "") + "…";
};

const readTimeFor = (html) => {
  const words = stripHtml(html).split(/\s+/).filter(Boolean).length;
  return `${Math.max(1, Math.ceil(words / 200))} min`;
};

const inferCategory = (title) => {
  // normalise dashes/underscores to spaces so "Police-Clearance" matches "police clearance"
  const t = String(title || "").toLowerCase().replace(/[-_]+/g, " ");
  if (t.includes("police clearance") || t.includes("pcc")) return "Police Clearance Certificate";
  if (t.includes("police verification") || t.includes("pvc")) return "Police Verification";
  if (t.includes("senior citizen")) return "Senior Citizen Card";
  if (t.includes("rental")) return "Rental Agreement";
  if (t.includes("lease")) return "Lease Agreement";
  if (t.includes("msme") || t.includes("udyam")) return "MSME Certificate";
  if (t.includes("insurance")) return "Insurance";
  if (t.includes("affidavit") || t.includes("annexure")) return "Affidavits / Annexure";
  if (t.includes("pan card") || /\bpan\b/.test(t)) return "PAN Card";
  if (t.includes("visa")) return "Tourist Visa";
  if (t.includes("passport")) return "Passport";
  return "Passport";
};

(async () => {
  console.log(`Mode: ${WRITE ? "WRITE — will upsert into target" : "DRY RUN — no writes"}`);
  const src = new MongoClient(SOURCE_URI);
  const tgt = new MongoClient(TARGET_URI);
  try {
    await Promise.all([src.connect(), tgt.connect()]);
    const srcBlogs = src.db("test").collection("blogs");
    const tgtBlogs = tgt.db("mmd").collection("blogs");

    const total = await srcBlogs.countDocuments();
    const existingTotal = await tgtBlogs.countDocuments();
    console.log(`Source docs: ${total}    Target existing docs: ${existingTotal}`);

    const cursor = srcBlogs.find().sort({ createdAt: 1 });
    let i = 0, inserted = 0, updated = 0, errors = 0;
    const usedSlugs = new Set();

    for await (const doc of cursor) {
      i += 1;
      try {
        const sourceId = String(doc._id);
        const displayTitle = titleFromKebab(doc.title) || "Untitled";

        // Build a slug that is unique within the target collection, but allow
        // a re-run to keep matching the doc we previously inserted.
        let baseSlug = slugify(doc.title || displayTitle);
        let slug = baseSlug;
        let n = 1;
        while (
          usedSlugs.has(slug) ||
          (await tgtBlogs.findOne({ slug, source_id: { $ne: sourceId } }))
        ) {
          n += 1;
          slug = `${baseSlug}-${n}`;
        }
        usedSlugs.add(slug);

        const content = String(doc.description || "");
        const mapped = {
          title: displayTitle,
          slug,
          category: inferCategory(doc.title),
          excerpt: makeExcerpt(content),
          image: doc.image || "",
          metaTitle: doc.metaTitle || displayTitle,
          metaDescription: doc.metaDescription || "",
          content,
          readTime: readTimeFor(content),
          status: "published",
          createdAt: doc.createdAt ? new Date(doc.createdAt) : new Date(),
          updatedAt: new Date(),
          source_id: sourceId,
        };

        if (!WRITE) {
          console.log(
            `[${String(i).padStart(3)}/${total}] DRY    slug="${slug}"  cat="${mapped.category}"  title="${mapped.title.slice(0, 60)}"`
          );
          continue;
        }

        const existing = await tgtBlogs.findOne({ source_id: sourceId });
        if (!existing) {
          const slNo = (await tgtBlogs.countDocuments()) + 1;
          await tgtBlogs.insertOne({ slNo, ...mapped });
          inserted += 1;
          console.log(`[${String(i).padStart(3)}/${total}] INSERT slug="${slug}"  slNo=${slNo}`);
        } else {
          // keep existing slNo so admin-side ordering doesn't shift on re-runs
          await tgtBlogs.updateOne({ _id: existing._id }, { $set: mapped });
          updated += 1;
          console.log(`[${String(i).padStart(3)}/${total}] UPDATE slug="${slug}"  slNo=${existing.slNo}`);
        }
      } catch (err) {
        errors += 1;
        console.error(`[${i}/${total}] ERROR title="${doc.title}":`, err.message);
      }
    }

    console.log(`\n=== Done ===`);
    if (WRITE) console.log(`Inserted: ${inserted}    Updated: ${updated}    Errors: ${errors}`);
    else console.log(`Dry run complete — re-run with --write to apply.`);
  } finally {
    await Promise.all([src.close(), tgt.close()]);
  }
})().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
