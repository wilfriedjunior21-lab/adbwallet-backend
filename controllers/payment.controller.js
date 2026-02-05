exports.deposit = (req, res) => {
  const { amount, method, userId } = req.body;

  // TODO: Connecter MTN / Orange / PayPal API ici
  res.json({
    success: true,
    message: "Paiement initié",
    transactionId: "TXN_" + Date.now(),
  });
};

exports.withdraw = (req, res) => {
  const { amount, phone } = req.body;

  res.json({
    success: true,
    message: "Retrait en cours",
  });
};

exports.history = (req, res) => {
  res.json([
    { amount: 5000, method: "MTN", status: "SUCCESS" },
    { amount: 2000, method: "ORANGE", status: "PENDING" },
  ]);
};
