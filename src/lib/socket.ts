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
    });

    this.socket.on('user-left', (data) => {
      console.log('User left:', data);
      this.participantCallbacks.forEach(callback => callback(data.participants));
    });

    this.socket.on('chat-message', (message: SocketMessage) => {
      console.log('Chat message received:', message);
      this.messageCallbacks.forEach(callback => callback(message));
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

    this.socket.emit('offer', { offer, to });
  }

  sendAnswer(answer: any, to: string) {
    if (!this.socket) return;

    this.socket.emit('answer', { answer, to });
  }

  sendIceCandidate(candidate: any, to: string) {
    if (!this.socket) return;

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