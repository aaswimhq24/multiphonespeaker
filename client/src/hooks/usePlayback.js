/**
 * usePlayback.js
 *
 * Client-side playback controller for BeatSync-style synchronized music.
 *
 * Consumes:
 *   socket    — the Socket.io instance owned by useSocket
 *   roomCode  — current room identifier
 *
 * Responsibilities:
 *   - Listen to server-driven playback events and drive the Web Audio engine:
 *       track_selected      → fetch + decode audio file, reset state
 *       playback_scheduled  → schedule synchronized audio start
 *       playback_paused     → stop audio engine
 *       track_seeked        → jump to new position
 *   - Poll the audio engine for progress updates (200 ms interval)
 *   - Expose playback control functions that emit to the server:
 *       play / pause / next / prev / seek
 *
 * What this hook does NOT do:
 *   - No socket creation          → useSocket.js
 *   - No queue / room state       → useSocket.js
 *   - No DOM manipulation
 *   - No room creation logic
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  loadAudioFile,
  schedulePlayback,
  stopPlayback,
  getCurrentTime,
  getPlaybackProgress,
  getDuration,
} from "../services/audioEngine";

// How far ahead (in seconds) to schedule audio relative to AudioContext.currentTime
const SCHEDULE_AHEAD_SEC = 0.1;

export default function usePlayback(socket, roomCode) {
  // ── Playback state ─────────────────────────────────────────────────────────
  const [isPlaying, setIsPlaying]                 = useState(false);
  const [duration, setDuration]                   = useState(0);
  const [progress, setProgress]                   = useState(0);
  const [currentTrackIndex, setCurrentTrackIndex] = useState(-1);

  // True once the audio file for the current track has been decoded and is ready
  const isFileLoadedRef = useRef(false);

  // Stable ref so emit callbacks never close over a stale roomCode
  const roomCodeRef = useRef(roomCode);
  useEffect(() => {
    roomCodeRef.current = roomCode;
  }, [roomCode]);

  // ---------------------------------------------------------------------------
  // Progress polling loop — runs independently of socket
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const interval = setInterval(() => {
      setProgress(getPlaybackProgress());
    }, 200);

    return () => clearInterval(interval);
  }, []);

  // ---------------------------------------------------------------------------
  // Socket listeners
  // Re-registered whenever the socket reference changes (e.g. reconnect).
  // Named handler references are used so socket.off() removes the exact listener.
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!socket) return;

    // ── track_selected ───────────────────────────────────────────────────────
    // Emitted by server when admin calls select_track / next_track / prev_track.
    // Payload: { index: number, track: { filename, fileUrl, durationMs } }
    const onTrackSelected = async ({ index, track }) => {
      setCurrentTrackIndex(index);
      stopPlayback();
      setIsPlaying(false);
      setProgress(0);
      isFileLoadedRef.current = false;

      try {
        const fullUrl = `http://${window.location.hostname}:5000${track.fileUrl}`;
        const response = await fetch(fullUrl);
        const blob     = await response.blob();
        const file     = new File([blob], track.filename);

        await loadAudioFile(file);
        setDuration(getDuration());
        isFileLoadedRef.current = true;
      } catch (err) {
        console.error("[usePlayback] Failed to load track:", err);
      }
    };

    // ── playback_scheduled ───────────────────────────────────────────────────
    // Emitted by server after start_playback is processed.
    // Payload: { scheduledStartTimeMs, roomTimeMs, serverTime }
    //
    // BeatSync sync math:
    //   msUntilStart = scheduledStartTimeMs − estimatedServerNow
    //   startTimeSec = AudioContext.currentTime + max(msUntilStart, 0) / 1000
    //   offsetSec    = roomTimeMs / 1000   (resume position)
    const onPlaybackScheduled = ({ scheduledStartTimeMs, roomTimeMs, serverTime }) => {
      if (!isFileLoadedRef.current) return;

      const nowClient    = Date.now();
      // Compensate for one-way network delay using the server timestamp echo
      const estimatedServerNow = serverTime + (nowClient - serverTime);
      const msUntilStart       = scheduledStartTimeMs - estimatedServerNow;
      const startTimeSec       = getCurrentTime() + Math.max(msUntilStart, 0) / 1000;
      const offsetSec          = roomTimeMs / 1000;

      stopPlayback();
      schedulePlayback(startTimeSec, offsetSec);
      setIsPlaying(true);
    };

    // ── playback_paused ──────────────────────────────────────────────────────
    // Emitted by server after pause_playback is processed.
    // Payload: { roomCode, roomTimeMs, serverTime }
    const onPlaybackPaused = () => {
      stopPlayback();
      setIsPlaying(false);
    };

    // ── track_seeked ─────────────────────────────────────────────────────────
    // Emitted by server after seek_track is processed.
    // Payload: { time } — new position in seconds
    const onTrackSeeked = ({ time }) => {
      stopPlayback();
      schedulePlayback(getCurrentTime() + SCHEDULE_AHEAD_SEC, time);
    };

    socket.on("track_selected",     onTrackSelected);
    socket.on("playback_scheduled", onPlaybackScheduled);
    socket.on("playback_paused",    onPlaybackPaused);
    socket.on("track_seeked",       onTrackSeeked);

    return () => {
      socket.off("track_selected",     onTrackSelected);
      socket.off("playback_scheduled", onPlaybackScheduled);
      socket.off("playback_paused",    onPlaybackPaused);
      socket.off("track_seeked",       onTrackSeeked);
    };
  }, [socket]);

  // ---------------------------------------------------------------------------
  // Playback control — emit to server; server broadcasts back to all clients
  // Guards: no-op if socket or roomCode is unavailable
  // ---------------------------------------------------------------------------

  /** Request the server to schedule synchronized playback for the whole room. */
  const play = useCallback(() => {
    if (!socket || !roomCodeRef.current) return;
    socket.emit("start_playback", { roomCode: roomCodeRef.current });
  }, [socket]);

  /** Request the server to pause playback for the whole room. */
  const pause = useCallback(() => {
    if (!socket || !roomCodeRef.current) return;
    socket.emit("pause_playback", { roomCode: roomCodeRef.current });
  }, [socket]);

  /** Request the server to advance to the next track. */
  const next = useCallback(() => {
    if (!socket || !roomCodeRef.current) return;
    socket.emit("next_track", { roomCode: roomCodeRef.current });
  }, [socket]);

  /** Request the server to go back to the previous track. */
  const prev = useCallback(() => {
    if (!socket || !roomCodeRef.current) return;
    socket.emit("prev_track", { roomCode: roomCodeRef.current });
  }, [socket]);

  /**
   * Request the server to seek to a specific position.
   * @param {number} time — seek target in seconds
   */
  const seek = useCallback((time) => {
    if (!socket || !roomCodeRef.current) return;
    socket.emit("seek_track", { roomCode: roomCodeRef.current, time });
  }, [socket]);

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  const formatTime = (seconds) => {
    if (!seconds || seconds < 0) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  return {
    // State
    isPlaying,
    duration,
    progress,
    currentTrackIndex,

    // Controls (emit to server → server broadcasts → all clients react)
    play,
    pause,
    next,
    prev,
    seek,

    // Utility
    formatTime,
  };
}
