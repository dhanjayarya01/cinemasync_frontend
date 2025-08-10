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

const CHUNK_SIZE = 64 * 1024; // 64KB

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
  private localStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
  private isHost = false;
  private currentVideoFile: File | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private chunkSize = 64 * 1024; // 64KB chunks
  
  // MediaSource Extensions for progressive playback
  private mse: MediaSource | null = null;
  private sourceBuffer: SourceBuffer | null = null;
  private pendingChunks: Array<{offset: number, chunk: ArrayBuffer, sequence: number}> = [];
  private isSourceBufferUpdating = false;
  private isMSEInitialized = false;
  private receivedOffsets: Set<number> = new Set();
  private totalChunksExpected = 0;
  private chunksReceived = 0;
  private videoMetadata: { name: string; size: number; type: string } | null = null;

  constructor() {
    this.setupSocketListeners();
  }

  private setupSocketListeners() {
    // WebRTC signaling via socket manager
    socketManager.onMessage((message) => {
      // Handle WebRTC signaling messages (check if message contains WebRTC data)
      if (message.message && typeof message.message === 'string') {
        try {
          const parsed = JSON.parse(message.message);
          if (parsed.type && ['offer', 'answer', 'ice-candidate', 'peer-joined', 'peer-left'].includes(parsed.type)) {
            this.handleWebRTCMessage(parsed);
          }
        } catch (e) {
          // Not a JSON message, ignore
        }
      }
    });
  }

  private handleWebRTCMessage(message: any) {
    const { type, from, data } = message;

    console.log(`[WebRTC] Received signaling message: ${type} from ${from}`);

    switch (type) {
      case 'offer':
        this.handleOffer(from, data);
        break;
      case 'answer':
        this.handleAnswer(from, data);
        break;
      case 'ice-candidate':
        this.handleIceCandidate(from, data);
        break;
      case 'peer-joined':
        this.handlePeerJoined(from);
        break;
      case 'peer-left':
        this.handlePeerLeft(from);
        break;
    }
  }

  async initializePeerConnection(peerId: string, isInitiator: boolean = false): Promise<RTCPeerConnection> {
    console.log(`[WebRTC] Initializing peer connection with ${peerId}, isInitiator: ${isInitiator}`);

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

    // Host creates data channel for video streaming
    if (this.isHost && isInitiator) {
      console.log(`[WebRTC] Host creating data channel for peer ${peerId}`);
      const dataChannel = pc.createDataChannel('video-chunks', {
        ordered: true,
        maxRetransmits: 3
      });
      peer.dataChannel = dataChannel;
      this.setupDataChannel(peerId, dataChannel, true);
    } else {
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

    // Handle incoming streams (for video calls)
    pc.ontrack = (event) => {
      console.log(`[WebRTC] Received media stream from peer ${peerId}`);
      peer.stream = event.streams[0];
      this.onStreamReceived(peerId, event.streams[0]);
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

    dataChannel.onopen = () => {
      console.log(`[WebRTC] ✅ Data channel opened for peer ${peerId}`);
      const peer = this.peers.get(peerId);
      if (peer) {
        peer.isConnected = true;
      }
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
        if (event.data instanceof ArrayBuffer) {
          console.log(`[WebRTC] [RECEIVER] Received video chunk from peer ${peerId}: size=${event.data.byteLength}`);
          this.handleP2PVideoChunk(peerId, event.data);
        } else {
          console.log(`[WebRTC] [RECEIVER] Received non-binary data from peer ${peerId}:`, event.data);
        }
      };
    } else {
      // Host: track data channel state for sending
      dataChannel.onbufferedamountlow = () => {
        console.log(`[WebRTC] [HOST] Data channel buffer low for peer ${peerId}`);
      };
    }
  }

  private async handleOffer(from: string, offer: RTCSessionDescriptionInit) {
    console.log(`[WebRTC][Non-Host] Offer received from host (${from})`);
    const pc = await this.initializePeerConnection(from, false);
    try {
      await pc.setRemoteDescription(offer);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      console.log(`[WebRTC][Non-Host] Sending answer to host (${from})`);
      socketManager.sendAnswer(answer, from);
    } catch (error) {
      console.error('[WebRTC][Non-Host] Error handling offer:', error);
    }
  }

  private async handleAnswer(from: string, answer: RTCSessionDescriptionInit) {
    console.log(`[WebRTC][Host] Answer received from peer (${from})`);
    const peer = this.peers.get(from);
    if (peer) {
      try {
        await peer.pc.setRemoteDescription(answer);
        console.log(`[WebRTC][Host] Answer processed for peer ${from}`);
      } catch (error) {
        console.error('[WebRTC][Host] Error handling answer:', error);
      }
    }
  }

  private async handleIceCandidate(from: string, candidate: RTCIceCandidateInit) {
    console.log(`[WebRTC] ICE candidate received from ${from}`);
    const peer = this.peers.get(from);
    if (peer) {
      try {
        await peer.pc.addIceCandidate(candidate);
        console.log(`[WebRTC] ICE candidate added for peer ${from}`);
      } catch (error) {
        console.error('[WebRTC] Error adding ICE candidate:', error);
      }
    }
  }

  private handlePeerJoined(peerId: string) {
    console.log(`[WebRTC] Peer ${peerId} joined the room`);
    if (this.isHost) {
      // Host initiates connection with new peer
      this.createOffer(peerId);
    }
  }

  private handlePeerLeft(peerId: string) {
    console.log(`[WebRTC] Peer ${peerId} left the room`);
    this.removePeer(peerId);
  }

  async createOffer(peerId: string): Promise<RTCSessionDescriptionInit> {
    console.log(`[WebRTC][Host] Creating offer for peer ${peerId}`);
    const pc = await this.initializePeerConnection(peerId, true);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    console.log(`[WebRTC][Host] Sending offer to peer ${peerId}`);
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
    this.isHost = true;
    
    // Store video metadata
    this.videoMetadata = {
      name: file.name,
      size: file.size,
      type: file.type
    };
    
    // Create video URL for local playback on host
    const videoUrl = URL.createObjectURL(file);
    videoElement.src = videoUrl;
    
    // Calculate total chunks
    this.totalChunksExpected = Math.ceil(file.size / CHUNK_SIZE);
    console.log(`[WebRTC] Total chunks to send: ${this.totalChunksExpected}`);
    
    // Start chunking and streaming to all connected peers
    let chunksSent = 0;
    readFileInChunks(file, (chunk, offset, sequence) => {
      chunksSent++;
      console.log(`[WebRTC] [HOST] Sending chunk ${sequence}/${this.totalChunksExpected} (offset: ${offset}, size: ${chunk.byteLength})`);
      
      // Send to all connected peers
      this.peers.forEach(peer => {
        if (peer.dataChannel && peer.dataChannel.readyState === 'open' && peer.isConnected) {
          try {
            peer.dataChannel.send(chunk);
            console.log(`[WebRTC] [HOST] ✅ Chunk ${sequence} sent to peer ${peer.id}`);
          } catch (e) {
            console.error(`[WebRTC] [HOST] ❌ Error sending chunk ${sequence} to peer ${peer.id}:`, e);
          }
        } else {
          console.log(`[WebRTC] [HOST] ⚠️ Peer ${peer.id} not ready for chunk ${sequence} (state: ${peer.dataChannel?.readyState}, connected: ${peer.isConnected})`);
        }
      });
    }, () => {
      console.log(`[WebRTC] [HOST] ✅ All ${chunksSent} chunks sent successfully!`);
    });
  }

  // Receiver: handle incoming P2P video chunk
  private handleP2PVideoChunk(peerId: string, arrayBuffer: ArrayBuffer) {
    console.log(`[WebRTC] [RECEIVER] Processing chunk from peer ${peerId}: size=${arrayBuffer.byteLength}`);
    
    if (!this.videoElement) {
      console.warn('[WebRTC] [RECEIVER] No videoElement available to play chunk.');
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

  // Cleanup
  cleanup() {
    console.log('[WebRTC] Cleaning up WebRTC manager');
    
    // Stop all streams
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }

    if (this.screenStream) {
      this.screenStream.getTracks().forEach(track => track.stop());
      this.screenStream = null;
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