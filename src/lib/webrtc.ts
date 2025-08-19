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

const CHUNK_SIZE = 16 * 1024; // 16KB for better reliability across browsers

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
  private videoElement: HTMLVideoElement | null = null;
  private chunkSize = 64 * 1024; // 64KB chunks
  
  // MediaSource Extensions for progressive playback
  private mse: MediaSource | null = null;
  private sourceBuffer: SourceBuffer | null = null;
  private pendingChunks: Array<{offset: number, chunk: ArrayBuffer, sequence: number}> = [];
  private prebufferChunks: Array<ArrayBuffer> = [];
  private isSourceBufferUpdating = false;
  private isMSEInitialized = false;
  private receivedOffsets: Set<number> = new Set();
  private totalChunksExpected = 0;
  private chunksReceived = 0;
  private videoMetadata: { name: string; size: number; type: string } | null = null;

  // Store callback references for cleanup
  private socketCallbacks: {
    offer: (data: { from: string; offer: any }) => void;
    answer: (data: { from: string; answer: any }) => void;
    iceCandidate: (data: { from: string; candidate: any }) => void;
    peerJoined: (data: { peerId: string }) => void;
    peerLeft: (data: { peerId: string }) => void;
  } | null = null;

  constructor() {
    // Don't setup listeners in constructor - wait until needed
    console.log('[WebRTC] WebRTC manager initialized');
  }

  // Add method to set host status
  setHostStatus(isHost: boolean) {
    console.log(`[WebRTC] Setting host status to: ${isHost}`);
    this.isHost = isHost;
    // Ensure socket listeners are set up when host status is set
    this.ensureSocketListeners();
  }

  // Add method to set video element for non-host users
  setVideoElement(videoElement: HTMLVideoElement) {
    console.log(`[WebRTC] Setting video element for ${this.isHost ? 'host' : 'non-host'} user`);
    this.videoElement = videoElement;
    // Ensure socket listeners are set up when video element is set
    this.ensureSocketListeners();

    // If we had prebuffered chunks before the element was available, initialize MSE and drain them
    if (!this.isMSEInitialized && this.prebufferChunks.length > 0) {
      console.log(`[WebRTC] [RECEIVER] Video element just bound with ${this.prebufferChunks.length} prebuffered chunks; initializing MSE and draining.`);
      this.initializeMediaSource();
      // Drain prebuffer into pendingChunks with proper sequencing
      this.prebufferChunks.forEach((buf) => {
        const sequence = this.chunksReceived;
        this.pendingChunks.push({ offset: sequence * CHUNK_SIZE, chunk: buf, sequence });
        this.chunksReceived++;
      });
      this.prebufferChunks = [];
      // Try to append
      this.appendPendingChunks();
    }
  }

  public ensureSocketListeners() {
    if (!this.socketCallbacks) {
      console.log('[WebRTC] Setting up socket listeners...');
      this.setupSocketListeners();
    }
  }

  private setupSocketListeners() {
    // Avoid double registration
    if (this.socketCallbacks) {
      console.log('[WebRTC] Socket callbacks already registered, skipping');
      return;
    }

    this.setupWebRTCCallbacks();
  }

  private setupWebRTCCallbacks() {
    // WebRTC signaling via socket manager - use dedicated callbacks
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

    // Store callback references for cleanup
    this.socketCallbacks = {
      offer: offerCallback,
      answer: answerCallback,
      iceCandidate: iceCandidateCallback,
      peerJoined: peerJoinedCallback,
      peerLeft: peerLeftCallback
    };

    // Register callbacks
    socketManager.onWebRTCOffer(offerCallback);
    socketManager.onWebRTCAnswer(answerCallback);
    socketManager.onWebRTCIceCandidate(iceCandidateCallback);
    socketManager.onWebRTCPeerJoined(peerJoinedCallback);
    socketManager.onWebRTCPeerLeft(peerLeftCallback);

    console.log('[WebRTC] Socket callbacks registered successfully');

    // Also listen to user-joined messages for host offer retry logic
    socketManager.onMessage((message) => {
      if (message.message && typeof message.message === 'string') {
        try {
          const parsed = JSON.parse(message.message);
          if (parsed.type === 'user-joined' && parsed.user) {
            console.log(`[WebRTC] User joined message: ${parsed.user.id}`);
            // This will be handled by the theater page for offer retry logic
          }
        } catch (e) {
          // Not a JSON message, ignore
        }
      }
    });
  }

  async initializePeerConnection(peerId: string, isInitiator: boolean = false): Promise<RTCPeerConnection> {
    console.log(`[WebRTC] Initializing peer connection with ${peerId}, isInitiator: ${isInitiator}, isHost: ${this.isHost}`);

    // Check if peer connection already exists
    const existingPeer = this.peers.get(peerId);
    if (existingPeer) {
      console.log(`[WebRTC] Peer connection already exists for ${peerId}, returning existing connection`);
      // If host is initiating and data channel is missing, create it
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

    // Add local stream tracks if available
    if (this.localStream) {
      console.log(`[WebRTC] Adding local stream tracks to peer ${peerId}`);
      this.localStream.getTracks().forEach(track => {
        pc.addTrack(track, this.localStream!);
      });
    }

    // Add or replace file stream tracks if available (late joiners)
    if (this.fileStream) {
      console.log(`[WebRTC] Adding file stream tracks to peer ${peerId}`);
      this.addOrReplaceTracks(pc, this.fileStream);
    }

    // Host creates data channel for video streaming
    if (this.isHost && isInitiator) {
      console.log(`[WebRTC] Host creating data channel for peer ${peerId}`);
      const dataChannel = pc.createDataChannel('video-chunks', {
        ordered: true,
        maxRetransmits: 3
      });
      peer.dataChannel = dataChannel;
      this.setupDataChannel(peerId, dataChannel, true);
    } else if (!this.isHost) {
      // Receiver listens for data channel
      pc.ondatachannel = (event) => {
        console.log(`[WebRTC] Receiver received data channel from peer ${peerId}`);
        const dataChannel = event.channel;
        peer.dataChannel = dataChannel;
        this.setupDataChannel(peerId, dataChannel, false);
      };
    }

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log(`[WebRTC] Sending ICE candidate to peer ${peerId}`);
        socketManager.sendIceCandidate(event.candidate, peerId);
      }
    };

    // Handle incoming streams (remote media)
    pc.ontrack = (event) => {
      console.log(`[WebRTC] Received media stream from peer ${peerId}`);
      peer.stream = event.streams[0];
      // If a video element has been provided (e.g., non-host UI), use it
      if (this.videoElement) {
        try {
          (this.videoElement as any).srcObject = event.streams[0];
          this.videoElement.autoplay = true;
          (this.videoElement as any).playsInline = true;
          // Do not force mute here; leave volume control to UI
          this.videoElement.play().catch(() => {});
        } catch (e) {
          console.error('[WebRTC] Error attaching remote stream to video element:', e);
        }
      } else {
        this.onStreamReceived(peerId, event.streams[0]);
      }
    };

    // Handle connection state changes
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

    // Handle ICE connection state
    pc.oniceconnectionstatechange = () => {
      console.log(`[WebRTC] Peer ${peerId} ICE connection state: ${pc.iceConnectionState}`);
    };

    this.peers.set(peerId, peer);
    console.log(`[WebRTC] Peer connection initialized for ${peerId}`);
    return pc;
  }

  private setupDataChannel(peerId: string, dataChannel: RTCDataChannel, isHost: boolean) {
    console.log(`[WebRTC] Setting up data channel for peer ${peerId}, isHost: ${isHost}`);

    // Ensure binary messages are delivered as ArrayBuffer
    try {
      (dataChannel as any).binaryType = 'arraybuffer';
    } catch (e) {
      // Some environments may not support setting binaryType explicitly on RTCDataChannel
    }

    // Hint threshold to help backpressure; we log on 'bufferedamountlow'
    try { (dataChannel as any).bufferedAmountLowThreshold = 1024 * 1024; } catch {}

    dataChannel.onopen = () => {
      console.log(`[WebRTC] ✅ Data channel opened for peer ${peerId}`);
      const peer = this.peers.get(peerId);
      if (peer) {
        peer.isConnected = true;
      }
      // Attempt to flush any queued chunks
      this.flushSendQueue(peerId);
    };

    dataChannel.onclose = () => {
      console.log(`[WebRTC] Data channel closed for peer ${peerId}`);
      const peer = this.peers.get(peerId);
      if (peer) {
        peer.isConnected = false;
      }
    };

    dataChannel.onerror = (e) => {
      console.error(`[WebRTC] Data channel error for peer ${peerId}:`, e);
    };

    if (!isHost) {
      // Receiver: handle incoming video chunks
      dataChannel.onmessage = (event) => {
        const payload = event.data;
        if (payload instanceof ArrayBuffer) {
          console.log(`[WebRTC] [RECEIVER] Received video chunk from peer ${peerId}: size=${payload.byteLength}`);
          this.handleP2PVideoChunk(peerId, payload);
        } else if (payload instanceof Blob) {
          // Convert Blob to ArrayBuffer
          payload.arrayBuffer().then((buf) => {
            console.log(`[WebRTC] [RECEIVER] Received Blob; converted to ArrayBuffer size=${buf.byteLength}`);
            this.handleP2PVideoChunk(peerId, buf);
          }).catch((e) => console.error('[WebRTC] [RECEIVER] Error converting Blob to ArrayBuffer:', e));
        } else {
          console.log(`[WebRTC] [RECEIVER] Received non-binary data from peer ${peerId}:`, payload);
        }
      };
    } else {
      // Host: track data channel state for sending
      dataChannel.onbufferedamountlow = () => {
        console.log(`[WebRTC] [HOST] Data channel buffer low for peer ${peerId}`);
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
        try { currentVideo.replaceTrack(newVideo); } catch {}
      } else {
        pc.addTrack(newVideo, stream);
      }
    }
    if (newAudio) {
      if (currentAudio) {
        try { currentAudio.replaceTrack(newAudio); } catch {}
      } else {
        pc.addTrack(newAudio, stream);
      }
    }
  }

  private enqueueChunk(peerId: string, chunk: ArrayBuffer) {
    const peer = this.peers.get(peerId);
    if (!peer || !peer.dataChannel) return;

    const dc = peer.dataChannel;
    if (dc.readyState !== 'open' || !peer.isConnected) {
      // queue until open
      const q = this.sendQueues.get(peerId) || [];
      q.push(chunk);
      this.sendQueues.set(peerId, q);
      return;
    }

    // If buffer is already high, queue and let bufferedamountlow flush
    if (dc.bufferedAmount + chunk.byteLength > WebRTCManager.MAX_BUFFERED_AMOUNT) {
      const q = this.sendQueues.get(peerId) || [];
      q.push(chunk);
      this.sendQueues.set(peerId, q);
      return;
    }

    try {
      dc.send(chunk);
    } catch (e) {
      // On error, queue and retry on bufferedamountlow
      const q = this.sendQueues.get(peerId) || [];
      q.push(chunk);
      this.sendQueues.set(peerId, q);
      console.error(`[WebRTC] [HOST] ❌ Error sending chunk directly to ${peerId}, queued for retry:`, e);
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
        // stop, wait for next bufferedamountlow
        break;
      }
      try {
        dc.send(next);
        queue.shift();
      } catch (e) {
        console.error(`[WebRTC] [HOST] ❌ Error flushing send queue to ${peerId}:`, e);
        // stop flushing; will retry later
        break;
      }
    }

    if (queue.length === 0) {
      this.sendQueues.delete(peerId);
    } else {
      this.sendQueues.set(peerId, queue);
    }
  }

  // Host helper: ensure we have connections to a set of participant user IDs
  public ensureConnectionsTo(participantUserIds: string[], currentUserId: string) {
    if (!this.isHost) return;
    const targetIds = participantUserIds.filter(id => id && id !== currentUserId);
    targetIds.forEach(id => {
      if (!this.peers.has(id)) {
        console.log(`[WebRTC] [HOST] Ensuring connection to ${id}`);
        // Fire and forget; createOffer handles negotiation checks
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
    
    console.log(`[WebRTC][Non-Host] Processing offer:`, offer);
    const pc = await this.initializePeerConnection(from, false);
    try {
      await pc.setRemoteDescription(offer);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      console.log(`[WebRTC][Non-Host] Sending answer to host (${from}):`, answer);
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
        // Check if we can set remote description
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
      // Host initiates connection with new peer
      console.log(`[WebRTC] Host initiating connection with new peer ${peerId}`);
      // Add a small delay to ensure the peer is ready
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
    
    // Check if we already have a connection with this peer
    const existingPeer = this.peers.get(peerId);
    if (existingPeer) {
      const state = existingPeer.pc.signalingState;
      if (state === 'have-local-offer') {
        // We likely created an offer before the peer was ready; re-send it now
        const existingOffer = existingPeer.pc.localDescription;
        if (existingOffer) {
          console.log(`[WebRTC][Host] Re-sending existing offer to peer ${peerId}`);
          socketManager.sendOffer(existingOffer, peerId);
          return existingOffer;
        }
      }
      if (state !== 'stable') {
        // Try to create a refreshed offer with ICE restart
        try {
          console.log(`[WebRTC][Host] Negotiation in progress with ${peerId} (state=${state}), attempting ICE restart`);
          const offer = await existingPeer.pc.createOffer({ iceRestart: true });
          await existingPeer.pc.setLocalDescription(offer);
          console.log(`[WebRTC][Host] Sending refreshed offer (ICE restart) to ${peerId}`);
          socketManager.sendOffer(offer, peerId);
          return offer;
        } catch (e) {
          console.warn(`[WebRTC][Host] Failed to refresh offer for ${peerId}, will skip this cycle`, e);
          return {} as RTCSessionDescriptionInit;
        }
      }
    }
    
    const pc = await this.initializePeerConnection(peerId, true);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    console.log(`[WebRTC][Host] Sending offer to peer ${peerId}:`, offer);
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
          videoSender.replaceTrack(videoTrack);
          console.log(`[WebRTC] Replaced video track for peer ${peer.id}`);
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
    }
  }

  // Video streaming with chunking
  async streamVideoFile(file: File, videoElement: HTMLVideoElement) {
    console.log(`[WebRTC] 🎬 Starting video streaming: ${file.name} (${file.size} bytes)`);
    
    this.currentVideoFile = file;
    this.videoElement = videoElement;
    // Don't override isHost here - it should be set by setHostStatus()
    console.log(`[WebRTC] Current host status: ${this.isHost}`);
    
    // Store video metadata
    this.videoMetadata = {
      name: file.name,
      size: file.size,
      type: file.type
    };
    
    // Prefer MediaStream-based sharing for maximum compatibility
    const videoUrl = URL.createObjectURL(file);
    videoElement.src = videoUrl;
    // Help autoplay policies so captureStream produces frames
    try {
      (videoElement as any).playsInline = true;
    } catch {}
    
    // Try to capture the file playback as a MediaStream and send via RTCPeerConnection
    try {
      // Ensure playback started before capture for better compatibility
      try { await videoElement.play(); } catch {}
      const capture = (videoElement as any).captureStream?.() || (videoElement as any).mozCaptureStream?.();
      if (capture) {
        this.fileStream = capture as MediaStream;
        console.log('[WebRTC] ✅ Using captureStream for file playback');
        // Attach/replace to each peer connection
        this.peers.forEach(peer => {
          this.addOrReplaceTracks(peer.pc, this.fileStream!);
        });
        // Renegotiate with all peers so the new tracks are received remotely
        this.peers.forEach(async (peer) => {
          try {
            await this.createOffer(peer.id);
          } catch (e) {
            console.warn(`[WebRTC] Failed to renegotiate after adding file stream for ${peer.id}`, e);
          }
        });
        return; // Exit early; no chunking required
      } else {
        console.warn('[WebRTC] captureStream not available; falling back to chunking over data channel');
      }
    } catch (e) {
      console.warn('[WebRTC] Error enabling captureStream; falling back to chunking:', e);
    }
    
    // Calculate total chunks
    this.totalChunksExpected = Math.ceil(file.size / CHUNK_SIZE);
    console.log(`[WebRTC] Total chunks to send: ${this.totalChunksExpected}`);
    
    // Start chunking and streaming to all connected peers
    // Add a tiny delay to allow receivers to bind their video elements
    let chunksSent = 0;
    const start = () => readFileInChunks(file, (chunk, offset, sequence) => {
      chunksSent++;
      console.log(`[WebRTC] [HOST] Sending chunk ${sequence}/${this.totalChunksExpected} (offset: ${offset}, size: ${chunk.byteLength})`);
      
      // Enqueue to all peers; backpressure-aware
      this.peers.forEach(peer => {
        if (peer.dataChannel) {
          this.enqueueChunk(peer.id, chunk);
        } else {
          console.log(`[WebRTC] [HOST] ⚠️ No data channel for peer ${peer.id} yet; queuing implicitly`);
          this.enqueueChunk(peer.id, chunk);
        }
      });
    }, () => {
      console.log(`[WebRTC] [HOST] ✅ All ${chunksSent} chunks sent successfully!`);
    });
    setTimeout(start, 250); // 250ms
  }

  // Receiver: handle incoming P2P video chunk
  private handleP2PVideoChunk(peerId: string, arrayBuffer: ArrayBuffer) {
    console.log(`[WebRTC] [RECEIVER] Processing chunk from peer ${peerId}: size=${arrayBuffer.byteLength}`);
    
    if (!this.videoElement) {
      // Buffer until video element is bound
      this.prebufferChunks.push(arrayBuffer);
      console.warn(`[WebRTC] [RECEIVER] No videoElement yet; prebuffered ${this.prebufferChunks.length} chunks.`);
      return;
    }

    // Initialize MediaSource if not already done
    if (!this.isMSEInitialized) {
      console.log('[WebRTC] [RECEIVER] Initializing MediaSource Extensions');
      this.initializeMediaSource();
    }

    // Add chunk to pending queue
    const sequence = this.chunksReceived;
    this.pendingChunks.push({ offset: sequence * CHUNK_SIZE, chunk: arrayBuffer, sequence });
    this.chunksReceived++;
    
    console.log(`[WebRTC] [RECEIVER] Chunk ${sequence} queued (${this.chunksReceived}/${this.totalChunksExpected})`);
    
    // Try to append chunks
    this.appendPendingChunks();
  }

  private initializeMediaSource() {
    console.log('[WebRTC] [RECEIVER] Setting up MediaSource for progressive playback');
    
    this.mse = new MediaSource();
    this.isMSEInitialized = true;
    this.pendingChunks = [];
    this.isSourceBufferUpdating = false;
    this.sourceBuffer = null;
    this.receivedOffsets = new Set();
    this.chunksReceived = 0;
    
    if (this.videoElement) {
      this.videoElement.src = URL.createObjectURL(this.mse);
      
      this.mse.addEventListener('sourceopen', () => {
        console.log('[WebRTC] [RECEIVER] MediaSource opened');
        if (!this.mse) return;
        
        try {
          // Use a more compatible codec string
          this.sourceBuffer = this.mse.addSourceBuffer('video/mp4; codecs="avc1.42E01E, mp4a.40.2"');
          this.sourceBuffer.mode = 'segments';
          
          console.log('[WebRTC] [RECEIVER] ✅ SourceBuffer created successfully');
          
          this.sourceBuffer.addEventListener('updateend', () => {
            console.log('[WebRTC] [RECEIVER] SourceBuffer update ended');
            this.isSourceBufferUpdating = false;
            this.appendPendingChunks();
          });
          
          this.sourceBuffer.addEventListener('error', (e) => {
            console.error('[WebRTC] [RECEIVER] SourceBuffer error:', e);
          });
          
          this.sourceBuffer.addEventListener('abort', (e) => {
            console.error('[WebRTC] [RECEIVER] SourceBuffer aborted:', e);
          });
          
        } catch (e) {
          console.error('[WebRTC] [RECEIVER] Error creating SourceBuffer:', e);
        }
      });
      
      this.mse.addEventListener('error', (e) => {
        console.error('[WebRTC] [RECEIVER] MediaSource error:', e);
      });
      
      this.videoElement.addEventListener('error', (e) => {
        console.error('[WebRTC] [RECEIVER] Video element error:', e, this.videoElement?.error);
      });
      
      this.videoElement.addEventListener('loadstart', () => {
        console.log('[WebRTC] [RECEIVER] Video load started');
      });
      
      this.videoElement.addEventListener('canplay', () => {
        console.log('[WebRTC] [RECEIVER] Video can play');
      });
      
      this.videoElement.addEventListener('playing', () => {
        console.log('[WebRTC] [RECEIVER] Video started playing');
      });
    }
  }

  private appendPendingChunks() {
    if (!this.sourceBuffer || this.isSourceBufferUpdating || this.pendingChunks.length === 0) {
      return;
    }
    
    if (this.sourceBuffer.updating) {
      console.log('[WebRTC] [RECEIVER] SourceBuffer is updating, will try again later');
      return;
    }

    // Sort by sequence for proper ordering
    this.pendingChunks.sort((a, b) => a.sequence - b.sequence);
    
    const chunkData = this.pendingChunks.shift()!;
    
    try {
      console.log(`[WebRTC] [RECEIVER] Appending chunk ${chunkData.sequence} to SourceBuffer`);
      this.isSourceBufferUpdating = true;
      this.sourceBuffer.appendBuffer(chunkData.chunk);
      
      // Try to play video after first chunk
      if (this.videoElement && this.videoElement.paused && chunkData.sequence === 0) {
        console.log('[WebRTC] [RECEIVER] Attempting to play video after first chunk');
        this.videoElement.play().then(() => {
          console.log('[WebRTC] [RECEIVER] ✅ Video playback started successfully');
        }).catch((err) => {
          console.error('[WebRTC] [RECEIVER] ❌ Error starting video playback:', err);
        });
      }
      
    } catch (e) {
      console.error('[WebRTC] [RECEIVER] Error appending chunk to SourceBuffer:', e);
      this.isSourceBufferUpdating = false;
    }
  }

  private onStreamReceived(peerId: string, stream: MediaStream) {
    console.log(`[WebRTC] Received media stream from peer ${peerId}`);
    
    // Handle incoming video stream (for video calls)
    const videoElement = document.createElement('video');
    videoElement.srcObject = stream;
    videoElement.autoplay = true;
    videoElement.muted = true; // Prevent echo
    
    // Add to UI or handle as needed
    document.body.appendChild(videoElement);
  }

  private removePeer(peerId: string) {
    console.log(`[WebRTC] Removing peer ${peerId}`);
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.pc.close();
      this.peers.delete(peerId);
      console.log(`[WebRTC] Peer ${peerId} removed`);
    }
  }

  // Video control synchronization
  syncVideoPlay(currentTime: number) {
    if (this.isHost && this.videoElement) {
      console.log(`[WebRTC] Host syncing video play at ${currentTime}`);
      this.videoElement.currentTime = currentTime;
      this.videoElement.play();
      
      // Notify peers via socket
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
      console.log('[WebRTC] Host syncing video pause');
      this.videoElement.pause();
      
      // Notify peers via socket
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
      console.log(`[WebRTC] Host syncing video seek to ${time}`);
      this.videoElement.currentTime = time;
      
      // Notify peers via socket
      this.peers.forEach(peer => {
        socketManager.sendMessage(JSON.stringify({
          type: 'video-control',
          action: 'seek',
          time
        }), false);
      });
    }
  }

  // Manual test method to create WebRTC connection
  async testCreateConnection(peerId: string) {
    console.log(`[WebRTC] Manual test: Creating connection with ${peerId}, isHost: ${this.isHost}`);
    
    if (this.isHost) {
      // Host creates offer
      console.log(`[WebRTC] Manual test: Host creating offer for ${peerId}`);
      await this.createOffer(peerId);
    } else {
      // Non-host waits for offer
      console.log(`[WebRTC] Manual test: Non-host waiting for offer from ${peerId}`);
    }
  }

  // Test WebRTC connection
  testConnection() {
    console.log(`[WebRTC] Connection test - isHost: ${this.isHost}`);
    console.log(`[WebRTC] Total peers: ${this.peers.size}`);
    this.peers.forEach((peer, peerId) => {
      console.log(`[WebRTC] Peer ${peerId}: connected=${peer.isConnected}, state=${peer.connectionState}, iceState=${peer.pc.iceConnectionState}`);
    });
  }

  // Test WebRTC signaling
  testSignaling() {
    console.log(`[WebRTC] Signaling test - isHost: ${this.isHost}`);
    console.log(`[WebRTC] Socket callbacks registered: ${!!this.socketCallbacks}`);
    if (this.socketCallbacks) {
      console.log(`[WebRTC] Callbacks: offer=${!!this.socketCallbacks.offer}, answer=${!!this.socketCallbacks.answer}, ice=${!!this.socketCallbacks.iceCandidate}`);
    }
  }

  // Cleanup
  cleanup() {
    console.log('[WebRTC] Cleaning up WebRTC manager');
    
    // Remove socket listeners
    if (this.socketCallbacks) {
      socketManager.offWebRTCOffer(this.socketCallbacks.offer);
      socketManager.offWebRTCAnswer(this.socketCallbacks.answer);
      socketManager.offWebRTCIceCandidate(this.socketCallbacks.iceCandidate);
      socketManager.offWebRTCPeerJoined(this.socketCallbacks.peerJoined);
      socketManager.offWebRTCPeerLeft(this.socketCallbacks.peerLeft);
    }
    
    // Stop all streams
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

    // Close all peer connections
    this.peers.forEach(peer => {
      peer.pc.close();
    });
    this.peers.clear();

    // Reset state
    this.isHost = false;
    this.currentVideoFile = null;
    this.videoElement = null;
    this.mse = null;
    this.sourceBuffer = null;
    this.pendingChunks = [];
    this.isSourceBufferUpdating = false;
    this.isMSEInitialized = false;
    this.receivedOffsets.clear();
    this.totalChunksExpected = 0;
    this.chunksReceived = 0;
    this.videoMetadata = null;
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
}

export const webrtcManager = new WebRTCManager(); 