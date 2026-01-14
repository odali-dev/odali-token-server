const express = require('express');
const cors = require('cors');
const twilio = require('twilio'); // Twilio SDK

const app = express();
app.use(cors());
app.use(express.json());

// Healthcheck / Test
app.get('/', (req, res) => {
  res.send('Token-Server läuft 🚀');
});

// gemeinsame Handler-Funktion für GET & POST /token
function handleTokenRequest(req, res) {
  try {
    // Bei GET kommen die Daten aus query, bei POST aus body
    const identity = req.body.identity || req.query.identity;
    const room = req.body.room || req.query.room;

    console.log('Token-Request:', { identity, room, time: new Date().toISOString() });

    if (!identity || !room) {
      console.log('Fehler: identity oder room fehlt');
      return res.status(400).json({ error: 'identity_and_room_required' });
    }

    // 🔎 Twilio-Env-Variablen prüfen
    const {
      TWILIO_ACCOUNT_SID,
      TWILIO_API_KEY_SID,
      TWILIO_API_KEY_SECRET,
    } = process.env;

    if (!TWILIO_ACCOUNT_SID || !TWILIO_API_KEY_SID || !TWILIO_API_KEY_SECRET) {
      console.error('Fehlende Twilio-Env-Variablen', {
        hasAccountSid: !!TWILIO_ACCOUNT_SID,
        hasApiKeySid: !!TWILIO_API_KEY_SID,
        hasApiKeySecret: !!TWILIO_API_KEY_SECRET,
      });
      return res.status(500).json({ error: 'missing_twilio_env_vars' });
    }

    // ✅ ECHTE Twilio-Token-Logik
    const AccessToken = twilio.jwt.AccessToken;
    const VideoGrant = AccessToken.VideoGrant;

    // Token-Objekt erstellen
    const token = new AccessToken(
      TWILIO_ACCOUNT_SID,
      TWILIO_API_KEY_SID,
      TWILIO_API_KEY_SECRET,
      { identity } // Benutzername
    );

    // Dem Token Zugriff auf diesen Raum geben
    const videoGrant = new VideoGrant({ room });
    token.addGrant(videoGrant);

    // In JWT umwandeln
    const jwt = token.toJwt();

    console.log('Twilio-Token erstellt für', identity, 'in Raum', room);
    return res.json({ token: jwt });

  } catch (err) {
    console.error('Fehler beim Erzeugen des Tokens:', err);
    return res.status(500).json({ error: 'token_error' });
  }
}

// Akzeptiere GET /token (z.B. wenn Frontend fetch ohne body macht)
app.get('/token', handleTokenRequest);

// Akzeptiere POST /token (sauberer für echte Nutzung)
app.post('/token', handleTokenRequest);

// WICHTIG: Render-Port verwenden
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server läuft auf Port ${port}`);
});
