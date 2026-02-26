import React from "react";

function TopBar({ roomCode = "----", participants = [], isConnected = false, onLeave = () => {} }) {
  const badgeClass = isConnected ? "bg-emerald-600 text-emerald-50" : "bg-amber-600 text-amber-50";

  return (
    <header className="flex items-center justify-between mb-6 bg-slate-900/40 border border-slate-800 rounded-lg p-3">

      <div className="flex items-center gap-4 min-w-0">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400">Room</span>
            <button
              type="button"
              onClick={() => { try { navigator.clipboard?.writeText(roomCode); } catch (e) { /* noop */ } }}
              className="font-mono tracking-widest text-sm text-white bg-slate-800/40 px-2 py-1 rounded-md hover:bg-slate-800/60"
              aria-label="Copy room code"
            >
              {roomCode}
            </button>
          </div>

          <div className="mt-2 text-xs text-slate-400 flex items-center gap-3">
            <span>Users: <span className="text-slate-200 font-medium">{participants.length}</span></span>
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs ${badgeClass}`}>
              {isConnected ? "Connected" : "Disconnected"}
            </span>
          </div>
        </div>
      </div>

      <div>
        <button
          onClick={onLeave}
          className="bg-red-600 hover:bg-red-500 px-3 py-1 rounded-md text-sm font-semibold"
        >
          Leave
        </button>
      </div>

    </header>
  );
}

export default TopBar;