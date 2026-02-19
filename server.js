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
// Note : Assure-toi que MONGO_URI dans Render n'a pas de numéro de port à la fin
mongoose.set("bufferCommands", false);
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connecté avec succès"))
  .catch((err) => console.error("❌ Erreur de connexion Mongo:", err));

// --- MODÈLES ---

// 1. Utilisateur
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

// 2. Action (Marché financier)
const actionSchema = new mongoose.Schema({
  name: { type: String, required: true },
  price: { type: Number, required: true },
  totalQuantity: { type: Number, required: true },
  availableQuantity: { type: Number, required: true },
  description: String,
  createdAt: { type: Date, default: Date.now },
});
const Action = mongoose.model("Action", actionSchema);

// 3. Transaction (Dépôts, Retraits, Achats)
const transactionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  userName: { type: String, required: true },
  type: { type: String, enum: ["depot", "retrait", "achat"], required: true },
  amount: { type: Number, required: true },
  status: {
    type: String,
    enum: ["en_attente", "valide", "rejete"],
    default: "en_attente",
  },
  createdAt: { type: Date, default: Date.now },
});
const Transaction = mongoose.model("Transaction", transactionSchema);

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

// --- ROUTES ACTIONS (MARCHÉ) ---

app.get("/api/actions", async (req, res) => {
  try {
    const actions = await Action.find().sort({ createdAt: -1 });
    res.json(actions);
  } catch (err) {
    res.status(500).json({ error: "Erreur récupération actions" });
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

// --- ROUTES TRANSACTIONS (UTILISATEUR) ---

app.post("/api/transactions/request", async (req, res) => {
  try {
    const { userId, userName, type, amount } = req.body;
    const newTx = new Transaction({ userId, userName, type, amount });
    await newTx.save();
    res.status(201).json({ message: "Demande envoyée" });
  } catch (err) {
    res.status(500).json({ error: "Erreur transaction" });
  }
});

app.get("/api/transactions/user/:userId", async (req, res) => {
  try {
    const history = await Transaction.find({ userId: req.params.userId }).sort({
      createdAt: -1,
    });
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: "Erreur historique" });
  }
});

// --- ROUTES ADMIN ---

// Gestion des utilisateurs
app.get("/api/admin/users", async (req, res) => {
  try {
    const users = await User.find().select("-password");
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: "Erreur admin" });
  }
});

// Stats globales
app.get("/api/admin/stats", async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const users = await User.find({});
    const totalVolume = users.reduce((acc, u) => acc + (u.balance || 0), 0);
    res.json({ totalUsers, totalVolume });
  } catch (err) {
    res.json({ totalUsers: 0, totalVolume: 0 });
  }
});

// Validation KYC
app.post("/api/admin/verify-kyc", async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.body.userId, {
      kycStatus: req.body.status,
    });
    res.json({ message: "Statut mis à jour" });
  } catch (err) {
    res.status(500).json({ error: "Erreur" });
  }
});

// Création d'action
app.post("/api/admin/add-action", async (req, res) => {
  try {
    const newAction = new Action({
      ...req.body,
      availableQuantity: req.body.totalQuantity,
    });
    await newAction.save();
    res.status(201).json(newAction);
  } catch (err) {
    res.status(500).json({ error: "Erreur création action" });
  }
});

// Gestion des transactions (Validation Dépôt/Retrait)
app.get("/api/admin/transactions", async (req, res) => {
  try {
    const tx = await Transaction.find().sort({ createdAt: -1 });
    res.json(tx);
  } catch (err) {
    res.status(500).json({ error: "Erreur transactions admin" });
  }
});

app.post("/api/admin/verify-transaction", async (req, res) => {
  try {
    const { txId, status } = req.body;
    const tx = await Transaction.findById(txId);

    if (status === "valide" && tx.status === "en_attente") {
      // Si c'est un dépôt, on augmente le solde. Si retrait, on diminue.
      const multiplier = tx.type === "depot" ? 1 : -1;
      await User.findByIdAndUpdate(tx.userId, {
        $inc: { balance: tx.amount * multiplier },
      });
    }

    tx.status = status;
    await tx.save();
    res.json({ message: "Transaction traitée" });
  } catch (err) {
    res.status(500).json({ error: "Erreur validation transaction" });
  }
});

// --- DÉMARRAGE ---
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Serveur démarré sur le port ${PORT}`));
