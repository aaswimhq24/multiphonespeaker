import { useRef, useState } from "react";
import TopBar from "./components/TopBar";
import PlayerBar from "./components/PlayerBar";
import TrackQueue from "./components/TrackQueue";
import useSocket from "./hooks/useSocket";
import usePlayback from "./hooks/usePlayback";

const SERVER_URL = `http://${window.location.hostname}:5000`;

export default function App() {
  /* -------------------------------------------------------------------------- */
  /*                               Local State                                  */
  /* -------------------------------------------------------------------------- */

  const [username, setUsername] = useState("");
  const [roomInput, setRoomInput] = useState("");
  const fileInputRef = useRef(null);

  /* -------------------------------------------------------------------------- */
  /*                              Socket + Sync                                 */
  /* -------------------------------------------------------------------------- */

  const {
    socket,
    isConnected,
    roomCode,
    isAdmin,
    participants,
    queue,
    currentTrackIndex,
    createRoom,
    joinRoom,
    leaveRoom,
    addTrack,
    selectTrack,
  } = useSocket(SERVER_URL);

  const {
    isPlaying,
    duration,
    progress,
    play,
    pause,
    next,
    prev,
    seek,
    formatTime,
  } = usePlayback(socket, roomCode);

  /* -------------------------------------------------------------------------- */
  /*                                 Handlers                                   */
  /* -------------------------------------------------------------------------- */

  const handleCreateRoom = () => {
    if (!username.trim()) return;
    createRoom(username);
  };

  const handleJoinRoom = () => {
    if (!username.trim() || !roomInput.trim()) return;
    joinRoom(roomInput.trim().toUpperCase(), username);
  };

  const handleUpload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !roomCode) return;

    const formData = new FormData();
    formData.append("audio", file);

    const res = await fetch(`${SERVER_URL}/upload`, {
      method: "POST",
      body: formData,
    });

    const data = await res.json();
    if (!res.ok) return;

    addTrack({
      id: Date.now().toString(),
      filename: data.filename,
      fileUrl: data.fileUrl,
      durationMs: 0,
    });
  };

  /* -------------------------------------------------------------------------- */
  /*                                Home Screen                                 */
  /* -------------------------------------------------------------------------- */

  if (!roomCode) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 flex items-center justify-center p-6 text-white">
        <div className="w-full max-w-md backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl shadow-2xl p-8 space-y-6">
          <div className="text-center space-y-2">
            <h1 className="text-2xl font-semibold">MultiSync</h1>
            <p className="text-slate-400 text-sm">
              Real-time synchronized music rooms
            </p>
          </div>

          <input
            placeholder="Choose a username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-2 text-white placeholder:text-slate-400 outline-none"
          />

          <button
            onClick={handleCreateRoom}
            className="w-full bg-emerald-500 hover:bg-emerald-600 rounded-xl py-2 transition"
          >
            Create Room
          </button>

          <div className="flex gap-2">
            <input
              placeholder="Room Code"
              value={roomInput}
              onChange={(e) => setRoomInput(e.target.value)}
              className="flex-1 bg-white/10 border border-white/20 rounded-xl px-4 py-2 text-white placeholder:text-slate-400 outline-none"
            />
            <button
              onClick={handleJoinRoom}
              className="bg-white/20 hover:bg-white/30 rounded-xl px-4 transition"
            >
              Join
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* -------------------------------------------------------------------------- */
  /*                                 Room View                                  */
  /* -------------------------------------------------------------------------- */

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 p-6 text-white">
      <div className="max-w-4xl mx-auto space-y-6">
        <TopBar
          roomCode={roomCode}
          isConnected={isConnected}
          participants={participants}
          isAdmin={isAdmin}
          onLeave={leaveRoom}
        />

        <PlayerBar
          isPlaying={isPlaying}
          progress={progress}
          duration={duration}
          play={play}
          pause={pause}
          next={next}
          prev={prev}
          seek={seek}
          formatTime={formatTime}
        />

        {isAdmin && (
          <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl shadow-xl p-6 flex justify-center">
            <input
              type="file"
              accept="audio/*"
              ref={fileInputRef}
              hidden
              onChange={handleUpload}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="bg-emerald-500 hover:bg-emerald-600 rounded-xl px-6 py-2 transition"
            >
              Upload Track
            </button>
          </div>
        )}

        <TrackQueue
          queue={queue}
          currentTrackIndex={currentTrackIndex}
          isAdmin={isAdmin}
          selectTrack={selectTrack}
        />
      </div>
    </div>
  );
}
