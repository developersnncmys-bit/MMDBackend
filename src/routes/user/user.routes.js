const express = require("express");
const {
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  login,
} = require("../../controllers/user/user.controller");

const router = express.Router();

router.post("/login", login);
router.get("/", listUsers);
router.post("/", createUser);
router.patch("/:id", updateUser);
router.delete("/:id", deleteUser);

module.exports = router;
