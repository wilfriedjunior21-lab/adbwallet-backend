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
const sendEmail = require("./utils/mailer");

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
      "VOTRE_CLE_SECRETE",
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

// Toutes les actions en vente
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

// Créer une action (Route corrigée pour éviter l'erreur 500)
app.post("/api/actions/create", async (req, res) => {
  try {
    const { companyName, sector, pricePerShare, totalShares, owner } = req.body;

    if (!owner)
      return res.status(400).json({ error: "L'ID du propriétaire est requis" });

    const nouvelleAction = new Action({
      companyName,
      sector,
      pricePerShare: Number(pricePerShare),
      totalShares: Number(totalShares),
      owner,
      status: "en_vente",
    });

    await nouvelleAction.save();
    res.status(201).json({ message: "Action mise en vente !" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur lors de la création de l'action" });
  }
});

// Actions spécifiques à un utilisateur (Actionnaire)
app.get("/api/user/actions/:userId", async (req, res) => {
  try {
    const actions = await Action.find({ owner: req.params.userId });
    res.json(actions || []);
  } catch (err) {
    res.status(500).json({ error: "Erreur récupération actions utilisateur" });
  }
});

// --- GESTION DES TRANSACTIONS ---

// Historique des transactions d'un utilisateur
app.get("/api/user/transactions/:userId", async (req, res) => {
  try {
    const transactions = await Transaction.find({
      $or: [{ buyer: req.params.userId }, { seller: req.params.userId }],
    })
      .populate("buyer seller action")
      .sort({ createdAt: -1 });
    res.json(transactions);
  } catch (err) {
    res.status(500).json({ error: "Erreur récupération transactions" });
  }
});

// --- PAIEMENT CAMPAY ---

app.post("/api/transactions/pay-campay", async (req, res) => {
  const { actionId, buyerId, amount, phoneNumber } = req.body;
  try {
    const response = await axios.post(
      "https://demo.campay.net/api/collect/",
      {
        amount,
        currency: "XAF",
        from: phoneNumber,
        description: `Achat Action ADB`,
        external_reference: `${Date.now()}`,
      },
      { headers: { Authorization: `Token ${process.env.CAMPAY_TOKEN}` } }
    );

    if (response.data && response.data.reference) {
      const action = await Action.findById(actionId);
      const newTransaction = new Transaction({
        action: actionId,
        buyer: buyerId,
        seller: action.owner,
        amount,
        status: "en_attente",
        campayReference: response.data.reference,
      });
      await newTransaction.save();
      res.json({ success: true, message: "USSD envoyé !" });
    }
  } catch (err) {
    res.status(500).json({ error: "Erreur Campay Collect" });
  }
});

// --- ADMIN ---

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
    res.status(500).json({ error: "Erreur stats" });
  }
});

app.get("/api/admin/pending-transactions", async (req, res) => {
  try {
    const trans = await Transaction.find({ status: "en_attente" }).populate(
      "buyer seller action"
    );
    res.json(trans);
  } catch (err) {
    res.status(500).json({ error: "Erreur admin transactions" });
  }
});

// --- INFOS UTILISATEUR & KYC ---

app.get("/api/user/:id", async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select("-password");
    res.json(user);
  } catch (err) {
    res.status(404).json("Utilisateur non trouvé");
  }
});

app.post("/api/user/upload-kyc", upload.single("idCard"), async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.body.userId, {
      documentUrl: req.file.path,
      kycStatus: "en_attente",
    });
    res.send("Document soumis !");
  } catch (err) {
    res.status(500).send("Erreur upload");
  }
});

// --- LANCEMENT DU SERVEUR ---
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Serveur actif sur le port ${PORT}`));
