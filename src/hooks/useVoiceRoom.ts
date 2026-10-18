import { useEffect, useRef, useState } from "react";
import type { Participant, RoomEnvironment } from "../types";

type SpeechResult = {
  isFinal: boolean;
  [index: number]: { transcript: string };
};
type SpeechEngine = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult:
    | ((event: {
        resultIndex: number;
        results: ArrayLike<SpeechResult>;
      }) => void)
    | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start: () => void;
  abort: () => void;
};
type SpeechWindow = Window & {
  SpeechRecognition?: new () => SpeechEngine;
  webkitSpeechRecognition?: new () => SpeechEngine;
};
type Signal = {
  ready?: boolean;
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};
type PeerConnection = {
  pc: RTCPeerConnection;
  audio: HTMLAudioElement;
  candidates: RTCIceCandidateInit[];
  queue: Promise<void>;
  offering: boolean;
};
type Options = {
  peers: Participant[];
  selfId: string;
  soundscape: RoomEnvironment["soundscape"];
  sendSignal: (target: string, data: unknown) => void;
  onTranscript: (text: string) => void;
  onError: (message: string) => void;
  iceServers?: RTCIceServer[];
};
type AmbientAudio = {
  context: AudioContext;
  gain: GainNode;
  analysers: AnalyserNode | null;
  sources: Array<OscillatorNode | AudioBufferSourceNode>;
};

// Capture stays open until leaving the room. Recognition is an optional browser
// service; WebRTC audio keeps working when that service is unavailable.
export function useVoiceRoom(options: Options) {
  const [joined, setJoined] = useState(false);
  const [joining, setJoining] = useState(false);
  const [muted, setMuted] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [level, setLevel] = useState(0);
  const [ambient, setAmbient] = useState(false);
  const [volume, setVolumeState] = useState(0.12);
  const [permission, setPermission] = useState<
    "idle" | "granted" | "denied" | "unavailable"
  >("idle");
  const supported =
    typeof window !== "undefined" &&
    Boolean(
      (window as SpeechWindow).SpeechRecognition ||
      (window as SpeechWindow).webkitSpeechRecognition,
    );
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const joinedRef = useRef(false);
  const joiningRef = useRef(false);
  const mutedRef = useRef(false);
  const ambientRef = useRef(false);
  const volumeRef = useRef(0.12);
  const generation = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const connections = useRef(new Map<string, PeerConnection>());
  const audioRef = useRef<AmbientAudio | null>(null);
  const recognitionRef = useRef<SpeechEngine | null>(null);
  const speechBlocked = useRef(false);
  const restartTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transcriptTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const meterTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const harmonyTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingTranscript = useRef("");

  function flushTranscript() {
    if (transcriptTimer.current) clearTimeout(transcriptTimer.current);
    transcriptTimer.current = null;
    const text = pendingTranscript.current.trim();
    pendingTranscript.current = "";
    if (text && joinedRef.current && !mutedRef.current)
      optionsRef.current.onTranscript(text);
  }

  function stopRecognition() {
    if (restartTimer.current) clearTimeout(restartTimer.current);
    restartTimer.current = null;
    const engine = recognitionRef.current;
    recognitionRef.current = null;
    if (engine) {
      engine.onend = null;
      engine.onerror = null;
      engine.onresult = null;
      engine.onstart = null;
      try {
        engine.abort();
      } catch {
        /* Already stopped. */
      }
    }
    setListening(false);
    setInterim("");
  }

  function startRecognition() {
    if (
      !joinedRef.current ||
      mutedRef.current ||
      speechBlocked.current ||
      recognitionRef.current
    )
      return;
    const SpeechRecognition =
      (window as SpeechWindow).SpeechRecognition ||
      (window as SpeechWindow).webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    const engine = new SpeechRecognition();
    recognitionRef.current = engine;
    engine.continuous = true;
    engine.interimResults = true;
    engine.lang = navigator.language || "en-US";
    engine.onstart = () => {
      if (recognitionRef.current === engine) setListening(true);
    };
    engine.onresult = (event) => {
      if (
        !joinedRef.current ||
        mutedRef.current ||
        recognitionRef.current !== engine
      )
        return;
      let partial = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript.trim();
        if (result.isFinal) pendingTranscript.current += ` ${text}`;
        else partial += `${text} `;
      }
      setInterim(partial.trim());
      if (transcriptTimer.current) clearTimeout(transcriptTimer.current);
      if (pendingTranscript.current.trim())
        transcriptTimer.current = setTimeout(
          flushTranscript,
          partial ? 2200 : 850,
        );
    };
    engine.onerror = (event) => {
      if (recognitionRef.current !== engine) return;
      setListening(false);
      if (
        [
          "not-allowed",
          "service-not-allowed",
          "audio-capture",
          "language-not-supported",
          "network",
        ].includes(event.error)
      ) {
        speechBlocked.current = true;
        optionsRef.current.onError(
          event.error === "network"
            ? "Browser transcription is offline. Live voice still works; reconnect voice to retry captions."
            : "Browser transcription is unavailable or denied. Live voice still works; enable speech access and reconnect to include your voice in AI drafts.",
        );
      }
    };
    engine.onend = () => {
      if (recognitionRef.current !== engine) return;
      recognitionRef.current = null;
      setListening(false);
      setInterim("");
      if (joinedRef.current && !mutedRef.current && !speechBlocked.current) {
        restartTimer.current = setTimeout(startRecognition, 350);
      }
    };
    try {
      engine.start();
    } catch {
      recognitionRef.current = null;
      speechBlocked.current = true;
      optionsRef.current.onError(
        "Browser transcription could not start. Your microphone remains connected for live voice.",
      );
    }
  }

  function closePeer(id: string) {
    const connection = connections.current.get(id);
    if (!connection) return;
    connections.current.delete(id);
    connection.pc.ontrack = null;
    connection.pc.onicecandidate = null;
    connection.pc.onnegotiationneeded = null;
    connection.pc.onconnectionstatechange = null;
    connection.pc.close();
    connection.audio.pause();
    connection.audio.srcObject = null;
    connection.audio.remove();
  }

  function validPeer(id: string) {
    const current = optionsRef.current;
    return (
      id !== current.selfId && current.peers.some((peer) => peer.id === id)
    );
  }

  async function offer(id: string, connection: PeerConnection) {
    if (
      !joinedRef.current ||
      !validPeer(id) ||
      connection.offering ||
      optionsRef.current.selfId > id
    )
      return;
    const { pc } = connection;
    if (pc.signalingState !== "stable") return;
    connection.offering = true;
    try {
      await pc.setLocalDescription(await pc.createOffer());
      if (connections.current.get(id) === connection && pc.localDescription) {
        optionsRef.current.sendSignal(id, {
          description: pc.localDescription.toJSON(),
        });
      }
    } catch {
      if (joinedRef.current && pc.connectionState !== "closed")
        optionsRef.current.onError(
          "Could not negotiate live audio with a participant.",
        );
    } finally {
      connection.offering = false;
    }
  }

  function ensurePeer(id: string): PeerConnection | null {
    if (!joinedRef.current || !streamRef.current || !validPeer(id)) return null;
    const existing = connections.current.get(id);
    if (existing) return existing;
    const pc = new RTCPeerConnection({
      iceServers: optionsRef.current.iceServers?.length
        ? optionsRef.current.iceServers
        : [{ urls: "stun:stun.l.google.com:19302" }],
    });
    const audio = new Audio();
    audio.autoplay = true;
    const connection: PeerConnection = {
      pc,
      audio,
      candidates: [],
      queue: Promise.resolve(),
      offering: false,
    };
    connections.current.set(id, connection);
    pc.onicecandidate = (event) => {
      if (event.candidate && joinedRef.current)
        optionsRef.current.sendSignal(id, {
          candidate: event.candidate.toJSON(),
        });
    };
    pc.ontrack = (event) => {
      audio.srcObject = event.streams[0] || new MediaStream([event.track]);
      void audio.play().catch(() => {
        if (joinedRef.current)
          optionsRef.current.onError(
            "Your browser blocked participant audio. Re-enter voice to allow playback.",
          );
      });
    };
    pc.onnegotiationneeded = () => {
      void offer(id, connection);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" && joinedRef.current) {
        optionsRef.current.onError(
          "A participant's audio could not connect. This prototype uses STUN only; some networks need a TURN relay. Re-enter voice to retry.",
        );
      }
    };
    for (const track of streamRef.current.getAudioTracks())
      pc.addTrack(track, streamRef.current);
    optionsRef.current.sendSignal(id, { ready: true });
    return connection;
  }

  function handleSignal(peerId: string, data: unknown) {
    if (
      !joinedRef.current ||
      !validPeer(peerId) ||
      !data ||
      typeof data !== "object"
    )
      return;
    const signal = data as Signal;
    const connection = ensurePeer(peerId);
    if (!connection) return;
    connection.queue = connection.queue
      .then(async () => {
        if (
          connections.current.get(peerId) !== connection ||
          !joinedRef.current
        )
          return;
        const { pc } = connection;
        if (signal.ready && optionsRef.current.selfId < peerId) {
          // Resend an unanswered offer when the other microphone joins later.
          if (pc.signalingState === "have-local-offer" && pc.localDescription) {
            optionsRef.current.sendSignal(peerId, {
              description: pc.localDescription.toJSON(),
            });
          } else await offer(peerId, connection);
        }
        if (
          signal.description &&
          ["offer", "answer"].includes(signal.description.type)
        ) {
          const description = signal.description;
          if (
            description.type === "offer" &&
            optionsRef.current.selfId < peerId
          )
            return;
          if (
            description.type === "answer" &&
            pc.signalingState !== "have-local-offer"
          )
            return;
          // The lower participant id always offers, preventing negotiation glare.
          await pc.setRemoteDescription(description);
          for (const candidate of connection.candidates.splice(0))
            await pc.addIceCandidate(candidate);
          if (description.type === "offer") {
            await pc.setLocalDescription(await pc.createAnswer());
            if (pc.localDescription)
              optionsRef.current.sendSignal(peerId, {
                description: pc.localDescription.toJSON(),
              });
          }
        }
        if (signal.candidate) {
          if (pc.remoteDescription) await pc.addIceCandidate(signal.candidate);
          else connection.candidates.push(signal.candidate);
        }
      })
      .catch(() => {
        if (joinedRef.current && connection.pc.signalingState !== "closed") {
          optionsRef.current.onError(
            "Live audio negotiation was interrupted. Re-enter voice if this participant remains silent.",
          );
        }
      });
  }

  function createAudio() {
    if (audioRef.current) {
      void audioRef.current.context.resume();
      return;
    }
    const context = new AudioContext();
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, context.currentTime);
    gain.connect(context.destination);
    audioRef.current = { context, gain, analysers: null, sources: [] };
    harmonyTimer.current = setInterval(playSoundscape, 4500);
    void context
      .resume()
      .catch(() =>
        optionsRef.current.onError(
          "Ambient audio could not start in this browser.",
        ),
      );
  }

  function playSoundscape() {
    const audio = audioRef.current;
    const mood = optionsRef.current.soundscape;
    if (
      !audio ||
      !ambientRef.current ||
      mood === "quiet" ||
      audio.context.state !== "running"
    )
      return;
    const { context, gain } = audio;
    const now = context.currentTime;
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0, now);
    envelope.connect(gain);
    let source: OscillatorNode | AudioBufferSourceNode;
    if (mood === "ocean") {
      const buffer = context.createBuffer(
        1,
        context.sampleRate * 8,
        context.sampleRate,
      );
      const values = buffer.getChannelData(0);
      let previous = 0;
      for (let i = 0; i < values.length; i++) {
        previous = (previous + (Math.random() * 2 - 1) * 0.025) / 1.025;
        values[i] = previous;
      }
      const wave = context.createBufferSource();
      wave.buffer = buffer;
      const filter = context.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 1100;
      wave.connect(filter).connect(envelope);
      wave.onended = () => {
        filter.disconnect();
        envelope.disconnect();
        audio.sources = audio.sources.filter((item) => item !== wave);
      };
      envelope.gain.linearRampToValueAtTime(0.65, now + 3);
      envelope.gain.linearRampToValueAtTime(0, now + 8);
      source = wave;
    } else {
      const note = context.createOscillator();
      const notes =
        mood === "garden"
          ? [523.25, 659.25, 783.99, 1046.5]
          : mood === "cosmic"
            ? [392, 523.25, 587.33, 783.99]
            : [261.63, 329.63, 392, 523.25];
      note.type = "sine";
      note.frequency.value = notes[Math.floor(Math.random() * notes.length)];
      note.connect(envelope);
      envelope.gain.linearRampToValueAtTime(
        mood === "garden" ? 0.055 : 0.09,
        now + 0.035,
      );
      envelope.gain.exponentialRampToValueAtTime(0.0001, now + 2.8);
      note.onended = () => {
        envelope.disconnect();
        audio.sources = audio.sources.filter((item) => item !== note);
      };
      source = note;
    }
    audio.sources.push(source);
    source.start(now);
    source.stop(now + (mood === "ocean" ? 8 : 3));
  }

  function stopAudio() {
    if (meterTimer.current) clearInterval(meterTimer.current);
    if (harmonyTimer.current) clearInterval(harmonyTimer.current);
    meterTimer.current = null;
    harmonyTimer.current = null;
    const audio = audioRef.current;
    audioRef.current = null;
    if (audio) {
      for (const source of audio.sources) {
        try {
          source.stop();
          source.disconnect();
        } catch {
          /* Context already closed. */
        }
      }
      audio.analysers?.disconnect();
      audio.gain.disconnect();
      void audio.context.close().catch(() => {});
    }
  }

  async function join() {
    if (joinedRef.current || joiningRef.current) return;
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof RTCPeerConnection === "undefined"
    ) {
      setPermission("unavailable");
      optionsRef.current.onError(
        "Live voice needs a browser with microphone and WebRTC support on localhost or HTTPS.",
      );
      return;
    }
    const token = ++generation.current;
    joiningRef.current = true;
    setJoining(true);
    // Start the audio context synchronously inside the user's entry gesture.
    try {
      createAudio();
    } catch {
      optionsRef.current.onError(
        "Ambient audio is unavailable in this browser.",
      );
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (token !== generation.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      joinedRef.current = true;
      mutedRef.current = false;
      speechBlocked.current = false;
      setJoined(true);
      setMuted(false);
      setPermission("granted");
      const audio = audioRef.current;
      if (audio) {
        const analyser = audio.context.createAnalyser();
        analyser.fftSize = 512;
        audio.context.createMediaStreamSource(stream).connect(analyser);
        audio.analysers = analyser;
        const samples = new Float32Array(analyser.fftSize);
        meterTimer.current = setInterval(() => {
          if (!joinedRef.current) return;
          analyser.getFloatTimeDomainData(samples);
          const rms = Math.sqrt(
            samples.reduce((sum, value) => sum + value * value, 0) /
              samples.length,
          );
          const currentLevel = mutedRef.current ? 0 : Math.min(1, rms * 6);
          setLevel(currentLevel);
          const duck = currentLevel > 0.06 ? 0.23 : 1;
          const target = ambientRef.current ? volumeRef.current * duck : 0;
          audio.gain.gain.setTargetAtTime(
            target,
            audio.context.currentTime,
            0.45,
          );
        }, 100);
      }
      stream.getAudioTracks().forEach((track) => {
        track.onended = () => {
          if (joinedRef.current) {
            leave();
            optionsRef.current.onError(
              "Microphone access ended. Enter voice again to reconnect.",
            );
          }
        };
      });
      for (const peer of optionsRef.current.peers) ensurePeer(peer.id);
      if (supported) startRecognition();
      else
        optionsRef.current.onError(
          "This browser supports live voice but has no speech recognition. Use Chrome or Edge for voice-driven room drafts.",
        );
    } catch (error) {
      if (token !== generation.current) return;
      leave();
      const name = error instanceof DOMException ? error.name : "";
      setPermission(
        name === "NotAllowedError" || name === "SecurityError"
          ? "denied"
          : "unavailable",
      );
      optionsRef.current.onError(
        name === "NotAllowedError"
          ? "Microphone access was denied. Allow the microphone in your browser, then enter voice again."
          : "Your microphone could not be opened. Check the input device and browser permissions.",
      );
    } finally {
      if (token === generation.current) {
        joiningRef.current = false;
        setJoining(false);
      }
    }
  }

  function leave() {
    generation.current++;
    joinedRef.current = false;
    joiningRef.current = false;
    stopRecognition();
    if (transcriptTimer.current) clearTimeout(transcriptTimer.current);
    transcriptTimer.current = null;
    pendingTranscript.current = "";
    for (const id of [...connections.current.keys()]) closePeer(id);
    const stream = streamRef.current;
    streamRef.current = null;
    stream?.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    stopAudio();
    setJoined(false);
    setJoining(false);
    setMuted(false);
    mutedRef.current = false;
    setLevel(0);
  }

  function toggleMute() {
    if (!joinedRef.current) return;
    if (!mutedRef.current) flushTranscript();
    mutedRef.current = !mutedRef.current;
    setMuted(mutedRef.current);
    streamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !mutedRef.current;
    });
    if (mutedRef.current) {
      stopRecognition();
      setLevel(0);
    } else startRecognition();
  }

  function toggleAmbient() {
    ambientRef.current = !ambientRef.current;
    setAmbient(ambientRef.current);
    if (ambientRef.current && !audioRef.current) createAudio();
    if (ambientRef.current) playSoundscape();
    const audio = audioRef.current;
    if (audio)
      audio.gain.gain.setTargetAtTime(
        ambientRef.current ? volumeRef.current : 0,
        audio.context.currentTime,
        0.35,
      );
  }

  function setVolume(value: number) {
    if (!Number.isFinite(value)) return;
    volumeRef.current = Math.max(0, Math.min(1, value));
    setVolumeState(volumeRef.current);
    const audio = audioRef.current;
    if (audio && ambientRef.current)
      audio.gain.gain.setTargetAtTime(
        volumeRef.current,
        audio.context.currentTime,
        0.25,
      );
  }

  useEffect(() => {
    const audio = audioRef.current;
    if (audio)
      for (const source of [...audio.sources]) {
        try {
          source.stop();
        } catch {
          /* Already ended. */
        }
      }
  }, [options.soundscape]);

  useEffect(() => {
    if (!joinedRef.current) return;
    const ids = new Set(options.peers.map((peer) => peer.id));
    for (const id of connections.current.keys())
      if (!ids.has(id)) closePeer(id);
    for (const peer of options.peers) ensurePeer(peer.id);
  }, [options.peers, options.selfId, joined]);

  useEffect(
    () => () => {
      leave();
    },
    [],
  );

  /** Distance-based loudness for a remote participant (0..1). */
  function setPeerVolume(peerId: string, value: number) {
    const connection = connections.current.get(peerId);
    if (connection) connection.audio.volume = Math.max(0, Math.min(1, value));
  }

  return {
    stream: joined ? streamRef.current : null,
    setPeerVolume,
    joined,
    joining,
    muted,
    listening,
    supported,
    interim,
    level,
    ambient,
    volume,
    permission,
    join,
    leave,
    toggleMute,
    toggleAmbient,
    setVolume,
    handleSignal,
  };
}
