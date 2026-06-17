// Read-only diagnostic: understand which "paid" leads are genuine (have a Paytm
// transaction) vs migrated/false. Prints counts and a few samples. No writes.
require("dotenv").config();
const mongoose = require("mongoose");

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const Lead = mongoose.connection.collection("leads");

  const total = await Lead.countDocuments();
  const paid = await Lead.countDocuments({ paymentStatus: "paid" });
  const paidWithTxn = await Lead.countDocuments({
    paymentStatus: "paid",
    paytmTxnId: { $exists: true, $nin: [null, ""] },
  });
  const paidNoTxn = paid - paidWithTxn;
  const paidNoTxnNoOrder = await Lead.countDocuments({
    paymentStatus: "paid",
    $or: [{ paytmTxnId: { $in: [null, ""] } }, { paytmTxnId: { $exists: false } }],
    $and: [{ $or: [{ orderId: { $in: [null, ""] } }, { orderId: { $exists: false } }] }],
  });
  const paidAmount0 = await Lead.countDocuments({ paymentStatus: "paid", amount: { $lte: 0 } });
  const paidWithPaidAt = await Lead.countDocuments({ paymentStatus: "paid", paidAt: { $exists: true, $ne: null } });

  console.log("── PAID LEAD BREAKDOWN ───────────────────────");
  console.log("total leads:           ", total);
  console.log("paymentStatus=paid:    ", paid);
  console.log("  has paytmTxnId:      ", paidWithTxn);
  console.log("  NO paytmTxnId:       ", paidNoTxn);
  console.log("  has paidAt:          ", paidWithPaidAt);
  console.log("  paid but amount<=0:  ", paidAmount0);
  console.log("  paid, no txn, no ord:", paidNoTxnNoOrder);

  console.log("\n── 8 sample PAID leads WITHOUT a txn id ─────");
  const samples = await Lead.find({
    paymentStatus: "paid",
    $or: [{ paytmTxnId: { $in: [null, ""] } }, { paytmTxnId: { $exists: false } }],
  }).project({ name: 1, amount: 1, orderId: 1, paytmTxnId: 1, source: 1, leadType: 1, paidAt: 1, createdAt: 1 }).limit(8).toArray();
  for (const s of samples) {
    console.log(JSON.stringify({
      name: s.name, amount: s.amount, orderId: s.orderId || null,
      txn: s.paytmTxnId || null, source: s.source, leadType: s.leadType,
      paidAt: s.paidAt || null, createdAt: s.createdAt,
    }));
  }

  console.log("\n── 4 sample PAID leads WITH a txn id ────────");
  const samples2 = await Lead.find({
    paymentStatus: "paid", paytmTxnId: { $exists: true, $nin: [null, ""] },
  }).project({ name: 1, amount: 1, orderId: 1, paytmTxnId: 1, source: 1, paidAt: 1 }).limit(4).toArray();
  for (const s of samples2) {
    console.log(JSON.stringify({ name: s.name, amount: s.amount, orderId: s.orderId || null, txn: s.paytmTxnId, source: s.source, paidAt: s.paidAt || null }));
  }

  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
