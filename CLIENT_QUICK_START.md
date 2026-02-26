# Quick Start Guide: Implementing Client Synchronization

This guide walks you through implementing the client-side synchronization logic to use the new server features.

---

## Prerequisites

- React app with Socket.io client
- Audio element or Web Audio API setup
- Basic understanding of async/await

---

## Step 1: Initialize Synchronization on Room Join

Add this to your `join_room` success callback:

```javascript
socket.on_room_joined = (response) => {
  if (!response.ok) return;

  // Store room state
  setRoomCode(response.roomCode);
  setIsAdmin(response.isAdmin);
  setQueue(response.queue);

  // Update playback state
  if (response.playback.isPlaying) {
    // Late joiner: seek to current position and play
    seekAndPlay(response.playback.positionMs);
  }

  // Start synchronization
  initializeSync();
  startPeriodicSync();
};
```

---

## Step 2: Implement NTP Clock Synchronization

Create a `clockSync.js` module:

```javascript
let clientOffset = 0;  // Stored globally or in context
let clientRTT = 0;

export async function performNTPSync(socket, roomCode) {
  return new Promise((resolve) => {
    const t0 = Date.now();

    socket.emit('ntp_request', { roomCode, t0 }, (response) => {
      const clientReceiveTime = Date.now();

      socket.emit('ntp_response', {
        roomCode,
        t0: response.t0,
        t1: response.t1,
        t2: response.t2,
        clientReceiveTime
      }, (syncResponse) => {
        if (syncResponse.ok) {
          clientOffset = syncResponse.offset;
          clientRTT = syncResponse.rtt;

          console.log(`Clock sync: offset=${Math.round(clientOffset)}ms, rtt=${Math.round(clientRTT)}ms`);

          resolve({ offset: clientOffset, rtt: clientRTT });
        }
      });
    });
  });
}

export function getClientOffset() {
  return clientOffset;
}

export function getClientRTT() {
  return clientRTT;
}
```

**Usage:**
```javascript
// On room join, after successful join_room
await performNTPSync(socket, roomCode);
console.log('Clock is synchronized');
```

---

## Step 3: Implement Scheduled Playback

Create a `playback.js` module:

```javascript
import { getClientOffset } from './clockSync';

export function handleScheduledPlayback(event) {
  const { scheduledStartTimeMs, track } = event;

  // Convert server timestamp to client time
  const clientOffset = getClientOffset();
  const localStartTimeMs = scheduledStartTimeMs + clientOffset;

  console.log(`Audio will start at local time: ${localStartTimeMs}ms`);

  // Load audio file
  loadAudioFile(track.filename);

  // Schedule audio playback using Web Audio API (recommended)
  scheduleAudioPlayback(localStartTimeMs);

  // OR use setTimeout for simple approach (less precise)
  // const delayMs = localStartTimeMs - Date.now();
  // setTimeout(() => {
  //   audioElement.play();
  // }, Math.max(0, delayMs));
}

function scheduleAudioPlayback(localStartTimeMs) {
  const audioContext = getAudioContext();
  const targetTime = localStartTimeMs / 1000; // Convert ms to seconds

  // Set up Web Audio oscillator or buffer playback
  // This is a simplified example; your actual implementation depends on audio source

  const startTime = audioContext.currentTime + ((localStartTimeMs - Date.now()) / 1000);

  // Example: if using a buffer source
  const source = audioContext.createBufferSource();
  source.buffer = audioBuffer;
  source.start(Math.max(audioContext.currentTime, startTime));
}
```

**Setup event listener:**
```javascript
useEffect(() => {
  socket.on('playback_scheduled', handleScheduledPlayback);
  socket.on('playback_paused', handlePausedPlayback);
  socket.on('playback_seeked', handleSeekedPlayback);

  return () => {
    socket.off('playback_scheduled', handleScheduledPlayback);
    socket.off('playback_paused', handlePausedPlayback);
    socket.off('playback_seeked', handleSeekedPlayback);
  };
}, []);
```

---

## Step 4: Implement Periodic Drift Correction

Create a `syncLoop.js` module:

```javascript
let syncInterval = null;

export function startPeriodicSync(socket, roomCode) {
  // Initial sync right away
  performSync();

  // Then every 2 seconds
  syncInterval = setInterval(performSync, 2000);

  function performSync() {
    const clientTime = Date.now();

    socket.emit('sync_ping', { roomCode, clientTime }, (response) => {
      const { roomTimeMs, isPlaying } = response;

      // Get current audio position
      const audioElement = document.getElementById('audio');
      const currentTimeMs = (audioElement.currentTime || 0) * 1000;

      // Calculate drift
      const driftMs = roomTimeMs - currentTimeMs;

      console.log(`Sync: server=${Math.round(roomTimeMs)}ms, local=${Math.round(currentTimeMs)}ms, drift=${Math.round(driftMs)}ms`);

      // Correct if drift exceeds threshold
      if (Math.abs(driftMs) > 50) {
        console.log(`Correcting drift: seeking to ${Math.round(roomTimeMs)}ms`);
        audioElement.currentTime = roomTimeMs / 1000;
      }

      // Update UI badge
      updateSyncBadge(Math.abs(driftMs));
    });
  }
}

export function stopPeriodicSync() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
}

function updateSyncBadge(driftMs) {
  // Green: ≤30ms, Yellow: 30-50ms, Red: >50ms
  const badge = document.getElementById('sync-badge');
  if (driftMs <= 30) {
    badge.className = 'sync-badge green';
    badge.textContent = 'Synced';
  } else if (driftMs <= 50) {
    badge.className = 'sync-badge yellow';
    badge.textContent = 'Drifting';
  } else {
    badge.className = 'sync-badge red';
    badge.textContent = 'Out of Sync';
  }
}
```

**Usage:**
```javascript
// Start sync loop after joining room
startPeriodicSync(socket, roomCode);

// Stop on disconnect
socket.on('disconnect', () => {
  stopPeriodicSync();
});
```

---

## Step 5: Implement Pause/Resume Handling

```javascript
export function handlePausedPlayback(event) {
  const { roomTimeMs } = event;

  const audioElement = document.getElementById('audio');
  audioElement.pause();
  audioElement.currentTime = roomTimeMs / 1000;

  console.log(`Paused at ${Math.round(roomTimeMs)}ms`);
}

export function handleSeekedPlayback(event) {
  const { roomTimeMs } = event;

  const audioElement = document.getElementById('audio');
  audioElement.currentTime = roomTimeMs / 1000;

  console.log(`Seeked to ${Math.round(roomTimeMs)}ms`);
}
```

---

## Step 6: Implement Admin Controls

Add this to your UI for admin users:

```javascript
export function PlaybackControls({ isAdmin, roomCode, socket }) {
  if (!isAdmin) {
    return <p>Only the room admin can control playback</p>;
  }

  return (
    <div>
      <button onClick={() => startPlayback(socket, roomCode)}>
        Play
      </button>
      <button onClick={() => pausePlayback(socket, roomCode)}>
        Pause
      </button>
    </div>
  );
}

function startPlayback(socket, roomCode) {
  socket.emit('start_playback', {
    roomCode,
    delayMs: 2000  // 2 second buffer
  }, (response) => {
    if (response.ok) {
      console.log(`Playback scheduled for ${response.scheduledStartTimeMs}`);
    } else {
      console.error(response.error);
    }
  });
}

function pausePlayback(socket, roomCode) {
  socket.emit('pause_playback', {
    roomCode
  }, (response) => {
    if (response.ok) {
      console.log(`Paused at ${response.roomTimeMs}ms`);
    } else {
      console.error(response.error);
    }
  });
}
```

---

## Step 7: Implement Queue Management (Admin Only)

```javascript
export function QueueManager({ isAdmin, roomCode, socket, queue }) {
  if (!isAdmin) {
    return (
      <div>
        <h3>Queue</h3>
        <ul>
          {queue.map(track => (
            <li key={track.id}>{track.filename}</li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div>
      <h3>Queue (Admin)</h3>
      <QueueList
        queue={queue}
        onReorder={(newOrder) => reorderQueue(socket, roomCode, newOrder)}
      />
      <QueueAddForm
        onAdd={(track) => addTrackToQueue(socket, roomCode, track)}
      />
    </div>
  );
}

function addTrackToQueue(socket, roomCode, track) {
  socket.emit('queue_add', {
    roomCode,
    track: {
      id: `track_${Date.now()}`,
      filename: track.filename,
      durationMs: track.durationMs
    }
  }, (response) => {
    if (response.ok) {
      console.log('Track added to queue');
    } else {
      console.error(response.error);
    }
  });
}

function reorderQueue(socket, roomCode, newOrder) {
  socket.emit('queue_reorder', {
    roomCode,
    newOrder: newOrder.map(item => item.id)
  }, (response) => {
    if (response.ok) {
      console.log('Queue reordered');
    } else {
      console.error(response.error);
    }
  });
}
```

---

## Step 8: Listen for Queue Updates (All Users)

```javascript
useEffect(() => {
  socket.on('queue_updated', (data) => {
    setQueue(data.queue);
    console.log('Queue updated:', data.queue);
  });

  socket.on('room_admin_changed', (data) => {
    console.log(`New admin: ${data.adminId}`);
  });

  return () => {
    socket.off('queue_updated');
    socket.off('room_admin_changed');
  };
}, []);
```

---

## Complete Integration Example

Here's how to tie it all together in a React component:

```javascript
import { useEffect, useState } from 'react';
import { performNTPSync, getClientOffset } from './clockSync';
import { startPeriodicSync, stopPeriodicSync } from './syncLoop';
import {
  handleScheduledPlayback,
  handlePausedPlayback,
  handleSeekedPlayback
} from './playback';
import { PlaybackControls, QueueManager } from './controls';

export function SyncedAudioRoom({ socket, roomCode }) {
  const [isAdmin, setIsAdmin] = useState(false);
  const [queue, setQueue] = useState([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [syncOffsetMs, setSyncOffsetMs] = useState(0);

  // Initialize on room join
  useEffect(() => {
    const initializeRoom = async () => {
      // Join room
      socket.emit('join_room', { roomCode }, async (response) => {
        if (!response.ok) {
          console.error('Failed to join room');
          return;
        }

        setIsAdmin(response.isAdmin);
        setQueue(response.queue);
        setIsPlaying(response.playback.isPlaying);

        // Perform NTP sync
        await performNTPSync(socket, roomCode);

        // Start periodic sync
        startPeriodicSync(socket, roomCode);

        // Handle late joiner
        if (response.playback.isPlaying) {
          const audioElement = document.getElementById('audio');
          audioElement.currentTime = response.playback.positionMs / 1000;
          audioElement.play();
        }
      });
    };

    initializeRoom();

    return () => {
      stopPeriodicSync();
    };
  }, [roomCode, socket]);

  // Setup event listeners
  useEffect(() => {
    socket.on('playback_scheduled', handleScheduledPlayback);
    socket.on('playback_paused', (event) => {
      handlePausedPlayback(event);
      setIsPlaying(false);
    });
    socket.on('playback_seeked', handleSeekedPlayback);
    socket.on('queue_updated', (data) => setQueue(data.queue));
    socket.on('room_admin_changed', (data) => {
      if (data.adminId === socket.id) {
        setIsAdmin(true);
      }
    });

    return () => {
      socket.off('playback_scheduled');
      socket.off('playback_paused');
      socket.off('playback_seeked');
      socket.off('queue_updated');
      socket.off('room_admin_changed');
    };
  }, [socket]);

  return (
    <div className="synced-room">
      <h2>Room: {roomCode}</h2>

      <div className="sync-status">
        <span id="sync-badge" className="sync-badge">Syncing...</span>
      </div>

      <audio id="audio" controls />

      <PlaybackControls
        isAdmin={isAdmin}
        roomCode={roomCode}
        socket={socket}
      />

      <QueueManager
        isAdmin={isAdmin}
        roomCode={roomCode}
        socket={socket}
        queue={queue}
      />
    </div>
  );
}
```

---

## CSS for Sync Badge

```css
.sync-badge {
  display: inline-block;
  padding: 4px 12px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: bold;
}

.sync-badge.green {
  background-color: #4caf50;
  color: white;
}

.sync-badge.yellow {
  background-color: #ff9800;
  color: white;
}

.sync-badge.red {
  background-color: #f44336;
  color: white;
}
```

---

## Testing Checklist

- [ ] NTP sync completes and offset is ±50ms or less
- [ ] Playback starts at scheduled time on multiple devices
- [ ] Late joiner catches up to current position
- [ ] Pause/resume maintains exact position across devices
- [ ] Sync offset badge shows green when offset ≤ 30ms
- [ ] Periodic sync_ping corrects drift automatically
- [ ] Admin can add tracks to queue
- [ ] Admin can reorder queue
- [ ] Non-admin cannot control playback (error message shown)
- [ ] New devices joining see current queue

---

## Troubleshooting

### Audio Starts at Different Times
- Check that `performNTPSync` completed successfully
- Verify `clientOffset` is being calculated (should be ±50ms)
- Ensure `scheduledStartTimeMs` is being broadcast correctly

### Sync Badge Shows Red
- Check network latency (WiFi weak signal?)
- Verify `sync_ping` is being called every 2 seconds
- Audio may have internal buffering; this is normal

### Late Joiner Doesn't Sync
- Confirm `response.playback.positionMs` is received
- Verify audio file is loaded before setting `currentTime`
- Check browser console for audio element errors

### Admin Can't Control Playback
- Verify `response.isAdmin` is `true` on join
- Check that socket ID matches `room.adminId` on server
- Look for error message: "Only admin can control playback"

---

## Performance Tips

1. **Debounce drift corrections:** Don't seek on every tiny drift, only if > 50ms
2. **Cache audio context:** Reuse single AudioContext instance
3. **Preload audio files:** Load before scheduling playback
4. **Throttle sync logs:** Don't log every sync_ping; sample every 10th
5. **Monitor network:** Track RTT and warn user if > 20ms

This completes a production-ready client synchronization implementation!
