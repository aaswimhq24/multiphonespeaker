const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const multer = require("multer");
const path = require("path");

require('dotenv').config();

const app = express();


//------ Basic configuration-----------------------------------------------
const PORT = process.env.PORT || 5000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

//----------------------------------------------------------------------

// Enable JSON parsing for future REST endpoints if needed----------------------
app.use(express.json());

// Enable CORS for the Vite dev server (and configurable origin)-------------------------


app.use(cors({
  origin: (origin, callback) => {
    // Allow no-origin requests (like mobile apps, curl)
    if (!origin) return callback(null, true);

    // Allow localhost
    if (origin.includes("localhost")) {
      return callback(null, true);
    }

    // Allow LAN IPs (192.168.x.x)
    if (origin.startsWith("http://192.168.")) {
      return callback(null, true);
    }

    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true
}));

//serve uploaded files statically
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Simple health endpoint
app.get('/', (_req, res) => {
  res.json({ status: 'ok', message: 'Multi-Phone Synchronized Speaker System backend' });
});

// Create HTTP server and attach Socket.io
const httpServer = http.createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);

      if (origin.includes("localhost")) {
        return callback(null, true);
      }

      if (origin.startsWith("http://192.168.")) {
        return callback(null, true);
      }

      return callback(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST"],
  },
});
const fs = require("fs");

const uploadDir = path.join(__dirname, "uploads");

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// ;Configure multer for file uploads; files will be stored in "uploads/" directory ;middleware for handling multipart/form-data, which is primarily used for uploading files. In this case, it's configured to store uploaded audio files in a local "uploads/" directory with unique filenames to avoid collisions.
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/");
  },
  filename: function (req, file, cb) {
    const uniqueName = Date.now() + "-" + file.originalname;
    cb(null, uniqueName);
  }
});

const upload = multer({ storage });
// Endpoint for uploading audio files; expects a form-data field named "audio"
app.post("/upload", upload.single("audio"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  const fileUrl = `/uploads/${req.file.filename}`;

  res.json({
    fileUrl,
    filename: req.file.filename
  });
});
/**
 * In-memory room store.
 *
 * rooms: Map<roomCode, {
 *   code: string;
 *   hostId: string;
 *   adminId: string;           // First user becomes admin; controls playback/queue
 *   members: Set<string>;
 *   createdAt: number;
 *   playback: {
 *     isPlaying: boolean;
 *     offsetMs: number;        // Accumulated playback offset when paused
 *     startedAt: number|null;  // Server Date.now() when playback was last started
 *     scheduledStartTimeMs: number|null;  // Future timestamp when playback should start
 *   };
 *   queue: Array<{id, filename, durationMs}>; // Simple queue of audio tracks
 *   clientOffsets: Map<socketId, {offset: number, rtt: number}>; // NTP clock sync
 * }>
 */



const rooms = new Map();

// --- Utility functions ------------------------------------------------------

// Generate a short human-friendly room code, e.g. "A7F3"
function generateRoomCode() {
  const alphabet = '23456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 4; i += 1) {
    code += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  // Ensure uniqueness within the current process
  if (rooms.has(code)) {
    return generateRoomCode();
  }
  return code;
}

// Compute the current room playback position based on server time
function getRoomPlaybackPositionMs(room) {
  if (!room.playback) return 0;
  const { isPlaying, offsetMs, startedAt } = room.playback;

  if (!isPlaying || !startedAt) {
    return offsetMs;
  }

  const now = Date.now();
  return offsetMs + (now - startedAt);
}

// Safely retrieve room object
function getRoom(roomCode) {
  if (!roomCode) return null;
  return rooms.get(roomCode) || null;
}

// --- NTP (Network Time Protocol) -style clock synchronization utilities -------
// These functions help synchronize client clocks with the server clock.
//
// How NTP-style sync works:
//   1. Client sends t0 (its send time) to server
//   2. Server receives at t1, responds at t2
//   3. Client receives at t3 (local time when response arrives)
//   4. RTT = t3 - t0 (total round-trip time)
//   5. Server's clock offset = (t1 + t2)/2 - t3 + RTT/2
//   6. This offset is stored per client to convert server timestamps to client time

// NTP request/response objects use timestamps:
// { t0, t1, t2 } where:
//   t0 = milliseconds since client started (client's time)
//   t1 = server's Date.now() when it received the request
//   t2 = server's Date.now() when it sent the response

function calculateClientOffset(t0, t1, t2, clientReceiveTime) {
  // Estimate server's actual time at midpoint of processing
  const serverTime = (t1 + t2) / 2;
  // Estimate client's local time when server was sending
  const estimatedClientTimeAtServerSend = clientReceiveTime - (clientReceiveTime - t0) / 2;
  // Client's clock offset relative to server
  const offset = serverTime - estimatedClientTimeAtServerSend;
  return offset;
}

function calculateRTT(t0, clientReceiveTime) {
  return clientReceiveTime - t0;
}
// Broadcast updated participant list to all clients in the room
function emitParticipants(room) {
  const participants = Array.from(room.members.entries()).map(
    ([id, data]) => ({
      id,
      name: data.name,
      isAdmin: room.adminId === id
    })
  );

  io.to(room.code).emit("room_participants", participants);
}
// --- Socket.io handlers -----------------------------------------------------

io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  // Keep track of which room this socket is currently in
  socket.data.roomCode = null;

  /**
   * Create a new room and join it.
   *
   * Client usage:
   *   socket.emit('create_room', (response) => { ... });
   */
  socket.on('create_room', (callback) => {
    const roomCode = generateRoomCode();

    const room = {
      code: roomCode,
      hostId: socket.id,
      adminId: socket.id,  // First user becomes admin
      members: new Map(),
      joinCount: 0,
      createdAt: Date.now(),
      playback: {
        isPlaying: false,
        offsetMs: 0,
        startedAt: null,
        scheduledStartTimeMs: null,  // For future scheduled playback
      },
      queue: [],  // Simple array of {id, filename, durationMs}
      currentTrackIndex: -1,  // Index of currently playing track in the queue
      clientOffsets: new Map(),  // Map<socketId, {offset, rtt}>
    };

    rooms.set(roomCode, room);

    room.joinCount += 1;
    const userNumber = String(room.joinCount).padStart(2, "0");
    room.members.set(socket.id, { name: `user_${userNumber}` });

    socket.join(roomCode);
    socket.data.roomCode = roomCode;

    emitParticipants(room);

    console.log(`Room created: ${roomCode} by ${socket.id}`);

    if (typeof callback === 'function') {
      callback({
        ok: true,
        roomCode,
        isHost: true,
        adminId: socket.id,
      });
    }
  });

  /**
   * Join an existing room by code.
   *
   * Payload: { roomCode: string }
   * Ack: { ok:boolean, error?:string, roomCode?:string, isAdmin?:boolean,
   *        playback?:{ ... }, queue?:Array, currentTrackIndex?:number }
   */
  socket.on('join_room', ({ roomCode }, callback) => {
    const room = getRoom(roomCode);

    if (!room) {
      if (typeof callback === 'function') {
        callback({ ok: false, error: 'Room not found' });
      }
      return;
    }

    const username = `User-${socket.id.slice(0, 4)}`;
    
    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    room.joinCount += 1;
    const userNumber = String(room.joinCount).padStart(2, "0");
    room.members.set(socket.id, { name: `user_${userNumber}` });

    emitParticipants(room);

    // If room has no admin yet (shouldn't normally happen), set this client as admin
    if (!room.adminId) {
      room.adminId = socket.id;
    }

    console.log(`Socket ${socket.id} joined room ${roomCode}`);

    const playbackPositionMs = getRoomPlaybackPositionMs(room);
    const isAdmin = room.adminId === socket.id;

    if (typeof callback === 'function') {
      callback({
        ok: true,
        roomCode,
        isHost: room.hostId === socket.id,
        isAdmin,
        playback: {
          isPlaying: room.playback.isPlaying,
          positionMs: playbackPositionMs,
        },
        queue: room.queue,
        currentTrackIndex: room.currentTrackIndex,
      });
    }
 

  // ----------------------------------------------------------------------
  /**
   * Notify room members that a new track is available after upload.
   *
   * Payload: { roomCode: string, fileUrl: string, filename: string }
   * Ack: none (fire-and-forget)
   *
   * This is emitted by the client after successfully uploading a track to the server.
     The server then broadcasts a "track_available" event to all other clients in the room with the file URL and metadata, so they can add it to their queue or make it available for playback.
   */
  socket.on("track_uploaded", ({ roomCode, fileUrl, filename }) => {
    socket.to(roomCode).emit("track_available", {
      fileUrl,
      filename,
    });
  });
  // ----------------------------------------------------------------------
  /**
   * Admin selects a track from the queue to play.
   *
   * Payload: { roomCode: string, index: number }
   * Ack: none (fire-and-forget)
   *
   * This is emitted by the admin client when they select a track from the queue.
     The server updates the currentTrackIndex for the room and broadcasts a "track_selected" event to all clients with the selected track's index and metadata, so they can prepare for playback.
   */
  socket.on("select_track", ({ roomCode, index }) => {
    const room = getRoom(roomCode);
    if (!room) return;

    // Only admin can select
    if (room.adminId !== socket.id) return;

    if (index < 0 || index >= room.queue.length) return;

    room.currentTrackIndex = index;

    io.to(roomCode).emit("track_selected", {
      index,
      track: room.queue[index]
    });
  });

  // Admin moves to the next track in the queue

  socket.on("next_track", ({ roomCode }) => {
    const room = getRoom(roomCode);
    if (!room) return;
    if (room.adminId !== socket.id) return;

    if (room.currentTrackIndex < room.queue.length - 1) {
      room.currentTrackIndex++;
    }

    io.to(roomCode).emit("track_selected", {
      index: room.currentTrackIndex,
      track: room.queue[room.currentTrackIndex]
    });
  });
  // Admin moves to the previous track in the queue
  socket.on("prev_track", ({ roomCode }) => {
    const room = getRoom(roomCode);
    if (!room) return;
    if (room.adminId !== socket.id) return;

    if (room.currentTrackIndex > 0) {
      room.currentTrackIndex--;
    }

    io.to(roomCode).emit("track_selected", {
      index: room.currentTrackIndex,
      track: room.queue[room.currentTrackIndex]
    });
  });

    socket.on("seek_track", ({ roomCode, time }) => {
      const room = getRoom(roomCode);
      if (!room) return;

      if (room.adminId !== socket.id) return;

      const now = Date.now();

      // Update server playback state
      room.playback.offsetMs = time * 1000;
      room.playback.startedAt = room.playback.isPlaying ? now : null;

      io.to(roomCode).emit("track_seeked", { time });
    });



  //----------------------------------------------------------------------
  /**
   * Leave the current room.
   * tempoprarily added for testing; 
   * Payload: { roomCode: string }
   * Ack: { ok:boolean, error?:string }
   */
    socket.on('leave_room', ({ roomCode }, callback) => {
      const room = getRoom(roomCode);

      if (!room) {
        if (typeof callback === 'function') {
          callback({ ok: false, error: 'Room not found' });
        }
        return;
      }

      // Remove socket from room members
      room.members.delete(socket.id);
      socket.leave(roomCode);
      socket.data.roomCode = null;

      if (typeof callback === 'function') {
        callback({ ok: true });
      }

      // If no members left in the room, remove it
      if (room.members.size === 0) {
        rooms.delete(roomCode);
        console.log(`Room deleted: ${roomCode}`);
      } else {
        emitParticipants(room);
      }
    });
  /**
   * Start (or resume) playback for a room.
   * ADMIN ONLY: Only the room admin can control playback.
   *
   * Payload: { roomCode: string, delayMs?: number (default 2000) }
   * This schedules playback to start at: Date.now() + delayMs (future timestamp)
   * Ack: { ok:boolean, scheduledStartTimeMs:number, roomTimeMs:number, serverTime:number }
   *
   * The future timestamp allows clients to:
   *   1. Convert server timestamp to local time using their clock offset
   *   2. Schedule audio to start at that local time using Web Audio API
   *   3. All clients start at nearly the same time (within RTT/2 jitter)
   */
  socket.on('start_playback', ({ roomCode, delayMs }, callback) => {
    const room = getRoom(roomCode || socket.data.roomCode);

    if (!room) {
      if (typeof callback === 'function') {
        callback({ ok: false, error: 'Room not found' });
      }
      return;
    }

    // Admin-only: check if requester is admin
    if (room.adminId !== socket.id) {
      if (typeof callback === 'function') {
        callback({ ok: false, error: 'Only admin can control playback' });
      }
      return;
    }

    const now = Date.now();
    const delay = delayMs || 3000;  // Default 3-second delay to allow clients to prepare
    const scheduledStartTimeMs = now + delay;

    room.playback.isPlaying = true;
    room.playback.offsetMs = 0;
    room.playback.startedAt = scheduledStartTimeMs;
    room.playback.scheduledStartTimeMs = scheduledStartTimeMs;


    // For scheduled playback, initial room time should be 0
    const roomTimeMs = room.playback.offsetMs || 0;

    // Broadcast to all clients with the scheduled start time
    io.to(room.code).emit('playback_scheduled', {
      roomCode: room.code,
      scheduledStartTimeMs,
      startedBy: socket.id,
      roomTimeMs,
      serverTime: now,
    });

    if (typeof callback === 'function') {
      callback({
        ok: true,
        scheduledStartTimeMs,
        roomTimeMs,
        serverTime: now,
      });
    }
  });

  /**
   * Pause playback for the room.
   * ADMIN ONLY: Only the room admin can control playback.
   *
   * Payload: { roomCode: string }
   * Stores the exact playback position and broadcasts pause event with scheduled timestamp
   */
  socket.on('pause_playback', ({ roomCode }, callback) => {
    const room = getRoom(roomCode || socket.data.roomCode);

    if (!room) {
      if (typeof callback === 'function') {
        callback({ ok: false, error: 'Room not found' });
      }
      return;
    }

    // Admin-only: check if requester is admin
    if (room.adminId !== socket.id) {
      if (typeof callback === 'function') {
        callback({ ok: false, error: 'Only admin can control playback' });
      }
      return;
    }

    // Capture current position into offset and stop time-based progress
    const positionMs = getRoomPlaybackPositionMs(room);
    room.playback.isPlaying = false;
    room.playback.startedAt = null;
    room.playback.offsetMs = positionMs;
    room.playback.scheduledStartTimeMs = null;

    const now = Date.now();

    io.to(room.code).emit('playback_paused', {
      roomCode: room.code,
      roomTimeMs: positionMs,
      serverTime: now,
    });

    if (typeof callback === 'function') {
      callback({
        ok: true,
        roomTimeMs: positionMs,
        serverTime: now,
      });
    }
  });


  /**
   * Latency and timeline synchronization.
   *
   * Client sends its local timestamp; server responds with current server time
   * and the current room playback time. Client can compute:
   *   RTT ≈ clientNow - clientSentTime
   *   oneWayDelay ≈ RTT / 2
   *   targetPlaybackTime ≈ roomTimeMs + oneWayDelay
   *
   * Payload: { roomCode: string, clientTime: number }
   * Ack: { serverTime:number, roomTimeMs:number, isPlaying:boolean }
   */
  socket.on('sync_ping', ({ roomCode, clientTime }, callback) => {
    const room = getRoom(roomCode || socket.data.roomCode);
    const now = Date.now();
    const roomTimeMs = room ? getRoomPlaybackPositionMs(room) : 0;

    if (typeof callback === 'function') {
      callback({
        serverTime: now,
        roomTimeMs,
        isPlaying: room ? room.playback.isPlaying : false,
        echo: {
          clientTime,
        },
      });
    }
  });

  /**
   * NTP-style clock synchronization request.
   *
   * Client initiates clock sync by sending t0 (its current time).
   * Server responds with t1 (receive time) and t2 (send time).
   *
   * Math:
   *   RTT = clientReceiveTime - t0
   *   serverTime = (t1 + t2) / 2  (midpoint estimate of server's clock)
   *   clientOffset = serverTime - (clientReceiveTime - RTT/2)
   *
   * This offset is stored and used to convert future server timestamps to client time:
   *   clientLocalTime = serverTimestamp + clientOffset
   *
   * Payload: { roomCode: string, t0: number }
   * Ack: { t0: number, t1: number, t2: number }
   */
  socket.on('ntp_request', ({ roomCode, t0 }, callback) => {
    const room = getRoom(roomCode || socket.data.roomCode);
    const t1 = Date.now();
    const t2 = Date.now();

    if (typeof callback === 'function') {
      callback({
        t0,
        t1,
        t2,
      });
    }

    // Log for debugging; in production may want to throttle this
    if (room) {
      console.log(`NTP sync from ${socket.id} in room ${room.code}`);
    }
  });

  /**
   * NTP clock sync completion.
   *
   * Client sends back the NTP response along with when it received the response.
   * Server calculates and stores the client's clock offset.
   *
   * Payload: { roomCode: string, t0: number, t1: number, t2: number, clientReceiveTime: number }
   * Ack: { ok: boolean, offset: number, rtt: number }
   */
  socket.on('ntp_response', ({ roomCode, t0, t1, t2, clientReceiveTime }, callback) => {
    const room = getRoom(roomCode || socket.data.roomCode);

    if (!room) {
      if (typeof callback === 'function') {
        callback({ ok: false, error: 'Room not found' });
      }
      return;
    }

    const rtt = calculateRTT(t0, clientReceiveTime);
    const offset = calculateClientOffset(t0, t1, t2, clientReceiveTime);

    // Store client's clock offset and RTT in room for future timestamp conversions
    room.clientOffsets.set(socket.id, { offset, rtt });

    if (typeof callback === 'function') {
      callback({
        ok: true,
        offset,
        rtt,
      });
    }

    console.log(`NTP sync completed: ${socket.id} offset=${Math.round(offset)}ms rtt=${Math.round(rtt)}ms`);
  });

  /**
   * Queue management: add a track to the room queue.
   * ADMIN ONLY.
   *
   * Payload: { roomCode: string, track: {id, filename, durationMs} }
   * Ack: { ok: boolean, queue: Array }
   */
  socket.on('queue_add', ({ roomCode, track }, callback) => {
    const room = getRoom(roomCode || socket.data.roomCode);

    if (!room) {
      if (typeof callback === 'function') {
        callback({ ok: false, error: 'Room not found' });
      }
      return;
    }

    // Admin-only
    if (room.adminId !== socket.id) {
      if (typeof callback === 'function') {
        callback({ ok: false, error: 'Only admin can manage queue' });
      }
      return;
    }

    room.queue.push(track);

    // Broadcast updated queue to all clients
    io.to(room.code).emit('queue_updated', {
      queue: room.queue,
    });

    if (typeof callback === 'function') {
      callback({
        ok: true,
        queue: room.queue,
      });
    }
  });

  /**
   * Queue management: reorder tracks in the queue.
   * ADMIN ONLY.
   *
   * Payload: { roomCode: string, newOrder: Array<trackId> }
   * Reorders queue to match the newOrder array
   */
  socket.on('queue_reorder', ({ roomCode, newOrder }, callback) => {
    const room = getRoom(roomCode || socket.data.roomCode);

    if (!room) {
      if (typeof callback === 'function') {
        callback({ ok: false, error: 'Room not found' });
      }
      return;
    }

    // Admin-only
    if (room.adminId !== socket.id) {
      if (typeof callback === 'function') {
        callback({ ok: false, error: 'Only admin can manage queue' });
      }
      return;
    }

    // Reorder queue based on track IDs in newOrder
    const reorderedQueue = newOrder
      .map(id => room.queue.find(track => track.id === id))
      .filter(track => track !== undefined);

    if (reorderedQueue.length !== room.queue.length) {
      if (typeof callback === 'function') {
        callback({ ok: false, error: 'Invalid reorder: some tracks missing' });
      }
      return;
    }

    room.queue = reorderedQueue;

    // Broadcast updated queue to all clients
    io.to(room.code).emit('queue_updated', {
      queue: room.queue,
    });

    if (typeof callback === 'function') {
      callback({
        ok: true,
        queue: room.queue,
      });
    }
  });

  /**
   * Handle client disconnection and cleanup.
   */
  socket.on('disconnect', () => {
    const { roomCode } = socket.data;

    if (roomCode && rooms.has(roomCode)) {
      const room = rooms.get(roomCode);
      room.members.delete(socket.id);
      room.clientOffsets.delete(socket.id);  // Clean up clock offset data
      emitParticipants(room); // Update participant list for remaining members

      console.log(`Socket ${socket.id} left room ${roomCode}`);

      // If room becomes empty, delete it
      if (room.members.size === 0) {
        rooms.delete(roomCode);
        console.log(`Room deleted (empty): ${roomCode}`);
      } else if (room.adminId === socket.id) {
        // If the admin disconnects, promote another member as admin
        const newAdminId = room.members.keys().next().value;
        room.adminId = newAdminId;
        room.hostId = newAdminId;  // Also update host for consistency
        io.to(room.code).emit('room_admin_changed', {
          roomCode: room.code,
          adminId: newAdminId,
        });
      }
    }

    console.log(`Socket disconnected: ${socket.id}`);
  });
});
});

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Backend server listening on port ${PORT}`);

});
