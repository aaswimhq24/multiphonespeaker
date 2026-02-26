import { useEffect, useState } from "react";
import { io } from "socket.io-client";

const SOCKET_URL = `http://${window.location.hostname}:5000`;

export default function useSocket() {
  const [socket, setSocket] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [participants, setParticipants] = useState([]);
  const [queue, setQueue] = useState([]);
  const [roomCode, setRoomCode] = useState(null);
  const [isHost, setIsHost] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const s = io(SOCKET_URL);
    setSocket(s);

    s.on("connect", () => {
      setIsConnected(true);
    });

    s.on("disconnect", () => {
      setIsConnected(false);
      setRoomCode(null);
      setParticipants([]);
      setQueue([]);
    });

    s.on("room_participants", (users) => {
      setParticipants(users);
    });

    s.on("queue_updated", ({ queue }) => {
      setQueue(queue);
    });

    return () => {
      s.disconnect();
    };
  }, []);

  const createRoom = () => {
    if (!socket) return;

    socket.emit("create_room", (response) => {
      if (!response?.ok) return;

      setRoomCode(response.roomCode);
      setIsHost(response.isHost);
      setIsAdmin(true);   // creator is admin
    });
  };

  const joinRoom = (code) => {
    if (!socket) return;

    socket.emit("join_room", { roomCode: code }, (response) => {
      if (!response?.ok) return;

      setRoomCode(response.roomCode);
      setIsHost(response.isHost);
      setIsAdmin(response.isAdmin);
    });
  };

  const leaveRoom = () => {
    if (!socket || !roomCode) return;

    socket.emit("leave_room", { roomCode });
    setRoomCode(null);
    setParticipants([]);
    setQueue([]);
  };

  const addTrack = (track) => {
    if (!socket || !roomCode || !isAdmin) return;

    socket.emit("queue_add", {
      roomCode,
      track: {
        id: Date.now().toString(),
        filename: track.filename,
        fileUrl: track.fileUrl,
        durationMs: 0,
      },
    });
  };

  const selectTrack = (index) => {
    if (!socket || !roomCode) return;

    socket.emit("select_track", {
      roomCode,
      index,
    });
  };

  const startPlayback = () => {
    if (!socket || !roomCode) return;
    socket.emit("start_playback", { roomCode });
  };

  const pausePlayback = () => {
    if (!socket || !roomCode) return;
    socket.emit("pause_playback", { roomCode });
  };

  const nextTrack = () => {
    if (!socket || !roomCode) return;
    socket.emit("next_track", { roomCode });
  };

  const prevTrack = () => {
    if (!socket || !roomCode) return;
    socket.emit("prev_track", { roomCode });
  };

  const seekTrack = (time) => {
    if (!socket || !roomCode) return;
    socket.emit("seek_track", { roomCode, time });
  };

  return {
    socket,
    isConnected,
    participants,
    queue,
    roomCode,
    isHost,
    createRoom,
    joinRoom,
    leaveRoom,
    addTrack,
    selectTrack,
    startPlayback,
    pausePlayback,
    nextTrack,
    prevTrack,
    seekTrack,
  };
}