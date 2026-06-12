const express = require("express");
const cors = require("cors");
const compression = require("compression");
const morgan = require("morgan");
const bodyParser = require("body-parser");
const routes = require("./routes");

const app = express();

// gzip every response. The leads list is several MB of JSON; gzip shrinks it
// ~8x over the wire, which is the single biggest speedup for the admin panel.
app.use(compression());

// Reflects the request origin, so the website and admin panel work on any
// localhost port or deployed domain without maintaining an allowlist.
app.use(cors({ origin: true }));
app.use(express.json({ limit: "10mb" }));
app.use(bodyParser.urlencoded({ limit: "10mb", extended: true }));
app.use(morgan("dev"));

app.get("/", (req, res) => {
  res.json({ success: true, message: "MMD backend is running" });
});

app.use("/api", routes);

module.exports = app;
