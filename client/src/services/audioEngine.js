let audioContext = null;
let audioBuffer = null;
let sourceNode = null;
let playbackStartTime = null;   // when playback actually started (AudioContext time)
let playbackOffset = 0;         // starting offset in seconds

export async function initAudioContext() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }

  if (audioContext.state === "suspended") {
    await audioContext.resume();
  }

  return audioContext;
}

export async function loadAudioFile(file) {
  const ctx = await initAudioContext();

  const arrayBuffer = await file.arrayBuffer();
  audioBuffer = await ctx.decodeAudioData(arrayBuffer);
}

export function schedulePlayback(startTimeSec, offsetSec = 0) {
  if (!audioContext || !audioBuffer) return;

  sourceNode = audioContext.createBufferSource();
  sourceNode.buffer = audioBuffer;
  sourceNode.connect(audioContext.destination);

  playbackStartTime = startTimeSec;
  playbackOffset = offsetSec;

  sourceNode.start(startTimeSec, offsetSec);
}

export function stopPlayback() {
  if (sourceNode) {
    sourceNode.stop();
    sourceNode.disconnect();
    sourceNode = null;
  }

  playbackStartTime = null;
}

export function getCurrentTime() {
  if (!audioContext) return 0;
  return audioContext.currentTime;
}

export function getPlaybackProgress() {
  if (!audioContext) return 0;

  if (playbackStartTime === null) {
    return playbackOffset;
  }

  const now = audioContext.currentTime;
  const elapsed = now - playbackStartTime;

  return playbackOffset + elapsed;
}

export function getDuration() {
  return audioBuffer ? audioBuffer.duration : 0;
}