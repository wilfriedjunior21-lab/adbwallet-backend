require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");
const crypto = require("crypto");

const app = express();

// --- CONFIGURATION CORS (CORRIGÉ) ---
// On autorise explicitement ton frontend (localhost:3000)
app.use(
  cors({
    origin: ["http://localhost:3000", "http://127.0.0.1:3000"],
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
    credentials: true,
  })
);

app.use(express.json());

// --- CONFIGURATION PAYMOONEY ---
const PAYMOONEY_PUBLIC_KEY =
  process.env.PAYMOONEY_PUBLIC_KEY || "PK_d5M4k6BYZ1qaHegEJ8x7";
const PAYMOONEY_PRIVATE_KEY =
  process.env.PAYMOONEY_PRIVATE_KEY ||
  "SK_k3fUZ2N4QeK0jybeg3hUxAsYW7Q9B3K8Z9d7sAcaC9DuV8TaX1m0w7ryhaLa";

// --- CONNEXION MONGODB ---
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log("✅ MongoDB Connecté");
    startMarketEngine();
  })
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
  priceHistory: [{ price: Number, date: { type: Date, default: Date.now } }], // Ajouté pour tes graphiques
  createdAt: { type: Date, default: Date.now },
});

const bondSchema = new mongoose.Schema({
  titre: { type: String, required: true },
  montantCible: { type: Number, required: true },
  tauxInteret: { type: Number, required: true },
  dureeMois: { type: Number, required: true },
  frequence: { type: String, required: true },
  garantie: { type: Number, required: true },
  prixUnitaire: { type: Number, default: 1000 }, // Ajouté pour correspondre à ton frontend
  description: String,
  actionnaireId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  status: {
    type: String,
    enum: ["en_attente", "valide", "cloture"],
    default: "en_attente",
  },
  createdAt: { type: Date, default: Date.now },
});

const transactionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  actionId: { type: mongoose.Schema.Types.ObjectId, ref: "Action" },
  bondId: { type: mongoose.Schema.Types.ObjectId, ref: "Bond" }, // Ajouté pour les obligations
  amount: Number,
  quantity: Number,
  type: {
    type: String,
    enum: [
      "achat",
      "vente",
      "depot",
      "retrait",
      "dividende",
      "bond_subscription",
    ],
  },
  status: {
    type: String,
    enum: ["en_attente", "valide", "rejete"],
    default: "valide",
  },
  recipientPhone: { type: String, default: "" },
  date: { type: Date, default: Date.now },
  referenceId: { type: String },
  paymentId: { type: String },
  comment: String,
});

const notificationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  title: String,
  message: String,
  type: {
    type: String,
    enum: ["info", "success", "warning", "retrait"],
    default: "info",
  },
  read: { type: Boolean, default: false },
  date: { type: Date, default: Date.now },
});

const messageSchema = new mongoose.Schema({
  actionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Action",
    required: true,
  },
  senderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  receiverId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  content: { type: String, required: true },
  reply: { type: String, default: "" },
  createdAt: { type: Date, default: Date.now },
});

const User = mongoose.model("User", userSchema);
const Action = mongoose.model("Action", actionSchema);
const Bond = mongoose.model("Bond", bondSchema);
const Transaction = mongoose.model("Transaction", transactionSchema);
const Notification = mongoose.model("Notification", notificationSchema);
const Message = mongoose.model("Message", messageSchema);

// --- FONCTION UTILITAIRE NOTIFICATIONS ---
const createNotify = async (userId, title, message, type = "info") => {
  try {
    const notify = new Notification({ userId, title, message, type });
    await notify.save();
  } catch (err) {
    console.error("Erreur Notification:", err);
  }
};

// --- MOTEUR DE MARCHÉ ---
const startMarketEngine = () => {
  console.log("🚀 Moteur de Marché activé (cycle: 30 min)");
  setInterval(async () => {
    try {
      const actions = await Action.find({ status: "valide" });
      for (let action of actions) {
        const changePercent = (Math.random() * 4 - 1.5) / 100;
        const newPrice = Math.round(action.price * (1 + changePercent));
        action.price = newPrice < 10 ? 10 : newPrice;
        // Mise à jour de l'historique pour le graphique frontend
        action.priceHistory.push({ price: action.price });
        if (action.priceHistory.length > 20) action.priceHistory.shift();
        await action.save();
      }
    } catch (err) {
      console.error("Erreur Market Engine:", err);
    }
  }, 30 * 60 * 1000);
};

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
  try {
    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(400).json({ error: "Identifiants invalides" });
    }
    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET || "SECRET_KEY",
      { expiresIn: "1d" }
    );
    res.json({
      token,
      userId: user._id,
      role: user.role,
      name: user.name,
      email: user.email,
      message: "Connexion réussie",
    });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// --- ROUTES OBLIGATIONS (BONDS) ---

// 1. Proposer une obligation
app.post("/api/bonds/propose", async (req, res) => {
  try {
    const {
      titre,
      montantCible,
      tauxInteret,
      dureeMois,
      frequence,
      garantie,
      description,
      actionnaireId,
    } = req.body;
    const newBond = new Bond({
      titre,
      montantCible,
      tauxInteret,
      dureeMois,
      frequence,
      garantie,
      description,
      actionnaireId,
    });
    await newBond.save();
    await createNotify(
      actionnaireId,
      "Obligation soumise",
      `Projet "${titre}" en cours d'examen.`,
      "info"
    );
    res.status(201).json({ message: "Proposition d'obligation envoyée" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Récupérer les obligations valides
app.get("/api/bonds", async (req, res) => {
  try {
    const bonds = await Bond.find({ status: "valide" });
    res.json(bonds);
  } catch (err) {
    res.status(500).json({ error: "Erreur récupération obligations" });
  }
});

// 3. Souscrire à une obligation (Route manquante précédemment)
app.post("/api/transactions/subscribe-bond", async (req, res) => {
  const { userId, bondId } = req.body;
  try {
    const user = await User.findById(userId);
    const bond = await Bond.findById(bondId);

    if (!bond || bond.status !== "valide")
      return res.status(404).json({ error: "Obligation non disponible" });

    const price = bond.prixUnitaire || 1000;
    if (user.balance < price)
      return res.status(400).json({ error: "Solde insuffisant" });

    user.balance -= price;
    await user.save();

    const tx = new Transaction({
      userId,
      bondId,
      amount: price,
      type: "bond_subscription",
      status: "valide",
    });
    await tx.save();

    await createNotify(
      userId,
      "Souscription réussie",
      `Vous avez investi dans l'obligation : ${bond.titre}`,
      "success"
    );
    res.json({ message: "Souscription réussie", newBalance: user.balance });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- ROUTES ACTIONS ---

app.get("/api/actions", async (req, res) => {
  try {
    const actions = await Action.find({ status: "valide" });
    res.json(actions);
  } catch (err) {
    res.status(500).json({ error: "Erreur marché" });
  }
});

app.post("/api/transactions/buy", async (req, res) => {
  const { userId, actionId, quantity } = req.body;
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const user = await User.findById(userId).session(session);
    const action = await Action.findById(actionId).session(session);
    if (!action || action.status !== "valide")
      throw new Error("Action non disponible");

    const totalCost = action.price * quantity;
    if (user.balance < totalCost) throw new Error("Solde insuffisant");
    if (action.availableQuantity < quantity)
      throw new Error("Parts insuffisantes");

    user.balance -= totalCost;
    await user.save({ session });

    action.availableQuantity -= quantity;
    // Petit boost de prix à l'achat pour simuler l'offre/demande
    action.price = Math.round(action.price * (1 + 0.001 * quantity));
    await action.save({ session });

    const buyerTx = new Transaction({
      userId,
      actionId,
      quantity,
      amount: totalCost,
      type: "achat",
      status: "valide",
    });
    await buyerTx.save({ session });

    await createNotify(
      userId,
      "Achat réussi",
      `Acquisition de ${quantity} parts de ${action.name}.`,
      "success"
    );
    await session.commitTransaction();
    res.json({ message: "Achat réussi !", newBalance: user.balance });
  } catch (err) {
    await session.abortTransaction();
    res.status(500).json({ error: err.message });
  } finally {
    session.endSession();
  }
});

// --- ROUTES PAYMOONEY ---
app.post("/api/payments/paymooney/init", async (req, res) => {
  try {
    const { userId, amount, email, name } = req.body;
    if (!userId || !amount || !email)
      return res.status(400).json({ error: "Données manquantes." });

    const referenceId = `PM-${uuidv4().substring(0, 8).toUpperCase()}`;
    const newTx = new Transaction({
      userId,
      amount: Number(amount),
      type: "depot",
      status: "en_attente",
      referenceId,
    });
    await newTx.save();

    const params = new URLSearchParams();
    params.append("amount", amount.toString());
    params.append("currency_code", "XAF");
    params.append("item_ref", referenceId);
    params.append("item_name", "Depot ADB Wallet");
    params.append("public_key", PAYMOONEY_PUBLIC_KEY);
    params.append("lang", "fr");
    params.append("first_name", name || "Client");
    params.append("email", email);

    const response = await axios.post(
      "https://www.paymooney.com/api/v1.0/payment_url",
      params,
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );
    if (response.data.response === "success") {
      res.json({ payment_url: response.data.payment_url, referenceId });
    } else {
      res
        .status(400)
        .json({ error: response.data.description || "Erreur PayMooney" });
    }
  } catch (error) {
    res.status(500).json({ error: "Impossible d'initialiser le paiement" });
  }
});

// --- AUTRES ROUTES ---
app.get("/api/user/:id", async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select("-password");
    res.json(user);
  } catch (err) {
    res.status(404).json({ error: "Utilisateur non trouvé" });
  }
});

app.get("/api/notifications/:userId", async (req, res) => {
  const notifies = await Notification.find({ userId: req.params.userId })
    .sort({ date: -1 })
    .limit(15);
  res.json(notifies);
});

// MESSAGERIE
app.get("/api/messages/chat/:actionId/:userId", async (req, res) => {
  const messages = await Message.find({
    actionId: req.params.actionId,
    $or: [{ senderId: req.params.userId }, { receiverId: req.params.userId }],
  }).sort({ createdAt: 1 });
  res.json(messages);
});

app.post("/api/messages/send", async (req, res) => {
  const { actionId, senderId, receiverId, content } = req.body;
  const newMessage = new Message({ actionId, senderId, receiverId, content });
  await newMessage.save();
  res.status(201).json(newMessage);
});

// ADMIN ROUTES (Simplifiées pour l'exemple)
app.get("/api/admin/bonds", async (req, res) => {
  const bonds = await Bond.find()
    .populate("actionnaireId", "name email")
    .sort({ createdAt: -1 });
  res.json(bonds);
});

app.patch("/api/admin/bonds/:id/validate", async (req, res) => {
  const bond = await Bond.findByIdAndUpdate(
    req.params.id,
    { status: "valide" },
    { new: true }
  );
  await createNotify(
    bond.actionnaireId,
    "Obligation Validée",
    `Votre obligation "${bond.titre}" est active.`,
    "success"
  );
  res.json({ message: "Validée" });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Serveur sur le port ${PORT}`));
