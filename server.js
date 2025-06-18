const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const multer = require('multer');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// --- Data directory & files ---
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const USERS_FILE = path.join(DATA_DIR, 'users.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const IP_BAN_FILE = path.join(DATA_DIR, 'banned_ips.json');

if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '{}');
if (!fs.existsSync(MESSAGES_FILE)) fs.writeFileSync(MESSAGES_FILE, '[]');
if (!fs.existsSync(IP_BAN_FILE)) fs.writeFileSync(IP_BAN_FILE, '[]');

// --- In-memory state ---
let users = JSON.parse(fs.readFileSync(USERS_FILE));
let messages = JSON.parse(fs.readFileSync(MESSAGES_FILE));
let bannedIPs = new Set(JSON.parse(fs.readFileSync(IP_BAN_FILE)));

for (const u in users) {
  users[u].followers ||= [];
  users[u].following ||= [];
  users[u].banned ||= false;
}

// --- File upload setup ---
const upload = multer({ dest: path.join(__dirname, 'public/uploads/') });

// --- Middleware ---
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.use(require('./middleware/auth')(users, bannedIPs));

// --- Routes ---
app.use('/', require('./routes/auth')(users, USERS_FILE));
app.use('/', require('./routes/api')(
  users,
  messages,
  DATA_DIR,
  USERS_FILE,
  MESSAGES_FILE,
  upload,
  wss
));
app.use('/admin', require('./routes/admin')(
  users,
  bannedIPs,
  DATA_DIR,
  USERS_FILE,
  MESSAGES_FILE,
  wss,
  messages
));

// --- WebSocket logic ---
require('./sockets')(wss, users, messages, MESSAGES_FILE, USERS_FILE, DATA_DIR);

// --- Error handlers ---
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public/404.html'));
});
app.use((err, req, res, next) => {
  console.error("🔥 Server Error:", err.stack);
  res.status(500).sendFile(path.join(__dirname, 'public/500.html'));
});

// --- Start server ---
const PORT = 3000;
server.listen(PORT, () => {
  console.log(`🚀 Grunt is live at http://localhost:${PORT}`);
});
