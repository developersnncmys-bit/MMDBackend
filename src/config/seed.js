const User = require("../models/user/User");

// Creates a default admin the first time the app runs against an empty user
// collection, so the admin panel has a login to bootstrap from. Once any user
// exists this is a no-op.
exports.seedDefaultAdmin = async () => {
  try {
    const count = await User.countDocuments();
    if (count > 0) return;
    await User.create({
      slNo: 1,
      name: "Deepak Kumar",
      email: "admin@makemydocuments.com",
      phone: "",
      username: "deepak",
      password: "admin123",
      role: "admin",
      status: "active",
    });
    console.log("Seeded default admin — username: deepak / password: admin123");
  } catch (err) {
    console.error("seedDefaultAdmin error:", err.message);
  }
};
