const express = require("express");
const {
  listBlogs,
  getBlogBySlug,
  createBlog,
  updateBlog,
  deleteBlog,
} = require("../../controllers/blog/blog.controller");

const router = express.Router();

router.get("/slug/:slug", getBlogBySlug);
router.get("/", listBlogs);
router.post("/", createBlog);
router.patch("/:id", updateBlog);
router.delete("/:id", deleteBlog);

module.exports = router;
