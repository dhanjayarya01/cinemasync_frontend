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
  const [activeTab, setActiveTab] = useState<"group" | "private">("group")
  const [isChatVisible, setIsChatVisible] = useState(true)
  const [unreadCount, setUnreadCount] = useState(0)
  const [joinNotice, setJoinNotice] = useState<string | null>(null)

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

  // Check if user is host
  const isHost = user?.id === roomInfo?.host?.id

  // WebRTC connection status
  const [webrtcStatus, setWebrtcStatus] = useState<any>(null)
  const [webrtcConnected, setWebrtcConnected] = useState(false)
  const [showConnectedText, setShowConnectedText] = useState(false)

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
          setMessages(prev => {
            // Check if message already exists to prevent duplicates
            const exists = prev.some(m => m.id === message.id)
            if (exists) return prev
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

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    console.log('[Theater] File input changed:', file)
    if (file && file.type.startsWith("video/")) {
      setIsLoadingVideo(true)
      setSelectedVideoFile(file)
      setCurrentVideoType("file")
      setIsPlaying(true)
      setIsLoadingVideo(false)
      setYoutubeVideoId(null)
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

  // Handle video file streaming for host (avoid duplicate starts)
  const hasStartedStreamingRef = useRef(false)
  useEffect(() => {
    if (!webrtcManager.isHostUser()) return
    if (!selectedVideoFile) return
    if (!videoRef.current) return
    if (hasStartedStreamingRef.current) return
    hasStartedStreamingRef.current = true
    console.log('[Theater] Host is about to stream video file (from useEffect):', selectedVideoFile.name)
    webrtcManager.streamVideoFile(selectedVideoFile, videoRef.current)
  }, [selectedVideoFile])

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
      socketManager.sendMessage(message, activeTab === "private")
      setMessage("")
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
            {currentVideoType && (
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
            {/* Chat Tab Buttons */}
            <div className="p-4 border-b border-gray-800">
              <div className="flex space-x-2">
                <Button
                  variant={activeTab === "group" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setActiveTab("group")}
                  className="flex-1"
                >
                  <MessageCircle className="mr-2 h-4 w-4" />
                  Group
                </Button>
                <Button
                  variant={activeTab === "private" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setActiveTab("private")}
                  className="flex-1"
                >
                  Private
                </Button>
              </div>
            </div>

            {/* Chat Messages */}
            <ScrollArea className="flex-1 p-4">
              <div className="space-y-4">
                {messages
                  .filter((msg) => (activeTab === "group" ? !msg.isPrivate : msg.isPrivate))
                  .map((msg, index) => (
                    <div key={`${msg.id}-${index}`} className="flex space-x-2">
                      <Avatar className="h-8 w-8">
                        <AvatarImage src={msg.user.picture || "/placeholder.svg"} />
                        <AvatarFallback className="text-xs">
                          {msg.user.name
                            .split(" ")
                            .map((n) => n[0])
                            .join("")}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1">
                        <div className="flex items-center space-x-2 mb-1">
                          <span className="text-sm font-medium text-white">{msg.user.name}</span>
                          <span className="text-xs text-gray-400">{msg.timestamp}</span>
                        </div>
                        <p className="text-sm text-gray-300">{msg.message}</p>
                      </div>
                    </div>
                  ))}
              </div>
            </ScrollArea>

            {/* Message Input */}
            <div className="p-4 border-t border-gray-800">
              <div className="flex space-x-2">
                <Input
                  placeholder="Type a message..."
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyPress={(e) => e.key === "Enter" && handleSendMessage()}
                  className="bg-gray-800 border-gray-700 text-white placeholder:text-gray-400 flex-1"
                />
                <Button onClick={handleSendMessage} className="bg-purple-600 hover:bg-purple-700 px-3">
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
