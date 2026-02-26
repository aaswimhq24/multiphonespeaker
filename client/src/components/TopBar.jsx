import React from "react";

function TopBar({
  roomCode,
  participants,
  isConnected,
  onLeave,
}) {
  return (
    <div className="flex justify-between mb-6">

      <div>
        <div>Room: {roomCode}</div>
        <div>Users: {participants.length}</div>
        <div>
          {isConnected ? "Connected" : "Disconnected"}
        </div>
      </div>

      <button
        onClick={onLeave}
        className="bg-red-600 px-4 py-2 rounded-lg"
      >
        Leave
      </button>

    </div>
  );
}

export default TopBar;