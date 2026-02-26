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
app.use(express.json());
app.use(cors());

// --- CONFIGURATION PAYMOONEY ---
const PAYMOONEY_PUBLIC_KEY = "PK_d5M4k6BYZ1qaHegEJ8x7";
const PAYMOONEY_PRIVATE_KEY =
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
  recipientPhone: { type: String, default: "" }, // <--- AJOUTÉ : Numéro de tel pour retrait
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

// --- INTEGRATION PAYMOONEY ---
// --- INITIALISATION DU PAIEMENT ---
// Changé 'transactions' en 'payments' pour la cohérence
app.post("/api/payments/paymooney/init", async (req, res) => {
  try {
    const { userId, amount, email, name } = req.body;

    // 1. Validation de base
    if (!userId || !amount) {
      return res.status(400).json({ error: "Données manquantes" });
    }

    const referenceId = `PM-${uuidv4().substring(0, 8).toUpperCase()}`;

    // 2. Création de la transaction en attente
    const newTx = new Transaction({
      userId,
      amount: Number(amount),
      type: "depot",
      status: "en_attente",
      referenceId: referenceId,
    });
    await newTx.save();

    // 3. Préparation des paramètres pour PayMooney
    const params = new URLSearchParams();
    params.append("amount", amount);
    params.append("currency_code", "XAF");
    params.append("item_ref", referenceId);
    params.append("item_name", "Dépôt ADB Wallet");
    params.append("public_key", process.env.PAYMOONEY_PUBLIC_KEY); // Utilise env
    params.append("lang", "fr");
    params.append("first_name", name || "Utilisateur");
    params.append("email", email || "");
    params.append("environement", "test"); // Attention à l'orthographe "environement" (spécifique à l'API PayMooney)

    const response = await axios.post(
      "https://www.paymooney.com/api/v1.0/payment_url",
      params,
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    if (response.data.response === "success") {
      res.json({
        message: "URL générée",
        payment_url: response.data.payment_url,
        referenceId,
      });
    } else {
      res
        .status(400)
        .json({ error: response.data.description || "Erreur PayMooney" });
    }
  } catch (error) {
    console.error("Erreur Init Payment:", error);
    res.status(500).json({ error: "Impossible d'initialiser le paiement" });
  }
});

// --- NOTIFICATION DE PAIEMENT (WEBHOOK) ---
app.post("/api/payments/paymooney-notify", async (req, res) => {
  try {
    // Note : PayMooney envoie parfois les données en query string ou en body selon la config
    const { status, item_reference, amount, transaction_id } = req.body;

    console.log(`Notification reçue pour ${item_reference} : ${status}`);

    if (status?.toLowerCase() === "success") {
      const tx = await Transaction.findOne({
        referenceId: item_reference,
        status: "en_attente",
      });

      if (tx) {
        tx.status = "valide";
        tx.paymentId = transaction_id;
        await tx.save();

        // Créditer le solde de l'utilisateur
        await User.findByIdAndUpdate(tx.userId, {
          $inc: { balance: Number(amount) },
        });

        // Notification interne
        await createNotify(
          tx.userId,
          "Dépôt Réussi",
          `Compte crédité de ${amount} F.`,
          "success"
        );

        return res.status(200).send("OK");
      }
    }
    res.status(200).send("OK"); // On répond OK même si c'est déjà traité pour stopper les relances
  } catch (error) {
    console.error("Erreur Webhook:", error);
    res.status(500).send("Erreur interne");
  }
});

// --- ROUTES UTILISATEURS & ACTIONS ---
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
      `Projet ${name} en attente.`,
      "info"
    );
    res.status(201).json({ message: "Proposition envoyée" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/transactions/user/:userId", async (req, res) => {
  try {
    const transactions = await Transaction.find({ userId: req.params.userId })
      .populate("actionId")
      .sort({ date: -1 });
    res.json(transactions);
  } catch (err) {
    res.status(500).json({ error: "Erreur" });
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
    const sellerId = action.creatorId;

    if (user.balance < totalCost) throw new Error("Solde insuffisant");
    if (action.availableQuantity < quantity)
      throw new Error("Parts insuffisantes");

    user.balance -= totalCost;
    await user.save({ session });

    if (sellerId) {
      await User.findByIdAndUpdate(
        sellerId,
        { $inc: { balance: totalCost } },
        { session }
      );
      await createNotify(
        sellerId,
        "Vente réussie !",
        `Reçu ${totalCost} F pour ${action.name}.`,
        "success"
      );
      const sellerTx = new Transaction({
        userId: sellerId,
        actionId,
        quantity,
        amount: totalCost,
        type: "vente",
        status: "valide",
      });
      await sellerTx.save({ session });
    }

    const priceHike = action.price * (0.0005 * quantity);
    action.price = Math.round(action.price + priceHike);
    action.availableQuantity -= quantity;
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

// --- ROUTE RETRAIT MODIFIÉE (AVEC NUMÉRO DE TÉLÉPHONE) ---
app.post("/api/transactions/withdraw", async (req, res) => {
  const { userId, amount, recipientPhone } = req.body; // <--- AJOUT : recipientPhone
  try {
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: "Utilisateur non trouvé" });
    if (user.balance < amount)
      return res.status(400).json({ error: "Solde insuffisant" });

    user.balance -= Number(amount);
    await user.save();

    const withdrawTx = new Transaction({
      userId,
      amount: Number(amount),
      recipientPhone: recipientPhone || "Non spécifié", // <--- ENREGISTREMENT
      type: "retrait",
      status: "en_attente",
    });
    await withdrawTx.save();

    await createNotify(
      userId,
      "Demande de retrait",
      `Demande de ${amount} F via ${recipientPhone} envoyée.`,
      "info"
    );
    res.json({ message: "Demande enregistrée", newBalance: user.balance });
  } catch (err) {
    res.status(500).json({ error: "Erreur retrait" });
  }
});

app.get("/api/notifications/:userId", async (req, res) => {
  try {
    const notifies = await Notification.find({ userId: req.params.userId })
      .sort({ date: -1 })
      .limit(15);
    res.json(notifies);
  } catch (err) {
    res.status(500).json({ error: "Erreur" });
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
    res.status(500).json({ error: "Erreur" });
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
      `${action.name} est en vente.`,
      "success"
    );
    const acheteurs = await User.find({ role: "acheteur" });
    for (let ach of acheteurs) {
      await createNotify(
        ach._id,
        "Nouvelle opportunité",
        `${action.name} est disponible !`,
        "info"
      );
    }
    res.json({ message: "Action publiée" });
  } catch (err) {
    res.status(500).json({ error: "Erreur" });
  }
});

app.get("/api/admin/transactions", async (req, res) => {
  try {
    const transactions = await Transaction.find()
      .populate("userId")
      .sort({ date: -1 });
    res.json(transactions);
  } catch (err) {
    res.status(500).json({ error: "Erreur" });
  }
});

app.post("/api/admin/distribute-dividends", async (req, res) => {
  const { actionId, amountPerShare } = req.body;
  try {
    const action = await Action.findById(actionId);
    const purchases = await Transaction.find({
      actionId,
      type: "achat",
      status: "valide",
    });
    for (let tx of purchases) {
      const divAmount = tx.quantity * amountPerShare;
      await User.findByIdAndUpdate(tx.userId, { $inc: { balance: divAmount } });
      const divTx = new Transaction({
        userId: tx.userId,
        actionId: action._id,
        amount: divAmount,
        quantity: tx.quantity,
        type: "dividende",
        status: "valide",
      });
      await divTx.save();
      await createNotify(
        tx.userId,
        "Dividendes !",
        `${divAmount} F reçus pour ${action.name}.`,
        "success"
      );
    }
    res.json({ message: `Dividendes distribués` });
  } catch (err) {
    res.status(500).json({ error: "Erreur" });
  }
});

app.patch("/api/admin/transactions/:id/validate", async (req, res) => {
  try {
    const tx = await Transaction.findById(req.params.id);
    if (!tx || tx.status === "valide")
      return res.status(400).json({ error: "Invalide" });
    tx.status = "valide";
    await tx.save();
    if (tx.type === "depot") {
      await User.findByIdAndUpdate(tx.userId, { $inc: { balance: tx.amount } });
    }
    res.json({ message: "Transaction validée" });
  } catch (error) {
    res.status(500).json({ error: "Erreur" });
  }
});

app.patch("/api/actions/:id", async (req, res) => {
  try {
    const { price, description } = req.body;
    const updatedAction = await Action.findByIdAndUpdate(
      req.params.id,
      { price: Number(price), description },
      { new: true }
    );
    res.json(updatedAction);
  } catch (err) {
    res.status(500).json({ error: "Erreur mise à jour" });
  }
});

// --- MESSAGERIE ---
app.post("/api/messages/send", async (req, res) => {
  try {
    const { actionId, senderId, receiverId, content } = req.body;
    const newMessage = new Message({ actionId, senderId, receiverId, content });
    await newMessage.save();
    await createNotify(
      receiverId,
      "Nouvelle question",
      `Question sur votre actif.`,
      "info"
    );
    res.status(201).json(newMessage);
  } catch (err) {
    res.status(500).json({ error: "Erreur" });
  }
});

app.get("/api/messages/owner/:userId", async (req, res) => {
  try {
    const messages = await Message.find({ receiverId: req.params.userId })
      .populate("senderId", "name")
      .populate("actionId", "name")
      .sort({ createdAt: -1 });
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: "Erreur" });
  }
});

app.get("/api/messages/buyer/:userId", async (req, res) => {
  try {
    const messages = await Message.find({ senderId: req.params.userId })
      .populate("actionId", "name")
      .populate("receiverId", "name")
      .sort({ createdAt: 1 });
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: "Erreur" });
  }
});

app.get("/api/messages/chat/:actionId/:userId", async (req, res) => {
  try {
    const messages = await Message.find({
      actionId: req.params.actionId,
      $or: [{ senderId: req.params.userId }, { receiverId: req.params.userId }],
    }).sort({ createdAt: 1 });
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: "Erreur" });
  }
});

app.patch("/api/messages/reply/:messageId", async (req, res) => {
  try {
    const { reply } = req.body;
    const message = await Message.findByIdAndUpdate(
      req.params.messageId,
      { reply },
      { new: true }
    );
    await createNotify(
      message.senderId,
      "Réponse reçue",
      `L'actionnaire a répondu.`,
      "success"
    );
    res.json(message);
  } catch (err) {
    res.status(500).json({ error: "Erreur" });
  }
});

app.patch("/api/admin/transactions/:id/reject", async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const transaction = await Transaction.findById(id);
    if (!transaction)
      return res.status(404).json({ error: "Transaction introuvable" });
    if (transaction.status !== "en_attente")
      return res.status(400).json({ error: "Déjà traitée" });

    const user = await User.findById(transaction.userId);
    if (!user)
      return res.status(404).json({ error: "Utilisateur introuvable" });

    user.balance = (user.balance || 0) + transaction.amount;
    transaction.status = "rejete";
    transaction.comment = reason || "Retrait refusé par l'administrateur";

    await createNotify(
      user._id,
      "Retrait refusé",
      `Retrait de ${transaction.amount} F refusé (Num: ${transaction.recipientPhone}). Balance créditée.`,
      "retrait"
    );
    await user.save();
    await transaction.save();
    res.json({
      message: "Retrait refusé et utilisateur recrédité",
      newBalance: user.balance,
    });
  } catch (error) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Remplace 'router' par 'app' si tu es dans le fichier principal
app.get("/api/admin/stats", async (req, res) => {
  try {
    // Assure-toi que le modèle User est bien importé en haut du fichier
    const userCount = await User.countDocuments();

    res.json({
      totalUsers: userCount,
    });
  } catch (error) {
    res.status(500).json({ message: "Erreur lors du comptage" });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Serveur sur le port ${PORT}`));
