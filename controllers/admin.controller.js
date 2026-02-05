exports.getKycRequests = (req, res) => {
  res.json([{ id: 1, name: "Jean Doe" }]);
};

exports.approveKyc = (req, res) => {
  res.json({ success: true });
};

exports.rejectKyc = (req, res) => {
  res.json({ success: true });
};

exports.getPayments = (req, res) => {
  res.json([{ id: 1, amount: 5000 }]);
};

exports.approvePayment = (req, res) => {
  res.json({ success: true });
};

exports.rejectPayment = (req, res) => {
  res.json({ success: true });
};

exports.getUsers = (req, res) => {
  res.json([{ id: 1, name: "Jean" }]);
};

exports.blockUser = (req, res) => {
  res.json({ success: true });
};
