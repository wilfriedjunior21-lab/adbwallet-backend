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
// Empêche le buffering pour voir les erreurs de connexion immédiatement
mongoose.set("bufferCommands", false);

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connecté avec succès"))
  .catch((err) => console.error("❌ Erreur de connexion Mongo:", err));

// --- MODÈLES ---

// 1. Modèle Utilisateur
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

// 2. Modèle Action (Ce qui manquait pour le Dashboard)
const actionSchema = new mongoose.Schema({
  name: { type: String, required: true },
  price: { type: Number, required: true },
  totalQuantity: { type: Number, required: true },
  availableQuantity: { type: Number, required: true },
  description: String,
  createdAt: { type: Date, default: Date.now },
});

const Action = mongoose.model("Action", actionSchema);

// --- ROUTES AUTHENTIFICATION ---

app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({
      name,
      email: email.toLowerCase(),
      password: hashedPassword,
      role,
    });
    await newUser.save();
    res.status(201).json({ message: "Utilisateur créé" });
  } catch (err) {
    res.status(400).json({ error: "Erreur lors de l'inscription" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email: email.toLowerCase() });
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

// --- ROUTES ACTIONS (DASHBOARD) ---

// Récupérer toutes les actions
app.get("/api/actions", async (req, res) => {
  try {
    const actions = await Action.find().sort({ createdAt: -1 });
    res.json(actions);
  } catch (err) {
    res
      .status(500)
      .json({ error: "Erreur lors de la récupération des actions" });
  }
});

// --- ROUTES USER & KYC ---

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
    res.status(500).json({ error: "Erreur KYC" });
  }
});

// --- ROUTES ADMIN ---

app.get("/api/admin/users", async (req, res) => {
  try {
    const users = await User.find().select("-password");
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: "Erreur" });
  }
});

app.get("/api/admin/stats", async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const allUsers = await User.find({});
    const totalVolume = allUsers.reduce((acc, u) => acc + (u.balance || 0), 0);
    res.json({ totalUsers, totalVolume });
  } catch (err) {
    res.json({ totalUsers: 0, totalVolume: 0 });
  }
});

app.post("/api/admin/verify-kyc", async (req, res) => {
  try {
    const { userId, status } = req.body;
    await User.findByIdAndUpdate(userId, { kycStatus: status });
    res.json({ message: "Statut mis à jour" });
  } catch (err) {
    res.status(500).json({ error: "Erreur" });
  }
});

// Route pour créer une action de test (Utile pour remplir ton Dashboard)
app.post("/api/admin/add-action", async (req, res) => {
  try {
    const { name, price, totalQuantity, description } = req.body;
    const newAction = new Action({
      name,
      price,
      totalQuantity,
      availableQuantity: totalQuantity,
      description,
    });
    await newAction.save();
    res.status(201).json(newAction);
  } catch (err) {
    res.status(500).json({ error: "Erreur création action" });
  }
});

// --- DÉMARRAGE ---
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Serveur démarré sur le port ${PORT}`));
