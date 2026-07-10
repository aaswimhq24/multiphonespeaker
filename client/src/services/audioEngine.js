/*
 * audioEngine.js
 * High-precision Web Audio engine for synchronized playback
 * Optimized for low drift, accurate scheduling, and minimal overhead
 */

let audioContext = null;
let audioBuffer = null;
let sourceNode = null;
let gainNode = null;

let playbackStartTime = 0; // AudioContext time when playback started
let playbackOffset = 0;    // Offset in seconds inside track
let isPlaying = false;

/* -------------------------------------------------------------------------- */
/*                            Context Initialization                           */
/* -------------------------------------------------------------------------- */

function getAudioContext() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)({
      latencyHint: "interactive",
    });

    gainNode = audioContext.createGain();
    gainNode.connect(audioContext.destination);
  }

  // Mobile browsers sometimes start suspended
  if (audioContext.state === "suspended") {
    audioContext.resume();
  }

  return audioContext;
}

/* -------------------------------------------------------------------------- */
/*                               Load Audio File                               */
/* -------------------------------------------------------------------------- */

export async function loadAudioFile(arrayBuffer) {
  const ctx = getAudioContext();

  stopPlayback();

  // decodeAudioData requires a fresh buffer copy
  audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));

  playbackOffset = 0;
  playbackStartTime = 0;
  isPlaying = false;
}

/* -------------------------------------------------------------------------- */
/*                              Schedule Playback                              */
/* -------------------------------------------------------------------------- */

export function schedulePlayback(startTimeSec, offsetSec = 0) {
  const ctx = getAudioContext();

  if (!audioBuffer) return;

  stopPlayback();

  sourceNode = ctx.createBufferSource();
  sourceNode.buffer = audioBuffer;
  sourceNode.connect(gainNode);

  playbackStartTime = startTimeSec;
  playbackOffset = offsetSec;
  isPlaying = true;

  try {
    sourceNode.start(startTimeSec, offsetSec);
  } catch (err) {
    console.error("Playback scheduling failed:", err);
  }

  sourceNode.onended = () => {
    sourceNode = null;
    isPlaying = false;
  };
}

/* -------------------------------------------------------------------------- */
/*                                Stop Playback                                */
/* -------------------------------------------------------------------------- */

export function stopPlayback() {
  if (sourceNode) {
    try {
      sourceNode.stop();
    } catch {}

    try {
      sourceNode.disconnect();
    } catch {}

    sourceNode = null;
  }

  isPlaying = false;
}

/* -------------------------------------------------------------------------- */
/*                             Playback Information                            */
/* -------------------------------------------------------------------------- */

export function getCurrentTime() {
  const ctx = getAudioContext();
  return ctx.currentTime;
}

export function getPlaybackProgress() {
  const ctx = getAudioContext();

  if (!isPlaying) return playbackOffset;

  const elapsed = ctx.currentTime - playbackStartTime;

  return playbackOffset + Math.max(elapsed, 0);
}

export function getDuration() {
  return audioBuffer ? audioBuffer.duration : 0;
}

/* -------------------------------------------------------------------------- */
/*                               Volume Control                                */
/* -------------------------------------------------------------------------- */

export function setVolume(value) {
  if (!gainNode) return;
  gainNode.gain.value = value;
}