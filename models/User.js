const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  role: {
    type: String,
    enum: ["acheteur", "actionnaire", "admin"],
    default: "acheteur",
    // Ajoutez ces champs au schéma existant
    kycStatus: {
      type: String,
      enum: ["non_soumis", "en_attente", "valide", "rejete"],
      default: "non_soumis",
    },
    documentUrl: { type: String }, // Lien vers l'image stockée
    verifiedAt: { type: Date },
  },
  balance: { type: Number, default: 0 }, // Le solde pour l'acheteur
});

module.exports = mongoose.model("User", userSchema);
