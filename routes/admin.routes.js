const express = require("express");
const router = express.Router();
const adminCtrl = require("../controllers/admin.controller");

router.get("/kyc", adminCtrl.getKycRequests);
router.post("/kyc/approve/:id", adminCtrl.approveKyc);
router.post("/kyc/reject/:id", adminCtrl.rejectKyc);

router.get("/payments", adminCtrl.getPayments);
router.post("/payments/approve/:id", adminCtrl.approvePayment);
router.post("/payments/reject/:id", adminCtrl.rejectPayment);

router.get("/users", adminCtrl.getUsers);
router.post("/users/block/:id", adminCtrl.blockUser);

module.exports = router;
