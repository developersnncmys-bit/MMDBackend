const dotenv = require("dotenv");

dotenv.config({ quiet: true });

const app = require("./src/app");
const { connectDB } = require("./src/config/db");
const { seedDefaultAdmin } = require("./src/config/seed");

connectDB().then(seedDefaultAdmin);

const PORT = process.env.PORT || 9000;

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
