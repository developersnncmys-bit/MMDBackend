// One-time cleanup: leads marked paymentStatus="paid" but with NO real Paytm
// transaction (no paytmTxnId AND no paidAt) are false positives carried over
// from the migrated old data. Set them to "unpaid". Genuine Paytm payments
// (which always record paytmTxnId + paidAt) are untouched.
//
// Reversible: the original paid flag still exists in the old source DB (the
// migration preserved each lead's _id), so this can be re-derived if needed.
require("dotenv").config();
const mongoose = require("mongoose");

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const Lead = mongoose.connection.collection("leads");

  const filter = {
    paymentStatus: "paid",
    $and: [
      { $or: [{ paytmTxnId: { $in: [null, ""] } }, { paytmTxnId: { $exists: false } }] },
      { $or: [{ paidAt: null }, { paidAt: { $exists: false } }] },
    ],
  };

  const before = await Lead.countDocuments({ paymentStatus: "paid" });
  const toFix = await Lead.countDocuments(filter);
  console.log("paid before:        ", before);
  console.log("to mark unpaid:     ", toFix);
  console.log("genuine paid (keep):", before - toFix);

  const res = await Lead.updateMany(filter, { $set: { paymentStatus: "unpaid" } });
  console.log("modified:           ", res.modifiedCount);

  const after = await Lead.countDocuments({ paymentStatus: "paid" });
  console.log("paid after:         ", after);

  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
