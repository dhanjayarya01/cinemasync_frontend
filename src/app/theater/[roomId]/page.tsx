
"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Play, Pause, Volume2, VolumeX, Maximize, Monitor, Loader2, StopCircle,
  Crown, Settings, Users, Send, Video, Youtube, AlertCircle, Mic, Trash2, X,
  MessageCircle, Share2, Copy, ExternalLink, SkipBack, SkipForward
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
  const ytPlayerInstanceRef = useRef<any>(null);
  const [youtubeContainerKey, setYoutubeContainerKey] = useState<number>(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const videoContainerRef = useRef<HTMLDivElement | null>(null);
  const progressBarRef = useRef<HTMLDivElement | null>(null);
  const messageInputRef = useRef<HTMLInputElement | null>(null);
  const chatContainerRef = useRef<HTMLDivElement | null>(null);

  const [currentVideoType, setCurrentVideoType] = useState<"youtube" | "screen" | "file" | null>(null);
  const [selectedVideoFile, setSelectedVideoFile] = useState<File | null>(null);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [youtubeVideoId, setYoutubeVideoId] = useState<string | null>(null);
  const [isLoadingVideo, setIsLoadingVideo] = useState(false);
  const [youtubeError, setYoutubeError] = useState<string | null>(null);
  const [ytPlayerReady, setYtPlayerReady] = useState(false);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  
  const [isChatVisible, setIsChatVisible] = useState(false);
  const [isFloatingMode, setIsFloatingMode] = useState(false);

  const [message, setMessage] = useState("");
  const [unreadCount, setUnreadCount] = useState(0);
  const [showResumeButton, setShowResumeButton] = useState(false);

  const [webrtcStatus, setWebrtcStatus] = useState<any>(null);
  const [showConnectedText, setShowConnectedText] = useState(false);

  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteLink, setInviteLink] = useState('');
  const [inviteRoomCode, setInviteRoomCode] = useState('');


  const [copiedStates, setCopiedStates] = useState<{ [key: string]: boolean }>({});


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

  // Video controls auto-hide state
  const [showControls, setShowControls] = useState(true);
  const controlsTimeoutRef = useRef<number | null>(null);

  const isHost = user?.id === roomInfo?.host?.id;
  const [toasts, setToasts] = useState<{ id: string; text: string }[]>([]);


const showToast = useCallback((text: string) => {
  const id = `t-${Date.now()}-${Math.random()}`;
  setToasts((s) => [...s, { id, text }]);
  setTimeout(() => {
    setToasts((s) => s.filter((t) => t.id !== id));
  }, 2000);
}, []);

useEffect(() => {
  const offMsg = socketManager.onMessage((msg) => {
    console.log("Socket message received:", msg);
    if (!msg?.message) return;
    try {
      const parsed = JSON.parse(msg.message);
      if (parsed?.type === 'user-joined' && parsed.user) {
        showToast(`${parsed.user.name} joined`);
      }
    } catch {}
  });

  const prevIdsRef = { current: [] as string[] };
  const offParts = socketManager.onParticipantsChange((parts) => {
    try {
      const ids = (parts || []).map((p) => p.user.id);
      const prev = prevIdsRef.current || [];
      const newIds = ids.filter((id) => !prev.includes(id));
      if (newIds.length > 0) {
        const newUsers = parts.filter((p) => newIds.includes(p.user.id)).map((p) => p.user);
        newUsers.forEach((u) => showToast(`${u.name} joined`));
      }
      prevIdsRef.current = ids;
    } catch {}
  });

  return () => {
    offMsg?.();
    offParts?.();
  };
}, [showToast]);


  const handleVideoVolumeChange = useCallback((vol: number) => {
    setVolume(vol);
    if (videoRef.current) {
      videoRef.current.volume = vol;
    }
    if (isHost) {
      webrtcManager.setLocalVolume(vol);
    }
  }, [isHost]);

  // Fix setState warning by using useCallback for mark as read
  const handleMarkAsRead = useCallback(() => {
    setUnreadCount(0);
  }, []);

  // Mobile viewport optimization
  useEffect(() => {
    const handleResize = () => {
      // Fix mobile viewport height issues
      const vh = window.innerHeight * 0.01;
      document.documentElement.style.setProperty('--vh', `${vh}px`);
    };

    const handleOrientationChange = () => {
      // Handle orientation changes on mobile
      setTimeout(handleResize, 100);
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleOrientationChange);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleOrientationChange);
    };
  }, []);

  // Video controls auto-hide functionality
  const showControlsTemporarily = useCallback(() => {
    setShowControls(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    controlsTimeoutRef.current = window.setTimeout(() => {
      setShowControls(false);
    }, 3000);
  }, []);

  const handleVideoContainerInteraction = useCallback(() => {
    showControlsTemporarily();
  }, [showControlsTemporarily]);

  // Seek functions
  const seekVideo = useCallback((seconds: number) => {
    if (currentVideoType === "youtube") {
      const player = getYTPlayer();
      if (!player) return;
      try {
        const currentTime = player.getCurrentTime();
        const newTime = Math.max(0, Math.min(duration, currentTime + seconds));
        player.seekTo(newTime, true);
        if (isHost) socketManager.seekVideo(newTime);
      } catch (e) { }
    } else if (videoRef.current) {
      const newTime = Math.max(0, Math.min(duration, videoRef.current.currentTime + seconds));
      videoRef.current.currentTime = newTime;
      setCurrentTime(newTime);
      if (isHost) socketManager.seekVideo(newTime);
    }
  }, [currentVideoType, duration, isHost]);

  const seekBackward = useCallback(() => seekVideo(-30), [seekVideo]);
  const seekForward = useCallback(() => seekVideo(30), [seekVideo]);

  // Volume control functions
  const adjustVolume = useCallback((delta: number) => {
    const newVolume = Math.max(0, Math.min(1, volume + delta));
    setVolume(newVolume);
    setIsMuted(newVolume === 0);

    if (currentVideoType === "youtube") {
      const player = getYTPlayer();
      if (player) {
        try {
          player.setVolume(newVolume * 100);
          if (newVolume === 0) {
            player.mute();
          } else {
            player.unMute();
          }
        } catch (e) { }
      }
    } else if (isHost) {
      webrtcManager.setLocalVolume(newVolume);
    } else if (videoRef.current) {
      videoRef.current.volume = newVolume;
    }
  }, [volume, currentVideoType, isHost]);

  const volumeUp = useCallback(() => adjustVolume(0.1), [adjustVolume]);
  const volumeDown = useCallback(() => adjustVolume(-0.1), [adjustVolume]);

  // Toggle mute function
  const handleToggleMute = useCallback(() => {
    if (currentVideoType === "youtube") {
      const player = getYTPlayer();
      if (!player) return;
      try {
        if (isMuted) {
          player.unMute();
          setIsMuted(false);
        } else {
          player.mute();
          setIsMuted(true);
        }
      } catch (e) { }
    } else if (isHost) {
      const newMuted = !isMuted;
      webrtcManager.setLocalMuted(newMuted);
      setIsMuted(newMuted);
    } else if (videoRef.current) {
      videoRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  }, [currentVideoType, isMuted, isHost]);

  // Toggle chat function
  const handleToggleChat = useCallback(() => {
    setIsChatVisible(prev => {
      const newVisible = !prev;
      if (newVisible) {

        setIsFloatingMode(false);

        setTimeout(() => {
          messageInputRef.current?.focus();
        }, 100);
      }
      return newVisible;
    });
  }, []);

  // Toggle fullscreen function
  const handleToggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      videoContainerRef.current?.requestFullscreen();
    }
  }, []);

  // Play/pause function
  const handleTogglePlayPause = useCallback(async () => {
    if (currentVideoType === "youtube") {
      const player = getYTPlayer();
      if (!player) return;

      try {
        const state = player.getPlayerState ? player.getPlayerState() : null;
        const YT = (window as any).YT;

        if (state === YT.PlayerState.PLAYING) {
          player.pauseVideo();
          setIsPlaying(false);
          if (isHost) socketManager.pauseVideo();
        } else {
          player.playVideo();
          setIsPlaying(true);
          if (isHost) {
            const ct = player.getCurrentTime ? player.getCurrentTime() : 0;
            socketManager.playVideo(ct);
          }
        }
      } catch (e) { }
      return;
    }

    if (!videoRef.current) return;

    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
      if (isHost) socketManager.pauseVideo();
    } else {
      try {
        await videoRef.current.play();
        setIsPlaying(true);
        if (isHost) socketManager.playVideo(videoRef.current.currentTime);
      } catch (e: any) {
        if (e?.name === "NotAllowedError") setShowResumeButton(true);
      }
    }
  }, [currentVideoType, isPlaying, isHost]);



  // YouTube utility functions
  const extractYouTubeId = (url: string): string | null => {
    if (!url) return null;

    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/|m\.youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
      /youtube\.com\/watch\?.*v=([a-zA-Z0-9_-]{11})/,
      /youtu\.be\/([a-zA-Z0-9_-]{11})/,
      /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
      /youtube\.com\/v\/([a-zA-Z0-9_-]{11})/
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match && match[1] && match[1].length === 11) {
        return match[1];
      }
    }

    return null;
  };

  // YouTube API loading
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

  // YouTube player management
  const getYTPlayer = () => ytPlayerInstanceRef.current;
  const setYTPlayer = (player: any) => {
    ytPlayerInstanceRef.current = player;
  };

  const recreateYouTubeContainer = useCallback(() => {
    setYoutubeContainerKey(prev => prev + 1);
    ytContainerRef.current = null;
  }, []);

  const createYouTubePlayer = useCallback(async (videoId: string, startTime = 0, autoplay = false) => {
    try {
      await loadYouTubeAPI();
      if (!ytContainerRef.current) return null;

      const existingPlayer = getYTPlayer();
      if (existingPlayer) {
        try {
          existingPlayer.destroy();
          setYTPlayer(null);
        } catch (e) {
        }
      }

      setYtPlayerReady(false);
      setYoutubeError(null);

      if (!ytContainerRef.current) {
        return null;
      }

      const player = new (window as any).YT.Player(ytContainerRef.current, {
        height: "100%",
        width: "100%",
        videoId,
        playerVars: {
          autoplay: autoplay ? 1 : 0,
          controls: 1,
          rel: 0,
          start: Math.floor(startTime),
          enablejsapi: 1,
          origin: window.location.origin,
          playsinline: 1,
          modestbranding: 1,
          showinfo: 0,
          fs: 0,
          cc_load_policy: 0,
          iv_load_policy: 3,
          disablekb: 1,
          color: 'white',
          theme: 'dark'
        },
        events: {
          onReady: (event: any) => {
            setYtPlayerReady(true);
            setIsLoadingVideo(false);

            try {
              const duration = event.target.getDuration();
              if (duration) setDuration(duration);
            } catch (e) { }

            if (autoplay) {
              try {
                event.target.playVideo();
                setIsPlaying(true);
              } catch (e) { }
            }

            setTimeout(() => {
              setYtPlayerReady(true);
            }, 100);
          },
          onStateChange: (event: any) => {
            const state = event.data;
            const YT = (window as any).YT;

            if (state === YT.PlayerState.PLAYING) {
              setIsPlaying(true);
              if (isHost) {
                const currentTime = event.target.getCurrentTime();
                socketManager.playVideo(currentTime);
                socketManager.sendVideoStateSync({
                  metadata: { name: `YouTube Video`, type: "youtube", url: youtubeUrl },
                  playbackState: {
                    currentTime,
                    isPlaying: true,
                    volume,
                    isMuted
                  }
                });
              }
            } else if (state === YT.PlayerState.PAUSED) {
              setIsPlaying(false);
              if (isHost) {
                socketManager.pauseVideo();
                socketManager.sendVideoStateSync({
                  metadata: { name: `YouTube Video`, type: "youtube", url: youtubeUrl },
                  playbackState: {
                    currentTime: event.target.getCurrentTime(),
                    isPlaying: false,
                    volume,
                    isMuted
                  }
                });
              }
            } else if (state === YT.PlayerState.ENDED) {
              setIsPlaying(false);
              if (isHost) {
                socketManager.pauseVideo();
              }
            }

            try {
              const currentTime = event.target.getCurrentTime();
              const duration = event.target.getDuration();
              if (currentTime !== undefined) setCurrentTime(currentTime);
              if (duration !== undefined) setDuration(duration);
            } catch (e) { }
          },
          onError: (event: any) => {
            const errorMessages: { [key: number]: string } = {
              2: "Invalid video ID",
              5: "HTML5 player error",
              100: "Video not found or private",
              101: "Video not allowed to be embedded",
              150: "Video not allowed to be embedded"
            };
            setYoutubeError(errorMessages[event.data] || "Failed to load video");
            setIsLoadingVideo(false);
          }
        }
      });

      setYTPlayer(player);
      return player;
    } catch (error) {
      setYoutubeError("Failed to create YouTube player");
      setIsLoadingVideo(false);
      return null;
    }
  }, [loadYouTubeAPI, isHost]);

  // Handle YouTube URL input
  const handleYouTubeUrlChange = (url: string) => {
    setYoutubeUrl(url);

    if (!url.trim()) {
      setYoutubeVideoId(null);
      setYoutubeError(null);
      return;
    }

    const videoId = extractYouTubeId(url);
    if (!videoId) {
      setYoutubeError("Please enter a valid YouTube URL");
      return;
    }

    setYoutubeVideoId(videoId);
    setYoutubeError(null);

    if (isHost) {
      loadYouTubeVideo(videoId, url);
    }
  };

  const loadYouTubeVideo = async (videoId: string, url: string) => {
    if (!isHost) return;

    setIsLoadingVideo(true);
    setCurrentVideoType("youtube");

    try {
      try { webrtcManager.stopFileStream(); } catch (e) { }
      try { webrtcManager.stopScreenShare(); } catch (e) { }
      setSelectedVideoFile(null);

      const player = await createYouTubePlayer(videoId, 0, true);

      if (player) {
        socketManager.sendVideoMetadata({
          name: `YouTube Video`,
          size: 0,
          type: "youtube",
          url: url
        });

        setTimeout(() => {
          try {
            const currentTime = player.getCurrentTime ? player.getCurrentTime() : 0;
            const playerState = player.getPlayerState ? player.getPlayerState() : 1;
            const isPlaying = playerState === 1;

            socketManager.sendVideoStateSync({
              metadata: { name: `YouTube Video`, type: "youtube", url: url },
              playbackState: {
                currentTime,
                isPlaying,
                volume,
                isMuted
              }
            });
          } catch (e) {
          }
        }, 2000);
      }
    } catch (error) {
      setYoutubeError("Failed to load YouTube video");
      setIsLoadingVideo(false);
    }
  };

  // Generate invite link and room code
  const generateInviteLink = async () => {
    const link = await getInviteLink();
    const code = await getRoomCode();
    setInviteLink(link);
    setInviteRoomCode(code);
    setShowInviteModal(true);
  };

  const getInviteLink = async () => {
    const resolved = await params;
    return `${window.location.origin}/theater/${resolved.roomId}`;
  };

  const getRoomCode = async () => {
    const resolved = await params;
    return resolved.roomId?.toUpperCase() || '';
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const shareOnWhatsApp = () => {
    const text = `Join me for a movie night! Room code: ${inviteRoomCode}\n${inviteLink}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  };

  const shareOnTelegram = () => {
    const text = `Join me for a movie night! Room code: ${inviteRoomCode}\n${inviteLink}`;
    window.open(`https://t.me/share/url?url=${encodeURIComponent(inviteLink)}&text=${encodeURIComponent(text)}`, '_blank');
  };

  const shareOnDiscord = () => {
    copyToClipboard(`Join me for a movie night! Room code: ${inviteRoomCode}\n${inviteLink}`);
  };

  const shareOnTwitter = () => {
    const text = `Join me for a movie night! Room code: ${inviteRoomCode}`;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(inviteLink)}`, '_blank');
  };




const [showRetry, setShowRetry] = useState(false);

useEffect(() => {
  
  const timer = setTimeout(() => {
    const status = webrtcManager.getConnectionStatus();
    if (status.connectedPeers === 0) {
      setShowRetry(true);
    }
  }, 8000);

  return () => clearTimeout(timer);
}, []);

useEffect(() => {
  const t = setInterval(() => {
    const status = webrtcManager.getConnectionStatus();
    setWebrtcStatus(status);

    if (status.connectedPeers > 0) {
      setShowConnectedText(true);
      setShowRetry(false); 
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
    let connectionCheckInterval: NodeJS.Timeout | null = null;



    const init = async () => {
      try {
        const resolved = await params;
        const roomId = resolved.roomId;

        const currentUser = getCurrentUser();
        const token = getToken();
        if (!currentUser || !token) {
          // Store the room ID to redirect after login
          localStorage.setItem('redirectAfterLogin', `/theater/${roomId}`);
          router.push("/auth");
          return;
        }
        setUser(currentUser);

try {
  if (!socketManager.isSocketConnected?.()) {
    socketManager.connect?.({ auth: { token } });
    console.log('___Socket connect requested with token');
  } else if (!socketManager.isSocketAuthenticated?.()) {
    socketManager.authenticateWithToken?.(token);
    console.log('___Requested socket authenticateWithToken');
  } else {
    console.log('___Socket already connected & authenticated');
  }
} catch (err) {
  try {
    socketManager.reconnectWithToken?.(token);
    console.log('___Forced socket reconnect with token');
  } catch (e) {
    console.error('Socket reconnect failed', e);
  }
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
          
          const wasHost = webrtcManager.isHostUser();
          const isNowHost = currentUser.id === room.host?.id;
          
          webrtcManager.setHostStatus(isNowHost);
          webrtcManager.ensureSocketListeners();
          
          if (isNowHost) {
            webrtcManager.ensureConnectionsTo(unique.map(p => p.user.id), currentUser.id);
          } else {
            // For non-host users, establish connection with the host
            const hostId = room.host?.id;
            if (hostId && hostId !== currentUser.id) {
              // Retry connection multiple times for new users
              for (let i = 0; i < 3; i++) {
                setTimeout(() => {
                  if (mounted) {
                    webrtcManager.initializePeerConnection(hostId, false).catch(() => {});
                  }
                }, 1000 + (i * 2000)); // 1s, 3s, 5s delays
              }
            }
          }
          
          setIsLoading(false);
        });
    
        console.log('room info recived ',roomInfo);
        socketManager.onParticipantsChange((parts) => {
          if (!mounted) return;
          const unique = parts.filter((p, i, arr) => i === arr.findIndex(x => x.user.id === p.user.id));
          setParticipants(unique);
          
          if (webrtcManager.isHostUser()) {
            // Host ensures connections to all participants
            webrtcManager.ensureConnectionsTo(unique.map(p => p.user.id), currentUser.id);
          } else {
            // Non-host users ensure connection with host
            const hostId = roomInfo?.host?.id;
            if (hostId && hostId !== currentUser.id) {
              // Check if we need to establish connection with host
              const isConnected = webrtcManager.getConnectedPeers().includes(hostId);
              if (!isConnected) {
                webrtcManager.initializePeerConnection(hostId, false).catch(() => {});
              }
            }
          }
        });

        // Periodic connection check for WebRTC peers
        connectionCheckInterval = setInterval(() => {
          if (!mounted) return;
          
          // If we're the host, check for unconnected peers and retry connections
          //for host only and for the retry method for the rtc 
          if (webrtcManager.isHostUser()) {
            const connectedPeers = webrtcManager.getConnectedPeers();
            const allPeerIds = participants.map(p => p.user.id).filter(id => id !== currentUser.id);
            const unconnectedPeers = allPeerIds.filter(id => !connectedPeers.includes(id));
            
            unconnectedPeers.forEach(peerId => {
              webrtcManager.createOfferWithRetriesPublic(peerId, 2, 1000).catch(() => {});
            });
          } else {
            // For non-host users, ensure connection with host
            const hostId = roomInfo?.host?.id;
            if (hostId && hostId !== currentUser.id) {
              const isConnected = webrtcManager.getConnectedPeers().includes(hostId);
              if (!isConnected) {
                webrtcManager.initializePeerConnection(hostId, false).catch(() => {});
              }
            }
          }
        }, 5000); // Check every 5 seconds for better connection reliability

        socketManager.onMessage((msg) => {
          console.log('Socket message received:___ in threater page ', msg);
          try {
            if (msg.message) {
              const parsed = JSON.parse(msg.message);
              if (parsed?.type === "user-joined") {
                console.log('pier join ________ processing ')
                // When a new user joins, ensure WebRTC connections
                if (webrtcManager.isHostUser()) {
                  console.log('pier join ________ host ensuring connection to new user')
                  // Host should connect to new user
                  const newUserId = msg.user?.id;
                  if (newUserId && newUserId !== currentUser.id) {
                    console.log('host user sending for webrtc connetction ')
                    setTimeout(() => {
                      
                      webrtcManager.ensureConnectionsTo([newUserId], currentUser.id);
                      console.log('host user sending for webrtc connetction timeout ',webrtcManager.ensureConnectionsTo([newUserId], currentUser.id))
                    }, 1000);
                  }
                } else {
                  // Non-host users should ensure connection with host
                  console.log('non host user ')
                  const hostId = roomInfo?.host?.id;
                  if (hostId && hostId !== currentUser.id) {
                    console.log('non host user user sending for webrtc connetction ')
                    const isConnected = webrtcManager.getConnectedPeers().includes(hostId);
                    if (!isConnected) {
                      setTimeout(() => {
                        webrtcManager.initializePeerConnection(hostId, false).catch(() => {});
                      }, 1000);
                    }
                  }
                }
                return;
              }

              if (parsed?.type === "refresh-page") {
                const isFromSelf = msg.user?.id === user?.id;

                if (!isFromSelf) {
                  window.location.reload();
                  return;
                }
              }
            }
          } catch (e) {
          }
          if (msg.type === "voice" && msg.audioUrl) {
            if (messages.find(m => m.audioUrl === msg.audioUrl)) return;
          }
          setMessages(prev => [...prev, msg]);
          if (!isChatVisible && msg.user?.id !== user?.id) setUnreadCount(c => c + 1);
        });

        socketManager.onVideoControl((data) => handleVideoControl(data));

        socketManager.onVideoMetadata((metadata) => {
          if (!mounted) return;

          const shouldProcessMetadata = metadata.type === "youtube" || !isHost;

          if (shouldProcessMetadata) {
            if (metadata.type === "youtube") {
              const id = extractYouTubeId(metadata.url || "");
              if (id) {
                setYoutubeVideoId(id);
                setYoutubeUrl(metadata.url || "");
                setCurrentVideoType("youtube");
                setYoutubeError(null);

                createYouTubePlayer(id, 0, false)
                  .then((player) => {
                    if (player) {
                      setTimeout(() => socketManager.sendVideoStateRequest(), 1000);
                      setTimeout(() => socketManager.sendVideoStateRequest(), 2000);
                    }
                  })
                  .catch((e) => {
                    setYoutubeError("Failed to load YouTube video");
                  });
              }
            } else if (metadata.type === "screen") {
              const existingPlayer = getYTPlayer();
              if (existingPlayer) {
                try {
                  existingPlayer.destroy();
                  setYTPlayer(null);
                } catch (e) {
                }
              }
              recreateYouTubeContainer();
              setYtPlayerReady(false);
              setYoutubeVideoId(null);
              setYoutubeUrl("");
              setYoutubeError(null);
              setCurrentVideoType("screen");
            } else if (metadata.type === "file" || metadata.type.startsWith("video/")) {
              const existingPlayer = getYTPlayer();
              if (existingPlayer) {
                try {
                  existingPlayer.destroy();
                  setYTPlayer(null);
                } catch (e) {
                }
              }
              recreateYouTubeContainer();
              setYtPlayerReady(false);
              setYoutubeVideoId(null);
              setYoutubeUrl("");
              setYoutubeError(null);
              setCurrentVideoType("file");
            } else if (metadata.type === "stopped") {
              const existingPlayer = getYTPlayer();
              if (existingPlayer) {
                try {
                  existingPlayer.destroy();
                  setYTPlayer(null);
                } catch (e) {
                }
              }
              recreateYouTubeContainer();
              setYtPlayerReady(false);
              setCurrentVideoType(null);
              setYoutubeVideoId(null);
              setYoutubeUrl("");
              setYoutubeError(null);
            }

            if (videoRef.current && metadata.type !== "youtube") {
              try { webrtcManager.setVideoElement(videoRef.current); } catch { }
            }

            if (metadata.type !== "youtube") {
              for (let i = 0; i < 4; i++) {
                setTimeout(() => socketManager.sendVideoStateRequest(), 300 * i + 200);
              }
            }
          }
        });

        socketManager.onVideoStateSync((data) => {
          if (!mounted) return;
          const vs = data.videoState || data;
          const metadata = vs.metadata || data.metadata;
          const playback = vs.playbackState || data.playbackState;

          const isFromOtherUser = data.from && data.from !== user?.id;
          const shouldProcessSync = !isHost && isFromOtherUser && metadata && playback && data.from;

          if (shouldProcessSync) {
            if (metadata.type === "youtube") {
              setCurrentTime(playback.currentTime || 0);
              setIsPlaying(playback.isPlaying || false);
              setVolume(playback.volume || 1);
              setIsMuted(playback.isMuted || false);

              const player = getYTPlayer();

              if (player && ytPlayerReady) {
                try {
                  if (playback.volume !== undefined) {
                    player.setVolume((playback.volume || 1) * 100);
                  }

                  if (playback.isMuted) {
                    player.mute();
                  } else {
                    player.unMute();
                  }

                  if (playback.isPlaying) {
                    player.seekTo(playback.currentTime || 0, true);
                    player.playVideo();
                    setIsPlaying(true);
                  } else {
                    player.seekTo(playback.currentTime || 0, true);
                    player.pauseVideo();
                    setIsPlaying(false);
                  }
                } catch (e) {
                }
              } else {
                setTimeout(() => {
                  const retryPlayer = getYTPlayer();
                  if (retryPlayer) {
                    try {
                      if (playback.isPlaying) {
                        retryPlayer.seekTo(playback.currentTime || 0, true);
                        retryPlayer.playVideo();
                        setIsPlaying(true);
                      } else {
                        retryPlayer.seekTo(playback.currentTime || 0, true);
                        retryPlayer.pauseVideo();
                        setIsPlaying(false);
                      }
                    } catch (e) {
                    }
                  }
                }, 1000);
              }
            } else {
              setCurrentVideoType(metadata.type === "screen" ? "screen" : "file");
              if (videoRef.current) webrtcManager.setVideoElement(videoRef.current);
              if (playback?.isPlaying) {
                setTimeout(() => {
                  tryPlayVideo().catch(() => {
                    setShowResumeButton(true);
                  });
                }, 300);
              }
            }
          }
        });

        socketManager.joinRoom(roomId);

        const resp = await fetch(`${API_BASE_URL}/api/rooms/${roomId}`, { headers: { Authorization: `Bearer ${token}` } });
        const data = await resp.json();
        console.log("Join room response:", data);
        if (data.success) {
          setRoomInfo(data.room);
          setParticipants(data.room.participants || []);

          if (currentUser.id !== data.room.host?.id) {
            // For non-host users, establish WebRTC connection with host
            const hostId = data.room.host?.id;
            if (hostId) {
              // Retry connection multiple times for new users
              for (let i = 0; i < 4; i++) {
                setTimeout(() => {
                  if (mounted) {
                    webrtcManager.initializePeerConnection(hostId, false).catch(() => {});
                  }
                }, 1000 + (i * 2000)); // 1s, 3s, 5s delays
              }
            }
            
            // Request video state multiple times
            setTimeout(() => {
              for (let i = 0; i < 5; i++) {
                setTimeout(() => socketManager.sendVideoStateRequest(), 500 * i);
              }
            }, 1000);
          }
        }
      } catch (e) {
        if (mounted) {
          setError("Failed to join room");
          setIsLoading(false);
        }
      }
    };

    init();
    return () => {
      mounted = false;

      const existingPlayer = getYTPlayer();
      if (existingPlayer) {
        try {
          existingPlayer.destroy();
          setYTPlayer(null);
        } catch (e) {
        }
      }

      setYoutubeContainerKey(0);

      // Clear the connection check interval
      if (connectionCheckInterval) {
        clearInterval(connectionCheckInterval);
      }

      socketManager.leaveRoom();
      webrtcManager.cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, router]);

  const handleVideoControl = (data: any) => {
    if (!data) return;

    console.log("Non-host received video control:", data);

    if (data.type && currentVideoType === "youtube") {
      const player = getYTPlayer();
      if (!player) {
        console.warn("YouTube player not available for control");
        return;
      }

      try {
        if (data.type === "play") {
          player.seekTo(data.currentTime || 0, true);
          player.playVideo();
          setIsPlaying(true);
          setCurrentTime(data.currentTime || 0);
        } else if (data.type === "pause") {
          player.pauseVideo();
          setIsPlaying(false);
        } else if (data.type === "seek") {
          player.seekTo(data.time || 0, true);
          setCurrentTime(data.time || 0);
        }
      } catch (e) {
        console.error("YouTube control error:", e);
      }
      return;
    }

    if (!videoRef.current) return;

    try {
      if (data.type === "play") {
        videoRef.current.currentTime = data.currentTime || 0;
        videoRef.current.play().catch(() => {
          if (currentVideoType !== "youtube") {
            setShowResumeButton(true);
          }
        });
        setIsPlaying(true);
      } else if (data.type === "pause") {
        videoRef.current.pause();
        setIsPlaying(false);
      } else if (data.type === "seek") {
        videoRef.current.currentTime = data.time || 0;
      }
    } catch (e) {
      console.error("handleVideoControl", e);
    }
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
      if (currentVideoType === "youtube" && youtubeVideoId) {
        socketManager.sendMessage(JSON.stringify({ type: "refresh-page", reason: "youtube-to-screen" }), false);
      }
      setYoutubeUrl("");
      setYoutubeVideoId(null);
      setYoutubeError(null);
      recreateYouTubeContainer();

      setIsLoadingVideo(true);

      const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      if (isMobile) {
        setError("Screen sharing is not supported on mobile devices. Please use a desktop browser.");
        return;
      }

      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        setError("Screen sharing is not supported in this browser.");
        return;
      }

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
      if (e.name === "NotAllowedError") {
        setError("Screen share permission denied. Please allow screen sharing and try again.");
      } else if (e.name === "NotSupportedError") {
        setError("Screen sharing is not supported in this browser.");
      } else {
        setError("Screen share failed. Please try again.");
      }
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
    } catch (e) { }
  };

  const handleSelectVideo = () => {
    if (currentVideoType === "youtube" && youtubeVideoId) {
      socketManager.sendMessage(JSON.stringify({ type: "refresh-page", reason: "youtube-to-file" }), false);
    }
    setYoutubeUrl("");
    setYoutubeVideoId(null);
    setYoutubeError(null);
    recreateYouTubeContainer();

    fileInputRef.current?.click();
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("video/")) { setError("Please select a video file"); return; }


    setYoutubeUrl("");
    setYoutubeVideoId(null);
    setYoutubeError(null);
    recreateYouTubeContainer();

    setSelectedVideoFile(file);
    setCurrentVideoType("file");
    setIsLoadingVideo(true);
    try { webrtcManager.stopFileStream(); } catch { }
    setTimeout(() => {
      socketManager.sendVideoMetadata({ name: file.name, size: file.size, type: file.type, url: "p2p" });
      if (isHost && videoRef.current) {
        try {
          webrtcManager.streamVideoFile(file, videoRef.current).catch((err) => { });
        } catch (e) { }
      }
    }, 200);
    setIsLoadingVideo(false);
  };

  // Periodic state broadcasting for YouTube (host only)
  useEffect(() => {
    if (!isHost || currentVideoType !== "youtube" || !ytPlayerReady) return;

    const broadcastState = () => {
      const player = getYTPlayer();
      if (player) {
        try {
          const currentTime = player.getCurrentTime();
          const playerState = player.getPlayerState();
          const isPlaying = playerState === 1;

          socketManager.sendVideoStateSync({
            metadata: { name: `YouTube Video`, type: "youtube", url: youtubeUrl },
            playbackState: {
              currentTime,
              isPlaying,
              volume,
              isMuted
            }
          });
        } catch (e) {
        }
      }
    };

    const interval = setInterval(broadcastState, 10000);

    return () => clearInterval(interval);
  }, [isHost, currentVideoType, ytPlayerReady, youtubeUrl, volume, isMuted]);

  // Handle video state requests from non-host users
  useEffect(() => {
    if (!isHost) return;

    const handleStateRequest = () => {
      if (currentVideoType === "youtube" && ytPlayerReady) {
        const player = getYTPlayer();
        if (player) {
          try {
            const currentTime = player.getCurrentTime();
            const playerState = player.getPlayerState();
            const isPlaying = playerState === 1;

            socketManager.sendVideoStateSync({
              metadata: { name: `YouTube Video`, type: "youtube", url: youtubeUrl },
              playbackState: {
                currentTime,
                isPlaying,
                volume,
                isMuted
              }
            });
          } catch (e) {
          }
        }
      }
    };

    const cleanup = socketManager.onHostVideoStateRequest?.(handleStateRequest);
    return cleanup;
  }, [isHost, currentVideoType, ytPlayerReady, youtubeUrl, volume, isMuted]);

  // YouTube time tracking
  useEffect(() => {
    if (currentVideoType !== "youtube" || !ytPlayerReady) return;

    const updateTime = () => {
      const player = getYTPlayer();
      if (player) {
        try {
          const currentTime = player.getCurrentTime();
          const duration = player.getDuration();
          if (currentTime !== undefined) setCurrentTime(currentTime);
          if (duration !== undefined) setDuration(duration);
        } catch (e) {
        }
      }
    };

    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, [currentVideoType, ytPlayerReady]);

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
      try { webrtcManager.setVideoElement(videoRef.current); } catch (e) { }
    }
  }, [isHost]);





  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    setVolume(v);
    setIsMuted(v === 0);

    if (currentVideoType === "youtube") {
      const player = getYTPlayer();
      if (player) {
        try {
          player.setVolume(v * 100);
          if (v === 0) {
            player.mute();
          } else {
            player.unMute();
          }
        } catch (e) {
        }
      }
      return;
    }

    if (isHost) {
      webrtcManager.setLocalVolume(v);
    } else if (videoRef.current) {
      videoRef.current.volume = v;
    }
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
      setShowResumeButton(false);
    } catch (e: any) {
      if (e?.name === "NotAllowedError") setShowResumeButton(true);
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

  // Keyboard controls
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {

      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          handleTogglePlayPause();
          showControlsTemporarily();
          break;
        case 'KeyF':
          e.preventDefault();
          handleToggleFullscreen();
          showControlsTemporarily();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          seekBackward();
          showControlsTemporarily();
          break;
        case 'ArrowRight':
          e.preventDefault();
          seekForward();
          showControlsTemporarily();
          break;
        case 'ArrowUp':
          e.preventDefault();
          volumeUp();
          showControlsTemporarily();
          break;
        case 'ArrowDown':
          e.preventDefault();
          volumeDown();
          showControlsTemporarily();
          break;
        case 'KeyM':
          e.preventDefault();
          handleToggleMute();
          showControlsTemporarily();
          break;
        case 'KeyI':
          e.preventDefault();
          handleToggleChat();
          showControlsTemporarily();
          break;
      }
    };

    document.addEventListener('keydown', handleKeyPress);
    return () => document.removeEventListener('keydown', handleKeyPress);
  }, [handleTogglePlayPause, handleToggleFullscreen, seekBackward, seekForward, volumeUp, volumeDown, handleToggleMute, handleToggleChat, showControlsTemporarily]);

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

          setAudioBlob(null);
          setRecordingTime(0);
          clearTimeout(timeoutId);
        } catch (sendError) {
          setMessages(prev => prev.map(msg => msg.id === voiceMessageId ? { ...msg, failed: true } : msg));
          throw sendError;
        }
      } catch (error) {
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
      // Cleanup controls timeout
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
    };

  }, []);

  // Show controls initially and when video starts playing
  useEffect(() => {
    showControlsTemporarily();
  }, [currentVideoType, showControlsTemporarily]);

  // Handle click outside chat to close it
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;

      // Check if click is on chat toggle button or its children
      const chatToggleButton = document.querySelector('[title="Toggle chat"]');
      const isClickOnToggleButton = chatToggleButton && (
        chatToggleButton.contains(target) ||
        chatToggleButton === target
      );

      if (isChatVisible &&
        chatContainerRef.current &&
        !chatContainerRef.current.contains(target) &&
        !isClickOnToggleButton &&
        !isFloatingMode) {
        setIsChatVisible(false);
      }
    };

    if (isChatVisible && !isFloatingMode) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isChatVisible, isFloatingMode]);

  useEffect(() => {
    if (!isHost && user && roomInfo && currentVideoType !== "youtube") {

      const timer = setTimeout(() => {
        setShowResumeButton(true);
      }, 2000);

      return () => clearTimeout(timer);
    }
  }, [isHost, user, roomInfo, currentVideoType]);


  useEffect(() => {
    if (isPlaying) {
      setShowResumeButton(false);
    }
  }, [isPlaying]);


  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      /* Hide YouTube branding and unwanted elements */
      .ytp-chrome-top,
      .ytp-show-cards-title,
      .ytp-watermark,
      .ytp-gradient-top,
      .ytp-chrome-top-buttons,
      .ytp-cards-button,
      .ytp-endscreen-element,
      .ytp-ce-element,
      .ytp-suggested-action,
      .ytp-pause-overlay,
      .ytp-share-button-visible,
      .ytp-watch-later-button,
      .ytp-miniplayer-button,
      .ytp-remote-button,
      .ytp-size-button,
      .ytp-subtitles-button,
      .ytp-settings-button,
      .ytp-pip-button,
      .ytp-overflow-button,
      .ytp-youtube-button,
      .ytp-endscreen-content,
      .ytp-ce-covering-overlay,
      .ytp-ce-element-shadow,
      .ytp-ce-covering-image,
      .ytp-cards-teaser,
      .ytp-cards-button-icon,
      .ytp-cards-button-icon-default {
        display: none !important;
      }
      
      /* Hide YouTube title and channel info */
      .ytp-title-channel,
      .ytp-title-expanded-heading,
      .ytp-title-expanded-content {
        display: none !important;
      }

      /* Mobile viewport optimization */
      :root {
        --vh: 1vh;
      }
      
      @media (max-width: 768px) {
        html, body {
          overflow-x: hidden;
          -webkit-overflow-scrolling: touch;
          height: calc(var(--vh, 1vh) * 100);
        }
        
        /* Prevent zoom on input focus */
        input, select, textarea {
          font-size: 16px !important;
        }
        
                 /* Video container optimization */
         video {
           width: 100% !important;
           height: 100% !important;
           object-fit: contain !important;
         }
        
        .theater-container {
          height: calc(var(--vh, 1vh) * 100) !important;
        }
      }

      /* Fullscreen video optimization */
      .video-fullscreen {
        width: 100vw !important;
        height: 100vh !important;
        object-fit: cover !important;
      }
      
      /* Fix video aspect ratio issues */
      .video-container {
        position: relative;
        width: 100%;
        height: 100%;
        background: #000;
      }
      
             .video-container video,
       .video-container iframe {
         position: absolute;
         top: 0;
         left: 0;
         width: 100%;
         height: 100%;
         object-fit: contain;
       }
    `;

    document.head.appendChild(style);

    return () => {
      try {
        if (document.head.contains(style)) {
          document.head.removeChild(style);
        }
      } catch (e) {
      }
    };
  }, []);


  useEffect(() => {
    if (currentVideoType !== "youtube") {
      const existingPlayer = getYTPlayer();
      if (existingPlayer) {
        try {
          existingPlayer.destroy();
          setYTPlayer(null);
          setYtPlayerReady(false);
        } catch (e) {
        }
      }

      recreateYouTubeContainer();
    }
  }, [currentVideoType, recreateYouTubeContainer]);

  useEffect(() => {
    if (!isHost && user && roomInfo) {
      for (let i = 0; i < 3; i++) {
        setTimeout(() => {
          socketManager.sendVideoStateRequest();
        }, 1000 * i + 1000);
      }
    }
  }, [isHost, user, roomInfo]);

  useEffect(() => {
    if (currentVideoType !== "youtube") return;

    const updateYouTubeTime = () => {
      const player = getYTPlayer();
      if (player && player.getCurrentTime && player.getDuration) {
        try {
          const currentTime = player.getCurrentTime();
          const duration = player.getDuration();
          setCurrentTime(currentTime);
          setDuration(duration);
        } catch (e) {
        }
      }
    };

    const interval = setInterval(updateYouTubeTime, 1000);
    return () => clearInterval(interval);
  }, [currentVideoType, youtubeVideoId]);

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
    <div className="theater-container min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 overflow-hidden relative">
      {/* Animated background elements */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-purple-500/10 rounded-full blur-3xl animate-pulse"></div>
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-blue-500/10 rounded-full blur-3xl animate-pulse" style={{animationDelay: '2s'}}></div>
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-indigo-500/5 rounded-full blur-3xl animate-pulse" style={{animationDelay: '4s'}}></div>
      </div>

    <div className="fixed top-4 left-4 z-50">
  {showConnectedText ? (
    <div className="px-3 py-2 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 text-white text-xs font-medium shadow-xl backdrop-blur-sm border border-emerald-400/20 animate-fade-in">
      ✓ Connected
    </div>
  ) : showRetry ? (
    <button
      onClick={() => window.location.reload()}
      className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-600/90 hover:bg-red-700 text-white text-xs font-medium shadow-lg backdrop-blur-sm border border-red-400/20 animate-fade-in"
    >
      <AlertTriangle className="w-4 h-4" />
      Retry Connect
      <RotateCcw className="w-4 h-4" />
    </button>
  ) : (
    <div
      className={`w-3 h-3 rounded-full shadow-xl transition-all duration-500 ${
        webrtcStatus?.connectedPeers > 0
          ? "bg-emerald-500 animate-ping"
          : "bg-red-500"
      }`}
    />
  )}
</div>


      <header className="bg-gradient-to-r from-slate-800/90 via-slate-700/90 to-slate-800/90 border-b border-slate-600/30 px-2 sm:px-4 py-2 sm:py-3 backdrop-blur-md shadow-lg">
        <div className="flex items-center justify-between">
          <Link href="/rooms" className="flex items-center space-x-1 sm:space-x-2 group transition-all duration-500 hover:scale-105">
            <Play className="h-5 w-5 sm:h-6 sm:w-6 text-emerald-400 group-hover:text-emerald-300 transition-all duration-500 group-hover:rotate-12" />
            <span className="text-sm sm:text-lg font-bold bg-gradient-to-r from-emerald-400 via-teal-300 to-cyan-400 bg-clip-text text-transparent">CinemaSync</span>
          </Link>
                     <div className="flex items-center space-x-1 sm:space-x-4">
             {/* Participant Avatars - Desktop Only */}
             <div className="hidden lg:flex items-center space-x-2">
               {participants.slice(0, 4).map((participant, index) => (
                 <Avatar 
                   key={participant.user.id} 
                   className={`h-6 w-6 border-2 transition-all duration-300 hover:scale-110 shadow-lg ${
                     participant.user.id === user?.id 
                       ? 'border-emerald-400 ring-2 ring-emerald-400/30' 
                       : 'border-slate-500/50'
                   }`}
                   title={participant.user.name}
                 >
                   <AvatarImage src={participant.user.picture || "/placeholder.svg"} />
                   <AvatarFallback className="text-xs bg-gradient-to-br from-slate-600 to-slate-700 text-white">
                     {participant.user.name?.split(" ").map((n: string) => n[0]).join("").slice(0, 2)}
                   </AvatarFallback>
                 </Avatar>
               ))}
               {participants.length > 4 && (
                 <div className="h-6 w-6 rounded-full bg-gradient-to-r from-slate-600 to-slate-700 border-2 border-slate-500/50 flex items-center justify-center text-xs text-white font-medium shadow-lg">
                   +{participants.length - 4}
                 </div>
               )}
             </div>

             <span className="px-2 sm:px-3 py-1 sm:py-1.5 bg-gradient-to-r from-emerald-600/20 to-teal-600/20 text-emerald-300 text-xs sm:text-sm rounded-full flex items-center border border-emerald-500/30 backdrop-blur-sm shadow-lg transition-all duration-300 hover:scale-105">
               <Users className="mr-1 h-3 w-3" />{participants.length}/5
             </span>
             {isHost && (
               <span className="hidden sm:flex px-3 py-1.5 bg-gradient-to-r from-amber-600/20 to-orange-600/20 text-amber-300 text-sm rounded-full items-center border border-amber-500/30 backdrop-blur-sm shadow-lg animate-pulse">
                 <Crown className="mr-1 h-3 w-3" />Host
               </span>
             )}
             <Button
               variant="outline"
               size="sm"
               onClick={generateInviteLink}
               className="text-white border-slate-500/50 hover:bg-slate-600/30 bg-slate-800/50 backdrop-blur-sm transition-all duration-500 hover:scale-105 hover:border-slate-400 text-xs sm:text-sm px-2 sm:px-3 shadow-lg"
             >
               <Users className="mr-1 sm:mr-2 h-3 w-3 sm:h-4 sm:w-4" />
               <span className="inline">Invite</span>
             </Button>
             {user && (
               <Avatar className="h-6 w-6 sm:h-8 sm:w-8 border-2 border-emerald-400 hover:border-emerald-300 transition-all duration-500 hover:scale-110 shadow-xl">
                 <AvatarImage src={user.picture || "/placeholder.svg"} />
                 <AvatarFallback className="text-xs bg-gradient-to-br from-emerald-600 to-teal-700 text-white">
                   {user.name?.split(" ").map((n: string) => n[0]).join("").slice(0, 2)}
                 </AvatarFallback>
               </Avatar>
             )}
           </div>
        </div>
      </header>

      {isHost && (
        <div className="bg-gradient-to-r from-slate-800/80 via-slate-700/80 to-slate-800/80 border-b border-slate-600/20 px-2 sm:px-4 py-2 sm:py-3 backdrop-blur-md shadow-lg">
          <div className="flex gap-1 sm:gap-2 w-full">
            {/* YouTube Input + Icon Section - 70% mobile, 60% desktop */}
            <div className="flex gap-1 sm:gap-2 w-full sm:w-full">
              <div className="relative flex-1">
                <Input
                  placeholder="YouTube URL..."
                  value={youtubeUrl}
                  onChange={(e) => handleYouTubeUrlChange(e.target.value)}
                  className={`bg-slate-700/50 border-slate-500 text-white placeholder:text-slate-400 pr-8 backdrop-blur-sm transition-all duration-500 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 text-xs sm:text-sm h-8 sm:h-10 shadow-lg ${youtubeError ? 'border-red-500 focus:border-red-400' :
                    youtubeVideoId ? 'border-emerald-500 focus:border-emerald-400' : ''
                    }`}
                  disabled={isLoadingVideo}
                />
                {isLoadingVideo && (
                  <div className="absolute right-2 top-1/2 transform -translate-y-1/2">
                    <Loader2 className="h-3 w-3 sm:h-4 sm:w-4 animate-spin text-purple-400" />
                  </div>
                )}
                {youtubeError && (
                  <div className="absolute top-full left-0 mt-1 text-xs text-red-400 bg-red-900/30 px-2 py-1 rounded z-10 border border-red-500/20 backdrop-blur-sm animate-pulse">
                    {youtubeError}
                  </div>
                )}
                {youtubeVideoId && !youtubeError && (
                  <div className="absolute top-full left-0 mt-1 text-xs text-green-400 bg-green-900/30 px-2 py-1 rounded z-10 border border-green-500/20 backdrop-blur-sm animate-pulse">
                    ✓ Valid
                  </div>
                )}
              </div>

              {/* YouTube Status Icon */}
              <div className={`flex items-center px-2 rounded border backdrop-blur-sm transition-all duration-500 shadow-lg ${youtubeVideoId && !youtubeError
                ? 'bg-emerald-600/20 border-emerald-500/30 animate-pulse'
                : 'bg-red-600/20 border-red-500/30'
                }`}>
                <Youtube className={`h-3 w-3 sm:h-4 sm:w-4 transition-all duration-500 ${youtubeVideoId && !youtubeError ? 'text-emerald-400' : 'text-red-400'
                  }`} />
              </div>
            </div>

            {/* Buttons Section - 30% mobile, 40% desktop */}
            <div className="w-[20%] sm:w-[30%]">
              {/* Desktop: Show both buttons */}
              <div className="hidden sm:flex gap-2 w-full">
                <Button
                  onClick={handleShareScreen}
                  disabled={isLoadingVideo}
                  className="bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 transition-all duration-300 transform hover:scale-105 shadow-lg hover:shadow-blue-500/25 text-[2.4vh] px-0 h-8 sm:h-10 flex-1"
                >
                  <Monitor className="mr-1 h-3  w-3 sm:h-4 sm:w-4" />
                  <span >Share Screen</span>
                </Button>
                <Button
                  onClick={handleSelectVideo}
                  disabled={isLoadingVideo}
                  className="bg-gradient-to-r from-green-600 to-green-700 hover:from-green-500 hover:to-green-600 transition-all duration-300 transform hover:scale-105 shadow-lg hover:shadow-green-500/25  text-[2.4vh] px-3 h-8 sm:h-10 flex-1"
                >
                  <Video className="mr-1 h-3 w-3 sm:h-4 sm:w-4" />
                  <span>Select Video</span>
                </Button>
              </div>

              {/* Mobile: Show only Select Video button */}
              <div className="sm:hidden w-full">
                <Button
                  onClick={handleSelectVideo}
                  disabled={isLoadingVideo}
                  className="bg-gradient-to-r from-green-600 to-green-700 hover:from-green-500 hover:to-green-600 transition-all duration-300 transform hover:scale-105 shadow-lg hover:shadow-green-500/25 text-[21%] px-2 h-8 w-full"
                >
                  <Video className="mr-0 h-3 w-3" />
                  <span>Video</span>
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <input ref={fileInputRef} type="file" accept="video/*" onChange={handleFileSelect} className="hidden" />

             <div className={`flex flex-col lg:flex-row ${isHost ? 'h-[calc(100vh-200px)] md:h-[calc(100vh-160px)]' : 'h-[calc(100vh-120px)]'}`}>
         <div
           ref={videoContainerRef}
           className="video-container flex-1 bg-black relative cursor-pointer overflow-hidden min-h-[40vh] lg:min-h-0"
          onMouseMove={handleVideoContainerInteraction}
          onTouchStart={handleVideoContainerInteraction}
          onClick={handleVideoContainerInteraction}
        >
          <div className="absolute inset-0 bg-black flex items-center justify-center">
            {currentVideoType === "youtube" && youtubeVideoId ? (
              <div key={youtubeContainerKey} className="w-full h-full" suppressHydrationWarning={true}>
                <div
                  ref={ytContainerRef}
                  className="w-full h-full"
                  suppressHydrationWarning={true}
                />
              </div>
            ) : (
                             <video
                 ref={bindVideo as any}
                 className="w-full h-full object-contain bg-black"
                 autoPlay
                 playsInline
                 style={{ objectFit: 'contain' }}
               />
            )}
          </div>

          {/* Video Controls with Auto-hide */}
         <div className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent p-2 sm:p-4 transition-all duration-300 ${
    showControls ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2 pointer-events-none"
  }`}
>
  <div
    ref={progressBarRef}
    className="w-full h-2 sm:h-3 bg-gray-700/80 rounded-full mb-2 sm:mb-4 cursor-pointer overflow-hidden"
    onClick={handleProgressBarClick}
  >
    <div
      className="h-full bg-gradient-to-r from-purple-500 to-pink-500 rounded-full transition-all duration-300 shadow-lg shadow-purple-500/30"
      style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }}
    />
  </div>

  <div className="flex flex-1 items-center justify-between ">
    <div className="flex items-center gap-0 sm:gap-2 md:gap-3 flex-wrap">
      {/* Play/Pause */}
      <Button
        variant="ghost"
        size="sm"
        onClick={handleTogglePlayPause}
        className="text-white hover:bg-white/20 transition-all duration-300 hover:scale-110 rounded-full p-0.5 sm:p-1 md:p-2"
        title="Play/Pause (Space)"
      >
        {isPlaying ? (
          <Pause className="h-3 w-3 sm:h-4 sm:w-4 md:h-5 md:w-5" />
        ) : (
          <Play className="h-3 w-3 sm:h-4 sm:w-4 md:h-5 md:w-5" />
        )}
      </Button>

      {/* Seek Backward */}
      <Button
        variant="ghost"
        size="sm"
        onClick={seekBackward}
        className="text-white hover:bg-white/20 transition-all duration-300 hover:scale-110 rounded-full p-0.5 sm:p-1 md:p-2"
        title="Seek backward 30s (←)"
      >
        <SkipBack className="h-3 w-3 sm:h-4 sm:w-4 md:h-5 md:w-5" />
      </Button>

      {/* Seek Forward */}
      <Button
        variant="ghost"
        size="sm"
        onClick={seekForward}
        className="text-white hover:bg-white/20 transition-all duration-300 hover:scale-110 rounded-full p-0.5 sm:p-1 md:p-2"
        title="Seek forward 30s (→)"
      >
        <SkipForward className="h-3 w-3 sm:h-4 sm:w-4 md:h-5 md:w-5" />
      </Button>

      {/* Volume */}
      <div className="flex items-center gap-0 sm:gap-1 md:gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleToggleMute}
          className="text-white hover:bg-white/20 transition-all duration-300 hover:scale-110 rounded-full p-0 m-0"
          title="Mute/Unmute (M)"
        >
          {isMuted ? (
            <VolumeX className="h-3 w-3 sm:h-4 sm:w-4 md:h-5 md:w-5" />
          ) : (
            <Volume2 className="h-3 w-3 sm:h-4 sm:w-4 md:h-5 md:w-5" />
          )}
        </Button>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={volume}
          onChange={handleVolumeChange}
          className="w-16 sm:w-16 md:w-30 h-1 sm:h-1.5 md:h-2 bg-gray-600/80 rounded-lg appearance-none cursor-pointer"
          title="Volume (↑↓)"
          style={{
            background: `linear-gradient(to right, rgb(168 85 247) 0%, rgb(168 85 247) ${
              volume * 100
            }%, rgb(75 85 99 / 0.8) ${volume * 100}%, rgb(75 85 99 / 0.8) 100%)`,
          }}
        />
      </div>

      {/* Time */}
      <div className="hidden md:block text-white text-sm font-medium bg-black/50 px-2 md:px-3 py-1 rounded-lg">
        {formatTime(currentTime)} / {formatTime(duration)}
      </div>
    </div>

    {/* Right side buttons */}
    <div className="flex items-center justify-end  ml-5 gap-0 sm:gap-1 md:gap-2">
      <div className="md:hidden text-white text-xs font-medium bg-black/50 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded text-[10px] sm:text-xs">
        {formatTime(currentTime)}
      </div>

      <Button
        variant="ghost"
        size="sm"
        onClick={handleToggleFullscreen}
        className="text-white hover:bg-white/20 transition-all duration-300 hover:scale-110 rounded-full p-0.5 sm:p-0 md:p-2"
        title="Fullscreen (F)"
      >
        <Maximize className="h-3 w-3 sm:h-4 sm:w-4 md:h-5 md:w-5" />
      </Button>

      {/* Mobile landscape */}
      <button
        className="md:hidden inline-flex items-center justify-center p-0.5 sm:p-1 rounded-full bg-white/10 hover:bg-white/20 text-white transition-all duration-300 hover:scale-110"
        onClick={() => {
          if (!document.fullscreenElement) {
            videoContainerRef.current?.requestFullscreen().catch(() => {});
          }
          try {
            (screen as any).orientation?.lock?.("landscape");
          } catch {}
        }}
        title="Mobile landscape"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden
        >
          <rect
            x="6"
            y="3"
            width="12"
            height="18"
            rx="2"
            stroke="currentColor"
            strokeWidth="1.2"
          />
          <path
            d="M9 7 L15 7"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  </div>
</div>

          {currentVideoType === "screen" && isHost && (
            <div className="absolute top-18 right-4">
              <Button
                onClick={handleStopScreenShare}
                variant="destructive"
                size="sm"
                className="bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 transition-all duration-300 transform hover:scale-105 shadow-lg hover:shadow-red-500/25 animate-pulse"
              >
                <StopCircle className="mr-2 h-4 w-4" />Stop Sharing
              </Button>
            </div>
          )}

          {/* Simple Resume Button - shows after refresh for non-host users (non-YouTube only) */}
          {showResumeButton && !isHost && currentVideoType !== "youtube" && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm z-10">
              <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-xl p-6 text-center border border-purple-500/20 shadow-2xl">
                <p className="text-white mb-4 text-lg">Resume Playing</p>
                <Button
                  onClick={() => {
                    setShowResumeButton(false);
                    handleTogglePlayPause();
                  }}
                  className="bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-500 hover:to-purple-600 transition-all duration-300 transform hover:scale-105 shadow-lg hover:shadow-purple-500/25"
                >
                  <Play className="mr-2 h-4 w-4" /> Resume
                </Button>
              </div>
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
             onVideoVolumeChange={handleVideoVolumeChange}
             currentVideoVolume={volume}
             socketManager={socketManager}
             webrtcManager={webrtcManager}
             unreadCount={unreadCount}
             onMarkAsRead={handleMarkAsRead}
             messageInputRef={messageInputRef}
             chatContainerRef={chatContainerRef}
           />

         </div>

         {/* Mobile Participant Avatars Card */}
         <div className="lg:hidden bg-gradient-to-r from-slate-800/90 to-slate-700/90 border-t border-slate-600/30 p-3 backdrop-blur-md shadow-lg">
           <div className="flex items-center justify-between mb-2">
             <span className="text-sm font-medium text-slate-300">Participants ({participants.length})</span>
             <span className="text-xs text-slate-400">{participants.length}/5</span>
           </div>
           <div className="flex items-center space-x-2 overflow-x-auto no-scrollbar">
             {participants.map((participant) => (
               <div key={participant.user.id} className="flex flex-col items-center space-y-1 min-w-0">
                 <Avatar 
                   className={`h-10 w-10 border-2 transition-all duration-300 hover:scale-110 shadow-lg ${
                     participant.user.id === user?.id 
                       ? 'border-emerald-400 ring-2 ring-emerald-400/30' 
                       : 'border-slate-500/50'
                   }`}
                   title={participant.user.name}
                 >
                   <AvatarImage src={participant.user.picture || "/placeholder.svg"} />
                   <AvatarFallback className="text-xs bg-gradient-to-br from-slate-600 to-slate-700 text-white">
                     {participant.user.name?.split(" ").map((n: string) => n[0]).join("").slice(0, 2)}
                   </AvatarFallback>
                 </Avatar>
                 <span className="text-xs text-slate-300 truncate max-w-16 text-center">
                   {participant.user.name}
                 </span>
               </div>
             ))}
           </div>
         </div>
      </div>




      {
        showInviteModal && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 animate-in fade-in duration-300">
            <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-xl p-6 w-full max-w-md mx-4 border border-purple-500/20 shadow-2xl animate-in slide-in-from-bottom-4 duration-300">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold bg-gradient-to-r from-white to-purple-200 bg-clip-text text-transparent">Invite Friends</h3>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowInviteModal(false)}
                  className="text-gray-400 hover:text-white hover:bg-purple-600/20 transition-all duration-300 rounded-full"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>

              {/* Room Code Section */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-purple-200 mb-2 flex items-center space-x-2">
                  <Users className="h-4 w-4 text-purple-400" />
                  <span>Room Code</span>
                </label>
                <div className="flex items-center space-x-2">
                  <Input
                    value={inviteRoomCode}
                    readOnly
                    className="bg-gradient-to-r from-gray-700/50 to-gray-800/50 border-purple-500/30 text-white text-center text-lg font-mono tracking-wider flex-1 backdrop-blur-sm focus:border-purple-400 focus:ring-2 focus:ring-purple-500/20 transition-all duration-300"
                  />
                  <Button
                    onClick={() => copyToClipboard(inviteRoomCode)}
                    variant="outline"
                    size="sm"
                    className="group bg-fuchsia-200 border-purple-500/30 active:scale-95 hover:bg-purple-600/20 hover:border-purple-400 transition-all duration-200 shadow-lg hover:shadow-purple-500/25"
                  >
                    <Copy className="mr-1 h-3 w-3 group-hover:animate-pulse" />
                    Copy
                  </Button>
                </div>
              </div>

              {/* Full Link Section */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-300 mb-2 flex items-center space-x-2">
                  <ExternalLink className="h-4 w-4 text-purple-400" />
                  <span>Invite Link</span>
                </label>
                <div className="flex items-center space-x-2">
                  <Input
                    value={inviteLink}
                    readOnly
                    className="bg-gradient-to-r from-gray-700 to-gray-800 border-purple-500/30 text-white flex-1 text-sm focus:border-purple-400 focus:ring-2 focus:ring-purple-500/20 transition-all duration-300"
                  />
                  <Button
                    onClick={() => copyToClipboard(inviteLink)}
                    variant="outline"
                    size="sm"
                    className="group bg-fuchsia-200 border-purple-500/30 active:scale-95 hover:bg-purple-600/20 hover:border-purple-400 transition-all duration-200 shadow-lg hover:shadow-purple-500/25"
                  >
                    <Copy className="mr-1 h-3 w-3 group-hover:animate-pulse" />
                    Copy
                  </Button>
                </div>
              </div>

              {/* Social Share Buttons */}
              <div className="space-y-4">
                <div className="flex items-center space-x-2 mb-4">
                  <Share2 className="h-4 w-4 text-purple-400" />
                  <p className="text-sm font-medium text-gray-300">Share on social media</p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Button
                    onClick={shareOnWhatsApp}
                    className="group relative overflow-hidden bg-gradient-to-r from-green-600 to-green-700 hover:from-green-500 hover:to-green-600 text-white border-0 transition-all duration-300 transform hover:scale-105 shadow-lg hover:shadow-green-500/25"
                  >
                    <div className="absolute inset-0 bg-gradient-to-r from-green-400/20 to-green-600/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                    <div className="relative flex items-center justify-center space-x-2">
                      <MessageCircle className="h-4 w-4" />
                      <span className="font-medium">WhatsApp</span>
                    </div>
                  </Button>

                  <Button
                    onClick={shareOnTelegram}
                    className="group relative overflow-hidden bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 text-white border-0 transition-all duration-300 transform hover:scale-105 shadow-lg hover:shadow-blue-500/25"
                  >
                    <div className="absolute inset-0 bg-gradient-to-r from-blue-400/20 to-blue-600/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                    <div className="relative flex items-center justify-center space-x-2">
                      <Send className="h-4 w-4" />
                      <span className="font-medium">Telegram</span>
                    </div>
                  </Button>

                  <Button
                    onClick={shareOnDiscord}
                    className="group relative overflow-hidden bg-gradient-to-r from-indigo-600 to-purple-700 hover:from-indigo-500 hover:to-purple-600 text-white border-0 transition-all duration-300 transform hover:scale-105 shadow-lg hover:shadow-indigo-500/25"
                  >
                    <div className="absolute inset-0 bg-gradient-to-r from-indigo-400/20 to-purple-600/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                    <div className="relative flex items-center justify-center space-x-2">
                      <Copy className="h-4 w-4" />
                      <span className="font-medium">Discord</span>
                    </div>
                  </Button>

                  <Button
                    onClick={shareOnTwitter}
                    className="group relative overflow-hidden bg-gradient-to-r from-sky-600 to-cyan-700 hover:from-sky-500 hover:to-cyan-600 text-white border-0 transition-all duration-300 transform hover:scale-105 shadow-lg hover:shadow-sky-500/25"
                  >
                    <div className="absolute inset-0 bg-gradient-to-r from-sky-400/20 to-cyan-600/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                    <div className="relative flex items-center justify-center space-x-2">
                      <ExternalLink className="h-4 w-4" />
                      <span className="font-medium">Twitter</span>
                    </div>
                  </Button>
                </div>


              </div>
            </div>
          </div>
        )
      }
      <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 8 }}>
  {toasts.map((t) => (
    <div key={t.id} className="px-4 py-2 rounded-lg shadow-md bg-gray-900 text-white text-sm" style={{ minWidth: 160 }}>
      {t.text}
    </div>
  ))}
</div>
    </div>
  );
}
