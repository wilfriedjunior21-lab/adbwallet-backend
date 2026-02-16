const mongoose = require("mongoose");
const bcrypt = require("bcrypt"); // Pour crypter le mot de passe
const User = require("./models/User");

mongoose.connect(
  "mongodb+srv://wilfriedjunior21_adb:wilfried2005@clusteradbwallet.f4jeap2.mongodb.net/?appName=Clusteradbwallet"
);

const setupAdmin = async () => {
  try {
    const email = "wilfriedjunior21@gmail.com";
    const password = "wilfried#2005";

    // On crypte le mot de passe comme pour une inscription normale
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const adminData = {
      name: "Wilfried Admin",
      email: email,
      password: hashedPassword,
      role: "admin",
      balance: 0,
      kycStatus: "valide", // L'admin est déjà vérifié
    };

    // "upsert" : met à jour si trouvé, sinon crée
    const user = await User.findOneAndUpdate({ email: email }, adminData, {
      upsert: true,
      new: true,
    });

    console.log("✅ Compte Admin configuré avec succès !");
    console.log("Email:", user.email);
    console.log("Rôle:", user.role);
    process.exit();
  } catch (err) {
    console.error("❌ Erreur:", err);
    process.exit(1);
  }
};

setupAdmin();
