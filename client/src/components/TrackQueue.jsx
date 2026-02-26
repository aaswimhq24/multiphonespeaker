/**
 * TrackQueue.jsx
 *
 * Pure presentational component for a BeatSync-style queue.
 * - No sockets, no hooks, no internal state. Props-only.
 *
 * Props:
 *   - tracks: Array of track objects { id, filename, title, artist }
 *   - currentIndex: number
 *   - isHost: boolean
 *   - onSelect: function(index)
 */
import React from "react";

export default function TrackQueue({ tracks = [], currentIndex = 0, isHost = false, onSelect = () => {} }) {
  return (
    <div className="w-full max-w-3xl mx-auto bg-slate-900/60 border border-slate-800 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-200">Queue</h3>
        <span className="text-xs text-slate-400">{tracks.length} tracks</span>
      </div>

      <ul className="divide-y divide-slate-800">
        {tracks.length === 0 && (
          <li className="py-6 text-center text-sm text-slate-500">No tracks in the queue</li>
        )}

        {tracks.map((track, index) => {
          const isCurrent = index === currentIndex;
          const title = track.filename || track.title || "Untitled";
          const subtitle = track.artist || track.album || "";

          return (
            <li
              key={track.id ?? `${title}-${index}`}
              className={`flex items-center justify-between gap-4 py-3 px-3 rounded-md transition-colors
                ${isCurrent ? "bg-gradient-to-r from-emerald-600/6 to-transparent" : "hover:bg-slate-800/50"}`}
            >
              <div className="flex items-center gap-3">
                <div
                  className={`w-2 h-8 rounded-full flex-shrink-0 ${isCurrent ? "bg-emerald-400" : "bg-slate-700/60"}`}
                  aria-hidden
                />

                <div className="min-w-0">
                  <div className={`text-sm font-medium truncate ${isCurrent ? "text-white" : "text-slate-200"}`}>{title}</div>
                  {subtitle && <div className="text-xs text-slate-400 truncate mt-0.5">{subtitle}</div>}
                </div>
              </div>

              <div className="flex items-center gap-3">
                {isCurrent && (
                  <span className="text-emerald-400 text-xs font-semibold">Now Playing</span>
                )}

                <button
                  type="button"
                  onClick={() => { if (isHost) onSelect(index); }}
                  disabled={!isHost}
                  className={`text-sm px-3 py-1 rounded-md font-medium transition-colors outline-none
                    ${isHost ? "text-emerald-400 hover:bg-emerald-600/10" : "text-slate-500 cursor-default"}`}
                  aria-pressed={isCurrent}
                  aria-label={isCurrent ? "Current track" : `Select track ${index + 1}`}
                >
                  {isHost ? "Select" : "—"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
