const mongoose = require("mongoose");

const actionSchema = new mongoose.Schema({
  companyName: { type: String, required: true },
  price: { type: Number, required: true },
  quantity: { type: Number, required: true },
  description: { type: String }, // Pour donner plus de détails sur l'action
  sellerPhone: { type: String, required: true }, // Le numéro Orange/MTN du vendeur
  owner: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, // L'actionnaire qui vend
  status: {
    type: String,
    enum: ["en_vente", "vendu", "en_attente"],
    default: "en_vente",
  },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Action", actionSchema);
