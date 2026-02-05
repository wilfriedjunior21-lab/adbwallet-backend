const Kyc = require("../models/Kyc");

// Soumission KYC
exports.submitKyc = async (req, res) => {
  const kyc = new Kyc({
    userId: req.user.id,
    ...req.body,
  });
  await kyc.save();
  res.json({ message: "KYC soumis avec succès" });
};

// Voir statut utilisateur
exports.getMyKyc = async (req, res) => {
  const kyc = await Kyc.findOne({ userId: req.user.id });
  res.json(kyc);
};

// Admin : voir tous les KYC
exports.getPendingKycs = async (req, res) => {
  const kycs = await Kyc.find({ status: "PENDING" }).populate("userId");
  res.json(kycs);
};

// Admin : valider ou refuser
exports.updateKycStatus = async (req, res) => {
  await Kyc.findByIdAndUpdate(req.params.id, {
    status: req.body.status,
  });
  res.json({ message: "Statut KYC mis à jour" });
};

exports.submitKyc = async (req, res) => {
  const kyc = new Kyc({
    userId: req.user.id,
    fullName: req.body.fullName,
    country: req.body.country,
    documentType: req.body.documentType,
    documentNumber: req.body.documentNumber,
    documentFront: req.files.documentFront[0].path,
    selfie: req.files.selfie[0].path,
  });

  await kyc.save();
  res.json({ message: "KYC envoyé avec images" });
};
