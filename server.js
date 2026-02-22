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
  referenceId: { type: String },
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

// --- CONFIGURATION MTN MOMO ---
const mtnConfig = {
  primaryKey: "8cc21d360efb40cfb4ef57d90bbb5e51",
  apiUser: "5f04e913-c740-470f-8d70-a0f7eabd3642",
  apiKey: "6b3d3a94a7ee4f33b8e19e963d957fb0",
  env: "sandbox",
  baseUrl: "https://sandbox.momodeveloper.mtn.com",
};

const getMTNToken = async () => {
  const auth = Buffer.from(`${mtnConfig.apiUser}:${mtnConfig.apiKey}`).toString(
    "base64"
  );
  const response = await axios.post(
    `${mtnConfig.baseUrl}/collection/token/`,
    {},
    {
      headers: {
        Authorization: `Basic ${auth}`,
        "Ocp-Apim-Subscription-Key": mtnConfig.primaryKey,
      },
    }
  );
  return response.data.access_token;
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

// --- INTEGRATION MTN MOMO PAY (CORRIGÉE) ---

app.post("/api/transactions/mtn/pay", async (req, res) => {
  const { amount, phone, userId } = req.body;
  const referenceId = uuidv4();
  const cleanPhone = phone.replace(/\D/g, "");

  console.log("--- TENTATIVE DE PAIEMENT ---");
  console.log("Montant:", amount, "Téléphone:", cleanPhone);

  try {
    const token = await getMTNToken();
    console.log("✅ Token obtenu avec succès");

    const payload = {
      amount: amount.toString(),
      currency: "EUR", // Garde EUR pour la Sandbox
      externalId: "ADB" + Date.now(),
      payer: { partyIdType: "MSISDN", partyId: cleanPhone },
      payerMessage: "Depot ADB Wallet",
      payeeNote: "Investissement",
    };

    const response = await axios.post(
      `${mtnConfig.baseUrl}/collection/v1_0/requesttopay`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Reference-Id": referenceId,
          "X-Target-Environment": mtnConfig.env,
          "Ocp-Apim-Subscription-Key": mtnConfig.primaryKey,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("✅ Réponse MTN (Code HTTP):", response.status);

    const newTx = new Transaction({
      userId,
      amount: Number(amount),
      type: "depot",
      status: "en_attente",
      referenceId: referenceId,
    });
    await newTx.save();

    res.json({ message: "Veuillez valider le paiement", referenceId });
  } catch (error) {
    console.log("❌ ERREUR DETECTÉE !");
    if (error.response) {
      // C'est ici que MTN nous dit pourquoi il rejette
      console.log("Données de l'erreur:", JSON.stringify(error.response.data));
      console.log("Statut de l'erreur:", error.response.status);
    } else {
      console.log("Message d'erreur:", error.message);
    }

    res.status(500).json({
      error: "Rejeté par MTN",
      details: error.response ? error.response.data : error.message,
    });
  }
});
app.get("/api/transactions/mtn/status/:referenceId", async (req, res) => {
  try {
    const token = await getMTNToken();
    const { referenceId } = req.params;

    const response = await axios.get(
      `${mtnConfig.baseUrl}/collection/v1_0/requesttopay/${referenceId}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Target-Environment": mtnConfig.env,
          "Ocp-Apim-Subscription-Key": mtnConfig.primaryKey,
        },
      }
    );

    const status = response.data.status;

    if (status === "SUCCESSFUL") {
      const tx = await Transaction.findOne({
        referenceId,
        status: "en_attente",
      });
      if (tx) {
        tx.status = "valide";
        await tx.save();
        await User.findByIdAndUpdate(tx.userId, {
          $inc: { balance: tx.amount },
        });
        await createNotify(
          tx.userId,
          "Dépôt Réussi",
          `Votre compte a été crédité de ${tx.amount} F.`,
          "success"
        );
      }
    }

    res.json({ status });
  } catch (error) {
    console.error(
      "Erreur Check Status:",
      error.response?.data || error.message
    );
    res.status(500).json({ error: "Erreur lors de la vérification du statut" });
  }
});

// --- AUTRES ROUTES (CONSERVÉES À 100%) ---

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
      `Votre projet ${name} est en attente.`,
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
  try {
    const user = await User.findById(userId);
    const action = await Action.findById(actionId);
    if (!action || action.status !== "valide")
      return res.status(404).json({ error: "Non dispo" });

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
      `Acquisition de ${quantity} parts de ${action.name}.`,
      "success"
    );
    res.json({ message: "Achat réussi !", newBalance: user.balance });
  } catch (err) {
    res.status(500).json({ error: "Erreur achat" });
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
      `Votre actif ${action.name} est en vente.`,
      "success"
    );
    const acheteurs = await User.find({ role: "acheteur" });
    const notificationPromises = acheteurs.map((acheteur) =>
      createNotify(
        acheteur._id,
        "Nouvelle opportunité",
        `${action.name} est disponible à ${action.price} F !`,
        "info"
      )
    );
    await Promise.all(notificationPromises);
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
    if (!action) return res.status(404).json({ error: "Non trouvé" });
    const purchases = await Transaction.find({
      actionId,
      type: "achat",
      status: "valide",
    });

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
        `${dividendAmount} F reçus pour ${action.name}.`,
        "success"
      );
    });

    await Promise.all(distributionPromises);
    res.json({ message: `Dividendes distribués pour ${action.name}` });
  } catch (err) {
    res.status(500).json({ error: "Erreur" });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Serveur sur le port ${PORT}`));
