const mongoose = require("mongoose");

const careerSchema = new mongoose.Schema(
  {
    slNo: { type: Number },
    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, trim: true, lowercase: true },
    department: { type: String, default: "General" },
    type: {
      type: String,
      enum: ["Full-time", "Part-time", "Internship", "Contract"],
      default: "Full-time",
    },
    location: { type: String, default: "Bangalore" },
    experience: { type: String, default: "" }, // e.g. "1-3 years"
    description: { type: String, default: "" },
    tags: { type: [String], default: [] },
    status: { type: String, enum: ["open", "closed"], default: "open" },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      versionKey: false,
      transform: (_doc, ret) => {
        delete ret._id;
        return ret;
      },
    },
  }
);

module.exports = mongoose.model("Career", careerSchema);
