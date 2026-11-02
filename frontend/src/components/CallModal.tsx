import React, { useEffect, useRef, useState } from 'react';
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  PhoneOff,
  Phone,
  Monitor,
  Volume2,
  VolumeX,
  Maximize2,
  Minimize2,
  Shield,
} from 'lucide-react';
import { ActiveCallState } from '../types';
import { webrtcService, CallPeerState } from '../services/webrtc';

interface CallModalProps {
  callState: ActiveCallState;
  onAccept: (video: boolean) => void;
  onDecline: () => void;
  onEndCall: () => void;
}

export const CallModal: React.FC<CallModalProps> = ({
  callState,
  onAccept,
  onDecline,
  onEndCall,
}) => {
  const [micMuted, setMicMuted] = useState(callState.micMuted);
  const [cameraOff, setCameraOff] = useState(callState.cameraOff);
  const [screenSharing, setScreenSharing] = useState(callState.screenSharing);
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);
  const [callDuration, setCallDuration] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const syncStreams = () => {
    const local = webrtcService.getLocalStream();
    if (local && localVideoRef.current && localVideoRef.current.srcObject !== local) {
      localVideoRef.current.srcObject = local;
      localVideoRef.current.play().catch(() => {});
    }
    const remote = webrtcService.getRemoteStream();
    if (remote) {
      if (remoteVideoRef.current && remoteVideoRef.current.srcObject !== remote) {
        remoteVideoRef.current.srcObject = remote;
        remoteVideoRef.current.play().catch(() => {});
      }
      if (remoteAudioRef.current && remoteAudioRef.current.srcObject !== remote) {
        remoteAudioRef.current.srcObject = remote;
        remoteAudioRef.current.play().catch(() => {});
      }
    }
  };

  // Subscribe to webrtc stream updates & periodically sync attached streams to video elements
  useEffect(() => {
    syncStreams();
    const unsub = webrtcService.subscribe(() => {
      syncStreams();
    });
    const interval = setInterval(syncStreams, 500);
    return () => {
      unsub();
      clearInterval(interval);
    };
  }, [callState.status, callState.kind]);

  // Timer when connected
  useEffect(() => {
    if (callState.status === 'ACCEPTED') {
      timerRef.current = setInterval(() => {
        setCallDuration((prev) => prev + 1);
      }, 1000);
    } else {
      setCallDuration(0);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [callState.status]);

  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleToggleMic = () => {
    const muted = webrtcService.toggleAudio();
    setMicMuted(muted);
  };

  const handleToggleCamera = () => {
    const off = webrtcService.toggleVideo();
    setCameraOff(off);
  };

  const handleToggleScreenShare = async () => {
    const isSharing = await webrtcService.toggleScreenShare();
    setScreenSharing(isSharing);
  };

  const isRinging = callState.status === 'RINGING';

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 150,
        background: 'rgba(9, 13, 22, 0.94)',
        backdropFilter: 'blur(20px)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      {/* Hidden remote audio element */}
      <audio ref={remoteAudioRef} autoPlay playsInline />

      {/* Top Header */}
      <div
        style={{
          position: 'absolute',
          top: 24,
          left: 24,
          right: 24,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          color: '#ffffff',
          zIndex: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: 'rgba(255, 255, 255, 0.1)',
              padding: '6px 12px',
              borderRadius: 'var(--radius-full)',
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            <Shield size={14} color="var(--accent-emerald)" />
            <span>Encrypted WebRTC Relay (coturn TURN/STUN)</span>
          </div>
        </div>

        {callState.status === 'ACCEPTED' && (
          <div
            style={{
              padding: '6px 16px',
              borderRadius: 'var(--radius-full)',
              background: 'rgba(99, 102, 241, 0.25)',
              border: '1px solid var(--primary-500)',
              fontSize: 14,
              fontFamily: 'var(--font-mono)',
              fontWeight: 700,
            }}
          >
            {formatTimer(callDuration)}
          </div>
        )}

        <button
          className="btn-icon"
          onClick={() => setIsFullscreen(!isFullscreen)}
          style={{ color: '#fff', background: 'rgba(255,255,255,0.1)' }}
        >
          {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
        </button>
      </div>

      {/* Main Calling / Video Body */}
      <div
        style={{
          width: '100%',
          maxWidth: 900,
          height: isFullscreen ? '100%' : '75vh',
          position: 'relative',
          borderRadius: 'var(--radius-xl)',
          overflow: 'hidden',
          background: '#040711',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.75)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
        }}
      >
        {/* Remote Video Stream */}
        {callState.kind === 'VIDEO' && callState.status === 'ACCEPTED' ? (
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            muted
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
            }}
          />
        ) : (
          /* Avatar & Audio Wave Display */
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
            <div
              className={`avatar ${isRinging ? 'pulse-ring' : ''}`}
              style={{
                width: 120,
                height: 120,
                fontSize: 44,
                marginBottom: 20,
                background: 'linear-gradient(135deg, var(--primary-600), var(--accent-purple))',
                boxShadow: '0 10px 30px rgba(99, 102, 241, 0.4)',
              }}
            >
              {callState.peer.displayName.slice(0, 2).toUpperCase()}
            </div>
            <h2 style={{ fontSize: 24, fontWeight: 700, color: '#ffffff', marginBottom: 8 }}>
              {callState.peer.displayName}
            </h2>
            <p style={{ fontSize: 14, color: 'var(--primary-200)' }}>
              {isRinging
                ? callState.isIncoming
                  ? `Incoming ${callState.kind === 'VIDEO' ? 'Video' : 'Voice'} Call...`
                  : `Calling ${callState.peer.displayName}...`
                : `${callState.kind === 'VIDEO' ? 'Video' : 'Voice'} Call Connected`}
            </p>
          </div>
        )}

        {/* Local PIP Video (Self Preview) */}
        {callState.kind === 'VIDEO' && (
          <div
            style={{
              position: 'absolute',
              bottom: 24,
              right: 24,
              width: 180,
              height: 130,
              borderRadius: 'var(--radius-md)',
              overflow: 'hidden',
              background: '#1e293b',
              border: '2px solid rgba(255, 255, 255, 0.2)',
              boxShadow: '0 8px 16px rgba(0,0,0,0.5)',
              zIndex: 20,
            }}
          >
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                transform: 'scaleX(-1)', // Mirror preview
              }}
            />
            {cameraOff && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: '#0f172a',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--text-muted)',
                  fontSize: 12,
                }}
              >
                Camera Off
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom Controls Bar */}
      <div
        style={{
          marginTop: 24,
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          zIndex: 10,
        }}
      >
        {/* Ringing Incoming State */}
        {isRinging && callState.isIncoming ? (
          <>
            <button
              onClick={onDecline}
              style={{
                width: 56,
                height: 56,
                borderRadius: '50%',
                background: 'var(--accent-rose)',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                boxShadow: '0 4px 14px rgba(244, 63, 94, 0.4)',
              }}
              title="Decline Call"
            >
              <PhoneOff size={24} />
            </button>

            <button
              onClick={() => onAccept(false)}
              style={{
                width: 56,
                height: 56,
                borderRadius: '50%',
                background: 'var(--accent-emerald)',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                boxShadow: '0 4px 14px rgba(16, 185, 129, 0.4)',
              }}
              title="Accept Audio Call"
            >
              <Phone size={24} />
            </button>

            {callState.kind === 'VIDEO' && (
              <button
                onClick={() => onAccept(true)}
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: '50%',
                  background: 'var(--primary-500)',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  boxShadow: '0 4px 14px rgba(99, 102, 241, 0.4)',
                }}
                title="Accept with Video"
              >
                <Video size={24} />
              </button>
            )}
          </>
        ) : (
          /* Active / Connected or Ringing Outgoing */
          <>
            <button
              onClick={handleToggleMic}
              style={{
                width: 50,
                height: 50,
                borderRadius: '50%',
                background: micMuted ? 'var(--accent-rose)' : 'rgba(255, 255, 255, 0.15)',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
              title={micMuted ? 'Unmute Mic' : 'Mute Mic'}
            >
              {micMuted ? <MicOff size={22} /> : <Mic size={22} />}
            </button>

            {callState.kind === 'VIDEO' && (
              <button
                onClick={handleToggleCamera}
                style={{
                  width: 50,
                  height: 50,
                  borderRadius: '50%',
                  background: cameraOff ? 'var(--accent-rose)' : 'rgba(255, 255, 255, 0.15)',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                }}
                title={cameraOff ? 'Turn Camera On' : 'Turn Camera Off'}
              >
                {cameraOff ? <VideoOff size={22} /> : <Video size={22} />}
              </button>
            )}

            <button
              onClick={handleToggleScreenShare}
              style={{
                width: 50,
                height: 50,
                borderRadius: '50%',
                background: screenSharing ? 'var(--primary-500)' : 'rgba(255, 255, 255, 0.15)',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
              title={screenSharing ? 'Stop Screen Sharing' : 'Share Screen'}
            >
              <Monitor size={22} />
            </button>

            <button
              onClick={() => setIsSpeakerOn(!isSpeakerOn)}
              style={{
                width: 50,
                height: 50,
                borderRadius: '50%',
                background: isSpeakerOn ? 'rgba(255, 255, 255, 0.15)' : 'var(--accent-rose)',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
              title={isSpeakerOn ? 'Mute Speaker' : 'Enable Speaker'}
            >
              {isSpeakerOn ? <Volume2 size={22} /> : <VolumeX size={22} />}
            </button>

            {/* End Call / Cancel Button */}
            <button
              onClick={onEndCall}
              style={{
                width: 58,
                height: 58,
                borderRadius: '50%',
                background: '#ef4444',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                boxShadow: '0 4px 18px rgba(239, 68, 68, 0.6)',
                border: 'none',
                transition: 'transform 0.1s ease',
              }}
              className="end-call-btn"
              title="End Call"
            >
              <PhoneOff size={26} />
            </button>
          </>
        )}
      </div>
    </div>
  );
};
