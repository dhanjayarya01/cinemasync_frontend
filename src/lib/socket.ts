import { io, Socket } from 'socket.io-client';
import { getToken } from './auth';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

export interface SocketMessage {
  id: string;
  user: {
    id: string;
    name: string;
    picture: string;
  };
  message: string;
  timestamp: string;
  isPrivate: boolean;
  type: 'text' | 'voice';
  audioUrl?: string;
  duration?: number;
  failed?: boolean;
}

export interface Participant {
  user: {
    id: string;
    name: string;
    picture: string;
  };
  joinedAt: string;
  isHost: boolean;
  isActive: boolean;
}

export interface RoomInfo {
  id: string;
  name: string;
  host: {
    id: string;
    name: string;
    picture: string;
  };
  movie: {
    name: string;
    year?: number;
    poster?: string;
    duration?: number;
    genre?: string;
  };
  videoFile?: {
    name: string;
    size: number;
    type: string;
    url: string;
  };
  status: string;
  playbackState: {
    isPlaying: boolean;
    currentTime: number;
    duration: number;
    lastUpdated: string;
  };
  settings: any;
  participants: Participant[];
}

export interface VideoMetadata {
  name: string;
  size: number;
  type: string;
  url: string;
}

class SocketManager {
  private socket: Socket | null = null;
  private isConnected = false;
  private roomId: string | null = null;
  private messageCallbacks: ((message: SocketMessage) => void)[] = [];
  private participantCallbacks: ((participants: Participant[]) => void)[] = [];
  private videoControlCallbacks: ((data: any) => void)[] = [];
  private videoMetadataCallbacks: ((metadata: VideoMetadata) => void)[] = [];
  private roomInfoCallbacks: ((room: RoomInfo) => void)[] = [];
  private errorCallbacks: ((error: string) => void)[] = [];
  // Add WebRTC specific callbacks
  private webrtcOfferCallbacks: ((data: { from: string; offer: any }) => void)[] = [];
  private webrtcAnswerCallbacks: ((data: { from: string; answer: any }) => void)[] = [];
  private webrtcIceCandidateCallbacks: ((data: { from: string; candidate: any }) => void)[] = [];
  private webrtcPeerJoinedCallbacks: ((data: { peerId: string }) => void)[] = [];
  private webrtcPeerLeftCallbacks: ((data: { peerId: string }) => void)[] = [];
  // Video state sync callbacks
  private videoStateSyncCallbacks: ((data: any) => void)[] = [];
  // Host video state request callbacks
  private hostVideoStateRequestCallbacks: (() => void)[] = [];
  // Pending signaling events if callbacks are not yet registered
  private pendingOffers: { from: string; offer: any }[] = [];
  private pendingAnswers: { from: string; answer: any }[] = [];
  private pendingIceCandidates: { from: string; candidate: any }[] = [];

  connect() {
    if (this.socket) return;

    this.socket = io(API_BASE_URL, {
      transports: ['websocket', 'polling'],
      autoConnect: true
    });

    this.socket.on('connect', () => {
      console.log('Socket connected');
      this.isConnected = true;
      this.authenticate();
    });

    this.socket.on('disconnect', () => {
      console.log('Socket disconnected');
      this.isConnected = false;
    });

    this.socket.on('connect_error', (error) => {
      console.error('Socket connection error:', error);
    });

    this.socket.on('authenticated', (data) => {
      console.log('Socket authenticated:', data);
    });

    this.socket.on('auth-error', (data) => {
      console.error('Socket auth error:', data);
      this.errorCallbacks.forEach(callback => callback(data.error));
    });

    this.socket.on('room-joined', (data) => {
      console.log('Room joined:', data);
      this.roomInfoCallbacks.forEach(callback => callback(data.room));
    });

    this.socket.on('user-joined', (data) => {
      console.log('User joined:', data);
      this.participantCallbacks.forEach(callback => callback(data.participants));
      // Forward to message callbacks for WebRTC host offer retry logic
      this.messageCallbacks.forEach(callback => {
        callback({
          id: Date.now().toString(),
          user: { id: data.userId || (data.user && data.user.id) || '', name: (data.user && data.user.name) || '', picture: (data.user && data.user.picture) || '' },
          message: JSON.stringify({ type: 'user-joined', user: data.user }),
          timestamp: new Date().toISOString(),
          isPrivate: false,
          type: 'text'
        });
      });
    });

    this.socket.on('user-left', (data) => {
      console.log('User left:', data);
      this.participantCallbacks.forEach(callback => callback(data.participants));
    });

    this.socket.on('chat-message', (message: SocketMessage) => {
      console.log('Chat message received:', message);
      // Ensure message has proper ID and timestamp
      const processedMessage: SocketMessage = {
        ...message,
        id: message.id || `chat-${Date.now()}-${Math.random()}`,
        timestamp: message.timestamp || new Date().toLocaleTimeString()
      };
      this.messageCallbacks.forEach(callback => callback(processedMessage));
    });

    this.socket.on('video-play', (data) => {
      console.log('Video play event:', data);
      this.videoControlCallbacks.forEach(callback => callback({ type: 'play', ...data }));
    });

    this.socket.on('video-pause', (data) => {
      console.log('Video pause event:', data);
      this.videoControlCallbacks.forEach(callback => callback({ type: 'pause', ...data }));
    });

    this.socket.on('video-seek', (data) => {
      console.log('Video seek event:', data);
      this.videoControlCallbacks.forEach(callback => callback({ type: 'seek', ...data }));
    });

    this.socket.on('video-metadata', (metadata: VideoMetadata) => {
      console.log('Video metadata received:', metadata);
      this.videoMetadataCallbacks.forEach(callback => callback(metadata));
    });

    this.socket.on('video-state-sync', (data) => {
      console.log('Video state sync received:', data);
      this.videoStateSyncCallbacks.forEach(callback => callback(data));
    });

    this.socket.on('host-video-state-request', (data) => {
      console.log('Host video state request received:', data);
      this.hostVideoStateRequestCallbacks.forEach(callback => callback());
    });

    this.socket.on('voice-message', (data) => {
      console.log('Voice message received:', data);
      // Create a proper SocketMessage object for voice messages
      const voiceMessage: SocketMessage = {
        id: `voice-${Date.now()}-${Math.random()}`,
        user: data.message?.user || { id: 'unknown', name: 'Unknown', picture: '' },
        message: 'Voice Message',
        timestamp: data.message?.timestamp || new Date().toLocaleTimeString(),
        isPrivate: data.message?.isPrivate || false,
        type: 'voice',
        audioUrl: data.message?.audioUrl,
        duration: data.message?.duration || 0
      };
      
      console.log('Processed voice message:', voiceMessage);
      // Send to message callbacks
      this.messageCallbacks.forEach(callback => callback(voiceMessage));
    });

    // WebRTC signaling events
    this.socket.on('offer', (data) => {
      console.log('WebRTC offer received:', data);
      console.log('WebRTC offer callbacks count:', this.webrtcOfferCallbacks.length);
      // Use dedicated WebRTC callbacks, or queue if none yet
      if (this.webrtcOfferCallbacks.length > 0) {
        this.webrtcOfferCallbacks.forEach(callback => callback({ from: data.from, offer: data.offer }));
      } else {
        console.warn('[Socket] No WebRTC offer listeners yet; queueing offer');
        this.pendingOffers.push({ from: data.from, offer: data.offer });
      }
    });

    this.socket.on('answer', (data) => {
      console.log('WebRTC answer received:', data);
      console.log('WebRTC answer callbacks count:', this.webrtcAnswerCallbacks.length);
      if (this.webrtcAnswerCallbacks.length > 0) {
        this.webrtcAnswerCallbacks.forEach(callback => callback({ from: data.from, answer: data.answer }));
      } else {
        console.warn('[Socket] No WebRTC answer listeners yet; queueing answer');
        this.pendingAnswers.push({ from: data.from, answer: data.answer });
      }
    });

    this.socket.on('ice-candidate', (data) => {
      console.log('WebRTC ICE candidate received:', data);
      console.log('WebRTC ICE candidate callbacks count:', this.webrtcIceCandidateCallbacks.length);
      if (this.webrtcIceCandidateCallbacks.length > 0) {
        this.webrtcIceCandidateCallbacks.forEach(callback => callback({ from: data.from, candidate: data.candidate }));
      } else {
        console.warn('[Socket] No WebRTC ICE listeners yet; queueing candidate');
        this.pendingIceCandidates.push({ from: data.from, candidate: data.candidate });
      }
    });

    this.socket.on('peer-joined', (data) => {
      console.log('WebRTC peer joined:', data);
      // Use dedicated WebRTC callbacks
      this.webrtcPeerJoinedCallbacks.forEach(callback => callback({ peerId: data.peerId }));
    });

    this.socket.on('peer-left', (data) => {
      console.log('WebRTC peer left:', data);
      // Use dedicated WebRTC callbacks
      this.webrtcPeerLeftCallbacks.forEach(callback => callback({ peerId: data.peerId }));
    });

    this.socket.on('error', (data) => {
      console.error('Socket error:', data);
      this.errorCallbacks.forEach(callback => callback(data.error));
    });
  }

  private authenticate() {
    const token = getToken();
    if (token && this.socket) {
      console.log('Authenticating socket with token...');
      this.socket.emit('authenticate', { token });
    } else {
      console.error('No token available for socket authentication');
    }
  }

  joinRoom(roomId: string) {
    if (!this.socket) {
      console.error('Socket not initialized');
      return;
    }

    if (!this.isConnected) {
      console.log('Socket not connected, waiting for connection...');
      this.socket.once('connect', () => {
        this.authenticate();
        setTimeout(() => {
          this.socket?.emit('join-room', { roomId });
        }, 1000);
      });
      return;
    }

    this.roomId = roomId;
    this.socket.emit('join-room', { roomId });
  }

  leaveRoom() {
    if (!this.socket || !this.roomId) return;

    this.socket.emit('leave-room');
    this.roomId = null;
  }

  sendMessage(message: string, isPrivate: boolean = false) {
    if (!this.socket || !this.roomId) return;

    this.socket.emit('chat-message', {
      message,
      isPrivate
    });
  }

  // Video control events (host only)
  playVideo(currentTime?: number) {
    if (!this.socket || !this.roomId) return;

    this.socket.emit('video-play', { currentTime });
  }

  pauseVideo() {
    if (!this.socket || !this.roomId) return;

    this.socket.emit('video-pause');
  }

  seekVideo(time: number) {
    if (!this.socket || !this.roomId) return;

    this.socket.emit('video-seek', { time });
  }

  // Video metadata (host only)
  sendVideoMetadata(metadata: VideoMetadata) {
    if (!this.socket || !this.roomId) return;

    this.socket.emit('video-metadata', metadata);
  }

  // WebRTC signaling
  sendOffer(offer: any, to: string) {
    if (!this.socket) return;

    console.log(`[Socket] Sending WebRTC offer to user ${to}`);
    this.socket.emit('offer', { offer, to });
  }

  sendAnswer(answer: any, to: string) {
    if (!this.socket) return;

    console.log(`[Socket] Sending WebRTC answer to user ${to}`);
    this.socket.emit('answer', { answer, to });
  }

  sendIceCandidate(candidate: any, to: string) {
    if (!this.socket) return;

    console.log(`[Socket] Sending WebRTC ICE candidate to user ${to}`);
    this.socket.emit('ice-candidate', { candidate, to });
  }

  // Event listeners
  onMessage(callback: (message: SocketMessage) => void) {
    this.messageCallbacks.push(callback);
  }

  onParticipantsChange(callback: (participants: Participant[]) => void) {
    this.participantCallbacks.push(callback);
  }

  onVideoControl(callback: (data: any) => void) {
    this.videoControlCallbacks.push(callback);
  }

  onVideoMetadata(callback: (metadata: VideoMetadata) => void) {
    this.videoMetadataCallbacks.push(callback);
  }

  onRoomInfo(callback: (room: RoomInfo) => void) {
    this.roomInfoCallbacks.push(callback);
  }

  onError(callback: (error: string) => void) {
    this.errorCallbacks.push(callback);
  }

  // WebRTC specific event listeners
  onWebRTCOffer(callback: (data: { from: string; offer: any }) => void) {
    console.log('[Socket] Registering WebRTC offer callback');
    this.webrtcOfferCallbacks.push(callback);
    console.log('[Socket] WebRTC offer callbacks count:', this.webrtcOfferCallbacks.length);
    // Drain pending offers
    if (this.pendingOffers.length) {
      console.log(`[Socket] Replaying ${this.pendingOffers.length} pending offers`);
      const queued = this.pendingOffers.slice();
      this.pendingOffers = [];
      queued.forEach(data => {
        try { callback({ from: data.from, offer: data.offer }); } catch (e) { console.error('[Socket] Error delivering pending offer', e); }
      });
    }
  }

  onWebRTCAnswer(callback: (data: { from: string; answer: any }) => void) {
    console.log('[Socket] Registering WebRTC answer callback');
    this.webrtcAnswerCallbacks.push(callback);
    console.log('[Socket] WebRTC answer callbacks count:', this.webrtcAnswerCallbacks.length);
    // Drain pending answers
    if (this.pendingAnswers.length) {
      console.log(`[Socket] Replaying ${this.pendingAnswers.length} pending answers`);
      const queued = this.pendingAnswers.slice();
      this.pendingAnswers = [];
      queued.forEach(data => {
        try { callback({ from: data.from, answer: data.answer }); } catch (e) { console.error('[Socket] Error delivering pending answer', e); }
      });
    }
  }

  onWebRTCIceCandidate(callback: (data: { from: string; candidate: any }) => void) {
    console.log('[Socket] Registering WebRTC ICE candidate callback');
    this.webrtcIceCandidateCallbacks.push(callback);
    console.log('[Socket] WebRTC ICE candidate callbacks count:', this.webrtcIceCandidateCallbacks.length);
    // Drain pending candidates
    if (this.pendingIceCandidates.length) {
      console.log(`[Socket] Replaying ${this.pendingIceCandidates.length} pending ICE candidates`);
      const queued = this.pendingIceCandidates.slice();
      this.pendingIceCandidates = [];
      queued.forEach(data => {
        try { callback({ from: data.from, candidate: data.candidate }); } catch (e) { console.error('[Socket] Error delivering pending ICE candidate', e); }
      });
    }
  }

  onWebRTCPeerJoined(callback: (data: { peerId: string }) => void) {
    this.webrtcPeerJoinedCallbacks.push(callback);
  }

  onWebRTCPeerLeft(callback: (data: { peerId: string }) => void) {
    this.webrtcPeerLeftCallbacks.push(callback);
  }

  // Remove event listeners
  offMessage(callback: (message: SocketMessage) => void) {
    this.messageCallbacks = this.messageCallbacks.filter(cb => cb !== callback);
  }

  offParticipantsChange(callback: (participants: Participant[]) => void) {
    this.participantCallbacks = this.participantCallbacks.filter(cb => cb !== callback);
  }

  offVideoControl(callback: (data: any) => void) {
    this.videoControlCallbacks = this.videoControlCallbacks.filter(cb => cb !== callback);
  }

  offVideoMetadata(callback: (metadata: VideoMetadata) => void) {
    this.videoMetadataCallbacks = this.videoMetadataCallbacks.filter(cb => cb !== callback);
  }

  offRoomInfo(callback: (room: RoomInfo) => void) {
    this.roomInfoCallbacks = this.roomInfoCallbacks.filter(cb => cb !== callback);
  }

  offError(callback: (error: string) => void) {
    this.errorCallbacks = this.errorCallbacks.filter(cb => cb !== callback);
  }

  // Remove WebRTC event listeners
  offWebRTCOffer(callback: (data: { from: string; offer: any }) => void) {
    this.webrtcOfferCallbacks = this.webrtcOfferCallbacks.filter(cb => cb !== callback);
  }

  offWebRTCAnswer(callback: (data: { from: string; answer: any }) => void) {
    this.webrtcAnswerCallbacks = this.webrtcAnswerCallbacks.filter(cb => cb !== callback);
  }

  offWebRTCIceCandidate(callback: (data: { from: string; candidate: any }) => void) {
    this.webrtcIceCandidateCallbacks = this.webrtcIceCandidateCallbacks.filter(cb => cb !== callback);
  }

  offWebRTCPeerJoined(callback: (data: { peerId: string }) => void) {
    this.webrtcPeerJoinedCallbacks = this.webrtcPeerJoinedCallbacks.filter(cb => cb !== callback);
  }

  offWebRTCPeerLeft(callback: (data: { peerId: string }) => void) {
    this.webrtcPeerLeftCallbacks = this.webrtcPeerLeftCallbacks.filter(cb => cb !== callback);
  }

  // Voice message methods
  async sendVoiceMessage(audioBlob: Blob, duration: number, isPrivate: boolean, user: any) {
    if (!this.socket || !this.roomId) return;

    try {
      // Convert blob to base64 for sending through socket
      const arrayBuffer = await audioBlob.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      let binaryString = '';
      for (let i = 0; i < uint8Array.length; i++) {
        binaryString += String.fromCharCode(uint8Array[i]);
      }
      const base64Audio = btoa(binaryString);
      
      // Create voice message object
      const voiceMessage = {
        type: 'voice',
        audioUrl: `data:audio/webm;base64,${base64Audio}`,
        duration: duration,
        isPrivate: isPrivate,
        timestamp: new Date().toLocaleTimeString(),
        user: user
      };

      console.log('Sending voice message:', { duration, user: user.name, audioSize: base64Audio.length });

      // Send through socket with acknowledgment
      return new Promise((resolve, reject) => {
        this.socket!.emit('voice-message', {
          roomId: this.roomId,
          message: voiceMessage
        }, (ack: any) => {
          if (ack && ack.success) {
            console.log('Voice message sent successfully');
            resolve(ack);
          } else {
            console.error('Voice message send failed:', ack);
            reject(new Error('Voice message send failed'));
          }
        });
        
        // Fallback: resolve after a short delay if no ack received
        setTimeout(() => {
          console.log('Voice message sent (fallback)');
          resolve({ success: true });
        }, 1000);
      });
    } catch (error) {
      console.error('Error sending voice message:', error);
      throw error;
    }
  }

  // Video state sync methods
  sendVideoStateRequest() {
    if (!this.socket || !this.roomId) return;
    console.log('Sending video state request');
    this.socket.emit('video-state-request', { roomId: this.roomId });
  }

  sendVideoStateSync(videoState: any) {
    if (!this.socket || !this.roomId) return;
    console.log('Sending video state sync:', videoState);
    this.socket.emit('video-state-sync', { 
      roomId: this.roomId, 
      videoState 
    });
  }

  onVideoStateSync(callback: (data: any) => void) {
    this.videoStateSyncCallbacks.push(callback);
  }

  offVideoStateSync(callback: (data: any) => void) {
    this.videoStateSyncCallbacks = this.videoStateSyncCallbacks.filter(cb => cb !== callback);
  }

  onHostVideoStateRequest(callback: () => void) {
    // Add to existing callbacks or create new array
    if (!this.hostVideoStateRequestCallbacks) {
      this.hostVideoStateRequestCallbacks = [];
    }
    this.hostVideoStateRequestCallbacks.push(callback);
  }

  offHostVideoStateRequest(callback: () => void) {
    if (this.hostVideoStateRequestCallbacks) {
      this.hostVideoStateRequestCallbacks = this.hostVideoStateRequestCallbacks.filter(cb => cb !== callback);
    }
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.isConnected = false;
    this.roomId = null;
  }

  isSocketConnected() {
    return this.isConnected;
  }
}

export const socketManager = new SocketManager(); 