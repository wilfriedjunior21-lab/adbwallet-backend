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
  // Champs pour la 2FA
  otp: { type: String },
  otpExpires: { type: Date },
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

// --- FONCTION UTILITAIRE NOTIFICATIONS ---
const createNotify = async (userId, title, message, type = "info") => {
  try {
    const notify = new Notification({ userId, title, message, type });
    await notify.save();
  } catch (err) {
    console.error("Erreur Notification:", err);
  }
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

// LOGIN MODIFIÉ POUR LA 2FA
app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(400).json({ error: "Identifiants invalides" });
    }

    // Génération du code OTP (6 chiffres)
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    user.otp = otpCode;
    user.otpExpires = Date.now() + 10 * 60 * 1000; // Valide 10 min
    await user.save();

    // Simulation d'envoi d'email
    console.log(`
      -----------------------------------------
      EMAIL DE SÉCURITÉ ENVOYÉ À : ${email}
      VOTRE CODE DE CONNEXION : ${otpCode}
      -----------------------------------------
    `);

    res.json({
      message: "Code de vérification envoyé",
      requires2FA: true,
      email: user.email,
    });
  } catch (err) {
    res.status(500).json({ error: "Erreur lors de la connexion" });
  }
});

// NOUVELLE ROUTE : VÉRIFICATION 2FA
app.post("/api/auth/verify-2fa", async (req, res) => {
  const { email, code } = req.body;
  try {
    const user = await User.findOne({
      email,
      otp: code,
      otpExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({ error: "Code invalide ou expiré" });
    }

    // Création du Token
    const token = jwt.sign({ id: user._id, role: user.role }, "SECRET_KEY", {
      expiresIn: "1d",
    });

    // Nettoyage de l'OTP
    user.otp = null;
    user.otpExpires = null;
    await user.save();

    res.json({ token, userId: user._id, role: user.role, name: user.name });
  } catch (err) {
    res.status(500).json({ error: "Erreur de vérification" });
  }
});

// --- ROUTES UTILISATEUR & SOLDE ---

app.get("/api/user/:id", async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select("-password");
    res.json(user);
  } catch (err) {
    res.status(404).json({ error: "Utilisateur non trouvé" });
  }
});

app.get("/api/users/:id/balance", async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    res.json({ balance: user.balance || 0 });
  } catch (err) {
    res.status(500).json({ error: "Erreur solde" });
  }
});

// --- ROUTES ACTIONS (MARCHÉ) ---

app.get("/api/actions", async (req, res) => {
  try {
    const actions = await Action.find({ status: "valide" });
    res.json(actions);
  } catch (err) {
    res.status(500).json({ error: "Erreur marché" });
  }
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
    await createNotify(
      creatorId,
      "Proposition envoyée",
      `Votre projet ${name} est en attente de validation admin.`,
      "info"
    );
    res.status(201).json({ message: "Proposition envoyée" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- ROUTES TRANSACTIONS & WALLET ---

app.get("/api/transactions/user/:userId", async (req, res) => {
  try {
    const transactions = await Transaction.find({ userId: req.params.userId })
      .populate("actionId")
      .sort({ date: -1 });
    res.json(transactions);
  } catch (err) {
    res.status(500).json({ error: "Erreur transactions" });
  }
});

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
    await createNotify(
      userId,
      "Dépôt en attente",
      `Votre demande de dépôt de ${amount} F est en cours de traitement.`,
      "info"
    );
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

    if (!action || action.status !== "valide")
      return res.status(404).json({ error: "Action non disponible" });

    const totalCost = action.price * quantity;
    if (user.balance < totalCost)
      return res.status(400).json({ error: "Solde insuffisant" });
    if (action.availableQuantity < quantity)
      return res.status(400).json({ error: "Parts insuffisantes" });

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

    await createNotify(
      userId,
      "Achat réussi",
      `Vous avez acquis ${quantity} parts de ${action.name}.`,
      "success"
    );

    res.json({ message: "Achat réussi !", newBalance: user.balance });
  } catch (err) {
    res.status(500).json({ error: "Erreur lors de l'achat" });
  }
});

app.post("/api/transactions/withdraw", async (req, res) => {
  try {
    const { userId, amount } = req.body;
    const withdrawal = new Transaction({
      userId,
      amount,
      type: "retrait",
      status: "en_attente",
      date: new Date(),
    });
    await withdrawal.save();
    await createNotify(
      userId,
      "Demande de retrait",
      `Votre demande de retrait de ${amount} F a été transmise.`,
      "warning"
    );
    res.status(201).json({ message: "Demande de retrait envoyée" });
  } catch (err) {
    res.status(500).json({ error: "Erreur retrait" });
  }
});

// --- ROUTES ACTIONNAIRE (STATS) ---

app.get("/api/actionnaire/stats/:userId", async (req, res) => {
  try {
    const actions = await Action.find({ creatorId: req.params.userId });
    const actionIds = actions.map((a) => a._id);
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

// --- ROUTES NOTIFICATIONS ---

app.get("/api/notifications/:userId", async (req, res) => {
  try {
    const notifies = await Notification.find({ userId: req.params.userId })
      .sort({ date: -1 })
      .limit(15);
    res.json(notifies);
  } catch (err) {
    res.status(500).json({ error: "Erreur notifications" });
  }
});

app.patch("/api/notifications/mark-read", async (req, res) => {
  try {
    await Notification.updateMany(
      { userId: req.body.userId, read: false },
      { read: true }
    );
    res.json({ message: "Marqué comme lu" });
  } catch (err) {
    res.status(500).json({ error: "Erreur lecture" });
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

app.patch("/api/admin/actions/:id/validate", async (req, res) => {
  try {
    const action = await Action.findByIdAndUpdate(
      req.params.id,
      { status: "valide" },
      { new: true }
    );

    await createNotify(
      action.creatorId,
      "Action publiée !",
      `Votre actif ${action.name} est maintenant en vente.`,
      "success"
    );

    const acheteurs = await User.find({ role: "acheteur" });
    const notificationPromises = acheteurs.map((acheteur) =>
      createNotify(
        acheteur._id,
        "Nouvelle opportunité",
        `L'actif ${action.name} est disponible au prix de ${action.price} F !`,
        "info"
      )
    );
    await Promise.all(notificationPromises);

    res.json({ message: "Action publiée et acheteurs notifiés" });
  } catch (err) {
    res.status(500).json({ error: "Erreur validation action" });
  }
});

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

app.patch("/api/admin/transactions/:id/validate", async (req, res) => {
  try {
    const transaction = await Transaction.findById(req.params.id);
    if (!transaction || transaction.status !== "en_attente")
      return res.status(400).json({ error: "Transaction invalide" });

    transaction.status = "valide";
    await transaction.save();

    await User.findByIdAndUpdate(transaction.userId, {
      $inc: { balance: transaction.amount },
    });

    await createNotify(
      transaction.userId,
      "Dépôt validé",
      `Votre compte a été crédité de ${transaction.amount} F.`,
      "success"
    );

    res.json({ message: "Dépôt validé" });
  } catch (err) {
    res.status(500).json({ error: "Erreur validation dépôt" });
  }
});

app.patch("/api/admin/transactions/:id/withdraw-confirm", async (req, res) => {
  try {
    const transaction = await Transaction.findById(req.params.id);
    if (
      !transaction ||
      transaction.status !== "en_attente" ||
      transaction.type !== "retrait"
    ) {
      return res.status(400).json({ error: "Retrait invalide" });
    }
    transaction.status = "valide";
    await transaction.save();

    await createNotify(
      transaction.userId,
      "Retrait confirmé",
      `Votre retrait de ${transaction.amount} F a été approuvé.`,
      "success"
    );

    res.json({ message: "Retrait confirmé" });
  } catch (err) {
    res.status(500).json({ error: "Erreur retrait" });
  }
});

// --- SYSTÈME DE DIVIDENDES ---

app.post("/api/admin/distribute-dividends", async (req, res) => {
  const { actionId, amountPerShare } = req.body;
  try {
    const action = await Action.findById(actionId);
    if (!action) return res.status(404).json({ error: "Action non trouvée" });

    const purchases = await Transaction.find({
      actionId,
      type: "achat",
      status: "valide",
    });

    if (purchases.length === 0)
      return res
        .status(400)
        .json({ message: "Aucun actionnaire pour cet actif" });

    const distributionPromises = purchases.map(async (tx) => {
      const dividendAmount = tx.quantity * amountPerShare;

      await User.findByIdAndUpdate(tx.userId, {
        $inc: { balance: dividendAmount },
      });

      const divTx = new Transaction({
        userId: tx.userId,
        actionId: action._id,
        amount: dividendAmount,
        quantity: tx.quantity,
        type: "dividende",
        status: "valide",
      });
      await divTx.save();

      return createNotify(
        tx.userId,
        "Dividendes reçus !",
        `Vous avez reçu ${dividendAmount} F de dividendes pour vos parts dans ${action.name}.`,
        "success"
      );
    });

    await Promise.all(distributionPromises);
    res.json({
      message: `Dividendes distribués avec succès pour ${action.name}`,
    });
  } catch (err) {
    res.status(500).json({ error: "Erreur distribution dividendes" });
  }
});

// --- LANCEMENT DU SERVEUR ---
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Serveur sur le port ${PORT}`));
