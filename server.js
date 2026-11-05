// PhoneCam signaling server: يوصّل الكاميرا بالمشاهدين، والفيديو نفسه بيروح مباشرة (WebRTC)
const express = require('express');
const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const app = express();
app.use(express.static('public'));
app.get('/health', (req, res) => res.json({ ok: true }));

// إعدادات STUN/TURN — للاتصال من شبكات مختلفة (4G / WiFi) محتاج TURN
app.get('/config', (req, res) => {
  let iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
  if (process.env.ICE_SERVERS) {
    try { iceServers = JSON.parse(process.env.ICE_SERVERS); } catch (e) { console.error('ICE_SERVERS invalid JSON'); }
  }
  res.set('Cache-Control', 'no-store').json({ iceServers });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 });

const rooms = new Map(); // code -> { key, camera, viewers: Map(id->ws), timer }
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_RE = /^[A-HJ-NP-Z2-9]{8}$/;
const MAX_VIEWERS = 10;
const gen = () => Array.from({ length: 8 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');
const send = (ws, o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };

wss.on('connection', (ws) => {
  ws.alive = true;
  ws.on('pong', () => (ws.alive = true));

  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }

    // ---- الكاميرا تسجّل ----
    if (m.type === 'register') {
      let code = m.room, room = rooms.get(code);
      if (!CODE_RE.test(code || '') || (room && room.key !== m.key)) {
        do { code = gen(); } while (rooms.has(code));
        room = null;
      }
      if (!room) { room = { key: String(m.key || '').slice(0, 64), camera: null, viewers: new Map(), timer: null }; rooms.set(code, room); }
      if (room.camera && room.camera !== ws) room.camera.close();
      clearTimeout(room.timer);
      room.camera = ws; ws.role = 'camera'; ws.room = code;
      send(ws, { type: 'registered', room: code });
      // لو في مشاهدين متصلين من قبل، ابعتهم للكاميرا من جديد
      for (const id of room.viewers.keys()) send(ws, { type: 'viewer-joined', id });
      room.viewers.forEach((v) => send(v, { type: 'camera-online' }));
    }

    // ---- مشاهد ينضم ----
    else if (m.type === 'join') {
      const room = rooms.get(String(m.room || '').toUpperCase());
      if (!room) return send(ws, { type: 'error', reason: 'not-found' });
      if (room.viewers.size >= MAX_VIEWERS) return send(ws, { type: 'error', reason: 'full' });
      ws.role = 'viewer'; ws.room = String(m.room).toUpperCase(); ws.id = crypto.randomUUID().slice(0, 8);
      room.viewers.set(ws.id, ws);
      send(ws, { type: 'joined', online: !!room.camera });
      if (room.camera) send(room.camera, { type: 'viewer-joined', id: ws.id });
    }

    // ---- تمرير رسائل WebRTC ----
    else if (['offer', 'answer', 'candidate'].includes(m.type)) {
      const room = rooms.get(ws.room); if (!room) return;
      if (ws.role === 'camera') send(room.viewers.get(m.to), { type: m.type, sdp: m.sdp, candidate: m.candidate });
      else if (ws.role === 'viewer') send(room.camera, { type: m.type, from: ws.id, sdp: m.sdp, candidate: m.candidate });
    }
  });

  ws.on('close', () => {
    const room = rooms.get(ws.room); if (!room) return;
    if (ws.role === 'camera' && room.camera === ws) {
      room.camera = null;
      room.viewers.forEach((v) => send(v, { type: 'camera-offline' }));
      room.timer = setTimeout(() => rooms.delete(ws.room), 60 * 60 * 1000); // امسح الغرفة بعد ساعة بدون كاميرا
    } else if (ws.role === 'viewer') {
      room.viewers.delete(ws.id);
      send(room.camera, { type: 'viewer-left', id: ws.id });
    }
  });
});

// heartbeat عشان نقفل الاتصالات الميتة
setInterval(() => wss.clients.forEach((ws) => { if (!ws.alive) return ws.terminate(); ws.alive = false; ws.ping(); }), 25000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log('PhoneCam running on port ' + PORT));
