const express = require('express');
const cors = require('cors');

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
      return res.status(400).json({ error: 'identity and room are required' });
    }

    // TODO: Hier später deine echte Token-Logik (z.B. Twilio)
    const jwt = `FAKE_TOKEN_FOR_${identity}_IN_${room}_${Date.now()}`;

    console.log('Token erfolgreich erstellt für', identity, 'in Raum', room);
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
