"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Play, Pause, Volume2, VolumeX, Maximize, Monitor, Loader2, StopCircle,
  Crown, Settings, Users, Send, Video, Youtube, AlertCircle
} from "lucide-react";

import { socketManager, type SocketMessage, type Participant, type RoomInfo } from "@/lib/socket";
import { webrtcManager } from "@/lib/webrtc";
import { getToken, getCurrentUser } from "@/lib/auth";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

export default function TheaterPage({ params }: { params: Promise<{ roomId: string }> }) {
  const router = useRouter();

  const [user, setUser] = useState<any>(null);
  const [roomInfo, setRoomInfo] = useState<RoomInfo | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [messages, setMessages] = useState<SocketMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const ytContainerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const videoContainerRef = useRef<HTMLDivElement | null>(null);
  const progressBarRef = useRef<HTMLDivElement | null>(null);

  const [currentVideoType, setCurrentVideoType] = useState<"youtube" | "screen" | "file" | null>(null);
  const [selectedVideoFile, setSelectedVideoFile] = useState<File | null>(null);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [youtubeVideoId, setYoutubeVideoId] = useState<string | null>(null);
  const [isLoadingVideo, setIsLoadingVideo] = useState(false);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const [isChatVisible] = useState(true);
  const [message, setMessage] = useState("");
  const [unreadCount, setUnreadCount] = useState(0);
  const [showResumeOverlay, setShowResumeOverlay] = useState(false);

  const [webrtcStatus, setWebrtcStatus] = useState<any>(null);
  const [showConnectedText, setShowConnectedText] = useState(false);

  const isHost = user?.id === roomInfo?.host?.id;

  const extractYouTubeId = (url: string): string | null => {
    if (!url) return null;
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    return match && match[2] && match[2].length === 11 ? match[2] : null;
  };

  const ytApiLoadedRef = useRef<Promise<void> | null>(null);
  const loadYouTubeAPI = useCallback(() => {
    if (ytApiLoadedRef.current) return ytApiLoadedRef.current;
    ytApiLoadedRef.current = new Promise((resolve) => {
      if ((window as any).YT && (window as any).YT.Player) {
        resolve();
        return;
      }
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      (window as any).onYouTubeIframeAPIReady = () => resolve();
      document.head.appendChild(tag);
    });
    return ytApiLoadedRef.current;
  }, []);

  const getYTPlayer = () => (ytContainerRef.current as any)?._ytPlayer || null;
  const setYTPlayer = (p: any) => { if (ytContainerRef.current) (ytContainerRef.current as any)._ytPlayer = p; };

  const createYouTubePlayer = useCallback(async (videoId: string, start = 0, autoplay = false, muted = false) => {
    await loadYouTubeAPI();
    if (!ytContainerRef.current) return null;
    const prev = getYTPlayer();
    try { prev?.destroy?.(); } catch {}
    try {
      const player = new (window as any).YT.Player(ytContainerRef.current, {
        height: "100%",
        width: "100%",
        videoId,
        playerVars: { autoplay: autoplay ? 1 : 0, controls: 1, rel: 0, start: Math.floor(start) },
        events: {
          onReady: (e: any) => {
            if (muted) { try { e.target.mute(); } catch {} }
            if (autoplay) { try { e.target.playVideo(); } catch {} }
          },
          onStateChange: (e: any) => {
            if (!isHost) return;
            const state = e.data;
            if (state === 1) {
              const ct = e.target.getCurrentTime ? e.target.getCurrentTime() : 0;
              socketManager.playVideo(ct);
            } else if (state === 2) {
              socketManager.pauseVideo();
            }
          }
        }
      });
      setYTPlayer(player);
      return player;
    } catch (e) {
      console.error("YT player create error", e);
      return null;
    }
  }, [loadYouTubeAPI, isHost]);

  useEffect(() => {
    const t = setInterval(() => {
      const status = webrtcManager.getConnectionStatus();
      setWebrtcStatus(status);
      if (status.connectedPeers > 0) {
        setShowConnectedText(true);
        setTimeout(() => setShowConnectedText(false), 1000);
      }
    }, 2000);
    return () => clearInterval(t);
  }, []);

  const waitForSocketAuth = (token: string, timeoutMs = 8000) =>
    new Promise<void>((resolve, reject) => {
      let done = false;
      const timer = setTimeout(() => {
        if (!done) {
          done = true;
          reject(new Error("Socket auth timeout"));
        }
      }, timeoutMs);

      const offAuth = socketManager.onAuthenticated?.(() => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        offAuth?.();
        resolve();
      });

      socketManager.authenticate?.(token);

      if (!offAuth) {
        const poll = () => {
          if (done) return;
          if (socketManager.isAuthenticated?.()) {
            done = true;
            clearTimeout(timer);
            resolve();
          } else {
            setTimeout(poll, 150);
          }
        };
        poll();
      }
    });

  useEffect(() => {
    let mounted = true;
    let authInFlight = true;

    const init = async () => {
      try {
        const resolved = await params;
        const roomId = resolved.roomId;

        const currentUser = getCurrentUser();
        const token = getToken();
        if (!currentUser || !token) {
          router.push("/auth");
          return;
        }
        setUser(currentUser);

        try {
          socketManager.connect?.({ auth: { token } });
        } catch {
          socketManager.connect();
        }
        webrtcManager.ensureSocketListeners();

        socketManager.onError((err) => {
          if (!mounted) return;
          if (authInFlight && (err === "Not authenticated" || err?.error === "Not authenticated")) return;
          setError(typeof err === "string" ? err : err?.error || "Unknown socket error");
        });

        await waitForSocketAuth(token);
        authInFlight = false;

        socketManager.onRoomInfo((room) => {
          if (!mounted) return;
          setRoomInfo(room);
          const unique = room.participants.filter((p, i, arr) => i === arr.findIndex(x => x.user.id === p.user.id));
          setParticipants(unique);
          webrtcManager.setHostStatus(currentUser.id === room.host?.id);
          webrtcManager.ensureSocketListeners();
          if (currentUser.id === room.host?.id) {
            webrtcManager.ensureConnectionsTo(unique.map(p => p.user.id), currentUser.id);
          }
          setIsLoading(false);
        });

        socketManager.onParticipantsChange((parts) => {
          if (!mounted) return;
          const unique = parts.filter((p, i, arr) => i === arr.findIndex(x => x.user.id === p.user.id));
          setParticipants(unique);
          if (webrtcManager.isHostUser()) webrtcManager.ensureConnectionsTo(unique.map(p => p.user.id), currentUser.id);
        });

        socketManager.onMessage((msg) => {
          try {
            if (msg.message) {
              const parsed = JSON.parse(msg.message);
              if (parsed?.type === "user-joined") return;
            }
          } catch {}
          setMessages(prev => [...prev, msg]);
          if (!isChatVisible) setUnreadCount(c => c + 1);
        });

        socketManager.onVideoControl((data) => handleVideoControl(data));

        socketManager.onVideoMetadata((metadata) => {
          if (!mounted) return;
          if (!isHost) {
            if (metadata.type === "youtube") {
              const id = extractYouTubeId(metadata.url || "");
              setYoutubeVideoId(id);
              setCurrentVideoType("youtube");
            } else if (metadata.type === "screen") {
              setCurrentVideoType("screen");
            } else {
              setCurrentVideoType("file");
            }
            if (videoRef.current) {
              try { webrtcManager.setVideoElement(videoRef.current); } catch {}
            }
            for (let i = 0; i < 4; i++) {
              setTimeout(() => socketManager.sendVideoStateRequest(), 300 * i + 200);
            }
          }
        });

        socketManager.onVideoStateSync((data) => {
          if (!mounted) return;
          const vs = data.videoState || data;
          const metadata = vs.metadata || data.metadata;
          const playback = vs.playbackState || data.playbackState;
          if (!isHost && metadata) {
            if (metadata.type === "youtube") {
              const id = extractYouTubeId(metadata.url || "");
              setYoutubeVideoId(id);
              setCurrentVideoType("youtube");
              createYouTubePlayer(id, playback?.currentTime || 0, playback?.isPlaying || false, true)
                .then((player) => { setTimeout(() => { try { player?.unMute?.(); } catch {} }, 300); })
                .catch(console.error);
            } else {
              setCurrentVideoType(metadata.type === "screen" ? "screen" : "file");
              if (videoRef.current) webrtcManager.setVideoElement(videoRef.current);
              if (playback?.isPlaying) setTimeout(() => tryPlayVideo(), 300);
            }
          }
        });

        socketManager.joinRoom(roomId);

        const resp = await fetch(`${API_BASE_URL}/api/rooms/${roomId}`, { headers: { Authorization: `Bearer ${token}` }});
        const data = await resp.json();
        if (data.success) {
          setRoomInfo(data.room);
          setParticipants(data.room.participants || []);
        }
      } catch (e) {
        console.error("init error", e);
        if (mounted) {
          setError("Failed to join room");
          setIsLoading(false);
        }
      }
    };

    init();
    return () => {
      mounted = false;
      socketManager.leaveRoom();
      webrtcManager.cleanup();
    };
  }, [params, router]);

  const handleVideoControl = (data: any) => {
    if (!data) return;
    if (data.type && currentVideoType === "youtube") {
      const player = getYTPlayer();
      if (!player) return;
      if (data.type === "play") { try { player.seekTo(data.currentTime || 0, true); player.playVideo(); } catch {} }
      if (data.type === "pause") { try { player.pauseVideo(); } catch {} }
      if (data.type === "seek") { try { player.seekTo(data.time || 0, true); } catch {} }
      return;
    }
    if (!videoRef.current) return;
    try {
      if (data.type === "play") {
        videoRef.current.currentTime = data.currentTime || 0;
        videoRef.current.play().catch(() => setShowResumeOverlay(true));
        setIsPlaying(true);
      } else if (data.type === "pause") {
        videoRef.current.pause();
        setIsPlaying(false);
      } else if (data.type === "seek") {
        videoRef.current.currentTime = data.time || 0;
      }
    } catch (e) { console.error("handleVideoControl", e); }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isHost) return;
      const id = extractYouTubeId(youtubeUrl);
      if (!id) return;
      setIsLoadingVideo(true);
      try {
        try { webrtcManager.stopFileStream(); } catch {}
        setSelectedVideoFile(null);
        setCurrentVideoType("youtube");
        await createYouTubePlayer(id, 0, true, false);
        socketManager.sendVideoMetadata({ name: `YouTube-${id}`, size: 0, type: "youtube", url: youtubeUrl });
        socketManager.sendVideoStateSync({
          metadata: { name: `YouTube-${id}`, type: "youtube", url: youtubeUrl },
          playbackState: { currentTime: 0, isPlaying: true, volume, isMuted }
        });
      } catch (e) {
        console.error("host youtube error", e);
      } finally {
        if (!cancelled) setIsLoadingVideo(false);
      }
    })();
    return () => { cancelled = true; };
  }, [youtubeUrl, isHost, createYouTubePlayer, volume, isMuted]);

  const handleShareScreen = async () => {
    try {
      setIsLoadingVideo(true);
      const stream = await webrtcManager.startScreenShare();
      if (videoRef.current) {
        try { (videoRef.current as any).srcObject = stream; videoRef.current.muted = false; await videoRef.current.play().catch(()=>{}); } catch {}
      }
      setCurrentVideoType("screen");
      socketManager.sendVideoMetadata({ name: "Screen Share", size: 0, type: "screen", url: "screen-share" });
      socketManager.sendVideoStateSync({
        metadata: { name: "Screen Share", type: "screen", url: "screen-share" },
        playbackState: { currentTime: 0, isPlaying: true, volume: 1, isMuted: false }
      });
    } catch (e) {
      console.error("share screen error", e);
      setError("Screen share failed / permission denied");
    } finally {
      setIsLoadingVideo(false);
    }
  };

  const handleStopScreenShare = () => {
    try {
      webrtcManager.stopScreenShare();
      setCurrentVideoType(null);
      setIsPlaying(false);
      if (videoRef.current) try { (videoRef.current as any).srcObject = null; } catch {}
      socketManager.sendVideoMetadata({ name: "None", size: 0, type: "stopped", url: "" });
    } catch (e) { console.warn(e); }
  };

  const handleSelectVideo = () => fileInputRef.current?.click();

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("video/")) { setError("Please select a video file"); return; }
    setSelectedVideoFile(file);
    setCurrentVideoType("file");
    setIsLoadingVideo(true);
    try { webrtcManager.stopFileStream(); } catch {}
    setTimeout(() => {
      socketManager.sendVideoMetadata({ name: file.name, size: file.size, type: file.type, url: "p2p" });
      if (isHost && videoRef.current) {
        try {
          webrtcManager.streamVideoFile(file, videoRef.current).catch((err)=>console.error("streamVideoFile err", err));
        } catch (e) { console.error(e); }
      }
    }, 200);
    setIsLoadingVideo(false);
  };

  const hasStartedStreamingRef = useRef(false);
  useEffect(() => {
    if (!isHost) return;
    if (!selectedVideoFile) return;
    const attempt = async () => {
      if (hasStartedStreamingRef.current) return;
      if (!videoRef.current) return;
      hasStartedStreamingRef.current = true;
      try {
        await webrtcManager.streamVideoFile(selectedVideoFile, videoRef.current);
      } catch (e) {
        console.error("streaming start failed", e);
        hasStartedStreamingRef.current = false;
      }
    };
    attempt();
    const r1 = setTimeout(attempt, 300);
    const r2 = setTimeout(attempt, 900);
    return () => { clearTimeout(r1); clearTimeout(r2); };
  }, [selectedVideoFile, isHost]);

  useEffect(() => {
    if (!isHost && videoRef.current) {
      try { webrtcManager.setVideoElement(videoRef.current); } catch (e) { console.warn(e); }
    }
  }, [isHost]);

  const togglePlayPause = async () => {
    if (currentVideoType === "youtube") {
      const player = getYTPlayer();
      if (!player) return;
      const state = player.getPlayerState ? player.getPlayerState() : null;
      if (state === 1) {
        try { player.pauseVideo(); } catch {}
        setIsPlaying(false);
        if (isHost) socketManager.pauseVideo();
      } else {
        try { player.playVideo(); } catch { setShowResumeOverlay(true); }
        setIsPlaying(true);
        if (isHost) { const ct = player.getCurrentTime ? player.getCurrentTime() : 0; socketManager.playVideo(ct); }
      }
      return;
    }
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
      if (isHost) socketManager.pauseVideo();
    } else {
      try { await videoRef.current.play(); } catch (e: any) { if (e?.name === "NotAllowedError") setShowResumeOverlay(true); }
      setIsPlaying(true);
      if (isHost) socketManager.playVideo(videoRef.current.currentTime);
    }
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    videoRef.current.muted = !isMuted;
    setIsMuted(!isMuted);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    setVolume(v);
    if (videoRef.current) videoRef.current.volume = v;
    setIsMuted(v === 0);
  };

  const handleProgressBarClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const bar = progressBarRef.current;
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    const pos = (e.clientX - rect.left) / rect.width;
    if (currentVideoType === "youtube") {
      const player = getYTPlayer();
      if (!player || !player.getDuration) return;
      const dur = player.getDuration();
      const seek = Math.max(0, Math.min(dur, pos * dur));
      try { player.seekTo(seek, true); } catch {}
      if (isHost) socketManager.seekVideo(seek);
      return;
    }
    if (!videoRef.current || !videoRef.current.duration) return;
    const seekTime = pos * videoRef.current.duration;
    videoRef.current.currentTime = seekTime;
    setCurrentTime(seekTime);
    if (isHost) socketManager.seekVideo(seekTime);
  };

  const bindVideo = (el: HTMLVideoElement | null) => {
    if (el) {
      videoRef.current = el;
      el.playsInline = true;
      el.style.objectFit = "contain";
      el.onloadedmetadata = () => { setDuration(el.duration || 0); };
      el.ontimeupdate = () => { setCurrentTime(el.currentTime || 0); setDuration(el.duration || duration); };
      el.onplay = () => setIsPlaying(true);
      el.onpause = () => setIsPlaying(false);
      if (!isHost) {
        try { webrtcManager.setVideoElement(el); } catch {}
        for (let i = 0; i < 3; i++) setTimeout(() => socketManager.sendVideoStateRequest(), 250 * i + 200);
      }
    } else {
      videoRef.current = null;
    }
  };

  const tryPlayVideo = async () => {
    if (!videoRef.current) return;
    try {
      await videoRef.current.play();
      setIsPlaying(true);
      setShowResumeOverlay(false);
    } catch (e: any) {
      if (e?.name === "NotAllowedError") setShowResumeOverlay(true);
    }
  };

  const sendMessage = () => {
    if (!message.trim()) return;
    const msgText = message.trim();
    const msg: SocketMessage = {
      id: `msg-${Date.now()}-${Math.random()}`,
      user: { id: user?.id || "", name: user?.name || "You", picture: user?.picture || "" },
      message: msgText,
      timestamp: new Date().toLocaleTimeString(),
      isPrivate: false,
      type: "text"
    };
    setMessages(prev => [...prev, msg]);
    setMessage("");
    socketManager.sendMessage(msgText, false);
  };

  useEffect(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.clientHeight <= el.scrollTop + 120;
    if (atBottom) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const formatTime = (t: number) => {
    if (!t || !isFinite(t)) return "00:00";
    const m = Math.floor(t / 60), s = Math.floor(t % 60);
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  if (isLoading) return (
    <div className="min-h-screen bg-black flex items-center justify-center">
      <div className="text-white flex items-center space-x-2"><Loader2 className="w-6 h-6 animate-spin" /><span>Joining room...</span></div>
    </div>
  );

  if (error) return (
    <div className="min-h-screen bg-black flex items-center justify-center">
      <div className="text-center">
        <AlertCircle className="w-16 h-16 text-red-400 mx-auto mb-4" />
        <h3 className="text-xl font-bold text-white mb-2">Error</h3>
        <p className="text-gray-400 mb-4">{error}</p>
        <Button onClick={() => router.push("/rooms")} className="bg-purple-600 hover:bg-purple-700">Back to Rooms</Button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-black">
      <div className="fixed top-4 left-4 z-50">
        {showConnectedText ? <div className="px-2 py-1 rounded bg-green-500 text-white text-xs">Connected</div> :
          <div className={`w-3 h-3 rounded-full ${webrtcStatus?.connectedPeers > 0 ? "bg-green-500" : "bg-red-500"}`} />}
      </div>

      <header className="bg-gray-900 border-b border-gray-800 px-4 py-3">
        <div className="flex items-center justify-between">
          <Link href="/rooms" className="flex items-center space-x-2">
            <Play className="h-6 w-6 text-purple-400" />
            <span className="text-lg font-bold text-white">CinemaSync</span>
          </Link>
          <div className="flex items-center space-x-4">
            <span className="px-2 py-1 bg-green-600/20 text-green-300 text-sm rounded-full flex items-center"><Users className="mr-1 h-3 w-3" />{participants.length}/5</span>
            {isHost && <span className="px-2 py-1 bg-purple-600/20 text-purple-300 text-sm rounded-full flex items-center"><Crown className="mr-1 h-3 w-3" />Host</span>}
            <Button variant="outline" size="sm" className="text-white border-gray-600 hover:bg-gray-800 bg-transparent"><Settings className="mr-2 h-4 w-4" />Settings</Button>
          </div>
        </div>
      </header>

      {isHost && (
        <div className="bg-gray-900 border-b border-gray-800 px-4 py-3">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 flex gap-2">
              <Input placeholder="Paste YouTube URL here (auto-plays when pasted)..." value={youtubeUrl} onChange={(e)=>setYoutubeUrl(e.target.value)} className="bg-gray-800 border-gray-700 text-white placeholder:text-gray-400" />
              <div className="flex items-center px-3 bg-red-600/20 rounded-md"><Youtube className="h-4 w-4 text-red-400" /></div>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleShareScreen} disabled={isLoadingVideo} className="bg-blue-600 hover:bg-blue-700 transition-all duration-300"><Monitor className="mr-2 h-4 w-4" />Share Screen</Button>
              <Button onClick={handleSelectVideo} disabled={isLoadingVideo} className="bg-green-600 hover:bg-green-700 transition-all duration-300"><Video className="mr-2 h-4 w-4" />Select Video</Button>
            </div>
          </div>
        </div>
      )}

      <input ref={fileInputRef} type="file" accept="video/*" onChange={handleFileSelect} className="hidden" />

      <div className="flex flex-col md:flex-row md:h-[calc(100vh-160px)]">
        <div ref={videoContainerRef} className="md:flex-1 bg-black flex flex-col">
          <div className="flex-1 relative bg-gray-900 flex items-center justify-center" style={{ minHeight: 240 }}>
            <div className="w-full h-full bg-gradient-to-br from-gray-800 to-gray-900 flex items-center justify-center">
              {currentVideoType === "youtube" && youtubeVideoId ? (
                <div ref={ytContainerRef} className="w-full h-full" />
              ) : (
                <video ref={bindVideo as any} className="w-full h-full object-contain bg-black" autoPlay playsInline />
              )}
            </div>

            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4">
              <div ref={progressBarRef} className="w-full h-2 bg-gray-700 rounded-full mb-4 cursor-pointer" onClick={handleProgressBarClick}>
                <div className="h-full bg-purple-600 rounded-full" style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }} />
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-4">
                  <Button variant="ghost" size="sm" onClick={togglePlayPause} className="text-white hover:bg-white/20">
                    {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                  </Button>
                  <div className="flex items-center space-x-2">
                    <Button variant="ghost" size="sm" onClick={toggleMute} className="text-white hover:bg-white/20">
                      {isMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
                    </Button>
                    <input type="range" min="0" max="1" step="0.01" value={volume} onChange={handleVolumeChange} className="w-20 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer" />
                  </div>
                  <div className="text-white text-sm">{formatTime(currentTime)} / {formatTime(duration)}</div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => { if (document.fullscreenElement) document.exitFullscreen(); else videoContainerRef.current?.requestFullscreen(); }} className="text-white hover:bg-white/20"><Maximize className="h-5 w-5" /></Button>
              </div>
            </div>

            {currentVideoType === "screen" && isHost && (
              <div className="absolute top-4 right-4">
                <Button onClick={handleStopScreenShare} variant="destructive" size="sm" className="bg-red-600 hover:bg-red-700"><StopCircle className="mr-2 h-4 w-4" />Stop Sharing</Button>
              </div>
            )}
          </div>
        </div>

        <div className="md:w-80 w-full md:h-auto h-[60vh] bg-gray-900 border-t md:border-l md:border-t-0 border-gray-800 flex flex-col">
          <div className="p-4 border-b border-gray-800 flex items-center justify-between">
            <h3 className="text-white font-semibold">Chat</h3>
            <div className="flex -space-x-2">
              {participants.slice(0,5).map(p => (
                <Avatar key={p.user.id} className="h-8 w-8 border-2 border-gray-800">
                  <AvatarImage src={p.user.picture || "/placeholder.svg"} />
                  <AvatarFallback className="text-xs bg-gray-700">{p.user.name.split(" ").map(n=>n[0]).join("")}</AvatarFallback>
                </Avatar>
              ))}
              {participants.length > 5 && <div className="h-8 w-8 rounded-full bg-gray-600 border-2 border-gray-800 flex items-center justify-center"><span className="text-xs text-white">+{participants.length-5}</span></div>}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4" ref={chatScrollRef}>
            <div className="space-y-3">
              {messages.filter(m => !m.isPrivate).map((m, idx) => {
                const isOwn = m.user.id === user?.id;
                return (
                  <div key={`${m.id}-${idx}`} className={`flex ${isOwn ? "justify-end" : "justify-start"}`}>
                    {!isOwn && (
                      <Avatar className="h-8 w-8 mr-2 flex-shrink-0">
                        <AvatarImage src={m.user.picture || "/placeholder.svg"} />
                        <AvatarFallback className="text-xs bg-gray-700">{m.user.name.split(" ").map(n => n[0]).join("")}</AvatarFallback>
                      </Avatar>
                    )}
                    <div className={`max-w-[70%] ${isOwn ? "order-1" : "order-2"}`}>
                      {!isOwn && <div className="flex items-center space-x-2 mb-1"><span className="text-sm font-medium text-white">{m.user.name}</span></div>}
                      <div className={`rounded-2xl px-4 py-2 shadow-sm ${isOwn ? "bg-purple-600 text-white" : "bg-gray-700 text-gray-200"}`}>
                        <p className="text-sm leading-relaxed">{m.type === "voice" ? "Voice message" : m.message}</p>
                      </div>
                    </div>
                    {isOwn && (
                      <Avatar className="h-8 w-8 ml-2 flex-shrink-0">
                        <AvatarImage src={m.user.picture || "/placeholder.svg"} />
                        <AvatarFallback className="text-xs bg-purple-700">{m.user.name.split(" ").map(n => n[0]).join("")}</AvatarFallback>
                      </Avatar>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="p-4 border-t border-gray-800">
            <div className="flex space-x-2">
              <Input
                placeholder="Type a message..."
                value={message}
                onChange={(e)=>setMessage(e.target.value)}
                onKeyDown={(e)=>{ if (e.key === "Enter" && message.trim()) { e.preventDefault(); sendMessage(); } }}
                className="bg-gray-800 border-gray-700 text-white placeholder:text-gray-400 flex-1"
              />
              <Button onClick={sendMessage} className="bg-purple-600 hover:bg-purple-700 px-3 disabled:opacity-50"><Send className="h-4 w-4" /></Button>
            </div>
          </div>
        </div>
      </div>

      {showResumeOverlay && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-6 text-center">
            <AlertCircle className="w-16 h-16 text-yellow-400 mx-auto mb-4" />
            <h3 className="text-xl font-bold text-white mb-2">Video Ready to Play</h3>
            <p className="text-gray-400 mb-4">Click below to resume playback</p>
            <Button
              onClick={async () => {
                setShowResumeOverlay(false);
                if (currentVideoType === "youtube" && youtubeVideoId) {
                  await createYouTubePlayer(youtubeVideoId, currentTime || 0, true, false);
                } else {
                  try { await videoRef.current?.play(); } catch {}
                }
              }}
              className="bg-purple-600 hover:bg-purple-700"
            >
              <Play className="mr-2 h-4 w-4" /> Resume Playback
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
