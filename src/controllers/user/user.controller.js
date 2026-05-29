const User = require("../../models/user/User");

const isDuplicate = (err) => err && err.code === 11000;

// list all team members (admin Settings page)
exports.listUsers = async (req, res) => {
  try {
    const users = await User.find().sort({ createdAt: 1 });
    return res.json({ success: true, count: users.length, data: users });
  } catch (err) {
    console.error("listUsers error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.createUser = async (req, res) => {
  try {
    const b = req.body || {};
    const name = String(b.name || "").trim();
    const username = String(b.username || "").trim();
    const password = String(b.password || "");

    if (!name)
      return res.status(400).json({ success: false, message: "Name is required" });
    if (!username)
      return res.status(400).json({ success: false, message: "Username is required" });
    if (password.length < 6)
      return res
        .status(400)
        .json({ success: false, message: "Password must be at least 6 characters" });

    const slNo = (await User.countDocuments()) + 1;
    const user = await User.create({
      slNo,
      name,
      email: String(b.email || "").trim(),
      phone: String(b.phone || "").trim(),
      username,
      password,
      role: b.role === "admin" ? "admin" : "employee",
      status: b.status === "inactive" ? "inactive" : "active",
    });

    return res
      .status(201)
      .json({ success: true, message: "User created", data: user });
  } catch (err) {
    if (isDuplicate(err))
      return res
        .status(409)
        .json({ success: false, message: "Username already taken" });
    console.error("createUser error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.updateUser = async (req, res) => {
  try {
    const b = req.body || {};
    // load with password so a save() re-hashes only when a new one is provided
    const user = await User.findById(req.params.id).select("+password");
    if (!user)
      return res.status(404).json({ success: false, message: "User not found" });

    if (b.username !== undefined) {
      const username = String(b.username).trim();
      if (username && username !== user.username) {
        const taken = await User.findOne({ username, _id: { $ne: user._id } });
        if (taken)
          return res
            .status(409)
            .json({ success: false, message: "Username already taken" });
        user.username = username;
      }
    }
    if (b.name !== undefined) user.name = String(b.name).trim();
    if (b.email !== undefined) user.email = String(b.email).trim();
    if (b.phone !== undefined) user.phone = String(b.phone).trim();
    if (b.role !== undefined) user.role = b.role === "admin" ? "admin" : "employee";
    if (b.status !== undefined)
      user.status = b.status === "inactive" ? "inactive" : "active";
    if (b.password) {
      if (String(b.password).length < 6)
        return res
          .status(400)
          .json({ success: false, message: "Password must be at least 6 characters" });
      user.password = String(b.password); // re-hashed by the pre-save hook
    }

    await user.save();
    return res.json({ success: true, message: "User updated", data: user });
  } catch (err) {
    if (isDuplicate(err))
      return res
        .status(409)
        .json({ success: false, message: "Username already taken" });
    console.error("updateUser error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.deleteUser = async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user)
      return res.status(404).json({ success: false, message: "User not found" });
    return res.json({ success: true, message: "User deleted" });
  } catch (err) {
    console.error("deleteUser error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// admin panel login — validates credentials, returns the user (no password)
exports.login = async (req, res) => {
  try {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");
    if (!username || !password)
      return res
        .status(400)
        .json({ success: false, message: "Please enter your username and password." });

    const user = await User.findOne({ username }).select("+password");
    if (!user || !(await user.comparePassword(password)))
      return res
        .status(401)
        .json({ success: false, message: "Invalid username or password." });
    if (user.status === "inactive")
      return res.status(403).json({
        success: false,
        message: "Your account is inactive. Please contact your admin.",
      });

    return res.json({ success: true, message: "Login successful", data: user });
  } catch (err) {
    console.error("login error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
