// models/Message.js
const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema({
  actionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Action",
    required: true,
  },
  senderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  }, // L'acheteur
  receiverId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  }, // L'actionnaire
  content: { type: String, required: true },
  reply: { type: String, default: "" }, // La réponse de l'actionnaire
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Message", messageSchema);
