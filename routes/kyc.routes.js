const router = require("express").Router();
const auth = require("../middlewares/authMiddleware");
const role = require("../middlewares/roleMiddleware");
const kyc = require("../controllers/kyc.controller");

router.post("/submit", auth, kyc.submitKyc);
router.get("/me", auth, kyc.getMyKyc);

router.get("/pending", auth, role("ADMIN"), kyc.getPendingKycs);
router.put("/update/:id", auth, role("ADMIN"), kyc.updateKycStatus);

module.exports = router;

const upload = require("../middlewares/uploadKyc");

router.post(
  "/submit",
  auth,
  upload.fields([
    { name: "documentFront", maxCount: 1 },
    { name: "selfie", maxCount: 1 },
  ]),
  kyc.submitKyc
);
