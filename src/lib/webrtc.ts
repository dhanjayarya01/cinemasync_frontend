
import { socketManager } from './socket';

export interface WebRTCPeer {
  id: string;
  pc: RTCPeerConnection;
  dataChannel?: RTCDataChannel;
  stream?: MediaStream;
  isConnected: boolean;
  connectionState: string;
}

const CHUNK_SIZE = 16 * 1024;

class WebRTCManager {
  private peers: Map<string, WebRTCPeer> = new Map();
  private sendQueues: Map<string, Array<ArrayBuffer>> = new Map();
  private static readonly MAX_BUFFERED_AMOUNT = 4 * 1024 * 1024;
  private localStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
  private fileStream: MediaStream | null = null;
  private isHost = false;
  private currentVideoFile: File | null = null;
  private currentVideoObjectUrl: string | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private chunkSize = CHUNK_SIZE;
  private incomingFiles: Map<string, { chunks: ArrayBuffer[]; totalChunks?: number; metadata?: any }> = new Map();
  private prebufferChunks: Array<ArrayBuffer> = [];
  private isSendingFile = false;
  private socketCallbacks: {
    offer: (data: { from: string; offer: any }) => void;
    answer: (data: { from: string; answer: any }) => void;
    iceCandidate: (data: { from: string; candidate: any }) => void;
    peerJoined: (data: { peerId: string }) => void;
    peerLeft: (data: { peerId: string }) => void;
  } | null = null;
  private totalChunksExpected = 0;
  private pendingRemoteCandidates: Map<string, RTCIceCandidateInit[]> = new Map();
  private prebufferMaxBytes = 50 * 1024 * 1024;
  private audioContext: AudioContext | null = null;
  private fileAudioGain: GainNode | null = null; // sent to peers
  private localPlaybackGain: GainNode | null = null; // host-local audible
  private retryCounts: Map<string, number> = new Map();
  
  // NEW: Live voice chat properties
  private liveVoiceStream: MediaStream | null = null;
  private isLiveVoiceModeActive = false;
  private voiceChatCallbacks: {
    onVoiceStreamReceived?: (peerId: string, stream: MediaStream) => void;
    onVoiceStreamEnded?: (peerId: string) => void;
  } = {};

  constructor() {}

  setHostStatus(isHost: boolean) {
    this.isHost = isHost;
    this.ensureSocketListeners();
  }

  setVideoElement(videoElement: HTMLVideoElement | null) {
    this.videoElement = videoElement;
    this.ensureSocketListeners();
    if (videoElement && this.prebufferChunks.length > 0) {
      try {
        const parts = this.prebufferChunks.map((ab) => new Uint8Array(ab));
        const blob = new Blob(parts, { type: 'video/mp4' });
        if (this.currentVideoObjectUrl) {
          try { URL.revokeObjectURL(this.currentVideoObjectUrl); } catch {}
          this.currentVideoObjectUrl = null;
        }
        const url = URL.createObjectURL(blob);
        this.currentVideoObjectUrl = url;
        videoElement.src = url;
        videoElement.muted = true;
        videoElement.play().catch(() => {});
        this.prebufferChunks = [];
      } catch (e) {
        this.prebufferChunks = [];
      }
    }
  }

  public ensureSocketListeners() {
    if (!this.socketCallbacks) {
      this.setupSocketListeners();
    }
  }

  private setupSocketListeners() {
    if (this.socketCallbacks) return;
    const offerCallback = (data: { from: string; offer: any }) => { this.handleOffer(data.from, data.offer); };
    const answerCallback = (data: { from: string; answer: any }) => { this.handleAnswer(data.from, data.answer); };
    const iceCandidateCallback = (data: { from: string; candidate: any }) => { this.handleIceCandidate(data.from, data.candidate); };
    const peerJoinedCallback = (data: { peerId: string }) => { this.handlePeerJoined(data.peerId); };
    const peerLeftCallback = (data: { peerId: string }) => { this.handlePeerLeft(data.peerId); };
    this.socketCallbacks = { offer: offerCallback, answer: answerCallback, iceCandidate: iceCandidateCallback, peerJoined: peerJoinedCallback, peerLeft: peerLeftCallback };
    socketManager.onWebRTCOffer(offerCallback);
    socketManager.onWebRTCAnswer(answerCallback);
    socketManager.onWebRTCIceCandidate(iceCandidateCallback);
    socketManager.onWebRTCPeerJoined(peerJoinedCallback);
    socketManager.onWebRTCPeerLeft(peerLeftCallback);
    socketManager.onMessage((message) => {
      if (message.message && typeof message.message === 'string') {
        try {
          const parsed = JSON.parse(message.message);
          if (parsed?.type === 'user-joined' && parsed.user) {}
        } catch (e) {}
      }
    });
  }

  async initializePeerConnection(peerId: string, isInitiator: boolean = false): Promise<RTCPeerConnection> {
    const existing = this.peers.get(peerId);
    if (existing) {
      if (this.isHost && isInitiator && !existing.dataChannel) {
        try {
          const dc = existing.pc.createDataChannel('video-chunks', { ordered: true, maxRetransmits: 3 });
          existing.dataChannel = dc;
          this.setupDataChannel(peerId, dc, true);
        } catch (e) {}
      }
      return existing.pc;
    }

    const envTurn = (typeof process !== 'undefined' && (process as any).env && (process as any).env.NEXT_PUBLIC_TURN_SERVERS) ? JSON.parse((process as any).env.NEXT_PUBLIC_TURN_SERVERS) : null;
    const iceServers = envTurn && Array.isArray(envTurn) ? envTurn : [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' }
    ];

    const configuration: RTCConfiguration = { iceServers };

    const pc = new RTCPeerConnection(configuration);
    const peer: WebRTCPeer = { id: peerId, pc, isConnected: false, connectionState: 'new' };

    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        try { pc.addTrack(track, this.localStream!); } catch (e) {}
      });
    }

    if (this.fileStream) {
      try {
        this.addOrReplaceTracks(pc, this.fileStream);
      } catch (e) {}
    }

    if (this.isHost && isInitiator) {
      try {
        const dataChannel = pc.createDataChannel('video-chunks', { ordered: true, maxRetransmits: 3 });
        peer.dataChannel = dataChannel;
        this.setupDataChannel(peerId, dataChannel, true);
      } catch (e) {}
    } else if (!this.isHost) {
      pc.ondatachannel = (event) => {
        const dc = event.channel;
        peer.dataChannel = dc;
        this.setupDataChannel(peerId, dc, false);
      };
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socketManager.sendIceCandidate(event.candidate, peerId);
      }
    };

    pc.ontrack = (event) => {
      peer.stream = event.streams[0];
      if (this.videoElement) {
        try {
          (this.videoElement as any).srcObject = event.streams[0];
          this.videoElement.autoplay = true;
          (this.videoElement as any).playsInline = true;
          this.videoElement.play().catch(() => {});
        } catch (e) {}
      } else {
        this.onStreamReceived(peerId, event.streams[0]);
      }
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      peer.connectionState = state;
      if (state === 'connected') {
        peer.isConnected = true;
        this.retryCounts.set(peerId, 0);
      } else if (state === 'failed' || state === 'disconnected') {
        peer.isConnected = false;
        const count = this.retryCounts.get(peerId) || 0;
        if (count < 3) {
          this.retryCounts.set(peerId, count + 1);
          try {
            pc.createOffer({ iceRestart: true }).then((offer) => pc.setLocalDescription(offer).then(() => socketManager.sendOffer(offer, peerId))).catch(() => {});
          } catch (e) {}
        } else {
          this.removePeer(peerId);
        }
      }
    };

    this.peers.set(peerId, peer);

    const pending = this.pendingRemoteCandidates.get(peerId);
    if (pending && pending.length) {
      pending.forEach(async (c) => {
        try { await pc.addIceCandidate(c); } catch (e) {}
      });
      this.pendingRemoteCandidates.delete(peerId);
    }

    return pc;
  }

  private setupDataChannel(peerId: string, dataChannel: RTCDataChannel, isHost: boolean) {
    try { (dataChannel as any).binaryType = 'arraybuffer'; } catch (e) {}
    try { (dataChannel as any).bufferedAmountLowThreshold = 1024 * 1024; } catch {}
    dataChannel.onopen = () => {
      const p = this.peers.get(peerId);
      if (p) p.isConnected = true;
      this.flushSendQueue(peerId);
    };
    dataChannel.onclose = () => {
      const p = this.peers.get(peerId);
      if (p) p.isConnected = false;
    };
    dataChannel.onerror = (e) => {
      const p = this.peers.get(peerId);
      if (p) { p.isConnected = false; p.connectionState = 'failed'; }
    };
    if (!isHost) {
      dataChannel.onmessage = (event) => {
        const payload = event.data;
        if (payload instanceof ArrayBuffer) {
          this.handleIncomingFileChunk(peerId, payload);
        } else if (payload instanceof Blob) {
          payload.arrayBuffer().then((buf) => this.handleIncomingFileChunk(peerId, buf)).catch(() => {});
        } else if (typeof payload === 'string') {
          try {
            const parsed = JSON.parse(payload);
            if (parsed.type === 'file-start') {
              this.incomingFiles.set(parsed.fileId, { chunks: [], totalChunks: parsed.totalChunks, metadata: parsed });
            } else if (parsed.type === 'file-end') {
              this.finishIncomingFile(parsed.fileId);
            }
          } catch (e) {}
        }
      };
    } else {
      dataChannel.onbufferedamountlow = () => {
        this.flushSendQueue(peerId);
      };
    }
  }

  private addOrReplaceTracks(pc: RTCPeerConnection, stream: MediaStream) {
    const senders = pc.getSenders();
    const currentVideo = senders.find(s => s.track && s.track.kind === 'video');
    const currentAudio = senders.find(s => s.track && s.track.kind === 'audio');
    const newVideo = stream.getVideoTracks()[0];
    const newAudio = stream.getAudioTracks()[0];
    if (newVideo) {
      if (currentVideo && currentVideo.track) {
        try { currentVideo.replaceTrack(newVideo); } catch (e) { try { pc.addTrack(newVideo, stream); } catch {} }
      } else {
        try { pc.addTrack(newVideo, stream); } catch (e) {}
      }
    }
    if (newAudio) {
      if (currentAudio && currentAudio.track) {
        try { currentAudio.replaceTrack(newAudio); } catch (e) { try { pc.addTrack(newAudio, stream); } catch {} }
      } else {
        try { pc.addTrack(newAudio, stream); } catch (e) {}
      }
    }
  }

  private enqueueChunk(peerId: string, chunk: ArrayBuffer) {
    const peer = this.peers.get(peerId);
    if (!peer || !peer.dataChannel) return;
    const dc = peer.dataChannel;
    if (dc.readyState !== 'open' || !peer.isConnected) {
      const q = this.sendQueues.get(peerId) || [];
      q.push(chunk);
      this.sendQueues.set(peerId, q);
      return;
    }
    if (dc.bufferedAmount + chunk.byteLength > WebRTCManager.MAX_BUFFERED_AMOUNT) {
      const q = this.sendQueues.get(peerId) || [];
      q.push(chunk);
      this.sendQueues.set(peerId, q);
      return;
    }
    try {
      dc.send(chunk);
    } catch (e) {
      const q = this.sendQueues.get(peerId) || [];
      q.push(chunk);
      this.sendQueues.set(peerId, q);
    }
  }

  private flushSendQueue(peerId: string) {
    const peer = this.peers.get(peerId);
    if (!peer || !peer.dataChannel) return;
    const dc = peer.dataChannel;
    if (dc.readyState !== 'open' || !peer.isConnected) return;
    const queue = this.sendQueues.get(peerId);
    if (!queue || queue.length === 0) return;
    while (queue.length > 0) {
      const next = queue[0];
      if (dc.bufferedAmount + next.byteLength > WebRTCManager.MAX_BUFFERED_AMOUNT) break;
      try {
        dc.send(next);
        queue.shift();
      } catch (e) {
        break;
      }
    }
    if (!queue || queue.length === 0) {
      this.sendQueues.delete(peerId);
    } else {
      this.sendQueues.set(peerId, queue);
    }
  }

  public ensureConnectionsTo(participantUserIds: string[], currentUserId: string) {
    if (!this.isHost) return;
    const targetIds = participantUserIds.filter(id => id && id !== currentUserId);
    targetIds.forEach(id => {
      if (!this.peers.has(id)) {
        setTimeout(() => {
          this.createOfferWithRetries(id, 3, 1000).catch(() => {});
        }, 500);
      }
    });
  }

  private async createOfferWithRetries(peerId: string, attempts = 3, delayMs = 1000) {
    for (let i = 0; i < attempts; i++) {
      try {
        await this.createOffer(peerId);
        return;
      } catch (e) {
        await new Promise(r => setTimeout(r, delayMs * (i + 1)));
      }
    }
  }

  private async handleOffer(from: string, offer: RTCSessionDescriptionInit) {
    if (this.isHost) return;
    const pc = await this.initializePeerConnection(from, false);
    try {
      await pc.setRemoteDescription(offer);
      const pending = this.pendingRemoteCandidates.get(from);
      if (pending && pending.length) {
        for (const c of pending) {
          try { await pc.addIceCandidate(c); } catch (e) {}
        }
        this.pendingRemoteCandidates.delete(from);
      }
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socketManager.sendAnswer(answer, from);
    } catch (error) {}
  }

  private async handleAnswer(from: string, answer: RTCSessionDescriptionInit) {
    if (!this.isHost) return;
    const peer = this.peers.get(from);
    if (!peer) return;
    try {
      await peer.pc.setRemoteDescription(answer);
      const pending = this.pendingRemoteCandidates.get(from);
      if (pending && pending.length) {
        for (const c of pending) {
          try { await peer.pc.addIceCandidate(c); } catch (e) {}
        }
        this.pendingRemoteCandidates.delete(from);
      }
    } catch (error) {}
  }

  private async handleIceCandidate(from: string, candidate: RTCIceCandidateInit) {
    const peer = this.peers.get(from);
    if (!peer) {
      const arr = this.pendingRemoteCandidates.get(from) || [];
      arr.push(candidate);
      this.pendingRemoteCandidates.set(from, arr);
      return;
    }
    try {
      await peer.pc.addIceCandidate(candidate);
    } catch (error) {}
  }

  private handlePeerJoined(peerId: string) {
    if (this.isHost) {
      setTimeout(() => {
        this.createOfferWithRetries(peerId, 4, 800).catch(() => {});
      }, 1000);
    }
  }

  private handlePeerLeft(peerId: string) {
    this.removePeer(peerId);
  }

  async createOffer(peerId: string): Promise<RTCSessionDescriptionInit> {
    if (!this.isHost) return {} as RTCSessionDescriptionInit;
    const existing = this.peers.get(peerId);
    if (existing) {
      const state = existing.pc.signalingState;
      if (state !== 'stable') {
        try {
          const offer = await existing.pc.createOffer({ iceRestart: true });
          await existing.pc.setLocalDescription(offer);
          socketManager.sendOffer(offer, peerId);
          return offer;
        } catch (e) {
          return {} as RTCSessionDescriptionInit;
        }
      }
    }
    const pc = await this.initializePeerConnection(peerId, true);
    if (this.isHost && !this.peers.get(peerId)?.dataChannel) {
      try {
        const dc = pc.createDataChannel('video-chunks', { ordered: true, maxRetransmits: 3 });
        const p = this.peers.get(peerId);
        if (p) { p.dataChannel = dc; this.setupDataChannel(peerId, dc, true); }
      } catch (e) {}
    }
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socketManager.sendOffer(offer, peerId);
    return offer;
  }

  async startLocalStream(constraints: MediaStreamConstraints = { video: true, audio: true }): Promise<MediaStream> {
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
      return this.localStream;
    } catch (error) {
      throw error;
    }
  }

  async startScreenShare(): Promise<MediaStream> {
    try {
      this.screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      this.fileStream = this.screenStream;
      this.peers.forEach(peer => {
        const senders = peer.pc.getSenders();
        const videoSender = senders.find(s => s.track?.kind === 'video');
        const audioSender = senders.find(s => s.track?.kind === 'audio');
        if (videoSender && this.screenStream) {
          const videoTrack = this.screenStream.getVideoTracks()[0];
          try { videoSender.replaceTrack(videoTrack); } catch (e) { try { peer.pc.addTrack(videoTrack, this.screenStream!); } catch {} }
        }
        if (audioSender && this.screenStream && this.screenStream.getAudioTracks().length > 0) {
          const audioTrack = this.screenStream.getAudioTracks()[0];
          try { audioSender.replaceTrack(audioTrack); } catch (e) { try { peer.pc.addTrack(audioTrack, this.screenStream!); } catch {} }
        }
      });
      this.peers.forEach(async (peer) => {
        try { await this.createOffer(peer.id); } catch (e) {}
      });
      return this.screenStream;
    } catch (error) {
      throw error;
    }
  }

  stopScreenShare() {
    if (this.screenStream) {
      try { this.screenStream.getTracks().forEach(t => { try { t.stop(); } catch {} }); } catch (e) {}
      if (this.fileStream && this.fileStream === this.screenStream) { this.fileStream = null; }
      this.screenStream = null;
    }
  }

  public stopFileStream() {
    if (this.fileStream) {
      try { this.fileStream.getTracks().forEach(t => { try { t.stop(); } catch {} }); } catch (e) {}
      this.fileStream = null;
    }
    if (this.currentVideoObjectUrl) {
      try { URL.revokeObjectURL(this.currentVideoObjectUrl); } catch (e) {}
      this.currentVideoObjectUrl = null;
    }
    this.currentVideoFile = null;
    this.isSendingFile = false;
    this.incomingFiles.clear();
    this.prebufferChunks = [];
    this.sendQueues.clear();
    this.fileAudioGain = null;
    this.localPlaybackGain = null;
  }

  // NEW: control local host playback volume (only host local audible, doesn't affect sent audio)
  public setLocalVolume(value: number) {
    try {
      if (this.localPlaybackGain) this.localPlaybackGain.gain.value = isFinite(value) ? value : 1;
    } catch (e) {}
  }

  // NEW: control send volume (what peers receive)
  public setSendVolume(value: number) {
    try {
      if (this.fileAudioGain) this.fileAudioGain.gain.value = isFinite(value) ? value : 1;
    } catch (e) {}
  }

  // NEW: mute/unmute host local playback without muting peers
  public setLocalMuted(muted: boolean) {
    try {
      if (this.localPlaybackGain) this.localPlaybackGain.gain.value = muted ? 0 : (this.localPlaybackGain.gain.value || 1);
    } catch (e) {}
  }

  // NEW: mute/unmute what is sent to peers
  public setSendMuted(muted: boolean) {
    try {
      if (this.fileAudioGain) this.fileAudioGain.gain.value = muted ? 0 : (this.fileAudioGain.gain.value || 1);
    } catch (e) {}
  }

  // NEW: Live voice chat methods - COMPLETELY INDEPENDENT FROM VIDEO
  public async startLiveVoiceChat(): Promise<MediaStream | null> {
    try {
      if (this.liveVoiceStream) {
        this.stopLiveVoiceChat();
      }

      // Get microphone access
      this.liveVoiceStream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 44100
        } 
      });

      this.isLiveVoiceModeActive = true;

      // COMPLETELY AVOID WebRTC for live voice to prevent video conflicts
      // Instead, use socket.io for voice data transmission (simpler approach)
      console.log('Live voice chat started (socket-based to avoid video conflicts)');
      return this.liveVoiceStream;
    } catch (error) {
      console.error('Failed to start live voice chat:', error);
      this.isLiveVoiceModeActive = false;
      return null;
    }
  }

  public stopLiveVoiceChat() {
    if (this.liveVoiceStream) {
      // Stop all tracks
      this.liveVoiceStream.getTracks().forEach(track => {
        try {
          track.stop();
        } catch (e) {}
      });

      // Remove tracks from peer connections
      this.peers.forEach(peer => {
        const senders = peer.pc.getSenders();
        senders.forEach(sender => {
          if (sender.track && sender.track.kind === 'audio' && 
              this.liveVoiceStream?.getAudioTracks().includes(sender.track)) {
            try {
              peer.pc.removeTrack(sender);
            } catch (e) {}
          }
        });
      });

      this.liveVoiceStream = null;
    }

    this.isLiveVoiceModeActive = false;
    console.log('Live voice chat stopped');
  }

  public isLiveVoiceModeActive(): boolean {
    return this.isLiveVoiceModeActive;
  }

  public setVoiceChatCallbacks(callbacks: {
    onVoiceStreamReceived?: (peerId: string, stream: MediaStream) => void;
    onVoiceStreamEnded?: (peerId: string) => void;
  }) {
    this.voiceChatCallbacks = callbacks;
  }

  // NEW: Enhanced ontrack handler for voice streams
  private handleTrackReceived(peerId: string, event: RTCTrackEvent) {
    const peer = this.peers.get(peerId);
    if (!peer) return;

    const stream = event.streams[0];
    const track = event.track;

    if (track.kind === 'audio' && this.voiceChatCallbacks.onVoiceStreamReceived) {
      // This is a voice stream from another participant
      this.voiceChatCallbacks.onVoiceStreamReceived(peerId, stream);
    } else if (track.kind === 'video') {
      // Handle video streams as before
      peer.stream = stream;
      if (this.videoElement) {
        try {
          (this.videoElement as any).srcObject = stream;
          this.videoElement.autoplay = true;
          (this.videoElement as any).playsInline = true;
          this.videoElement.play().catch(() => {});
        } catch (e) {}
      } else {
        this.onStreamReceived(peerId, stream);
      }
    }
  }

  // NEW: Get connection status including voice chat info
  public getConnectionStatus() {
    return {
      connectedPeers: Array.from(this.peers.values()).filter(p => p.isConnected).length,
      totalPeers: this.peers.size,
      isLiveVoiceActive: this.isLiveVoiceModeActive,
      hasLiveVoiceStream: !!this.liveVoiceStream
    };
  }

  async streamVideoFile(file: File, videoElement: HTMLVideoElement) {
    try { this.stopFileStream(); } catch (e) {}
    this.currentVideoFile = file;
    this.videoElement = videoElement;
    try {
      const videoUrl = URL.createObjectURL(file);
      this.currentVideoObjectUrl = videoUrl;
      try { videoElement.crossOrigin = 'anonymous'; } catch (e) {}
      videoElement.src = videoUrl;
      try { videoElement.muted = false; } catch (e) {}
      try { await videoElement.play().catch(() => {}); } catch (e) {}
      const capture: MediaStream | null = (videoElement as any).captureStream?.() || (videoElement as any).mozCaptureStream?.() || null;
      if (!this.audioContext) {
        try { this.audioContext = new (window as any).AudioContext(); } catch (e) { this.audioContext = null; }
      }
      const audioCtx = this.audioContext || null;
      if (audioCtx) {
        try { await audioCtx.resume(); } catch (e) {}
        let sourceNode: MediaStreamAudioSourceNode | MediaElementAudioSourceNode | null = null;
        if (capture && capture.getAudioTracks().length > 0) {
          try { sourceNode = audioCtx.createMediaStreamSource(capture); } catch (e) { sourceNode = null; }
        }
        if (!sourceNode) {
          try { sourceNode = audioCtx.createMediaElementSource(videoElement); } catch (e) { sourceNode = null; }
        }
        if (sourceNode) {
          const MAX_CHANNELS = 8;
          const splitter = audioCtx.createChannelSplitter(MAX_CHANNELS);
          const merger = audioCtx.createChannelMerger(2);
          const centerGain = 1.0;
          const lfeGain = 0.25;
          const surroundGain = 0.5;
          for (let ch = 0; ch < MAX_CHANNELS; ch++) {
            const gL = audioCtx.createGain();
            const gR = audioCtx.createGain();
            if (ch === 0) { gL.gain.value = 1.0; gR.gain.value = 0.6; }
            else if (ch === 1) { gL.gain.value = 0.6; gR.gain.value = 1.0; }
            else if (ch === 2) { gL.gain.value = centerGain; gR.gain.value = centerGain; }
            else if (ch === 3) { gL.gain.value = lfeGain; gR.gain.value = lfeGain; }
            else { gL.gain.value = surroundGain; gR.gain.value = surroundGain; }
            try { splitter.connect(gL, ch); splitter.connect(gR, ch); } catch (e) {}
            try { gL.connect(merger, 0, 0); gR.connect(merger, 0, 1); } catch (e) {}
          }
          try { sourceNode.connect(splitter); } catch (e) {}
          const compressor = audioCtx.createDynamicsCompressor();
          try { merger.connect(compressor); } catch (e) {}
          // create fileAudioGain (sent to peers) and localPlaybackGain (host hears)
          this.fileAudioGain = audioCtx.createGain();
          this.localPlaybackGain = audioCtx.createGain();
          const dest = audioCtx.createMediaStreamDestination();
          try { compressor.connect(this.fileAudioGain); } catch (e) {}
          try { this.fileAudioGain.connect(dest); } catch (e) {}
          try { compressor.connect(this.localPlaybackGain); } catch (e) {}
          try { this.localPlaybackGain.connect(audioCtx.destination); } catch (e) {}
          // default values
          try { this.fileAudioGain.gain.value = 1; } catch (e) {}
          try { this.localPlaybackGain.gain.value = 1; } catch (e) {}
          try { videoElement.muted = true; } catch (e) {}
          const combined = new MediaStream();
          if (capture && capture.getVideoTracks().length > 0) {
            capture.getVideoTracks().forEach(t => combined.addTrack(t));
          } else {
            const canvas = document.createElement('canvas');
            canvas.width = videoElement.videoWidth || 640;
            canvas.height = videoElement.videoHeight || 360;
            const ctx = canvas.getContext('2d');
            let rafId: number | null = null;
            const draw = () => {
              try { ctx && ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height); } catch (e) {}
              rafId = requestAnimationFrame(draw);
            };
            draw();
            const canvasStream = (canvas as any).captureStream?.(25);
            if (canvasStream) {
              canvasStream.getVideoTracks().forEach(t => combined.addTrack(t));
            }
            if (rafId) setTimeout(() => { cancelAnimationFrame(rafId!); }, 1000);
          }
          dest.stream.getAudioTracks().forEach(t => combined.addTrack(t));
          this.fileStream = combined;
          this.peers.forEach(peer => {
            try { this.addOrReplaceTracks(peer.pc, this.fileStream!); } catch (e) {}
          });
          this.peers.forEach(async (peer) => {
            try { await this.createOffer(peer.id); } catch (e) {}
          });
          return;
        }
      }
      if (capture && capture.getTracks().length > 0) {
        this.fileStream = capture;
        this.peers.forEach(peer => {
          try { this.addOrReplaceTracks(peer.pc, this.fileStream!); } catch (e) {}
        });
        this.peers.forEach(async (peer) => { try { await this.createOffer(peer.id); } catch (e) {} });
        return;
      }
    } catch (e) {}
    const fileId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    this.totalChunksExpected = Math.ceil(file.size / CHUNK_SIZE);
    this.peers.forEach(peer => {
      if (peer.dataChannel && peer.dataChannel.readyState === 'open') {
        try {
          peer.dataChannel.send(JSON.stringify({
            type: 'file-start',
            fileId,
            name: file.name,
            size: file.size,
            mime: file.type,
            totalChunks: this.totalChunksExpected
          }));
        } catch (e) {}
      }
    });
    this.isSendingFile = true;
    const fileReader = new FileReader();
    let offset = 0;
    const readNext = () => {
      const slice = file.slice(offset, offset + CHUNK_SIZE);
      fileReader.readAsArrayBuffer(slice);
    };
    fileReader.onload = (e) => {
      if (e.target?.result) {
        const chunk = e.target.result as ArrayBuffer;
        this.peers.forEach(peer => { this.enqueueChunk(peer.id, chunk); });
        offset += CHUNK_SIZE;
        if (offset < file.size) readNext();
        else {
          this.peers.forEach(peer => {
            if (peer.dataChannel && peer.dataChannel.readyState === 'open') {
              try { peer.dataChannel.send(JSON.stringify({ type: 'file-end', fileId })); } catch (e) {}
            }
          });
          this.isSendingFile = false;
        }
      }
    };
    setTimeout(() => readNext(), 250);
  }

  private handleIncomingFileChunk(peerId: string, chunk: ArrayBuffer) {
    const entryPair = Array.from(this.incomingFiles.entries()).find(([id, entry]) => {
      if (!entry.totalChunks) return true;
      return entry.chunks.length < (entry.totalChunks || 0);
    });
    if (entryPair) {
      const [fileId, entry] = entryPair;
      entry.chunks.push(chunk);
      return;
    }
    let total = this.prebufferChunks.reduce((s, c) => s + c.byteLength, 0);
    total += chunk.byteLength;
    if (total > this.prebufferMaxBytes) {
      return;
    }
    this.prebufferChunks.push(chunk);
  }

  private finishIncomingFile(fileId: string) {
    const entry = this.incomingFiles.get(fileId);
    if (!entry) return;
    try {
      const blobParts: BlobPart[] = entry.chunks.map(ab => new Uint8Array(ab));
      const blob = new Blob(blobParts, { type: entry.metadata?.mime || 'video/mp4' });
      if (this.videoElement) {
        if (this.currentVideoObjectUrl) {
          try { URL.revokeObjectURL(this.currentVideoObjectUrl); } catch {}
          this.currentVideoObjectUrl = null;
        }
        const url = URL.createObjectURL(blob);
        this.currentVideoObjectUrl = url;
        this.videoElement.src = url;
        try { this.videoElement.muted = true; this.videoElement.play().catch(() => {}); } catch (e) {}
      } else {
        const reader = new FileReader();
        reader.onload = () => {
          const ab = reader.result as ArrayBuffer;
          this.prebufferChunks.push(ab);
        };
        reader.readAsArrayBuffer(blob);
      }
    } catch (e) {} finally {
      this.incomingFiles.delete(fileId);
    }
  }

  private onStreamReceived(peerId: string, stream: MediaStream) {
    const videoElement = document.createElement('video');
    videoElement.srcObject = stream;
    videoElement.autoplay = true;
    videoElement.muted = true;
    videoElement.playsInline = true;
    videoElement.style.position = 'fixed';
    videoElement.style.bottom = '8px';
    videoElement.style.right = '8px';
    videoElement.style.width = '180px';
    videoElement.style.zIndex = '9999';
    document.body.appendChild(videoElement);
  }

  private removePeer(peerId: string) {
    const peer = this.peers.get(peerId);
    if (peer) {
      try { peer.pc.close(); } catch (e) {}
      this.peers.delete(peerId);
    }
  }

  syncVideoPlay(currentTime: number) {
    if (this.isHost && this.videoElement) {
      this.videoElement.currentTime = currentTime;
      this.videoElement.play();
      socketManager.playVideo(currentTime);
    }
  }

  syncVideoPause() {
    if (this.isHost && this.videoElement) {
      this.videoElement.pause();
      socketManager.pauseVideo();
    }
  }

  syncVideoSeek(time: number) {
    if (this.isHost && this.videoElement) {
      this.videoElement.currentTime = time;
      socketManager.seekVideo(time);
    }
  }

  async testCreateConnection(peerId: string) {
    if (this.isHost) {
      await this.createOffer(peerId);
    }
  }

  testConnection() {}

  cleanup() {
    if (this.socketCallbacks) {
      socketManager.offWebRTCOffer(this.socketCallbacks.offer);
      socketManager.offWebRTCAnswer(this.socketCallbacks.answer);
      socketManager.offWebRTCIceCandidate(this.socketCallbacks.iceCandidate);
      socketManager.offWebRTCPeerJoined(this.socketCallbacks.peerJoined);
      socketManager.offWebRTCPeerLeft(this.socketCallbacks.peerLeft);
    }
    if (this.localStream) {
      try { this.localStream.getTracks().forEach(t => t.stop()); } catch {}
      this.localStream = null;
    }
    if (this.screenStream) {
      try { this.screenStream.getTracks().forEach(t => t.stop()); } catch {}
      this.screenStream = null;
    }
    if (this.fileStream) {
      try { this.fileStream.getTracks().forEach(t => t.stop()); } catch {}
      this.fileStream = null;
    }
    this.peers.forEach(peer => { try { peer.pc.close(); } catch {} });
    this.peers.clear();
    this.isHost = false;
    this.currentVideoFile = null;
    if (this.currentVideoObjectUrl) {
      try { URL.revokeObjectURL(this.currentVideoObjectUrl); } catch (e) {}
      this.currentVideoObjectUrl = null;
    }
    this.videoElement = null;
    this.prebufferChunks = [];
    this.incomingFiles.clear();
    this.isSendingFile = false;
    this.sendQueues.clear();
    this.socketCallbacks = null;
    this.pendingRemoteCandidates.clear();
    if (this.audioContext) {
      try { this.audioContext.close().catch(() => {}); } catch {}
      this.audioContext = null;
    }
    this.fileAudioGain = null;
    this.localPlaybackGain = null;
    this.retryCounts.clear();
  }

  getPeers() { return Array.from(this.peers.values()); }
  getLocalStream() { return this.localStream; }
  getScreenStream() { return this.screenStream; }
  isHostUser() { return this.isHost; }
  getConnectedPeersCount() { return Array.from(this.peers.values()).filter(peer => peer.isConnected).length; }
  getConnectionStatus() {
    return {
      isHost: this.isHost,
      connectedPeers: this.getConnectedPeersCount(),
      totalPeers: this.peers.size,
      peers: this.getPeers().map(peer => ({ id: peer.id, connected: peer.isConnected, connectionState: peer.connectionState }))
    };
  }
}

export const webrtcManager = new WebRTCManager();
