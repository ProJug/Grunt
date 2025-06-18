const express = require('express');
const bcrypt = require('bcryptjs');
const fs = require('fs');

module.exports = (users, USERS_FILE) => {
  const router = express.Router();

  // POST /signup
  router.post('/signup', async (req, res) => {
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

  // POST /signin (with IP logging)
  router.post('/signin', async (req, res) => {
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

  // POST /change-password
  router.post('/change-password', async (req, res) => {
    const username = req.cookies.username;
    if (!username || !users[username]) return res.redirect('/signin.html');

    const { oldPassword, newPassword } = req.body;
    const user = users[username];

    const match = await bcrypt.compare(oldPassword, user.password);
    if (!match) {
      return res.redirect('/settings.html?error=wrongpass');
    }

    const hash = await bcrypt.hash(newPassword, 10);
    user.password = hash;
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
    res.redirect('/settings.html?saved=1');
  });

  // GET /logout
  router.get('/logout', (req, res) => {
    res.clearCookie('username');
    res.redirect('/signin.html');
  });

  return router;
};
