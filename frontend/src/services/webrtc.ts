import { emitSocket, onSocketEvent } from './socket';
import { api } from './api';

export interface CallPeerState {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  connectionState: RTCPeerConnectionState;
  isAudioMuted: boolean;
  isVideoOff: boolean;
  isScreenSharing: boolean;
}

export type WebRtcEventCallback = (state: Partial<CallPeerState>) => void;

class WebRtcManager {
  private pc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
  private currentCallId: string | null = null;
  private listeners: Set<WebRtcEventCallback> = new Set();
  private isAudioMuted = false;
  private isVideoOff = false;
  private isScreenSharing = false;
  private unsubs: Array<() => void> = [];

  // Queues to prevent dropping early signals before RTCPeerConnection or remoteDescription is ready
  private pendingSignals: Map<string, any[]> = new Map();
  private pendingCandidates: RTCIceCandidateInit[] = [];

  constructor() {
    this.setupSignaling();
  }

  subscribe(cb: WebRtcEventCallback) {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private notify(data: Partial<CallPeerState>) {
    this.listeners.forEach((cb) => cb(data));
  }

  private setupSignaling() {
    const unsubSignal = onSocketEvent('call:signal', async ({ callId, from, data }) => {
      // If we don't have a peer connection yet, buffer this signal so it's not lost
      if (!this.pc || this.currentCallId !== callId) {
        if (!this.pendingSignals.has(callId)) {
          this.pendingSignals.set(callId, []);
        }
        this.pendingSignals.get(callId)!.push(data);
        return;
      }

      await this.processSignalData(callId, data);
    });

    this.unsubs.push(unsubSignal);
  }

  private async processSignalData(callId: string, data: any) {
    if (!this.pc) return;

    try {
      if ('sdp' in data) {
        const sdp = data.sdp as RTCSessionDescriptionInit;
        await this.pc.setRemoteDescription(new RTCSessionDescription(sdp));

        // Flush any candidates buffered while waiting for remote description
        await this.flushPendingCandidates();

        if (sdp.type === 'offer') {
          const answer = await this.pc.createAnswer();
          await this.pc.setLocalDescription(answer);
          emitSocket('call:signal', {
            callId,
            data: { sdp: { type: 'answer', sdp: answer.sdp } },
          });
        }
      } else if ('candidate' in data) {
        const cand = data.candidate as RTCIceCandidateInit;
        if (!this.pc.remoteDescription) {
          // Cannot add ICE candidate before remote description is set
          this.pendingCandidates.push(cand);
        } else {
          await this.pc.addIceCandidate(new RTCIceCandidate(cand)).catch((err) => {
            console.warn('[WebRTC] addIceCandidate warning:', err);
          });
        }
      } else if ('state' in data) {
        // Handle remote mute/video toggles if needed
      }
    } catch (err) {
      console.error('[WebRTC Signaling Error]', err);
    }
  }

  private async flushPendingCandidates() {
    if (!this.pc || !this.pc.remoteDescription) return;
    const candidates = [...this.pendingCandidates];
    this.pendingCandidates = [];

    for (const cand of candidates) {
      try {
        await this.pc.addIceCandidate(new RTCIceCandidate(cand));
      } catch (e) {
        console.warn('[WebRTC] Error adding buffered ICE candidate:', e);
      }
    }
  }

  async initializeCall(callId: string, isVideo: boolean, isCaller: boolean) {
    this.cleanup();
    this.currentCallId = callId;

    // Google public STUN servers for reliable peer discovery across LAN and WAN
    let iceServers: RTCIceServer[] = [
      {
        urls: [
          'stun:stun.l.google.com:19302',
          'stun:stun1.l.google.com:19302',
          'stun:stun2.l.google.com:19302',
          'stun:stun3.l.google.com:19302',
          'stun:stun4.l.google.com:19302',
        ],
      },
    ];

    try {
      const turnData = await api.getIceServers();
      if (turnData?.iceServers?.length) {
        iceServers = [...iceServers, ...turnData.iceServers];
      }
    } catch (e) {
      console.warn('[WebRTC] Using fallback STUN servers', e);
    }

    this.pc = new RTCPeerConnection({
      iceServers,
      iceCandidatePoolSize: 4,
    });

    this.remoteStream = new MediaStream();
    this.notify({ remoteStream: this.remoteStream });

    this.pc.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        event.streams[0].getTracks().forEach((track) => {
          if (this.remoteStream && !this.remoteStream.getTracks().includes(track)) {
            this.remoteStream.addTrack(track);
          }
        });
      } else if (event.track) {
        if (this.remoteStream && !this.remoteStream.getTracks().includes(event.track)) {
          this.remoteStream.addTrack(event.track);
        }
      }
      this.notify({ remoteStream: this.remoteStream });
    };

    this.pc.onicecandidate = (event) => {
      if (event.candidate && this.currentCallId) {
        emitSocket('call:signal', {
          callId: this.currentCallId,
          data: {
            candidate: {
              candidate: event.candidate.candidate,
              sdpMid: event.candidate.sdpMid,
              sdpMLineIndex: event.candidate.sdpMLineIndex,
            },
          },
        });
      }
    };

    this.pc.onconnectionstatechange = () => {
      if (this.pc) {
        this.notify({ connectionState: this.pc.connectionState });
      }
    };

    // Acquire camera & microphone streams
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
        video: isVideo ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } : false,
      });

      this.localStream.getTracks().forEach((track) => {
        if (this.localStream && this.pc) {
          this.pc.addTrack(track, this.localStream);
        }
      });

      this.isAudioMuted = false;
      this.isVideoOff = !isVideo;
      this.notify({ localStream: this.localStream, isAudioMuted: false, isVideoOff: !isVideo });
    } catch (mediaErr) {
      console.warn('[WebRTC] Media capture failed:', mediaErr);
    }

    // Callee: Process any signals that arrived while the phone was ringing
    const queuedSignals = this.pendingSignals.get(callId) || [];
    this.pendingSignals.delete(callId);
    for (const queuedData of queuedSignals) {
      await this.processSignalData(callId, queuedData);
    }

    if (isCaller) {
      const offer = await this.pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: isVideo,
      });
      await this.pc.setLocalDescription(offer);
      emitSocket('call:signal', {
        callId: this.currentCallId,
        data: { sdp: { type: 'offer', sdp: offer.sdp } },
      });
    }
  }

  toggleAudio(): boolean {
    if (!this.localStream) return false;
    const audioTrack = this.localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      this.isAudioMuted = !audioTrack.enabled;
      this.notify({ isAudioMuted: this.isAudioMuted });
      if (this.currentCallId) {
        emitSocket('call:signal', {
          callId: this.currentCallId,
          data: { state: this.isAudioMuted ? 'audio-off' : 'audio-on' },
        });
      }
      return this.isAudioMuted;
    }
    return false;
  }

  toggleVideo(): boolean {
    if (!this.localStream) return false;
    const videoTrack = this.localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      this.isVideoOff = !videoTrack.enabled;
      this.notify({ isVideoOff: this.isVideoOff });
      if (this.currentCallId) {
        emitSocket('call:signal', {
          callId: this.currentCallId,
          data: { state: this.isVideoOff ? 'video-off' : 'video-on' },
        });
      }
      return this.isVideoOff;
    }
    return false;
  }

  async toggleScreenShare(): Promise<boolean> {
    if (!this.pc) return false;

    if (this.isScreenSharing) {
      this.screenStream?.getTracks().forEach((t) => t.stop());
      this.screenStream = null;
      this.isScreenSharing = false;

      const videoTrack = this.localStream?.getVideoTracks()[0];
      const sender = this.pc.getSenders().find((s) => s.track?.kind === 'video');
      if (sender && videoTrack) {
        await sender.replaceTrack(videoTrack);
      }
      this.notify({ isScreenSharing: false });
      return false;
    } else {
      try {
        if (!navigator.mediaDevices?.getDisplayMedia) {
          throw new Error('Screen sharing is not supported on this platform');
        }
        this.screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const screenTrack = this.screenStream.getVideoTracks()[0];

        screenTrack.onended = () => {
          if (this.isScreenSharing) this.toggleScreenShare();
        };

        const sender = this.pc.getSenders().find((s) => s.track?.kind === 'video');
        if (sender) {
          await sender.replaceTrack(screenTrack);
        } else if (this.localStream) {
          this.pc.addTrack(screenTrack, this.localStream);
        }

        this.isScreenSharing = true;
        this.notify({ isScreenSharing: true });
        return true;
      } catch (e) {
        console.warn('[WebRTC] Screen sharing cancelled or failed:', e);
        return false;
      }
    }
  }

  cleanup() {
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.screenStream?.getTracks().forEach((t) => t.stop());
    this.pc?.close();
    this.pc = null;
    this.localStream = null;
    this.remoteStream = null;
    this.screenStream = null;
    this.currentCallId = null;
    this.isAudioMuted = false;
    this.isVideoOff = false;
    this.isScreenSharing = false;
    this.pendingCandidates = [];
    this.notify({
      localStream: null,
      remoteStream: null,
      connectionState: 'closed',
      isAudioMuted: false,
      isVideoOff: false,
      isScreenSharing: false,
    });
  }

  getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  getRemoteStream(): MediaStream | null {
    return this.remoteStream;
  }

  destroy() {
    this.cleanup();
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    this.listeners.clear();
    this.pendingSignals.clear();
  }
}

export const webrtc = new WebRtcManager();
export const webrtcService = webrtc;
