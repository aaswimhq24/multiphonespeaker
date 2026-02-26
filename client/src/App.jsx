import React, { useRef, useState } from "react";
import useSocket from "./hooks/useSocket";
import usePlayback from "./hooks/usePlayback";
import TopBar from "./components/TopBar";
import TrackList from "./components/TrackList";
import PlayerBar from "./components/PlayerBar";
import "./App.css";

function App() {
  const {
    socket,
    isConnected,
    participants,
    queue,
    roomCode,
    isHost,
    createRoom,
    joinRoom,
    leaveRoom,
    addTrack,
    selectTrack,
  } = useSocket();

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

  const [view, setView] = useState("home");
  const [joinCodeInput, setJoinCodeInput] = useState("");
  const fileInputRef = useRef(null);

  // ---------------- Upload ----------------

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("audio", file);

    const response = await fetch(
      `http://${window.location.hostname}:5000/upload`,
      {
        method: "POST",
        body: formData,
      }
    );

    const data = await response.json();
    if (!response.ok) return;

    addTrack({
      id: Date.now().toString(),
      filename: data.filename,
      fileUrl: data.fileUrl,
      durationMs: 0,
    });
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white">

      {/* ---------------- HOME ---------------- */}
      {view === "home" && (
        <div className="flex items-center justify-center min-h-screen">
          <div className="space-y-6 w-full max-w-md">

            <button
              onClick={() => {
                createRoom();
                setView("room");
              }}
              className="w-full bg-emerald-600 py-3 rounded-xl"
            >
              Create Room
            </button>

            <div className="flex gap-3">
              <input
                value={joinCodeInput}
                onChange={(e) => setJoinCodeInput(e.target.value)}
                className="flex-1 px-4 py-3 bg-slate-800 rounded-xl"
                placeholder="Room Code"
              />
              <button
                onClick={() => {
                  joinRoom(joinCodeInput);
                  setView("room");
                }}
                className="bg-slate-700 px-5 rounded-xl"
              >
                Join
              </button>
            </div>

          </div>
        </div>
      )}

      {/* ---------------- ROOM ---------------- */}
      {view === "room" && (
        <div className="p-6">

          <TopBar
            roomCode={roomCode}
            participants={participants}
            isConnected={isConnected}
            onLeave={() => {
              leaveRoom();
              setView("home");
            }}
          />

          {isHost && (
            <>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="mb-4 bg-emerald-600 px-4 py-2 rounded-lg"
              >
                + Upload Track
              </button>

              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*"
                onChange={handleFileChange}
                className="hidden"
              />
            </>
          )}
          <TrackList
            tracks={queue}
            currentIndex={currentTrackIndex}
            isHost={isHost}
            onSelect={selectTrack}
          />

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

export default App;