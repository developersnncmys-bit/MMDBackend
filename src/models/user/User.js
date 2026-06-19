const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    slNo: { type: Number },
    name: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true, default: "" },
    phone: { type: String, default: "" },
    username: { type: String, required: true, unique: true, trim: true },
    // never returned to the client — see toJSON transform and `select: false`
    password: { type: String, required: true, select: false },
    // Plain-text copy of the password, kept ON PURPOSE so admins can view a
    // team member's password in Team Settings (requested by the business).
    // SECURITY NOTE: anyone with admin/DB access can read these, and a DB leak
    // exposes every password. This is an explicit, accepted trade-off.
    passwordPlain: { type: String, default: "" },
    role: { type: String, enum: ["admin", "employee"], default: "employee" },
    status: { type: String, enum: ["active", "inactive"], default: "active" },
    // Services + states this user handles. A new lead is auto-assigned to the
    // user whose services AND states cover the lead's service + state. Empty
    // states = handles that service for ALL states.
    services: { type: [String], default: [] },
    states: { type: [String], default: [] },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      versionKey: false,
      transform: (_doc, ret) => {
        delete ret._id;
        delete ret.password;
        return ret;
      },
    },
  }
);

userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  // Keep a viewable copy before hashing (admin "show password" feature).
  this.passwordPlain = this.password;
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

userSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

module.exports = mongoose.model("User", userSchema);
