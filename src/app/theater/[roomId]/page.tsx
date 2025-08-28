
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
import router from "next/router";
import { error } from "console";
import router from "next/router";
import { init } from "next/dist/compiled/webpack/webpack";

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

  // Chat overlay state now here
  const [isChatVisible, setIsChatVisible] = useState(true);
  const [isFloatingMode, setIsFloatingMode] = useState(false);

  const [message, setMessage] = useState("");
  const [unreadCount, setUnreadCount] = useState(0);
  const [showResumeButton, setShowResumeButton] = useState(false);

  const [webrtcStatus, setWebrtcStatus] = useState<any>(null);
  const [showConnectedText, setShowConnectedText] = useState(false);

  // Invite modal state
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteLink, setInviteLink] = useState('');
  const [inviteRoomCode, setInviteRoomCode] = useState('');

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

  // Simple container recreation using React key
  const recreateYouTubeContainer = useCallback(() => {
    setYoutubeContainerKey(prev => prev + 1);
    ytContainerRef.current = null;
    console.log('YouTube container recreated');
  }, []);

  // Create YouTube player
  const createYouTubePlayer = useCallback(async (videoId: string, startTime = 0, autoplay = false) => {
    try {
      console.log(`Creating YouTube player: ${videoId}, startTime: ${startTime}, autoplay: ${autoplay}, isHost: ${isHost}`);

      await loadYouTubeAPI();
      if (!ytContainerRef.current) return null;

      // Destroy existing player first
      const existingPlayer = getYTPlayer();
      if (existingPlayer) {
        try {
          existingPlayer.destroy();
          setYTPlayer(null);
        } catch (e) {
          console.warn("Error destroying existing player:", e);
        }
      }

      setYtPlayerReady(false);
      setYoutubeError(null);

      // Ensure container exists
      if (!ytContainerRef.current) {
        console.warn("YouTube container not available, cannot create player");
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
          modestbranding: 1,        // Hide YouTube logo
          showinfo: 0,              // Hide video title and uploader
          fs: 0,                    // Hide fullscreen button
          cc_load_policy: 0,        // Hide closed captions
          iv_load_policy: 3,        // Hide video annotations
          disablekb: 1,             // Disable keyboard controls
          color: 'white',           // Use white progress bar
          theme: 'dark'             // Use dark theme
        },
        events: {
          onReady: (event: any) => {
            console.log("YouTube player ready", { isHost, autoplay, videoId });
            setYtPlayerReady(true);
            setIsLoadingVideo(false);

            try {
              const duration = event.target.getDuration();
              if (duration) setDuration(duration);
            } catch (e) { console.warn("Error getting duration:", e); }

            if (autoplay) {
              try {
                event.target.playVideo();
                setIsPlaying(true);
                console.log("YouTube autoplay started");
              } catch (e) { console.warn("Autoplay failed:", e); }
            } else {
              console.log("YouTube player ready but not autoplaying (waiting for sync)");
            }

            // Force set ready state to ensure sync works
            setTimeout(() => {
              setYtPlayerReady(true);
              console.log("YouTube player ready state confirmed");
            }, 100);
          },
          onStateChange: (event: any) => {
            const state = event.data;
            const YT = (window as any).YT;

            console.log("YouTube state change:", state, "isHost:", isHost);

            if (state === YT.PlayerState.PLAYING) {
              setIsPlaying(true);
              if (isHost) {
                const currentTime = event.target.getCurrentTime();
                console.log("Host: YouTube started playing, broadcasting");
                socketManager.playVideo(currentTime);
                // Also send state sync for YouTube
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
                console.log("Host: YouTube paused, broadcasting");
                socketManager.pauseVideo();
                // Also send state sync for YouTube
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
                console.log("Host: YouTube ended, broadcasting");
                socketManager.pauseVideo();
              }
            }

            // Update time and duration
            try {
              const currentTime = event.target.getCurrentTime();
              const duration = event.target.getDuration();
              if (currentTime !== undefined) setCurrentTime(currentTime);
              if (duration !== undefined) setDuration(duration);
            } catch (e) { console.warn("Error updating time:", e); }
          },
          onError: (event: any) => {
            console.error("YouTube player error:", event.data);
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
      console.error("YouTube player creation error:", error);
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

    // Auto-load for host
    if (isHost) {
      loadYouTubeVideo(videoId, url);
    }
  };

  // Load YouTube video (host only)
  const loadYouTubeVideo = async (videoId: string, url: string) => {
    if (!isHost) return;

    console.log("Host loading YouTube video:", videoId);
    setIsLoadingVideo(true);
    setCurrentVideoType("youtube");

    try {
      // Stop other video types
      try { webrtcManager.stopFileStream(); } catch (e) { }
      try { webrtcManager.stopScreenShare(); } catch (e) { }
      setSelectedVideoFile(null);

      // Create YouTube player
      const player = await createYouTubePlayer(videoId, 0, true);

      if (player) {
        // Send metadata to all participants
        socketManager.sendVideoMetadata({
          name: `YouTube Video`,
          size: 0,
          type: "youtube",
          url: url
        });

        // Send initial state after a delay
        setTimeout(() => {
          try {
            const currentTime = player.getCurrentTime ? player.getCurrentTime() : 0;
            const playerState = player.getPlayerState ? player.getPlayerState() : 1;
            const isPlaying = playerState === 1;

            console.log("Host broadcasting initial YouTube state:", { currentTime, isPlaying });

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
            console.warn("Error broadcasting initial state:", e);
          }
        }, 2000);
      }
    } catch (error) {
      console.error("Error loading YouTube video:", error);
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

    // webrtcManager will be passed as prop to Chat component instead of global exposure

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
          socketManager.connect?.({ auth: { token } });
        } catch {
          socketManager.connect();
        }

        // socketManager will be passed as prop to Chat component instead of global exposure

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
          console.log("Room info received:", {
            roomHost: room.host,
            currentUserId: currentUser.id,
            isHostCalculation: currentUser.id === room.host?.id
          });
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

              // Handle refresh message for non-host users
              if (parsed?.type === "refresh-page") {
                // Check if message is from a different user (not from self)
                const isFromSelf = msg.user?.id === user?.id;

                if (!isFromSelf) {
                  console.log("Received refresh message from host, reloading page...");
                  window.location.reload();
                  return;
                }
              }
            }
          } catch (e) {
            console.log("Message parsing error:", e);
          }
          if (msg.type === "voice" && msg.audioUrl) {
            if (messages.find(m => m.audioUrl === msg.audioUrl)) return;
          }
          setMessages(prev => [...prev, msg]);
          if (!isChatVisible) setUnreadCount(c => c + 1);
        });

        socketManager.onVideoControl((data) => handleVideoControl(data));

        socketManager.onVideoMetadata((metadata) => {
          if (!mounted) return;
          console.log("Non-host received video metadata:", metadata);

          // For now, always process metadata if it's YouTube (since the host detection is broken)
          // TODO: Fix host detection properly
          const shouldProcessMetadata = metadata.type === "youtube" || !isHost;

          console.log("Metadata processing check:", {
            isHost,
            metadataType: metadata.type,
            shouldProcessMetadata
          });

          if (shouldProcessMetadata) {
            if (metadata.type === "youtube") {
              const id = extractYouTubeId(metadata.url || "");
              if (id) {
                console.log("Non-host: Setting up YouTube video", id);
                setYoutubeVideoId(id);
                setYoutubeUrl(metadata.url || "");
                setCurrentVideoType("youtube");
                setYoutubeError(null);

                console.log("Non-host: Creating YouTube player for video ID:", id);
                // Create YouTube player for non-host (don't autoplay, wait for sync)
                createYouTubePlayer(id, 0, false)
                  .then((player) => {
                    if (player) {
                      console.log("Non-host: YouTube player created, requesting state");
                      // Request current state from host
                      setTimeout(() => socketManager.sendVideoStateRequest(), 1000);
                      setTimeout(() => socketManager.sendVideoStateRequest(), 2000);
                    }
                  })
                  .catch((e) => {
                    console.error("Non-host YouTube player creation failed:", e);
                    setYoutubeError("Failed to load YouTube video");
                  });
              }
            } else if (metadata.type === "screen") {
              // Cleanup YouTube when switching to screen share
              const existingPlayer = getYTPlayer();
              if (existingPlayer) {
                try {
                  existingPlayer.destroy();
                  setYTPlayer(null);
                } catch (e) {
                  console.warn("Error destroying YouTube player:", e);
                }
              }
              recreateYouTubeContainer();
              setYtPlayerReady(false);
              setYoutubeVideoId(null);
              setYoutubeUrl("");
              setYoutubeError(null);
              setCurrentVideoType("screen");
            } else if (metadata.type === "file" || metadata.type.startsWith("video/")) {
              // Cleanup YouTube when switching to file
              const existingPlayer = getYTPlayer();
              if (existingPlayer) {
                try {
                  existingPlayer.destroy();
                  setYTPlayer(null);
                } catch (e) {
                  console.warn("Error destroying YouTube player:", e);
                }
              }
              recreateYouTubeContainer();
              setYtPlayerReady(false);
              setYoutubeVideoId(null);
              setYoutubeUrl("");
              setYoutubeError(null);
              setCurrentVideoType("file");
            } else if (metadata.type === "stopped") {
              // Cleanup YouTube when stopping
              const existingPlayer = getYTPlayer();
              if (existingPlayer) {
                try {
                  existingPlayer.destroy();
                  setYTPlayer(null);
                } catch (e) {
                  console.warn("Error destroying YouTube player:", e);
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

            // Request current state for non-YouTube videos
            if (metadata.type !== "youtube") {
              for (let i = 0; i < 4; i++) {
                setTimeout(() => socketManager.sendVideoStateRequest(), 300 * i + 200);
              }
            }
          }
        });

        socketManager.onVideoStateSync((data) => {
          if (!mounted) return;
          console.log("Non-host received video state sync:", data);
          const vs = data.videoState || data;
          const metadata = vs.metadata || data.metadata;
          const playback = vs.playbackState || data.playbackState;

          // Check if this sync is from another user (meaning we're not the host)
          const isFromOtherUser = data.from && data.from !== user?.id;
          // IMPORTANT: Host should NEVER process sync data to avoid loops
          // Use multiple checks to ensure host doesn't process its own data
          const shouldProcessSync = !isHost && isFromOtherUser && metadata && playback && data.from;

          console.log("Video state sync check:", {
            isHost,
            dataFrom: data.from,
            currentUserId: user?.id,
            isFromOtherUser,
            hasMetadata: !!metadata,
            hasPlayback: !!playback,
            shouldProcessSync
          });

          if (shouldProcessSync) {
            console.log("Non-host: Processing video state sync", {
              metadata,
              playback,
              metadataType: metadata.type
            });

            if (metadata.type === "youtube") {
              console.log("Non-host: Syncing YouTube state", playback);

              // Update local state
              setCurrentTime(playback.currentTime || 0);
              setIsPlaying(playback.isPlaying || false);
              setVolume(playback.volume || 1);
              setIsMuted(playback.isMuted || false);

              // Sync existing YouTube player
              const player = getYTPlayer();
              console.log("Non-host: YouTube sync debug", {
                hasPlayer: !!player,
                ytPlayerReady,
                youtubeVideoId,
                playbackState: playback
              });

              if (player && ytPlayerReady) {
                try {
                  console.log("Non-host: Applying YouTube sync", {
                    currentTime: playback.currentTime,
                    isPlaying: playback.isPlaying
                  });

                  // Set volume and mute
                  if (playback.volume !== undefined) {
                    player.setVolume((playback.volume || 1) * 100);
                  }

                  if (playback.isMuted) {
                    player.mute();
                  } else {
                    player.unMute();
                  }

                  // Sync playback state
                  if (playback.isPlaying) {
                    player.seekTo(playback.currentTime || 0, true);
                    player.playVideo();
                    setIsPlaying(true);
                    console.log("Non-host: YouTube play command sent");
                  } else {
                    player.seekTo(playback.currentTime || 0, true);
                    player.pauseVideo();
                    setIsPlaying(false);
                    console.log("Non-host: YouTube pause command sent");
                  }
                } catch (e) {
                  console.warn("YouTube sync error:", e);
                }
              } else {
                // Player exists but not ready, try once more after a delay
                console.log("Non-host: YouTube player not ready, will retry once");
                setTimeout(() => {
                  const retryPlayer = getYTPlayer();
                  if (retryPlayer) {
                    try {
                      console.log("Non-host: Retrying YouTube sync");
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
                      console.warn("YouTube retry sync error:", e);
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
        if (data.success) {
          setRoomInfo(data.room);
          setParticipants(data.room.participants || []);

          // Request current video state after joining (for refresh handling)
          if (currentUser.id !== data.room.host?.id) {
            setTimeout(() => {
              for (let i = 0; i < 5; i++) {
                setTimeout(() => socketManager.sendVideoStateRequest(), 500 * i);
              }
            }, 1000);
          }
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

      // Cleanup YouTube player before unmounting
      const existingPlayer = getYTPlayer();
      if (existingPlayer) {
        try {
          existingPlayer.destroy();
          setYTPlayer(null);
        } catch (e) {
          console.warn("Error destroying YouTube player on unmount:", e);
        }
      }

      // Reset container key for next mount
      setYoutubeContainerKey(0);

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
      // If switching from YouTube, send refresh message to non-host users
      if (currentVideoType === "youtube" && youtubeVideoId) {
        console.log("Host: Sending refresh message to non-host users");
        socketManager.sendMessage(JSON.stringify({ type: "refresh-page", reason: "youtube-to-screen" }), false);
      }

      // Clear YouTube state when switching to screen share
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
      console.error("share screen error", e);
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
    } catch (e) { console.warn(e); }
  };

  const handleSelectVideo = () => {
    // If switching from YouTube, send refresh message to non-host users
    if (currentVideoType === "youtube" && youtubeVideoId) {
      console.log("Host: Sending refresh message to non-host users");
      socketManager.sendMessage(JSON.stringify({ type: "refresh-page", reason: "youtube-to-file" }), false);
    }

    // Clear YouTube state when switching to file
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

    console.log("handleFileSelect - File selected:", file.name);

    // Clear YouTube state when switching to file
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
          webrtcManager.streamVideoFile(file, videoRef.current).catch((err) => console.error("streamVideoFile err", err));
        } catch (e) { console.error(e); }
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
          console.warn("Error broadcasting YouTube state:", e);
        }
      }
    };

    // Broadcast state every 10 seconds for new joiners (reduced frequency since we broadcast on state changes)
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

            console.log("Host responding to state request:", { currentTime, isPlaying });

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
            console.warn("Error responding to state request:", e);
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
          // Player might not be ready
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
      if (!player) {
        console.warn("YouTube player not available");
        return;
      }

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
      } catch (e) {
        console.error("YouTube play/pause error:", e);
      }
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
  };

  const toggleMute = () => {
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
      } catch (e) {
        console.error("YouTube mute error:", e);
      }
      return;
    }

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
    setIsMuted(v === 0);

    if (currentVideoType === "youtube") {
      const player = getYTPlayer();
      if (player) {
        try {
          player.setVolume(v * 100); // YouTube expects 0-100
          if (v === 0) {
            player.mute();
          } else {
            player.unMute();
          }
        } catch (e) {
          console.error("YouTube volume error:", e);
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
    
  }, []);

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
    `;

    document.head.appendChild(style);

    return () => {
      try {
        if (document.head.contains(style)) {
          document.head.removeChild(style);
        }
      } catch (e) {
        console.warn("Error removing style:", e);
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
          console.log("YouTube player cleaned up due to video type change");
        } catch (e) {
          console.warn("Error cleaning up YouTube player:", e);
        }
      }

      recreateYouTubeContainer();
    }
  }, [currentVideoType, recreateYouTubeContainer]);

  useEffect(() => {
    if (!isHost && user && roomInfo) {
      console.log("Requesting video state after refresh/mount");
      for (let i = 0; i < 3; i++) {
        setTimeout(() => {
          socketManager.sendVideoStateRequest();
          console.log("Requesting video state", i + 1);
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
            <Button
              variant="outline"
              size="sm"
              onClick={generateInviteLink}
              className="text-white border-gray-600 hover:bg-gray-800 bg-transparent"
            >
              <Users className="mr-2 h-4 w-4" />Invite
            </Button>
          </div>
        </div>
      </header>

      {isHost && (
        <div className="bg-gray-900 border-b border-gray-800 px-4 py-3">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 flex gap-2">
              <div className="relative flex-1">
                <Input
                  placeholder="Paste YouTube URL here (auto-plays when pasted)..."
                  value={youtubeUrl}
                  onChange={(e) => handleYouTubeUrlChange(e.target.value)}
                  className={`bg-gray-800 border-gray-700 text-white placeholder:text-gray-400 pr-10 ${youtubeError ? 'border-red-500' : youtubeVideoId ? 'border-green-500' : ''
                    }`}
                  disabled={isLoadingVideo}
                />
                {isLoadingVideo && (
                  <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                    <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                  </div>
                )}
                {youtubeError && (
                  <div className="absolute top-full left-0 mt-1 text-xs text-red-400 bg-red-900/20 px-2 py-1 rounded z-10">
                    {youtubeError}
                  </div>
                )}
                {youtubeVideoId && !youtubeError && (
                  <div className="absolute top-full left-0 mt-1 text-xs text-green-400 bg-green-900/20 px-2 py-1 rounded z-10">
                    ✓ Valid YouTube URL - Video loaded
                  </div>
                )}
              </div>
              <div className={`flex items-center px-3 rounded-md ${youtubeVideoId && !youtubeError ? 'bg-green-600/20' : 'bg-red-600/20'
                }`}>
                <Youtube className={`h-4 w-4 ${youtubeVideoId && !youtubeError ? 'text-green-400' : 'text-red-400'
                  }`} />
              </div>
            </div>
            <div className="flex gap-2">
              {!/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) && (
                <Button onClick={handleShareScreen} disabled={isLoadingVideo} className="bg-blue-600 hover:bg-blue-700 transition-all duration-300"><Monitor className="mr-2 h-4 w-4" />Share Screen</Button>
              )}
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
                <div key={youtubeContainerKey} className="w-full h-full" suppressHydrationWarning={true}>
                  <div
                    ref={ytContainerRef}
                    className="w-full h-full"
                    suppressHydrationWarning={true}
                  />
                </div>
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

            {/* Simple Resume Button - shows after refresh for non-host users (non-YouTube only) */}
            {showResumeButton && !isHost && currentVideoType !== "youtube" && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-10">
                <div className="bg-gray-800 rounded-lg p-4 text-center">
                  <p className="text-white mb-3">Resume Playing</p>
                  <Button
                    onClick={() => {
                      setShowResumeButton(false);

                      togglePlayPause();
                    }}
                    className="bg-purple-600 hover:bg-purple-700"
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
              socketManager={socketManager}
              webrtcManager={webrtcManager}
            />

          </div>
        </div>


      </div>



      {/* Invite Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-6 w-full max-w-md mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-white">Invite Friends</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowInviteModal(false)}
                className="text-gray-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>

            {/* Room Code Section */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-300 mb-2">Room Code</label>
              <div className="flex items-center space-x-2">
                <Input
                  value={inviteRoomCode}
                  readOnly
                  className="bg-gray-700 border-gray-600 text-white flex-1"
                />
                <Button
                  onClick={() => copyToClipboard(inviteRoomCode)}
                  variant="outline"
                  size="sm"
                  className="text-white border-gray-600 hover:bg-gray-700"
                >
                  Copy
                </Button>
              </div>
            </div>

            {/* Full Link Section */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-300 mb-2">Invite Link</label>
              <div className="flex items-center space-x-2">
                <Input
                  value={inviteLink}
                  readOnly
                  className="bg-gray-700 border-gray-600 text-white flex-1 text-sm"
                />
                <Button
                  onClick={() => copyToClipboard(inviteLink)}
                  variant="outline"
                  size="sm"
                  className="text-white border-gray-600 hover:bg-gray-700"
                >
                  Copy
                </Button>
              </div>
            </div>

            {/* Social Share Buttons */}
            <div className="space-y-3">
              <p className="text-sm text-gray-300 mb-3">Share on social media:</p>

              <Button
                onClick={shareOnWhatsApp}
                className="w-full bg-green-600 hover:bg-green-700 text-white"
              >
                Share on WhatsApp
              </Button>

              <Button
                onClick={shareOnTelegram}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white"
              >
                Share on Telegram
              </Button>

              <Button
                onClick={shareOnDiscord}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white"
              >
                Copy for Discord
              </Button>

              <Button
                onClick={shareOnTwitter}
                className="w-full bg-sky-600 hover:bg-sky-700 text-white"
              >
                Share on Twitter
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
