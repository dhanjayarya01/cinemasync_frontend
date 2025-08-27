// app/(routes)/rooms/[roomId]/page.tsx (full updated TheaterPage)
"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Play, Pause, Volume2, VolumeX, Maximize, Monitor, Loader2, StopCircle,
  Crown, Settings, Users, Send, Video, Youtube, AlertCircle, Mic, Trash2, X
} from "lucide-react";

import Chat from "@/lib/chat";

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

  // Chat overlay state now here
  const [isChatVisible, setIsChatVisible] = useState(true);
  const [isFloatingMode, setIsFloatingMode] = useState(false);

  const [message, setMessage] = useState("");
  const [unreadCount, setUnreadCount] = useState(0);
  const [showResumeOverlay, setShowResumeOverlay] = useState(false);

  const [webrtcStatus, setWebrtcStatus] = useState<any>(null);
  const [showConnectedText, setShowConnectedText] = useState(false);

  // Voice message states
  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [recordingTime, setRecordingTime] = useState(0);
  const [playingVoiceMessages, setPlayingVoiceMessages] = useState<Set<string>>(new Set());
  const [voiceMessageProgress, setVoiceMessageProgress] = useState<Map<string, number>>(new Map());
  const [voiceMessageCurrentTime, setVoiceMessageCurrentTime] = useState<Map<string, number>>(new Map());
  const [isSendingVoiceMessage, setIsSendingVoiceMessage] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingIntervalRef = useRef<number | null>(null);
  const audioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());

  // ephemeral messages for floating mode
  const [ephemeralMessages, setEphemeralMessages] = useState<Array<{ id: string; text: string }>>([]);

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
    try { prev?.destroy?.(); } catch { }
    try {
      const player = new (window as any).YT.Player(ytContainerRef.current, {
        height: "100%",
        width: "100%",
        videoId,
        playerVars: { autoplay: autoplay ? 1 : 0, controls: 1, rel: 0, start: Math.floor(start) },
        events: {
          onReady: (e: any) => {
            if (muted) { try { e.target.mute(); } catch { } }
            if (autoplay) { try { e.target.playVideo(); } catch { } }
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

    // Expose webrtcManager globally for Chat component
    (window as any).webrtcManager = webrtcManager;

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

        // Expose socketManager to global window for live voice chat
        (window as any).socketManager = socketManager;

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
          } catch { }
          if (msg.type === "voice" && msg.audioUrl) {
            if (messages.find(m => m.audioUrl === msg.audioUrl)) return;
          }
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
              try { webrtcManager.setVideoElement(videoRef.current); } catch { }
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
                .then((player) => { setTimeout(() => { try { player?.unMute?.(); } catch { } }, 300); })
                .catch(console.error);
            } else {
              setCurrentVideoType(metadata.type === "screen" ? "screen" : "file");
              if (videoRef.current) webrtcManager.setVideoElement(videoRef.current);
              if (playback?.isPlaying) setTimeout(() => tryPlayVideo(), 300);
            }
          }
        });

        socketManager.joinRoom(roomId);

        const resp = await fetch(`${API_BASE_URL}/api/rooms/${roomId}`, { headers: { Authorization: `Bearer ${token}` } });
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, router]);

  const handleVideoControl = (data: any) => {
    if (!data) return;
    if (data.type && currentVideoType === "youtube") {
      const player = getYTPlayer();
      if (!player) return;
      if (data.type === "play") { try { player.seekTo(data.currentTime || 0, true); player.playVideo(); } catch { } }
      if (data.type === "pause") { try { player.pauseVideo(); } catch { } }
      if (data.type === "seek") { try { player.seekTo(data.time || 0, true); } catch { } }
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
        try { webrtcManager.stopFileStream(); } catch { }
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
        try { (videoRef.current as any).srcObject = stream; videoRef.current.muted = false; await videoRef.current.play().catch(() => { }); } catch { }
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
      if (videoRef.current) try { (videoRef.current as any).srcObject = null; } catch { }
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
    try { webrtcManager.stopFileStream(); } catch { }
    setTimeout(() => {
      socketManager.sendVideoMetadata({ name: file.name, size: file.size, type: file.type, url: "p2p" });
      if (isHost && videoRef.current) {
        try {
          webrtcManager.streamVideoFile(file, videoRef.current).catch((err) => console.error("streamVideoFile err", err));
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
        try { player.pauseVideo(); } catch { }
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
    if (isHost) {
      const newMuted = !isMuted;
      webrtcManager.setLocalMuted(newMuted);
      setIsMuted(newMuted);
      return;
    }
    videoRef.current.muted = !isMuted;
    setIsMuted(!isMuted);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    setVolume(v);
    if (isHost) {
      webrtcManager.setLocalVolume(v);
    } else if (videoRef.current) {
      videoRef.current.volume = v;
    }
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
      try { player.seekTo(seek, true); } catch { }
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
        try { webrtcManager.setVideoElement(el); } catch { }
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
    if (!t || !isFinite(t) || t <= 0) return "0:00";
    const total = Math.floor(t);
    const hours = Math.floor(total / 3600);
    const mins = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    const two = (n: number) => n.toString().padStart(2, "0");
    if (hours > 0) return `${hours}:${two(mins)}:${two(secs)}`;
    return `${mins}:${two(secs)}`;
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      const chunks: Blob[] = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };
      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        setAudioBlob(blob);
        try { stream.getTracks().forEach(track => track.stop()); } catch { }
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);

      recordingIntervalRef.current = window.setInterval(() => {
        setRecordingTime(prev => +(prev + 0.1).toFixed(1));
      }, 100) as unknown as number;
    } catch (error) {
      console.error('Error starting recording:', error);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      try {
        mediaRecorderRef.current.stop();
      } catch (e) { }
      setIsRecording(false);
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
        recordingIntervalRef.current = null;
      }
    }
  };

  const handleSendVoiceMessage = async () => {
    if (audioBlob) {
      setIsSendingVoiceMessage(true);

      const timeoutId = setTimeout(() => {
        setIsSendingVoiceMessage(false);
        console.error('Voice message sending timeout');
      }, 10000);

      try {
        const voiceMessageId = `voice-${Date.now()}-${Math.random()}`;
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
          audioUrl: URL.createObjectURL(audioBlob),
          duration: Math.round(recordingTime)
        };

        setMessages(prev => [...prev, localVoiceMessage]);

        try {
          await socketManager.sendVoiceMessage(audioBlob, Math.round(recordingTime), false, {
            id: user?.id || '',
            name: user?.name || 'You',
            picture: user?.picture || ''
          });

          console.log('Voice message sent successfully');
          setAudioBlob(null);
          setRecordingTime(0);
          clearTimeout(timeoutId);
        } catch (sendError) {
          console.error('Socket send error:', sendError);
          setMessages(prev => prev.map(msg => msg.id === voiceMessageId ? { ...msg, failed: true } : msg));
          throw sendError;
        }
      } catch (error) {
        console.error('Error sending voice message:', error);
        clearTimeout(timeoutId);
      } finally {
        setIsSendingVoiceMessage(false);
      }
    }
  };

  const playVoiceMessage = (messageId: string, audioUrl: string) => {
    let audio = audioRefs.current.get(messageId);
    if (!audio) {
      audio = new Audio(audioUrl);
      audioRefs.current.set(messageId, audio);
      audio.preload = "auto";
      audio.addEventListener('timeupdate', () => {
        if (audio && audio.duration) {
          const progress = (audio.currentTime / audio.duration) * 100;
          const currentTime = audio.currentTime;
          setVoiceMessageProgress(prev => new Map(prev).set(messageId, progress));
          setVoiceMessageCurrentTime(prev => new Map(prev).set(messageId, currentTime));
        }
      });
      audio.addEventListener('ended', () => {
        setPlayingVoiceMessages(prev => {
          const newSet = new Set(prev);
          newSet.delete(messageId);
          return newSet;
        });
        setVoiceMessageProgress(prev => {
          const newMap = new Map(prev);
          newMap.delete(messageId);
          return newMap;
        });
        setVoiceMessageCurrentTime(prev => {
          const newMap = new Map(prev);
          newMap.delete(messageId);
          return newMap;
        });
        audioRefs.current.delete(messageId);
      });
    }

    audio.play().then(() => {
      setPlayingVoiceMessages(prev => new Set(prev).add(messageId));
    }).catch((e) => {
      console.error("playVoiceMessage error:", e);
    });
  };

  const pauseVoiceMessage = (messageId: string) => {
    const audio = audioRefs.current.get(messageId);
    if (audio) {
      audio.pause();
      setPlayingVoiceMessages(prev => {
        const newSet = new Set(prev);
        newSet.delete(messageId);
        return newSet;
      });
    }
  };

  // cleanup audio refs + revoke blob urls on unmount
  useEffect(() => {
    return () => {
      audioRefs.current.forEach((a) => {
        try { a.pause(); a.src = ""; } catch { }
      });
      audioRefs.current.clear();
      messages.forEach(msg => {
        if (msg.type === 'voice' && msg.audioUrl && msg.audioUrl.startsWith('blob:')) {
          try { URL.revokeObjectURL(msg.audioUrl); } catch { }
        }
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ephemeral messages (floating) behavior:
  const lastMessageIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isFloatingMode) return;
    if (!messages || messages.length === 0) return;
    const last = messages[messages.length - 1];
    if (!last || last.id === lastMessageIdRef.current) return;
    lastMessageIdRef.current = last.id;
    const text = last.type === "voice" ? "Voice message" : (last.message || "");
    const id = `ephemeral-${Date.now()}-${Math.random()}`;
    setEphemeralMessages(prev => [...prev, { id, text }]);
    const t = window.setTimeout(() => {
      setEphemeralMessages(prev => prev.filter(m => m.id !== id));
    }, 2000);
    return () => clearTimeout(t);
  }, [messages, isFloatingMode]);

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
              <Input placeholder="Paste YouTube URL here (auto-plays when pasted)..." value={youtubeUrl} onChange={(e) => setYoutubeUrl(e.target.value)} className="bg-gray-800 border-gray-700 text-white placeholder:text-gray-400" />
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
        <div ref={videoContainerRef} className="md:flex-1 bg-black flex flex-col relative">
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

                <div className="flex items-center space-x-2">
                  <Button variant="ghost" size="sm" onClick={() => { if (document.fullscreenElement) document.exitFullscreen(); else videoContainerRef.current?.requestFullscreen(); }} className="text-white hover:bg-white/20"><Maximize className="h-5 w-5" /></Button>

                  <button className="md:hidden inline-flex items-center justify-center p-2 rounded bg-gray-700 hover:bg-gray-600 text-white" onClick={() => {
                    // quick mobile rotation request: attempt fullscreen then orientation lock
                    if (!document.fullscreenElement) {
                      videoContainerRef.current?.requestFullscreen().catch(() => { });
                    }
                    try { (screen as any).orientation?.lock?.("landscape"); } catch { }
                  }} title="Mobile landscape">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                      <rect x="6" y="3" width="12" height="18" rx="2" stroke="currentColor" strokeWidth="1.2" />
                      <path d="M9 7 L15 7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>

            {currentVideoType === "screen" && isHost && (
              <div className="absolute top-4 right-4">
                <Button onClick={handleStopScreenShare} variant="destructive" size="sm" className="bg-red-600 hover:bg-red-700"><StopCircle className="mr-2 h-4 w-4" />Stop Sharing</Button>
              </div>
            )}

            {/* Chat overlay component */}

            <Chat
              user={user}
              participants={participants}
              messages={messages}
              isVisible={isChatVisible}
              setIsVisible={setIsChatVisible}
              isFloatingMode={isFloatingMode}
              setIsFloatingMode={setIsFloatingMode}
              message={message}
              setMessage={setMessage}
              sendMessage={sendMessage}
              isRecording={isRecording}
              startRecording={startRecording}
              stopRecording={stopRecording}
              audioBlob={audioBlob}
              setAudioBlob={setAudioBlob}
              recordingTime={recordingTime}
              handleSendVoiceMessage={handleSendVoiceMessage}
              isSendingVoiceMessage={isSendingVoiceMessage}
              playVoiceMessage={playVoiceMessage}
              pauseVoiceMessage={pauseVoiceMessage}
              playingVoiceMessages={playingVoiceMessages}
              onVideoVolumeChange={(vol) => {
                setVolume(vol);
                if (videoRef.current) {
                  videoRef.current.volume = vol;
                }
                if (isHost) {
                  webrtcManager.setLocalVolume(vol);
                }
              }}
              currentVideoVolume={volume}
            />

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
                  try { await videoRef.current?.play(); } catch { }
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
