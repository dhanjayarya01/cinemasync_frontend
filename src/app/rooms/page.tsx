"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer"
import { Play, Users, Lock, Globe, Crown, Plus, Search, LogOut, User, Youtube, Upload, Loader2 } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"

const mockRooms = [
  {
    id: "1",
    name: "Marvel Movie Marathon",
    movie: "Avengers: Endgame",
    host: "John Doe",
    hostAvatar: "/placeholder.svg?height=40&width=40",
    participants: 12,
    isPrivate: false,
    isPaid: false,
    description: "Join us for an epic Marvel marathon! Starting with Endgame tonight.",
    category: "Action",
    mediaSource: "youtube",
  },
  {
    id: "2",
    name: "Horror Night 🎃",
    movie: "The Conjuring",
    host: "Sarah Wilson",
    hostAvatar: "/placeholder.svg?height=40&width=40",
    participants: 8,
    isPrivate: false,
    isPaid: true,
    description: "Scary movie night for horror enthusiasts. Bring your courage!",
    category: "Horror",
    mediaSource: "upload",
  },
]

export default function RoomsPage() {
  const [user, setUser] = useState<any>(null)
  const [searchTerm, setSearchTerm] = useState("")
  const [isCreateDrawerOpen, setIsCreateDrawerOpen] = useState(false)
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [newRoom, setNewRoom] = useState({
    name: "",
    movie: "",
    description: "",
    isPrivate: false,
    isPaid: false,
    category: "",
    mediaSource: "youtube",
    youtubeUrl: "",
    uploadedFile: null as File | null,
    uploadType: "live",
  })
  const router = useRouter()

  useEffect(() => {
    const userData = localStorage.getItem("user")
    if (!userData) {
      router.push("/auth")
      return
    }
    setUser(JSON.parse(userData))
  }, [router])

  const handleLogout = () => {
    localStorage.removeItem("user")
    router.push("/")
  }

  const filteredRooms = mockRooms.filter(
    (room) =>
      room.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      room.movie.toLowerCase().includes(searchTerm.toLowerCase()) ||
      room.category.toLowerCase().includes(searchTerm.toLowerCase()),
  )

  const handleCreateRoom = () => {
    setIsLoading(true)
    setTimeout(() => {
      console.log("Creating room:", newRoom)
      setIsCreateDrawerOpen(false)
      setIsLoading(false)
      router.push(`/theater/new-room`)
    }, 1000)
  }

  const handleJoinRoom = (roomId: string) => {
    router.push(`/theater/${roomId}`)
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 flex items-center justify-center">
        <div className="text-white flex items-center space-x-2">
          <Loader2 className="w-6 h-6 animate-spin" />
          <span className="loading-dots">Loading</span>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 overflow-hidden">
      {/* Header */}
      <header className="container mx-auto px-4 py-6 relative z-10">
        <nav className="flex items-center justify-between animate-fadeInDown">
          <Link href="/" className="flex items-center space-x-2 group">
            <Play className="h-8 w-8 text-purple-400 transition-all duration-300 group-hover:scale-110 group-hover:rotate-12" />
            <span className="text-2xl font-bold text-white transition-colors duration-300 group-hover:text-purple-300">
              CinemaSync
            </span>
          </Link>
          <div className="flex items-center space-x-4">
            {/* User Menu Drawer */}
            <Drawer open={isUserMenuOpen} onOpenChange={setIsUserMenuOpen}>
              <DrawerTrigger asChild>
                <Button variant="ghost" className="relative h-10 w-10 rounded-full hover-lift">
                  <Avatar className="h-8 w-8 transition-all duration-300 hover:scale-110">
                    <AvatarImage src={user.avatar || "/placeholder.svg"} alt={user.name} />
                    <AvatarFallback className="bg-purple-600 text-white">
                      {user.name
                        .split(" ")
                        .map((n: string) => n[0])
                        .join("")}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DrawerTrigger>
              <DrawerContent className="bg-gray-900 border-gray-700">
                <DrawerHeader>
                  <DrawerTitle className="text-white">{user.name}</DrawerTitle>
                  <DrawerDescription className="text-gray-300">{user.email}</DrawerDescription>
                </DrawerHeader>
                <div className="p-4 space-y-2">
                  <Button variant="ghost" className="w-full justify-start text-white hover:bg-gray-800">
                    <User className="mr-2 h-4 w-4" />
                    Profile
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={handleLogout}
                    className="w-full justify-start text-white hover:bg-gray-800"
                  >
                    <LogOut className="mr-2 h-4 w-4" />
                    Log out
                  </Button>
                </div>
              </DrawerContent>
            </Drawer>
          </div>
        </nav>
      </header>

      <div className="container mx-auto px-4 py-8 relative z-10">
        <div className="flex flex-col lg:flex-row gap-8">
          {/* Left Side - Room List */}
          <div className="flex-1">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 animate-fadeInUp">
              <h1 className="text-3xl font-bold text-white mb-4 sm:mb-0">Movie Rooms</h1>

              {/* Create Room Drawer */}
              <Drawer open={isCreateDrawerOpen} onOpenChange={setIsCreateDrawerOpen}>
                <DrawerTrigger asChild>
                  <Button className="bg-purple-600 hover:bg-purple-700 transition-all duration-300 hover:scale-105 hover-glow group">
                    <Plus className="mr-2 h-4 w-4 transition-transform duration-300 group-hover:rotate-90" />
                    Create Room
                  </Button>
                </DrawerTrigger>
                <DrawerContent className="bg-gray-900 border-gray-700 max-h-[90vh]">
                  <DrawerHeader>
                    <DrawerTitle className="text-white">Create New Room</DrawerTitle>
                    <DrawerDescription className="text-gray-300">
                      Set up your movie room and invite others to join you.
                    </DrawerDescription>
                  </DrawerHeader>
                  <div className="p-4 space-y-4 overflow-y-auto">
                    <div className="animate-fadeInUp delay-100">
                      <label htmlFor="room-name" className="text-white text-sm font-medium block mb-2">
                        Room Name
                      </label>
                      <Input
                        id="room-name"
                        placeholder="Enter room name"
                        value={newRoom.name}
                        onChange={(e) => setNewRoom({ ...newRoom, name: e.target.value })}
                        className="bg-gray-800 border-gray-600 text-white placeholder:text-gray-400 transition-all duration-300 focus:scale-105"
                      />
                    </div>

                    <div className="animate-fadeInUp delay-200">
                      <label htmlFor="movie-name" className="text-white text-sm font-medium block mb-2">
                        Movie Name
                      </label>
                      <Input
                        id="movie-name"
                        placeholder="Enter movie name"
                        value={newRoom.movie}
                        onChange={(e) => setNewRoom({ ...newRoom, movie: e.target.value })}
                        className="bg-gray-800 border-gray-600 text-white placeholder:text-gray-400 transition-all duration-300 focus:scale-105"
                      />
                    </div>

                    <div className="animate-fadeInUp delay-300">
                      <label htmlFor="category" className="text-white text-sm font-medium block mb-2">
                        Category
                      </label>
                      <Input
                        id="category"
                        placeholder="e.g., Action, Comedy, Horror, Drama"
                        value={newRoom.category}
                        onChange={(e) => setNewRoom({ ...newRoom, category: e.target.value })}
                        className="bg-gray-800 border-gray-600 text-white placeholder:text-gray-400 transition-all duration-300 focus:scale-105"
                      />
                    </div>

                    {/* Media Source Selection */}
                    <div className="animate-fadeInUp delay-400">
                      <label className="text-white text-sm font-medium block mb-2">Media Source</label>
                      <div className="grid grid-cols-2 gap-2">
                        <Button
                          type="button"
                          variant={newRoom.mediaSource === "youtube" ? "default" : "outline"}
                          onClick={() => setNewRoom({ ...newRoom, mediaSource: "youtube" })}
                          className="transition-all duration-300 hover:scale-105"
                        >
                          <Youtube className="mr-2 h-4 w-4" />
                          YouTube
                        </Button>
                        <Button
                          type="button"
                          variant={newRoom.mediaSource === "upload" ? "default" : "outline"}
                          onClick={() => setNewRoom({ ...newRoom, mediaSource: "upload" })}
                          className="transition-all duration-300 hover:scale-105"
                        >
                          <Upload className="mr-2 h-4 w-4" />
                          Upload
                        </Button>
                      </div>

                      {newRoom.mediaSource === "youtube" && (
                        <div className="mt-3 animate-fadeIn">
                          <label htmlFor="youtube-url" className="text-white text-sm font-medium block mb-2">
                            YouTube URL
                          </label>
                          <Input
                            id="youtube-url"
                            placeholder="https://www.youtube.com/watch?v=..."
                            value={newRoom.youtubeUrl}
                            onChange={(e) => setNewRoom({ ...newRoom, youtubeUrl: e.target.value })}
                            className="bg-gray-800 border-gray-600 text-white placeholder:text-gray-400 transition-all duration-300 focus:scale-105"
                          />
                        </div>
                      )}

                      {newRoom.mediaSource === "upload" && (
                        <div className="space-y-3 mt-3 animate-fadeIn">
                          <div>
                            <label className="text-white text-sm font-medium block mb-2">Upload Options</label>
                            <div className="grid grid-cols-2 gap-2">
                              <Button
                                type="button"
                                variant={newRoom.uploadType === "live" ? "default" : "outline"}
                                onClick={() => setNewRoom({ ...newRoom, uploadType: "live" })}
                                className="text-sm transition-all duration-300 hover:scale-105"
                              >
                                Watch Live
                              </Button>
                              <Button
                                type="button"
                                variant={newRoom.uploadType === "later" ? "default" : "outline"}
                                onClick={() => setNewRoom({ ...newRoom, uploadType: "later" })}
                                className="text-sm transition-all duration-300 hover:scale-105"
                              >
                                Process Later
                              </Button>
                            </div>
                          </div>

                          <div>
                            <label htmlFor="file-upload" className="text-white text-sm font-medium block mb-2">
                              Select Video File
                            </label>
                            <Input
                              id="file-upload"
                              type="file"
                              accept="video/*"
                              onChange={(e) =>
                                setNewRoom({
                                  ...newRoom,
                                  uploadedFile: e.target.files?.[0] || null,
                                })
                              }
                              className="bg-gray-800 border-gray-600 text-white transition-all duration-300 hover:scale-105"
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="animate-fadeInUp delay-500">
                      <label htmlFor="description" className="text-white text-sm font-medium block mb-2">
                        Description
                      </label>
                      <textarea
                        id="description"
                        placeholder="Describe your movie room"
                        value={newRoom.description}
                        onChange={(e) => setNewRoom({ ...newRoom, description: e.target.value })}
                        className="w-full min-h-[80px] px-3 py-2 bg-gray-800 border border-gray-600 rounded-md text-white placeholder:text-gray-400 transition-all duration-300 focus:scale-105 resize-none"
                      />
                    </div>

                    <div className="flex items-center justify-between animate-fadeInUp delay-600">
                      <div className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          id="private-room"
                          checked={newRoom.isPrivate}
                          onChange={(e) => setNewRoom({ ...newRoom, isPrivate: e.target.checked })}
                          className="w-4 h-4 text-purple-600 bg-gray-800 border-gray-600 rounded focus:ring-purple-500"
                        />
                        <label htmlFor="private-room" className="text-white text-sm font-medium">
                          Private Room
                        </label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          id="paid-room"
                          checked={newRoom.isPaid}
                          onChange={(e) => setNewRoom({ ...newRoom, isPaid: e.target.checked })}
                          className="w-4 h-4 text-purple-600 bg-gray-800 border-gray-600 rounded focus:ring-purple-500"
                        />
                        <label htmlFor="paid-room" className="text-white text-sm font-medium">
                          Paid Room
                        </label>
                      </div>
                    </div>

                    <Button
                      onClick={handleCreateRoom}
                      disabled={isLoading}
                      className="w-full bg-purple-600 hover:bg-purple-700 transition-all duration-300 hover:scale-105 animate-fadeInUp delay-700"
                    >
                      {isLoading ? (
                        <div className="flex items-center space-x-2">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Creating Room...</span>
                        </div>
                      ) : (
                        "Create Room"
                      )}
                    </Button>
                  </div>
                </DrawerContent>
              </Drawer>
            </div>

            {/* Search */}
            <div className="relative mb-6 animate-fadeInUp delay-200">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
              <Input
                placeholder="Search rooms, movies, or categories..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 bg-white/10 border-white/20 text-white placeholder:text-gray-400 transition-all duration-300 focus:scale-105 focus:bg-white/15"
              />
            </div>

            {/* Room Cards */}
            <div className="space-y-4">
              {filteredRooms.map((room, index) => (
                <Card
                  key={room.id}
                  className="bg-white/10 backdrop-blur-sm border-white/20 text-white hover:bg-white/15 transition-all duration-500 hover:scale-105 hover-lift animate-fadeInUp group cursor-pointer"
                  style={{ animationDelay: `${index * 100}ms` }}
                >
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <CardTitle className="text-lg transition-colors duration-300 group-hover:text-purple-300">
                            {room.name}
                          </CardTitle>
                          {room.isPrivate && (
                            <Lock className="h-4 w-4 text-yellow-400 transition-all duration-300 group-hover:scale-110" />
                          )}
                          {!room.isPrivate && (
                            <Globe className="h-4 w-4 text-green-400 transition-all duration-300 group-hover:scale-110" />
                          )}
                          {room.isPaid && (
                            <Crown className="h-4 w-4 text-purple-400 transition-all duration-300 group-hover:scale-110 group-hover:rotate-12" />
                          )}
                        </div>
                        <CardDescription className="text-gray-300 group-hover:text-gray-200 transition-colors duration-300">
                          <span className="font-medium text-purple-300">Now Playing:</span> {room.movie}
                        </CardDescription>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Avatar className="h-8 w-8 transition-all duration-300 group-hover:scale-110">
                          <AvatarImage src={room.hostAvatar || "/placeholder.svg"} />
                          <AvatarFallback>
                            {room.host
                              .split(" ")
                              .map((n) => n[0])
                              .join("")}
                          </AvatarFallback>
                        </Avatar>
                        <div className="text-sm">
                          <div className="text-gray-300 group-hover:text-gray-200 transition-colors duration-300">
                            {room.host}
                          </div>
                          <div className="text-xs text-gray-400">Host</div>
                        </div>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-gray-300 mb-4 group-hover:text-gray-200 transition-colors duration-300">
                      {room.description}
                    </p>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-4">
                        <div className="flex items-center space-x-1">
                          <Users className="h-4 w-4 text-gray-400 transition-all duration-300 group-hover:scale-110" />
                          <span className="text-sm text-gray-300 group-hover:text-gray-200 transition-colors duration-300">
                            {room.participants} watching
                          </span>
                        </div>
                        <span className="px-2 py-1 bg-purple-600/20 text-purple-300 text-xs rounded-full transition-all duration-300 hover:scale-105">
                          {room.category}
                        </span>
                        <span className="px-2 py-1 bg-blue-600/20 text-blue-300 text-xs rounded-full transition-all duration-300 hover:scale-105">
                          {room.mediaSource === "youtube" ? "YouTube" : "Upload"}
                        </span>
                      </div>
                      <Button
                        onClick={() => handleJoinRoom(room.id)}
                        className="bg-purple-600 hover:bg-purple-700 transition-all duration-300 hover:scale-105 hover-glow group/button"
                      >
                        <Play className="mr-2 h-4 w-4 transition-transform duration-300 group-hover/button:scale-110" />
                        Join Room
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          {/* Right Side - Quick Actions */}
          <div className="lg:w-80">
            <Card className="bg-white/10 backdrop-blur-sm border-white/20 text-white hover-lift animate-slideInRight">
              <CardHeader>
                <CardTitle>Quick Join</CardTitle>
                <CardDescription className="text-gray-300">Have a room code? Join directly</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Input
                  placeholder="Enter room code"
                  className="bg-white/10 border-white/20 text-white placeholder:text-gray-400 transition-all duration-300 focus:scale-105"
                />
                <Button className="w-full bg-blue-600 hover:bg-blue-700 transition-all duration-300 hover:scale-105 hover-glow">
                  Join with Code
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
