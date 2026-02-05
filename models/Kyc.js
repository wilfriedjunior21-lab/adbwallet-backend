const mongoose = require("mongoose");

const KycSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },
  fullName: String,
  country: String,
  documentType: {
    type: String,
    enum: ["CNI", "PASSEPORT"],
  },
  documentNumber: String,
  documentFront: String,
  selfie: String,
  status: {
    type: String,
    enum: ["PENDING", "APPROVED", "REJECTED"],
    default: "PENDING",
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("Kyc", KycSchema);
