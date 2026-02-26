/**
 * App.jsx
 *
 * Root coordinator component for BeatSync.
 *
 * Responsibilities (ONLY):
 *   - Manage view state  : "home" | "room"
 *   - Handle file upload : POST to /upload, then delegate to addTrack()
 *   - Render UI          : HomeView / RoomView
 *   - Pass props         : down to TopBar, TrackList, PlayerBar
 *
 * What this component does NOT do:
 *   - No socket.emit calls          → useSocket handles all realtime logic
 *   - No audio scheduling           → usePlayback handles all playback logic
 *   - No queue / room state         → owned by useSocket
 *   - No playback timing            → owned by usePlayback
 */

import React, { useRef, useState } from "react";
import useSocket from "./hooks/useSocket";
import usePlayback from "./hooks/usePlayback";
import TopBar from "./components/TopBar";
import TrackQueue from "./components/TrackQueue";
import PlayerBar from "./components/PlayerBar";
import "./App.css";

const UPLOAD_URL = `http://${window.location.hostname}:5000/upload`;

export default function App() {
  // ── Realtime room state (socket, participants, queue, room actions) ─────────
  const {
    socket,
    isConnected,
    participants,
    queue,
    roomCode,
    isHost,
    isAdmin,
    createRoom,
    joinRoom,
    leaveRoom,
    addTrack,
    selectTrack,
  } = useSocket();

  // ── Playback state + controls (audio engine + server emits) ────────────────
  const {
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
  } = usePlayback(socket, roomCode);

  // ── Local UI state ──────────────────────────────────────────────────────────
  const [view, setView]                 = useState("home");   // "home" | "room"
  const [joinCodeInput, setJoinCodeInput] = useState("");
  const [isUploading, setIsUploading]   = useState(false);
  const [uploadError, setUploadError]   = useState(null);
  const fileInputRef                    = useRef(null);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleCreateRoom = () => {
    createRoom();
    setView("room");
  };

  const handleJoinRoom = () => {
    const code = joinCodeInput.trim().toUpperCase();
    if (!code) return;
    joinRoom(code);
    setView("room");
  };

  const handleLeaveRoom = () => {
    leaveRoom();
    setJoinCodeInput("");
    setUploadError(null);
    setView("home");
  };

  /**
   * Upload an audio file to the server, then add it to the room queue.
   * All socket work is delegated to addTrack() from useSocket.
   */
  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];
    // Reset input so the same file can be re-selected if needed
    event.target.value = "";
    if (!file) return;

    setIsUploading(true);
    setUploadError(null);

    try {
      const formData = new FormData();
      formData.append("audio", file);

      const response = await fetch(UPLOAD_URL, {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        setUploadError(data?.error || "Upload failed.");
        return;
      }

      addTrack({
        id: Date.now().toString(),
        filename: data.filename,
        fileUrl: data.fileUrl,
        durationMs: 0,
      });
    } catch (err) {
      console.error("[App] Upload error:", err);
      setUploadError("Could not reach the server.");
    } finally {
      setIsUploading(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="min-h-screen bg-slate-950 text-white">

      {/* ================================================================== */}
      {/* HOME VIEW                                                           */}
      {/* ================================================================== */}
      {view === "home" && (
        <div className="flex items-center justify-center min-h-screen px-4">
          <div className="space-y-6 w-full max-w-md">

            {/* App title */}
            <div className="text-center mb-8">
              <h1 className="text-3xl font-bold tracking-tight">BeatSync</h1>
              <p className="text-slate-400 text-sm mt-1">
                Synchronized music for every room
              </p>
            </div>

            {/* Create room */}
            <button
              onClick={handleCreateRoom}
              className="w-full bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700
                         py-3 rounded-xl font-semibold transition-colors"
            >
              Create Room
            </button>

            {/* Join room */}
            <div className="flex gap-3">
              <input
                value={joinCodeInput}
                onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === "Enter" && handleJoinRoom()}
                maxLength={4}
                className="flex-1 px-4 py-3 bg-slate-800 rounded-xl
                           tracking-widest text-center font-mono uppercase
                           placeholder:normal-case placeholder:tracking-normal
                           focus:outline-none focus:ring-2 focus:ring-emerald-500"
                placeholder="Room Code"
              />
              <button
                onClick={handleJoinRoom}
                disabled={!joinCodeInput.trim()}
                className="bg-slate-700 hover:bg-slate-600 active:bg-slate-800
                           disabled:opacity-40 disabled:cursor-not-allowed
                           px-5 rounded-xl font-semibold transition-colors"
              >
                Join
              </button>
            </div>

          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* ROOM VIEW                                                           */}
      {/* ================================================================== */}
      {view === "room" && (
        <div className="flex flex-col min-h-screen p-6">

          {/* Top bar: room code, participants, connection status, leave */}
          <TopBar
            roomCode={roomCode}
            participants={participants}
            isConnected={isConnected}
            onLeave={handleLeaveRoom}
          />

          {/* Upload controls — host only */}
          {isHost && (
            <div className="mb-4">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700
                           disabled:opacity-50 disabled:cursor-not-allowed
                           px-4 py-2 rounded-lg font-semibold transition-colors"
              >
                {isUploading ? "Uploading…" : "+ Upload Track"}
              </button>

              {uploadError && (
                <p className="mt-2 text-sm text-red-400">{uploadError}</p>
              )}

              {/* Hidden file input — triggered by the button above */}
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*"
                onChange={handleFileChange}
                className="hidden"
              />
            </div>
          )}

          {/* Track queue list */}
          <TrackQueue
            tracks={queue}
            currentIndex={currentTrackIndex}
            isHost={isHost}
            onSelect={selectTrack}
          />

          {/* Playback controls */}
          <PlayerBar
            currentTrack={queue[currentTrackIndex]}
            isPlaying={isPlaying}
            duration={duration}
            progress={progress}
            onPlayPause={isPlaying ? pause : play}
            onPrev={prev}
            onNext={next}
            onSeek={seek}
            formatTime={formatTime}
          />

        </div>
      )}

    </div>
  );
}
