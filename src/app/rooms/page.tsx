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
import { getToken, logout } from "@/lib/auth"

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000'

interface Room {
  id: string
  name: string
  description: string
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
  isPrivate: boolean
  maxParticipants: number
  currentParticipants: number
  status: string
  tags: string[]
  createdAt: string
}

export default function RoomsPage() {
  const [user, setUser] = useState<any>(null)
  const [rooms, setRooms] = useState<Room[]>([])
  const [searchTerm, setSearchTerm] = useState("")
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingRooms, setIsLoadingRooms] = useState(true)
  const [newRoom, setNewRoom] = useState({
    name: "",
    description: "",
    movieName: "",
    movieYear: "",
    movieGenre: "",
    isPrivate: false,
    maxParticipants: 50,
    tags: [] as string[]
  })
  const [roomCode, setRoomCode] = useState("")
  const [isJoining, setIsJoining] = useState(false)
  const router = useRouter()

  useEffect(() => {
    const userData = localStorage.getItem("user")
    const token = getToken()

    if (!userData || !token) {
      router.push("/auth")
      return
    }

    setUser(JSON.parse(userData))
    fetchRooms()
  }, [router])

  const fetchRooms = async () => {
    try {
      setIsLoadingRooms(true)
      const token = getToken()
      const headers: any = {}
      if (token) {
        headers.Authorization = `Bearer ${token}`
      }

      const response = await fetch(`${API_BASE_URL}/api/rooms`, { headers })
      const data = await response.json()

      if (data.success) {
        setRooms(data.rooms)
      }
    } catch (error) {
      console.error('Failed to fetch rooms:', error)
    } finally {
      setIsLoadingRooms(false)
    }
  }

  const handleLogout = () => {
    logout()
    router.push("/")
  }

  const filteredRooms = rooms
    .filter(
      (room) =>
        room.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        room.movie.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        room.tags.some(tag => tag.toLowerCase().includes(searchTerm.toLowerCase()))
    )
    .sort((a, b) => {
      const aIsOwner = user && a.host.id === user.id;
      const bIsOwner = user && b.host.id === user.id;

      if (aIsOwner && !bIsOwner) return -1;
      if (!aIsOwner && bIsOwner) return 1;

      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    })

  const handleCreateRoom = async () => {
    try {
      setIsLoading(true)
      const token = getToken()

      const response = await fetch(`${API_BASE_URL}/api/rooms`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          name: newRoom.name,
          description: newRoom.description,
          movieName: newRoom.movieName,
          movieYear: newRoom.movieYear ? parseInt(newRoom.movieYear) : undefined,
          movieGenre: newRoom.movieGenre,
          isPrivate: newRoom.isPrivate,
          maxParticipants: newRoom.maxParticipants,
          tags: newRoom.tags
        })
      })

      const data = await response.json()

      if (data.success) {
        setIsCreateModalOpen(false)
        setNewRoom({
          name: "",
          description: "",
          movieName: "",
          movieYear: "",
          movieGenre: "",
          isPrivate: false,
          maxParticipants: 50,
          tags: []
        })
        router.push(`/theater/${data.room.id}`)
      } else {
        alert(data.error || 'Failed to create room')
      }
    } catch (error) {
      console.error('Failed to create room:', error)
      alert('Failed to create room')
    } finally {
      setIsLoading(false)
    }
  }

  const handleJoinRoom = (roomId: string) => {
    router.push(`/theater/${roomId}`)
  }

  const handleQuickJoin = async () => {
    if (!roomCode.trim()) return

    setIsJoining(true)
    try {
      const normalizedRoomCode = roomCode.trim().toLowerCase()
      router.push(`/theater/${normalizedRoomCode}`)
    } catch (error) {
      console.error('Failed to join room:', error)
      alert('Failed to join room. Please check the room code.')
    } finally {
      setIsJoining(false)
    }
  }

  const handleRoomCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Auto-uppercase the room code for better UX
    setRoomCode(e.target.value.toUpperCase())
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
                    <AvatarImage src={user.picture || "/placeholder.svg"} alt={user.name} />
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

      <div className="container mx-auto px-4 py-4 lg:py-8 relative z-10">
        {/* Mobile Quick Actions - Top on mobile */}
        <div className="lg:hidden mb-6">
          <Card className="bg-white/10 backdrop-blur-sm border-white/20 text-white">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Quick Join</CardTitle>
              <CardDescription className="text-gray-300 text-sm">Have a room code? Join directly</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input
                placeholder="Enter room code (e.g. ABC123)"
                value={roomCode}
                onChange={handleRoomCodeChange}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && roomCode.trim()) {
                    handleQuickJoin()
                  }
                }}
                className="bg-white/10 border-white/20 text-white placeholder:text-gray-400 uppercase"
              />
              <Button
                onClick={handleQuickJoin}
                disabled={!roomCode.trim() || isJoining}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
              >
                {isJoining ? (
                  <div className="flex items-center space-x-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Joining...</span>
                  </div>
                ) : (
                  "Join with Code"
                )}
              </Button>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col lg:flex-row gap-6 lg:gap-8">
          {/* Left Side - Room List */}
          <div className="flex-1">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 lg:mb-6">
              <h1 className="text-2xl lg:text-3xl font-bold text-white mb-3 sm:mb-0">Movie Rooms</h1>

              {/* Create Room Button */}
              <Button
                onClick={() => setIsCreateModalOpen(true)}
                className="w-full sm:w-auto bg-purple-600 hover:bg-purple-700 transition-all duration-300 hover:scale-105 hover-glow group"
              >
                <Plus className="mr-2 h-4 w-4 transition-transform duration-300 group-hover:rotate-90" />
                Create Room
              </Button>
            </div>

            {/* Search */}
            <div className="relative mb-4 lg:mb-6">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
              <Input
                placeholder="Search rooms, movies, or categories..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 bg-white/10 border-white/20 text-white placeholder:text-gray-400 transition-all duration-300 focus:bg-white/15"
              />
            </div>

            {/* Room Cards */}
            <div className="space-y-4">
              {isLoadingRooms ? (
                <div className="flex items-center justify-center py-12">
                  <div className="text-white flex items-center space-x-2">
                    <Loader2 className="w-6 h-6 animate-spin" />
                    <span>Loading rooms...</span>
                  </div>
                </div>
              ) : filteredRooms.length === 0 ? (
                <div className="text-center py-12">
                  <div className="text-gray-400 mb-4">No rooms found</div>
                  <Button
                    onClick={() => setIsCreateModalOpen(true)}
                    className="bg-purple-600 hover:bg-purple-700"
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Create First Room
                  </Button>
                </div>
              ) : (
                filteredRooms.map((room, index) => {
                  const isOwner = user && room.host.id === user.id;
                  return (
                    <Card
                      key={room.id}
                      className="bg-white/10 backdrop-blur-sm border-white/20 text-white hover:bg-white/15 transition-all duration-300 hover:scale-[1.02] group cursor-pointer"
                    >
                      <CardHeader className="pb-3">
                        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-2 flex-wrap">
                              <CardTitle className="text-base lg:text-lg transition-colors duration-300 group-hover:text-purple-300 truncate">
                                {room.name}
                              </CardTitle>
                              {room.isPrivate ? (
                                <div className="flex items-center gap-1">
                                  <Lock className="h-4 w-4 text-orange-400" />
                                  <span className="text-xs text-orange-400 font-medium">Private</span>
                                </div>
                              ) : (
                                <div className="flex items-center gap-1">
                                  <Globe className="h-4 w-4 text-green-400" />
                                  <span className="text-xs text-green-400 font-medium">Public</span>
                                </div>
                              )}
                              {isOwner && (
                                <div className="flex items-center gap-1">
                                  <Crown className="h-3 w-3 text-yellow-400" />
                                  <span className="text-xs text-yellow-400 font-medium">Owner</span>
                                </div>
                              )}
                            </div>
                            <CardDescription className="text-gray-300 group-hover:text-gray-200 transition-colors duration-300 text-sm">
                              <span className="font-medium text-purple-300">Now Playing:</span> {room.movie.name}
                              {room.movie.year && ` (${room.movie.year})`}
                            </CardDescription>
                          </div>
                          <div className="flex items-center space-x-2 flex-shrink-0">
                            <Avatar className="h-8 w-8 transition-all duration-300 group-hover:scale-110">
                              <AvatarImage src={room.host.picture || "/placeholder.svg"} />
                              <AvatarFallback className="text-xs">
                                {room.host.name
                                  .split(" ")
                                  .map((n) => n[0])
                                  .join("")}
                              </AvatarFallback>
                            </Avatar>
                            <div className="text-sm hidden sm:block">
                              <div className="text-gray-300 group-hover:text-gray-200 transition-colors duration-300 truncate max-w-20">
                                {room.host.name}
                              </div>
                              <div className="text-xs text-gray-400">Host</div>
                            </div>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="pt-0">
                        {room.description && (
                          <p className="text-gray-300 mb-3 group-hover:text-gray-200 transition-colors duration-300 text-sm line-clamp-2">
                            {room.description}
                          </p>
                        )}
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div className="flex items-center gap-2 flex-wrap">
                            <div className="flex items-center space-x-1">
                              <Users className="h-4 w-4 text-gray-400" />
                              <span className="text-sm text-gray-300 group-hover:text-gray-200 transition-colors duration-300">
                                {room.currentParticipants}/{room.maxParticipants}
                              </span>
                            </div>
                            {room.movie.genre && (
                              <span className="px-2 py-1 bg-purple-600/20 text-purple-300 text-xs rounded-full">
                                {room.movie.genre}
                              </span>
                            )}
                            <span className="px-2 py-1 bg-blue-600/20 text-blue-300 text-xs rounded-full">
                              {room.status}
                            </span>
                          </div>
                          <Button
                            onClick={() => handleJoinRoom(room.id)}
                            className="w-full sm:w-auto bg-purple-600 hover:bg-purple-700 transition-all duration-300 hover:scale-105 group/button"
                            size="sm"
                          >
                            <Play className="mr-2 h-4 w-4 transition-transform duration-300 group-hover/button:scale-110" />
                            Join Room
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Side - Quick Actions (Desktop only) */}
          <div className="hidden lg:block lg:w-80">
            <Card className="bg-white/10 backdrop-blur-sm border-white/20 text-white sticky top-4">
              <CardHeader>
                <CardTitle>Quick Join</CardTitle>
                <CardDescription className="text-gray-300">Have a room code? Join directly</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Input
                  placeholder="Enter room code (e.g. ABC123)"
                  value={roomCode}
                  onChange={handleRoomCodeChange}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && roomCode.trim()) {
                      handleQuickJoin()
                    }
                  }}
                  className="bg-white/10 border-white/20 text-white placeholder:text-gray-400 transition-all duration-300 focus:bg-white/15 uppercase"
                />
                <Button
                  onClick={handleQuickJoin}
                  disabled={!roomCode.trim() || isJoining}
                  className="w-full bg-blue-600 hover:bg-blue-700 transition-all duration-300 hover:scale-105 disabled:opacity-50"
                >
                  {isJoining ? (
                    <div className="flex items-center space-x-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Joining...</span>
                    </div>
                  ) : (
                    "Join with Code"
                  )}
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Create Room Modal - Fully Responsive */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 bg-black/70 flex items-start sm:items-center justify-center z-50 p-0 sm:p-4">
          <div className="w-full h-full sm:h-auto sm:max-w-lg sm:max-h-[90vh] flex flex-col">
            <Card className="w-full h-full sm:h-auto bg-white shadow-2xl rounded-none sm:rounded-lg flex flex-col">
              <CardHeader className="border-b border-gray-200 p-4 sm:p-6 flex-shrink-0">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-gray-900 text-xl sm:text-2xl">Create New Room</CardTitle>
                    <CardDescription className="text-gray-600 text-sm sm:text-base mt-1">
                      Set up your movie room and invite others to join you.
                    </CardDescription>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsCreateModalOpen(false)}
                    className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full p-2 flex-shrink-0 ml-2"
                  >
                    <X className="h-5 w-5" />
                  </Button>
                </div>
              </CardHeader>

              <div className="flex-1 overflow-y-auto">
                <CardContent className="p-4 sm:p-6 space-y-4 sm:space-y-6">
                  <div>
                    <label htmlFor="room-name" className="text-gray-900 text-sm sm:text-base font-medium block mb-2 sm:mb-3">
                      Room Name *
                    </label>
                    <Input
                      id="room-name"
                      placeholder="Enter room name"
                      value={newRoom.name}
                      onChange={(e) => setNewRoom({ ...newRoom, name: e.target.value })}
                      className="bg-white border-gray-300 text-gray-900 placeholder:text-gray-500 focus:ring-2 focus:ring-purple-500 focus:border-transparent h-12 text-base"
                    />
                  </div>

                  <div>
                    <label htmlFor="room-description" className="text-gray-900 text-sm sm:text-base font-medium block mb-2 sm:mb-3">
                      Description
                    </label>
                    <Input
                      id="room-description"
                      placeholder="Enter room description (optional)"
                      value={newRoom.description}
                      onChange={(e) => setNewRoom({ ...newRoom, description: e.target.value })}
                      className="bg-white border-gray-300 text-gray-900 placeholder:text-gray-500 focus:ring-2 focus:ring-purple-500 focus:border-transparent h-12 text-base"
                    />
                  </div>

                  <div>
                    <label htmlFor="movie-name" className="text-gray-900 text-sm sm:text-base font-medium block mb-2 sm:mb-3">
                      Movie Name *
                    </label>
                    <Input
                      id="movie-name"
                      placeholder="Enter movie name"
                      value={newRoom.movieName}
                      onChange={(e) => setNewRoom({ ...newRoom, movieName: e.target.value })}
                      className="bg-white border-gray-300 text-gray-900 placeholder:text-gray-500 focus:ring-2 focus:ring-purple-500 focus:border-transparent h-12 text-base"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="movie-year" className="text-gray-900 text-sm sm:text-base font-medium block mb-2 sm:mb-3">
                        Movie Year
                      </label>
                      <Input
                        id="movie-year"
                        placeholder="2024"
                        type="number"
                        value={newRoom.movieYear}
                        onChange={(e) => setNewRoom({ ...newRoom, movieYear: e.target.value })}
                        className="bg-white border-gray-300 text-gray-900 placeholder:text-gray-500 focus:ring-2 focus:ring-purple-500 focus:border-transparent h-12 text-base"
                      />
                    </div>
                    <div>
                      <label htmlFor="movie-genre" className="text-gray-900 text-sm sm:text-base font-medium block mb-2 sm:mb-3">
                        Genre
                      </label>
                      <Input
                        id="movie-genre"
                        placeholder="Action, Drama, etc."
                        value={newRoom.movieGenre}
                        onChange={(e) => setNewRoom({ ...newRoom, movieGenre: e.target.value })}
                        className="bg-white border-gray-300 text-gray-900 placeholder:text-gray-500 focus:ring-2 focus:ring-purple-500 focus:border-transparent h-12 text-base"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-gray-900 text-sm sm:text-base font-medium block mb-3 sm:mb-4">Room Type</label>
                    <div className="grid grid-cols-2 gap-3 sm:gap-4">
                      <Button
                        type="button"
                        variant={!newRoom.isPrivate ? "default" : "outline"}
                        onClick={() => setNewRoom({ ...newRoom, isPrivate: false })}
                        className="h-14 sm:h-16 transition-all duration-300 hover:scale-105 text-base sm:text-lg"
                      >
                        <Globe className="mr-2 h-5 w-5" />
                        <span>Public</span>
                      </Button>
                      <Button
                        type="button"
                        variant={newRoom.isPrivate ? "default" : "outline"}
                        onClick={() => setNewRoom({ ...newRoom, isPrivate: true })}
                        className="h-14 sm:h-16 transition-all duration-300 hover:scale-105 text-base sm:text-lg"
                      >
                        <Lock className="mr-2 h-5 w-5" />
                        <span>Private</span>
                      </Button>
                    </div>
                  </div>

                  <div className="sticky bottom-0 bg-white pt-4 sm:pt-6 border-t sm:border-t-0">
                    <Button
                      onClick={handleCreateRoom}
                      disabled={isLoading || !newRoom.name || !newRoom.movieName}
                      className="w-full bg-purple-600 hover:bg-purple-700 transition-all duration-300 hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed h-12 sm:h-14 text-base sm:text-lg font-medium"
                    >
                      {isLoading ? (
                        <div className="flex items-center space-x-2">
                          <Loader2 className="w-5 h-5 animate-spin" />
                          <span>Creating Room...</span>
                        </div>
                      ) : (
                        "Create Room"
                      )}
                    </Button>
                  </div>
                </CardContent>
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}
