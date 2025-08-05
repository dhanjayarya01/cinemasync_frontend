"use client"

import { useState, useEffect } from "react"
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
  },
  {
    id: 2,
    user: "Sarah Wilson",
    avatar: "/placeholder.svg?height=32&width=32",
    message: "I love this scene!",
    timestamp: "10:32 PM",
    isPrivate: false,
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
  const [isPlaying, setIsPlaying] = useState(true)
  const [isMuted, setIsMuted] = useState(false)
  const [message, setMessage] = useState("")
  const [messages, setMessages] = useState(mockMessages)
  const [isMicMuted, setIsMicMuted] = useState(false)
  const [isVideoOn, setIsVideoOn] = useState(true)
  const [isInCall, setIsInCall] = useState(false)
  const [activeTab, setActiveTab] = useState("group")
  const router = useRouter()

  useEffect(() => {
    const userData = localStorage.getItem("user")
    if (!userData) {
      router.push("/auth")
      return
    }
    setUser(JSON.parse(userData))
  }, [router])

  const handleSendMessage = () => {
    if (message.trim()) {
      const newMessage = {
        id: messages.length + 1,
        user: user?.name || "You",
        avatar: user?.avatar || "/placeholder.svg?height=32&width=32",
        message: message,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        isPrivate: activeTab === "private",
      }
      setMessages([...messages, newMessage])
      setMessage("")
    }
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-white">Loading...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-black">
      {/* Header */}
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
            <Button variant="outline" size="sm" className="text-white border-gray-600 hover:bg-gray-800 bg-transparent">
              <Settings className="mr-2 h-4 w-4" />
              Settings
            </Button>
          </div>
        </div>
      </header>

      <div className="flex h-[calc(100vh-73px)]">
        {/* Left Side - Video Player */}
        <div className="flex-1 flex flex-col bg-black">
          {/* Video Container */}
          <div className="flex-1 relative bg-gray-900 flex items-center justify-center">
            <div className="w-full h-full bg-gradient-to-br from-gray-800 to-gray-900 flex items-center justify-center">
              <div className="text-center">
                <div className="w-32 h-32 bg-purple-600 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Play className="h-16 w-16 text-white" />
                </div>
                <h3 className="text-2xl font-bold text-white mb-2">Avengers: Endgame</h3>
                <p className="text-gray-400">Movie is playing...</p>
              </div>
            </div>

            {/* Video Controls */}
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-4">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsPlaying(!isPlaying)}
                    className="text-white hover:bg-white/20"
                  >
                    {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsMuted(!isMuted)}
                    className="text-white hover:bg-white/20"
                  >
                    {isMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
                  </Button>
                </div>
                <Button variant="ghost" size="sm" className="text-white hover:bg-white/20">
                  <Maximize className="h-5 w-5" />
                </Button>
              </div>
            </div>
          </div>

          {/* Video Chat Section */}
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
        </div>

        {/* Right Side - Chat */}
        <div className="w-80 bg-gray-900 border-l border-gray-800 flex flex-col">
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
                className="bg-gray-800 border-gray-700 text-white placeholder:text-gray-400"
              />
              <Button onClick={handleSendMessage} className="bg-purple-600 hover:bg-purple-700">
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
