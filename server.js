require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
app.use(express.json());
app.use(cors());

// --- CONNEXION MONGODB ---
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Connecté"))
  .catch((err) => console.error("❌ Erreur MongoDB:", err));

// --- MODÈLES ---

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: {
    type: String,
    enum: ["admin", "actionnaire", "acheteur"],
    default: "acheteur",
  },
  balance: { type: Number, default: 0 },
  kycStatus: {
    type: String,
    enum: ["non_verifie", "en_attente", "valide"],
    default: "non_verifie",
  },
  kycDocUrl: { type: String, default: "" },
});

const actionSchema = new mongoose.Schema({
  name: { type: String, required: true },
  price: { type: Number, required: true },
  totalQuantity: { type: Number, required: true },
  availableQuantity: { type: Number, required: true },
  description: String,
  status: {
    type: String,
    enum: ["en_attente", "valide"],
    default: "en_attente",
  },
  creatorId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  createdAt: { type: Date, default: Date.now },
});

const transactionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  actionId: { type: mongoose.Schema.Types.ObjectId, ref: "Action" },
  amount: Number,
  quantity: Number,
  type: { type: String, enum: ["achat", "depot", "retrait"] },
  status: {
    type: String,
    enum: ["en_attente", "valide", "rejete"],
    default: "valide",
  },
  date: { type: Date, default: Date.now },
});

const User = mongoose.model("User", userSchema);
const Action = mongoose.model("Action", actionSchema);
const Transaction = mongoose.model("Transaction", transactionSchema);

// --- ROUTES AUTHENTIFICATION ---

app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ name, email, password: hashedPassword, role });
    await user.save();
    res.status(201).json({ message: "Utilisateur créé" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email });
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(400).json({ error: "Identifiants invalides" });
  }
  const token = jwt.sign({ id: user._id, role: user.role }, "SECRET_KEY", {
    expiresIn: "1d",
  });
  res.json({ token, userId: user._id, role: user.role, name: user.name });
});

// --- ROUTES UTILISATEUR & KYC ---

app.get("/api/user/:id", async (req, res) => {
  const user = await User.findById(req.params.id).select("-password");
  res.json(user);
});

app.post("/api/user/submit-kyc", async (req, res) => {
  const { userId, documentUrl } = req.body;
  await User.findByIdAndUpdate(userId, {
    kycDocUrl: documentUrl,
    kycStatus: "en_attente",
  });
  res.json({ message: "KYC soumis" });
});

// --- ROUTES ACTIONS (MARCHÉ & PROPOSITIONS) ---

// Marché public (uniquement les actions validées)
app.get("/api/actions", async (req, res) => {
  const actions = await Action.find({ status: "valide" });
  res.json(actions);
});

// Proposition par un actionnaire
app.post("/api/actions/propose", async (req, res) => {
  try {
    const { name, price, totalQuantity, description, creatorId } = req.body;
    const newAction = new Action({
      name,
      price,
      totalQuantity,
      availableQuantity: totalQuantity,
      description,
      creatorId,
      status: "en_attente",
    });
    await newAction.save();
    res.status(201).json({ message: "Proposition envoyée" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- ROUTES ADMIN ---

// Liste des utilisateurs pour l'admin
app.get("/api/admin/users", async (req, res) => {
  const users = await User.find().select("-password");
  res.json(users);
});

// Validation KYC
app.patch("/api/admin/kyc/:id", async (req, res) => {
  const { status } = req.body;
  await User.findByIdAndUpdate(req.params.id, { kycStatus: status });
  res.json({ message: "Statut KYC mis à jour" });
});

// Liste de TOUTES les actions pour l'admin
app.get("/api/admin/actions", async (req, res) => {
  const actions = await Action.find().sort({ createdAt: -1 });
  res.json(actions);
});

// Validation d'une action par l'admin
app.patch("/api/admin/actions/:id/validate", async (req, res) => {
  await Action.findByIdAndUpdate(req.params.id, { status: "valide" });
  res.json({ message: "Action publiée" });
});

// --- TRANSACTIONS ---

app.get("/api/transactions/user/:userId", async (req, res) => {
  const tx = await Transaction.find({ userId: req.params.userId }).populate(
    "actionId"
  );
  res.json(tx);
});

// --- LANCEMENT DU SERVEUR ---
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Serveur sur le port ${PORT}`));
