import { useRef } from "react";
import { Play, Pause, SkipBack, SkipForward, Volume2 } from "lucide-react";

export default function PlayerBar({
  isPlaying,
  progress,
  duration,
  play,
  pause,
  next,
  prev,
  seek,
  formatTime,
}) {
  const progressRef = useRef(null);

  const handleSeek = (e) => {
    const rect = progressRef.current.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    const newTime = percent * duration;
    seek?.(newTime);
  };

  const progressPercent = duration
    ? Math.min((progress / duration) * 100, 100)
    : 0;

  return (
    <div className="w-full backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl shadow-2xl px-8 py-6 space-y-6">
      {/* Progress Section */}
      <div className="space-y-2">
        <div
          ref={progressRef}
          onClick={handleSeek}
          className="relative h-2 bg-white/10 rounded-full cursor-pointer overflow-hidden"
        >
          <div
            className="absolute left-0 top-0 h-full bg-emerald-400 transition-all"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        <div className="flex justify-between text-xs text-slate-400">
          <span>{formatTime(progress)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-8">
        <button
          onClick={prev}
          className="p-3 rounded-xl bg-white/10 hover:bg-white/20 transition"
        >
          <SkipBack className="w-5 h-5" />
        </button>

        <button
          onClick={isPlaying ? pause : play}
          className="w-16 h-16 flex items-center justify-center rounded-full bg-emerald-500 hover:bg-emerald-600 shadow-lg transition"
        >
          {isPlaying ? (
            <Pause className="w-7 h-7" />
          ) : (
            <Play className="w-7 h-7 ml-1" />
          )}
        </button>

        <button
          onClick={next}
          className="p-3 rounded-xl bg-white/10 hover:bg-white/20 transition"
        >
          <SkipForward className="w-5 h-5" />
        </button>
      </div>

      {/* Bottom Decorative Audio Line */}
      <div className="flex items-center justify-center gap-1 opacity-40">
        {Array.from({ length: 30 }).map((_, i) => (
          <div
            key={i}
            className="w-1 bg-emerald-400 rounded-full"
            style={{
              height: `${8 + Math.sin((progress + i) * 2) * 6}px`,
            }}
          />
        ))}
      </div>
    </div>
  );
}
