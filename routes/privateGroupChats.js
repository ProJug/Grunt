// routes/privateGroupChats.js

const fs   = require('fs');
const path = require('path');
const { Router } = require('express');
const WebSocket = require('ws');

module.exports = (dataDir, users, wss) => {
  const router = Router();
  const GROUPS_FILE = path.join(dataDir, 'privateGroups.json');
  const MSGS_DIR    = path.join(dataDir, 'privateGroupMessages');

  // Ensure storage exists
  if (!fs.existsSync(GROUPS_FILE)) {
    fs.writeFileSync(GROUPS_FILE, JSON.stringify([], null, 2), 'utf-8');
  }
  if (!fs.existsSync(MSGS_DIR)) {
    fs.mkdirSync(MSGS_DIR);
  }

  // Load & helpers
  let groups = JSON.parse(fs.readFileSync(GROUPS_FILE, 'utf-8'));
  const saveGroups = () =>
    fs.writeFileSync(GROUPS_FILE, JSON.stringify(groups, null, 2), 'utf-8');

  function loadMsgs(groupId) {
    const file = path.join(MSGS_DIR, `${groupId}.json`);
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, JSON.stringify([], null, 2), 'utf-8');
    }
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  }
  function saveMsgs(groupId, msgs) {
    const file = path.join(MSGS_DIR, `${groupId}.json`);
    fs.writeFileSync(file, JSON.stringify(msgs, null, 2), 'utf-8');
  }

  function genId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  // Create new private group
  router.post('/api/private-groups', (req, res) => {
    const owner = req.cookies.username;
    if (!owner) return res.status(401).json({ error:'unauthenticated' });

    const name = (req.body.name||'').trim();
    if (!name) return res.status(400).json({ error:'invalid group name' });

    const id = genId();
    const group = { id, name, owner, members:[owner], roles:{ [owner]:'owner' } };
    groups.push(group);
    saveGroups();
    res.json(group);
  });

  // List your groups
  router.get('/api/private-groups', (req, res) => {
    const u = req.cookies.username;
    if (!u) return res.status(401).json({ error:'unauthenticated' });
    res.json(groups.filter(g=>g.members.includes(u)));
  });

  // Get one group's info
  router.get('/api/private-groups/:id', (req, res) => {
    const u = req.cookies.username;
    const g = groups.find(x=>x.id===req.params.id);
    if (!g||!g.members.includes(u)) return res.status(404).json({ error:'no access' });
    res.json(g);
  });

  // Invite
  router.post('/api/private-groups/:id/invite',(req,res)=>{
    const inviter = req.cookies.username;
    const g = groups.find(x=>x.id===req.params.id);
    if(!g) return res.status(404).json({ error:'group not found' });
    const role = g.roles[inviter];
    if(!['owner','admin'].includes(role)) return res.status(403).json({ error:'no permission' });
    const invitee = req.body.username;
    if(!users[invitee]) return res.status(400).json({ error:'user does not exist' });
    if(g.members.includes(invitee)) return res.status(400).json({ error:'already a member' });
    g.members.push(invitee);
    g.roles[invitee] = 'member';
    saveGroups();
    res.json({ success:true, group:g });
  });

  // Kick
  router.post('/api/private-groups/:id/kick',(req,res)=>{
    const actor = req.cookies.username;
    const g = groups.find(x=>x.id===req.params.id);
    if(!g) return res.status(404).json({ error:'group not found' });
    const role = g.roles[actor];
    const target = req.body.username;
    if(!['owner','admin'].includes(role)||target===g.owner) return res.status(403).json({ error:'no permission' });
    if(!g.members.includes(target)) return res.status(400).json({ error:'not a member' });
    g.members = g.members.filter(u=>u!==target);
    delete g.roles[target];
    saveGroups();
    res.json({ success:true, group:g });
  });

  // Post message
  router.post('/api/private-groups/:id/messages',(req,res)=>{
    const u = req.cookies.username;
    const g = groups.find(x=>x.id===req.params.id);
    if(!g||!g.members.includes(u)) return res.status(403).json({ error:'no access' });
    const msgs = loadMsgs(g.id);
    const newMsg = { username:u, message:req.body.message, timestamp:Date.now() };
    msgs.push(newMsg);
    saveMsgs(g.id,msgs);
    // broadcast
    wss.clients.forEach(c=>{
      if(c.readyState===WebSocket.OPEN){
        c.send(JSON.stringify({ channel:'private-group', groupId:g.id, payload:newMsg }));
      }
    });
    res.json(newMsg);
  });

  // Get history
  router.get('/api/private-groups/:id/messages',(req,res)=>{
    const u = req.cookies.username;
    const g = groups.find(x=>x.id===req.params.id);
    if(!g||!g.members.includes(u)) return res.status(403).json({ error:'no access' });
    res.json(loadMsgs(g.id));
  });

  return router;
};
