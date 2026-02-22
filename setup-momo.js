const axios = require("axios");
const { v4: uuidv4 } = require("uuid");

const PRIMARY_KEY = "4bf2ffa53c4e43ef8864b27dbbaefe66"; // À récupérer sur votre profil MoMo Developer
const API_USER_ID = uuidv4(); // Génère un UUID unique

async function setupSandbox() {
  try {
    // ÉTAPE 1 : Créer l'API User
    console.log("--- Étape 1 : Création de l'API User ---");
    await axios.post(
      "https://sandbox.momodeveloper.mtn.com/v1_0/apiuser",
      { providerCallbackHost: "webhook.site" }, // URL fictive pour le test
      {
        headers: {
          "X-Reference-Id": API_USER_ID,
          "Ocp-Apim-Subscription-Key": PRIMARY_KEY,
        },
      }
    );
    console.log(`✅ API User créé avec succès ! ID : ${API_USER_ID}`);

    // ÉTAPE 2 : Générer l'API Key
    console.log("\n--- Étape 2 : Génération de l'API Key ---");
    const response = await axios.post(
      `https://sandbox.momodeveloper.mtn.com/v1_0/apiuser/${API_USER_ID}/apikey`,
      {},
      { headers: { "Ocp-Apim-Subscription-Key": PRIMARY_KEY } }
    );

    const apiKey = response.data.apiKey;
    console.log(`✅ API Key générée : ${apiKey}`);

    console.log("\n--- RÉSUMÉ À GARDER ---");
    console.log(`UserId : ${API_USER_ID}`);
    console.log(`ApiKey : ${apiKey}`);
    console.log("-----------------------");
  } catch (error) {
    console.error("❌ Erreur :", error.response?.data || error.message);
  }
}

setupSandbox();
