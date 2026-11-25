const mongoose = require("mongoose");
const { CASE_STATUSES } = require("../../constants/operations");

// One operations case = one customer's service being processed by the backend
// team after their lead converted. Mirrors the columns of the team's sheet.
const caseSchema = new mongoose.Schema(
  {
    caseNo: { type: Number, index: true },

    // Link back to the converted lead (absent for cases added by hand).
    leadId: { type: String },
    orderId: { type: String, default: "" },

    date: { type: Date, default: Date.now, index: true }, // when the case started
    service: { type: String, required: true, trim: true, index: true },
    serviceDetail: { type: String, default: "" }, // the lead's original wording, e.g. "Dubai Tourist Visa"

    source: { type: String, default: "" },    // CALL / REF / WEBSITE / WALK-IN …
    city: { type: String, default: "" },
    handledBy: { type: String, default: "" }, // backend team member

    appType: { type: String, default: "" },   // FRESH / RE-ISSUE / LOP / CORRECTION …
    scheme: { type: String, default: "" },    // NORMAL / TATKAL / SPECIAL
    category: { type: String, default: "" },  // ADULT / MINOR / SENIOR

    name: { type: String, required: true, trim: true },
    phone: { type: String, default: "" },
    email: { type: String, default: "", trim: true, lowercase: true },

    status: { type: String, enum: CASE_STATUSES, default: "new", index: true },

    // Customer's government-portal login (e.g. Passport Seva). The password is
    // never sent in lists — the panel fetches it on demand (GET /:id/secret).
    portalLoginId: { type: String, default: "" },
    portalPassword: { type: String, default: "", select: false },
    hasPortalPassword: { type: Boolean, default: false },

    appointmentDate: { type: String, default: "" }, // YYYY-MM-DD
    applicationNo: { type: String, default: "" },   // ARN / file / acknowledgement no.

    amount: { type: Number, default: 0 },      // service charge
    extraAmount: { type: Number, default: 0 }, // govt / tatkal / extra fee ("3500+2000")
    paymentMode: { type: String, default: "" },

    remarks: { type: String, default: "" },
    completedAt: { type: Date },
    createdBy: { type: String, default: "" },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      versionKey: false,
      transform: (_doc, ret) => {
        delete ret._id;
        delete ret.portalPassword;
        return ret;
      },
    },
  }
);

// One case per converted lead (manual cases have no leadId).
caseSchema.index(
  { leadId: 1 },
  { unique: true, partialFilterExpression: { leadId: { $type: "string" } } }
);

module.exports = mongoose.model("Case", caseSchema);
