const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const dotenv = require("dotenv");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

dotenv.config();
const app = express();

// Middlewares
app.use(express.json());
app.use(cors());

// Connexion MongoDB
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connecté"))
  .catch((err) => console.log("Erreur Mongo:", err));

// MODÈLE UTILISATEUR
const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: {
    type: String,
    enum: ["acheteur", "actionnaire", "admin"],
    default: "acheteur",
  },
  balance: { type: Number, default: 0 },
  kycStatus: {
    type: String,
    enum: ["non_verifie", "en_attente", "valide"],
    default: "non_verifie",
  },
  kycDocument: { type: String, default: "" },
});

const User = mongoose.model("User", userSchema);

// --- ROUTES AUTHENTIFICATION ---

app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({ name, email, password: hashedPassword, role });
    await newUser.save();
    res.status(201).json({ message: "Utilisateur créé" });
  } catch (err) {
    res.status(400).json({ error: "Email déjà utilisé ou données invalides" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ error: "Utilisateur non trouvé" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch)
      return res.status(400).json({ error: "Mot de passe incorrect" });

    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );
    res.json({ token, userId: user._id, role: user.role, name: user.name });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// --- ROUTES UTILISATEUR ---

app.get("/api/user/:id", async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select("-password");
    res.json(user);
  } catch (err) {
    res.status(404).json({ error: "Profil non trouvé" });
  }
});

app.post("/api/user/submit-kyc", async (req, res) => {
  try {
    const { userId, documentUrl } = req.body;
    await User.findByIdAndUpdate(userId, {
      kycStatus: "en_attente",
      kycDocument: documentUrl,
    });
    res.json({ message: "KYC soumis" });
  } catch (err) {
    res.status(500).json({ error: "Erreur lors de la soumission" });
  }
});

// --- ROUTES ADMIN (VERSION CORRIGÉE) ---

// 1. Récupérer tous les utilisateurs
app.get("/api/admin/users", async (req, res) => {
  try {
    const users = await User.find().select("-password");
    res.status(200).json(users || []);
  } catch (err) {
    console.error("Erreur GET /admin/users:", err);
    res
      .status(500)
      .json({ error: "Erreur lors de la récupération des utilisateurs" });
  }
});

// 2. Récupérer les statistiques globales
app.get("/api/admin/stats", async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();

    // On calcule la somme manuellement ou via aggregate avec une sécurité
    const stats = await User.aggregate([
      { $group: { _id: null, total: { $sum: "$balance" } } },
    ]);

    const totalVolume = stats.length > 0 ? stats[0].total : 0;

    res.status(200).json({
      totalUsers: totalUsers || 0,
      totalVolume: totalVolume || 0,
    });
  } catch (err) {
    console.error("Erreur GET /admin/stats:", err);
    // On renvoie des valeurs par défaut au lieu d'une erreur 500 pour ne pas bloquer le front
    res.json({ totalUsers: 0, totalVolume: 0 });
  }
});

// 3. Valider ou Rejeter un KYC
app.post("/api/admin/verify-kyc", async (req, res) => {
  try {
    const { userId, status } = req.body;
    if (!userId || !status) {
      return res.status(400).json({ error: "Données manquantes" });
    }
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { kycStatus: status },
      { new: true }
    );
    res.json({ message: "Statut mis à jour", user: updatedUser });
  } catch (err) {
    console.error("Erreur POST /verify-kyc:", err);
    res.status(500).json({ error: "Erreur lors de la validation" });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Serveur sur port ${PORT}`));
