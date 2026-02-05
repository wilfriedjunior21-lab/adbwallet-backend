const express = require("express");
const router = express.Router();

router.get("/", (req, res) => {
  res.json([{ text: "Apple +5%" }, { text: "Tesla -3%" }]);
});

module.exports = router;
