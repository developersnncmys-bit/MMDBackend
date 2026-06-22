// Assign a topic-matched stock image to blogs that don't have one.
// Source: loremflickr (keyword-matched real photos, no API key). A per-blog
// "lock" makes each blog keep the SAME image on every load.
//
//   node scripts/blog-images.cjs --limit 3        # sample: first 3 (distinct cats)
//   node scripts/blog-images.cjs --all            # every blog without an image
//   node scripts/blog-images.cjs --all --force    # overwrite existing images too
require("dotenv").config();
const mongoose = require("mongoose");

const args = process.argv.slice(2);
const ALL = args.includes("--all");
const FORCE = args.includes("--force");
const limArg = args.indexOf("--limit");
const LIMIT = limArg !== -1 ? Number(args[limArg + 1]) || 3 : 3;

// category -> loremflickr tag query (comma = AND-ish tag match)
const CATEGORY_TAGS = {
  "Passport": "passport,travel",
  "Tourist Visa": "visa,airport,travel",
  "PAN Card": "document,identity,card",
  "Senior Citizen Card": "elderly,senior,india",
  "Insurance": "insurance,family,protection",
  "Rental Agreement": "contract,agreement,keys,house",
  "Lease Agreement": "contract,agreement,office",
  "Police Verification": "police,document",
  "Police Clearance Certificate": "police,document,law",
  "MSME Certificate": "business,office,startup",
  "Affidavits / Annexure": "legal,document,paper",
};
const tagsFor = (cat) => CATEGORY_TAGS[cat] || "documents,office,india";

const imageUrl = (cat, lock) =>
  `https://loremflickr.com/1200/630/${tagsFor(cat)}?lock=${lock}`;

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const Blog = mongoose.connection.collection("blogs");

  // Target blogs whose image is missing OR not a real URL/data-URI (the legacy
  // migration left bare filenames like "1743679867815.png" that 404 on the new
  // site). --force overwrites everything including valid URLs.
  const query = FORCE ? {} : { image: { $not: { $regex: "^(https?:|data:)" } } };
  let blogs = await Blog.find(query).project({ title: 1, category: 1, slNo: 1, slug: 1 }).toArray();

  if (!ALL) {
    // Sample: pick up to LIMIT blogs from DISTINCT categories for a varied demo.
    const seen = new Set();
    const picked = [];
    for (const b of blogs) {
      if (seen.has(b.category)) continue;
      seen.add(b.category);
      picked.push(b);
      if (picked.length >= LIMIT) break;
    }
    blogs = picked.length ? picked : blogs.slice(0, LIMIT);
  }

  console.log(`Updating ${blogs.length} blog(s)${ALL ? " (ALL)" : " (sample)"}…\n`);
  let n = 0;
  for (const b of blogs) {
    const lock = b.slNo || (n + 1);
    const url = imageUrl(b.category, lock);
    await Blog.updateOne({ _id: b._id }, { $set: { image: url } });
    n += 1;
    console.log(`[${n}] ${b.category} — ${String(b.title).slice(0, 55)}`);
    console.log(`     slug:  ${b.slug}`);
    console.log(`     image: ${url}\n`);
  }

  console.log(`Done. Updated ${n} blog(s).`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
