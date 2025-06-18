// server.js

const express      = require('express');
const http         = require('http');
const WebSocket    = require('ws');
const path         = require('path');
const multer       = require('multer');
const cookieParser = require('cookie-parser');
const bodyParser   = require('body-parser');

const {
  ensureDir,
  ensureFile,
  loadJSON,
  saveJSON,
  broadcast
} = require('./utils/lib');

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });

// ─── Setup directories ─────────────────────────────────────────────────────────
const DATA_DIR               = path.join(__dirname, 'data');
const UPLOAD_DIR             = path.join(__dirname, 'public/uploads');
const PRIVATE_GROUP_MSGS_DIR = path.join(DATA_DIR, 'privateGroupMessages');

[DATA_DIR, UPLOAD_DIR, PRIVATE_GROUP_MSGS_DIR].forEach(ensureDir);

// ─── Setup JSON data files ─────────────────────────────────────────────────────
const USERS_FILE          = path.join(DATA_DIR, 'users.json');
const MESSAGES_FILE       = path.join(DATA_DIR, 'messages.json');
const IP_BAN_FILE         = path.join(DATA_DIR, 'banned_ips.json');
const GROUP_CHATS_FILE    = path.join(DATA_DIR, 'groupChats.json');
const PRIVATE_GROUPS_FILE = path.join(DATA_DIR, 'privateGroups.json');

ensureFile(USERS_FILE,         {});
ensureFile(MESSAGES_FILE,      []);
ensureFile(IP_BAN_FILE,        []);
ensureFile(GROUP_CHATS_FILE,   []);
ensureFile(PRIVATE_GROUPS_FILE, []);

// ─── Load in-memory state ───────────────────────────────────────────────────────
let users      = loadJSON(USERS_FILE,       {});
let messages   = loadJSON(MESSAGES_FILE,    []);
let bannedArr  = loadJSON(IP_BAN_FILE,      []);
let groupChats = loadJSON(GROUP_CHATS_FILE, []);
const bannedIPs = new Set(bannedArr);

// normalize any missing user fields
for (const username in users) {
  users[username].followers = users[username].followers || [];
  users[username].following = users[username].following || [];
  users[username].banned    = users[username].banned    || false;
}

// ─── File upload setup ─────────────────────────────────────────────────────────
const upload = multer({ dest: UPLOAD_DIR });

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.use(require('./middleware/auth')(users, bannedIPs));

// ─── Auth & Core API Routes ────────────────────────────────────────────────────
app.use('/', require('./routes/auth')(users, USERS_FILE));
app.use(
  '/',
  require('./routes/api')(
    users,
    messages,
    DATA_DIR,
    USERS_FILE,
    MESSAGES_FILE,
    upload,
    wss
  )
);

// ─── Public Group Chats Endpoints ──────────────────────────────────────────────
app.get('/api/group-chats/messages', (req, res) => {
  res.json(groupChats);
});

app.post('/api/group-chats/messages', (req, res) => {
  const username = req.cookies.username;
  if (!username) return res.status(401).json({ error: 'unauthenticated' });

  const { message } = req.body;
  const newMsg = { username, message, timestamp: Date.now() };

  groupChats.push(newMsg);
  saveJSON(GROUP_CHATS_FILE, groupChats);
  broadcast(wss, 'group', newMsg);

  res.json(newMsg);
});

// ─── Private Group Chats Routes ────────────────────────────────────────────────
app.use(
  '/',
  require('./routes/privateGroupChats')(DATA_DIR, users, wss)
);

// ─── Admin Routes ──────────────────────────────────────────────────────────────
app.use(
  '/admin',
  require('./routes/admin')(
    users,
    bannedIPs,
    DATA_DIR,
    USERS_FILE,
    MESSAGES_FILE,
    wss,
    messages
  )
);

// ─── WebSocket logic ────────────────────────────────────────────────────────────
require('./sockets')(wss, users, messages, MESSAGES_FILE, USERS_FILE, DATA_DIR);

// ─── Error handlers ────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public/404.html'));
});
app.use((err, req, res, next) => {
  console.error('🔥 Server Error:', err.stack);
  res.status(500).sendFile(path.join(__dirname, 'public/500.html'));
});

// ─── Start server ───────────────────────────────────────────────────────────────
const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Grunt is live on port ${PORT}`);
});
