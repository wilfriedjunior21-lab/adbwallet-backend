const nodemailer = require("nodemailer");

// Configuration du transporteur (Exemple avec Gmail)
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "votre-email@gmail.com",
    pass: "votre-mot-de-passe-d-application", // Utilisez un mot de passe d'application, pas votre mot de passe réel
  },
});

const sendEmail = (to, subject, text) => {
  const mailOptions = {
    from: "ADBWALLET <wilfriedjunior21@gmail.com>",
    to,
    subject,
    text,
  };

  return transporter.sendMail(mailOptions);
};

module.exports = sendEmail;
