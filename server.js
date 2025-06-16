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

const USERS_FILE = './users.json';
const MESSAGES_FILE = './messages.json';

function getDMFile(userA, userB) {
  const sorted = [userA, userB].sort();
  return `./dm_${sorted[0]}_${sorted[1]}.json`;
}

const upload = multer({ dest: path.join(__dirname, 'public/uploads/') });

app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Load data
let users = fs.existsSync(USERS_FILE) ? JSON.parse(fs.readFileSync(USERS_FILE)) : {};
let messages = fs.existsSync(MESSAGES_FILE) ? JSON.parse(fs.readFileSync(MESSAGES_FILE)) : [];

for (const user in users) {
  users[user].followers ||= [];
  users[user].following ||= [];
}

// === ROUTES ===

app.get('/', (req, res) => {
  const username = req.cookies.username;
  if (!username || !users[username]) return res.redirect('/signin.html');
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

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

app.post('/signup', async (req, res) => {
  const { username, password } = req.body;
  if (users[username]) return res.send('Username already taken.');

  const hash = await bcrypt.hash(password, 10);
  users[username] = {
    password: hash,
    posts: 0,
    followers: [],
    following: [],
    isAdmin: username.toLowerCase() === 'admin'
  };

  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  res.cookie('username', username, { sameSite: 'Lax' }).redirect('/');
});

app.post('/signin', async (req, res) => {
  const { username, password } = req.body;
  const user = users[username];
  if (!user) return res.redirect('/signin.html?error=notfound');
  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.redirect('/signin.html?error=wrongpass');
  res.cookie('username', username, { sameSite: 'Lax' }).redirect('/');
});

app.get('/logout', (req, res) => {
  res.clearCookie('username');
  res.redirect('/signin.html');
});

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

// === Thread Routes ===

app.get('/thread/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/thread.html'));
});

app.get('/api/thread/:id', (req, res) => {
  const file = `./thread_${req.params.id}.json`;
  const replies = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : [];
  res.json(replies);
});

app.post('/api/thread/:id/reply', bodyParser.urlencoded({ extended: true }), (req, res) => {
  const username = req.cookies.username;
  if (!username || !users[username]) return res.status(401).send("Not authorized");

  const message = req.body.message?.trim();
  if (!message) return res.status(400).send("Message required");

  const threadId = req.params.id;
  const file = `./thread_${threadId}.json`;
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

// === DM & Profile ===

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

// === API Endpoints ===
app.get('/api/post/:id', (req, res) => {
  const id = req.params.id;
  const post = messages.find(m => m.id === id);
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

  const files = fs.readdirSync('./').filter(f => f.startsWith('dm_') && f.endsWith('.json'));
  const recentConversations = [];

  files.forEach(file => {
    if (!file.includes(currentUser)) return;
    const history = JSON.parse(fs.readFileSync(file));
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

// === Follow System ===

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

// === WebSocket ===

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

// === Admin Panel ===

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

  const userList = Object.keys(users);
  const dmFiles = fs.readdirSync('./').filter(f => f.startsWith('dm_') && f.endsWith('.json'));

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
  const fullPath = `./${safeFile}`;
  if (!fs.existsSync(fullPath) || !safeFile.startsWith('dm_')) {
    return res.status(404).json({ error: 'DM file not found' });
  }

  const history = JSON.parse(fs.readFileSync(fullPath));
  res.json({ history });
});

app.post('/admin/clear-chat', (req, res) => {
  const username = req.cookies.username;
  if (!username || !users[username] || !users[username].isAdmin) {
    return res.status(403).sendFile(path.join(__dirname, 'public/403.html'));
  }

  messages = [];
  fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2));

  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: 'clear-chat' }));
    }
  });

  res.send("Chat cleared.");
});

// === Catch-All ===

app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public/404.html'));
});

app.use((err, req, res, next) => {
  console.error("🔥 Server Error:", err.stack);
  res.status(500).sendFile(path.join(__dirname, 'public/500.html'));
});



// === Start Server ===

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`🚀 Grunt online at http://localhost:${PORT}`);
});
