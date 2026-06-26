// Regenerate full slugs for blogs whose slug was truncated by the old 80-char
// cap. Only touches blogs whose stored slug is shorter than the full slug
// derived from the title (i.e. genuinely truncated), so correct slugs and
// hand-edited ones are left alone. Ensures uniqueness.
require("dotenv").config();
const mongoose = require("mongoose");

const slugify = (str) =>
  String(str).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "post";

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const B = mongoose.connection.collection("blogs");
  const all = await B.find({}, { projection: { title: 1, slug: 1 } }).toArray();

  let fixed = 0;
  for (const b of all) {
    const full = slugify(b.title);
    // Only fix when the stored slug is a truncated version of the full slug.
    if (b.slug === full) continue;
    if (!full.startsWith(b.slug)) continue; // not a truncation (renamed/edited) — skip

    // Make the new full slug unique across the collection.
    let slug = full, n = 1;
    while (await B.findOne({ slug, _id: { $ne: b._id } })) { n += 1; slug = `${full}-${n}`; }

    await B.updateOne({ _id: b._id }, { $set: { slug } });
    fixed += 1;
    console.log(`fixed: "${b.slug}" -> "${slug}"`);
  }
  console.log(`\nDone. ${fixed} slug(s) regenerated.`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
