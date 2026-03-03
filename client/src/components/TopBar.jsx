import { useState } from "react";
import { Settings, Users, Wifi, WifiOff, LogOut } from "lucide-react";

export default function TopBar({
  roomCode,
  isConnected,
  participants = [],
  isAdmin,
  onLeave,
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Top Bar */}
      <div className="flex items-center justify-between backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl px-6 py-4 shadow-xl">
        <div>
          <p className="text-xs text-slate-400 tracking-wide">ROOM</p>
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold tracking-widest">
              {roomCode}
            </h2>

            <div className="flex items-center gap-1 text-xs">
              {isConnected ? (
                <>
                  <Wifi className="w-4 h-4 text-emerald-400" />
                  <span className="text-emerald-400">Connected</span>
                </>
              ) : (
                <>
                  <WifiOff className="w-4 h-4 text-red-400" />
                  <span className="text-red-400">Disconnected</span>
                </>
              )}
            </div>
          </div>
        </div>

        <button
          onClick={() => setOpen(true)}
          className="p-3 rounded-xl bg-white/10 hover:bg-white/20 transition"
        >
          <Settings className="w-5 h-5" />
        </button>
      </div>

      {/* Settings Panel */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md bg-slate-900 border border-white/10 rounded-2xl shadow-2xl p-6 space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Room Settings</h3>
              <button
                onClick={() => setOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            {/* Participants */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-slate-400">
                <Users className="w-4 h-4 text-emerald-400" />
                <span>Participants ({participants.length})</span>
              </div>

              <div className="space-y-2 max-h-48 overflow-y-auto">
                {participants.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between bg-white/5 px-3 py-2 rounded-lg text-sm"
                  >
                    <span>
                      {p.name} {p.isAdmin && "(Admin)"}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Leave Button */}
            <button
              onClick={() => {
                setOpen(false);
                onLeave?.();
              }}
              className="w-full flex items-center justify-center gap-2 bg-red-500 hover:bg-red-600 transition rounded-xl py-2"
            >
              <LogOut className="w-4 h-4" />
              Leave Room
            </button>
          </div>
        </div>
      )}
    </>
  );
}