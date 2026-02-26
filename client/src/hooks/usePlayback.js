import { useEffect, useRef, useState } from "react";
import {
  loadAudioFile,
  schedulePlayback,
  stopPlayback,
  getCurrentTime,
  getPlaybackProgress,
  getDuration,
} from "../services/audioEngine";

export default function usePlayback(socket, roomCode) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [progress, setProgress] = useState(0);
  const [currentTrackIndex, setCurrentTrackIndex] = useState(-1);

  const playbackStartTimeRef = useRef(null);
  const playbackOffsetRef = useRef(0);
  const isFileLoadedRef = useRef(false);

  const SCHEDULE_AHEAD_SEC = 0.1;

  // ---------------- Progress Loop ----------------

  useEffect(() => {
    const interval = setInterval(() => {
      const time = getPlaybackProgress();
      setProgress(time);
    }, 200);

    return () => clearInterval(interval);
  }, []);

  // ---------------- Socket Listeners ----------------

  useEffect(() => {
    if (!socket) return;

    socket.on("track_selected", async ({ index, track }) => {
      setCurrentTrackIndex(index);

      stopPlayback();

      const fullUrl = `http://${window.location.hostname}:5000${track.fileUrl}`;
      const response = await fetch(fullUrl);
      const blob = await response.blob();
      const file = new File([blob], track.filename);

      await loadAudioFile(file);
      setDuration(getDuration());
      isFileLoadedRef.current = true;
    });

    socket.on("playback_scheduled", ({ scheduledStartTimeMs, roomTimeMs, serverTime }) => {
      if (!isFileLoadedRef.current) return;

      const nowClient = Date.now();
      const estimatedServerNow = serverTime + (nowClient - serverTime);

      const msUntilStart = scheduledStartTimeMs - estimatedServerNow;

      const startTimeSec =
        getCurrentTime() + Math.max(msUntilStart, 0) / 1000;

      const offsetSec = roomTimeMs / 1000;

      stopPlayback();
      schedulePlayback(startTimeSec, offsetSec);

      playbackStartTimeRef.current = startTimeSec;
      playbackOffsetRef.current = offsetSec;

      setIsPlaying(true);
    });

    socket.on("queue_updated", ({ queue }) => {
      setQueue(queue);
    });

    socket.on("playback_paused", () => {
      stopPlayback();
      setIsPlaying(false);
    });

    socket.on("track_seeked", ({ time }) => {
      stopPlayback();
      schedulePlayback(getCurrentTime() + SCHEDULE_AHEAD_SEC, time);
    });

    return () => {
      socket.off("track_selected");
      socket.off("playback_scheduled");
      socket.off("playback_paused");
      socket.off("track_seeked");
    };
  }, [socket]);

  // ---------------- Controls ----------------

  const play = () => {
    if (!socket || !roomCode) return;
    socket.emit("start_playback", { roomCode });
  };

  const pause = () => {
    if (!socket || !roomCode) return;
    socket.emit("pause_playback", { roomCode });
  };

  const next = () => {
    if (!socket || !roomCode) return;
    socket.emit("next_track", { roomCode });
  };

  const prev = () => {
    if (!socket || !roomCode) return;
    socket.emit("prev_track", { roomCode });
  };

  const seek = (time) => {
    if (!socket || !roomCode) return;
    socket.emit("seek_track", { roomCode, time });
  };

  const formatTime = (seconds) => {
    if (!seconds) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

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