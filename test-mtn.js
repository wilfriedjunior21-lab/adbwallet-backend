require("dotenv").config();
const axios = require("axios");

const testMTNConfig = async () => {
  const { MTN_SUBSCRIPTION_KEY, MTN_API_USER, MTN_API_KEY, MTN_ENVIRONMENT } =
    process.env;

  console.log("--- Diagnostic MTN MoMo ---");
  console.log("Environnement:", MTN_ENVIRONMENT);

  // Encodage en Base64 de API_USER:API_KEY
  const auth = Buffer.from(`${MTN_API_USER}:${MTN_API_KEY}`).toString("base64");

  try {
    const response = await axios.post(
      `https://sandbox.momodeveloper.mtn.com/collection/token/`,
      {},
      {
        headers: {
          Authorization: `Basic ${auth}`,
          "Ocp-Apim-Subscription-Key": MTN_SUBSCRIPTION_KEY,
        },
      }
    );

    console.log("✅ SUCCÈS : Connexion établie !");
    console.log("Votre Token temporaire est :", response.data.access_token);
    console.log("\nSi vous voyez ceci, vos clés sont parfaites.");
  } catch (err) {
    console.error("❌ ÉCHEC : Impossible de se connecter à MTN.");
    if (err.response) {
      console.error("Code erreur:", err.response.status);
      console.error("Message MTN:", err.response.data);

      if (err.response.status === 401) {
        console.log(
          "\n👉 Analyse : Vos identifiants (User ID ou API Key) sont incorrects."
        );
      } else if (err.response.status === 404) {
        console.log(
          "\n👉 Analyse : L'URL est incorrecte ou le produit 'Collection' n'est pas actif."
        );
      }
    } else {
      console.error("Erreur réseau:", err.message);
    }
  }
};

testMTNConfig();
