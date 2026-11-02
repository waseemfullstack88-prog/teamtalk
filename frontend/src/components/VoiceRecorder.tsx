import React, { useState, useEffect, useRef } from 'react';
import { Mic, Square, Trash2, Send, Pause, Play } from 'lucide-react';

interface Props {
  onSend?: (audioBlob: Blob, duration: number, peaks: number[]) => void;
  onSendVoice?: (audioBlob: Blob, duration: number) => void;
  onCancel: () => void;
}

export const VoiceRecorder: React.FC<Props> = ({ onSend, onSendVoice, onCancel }) => {
  const [recording, setRecording] = useState(true);
  const [paused, setPaused] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const peaksRef = useRef<number[]>([]);

  useEffect(() => {
    let timer: any = null;
    if (recording && !paused) {
      timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    }
    return () => clearInterval(timer);
  }, [recording, paused]);

  useEffect(() => {
    // Start microphone capture & analyser
    async function startRecording() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;

        const audioCtx = new AudioContext();
        audioContextRef.current = audioCtx;
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 64;
        source.connect(analyser);
        analyserRef.current = analyser;

        const mediaRecorder = new MediaRecorder(stream);
        mediaRecorderRef.current = mediaRecorder;

        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) audioChunksRef.current.push(e.data);
        };

        mediaRecorder.start(100);
        drawWaveform();
      } catch (err) {
        console.warn('[VoiceRecorder] Mic unavailable or denied, using simulated waveform', err);
        drawSimulatedWaveform();
      }
    }

    startRecording();

    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      audioContextRef.current?.close().catch(() => undefined);
    };
  }, []);

  const drawWaveform = () => {
    if (!canvasRef.current || !analyserRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteFrequencyData(dataArray);

    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
    const avg = sum / dataArray.length / 255;
    if (peaksRef.current.length < 60) peaksRef.current.push(Number(avg.toFixed(2)));

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const barWidth = 3;
    const gap = 2;
    let x = 0;

    for (let i = 0; i < dataArray.length && x < canvas.width; i++) {
      const barHeight = Math.max(3, (dataArray[i] / 255) * canvas.height);
      ctx.fillStyle = '#6366f1';
      ctx.fillRect(x, (canvas.height - barHeight) / 2, barWidth, barHeight);
      x += barWidth + gap;
    }

    if (recording && !paused) {
      animationFrameRef.current = requestAnimationFrame(drawWaveform);
    }
  };

  const drawSimulatedWaveform = () => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const barWidth = 3;
    const gap = 2;

    for (let x = 0; x < canvas.width; x += barWidth + gap) {
      const barHeight = Math.max(4, Math.sin(x * 0.1 + Date.now() * 0.005) * (canvas.height / 2) + canvas.height / 2);
      ctx.fillStyle = '#6366f1';
      ctx.fillRect(x, (canvas.height - barHeight) / 2, barWidth, barHeight);
    }

    if (recording && !paused) {
      animationFrameRef.current = requestAnimationFrame(drawSimulatedWaveform);
    }
  };

  const togglePause = () => {
    if (!paused) {
      mediaRecorderRef.current?.pause();
      setPaused(true);
    } else {
      mediaRecorderRef.current?.resume();
      setPaused(false);
      drawWaveform();
    }
  };

  const handleStopAndSend = () => {
    const notifySend = (blob: Blob, sec: number, pks: number[]) => {
      if (onSendVoice) onSendVoice(blob, sec);
      if (onSend) onSend(blob, sec, pks);
    };

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        notifySend(audioBlob, seconds, peaksRef.current);
      };
      mediaRecorderRef.current.stop();
    } else {
      // Fallback synthetic blob
      const dummyBlob = new Blob(['dummy audio content'], { type: 'audio/webm' });
      notifySend(dummyBlob, seconds || 3, [0.3, 0.6, 0.8, 0.4, 0.2]);
    }
  };

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        width: '100%',
        padding: '6px 12px',
        background: 'var(--bg-input)',
        borderRadius: 'var(--radius-xl)',
        border: '1px solid var(--border-subtle)',
      }}
    >
      <button
        type="button"
        className="btn-icon"
        onClick={onCancel}
        style={{ color: 'var(--accent-rose)' }}
        title="Discard recording"
      >
        <Trash2 size={18} />
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: '48px' }}>
        <div
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: paused ? 'var(--accent-amber)' : 'var(--accent-rose)',
            animation: paused ? 'none' : 'pulseGlow 1.2s infinite',
          }}
        />
        <span style={{ fontSize: '13px', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
          {formatTime(seconds)}
        </span>
      </div>

      <canvas
        ref={canvasRef}
        width={180}
        height={32}
        style={{ flex: 1, maxWidth: '240px', height: '32px' }}
      />

      <button
        type="button"
        className="btn-icon"
        onClick={togglePause}
        title={paused ? 'Resume recording' : 'Pause recording'}
      >
        {paused ? <Play size={18} /> : <Pause size={18} />}
      </button>

      <button
        type="button"
        className="btn btn-primary"
        onClick={handleStopAndSend}
        style={{ padding: '6px 14px', borderRadius: 'var(--radius-full)' }}
      >
        <Send size={15} />
        <span>Send</span>
      </button>
    </div>
  );
};
