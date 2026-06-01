// Read-only inspection of the source `test.blogs` collection. Run once to
// see the document shape so the migration script can map fields correctly.
//
//   node scripts/discover-blogs.cjs
const { MongoClient } = require("mongodb");

const SOURCE_URI =
  process.env.SOURCE_MONGO_URI ||
  "mongodb+srv://MakeMyDocuments:MakeMyDoc@makemydocuments.gr6dy.mongodb.net/?retryWrites=true&w=majority&appName=MakeMyDocuments";

(async () => {
  const client = new MongoClient(SOURCE_URI);
  try {
    await client.connect();
    const db = client.db("test");

    const cols = await db.listCollections().toArray();
    console.log(
      `Collections in 'test':`,
      cols.map((c) => c.name).sort()
    );

    const blogs = db.collection("blogs");
    const count = await blogs.countDocuments();
    console.log(`\n test.blogs total documents: ${count}`);

    if (count === 0) {
      console.log("No documents in test.blogs — nothing to migrate.");
      return;
    }

    const keys = new Set();
    await blogs.find().forEach((d) => {
      Object.keys(d).forEach((k) => keys.add(k));
    });
    console.log(`\nUnique top-level keys across docs:`, [...keys].sort());

    const samples = await blogs.find().limit(3).toArray();
    console.log(`\n=== First 3 sample documents ===`);
    samples.forEach((s, i) => {
      console.log(`\n--- Sample ${i + 1} ---`);
      // truncate long fields so the console output stays readable
      const out = {};
      for (const [k, v] of Object.entries(s)) {
        if (typeof v === "string" && v.length > 500)
          out[k] = `${v.slice(0, 500)}…  [truncated, ${v.length} chars]`;
        else out[k] = v;
      }
      console.log(JSON.stringify(out, null, 2));
    });
  } catch (err) {
    console.error("Discovery failed:", err.message);
    process.exit(1);
  } finally {
    await client.close();
  }
})();
