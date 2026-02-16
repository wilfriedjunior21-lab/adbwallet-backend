const jwt = require("jsonwebtoken");

module.exports = (req, res, next) => {
  const token = req.header("Authorization");
  if (!token) return res.status(401).send("Accès refusé");

  try {
    const verified = jwt.verify(token, "VOTRE_CLE_SECRETE");
    req.user = verified;
    next();
  } catch (err) {
    res.status(400).send("Token invalide");
  }
};
