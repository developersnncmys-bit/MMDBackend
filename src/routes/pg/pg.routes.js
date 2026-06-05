const express = require("express");
const { initiate, callback } = require("../../controllers/pg/pg.controller");

const router = express.Router();

router.post("/paytm/initiate", initiate);
// Paytm POSTs the callback as x-www-form-urlencoded — express.urlencoded()
// must be mounted globally (it already is in src/app.js).
router.post("/paytm/callback", callback);

module.exports = router;
