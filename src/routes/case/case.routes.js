const express = require("express");
const {
  listCases,
  getCase,
  getCaseByLead,
  getCaseSecret,
  updateCase,
  deleteCase,
  getCaseStats,
  listPendingLeads,
  createCaseFromLead,
  importCases,
  handOverAllPending,
} = require("../../controllers/case/case.controller");

const router = express.Router();

// Cases only come from converted leads (automatic on conversion, or handed
// over here) or from importing the team's old sheets — no free-form create.
router.get("/stats", getCaseStats);
router.get("/pending-leads", listPendingLeads);
router.post("/from-leads/all", handOverAllPending);
router.post("/from-lead/:leadId", createCaseFromLead);
router.post("/import", importCases);
router.get("/by-lead/:leadId", getCaseByLead);
router.get("/", listCases);
router.get("/:id/secret", getCaseSecret);
router.get("/:id", getCase);
router.patch("/:id", updateCase);
router.delete("/:id", deleteCase);

module.exports = router;
