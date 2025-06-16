fetch('/userdata')
  .then(res => res.json())
  .then(data => {
    if (data.error) {
      alert("Failed to load profile info.");
      location.href = "/signin.html";
      return;
    }

    document.getElementById('profile-letter').textContent = data.username[0].toUpperCase();
    document.getElementById('profile-name').textContent = data.username;
    document.getElementById('profile-handle').textContent = data.handle;
    document.getElementById('stat-posts').textContent = data.posts;
    document.getElementById('stat-following').textContent = data.following;
    document.getElementById('stat-followers').textContent = data.followers;

    if (data.isAdmin) {
      const badge = document.createElement('div');
      badge.textContent = "🛡️ ADMIN MODE ENABLED";
      badge.style.color = "gold";
      badge.style.fontWeight = "bold";
      badge.style.marginTop = "10px";
      document.querySelector('.card')?.appendChild(badge);

      const adminPanelLink = document.getElementById('adminPanelLink');
      if (adminPanelLink) adminPanelLink.style.display = 'block';
    }
  })
  .catch(() => {
    alert("Error loading user data.");
    location.href = "/signin.html";
  });

window.addEventListener('DOMContentLoaded', () => {
  if (!document.cookie.includes('username=')) {
    alert("You must be signed in to use Grunt.");
    location.href = "/signin.html";
    return;
  }

  const socket = new WebSocket(
    (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host
  );

  const messagesDiv = document.querySelector('.messages');
  const form = document.getElementById('postForm');

  socket.addEventListener('open', () => logSystem('🟢 Connected to Grunt server'));
  socket.addEventListener('close', () => logSystem('🔴 Disconnected from server'));
  socket.addEventListener('error', err => {
    logSystem('⚠️ WebSocket error');
    console.error(err);
  });

  socket.addEventListener('message', event => {
    try {
      const data = JSON.parse(event.data);

      if (data.type === 'history') {
        data.messages.forEach(msg => {
          renderMessage(msg.username, msg.message, msg.image, msg.id);
        });
      } else if (data.type === 'message') {
        renderMessage(data.username, data.message, data.image, data.id);
      } else if (data.type === 'notification') {
        showBadge(data.subType);
        console.log('🔔 Notification:', data.subType, 'from', data.from);
      } else if (data.type === 'clear-chat') {
        messagesDiv.innerHTML = '';
        logSystem("⚠️ Chat was cleared by Admin");
      }

    } catch (e) {
      console.error('Bad message format:', e);
    }
  });

  form?.addEventListener('submit', sendMessage);
  document.querySelector('textarea')?.focus();

  function sendMessage(e) {
    e.preventDefault();
    const formData = new FormData(form);
    fetch('/upload-post', {
      method: 'POST',
      body: formData
    }).then(res => {
      if (res.ok) form.reset();
      else alert("Failed to post.");
    });
  }

  function renderMessage(user, text, image = null, id = null) {
    const msg = document.createElement('div');
    msg.className = 'message';

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = user[0].toUpperCase();

    const content = document.createElement('div');
    content.className = 'content';

    const usernameDiv = document.createElement('div');
    usernameDiv.className = 'user';
    usernameDiv.innerHTML = `<a href="/profile/${user}" style="color: #1da1f2; text-decoration: none;">${user}</a>`;

    const textDiv = document.createElement('div');
    textDiv.className = 'text';

    if (id) {
      textDiv.innerHTML = `<a href="/thread/${id}" style="color: #58a6ff; text-decoration: none;">💬 Open Thread</a><br>${text}`;
    } else {
      textDiv.textContent = text;
    }

    content.appendChild(usernameDiv);
    content.appendChild(textDiv);

    if (image) {
      const img = document.createElement('img');
      img.src = image;
      img.style.maxWidth = '100%';
      img.style.marginTop = '8px';
      content.appendChild(img);
    }

    msg.appendChild(avatar);
    msg.appendChild(content);
    messagesDiv.prepend(msg);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }

  function logSystem(text) {
    const log = document.createElement('div');
    log.style.color = '#888';
    log.style.fontSize = '0.9em';
    log.style.textAlign = 'center';
    log.style.margin = '5px 0';
    log.textContent = text;
    messagesDiv.appendChild(log);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }

  function showBadge(type) {
    const badgeTargets = {
      dm: document.querySelector('a[href="/messages.html"]'),
      follow: document.querySelector('a[href="/profile.html"]'),
      mention: document.querySelector('a[href="/"]')
    };

    const target = badgeTargets[type];
    if (target && !target.classList.contains('badge')) {
      target.classList.add('badge');
    }
  }
});
