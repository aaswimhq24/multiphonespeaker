function TrackList({
  tracks = [],
  currentIndex = -1,
  isHost = false,
  onSelect,
}) {
  if (!tracks.length) {
    return (
      <div className="text-slate-400 text-center py-10">
        No tracks uploaded yet
      </div>
    );
  }

  return (
    <div className="space-y-3 mb-20">
      {tracks.map((track, index) => {
        const isActive = index === currentIndex;

        return (
          <div
            key={track.id}
            onClick={() => {
              if (!isHost) return;
              onSelect?.(index);
            }}
            className={`p-4 rounded-xl transition cursor-pointer border ${
              isActive
                ? "bg-emerald-600/20 border-emerald-500"
                : "bg-slate-800 border-slate-700 hover:border-emerald-500"
            }`}
          >
            <div className="flex justify-between items-center">
              <span className="text-white text-sm">
                {track.filename}
              </span>

              {isActive && (
                <span className="text-emerald-400 text-xs">
                  Now Playing
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default TrackList;