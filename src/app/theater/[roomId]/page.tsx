"use client"

import type React from "react"

import { useState, useEffect, useRef } from "react"
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
} from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"

const mockMessages = [
  {
    id: 1,
    user: "John Doe",
    avatar: "/placeholder.svg?height=32&width=32",
    message: "This movie is amazing!",
    timestamp: "10:30 PM",
    isPrivate: false,
    type: "text",
  },
  {
    id: 2,
    user: "Sarah Wilson",
    avatar: "/placeholder.svg?height=32&width=32",
    message: "I love this scene!",
    timestamp: "10:32 PM",
    isPrivate: false,
    type: "text",
  },
]

const mockParticipants = [
  {
    id: 1,
    name: "John Doe",
    avatar: "/placeholder.svg?height=40&width=40",
    isHost: true,
    isMuted: false,
    hasVideo: true,
  },
  {
    id: 2,
    name: "Sarah Wilson",
    avatar: "/placeholder.svg?height=40&width=40",
    isHost: false,
    isMuted: false,
    hasVideo: true,
  },
]

export default function TheaterPage({ params }: { params: { roomId: string } }) {
  const [user, setUser] = useState<any>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [message, setMessage] = useState("")
  const [messages, setMessages] = useState(mockMessages)
  const [isMicMuted, setIsMicMuted] = useState(false)
  const [isVideoOn, setIsVideoOn] = useState(true)
  const [isInCall, setIsInCall] = useState(false)
  const [activeTab, setActiveTab] = useState("group")
  const [youtubeUrl, setYoutubeUrl] = useState("")
  const [isLoadingVideo, setIsLoadingVideo] = useState(false)
  const [currentVideoType, setCurrentVideoType] = useState<"youtube" | "screen" | "file" | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null)
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null)
  const [selectedVideoFile, setSelectedVideoFile] = useState<File | null>(null)
  const [youtubeVideoId, setYoutubeVideoId] = useState<string | null>(null)
  const [currentVideoUrl, setCurrentVideoUrl] = useState<string | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isChatVisible, setIsChatVisible] = useState(true)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const screenVideoRef = useRef<HTMLVideoElement>(null)
  const youtubePlayerRef = useRef<HTMLIFrameElement>(null)
  const videoContainerRef = useRef<HTMLDivElement>(null)
  const progressBarRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  useEffect(() => {
    const userData = localStorage.getItem("user")
    if (!userData) {
      router.push("/auth")
      return
    }
    setUser(JSON.parse(userData))
  }, [router])

  // Extract YouTube video ID from URL
  const extractYouTubeId = (url: string): string | null => {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/
    const match = url.match(regExp)
    return match && match[2].length === 11 ? match[2] : null
  }

  // Handle YouTube URL input and auto-play
  const handleYouTubeUrlChange = (url: string) => {
    setYoutubeUrl(url)
    if (url.trim()) {
      const videoId = extractYouTubeId(url)
      if (videoId) {
        setIsLoadingVideo(true)
        setTimeout(() => {
          setYoutubeVideoId(videoId)
          setCurrentVideoType("youtube")
          setIsPlaying(true)
          setIsLoadingVideo(false)
          setScreenStream(null)
          setSelectedVideoFile(null)
          setCurrentVideoUrl(null)
        }, 1000)
      }
    }
  }

  // Handle screen sharing
  const handleShareScreen = async () => {
    try {
      setIsLoadingVideo(true)
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { mediaSource: "screen" },
        audio: true,
      })

      setScreenStream(stream)
      setCurrentVideoType("screen")
      setIsPlaying(true)
      setIsLoadingVideo(false)
      setYoutubeVideoId(null)
      setSelectedVideoFile(null)
      setCurrentVideoUrl(null)

      // Handle stream end
      stream.getVideoTracks()[0].onended = () => {
        setScreenStream(null)
        setCurrentVideoType(null)
        setIsPlaying(false)
      }
    } catch (error) {
      console.error("Error sharing screen:", error)
      setIsLoadingVideo(false)
      alert("Screen sharing not supported or permission denied")
    }
  }

  // Stop screen sharing
  const handleStopScreenShare = () => {
    if (screenStream) {
      screenStream.getTracks().forEach((track) => track.stop())
      setScreenStream(null)
      setCurrentVideoType(null)
      setIsPlaying(false)
    }
  }

  // Handle file selection
  const handleSelectVideo = () => {
    fileInputRef.current?.click()
  }

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file && file.type.startsWith("video/")) {
      setIsLoadingVideo(true)
      const url = URL.createObjectURL(file)

      setTimeout(() => {
        setSelectedVideoFile(file)
        setCurrentVideoUrl(url)
        setCurrentVideoType("file")
        setIsPlaying(true)
        setIsLoadingVideo(false)
        setYoutubeVideoId(null)
        setScreenStream(null)
      }, 500)
    } else {
      alert("Please select a valid video file")
    }
  }

  // Handle video upload for better quality
  const handleUploadVideo = () => {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = "video/*"
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (file) {
        setIsLoadingVideo(true)
        // Simulate upload process
        setTimeout(() => {
          const url = URL.createObjectURL(file)
          setSelectedVideoFile(file)
          setCurrentVideoUrl(url)
          setCurrentVideoType("file")
          setIsPlaying(true)
          setIsLoadingVideo(false)
          setYoutubeVideoId(null)
          setScreenStream(null)
          console.log("Video uploaded for HD quality:", file.name)
        }, 2000)
      }
    }
    input.click()
  }

  // Handle voice recording
  const handleVoiceMessage = async () => {
    if (!isRecording) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        const recorder = new MediaRecorder(stream)
        const chunks: BlobPart[] = []

        recorder.ondataavailable = (e) => chunks.push(e.data)
        recorder.onstop = () => {
          const blob = new Blob(chunks, { type: "audio/wav" })
          const audioUrl = URL.createObjectURL(blob)

          const voiceMessage = {
            id: messages.length + 1,
            user: user?.name || "You",
            avatar: user?.avatar || "/placeholder.svg?height=32&width=32",
            message: "🎤 Voice message",
            timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            isPrivate: activeTab === "private",
            type: "voice" as const,
            audioUrl,
          }
          setMessages([...messages, voiceMessage])
          stream.getTracks().forEach((track) => track.stop())
        }

        recorder.start()
        setMediaRecorder(recorder)
        setIsRecording(true)
      } catch (error) {
        console.error("Error accessing microphone:", error)
        alert("Microphone access denied")
      }
    } else {
      if (mediaRecorder) {
        mediaRecorder.stop()
        setMediaRecorder(null)
        setIsRecording(false)
      }
    }
  }

  // Handle message sending
  const handleSendMessage = () => {
    if (message.trim()) {
      const newMessage = {
        id: messages.length + 1,
        user: user?.name || "You",
        avatar: user?.avatar || "/placeholder.svg?height=32&width=32",
        message: message,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        isPrivate: activeTab === "private",
        type: "text" as const,
      }
      setMessages([...messages, newMessage])
      setMessage("")
    }
  }

  // Play voice message
  const playVoiceMessage = (audioUrl: string) => {
    const audio = new Audio(audioUrl)
    audio.play()
  }

  // Video player controls
  const togglePlayPause = () => {
    if (currentVideoType === "file" && videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause()
      } else {
        videoRef.current.play()
      }
      setIsPlaying(!isPlaying)
    } else if (currentVideoType === "screen" && screenVideoRef.current) {
      // Screen sharing doesn't have play/pause
      return
    } else if (currentVideoType === "youtube") {
      // YouTube player control would go here
      setIsPlaying(!isPlaying)
    }
  }

  const toggleMute = () => {
    if (currentVideoType === "file" && videoRef.current) {
      videoRef.current.muted = !isMuted
      setIsMuted(!isMuted)
    } else if (currentVideoType === "youtube") {
      // YouTube player mute control would go here
      setIsMuted(!isMuted)
    }
  }

  // Toggle fullscreen
  const toggleFullscreen = () => {
    if (!videoContainerRef.current) return

    if (!isFullscreen) {
      if (videoContainerRef.current.requestFullscreen) {
        videoContainerRef.current.requestFullscreen()
      } else if ((videoContainerRef.current as any).webkitRequestFullscreen) {
        ;(videoContainerRef.current as any).webkitRequestFullscreen()
      } else if ((videoContainerRef.current as any).msRequestFullscreen) {
        ;(videoContainerRef.current as any).msRequestFullscreen()
      }
      setIsFullscreen(true)
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen()
      } else if ((document as any).webkitExitFullscreen) {
        ;(document as any).webkitExitFullscreen()
      } else if ((document as any).msExitFullscreen) {
        ;(document as any).msExitFullscreen()
      }
      setIsFullscreen(false)
    }
  }

  // Listen for fullscreen change events
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement)
    }

    document.addEventListener("fullscreenchange", handleFullscreenChange)
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange)
    document.addEventListener("mozfullscreenchange", handleFullscreenChange)
    document.addEventListener("MSFullscreenChange", handleFullscreenChange)

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange)
      document.removeEventListener("webkitfullscreenchange", handleFullscreenChange)
      document.removeEventListener("mozfullscreenchange", handleFullscreenChange)
      document.removeEventListener("MSFullscreenChange", handleFullscreenChange)
    }
  }, [])

  // Update progress bar for file videos
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const updateProgress = () => {
      setCurrentTime(video.currentTime)
      setDuration(video.duration)
    }

    video.addEventListener("timeupdate", updateProgress)
    video.addEventListener("loadedmetadata", updateProgress)

    return () => {
      video.removeEventListener("timeupdate", updateProgress)
      video.removeEventListener("loadedmetadata", updateProgress)
    }
  }, [currentVideoType])

  // Handle seeking when clicking on progress bar
  const handleProgressBarClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressBarRef.current || !videoRef.current) return

    const rect = progressBarRef.current.getBoundingClientRect()
    const pos = (e.clientX - rect.left) / rect.width
    const seekTime = pos * videoRef.current.duration

    videoRef.current.currentTime = seekTime
    setCurrentTime(seekTime)
  }

  // Format time for display (mm:ss)
  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60)
    const seconds = Math.floor(time % 60)
    return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`
  }

  // Set up screen video when stream changes
  useEffect(() => {
    if (screenStream && screenVideoRef.current) {
      screenVideoRef.current.srcObject = screenStream
      screenVideoRef.current.play()
    }
  }, [screenStream])

  // Set up file video when URL changes
  useEffect(() => {
    if (currentVideoUrl && videoRef.current) {
      videoRef.current.src = currentVideoUrl
      videoRef.current.play()
    }
  }, [currentVideoUrl])

  // Handle volume change
  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = Number.parseFloat(e.target.value)
    setVolume(newVolume)

    if (videoRef.current) {
      videoRef.current.volume = newVolume
    }

    setIsMuted(newVolume === 0)
  }

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

    if (currentVideoType === "screen" && screenStream) {
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

    if (currentVideoType === "file" && currentVideoUrl) {
      return (
        <div className="w-full h-full">
          <video
            ref={videoRef}
            className="w-full h-full object-contain"
            autoPlay
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
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

  if (!user) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-white flex items-center space-x-2">
          <Loader2 className="w-6 h-6 animate-spin" />
          <span>Loading...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-black overflow-auto">
      {/* Header - Hide in fullscreen */}
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
                  {mockParticipants.length} watching
                </span>
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
                <Button
                  onClick={handleUploadVideo}
                  disabled={isLoadingVideo}
                  className="bg-purple-600 hover:bg-purple-700 transition-all duration-300"
                >
                  <Upload className="mr-2 h-4 w-4" />
                  Upload HD
                </Button>
              </div>
            </div>
          </div>
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
                {/* Progress Bar */}
                {currentVideoType === "file" && (
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

                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    {/* Play/Pause Button */}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={togglePlayPause}
                      className="text-white hover:bg-white/20"
                      disabled={currentVideoType === "screen"}
                    >
                      {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                    </Button>

                    {/* Volume Controls */}
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

                    {/* Time Display */}
                    {currentVideoType === "file" && (
                      <div className="text-white text-sm">
                        {formatTime(currentTime)} / {formatTime(duration)}
                      </div>
                    )}
                  </div>

                  {/* Fullscreen Button */}
                  <Button variant="ghost" size="sm" onClick={toggleFullscreen} className="text-white hover:bg-white/20">
                    {isFullscreen ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}
                  </Button>
                </div>
              </div>
            )}

            {/* Chat Toggle Button in Fullscreen */}
            {isFullscreen && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsChatVisible(!isChatVisible)}
                className="absolute top-4 right-4 text-white bg-black/50 hover:bg-black/70"
              >
                {isChatVisible ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
              </Button>
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
                    onClick={() => setIsMicMuted(!isMicMuted)}
                  >
                    {isMicMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                  </Button>
                  <Button
                    variant={isVideoOn ? "secondary" : "destructive"}
                    size="sm"
                    onClick={() => setIsVideoOn(!isVideoOn)}
                  >
                    {isVideoOn ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
                  </Button>
                  <Button
                    variant={isInCall ? "destructive" : "default"}
                    size="sm"
                    onClick={() => setIsInCall(!isInCall)}
                    className={isInCall ? "" : "bg-green-600 hover:bg-green-700"}
                  >
                    {isInCall ? <PhoneOff className="h-4 w-4" /> : <Phone className="h-4 w-4" />}
                    {isInCall ? "Leave" : "Join"}
                  </Button>
                </div>
              </div>

              {/* Video Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {mockParticipants.map((participant) => (
                  <div key={participant.id} className="relative bg-gray-800 rounded-lg aspect-video overflow-hidden">
                    <div className="w-full h-full bg-gradient-to-br from-purple-600 to-blue-600 flex items-center justify-center">
                      <Avatar className="h-12 w-12">
                        <AvatarImage src={participant.avatar || "/placeholder.svg"} />
                        <AvatarFallback>
                          {participant.name
                            .split(" ")
                            .map((n) => n[0])
                            .join("")}
                        </AvatarFallback>
                      </Avatar>
                    </div>
                    <div className="absolute bottom-1 left-1 right-1">
                      <div className="bg-black/60 rounded px-2 py-1 text-xs text-white flex items-center justify-between">
                        <span className="truncate">{participant.name}</span>
                        {participant.isHost && <span className="text-xs bg-purple-600 px-1 rounded">Host</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Side - Chat (normal or transparent overlay in fullscreen) */}
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
                  .map((msg) => (
                    <div key={msg.id} className="flex space-x-2">
                      <Avatar className="h-8 w-8">
                        <AvatarImage src={msg.avatar || "/placeholder.svg"} />
                        <AvatarFallback className="text-xs">
                          {msg.user
                            .split(" ")
                            .map((n) => n[0])
                            .join("")}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1">
                        <div className="flex items-center space-x-2 mb-1">
                          <span className="text-sm font-medium text-white">{msg.user}</span>
                          <span className="text-xs text-gray-400">{msg.timestamp}</span>
                        </div>
                        <div className="flex items-center space-x-2">
                          <p className="text-sm text-gray-300">{msg.message}</p>
                          {msg.type === "voice" && (msg as any).audioUrl && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="p-1 h-6 w-6 hover:bg-purple-600"
                              onClick={() => playVoiceMessage((msg as any).audioUrl)}
                            >
                              <Play className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
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
                <Button
                  onClick={handleVoiceMessage}
                  variant={isRecording ? "destructive" : "secondary"}
                  size="sm"
                  className="px-3"
                >
                  <Mic className={`h-4 w-4 ${isRecording ? "animate-pulse" : ""}`} />
                </Button>
                <Button onClick={handleSendMessage} className="bg-purple-600 hover:bg-purple-700 px-3">
                  <Send className="h-4 w-4" />
                </Button>
              </div>
              {isRecording && (
                <div className="mt-2 text-center">
                  <span className="text-red-400 text-sm animate-pulse">🔴 Recording... Click mic to stop</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
