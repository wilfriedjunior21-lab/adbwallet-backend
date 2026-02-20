require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const axios = require("axios");

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
  type: {
    type: String,
    enum: ["achat", "vente", "depot", "retrait", "dividende"],
  },
  status: {
    type: String,
    enum: ["en_attente", "valide", "rejete"],
    default: "valide",
  },
  date: { type: Date, default: Date.now },
  monetbilId: { type: String },
});

const notificationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  title: String,
  message: String,
  type: { type: String, enum: ["info", "success", "warning"], default: "info" },
  read: { type: Boolean, default: false },
  date: { type: Date, default: Date.now },
});

const User = mongoose.model("User", userSchema);
const Action = mongoose.model("Action", actionSchema);
const Transaction = mongoose.model("Transaction", transactionSchema);
const Notification = mongoose.model("Notification", notificationSchema);

// --- UTILITAIRE NOTIFICATIONS ---
const createNotify = async (userId, title, message, type = "info") => {
  try {
    const notify = new Notification({ userId, title, message, type });
    await notify.save();
  } catch (err) {
    console.error("Erreur Notification:", err);
  }
};

// --- ROUTES AUTH ---
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
      process.env.JWT_SECRET || "SECRET",
      { expiresIn: "1d" }
    );
    res.json({
      token,
      userId: user._id,
      role: user.role,
      name: user.name,
      email: user.email,
    });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// --- MONETBIL & TRANSACTIONS ---

app.post("/api/transactions/monetbil/pay", async (req, res) => {
  const { amount, userId, email, name } = req.body;
  try {
    const payload = {
      service: process.env.MONETBIL_SERVICE_KEY,
      amount: amount,
      currency: "XAF",
      item_name: `Depot ADB - ${name}`,
      user: userId,
      email: email,
      // Remplace par ton URL Render réelle
      notify_url:
        "https://adbwallet-backend.onrender.com/api/transactions/monetbil/callback",
    };

    const response = await axios.post(
      "https://api.monetbil.com/widget/v2.1",
      payload
    );

    if (response.data.payment_url) {
      res.json({ url: response.data.payment_url });
    } else {
      console.log("Détails refus Monetbil:", response.data);
      res.status(400).json({ error: "Erreur initiation Monetbil" });
    }
  } catch (error) {
    console.error(
      "Erreur API Monetbil:",
      error.response?.data || error.message
    );
    res.status(500).json({ error: "Erreur service de paiement" });
  }
});

app.post("/api/transactions/monetbil/callback", async (req, res) => {
  const { status, user, amount, transaction_id } = req.body;
  if (status === "success") {
    try {
      const amountNum = parseFloat(amount);
      await User.findByIdAndUpdate(user, { $inc: { balance: amountNum } });
      const newTx = new Transaction({
        userId: user,
        amount: amountNum,
        type: "depot",
        status: "valide",
        monetbilId: transaction_id,
      });
      await newTx.save();
      await createNotify(
        user,
        "Dépôt Réussi",
        `+${amountNum} F CFA`,
        "success"
      );
      return res.status(200).send("OK");
    } catch (err) {
      return res.status(500).send("Erreur");
    }
  }
  res.status(200).send("Echec");
});

// --- RETRAIT (Côté Utilisateur) ---
app.post("/api/transactions/withdraw", async (req, res) => {
  const { userId, amount } = req.body;
  try {
    const user = await User.findById(userId);
    if (user.balance < amount)
      return res.status(400).json({ error: "Solde insuffisant" });

    // Bloquer les fonds
    user.balance -= amount;
    await user.save();

    const tx = new Transaction({
      userId,
      amount,
      type: "retrait",
      status: "en_attente",
    });
    await tx.save();

    await createNotify(
      userId,
      "Demande de retrait",
      `Votre demande de ${amount} F est en cours.`,
      "warning"
    );
    res.status(201).json({ message: "Demande envoyée" });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// --- ROUTES ADMIN ---

app.get("/api/admin/users", async (req, res) => {
  const users = await User.find().select("-password");
  res.json(users);
});

app.get("/api/admin/actions", async (req, res) => {
  const actions = await Action.find().sort({ createdAt: -1 });
  res.json(actions);
});

app.get("/api/admin/transactions", async (req, res) => {
  const tx = await Transaction.find().populate("userId").sort({ date: -1 });
  res.json(tx);
});

// Validation Transaction (Dépôt ou Retrait manuel)
app.patch("/api/admin/transactions/:id/validate", async (req, res) => {
  try {
    const tx = await Transaction.findById(req.params.id);
    if (tx.status === "valide")
      return res.status(400).json({ error: "Déjà validé" });

    tx.status = "valide";
    await tx.save();

    // Si c'était un dépôt en attente (cas manuel)
    if (tx.type === "depot") {
      await User.findByIdAndUpdate(tx.userId, { $inc: { balance: tx.amount } });
    }

    await createNotify(
      tx.userId,
      "Transaction validée",
      `Votre ${tx.type} de ${tx.amount} F est confirmé.`,
      "success"
    );
    res.json({ message: "Validé" });
  } catch (err) {
    res.status(500).json({ error: "Erreur" });
  }
});

// Validation d'Actif (Action)
app.patch("/api/admin/actions/:id/validate", async (req, res) => {
  const action = await Action.findByIdAndUpdate(
    req.params.id,
    { status: "valide" },
    { new: true }
  );
  await createNotify(
    action.creatorId,
    "Projet validé",
    `L'actif ${action.name} est en ligne.`,
    "success"
  );
  res.json(action);
});

// Distribution de dividendes
app.post("/api/admin/distribute-dividends", async (req, res) => {
  const { actionId, amountPerShare } = req.body;
  try {
    const purchases = await Transaction.find({
      actionId,
      type: "achat",
      status: "valide",
    });
    for (let tx of purchases) {
      const totalDiv = tx.quantity * amountPerShare;
      await User.findByIdAndUpdate(tx.userId, { $inc: { balance: totalDiv } });
      await new Transaction({
        userId: tx.userId,
        actionId,
        amount: totalDiv,
        type: "dividende",
        status: "valide",
      }).save();
      await createNotify(
        tx.userId,
        "Dividendes",
        `+${totalDiv} F reçus.`,
        "success"
      );
    }
    res.json({ message: "Distribution réussie" });
  } catch (err) {
    res.status(500).json({ error: "Erreur" });
  }
});

// --- MARCHÉ ---
app.get("/api/actions", async (req, res) => {
  const actions = await Action.find({ status: "valide" });
  res.json(actions);
});

app.post("/api/transactions/buy", async (req, res) => {
  const { userId, actionId, quantity } = req.body;
  try {
    const user = await User.findById(userId);
    const action = await Action.findById(actionId);
    const cost = action.price * quantity;

    if (user.balance < cost)
      return res.status(400).json({ error: "Solde insuffisant" });
    if (action.availableQuantity < quantity)
      return res.status(400).json({ error: "Stock insuffisant" });

    user.balance -= cost;
    action.availableQuantity -= quantity;
    await user.save();
    await action.save();

    await new Transaction({
      userId,
      actionId,
      quantity,
      amount: cost,
      type: "achat",
      status: "valide",
    }).save();
    res.json({ message: "Achat validé" });
  } catch (err) {
    res.status(500).json({ error: "Erreur achat" });
  }
});

// --- NOTIFICATIONS & INFOS ---
app.get("/api/notifications/:userId", async (req, res) => {
  const n = await Notification.find({ userId: req.params.userId }).sort({
    date: -1,
  });
  res.json(n);
});

app.get("/api/user/:id", async (req, res) => {
  const user = await User.findById(req.params.id).select("-password");
  res.json(user);
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Serveur actif sur le port ${PORT}`));
