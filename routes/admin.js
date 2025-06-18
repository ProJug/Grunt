const express = require('express');
const fs = require('fs');
const path = require('path');

module.exports = (
  users,
  bannedIPs,
  DATA_DIR,
  USERS_FILE,
  MESSAGES_FILE,
  wss,
  messages      // ← Added messages array here
) => {
  const router = express.Router();

  // GET /admin
  router.get('/', (req, res) => {
    const username = req.cookies.username;
    if (!username || !users[username]?.isAdmin) {
      return res.status(403).sendFile(path.join(__dirname, '../public/403.html'));
    }
    res.sendFile(path.join(__dirname, '../admin/admin.html'));
  });

  // GET /admin/data
  router.get('/data', (req, res) => {
    const username = req.cookies.username;
    if (!username || !users[username]?.isAdmin) {
      return res.status(403).sendFile(path.join(__dirname, '../public/403.html'));
    }

    const userList = Object.keys(users).map(u => ({
      username: u,
      isAdmin: users[u].isAdmin,
      banned: users[u].banned || false,
      ip: users[u].ip || 'unknown'
    }));

    const dmFiles = fs.readdirSync(DATA_DIR)
      .filter(f => f.startsWith('dm_') && f.endsWith('.json'));
    const dms = dmFiles.map(f => ({
      file: f,
      label: f.replace('dm_', '').replace('.json', '').replace('_', ' ⇄ ')
    }));

    res.json({ users: userList, dms });
  });

  // GET /admin/dm/:file
  router.get('/dm/:file', (req, res) => {
    const username = req.cookies.username;
    const file = req.params.file;
    if (!username || !users[username]?.isAdmin) {
      return res.status(403).sendFile(path.join(__dirname, '../public/403.html'));
    }

    const safeFile = file.replace(/[^a-zA-Z0-9_.]/g, '');
    const fullPath = path.join(DATA_DIR, safeFile);
    if (!fs.existsSync(fullPath) || !safeFile.startsWith('dm_')) {
      return res.status(404).json({ error: 'DM file not found' });
    }

    const history = JSON.parse(fs.readFileSync(fullPath));
    res.json({ history });
  });

  // POST /admin/clear-chat
  router.post('/clear-chat', (req, res) => {
    const username = req.cookies.username;
    if (!username || !users[username]?.isAdmin) {
      return res.status(403).send("Nope");
    }

    // 1) Clear in-memory messages
    messages.length = 0;

    // 2) Clear persisted file
    fs.writeFileSync(MESSAGES_FILE, JSON.stringify([], null, 2));

    // 3) Broadcast clear-chat to all clients
    wss.clients.forEach(client => {
      if (client.readyState === client.OPEN) {
        client.send(JSON.stringify({ type: 'clear-chat' }));
      }
    });

    // Redirect back to admin dashboard
    res.redirect('/admin');
  });

  // POST /admin/ban/:target
  router.post('/ban/:target', (req, res) => {
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

  // POST /admin/unban/:target
  router.post('/unban/:target', (req, res) => {
    const admin = req.cookies.username;
    const tgt = req.params.target;
    if (!admin || !users[admin]?.isAdmin || !users[tgt]) {
      return res.status(400).json({ error: 'Invalid unban' });
    }

    users[tgt].banned = false;
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
    res.json({ success: true });
  });

  // POST /admin/delete-user/:target
  router.post('/delete-user/:target', (req, res) => {
    const admin = req.cookies.username;
    const tgt = req.params.target;
    if (!admin || !users[admin]?.isAdmin || !users[tgt] || tgt === admin) {
      return res.status(400).json({ error: 'Invalid delete' });
    }

    delete users[tgt];

    // Remove their messages from persisted file
    const allMsgs = JSON.parse(fs.readFileSync(MESSAGES_FILE));
    const filtered = allMsgs.filter(m => m.username !== tgt);
    fs.writeFileSync(MESSAGES_FILE, JSON.stringify(filtered, null, 2));

    // Remove their DMs
    fs.readdirSync(DATA_DIR).forEach(f => {
      if (f.startsWith(`dm_${tgt}_`) || f.endsWith(`_${tgt}.json`)) {
        fs.unlinkSync(path.join(DATA_DIR, f));
      }
    });

    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
    wss.clients.forEach(c => { if (c.user === tgt) c.close(); });

    res.json({ success: true });
  });

  // POST /admin/ipban/:ip
  router.post('/ipban/:ip', (req, res) => {
    const admin = req.cookies.username;
    const ip = req.params.ip;
    if (!users[admin]?.isAdmin) {
      return res.status(403).send('Not authorized');
    }

    bannedIPs.add(ip);
    fs.writeFileSync(path.join(DATA_DIR, 'banned_ips.json'),
      JSON.stringify([...bannedIPs], null, 2));
    wss.clients.forEach(c => {
      if (c._socket.remoteAddress === ip) c.close();
    });

    res.json({ success: true });
  });

  // POST /admin/unipban/:ip
  router.post('/unipban/:ip', (req, res) => {
    const admin = req.cookies.username;
    const ip = req.params.ip;
    if (!users[admin]?.isAdmin) {
      return res.status(403).send('Not authorized');
    }

    bannedIPs.delete(ip);
    fs.writeFileSync(path.join(DATA_DIR, 'banned_ips.json'),
      JSON.stringify([...bannedIPs], null, 2));
    res.json({ success: true });
  });

  return router;
};
