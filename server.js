require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const path = require("path");

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

// --- CONFIGURATION CLOUDINARY (WILFRIED) ---
cloudinary.config({
  cloud_name: "wilfriedjunior21",
  api_key: "282333729488766",
  api_secret: "kGzwKVICcHtqaWH5z-s8ST1lL5M",
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "adb_wallet_profiles",
    allowed_formats: ["jpg", "png", "jpeg"],
  },
});

const upload = multer({ storage: storage });

// --- CONFIGURATION PAYMOONEY ---
const PAYMOONEY_PUBLIC_KEY = "PK_d5M4k6BYZ1qaHegEJ8x7";

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
  profilePic: { type: String, default: "" },
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
  montantCollecte: { type: Number, default: 0 },
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
  bondId: { type: mongoose.Schema.Types.ObjectId, ref: "Bond" },
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
      "coupon",
      "souscription_obligation",
    ],
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

// --- ROUTES PROFIL (MAINTENANT AVEC CLOUDINARY) ---
app.post(
  "/api/user/upload-profile-pic/:userId",
  upload.single("image"),
  async (req, res) => {
    try {
      if (!req.file)
        return res.status(400).json({ error: "Aucun fichier envoyé" });
      const imageUrl = req.file.path; // URL Cloudinary sécurisée
      const updatedUser = await User.findByIdAndUpdate(
        req.params.userId,
        { profilePic: imageUrl },
        { new: true }
      ).select("-password");
      res.json(updatedUser);
    } catch (err) {
      res.status(500).json({ error: "Erreur Cloudinary" });
    }
  }
);

app.put("/api/user/update/:id", async (req, res) => {
  try {
    const { name } = req.body;
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { name },
      { new: true }
    ).select("-password");
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: "Erreur MAJ" });
  }
});

app.get("/api/user/:id", async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select("-password");
    if (!user) return res.status(404).json({ error: "Utilisateur non trouvé" });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

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
      profilePic: user.profilePic,
    });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// --- ACTIONS ---
app.post("/api/actions/propose", async (req, res) => {
  try {
    const { name, price, totalQuantity, description, creatorId } = req.body;
    const newAction = new Action({
      name,
      price: Number(price),
      totalQuantity: Number(totalQuantity),
      availableQuantity: Number(totalQuantity),
      description,
      creatorId,
      status: "en_attente",
    });
    await newAction.save();
    await createNotify(
      creatorId,
      "Actif soumis",
      `Votre actif "${name}" est en cours d'examen.`,
      "info"
    );
    res.status(201).json({ message: "Succès" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/actions", async (req, res) => {
  try {
    const actions = await Action.find().populate(
      "creatorId",
      "name profilePic"
    );
    res.json(actions);
  } catch (err) {
    res.status(500).json({ error: "Erreur" });
  }
});

app.patch("/api/actions/:id", async (req, res) => {
  try {
    const { price, description } = req.body;
    const action = await Action.findByIdAndUpdate(
      req.params.id,
      { price, description },
      { new: true }
    );
    res.json(action);
  } catch (err) {
    res.status(500).json({ error: "Erreur MAJ Action" });
  }
});

// --- OBLIGATIONS (BONDS) ---
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

app.get("/api/bonds", async (req, res) => {
  try {
    const bonds = await Bond.find({ status: "valide" }).sort({ createdAt: -1 });
    res.json(bonds);
  } catch (err) {
    res.status(500).json({ error: "Erreur" });
  }
});

// --- PAYMOONEY & SOLDE ---
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
    if (response.data.response === "success")
      res.json({ payment_url: response.data.payment_url, referenceId });
    else res.status(400).json({ error: "Erreur Paymooney" });
  } catch (error) {
    res.status(500).json({ error: "Erreur initialisation" });
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

app.get("/api/users/:id/balance", async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    res.json({ balance: user.balance || 0 });
  } catch (err) {
    res.status(500).json({ error: "Erreur solde" });
  }
});

// --- MARCHÉ : ACHAT & VENTE ---
app.post("/api/transactions/buy", async (req, res) => {
  const { userId, actionId, quantity } = req.body;
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const user = await User.findById(userId).session(session);
    const action = await Action.findById(actionId).session(session);
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
      await new Transaction({
        userId: action.creatorId,
        actionId,
        quantity,
        amount: totalCost,
        type: "vente",
        status: "valide",
      }).save({ session });
    }

    action.price = Math.round(action.price + action.price * 0.0005 * quantity);
    action.availableQuantity -= quantity;
    await action.save({ session });

    await new Transaction({
      userId,
      actionId,
      quantity,
      amount: totalCost,
      type: "achat",
      status: "valide",
    }).save({ session });
    await session.commitTransaction();
    res.json({ message: "Succès", newBalance: user.balance });
  } catch (err) {
    await session.abortTransaction();
    res.status(500).json({ error: err.message });
  } finally {
    session.endSession();
  }
});

app.post("/api/transactions/sell", async (req, res) => {
  const { userId, actionId, quantity } = req.body;
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const user = await User.findById(userId).session(session);
    const action = await Action.findById(actionId).session(session);
    const txs = await Transaction.find({
      userId,
      actionId,
      status: "valide",
    }).session(session);
    let owned = 0;
    txs.forEach((t) => {
      if (t.type === "achat") owned += t.quantity;
      if (t.type === "vente") owned -= t.quantity;
    });

    if (owned < quantity) throw new Error("Parts insuffisantes");

    const gain = action.price * quantity;
    user.balance += gain;
    await user.save({ session });

    action.availableQuantity += Number(quantity);
    action.price = Math.round(action.price - action.price * 0.0003 * quantity);
    if (action.price < 10) action.price = 10;
    await action.save({ session });

    await new Transaction({
      userId,
      actionId,
      quantity,
      amount: gain,
      type: "vente",
      status: "valide",
    }).save({ session });
    await session.commitTransaction();
    res.json({ message: "Vente réussie", newBalance: user.balance });
  } catch (err) {
    await session.abortTransaction();
    res.status(500).json({ error: err.message });
  } finally {
    session.endSession();
  }
});

// --- ADMIN : DIVIDENDES ---
app.post("/api/admin/distribute-dividends", async (req, res) => {
  const { actionId, totalAmount } = req.body;
  try {
    const action = await Action.findById(actionId);
    const txs = await Transaction.find({ actionId, status: "valide" });
    const ownership = {};
    let totalOwned = 0;

    txs.forEach((t) => {
      if (!ownership[t.userId]) ownership[t.userId] = 0;
      if (t.type === "achat") ownership[t.userId] += t.quantity;
      if (t.type === "vente") ownership[t.userId] -= t.quantity;
    });

    Object.values(ownership).forEach((q) => (totalOwned += q));
    if (totalOwned <= 0)
      return res.status(400).json({ error: "Aucun actionnaire trouvé" });

    for (const userId in ownership) {
      if (ownership[userId] > 0) {
        const dividend = Math.round(
          (ownership[userId] / totalOwned) * Number(totalAmount)
        );
        await User.findByIdAndUpdate(userId, { $inc: { balance: dividend } });
        await new Transaction({
          userId,
          actionId,
          amount: dividend,
          type: "dividende",
          status: "valide",
          comment: `Dividende ${action.name}`,
        }).save();
        await createNotify(
          userId,
          "Dividende Reçu",
          `+${dividend} F pour ${action.name}`,
          "success"
        );
      }
    }
    res.json({ message: "Distribué avec succès" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- ADMIN : VALIDATION ---
app.get("/api/admin/transactions", async (req, res) =>
  res.json(await Transaction.find().populate("userId").sort({ date: -1 }))
);

app.patch("/api/admin/transactions/:id/validate", async (req, res) => {
  try {
    const tx = await Transaction.findById(req.params.id);
    if (tx.type === "depot" && tx.status === "en_attente") {
      await User.findByIdAndUpdate(tx.userId, { $inc: { balance: tx.amount } });
    }
    tx.status = "valide";
    await tx.save();
    res.json({ message: "Validé" });
  } catch (err) {
    res.status(500).json({ error: "Erreur" });
  }
});

app.patch("/api/admin/transactions/:id/reject", async (req, res) => {
  try {
    const tx = await Transaction.findById(req.params.id);
    tx.status = "rejete";
    await tx.save();
    if (tx.type === "retrait")
      await User.findByIdAndUpdate(tx.userId, { $inc: { balance: tx.amount } });
    res.json({ message: "Rejeté" });
  } catch (err) {
    res.status(500).json({ error: "Erreur" });
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
    await new Transaction({
      userId,
      amount: Number(amount),
      recipientPhone,
      type: "retrait",
      status: "en_attente",
    }).save();
    res.json({ message: "Demande reçue", newBalance: user.balance });
  } catch (err) {
    res.status(500).json({ error: "Erreur" });
  }
});

// --- NOTIFICATIONS ---
app.get("/api/notifications/:userId", async (req, res) => {
  res.json(
    await Notification.find({ userId: req.params.userId })
      .sort({ date: -1 })
      .limit(15)
  );
});

// --- DÉMARRAGE ---
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Serveur actif sur le port ${PORT}`));
