"use client"

import type React from "react"
import { useState, useEffect, useRef, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  Send,
  Mic,
  MicOff,
  Video,
  VideoOff,
  Users,
  Settings,
  MessageCircle,
  Phone,
  PhoneOff,
  Youtube,
  Upload,
  Monitor,
  Loader2,
  StopCircle,
  ChevronRight,
  ChevronLeft,
  Crown,
  AlertCircle,
  CheckCircle,
  X,
} from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { socketManager, type SocketMessage, type Participant, type RoomInfo } from "@/lib/socket"
import { webrtcManager } from "@/lib/webrtc"
import { getToken, getCurrentUser } from "@/lib/auth"

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000'

export default function TheaterPage({ params }: { params: Promise<{ roomId: string }> }) {
  const [user, setUser] = useState<any>(null)
  const [roomInfo, setRoomInfo] = useState<RoomInfo | null>(null)
  const [participants, setParticipants] = useState<Participant[]>([])
  const [messages, setMessages] = useState<SocketMessage[]>([])
  const [isConnected, setIsConnected] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Video states
  const [isPlaying, setIsPlaying] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const suppressLocalPlaybackRef = useRef(false)

  // Chat states
  const [message, setMessage] = useState("")
  const [isChatVisible, setIsChatVisible] = useState(true)
  const [unreadCount, setUnreadCount] = useState(0)
  const [joinNotice, setJoinNotice] = useState<string | null>(null)
  
  // Voice message states
  const [isRecording, setIsRecording] = useState(false)
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
  const [isPlayingPreview, setIsPlayingPreview] = useState(false)
  const [recordingTime, setRecordingTime] = useState(0)
  const [playingVoiceMessages, setPlayingVoiceMessages] = useState<Set<string>>(new Set())
  const [voiceMessageProgress, setVoiceMessageProgress] = useState<Map<string, number>>(new Map())
  const [voiceMessageCurrentTime, setVoiceMessageCurrentTime] = useState<Map<string, number>>(new Map())
  const [isSendingVoiceMessage, setIsSendingVoiceMessage] = useState(false)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recordingIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const audioRefs = useRef<Map<string, HTMLAudioElement>>(new Map())
  const chatScrollRef = useRef<HTMLDivElement>(null)

  // Video state persistence and autoplay handling
  const [videoMetadata, setVideoMetadata] = useState<any>(null)
  const [videoPlaybackState, setVideoPlaybackState] = useState<any>(null)
  const [showResumeOverlay, setShowResumeOverlay] = useState(false)

  // Video call states
  const [isMicMuted, setIsMicMuted] = useState(false)
  const [isVideoOn, setIsVideoOn] = useState(true)
  const [isInCall, setIsInCall] = useState(false)

  // Video selection states
  const [youtubeUrl, setYoutubeUrl] = useState("")
  const [isLoadingVideo, setIsLoadingVideo] = useState(false)
  const [currentVideoType, setCurrentVideoType] = useState<"youtube" | "screen" | "file" | null>(null)
  const [selectedVideoFile, setSelectedVideoFile] = useState<File | null>(null)
  const [youtubeVideoId, setYoutubeVideoId] = useState<string | null>(null)

  // Refs
  const videoRef = useRef<HTMLVideoElement>(null)
  const screenVideoRef = useRef<HTMLVideoElement>(null)
  const youtubePlayerRef = useRef<HTMLIFrameElement>(null)
  const videoContainerRef = useRef<HTMLDivElement>(null)
  const progressBarRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  // Host detection
  const isHost = user?.id === roomInfo?.host?.id

  // WebRTC connection status
  const [webrtcStatus, setWebrtcStatus] = useState<any>(null)
  const [webrtcConnected, setWebrtcConnected] = useState(false)
  const [showConnectedText, setShowConnectedText] = useState(false)

  // Ensure we only start host streaming once per selected file
  const hasStartedStreamingRef = useRef(false)

  // Monitor WebRTC connection status
  useEffect(() => {
    const interval = setInterval(() => {
      const status = webrtcManager.getConnectionStatus();
      setWebrtcStatus(status);
      
      if (status.connectedPeers > 0 && !webrtcConnected) {
        setWebrtcConnected(true);
        console.log(`[Theater] ✅ WebRTC connected to ${status.connectedPeers} peers!`);
      } else if (status.connectedPeers === 0 && webrtcConnected) {
        setWebrtcConnected(false);
        console.log(`[Theater] ❌ WebRTC disconnected`);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [webrtcConnected]);

  useEffect(() => {
    if (!webrtcStatus) return
    if (webrtcStatus.connectedPeers > 0) {
      setShowConnectedText(true)
      const t = setTimeout(() => setShowConnectedText(false), 1000)
      return () => clearTimeout(t)
    }
  }, [webrtcStatus?.connectedPeers])

  useEffect(() => {
    const initializeRoom = async () => {
      try {
        const resolvedParams = await params
        const userData = getCurrentUser()
        const token = getToken()
        console.log('User data:', userData)
        console.log('Token available:', !!token)
        
        if (!userData || !token) {
          console.log('No user data or token, redirecting to auth')
          router.push("/auth")
          return
        }
        setUser(userData)

        // Connect to socket
        socketManager.connect()

        // Initialize WebRTC manager socket listeners immediately
        console.log('[Theater] Initializing WebRTC manager...');
        webrtcManager.ensureSocketListeners();

        // Set up socket event listeners
        socketManager.onRoomInfo((room) => {
          console.log('Room info received:', room)
          setRoomInfo(room)
          // Remove duplicates from participants
          const uniqueParticipants = room.participants.filter((participant, index, self) => 
            index === self.findIndex(p => p.user.id === participant.user.id)
          )
          setParticipants(uniqueParticipants)
          
          // Set host status in WebRTC manager
          const isHostUser = userData?.id === room.host?.id;
          console.log(`[Theater] User ${userData?.id} is host: ${isHostUser} (room host: ${room.host?.id})`);
          webrtcManager.setHostStatus(isHostUser);
          
          // Ensure WebRTC socket listeners are set up for all users
          webrtcManager.ensureSocketListeners();

          // Host proactively connects to all existing participants
          const userIds = uniqueParticipants.map(p => p.user.id)
          if (isHostUser && userData?.id) {
            webrtcManager.ensureConnectionsTo(userIds, userData.id)
          }
          
          setIsLoading(false)
        })

        socketManager.onParticipantsChange((participants) => {
          console.log('Participants updated:', participants)
          // Remove duplicates based on user ID
          const uniqueParticipants = participants.filter((participant, index, self) => 
            index === self.findIndex(p => p.user.id === participant.user.id)
          )
          setParticipants(uniqueParticipants)

          // Auto-initiate WebRTC from host to all others
          const userIds = uniqueParticipants.map(p => p.user.id)
          if (webrtcManager.isHostUser() && userData?.id) {
            webrtcManager.ensureConnectionsTo(userIds, userData.id)
          }
        })

        socketManager.onMessage((message) => {
          console.log('Message received:', message)
          
          // Handle WebRTC signaling for user joins
          try {
            const parsed = JSON.parse(message.message);
            if (parsed.type === 'user-joined' && parsed.user && parsed.user.id !== userData.id) {
              const peerId = parsed.user.id;
              console.log(`[Theater] New user joined: ${peerId}, isHost: ${webrtcManager.isHostUser()}`);
              // Show transient notice instead of dumping JSON to chat
              setJoinNotice(`${parsed.user.name} joined`)
              setTimeout(() => setJoinNotice(null), 3000)
              // If we're the host, send offer to the new user
              if (webrtcManager.isHostUser()) {
                console.log(`[Theater] Host sending offer to new user ${peerId}`);
                webrtcManager.createOffer(peerId);
              }
              // Do not push the JSON join message into chat history
              return;
            }
          } catch (e) {
            // Not a JSON message, continue with normal message handling
          }
          
          // Handle voice messages
          if (message.type === 'voice' && message.audioUrl) {
            console.log('Processing voice message:', message)
            setMessages(prev => {
              // Check if this voice message already exists
              const exists = prev.some(m => 
                m.type === 'voice' && 
                m.user.id === message.user.id && 
                m.duration === message.duration &&
                Math.abs(new Date(m.timestamp).getTime() - new Date(message.timestamp).getTime()) < 5000
              )
              
              if (exists) {
                console.log('Voice message already exists, skipping')
                return prev
              }
              
              if (!isChatVisible) setUnreadCount(c => c + 1)
              return [...prev, message]
            })
            return
          }
          
          // Handle regular text messages
          setMessages(prev => {
            // Check if message already exists to prevent duplicates
            const exists = prev.some(m => 
              m.id === message.id || 
              (m.type === 'text' && 
               m.message === message.message && 
               m.user.id === message.user.id &&
               Math.abs(new Date(m.timestamp).getTime() - new Date(message.timestamp).getTime()) < 2000)
            )
            
            if (exists) {
              console.log('Message already exists, skipping')
              return prev
            }
            
            if (!isChatVisible) setUnreadCount(c => c + 1)
            return [...prev, message]
          })
        })

        socketManager.onVideoControl((data) => {
          console.log('Video control received:', data)
          handleVideoControl(data)
        })

        socketManager.onVideoMetadata((metadata) => {
          console.log('Video metadata received:', metadata)
          handleVideoMetadata(metadata)
          
          // If we're not the host and receive new metadata, request the full video state
          if (!isHost) {
            console.log('[Theater] Non-host received new video metadata, requesting full state')
            setTimeout(() => {
              socketManager.sendVideoStateRequest()
            }, 500) // Small delay to ensure host has processed the metadata
          }
        })

        // Listen for host video state requests
        socketManager.onHostVideoStateRequest(() => {
          if (isHost && videoMetadata) {
            console.log('[Theater] Host received video state request, sending current state')
            const videoState = {
              metadata: videoMetadata,
              playbackState: {
                currentTime: videoRef.current?.currentTime || 0,
                isPlaying: isPlaying,
                volume: volume,
                isMuted: isMuted
              }
            }
            socketManager.sendVideoStateSync(videoState)
          }
        })

        socketManager.onError((error) => {
          console.error('Socket error:', error)
          setError(error)
        })

        // Initialize WebRTC connections
        const initializeWebRTC = async () => {
          try {
            console.log('[Theater] Initializing WebRTC connections...')
            // Do NOT start local media stream here!
            // Only set up WebRTC connection status monitoring
            const statusInterval = setInterval(() => {
              const status = webrtcManager.getConnectionStatus()
              console.log('[Theater] WebRTC connection status:', status)
              setWebrtcStatus(status)
            }, 5000)
            // Clean up interval on unmount
            return () => clearInterval(statusInterval)
          } catch (error) {
            console.error('[Theater] Error initializing WebRTC:', error)
          }
        }
        
        initializeWebRTC()

        // Wait a bit for socket to connect, then join room
        setTimeout(() => {
          socketManager.joinRoom(resolvedParams.roomId)
        }, 2000)

        // Fetch room info from API
        await fetchRoomInfo(resolvedParams.roomId)

      } catch (error) {
        console.error('Error initializing room:', error)
        setError('Failed to join room')
        setIsLoading(false)
      }
    }

    initializeRoom()

    return () => {
      socketManager.leaveRoom()
      webrtcManager.cleanup()
    }
  }, [params, router])

  const fetchRoomInfo = async (roomId: string) => {
    try {
      const token = getToken()
      const response = await fetch(`${API_BASE_URL}/api/rooms/${roomId}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      const data = await response.json()
      if (data.success) {
        setRoomInfo(data.room)
        setParticipants(data.room.participants)
      } else {
        setError(data.error || 'Failed to fetch room info')
      }
    } catch (error) {
      console.error('Error fetching room info:', error)
      setError('Failed to fetch room info')
    }
  }

  const handleVideoControl = (data: any) => {
    if (!isHost && videoRef.current) {
      switch (data.type) {
        case 'play':
          suppressLocalPlaybackRef.current = true
          videoRef.current.currentTime = data.currentTime || 0
          videoRef.current.play().finally(() => {
            suppressLocalPlaybackRef.current = false
          })
          setIsPlaying(true)
          break
        case 'pause':
          suppressLocalPlaybackRef.current = true
          videoRef.current.pause()
          suppressLocalPlaybackRef.current = false
          setIsPlaying(false)
          break
        case 'seek':
          videoRef.current.currentTime = data.time
          break
      }
    }
  }

  const handleVideoMetadata = (metadata: any) => {
    // Handle video metadata from host
    console.log('Received video metadata:', metadata)
    if (!isHost) {
      setCurrentVideoType('file')
      // Ensure the receiver element is bound
      if (videoRef.current) {
        webrtcManager.setVideoElement(videoRef.current)
      }
    }
  }

  // YouTube video handling
  const extractYouTubeId = (url: string): string | null => {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/
    const match = url.match(regExp)
    return match && match[2].length === 11 ? match[2] : null
  }

  const handleYouTubeUrlChange = (url: string) => {
    setYoutubeUrl(url)
    if (url.trim() && isHost) {
      const videoId = extractYouTubeId(url)
      if (videoId) {
        setIsLoadingVideo(true)
        setTimeout(() => {
          setYoutubeVideoId(videoId)
          setCurrentVideoType("youtube")
          setIsPlaying(true)
          setIsLoadingVideo(false)
          
          // Send video metadata to peers
          socketManager.sendVideoMetadata({
            name: `YouTube Video - ${videoId}`,
            size: 0,
            type: 'youtube',
            url: url
          })
        }, 1000)
      }
    }
  }

  // Screen sharing
  const handleShareScreen = async () => {
    try {
      setIsLoadingVideo(true)
      const stream = await webrtcManager.startScreenShare()
      
      setCurrentVideoType("screen")
      setIsPlaying(true)
      setIsLoadingVideo(false)
      setYoutubeVideoId(null)
      setSelectedVideoFile(null)

      // Send metadata to peers
      socketManager.sendVideoMetadata({
        name: 'Screen Share',
        size: 0,
        type: 'screen',
        url: 'screen-share'
      })

      // Handle stream end
      stream.getVideoTracks()[0].onended = () => {
        setCurrentVideoType(null)
        setIsPlaying(false)
      }
    } catch (error) {
      console.error("Error sharing screen:", error)
      setIsLoadingVideo(false)
      setError("Screen sharing not supported or permission denied")
    }
  }

  const handleStopScreenShare = () => {
    webrtcManager.stopScreenShare()
    setCurrentVideoType(null)
    setIsPlaying(false)
  }

  // File video handling
  const handleSelectVideo = () => {
    fileInputRef.current?.click()
  }

  // ---- FIXED handleFileSelect: set selected file and let effect start streaming when host videoRef is ready ----
  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    console.log('[Theater] File input changed:', file)
    if (!file) return

    if (file && file.type.startsWith("video/")) {
      setIsLoadingVideo(true)
      setSelectedVideoFile(file)
      setCurrentVideoType("file")
      setIsPlaying(true)
      setIsLoadingVideo(false)
      setYoutubeVideoId(null)
      // Reset streaming flag so effect will attempt to start for this new file
      hasStartedStreamingRef.current = false

      // Broadcast metadata so receivers prepare their video element
      socketManager.sendVideoMetadata({
        name: file.name,
        size: file.size,
        type: file.type,
        url: 'p2p'
      })
    } else {
      setError("Please select a valid video file")
    }
  }

  // Ensure host streaming starts as soon as the host's <video> element is mounted and ready
  useEffect(() => {
    const tryStartHostFileStream = async () => {
      // Only host should start streaming
      if (!webrtcManager.isHostUser()) return
      if (!selectedVideoFile) return
      if (!videoRef.current) return
      if (hasStartedStreamingRef.current) return

      try {
        console.log('[Theater] Host starting file stream (effect):', selectedVideoFile.name)
        hasStartedStreamingRef.current = true
        await webrtcManager.streamVideoFile(selectedVideoFile, videoRef.current)
        // streamVideoFile will handle captureStream fallback internally
      } catch (e) {
        console.error('[Theater] Error while starting host file stream (effect):', e)
        // Reset flag to allow retries
        hasStartedStreamingRef.current = false
      }
    }

    // Try immediately and also schedule a couple of retries to handle mount timing edge-cases.
    tryStartHostFileStream()
    const retry1 = setTimeout(tryStartHostFileStream, 300)
    const retry2 = setTimeout(tryStartHostFileStream, 800)
    return () => {
      clearTimeout(retry1)
      clearTimeout(retry2)
    }
  }, [selectedVideoFile, isHost])

  // Bind receiver video element early for non-hosts
  useEffect(() => {
    if (!isHost && videoRef.current) {
      console.log('[Theater] Binding receiver video element for non-host')
      webrtcManager.setVideoElement(videoRef.current)
    }
  }, [isHost])

  // Video controls
  const togglePlayPause = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause()
        setIsPlaying(false)
        if (isHost) {
          socketManager.pauseVideo()
        }
      } else {
        videoRef.current.play()
        setIsPlaying(true)
        if (isHost) {
          socketManager.playVideo(videoRef.current.currentTime)
        }
      }
    }
  }

  const toggleMute = () => {
    if (videoRef.current) {
      videoRef.current.muted = !isMuted
      setIsMuted(!isMuted)
    }
  }

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = Number.parseFloat(e.target.value)
    setVolume(newVolume)

    if (videoRef.current) {
      videoRef.current.volume = newVolume
    }

    setIsMuted(newVolume === 0)
  }

  const handleProgressBarClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressBarRef.current || !videoRef.current) return

    const rect = progressBarRef.current.getBoundingClientRect()
    const pos = (e.clientX - rect.left) / rect.width
    const seekTime = pos * videoRef.current.duration

    videoRef.current.currentTime = seekTime
    setCurrentTime(seekTime)

    if (isHost) {
      socketManager.seekVideo(seekTime)
    }
  }

  // Chat functions
  const handleSendMessage = () => {
    if (message.trim()) {
      const messageText = message.trim()
      const messageId = `msg-${Date.now()}-${Math.random()}`
      
      // Add message to local chat immediately
      const newMessage: SocketMessage = {
        id: messageId,
        message: messageText,
        user: {
          id: user?.id || '',
          name: user?.name || 'You',
          picture: user?.picture || ''
        },
        timestamp: new Date().toLocaleTimeString(),
        isPrivate: false,
        type: 'text'
      }
      setMessages(prev => [...prev, newMessage])
      
      // Clear input immediately
      setMessage("")
      
      // Send via socket
      socketManager.sendMessage(messageText, false)
    }
  }

  // Voice message functions
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mediaRecorder = new MediaRecorder(stream)
      mediaRecorderRef.current = mediaRecorder
      
      const chunks: Blob[] = []
      mediaRecorder.ondataavailable = (e) => chunks.push(e.data)
      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'audio/webm' })
        setAudioBlob(blob)
        stream.getTracks().forEach(track => track.stop())
      }
      
      mediaRecorder.start()
      setIsRecording(true)
      setRecordingTime(0)
      
      // Start timer
      recordingIntervalRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1)
      }, 100)
      
    } catch (error) {
      console.error('Error starting recording:', error)
    }
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop()
      setIsRecording(false)
      
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current)
      }
    }
  }

  // Voice message functions
  const handleSendVoiceMessage = async () => {
    if (audioBlob) {
      setIsSendingVoiceMessage(true)
      
      // Add timeout to prevent stuck sending state
      const timeoutId = setTimeout(() => {
        setIsSendingVoiceMessage(false)
        console.error('Voice message sending timeout')
      }, 10000) // 10 second timeout
      
      try {
        // Add voice message to local chat immediately
        const voiceMessageId = `voice-${Date.now()}-${Math.random()}`
        const localVoiceMessage: SocketMessage = {
          id: voiceMessageId,
          user: {
            id: user?.id || '',
            name: user?.name || 'You',
            picture: user?.picture || ''
          },
          message: 'Voice Message',
          timestamp: new Date().toLocaleTimeString(),
          isPrivate: false,
          type: 'voice',
          audioUrl: URL.createObjectURL(audioBlob), // Use blob URL for local playback
          duration: recordingTime
        }
        
        setMessages(prev => [...prev, localVoiceMessage])
        
        // Send via socket with better error handling
        try {
          await socketManager.sendVoiceMessage(audioBlob, recordingTime, false, {
            id: user?.id || '',
            name: user?.name || 'You',
            picture: user?.picture || ''
          })
          
          console.log('Voice message sent successfully')
          setAudioBlob(null)
          setRecordingTime(0)
          clearTimeout(timeoutId)
        } catch (sendError) {
          console.error('Socket send error:', sendError)
          // Keep the local message but mark it as failed
          setMessages(prev => prev.map(msg => 
            msg.id === voiceMessageId 
              ? { ...msg, failed: true }
              : msg
          ))
          throw sendError
        }
      } catch (error) {
        console.error('Error sending voice message:', error)
        clearTimeout(timeoutId)
        // Don't remove the message, just mark it as failed
      } finally {
        setIsSendingVoiceMessage(false)
      }
    }
  }

  // Voice message playback functions
  const playVoiceMessage = (messageId: string, audioUrl: string) => {
    const audio = new Audio(audioUrl)
    audioRefs.current.set(messageId, audio)
    
    audio.addEventListener('timeupdate', () => {
      if (audio.duration) {
        const progress = (audio.currentTime / audio.duration) * 100
        const currentTime = audio.currentTime
        setVoiceMessageProgress(prev => new Map(prev).set(messageId, progress))
        setVoiceMessageCurrentTime(prev => new Map(prev).set(messageId, currentTime))
      }
    })
    
    audio.addEventListener('ended', () => {
      setPlayingVoiceMessages(prev => {
        const newSet = new Set(prev)
        newSet.delete(messageId)
        return newSet
      })
      setVoiceMessageProgress(prev => {
        const newMap = new Map(prev)
        newMap.delete(messageId)
        return newMap
      })
      setVoiceMessageCurrentTime(prev => {
        const newMap = new Map(prev)
        newMap.delete(messageId)
        return newMap
      })
      audioRefs.current.delete(messageId)
    })
    
    audio.play()
    setPlayingVoiceMessages(prev => new Set(prev).add(messageId))
  }

  const pauseVoiceMessage = (messageId: string) => {
    const audio = audioRefs.current.get(messageId)
    if (audio) {
      audio.pause()
      setPlayingVoiceMessages(prev => {
        const newSet = new Set(prev)
        newSet.delete(messageId)
        return newSet
      })
    }
  }

  const stopVoiceMessage = (messageId: string) => {
    const audio = audioRefs.current.get(messageId)
    if (audio) {
      audio.pause()
      audio.currentTime = 0
      setPlayingVoiceMessages(prev => {
        const newSet = new Set(prev)
        newSet.delete(messageId)
        return newSet
      })
      setVoiceMessageProgress(prev => {
        const newMap = new Map(prev)
        newMap.set(messageId, 0)
        return newMap
      })
      setVoiceMessageCurrentTime(prev => {
        const newMap = new Map(prev)
        newMap.set(messageId, 0)
        return newMap
      })
    }
  }

  // Video state persistence functions
  const saveVideoState = (metadata: any, playbackState: any) => {
    try {
      localStorage.setItem('videoMetadata', JSON.stringify(metadata))
      localStorage.setItem('videoPlaybackState', JSON.stringify(playbackState))
    } catch (error) {
      console.error('Error saving video state:', error)
    }
  }

  const loadVideoState = () => {
    try {
      const savedMetadata = localStorage.getItem('videoMetadata')
      const savedPlaybackState = localStorage.getItem('videoPlaybackState')
      
      if (savedMetadata) {
        setVideoMetadata(JSON.parse(savedMetadata))
      }
      if (savedPlaybackState) {
        setVideoPlaybackState(JSON.parse(savedPlaybackState))
      }
    } catch (error) {
      console.error('Error loading video state:', error)
    }
  }

  // Autoplay policy handling
  const tryPlayVideo = async () => {
    if (!videoRef.current) return

    try {
      await videoRef.current.play()
      setIsPlaying(true)
      setShowResumeOverlay(false)
    } catch (error: any) {
      if (error.name === 'NotAllowedError') {
        console.log('Autoplay blocked, showing resume overlay')
        setShowResumeOverlay(true)
      } else {
        console.error('Error playing video:', error)
      }
    }
  }

  const bindAndSyncVideoElement = (metadata: any, playbackState: any) => {
    if (!videoRef.current) return

    // Set video metadata
    setVideoMetadata(metadata)
    setVideoPlaybackState(playbackState)
    
    // Save to localStorage
    saveVideoState(metadata, playbackState)

    // Sync playback state
    if (playbackState) {
      videoRef.current.currentTime = playbackState.currentTime || 0
      setCurrentTime(playbackState.currentTime || 0)
      
      if (playbackState.isPlaying) {
        tryPlayVideo()
      } else {
        setIsPlaying(false)
      }
    }
  }

  // Video call functions
  const toggleMic = async () => {
    try {
      if (!isMicMuted) {
        await webrtcManager.startLocalStream({ audio: true, video: false })
      } else {
        webrtcManager.cleanup()
      }
      setIsMicMuted(!isMicMuted)
    } catch (error) {
      console.error('Error toggling mic:', error)
      setError('Failed to access microphone')
    }
  }

  const toggleVideo = async () => {
    try {
      if (!isVideoOn) {
        await webrtcManager.startLocalStream({ video: true, audio: true })
      } else {
        webrtcManager.cleanup()
      }
      setIsVideoOn(!isVideoOn)
    } catch (error) {
      console.error('Error toggling video:', error)
      setError('Failed to access camera')
    }
  }

  const toggleCall = async () => {
    if (!isInCall) {
      // Join call: request camera/mic
      try {
        await webrtcManager.startLocalStream({ video: true, audio: true })
        setIsInCall(true)
      } catch (error) {
        console.error('Error starting video call:', error)
        setError('Failed to access camera/mic')
      }
    } else {
      // Leave call: stop stream
      webrtcManager.cleanup()
      setIsInCall(false)
    }
  }

  // Utility functions
  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60)
    const seconds = Math.floor(time % 60)
    return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`
  }

  const toggleFullscreen = () => {
    if (!videoContainerRef.current) return

    if (!isFullscreen) {
      if (videoContainerRef.current.requestFullscreen) {
        videoContainerRef.current.requestFullscreen()
      }
      setIsFullscreen(true)
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen()
      }
      setIsFullscreen(false)
    }
  }

  // Listen for fullscreen changes from browser
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isFullscreenNow = !!document.fullscreenElement
      setIsFullscreen(isFullscreenNow)
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange)
    document.addEventListener('mozfullscreenchange', handleFullscreenChange)
    document.addEventListener('MSFullscreenChange', handleFullscreenChange)

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange)
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange)
      document.removeEventListener('MSFullscreenChange', handleFullscreenChange)
    }
  }, [])

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (chatScrollRef.current) {
      const scrollElement = chatScrollRef.current
      const isAtBottom = scrollElement.scrollHeight - scrollElement.clientHeight <= scrollElement.scrollTop + 100
      
      if (isAtBottom) {
        scrollElement.scrollTop = scrollElement.scrollHeight
      }
    }
  }, [messages])

  // Load video state on mount
  useEffect(() => {
    loadVideoState()
  }, [])

  // Request video state sync when connected as non-host
  useEffect(() => {
    if (isConnected && !isHost) {
      console.log('Non-host connected, requesting video state')
      socketManager.sendVideoStateRequest()
    }
  }, [isConnected, isHost])

  // Listen for video state sync
  useEffect(() => {
    const handleVideoStateSync = (data: any) => {
      console.log('Received video state sync:', data)
      if (!isHost && data.metadata && data.playbackState) {
        bindAndSyncVideoElement(data.metadata, data.playbackState)
      }
    }

    socketManager.onVideoStateSync(handleVideoStateSync)

    return () => {
      // Clean up listener if needed
    }
  }, [isHost])

  // Cleanup voice messages on unmount
  useEffect(() => {
    return () => {
      // Stop all playing voice messages
      audioRefs.current.forEach((audio) => {
        audio.pause()
        audio.src = ''
      })
      audioRefs.current.clear()
      setPlayingVoiceMessages(new Set())
      setVoiceMessageProgress(new Map())
      setVoiceMessageCurrentTime(new Map())
      
      // Revoke blob URLs to prevent memory leaks
      messages.forEach(msg => {
        if (msg.type === 'voice' && msg.audioUrl && msg.audioUrl.startsWith('blob:')) {
          URL.revokeObjectURL(msg.audioUrl)
        }
      })
    }
  }, [messages])

  // Video player content
  const getVideoPlayerContent = () => {
    if (isLoadingVideo) {
      return (
        <div className="text-center">
          <Loader2 className="w-16 h-16 text-purple-400 animate-spin mx-auto mb-4" />
          <h3 className="text-xl font-bold text-white mb-2">Loading...</h3>
          <p className="text-gray-400">Preparing your content</p>
        </div>
      )
    }

    if (currentVideoType === "youtube" && youtubeVideoId) {
      return (
        <div className="w-full h-full">
          <iframe
            ref={youtubePlayerRef}
            className="w-full h-full"
            src={`https://www.youtube.com/embed/${youtubeVideoId}?autoplay=1&controls=1&rel=0`}
            title="YouTube video player"
            frameBorder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      )
    }

    if (currentVideoType === "screen") {
      return (
        <div className="w-full h-full relative">
          <video ref={screenVideoRef} className="w-full h-full object-contain" autoPlay muted />
          <div className="absolute top-4 right-4">
            <Button
              onClick={handleStopScreenShare}
              variant="destructive"
              size="sm"
              className="bg-red-600 hover:bg-red-700"
            >
              <StopCircle className="mr-2 h-4 w-4" />
              Stop Sharing
            </Button>
          </div>
        </div>
      )
    }

    // For non-host, always render a receiver element and expose native controls
    if (!isHost) {
      return (
        <div className="w-full h-full">
          <video
            ref={(el) => {
              // Assign and immediately bind to webrtc manager when available
              // so we don't miss early chunks
              // eslint-disable-next-line @typescript-eslint/ban-ts-comment
              // @ts-ignore
              videoRef.current = el
                           if (el && !isHost) {
               webrtcManager.setVideoElement(el)
             }
            }}
            className="w-full h-full object-contain"
            autoPlay
            playsInline
                       preload="auto"
           onLoadedMetadata={() => {
              try {
                videoRef.current?.play()
                setIsPlaying(true)
              } catch {}
            }}
            onCanPlay={() => {
              if (videoRef.current && videoRef.current.paused) {
                videoRef.current.play().then(() => setIsPlaying(true)).catch(() => {})
              }
            }}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onTimeUpdate={() => {
              if (videoRef.current) {
                setCurrentTime(videoRef.current.currentTime)
                setDuration(videoRef.current.duration)
              }
            }}
          />
        </div>
      )
    }

    if (currentVideoType === "file" && selectedVideoFile) {
      return (
        <div className="w-full h-full">
          <video
            ref={videoRef}
            className="w-full h-full object-contain"
            autoPlay
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onTimeUpdate={() => {
              if (videoRef.current) {
                setCurrentTime(videoRef.current.currentTime)
                setDuration(videoRef.current.duration)
              }
            }}
          />
        </div>
      )
    }

    return (
      <div className="text-center">
        <div className="w-32 h-32 bg-purple-600 rounded-full flex items-center justify-center mx-auto mb-4">
          <Play className="h-16 w-16 text-white" />
        </div>
        <h3 className="text-2xl font-bold text-white mb-2">Ready to Watch</h3>
        <p className="text-gray-400">Add content using the controls above</p>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-white flex items-center space-x-2">
          <Loader2 className="w-6 h-6 animate-spin" />
          <span>Joining room...</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="w-16 h-16 text-red-400 mx-auto mb-4" />
          <h3 className="text-xl font-bold text-white mb-2">Error</h3>
          <p className="text-gray-400 mb-4">{error}</p>
          <Button onClick={() => router.push('/rooms')} className="bg-purple-600 hover:bg-purple-700">
            Back to Rooms
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-black overflow-auto">
      {joinNotice && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-green-600 text-white px-4 py-2 rounded shadow">
          {joinNotice}
        </div>
      )}
      {/* Header */}
      {!isFullscreen && (
        <>
          <header className="bg-gray-900 border-b border-gray-800 px-4 py-3">
            <div className="flex items-center justify-between">
              <Link href="/rooms" className="flex items-center space-x-2">
                <Play className="h-6 w-6 text-purple-400" />
                <span className="text-lg font-bold text-white">CinemaSync</span>
              </Link>
              <div className="flex items-center space-x-4">
                <span className="px-2 py-1 bg-green-600/20 text-green-300 text-sm rounded-full flex items-center">
                  <Users className="mr-1 h-3 w-3" />
                  {participants.length}/5 watching
                </span>
                {isHost && (
                  <span className="px-2 py-1 bg-purple-600/20 text-purple-300 text-sm rounded-full flex items-center">
                    <Crown className="mr-1 h-3 w-3" />
                    Host
                  </span>
                )}
                {/* WebRTC Connection Status */}
                {webrtcStatus && (
                  <div className="fixed top-4 left-4 z-50">
                    {showConnectedText ? (
                      <div className="px-2 py-1 rounded bg-green-500 text-white text-xs">Connected</div>
                    ) : (
                      <div className={`w-3 h-3 rounded-full ${webrtcStatus.connectedPeers > 0 ? 'bg-green-500' : 'bg-red-500'}`}></div>
                    )}
                  </div>
                )}

                {/* Removed test buttons for production */}
                <Button
                  variant="outline"
                  size="sm"
                  className="text-white border-gray-600 hover:bg-gray-800 bg-transparent"
                >
                  <Settings className="mr-2 h-4 w-4" />
                  Settings
                </Button>
              </div>
            </div>
          </header>

          {/* Media Controls */}
          {isHost && (
            <div className="bg-gray-900 border-b border-gray-800 px-4 py-3">
              <div className="flex flex-col lg:flex-row gap-4">
                {/* YouTube URL Input */}
                <div className="flex-1 flex gap-2">
                  <Input
                    placeholder="Paste YouTube URL here (auto-plays when pasted)..."
                    value={youtubeUrl}
                    onChange={(e) => handleYouTubeUrlChange(e.target.value)}
                    className="bg-gray-800 border-gray-700 text-white placeholder:text-gray-400"
                  />
                  <div className="flex items-center px-3 bg-red-600/20 rounded-md">
                    <Youtube className="h-4 w-4 text-red-400" />
                  </div>
                </div>

                {/* Media Action Buttons */}
                <div className="flex gap-2">
                  <Button
                    onClick={handleShareScreen}
                    disabled={isLoadingVideo}
                    className="bg-blue-600 hover:bg-blue-700 transition-all duration-300"
                  >
                    <Monitor className="mr-2 h-4 w-4" />
                    Share Screen
                  </Button>
                  <Button
                    onClick={handleSelectVideo}
                    disabled={isLoadingVideo}
                    className="bg-green-600 hover:bg-green-700 transition-all duration-300"
                  >
                    <Video className="mr-2 h-4 w-4" />
                    Select Video
                  </Button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      <input ref={fileInputRef} type="file" accept="video/*" onChange={handleFileSelect} className="hidden" />

      <div className={`flex ${isFullscreen ? "h-screen" : "h-[calc(100vh-140px)]"} relative`}>
        {/* Left Side - Video Player */}
        <div
          ref={videoContainerRef}
          className={`flex-1 flex flex-col bg-black relative ${isFullscreen ? "h-screen" : ""}`}
        >
          {/* Video Container */}
          <div className="flex-1 relative bg-gray-900 flex items-center justify-center">
            <div className="w-full h-full bg-gradient-to-br from-gray-800 to-gray-900 flex items-center justify-center">
              {getVideoPlayerContent()}
            </div>

            {/* Custom Video Controls */}
            {(currentVideoType || !isHost) && (
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4">
                {/* Progress Bar - Only for host with file video */}
                {isHost && currentVideoType === "file" && (
                  <div
                    ref={progressBarRef}
                    className="w-full h-2 bg-gray-700 rounded-full mb-4 cursor-pointer"
                    onClick={handleProgressBarClick}
                  >
                    <div
                      className="h-full bg-purple-600 rounded-full"
                      style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }}
                    ></div>
                  </div>
                )}
                
                {isHost ? (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={togglePlayPause}
                        className="text-white hover:bg-white/20"
                        disabled={currentVideoType === "screen"}
                      >
                        {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                      </Button>
                      <div className="flex items-center space-x-2">
                        <Button variant="ghost" size="sm" onClick={toggleMute} className="text-white hover:bg-white/20">
                          {isMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
                        </Button>
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.01"
                          value={volume}
                          onChange={handleVolumeChange}
                          className="w-20 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"
                        />
                      </div>
                      {currentVideoType === "file" && (
                        <div className="text-white text-sm">
                          {formatTime(currentTime)} / {formatTime(duration)}
                        </div>
                      )}
                    </div>
                    <Button variant="ghost" size="sm" onClick={toggleFullscreen} className="text-white hover:bg-white/20">
                      {isFullscreen ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                      <div className="flex items-center space-x-2">
                        <Button variant="ghost" size="sm" onClick={toggleMute} className="text-white hover:bg-white/20">
                          {isMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
                        </Button>
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.01"
                          value={volume}
                          onChange={handleVolumeChange}
                          className="w-20 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"
                        />
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" onClick={toggleFullscreen} className="text-white hover:bg-white/20">
                      {isFullscreen ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* Chat Toggle Button in Fullscreen with unread badge - for both host and non-host */}
            {isFullscreen && (
              <div className="absolute top-4 right-4 z-20">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setIsChatVisible(!isChatVisible); if (!isChatVisible) setUnreadCount(0); }}
                  className="relative text-white bg-black/50 hover:bg-black/70"
                >
                  {isChatVisible ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
                  {!isChatVisible && unreadCount > 0 && (
                    <span className="absolute -top-2 -right-2 bg-red-600 text-white text-[10px] rounded-full px-1">{unreadCount}</span>
                  )}
                </Button>
              </div>
            )}
          </div>

          {/* Video Chat Section - Hide in fullscreen */}
          {!isFullscreen && (
            <div className="bg-gray-900 border-t border-gray-800 p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-white font-semibold">Video Chat</h3>
                <div className="flex items-center space-x-2">
                  <Button
                    variant={isMicMuted ? "destructive" : "secondary"}
                    size="sm"
                    onClick={toggleMic}
                  >
                    {isMicMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                  </Button>
                  <Button
                    variant={isVideoOn ? "secondary" : "destructive"}
                    size="sm"
                    onClick={toggleVideo}
                  >
                    {isVideoOn ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
                  </Button>
                  <Button
                    variant={isInCall ? "destructive" : "default"}
                    size="sm"
                    onClick={toggleCall}
                    className={isInCall ? "" : "bg-green-600 hover:bg-green-700"}
                  >
                    {isInCall ? <PhoneOff className="h-4 w-4" /> : <Phone className="h-4 w-4" />}
                    {isInCall ? "Leave" : "Join"}
                  </Button>
                </div>
              </div>

              {/* Video Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {participants
                  .filter((participant, index, self) => 
                    index === self.findIndex(p => p.user.id === participant.user.id)
                  )
                  .slice(0, 4)
                  .map((participant) => (
                  <div key={participant.user.id} className="relative bg-gray-800 rounded-lg aspect-video overflow-hidden">
                    <div className="w-full h-full bg-gradient-to-br from-purple-600 to-blue-600 flex items-center justify-center">
                      <Avatar className="h-12 w-12">
                        <AvatarImage src={participant.user.picture || "/placeholder.svg"} />
                        <AvatarFallback>
                          {participant.user.name
                            .split(" ")
                            .map((n) => n[0])
                            .join("")}
                        </AvatarFallback>
                      </Avatar>
                    </div>
                    <div className="absolute bottom-1 left-1 right-1">
                      <div className="bg-black/60 rounded px-2 py-1 text-xs text-white flex items-center justify-between">
                        <span className="truncate">{participant.user.name}</span>
                        {participant.isHost && <span className="text-xs bg-purple-600 px-1 rounded">Host</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Side - Chat - Always visible, but can be hidden in fullscreen */}
        {(!isFullscreen || (isFullscreen && isChatVisible)) && (
          <div
            className={`${
              isFullscreen
                ? "absolute right-0 top-0 bottom-0 w-80 bg-black/70 backdrop-blur-sm z-10 transition-all duration-300"
                : "w-80 bg-gray-900 border-l border-gray-800"
            } 
              flex flex-col`}
          >
            {/* Participants Header */}
            <div className="p-4 border-b border-gray-800">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-white font-semibold text-lg">Chat</h3>
                <div className="flex -space-x-2">
                  {participants.slice(0, 5).map((participant) => (
                    <Avatar key={participant.user.id} className="h-8 w-8 border-2 border-gray-800">
                      <AvatarImage src={participant.user.picture || "/placeholder.svg"} />
                      <AvatarFallback className="text-xs bg-gray-700">
                        {participant.user.name.split(" ").map((n) => n[0]).join("")}
                      </AvatarFallback>
                    </Avatar>
                  ))}
                  {participants.length > 5 && (
                    <div className="h-8 w-8 rounded-full bg-gray-600 border-2 border-gray-800 flex items-center justify-center">
                      <span className="text-xs text-white">+{participants.length - 5}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Chat Messages */}
            <div className="flex-1 overflow-y-auto p-4" ref={chatScrollRef}>
              <div className="space-y-3">
                {messages
                  .filter((msg) => !msg.isPrivate)
                  .map((msg, index) => {
                    const isOwnMessage = msg.user.id === user?.id
                    return (
                      <div key={`${msg.id}-${index}`} className={`flex ${isOwnMessage ? 'justify-end' : 'justify-start'}`}>
                        {!isOwnMessage && (
                          <Avatar className="h-8 w-8 mr-2 flex-shrink-0">
                            <AvatarImage src={msg.user.picture || "/placeholder.svg"} />
                            <AvatarFallback className="text-xs bg-gray-700">
                              {msg.user.name
                                .split(" ")
                                .map((n) => n[0])
                                .join("")}
                            </AvatarFallback>
                          </Avatar>
                        )}
                        <div className={`max-w-[70%] ${isOwnMessage ? 'order-1' : 'order-2'}`}>
                          {!isOwnMessage && (
                            <div className="flex items-center space-x-2 mb-1">
                              <span className="text-sm font-medium text-white">{msg.user.name}</span>
                            </div>
                          )}
                          <div className={`rounded-2xl px-4 py-2 shadow-sm ${
                            isOwnMessage 
                              ? 'bg-purple-600 text-white' 
                              : 'bg-gray-700 text-gray-200'
                          }`}>
                            {msg.type === 'voice' ? (
                              /* WhatsApp-style Voice Message Display */
                              <div className="flex items-center space-x-3 min-w-[200px]">
                                {/* Avatar */}
                                <Avatar className="h-8 w-8 flex-shrink-0">
                                  <AvatarImage src={msg.user.picture || "/placeholder.svg"} />
                                  <AvatarFallback className="text-xs bg-gray-700">
                                    {msg.user.name.split(" ").map((n: string) => n[0]).join("")}
                                  </AvatarFallback>
                                </Avatar>
                                
                                {/* Voice Message Content */}
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center space-x-3">
                                    {/* Play/Pause Button */}
                                    {playingVoiceMessages.has(msg.id) ? (
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => pauseVoiceMessage(msg.id)}
                                        className="h-8 w-8 p-0 text-current hover:bg-black/20 rounded-full animate-pulse"
                                      >
                                        <Pause className="h-4 w-4" />
                                      </Button>
                                    ) : (
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => msg.audioUrl && playVoiceMessage(msg.id, msg.audioUrl)}
                                        className="h-8 w-8 p-0 text-current hover:bg-black/20 rounded-full"
                                      >
                                        <Play className="h-4 w-4" />
                                      </Button>
                                    )}
                                    
                                    {/* Progress Bar with Waveform */}
                                    <div className="flex-1 min-w-0">
                                      <div className="w-full h-1.5 bg-black/20 rounded-full overflow-hidden relative">
                                        {/* Waveform visualization */}
                                        <div className="absolute inset-0 flex items-center justify-center space-x-px">
                                          {Array.from({ length: 20 }, (_, i) => (
                                            <div
                                              key={i}
                                              className="w-0.5 bg-current opacity-30"
                                              style={{
                                                height: `${Math.random() * 60 + 20}%`,
                                                opacity: voiceMessageProgress.get(msg.id) || 0 > (i / 20) * 100 ? 0.8 : 0.3
                                              }}
                                            />
                                          ))}
                                        </div>
                                        {/* Progress overlay */}
                                        <div 
                                          className="h-full bg-current rounded-full transition-all duration-100 relative z-10"
                                          style={{ width: `${voiceMessageProgress.get(msg.id) || 0}%` }}
                                        ></div>
                                      </div>
                                    </div>
                                    
                                    {/* Duration and Current Time */}
                                    <span className="text-xs opacity-70 min-w-[40px] text-right">
                                      {voiceMessageCurrentTime.get(msg.id) ? 
                                        `${Math.floor(voiceMessageCurrentTime.get(msg.id)!)}s` : 
                                        `${msg.duration}s`
                                      }
                                    </span>
                                    
                                    {/* Sending indicator for own messages */}
                                    {msg.user.id === user?.id && msg.audioUrl?.startsWith('blob:') && (
                                      <div className="ml-2">
                                        {msg.failed ? (
                                          <Button
                                            size="sm"
                                            variant="ghost"
                                            onClick={() => {
                                              // Retry sending the voice message
                                              if (msg.audioUrl && msg.duration) {
                                                // Convert blob URL back to blob and retry
                                                fetch(msg.audioUrl)
                                                  .then(res => res.blob())
                                                  .then(blob => {
                                                    socketManager.sendVoiceMessage(blob, msg.duration || 0, false, {
                                                      id: user?.id || '',
                                                      name: user?.name || 'You',
                                                      picture: user?.picture || ''
                                                    }).then(() => {
                                                      // Mark as sent successfully
                                                      setMessages(prev => prev.map(m => 
                                                        m.id === msg.id 
                                                          ? { ...m, failed: false }
                                                          : m
                                                      ))
                                                    }).catch(console.error)
                                                  })
                                              }
                                            }}
                                            className="h-6 w-6 p-0 text-red-400 hover:text-red-300"
                                          >
                                            <AlertCircle className="h-3 w-3" />
                                          </Button>
                                        ) : (
                                          <Loader2 className="h-3 w-3 text-current animate-spin opacity-70" />
                                        )}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <p className="text-sm leading-relaxed">{msg.message}</p>
                            )}
                          </div>
                        </div>
                        {isOwnMessage && (
                          <Avatar className="h-8 w-8 ml-2 flex-shrink-0">
                            <AvatarImage src={msg.user.picture || "/placeholder.svg"} />
                            <AvatarFallback className="text-xs bg-purple-700">
                              {msg.user.name
                                .split(" ")
                                .map((n) => n[0])
                                .join("")}
                            </AvatarFallback>
                          </Avatar>
                        )}
                      </div>
                    )
                  })}
              </div>
            </div>

            {/* Recording Indicator */}
            {isRecording && (
              <div className="px-4 py-2 bg-red-600/20 border-l-4 border-red-500">
                <div className="flex items-center space-x-2 text-red-400">
                  <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
                  <span className="text-sm font-medium">Recording voice message...</span>
                  <span className="text-xs opacity-70">{recordingTime.toFixed(1)}s</span>
                  <div className="ml-auto">
                    <div className="w-4 h-4 border-2 border-red-500 border-t-transparent rounded-full animate-spin"></div>
                  </div>
                </div>
              </div>
            )}
            
            {/* Message Input */}
            <div className="p-4 border-t border-gray-800">
              {audioBlob ? (
                /* WhatsApp-style Voice Message Preview */
                <div className="space-y-3">
                  <div className="bg-gray-800 rounded-lg p-3">
                    <div className="flex items-center space-x-3">
                      {/* Avatar */}
                      <Avatar className="h-8 w-8 flex-shrink-0">
                        <AvatarImage src={user?.picture || "/placeholder.svg"} />
                        <AvatarFallback className="text-xs bg-purple-700">
                          {user?.name?.split(" ").map((n: string) => n[0]).join("") || "U"}
                        </AvatarFallback>
                      </Avatar>
                      
                      {/* Voice Message Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center space-x-3">
                          {/* Play Button */}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              if (audioBlob) {
                                const audio = new Audio(URL.createObjectURL(audioBlob))
                                audio.play()
                              }
                            }}
                            className="h-8 w-8 p-0 text-purple-400 hover:text-purple-300 rounded-full"
                          >
                            <Play className="h-4 w-4" />
                          </Button>
                          
                          {/* Progress Bar with Waveform */}
                          <div className="flex-1 min-w-0">
                            <div className="w-full h-1.5 bg-gray-700 rounded-full overflow-hidden relative">
                              {/* Waveform visualization */}
                              <div className="absolute inset-0 flex items-center justify-center space-x-px">
                                {Array.from({ length: 20 }, (_, i) => (
                                  <div
                                    key={i}
                                    className="w-0.5 bg-purple-400 opacity-30"
                                    style={{
                                      height: `${Math.random() * 60 + 20}%`,
                                      opacity: (recordingTime / Math.max(recordingTime, 1)) > (i / 20) ? 0.8 : 0.3
                                    }}
                                  />
                                ))}
                              </div>
                              {/* Progress overlay */}
                              <div 
                                className="h-full bg-purple-600 rounded-full transition-all duration-100 relative z-10"
                                style={{ width: `${(recordingTime / Math.max(recordingTime, 1)) * 100}%` }}
                              ></div>
                            </div>
                          </div>
                          
                          {/* Duration */}
                          <span className="text-xs text-gray-400 min-w-[30px] text-right">
                            {recordingTime}s
                          </span>
                          
                          {/* Recording indicator */}
                          <div className="ml-2">
                            <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
                          </div>
                          
                          {/* Recording time indicator */}
                          <div className="ml-2">
                            <span className="text-xs text-red-400 font-medium">REC</span>
                          </div>
                        </div>
                      </div>
                      
                      {/* Delete Button */}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setAudioBlob(null)}
                        className="h-8 w-8 p-0 text-red-400 hover:text-red-300 rounded-full"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex space-x-2">
                    <Button
                      onClick={handleSendVoiceMessage}
                      disabled={isSendingVoiceMessage}
                      className="bg-purple-600 hover:bg-purple-700 flex-1 disabled:opacity-50"
                    >
                      {isSendingVoiceMessage ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Sending Voice Message...
                        </>
                      ) : (
                        <>
                          <Send className="h-4 w-4 mr-2" />
                          Send Voice Message
                        </>
                      )}
                    </Button>
                    <Button
                      onClick={() => {
                        setAudioBlob(null)
                        setRecordingTime(0)
                      }}
                      variant="outline"
                      className="border-gray-600 text-gray-300 hover:bg-gray-700"
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                /* Text Message Input */
                <div className="flex space-x-2">
                  <Input
                    placeholder={isRecording ? `Recording voice message... ${recordingTime.toFixed(1)}s` : "Type a message..."}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    onKeyPress={(e) => {
                      if (e.key === "Enter" && message.trim() && !isRecording) {
                        e.preventDefault()
                        handleSendMessage()
                      }
                    }}
                    className={`bg-gray-800 border-gray-700 text-white placeholder:text-gray-400 flex-1 transition-all duration-200 ${
                      isRecording ? 'border-red-500 placeholder:text-red-400' : ''
                    }`}
                    disabled={isRecording}
                  />
                  <Button
                    onMouseDown={() => {
                      if (!isRecording) {
                        startRecording()
                      }
                    }}
                    onMouseUp={() => {
                      if (isRecording) {
                        stopRecording()
                      }
                    }}
                    onMouseLeave={() => {
                      if (isRecording) {
                        stopRecording()
                      }
                    }}
                    className={`px-3 transition-all duration-200 ${
                      isRecording 
                        ? 'bg-red-600 hover:bg-red-700 animate-pulse' 
                        : 'bg-gray-600 hover:bg-gray-700'
                    }`}
                  >
                    {isRecording ? (
                      <div className="flex items-center space-x-2">
                        <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
                        <Mic className="h-4 w-4" />
                        <span className="text-xs font-medium text-white">{recordingTime.toFixed(1)}s</span>
                      </div>
                    ) : (
                      <Mic className="h-4 w-4" />
                    )}
                  </Button>
                  <Button 
                    onClick={handleSendMessage} 
                    disabled={!message.trim() || isRecording}
                    className="bg-purple-600 hover:bg-purple-700 px-3 disabled:opacity-50"
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Resume Playback Overlay */}
      {showResumeOverlay && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-6 text-center">
            <AlertCircle className="w-16 h-16 text-yellow-400 mx-auto mb-4" />
            <h3 className="text-xl font-bold text-white mb-2">Video Ready to Play</h3>
            <p className="text-gray-400 mb-4">Click below to resume playback</p>
            <Button
              onClick={tryPlayVideo}
              className="bg-purple-600 hover:bg-purple-700"
            >
              <Play className="mr-2 h-4 w-4" />
              Resume Playback
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
