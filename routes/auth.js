const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");

// --- INSCRIPTION ---
app.post("/api/auth/register", async (req, res) => {
  const { name, email, password, role } = req.body;

  // Hachage du mot de passe
  const hashedPassword = await bcrypt.hash(password, 10);

  const newUser = new User({ name, email, password: hashedPassword, role });
  await newUser.save();
  res.json({ message: "Utilisateur créé !" });
});

// --- CONNEXION ---
app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email });

  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ error: "Identifiants incorrects" });
  }

  // Création du Token
  const token = jwt.sign(
    { id: user._id, role: user.role },
    "VOTRE_CLE_SECRETE",
    { expiresIn: "24h" }
  );

  res.json({ token, role: user.role, userId: user._id });
});

app.post("/api/buy-action", async (req, res) => {
  const user = await User.findById(req.body.userId);

  if (user.kycStatus !== "valide") {
    return res.status(403).json({
      error: "Vous devez valider votre KYC pour acheter des actions.",
    });
  }

  // Continuer la transaction...
});
