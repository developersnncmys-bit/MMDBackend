const express = require("express");
const {
  createLead,
  listLeads,
  getLeadById,
  updateLead,
  addNote,
  deleteLead,
  getStats,
} = require("../../controllers/lead/lead.controller");

const router = express.Router();

router.post("/", createLead);
router.get("/", listLeads);
router.get("/stats", getStats);
router.get("/:id", getLeadById);
router.patch("/:id", updateLead);
router.post("/:id/notes", addNote);
router.delete("/:id", deleteLead);

module.exports = router;
