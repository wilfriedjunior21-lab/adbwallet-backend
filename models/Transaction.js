const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema({
  buyer: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, // Initiateur (Acheteur ou celui qui retire)
  seller: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, // Destinataire (Vendeur)
  action: { type: mongoose.Schema.Types.ObjectId, ref: "Action" },
  amount: { type: Number, required: true },

  // --- NOUVEAUX CHAMPS ESSENTIELS ---
  type: {
    type: String,
    enum: ["achat", "retrait"],
    default: "achat",
  },
  phoneNumber: { type: String }, // Le numéro Orange/MTN pour les retraits ou paiements
  campayReference: { type: String }, // Pour retrouver la transaction sur le dashboard Campay
  paymentMethod: { type: String, default: "Mobile Money" },

  status: {
    type: String,
    enum: ["en_attente", "valide", "rejete"],
    default: "en_attente",
  },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Transaction", transactionSchema);
