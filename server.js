const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const multer = require('multer');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const USERS_FILE = `${DATA_DIR}/users.json`;
const MESSAGES_FILE = `${DATA_DIR}/messages.json`;
const IP_BAN_FILE = `${DATA_DIR}/banned_ips.json`;

if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '{}');
if (!fs.existsSync(MESSAGES_FILE)) fs.writeFileSync(MESSAGES_FILE, '[]');
if (!fs.existsSync(IP_BAN_FILE)) fs.writeFileSync(IP_BAN_FILE, '[]');

let users = JSON.parse(fs.readFileSync(USERS_FILE));
let messages = JSON.parse(fs.readFileSync(MESSAGES_FILE));
let bannedIPs = new Set(JSON.parse(fs.readFileSync(IP_BAN_FILE)));

for (const user in users) {
  users[user].followers ||= [];
  users[user].following ||= [];
  users[user].banned ||= false;
}

function getDMFile(userA, userB) {
  const sorted = [userA, userB].sort();
  return `${DATA_DIR}/dm_${sorted[0]}_${sorted[1]}.json`;
}

const upload = multer({ dest: path.join(__dirname, 'public/uploads/') });

app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// 🔒 Block banned IPs & accounts
app.use((req, res, next) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
  if (bannedIPs.has(ip)) return res.status(403).sendFile(path.join(__dirname, 'public/banned.html'));

  const username = req.cookies.username;
  if (username && users[username]?.banned && !req.path.startsWith('/admin') && req.path !== '/banned.html') {
    return res.redirect('/banned.html');
  }
  next();
});

// Home
app.get('/', (req, res) => {
  const username = req.cookies.username;
  if (!username || !users[username]) return res.redirect('/signin.html');
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// User Data API
app.get('/userdata', (req, res) => {
  const username = req.cookies.username;
  if (!username || !users[username]) return res.status(401).json({ error: "Not authenticated" });

  const user = users[username];
  res.json({
    username,
    displayName: user.displayName || username,
    handle: user.handle || `@${username}`,
    bio: user.bio || "",
    posts: user.posts || 0,
    followers: user.followers.length,
    following: user.following.length,
    isAdmin: !!user.isAdmin
  });
});

// Signup
app.post('/signup', async (req, res) => {
  const { username, password } = req.body;
  if (users[username]) return res.send('Username already taken.');

  const hash = await bcrypt.hash(password, 10);
  users[username] = {
    password: hash,
    posts: 0,
    followers: [],
    following: [],
    isAdmin: username.toLowerCase() === 'admin',
    banned: false,
    ip: ''
  };

  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  res.cookie('username', username, { sameSite: 'Lax' }).redirect('/');
});

// Signin with IP logging
app.post('/signin', async (req, res) => {
  const { username, password } = req.body;
  const user = users[username];
  if (!user) return res.redirect('/signin.html?error=notfound');
  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.redirect('/signin.html?error=wrongpass');

  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  users[username].ip = ip;
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));

  res.cookie('username', username, { sameSite: 'Lax' }).redirect('/');
});

// Logout
app.get('/logout', (req, res) => {
  res.clearCookie('username');
  res.redirect('/signin.html');
});

// Post Upload
app.post('/upload-post', upload.single('image'), (req, res) => {
  const username = req.cookies.username;
  if (!username || !users[username]) return res.status(401).send("Not authorized");

  const id = Math.random().toString(36).substring(2, 10);
  const text = req.body.message?.trim() || '';
  const file = req.file;
  const imgPath = file ? `/uploads/${file.filename}` : null;

  const newMsg = {
    id,
    username,
    message: text,
    image: imgPath,
    timestamp: Date.now()
  };

  messages.push(newMsg);
  users[username].posts = (users[username].posts || 0) + 1;

  fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2));
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));

  const json = JSON.stringify({ type: 'message', ...newMsg });

  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(json);
    }
  });

  res.sendStatus(200);
});

// Save Profile
app.post('/save-profile', (req, res) => {
  const username = req.cookies.username;
  if (!username || !users[username]) return res.status(401).send("Not authorized");

  const { displayName, handle, bio } = req.body;
  users[username].displayName = displayName?.trim() || username;
  users[username].handle = handle?.trim() || `@${username}`;
  users[username].bio = bio?.trim() || "";

  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  res.redirect('/profile.html?saved=1');
});

// Threads
app.get('/thread/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/thread.html'));
});

app.get('/api/thread/:id', (req, res) => {
  const file = `${DATA_DIR}/thread_${req.params.id}.json`;
  const replies = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : [];
  res.json(replies);
});

app.post('/api/thread/:id/reply', bodyParser.urlencoded({ extended: true }), (req, res) => {
  const username = req.cookies.username;
  if (!username || !users[username]) return res.status(401).send("Not authorized");

  const message = req.body.message?.trim();
  if (!message) return res.status(400).send("Message required");

  const threadId = req.params.id;
  const file = `${DATA_DIR}/thread_${threadId}.json`;
  const replies = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : [];

  const entry = { from: username, message, timestamp: Date.now() };
  replies.push(entry);
  fs.writeFileSync(file, JSON.stringify(replies, null, 2));

  const json = JSON.stringify({ type: 'thread-reply', threadId, ...entry });

  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(json);
    }
  });

  res.sendStatus(200);
});

// Profile & DMs
app.get('/profile/:username', (req, res) => {
  const currentUser = req.cookies.username;
  const targetUser = req.params.username;
  if (!currentUser || !users[currentUser]) return res.redirect('/signin.html');
  if (!users[targetUser]) return res.status(404).sendFile(path.join(__dirname, 'public/404.html'));
  res.sendFile(path.join(__dirname, 'public/user.html'));
});

app.get('/dm/:username', (req, res) => {
  const currentUser = req.cookies.username;
  const target = req.params.username;
  if (!currentUser || !users[currentUser]) return res.redirect('/signin.html');
  if (!users[target]) return res.status(404).sendFile(path.join(__dirname, 'public/404.html'));
  res.sendFile(path.join(__dirname, 'public/dm.html'));
});

app.get('/messages.html', (req, res) => {
  const username = req.cookies.username;
  if (!username || !users[username]) return res.redirect('/signin.html');
  res.sendFile(path.join(__dirname, 'public/messages.html'));
});

// APIs
app.get('/api/post/:id', (req, res) => {
  const post = messages.find(m => m.id === req.params.id);
  if (!post) return res.status(404).json({ error: "Not found" });
  res.json(post);
});

app.get('/api/user/:username', (req, res) => {
  const currentUser = req.cookies.username;
  const target = req.params.username;
  if (!currentUser || !users[currentUser] || !users[target]) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const isFollowing = users[currentUser].following.includes(target);
  const user = users[target];
  res.json({
    username: target,
    displayName: user.displayName || target,
    handle: user.handle || `@${target}`,
    bio: user.bio || "",
    posts: user.posts || 0,
    followers: user.followers.length,
    following: user.following.length,
    isFollowing
  });
});

app.get('/api/dm/:target', (req, res) => {
  const currentUser = req.cookies.username;
  const target = req.params.target;
  if (!currentUser || !users[currentUser] || !users[target]) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const file = getDMFile(currentUser, target);
  const history = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : [];
  res.json({ history });
});

app.get('/api/dm-recent', (req, res) => {
  const currentUser = req.cookies.username;
  if (!currentUser || !users[currentUser]) return res.status(401).json([]);

  const files = fs.readdirSync(DATA_DIR).filter(f => f.startsWith('dm_') && f.endsWith('.json'));
  const recentConversations = [];

  files.forEach(file => {
    if (!file.includes(currentUser)) return;
    const history = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file)));
    if (history.length === 0) return;
    const lastMsg = history[history.length - 1];
    const otherUser = lastMsg.from === currentUser ? lastMsg.to : lastMsg.from;

    recentConversations.push({
      username: otherUser,
      timestamp: lastMsg.timestamp,
      preview: lastMsg.message
    });
  });

  recentConversations.sort((a, b) => b.timestamp - a.timestamp);
  res.json(recentConversations);
});

// Follow system
app.post('/follow/:username', (req, res) => {
  const currentUser = req.cookies.username;
  const target = req.params.username;
  if (!currentUser || !users[currentUser] || !users[target] || currentUser === target) {
    return res.status(400).send("Invalid follow attempt");
  }

  if (!users[currentUser].following.includes(target)) {
    users[currentUser].following.push(target);
    users[target].followers.push(currentUser);
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));

    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN && client.user === target) {
        client.send(JSON.stringify({ type: 'notification', subType: 'follow', from: currentUser }));
      }
    });
  }

  res.redirect(`/profile/${target}`);
});

app.post('/unfollow/:username', (req, res) => {
  const currentUser = req.cookies.username;
  const target = req.params.username;
  if (!currentUser || !users[currentUser] || !users[target]) {
    return res.status(400).send("Invalid unfollow attempt");
  }

  users[currentUser].following = users[currentUser].following.filter(u => u !== target);
  users[target].followers = users[target].followers.filter(u => u !== currentUser);
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  res.redirect(`/profile/${target}`);
});

// WebSocket for public chat and DMs
wss.on('connection', (ws, req) => {
  const cookie = req.headers.cookie;
  const username = cookie?.split('; ').find(c => c.startsWith('username='))?.split('=')[1];
  if (!username || !users[username]) return ws.close();

  ws.user = username;
  ws.send(JSON.stringify({ type: 'history', messages }));

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());

      if (!msg.type || msg.type === 'public') {
        const newMsg = {
          id: Math.random().toString(36).substr(2, 9),
          username,
          message: msg.message,
          timestamp: Date.now()
        };

        messages.push(newMsg);
        fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2));
        fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));

        const json = JSON.stringify({ type: 'message', ...newMsg });

        wss.clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) client.send(json);
        });

        Object.keys(users).forEach(user => {
          if (msg.message.includes(`@${user}`)) {
            wss.clients.forEach(client => {
              if (client.readyState === WebSocket.OPEN && client.user === user) {
                client.send(JSON.stringify({ type: 'notification', subType: 'mention', from: username }));
              }
            });
          }
        });

      } else if (msg.type === 'dm') {
        const to = msg.to;
        if (!users[to]) return;

        const file = getDMFile(username, to);
        const history = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : [];

        const dmEntry = {
          from: username,
          to,
          message: msg.message,
          timestamp: Date.now()
        };

        history.push(dmEntry);
        fs.writeFileSync(file, JSON.stringify(history, null, 2));

        const json = JSON.stringify({ type: 'dm', ...dmEntry });

        wss.clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN && (client.user === username || client.user === to)) {
            client.send(json);
          }
          if (client.readyState === WebSocket.OPEN && client.user === to) {
            client.send(JSON.stringify({ type: 'notification', subType: 'dm', from: username }));
          }
        });
      }

    } catch (e) {
      console.error('Message error:', e);
    }
  });
});

// Admin Panel
app.get('/admin', (req, res) => {
  const username = req.cookies.username;
  if (!username || !users[username] || !users[username].isAdmin) {
    return res.status(403).sendFile(path.join(__dirname, 'public/403.html'));
  }
  res.sendFile(path.join(__dirname, 'admin/admin.html'));
});

app.get('/admin/data', (req, res) => {
  const username = req.cookies.username;
  if (!username || !users[username] || !users[username].isAdmin) {
    return res.status(403).sendFile(path.join(__dirname, 'public/403.html'));
  }

  const userList = Object.keys(users).map(u => ({
    username: u,
    isAdmin: users[u].isAdmin,
    banned: users[u].banned || false,
    ip: users[u].ip || 'unknown'
  }));

  const dmFiles = fs.readdirSync(DATA_DIR).filter(f => f.startsWith('dm_') && f.endsWith('.json'));
  const dms = dmFiles.map(f => ({
    file: f,
    label: f.replace('dm_', '').replace('.json', '').replace('_', ' ⇄ ')
  }));

  res.json({ users: userList, dms });
});

app.get('/admin/dm/:file', (req, res) => {
  const username = req.cookies.username;
  const file = req.params.file;
  if (!username || !users[username] || !users[username].isAdmin) {
    return res.status(403).sendFile(path.join(__dirname, 'public/403.html'));
  }

  const safeFile = file.replace(/[^a-zA-Z0-9_.]/g, '');
  const fullPath = path.join(DATA_DIR, safeFile);
  if (!fs.existsSync(fullPath) || !safeFile.startsWith('dm_')) {
    return res.status(404).json({ error: 'DM file not found' });
  }

  const history = JSON.parse(fs.readFileSync(fullPath));
  res.json({ history });
});

// Admin Actions
app.post('/admin/clear-chat', (req, res) => {
  const username = req.cookies.username;
  if (!username || !users[username]?.isAdmin) return res.status(403).send("Nope");

  messages = [];
  fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2));
  wss.clients.forEach(c => c.send(JSON.stringify({ type: 'clear-chat' })));
  res.send("Cleared");
});

app.post('/admin/ban/:target', (req, res) => {
  const admin = req.cookies.username;
  const tgt = req.params.target;
  if (!admin || !users[admin]?.isAdmin || !users[tgt] || tgt === admin) {
    return res.status(400).json({ error: 'Invalid ban' });
  }
  users[tgt].banned = true;
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  wss.clients.forEach(c => { if (c.user === tgt) c.close(); });
  res.json({ success: true });
});

app.post('/admin/unban/:target', (req, res) => {
  const admin = req.cookies.username;
  const tgt = req.params.target;
  if (!admin || !users[admin]?.isAdmin || !users[tgt]) {
    return res.status(400).json({ error: 'Invalid unban' });
  }
  users[tgt].banned = false;
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  res.json({ success: true });
});

app.post('/admin/delete-user/:target', (req, res) => {
  const admin = req.cookies.username;
  const tgt = req.params.target;
  if (!admin || !users[admin]?.isAdmin || !users[tgt] || tgt === admin) {
    return res.status(400).json({ error: 'Invalid delete' });
  }

  delete users[tgt];
  messages = messages.filter(m => m.username !== tgt);
  fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2));

  fs.readdirSync(DATA_DIR).forEach(f => {
    if (f.startsWith(`dm_${tgt}_`) || f.endsWith(`_${tgt}.json`)) {
      fs.unlinkSync(path.join(DATA_DIR, f));
    }
  });

  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  wss.clients.forEach(c => { if (c.user === tgt) c.close(); });

  res.json({ success: true });
});

app.post('/admin/ipban/:ip', (req, res) => {
  const admin = req.cookies.username;
  const ip = req.params.ip;
  if (!users[admin]?.isAdmin) return res.status(403).send('Not authorized');

  bannedIPs.add(ip);
  fs.writeFileSync(IP_BAN_FILE, JSON.stringify([...bannedIPs], null, 2));
  wss.clients.forEach(c => {
    if (c._socket.remoteAddress === ip) c.close();
  });
  res.json({ success: true });
});

app.post('/admin/unipban/:ip', (req, res) => {
  const admin = req.cookies.username;
  const ip = req.params.ip;
  if (!users[admin]?.isAdmin) return res.status(403).send('Not authorized');

  bannedIPs.delete(ip);
  fs.writeFileSync(IP_BAN_FILE, JSON.stringify([...bannedIPs], null, 2));
  res.json({ success: true });
});

// Errors
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public/404.html'));
});

app.use((err, req, res, next) => {
  console.error("🔥 Server Error:", err.stack);
  res.status(500).sendFile(path.join(__dirname, 'public/500.html'));
});

// Start Server
const PORT = 3000;
server.listen(PORT, () => {
  console.log(`🚀 Grunt is live at http://localhost:${PORT}`);
});
