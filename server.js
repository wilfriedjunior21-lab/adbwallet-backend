const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const dotenv = require("dotenv");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

dotenv.config();
const app = express();

// --- MIDDLEWARES ---
app.use(express.json());
app.use(cors());

// --- CONNEXION MONGODB ---
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connecté avec succès"))
  .catch((err) => console.error("❌ Erreur de connexion Mongo:", err));

// --- MODÈLE UTILISATEUR ---
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
  createdAt: { type: Date, default: Date.now },
});

const User = mongoose.model("User", userSchema);

// --- ROUTES AUTHENTIFICATION ---

// Inscription
app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    // Vérifier si l'utilisateur existe déjà
    const userExists = await User.findOne({ email });
    if (userExists)
      return res.status(400).json({ error: "Cet email est déjà utilisé" });

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({
      name,
      email: email.toLowerCase().trim(),
      password: hashedPassword,
      role: role || "acheteur",
    });

    await newUser.save();
    res.status(201).json({ message: "Utilisateur créé avec succès" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur lors de l'inscription" });
  }
});

// Connexion
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email: email.toLowerCase().trim() });

    if (!user) return res.status(400).json({ error: "Utilisateur non trouvé" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch)
      return res.status(400).json({ error: "Mot de passe incorrect" });

    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    res.json({
      token,
      userId: user._id,
      role: user.role,
      name: user.name,
    });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur lors de la connexion" });
  }
});

// --- ROUTES UTILISATEUR (PROFIL) ---

// Récupérer un profil spécifique
app.get("/api/user/:id", async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select("-password");
    if (!user)
      return res.status(404).json({ error: "Utilisateur introuvable" });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: "Erreur lors de la récupération du profil" });
  }
});

// Soumettre le KYC (URL du document)
app.post("/api/user/submit-kyc", async (req, res) => {
  try {
    const { userId, documentUrl } = req.body;
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { kycStatus: "en_attente", kycDocument: documentUrl },
      { new: true }
    );
    res.json({ message: "Documents KYC envoyés", user: updatedUser });
  } catch (err) {
    res.status(500).json({ error: "Erreur lors de la soumission du KYC" });
  }
});

// --- ROUTES ADMIN (GESTION) ---

// 1. Récupérer tous les utilisateurs
app.get("/api/admin/users", async (req, res) => {
  try {
    const users = await User.find().select("-password").sort({ createdAt: -1 });
    res.json(users);
  } catch (err) {
    console.error("Erreur Admin Users:", err);
    res
      .status(500)
      .json({ error: "Erreur lors de la récupération de la liste" });
  }
});

// 2. Statistiques globales
app.get("/api/admin/stats", async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const balanceStats = await User.aggregate([
      { $group: { _id: null, total: { $sum: "$balance" } } },
    ]);

    res.json({
      totalUsers,
      totalVolume: balanceStats.length > 0 ? balanceStats[0].total : 0,
    });
  } catch (err) {
    console.error("Erreur Admin Stats:", err);
    res.status(500).json({ error: "Erreur lors du calcul des stats" });
  }
});

// 3. Valider / Rejeter le KYC d'un utilisateur
app.post("/api/admin/verify-kyc", async (req, res) => {
  try {
    const { userId, status } = req.body; // status attendu: "valide" ou "non_verifie"
    await User.findByIdAndUpdate(userId, { kycStatus: status });
    res.json({ message: `Statut KYC mis à jour vers: ${status}` });
  } catch (err) {
    res.status(500).json({ error: "Erreur lors de la mise à jour du KYC" });
  }
});

// --- DÉMARRAGE DU SERVEUR ---
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Serveur démarré sur le port ${PORT}`);
});
