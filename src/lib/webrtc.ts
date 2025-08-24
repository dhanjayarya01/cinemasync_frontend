// lib/webrtc.ts
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
  private chunkSize = CHUNK_SIZE; // use const chunk size

  // Fallback file-reassembly map: fileId -> { metadata, chunks[] }
  private incomingFiles: Map<string, { chunks: ArrayBuffer[]; totalChunks?: number; metadata?: any }> = new Map();

  // MediaSource fields removed from primary flow (we avoid naive MSE usage)
  private prebufferChunks: Array<ArrayBuffer> = [];

  // State
  private isSendingFile = false;

  // Store callback references for cleanup
  private socketCallbacks: {
    offer: (data: { from: string; offer: any }) => void;
    answer: (data: { from: string; answer: any }) => void;
    iceCandidate: (data: { from: string; candidate: any }) => void;
    peerJoined: (data: { peerId: string }) => void;
    peerLeft: (data: { peerId: string }) => void;
  } | null = null;

  constructor() {
    console.log('[WebRTC] WebRTC manager initialized');
  }

  setHostStatus(isHost: boolean) {
    console.log(`[WebRTC] Setting host status to: ${isHost}`);
    this.isHost = isHost;
    this.ensureSocketListeners();
  }

  setVideoElement(videoElement: HTMLVideoElement) {
    console.log(`[WebRTC] Setting video element for ${this.isHost ? 'host' : 'non-host'} user`);
    this.videoElement = videoElement;
    this.ensureSocketListeners();

    // If we had prebuffered chunks, we will not attempt MSE; instead they will
    // be assembled when 'file-end' arrives. If blob was prepared earlier, it will be set then.
  }

  public ensureSocketListeners() {
    if (!this.socketCallbacks) {
      console.log('[WebRTC] Setting up socket listeners...');
      this.setupSocketListeners();
    }
  }

  private setupSocketListeners() {
    if (this.socketCallbacks) {
      console.log('[WebRTC] Socket callbacks already registered, skipping');
      return;
    }

    this.setupWebRTCCallbacks();
  }

  private setupWebRTCCallbacks() {
    const offerCallback = (data: { from: string; offer: any }) => {
      console.log(`[WebRTC] Received offer from ${data.from}`);
      this.handleOffer(data.from, data.offer);
    };

    const answerCallback = (data: { from: string; answer: any }) => {
      console.log(`[WebRTC] Received answer from ${data.from}`);
      this.handleAnswer(data.from, data.answer);
    };

    const iceCandidateCallback = (data: { from: string; candidate: any }) => {
      console.log(`[WebRTC] Received ICE candidate from ${data.from}`);
      this.handleIceCandidate(data.from, data.candidate);
    };

    const peerJoinedCallback = (data: { peerId: string }) => {
      console.log(`[WebRTC] Peer ${data.peerId} joined`);
      this.handlePeerJoined(data.peerId);
    };

    const peerLeftCallback = (data: { peerId: string }) => {
      console.log(`[WebRTC] Peer ${data.peerId} left`);
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

    // Also listen to socketManager.message for host join hints (if used)
    socketManager.onMessage((message) => {
      if (message.message && typeof message.message === 'string') {
        try {
          const parsed = JSON.parse(message.message);
          if (parsed.type === 'user-joined' && parsed.user) {
            console.log(`[WebRTC] User joined message: ${parsed.user.id}`);
          }
        } catch (e) {}
      }
    });

    console.log('[WebRTC] Socket callbacks registered successfully');
  }

  async initializePeerConnection(peerId: string, isInitiator: boolean = false): Promise<RTCPeerConnection> {
    console.log(`[WebRTC] Initializing peer connection with ${peerId}, isInitiator: ${isInitiator}, isHost: ${this.isHost}`);

    const existingPeer = this.peers.get(peerId);
    if (existingPeer) {
      console.log(`[WebRTC] Peer connection already exists for ${peerId}, returning existing connection`);
      if (this.isHost && isInitiator && !existingPeer.dataChannel) {
        console.log(`[WebRTC] Host creating data channel for existing peer ${peerId}`);
        const dataChannel = existingPeer.pc.createDataChannel('video-chunks', {
          ordered: true,
          maxRetransmits: 3
        });
        existingPeer.dataChannel = dataChannel;
        this.setupDataChannel(peerId, dataChannel, true);
      }
      return existingPeer.pc;
    }

    const configuration = {
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

    if (this.localStream) {
      console.log(`[WebRTC] Adding local stream tracks to peer ${peerId}`);
      this.localStream.getTracks().forEach(track => {
        try { pc.addTrack(track, this.localStream!); } catch (e) {}
      });
    }

    if (this.fileStream) {
      console.log(`[WebRTC] Adding file stream tracks to peer ${peerId}`);
      this.addOrReplaceTracks(pc, this.fileStream);
    }

    if (this.isHost && isInitiator) {
      console.log(`[WebRTC] Host creating data channel for peer ${peerId}`);
      const dataChannel = pc.createDataChannel('video-chunks', {
        ordered: true,
        maxRetransmits: 3
      });
      peer.dataChannel = dataChannel;
      this.setupDataChannel(peerId, dataChannel, true);
    } else if (!this.isHost) {
      pc.ondatachannel = (event) => {
        console.log(`[WebRTC] Receiver received data channel from peer ${peerId}`);
        const dataChannel = event.channel;
        peer.dataChannel = dataChannel;
        this.setupDataChannel(peerId, dataChannel, false);
      };
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socketManager.sendIceCandidate(event.candidate, peerId);
      }
    };

    pc.ontrack = (event) => {
      console.log(`[WebRTC] Received media stream from peer ${peerId}`);
      peer.stream = event.streams[0];
      if (this.videoElement) {
        try {
          (this.videoElement as any).srcObject = event.streams[0];
          this.videoElement.autoplay = true;
          (this.videoElement as any).playsInline = true;
          this.videoElement.play().catch(() => {});
        } catch (e) {
          console.error('[WebRTC] Error attaching remote stream to video element:', e);
        }
      } else {
        this.onStreamReceived(peerId, event.streams[0]);
      }
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      peer.connectionState = state;
      console.log(`[WebRTC] Peer ${peerId} connection state changed to: ${state}`);

      if (state === 'connected') {
        peer.isConnected = true;
        console.log(`[WebRTC] ✅ Peer ${peerId} connected successfully!`);
      } else if (state === 'failed' || state === 'disconnected') {
        peer.isConnected = false;
        console.log(`[WebRTC] ❌ Peer ${peerId} disconnected: ${state}`);
        this.removePeer(peerId);
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`[WebRTC] Peer ${peerId} ICE connection state: ${pc.iceConnectionState}`);
    };

    this.peers.set(peerId, peer);
    console.log(`[WebRTC] Peer connection initialized for ${peerId}`);
    return pc;
  }

  private setupDataChannel(peerId: string, dataChannel: RTCDataChannel, isHost: boolean) {
    console.log(`[WebRTC] Setting up data channel for peer ${peerId}, isHost: ${isHost}`);

    try {
      (dataChannel as any).binaryType = 'arraybuffer';
    } catch (e) {}

    try { (dataChannel as any).bufferedAmountLowThreshold = 1024 * 1024; } catch {}

    dataChannel.onopen = () => {
      console.log(`[WebRTC] ✅ Data channel opened for peer ${peerId}`);
      const peer = this.peers.get(peerId);
      if (peer) peer.isConnected = true;
      this.flushSendQueue(peerId);
    };

    dataChannel.onclose = () => {
      console.log(`[WebRTC] Data channel closed for peer ${peerId}`);
      const peer = this.peers.get(peerId);
      if (peer) peer.isConnected = false;
    };

    dataChannel.onerror = (e) => {
      console.error(`[WebRTC] Data channel error for peer ${peerId}:`, e);
      const peer = this.peers.get(peerId);
      if (peer) {
        peer.isConnected = false;
        peer.connectionState = 'failed';
      }
    };

    if (!isHost) {
      dataChannel.onmessage = (event) => {
        const payload = event.data;
        if (payload instanceof ArrayBuffer) {
          // Binary chunk for file assembly (simple protocol: assign to current active incoming file)
          this.handleIncomingFileChunk(peerId, payload);
        } else if (payload instanceof Blob) {
          payload.arrayBuffer().then((buf) => this.handleIncomingFileChunk(peerId, buf)).catch((e) => console.error('[WebRTC] Blob->ArrayBuffer conversion error', e));
        } else if (typeof payload === 'string') {
          // Control messages: file-start / file-end
          try {
            const parsed = JSON.parse(payload);
            if (parsed.type === 'file-start') {
              console.log(`[WebRTC] [RECEIVER] file-start received for fileId=${parsed.fileId}, name=${parsed.name}`);
              this.incomingFiles.set(parsed.fileId, { chunks: [], totalChunks: parsed.totalChunks, metadata: parsed });
            } else if (parsed.type === 'file-end') {
              console.log(`[WebRTC] [RECEIVER] file-end received for fileId=${parsed.fileId}`);
              // assemble file
              this.finishIncomingFile(parsed.fileId);
            } else {
              // ignore other control messages for now
            }
          } catch (e) {
            console.warn('[WebRTC] [RECEIVER] Received a non-JSON string on data channel', payload);
          }
        } else {
          console.log(`[WebRTC] [RECEIVER] Received unknown data type from ${peerId}`, payload);
        }
      };
    } else {
      dataChannel.onbufferedamountlow = () => {
        // flushing queued chunks for host
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
      if (currentVideo) {
        try { currentVideo.replaceTrack(newVideo); } catch (e) { console.warn('replaceTrack video failed', e); }
      } else {
        try { pc.addTrack(newVideo, stream); } catch (e) { console.warn('addTrack video failed', e); }
      }
    }
    if (newAudio) {
      if (currentAudio) {
        try { currentAudio.replaceTrack(newAudio); } catch (e) { console.warn('replaceTrack audio failed', e); }
      } else {
        try { pc.addTrack(newAudio, stream); } catch (e) { console.warn('addTrack audio failed', e); }
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
      console.error(`[WebRTC] [HOST] Error sending chunk directly to ${peerId}, queued:`, e);
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
      if (dc.bufferedAmount + next.byteLength > WebRTCManager.MAX_BUFFERED_AMOUNT) {
        break;
      }
      try {
        dc.send(next);
        queue.shift();
      } catch (e) {
        console.error(`[WebRTC] [HOST] Error flushing send queue to ${peerId}:`, e);
        break;
      }
    }

    if (queue.length === 0) {
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
        console.log(`[WebRTC] [HOST] Ensuring connection to ${id}`);
        this.createOffer(id);
      }
    });
  }

  private async handleOffer(from: string, offer: RTCSessionDescriptionInit) {
    console.log(`[WebRTC][Non-Host] Offer received from host (${from}), isHost: ${this.isHost}`);
    if (this.isHost) {
      console.warn(`[WebRTC] Host received offer, ignoring`);
      return;
    }

    const pc = await this.initializePeerConnection(from, false);
    try {
      await pc.setRemoteDescription(offer);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socketManager.sendAnswer(answer, from);
    } catch (error) {
      console.error('[WebRTC][Non-Host] Error handling offer:', error);
    }
  }

  private async handleAnswer(from: string, answer: RTCSessionDescriptionInit) {
    console.log(`[WebRTC][Host] Answer received from peer (${from}), isHost: ${this.isHost}`);
    if (!this.isHost) {
      console.warn(`[WebRTC] Non-host received answer, ignoring`);
      return;
    }

    const peer = this.peers.get(from);
    if (peer) {
      try {
        if (peer.pc.signalingState === 'stable') {
          console.log(`[WebRTC][Host] Connection already stable, ignoring answer from ${from}`);
          return;
        }

        await peer.pc.setRemoteDescription(answer);
        console.log(`[WebRTC][Host] Answer processed for peer ${from}`);
      } catch (error) {
        console.error('[WebRTC][Host] Error handling answer:', error);
      }
    } else {
      console.warn(`[WebRTC][Host] No peer found for ${from}`);
    }
  }

  private async handleIceCandidate(from: string, candidate: RTCIceCandidateInit) {
    console.log(`[WebRTC] ICE candidate received from ${from}, isHost: ${this.isHost}`);
    const peer = this.peers.get(from);
    if (peer) {
      try {
        await peer.pc.addIceCandidate(candidate);
        console.log(`[WebRTC] ICE candidate added for peer ${from}`);
      } catch (error) {
        console.error('[WebRTC] Error adding ICE candidate:', error);
      }
    } else {
      console.warn(`[WebRTC] No peer found for ICE candidate from ${from}`);
    }
  }

  private handlePeerJoined(peerId: string) {
    console.log(`[WebRTC] Peer ${peerId} joined the room, isHost: ${this.isHost}`);
    if (this.isHost) {
      setTimeout(() => {
        this.createOffer(peerId);
      }, 1000);
    } else {
      console.log(`[WebRTC] Non-host user, waiting for offer from host`);
    }
  }

  private handlePeerLeft(peerId: string) {
    console.log(`[WebRTC] Peer ${peerId} left the room`);
    this.removePeer(peerId);
  }

  async createOffer(peerId: string): Promise<RTCSessionDescriptionInit> {
    console.log(`[WebRTC][Host] Creating offer for peer ${peerId}, isHost: ${this.isHost}`);
    if (!this.isHost) {
      console.warn(`[WebRTC] Non-host user trying to create offer, ignoring`);
      return {} as RTCSessionDescriptionInit;
    }

    const existingPeer = this.peers.get(peerId);
    if (existingPeer) {
      const state = existingPeer.pc.signalingState;
      if (state === 'have-local-offer') {
        const existingOffer = existingPeer.pc.localDescription;
        if (existingOffer) {
          socketManager.sendOffer(existingOffer, peerId);
          return existingOffer;
        }
      }
      if (state !== 'stable') {
        try {
          const offer = await existingPeer.pc.createOffer({ iceRestart: true });
          await existingPeer.pc.setLocalDescription(offer);
          socketManager.sendOffer(offer, peerId);
          return offer;
        } catch (e) {
          console.warn(`[WebRTC][Host] Failed to refresh offer for ${peerId}`, e);
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
      console.log('[WebRTC] Starting local media stream');
      this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
      console.log('[WebRTC] ✅ Local media stream started');
      return this.localStream;
    } catch (error) {
      console.error('[WebRTC] Error accessing media devices:', error);
      throw error;
    }
  }

  async startScreenShare(): Promise<MediaStream> {
    try {
      console.log('[WebRTC] Starting screen share');
      this.screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true
      });

      // Replace video track in all peer connections
      this.peers.forEach(peer => {
        const senders = peer.pc.getSenders();
        const videoSender = senders.find(sender => sender.track?.kind === 'video');
        if (videoSender && this.screenStream) {
          const videoTrack = this.screenStream.getVideoTracks()[0];
          try { videoSender.replaceTrack(videoTrack); } catch (e) { console.warn('replaceTrack screen failed', e); }
          console.log(`[WebRTC] Replaced video track for peer ${peer.id}`);
        }
      });

      // Also set as fileStream so logic that expects fileStream can treat screen-share similarly
      this.fileStream = this.screenStream;

      // Renegotiate with all peers
      this.peers.forEach(async (peer) => {
        try {
          await this.createOffer(peer.id);
        } catch (e) {
          console.warn(`[WebRTC] Failed to renegotiate after starting screen share for ${peer.id}`, e);
        }
      });

      console.log('[WebRTC] ✅ Screen share started');
      return this.screenStream;
    } catch (error) {
      console.error('[WebRTC] Error starting screen share:', error);
      throw error;
    }
  }

  stopScreenShare() {
    if (this.screenStream) {
      console.log('[WebRTC] Stopping screen share');
      this.screenStream.getTracks().forEach(track => track.stop());
      this.screenStream = null;
      // Don't automatically clear fileStream if it was a previously selected file; clearing helps avoid stale references
      if (this.fileStream && this.fileStream === this.screenStream) {
        this.fileStream = null;
      }
    }
  }

  // === New: stopFileStream() used when host switches files ===
  public stopFileStream() {
    console.log('[WebRTC] stopFileStream called - cleaning previous file transfer / capture');
    // Stop capture stream if it was used
    if (this.fileStream) {
      try {
        this.fileStream.getTracks().forEach(t => { try { t.stop(); } catch (e) {} });
      } catch (e) {}
      this.fileStream = null;
    }

    // revoke object URL if any
    if (this.currentVideoObjectUrl) {
      try { URL.revokeObjectURL(this.currentVideoObjectUrl); } catch (e) {}
      this.currentVideoObjectUrl = null;
    }

    this.currentVideoFile = null;
    this.isSendingFile = false;
    // reset any pending incoming file structures on receivers (they will be cleared on next file-start/file-end)
    this.incomingFiles.clear();

    // clear send queues
    this.sendQueues.clear();
  }

  // Video streaming with chunking + safer fallback
  async streamVideoFile(file: File, videoElement: HTMLVideoElement) {
    console.log(`[WebRTC] 🎬 Starting video streaming: ${file.name} (${file.size} bytes)`);

    // If previously streaming, stop it first
    try {
      this.stopFileStream();
    } catch (e) {
      console.warn('[WebRTC] Error while stopping previous file stream', e);
    }

    this.currentVideoFile = file;
    this.videoElement = videoElement;

    // Store metadata
    const metadata = { name: file.name, size: file.size, type: file.type };

    // Preferred path: captureStream from a playing <video> element (low-latency, preserves audio)
    const videoUrl = URL.createObjectURL(file);
    this.currentVideoObjectUrl = videoUrl;
    videoElement.src = videoUrl;

    try {
      // Try to play (some browsers require user gesture, but host likely initiated)
      await videoElement.play().catch(() => {});
      const capture = (videoElement as any).captureStream?.() || (videoElement as any).mozCaptureStream?.();
      if (capture && capture.getTracks().length > 0) {
        // use captureStream path
        this.fileStream = capture as MediaStream;
        console.log('[WebRTC] ✅ Using captureStream for file playback');

        // Replace tracks on peers
        this.peers.forEach(peer => {
          this.addOrReplaceTracks(peer.pc, this.fileStream!);
        });

        // Renegotiate so remote gets the new track
        this.peers.forEach(async (peer) => {
          try {
            await this.createOffer(peer.id);
          } catch (e) {
            console.warn(`[WebRTC] Failed to renegotiate after adding file stream for ${peer.id}`, e);
          }
        });

        // done (live capture)
        return;
      } else {
        console.warn('[WebRTC] captureStream not available or no tracks; falling back to data-channel transfer');
      }
    } catch (e) {
      console.warn('[WebRTC] Error enabling captureStream; falling back to data-channel transfer:', e);
    }

    // Fallback: transfer the whole file via data channels (host -> peers), then receivers construct a Blob and set video.src
    // Create a fileId to identify this transfer
    const fileId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    this.totalChunksExpected = Math.ceil(file.size / CHUNK_SIZE);

    // Inform peers about incoming file
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
        } catch (e) {
          console.warn('[WebRTC] Failed to send file-start to', peer.id, e);
        }
      } else {
        console.log(`[WebRTC] [HOST] Peer ${peer.id} has no open dataChannel yet - file-start deferred`);
      }
    });

    this.isSendingFile = true;

    let chunksSent = 0;
    const start = () => readFileInChunks(file, (chunk, offset, sequence) => {
      chunksSent++;
      // Send the ArrayBuffer chunk to all peers via enqueueChunk (which respects backpressure)
      this.peers.forEach(peer => {
        this.enqueueChunk(peer.id, chunk);
      });
    }, () => {
      // Send file-end control
      this.peers.forEach(peer => {
        if (peer.dataChannel && peer.dataChannel.readyState === 'open') {
          try {
            peer.dataChannel.send(JSON.stringify({
              type: 'file-end',
              fileId
            }));
          } catch (e) {
            console.warn('[WebRTC] Failed to send file-end to', peer.id, e);
          }
        }
      });
      this.isSendingFile = false;
      console.log(`[WebRTC] [HOST] ✅ All ${chunksSent} chunks sent for fileId=${fileId}`);
    });

    // small delay to allow receivers bind
    setTimeout(start, 250);
  }

  // Helper used by the fallback assembly
  private handleIncomingFileChunk(peerId: string, chunk: ArrayBuffer) {
    // Find a pending incoming file; pick first with chunks.length < totalChunks or no totalChunks yet
    const entryPair = Array.from(this.incomingFiles.entries()).find(([id, entry]) => {
      if (!entry.totalChunks) return true;
      return entry.chunks.length < (entry.totalChunks || 0);
    });

    if (entryPair) {
      const [fileId, entry] = entryPair;
      entry.chunks.push(chunk);
      // Optionally log progress rarely
      if (entry.chunks.length % 50 === 0) {
        console.log(`[WebRTC] [RECEIVER] Received ${entry.chunks.length}/${entry.totalChunks || '?'} chunks for fileId=${fileId}`);
      }
      return;
    }

    // No incoming file set up — store as prebuffer fallback
    this.prebufferChunks.push(chunk);
    console.warn('[WebRTC] Received chunk but no file-start seen yet - prebuffering');
  }

  private finishIncomingFile(fileId: string) {
    const entry = this.incomingFiles.get(fileId);
    if (!entry) {
      console.warn('[WebRTC] finishIncomingFile: no entry for', fileId);
      return;
    }

    // Concatenate buffers into a single Blob
    try {
      const blobParts: BlobPart[] = entry.chunks.map(ab => new Uint8Array(ab));
      const blob = new Blob(blobParts, { type: entry.metadata?.mime || 'video/mp4' });

      // set on video element if bound
      if (this.videoElement) {
        try {
          // Revoke previous url to avoid leaks
          if (this.currentVideoObjectUrl) {
            try { URL.revokeObjectURL(this.currentVideoObjectUrl); } catch (e) {}
            this.currentVideoObjectUrl = null;
          }
          const url = URL.createObjectURL(blob);
          this.currentVideoObjectUrl = url;
          // Prefer to set src directly
          this.videoElement.src = url;
          // Try muted autoplay to increase success chance
          try {
            this.videoElement.muted = true;
            this.videoElement.play().catch(() => {});
          } catch (e) {}
          console.log('[WebRTC] [RECEIVER] Received file assembled and assigned to video element');
        } catch (e) {
          console.error('[WebRTC] [RECEIVER] Error assigning received video blob URL', e);
        }
      } else {
        // If no element yet, put in prebuffer (as ArrayBuffer)
        const reader = new FileReader();
        reader.onload = () => {
          const ab = reader.result as ArrayBuffer;
          this.prebufferChunks.push(ab);
        };
        reader.readAsArrayBuffer(blob);
      }
    } catch (e) {
      console.error('[WebRTC] [RECEIVER] Error finishing incoming file', e);
    } finally {
      this.incomingFiles.delete(fileId);
    }
  }

  private onStreamReceived(peerId: string, stream: MediaStream) {
    console.log(`[WebRTC] Received media stream from peer ${peerId}`);
    const videoElement = document.createElement('video');
    videoElement.srcObject = stream;
    videoElement.autoplay = true;
    videoElement.muted = true;
    document.body.appendChild(videoElement);
  }

  private removePeer(peerId: string) {
    console.log(`[WebRTC] Removing peer ${peerId}`);
    const peer = this.peers.get(peerId);
    if (peer) {
      try { peer.pc.close(); } catch (e) {}
      this.peers.delete(peerId);
      console.log(`[WebRTC] Peer ${peerId} removed`);
    }
  }

  // Video control sync helpers (unchanged)
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

  // Test helpers
  async testCreateConnection(peerId: string) {
    console.log(`[WebRTC] Manual test: Creating connection with ${peerId}, isHost: ${this.isHost}`);
    if (this.isHost) {
      await this.createOffer(peerId);
    } else {
      console.log(`[WebRTC] Non-host waiting for host offer`);
    }
  }

  testConnection() {
    console.log(`[WebRTC] Connection test - isHost: ${this.isHost}`);
    console.log(`[WebRTC] Total peers: ${this.peers.size}`);
    this.peers.forEach((peer, peerId) => {
      console.log(`[WebRTC] Peer ${peerId}: connected=${peer.isConnected}, state=${peer.connectionState}, iceState=${peer.pc.iceConnectionState}`);
    });
  }

  testSignaling() {
    console.log(`[WebRTC] Signaling test - isHost: ${this.isHost}`);
    console.log(`[WebRTC] Socket callbacks registered: ${!!this.socketCallbacks}`);
    if (this.socketCallbacks) {
      console.log(`[WebRTC] Callbacks: offer=${!!this.socketCallbacks.offer}, answer=${!!this.socketCallbacks.answer}, ice=${!!this.socketCallbacks.iceCandidate}`);
    }
  }

  cleanup() {
    console.log('[WebRTC] Cleaning up WebRTC manager');

    if (this.socketCallbacks) {
      socketManager.offWebRTCOffer(this.socketCallbacks.offer);
      socketManager.offWebRTCAnswer(this.socketCallbacks.answer);
      socketManager.offWebRTCIceCandidate(this.socketCallbacks.iceCandidate);
      socketManager.offWebRTCPeerJoined(this.socketCallbacks.peerJoined);
      socketManager.offWebRTCPeerLeft(this.socketCallbacks.peerLeft);
    }

    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }

    if (this.screenStream) {
      this.screenStream.getTracks().forEach(track => track.stop());
      this.screenStream = null;
    }

    if (this.fileStream) {
      this.fileStream.getTracks().forEach(track => track.stop());
      this.fileStream = null;
    }

    this.peers.forEach(peer => {
      try { peer.pc.close(); } catch (e) {}
    });
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

    console.log('[WebRTC] ✅ Cleanup completed');
  }

  // Getters
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

  // Expose totalChunksExpected for visibility in UI if desired
  private totalChunksExpected = 0;
}

export const webrtcManager = new WebRTCManager();
