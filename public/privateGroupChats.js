// public/privateGroupChats.js

// Open WebSocket connection to your server
const ws = new WebSocket(
  (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host
);

let currentGroup = null;
let userRole = null;

// DOM references
const groupList      = document.getElementById('groupList');
const newGroupName   = document.getElementById('newGroupName');
const createBtn      = document.getElementById('createGroupBtn');
const groupTitle     = document.getElementById('groupTitle');
const chatMembers    = document.getElementById('chatMembers');
const messagesDiv    = document.getElementById('privateMessages');
const chatForm       = document.getElementById('privateChatForm');
const msgInput       = document.getElementById('privateMsgInput');
const inviteSection  = document.getElementById('inviteSection');
const inviteInput    = document.getElementById('inviteUsername');
const inviteBtn      = document.getElementById('inviteBtn');

/**
 * Render a single message bubble into the chat window.
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
 * Load and display the list of private groups you belong to.
 */
function loadGroups() {
  fetch('/api/private-groups')
    .then(res => res.json())
    .then(arr => {
      groupList.innerHTML = '';
      arr.forEach(g => {
        const li = document.createElement('li');
        li.textContent = g.name;
        li.dataset.id = g.id;
        li.addEventListener('click', () => openGroup(g.id));
        groupList.appendChild(li);
      });
    })
    .catch(console.error);
}

/**
 * Create a new private group via API, then refresh the list.
 */
createBtn.addEventListener('click', ev => {
  ev.preventDefault();
  const name = newGroupName.value.trim();
  if (!name) return;
  fetch('/api/private-groups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  })
    .then(res => res.json())
    .then(() => {
      newGroupName.value = '';
      loadGroups();
    })
    .catch(console.error);
});

/**
 * Open a group: load its info, render members (with kick buttons if allowed),
 * show invite form if permitted, then fetch and render its message history.
 */
function openGroup(id) {
  fetch(`/api/private-groups/${id}`)
    .then(res => res.json())
    .then(g => {
      currentGroup = g;
      // Determine your role
      const me = document.cookie.replace(/(?:(?:^|.*;\s*)username\s*\=\s*([^;]*).*$)|^.*$/, '$1');
      userRole = g.roles[me] || 'member';

      // Update header
      groupTitle.textContent = g.name;

      // Render members & kick buttons (owner/admin only)
      chatMembers.innerHTML = g.members.map(u => {
        if ((userRole === 'owner' || userRole === 'admin') && u !== g.owner) {
          return `${u} <button data-user="${u}" class="kick-btn">Kick</button>`;
        }
        return u;
      }).join(', ');

      // Attach kick handlers
      chatMembers.querySelectorAll('.kick-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          fetch(`/api/private-groups/${id}/kick`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: btn.dataset.user })
          })
            .then(() => openGroup(id))
            .catch(console.error);
        });
      });

      // Show or hide the invite box
      inviteSection.style.display = (userRole === 'owner' || userRole === 'admin') ? 'flex' : 'none';

      // Clear and load history
      messagesDiv.innerHTML = '';
      return fetch(`/api/private-groups/${id}/messages`);
    })
    .then(res => res.json())
    .then(arr => arr.forEach(renderMsg))
    .catch(console.error);
}

/**
 * Send a message to the currently open group.
 */
chatForm.addEventListener('submit', ev => {
  ev.preventDefault();
  if (!currentGroup) return;
  const text = msgInput.value.trim();
  if (!text) return;
  fetch(`/api/private-groups/${currentGroup.id}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: text })
  }).catch(console.error);
  msgInput.value = '';
});

/**
 * Invite another user to the current group.
 */
inviteBtn.addEventListener('click', () => {
  if (!currentGroup) return;
  const name = inviteInput.value.trim();
  if (!name) return;
  fetch(`/api/private-groups/${currentGroup.id}/invite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: name })
  })
    .then(() => openGroup(currentGroup.id))
    .catch(console.error);
  inviteInput.value = '';
});

/**
 * Listen for real-time private-group messages over WebSocket.
 */
ws.addEventListener('message', ev => {
  let msg;
  try { msg = JSON.parse(ev.data); } catch { return; }
  if (
    msg.channel === 'private-group' &&
    msg.groupId === (currentGroup && currentGroup.id)
  ) {
    renderMsg(msg.payload);
  }
});

// Kick off by loading your group list
loadGroups();
