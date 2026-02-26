/**
 * useSocket.js
 *
 * Single source of truth for all real-time room state in BeatSync.
 *
 * Responsibilities:
 *  - Owns the ONE socket instance (created once, cleaned up on unmount)
 *  - Tracks connection state
 *  - Manages room lifecycle  : create / join / leave
 *  - Manages queue state     : add track, receive queue_updated
 *  - Exposes playback emits  : start, pause, next, prev, seek, selectTrack
 *
 * What this hook does NOT do:
 *  - No audio scheduling / timing logic  → usePlayback.js
 *  - No UI rendering                     → components
 *  - No duplicate socket instances       → single io() call inside useEffect
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SOCKET_URL =
  import.meta.env.VITE_SOCKET_URL || `http://${window.location.hostname}:5000`;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export default function useSocket() {
  // ── Connection ────────────────────────────────────────────────────────────
  const socketRef = useRef(null);
  const [isConnected, setIsConnected] = useState(false);

  // ── Room ──────────────────────────────────────────────────────────────────
  const [roomCode, setRoomCode]     = useState(null);
  const [isHost, setIsHost]         = useState(false);
  const [isAdmin, setIsAdmin]       = useState(false);
  const [participants, setParticipants] = useState([]);

  // ── Queue ─────────────────────────────────────────────────────────────────
  const [queue, setQueue] = useState([]);

  // Keep a stable ref to roomCode so callbacks never close over a stale value
  const roomCodeRef = useRef(null);
  useEffect(() => {
    roomCodeRef.current = roomCode;
  }, [roomCode]);

  // ---------------------------------------------------------------------------
  // Socket initialisation — runs ONCE on mount
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const socket = io(SOCKET_URL, {
      autoConnect: true,
      reconnectionAttempts: 5,
    });

    socketRef.current = socket;

    // ── Connection state ────────────────────────────────────────────────────
    socket.on("connect", () => {
      setIsConnected(true);
    });

    socket.on("disconnect", () => {
      setIsConnected(false);
    });

    socket.on("connect_error", (err) => {
      console.error("[useSocket] connect_error:", err.message);
      setIsConnected(false);
    });

    // ── Room events ─────────────────────────────────────────────────────────

    /**
     * Emitted by the server whenever the participant list changes.
     * Payload: Array<{ id, name, isAdmin }>
     */
    socket.on("room_participants", (list) => {
      setParticipants(list);
    });

    /**
     * Emitted when the admin role is transferred (e.g. previous admin left).
     * Payload: { roomCode, adminId }
     */
    socket.on("room_admin_changed", ({ adminId }) => {
      setIsAdmin(socket.id === adminId);
    });

    // ── Queue events ────────────────────────────────────────────────────────

    /**
     * Emitted by the server after any queue mutation (add / reorder).
     * Payload: { queue: Array<{ id, filename, fileUrl, durationMs }> }
     */
    socket.on("queue_updated", ({ queue: updatedQueue }) => {
      setQueue(updatedQueue);
    });

    // ── Cleanup on unmount ──────────────────────────────────────────────────
    return () => {
      socket.off("connect");
      socket.off("disconnect");
      socket.off("connect_error");
      socket.off("room_participants");
      socket.off("room_admin_changed");
      socket.off("queue_updated");
      socket.disconnect();
    };
  }, []); // ← empty deps: socket is created exactly once

  // ---------------------------------------------------------------------------
  // Room management
  // ---------------------------------------------------------------------------

  /**
   * Create a new room.
   * Server ack: { ok, roomCode, isHost, adminId }
   */
  const createRoom = useCallback(() => {
    const socket = socketRef.current;
    if (!socket) return;

    socket.emit("create_room", (res) => {
      if (!res?.ok) {
        console.error("[useSocket] create_room failed:", res?.error);
        return;
      }

      setRoomCode(res.roomCode);
      setIsHost(res.isHost ?? true);
      setIsAdmin(res.adminId === socket.id);
    });
  }, []);

  /**
   * Join an existing room by code.
   * Server ack: { ok, roomCode, isHost, isAdmin, queue, currentTrackIndex, playback }
   *
   * @param {string} code  - The 4-character room code
   */
  const joinRoom = useCallback((code) => {
    const socket = socketRef.current;
    if (!socket || !code) return;

    socket.emit("join_room", { roomCode: code }, (res) => {
      if (!res?.ok) {
        console.error("[useSocket] join_room failed:", res?.error);
        return;
      }

      setRoomCode(res.roomCode);
      setIsHost(res.isHost ?? false);
      setIsAdmin(res.isAdmin ?? false);

      if (Array.isArray(res.queue)) {
        setQueue(res.queue);
      }
    });
  }, []);

  /**
   * Leave the current room.
   * Server ack: { ok }
   */
  const leaveRoom = useCallback(() => {
    const socket = socketRef.current;
    const code   = roomCodeRef.current;
    if (!socket || !code) return;

    socket.emit("leave_room", { roomCode: code }, (res) => {
      if (res && !res.ok) {
        console.error("[useSocket] leave_room failed:", res.error);
      }
    });

    // Reset local state immediately for snappy UX
    setRoomCode(null);
    setIsHost(false);
    setIsAdmin(false);
    setParticipants([]);
    setQueue([]);
  }, []);

  // ---------------------------------------------------------------------------
  // Queue management
  // ---------------------------------------------------------------------------

  /**
   * Add a track to the room queue.
   * Server broadcasts queue_updated to all room members.
   *
   * @param {{ id: string, filename: string, fileUrl: string, durationMs: number }} track
   */
  const addTrack = useCallback((track) => {
    const socket = socketRef.current;
    const code   = roomCodeRef.current;
    if (!socket || !code) return;

    socket.emit("queue_add", { roomCode: code, track }, (res) => {
      if (res && !res.ok) {
        console.error("[useSocket] queue_add failed:", res.error);
      }
    });
  }, []);

  /**
   * Select a track from the queue by index.
   * Server broadcasts track_selected to all room members.
   *
   * @param {number} index - Zero-based index into the queue array
   */
  const selectTrack = useCallback((index) => {
    const socket = socketRef.current;
    const code   = roomCodeRef.current;
    if (!socket || !code) return;

    socket.emit("select_track", { roomCode: code, index });
  }, []);

  // ---------------------------------------------------------------------------
  // Playback control emits
  // ---------------------------------------------------------------------------

  /**
   * Tell the server to schedule playback for all room members.
   */
  const startPlayback = useCallback(() => {
    const socket = socketRef.current;
    const code   = roomCodeRef.current;
    if (!socket || !code) return;

    socket.emit("start_playback", { roomCode: code });
  }, []);

  /**
   * Tell the server to pause playback for all room members.
   */
  const pausePlayback = useCallback(() => {
    const socket = socketRef.current;
    const code   = roomCodeRef.current;
    if (!socket || !code) return;

    socket.emit("pause_playback", { roomCode: code });
  }, []);

  /**
   * Tell the server to advance to the next track.
   */
  const nextTrack = useCallback(() => {
    const socket = socketRef.current;
    const code   = roomCodeRef.current;
    if (!socket || !code) return;

    socket.emit("next_track", { roomCode: code });
  }, []);

  /**
   * Tell the server to go back to the previous track.
   */
  const prevTrack = useCallback(() => {
    const socket = socketRef.current;
    const code   = roomCodeRef.current;
    if (!socket || !code) return;

    socket.emit("prev_track", { roomCode: code });
  }, []);

  /**
   * Tell the server to seek to a specific position.
   *
   * @param {number} time - Seek position in seconds
   */
  const seekTrack = useCallback((time) => {
    const socket = socketRef.current;
    const code   = roomCodeRef.current;
    if (!socket || !code) return;

    socket.emit("seek_track", { roomCode: code, time });
  }, []);

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  return {
    // Raw socket (passed to usePlayback for its own listeners)
    socket: socketRef.current,

    // Connection
    isConnected,

    // Room state
    roomCode,
    isHost,
    isAdmin,
    participants,

    // Queue state
    queue,

    // Room actions
    createRoom,
    joinRoom,
    leaveRoom,

    // Queue actions
    addTrack,
    selectTrack,

    // Playback emits
    startPlayback,
    pausePlayback,
    nextTrack,
    prevTrack,
    seekTrack,
  };
}
