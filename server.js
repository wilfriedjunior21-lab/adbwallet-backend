require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");

const app = express();
app.use(express.json());

// --- CONFIGURATION CORS ---
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

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
  createdAt: { type: Date, default: Date.now },
});

const bondSchema = new mongoose.Schema({
  titre: { type: String, required: true },
  montantCible: { type: Number, required: true },
  tauxInteret: { type: Number, required: true },
  dureeMois: { type: Number, required: true },
  frequence: { type: String, required: true },
  garantie: { type: Number, required: true },
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
  recipientPhone: { type: String, default: "" },
  paymentNumber: { type: String, default: "" },
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

// --- FONCTIONS ET MOTEUR ---
const createNotify = async (userId, title, message, type = "info") => {
  try {
    const notify = new Notification({ userId, title, message, type });
    await notify.save();
  } catch (err) {
    console.error("Erreur Notification:", err);
  }
};

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
      process.env.JWT_SECRET || "SECRET_KEY",
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

// --- PAYMOONEY ---
app.post("/api/payments/paymooney/init", async (req, res) => {
  try {
    const { userId, amount, email, name } = req.body;
    const referenceId = `PM-${uuidv4().substring(0, 8).toUpperCase()}`;
    const newTx = new Transaction({
      userId,
      amount: Number(amount),
      type: "depot",
      status: "en_attente",
      referenceId,
    });
    await newTx.save();

    const params = new URLSearchParams({
      amount: amount.toString(),
      currency_code: "XAF",
      item_ref: referenceId,
      item_name: "Depot ADB Wallet",
      public_key: PAYMOONEY_PUBLIC_KEY,
      lang: "fr",
      first_name: name || "Client",
      email: email,
    });

    const response = await axios.post(
      "https://www.paymooney.com/api/v1.0/payment_url",
      params
    );
    if (response.data.response === "success") {
      res.json({ payment_url: response.data.payment_url, referenceId });
    } else {
      res.status(400).json({ error: response.data.description });
    }
  } catch (error) {
    res.status(500).json({ error: "Erreur Paymooney Init" });
  }
});

app.post("/api/payments/paymooney-notify", async (req, res) => {
  try {
    const { status, item_reference, amount, transaction_id } = req.body;
    if (status?.toLowerCase() === "success") {
      const tx = await Transaction.findOne({
        referenceId: item_reference,
        status: "en_attente",
      });
      if (tx) {
        tx.status = "valide";
        tx.paymentId = transaction_id;
        await tx.save();
        await User.findByIdAndUpdate(tx.userId, {
          $inc: { balance: Number(amount) },
        });
        await createNotify(
          tx.userId,
          "Dépôt Réussi",
          `Compte crédité de ${amount} F.`,
          "success"
        );
      }
    }
    res.status(200).send("OK");
  } catch (error) {
    res.status(500).send("Erreur Notify");
  }
});

// --- ROUTES CORE ---
app.get("/api/user/:id", async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select("-password");
    res.json(user);
  } catch (err) {
    res.status(404).json({ error: "Non trouvé" });
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

// --- OBLIGATIONS (BONDS) ---
// Route pour proposer (Déjà existante)
app.post("/api/bonds/propose", async (req, res) => {
  try {
    const newBond = new Bond(req.body);
    await newBond.save();
    await createNotify(
      req.body.actionnaireId,
      "Obligation soumise",
      `Projet "${req.body.titre}" en examen.`,
      "info"
    );
    res.status(201).json({ message: "Envoyé" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// NOUVELLE ROUTE : Pour afficher les obligations validées aux acheteurs (Evite la 404)
app.get("/api/bonds", async (req, res) => {
  try {
    const bonds = await Bond.find({ status: "valide" }).sort({ createdAt: -1 });
    res.json(bonds);
  } catch (err) {
    res.status(500).json({ error: "Erreur récupération obligations" });
  }
});

// --- SOUSCRIRE À UNE OBLIGATION (INVESTIR) ---
app.post("/api/transactions/subscribe-bond", async (req, res) => {
  const { userId, bondId, amount } = req.body;
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const user = await User.findById(userId).session(session);
    const bond = await Bond.findById(bondId).session(session);

    if (!bond || bond.status !== "valide") {
      throw new Error("Cette obligation n'est pas disponible.");
    }

    if (user.balance < amount) {
      throw new Error("Solde insuffisant pour cet investissement.");
    }

    // 1. Déduire le montant du solde de l'utilisateur
    user.balance -= Number(amount);
    await user.save({ session });

    // 2. Créer la transaction d'achat d'obligation
    const bondTx = new Transaction({
      userId,
      amount: Number(amount),
      type: "achat", // ou "investissement" si tu veux créer un nouveau type
      status: "valide",
      comment: `Souscription à l'obligation : ${bond.titre}`,
      date: new Date(),
    });
    await bondTx.save({ session });

    // 3. Notifier l'utilisateur
    await createNotify(
      userId,
      "Investissement confirmé",
      `Vous avez investi ${amount} F dans ${bond.titre}.`,
      "success"
    );

    await session.commitTransaction();
    res.json({
      message: "Souscription réussie",
      newBalance: user.balance,
    });
  } catch (err) {
    await session.abortTransaction();
    res.status(400).json({ error: err.message });
  } finally {
    session.endSession();
  }
});

// --- ACTIONS ---
app.get("/api/actions", async (req, res) => {
  try {
    // Populate creatorId pour permettre la messagerie entre acheteur et vendeur
    res.json(
      await Action.find({ status: "valide" }).populate("creatorId", "name")
    );
  } catch (err) {
    res.status(500).json({ error: "Erreur" });
  }
});

// --- TRANSACTIONS ---
app.get("/api/transactions/user/:userId", async (req, res) => {
  try {
    const txs = await Transaction.find({ userId: req.params.userId })
      .populate("actionId")
      .sort({ date: -1 });
    res.json(txs);
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
    if (!action || action.status !== "valide") throw new Error("Invalide");
    const totalCost = action.price * quantity;
    if (user.balance < totalCost) throw new Error("Solde insuffisant");
    if (action.availableQuantity < quantity)
      throw new Error("Parts insuffisantes");

    user.balance -= totalCost;
    await user.save({ session });

    if (action.creatorId) {
      await User.findByIdAndUpdate(
        action.creatorId,
        { $inc: { balance: totalCost } },
        { session }
      );
      const sellerTx = new Transaction({
        userId: action.creatorId,
        actionId,
        quantity,
        amount: totalCost,
        type: "vente",
        status: "valide",
      });
      await sellerTx.save({ session });
    }

    action.price = Math.round(
      action.price + action.price * (0.0005 * quantity)
    );
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

    await session.commitTransaction();
    res.json({ message: "Succès", newBalance: user.balance });
  } catch (err) {
    await session.abortTransaction();
    res.status(500).json({ error: err.message });
  } finally {
    session.endSession();
  }
});

app.post("/api/transactions/withdraw", async (req, res) => {
  const { userId, amount, recipientPhone } = req.body;
  try {
    const user = await User.findById(userId);
    if (user.balance < amount)
      return res.status(400).json({ error: "Insuffisant" });
    user.balance -= Number(amount);
    await user.save();
    const tx = new Transaction({
      userId,
      amount: Number(amount),
      recipientPhone,
      type: "retrait",
      status: "en_attente",
    });
    await tx.save();
    res.json({ message: "Demande reçue", newBalance: user.balance });
  } catch (err) {
    res.status(500).json({ error: "Erreur" });
  }
});

// --- MESSAGERIE ---
app.get("/api/messages/owner/:userId", async (req, res) => {
  try {
    const msgs = await Message.find({ receiverId: req.params.userId })
      .populate("senderId", "name")
      .populate("actionId", "name")
      .sort({ createdAt: -1 });
    res.json(msgs);
  } catch (err) {
    res.status(500).json({ error: "Erreur" });
  }
});

app.post("/api/messages/send", async (req, res) => {
  try {
    const msg = new Message(req.body);
    await msg.save();
    await createNotify(
      req.body.receiverId,
      "Nouveau message",
      "Vous avez une question sur un actif."
    );
    res.status(201).json(msg);
  } catch (err) {
    res.status(500).json({ error: "Erreur" });
  }
});

// --- ADMIN ROUTES ---
app.get("/api/admin/users", async (req, res) =>
  res.json(await User.find().select("-password"))
);
app.get("/api/admin/actions", async (req, res) =>
  res.json(await Action.find().sort({ createdAt: -1 }))
);
app.get("/api/admin/bonds", async (req, res) =>
  res.json(
    await Bond.find()
      .populate("actionnaireId", "name email")
      .sort({ createdAt: -1 })
  )
);
app.get("/api/admin/transactions", async (req, res) =>
  res.json(await Transaction.find().populate("userId").sort({ date: -1 }))
);

app.patch("/api/admin/kyc/:id", async (req, res) => {
  await User.findByIdAndUpdate(req.params.id, { kycStatus: req.body.status });
  res.json({ message: "Statut mis à jour" });
});

app.patch("/api/admin/actions/:id/validate", async (req, res) => {
  const action = await Action.findByIdAndUpdate(
    req.params.id,
    { status: "valide" },
    { new: true }
  );
  await createNotify(
    action.creatorId,
    "Action Validée",
    `${action.name} est en vente !`,
    "success"
  );
  res.json({ message: "Validée" });
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
    "Votre projet est actif.",
    "success"
  );
  res.json({ message: "Validée" });
});

app.delete("/api/admin/bonds/:id", async (req, res) => {
  await Bond.findByIdAndDelete(req.params.id);
  res.json({ message: "Supprimée" });
});

app.patch("/api/admin/transactions/:id/validate", async (req, res) => {
  const tx = await Transaction.findById(req.params.id);
  tx.status = "valide";
  await tx.save();
  if (tx.type === "depot")
    await User.findByIdAndUpdate(tx.userId, { $inc: { balance: tx.amount } });
  res.json({ message: "Validée" });
});

app.patch("/api/admin/transactions/:id/reject", async (req, res) => {
  const tx = await Transaction.findById(req.params.id);
  if (tx.type === "retrait")
    await User.findByIdAndUpdate(tx.userId, { $inc: { balance: tx.amount } });
  tx.status = "rejete";
  tx.comment = req.body.reason;
  await tx.save();
  res.json({ message: "Rejeté" });
});

app.post("/api/admin/distribute-dividends", async (req, res) => {
  const { actionId, amountPerShare } = req.body;
  const purchases = await Transaction.find({
    actionId,
    type: "achat",
    status: "valide",
  });
  for (let tx of purchases) {
    const div = tx.quantity * amountPerShare;
    await User.findByIdAndUpdate(tx.userId, { $inc: { balance: div } });
    await new Transaction({
      userId: tx.userId,
      actionId,
      amount: div,
      type: "dividende",
      status: "valide",
    }).save();
  }
  res.json({ message: "Distribués" });
});

app.get("/api/notifications/:userId", async (req, res) => {
  res.json(
    await Notification.find({ userId: req.params.userId })
      .sort({ date: -1 })
      .limit(15)
  );
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Serveur sur le port ${PORT}`));
