const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const axios = require("axios");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

// Import des modèles
const User = require("./models/User");
const Action = require("./models/Action");
const Transaction = require("./models/Transaction");

const app = express();
app.use(express.json());
app.use(cors());

// --- CONNEXION MONGODB ---
const mongoURI =
  "mongodb+srv://wilfriedjunior21_adb:wilfried2005@clusteradbwallet.f4jeap2.mongodb.net/?appName=Clusteradbwallet";

mongoose
  .connect(mongoURI)
  .then(() => console.log("✅ MongoDB Connecté avec succès"))
  .catch((err) => console.error("❌ Erreur de connexion Mongo:", err));

// --- AUTHENTIFICATION ---

// Inscription
app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, password, role } = req.body;
    const email = req.body.email.trim().toLowerCase(); // Nettoyage email

    const existingUser = await User.findOne({ email });
    if (existingUser)
      return res.status(400).json({ error: "Cet email est déjà utilisé" });

    const hashed = await bcrypt.hash(password, 10);
    const user = new User({
      name,
      email,
      password: hashed,
      role: role || "acheteur",
      kycStatus: "non_verifie",
      balance: 0,
    });

    await user.save();
    console.log(`👤 Nouvel utilisateur : ${email} (${user.role})`);
    res.status(201).json({ success: true, message: "Utilisateur créé" });
  } catch (err) {
    console.error("Erreur Register:", err);
    res.status(500).json({ error: "Erreur lors de l'inscription" });
  }
});

// Connexion
app.post("/api/auth/login", async (req, res) => {
  try {
    const email = req.body.email.trim().toLowerCase();
    const { password } = req.body;

    console.log(`🔑 Tentative de connexion : ${email}`);

    const user = await User.findOne({ email });
    if (!user) {
      console.log("❌ Utilisateur introuvable");
      return res.status(401).json({ error: "Identifiants incorrects" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      console.log("❌ Mot de passe incorrect");
      return res.status(401).json({ error: "Identifiants incorrects" });
    }

    const token = jwt.sign(
      { id: user._id, role: user.role },
      "CLE_TRANS_SECRET",
      { expiresIn: "24h" }
    );

    console.log("✅ Connexion réussie");
    res.json({
      token,
      userId: user._id,
      role: user.role,
      name: user.name,
    });
  } catch (err) {
    console.error("Erreur Login:", err);
    res.status(500).json({ error: "Erreur serveur lors de la connexion" });
  }
});

// --- TRANSACTIONS (ACHAT & RETRAIT) ---

app.post("/api/transactions/pay-mashapay", async (req, res) => {
  try {
    const { actionId, buyerId, amount, phoneNumber } = req.body;
    const user = await User.findById(buyerId);

    if (user.kycStatus !== "valide") {
      return res
        .status(403)
        .json({ error: "KYC requis pour effectuer un achat." });
    }

    const formattedPhone = phoneNumber.startsWith("237")
      ? phoneNumber
      : `237${phoneNumber}`;

    // Note: Remplace TON_ID et TON_KEY par tes vraies clés MashaPay
    const response = await axios.post(
      "https://api.mashapay.com/v1/payment/request",
      {
        amount,
        phone_number: formattedPhone,
        integration_id: "TON_ID",
        external_id: `ADB_${Date.now()}`,
      },
      { headers: { Authorization: `Bearer TON_KEY` } }
    );

    if (
      response.data.status === "success" ||
      response.data.status === "pending"
    ) {
      const action = await Action.findById(actionId);
      const newTrans = new Transaction({
        action: actionId,
        buyer: buyerId,
        seller: action.owner,
        amount,
        status: "en_attente",
        type: "achat",
        phoneNumber: formattedPhone,
        paymentReference: response.data.reference,
      });
      await newTrans.save();
      res.json({
        success: true,
        message: "Validez la transaction sur votre téléphone",
      });
    }
  } catch (err) {
    console.error("Erreur MashaPay:", err);
    res.status(500).json({ error: "Erreur lors du paiement MashaPay" });
  }
});

app.post("/api/transactions/withdraw", async (req, res) => {
  try {
    const { userId, amount, phoneNumber } = req.body;
    const user = await User.findById(userId);

    if (user.kycStatus !== "valide") {
      return res.status(403).json({ error: "KYC requis pour le retrait." });
    }
    if (user.balance < amount) {
      return res.status(400).json({ error: "Solde insuffisant." });
    }

    const withdrawal = new Transaction({
      buyer: userId,
      amount,
      phoneNumber,
      type: "retrait",
      status: "en_attente",
    });
    await withdrawal.save();
    res.json({ success: true, message: "Demande de retrait enregistrée" });
  } catch (err) {
    res.status(500).json({ error: "Erreur retrait" });
  }
});

// --- ADMINISTRATION (VALIDATION) ---

app.post("/api/admin/validate/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { type, status } = req.body;

    if (type === "kyc") {
      await User.findByIdAndUpdate(id, { kycStatus: status });
    } else {
      const trans = await Transaction.findById(id);
      if (status === "valide" && trans.status !== "valide") {
        if (trans.type === "achat") {
          await User.findByIdAndUpdate(trans.buyer, {
            $inc: { balance: trans.amount },
          });
        } else if (trans.type === "retrait") {
          await User.findByIdAndUpdate(trans.buyer, {
            $inc: { balance: -trans.amount },
          });
        }
      }
      trans.status = status;
      await trans.save();
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Erreur lors de la validation" });
  }
});

// --- RÉCUPÉRATION DE DONNÉES ---

app.get("/api/admin/pending-kyc", async (req, res) => {
  res.json(await User.find({ kycStatus: "en_attente" }));
});

app.get("/api/admin/pending-transactions", async (req, res) => {
  res.json(
    await Transaction.find({ status: "en_attente" })
      .populate("buyer")
      .populate("action")
  );
});

app.get("/api/user/:id", async (req, res) => {
  res.json(await User.findById(req.params.id));
});

app.get("/api/actions", async (req, res) => {
  res.json(await Action.find({ status: "en_vente" }).populate("owner"));
});

app.post("/api/user/submit-kyc", async (req, res) => {
  const { userId, documentUrl } = req.body;
  await User.findByIdAndUpdate(userId, {
    kycStatus: "en_attente",
    documentUrl,
  });
  res.json({ success: true });
});

// --- DÉMARRAGE ---
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Serveur actif sur le port ${PORT}`));
