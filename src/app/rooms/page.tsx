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
import { ScrollArea } from "@/components/ui/scroll-area"
import { Play, Users, Lock, Globe, Crown, Plus, Search, LogOut, User, Loader2, X } from "lucide-react"
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
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [newRoom, setNewRoom] = useState({
    name: "",
    movie: "",
    isPrivate: false,
    roomKey: "",
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
      setIsCreateModalOpen(false)
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
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 overflow-auto">
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

              {/* Create Room Button */}
              <Button
                onClick={() => setIsCreateModalOpen(true)}
                className="bg-purple-600 hover:bg-purple-700 transition-all duration-300 hover:scale-105 hover-glow group"
              >
                <Plus className="mr-2 h-4 w-4 transition-transform duration-300 group-hover:rotate-90" />
                Create Room
              </Button>
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

      {/* Create Room Modal - Perfectly Centered */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4 overflow-auto">
          <div className="animate-scaleIn max-h-full">
            <Card className="w-full max-w-md bg-white shadow-2xl">
              <CardHeader className="border-b border-gray-200">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-gray-900">Create New Room</CardTitle>
                    <CardDescription className="text-gray-600">
                      Set up your movie room and invite others to join you.
                    </CardDescription>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsCreateModalOpen(false)}
                    className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full p-2"
                  >
                    <X className="h-5 w-5" />
                  </Button>
                </div>
              </CardHeader>

              <ScrollArea className="max-h-[70vh]">
                <CardContent className="p-6 space-y-4">
                  <div className="animate-fadeInUp delay-100">
                    <label htmlFor="room-name" className="text-gray-900 text-sm font-medium block mb-2">
                      Room Name
                    </label>
                    <Input
                      id="room-name"
                      placeholder="Enter room name"
                      value={newRoom.name}
                      onChange={(e) => setNewRoom({ ...newRoom, name: e.target.value })}
                      className="bg-white border-gray-300 text-gray-900 placeholder:text-gray-500 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    />
                  </div>

                  <div className="animate-fadeInUp delay-200">
                    <label htmlFor="movie-name" className="text-gray-900 text-sm font-medium block mb-2">
                      Movie Name
                    </label>
                    <Input
                      id="movie-name"
                      placeholder="Enter movie name"
                      value={newRoom.movie}
                      onChange={(e) => setNewRoom({ ...newRoom, movie: e.target.value })}
                      className="bg-white border-gray-300 text-gray-900 placeholder:text-gray-500 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    />
                  </div>

                  <div className="animate-fadeInUp delay-300">
                    <label className="text-gray-900 text-sm font-medium block mb-2">Room Type</label>
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        type="button"
                        variant={!newRoom.isPrivate ? "default" : "outline"}
                        onClick={() => setNewRoom({ ...newRoom, isPrivate: false, roomKey: "" })}
                        className="transition-all duration-300 hover:scale-105"
                      >
                        <Globe className="mr-2 h-4 w-4" />
                        Public
                      </Button>
                      <Button
                        type="button"
                        variant={newRoom.isPrivate ? "default" : "outline"}
                        onClick={() => setNewRoom({ ...newRoom, isPrivate: true })}
                        className="transition-all duration-300 hover:scale-105"
                      >
                        <Lock className="mr-2 h-4 w-4" />
                        Private
                      </Button>
                    </div>
                  </div>

                  {newRoom.isPrivate && (
                    <div className="animate-fadeIn">
                      <label htmlFor="room-key" className="text-gray-900 text-sm font-medium block mb-2">
                        Room Key
                      </label>
                      <Input
                        id="room-key"
                        placeholder="Enter room key"
                        value={newRoom.roomKey || ""}
                        onChange={(e) => setNewRoom({ ...newRoom, roomKey: e.target.value })}
                        className="bg-white border-gray-300 text-gray-900 placeholder:text-gray-500 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      />
                    </div>
                  )}

                  <Button
                    onClick={handleCreateRoom}
                    disabled={isLoading || !newRoom.name || !newRoom.movie || (newRoom.isPrivate && !newRoom.roomKey)}
                    className="w-full bg-purple-600 hover:bg-purple-700 transition-all duration-300 hover:scale-105 mt-6 disabled:opacity-50 disabled:cursor-not-allowed"
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
                </CardContent>
              </ScrollArea>
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}
