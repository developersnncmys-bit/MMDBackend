const dotenv = require("dotenv");

dotenv.config({ quiet: true });

const app = require("./src/app");
const { connectDB } = require("./src/config/db");

connectDB();

const PORT = process.env.PORT || 9000;

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
