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
const nodemailer = require("nodemailer"); // AJOUTÉ : Pour les emails

const app = express();
app.use(express.json());
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// --- CONFIGURATION NODEMAILER ---
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER || "votre-email@gmail.com",
    pass: process.env.EMAIL_PASS || "votre-mot-de-passe-application",
  },
});

// Fonction utilitaire pour envoyer le reçu
const sendReceiptEmail = async (userEmail, userName, details) => {
  try {
    const mailOptions = {
      from: '"ADB WALLET" <noreply@adbwallet.com>',
      to: userEmail,
      subject: `Reçu de Transaction - ${details.type.toUpperCase()}`,
      html: `
        <div style="font-family: Arial, sans-serif; background-color: #000; color: #fff; padding: 20px; border-radius: 15px; max-width: 500px; margin: auto; border: 1px solid #333;">
          <h2 style="color: #3b82f6; text-align: center;">ADB WALLET</h2>
          <p style="text-align: center; color: #888; font-size: 12px;">REÇU DE TRANSACTION OFFICIEL</p>
          <hr style="border: 0.5px solid #222;" />
          <div style="padding: 10px 0;">
            <p><strong>Client :</strong> ${userName}</p>
            <p><strong>Type :</strong> ${details.type}</p>
            <p><strong>Montant :</strong> <span style="color: #10b981; font-weight: bold;">${
              details.amount
            } FCFA</span></p>
            <p><strong>Date :</strong> ${new Date().toLocaleString()}</p>
            <p><strong>Référence :</strong> ${
              details.ref || "ADB-" + uuidv4().substring(0, 6).toUpperCase()
            }</p>
          </div>
          <hr style="border: 0.5px solid #222;" />
          <p style="font-size: 10px; color: #555; text-align: center;">Merci d'utiliser ADB WALLET pour vos investissements financiers.</p>
        </div>
      `,
    };
    await transporter.sendMail(mailOptions);
    console.log(`✅ Email envoyé à ${userEmail}`);
  } catch (error) {
    console.error("❌ Erreur envoi email:", error);
  }
};

// --- 1. CONFIGURATION CLOUDINARY (WILFRIED) ---
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

// --- 2. CONNEXION MONGODB ---
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log("✅ MongoDB Connecté");
    startMarketEngine();
  })
  .catch((err) => console.error("❌ Erreur MongoDB:", err));

// --- 3. TOUS LES MODÈLES ---
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
    recipientPhone: { type: String, default: "" },
    paymentNumber: { type: String, default: "" },
    referenceId: String,
    comment: String,
    date: { type: Date, default: Date.now },
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
    actionId: { type: mongoose.Schema.Types.ObjectId, ref: "Action" },
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    receiverId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    content: { type: String, required: true },
    reply: { type: String, default: "" },
    createdAt: { type: Date, default: Date.now },
  })
);

// --- 4. MOTEUR DE MARCHÉ ---
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

// --- 5. ROUTES AUTHENTIFICATION ---
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

// --- 6. ROUTES UTILISATEUR & PROFIL ---
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

app.get(
  ["/api/user/:id/balance", "/api/users/:id/balance"],
  async (req, res) => {
    const user = await User.findById(req.params.id);
    res.json({ balance: user ? user.balance : 0 });
  }
);

app.post(
  "/api/user/upload-profile-pic/:userId",
  upload.single("image"),
  async (req, res) => {
    try {
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

app.post("/api/user/submit-kyc", async (req, res) => {
  try {
    const { userId, documentUrl } = req.body;
    await User.findByIdAndUpdate(userId, {
      kycDocUrl: documentUrl,
      kycStatus: "en_attente",
    });
    res.json({ message: "KYC soumis avec succès" });
  } catch (e) {
    res.status(500).json({ error: "Erreur KYC" });
  }
});

// --- 7. ROUTES ACTIONS & OBLIGATIONS ---
app.get("/api/actions", async (req, res) =>
  res.json(await Action.find().populate("creatorId", "name profilePic"))
);

app.get("/api/actions/owner/:userId", async (req, res) => {
  res.json(await Action.find({ creatorId: req.params.userId }));
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

app.patch("/api/actions/:id", async (req, res) => {
  const action = await Action.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
  });
  res.json(action);
});

app.get("/api/bonds", async (req, res) =>
  res.json(await Bond.find({ status: "valide" }))
);

app.get(
  ["/api/bonds/owner/:userId", "/api/obligations/owner/:userId"],
  async (req, res) => {
    res.json(await Bond.find({ actionnaireId: req.params.userId }));
  }
);

app.post("/api/bonds/propose", async (req, res) => {
  await new Bond({ ...req.body, status: "en_attente" }).save();
  res.json({ message: "OK" });
});

app.patch("/api/obligations/:id", async (req, res) => {
  const bond = await Bond.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
  });
  res.json(bond);
});

// --- 8. SYSTÈME DE TRANSACTIONS ---
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
    await user.save();
    action.availableQuantity -= quantity;
    action.price = Math.round(action.price + action.price * 0.0005 * quantity);
    await action.save();
    const tx = await new Transaction({
      userId,
      actionId,
      quantity,
      amount: cost,
      type: "achat",
      status: "valide",
    }).save();

    // ENVOI REÇU
    sendReceiptEmail(user.email, user.name, {
      type: "Achat Actions",
      amount: cost,
      ref: tx._id,
    });

    res.json({ message: "Achat réussi" });
  } else res.status(400).json({ error: "Solde ou stock insuffisant" });
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
    await user.save();
    action.availableQuantity += Number(quantity);
    action.price = Math.max(
      10,
      Math.round(action.price - action.price * 0.0003 * quantity)
    );
    await action.save();
    const tx = await new Transaction({
      userId,
      actionId,
      quantity,
      amount: gain,
      type: "vente",
      status: "valide",
    }).save();

    // ENVOI REÇU
    sendReceiptEmail(user.email, user.name, {
      type: "Vente Actions",
      amount: gain,
      ref: tx._id,
    });

    res.json({ message: "Vente réussie" });
  } else
    res
      .status(400)
      .json({ error: "Quantité insuffisante dans le portefeuille" });
});

app.post("/api/transactions/subscribe-bond", async (req, res) => {
  const { userId, bondId, amount } = req.body;
  const user = await User.findById(userId);
  const bond = await Bond.findById(bondId);
  if (user.balance < amount)
    return res.status(400).json({ error: "Solde insuffisant" });
  user.balance -= amount;
  bond.montantCollecte += Number(amount);
  await user.save();
  await bond.save();
  const tx = await new Transaction({
    userId,
    bondId,
    amount,
    type: "souscription_obligation",
    status: "valide",
  }).save();

  // ENVOI REÇU
  sendReceiptEmail(user.email, user.name, {
    type: "Souscription Obligation",
    amount,
    ref: tx._id,
  });

  res.json({ message: "Souscription réussie" });
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
    res.json({ message: "Demande de retrait envoyée" });
  } else res.status(400).json({ error: "Solde insuffisant" });
});

app.get("/api/transactions/user/:userId", async (req, res) => {
  res.json(
    await Transaction.find({ userId: req.params.userId })
      .populate("actionId bondId")
      .sort({ date: -1 })
  );
});

// --- 9. MESSAGERIE & CHAT ---
app.get(
  ["/api/messages/owner/:userId", "/api/messages/user/:userId"],
  async (req, res) => {
    res.json(
      await Message.find({ receiverId: req.params.userId })
        .populate("senderId", "name profilePic")
        .populate("actionId", "name")
        .sort({ createdAt: -1 })
    );
  }
);

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

app.patch("/api/messages/reply/:id", async (req, res) => {
  res.json(
    await Message.findByIdAndUpdate(
      req.params.id,
      { reply: req.body.reply },
      { new: true }
    )
  );
});

// --- 10. ADMINISTRATION ---
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

app.patch("/api/admin/kyc/:id", async (req, res) => {
  await User.findByIdAndUpdate(req.params.id, { kycStatus: req.body.status });
  res.json({ message: "Statut KYC mis à jour" });
});

app.patch("/api/admin/actions/:id/validate", async (req, res) => {
  await Action.findByIdAndUpdate(req.params.id, { status: "valide" });
  res.json({ message: "Action validée" });
});

app.patch("/api/admin/bonds/:id/validate", async (req, res) => {
  await Bond.findByIdAndUpdate(req.params.id, { status: "valide" });
  res.json({ message: "Obligation validée" });
});

app.patch("/api/admin/transactions/:id/validate", async (req, res) => {
  const tx = await Transaction.findById(req.params.id).populate("userId");
  if (tx.type === "depot" && tx.status === "en_attente") {
    await User.findByIdAndUpdate(tx.userId._id, {
      $inc: { balance: tx.amount },
    });
    // ENVOI REÇU DÉPOT
    sendReceiptEmail(tx.userId.email, tx.userId.name, {
      type: "Dépôt validé",
      amount: tx.amount,
      ref: tx.referenceId || tx._id,
    });
  }
  tx.status = "valide";
  await tx.save();
  res.json({ message: "Transaction validée" });
});

app.patch("/api/admin/transactions/:id/reject", async (req, res) => {
  const tx = await Transaction.findById(req.params.id);
  if (tx.status === "en_attente") {
    await User.findByIdAndUpdate(tx.userId, { $inc: { balance: tx.amount } });
    tx.status = "rejete";
    tx.comment = req.body.reason;
    await tx.save();
  }
  res.json({ message: "Transaction rejetée et utilisateur remboursé" });
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
    const tx = await new Transaction({
      userId: u._id,
      actionId,
      amount: total,
      type: "dividende",
      status: "valide",
    }).save();

    // ENVOI REÇU DIVIDENDE
    sendReceiptEmail(u.email, u.name, {
      type: "Distribution Dividendes",
      amount: total,
      ref: tx._id,
    });
  }
  res.json({ message: "Dividendes distribués avec succès" });
});

// --- 11. PAIEMENTS PAYMOONEY & NOTIFICATIONS ---
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

// --- AJOUT ROUTES NOTIFICATIONS (WILFRIED) ---

// Récupérer toutes les notifications d'un utilisateur
app.get("/api/notifications/:userId", async (req, res) => {
  try {
    const notifications = await Notification.find({
      userId: req.params.userId,
    }).sort({ date: -1 });
    res.json(notifications);
  } catch (error) {
    res
      .status(500)
      .json({ error: "Erreur lors de la récupération des notifications" });
  }
});

// Marquer une notification spécifique comme lue
app.patch("/api/notifications/:id/read", async (req, res) => {
  try {
    await Notification.findByIdAndUpdate(req.params.id, { read: true });
    res.json({ message: "Notification marquée comme lue" });
  } catch (error) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Marquer toutes les notifications d'un utilisateur comme lues
app.put("/api/notifications/read-all/:userId", async (req, res) => {
  try {
    await Notification.updateMany(
      { userId: req.params.userId, read: false },
      { read: true }
    );
    res.json({
      message: "Toutes les notifications ont été marquées comme lues",
    });
  } catch (error) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Supprimer une notification
app.delete("/api/notifications/:id", async (req, res) => {
  try {
    await Notification.findByIdAndDelete(req.params.id);
    res.json({ message: "Notification supprimée" });
  } catch (error) {
    res.status(500).json({ error: "Erreur lors de la suppression" });
  }
});

// --- FIN AJOUT ROUTES NOTIFICATIONS ---

// --- DÉMARRAGE ---
const PORT = process.env.PORT || 5000;
app.listen(PORT, () =>
  console.log(`🚀 Serveur Wilfried 100% Opérationnel sur ${PORT}`)
);
