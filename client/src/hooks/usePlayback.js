import { useCallback, useEffect, useRef, useState } from "react";
import {
  loadAudioFile,
  schedulePlayback,
  stopPlayback,
  getCurrentTime,
  getPlaybackProgress,
  getDuration,
} from "../services/audioEngine";

// Small safety buffer to avoid scheduling too close to currentTime
const MIN_SCHEDULE_AHEAD_MS = 50;

export default function usePlayback(socket, roomCode) {
  /* -------------------------------------------------------------------------- */
  /*                                  State                                     */
  /* -------------------------------------------------------------------------- */

  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [progress, setProgress] = useState(0);
  const [currentTrackIndex, setCurrentTrackIndex] = useState(-1);

  const isFileLoadedRef = useRef(false);
  const driftCheckIntervalRef = useRef(null);

  /* -------------------------------------------------------------------------- */
  /*                           Progress Polling Loop                            */
  /* -------------------------------------------------------------------------- */

  useEffect(() => {
    const interval = setInterval(() => {
      setProgress(getPlaybackProgress());
    }, 200);

    return () => clearInterval(interval);
  }, []);

  /* -------------------------------------------------------------------------- */
  /*                              Drift Correction                              */
  /* -------------------------------------------------------------------------- */

  const startDriftCorrection = useCallback(() => {
    clearInterval(driftCheckIntervalRef.current);

    driftCheckIntervalRef.current = setInterval(() => {
      if (!isPlaying) return;

      const actual = getPlaybackProgress();
      const expected = progress;

      const driftMs = Math.abs(actual - expected) * 1000;

      // If drift exceeds 120ms, correct
      if (driftMs > 120) {
        stopPlayback();
        schedulePlayback(getCurrentTime() + 0.1, actual);
      }
    }, 3000);
  }, [isPlaying, progress]);

  /* -------------------------------------------------------------------------- */
  /*                               Socket Events                                */
  /* -------------------------------------------------------------------------- */

  useEffect(() => {
    if (!socket) return;

    /* ----------------------------- Track Selected ---------------------------- */

    const onTrackSelected = async ({ index, track }) => {
      setCurrentTrackIndex(index);
      stopPlayback();
      setIsPlaying(false);
      setProgress(0);
      isFileLoadedRef.current = false;

      try {
        const fullUrl = `http://${window.location.hostname}:5000${track.fileUrl}`;
        const response = await fetch(fullUrl);

        if (!response.ok) throw new Error("Failed to fetch audio file");

        const arrayBuffer = await response.arrayBuffer();
        await loadAudioFile(arrayBuffer);

        setDuration(getDuration());
        isFileLoadedRef.current = true;
      } catch (err) {
        console.error("Audio load failed:", err);
      }
    };

    /* -------------------------- Playback Scheduled -------------------------- */

    const onPlaybackScheduled = ({
      scheduledStartTimeMs,
      roomTimeMs,
      serverTime,
    }) => {
      if (!isFileLoadedRef.current) return;

      const nowClient = Date.now();

      // Estimate one-way delay
      const oneWayDelay = (nowClient - serverTime) / 2;

      const estimatedServerNow = serverTime + oneWayDelay;

      let msUntilStart = scheduledStartTimeMs - estimatedServerNow;

      if (msUntilStart < MIN_SCHEDULE_AHEAD_MS) {
        msUntilStart = MIN_SCHEDULE_AHEAD_MS;
      }

      const startTimeSec =
        getCurrentTime() + msUntilStart / 1000;

      const offsetSec = roomTimeMs / 1000;

      stopPlayback();
      schedulePlayback(startTimeSec + 0.2, offsetSec);

      setIsPlaying(true);
      startDriftCorrection();
    };

    /* ----------------------------- Playback Paused --------------------------- */

    const onPlaybackPaused = () => {
      stopPlayback();
      setIsPlaying(false);
      clearInterval(driftCheckIntervalRef.current);
    };

    socket.on("track_selected", onTrackSelected);
    socket.on("playback_scheduled", onPlaybackScheduled);
    socket.on("playback_paused", onPlaybackPaused);

    return () => {
      socket.off("track_selected", onTrackSelected);
      socket.off("playback_scheduled", onPlaybackScheduled);
      socket.off("playback_paused", onPlaybackPaused);
      clearInterval(driftCheckIntervalRef.current);
    };
  }, [socket, startDriftCorrection]);

  /* -------------------------------------------------------------------------- */
  /*                               Playback Controls                            */
  /* -------------------------------------------------------------------------- */

  const play = useCallback(() => {
    if (!socket || !roomCode) return;
    socket.emit("start_playback", { roomCode });
  }, [socket, roomCode]);

  const pause = useCallback(() => {
    if (!socket || !roomCode) return;
    socket.emit("pause_playback", { roomCode });
  }, [socket, roomCode]);

  const next = useCallback(() => {
    if (!socket || !roomCode) return;
    socket.emit("next_track", { roomCode });
  }, [socket, roomCode]);

  const prev = useCallback(() => {
    if (!socket || !roomCode) return;
    socket.emit("prev_track", { roomCode });
  }, [socket, roomCode]);

  const seek = useCallback(
    (time) => {
      if (!socket || !roomCode) return;
      socket.emit("seek_track", { roomCode, time });
    },
    [socket, roomCode]
  );

  const formatTime = (seconds) => {
    if (!seconds || seconds < 0) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  /* -------------------------------------------------------------------------- */
  /*                                 Public API                                 */
  /* -------------------------------------------------------------------------- */

  return {
    isPlaying,
    duration,
    progress,
    currentTrackIndex,
    play,
    pause,
    next,
    prev,
    seek,
    formatTime,
  };
}
