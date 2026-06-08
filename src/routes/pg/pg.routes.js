const express = require("express");
const { initiate, callback, refund } = require("../../controllers/pg/pg.controller");

const router = express.Router();

router.post("/paytm/initiate", initiate);
// Admin-issued refund. Called from the admin panel's Refund button.
// Body: { leadId, amount } — refunds the given amount to the original
// payment source. Paytm handles the routing back to the customer.
router.post("/paytm/refund", refund);
// Paytm POSTs the callback as x-www-form-urlencoded — express.urlencoded()
// must be mounted globally (it already is in src/app.js). We also handle GET
// because Paytm occasionally returns the user via GET (and so does anyone who
// refreshes / bookmarks the URL) — the handler redirects them to the failure
// page in that case instead of showing raw JSON.
router.post("/paytm/callback", callback);
router.get("/paytm/callback", callback);

module.exports = router;
