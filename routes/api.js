const express = require('express');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');

function getDMFile(userA, userB, dataDir) {
  const sorted = [userA, userB].sort();
  return `${dataDir}/dm_${sorted[0]}_${sorted[1]}.json`;
}

module.exports = (users, messages, DATA_DIR, USERS_FILE, MESSAGES_FILE, upload, wss) => {
  const router = express.Router();

  router.get('/userdata', (req, res) => {
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

  router.post('/upload-post', upload.single('image'), (req, res) => {
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
      if (client.readyState === client.OPEN) {
        client.send(json);
      }
    });

    res.sendStatus(200);
  });

  router.post('/save-profile', (req, res) => {
    const username = req.cookies.username;
    if (!username || !users[username]) return res.status(401).send("Not authorized");

    const { displayName, handle, bio } = req.body;
    users[username].displayName = displayName?.trim() || username;
    users[username].handle = handle?.trim() || `@${username}`;
    users[username].bio = bio?.trim() || "";

    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
    res.redirect('/profile.html?saved=1');
  });

  router.get('/thread/:id', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/thread.html'));
  });

  router.get('/api/thread/:id', (req, res) => {
    const file = `${DATA_DIR}/thread_${req.params.id}.json`;
    const replies = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : [];
    res.json(replies);
  });

  router.post('/api/thread/:id/reply', bodyParser.urlencoded({ extended: true }), (req, res) => {
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

    // 🔥 Broadcast to all clients watching threads
    const json = JSON.stringify({ type: 'thread-reply', threadId, ...entry });
    wss.clients.forEach(client => {
      if (client.readyState === client.OPEN) {
        client.send(json);
      }
    });

    res.sendStatus(200);
  });

  router.get('/profile/:username', (req, res) => {
    const currentUser = req.cookies.username;
    const targetUser = req.params.username;
    if (!currentUser || !users[currentUser]) return res.redirect('/signin.html');
    if (!users[targetUser]) return res.status(404).sendFile(path.join(__dirname, '../public/404.html'));
    res.sendFile(path.join(__dirname, '../public/user.html'));
  });

  router.get('/api/user/:username', (req, res) => {
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

  router.get('/dm/:username', (req, res) => {
    const currentUser = req.cookies.username;
    const target = req.params.username;
    if (!currentUser || !users[currentUser]) return res.redirect('/signin.html');
    if (!users[target]) return res.status(404).sendFile(path.join(__dirname, '../public/404.html'));
    res.sendFile(path.join(__dirname, '../public/dm.html'));
  });

  router.get('/api/dm/:target', (req, res) => {
    const currentUser = req.cookies.username;
    const target = req.params.target;
    if (!currentUser || !users[currentUser] || !users[target]) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const file = getDMFile(currentUser, target, DATA_DIR);
    const history = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : [];
    res.json({ history });
  });

  router.get('/api/dm-recent', (req, res) => {
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

  router.post('/follow/:username', (req, res) => {
    const currentUser = req.cookies.username;
    const target = req.params.username;
    if (!currentUser || !users[currentUser] || !users[target] || currentUser === target) {
      return res.status(400).send("Invalid follow attempt");
    }

    if (!users[currentUser].following.includes(target)) {
      users[currentUser].following.push(target);
      users[target].followers.push(currentUser);
      fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
    }

    res.redirect(`/profile/${target}`);
  });

  router.post('/unfollow/:username', (req, res) => {
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

  router.get('/messages.html', (req, res) => {
    const username = req.cookies.username;
    if (!username || !users[username]) return res.redirect('/signin.html');
    res.sendFile(path.join(__dirname, '../public/messages.html'));
  });

  router.get('/api/post/:id', (req, res) => {
    const post = messages.find(m => m.id === req.params.id);
    if (!post) return res.status(404).json({ error: "Not found" });
    res.json(post);
  });

  return router;
};
