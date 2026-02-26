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
  return (
    <div className="fixed bottom-0 left-0 right-0 bg-slate-900 p-6 border-t border-slate-800">

      <div className="text-center mb-3">
        {currentTrack?.filename || "No Track Selected"}
      </div>

      <div className="flex justify-center gap-8 mb-4">
        <button onClick={onPrev}>⏮</button>

        <button
          onClick={onPlayPause}
          className="w-14 h-14 bg-white text-black rounded-md"
        >
          {isPlaying ? "⏸" : "▶"}
        </button>

        <button onClick={onNext}>⏭</button>
      </div>

      <input
        type="range"
        min="0"
        max={duration}
        step="0.01"
        value={progress}
        onChange={(e) => onSeek(Number(e.target.value))}
        className="w-full"
      />

      <div className="flex justify-between text-xs mt-1">
        <span>{formatTime(progress)}</span>
        <span>{formatTime(duration)}</span>
      </div>

    </div>
  );
}

export default PlayerBar;