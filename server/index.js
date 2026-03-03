/*
 * server/index.js
 * Clean backend for multi-phone synchronized speaker system
 */

const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
require("dotenv").config();

const app = express();
const httpServer = http.createServer(app);

const PORT = process.env.PORT || 5000;
const UPLOAD_DIR = path.join(__dirname, "uploads");

// Ensure uploads folder exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

/* -------------------------------------------------------------------------- */
/*                                Middleware                                  */
/* -------------------------------------------------------------------------- */

app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(UPLOAD_DIR));

app.get("/", (_req, res) => {
  res.json({ status: "ok", message: "Backend running" });
});

/* -------------------------------------------------------------------------- */
/*                                File Upload                                 */
/* -------------------------------------------------------------------------- */

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) =>
    cb(null, `${Date.now()}-${file.originalname}`),
});

const upload = multer({ storage });

app.post("/upload", upload.single("audio"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  res.json({
    fileUrl: `/uploads/${req.file.filename}`,
    filename: req.file.filename,
  });
});

/* -------------------------------------------------------------------------- */
/*                              Room State Store                              */
/* -------------------------------------------------------------------------- */

const rooms = new Map();

function generateRoomCode() {
  const chars = "23456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return rooms.has(code) ? generateRoomCode() : code;
}

function getRoom(code) {
  return rooms.get(code) || null;
}

function getPlaybackPositionMs(room) {
  if (!room || !room.playback) return 0;

  const { isPlaying, offsetMs, startedAt } = room.playback;

  if (!isPlaying || !startedAt) return offsetMs;

  return offsetMs + (Date.now() - startedAt);
}

function emitParticipants(io, room) {
  const participants = Array.from(room.members.entries()).map(
    ([id, data]) => ({
      id,
      name: data.name,
      isAdmin: room.adminId === id,
    })
  );

  io.to(room.code).emit("room_participants", participants);
}

/* -------------------------------------------------------------------------- */
/*                               Socket Server                                */
/* -------------------------------------------------------------------------- */

const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);
  socket.data.roomCode = null;

  /* ------------------------------ Create Room ----------------------------- */

  socket.on("create_room", (callback) => {
    const code = generateRoomCode();

    const room = {
      code,
      hostId: socket.id,
      adminId: socket.id,
      members: new Map(),
      joinCount: 1,
      createdAt: Date.now(),
      playback: {
        isPlaying: false,
        offsetMs: 0,
        startedAt: null,
      },
      queue: [],
      currentTrackIndex: -1,
    };

    room.members.set(socket.id, { name: "user_01" });

    rooms.set(code, room);

    socket.join(code);
    socket.data.roomCode = code;

    emitParticipants(io, room);

    if (callback) {
      callback({
        ok: true,
        roomCode: code,
        isHost: true,
        adminId: socket.id,
      });
    }
  });

  /* ------------------------------- Join Room ------------------------------ */

  socket.on("join_room", ({ roomCode }, callback) => {
    const room = getRoom(roomCode);

    if (!room) {
      return callback?.({ ok: false, error: "Room not found" });
    }

    socket.join(roomCode);
    socket.data.roomCode = roomCode;

    room.joinCount += 1;
    const userNumber = String(room.joinCount).padStart(2, "0");
    room.members.set(socket.id, { name: `user_${userNumber}` });

    emitParticipants(io, room);

    callback?.({
      ok: true,
      roomCode,
      isHost: room.hostId === socket.id,
      isAdmin: room.adminId === socket.id,
      playback: {
        isPlaying: room.playback.isPlaying,
        positionMs: getPlaybackPositionMs(room),
      },
      queue: room.queue,
      currentTrackIndex: room.currentTrackIndex,
    });
  });

  /* ------------------------------ Queue Add ------------------------------- */

  socket.on("queue_add", ({ roomCode, track }, callback) => {
    const room = getRoom(roomCode);

    if (!room) {
      return callback?.({ ok: false, error: "Room not found" });
    }

    if (room.adminId !== socket.id) {
      return callback?.({
        ok: false,
        error: "Only admin can manage queue",
      });
    }

    room.queue.push(track);
    io.to(room.code).emit("queue_updated", { queue: room.queue });

    callback?.({ ok: true });
  });

  /* ------------------------------ Select Track ---------------------------- */

  socket.on("select_track", ({ roomCode, index }) => {
    const room = getRoom(roomCode);
    if (!room) return;
    if (room.adminId !== socket.id) return;
    if (index < 0 || index >= room.queue.length) return;

    room.currentTrackIndex = index;

    io.to(room.code).emit("track_selected", {
      index,
      track: room.queue[index],
    });
  });

  /* ------------------------------ Start Playback -------------------------- */

  socket.on("start_playback", ({ roomCode }, callback) => {
    const room = getRoom(roomCode);

    if (!room) {
      return callback?.({ ok: false, error: "Room not found" });
    }

    if (room.adminId !== socket.id) {
      return callback?.({
        ok: false,
        error: "Only admin can control playback",
      });
    }

    const now = Date.now();
    const START_DELAY_MS = 1000; // safe buffer

    const scheduledStartTimeMs = now + START_DELAY_MS;

    room.playback.isPlaying = true;
    room.playback.offsetMs = 0;
    room.playback.startedAt = scheduledStartTimeMs;

    io.to(room.code).emit("playback_scheduled", {
      scheduledStartTimeMs,
      roomTimeMs: 0,
      serverTime: now,
    });

    callback?.({
      ok: true,
      scheduledStartTimeMs,
      roomTimeMs: 0,
      serverTime: now,
    });
  });

  /* ------------------------------ Pause Playback -------------------------- */

  socket.on("pause_playback", ({ roomCode }, callback) => {
    const room = getRoom(roomCode);
    if (!room) return;

    const positionMs = getPlaybackPositionMs(room);

    room.playback.isPlaying = false;
    room.playback.startedAt = null;
    room.playback.offsetMs = positionMs;

    io.to(room.code).emit("playback_paused", {
      roomTimeMs: positionMs,
      serverTime: Date.now(),
    });

    callback?.({ ok: true });
  });

  /* ------------------------------ Disconnect ------------------------------ */

  socket.on("disconnect", () => {
    const { roomCode } = socket.data;
    if (!roomCode) return;

    const room = rooms.get(roomCode);
    if (!room) return;

    room.members.delete(socket.id);
    emitParticipants(io, room);

    if (room.members.size === 0) {
      rooms.delete(roomCode);
    }
  });
});

/* -------------------------------------------------------------------------- */
/*                                Start Server                                */
/* -------------------------------------------------------------------------- */

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Backend listening on port ${PORT}`);
});