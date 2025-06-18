// server.js

const express       = require('express');
const http          = require('http');
const WebSocket     = require('ws');
const path          = require('path');
const fs            = require('fs');
const cookieParser  = require('cookie-parser');
const bodyParser    = require('body-parser');
const multer        = require('multer');

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });

// ─── Helpers for JSON files ────────────────────────────────────────────────────
function ensureFile(filePath, defaultValue) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2), 'utf-8');
  }
}

function loadJSON(filePath, defaultValue) {
  try {
    let content = fs.readFileSync(filePath, 'utf-8').trim();
    if (!content) {
      fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2), 'utf-8');
      return defaultValue;
    }
    return JSON.parse(content);
  } catch (err) {
    fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2), 'utf-8');
    return defaultValue;
  }
}

// ─── Data directory & files ───────────────────────────────────────────────────
const DATA_DIR                = path.join(__dirname, 'data');
const USERS_FILE              = path.join(DATA_DIR, 'users.json');
const MESSAGES_FILE           = path.join(DATA_DIR, 'messages.json');
const IP_BAN_FILE             = path.join(DATA_DIR, 'banned_ips.json');
const GROUP_CHATS_FILE        = path.join(DATA_DIR, 'groupChats.json');
const PRIVATE_GROUPS_FILE     = path.join(DATA_DIR, 'privateGroups.json');
const PRIVATE_GROUP_MSGS_DIR  = path.join(DATA_DIR, 'privateGroupMessages');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
ensureFile(USERS_FILE,       {});
ensureFile(MESSAGES_FILE,    []);
ensureFile(IP_BAN_FILE,      []);
ensureFile(GROUP_CHATS_FILE, []);
ensureFile(PRIVATE_GROUPS_FILE, []);
if (!fs.existsSync(PRIVATE_GROUP_MSGS_DIR)) fs.mkdirSync(PRIVATE_GROUP_MSGS_DIR);

// ─── In-memory state ───────────────────────────────────────────────────────────
let users      = loadJSON(USERS_FILE,       {});
let messages   = loadJSON(MESSAGES_FILE,    []);
let bannedArr  = loadJSON(IP_BAN_FILE,      []);
let groupChats = loadJSON(GROUP_CHATS_FILE, []);
// privateGroups are managed inside routes/privateGroupChats.js

const bannedIPs = new Set(bannedArr);

// normalize user objects
for (const username in users) {
  users[username].followers = users[username].followers || [];
  users[username].following = users[username].following || [];
  users[username].banned    = users[username].banned    || false;
}

// ─── File upload setup ─────────────────────────────────────────────────────────
const upload = multer({ dest: path.join(__dirname, 'public/uploads/') });

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.use(require('./middleware/auth')(users, bannedIPs));

// ─── Auth & API Routes ─────────────────────────────────────────────────────────
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

// ─── Public Group Chats REST API ───────────────────────────────────────────────
app.get('/api/group-chats/messages', (req, res) => {
  res.json(groupChats);
});

app.post('/api/group-chats/messages', (req, res) => {
  const username = req.cookies.username;
  if (!username) {
    return res.status(401).json({ error: 'unauthenticated' });
  }
  const { message } = req.body;
  const newMsg = { username, message, timestamp: Date.now() };
  groupChats.push(newMsg);
  fs.writeFileSync(GROUP_CHATS_FILE, JSON.stringify(groupChats, null, 2), 'utf-8');

  // broadcast on WS channel "group"
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({
        channel: 'group',
        payload: newMsg
      }));
    }
  });

  res.json(newMsg);
});

// ─── Private Group Chats Routes ────────────────────────────────────────────────
app.use(
  '/',
  require('./routes/privateGroupChats')(DATA_DIR, users, wss)
);

// ─── Admin routes ──────────────────────────────────────────────────────────────
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
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Grunt is live at http://localhost:${PORT}`);
});
