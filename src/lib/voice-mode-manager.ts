// lib/voice-mode-manager.ts
import { socketManager } from './socket';
import type {
  VoiceMode,
  VoiceState,
  LiveVoiceParticipant,
  LiveVoiceSession,
  VoiceModeManagerCallbacks
} from '../types/voice';

class VoiceModeManager {
  private _currentMode: VoiceMode = 'message';
  private _isLiveActive = false;
  private _participants: Map<string, LiveVoiceParticipant> = new Map();
  private _callbacks: VoiceModeManagerCallbacks = {};
  private _currentSession: LiveVoiceSession | null = null;
  private _currentUserId: string | null = null;
  private _currentUserName: string | null = null;
  private _currentUserAvatar: string | null = null;

  constructor() {
    this.setupSocketListeners();
    
    // Setup listeners when socket connects
    socketManager.onConnect(() => {
      this.setupSocketListeners();
    });
  }

  // Getters
  get currentMode(): VoiceMode {
    return this._currentMode;
  }

  get isLiveActive(): boolean {
    return this._isLiveActive;
  }

  get participants(): LiveVoiceParticipant[] {
    return Array.from(this._participants.values());
  }

  get currentSession(): LiveVoiceSession | null {
    return this._currentSession;
  }

  // Set callbacks for external components to listen to state changes
  setCallbacks(callbacks: VoiceModeManagerCallbacks): void {
    this._callbacks = { ...this._callbacks, ...callbacks };
  }

  // Set current user info for participant management
  setCurrentUser(userId: string, userName: string, userAvatar?: string): void {
    this._currentUserId = userId;
    this._currentUserName = userName;
    this._currentUserAvatar = userAvatar;
  }

  // Toggle between message and live voice modes
  toggleMode(): void {
    if (this._currentMode === 'message') {
      this.startLiveMode();
    } else {
      this.stopLiveMode();
    }
  }

  // Start live voice mode
  async startLiveMode(): Promise<void> {
    try {
      if (this._currentMode === 'live') {
        console.log('Already in live voice mode');
        return;
      }

      console.log('Starting live voice mode...');
      
      // Update mode first
      this._currentMode = 'live';
      this._callbacks.onModeChanged?.(this._currentMode);

      // Join live voice session via socket
      if (socketManager.isSocketConnected()) {
        socketManager.socket?.emit('live-voice-join', {
          roomId: socketManager.roomId,
          user: {
            id: this._currentUserId,
            name: this._currentUserName,
            avatar: this._currentUserAvatar
          }
        });
      }

      this._isLiveActive = true;
      this._callbacks.onLiveVoiceStateChanged?.(this._isLiveActive);

      console.log('Live voice mode started successfully');
    } catch (error) {
      console.error('Failed to start live voice mode:', error);
      this._currentMode = 'message';
      this._isLiveActive = false;
      this._callbacks.onError?.(`Failed to start live voice mode: ${error}`);
      throw error;
    }
  }

  // Stop live voice mode
  stopLiveMode(): void {
    try {
      console.log('Stopping live voice mode...');

      // Leave live voice session via socket
      if (socketManager.isSocketConnected()) {
        socketManager.socket?.emit('live-voice-leave', {
          roomId: socketManager.roomId,
          userId: this._currentUserId
        });
      }

      // Update state
      this._currentMode = 'message';
      this._isLiveActive = false;
      this._currentSession = null;

      // Clear participants
      this._participants.clear();

      // Notify callbacks
      this._callbacks.onModeChanged?.(this._currentMode);
      this._callbacks.onLiveVoiceStateChanged?.(this._isLiveActive);

      console.log('Live voice mode stopped successfully');
    } catch (error) {
      console.error('Error stopping live voice mode:', error);
      this._callbacks.onError?.(`Error stopping live voice mode: ${error}`);
    }
  }

  // Update participant state (called by audio managers)
  updateParticipantState(userId: string, state: VoiceState): void {
    const participant = this._participants.get(userId);
    if (!participant) {
      console.warn(`Participant ${userId} not found for state update`);
      return;
    }

    // Update participant state
    participant.isSpeaking = state.isSpeaking;
    participant.isMuted = state.isMuted;
    participant.audioLevel = state.audioLevel;
    participant.lastActivity = new Date();

    // Update connection state based on activity
    if (state.isSpeaking || state.audioLevel > 0) {
      participant.connectionState = 'connected';
    }

    this._participants.set(userId, participant);

    // Broadcast state to other participants via socket
    if (socketManager.isSocketConnected() && userId === this._currentUserId) {
      socketManager.socket?.emit('live-voice-state', {
        roomId: socketManager.roomId,
        userId,
        isSpeaking: state.isSpeaking,
        isMuted: state.isMuted,
        audioLevel: state.audioLevel
      });
    }

    // Notify callbacks
    this._callbacks.onParticipantStateChanged?.(participant);
  }

  // Get participant by user ID
  getParticipant(userId: string): LiveVoiceParticipant | null {
    return this._participants.get(userId) || null;
  }

  // Check if a specific user is in live voice mode
  isParticipantInLiveMode(userId: string): boolean {
    return this._participants.has(userId);
  }

  // Get current user's participant info
  getCurrentUserParticipant(): LiveVoiceParticipant | null {
    if (!this._currentUserId) return null;
    return this._participants.get(this._currentUserId) || null;
  }

  // Private method to setup socket event listeners
  private setupSocketListeners(): void {
    if (!socketManager.socket) return;

    // Listen for live voice session updates
    socketManager.socket.on('live-voice-session-state', (data: { session: LiveVoiceSession }) => {
      this._currentSession = data.session;
      
      // Update participants map
      this._participants.clear();
      data.session.participants.forEach(participant => {
        this._participants.set(participant.userId, participant);
      });

      console.log('Live voice session state updated:', data.session);
    });

    // Listen for participant joined events
    socketManager.socket.on('live-voice-participant-joined', (data: { participant: LiveVoiceParticipant }) => {
      this._participants.set(data.participant.userId, data.participant);
      this._callbacks.onParticipantJoined?.(data.participant);
      console.log('Participant joined live voice:', data.participant.userName);
    });

    // Listen for participant left events
    socketManager.socket.on('live-voice-participant-left', (data: { userId: string }) => {
      this._participants.delete(data.userId);
      this._callbacks.onParticipantLeft?.(data.userId);
      console.log('Participant left live voice:', data.userId);
    });

    // Listen for participant state updates
    socketManager.socket.on('live-voice-participant-state', (data: {
      userId: string;
      isSpeaking: boolean;
      isMuted: boolean;
      audioLevel: number;
    }) => {
      const participant = this._participants.get(data.userId);
      if (participant) {
        participant.isSpeaking = data.isSpeaking;
        participant.isMuted = data.isMuted;
        participant.audioLevel = data.audioLevel;
        participant.lastActivity = new Date();
        
        this._participants.set(data.userId, participant);
        this._callbacks.onParticipantStateChanged?.(participant);
      }
    });
  }

  // Cleanup method
  destroy(): void {
    this.stopLiveMode();
    this._participants.clear();
    this._callbacks = {};
    this._currentSession = null;
  }
}

// Export singleton instance
export const voiceModeManager = new VoiceModeManager();