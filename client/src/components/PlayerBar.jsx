import React from "react";

function PlayerBar({
  currentTrack,
  isPlaying,
  duration,
  progress,
  onPlayPause,
  onPrev,
  onNext,
  onSeek,
  formatTime,
}) {
  const displayName = currentTrack?.filename || currentTrack?.title || "No Track Selected";

  return (
    <div className="fixed bottom-4 left-4 right-4 md:left-8 md:right-8 bg-slate-900/72 backdrop-blur-sm border border-slate-800 rounded-xl p-4 flex flex-col gap-3 z-50">

      <div className="w-full flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-md bg-gradient-to-br from-slate-700 to-slate-800 flex items-center justify-center text-sm text-slate-300 font-semibold">
            {String(displayName || "-").charAt(0).toUpperCase()}
          </div>

          <div className="min-w-0">
            <div className="text-sm font-medium text-white truncate">{displayName}</div>
            <div className="text-xs text-slate-400 truncate">{currentTrack?.artist || ""}</div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onPrev}
            className="p-2 rounded-md text-slate-300 hover:bg-slate-800/50"
            aria-label="Previous"
          >
            ⏮
          </button>

          <button
            type="button"
            onClick={onPlayPause}
            className="w-12 h-12 rounded-lg bg-emerald-400 text-slate-900 flex items-center justify-center text-lg font-semibold shadow-md hover:scale-105 transition-transform"
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? "⏸" : "▶"}
          </button>

          <button
            type="button"
            onClick={onNext}
            className="p-2 rounded-md text-slate-300 hover:bg-slate-800/50"
            aria-label="Next"
          >
            ⏭
          </button>
        </div>
      </div>

      <div className="w-full flex flex-col gap-1">
        <input
          type="range"
          min={0}
          max={duration ?? 0}
          step="0.01"
          value={progress ?? 0}
          onChange={(e) => onSeek(Number(e.target.value))}
          className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer"
          aria-label="Seek"
        />

        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>{formatTime ? formatTime(progress ?? 0) : "0:00"}</span>
          <span>{formatTime ? formatTime(duration ?? 0) : "0:00"}</span>
        </div>
      </div>

    </div>
  );
}

export default PlayerBar;