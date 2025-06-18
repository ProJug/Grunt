const path = require('path');

module.exports = (users, bannedIPs) => {
  return (req, res, next) => {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    const username = req.cookies.username;

    // Block banned IPs
    if (bannedIPs.has(ip)) {
      return res.status(403).sendFile(path.join(__dirname, '../public/banned.html'));
    }

    // Block banned accounts (except admin panel or banned.html)
    if (username && users[username]?.banned && !req.path.startsWith('/admin') && req.path !== '/banned.html') {
      return res.redirect('/banned.html');
    }

    next();
  };
};
