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

app.get("/api/actions", async (req, res) => {
  const actions = await Action.find({ status: "valide" });
  res.json(actions);
});

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

app.get("/api/admin/users", async (req, res) => {
  const users = await User.find().select("-password");
  res.json(users);
});

app.patch("/api/admin/kyc/:id", async (req, res) => {
  const { status } = req.body;
  await User.findByIdAndUpdate(req.params.id, { kycStatus: status });
  res.json({ message: "Statut KYC mis à jour" });
});

app.get("/api/admin/actions", async (req, res) => {
  const actions = await Action.find().sort({ createdAt: -1 });
  res.json(actions);
});

app.patch("/api/admin/actions/:id/validate", async (req, res) => {
  await Action.findByIdAndUpdate(req.params.id, { status: "valide" });
  res.json({ message: "Action publiée" });
});

// Nouvelle route : Liste des transactions pour l'admin
app.get("/api/admin/transactions", async (req, res) => {
  try {
    const transactions = await Transaction.find()
      .populate("userId")
      .sort({ date: -1 });
    res.json(transactions);
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Nouvelle route : Valider un dépôt (Admin)
app.patch("/api/admin/transactions/:id/validate", async (req, res) => {
  try {
    const transaction = await Transaction.findById(req.params.id);
    if (!transaction || transaction.status !== "en_attente") {
      return res.status(400).json({ error: "Transaction invalide" });
    }
    transaction.status = "valide";
    await transaction.save();
    await User.findByIdAndUpdate(transaction.userId, {
      $inc: { balance: transaction.amount },
    });
    res.json({ message: "Dépôt validé avec succès" });
  } catch (err) {
    res.status(500).json({ error: "Erreur validation" });
  }
});

// --- TRANSACTIONS ---

app.get("/api/transactions/user/:userId", async (req, res) => {
  const tx = await Transaction.find({ userId: req.params.userId }).populate(
    "actionId"
  );
  res.json(tx);
});

// Nouvelle route : Historique complet (utilisé pour le Wallet)
app.get("/api/transactions/history/:userId", async (req, res) => {
  try {
    const history = await Transaction.find({ userId: req.params.userId })
      .populate("actionId")
      .sort({ date: -1 });
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: "Erreur historique" });
  }
});

// Nouvelle route : Demande de dépôt
app.post("/api/transactions/deposit", async (req, res) => {
  try {
    const { userId, amount } = req.body;
    const deposit = new Transaction({
      userId,
      amount,
      type: "depot",
      status: "en_attente",
      date: new Date(),
    });
    await deposit.save();
    res.status(201).json({ message: "Demande de dépôt enregistrée" });
  } catch (err) {
    res.status(500).json({ error: "Erreur dépôt" });
  }
});

app.post("/api/transactions/buy", async (req, res) => {
  const { userId, actionId, quantity } = req.body;
  try {
    const user = await User.findById(userId);
    const action = await Action.findById(actionId);

    if (!action || action.status !== "valide") {
      return res.status(404).json({ error: "Action non disponible" });
    }

    const totalCost = action.price * quantity;
    if (user.balance < totalCost) {
      return res.status(400).json({ error: "Solde insuffisant" });
    }
    if (action.availableQuantity < quantity) {
      return res.status(400).json({ error: "Pas assez de parts disponibles" });
    }

    action.availableQuantity -= quantity;
    user.balance -= totalCost;

    const transaction = new Transaction({
      userId,
      actionId,
      quantity,
      amount: totalCost,
      type: "achat",
      status: "valide",
    });

    await action.save();
    await user.save();
    await transaction.save();

    res.json({ message: "Achat réussi !", newBalance: user.balance });
  } catch (err) {
    res.status(500).json({ error: "Erreur lors de l'achat" });
  }
});

// 1. Récupérer les statistiques de vente pour l'actionnaire
app.get("/api/actionnaire/stats/:userId", async (req, res) => {
  try {
    // Trouver toutes les actions créées par cet utilisateur
    const actions = await Action.find({ creatorId: req.params.userId });
    const actionIds = actions.map((a) => a._id);

    // Calculer le total vendu via les transactions validées
    const transactions = await Transaction.find({
      actionId: { $in: actionIds },
      type: "achat",
      status: "valide",
    });

    const totalGagne = transactions.reduce((acc, curr) => acc + curr.amount, 0);

    res.json({
      totalGagne,
      nombreVentes: transactions.length,
      actionsCount: actions.length,
    });
  } catch (err) {
    res.status(500).json({ error: "Erreur statistiques" });
  }
});

// 2. Demander un retrait
app.post("/api/transactions/withdraw", async (req, res) => {
  try {
    const { userId, amount } = req.body;

    // On crée une transaction de type "retrait"
    const withdrawal = new Transaction({
      userId,
      amount,
      type: "retrait",
      status: "en_attente",
      date: new Date(),
    });

    await withdrawal.save();
    res.status(201).json({ message: "Demande de retrait envoyée à l'admin." });
  } catch (err) {
    res.status(500).json({ error: "Erreur retrait" });
  }
});

// Valider un retrait (Admin)
app.patch("/api/admin/transactions/:id/withdraw-confirm", async (req, res) => {
  try {
    const transaction = await Transaction.findById(req.params.id);
    if (
      !transaction ||
      transaction.status !== "en_attente" ||
      transaction.type !== "retrait"
    ) {
      return res.status(400).json({ error: "Retrait invalide ou déjà traité" });
    }

    // On marque juste comme valide pour confirmer que l'admin a envoyé l'argent
    transaction.status = "valide";
    await transaction.save();

    res.json({ message: "Retrait confirmé avec succès !" });
  } catch (err) {
    res
      .status(500)
      .json({ error: "Erreur lors de la confirmation du retrait" });
  }
});

// --- ROUTES POUR LE DASHBOARD ACTIONNAIRE ---

// 1. Récupérer les stats (Gains, nombre de ventes, etc.)
app.get("/api/actionnaire/stats/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    // Trouver les actions créées par cet utilisateur
    const actions = await Action.find({ creatorId: userId });
    const actionIds = actions.map((a) => a._id);

    // Calculer les gains via les transactions validées de type "achat" sur ses actions
    const transactions = await Transaction.find({
      actionId: { $in: actionIds },
      type: "achat",
      status: "valide",
    });

    const totalGagne = transactions.reduce((acc, curr) => acc + curr.amount, 0);

    res.json({
      totalGagne,
      nombreVentes: transactions.length,
      actionsCount: actions.length,
    });
  } catch (err) {
    res.status(500).json({ error: "Erreur lors du calcul des statistiques" });
  }
});

// 2. Récupérer l'historique des transactions d'un utilisateur (Retraits ou Achats)
// Assure-toi que cette route existe car elle est utilisée pour le tableau de suivi
app.get("/api/transactions/user/:userId", async (req, res) => {
  try {
    const transactions = await Transaction.find({
      userId: req.params.userId,
    }).sort({ date: -1 });
    res.json(transactions);
  } catch (err) {
    res
      .status(500)
      .json({ error: "Erreur lors de la récupération des transactions" });
  }
});

// --- LANCEMENT DU SERVEUR ---
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Serveur sur le port ${PORT}`));
