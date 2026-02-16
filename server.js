const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const axios = require("axios"); // AJOUTÉ : Pour Campay
const multer = require("multer");
const User = require("./models/User");
const Action = require("./models/Action");
const Transaction = require("./models/Transaction");
const sendEmail = require("./utils/mailer");
const bcrypt = require("bcryptjs"); // Pour hacher les mots de passe
const jwt = require("jsonwebtoken"); // Pour la connexion
const app = express();
const upload = multer({ dest: "uploads/" });

app.use(express.json());
app.use(cors());

// Connexion à MongoDB
mongoose
  .connect(
    "mongodb+srv://wilfriedjunior21_adb:wilfried2005@clusteradbwallet.f4jeap2.mongodb.net/?appName=Clusteradbwallet"
  )
  .then(() => console.log("✅ Connecté à MongoDB"))
  .catch((err) => console.error("❌ Erreur de connexion", err));

// --- AUTHENTIFICATION (AJOUTÉ) ---

app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    // Vérifier si l'utilisateur existe déjà
    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ error: "Cet email est déjà utilisé." });
    }

    // Hachage du mot de passe
    const hashedPassword = await bcrypt.hash(password, 10);

    // Création de l'utilisateur
    const newUser = new User({
      name,
      email,
      password: hashedPassword,
      role: role || "acheteur",
    });

    await newUser.save();
    res.status(201).json({ message: "Utilisateur créé avec succès !" });
  } catch (err) {
    console.error("Erreur Register:", err);
    res
      .status(500)
      .json({ error: "Erreur lors de l'inscription sur le serveur." });
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

    // Création du Token de sécurité
    const token = jwt.sign(
      { id: user._id, role: user.role },
      "VOTRE_CLE_SECRETE", // Idéalement à mettre dans .env
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
// --- ROUTES UTILISATEUR & ACTIONS ---

app.get("/api/user/:id", async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select("-password");
    res.json(user);
  } catch (err) {
    res.status(404).json("Utilisateur non trouvé");
  }
});

app.get("/api/actions", async (req, res) => {
  const actions = await Action.find({ status: "en_vente" }).populate(
    "owner",
    "name"
  );
  res.json(actions);
});

app.post("/api/actions/create", async (req, res) => {
  try {
    const nouvelleAction = new Action(req.body);
    await nouvelleAction.save();
    res.status(201).json({ message: "Action mise en vente !" });
  } catch (err) {
    res.status(500).json("Erreur création action");
  }
});

// --- ROUTES PAIEMENT CAMPAY (COLLECTE) ---

app.post("/api/transactions/pay-campay", async (req, res) => {
  const { actionId, buyerId, amount, phoneNumber } = req.body;
  try {
    const campayData = {
      amount: amount,
      currency: "XAF",
      from: phoneNumber,
      description: `Achat Action ADB`,
      external_reference: `${Date.now()}`,
    };

    // Note: Utilise 'demo.campay.net' pour le Sandbox et 'www.campay.net' pour le Live
    const response = await axios.post(
      "https://demo.campay.net/api/collect/",
      campayData,
      {
        headers: { Authorization: `Token ${process.env.CAMPAY_TOKEN}` },
      }
    );

    if (response.data && response.data.reference) {
      const action = await Action.findById(actionId);
      const newTransaction = new Transaction({
        action: actionId,
        buyer: buyerId,
        seller: action.owner,
        amount: amount,
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

// --- ROUTES RETRAIT (WITHDRAW) ---

// C'est cette route qui communique AVEC Campay pour envoyer le cash
app.post("/api/admin/approve-withdrawal/:id", async (req, res) => {
  try {
    const trans = await Transaction.findById(req.params.id);

    // APPEL À CAMPAY
    const response = await axios.post(
      "https://demo.campay.net/api/withdraw/", // URL de retrait
      {
        amount: trans.amount,
        currency: "XAF",
        to: trans.phoneNumber, // Le numéro saisi par le client
        external_reference: trans._id,
      },
      {
        headers: { Authorization: `Token ${process.env.CAMPAY_TOKEN}` },
      }
    );

    // Si Campay confirme l'envoi, on valide en base de données
    if (response.status === 200) {
      const user = await User.findById(trans.buyer);
      user.balance -= trans.amount; // On déduit le solde seulement quand c'est envoyé
      trans.status = "valide";

      await user.save();
      await trans.save();
      res.json({ message: "Argent envoyé avec succès via Campay !" });
    }
  } catch (err) {
    res.status(500).json({ error: "Erreur lors du transfert réel" });
  }
});

// --- ROUTES ADMIN ---

app.get("/api/admin/pending-transactions", async (req, res) => {
  const trans = await Transaction.find({ status: "en_attente" }).populate(
    "buyer seller action"
  );
  res.json(trans);
});

app.post("/api/admin/validate/:id", async (req, res) => {
  try {
    const t = await Transaction.findById(req.params.id).populate(
      "buyer seller action"
    );
    if (!t || t.status !== "en_attente")
      return res.status(400).send("Invalide");

    const buyer = await User.findById(t.buyer._id);
    const seller = await User.findById(t.seller._id);

    // Transfert virtuel
    buyer.balance -= t.amount;
    seller.balance += t.amount;
    t.status = "valide";

    await buyer.save();
    await seller.save();
    await t.save();

    // Emails
    sendEmail(
      buyer.email,
      "Achat validé ✅",
      `Votre achat pour ${t.action.companyName} est OK.`
    );
    sendEmail(
      seller.email,
      "Vente réussie 💰",
      `Vous avez reçu ${t.amount} F.`
    );

    res.send("Validé !");
  } catch (err) {
    res.status(500).send("Erreur validation");
  }
});

// --- KYC ---
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

app.post("/api/admin/verify-user", async (req, res) => {
  const { userId, decision } = req.body;
  const user = await User.findByIdAndUpdate(userId, { kycStatus: decision });
  const subject =
    decision === "valide" ? "Compte Vérifié ✅" : "Document Rejeté ❌";
  sendEmail(user.email, subject, `Votre compte est désormais ${decision}.`);
  res.send("KYC traité");
});
// 1. Statistiques globales pour les cartes du haut
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

// 2. Récupérer les KYC en attente avec les infos nécessaires
app.get("/api/admin/pending-kyc", async (req, res) => {
  const users = await User.find({ kycStatus: "en_attente" }).select(
    "name email documentUrl"
  );
  res.json(users);
});

// 3. Récupérer les transactions avec les relations (Populate)
app.get("/api/admin/pending-transactions", async (req, res) => {
  const trans = await Transaction.find({ status: "en_attente" })
    .populate("buyer", "name")
    .populate("action", "companyName");
  res.json(trans);
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Serveur sur le port ${PORT}`));
