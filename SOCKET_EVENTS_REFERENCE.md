# Socket.io Events Reference

## New Events Added to `server/index.js`

### NTP Clock Synchronization Events

#### `ntp_request`
**Direction:** Client → Server

Initiates NTP-style clock synchronization.

**Payload:**
```javascript
{
  roomCode: string,  // Room identifier
  t0: number         // Client's timestamp when sending (milliseconds since client started)
}
```

**Response (Ack callback):**
```javascript
{
  t0: number,  // Echo of client's send time
  t1: number,  // Server's timestamp when receiving request
  t2: number   // Server's timestamp when sending response
}
```

**Usage:**
```javascript
const t0 = Date.now();
socket.emit('ntp_request', { roomCode, t0 }, (response) => {
  const { t0, t1, t2 } = response;
  const clientReceiveTime = Date.now();

  // Now send ntp_response with full info
  socket.emit('ntp_response', { roomCode, t0, t1, t2, clientReceiveTime });
});
```

---

#### `ntp_response`
**Direction:** Client → Server

Completes NTP synchronization. Server calculates and stores clock offset.

**Payload:**
```javascript
{
  roomCode: string,
  t0: number,              // From ntp_request
  t1: number,              // From ntp_request response
  t2: number,              // From ntp_request response
  clientReceiveTime: number // Client's timestamp when receiving ntp_request response
}
```

**Response (Ack callback):**
```javascript
{
  ok: boolean,   // true if successful
  offset: number, // Client's clock offset in ms (negative = ahead of server)
  rtt: number     // Round-trip time in ms
}
```

**Example response:**
```javascript
{
  ok: true,
  offset: -5.2,  // Client is 5.2ms ahead of server
  rtt: 8.4       // Network round-trip is 8.4ms (≈4.2ms one-way)
}
```

---

### Playback Control Events (Admin Only)

#### `start_playback` (Updated)
**Direction:** Client → Server
**Requirements:** Sender must be room admin

Schedules playback to start at a future time.

**Payload:**
```javascript
{
  roomCode: string,
  delayMs?: number  // Milliseconds to wait before starting (default: 2000)
}
```

**Response (Ack callback):**
```javascript
{
  ok: boolean,
  scheduledStartTimeMs?: number,  // Absolute server time when playback will start
  roomTimeMs?: number,             // Current playback position before start
  serverTime?: number,             // Current server time
  error?: string                   // If ok: false
}
```

**Server Broadcast:**
When playback is scheduled, server emits `playback_scheduled` to all clients:
```javascript
{
  roomCode: string,
  scheduledStartTimeMs: number,  // When audio should start (server's clock)
  startedBy: string,             // Socket ID of admin who triggered
  roomTimeMs: number,
  serverTime: number
}
```

---

#### `pause_playback` (Updated)
**Direction:** Client → Server
**Requirements:** Sender must be room admin

Pauses playback and captures current position.

**Payload:**
```javascript
{
  roomCode: string
}
```

**Response (Ack callback):**
```javascript
{
  ok: boolean,
  roomTimeMs?: number,  // Pause position in milliseconds
  serverTime?: number,
  error?: string        // If ok: false
}
```

**Server Broadcast:**
Server emits `playback_paused` to all clients:
```javascript
{
  roomCode: string,
  roomTimeMs: number,  // Position where audio paused
  serverTime: number
}
```

---

### Queue Management Events (Admin Only)

#### `queue_add`
**Direction:** Client → Server
**Requirements:** Sender must be room admin

Adds a track to the room's queue.

**Payload:**
```javascript
{
  roomCode: string,
  track: {
    id: string,           // Unique track identifier
    filename: string,     // Audio file name/path
    durationMs: number    // Duration in milliseconds
  }
}
```

**Response (Ack callback):**
```javascript
{
  ok: boolean,
  queue?: Array<Track>,  // Updated queue
  error?: string         // If ok: false
}
```

**Server Broadcast:**
Server emits `queue_updated` to all clients:
```javascript
{
  queue: Array<Track>  // Array of {id, filename, durationMs, ...}
}
```

**Example:**
```javascript
socket.emit('queue_add', {
  roomCode: 'A7F3',
  track: {
    id: 'song_001',
    filename: 'mysong.wav',
    durationMs: 180000  // 3 minutes
  }
}, (response) => {
  if (response.ok) {
    console.log('Queue updated:', response.queue);
  }
});
```

---

#### `queue_reorder`
**Direction:** Client → Server
**Requirements:** Sender must be room admin

Reorders the queue to a new sequence of track IDs.

**Payload:**
```javascript
{
  roomCode: string,
  newOrder: Array<string>  // Track IDs in desired order
}
```

**Response (Ack callback):**
```javascript
{
  ok: boolean,
  queue?: Array<Track>,  // Updated queue in new order
  error?: string         // If ok: false
}
```

**Server Broadcast:**
Server emits `queue_updated` to all clients:
```javascript
{
  queue: Array<Track>  // Array in new order
}
```

**Example:**
```javascript
socket.emit('queue_reorder', {
  roomCode: 'A7F3',
  newOrder: ['song_003', 'song_001', 'song_002']
}, (response) => {
  if (response.ok) {
    console.log('Queue reordered:', response.queue);
  }
});
```

---

### Join Room Event (Updated)

#### `join_room` (Updated to return admin info)
**Direction:** Client → Server

**Response (Ack callback) - Now includes:**
```javascript
{
  ok: boolean,
  roomCode?: string,
  isHost?: boolean,
  isAdmin?: boolean,         // NEW: true if sender is room admin
  playback?: {
    isPlaying: boolean,
    positionMs: number       // Current playback position (for late joiners)
  },
  queue?: Array<Track>,      // NEW: current room queue
  currentTrackIndex?: number, // NEW: index of current track
  error?: string
}
```

---

## Existing Events (Unchanged)

### `sync_ping`
**Direction:** Client → Server

Periodic synchronization check to detect and correct audio drift.

**Payload:**
```javascript
{
  roomCode: string,
  clientTime: number  // Client's current timestamp
}
```

**Response (Ack callback):**
```javascript
{
  serverTime: number,
  roomTimeMs: number,
  isPlaying: boolean,
  echo: { clientTime: number }
}
```

---

### `seek_playback`
**Direction:** Client → Server
**Requirements:** Sender must be room admin (newly enforced)

Seeks to a specific position in the current track.

**Payload:**
```javascript
{
  roomCode: string,
  positionMs: number  // Target milliseconds
}
```

**Server Broadcast:**
Server emits `playback_seeked` to all clients:
```javascript
{
  roomCode: string,
  roomTimeMs: number,
  serverTime: number
}
```

---

## Admin-Only Events Summary

These events will return `{ok: false, error: 'Only admin can...'}` if sender is not the room admin:

- `start_playback` - Admin only
- `pause_playback` - Admin only
- `queue_add` - Admin only
- `queue_reorder` - Admin only
- `seek_playback` - Admin only (newly enforced)

**Admin Detection:**
```javascript
// Server checks before processing:
if (room.adminId !== socket.id) {
  callback({ ok: false, error: 'Only admin can control playback' });
  return;
}
```

---

## Server Broadcast Events

These events are sent by server to all clients in a room:

| Event | Trigger | Payload |
|-------|---------|---------|
| `playback_scheduled` | Admin calls `start_playback` | `{roomCode, scheduledStartTimeMs, startedBy, roomTimeMs, serverTime}` |
| `playback_paused` | Admin calls `pause_playback` | `{roomCode, roomTimeMs, serverTime}` |
| `playback_seeked` | Admin calls `seek_playback` | `{roomCode, roomTimeMs, serverTime}` |
| `queue_updated` | Admin calls `queue_add` or `queue_reorder` | `{queue: Array}` |
| `room_admin_changed` | Admin disconnects | `{roomCode, adminId}` |
| `room_member_joined` | New client joins | `{socketId}` |

---

## Error Responses Quick Reference

| Error | Cause | Solution |
|-------|-------|----------|
| `Only admin can control playback` | Non-admin called `start_playback`, `pause_playback`, or `seek_playback` | Request admin to control playback, or check if admin changed |
| `Only admin can manage queue` | Non-admin called `queue_add` or `queue_reorder` | Request admin to manage queue |
| `Room not found` | Invalid or expired room code | Create new room or rejoin with correct code |
| `Invalid reorder: some tracks missing` | `queue_reorder` called with incomplete track list | Ensure all tracks in queue are included in newOrder |

---

## Implementation Order for Client

1. **Connect to room** → emit `join_room`
2. **Synchronize clock** → emit `ntp_request`, then `ntp_response`
3. **Listen for playback events** → `playback_scheduled`, `playback_paused`, `playback_seeked`
4. **Listen for queue updates** → `queue_updated`
5. **Regular syncing** → emit `sync_ping` every 2 seconds
6. **Optional: Manage queue** (admin only) → emit `queue_add`, `queue_reorder`
7. **Optional: Control playback** (admin only) → emit `start_playback`, `pause_playback`
