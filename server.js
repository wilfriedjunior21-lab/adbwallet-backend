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

const app = express();
app.use(express.json());
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// --- CONFIGURATION CLOUDINARY ---
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || "wilfriedjunior21",
  api_key: process.env.CLOUDINARY_API_KEY || "282333729488766",
  api_secret:
    process.env.CLOUDINARY_API_SECRET || "kGzwKVICcHtqaWH5z-s8ST1lL5M",
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => ({
    folder: "adb_wallet_profiles",
    allowed_formats: ["jpg", "png", "jpeg"],
    public_id: `profile-${req.params.userId || uuidv4()}-${Date.now()}`,
  }),
});
const upload = multer({ storage });

// --- CONNEXION MONGODB ---
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log("✅ MongoDB Connecté");
    startMarketEngine();
  })
  .catch((err) => console.error("❌ Erreur MongoDB:", err));

// --- MODÈLES ---
const User = mongoose.model(
  "User",
  new mongoose.Schema({
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
    portfolio: [
      {
        actionId: { type: mongoose.Schema.Types.ObjectId, ref: "Action" },
        quantity: Number,
      },
    ],
    totalProfitGained: { type: Number, default: 0 },
  })
);

const Action = mongoose.model(
  "Action",
  new mongoose.Schema({
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
  })
);

const Bond = mongoose.model(
  "Bond",
  new mongoose.Schema({
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
  })
);

const Transaction = mongoose.model(
  "Transaction",
  new mongoose.Schema({
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
    recipientPhone: String,
    referenceId: String,
    reason: String, // Pour les rejets
    date: { type: Date, default: Date.now },
  })
);

const Message = mongoose.model(
  "Message",
  new mongoose.Schema({
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
  })
);

// --- MOTEUR DE MARCHÉ ---
const startMarketEngine = () => {
  setInterval(async () => {
    try {
      const actions = await Action.find({ status: "valide" });
      for (let a of actions) {
        let change = (Math.random() * 4 - 1.5) / 100;
        a.price = Math.max(10, Math.round(a.price * (1 + change)));
        await a.save();
      }
    } catch (e) {
      console.error("Market Engine Error:", e);
    }
  }, 30 * 60 * 1000);
};

// --- ROUTES AUTH & USER ---
app.post("/api/auth/register", async (req, res) => {
  try {
    const hash = await bcrypt.hash(req.body.password, 10);
    const user = new User({ ...req.body, password: hash });
    await user.save();
    res.status(201).json({ message: "OK" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const user = await User.findOne({ email: req.body.email });
    if (user && (await bcrypt.compare(req.body.password, user.password))) {
      const token = jwt.sign({ id: user._id, role: user.role }, "SECRET", {
        expiresIn: "1d",
      });
      res.json({
        token,
        userId: user._id,
        role: user.role,
        name: user.name,
        email: user.email,
        profilePic: user.profilePic,
      });
    } else res.status(400).json({ error: "Identifiants invalides" });
  } catch (e) {
    res.status(500).json({ error: "Erreur login" });
  }
});

app.get("/api/user/:id", async (req, res) => {
  try {
    res.json(
      await User.findById(req.params.id)
        .populate("portfolio.actionId")
        .select("-password")
    );
  } catch (e) {
    res.status(404).json({ error: "Utilisateur non trouvé" });
  }
});

// NOUVEAU: Route soumission KYC (DashboardAcheteur)
app.post("/api/user/submit-kyc", async (req, res) => {
  try {
    const { userId, documentUrl } = req.body;
    await User.findByIdAndUpdate(userId, {
      kycDocUrl: documentUrl,
      kycStatus: "en_attente",
    });
    res.json({ message: "KYC soumis" });
  } catch (e) {
    res.status(500).json({ error: "Erreur KYC" });
  }
});

// --- ROUTES ACTIONS & OBLIGATIONS ---
app.get("/api/actions", async (req, res) =>
  res.json(await Action.find().populate("creatorId", "name profilePic"))
);

// NOUVEAU: Patch Action (DashboardActionnaire)
app.patch("/api/actions/:id", async (req, res) => {
  try {
    const action = await Action.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });
    res.json(action);
  } catch (e) {
    res.status(500).json({ error: "Erreur MAJ" });
  }
});

app.get("/api/bonds", async (req, res) =>
  res.json(await Bond.find({ status: "valide" }))
);

app.get("/api/obligations/owner/:userId", async (req, res) => {
  try {
    res.json(await Bond.find({ actionnaireId: req.params.userId }));
  } catch (e) {
    res.status(500).json({ error: "Erreur obligations" });
  }
});

// NOUVEAU: Patch Obligation (DashboardActionnaire)
app.patch("/api/obligations/:id", async (req, res) => {
  try {
    const bond = await Bond.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });
    res.json(bond);
  } catch (e) {
    res.status(500).json({ error: "Erreur MAJ" });
  }
});

// --- TRANSACTIONS ---
app.post("/api/transactions/buy", async (req, res) => {
  const { userId, actionId, quantity } = req.body;
  const user = await User.findById(userId);
  const action = await Action.findById(actionId);
  const cost = action.price * quantity;
  if (user.balance >= cost && action.availableQuantity >= quantity) {
    user.balance -= cost;
    // Mise à jour portfolio
    const existing = user.portfolio.find(
      (p) => p.actionId.toString() === actionId
    );
    if (existing) existing.quantity += Number(quantity);
    else user.portfolio.push({ actionId, quantity });
    await user.save();
    action.availableQuantity -= quantity;
    await action.save();
    await new Transaction({
      userId,
      actionId,
      quantity,
      amount: cost,
      type: "achat",
      status: "valide",
    }).save();
    res.json({ message: "Achat réussi" });
  } else res.status(400).json({ error: "Solde ou stock insuffisant" });
});

// NOUVEAU: Route Souscription Obligation (DashboardAcheteur)
app.post("/api/transactions/subscribe-bond", async (req, res) => {
  try {
    const { userId, bondId, amount } = req.body;
    const user = await User.findById(userId);
    const bond = await Bond.findById(bondId);
    if (user.balance < amount)
      return res.status(400).json({ error: "Solde insuffisant" });
    user.balance -= amount;
    bond.montantCollecte += Number(amount);
    await user.save();
    await bond.save();
    await new Transaction({
      userId,
      bondId,
      amount,
      type: "souscription_obligation",
      status: "valide",
    }).save();
    res.json({ message: "Souscription réussie" });
  } catch (e) {
    res.status(500).json({ error: "Erreur" });
  }
});

app.post("/api/transactions/withdraw", async (req, res) => {
  const { userId, amount, recipientPhone } = req.body;
  const user = await User.findById(userId);
  if (user.balance >= amount) {
    user.balance -= amount;
    await user.save();
    await new Transaction({
      userId,
      amount,
      recipientPhone,
      type: "retrait",
      status: "en_attente",
    }).save();
    res.json({ message: "Demande envoyée" });
  } else res.status(400).json({ error: "Solde insuffisant" });
});

app.get("/api/transactions/user/:userId", async (req, res) => {
  res.json(
    await Transaction.find({ userId: req.params.userId })
      .populate("actionId bondId")
      .sort({ date: -1 })
  );
});

// --- MESSAGERIE ---
app.get("/api/messages/owner/:userId", async (req, res) => {
  res.json(
    await Message.find({ receiverId: req.params.userId })
      .populate("senderId", "name profilePic")
      .populate("actionId", "name")
      .sort({ createdAt: -1 })
  );
});

app.get("/api/messages/chat/:contactId/:userId", async (req, res) => {
  res.json(
    await Message.find({
      $or: [
        { senderId: req.params.userId, receiverId: req.params.contactId },
        { senderId: req.params.contactId, receiverId: req.params.userId },
      ],
    }).sort({ createdAt: 1 })
  );
});

app.post("/api/messages/send", async (req, res) =>
  res.json(await new Message(req.body).save())
);

// NOUVEAU: Répondre à un message (DashboardActionnaire)
app.patch("/api/messages/reply/:id", async (req, res) => {
  res.json(
    await Message.findByIdAndUpdate(
      req.params.id,
      { reply: req.body.reply },
      { new: true }
    )
  );
});

// --- ADMIN ---
app.get("/api/admin/users", async (req, res) =>
  res.json(await User.find().select("-password"))
);
app.get("/api/admin/actions", async (req, res) =>
  res.json(await Action.find().populate("creatorId", "name"))
);
app.get("/api/admin/bonds", async (req, res) =>
  res.json(await Bond.find().populate("actionnaireId", "name"))
);
app.get("/api/admin/transactions", async (req, res) =>
  res.json(
    await Transaction.find().populate("userId", "name").sort({ date: -1 })
  )
);

// NOUVEAU: Validation KYC (AdminPanel)
app.patch("/api/admin/kyc/:id", async (req, res) => {
  await User.findByIdAndUpdate(req.params.id, { kycStatus: req.body.status });
  res.json({ message: "KYC mis à jour" });
});

// NOUVEAU: Validation Action (AdminPanel)
app.patch("/api/admin/actions/:id/validate", async (req, res) => {
  await Action.findByIdAndUpdate(req.params.id, { status: "valide" });
  res.json({ message: "Action validée" });
});

// NOUVEAU: Validation Obligation (AdminPanel)
app.patch("/api/admin/bonds/:id/validate", async (req, res) => {
  await Bond.findByIdAndUpdate(req.params.id, { status: "valide" });
  res.json({ message: "Obligation validée" });
});

// NOUVEAU: Rejet Retrait avec recrédit (AdminPanel)
app.patch("/api/admin/transactions/:id/reject", async (req, res) => {
  const tx = await Transaction.findById(req.params.id);
  if (tx.status === "en_attente") {
    await User.findByIdAndUpdate(tx.userId, { $inc: { balance: tx.amount } });
    tx.status = "rejete";
    tx.reason = req.body.reason;
    await tx.save();
  }
  res.json({ message: "Transaction rejetée et recréditée" });
});

// NOUVEAU: Validation générale transactions (Dépôt/Retrait)
app.patch("/api/admin/transactions/:id/validate", async (req, res) => {
  const tx = await Transaction.findById(req.params.id);
  if (tx.type === "depot" && tx.status === "en_attente") {
    await User.findByIdAndUpdate(tx.userId, { $inc: { balance: tx.amount } });
  }
  tx.status = "valide";
  await tx.save();
  res.json({ message: "Validé" });
});

// NOUVEAU: Suppression (Rejet) Obligation
app.delete("/api/admin/bonds/:id", async (req, res) => {
  await Bond.findByIdAndDelete(req.params.id);
  res.json({ message: "Supprimé" });
});

// NOUVEAU: Distribution Dividendes (AdminPanel)
app.post("/api/admin/distribute-dividends", async (req, res) => {
  const { actionId, amountPerShare } = req.body;
  const users = await User.find({ "portfolio.actionId": actionId });
  for (let u of users) {
    const entry = u.portfolio.find((p) => p.actionId.toString() === actionId);
    const total = entry.quantity * amountPerShare;
    u.balance += total;
    u.totalProfitGained += total;
    await u.save();
    await new Transaction({
      userId: u._id,
      actionId,
      amount: total,
      type: "dividende",
      status: "valide",
    }).save();
  }
  res.json({ message: "Distribution terminée" });
});

// --- PAIEMENTS ---
app.post("/api/payments/paymooney/init", async (req, res) => {
  try {
    const { userId, amount, email, name } = req.body;
    const ref = `PM-${uuidv4().substring(0, 8).toUpperCase()}`;
    const response = await axios.post(
      "https://www.paymooney.com/api/v1.0/payment_url",
      new URLSearchParams({
        amount: amount.toString(),
        currency_code: "XAF",
        item_ref: ref,
        item_name: "Depot ADB",
        public_key: "PK_d5M4k6BYZ1qaHegEJ8x7",
        lang: "fr",
        first_name: name,
        email,
      })
    );
    await new Transaction({
      userId,
      amount,
      type: "depot",
      status: "en_attente",
      referenceId: ref,
    }).save();
    res.json({ payment_url: response.data.payment_url });
  } catch (error) {
    res.status(500).json({ error: "Erreur Paymooney" });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Serveur Wilfried sur ${PORT}`));
