const express = require("express");
const cors = require("cors");
const { config } = require("dotenv");
const { jwt } = require("twilio");

const { AccessToken } = jwt;
const { VideoGrant } = AccessToken;

// .env-Variablen laden (Render liest die Environment Variables)
config();

const app = express();
app.use(cors());
app.use(express.json());

// Healthcheck – zum Testen im Browser
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// Token-Endpoint
app.post("/video-token", (req, res) => {
  try {
    const { identity, roomName } = req.body;

    if (!identity || !roomName) {
      return res
        .status(400)
        .json({ error: "identity und roomName sind Pflicht" });
    }

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const apiKeySid = process.env.TWILIO_API_KEY_SID;
    const apiKeySecret = process.env.TWILIO_API_KEY_SECRET;

    if (!accountSid || !apiKeySid || !apiKeySecret) {
      console.error("Twilio-Env-Variablen fehlen");
      return res
        .status(500)
        .json({ error: "Server falsch konfiguriert (Twilio-Keys fehlen)" });
    }

    // AccessToken bauen
    const token = new AccessToken(accountSid, apiKeySid, apiKeySecret, {
      identity,
    });

    const videoGrant = new VideoGrant({ room: roomName });
    token.addGrant(videoGrant);

    res.json({ token: token.toJwt() });
  } catch (err) {
    console.error("Fehler beim Token-Bau:", err);
    res.status(500).json({ error: "Interner Serverfehler" });
  }
});

// Render setzt PORT als Env-Variable
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Odali Token Server läuft auf Port ${port}`);
});
