/*
 * server/index.js
 *
 * Clean, modular server for BeatSync-style synchronized music system.
 * - Preserves all socket event names and client contracts
 * - Enforces admin-only controls for playback and queue management
 * - Clear separation of room, queue, playback, and sync logic
 */

const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

require('dotenv').config();

const app = express();

// Configuration
const PORT = process.env.PORT || 5000;
const UPLOAD_DIR = path.join(__dirname, 'uploads');

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Middleware
app.use(express.json());
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (origin.includes('localhost')) return callback(null, true);
      if (origin.startsWith('http://192.168.')) return callback(null, true);
      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  })
);

app.use('/uploads', express.static(UPLOAD_DIR));

app.get('/', (_req, res) => {
  res.json({ status: 'ok', message: 'Multi-Phone Synchronized Speaker System backend' });
});

// File upload
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = multer({ storage });

app.post('/upload', upload.single('audio'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const fileUrl = `/uploads/${req.file.filename}`;
  res.json({ fileUrl, filename: req.file.filename });
});

// In-memory room store
const rooms = new Map();

// Utilities: Room lifecycle, playback calculations, and participants
function generateRoomCode() {
  const alphabet = '23456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 4; i++) code += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  if (rooms.has(code)) return generateRoomCode();
  return code;
}

function getRoom(roomCode) {
  if (!roomCode) return null;
  return rooms.get(roomCode) || null;
}

function getRoomPlaybackPositionMs(room) {
  if (!room || !room.playback) return 0;
  const { isPlaying, offsetMs, startedAt } = room.playback;
  if (!isPlaying || !startedAt) return offsetMs;
  return offsetMs + (Date.now() - startedAt);
}

function emitParticipants(io, room) {
  if (!room) return;
  const participants = Array.from(room.members.entries()).map(([id, data]) => ({ id, name: data.name, isAdmin: room.adminId === id }));
  io.to(room.code).emit('room_participants', participants);
}

// NTP / sync helpers (kept behavior to preserve client contract)
function calculateClientOffset(t0, t1, t2, clientReceiveTime) {
  const serverTime = (t1 + t2) / 2;
  const estimatedClientTimeAtServerSend = clientReceiveTime - (clientReceiveTime - t0) / 2;
  const offset = serverTime - estimatedClientTimeAtServerSend;
  return offset;
}

function calculateRTT(t0, clientReceiveTime) {
  return clientReceiveTime - t0;
}

// Socket.io server
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (origin.includes('localhost')) return callback(null, true);
      if (origin.startsWith('http://192.168.')) return callback(null, true);
      return callback(new Error('Not allowed by CORS'));
    },
    methods: ['GET', 'POST'],
  },
});

io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);
  socket.data.roomCode = null;

  // --- Room management -------------------------------------------------
  socket.on('create_room', (callback) => {
    const roomCode = generateRoomCode();
    const room = {
      code: roomCode,
      hostId: socket.id,
      adminId: socket.id,
      members: new Map(),
      joinCount: 0,
      createdAt: Date.now(),
      playback: { isPlaying: false, offsetMs: 0, startedAt: null, scheduledStartTimeMs: null },
      queue: [],
      currentTrackIndex: -1,
      clientOffsets: new Map(),
    };

    rooms.set(roomCode, room);
    room.joinCount += 1;
    const userNumber = String(room.joinCount).padStart(2, '0');
    room.members.set(socket.id, { name: `user_${userNumber}` });

    socket.join(roomCode);
    socket.data.roomCode = roomCode;

    emitParticipants(io, room);

    console.log(`Room created: ${roomCode} by ${socket.id}`);

    if (typeof callback === 'function') {
      callback({ ok: true, roomCode, isHost: true, adminId: socket.id });
    }
  });

  socket.on('join_room', ({ roomCode }, callback) => {
    const room = getRoom(roomCode);
    if (!room) {
      if (typeof callback === 'function') callback({ ok: false, error: 'Room not found' });
      return;
    }

    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    room.joinCount += 1;
    const userNumber = String(room.joinCount).padStart(2, '0');
    room.members.set(socket.id, { name: `user_${userNumber}` });

    if (!room.adminId) room.adminId = socket.id;

    emitParticipants(io, room);

    const playbackPositionMs = getRoomPlaybackPositionMs(room);
    const isAdmin = room.adminId === socket.id;

    console.log(`Socket ${socket.id} joined room ${roomCode}`);

    if (typeof callback === 'function') {
      callback({ ok: true, roomCode, isHost: room.hostId === socket.id, isAdmin, playback: { isPlaying: room.playback.isPlaying, positionMs: playbackPositionMs }, queue: room.queue, currentTrackIndex: room.currentTrackIndex });
    }
  });

  socket.on('leave_room', ({ roomCode }, callback) => {
    const room = getRoom(roomCode || socket.data.roomCode);
    if (!room) {
      if (typeof callback === 'function') callback({ ok: false, error: 'Room not found' });
      return;
    }

    room.members.delete(socket.id);
    socket.leave(room.code);
    socket.data.roomCode = null;

    if (typeof callback === 'function') callback({ ok: true });

    if (room.members.size === 0) {
      rooms.delete(room.code);
      console.log(`Room deleted: ${room.code}`);
    } else {
      emitParticipants(io, room);
    }
  });

  // --- Track upload notification (client emits after successful REST upload)
  socket.on('track_uploaded', ({ roomCode, fileUrl, filename }) => {
    socket.to(roomCode).emit('track_available', { fileUrl, filename });
  });

  // --- Queue management (admin-only) ----------------------------------
  socket.on('queue_add', ({ roomCode, track }, callback) => {
    const room = getRoom(roomCode || socket.data.roomCode);
    if (!room) return typeof callback === 'function' ? callback({ ok: false, error: 'Room not found' }) : null;
    if (room.adminId !== socket.id) return typeof callback === 'function' ? callback({ ok: false, error: 'Only admin can manage queue' }) : null;

    room.queue.push(track);
    io.to(room.code).emit('queue_updated', { queue: room.queue });

    if (typeof callback === 'function') callback({ ok: true, queue: room.queue });
  });

  socket.on('queue_reorder', ({ roomCode, newOrder }, callback) => {
    const room = getRoom(roomCode || socket.data.roomCode);
    if (!room) return typeof callback === 'function' ? callback({ ok: false, error: 'Room not found' }) : null;
    if (room.adminId !== socket.id) return typeof callback === 'function' ? callback({ ok: false, error: 'Only admin can manage queue' }) : null;

    const reorderedQueue = newOrder.map((id) => room.queue.find((t) => t.id === id)).filter(Boolean);
    if (reorderedQueue.length !== room.queue.length) return typeof callback === 'function' ? callback({ ok: false, error: 'Invalid reorder: some tracks missing' }) : null;

    room.queue = reorderedQueue;
    io.to(room.code).emit('queue_updated', { queue: room.queue });
    if (typeof callback === 'function') callback({ ok: true, queue: room.queue });
  });

  // --- Track selection / navigation (admin-only) ----------------------
  socket.on('select_track', ({ roomCode, index }) => {
    const room = getRoom(roomCode || socket.data.roomCode);
    if (!room) return;
    if (room.adminId !== socket.id) return;
    if (index < 0 || index >= room.queue.length) return;

    room.currentTrackIndex = index;
    io.to(room.code).emit('track_selected', { index, track: room.queue[index] });
  });

  socket.on('next_track', ({ roomCode }) => {
    const room = getRoom(roomCode || socket.data.roomCode);
    if (!room) return;
    if (room.adminId !== socket.id) return;
    if (room.currentTrackIndex < room.queue.length - 1) room.currentTrackIndex++;
    io.to(room.code).emit('track_selected', { index: room.currentTrackIndex, track: room.queue[room.currentTrackIndex] });
  });

  socket.on('prev_track', ({ roomCode }) => {
    const room = getRoom(roomCode || socket.data.roomCode);
    if (!room) return;
    if (room.adminId !== socket.id) return;
    if (room.currentTrackIndex > 0) room.currentTrackIndex--;
    io.to(room.code).emit('track_selected', { index: room.currentTrackIndex, track: room.queue[room.currentTrackIndex] });
  });

  // --- Seeking (admin-only) ------------------------------------------
  socket.on('seek_track', ({ roomCode, time }) => {
    const room = getRoom(roomCode || socket.data.roomCode);
    if (!room) return;
    if (room.adminId !== socket.id) return;

    const now = Date.now();
    room.playback.offsetMs = Math.round((time || 0) * 1000);
    room.playback.startedAt = room.playback.isPlaying ? now : null;
    io.to(room.code).emit('track_seeked', { time });
  });

  // --- Playback scheduling and controls (admin-only) -----------------
  socket.on('start_playback', ({ roomCode, delayMs }, callback) => {
    const room = getRoom(roomCode || socket.data.roomCode);
    if (!room) return typeof callback === 'function' ? callback({ ok: false, error: 'Room not found' }) : null;
    if (room.adminId !== socket.id) return typeof callback === 'function' ? callback({ ok: false, error: 'Only admin can control playback' }) : null;

    const now = Date.now();
    const delay = typeof delayMs === 'number' ? delayMs : 3000;
    const scheduledStartTimeMs = now + delay;

    room.playback.isPlaying = true;
    room.playback.offsetMs = 0;
    room.playback.startedAt = scheduledStartTimeMs;
    room.playback.scheduledStartTimeMs = scheduledStartTimeMs;

    const roomTimeMs = room.playback.offsetMs || 0;

    io.to(room.code).emit('playback_scheduled', { roomCode: room.code, scheduledStartTimeMs, startedBy: socket.id, roomTimeMs, serverTime: now });

    if (typeof callback === 'function') callback({ ok: true, scheduledStartTimeMs, roomTimeMs, serverTime: now });
  });

  socket.on('pause_playback', ({ roomCode }, callback) => {
    const room = getRoom(roomCode || socket.data.roomCode);
    if (!room) return typeof callback === 'function' ? callback({ ok: false, error: 'Room not found' }) : null;
    if (room.adminId !== socket.id) return typeof callback === 'function' ? callback({ ok: false, error: 'Only admin can control playback' }) : null;

    const positionMs = getRoomPlaybackPositionMs(room);
    room.playback.isPlaying = false;
    room.playback.startedAt = null;
    room.playback.offsetMs = positionMs;
    room.playback.scheduledStartTimeMs = null;

    const now = Date.now();
    io.to(room.code).emit('playback_paused', { roomCode: room.code, roomTimeMs: positionMs, serverTime: now });

    if (typeof callback === 'function') callback({ ok: true, roomTimeMs: positionMs, serverTime: now });
  });

  // --- Sync endpoints -------------------------------------------------
  socket.on('sync_ping', ({ roomCode, clientTime }, callback) => {
    const room = getRoom(roomCode || socket.data.roomCode);
    const now = Date.now();
    const roomTimeMs = room ? getRoomPlaybackPositionMs(room) : 0;
    if (typeof callback === 'function') callback({ serverTime: now, roomTimeMs, isPlaying: room ? room.playback.isPlaying : false, echo: { clientTime } });
  });

  socket.on('ntp_request', ({ roomCode, t0 }, callback) => {
    const room = getRoom(roomCode || socket.data.roomCode);
    const t1 = Date.now();
    const t2 = Date.now();
    if (typeof callback === 'function') callback({ t0, t1, t2 });
    if (room) console.log(`NTP sync from ${socket.id} in room ${room.code}`);
  });

  socket.on('ntp_response', ({ roomCode, t0, t1, t2, clientReceiveTime }, callback) => {
    const room = getRoom(roomCode || socket.data.roomCode);
    if (!room) {
      if (typeof callback === 'function') callback({ ok: false, error: 'Room not found' });
      return;
    }

    const rtt = calculateRTT(t0, clientReceiveTime);
    const offset = calculateClientOffset(t0, t1, t2, clientReceiveTime);
    room.clientOffsets.set(socket.id, { offset, rtt });

    if (typeof callback === 'function') callback({ ok: true, offset, rtt });
    console.log(`NTP sync completed: ${socket.id} offset=${Math.round(offset)}ms rtt=${Math.round(rtt)}ms`);
  });

  // --- Cleanup on disconnect -----------------------------------------
  socket.on('disconnect', () => {
    const { roomCode } = socket.data;
    if (roomCode && rooms.has(roomCode)) {
      const room = rooms.get(roomCode);
      room.members.delete(socket.id);
      room.clientOffsets.delete(socket.id);
      emitParticipants(io, room);

      console.log(`Socket ${socket.id} left room ${roomCode}`);

      if (room.members.size === 0) {
        rooms.delete(roomCode);
        console.log(`Room deleted (empty): ${roomCode}`);
      } else if (room.adminId === socket.id) {
        const newAdminId = room.members.keys().next().value;
        room.adminId = newAdminId;
        room.hostId = newAdminId;
        io.to(room.code).emit('room_admin_changed', { roomCode: room.code, adminId: newAdminId });
      }
    }
    console.log(`Socket disconnected: ${socket.id}`);
  });
});

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Backend server listening on port ${PORT}`);
});
