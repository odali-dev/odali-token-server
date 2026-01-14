require('dotenv').config();

const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const twilio = require('twilio');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*', // für dev; später enger setzen (z.B. deine Website-Domain)
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());

// --------------------------------------
// Twilio Setup
// --------------------------------------

const {
  TWILIO_ACCOUNT_SID,
  TWILIO_API_KEY_SID,
  TWILIO_API_KEY_SECRET,
  PORT
} = process.env;

if (!TWILIO_ACCOUNT_SID || !TWILIO_API_KEY_SID || !TWILIO_API_KEY_SECRET) {
  console.warn(
    '⚠️  TWILIO_* env vars fehlen – /token Endpoint wird fehlschlagen, bis du sie setzt.'
  );
}

const twilioJwt = twilio.jwt;
const AccessToken = twilioJwt.AccessToken;
const VideoGrant = AccessToken.VideoGrant;

// POST /token  { identity, room }
app.post('/token', (req, res) => {
  const { identity, room } = req.body || {};

  if (!identity || !room) {
    return res.status(400).json({ error: 'identity und room sind nötig' });
  }

  if (!TWILIO_ACCOUNT_SID || !TWILIO_API_KEY_SID || !TWILIO_API_KEY_SECRET) {
    return res.status(500).json({ error: 'Twilio Konfiguration fehlt' });
  }

  const token = new AccessToken(
    TWILIO_ACCOUNT_SID,
    TWILIO_API_KEY_SID,
    TWILIO_API_KEY_SECRET,
    {
      identity
    }
  );

  const videoGrant = new VideoGrant({ room });
  token.addGrant(videoGrant);

  const jwt = token.toJwt();

  res.json({ token: jwt });
});

// --------------------------------------
// In-Memory "Datenbank"
// --------------------------------------
//
// ACHTUNG: das ist nur für Demo/Dev.
// Wenn der Server neu startet, ist alles weg.
// Für "echte" Persistenz bitte später eine DB nehmen (z.B. Postgres, SQLite).

const users = new Map(); // username -> { password, friends:Set<string>, incoming:Set<string>, outgoing:Set<string> }
const onlineUsers = new Map(); // username -> socketId

function ensureUser(username) {
  if (!users.has(username)) {
    users.set(username, {
      password: null,
      friends: new Set(),
      incoming: new Set(),
      outgoing: new Set()
    });
  }
  return users.get(username);
}

// --------------------------------------
// Auth
// --------------------------------------
//
// POST /register { username, password }
// – existiert user bereits: 409
// – sonst: neuer User
//
// POST /login { username, password }
// – existiert user nicht: 404
// – passwort falsch: 401

app.post('/register', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res
      .status(400)
      .json({ error: 'username dhe password jonë të domosdoshëm' });
  }

  const name = username.trim().toLowerCase();

  if (users.has(name)) {
    return res
      .status(409)
      .json({ error: 'ky username veç osht i zënë, zgjidh tjeter' });
  }

  const user = {
    password,
    friends: new Set(),
    incoming: new Set(),
    outgoing: new Set()
  };
  users.set(name, user);

  console.log(`👤 New user registered: ${name}`);

  res.json({ username: name });
});

app.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res
      .status(400)
      .json({ error: 'username dhe password jonë të domosdoshëm' });
  }

  const name = username.trim().toLowerCase();
  const user = users.get(name);

  if (!user) {
    return res
      .status(404)
      .json({ error: 'ky user nuk ekziston – krijo account se pari' });
  }

  if (user.password !== password) {
    return res.status(401).json({ error: 'password gabim' });
  }

  res.json({ username: name });
});

// --------------------------------------
// Friends APIs
// --------------------------------------
//
// GET /friends?username=...
// POST /friends/request  { from, to }
// POST /friends/accept   { from, to }

app.get('/friends', (req, res) => {
  const username = (req.query.username || '').trim().toLowerCase();
  if (!username || !users.has(username)) {
    return res.status(404).json({ error: 'user nicht gefunden' });
  }

  const user = users.get(username);
  res.json({
    friends: Array.from(user.friends),
    incoming: Array.from(user.incoming),
    outgoing: Array.from(user.outgoing)
  });
});

app.post('/friends/request', (req, res) => {
  const { from, to } = req.body || {};
  if (!from || !to) {
    return res.status(400).json({ error: 'from und to sind nötig' });
  }

  const fromName = from.trim().toLowerCase();
  const toName = to.trim().toLowerCase();

  if (fromName === toName) {
    return res.status(400).json({ error: 's\'munesh me shtu vetveten' });
  }

  if (!users.has(fromName) || !users.has(toName)) {
    return res.status(404).json({ error: 'user jo valid' });
  }

  const fromUser = users.get(fromName);
  const toUser = users.get(toName);

  // Schon Freunde?
  if (fromUser.friends.has(toName) || toUser.friends.has(fromName)) {
    return res.json({ ok: true, info: 'veç jeni shokë' });
  }

  // Bereits pending?
  if (fromUser.outgoing.has(toName) || fromUser.incoming.has(toName)) {
    return res.json({ ok: true, info: 'ka veç kërkesë' });
  }

  fromUser.outgoing.add(toName);
  toUser.incoming.add(fromName);

  // Wenn "to" online: Socket Events
  const toSocketId = onlineUsers.get(toName);
  if (toSocketId) {
    io.to(toSocketId).emit('friendRequest', {
      from: fromName
    });
  }

  res.json({ ok: true });
});

app.post('/friends/accept', (req, res) => {
  const { from, to } = req.body || {};
  // from = der, der akzeptiert
  // to   = der, der ursprünglich requested hat

  if (!from || !to) {
    return res.status(400).json({ error: 'from und to sind nötig' });
  }

  const fromName = from.trim().toLowerCase();
  const toName = to.trim().toLowerCase();

  if (!users.has(fromName) || !users.has(toName)) {
    return res.status(404).json({ error: 'user jo valid' });
  }

  const fromUser = users.get(fromName);
  const toUser = users.get(toName);

  if (!fromUser.incoming.has(toName)) {
    return res
      .status(400)
      .json({ error: 'ska kërkesë prej këtij useri' });
  }

  // Pending entfernen
  fromUser.incoming.delete(toName);
  toUser.outgoing.delete(fromName);

  // Freundschaft eintragen (bidirektional)
  fromUser.friends.add(toName);
  toUser.friends.add(fromName);

  // Optional: pending auch bei dem anderen User aufräumen
  fromUser.outgoing.delete(toName);
  toUser.incoming.delete(fromName);

  // Socket Events
  const fromSocketId = onlineUsers.get(fromName);
  const toSocketId = onlineUsers.get(toName);

  if (fromSocketId) {
    io.to(fromSocketId).emit('friendUpdate', { user: fromName });
  }
  if (toSocketId) {
    io.to(toSocketId).emit('friendUpdate', { user: toName });
    io.to(toSocketId).emit('friendAccepted', { from: fromName });
  }

  res.json({ ok: true });
});

// --------------------------------------
// Socket.io – Online Status & Calls
// --------------------------------------

io.on('connection', (socket) => {
  console.log('🔌 socket connected', socket.id);

  let username = null;

  socket.on('register', (data) => {
    username = (data && data.username || '').trim().toLowerCase();
    if (!username) return;

    onlineUsers.set(username, socket.id);
    ensureUser(username);
    console.log(`✅ ${username} online (socket ${socket.id})`);
  });

  // Call Signaling
  // "caller" sendet callUser -> server -> forward an "callee"
  socket.on('callUser', ({ from, to, roomName }) => {
    const fromName = (from || '').trim().toLowerCase();
    const toName = (to || '').trim().toLowerCase();
    const room = (roomName || '').trim();

    if (!fromName || !toName || !room) return;

    const targetSocket = onlineUsers.get(toName);
    if (targetSocket) {
      io.to(targetSocket).emit('incomingCall', {
        from: fromName,
        roomName: room
      });
    }
  });

  // Optional: "answerCall" – falls du Rückmeldung brauchst
  socket.on('answerCall', ({ from, to, roomName, accepted }) => {
    const fromName = (from || '').trim().toLowerCase();
    const toName = (to || '').trim().toLowerCase();
    const room = (roomName || '').trim();

    const targetSocket = onlineUsers.get(toName);
    if (targetSocket) {
      io.to(targetSocket).emit('callAnswered', {
        from: fromName,
        roomName: room,
        accepted: !!accepted
      });
    }
  });

  socket.on('disconnect', () => {
    if (username && onlineUsers.get(username) === socket.id) {
      onlineUsers.delete(username);
      console.log(`🚪 ${username} offline`);
    }
  });
});

// --------------------------------------
// Start Server
// --------------------------------------

const port = PORT || 4000;
server.listen(port, () => {
  console.log(`🚀 odali-token-server läuft auf Port ${port}`);
});
