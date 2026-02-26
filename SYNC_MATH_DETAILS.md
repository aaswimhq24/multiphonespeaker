# Synchronization Math Deep Dive

This document provides detailed mathematical explanations of how the NTP-style clock synchronization and scheduled playback work.

---

## Part 1: NTP Clock Synchronization Math

### The Three-Way Handshake

```
Timeline:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Device A (Client)     |   Network Delay   |    Server (Master Clock)
─────────────────────────────────────────────────────────────────

t = 0ms
 ├─ Client time: 0ms
 │  Send NTP request (t0 = 0)
 └─────────────────────────────────────────────────→ Network takes Δₜ₁

t = 0 + Δₜ₁
                                                      Server receives (t1 = 5ms)
                                                      ├─ Process request
                                                      └─ Send response (t2 = 5ms)

t = 0 + Δₜ₁ + Δₜ₂
 ←─────────────────────────────────────────────────  Network takes Δₜ₂

t = RTT
 Client receives at: 10ms (relative to its start)
 Stored: t0=0, t1=5, t2=5, clientReceiveTime=10
```

### Formula Derivation

**Assumptions:**
- One-way network delay is approximately symmetric: `Δₜ₁ ≈ Δₜ₂ ≈ RTT/2`
- Server processing time is negligible: `t2 ≈ t1`

**Given:**
- `t0` = Client's timestamp when sending request
- `t1` = Server's timestamp when receiving request
- `t2` = Server's timestamp when sending response
- `clientReceiveTime` = Client's timestamp when receiving response
- `RTT = clientReceiveTime - t0` (round-trip time)

**What we want to find:**
- Server's "real" time at the moment the request was being processed
- Client's clock offset relative to server

**Derivation:**

Step 1: Estimate the one-way network delay
```
  One-way delay ≈ RTT / 2
  one_way_delay = (clientReceiveTime - t0) / 2
```

Step 2: Estimate server's "real" time (midpoint of processing window)
```
  The server processed the request at some time between t1 and t2.
  Best estimate: midpoint

  serverTime = (t1 + t2) / 2
```

Step 3: Estimate client's clock time at that moment
```
  Server sent response at t2.
  Client received at clientReceiveTime.
  Time in transit: one_way_delay

  So when server sent (t2), client's clock was at:
  clientTimeAtServerSend = clientReceiveTime - one_way_delay
                         = clientReceiveTime - RTT/2
```

Step 4: Calculate clock offset
```
  offset = serverTime - clientTimeAtServerSend
         = (t1 + t2) / 2 - (clientReceiveTime - RTT/2)
         = (t1 + t2) / 2 - clientReceiveTime + (clientReceiveTime - t0) / 2
         = (t1 + t2) / 2 - clientReceiveTime + clientReceiveTime/2 - t0/2
         = (t1 + t2) / 2 + clientReceiveTime/2 - clientReceiveTime - t0/2
         = (t1 + t2) / 2 - clientReceiveTime/2 - t0/2
         = ((t1 + t2) - clientReceiveTime - t0) / 2
```

**Simplified:**
```
  offset = (t1 + t2 - clientReceiveTime - t0) / 2
```

Or equivalently (what's in the code):
```
  serverTime = (t1 + t2) / 2
  clientTimeAtServerSend = clientReceiveTime - (clientReceiveTime - t0) / 2
  offset = serverTime - clientTimeAtServerSend
```

### Numerical Example

**Scenario:**
- Server clock: 1708000000000 ms
- Client clock: 1708000005 ms (5ms ahead)
- Network latency: 2.5ms one-way (5ms round-trip)

**Exchange:**

1. **t0 = 0** (Client's relative time)
   - Client's actual time: 1708000005 ms
   - Client sends: `ntp_request { t0: 0 }`

2. **t1 = 5** (Server receives after 5ms network latency)
   - Server's actual time: 1708000000 ms
   - Server sends: `ntp_response { t0: 0, t1: 5, t2: 5 }`

3. **clientReceiveTime = 10** (Client receives after 5ms more latency)
   - Client's actual time: 1708000015 ms

**Calculation:**
```
  RTT = 10 - 0 = 10ms ✓ (5ms there, 5ms back)

  serverTime = (5 + 5) / 2 = 5ms
  (This is server's estimate of actual time, relative to client t0=0)

  clientTimeAtServerSend = 10 - (10 - 0)/2 = 10 - 5 = 5ms
  (Client's clock was at 5ms relative in its timeline when server sent)

  offset = 5 - 5 = 0ms ✓
```

Wait, that doesn't match. Let me recalculate with absolute times:

**Absolute Time Exchange:**

```
Server actual time: 1708000000000
Client actual time: 1708000005000 (5ms ahead)
Network latency: 5ms round-trip (2.5ms one-way)

Timeline (in ms):
  0ms:   Client at 1708000005, sends t0=1708000005
  2.5ms: Server at 1708000002.5, receives (appears as t1 in server's time)
         But server records t1 = 1708000002.5
  2.5ms: Server sends response with t1, t2 = 1708000002.5
  5ms:   Client receives at 1708000010, response says t1=1708000002.5, t2=1708000002.5

Calculation:
  RTT = 1708000010 - 1708000005 = 5ms ✓

  serverTime = (1708000002.5 + 1708000002.5) / 2 = 1708000002.5

  clientTimeAtServerSend = 1708000010 - 5/2 = 1708000007.5

  offset = 1708000002.5 - 1708000007.5 = -5ms

  Interpretation: client's clock is 5ms AHEAD of server
  To convert server time to client time: clientTime = serverTime + offset = serverTime - 5ms
```

This matches our setup! ✓

### Using the Offset

Once we have `offset`, we can convert any server timestamp to client time:

```
  clientTime = serverTime + offset
```

**Example:**
```
  Server says: "Playback starts at server time 1708000000000"
  Client's offset: -5ms

  Client converts: 1708000000000 + (-5) = 1708000000000 - 5 = 1708000000000 - 5ms

  So client schedules audio start at its local time: 1708000000000 - 5ms
```

---

## Part 2: Playback Position Calculation

### Playing State Formula

When playback is active, the current position advances with time:

```
  positionMs = base_offset + (now - start_time)

Where:
  base_offset = room.playback.offsetMs
              = value at time playback started
              = 0 if starting from beginning
              = N if resuming from paused position N

  now = current server time (Date.now())

  start_time = room.playback.startedAt
             = server time when playback was initiated
```

**Example:**
```
  Playback starts at server time 1708000000000
  room.playback.offsetMs = 0 (starting from beginning)
  room.playback.startedAt = 1708000000000

  After 5 seconds of playback:
  now = 1708000005000
  positionMs = 0 + (1708000005000 - 1708000000000)
             = 0 + 5000
             = 5000ms ✓
```

### Paused State Formula

When paused, position stays constant:

```
  positionMs = room.playback.offsetMs
             = captured position when pause was called
```

**Example:**
```
  Playback paused at 12.5 seconds
  room.playback.offsetMs = 12500
  room.playback.startedAt = null  (not advancing)

  Position always returned as: 12500ms
```

### Practical Implementation

```javascript
function getRoomPlaybackPositionMs(room) {
  const { isPlaying, offsetMs, startedAt } = room.playback;

  if (!isPlaying || !startedAt) {
    return offsetMs;  // Paused: return stored position
  }

  const now = Date.now();
  return offsetMs + (now - startedAt);  // Playing: calculate current position
}
```

---

## Part 3: Scheduled Playback Timestamp Conversion

### The Problem

Naive approach: "Play now"
```
  Time on server: 1708000000000
  Time on Device A: 1708000000000 + 5ms = 1708000000005
  Time on Device B: 1708000000000 - 3ms = 1708000000000 - 3ms = 1708000000000 - 3ms

  If server says "play now":
    Device A receives at: 1708000001000 (after network latency)
    Device B receives at: 1708000001005 (after different latency)

  Devices start at different times!
```

### The Solution: Future Timestamp

```
  Server calculates: scheduledStartTimeMs = now + delayMs
                                          = 1708000000000 + 2000
                                          = 1708000002000

  Server broadcasts this timestamp to all clients.

  Each client converts to its local time:
    Device A: 1708000002000 + 5 = 1708000002005
    Device B: 1708000002000 + (-3) = 1708000001997

  Wait, they still differ by 8ms!
```

**But here's the key:** All clients receive the same server timestamp immediately (ignoring tiny socket.io latency). The 8ms difference is only the pre-existing clock offset, which is **constant and predictable**.

### Why This Works

```
  The difference in local start times = difference in clock offsets
                                       = constant
                                       = typically ±50ms total across all devices
                                       = imperceptible by human ear

  Web Audio API can schedule events to millisecond precision.
  If all devices use the exact same server timestamp:
    - Device A will start at: scheduledTime + offsetA
    - Device B will start at: scheduledTime + offsetB
    - Difference: offsetA - offsetB = at most ±50ms
```

On a LAN, network latencies are 1-5ms one-way per device, so:
- Device A sees network latency 2ms before response arrives
- Device B sees network latency 3ms before response arrives
- They both receive same `scheduledStartTimeMs`
- They both apply their (different) offsets
- Result: They start within 5ms of each other ✓

### Mathematical Proof

```
All devices receive at approximately same time t_receive:
Device A playback start time = scheduledStartTimeMs + offsetA
Device B playback start time = scheduledStartTimeMs + offsetB

Difference = (scheduledStartTimeMs + offsetA) - (scheduledStartTimeMs + offsetB)
           = offsetA - offsetB
           = typically ±5-10ms on good LAN
           = imperceptible (human ear threshold ~100ms)
```

---

## Part 4: Drift Correction via sync_ping

### The Drift Problem

Even with perfect sync at start, position can drift due to:
1. **Clock drift:** Device clocks don't run at exactly 1ms per real millisecond
2. **Rounding errors:** Integer vs float precision
3. **Browser audio engine variations:** Different devices process audio at slightly different rates

### The Solution: Periodic Polling

Every 2 seconds, client asks server for current position:

```
Client: emit('sync_ping', { roomCode, clientTime })
Server: responds with roomTimeMs (current position)

Client calculates expected position:
  expected = audioElement.currentTime * 1000

Drift = roomTimeMs - expected

If |drift| > threshold (e.g., 50ms):
  audioElement.currentTime = roomTimeMs / 1000
```

### Drift Accumulation Example

```
Without sync_ping:
  Start: both at 0ms
  After 10 seconds:
    Device A: 10000ms (drifts +2ms due to slower clock)
    Device B: 10000ms (keeps accurate time)
    Difference: 2ms/10sec × audio length

After 3 minutes:
  Drift = 2ms/10s × 180s = 36ms (still imperceptible but growing)

With sync_ping every 2 seconds:
  Every 2 seconds, drift is corrected
  Max drift between syncs: 2ms/10s × 2s = 0.4ms (not noticeable)
```

---

## Part 5: Late Joiner Calculation

### New Client Joins Room

When Device C joins while A & B are playing:

```
Server state:
  startedAt = 1708000000000 (2 seconds ago)
  offsetMs = 0
  now = 1708000002000

Current position = 0 + (1708000002000 - 1708000000000) = 2000ms

Device C receives: positionMs = 2000

Device C:
  Loads audio file
  Sets currentTime = 2000 / 1000 = 2.0 seconds
  Plays audio

Result: All devices now at same position (within network latency)
```

### Catch-Up Timeline

```
t = 2.000s: Device C joins at 2000ms position
t = 2.000s: Device C starts audio at 2.0s
t = 2.100s: Device C sync_ping gets server position: 2100ms
            Audio is at 2.0s = 2000ms
            Drift = 2100 - 2000 = 100ms
            Seeks to 2100/1000 = 2.1s

t = 4.100s: Device C sync_ping gets server position: 4100ms
            Audio is at 2.1 + 2.0 = 4.1s = 4100ms
            Drift = 0ms
            ✓ Perfect sync achieved

Total catch-up time: ~2 seconds (until next sync_ping)
```

---

## Part 6: Clock Offset Edge Cases

### What if Client is Behind Server Clock?

```
Example:
  Server: 1708000000000
  Client: 1708000000000 - 10 = 1708000000000 - 10ms (10ms behind)

Offset calculation: -10ms
Client offset = -10ms (negative)

Server broadcasts playback at: 1708000002000
Client converts: 1708000002000 + (-10) = 1708000001990

Client schedules 10ms earlier than server time.
This is fine! Web Audio API handles future timestamps.
```

### What if Offset Changes Over Time?

```
Initial offset: -5ms
After 30 minutes: +3ms (clock drifted)
Change: 8ms

If we don't re-sync NTP:
  Old scheduled timestamps now off by 8ms

Solution: Re-sync NTP every 10-30 seconds
  Keep offset updated
  Minimize drift accumulation
```

### Maximum Realistic Offset

```
On modern mobile devices:
  Typical clock drift: ±5ms per minute
  Initial measurement error: ±10ms
  Max expected offset: ±50ms

On gaming devices/high-end:
  Better oscillators: ±1-2ms per minute
  Max expected offset: ±20ms

Worst case (cheap hardware):
  Clock drift: ±10ms per minute
  Initial error: ±20ms
  Max expected offset: ±100ms

Verdict: ±50ms is safe design target
```

---

## Part 7: Summary Table

| Metric | Formula | Example | Notes |
|--------|---------|---------|-------|
| **RTT** | `clientReceiveTime - t0` | 10ms | Network round-trip |
| **One-Way Delay** | `RTT / 2` | 5ms | Estimated one-way |
| **Server Time** | `(t1 + t2) / 2` | 1708000000005 | Midpoint estimate |
| **Clock Offset** | `serverTime - (clientReceiveTime - RTT/2)` | -5ms | Client ahead of server |
| **Local Playback Time** | `scheduledStartTimeMs + offset` | 1708000001995 | Client time for scheduled event |
| **Position (Playing)** | `offsetMs + (now - startedAt)` | 5000ms | Current position when playing |
| **Position (Paused)** | `offsetMs` | 12500ms | Frozen position when paused |
| **Drift Detection** | `|serverPosition - localPosition|` | 45ms | If > threshold, seek |

---

## Conclusion

The synchronization system uses three core math concepts:

1. **NTP offset calculation** - Measures and compensates for clock differences
2. **Future timestamp scheduling** - Prevents network latency from causing desync
3. **Periodic drift correction** - Keeps audio position accurate over time

Together, these achieve **±50ms synchronization on typical LAN**, which is imperceptible to human hearing.
