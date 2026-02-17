const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

// Import des modèles (Assure-toi que ces fichiers existent dans ton dossier /models)
const User = require("./models/User");
const Action = require("./models/Action");
const Transaction = require("./models/Transaction");

const app = express();
app.use(express.json());
app.use(cors());

// --- CONNEXION MONGODB ---
mongoose
  .connect(
    "mongodb+srv://wilfriedjunior21_adb:wilfried2005@clusteradbwallet.f4jeap2.mongodb.net/?appName=Clusteradbwallet"
  )
  .then(() => console.log("✅ Connecté à MongoDB"))
  .catch((err) => console.error("❌ Erreur de connexion", err));

// --- AUTHENTIFICATION ---

app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    const hashed = await bcrypt.hash(password, 10);
    const user = new User({
      name,
      email,
      password: hashed,
      role: role || "acheteur",
    });
    await user.save();
    res.status(201).json({ message: "Utilisateur créé" });
  } catch (err) {
    res.status(500).json({ error: "Erreur lors de l'inscription" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: "Identifiants invalides" });
    }
    const token = jwt.sign(
      { id: user._id, role: user.role },
      "VOTRE_CLE_SECRETE"
    );
    res.json({ token, userId: user._id, role: user.role, name: user.name });
  } catch (err) {
    res.status(500).json({ error: "Erreur de connexion" });
  }
});

// --- GESTION DES ACTIONS ---

app.get("/api/actions", async (req, res) => {
  try {
    const actions = await Action.find({ status: "en_vente" });
    res.json(actions);
  } catch (err) {
    res.status(500).json({ error: "Erreur récupération actions" });
  }
});

app.post("/api/actions/create", async (req, res) => {
  try {
    const { companyName, sector, pricePerShare, totalShares, owner } = req.body;
    const nouvelleAction = new Action({
      companyName,
      sector,
      price: Number(pricePerShare),
      quantity: Number(totalShares),
      owner,
      status: "en_vente",
    });
    await nouvelleAction.save();
    res.status(201).json({ message: "Action créée" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- PAIEMENT MASHAPAY & TRANSACTIONS ---

app.post("/api/transactions/pay-mashapay", async (req, res) => {
  const { actionId, buyerId, amount, phoneNumber } = req.body;
  try {
    const action = await Action.findById(actionId);
    const newTrans = new Transaction({
      action: actionId,
      buyer: buyerId,
      seller: action.owner,
      amount,
      phoneNumber,
      status: "en_attente",
      type: "achat",
    });
    await newTrans.save();
    res.json({ success: true, message: "Paiement MashaPay initié" });
  } catch (err) {
    res.status(500).json({ error: "Erreur MashaPay" });
  }
});

// --- KYC (SOUUMISSION) ---

app.post("/api/user/submit-kyc", async (req, res) => {
  const { userId, documentUrl } = req.body;
  try {
    await User.findByIdAndUpdate(userId, {
      kycStatus: "en_attente",
      documentUrl,
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Erreur KYC" });
  }
});

// --- ADMINISTRATION (COMMAND CENTER) ---

app.get("/api/admin/stats", async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const trans = await Transaction.find({ status: "valide" });
    const totalVolume = trans.reduce((acc, curr) => acc + curr.amount, 0);
    const pendingPurchases = await Transaction.countDocuments({
      status: "en_attente",
      type: "achat",
    });

    res.json({
      totalUsers,
      totalVolume,
      pendingPurchasesCount: pendingPurchases,
      pendingWithdrawalsCount: 0,
    });
  } catch (err) {
    res.status(500).json({ error: "Erreur Stats" });
  }
});

app.get("/api/admin/pending-kyc", async (req, res) => {
  try {
    const users = await User.find({ kycStatus: "en_attente" });
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: "Erreur KYC" });
  }
});

app.get("/api/admin/pending-transactions", async (req, res) => {
  try {
    const trans = await Transaction.find({ status: "en_attente" })
      .populate("buyer", "name email")
      .populate("action", "companyName");
    res.json(trans);
  } catch (err) {
    res.status(500).json({ error: "Erreur Transactions" });
  }
});

// ROUTE CRUCIALE : Validation (KYC ou Transaction)
app.post("/api/admin/validate/:id", async (req, res) => {
  const { id } = req.params;
  const { type, status } = req.body;
  try {
    if (type === "kyc") {
      await User.findByIdAndUpdate(id, { kycStatus: status });
    } else {
      await Transaction.findByIdAndUpdate(id, { status: status });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Erreur validation" });
  }
});

// --- INFOS UTILISATEUR & HISTORIQUE ---

app.get("/api/user/:id", async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select("-password");
    res.json(user);
  } catch (err) {
    res.status(404).json({ error: "User not found" });
  }
});

app.get("/api/user/transactions/:userId", async (req, res) => {
  try {
    const t = await Transaction.find({
      $or: [{ buyer: req.params.userId }, { seller: req.params.userId }],
    })
      .populate("action")
      .sort({ createdAt: -1 });
    res.json(t);
  } catch (err) {
    res.status(500).json({ error: "Erreur historique" });
  }
});

app.get("/api/user/actions/:userId", async (req, res) => {
  try {
    const a = await Action.find({ owner: req.params.userId });
    res.json(a);
  } catch (err) {
    res.status(500).json({ error: "Erreur actions" });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Serveur sur port ${PORT}`));
