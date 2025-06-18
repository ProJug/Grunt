// public/groupChats.js

// Open a WebSocket connection to the server
const ws = new WebSocket(
  (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host
);

// DOM references
const messagesDiv    = document.querySelector('.group-chat .messages');
const form           = document.getElementById('groupChatForm');
const input          = form.querySelector('input[name="message"]');
const otherList      = document.getElementById('otherChatList');

/**
 * Render a single message bubble into the main feed.
 * @param {{username: string, message: string, timestamp: number}} msg
 */
function renderMsg({ username, message, timestamp }) {
  const el = document.createElement('div');
  el.classList.add('message');
  el.innerHTML = `
    <strong>${username}</strong>
    <span style="font-size:0.8em; color:#8899a6; margin-left:8px;">
      ${new Date(timestamp).toLocaleTimeString()}
    </span>
    <div style="margin-top:4px;">${message}</div>
  `;
  messagesDiv.appendChild(el);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

/**
 * Load the public "Group Chats" history from the server and render it.
 */
function loadHistory() {
  fetch('/api/group-chats/messages')
    .then(res => res.json())
    .then(arr => {
      messagesDiv.innerHTML = '';
      arr.forEach(renderMsg);
    })
    .catch(console.error);
}

/**
 * Fetch your private groups and display them under "Other Group Chats".
 */
function loadOtherGroups() {
  fetch('/api/private-groups')
    .then(res => res.json())
    .then(groups => {
      otherList.innerHTML = '';
      groups.forEach(g => {
        const li = document.createElement('li');
        li.classList.add('chat-item', 'private');
        li.textContent = g.name;
        // Clicking jumps to the private-groups UI, carrying the group ID in the hash
        li.addEventListener('click', () => {
          window.location.href = `/privateGroups.html#${g.id}`;
        });
        otherList.appendChild(li);
      });
    })
    .catch(console.error);
}

// Listen for new public-group messages over WebSocket
ws.addEventListener('message', ev => {
  let msg;
  try { msg = JSON.parse(ev.data); }
  catch { return; }
  if (msg.channel === 'group') {
    renderMsg(msg.payload);
  }
});

// Handle posting new public-group messages
form.addEventListener('submit', ev => {
  ev.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  fetch('/api/group-chats/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: text })
  }).catch(console.error);
  input.value = '';
});

// Initial load
loadHistory();
loadOtherGroups();
