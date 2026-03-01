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

// --- CONFIGURATION CLOUDINARY (WILFRIED) ---
cloudinary.config({
  cloud_name: "wilfriedjunior21",
  api_key: "282333729488766",
  api_secret: "kGzwKVICcHtqaWH5z-s8ST1lL5M",
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

// --- TOUS LES MODÈLES (REPRIS À L'IDENTIQUE) ---
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
    recipientPhone: { type: String, default: "" },
    paymentNumber: { type: String, default: "" },
    date: { type: Date, default: Date.now },
    referenceId: String,
    comment: String,
  })
);

const Notification = mongoose.model(
  "Notification",
  new mongoose.Schema({
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

// --- ROUTES PROFIL & KYC (CLOUDINARY) ---
app.post(
  "/api/user/upload-profile-pic/:userId",
  upload.single("image"),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "Fichier manquant" });
      const user = await User.findByIdAndUpdate(
        req.params.userId,
        { profilePic: req.file.path },
        { new: true }
      );
      res.json(user);
    } catch (e) {
      res.status(500).json({ error: "Erreur Upload" });
    }
  }
);

app.get("/api/user/:id", async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select("-password");
    res.json(user);
  } catch (e) {
    res.status(404).json({ error: "Utilisateur non trouvé" });
  }
});

// --- ROUTES BALANCE (RÉSOLUTION 404 WALLET) ---
app.get(
  ["/api/user/:id/balance", "/api/users/:id/balance"],
  async (req, res) => {
    try {
      const user = await User.findById(req.params.id);
      res.json({ balance: user ? user.balance : 0 });
    } catch (e) {
      res.status(500).json({ error: "Erreur solde" });
    }
  }
);

// --- AUTHENTIFICATION ---
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

// --- ACTIONS & BOURSE ---
app.get("/api/actions", async (req, res) =>
  res.json(await Action.find().populate("creatorId", "name profilePic"))
);

// Route spécifique pour les actions possédées par un utilisateur (Dashboard)
app.get("/api/actions/owner/:userId", async (req, res) => {
  try {
    const actions = await Action.find({ creatorId: req.params.userId });
    res.json(actions);
  } catch (e) {
    res
      .status(500)
      .json({ error: "Erreur lors de la récupération de vos actions" });
  }
});

app.post("/api/actions/propose", async (req, res) => {
  try {
    const action = new Action({
      ...req.body,
      availableQuantity: req.body.totalQuantity,
      status: "en_attente",
    });
    await action.save();
    res.status(201).json({ message: "OK" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/transactions/buy", async (req, res) => {
  const { userId, actionId, quantity } = req.body;
  const user = await User.findById(userId);
  const action = await Action.findById(actionId);
  const cost = action.price * quantity;
  if (user.balance >= cost && action.availableQuantity >= quantity) {
    user.balance -= cost;
    await user.save();
    action.availableQuantity -= quantity;
    action.price = Math.round(action.price + action.price * 0.0005 * quantity);
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

app.post("/api/transactions/sell", async (req, res) => {
  const { userId, actionId, quantity } = req.body;
  const user = await User.findById(userId);
  const action = await Action.findById(actionId);
  const gain = action.price * quantity;
  user.balance += gain;
  await user.save();
  action.availableQuantity += Number(quantity);
  action.price = Math.max(
    10,
    Math.round(action.price - action.price * 0.0003 * quantity)
  );
  await action.save();
  await new Transaction({
    userId,
    actionId,
    quantity,
    amount: gain,
    type: "vente",
    status: "valide",
  }).save();
  res.json({ message: "Vente réussie" });
});

// --- OBLIGATIONS (BONDS) ---
app.get("/api/bonds", async (req, res) =>
  res.json(await Bond.find({ status: "valide" }))
);

// Alias de route pour assurer la compatibilité Dashboard (404 fix)
app.get(
  ["/api/bonds/owner/:userId", "/api/obligations/owner/:userId"],
  async (req, res) => {
    try {
      const bonds = await Bond.find({ actionnaireId: req.params.userId });
      res.json(bonds);
    } catch (e) {
      res.status(500).json({ error: "Erreur obligations" });
    }
  }
);

app.post("/api/bonds/propose", async (req, res) => {
  await new Bond(req.body).save();
  res.json({ message: "OK" });
});

// --- MESSAGERIE & CHAT ---
// Alias pour les messages reçus (pour le Dashboard Actionnaire)
app.get(
  ["/api/messages/owner/:userId", "/api/messages/user/:userId"],
  async (req, res) => {
    try {
      const msgs = await Message.find({ receiverId: req.params.userId })
        .populate("senderId", "name profilePic")
        .populate("actionId", "name")
        .sort({ createdAt: -1 });
      res.json(msgs);
    } catch (e) {
      res.status(500).json({ error: "Erreur messages" });
    }
  }
);

app.get("/api/messages/chat/:userId/:contactId", async (req, res) => {
  try {
    const msgs = await Message.find({
      $or: [
        { senderId: req.params.userId, receiverId: req.params.contactId },
        { senderId: req.params.contactId, receiverId: req.params.userId },
      ],
    })
      .populate("senderId", "name profilePic")
      .sort({ createdAt: 1 });
    res.json(msgs);
  } catch (e) {
    res.status(500).json({ error: "Erreur chat" });
  }
});

app.post("/api/messages/send", async (req, res) =>
  res.json(await new Message(req.body).save())
);

// --- ADMIN & GESTION ---
app.get("/api/admin/users", async (req, res) =>
  res.json(await User.find().select("-password").sort({ name: 1 }))
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

app.patch("/api/admin/transactions/:id/validate", async (req, res) => {
  const tx = await Transaction.findById(req.params.id);
  if (tx.type === "depot" && tx.status === "en_attente") {
    await User.findByIdAndUpdate(tx.userId, { $inc: { balance: tx.amount } });
  }
  tx.status = "valide";
  await tx.save();
  res.json({ message: "Transaction validée" });
});

app.post("/api/admin/distribute-dividends", async (req, res) => {
  const { actionId, totalAmount } = req.body;
  const txs = await Transaction.find({ actionId, status: "valide" });
  let owns = {};
  let total = 0;
  txs.forEach((t) => {
    owns[t.userId] =
      (owns[t.userId] || 0) + (t.type === "achat" ? t.quantity : -t.quantity);
  });
  Object.values(owns).forEach((v) => {
    if (v > 0) total += v;
  });
  if (total <= 0) return res.status(400).json({ error: "Aucun actionnaire" });

  for (let id in owns) {
    if (owns[id] > 0) {
      const div = Math.round((owns[id] / total) * totalAmount);
      await User.findByIdAndUpdate(id, { $inc: { balance: div } });
      await new Transaction({
        userId: id,
        actionId,
        amount: div,
        type: "dividende",
        status: "valide",
      }).save();
    }
  }
  res.json({ message: "Dividendes distribués" });
});

// --- PAYMOONEY & RETRAITS ---
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

app.post("/api/transactions/withdraw", async (req, res) => {
  try {
    const user = await User.findById(req.body.userId);
    if (user.balance >= req.body.amount) {
      user.balance -= req.body.amount;
      await user.save();
      await new Transaction({
        ...req.body,
        type: "retrait",
        status: "en_attente",
      }).save();
      res.json({ message: "Demande envoyée" });
    } else res.status(400).json({ error: "Solde insuffisant" });
  } catch (e) {
    res.status(500).json({ error: "Erreur" });
  }
});

// --- NOTIFICATIONS & HISTORIQUE ---
app.get("/api/notifications/:userId", async (req, res) =>
  res.json(
    await Notification.find({ userId: req.params.userId }).sort({ date: -1 })
  )
);
app.get("/api/transactions/user/:userId", async (req, res) =>
  res.json(
    await Transaction.find({ userId: req.params.userId })
      .populate("actionId bondId")
      .sort({ date: -1 })
  )
);

// --- DÉMARRAGE ---
const PORT = process.env.PORT || 5000;
app.listen(PORT, () =>
  console.log(`🚀 Serveur Wilfried 100% Opérationnel sur ${PORT}`)
);
