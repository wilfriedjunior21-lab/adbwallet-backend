const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const axios = require("axios");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

// Import des modèles
const User = require("./models/User");
const Action = require("./models/Action");
const Transaction = require("./models/Transaction");

const app = express();
const upload = multer({ dest: "uploads/" });

app.use(express.json());
app.use(cors());

// --- CONNEXION BASE DE DONNÉES ---
mongoose
  .connect(
    "mongodb+srv://wilfriedjunior21_adb:wilfried2005@clusteradbwallet.f4jeap2.mongodb.net/?appName=Clusteradbwallet"
  )
  .then(() => console.log("✅ Connecté à MongoDB Atlas"))
  .catch((err) => console.error("❌ Erreur de connexion", err));

// --- AUTHENTIFICATION ---

app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    const userExists = await User.findOne({ email });
    if (userExists)
      return res.status(400).json({ error: "Cet email est déjà utilisé." });

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({
      name,
      email,
      password: hashedPassword,
      role: role || "acheteur",
      kycStatus: "non_verifie",
      balance: 0,
    });

    await newUser.save();
    res.status(201).json({ message: "Utilisateur créé avec succès !" });
  } catch (err) {
    res.status(500).json({ error: "Erreur lors de l'inscription." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res
        .status(401)
        .json({ error: "Email ou mot de passe incorrect." });
    }

    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET || "VOTRE_CLE_SECRETE",
      { expiresIn: "24h" }
    );

    res.json({
      token,
      role: user.role,
      userId: user._id,
      name: user.name,
    });
  } catch (err) {
    res.status(500).json({ error: "Erreur lors de la connexion." });
  }
});

// --- GESTION DES ACTIONS ---

app.get("/api/actions", async (req, res) => {
  try {
    const actions = await Action.find({ status: "en_vente" }).populate(
      "owner",
      "name"
    );
    res.json(actions);
  } catch (err) {
    res.status(500).json({ error: "Erreur récupération actions" });
  }
});

app.post("/api/actions/create", async (req, res) => {
  try {
    const { companyName, sector, pricePerShare, totalShares, owner } = req.body;
    const user = await User.findById(owner);

    const nouvelleAction = new Action({
      companyName,
      sector,
      price: Number(pricePerShare),
      quantity: Number(totalShares),
      sellerPhone: user?.phone || "00000000",
      owner,
      status: "en_vente",
    });

    await nouvelleAction.save();
    res.status(201).json({ message: "Action créée !" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/user/actions/:userId", async (req, res) => {
  try {
    const actions = await Action.find({ owner: req.params.userId });
    res.json(actions);
  } catch (err) {
    res.status(500).json({ error: "Erreur actions utilisateur" });
  }
});

// --- PAIEMENT MASHAPAY ---

app.post("/api/transactions/pay-mashapay", async (req, res) => {
  const { actionId, buyerId, amount, phoneNumber } = req.body;
  try {
    const action = await Action.findById(actionId);

    // Logique simplifiée pour MashaPay (à adapter selon ta clé API)
    const newTransaction = new Transaction({
      action: actionId,
      buyer: buyerId,
      seller: action.owner,
      amount,
      status: "en_attente",
      paymentMethod: "MashaPay",
      phoneNumber,
    });

    await newTransaction.save();
    res.json({
      success: true,
      message: "Demande de paiement envoyée via MashaPay !",
    });
  } catch (err) {
    res.status(500).json({ error: "Erreur lors du paiement MashaPay" });
  }
});

// --- ROUTES ADMIN (Correction Erreur 404) ---

app.get("/api/admin/stats", async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const transactions = await Transaction.find({ status: "valide" });
    const totalVolume = transactions.reduce(
      (acc, curr) => acc + curr.amount,
      0
    );
    res.json({ totalUsers, totalVolume });
  } catch (err) {
    res.status(500).json({ error: "Erreur statistiques" });
  }
});

app.get("/api/admin/pending-kyc", async (req, res) => {
  try {
    const users = await User.find({ kycStatus: "en_attente" });
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: "Erreur récupération KYC" });
  }
});

app.post("/api/admin/verify-kyc", async (req, res) => {
  const { userId, status } = req.body;
  try {
    await User.findByIdAndUpdate(userId, { kycStatus: status });
    res.json({ message: "Statut KYC mis à jour" });
  } catch (err) {
    res.status(500).json({ error: "Erreur validation KYC" });
  }
});

// Récupérer toutes les transactions en attente pour l'admin
app.get("/api/admin/pending-transactions", async (req, res) => {
  try {
    const transactions = await Transaction.find({ status: "en_attente" })
      .populate("buyer", "name email")
      .populate("seller", "name email")
      .populate("action", "companyName");
    res.json(transactions);
  } catch (err) {
    res
      .status(500)
      .json({ error: "Erreur récupération transactions en attente" });
  }
});

// Valider manuellement une transaction (par exemple après vérification MashaPay)
app.post("/api/admin/verify-transaction", async (req, res) => {
  const { transactionId, status } = req.body; // status: "valide" ou "rejete"
  try {
    const transaction = await Transaction.findById(transactionId);
    if (!transaction)
      return res.status(404).json({ error: "Transaction non trouvée" });

    transaction.status = status;
    await transaction.save();

    // Si la transaction est validée, on pourrait ici transférer les actions
    // ou mettre à jour les soldes si ce n'est pas déjà fait.

    res.json({ message: `Transaction ${status}` });
  } catch (err) {
    res.status(500).json({ error: "Erreur validation transaction" });
  }
});

// --- INFOS UTILISATEUR ---

app.get("/api/user/:id", async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select("-password");
    res.json(user);
  } catch (err) {
    res.status(404).json({ error: "Utilisateur non trouvé" });
  }
});

app.get("/api/user/transactions/:userId", async (req, res) => {
  try {
    const transactions = await Transaction.find({
      $or: [{ buyer: req.params.userId }, { seller: req.params.userId }],
    })
      .populate("action buyer seller")
      .sort({ createdAt: -1 });
    res.json(transactions);
  } catch (err) {
    res.status(500).json({ error: "Erreur transactions" });
  }
});

// --- LANCEMENT ---
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Serveur actif sur le port ${PORT}`));
