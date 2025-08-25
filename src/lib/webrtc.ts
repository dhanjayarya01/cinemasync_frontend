
import { socketManager } from './socket';

export interface WebRTCPeer {
  id: string;
  pc: RTCPeerConnection;
  dataChannel?: RTCDataChannel;
  stream?: MediaStream;
  isConnected: boolean;
  connectionState: string;
}

export interface VideoChunk {
  id: string;
  data: ArrayBuffer;
  timestamp: number;
  sequence: number;
  offset: number;
}

const CHUNK_SIZE = 16 * 1024; // 16KB for reliability across browsers

function readFileInChunks(file: File, onChunk: (chunk: ArrayBuffer, offset: number, sequence: number) => void, onEnd?: () => void) {
  let offset = 0;
  let sequence = 0;
  const fileReader = new FileReader();

  fileReader.onload = function (e) {
    if (e.target?.result) {
      onChunk(e.target.result as ArrayBuffer, offset, sequence);
      offset += CHUNK_SIZE;
      sequence++;
      if (offset < file.size) {
        readNext();
      } else if (onEnd) {
        onEnd();
      }
    }
  };

  function readNext() {
    const slice = file.slice(offset, offset + CHUNK_SIZE);
    fileReader.readAsArrayBuffer(slice);
  }

  readNext();
}

class WebRTCManager {
  private peers: Map<string, WebRTCPeer> = new Map();
  private sendQueues: Map<string, Array<ArrayBuffer>> = new Map();
  private static readonly MAX_BUFFERED_AMOUNT = 4 * 1024 * 1024; // 4MB
  private localStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
  private fileStream: MediaStream | null = null;
  private isHost = false;
  private currentVideoFile: File | null = null;
  private currentVideoObjectUrl: string | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private chunkSize = CHUNK_SIZE;

  // Fallback file-reassembly map: fileId -> { metadata, chunks[] }
  private incomingFiles: Map<string, { chunks: ArrayBuffer[]; totalChunks?: number; metadata?: any }> = new Map();

  // Prebuffer chunks that arrived before file-start seen
  private prebufferChunks: Array<ArrayBuffer> = [];

  // State
  private isSendingFile = false;

  // Store socket callback refs for cleanup
  private socketCallbacks: {
    offer: (data: { from: string; offer: any }) => void;
    answer: (data: { from: string; answer: any }) => void;
    iceCandidate: (data: { from: string; candidate: any }) => void;
    peerJoined: (data: { peerId: string }) => void;
    peerLeft: (data: { peerId: string }) => void;
  } | null = null;

  // Expose for debug/visibility
  private totalChunksExpected = 0;

  constructor() {
    console.log('[WebRTC] WebRTC manager initialized');
  }

  setHostStatus(isHost: boolean) {
    this.isHost = isHost;
    this.ensureSocketListeners();
  }

  setVideoElement(videoElement: HTMLVideoElement | null) {
    this.videoElement = videoElement;
    this.ensureSocketListeners();

    // If we have prebuffered ArrayBuffers, assemble into a Blob and attach
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
        console.log('[WebRTC] Attached prebuffered video to bound element');
      } catch (e) {
        console.warn('[WebRTC] Failed to attach prebuffered video', e);
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
    const offerCallback = (data: { from: string; offer: any }) => {
      this.handleOffer(data.from, data.offer);
    };

    const answerCallback = (data: { from: string; answer: any }) => {
      this.handleAnswer(data.from, data.answer);
    };

    const iceCandidateCallback = (data: { from: string; candidate: any }) => {
      this.handleIceCandidate(data.from, data.candidate);
    };

    const peerJoinedCallback = (data: { peerId: string }) => {
      this.handlePeerJoined(data.peerId);
    };

    const peerLeftCallback = (data: { peerId: string }) => {
      this.handlePeerLeft(data.peerId);
    };

    this.socketCallbacks = {
      offer: offerCallback,
      answer: answerCallback,
      iceCandidate: iceCandidateCallback,
      peerJoined: peerJoinedCallback,
      peerLeft: peerLeftCallback
    };

    socketManager.onWebRTCOffer(offerCallback);
    socketManager.onWebRTCAnswer(answerCallback);
    socketManager.onWebRTCIceCandidate(iceCandidateCallback);
    socketManager.onWebRTCPeerJoined(peerJoinedCallback);
    socketManager.onWebRTCPeerLeft(peerLeftCallback);

    // Keep a message listener to debug join messages
    socketManager.onMessage((message) => {
      if (message.message && typeof message.message === 'string') {
        try {
          const parsed = JSON.parse(message.message);
          if (parsed.type === 'user-joined' && parsed.user) {
            console.log('[WebRTC] user-joined message', parsed.user.id);
          }
        } catch (e) {}
      }
    });

    console.log('[WebRTC] Socket callbacks registered');
  }

  async initializePeerConnection(peerId: string, isInitiator: boolean = false): Promise<RTCPeerConnection> {
    const existing = this.peers.get(peerId);
    if (existing) {
      // ensure data channel exists for host initiator case
      if (this.isHost && isInitiator && !existing.dataChannel) {
        try {
          const dc = existing.pc.createDataChannel('video-chunks', { ordered: true, maxRetransmits: 3 });
          existing.dataChannel = dc;
          this.setupDataChannel(peerId, dc, true);
        } catch (e) {}
      }
      return existing.pc;
    }

    const configuration: RTCConfiguration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
      ]
    };

    const pc = new RTCPeerConnection(configuration);
    const peer: WebRTCPeer = {
      id: peerId,
      pc,
      isConnected: false,
      connectionState: 'new'
    };

    // Add local tracks (camera/mic) if present
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        try { pc.addTrack(track, this.localStream!); } catch (e) {}
      });
    }

    // Add file/screen stream tracks if present
    if (this.fileStream) {
      try {
        this.addOrReplaceTracks(pc, this.fileStream);
      } catch (e) {
        console.warn('[WebRTC] addOrReplaceTracks failed during init', e);
      }
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
        } catch (e) {
          console.error('[WebRTC] error attaching remote stream to video element', e);
        }
      } else {
        this.onStreamReceived(peerId, event.streams[0]);
      }
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      peer.connectionState = state;
      if (state === 'connected') {
        peer.isConnected = true;
      } else if (state === 'failed' || state === 'disconnected') {
        peer.isConnected = false;
        this.removePeer(peerId);
      }
    };

    pc.oniceconnectionstatechange = () => {
      // nothing extra here, but useful for debugging
    };

    this.peers.set(peerId, peer);
    return pc;
  }

  private setupDataChannel(peerId: string, dataChannel: RTCDataChannel, isHost: boolean) {
    try {
      (dataChannel as any).binaryType = 'arraybuffer';
    } catch (e) {}

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
      if (p) {
        p.isConnected = false;
        p.connectionState = 'failed';
      }
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
          } catch (e) {
            // ignore non-json strings
          }
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
          this.createOffer(id).catch(() => {});
        }, 500);
      }
    });
  }

  private async handleOffer(from: string, offer: RTCSessionDescriptionInit) {
    if (this.isHost) return;
    const pc = await this.initializePeerConnection(from, false);
    try {
      await pc.setRemoteDescription(offer);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socketManager.sendAnswer(answer, from);
    } catch (error) {
      console.error('[WebRTC] Error handling offer', error);
    }
  }

  private async handleAnswer(from: string, answer: RTCSessionDescriptionInit) {
    if (!this.isHost) return;
    const peer = this.peers.get(from);
    if (!peer) return;
    try {
      await peer.pc.setRemoteDescription(answer);
    } catch (error) {
      console.error('[WebRTC] Error handling answer', error);
    }
  }

  private async handleIceCandidate(from: string, candidate: RTCIceCandidateInit) {
    const peer = this.peers.get(from);
    if (!peer) return;
    try {
      await peer.pc.addIceCandidate(candidate);
    } catch (error) {
      console.error('[WebRTC] Error adding ICE candidate', error);
    }
  }

  private handlePeerJoined(peerId: string) {
    if (this.isHost) {
      setTimeout(() => {
        this.createOffer(peerId).catch(() => {});
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

      // Replace video track for each peer
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

      // Renegotiate
      this.peers.forEach(async (peer) => {
        try {
          await this.createOffer(peer.id);
        } catch (e) {}
      });

      return this.screenStream;
    } catch (error) {
      throw error;
    }
  }

  stopScreenShare() {
    if (this.screenStream) {
      try {
        this.screenStream.getTracks().forEach(t => { try { t.stop(); } catch {} });
      } catch (e) {}
      // only clear fileStream if it is the screenStream reference
      if (this.fileStream && this.fileStream === this.screenStream) {
        this.fileStream = null;
      }
      this.screenStream = null;
    }
  }

  public stopFileStream() {
    // Stop any existing file/screen transfer
    if (this.fileStream) {
      try {
        this.fileStream.getTracks().forEach(t => { try { t.stop(); } catch {} });
      } catch (e) {}
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
  }

  async streamVideoFile(file: File, videoElement: HTMLVideoElement) {
    // Stop previous file stream cleanly
    try { this.stopFileStream(); } catch (e) {}

    this.currentVideoFile = file;
    this.videoElement = videoElement;

    // Create object URL and assign to host's video element
    try {
      const videoUrl = URL.createObjectURL(file);
      this.currentVideoObjectUrl = videoUrl;
      videoElement.src = videoUrl;
      // Ensure host audio is unmuted so captureStream may include audio
      try { videoElement.muted = false; } catch (e) {}
      try {
        await videoElement.play().catch(() => {});
      } catch (e) {}

      // Try captureStream (preferred)
      const capture = (videoElement as any).captureStream?.() || (videoElement as any).mozCaptureStream?.();
      if (capture && capture.getTracks().length > 0) {
        this.fileStream = capture as MediaStream;

        // Replace tracks on all peers
        this.peers.forEach(peer => {
          try {
            this.addOrReplaceTracks(peer.pc, this.fileStream!);
          } catch (e) {}
        });

        // Renegotiate
        this.peers.forEach(async (peer) => {
          try { await this.createOffer(peer.id); } catch (e) {}
        });

        return;
      } else {
        // If captureStream not available or no tracks, fall back to data-channel transfer
        console.warn('[WebRTC] captureStream not available or no tracks; falling back to data-channel transfer');
      }
    } catch (e) {
      console.warn('[WebRTC] Error during captureStream attempt, falling back to data-channel', e);
    }

    // Fallback: data-channel transfer of the file
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
    let chunksSent = 0;
    const start = () => readFileInChunks(file, (chunk, offset, sequence) => {
      chunksSent++;
      this.peers.forEach(peer => {
        this.enqueueChunk(peer.id, chunk);
      });
    }, () => {
      this.peers.forEach(peer => {
        if (peer.dataChannel && peer.dataChannel.readyState === 'open') {
          try {
            peer.dataChannel.send(JSON.stringify({ type: 'file-end', fileId }));
          } catch (e) {}
        }
      });
      this.isSendingFile = false;
    });

    setTimeout(start, 250);
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

    // prebuffer fallback
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
        try {
          this.videoElement.muted = true;
          this.videoElement.play().catch(() => {});
        } catch (e) {}
      } else {
        const reader = new FileReader();
        reader.onload = () => {
          const ab = reader.result as ArrayBuffer;
          this.prebufferChunks.push(ab);
        };
        reader.readAsArrayBuffer(blob);
      }
    } catch (e) {
      console.error('[WebRTC] Error assembling incoming file', e);
    } finally {
      this.incomingFiles.delete(fileId);
    }
  }

  private onStreamReceived(peerId: string, stream: MediaStream) {
    // fallback display when UI hasn't bound element
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
      this.peers.forEach(peer => {
        socketManager.sendMessage(JSON.stringify({
          type: 'video-control',
          action: 'play',
          currentTime
        }), false);
      });
    }
  }

  syncVideoPause() {
    if (this.isHost && this.videoElement) {
      this.videoElement.pause();
      this.peers.forEach(peer => {
        socketManager.sendMessage(JSON.stringify({
          type: 'video-control',
          action: 'pause'
        }), false);
      });
    }
  }

  syncVideoSeek(time: number) {
    if (this.isHost && this.videoElement) {
      this.videoElement.currentTime = time;
      this.peers.forEach(peer => {
        socketManager.sendMessage(JSON.stringify({
          type: 'video-control',
          action: 'seek',
          time
        }), false);
      });
    }
  }

  async testCreateConnection(peerId: string) {
    if (this.isHost) {
      await this.createOffer(peerId);
    }
  }

  testConnection() {
    console.log('[WebRTC] Peers: ', this.peers.size);
    this.peers.forEach((peer) => {
      console.log(`[WebRTC] ${peer.id} connected=${peer.isConnected} state=${peer.connectionState}`);
    });
  }

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

    this.peers.forEach(peer => {
      try { peer.pc.close(); } catch {}
    });
    this.peers.clear();

    this.isHost = false;
    this.currentVideoFile = null;
    if (this.currentVideoObjectUrl) {
      try { URL.revokeObjectURL(this.currentVideoObjectUrl); } catch {}
      this.currentVideoObjectUrl = null;
    }
    this.videoElement = null;
    this.prebufferChunks = [];
    this.incomingFiles.clear();
    this.isSendingFile = false;
    this.sendQueues.clear();
    this.socketCallbacks = null;
  }

  getPeers() {
    return Array.from(this.peers.values());
  }

  getLocalStream() {
    return this.localStream;
  }

  getScreenStream() {
    return this.screenStream;
  }

  isHostUser() {
    return this.isHost;
  }

  getConnectedPeersCount() {
    return Array.from(this.peers.values()).filter(peer => peer.isConnected).length;
  }

  getConnectionStatus() {
    return {
      isHost: this.isHost,
      connectedPeers: this.getConnectedPeersCount(),
      totalPeers: this.peers.size,
      peers: this.getPeers().map(peer => ({
        id: peer.id,
        connected: peer.isConnected,
        connectionState: peer.connectionState
      }))
    };
  }
}

export const webrtcManager = new WebRTCManager();
