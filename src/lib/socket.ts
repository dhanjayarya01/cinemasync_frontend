import { io, Socket } from 'socket.io-client'
import { getToken } from './auth'

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000'

export interface SocketMessage {
  id: string
  user: {
    id: string
    name: string
    picture: string
  }
  message: string
  timestamp: string
  isPrivate: boolean
  type: 'text' | 'voice'
  audioUrl?: string
  duration?: number
  failed?: boolean
}

export interface Participant {
  user: {
    id: string
    name: string
    picture: string
  }
  joinedAt: string
  isHost: boolean
  isActive: boolean
}

export interface RoomInfo {
  id: string
  name: string
  host: {
    id: string
    name: string
    picture: string
  }
  movie: {
    name: string
    year?: number
    poster?: string
    duration?: number
    genre?: string
  }
  videoFile?: {
    name: string
    size: number
    type: string
    url: string
  }
  status: string
  playbackState: {
    isPlaying: boolean
    currentTime: number
    duration: number
    lastUpdated: string
  }
  settings: any
  participants: Participant[]
}

export interface VideoMetadata {
  name: string
  size: number
  type: string
  url: string
}

type JoinRequest = { roomId: string; resolve?: (v?: any) => void; reject?: (e?: any) => void; attempts?: number }

class SocketManager {
  private socket: Socket | null = null
  private isConnected = false
  private isAuthenticated = false
  private roomId: string | null = null

  private messageCallbacks: ((message: SocketMessage) => void)[] = []
  private participantCallbacks: ((participants: Participant[]) => void)[] = []
  private videoControlCallbacks: ((data: any) => void)[] = []
  private videoMetadataCallbacks: ((metadata: VideoMetadata) => void)[] = []
  private roomInfoCallbacks: ((room: RoomInfo) => void)[] = []
  private errorCallbacks: ((error: string) => void)[] = []

  private webrtcOfferCallbacks: ((data: { from: string; offer: any }) => void)[] = []
  private webrtcAnswerCallbacks: ((data: { from: string; answer: any }) => void)[] = []
  private webrtcIceCandidateCallbacks: ((data: { from: string; candidate: any }) => void)[] = []
  private webrtcPeerJoinedCallbacks: ((data: { peerId: string }) => void)[] = []
  private webrtcPeerLeftCallbacks: ((data: { peerId: string }) => void)[] = []

  private videoStateSyncCallbacks: ((data: any) => void)[] = []
  private hostVideoStateRequestCallbacks: (() => void)[] = []

  private pendingOffers: { from: string; offer: any }[] = []
  private pendingAnswers: { from: string; answer: any }[] = []
  private pendingIceCandidates: { from: string; candidate: any }[] = []

  private connectCallbacks: (() => void)[] = []
  private authenticatedCallbacks: ((data: any) => void)[] = []

  private pendingJoin: JoinRequest | null = null

  connect(options?: any) {
    if (this.socket) return

    const token = getToken()

    this.socket = io(API_BASE_URL, {
      transports: ['websocket', 'polling'],
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      auth: options?.auth || (token ? { token } : undefined),
      forceNew: true
    })

    this.socket.on('connect', () => {
      this.isConnected = true
      if (!this.isAuthenticated) this.authenticate()
      this.connectCallbacks.forEach(cb => { try { cb() } catch (e) {} })
    })

    this.socket.on('disconnect', () => {
      this.isConnected = false
      this.isAuthenticated = false
    })

    this.socket.on('connect_error', (err) => {
      this.errorCallbacks.forEach(cb => cb((err && (err as any).message) || 'connect_error'))
    })

    this.socket.on('authenticated', (data) => {
      this.isAuthenticated = true
      this.authenticatedCallbacks.forEach(cb => { try { cb(data) } catch (e) {} })
      if (this.pendingJoin) {
        const pj = this.pendingJoin
        this.pendingJoin = null
        this.joinRoom(pj.roomId).then(() => pj.resolve && pj.resolve()).catch((e) => pj.reject && pj.reject(e))
      }
    })

    this.socket.on('auth-error', (data) => {
      this.errorCallbacks.forEach(cb => cb((data && data.error) || 'Authentication error'))
    })

    this.socket.on('room-joined', (data) => {
      this.roomId = data.room?.id || this.roomId
      this.roomInfoCallbacks.forEach(cb => cb(data.room))
      if (this.pendingJoin && this.pendingJoin.roomId === data.room?.id) {
        this.pendingJoin.resolve && this.pendingJoin.resolve(data.room)
        this.pendingJoin = null
      }
    })

    this.socket.on('user-joined', (data) => {
      if (data.participants) this.participantCallbacks.forEach(cb => cb(data.participants))
      this.messageCallbacks.forEach(callback => {
        callback({
          id: `join-${Date.now()}-${Math.random()}`,
          user: { id: data.userId || '', name: data.user?.name || '', picture: data.user?.picture || '' },
          message: JSON.stringify({ type: 'user-joined', user: data.user }),
          timestamp: new Date().toISOString(),
          isPrivate: false,
          type: 'text'
        })
      })
    })

    this.socket.on('user-left', (data) => {
      if (data.participants) this.participantCallbacks.forEach(cb => cb(data.participants))
    })

    this.socket.on('chat-message', (message: SocketMessage) => {
      this.messageCallbacks.forEach(cb => cb({
        ...message,
        id: message.id || `chat-${Date.now()}-${Math.random()}`,
        timestamp: message.timestamp || new Date().toISOString()
      }))
    })

    this.socket.on('video-play', (data) => {
      this.videoControlCallbacks.forEach(cb => cb({ type: 'play', ...data }))
    })

    this.socket.on('video-pause', (data) => {
      this.videoControlCallbacks.forEach(cb => cb({ type: 'pause', ...data }))
    })

    this.socket.on('video-seek', (data) => {
      this.videoControlCallbacks.forEach(cb => cb({ type: 'seek', ...data }))
    })

    this.socket.on('video-metadata', (metadata: VideoMetadata) => {
      this.videoMetadataCallbacks.forEach(cb => cb(metadata))
    })

    this.socket.on('video-state-sync', (payload) => {
      this.videoStateSyncCallbacks.forEach(cb => cb(payload))
    })

    this.socket.on('host-video-state-request', () => {
      this.hostVideoStateRequestCallbacks.forEach(cb => cb())
    })

    this.socket.on('voice-message', (data) => {
      const voiceMessage: SocketMessage = {
        id: `voice-${Date.now()}-${Math.random()}`,
        user: data.message?.user || { id: 'unknown', name: 'Unknown', picture: '' },
        message: 'Voice Message',
        timestamp: data.message?.timestamp || new Date().toISOString(),
        isPrivate: data.message?.isPrivate || false,
        type: 'voice',
        audioUrl: data.message?.audioUrl,
        duration: data.message?.duration || 0
      }
      this.messageCallbacks.forEach(cb => cb(voiceMessage))
    })

    this.socket.on('offer', (data) => {
      if (this.webrtcOfferCallbacks.length > 0) this.webrtcOfferCallbacks.forEach(cb => cb({ from: data.from, offer: data.offer }))
      else this.pendingOffers.push({ from: data.from, offer: data.offer })
    })

    this.socket.on('answer', (data) => {
      if (this.webrtcAnswerCallbacks.length > 0) this.webrtcAnswerCallbacks.forEach(cb => cb({ from: data.from, answer: data.answer }))
      else this.pendingAnswers.push({ from: data.from, answer: data.answer })
    })

    this.socket.on('ice-candidate', (data) => {
      if (this.webrtcIceCandidateCallbacks.length > 0) this.webrtcIceCandidateCallbacks.forEach(cb => cb({ from: data.from, candidate: data.candidate }))
      else this.pendingIceCandidates.push({ from: data.from, candidate: data.candidate })
    })

    this.socket.on('peer-joined', (data) => {
      this.webrtcPeerJoinedCallbacks.forEach(cb => cb({ peerId: data.peerId }))
    })

    this.socket.on('peer-left', (data) => {
      this.webrtcPeerLeftCallbacks.forEach(cb => cb({ peerId: data.peerId }))
    })

    this.socket.on('error', (data) => {
      this.errorCallbacks.forEach(cb => cb((data && data.error) || 'Unknown socket error'))
    })
  }

  private authenticate() {
    const token = getToken()
    if (!token || !this.socket) return
    this.socket.emit('authenticate', { token })
  }

  authenticateWithToken(token?: string) {
    if (token && this.socket) this.socket.emit('authenticate', { token })
    else this.authenticate()
  }

  joinRoom(roomId: string): Promise<any> {
    if (!this.socket) {
      return new Promise((resolve, reject) => {
        this.pendingJoin = { roomId, resolve, reject, attempts: 0 }
        this.connect()
      })
    }

    if (!this.isConnected) {
      return new Promise((resolve, reject) => {
        this.pendingJoin = { roomId, resolve, reject, attempts: 0 }
        try { this.connect() } catch (e) {}
      })
    }

    if (!this.isAuthenticated) {
      return new Promise((resolve, reject) => {
        this.pendingJoin = { roomId, resolve, reject, attempts: 0 }
        try { this.authenticate() } catch (e) {}
      })
    }

    this.roomId = roomId
    this.socket.emit('join-room', { roomId })
    return new Promise((resolve, reject) => {
      const onJoined = (room: any) => {
        if (room && room.id === roomId) {
          resolve(room)
          off()
        }
      }
      let off = this.onRoomInfo(onJoined)
      const t = setTimeout(() => {
        reject(new Error('join-room timeout'))
        off()
      }, 15000)
      const origOff = off
      off = () => { clearTimeout(t); origOff() }
    })
  }

  leaveRoom() {
    if (!this.socket || !this.roomId) return
    this.socket.emit('leave-room')
    this.roomId = null
  }

  sendMessage(message: string, isPrivate: boolean = false) {
    if (!this.socket || !this.roomId) return
    this.socket.emit('chat-message', { message, isPrivate })
  }

  playVideo(currentTime?: number) {
    if (!this.socket || !this.roomId) return
    this.socket.emit('video-play', { currentTime })
  }

  pauseVideo() {
    if (!this.socket || !this.roomId) return
    this.socket.emit('video-pause')
  }

  seekVideo(time: number) {
    if (!this.socket || !this.roomId) return
    this.socket.emit('video-seek', { time })
  }

  sendVideoMetadata(metadata: VideoMetadata) {
    if (!this.socket || !this.roomId) return
    this.socket.emit('video-metadata', metadata)
  }

  sendVideoStateRequest() {
    if (!this.socket || !this.roomId) return
    this.socket.emit('video-state-request', { roomId: this.roomId })
  }

  sendVideoStateSync(videoState: any) {
    if (!this.socket || !this.roomId) return
    this.socket.emit('video-state-sync', { roomId: this.roomId, ...videoState })
  }

  sendOffer(offer: any, to: string) {
    if (!this.socket) return
    this.socket.emit('offer', { offer, to })
  }

  sendAnswer(answer: any, to: string) {
    if (!this.socket) return
    this.socket.emit('answer', { answer, to })
  }

  sendIceCandidate(candidate: any, to: string) {
    if (!this.socket) return
    this.socket.emit('ice-candidate', { candidate, to })
  }

  async sendVoiceMessage(audioBlob: Blob, duration: number, isPrivate: boolean, user: any) {
    if (!this.socket || !this.roomId) return
    const dataUrl = await new Promise<string>((res, rej) => {
      const reader = new FileReader()
      reader.onload = () => res(String(reader.result))
      reader.onerror = rej
      reader.readAsDataURL(audioBlob)
    })
    const voiceMessage = {
      type: 'voice',
      audioUrl: dataUrl,
      duration,
      isPrivate,
      timestamp: new Date().toISOString(),
      user
    }
    return new Promise((resolve, reject) => {
      this.socket!.emit('voice-message', { roomId: this.roomId, message: voiceMessage }, (ack: any) => {
        if (ack && ack.success) resolve(ack)
        else reject(ack || new Error('Voice message failed'))
      })
      setTimeout(() => resolve({ success: true }), 1000)
    })
  }

  joinLiveVoice(user: { id: string; name: string; avatar?: string }) {
    if (!this.socket || !this.roomId) return
    this.socket.emit('live-voice-join', { roomId: this.roomId, user })
  }

  leaveLiveVoice(userId: string) {
    if (!this.socket || !this.roomId) return
    this.socket.emit('live-voice-leave', { roomId: this.roomId, userId })
  }

  sendLiveVoiceState(userId: string, isSpeaking: boolean, isMuted: boolean, audioLevel: number) {
    if (!this.socket || !this.roomId) return
    this.socket.emit('live-voice-state', {
      roomId: this.roomId,
      userId,
      isSpeaking,
      isMuted,
      audioLevel
    })
  }

  sendLiveVoiceMute(userId: string, isMuted: boolean) {
    if (!this.socket || !this.roomId) return
    this.socket.emit('live-voice-mute', { roomId: this.roomId, userId, isMuted })
  }

  onMessage(cb: (m: SocketMessage) => void) { this.messageCallbacks.push(cb); return () => { this.messageCallbacks = this.messageCallbacks.filter(c => c !== cb) } }
  offMessage(cb: (m: SocketMessage) => void) { this.messageCallbacks = this.messageCallbacks.filter(c => c !== cb) }

  onParticipantsChange(cb: (p: Participant[]) => void) { this.participantCallbacks.push(cb); return () => { this.participantCallbacks = this.participantCallbacks.filter(c => c !== cb) } }
  offParticipantsChange(cb: (p: Participant[]) => void) { this.participantCallbacks = this.participantCallbacks.filter(c => c !== cb) }

  onVideoControl(cb: (d: any) => void) { this.videoControlCallbacks.push(cb); return () => { this.videoControlCallbacks = this.videoControlCallbacks.filter(c => c !== cb) } }
  offVideoControl(cb: (d: any) => void) { this.videoControlCallbacks = this.videoControlCallbacks.filter(c => c !== cb) }

  onVideoMetadata(cb: (m: VideoMetadata) => void) { this.videoMetadataCallbacks.push(cb); return () => { this.videoMetadataCallbacks = this.videoMetadataCallbacks.filter(c => c !== cb) } }
  offVideoMetadata(cb: (m: VideoMetadata) => void) { this.videoMetadataCallbacks = this.videoMetadataCallbacks.filter(c => c !== cb) }

  onRoomInfo(cb: (r: RoomInfo) => void) { this.roomInfoCallbacks.push(cb); return () => { this.roomInfoCallbacks = this.roomInfoCallbacks.filter(c => c !== cb) } }
  offRoomInfo(cb: (r: RoomInfo) => void) { this.roomInfoCallbacks = this.roomInfoCallbacks.filter(c => c !== cb) }

  onError(cb: (err: string) => void) { this.errorCallbacks.push(cb); return () => { this.errorCallbacks = this.errorCallbacks.filter(c => c !== cb) } }
  offError(cb: (err: string) => void) { this.errorCallbacks = this.errorCallbacks.filter(c => c !== cb) }

  onWebRTCOffer(cb: (d: { from: string; offer: any }) => void) {
    this.webrtcOfferCallbacks.push(cb)
    if (this.pendingOffers.length) {
      const queued = this.pendingOffers.slice()
      this.pendingOffers = []
      queued.forEach(it => { try { cb(it) } catch (e) {} })
    }
    return () => { this.webrtcOfferCallbacks = this.webrtcOfferCallbacks.filter(c => c !== cb) }
  }
  offWebRTCOffer(cb: (d: { from: string; offer: any }) => void) { this.webrtcOfferCallbacks = this.webrtcOfferCallbacks.filter(c => c !== cb) }

  onWebRTCAnswer(cb: (d: { from: string; answer: any }) => void) {
    this.webrtcAnswerCallbacks.push(cb)
    if (this.pendingAnswers.length) {
      const queued = this.pendingAnswers.slice()
      this.pendingAnswers = []
      queued.forEach(it => { try { cb(it) } catch (e) {} })
    }
    return () => { this.webrtcAnswerCallbacks = this.webrtcAnswerCallbacks.filter(c => c !== cb) }
  }
  offWebRTCAnswer(cb: (d: { from: string; answer: any }) => void) { this.webrtcAnswerCallbacks = this.webrtcAnswerCallbacks.filter(c => c !== cb) }

  onWebRTCIceCandidate(cb: (d: { from: string; candidate: any }) => void) {
    this.webrtcIceCandidateCallbacks.push(cb)
    if (this.pendingIceCandidates.length) {
      const queued = this.pendingIceCandidates.slice()
      this.pendingIceCandidates = []
      queued.forEach(it => { try { cb(it) } catch (e) {} })
    }
    return () => { this.webrtcIceCandidateCallbacks = this.webrtcIceCandidateCallbacks.filter(c => c !== cb) }
  }
  offWebRTCIceCandidate(cb: (d: { from: string; candidate: any }) => void) { this.webrtcIceCandidateCallbacks = this.webrtcIceCandidateCallbacks.filter(c => c !== cb) }

  onWebRTCPeerJoined(cb: (d: { peerId: string }) => void) { this.webrtcPeerJoinedCallbacks.push(cb); return () => { this.webrtcPeerJoinedCallbacks = this.webrtcPeerJoinedCallbacks.filter(c => c !== cb) } }
  offWebRTCPeerJoined(cb: (d: { peerId: string }) => void) { this.webrtcPeerJoinedCallbacks = this.webrtcPeerJoinedCallbacks.filter(c => c !== cb) }

  onWebRTCPeerLeft(cb: (d: { peerId: string }) => void) { this.webrtcPeerLeftCallbacks.push(cb); return () => { this.webrtcPeerLeftCallbacks = this.webrtcPeerLeftCallbacks.filter(c => c !== cb) } }
  offWebRTCPeerLeft(cb: (d: { peerId: string }) => void) { this.webrtcPeerLeftCallbacks = this.webrtcPeerLeftCallbacks.filter(c => c !== cb) }

  onVideoStateSync(cb: (d: any) => void) { this.videoStateSyncCallbacks.push(cb); return () => { this.videoStateSyncCallbacks = this.videoStateSyncCallbacks.filter(c => c !== cb) } }
  offVideoStateSync(cb: (d: any) => void) { this.videoStateSyncCallbacks = this.videoStateSyncCallbacks.filter(c => c !== cb) }

  onHostVideoStateRequest(cb: () => void) { this.hostVideoStateRequestCallbacks.push(cb); return () => { this.hostVideoStateRequestCallbacks = this.hostVideoStateRequestCallbacks.filter(c => c !== cb) } }
  offHostVideoStateRequest(cb: () => void) { this.hostVideoStateRequestCallbacks = this.hostVideoStateRequestCallbacks.filter(c => c !== cb) }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect()
      this.socket = null
    }
    this.isConnected = false
    this.isAuthenticated = false
    this.roomId = null
  }

  isSocketConnected() { return this.isConnected }

  onConnect(cb: () => void) { this.connectCallbacks.push(cb); return () => { this.connectCallbacks = this.connectCallbacks.filter(c => c !== cb) } }
  onAuthenticated(cb: (d: any) => void) { this.authenticatedCallbacks.push(cb); return () => { this.authenticatedCallbacks = this.authenticatedCallbacks.filter(c => c !== cb) } }
  offAuthenticated(cb: (d: any) => void) { this.authenticatedCallbacks = this.authenticatedCallbacks.filter(c => c !== cb) }
}

export const socketManager = new SocketManager()
