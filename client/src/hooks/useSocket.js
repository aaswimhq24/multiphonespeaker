import { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

export default function useSocket(serverUrl) {
  const socketRef = useRef(null);

  const [socket, setSocket] = useState(null);
  const [isConnected, setIsConnected] = useState(false);

  const [roomCode, setRoomCode] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [participants, setParticipants] = useState([]);
  const [queue, setQueue] = useState([]);
  const [currentTrackIndex, setCurrentTrackIndex] = useState(-1);

  /* -------------------------------------------------------------------------- */
  /*                             Socket Lifecycle                               */
  /* -------------------------------------------------------------------------- */

  useEffect(() => {
    const socketInstance = io(serverUrl, {
      transports: ["websocket"],
      reconnectionAttempts: 5,
    });

    socketRef.current = socketInstance;
    setSocket(socketInstance);

    socketInstance.on("connect", () => {
      setIsConnected(true);
    });

    socketInstance.on("disconnect", () => {
      setIsConnected(false);
    });

    /* ---------------------------- Server Events ---------------------------- */

    socketInstance.on("room_participants", (list) => {
      setParticipants(list);
    });

    socketInstance.on("queue_updated", ({ queue }) => {
      setQueue(queue);
    });

    socketInstance.on("track_selected", ({ index }) => {
      setCurrentTrackIndex(index);
    });

    socketInstance.on("room_admin_changed", ({ adminId }) => {
      if (socketInstance.id === adminId) {
        setIsAdmin(true);
      } else {
        setIsAdmin(false);
      }
    });

    return () => {
      socketInstance.disconnect();
    };
  }, [serverUrl]);

  /* -------------------------------------------------------------------------- */
  /*                               Room Actions                                 */
  /* -------------------------------------------------------------------------- */

  const createRoom = useCallback((username) => {
    const socket = socketRef.current;
    if (!socket) return;

    socket.emit("create_room", (res) => {
      if (!res?.ok) return;

      setRoomCode(res.roomCode);
      setIsAdmin(true);

      setParticipants([
        { id: socket.id, name: username, isAdmin: true },
      ]);
    });
  }, []);

  const joinRoom = useCallback((code, username) => {
    const socket = socketRef.current;
    if (!socket) return;

    socket.emit("join_room", { roomCode: code }, (res) => {
      if (!res?.ok) return;

      setRoomCode(code);
      setIsAdmin(res.isAdmin);
      setQueue(res.queue || []);
      setCurrentTrackIndex(res.currentTrackIndex ?? -1);
    });
  }, []);

  const leaveRoom = useCallback(() => {
    const socket = socketRef.current;
    if (!socket || !roomCode) return;

    socket.emit("leave_room", { roomCode }, () => {
      setRoomCode(null);
      setQueue([]);
      setParticipants([]);
      setCurrentTrackIndex(-1);
      setIsAdmin(false);
    });
  }, [roomCode]);

  /* -------------------------------------------------------------------------- */
  /*                               Queue Actions                                */
  /* -------------------------------------------------------------------------- */

  const addTrack = useCallback((track) => {
    const socket = socketRef.current;
    if (!socket || !roomCode) return;

    socket.emit("queue_add", { roomCode, track });
  }, [roomCode]);

  const selectTrack = useCallback((index) => {
    const socket = socketRef.current;
    if (!socket || !roomCode) return;

    socket.emit("select_track", { roomCode, index });
  }, [roomCode]);

  /* -------------------------------------------------------------------------- */
  /*                                Public API                                  */
  /* -------------------------------------------------------------------------- */

  return {
    socket,
    isConnected,
    roomCode,
    isAdmin,
    participants,
    queue,
    currentTrackIndex,
    createRoom,
    joinRoom,
    leaveRoom,
    addTrack,
    selectTrack,
  };
}
