import { Music, Crown } from "lucide-react";

export default function TrackQueue({
  queue = [],
  currentTrackIndex,
  isAdmin,
  selectTrack,
}) {
  return (
    <div className="w-full backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl shadow-2xl p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Queue</h3>
        <span className="text-sm text-slate-400">
          {queue.length} {queue.length === 1 ? "track" : "tracks"}
        </span>
      </div>

      {/* Empty State */}
      {queue.length === 0 && (
        <div className="text-center text-slate-400 py-8 text-sm">
          No tracks in the queue
        </div>
      )}

      {/* Track List */}
      <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
        {queue.map((track, index) => {
          const isActive = index === currentTrackIndex;

          return (
            <div
              key={track.id}
              onClick={() => isAdmin && selectTrack?.(index)}
              className={`
                flex items-center justify-between
                px-4 py-3 rounded-xl
                transition cursor-pointer
                ${
                  isActive
                    ? "bg-emerald-500/20 border border-emerald-400/40"
                    : "bg-white/5 hover:bg-white/10"
                }
              `}
            >
              <div className="flex items-center gap-3">
                <div
                  className={`
                    p-2 rounded-lg
                    ${
                      isActive
                        ? "bg-emerald-500/30"
                        : "bg-white/10"
                    }
                  `}
                >
                  <Music className="w-4 h-4 text-emerald-400" />
                </div>

                <div className="flex flex-col">
                  <span className="text-sm font-medium truncate max-w-[200px]">
                    {track.filename}
                  </span>
                  <span className="text-xs text-slate-400">
                    #{index + 1}
                  </span>
                </div>
              </div>

              {isActive && (
                <div className="text-emerald-400 text-xs font-semibold">
                  Playing
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Admin Hint */}
      {isAdmin && queue.length > 0 && (
        <div className="text-xs text-slate-400 text-center pt-2">
          Tap a track to select it
        </div>
      )}
    </div>
  );
}
