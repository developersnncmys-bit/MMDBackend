const mongoose = require("mongoose");

const blogSchema = new mongoose.Schema(
  {
    slNo: { type: Number },
    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, trim: true, lowercase: true },
    category: { type: String, default: "Passport" },
    excerpt: { type: String, default: "" },
    image: { type: String, default: "" },
    metaTitle: { type: String, default: "" },
    metaDescription: { type: String, default: "" },
    // the HTML body of the article (the admin form calls this "description")
    content: { type: String, default: "" },
    readTime: { type: String, default: "" },
    status: { type: String, enum: ["published", "draft"], default: "draft" },
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

module.exports = mongoose.model("Blog", blogSchema);
