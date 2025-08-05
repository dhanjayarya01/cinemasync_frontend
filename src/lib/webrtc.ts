import { socketManager } from './socket';

export interface WebRTCPeer {
  id: string;
  pc: RTCPeerConnection;
  stream?: MediaStream;
}

export interface VideoChunk {
  id: string;
  data: ArrayBuffer;
  timestamp: number;
  sequence: number;
}

class WebRTCManager {
  private peers: Map<string, WebRTCPeer> = new Map();
  private localStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
  private videoChunks: Map<string, VideoChunk[]> = new Map();
  private isHost = false;
  private currentVideoFile: File | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private chunkSize = 64 * 1024; // 64KB chunks

  constructor() {
    this.setupSocketListeners();
  }

  private setupSocketListeners() {
    // WebRTC signaling
    socketManager.onMessage((message) => {
      if (message.type === 'webrtc') {
        this.handleWebRTCMessage(message);
      }
    });
  }

  private handleWebRTCMessage(message: any) {
    const { type, from, data } = message;

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
      case 'video-chunk':
        this.handleVideoChunk(from, data);
        break;
    }
  }

  async initializePeerConnection(peerId: string): Promise<RTCPeerConnection> {
    const configuration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    };

    const pc = new RTCPeerConnection(configuration);
    const peer: WebRTCPeer = { id: peerId, pc };

    // Add local stream tracks
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        pc.addTrack(track, this.localStream!);
      });
    }

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socketManager.sendIceCandidate(event.candidate, peerId);
      }
    };

    // Handle incoming streams
    pc.ontrack = (event) => {
      peer.stream = event.streams[0];
      this.onStreamReceived(peerId, event.streams[0]);
    };

    // Handle connection state changes
    pc.onconnectionstatechange = () => {
      console.log(`Peer ${peerId} connection state:`, pc.connectionState);
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        this.removePeer(peerId);
      }
    };

    this.peers.set(peerId, peer);
    return pc;
  }

  private async handleOffer(from: string, offer: RTCSessionDescriptionInit) {
    const pc = await this.initializePeerConnection(from);
    
    try {
      await pc.setRemoteDescription(offer);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      
      socketManager.sendAnswer(answer, from);
    } catch (error) {
      console.error('Error handling offer:', error);
    }
  }

  private async handleAnswer(from: string, answer: RTCSessionDescriptionInit) {
    const peer = this.peers.get(from);
    if (peer) {
      try {
        await peer.pc.setRemoteDescription(answer);
      } catch (error) {
        console.error('Error handling answer:', error);
      }
    }
  }

  private async handleIceCandidate(from: string, candidate: RTCIceCandidateInit) {
    const peer = this.peers.get(from);
    if (peer) {
      try {
        await peer.pc.addIceCandidate(candidate);
      } catch (error) {
        console.error('Error adding ICE candidate:', error);
      }
    }
  }

  async createOffer(peerId: string): Promise<RTCSessionDescriptionInit> {
    const pc = await this.initializePeerConnection(peerId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    return offer;
  }

  async startLocalStream(constraints: MediaStreamConstraints = { video: true, audio: true }): Promise<MediaStream> {
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
      return this.localStream;
    } catch (error) {
      console.error('Error accessing media devices:', error);
      throw error;
    }
  }

  async startScreenShare(): Promise<MediaStream> {
    try {
      this.screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { mediaSource: 'screen' },
        audio: true
      });

      // Replace video track in all peer connections
      this.peers.forEach(peer => {
        const senders = peer.pc.getSenders();
        const videoSender = senders.find(sender => sender.track?.kind === 'video');
        if (videoSender && this.screenStream) {
          const videoTrack = this.screenStream.getVideoTracks()[0];
          videoSender.replaceTrack(videoTrack);
        }
      });

      return this.screenStream;
    } catch (error) {
      console.error('Error starting screen share:', error);
      throw error;
    }
  }

  stopScreenShare() {
    if (this.screenStream) {
      this.screenStream.getTracks().forEach(track => track.stop());
      this.screenStream = null;
    }
  }

  // Video streaming with chunking
  async streamVideoFile(file: File, videoElement: HTMLVideoElement) {
    this.currentVideoFile = file;
    this.videoElement = videoElement;
    this.isHost = true;

    // Create video URL for local playback
    const videoUrl = URL.createObjectURL(file);
    videoElement.src = videoUrl;

    // Start chunking and streaming
    await this.startVideoChunking(file);
  }

  private async startVideoChunking(file: File) {
    const chunkSize = this.chunkSize;
    const totalChunks = Math.ceil(file.size / chunkSize);
    let sequence = 0;

    for (let offset = 0; offset < file.size; offset += chunkSize) {
      const chunk = file.slice(offset, offset + chunkSize);
      const arrayBuffer = await chunk.arrayBuffer();

      const videoChunk: VideoChunk = {
        id: `${file.name}-${sequence}`,
        data: arrayBuffer,
        timestamp: Date.now(),
        sequence
      };

      // Send chunk to all peers
      this.peers.forEach(peer => {
        this.sendVideoChunk(peer.id, videoChunk);
      });

      sequence++;
      
      // Small delay to prevent overwhelming the network
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }

  private sendVideoChunk(peerId: string, chunk: VideoChunk) {
    socketManager.sendMessage(JSON.stringify({
      type: 'video-chunk',
      chunk
    }), false);
  }

  private handleVideoChunk(from: string, chunkData: VideoChunk) {
    if (!this.isHost) {
      // Store chunk for reassembly
      if (!this.videoChunks.has(chunkData.id)) {
        this.videoChunks.set(chunkData.id, []);
      }
      
      const chunks = this.videoChunks.get(chunkData.id)!;
      chunks.push(chunkData);
      
      // Sort by sequence number
      chunks.sort((a, b) => a.sequence - b.sequence);
      
      // Check if we have all chunks
      const totalChunks = Math.ceil(chunkData.data.byteLength / this.chunkSize);
      if (chunks.length === totalChunks) {
        this.reassembleVideo(chunks);
      }
    }
  }

  private reassembleVideo(chunks: VideoChunk[]) {
    // Reassemble video from chunks
    const totalSize = chunks.reduce((size, chunk) => size + chunk.data.byteLength, 0);
    const videoData = new Uint8Array(totalSize);
    
    let offset = 0;
    chunks.forEach(chunk => {
      videoData.set(new Uint8Array(chunk.data), offset);
      offset += chunk.data.byteLength;
    });

    // Create blob and play video
    const blob = new Blob([videoData], { type: 'video/mp4' });
    const videoUrl = URL.createObjectURL(blob);
    
    if (this.videoElement) {
      this.videoElement.src = videoUrl;
      this.videoElement.play();
    }
  }

  private onStreamReceived(peerId: string, stream: MediaStream) {
    // Handle incoming video stream
    console.log(`Received stream from peer ${peerId}`);
    
    // You can create a video element to display the stream
    const videoElement = document.createElement('video');
    videoElement.srcObject = stream;
    videoElement.autoplay = true;
    videoElement.muted = true; // Prevent echo
    
    // Add to UI or handle as needed
    document.body.appendChild(videoElement);
  }

  private removePeer(peerId: string) {
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.pc.close();
      this.peers.delete(peerId);
    }
  }

  // Video control synchronization
  syncVideoPlay(currentTime: number) {
    if (this.isHost && this.videoElement) {
      this.videoElement.currentTime = currentTime;
      this.videoElement.play();
      
      // Notify peers
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
      
      // Notify peers
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
      
      // Notify peers
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

    // Clear video chunks
    this.videoChunks.clear();

    // Reset state
    this.isHost = false;
    this.currentVideoFile = null;
    this.videoElement = null;
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
}

export const webrtcManager = new WebRTCManager(); 