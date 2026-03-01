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

// ==========================================
// 1. CONFIGURATION CLOUDINARY
// ==========================================
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

// ==========================================
// 2. MODÈLES DE DONNÉES (DATABASE)
// ==========================================
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
        quantity: { type: Number, default: 0 },
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
    comment: String,
    date: { type: Date, default: Date.now },
  })
);

const Message = mongoose.model(
  "Message",
  new mongoose.Schema({
    actionId: { type: mongoose.Schema.Types.ObjectId, ref: "Action" },
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    receiverId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    content: { type: String, required: true },
    reply: { type: String, default: "" },
    createdAt: { type: Date, default: Date.now },
  })
);

// ==========================================
// 3. MOTEUR DE BOURSE (SIMULATION)
// ==========================================
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
      console.error("Erreur Moteur Marché:", e);
    }
  }, 30 * 60 * 1000);
};

// ==========================================
// 4. ROUTES AUTHENTIFICATION
// ==========================================
app.post("/api/auth/register", async (req, res) => {
  try {
    const hash = await bcrypt.hash(req.body.password, 10);
    const user = new User({ ...req.body, password: hash });
    await user.save();
    res.status(201).json({ message: "Utilisateur créé" });
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
    } else {
      res.status(400).json({ error: "Email ou mot de passe incorrect" });
    }
  } catch (e) {
    res.status(500).json({ error: "Erreur lors de la connexion" });
  }
});

// ==========================================
// 5. ROUTES UTILISATEUR & PROFIL
// ==========================================
app.get("/api/user/:id", async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .populate("portfolio.actionId")
      .select("-password");
    res.json(user);
  } catch (e) {
    res.status(404).json({ error: "Utilisateur non trouvé" });
  }
});

app.put("/api/user/:id", async (req, res) => {
  try {
    const { name } = req.body;
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { name },
      { new: true }
    );
    res.json(user);
  } catch (e) {
    res.status(500).json({ error: "Erreur mise à jour nom" });
  }
});

app.post(
  "/api/user/upload-profile-pic/:userId",
  upload.single("image"),
  async (req, res) => {
    try {
      if (!req.file)
        return res.status(400).json({ error: "Aucune image reçue" });
      const user = await User.findByIdAndUpdate(
        req.params.userId,
        { profilePic: req.file.path },
        { new: true }
      );
      res.json(user);
    } catch (e) {
      res.status(500).json({ error: "Erreur upload image" });
    }
  }
);

app.get("/api/user/:id/balance", async (req, res) => {
  const user = await User.findById(req.params.id);
  res.json({ balance: user ? user.balance : 0 });
});

// ==========================================
// 6. ROUTES ACTIONS & OBLIGATIONS
// ==========================================
app.get("/api/actions", async (req, res) => {
  const actions = await Action.find().populate("creatorId", "name profilePic");
  res.json(actions);
});

app.get("/api/actions/owner/:userId", async (req, res) => {
  const actions = await Action.find({ creatorId: req.params.userId });
  res.json(actions);
});

app.post("/api/actions/propose", async (req, res) => {
  try {
    const action = new Action({
      ...req.body,
      availableQuantity: req.body.totalQuantity,
      status: "en_attente",
    });
    await action.save();
    res.status(201).json({ message: "Proposition envoyée" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/bonds", async (req, res) => {
  const bonds = await Bond.find({ status: "valide" });
  res.json(bonds);
});

app.get("/api/obligations/owner/:userId", async (req, res) => {
  const bonds = await Bond.find({ actionnaireId: req.params.userId });
  res.json(bonds);
});

// ==========================================
// 7. SYSTÈME DE TRANSACTIONS (ACHAT / VENTE)
// ==========================================
app.post("/api/transactions/buy", async (req, res) => {
  const { userId, actionId, quantity } = req.body;
  const user = await User.findById(userId);
  const action = await Action.findById(actionId);
  const cost = action.price * quantity;

  if (user.balance >= cost && action.availableQuantity >= quantity) {
    user.balance -= cost;
    const portIdx = user.portfolio.findIndex(
      (p) => p.actionId.toString() === actionId
    );
    if (portIdx > -1) user.portfolio[portIdx].quantity += Number(quantity);
    else user.portfolio.push({ actionId, quantity });

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
  } else {
    res.status(400).json({ error: "Solde ou stock insuffisant" });
  }
});

app.post("/api/transactions/sell", async (req, res) => {
  const { userId, actionId, quantity } = req.body;
  const user = await User.findById(userId);
  const action = await Action.findById(actionId);
  const gain = action.price * quantity;
  const portIdx = user.portfolio.findIndex(
    (p) => p.actionId.toString() === actionId
  );

  if (portIdx > -1 && user.portfolio[portIdx].quantity >= quantity) {
    user.portfolio[portIdx].quantity -= quantity;
    user.balance += gain;
    action.availableQuantity += Number(quantity);
    await user.save();
    await action.save();
    await new Transaction({
      userId,
      actionId,
      quantity,
      amount: gain,
      type: "vente",
      status: "valide",
    }).save();
    res.json({ message: "Vente effectuée" });
  } else {
    res.status(400).json({ error: "Quantité insuffisante" });
  }
});

app.get("/api/transactions/user/:userId", async (req, res) => {
  const tx = await Transaction.find({ userId: req.params.userId })
    .populate("actionId bondId")
    .sort({ date: -1 });
  res.json(tx);
});

// ==========================================
// 8. MESSAGERIE
// ==========================================
app.get("/api/messages/owner/:userId", async (req, res) => {
  const msg = await Message.find({ receiverId: req.params.userId })
    .populate("senderId", "name profilePic")
    .sort({ createdAt: -1 });
  res.json(msg);
});

app.post("/api/messages/send", async (req, res) => {
  const msg = new Message(req.body);
  await msg.save();
  res.json(msg);
});

// ==========================================
// 9. ADMINISTRATION (KYC, VALIDATION, DIVIDENDES)
// ==========================================
app.get("/api/admin/users", async (req, res) => {
  const users = await User.find().select("-password");
  res.json(users);
});

app.patch("/api/admin/transactions/:id/validate", async (req, res) => {
  const tx = await Transaction.findById(req.params.id);
  if (tx.type === "depot") {
    await User.findByIdAndUpdate(tx.userId, { $inc: { balance: tx.amount } });
  }
  tx.status = "valide";
  await tx.save();
  res.json({ message: "Validé" });
});

app.patch("/api/admin/transactions/:id/reject", async (req, res) => {
  const tx = await Transaction.findById(req.params.id);
  tx.status = "rejete";
  tx.comment = req.body.reason;
  await tx.save();
  res.json({ message: "Rejeté" });
});

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

// ==========================================
// 10. PAIEMENTS PAYMOONEY
// ==========================================
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

// ==========================================
// DÉMARRAGE DU SERVEUR
// ==========================================
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log("✅ MongoDB Connecté");
    startMarketEngine();
  })
  .catch((err) => console.log(err));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () =>
  console.log(`🚀 Serveur Wilfried lancé sur le port ${PORT}`)
);
