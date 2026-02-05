const express = require("express");
const router = express.Router();
const paymentCtrl = require("../controllers/payments.controller");

router.post("/deposit", paymentCtrl.deposit);
router.post("/withdraw", paymentCtrl.withdraw);
router.get("/history/:userId", paymentCtrl.history);

module.exports = router;
