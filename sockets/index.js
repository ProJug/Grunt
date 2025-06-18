const fs = require('fs');
const path = require('path');

function getDMFile(userA, userB, dataDir) {
  const sorted = [userA, userB].sort();
  return `${dataDir}/dm_${sorted[0]}_${sorted[1]}.json`;
}

module.exports = (wss, users, messages, MESSAGES_FILE, USERS_FILE, DATA_DIR) => {
  wss.on('connection', (ws, req) => {
    const cookie = req.headers.cookie;
    const username = cookie?.split('; ').find(c => c.startsWith('username='))?.split('=')[1];

    if (!username || !users[username]) return ws.close();
    ws.user = username;

    // Send full history
    ws.send(JSON.stringify({ type: 'history', messages }));

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());

        // PUBLIC CHAT
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
            if (client.readyState === ws.OPEN) client.send(json);
          });

          // Notify @mentions
          Object.keys(users).forEach(user => {
            if (msg.message.includes(`@${user}`)) {
              wss.clients.forEach(client => {
                if (client.readyState === ws.OPEN && client.user === user) {
                  client.send(JSON.stringify({ type: 'notification', subType: 'mention', from: username }));
                }
              });
            }
          });

        }

        // DIRECT MESSAGES
        else if (msg.type === 'dm') {
          const to = msg.to;
          if (!users[to]) return;

          const file = getDMFile(username, to, DATA_DIR);
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
            if (client.readyState === ws.OPEN && (client.user === username || client.user === to)) {
              client.send(json);
            }
            if (client.readyState === ws.OPEN && client.user === to) {
              client.send(JSON.stringify({ type: 'notification', subType: 'dm', from: username }));
            }
          });
        }

        // THREAD REPLIES
        else if (msg.type === 'thread-reply') {
          const threadId = msg.threadId;
          const file = `${DATA_DIR}/thread_${threadId}.json`;
          const replies = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : [];

          const entry = {
            from: username,
            message: msg.message,
            timestamp: Date.now()
          };

          replies.push(entry);
          fs.writeFileSync(file, JSON.stringify(replies, null, 2));

          const json = JSON.stringify({ type: 'thread-reply', threadId, ...entry });

          wss.clients.forEach(client => {
            if (client.readyState === ws.OPEN) client.send(json);
          });
        }

      } catch (e) {
        console.error('Message error:', e);
      }
    });
  });
};
