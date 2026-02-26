# Multi-Phone Speaker System: Synchronization Guide

## Overview

This guide explains the synchronized audio playback system implemented in `server/index.js`. The system enables multiple phones to play the same audio in near-perfect synchronization using:

1. **NTP-style clock synchronization** - Measures and compensates for clock differences between client devices
2. **Future scheduled playback** - Server tells all clients exactly when to start audio
3. **Admin role enforcement** - Only the admin can control playback and queue
4. **Queue management** - Simple in-memory track queue with reordering
5. **Late joiner support** - New clients sync to current playback position

---

## How It Works: Step by Step

### 1. Room Creation & Admin Role

**Flow:**
```
Device A → emit('create_room')
Server   → creates room, sets Device A as admin
Server   → emit callback with roomCode and adminId
```

**Room State:**
```javascript
rooms.set(roomCode, {
  code: 'A7F3',
  hostId: socket_A,
  adminId: socket_A,           // First user is admin
  members: Set([socket_A]),
  playback: {
    isPlaying: false,
    offsetMs: 0,               // Paused position
    startedAt: null,
    scheduledStartTimeMs: null // Future start time
  },
  queue: [],                   // Audio tracks: [{id, filename, durationMs}, ...]
  clientOffsets: Map()         // Clock sync data per client
})
```

**Key Point:** The admin (first user) has exclusive control over:
- Starting/pausing playback (`start_playback`, `pause_playback`)
- Managing the queue (`queue_add`, `queue_reorder`)

---

### 2. NTP-Style Clock Synchronization

**Problem:** Client clocks may drift from server clock. If we schedule playback at "server time 1708000000000", a client with a clock 5ms ahead will start 5ms early.

**Solution:** Measure clock drift and store it per client.

#### The NTP Exchange

**Step 1: Client sends NTP request**
```javascript
// Client code
const t0 = Date.now(); // Client's time when sending
socket.emit('ntp_request', { roomCode, t0 }, (response) => {
  const { t0, t1, t2 } = response;
  const clientReceiveTime = Date.now(); // Client's time when receiving response
  // Send t0, t1, t2, clientReceiveTime to ntp_response handler
});
```

**Step 2: Server responds immediately**
```javascript
// Server: handlers/ntp_request
socket.on('ntp_request', ({ roomCode, t0 }, callback) => {
  const t1 = Date.now(); // Server's time when receiving request
  const t2 = Date.now(); // Server's time when sending response

  callback({ t0, t1, t2 });
  // t1 ≈ t2 (very close, since server responds immediately)
});
```

**Step 3: Client calculates offset and sends it back**
```javascript
// Client code
const clientReceiveTime = Date.now();
socket.emit('ntp_response', {
  roomCode,
  t0, t1, t2,
  clientReceiveTime
}, (response) => {
  console.log(`Clock offset: ${response.offset}ms, RTT: ${response.rtt}ms`);
});
```

**Step 4: Server calculates and stores offset**
```javascript
// Server: handlers/ntp_response
socket.on('ntp_response', ({ roomCode, t0, t1, t2, clientReceiveTime }, callback) => {
  const rtt = clientReceiveTime - t0;
  const offset = calculateClientOffset(t0, t1, t2, clientReceiveTime);

  room.clientOffsets.set(socket.id, { offset, rtt });
  // offset is typically between -50ms and +50ms on LAN
  // This is the client's clock difference relative to server
});
```

#### The Math

**RTT (Round-Trip Time):**
```
RTT = clientReceiveTime - t0
    = time from client send to client receive
    = 2 × one-way network delay (approximately)
```

**Server's Actual Time (Estimate):**
```
serverTime = (t1 + t2) / 2
           = midpoint of server's time window
           ≈ server's actual clock when processing the request
```

**Client's Clock Offset:**
```
clientOffset = serverTime - localClientTime
             = server's time - client's time at response receipt
             = how many ms the client's clock is ahead (+) or behind (-) the server
```

**Example:**
- Server clock: 1708000000000 ms
- Client clock at request: 1708000005 ms (client is 5ms ahead)
- Client sends t0 = 1708000005
- Server responds t1 = 1708000000, t2 = 1708000000
- Client receives at time 1708000010 (5ms after send, assuming 2.5ms network latency one-way)
- RTT = 5ms
- serverTime estimate = (1708000000 + 1708000000) / 2 = 1708000000
- clientOffset = 1708000000 - (1708000010 - 5/2) = 1708000000 - 1708000007.5 ≈ -7.5ms
- This means: when server says "time is 1708000000", client's clock says "1708000007.5"

---

### 3. Scheduled Future Playback

**Problem:** If server tells clients "play now", there's network latency. Client A might get the message 10ms before Client B, causing audio to start at different times.

**Solution:** Server schedules a future wall-clock time for playback. All clients receive the same timestamp and start at that time.

#### Playing Audio

**Admin clicks Play:**
```javascript
// Client code (admin only)
socket.emit('start_playback', { roomCode, delayMs: 2000 }, (response) => {
  console.log(`Audio will start at: ${response.scheduledStartTimeMs}`);
});
```

**Server schedules playback 2 seconds in future:**
```javascript
// Server: start_playback handler
socket.on('start_playback', ({ roomCode, delayMs }, callback) => {
  if (room.adminId !== socket.id) {
    callback({ ok: false, error: 'Only admin can control playback' });
    return;
  }

  const now = Date.now();
  const delay = delayMs || 2000; // Default 2 second buffer
  const scheduledStartTimeMs = now + delay; // e.g., 1708000000000 + 2000 = 1708000002000

  room.playback.isPlaying = true;
  room.playback.startedAt = scheduledStartTimeMs;
  room.playback.scheduledStartTimeMs = scheduledStartTimeMs;

  // Broadcast to all clients
  io.to(room.code).emit('playback_scheduled', {
    scheduledStartTimeMs,  // THE KEY: all clients get same timestamp
    track: { id, filename, durationMs },
    serverTime: now
  });
});
```

#### Client Converts Server Time to Local Time

**Each client has stored its clock offset from NTP sync. Now:**

```javascript
// Client code
socket.on('playback_scheduled', ({ scheduledStartTimeMs, track }) => {
  // Retrieve stored clock offset from NTP sync
  const clientOffset = storedClientOffset; // e.g., -7.5ms

  // Convert server timestamp to local client time
  const localStartTime = scheduledStartTimeMs + clientOffset;
  // 1708000002000 + (-7.5) = 1708000001992.5

  // Load audio file for the track
  loadAudioFile(track.filename);

  // Schedule audio to start at that local time
  // Using Web Audio API's audioContext.currentTime
  scheduleAudioPlayback(localStartTime);
});

// When audioContext.currentTime reaches the scheduled time, audio starts
```

#### Why This Works

- **Server time:** 1708000002000
- **Device A offset:** -5ms → local start time = 1708000001995
- **Device B offset:** +3ms → local start time = 1708000002003
- **Difference:** 8ms (sum of their offsets)
- **On LAN:** Network latency is ~1-5ms one-way
- **Result:** Devices start within 8ms of each other (imperceptible)

---

### 4. Pause with Position Tracking

**Admin clicks Pause:**
```javascript
// Server: pause_playback handler
socket.on('pause_playback', ({ roomCode }, callback) => {
  if (room.adminId !== socket.id) {
    callback({ ok: false, error: 'Only admin can control playback' });
    return;
  }

  // Capture current position
  const positionMs = getRoomPlaybackPositionMs(room);
  // positionMs = room.playback.offsetMs + (now - room.playback.startedAt)

  // Stop playback
  room.playback.isPlaying = false;
  room.playback.startedAt = null;
  room.playback.offsetMs = positionMs; // Store the pause point
  room.playback.scheduledStartTimeMs = null;

  // Tell all clients to pause at this position
  io.to(room.code).emit('playback_paused', {
    roomTimeMs: positionMs, // e.g., 12500ms (12.5 seconds in)
    serverTime: now
  });
});
```

**Client pauses:**
```javascript
// Client code
socket.on('playback_paused', ({ roomTimeMs }) => {
  audioElement.pause();
  audioElement.currentTime = roomTimeMs / 1000; // Convert ms to seconds
});
```

**Resume (admin clicks Play again after pause):**
- Same as scheduled playback
- Room has `offsetMs` stored (e.g., 12500)
- Server schedules: `scheduledStartTimeMs = now + 2000`
- When playback resumes, position starts from `offsetMs`
- All clients resume from exact same position (12500ms)

---

### 5. Late Joiner Support

**Device C joins room while A and B are playing at 12.5 seconds:**

```javascript
// Server: join_room handler
socket.on('join_room', ({ roomCode }, callback) => {
  // ... validation ...

  const playbackPositionMs = getRoomPlaybackPositionMs(room);
  // 12500ms (12.5 seconds in)

  callback({
    ok: true,
    playback: {
      isPlaying: true,
      positionMs: 12500  // Tell C where playback is
    },
    queue: room.queue,
    isAdmin: false
  });
});
```

**Device C catches up:**
```javascript
// Client code
socket.on('join_room_response', ({ playback, queue, isAdmin }) => {
  if (playback.isPlaying) {
    loadAudioFile(queue[currentTrackIndex].filename);

    // Seek to current position
    audioElement.currentTime = playback.positionMs / 1000;

    // Start playing from that position
    audioElement.play();
  }
});
```

**Result:** Device C is now at the same position as A and B. Within 1-2 seconds, it's in perfect sync (via sync_ping polls every 2 seconds).

---

### 6. Queue Management

#### Admin Adds Track
```javascript
// Client code (admin only)
socket.emit('queue_add', {
  roomCode,
  track: {
    id: 'track_1',
    filename: 'song.wav',
    durationMs: 180000 // 3 minutes
  }
}, (response) => {
  console.log('Queue:', response.queue);
});
```

#### Admin Reorders Queue
```javascript
// Client code (admin only)
socket.emit('queue_reorder', {
  roomCode,
  newOrder: ['track_3', 'track_1', 'track_2'] // New order by ID
}, (response) => {
  console.log('Queue reordered:', response.queue);
});
```

#### Server Validates & Broadcasts
```javascript
// Server: queue_reorder handler
socket.on('queue_reorder', ({ roomCode, newOrder }, callback) => {
  if (room.adminId !== socket.id) {
    callback({ ok: false, error: 'Only admin can manage queue' });
    return;
  }

  const reorderedQueue = newOrder
    .map(id => room.queue.find(track => track.id === id))
    .filter(track => track !== undefined);

  room.queue = reorderedQueue;

  // Broadcast to all clients
  io.to(room.code).emit('queue_updated', {
    queue: room.queue
  });

  callback({ ok: true, queue: room.queue });
});
```

---

## Client Implementation Checklist

### 1. NTP Synchronization Setup
- [ ] On room join, initiate NTP request: `socket.emit('ntp_request', { roomCode, t0 })`
- [ ] Receive response and send back: `socket.emit('ntp_response', { t0, t1, t2, clientReceiveTime })`
- [ ] Store result: `const clientOffset = response.offset`
- [ ] Repeat every 10-30 seconds (optional, for drift correction)

### 2. Playback Scheduling
- [ ] Listen for `playback_scheduled` event
- [ ] Load audio file from track info
- [ ] Convert server timestamp to local: `localTime = scheduledStartTimeMs + clientOffset`
- [ ] Schedule audio start using Web Audio API: `audioContext.currentTime`
- [ ] Alternatively, use setTimeout for HTML5 audio element (less precise)

### 3. Queue Management
- [ ] Listen for `queue_updated` event
- [ ] If admin: emit `queue_add` and `queue_reorder` events
- [ ] Update UI to show current queue

### 4. Regular Syncing
- [ ] Every 2 seconds: emit `sync_ping` to check if audio drifted
- [ ] If drift > 50ms, seek to correct position
- [ ] Display sync offset in UI (green badge if offset ≤ 30ms)

---

## Synchronization Accuracy

### On Typical LAN (WiFi at home)
- **Network latency:** 1-5ms one-way
- **Clock drift:** ±5-20ms (varies with device hardware)
- **Expected sync error:** ±40ms
- **Perceptible threshold:** ~100ms
- **Verdict:** ✅ **Imperceptible difference**

### On Mobile Hotspot
- **Network latency:** 5-20ms one-way
- **Clock drift:** ±10-30ms
- **Expected sync error:** ±70ms
- **Verdict:** ✅ **Minor, mostly acceptable**

### On Cellular Network
- **Network latency:** 20-50ms one-way
- **Clock drift:** ±20-50ms
- **Expected sync error:** ±150ms
- **Verdict:** ⚠️ **Noticeable but may be acceptable**

---

## Key Math Formulas Summary

| Concept | Formula |
|---------|---------|
| **RTT** | `RTT = clientReceiveTime - t0` |
| **Server Time Estimate** | `serverTime = (t1 + t2) / 2` |
| **Clock Offset** | `offset = serverTime - (clientReceiveTime - RTT/2)` |
| **Local Playback Time** | `localStartTime = scheduledStartTimeMs + clientOffset` |
| **Playback Position (Playing)** | `positionMs = offsetMs + (now - startedAt)` |
| **Playback Position (Paused)** | `positionMs = offsetMs` |
| **One-Way Delay Estimate** | `oneWayDelay ≈ RTT / 2` |

---

## Event Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ SYNCHRONIZATION SEQUENCE                                    │
└─────────────────────────────────────────────────────────────┘

SETUP PHASE:
  Device A: emit('create_room')
  Server:   room created, A is admin

  Device B: emit('join_room', {roomCode})
  Server:   B joins, receives current playback state

  Devices A & B: emit('ntp_request', {roomCode, t0})
  Server:        respond with t1, t2
  Devices:       emit('ntp_response', {t0, t1, t2, clientReceiveTime})
  Server:        store clientOffset for each device

PLAYBACK PHASE:
  User (on A): clicks Play
  Device A:    emit('start_playback', {roomCode, delayMs: 2000})
  Server:      validate A is admin, schedule playback
  Server:      emit('playback_scheduled', {scheduledStartTimeMs, track, ...})

  Devices A, B, C:
    - Load audio file
    - Convert server time: localTime = scheduledStartTimeMs + clientOffset
    - Schedule audio start using Web Audio API
    - Audio starts at near-identical times

SYNC CORRECTION (every 2 seconds):
  All devices: emit('sync_ping', {roomCode, clientTime})
  Server:      respond with current roomTimeMs, serverTime
  Devices:     compare audioContext.currentTime with target
               if drift > 50ms, seek to correct position

PAUSE PHASE:
  User (on A): clicks Pause
  Device A:    emit('pause_playback', {roomCode})
  Server:      capture position, stop playback
  Server:      emit('playback_paused', {roomTimeMs})
  All Devices: pause audio, seek to pauseMs position
```

---

## Troubleshooting

### Audio Starts at Different Times
- **Cause:** NTP sync not completed or clock offset too large
- **Fix:** Ensure `ntp_response` is sent and offset value is reasonable
- **Check:** Log `offset` and `rtt` values; they should be ±50ms and <20ms respectively

### Audio Drifts Apart Over Time
- **Cause:** Clock drift accumulating; devices not re-syncing
- **Fix:** Add periodic NTP sync (every 10-30 seconds) or increase sync_ping frequency
- **Check:** Monitor offset via logging; if it grows beyond ±100ms, re-sync

### Late Joiner Appears at Wrong Position
- **Cause:** `getRoomPlaybackPositionMs()` calculation is incorrect
- **Fix:** Verify that `offsetMs` and `startedAt` are being updated correctly on play/pause
- **Check:** Compare `roomTimeMs` from server with `audioContext.currentTime` on device

### Some Clients Can't Control Playback
- **Cause:** User is not the admin
- **Fix:** Check that `room.adminId === socket.id` before allowing playback control
- **Check:** Ensure only first user gets admin role, or implement admin reassignment

---

## Production Considerations

1. **Add RTT jitter monitoring:** Track if latency is increasing; warn users if network is unstable
2. **Implement slow drift correction:** Small adjustments every 30 sec instead of sudden jumps
3. **Add user feedback:** Show sync quality UI (green = synced, yellow = drifting, red = out of sync)
4. **Handle admin disconnect:** Promote next member as admin (already implemented)
5. **Add heartbeat:** Detect dead connections faster (optional, socket.io has built-in)
6. **Log sync metrics:** For debugging and monitoring production deployments
