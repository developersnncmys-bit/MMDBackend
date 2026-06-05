const express = require("express");
const {
  listCareers,
  getCareerBySlug,
  createCareer,
  updateCareer,
  deleteCareer,
} = require("../../controllers/career/career.controller");

const router = express.Router();

router.get("/slug/:slug", getCareerBySlug);
router.get("/", listCareers);
router.post("/", createCareer);
router.patch("/:id", updateCareer);
router.delete("/:id", deleteCareer);

module.exports = router;
