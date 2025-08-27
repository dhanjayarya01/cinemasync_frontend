
"use client";

import React, { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Play, Pause, Mic, Trash2, Send, Loader2, Settings, Volume2, VolumeX, MicOff, X, Users } from "lucide-react";
import type { SocketMessage, Participant } from "@/lib/socket";
import VoiceChatManager from "@/components/VoiceChatManager";

type EphemeralItem = { id: string; text: string; fromId?: string; fromName?: string; fromAvatar?: string };

type Props = {
  user?: any;
  participants: Participant[];
  messages: SocketMessage[];
  isVisible: boolean;
  setIsVisible: (v: boolean) => void;
  isFloatingMode: boolean;
  setIsFloatingMode: (v: boolean) => void;

  // text message state + handlers
  message: string;
  setMessage: (s: string) => void;
  sendMessage: () => void;

  // recording state + handlers
  isRecording: boolean;
  startRecording: () => void;
  stopRecording: () => void;
  audioBlob: Blob | null;
  setAudioBlob: (b: Blob | null) => void;
  recordingTime: number;
  handleSendVoiceMessage: () => Promise<void>;
  isSendingVoiceMessage: boolean;

  // voice playback
  playVoiceMessage: (id: string, url: string) => void;
  pauseVoiceMessage: (id: string) => void;
  playingVoiceMessages: Set<string>;

  // NEW: video volume control for voice chat
  onVideoVolumeChange?: (volume: number) => void;
  currentVideoVolume?: number;
};

export default function Chat({
  user,
  participants,
  messages,
  isVisible,
  setIsVisible,
  isFloatingMode,
  setIsFloatingMode,
  message,
  setMessage,
  sendMessage,
  isRecording,
  startRecording,
  stopRecording,
  audioBlob,
  setAudioBlob,
  recordingTime,
  handleSendVoiceMessage,
  isSendingVoiceMessage,
  playVoiceMessage,
  pauseVoiceMessage,
  playingVoiceMessages,
  onVideoVolumeChange,
  currentVideoVolume = 1,
}: Props) {
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const prevMessagesRef = useRef<string | null>(null);
  const [ephemeralQueue, setEphemeralQueue] = useState<EphemeralItem[]>([]);
  
  // NEW: Voice chat settings state
  const [showSettings, setShowSettings] = useState(false);
  const [voiceChatAutoPlay, setVoiceChatAutoPlay] = useState(true);
  const [voiceChatVolume, setVoiceChatVolume] = useState(1);
  const [isLiveVoiceMode, setIsLiveVoiceMode] = useState(false);
  const [isHoldingMic, setIsHoldingMic] = useState(false);
  const [originalVideoVolume, setOriginalVideoVolume] = useState(currentVideoVolume);
  
  // NEW: Live voice chat refs
  const liveVoiceStreamRef = useRef<MediaStream | null>(null);
  const liveVoiceRecorderRef = useRef<MediaRecorder | null>(null);
  const holdTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const liveRecordingStartTime = useRef<number>(0);
  const isLiveVoiceModeRef = useRef<boolean>(false);
  
  // NEW: Voice chat manager state
  const [showVoiceChatManager, setShowVoiceChatManager] = useState(false);
  const [liveRecordingTime, setLiveRecordingTime] = useState(0);

  // Sync ref with state
  useEffect(() => {
    isLiveVoiceModeRef.current = isLiveVoiceMode;
  }, [isLiveVoiceMode]);

  // NEW: Auto-play voice messages when enabled (fixed to prevent duplicates)
  const playedMessagesRef = useRef<Set<string>>(new Set());
  
  useEffect(() => {
    if (!voiceChatAutoPlay) return;
    
    const lastMessage = messages[messages.length - 1];
    if (lastMessage && 
        lastMessage.type === "voice" && 
        lastMessage.user?.id !== user?.id && 
        lastMessage.audioUrl &&
        !playedMessagesRef.current.has(lastMessage.id)) {
      
      // Mark as played to prevent duplicates
      playedMessagesRef.current.add(lastMessage.id);
      
      // Auto-play voice messages from others
      setTimeout(() => {
        playVoiceMessage(lastMessage.id, lastMessage.audioUrl!);
      }, 100);
    }
  }, [messages, voiceChatAutoPlay, user?.id, playVoiceMessage]);

  // REMOVED: Automatic video volume control to prevent conflicts
  // Voice chat now operates independently from video audio

  // NEW: True real-time live voice chat (like Discord/phone call)
  const startLiveVoiceChat = async () => {
    try {
      console.log("🎙️ Starting real-time live voice chat...");
      
      // Enable audio context for autoplay (user interaction)
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      
      // Resume audio context if suspended (required for autoplay)
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
        console.log('🔊 Audio context resumed for live voice');
      }
      
      // Get microphone access for real-time streaming
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 44100
        } 
      });
      
      console.log("🎙️ Microphone access granted for live streaming");
      
      liveVoiceStreamRef.current = stream;
      
      // Set both state and ref BEFORE starting streaming
      setIsLiveVoiceMode(true);
      isLiveVoiceModeRef.current = true;
      
      // Start continuous live voice streaming (no chat messages)
      startContinuousLiveVoiceStream();
      
      console.log("✅ Real-time live voice chat active");
    } catch (error) {
      console.error("❌ Failed to start live voice chat:", error);
      setIsLiveVoiceMode(false);
      isLiveVoiceModeRef.current = false;
    }
  };

  // NEW: Live voice streaming with proper audio chunks
  const startContinuousLiveVoiceStream = async () => {
    if (!liveVoiceStreamRef.current) {
      console.error('❌ No live voice stream available');
      return;
    }
    
    console.log('🎙️ Starting live voice streaming...');
    
    // Function to create and start a recording session
    const createRecordingSession = () => {
      if (!isLiveVoiceModeRef.current || !liveVoiceStreamRef.current) {
        console.log('🛑 Live mode stopped or stream unavailable');
        return;
      }
      
      try {
        // Create new MediaRecorder for each session to get complete audio chunks
        const mediaRecorder = new MediaRecorder(liveVoiceStreamRef.current, {
          mimeType: 'audio/webm;codecs=opus'
        });
        
        liveVoiceRecorderRef.current = mediaRecorder;
        
        mediaRecorder.ondataavailable = async (event) => {
          if (event.data && event.data.size > 0 && isLiveVoiceModeRef.current) {
            
            try {
              // Check if audio chunk has actual voice content (Voice Activity Detection)
              const audioBlob = event.data;
              const hasVoiceActivity = await detectVoiceActivity(audioBlob);
              
              if (hasVoiceActivity) {
                console.log('🎙️ Streaming live audio chunk:', event.data.size, 'bytes');
                
                // Convert to base64 for real-time transmission
                const reader = new FileReader();
                reader.onload = () => {
                  const audioData = reader.result as string;
                  
                  // Send via socket for real-time playback (NOT as chat message)
                  const socketManager = (window as any).socketManager;
                  if (socketManager && socketManager.socket) {
                    socketManager.socket.emit('live-voice-stream', {
                      audioData,
                      userId: user?.id,
                      userName: user?.name,
                      timestamp: Date.now()
                    });
                    console.log('📡 Live audio chunk sent via socket');
                  } else {
                    console.warn('⚠️ Socket manager not available for live voice streaming');
                  }
                };
                reader.readAsDataURL(event.data);
              } else {
                console.log('🔇 Silent audio chunk - not sending');
              }
            } catch (error) {
              console.error('❌ Failed to stream live audio:', error);
            }
          }
        };
        
        mediaRecorder.onstop = () => {
          console.log('🔄 Recording session ended, creating new session...');
          // Create next recording session after a minimal delay
          setTimeout(() => {
            if (isLiveVoiceModeRef.current) {
              createRecordingSession();
            }
          }, 10); // Very short delay to minimize gaps
        };
        
        // Record for 500ms to get a complete audio chunk
        mediaRecorder.start();
        console.log('🎙️ Recording session started');
        
        // Auto-stop after 500ms to get a complete audio chunk
        setTimeout(() => {
          if (mediaRecorder.state === 'recording' && isLiveVoiceModeRef.current) {
            mediaRecorder.stop();
          }
        }, 500);
        
      } catch (error) {
        console.error('❌ Failed to create recording session:', error);
        // Retry after a short delay
        setTimeout(() => {
          if (isLiveVoiceModeRef.current) {
            createRecordingSession();
          }
        }, 100);
      }
    };
    
    // Start the first recording session
    createRecordingSession();
  };

  const stopLiveVoiceChat = () => {
    console.log("🛑 Stopping real-time live voice chat...");
    
    // Update ref first to stop new recording sessions
    isLiveVoiceModeRef.current = false;
    
    // Stop live voice recorder if active
    if (liveVoiceRecorderRef.current && liveVoiceRecorderRef.current.state !== 'inactive') {
      try {
        liveVoiceRecorderRef.current.stop();
      } catch (e) {}
    }
    
    if (liveVoiceStreamRef.current) {
      liveVoiceStreamRef.current.getTracks().forEach(track => track.stop());
      liveVoiceStreamRef.current = null;
    }
    
    setIsLiveVoiceMode(false);
    setIsHoldingMic(false);
    
    console.log("✅ Real-time live voice chat stopped");
  };

  // REMOVED: Old live voice transmission function to avoid conflicts

  // Simplified mic button handlers - no holding functionality
  const handleMicClick = () => {
    if (!isLiveVoiceMode) {
      // Regular tap-to-record behavior (only in normal mode)
      if (isRecording) {
        stopRecording();
      } else {
        startRecording();
      }
    }
    // In live mode, mic is always active - no click functionality needed
  };

  // NEW: Quick voice mode toggle with debugging
  const toggleVoiceMode = () => {
    console.log('🎯 toggleVoiceMode called, current isLiveVoiceMode:', isLiveVoiceMode);
    if (isLiveVoiceMode) {
      console.log('🛑 Stopping live voice chat...');
      stopLiveVoiceChat();
    } else {
      console.log('▶️ Starting live voice chat...');
      startLiveVoiceChat();
    }
  };

  // NEW: Listen for incoming live voice streams
  useEffect(() => {
    const socketManager = (window as any).socketManager;
    if (socketManager && socketManager.socket) {
      // Listen for live voice streams from other participants
      socketManager.socket.on('live-voice-stream', (data: {
        audioData: string;
        userId: string;
        userName: string;
        timestamp: number;
      }) => {
        // Only play if it's from another user (not yourself)
        if (data.userId !== user?.id) {
          playLiveVoiceStream(data.audioData, data.userName);
        }
      });
      
      return () => {
        socketManager.socket.off('live-voice-stream');
      };
    }
  }, [user?.id]);

  // NEW: Improved live voice playback with audio context for smoother streaming
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioBufferQueueRef = useRef<AudioBuffer[]>([]);
  const isPlayingLiveAudioRef = useRef<boolean>(false);

  // NEW: Voice Activity Detection to prevent sending silent audio
  const detectVoiceActivity = async (audioBlob: Blob): Promise<boolean> => {
    try {
      // Initialize AudioContext if not exists
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      
      const audioContext = audioContextRef.current;
      
      // Convert blob to array buffer
      const arrayBuffer = await audioBlob.arrayBuffer();
      
      // Decode audio data
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      
      // Analyze audio data for voice activity
      const channelData = audioBuffer.getChannelData(0);
      let sum = 0;
      let maxAmplitude = 0;
      
      // Calculate RMS (Root Mean Square) and peak amplitude
      for (let i = 0; i < channelData.length; i++) {
        const sample = Math.abs(channelData[i]);
        sum += sample * sample;
        maxAmplitude = Math.max(maxAmplitude, sample);
      }
      
      const rms = Math.sqrt(sum / channelData.length);
      
      // Voice activity thresholds
      const RMS_THRESHOLD = 0.01; // Minimum RMS for voice activity
      const PEAK_THRESHOLD = 0.05; // Minimum peak amplitude for voice activity
      
      const hasVoice = rms > RMS_THRESHOLD || maxAmplitude > PEAK_THRESHOLD;
      
      if (hasVoice) {
        console.log(`🎤 Voice detected - RMS: ${rms.toFixed(4)}, Peak: ${maxAmplitude.toFixed(4)}`);
      }
      
      return hasVoice;
      
    } catch (error) {
      console.error('❌ Voice activity detection failed:', error);
      // If VAD fails, assume there's voice activity to avoid blocking audio
      return true;
    }
  };
  
  const playLiveVoiceStream = async (audioData: string, userName: string) => {
    try {
      console.log('🔊 Playing live voice from:', userName);
      
      // Simple audio element approach with user interaction handling
      const byteCharacters = atob(audioData.split(',')[1]);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const audioBlob = new Blob([byteArray], { type: 'audio/webm' });
      
      const audio = new Audio(URL.createObjectURL(audioBlob));
      audio.volume = voiceChatVolume;
      
      // Handle autoplay policy
      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise.catch(error => {
          if (error.name === 'NotAllowedError') {
            console.log('🔇 Autoplay blocked - user needs to interact first');
            // Store audio for later playback when user interacts
            (window as any).pendingLiveAudio = audio;
          } else {
            console.error('Audio playback error:', error);
          }
        });
      }
      
      // Clean up URL after playing
      audio.onended = () => {
        URL.revokeObjectURL(audio.src);
      };
      
    } catch (error) {
      console.error('❌ Failed to play live voice stream:', error);
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (liveVoiceStreamRef.current) {
        liveVoiceStreamRef.current.getTracks().forEach(track => track.stop());
      }
      if (holdTimeoutRef.current) {
        clearTimeout(holdTimeoutRef.current);
      }
    };
  }, []);

  // style block (hide scrollbar, glass, animation)
  const styleBlock = `
    .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
    .hide-scrollbar::-webkit-scrollbar { display: none; }

    .chat-glass {
      background: linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.01));
      border: 1px solid rgba(255,255,255,0.04);
      backdrop-filter: blur(8px) saturate(1.02);
    }

    @keyframes centerRise {
      0% { transform: translateY(30px) scale(0.98); opacity: 0; }
      12% { transform: translateY(6px) scale(1.00); opacity: 1; }
      70% { transform: translateY(-10px) scale(0.996); opacity: 1; }
      100% { transform: translateY(-40px) scale(0.994); opacity: 0; }
    }

    .ephemeral-center {
      animation: centerRise 4s cubic-bezier(.2,.9,.2,1) forwards;
      will-change: transform, opacity;
    }

    /* Custom slider styling */
    .slider {
      -webkit-appearance: none;
      appearance: none;
      background: transparent;
      cursor: pointer;
    }

    .slider::-webkit-slider-track {
      background: #4b5563;
      height: 4px;
      border-radius: 2px;
    }

    .slider::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      background: #8b5cf6;
      height: 16px;
      width: 16px;
      border-radius: 50%;
      cursor: pointer;
    }

    .slider::-moz-range-track {
      background: #4b5563;
      height: 4px;
      border-radius: 2px;
      border: none;
    }

    .slider::-moz-range-thumb {
      background: #8b5cf6;
      height: 16px;
      width: 16px;
      border-radius: 50%;
      cursor: pointer;
      border: none;
    }
  `;

  // Auto-scroll to bottom when new messages arrive in panel mode
  useEffect(() => {
    const el = chatScrollRef.current;
    if (!el || !isVisible) return;
    
    // Always scroll to bottom when new messages arrive
    const id = window.setTimeout(() => {
      el.scrollTop = el.scrollHeight;
    }, 50);
    return () => clearTimeout(id);
  }, [messages, isVisible]);

  // Watch for new messages and enqueue ephemeral items for others when floating mode ON (or panel open)
  useEffect(() => {
    const last = messages.length ? messages[messages.length - 1] : null;
    const sig = last ? `${last.id || "id"}|${last.timestamp || ""}` : null;
    if (!sig || sig === prevMessagesRef.current) return;
    prevMessagesRef.current = sig;
    if (!last) return;

    const fromOther = last.user?.id !== user?.id;
    if (!fromOther) return;
    if (last.isPrivate) return;

    // Show floating animation only when floating mode enabled AND chat is closed
    if (isFloatingMode && !isVisible) {
      const item: EphemeralItem = {
        id: `${last.id || Date.now()}`,
        text: last.type === "voice" ? "Voice message" : (last.message || ""),
        fromId: last.user?.id,
        fromName: last.user?.name,
        fromAvatar: last.user?.picture,
      };
      setEphemeralQueue((q) => {
        // Limit to maximum 3 floating messages and auto-scroll by removing oldest
        const newQueue = [...q, item];
        return newQueue.slice(-3); // Keep only the last 3 messages
      });

      // Remove after animation length (4s). Use timer per-item.
      const t = window.setTimeout(() => {
        setEphemeralQueue((q) => q.filter(x => x.id !== item.id));
      }, 4000);

      // clean timer if component unmounts before removal
      return () => clearTimeout(t);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, user?.id, isFloatingMode, isVisible]);

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

  // Toggle via icon only; if opening panel clear ephemeralQueue and switch to panel mode
  const onToggle = () => {
    setIsVisible((v) => {
      const next = !v;
      if (next) {
        setEphemeralQueue([]); // clear ephemeral when panel opens
        setIsFloatingMode(false); // always open in panel mode
      }
      return next;
    });
  };

  // When switching to floating mode, close the chat
  const handleFloatingModeToggle = () => {
    setIsFloatingMode((v) => {
      const nextFloating = !v;
      if (nextFloating && isVisible) {
        setIsVisible(false); // close chat when switching to floating mode
      }
      return nextFloating;
    });
  };

  return (
    <>
      <style>{styleBlock}</style>

      {/* Chat toggle icon top-right */}
      <div className="absolute top-3 right-3 z-50 flex items-center space-x-2 pointer-events-auto">
        {/* NEW: Floating Voice Mode Indicator */}
        <button
          onClick={toggleVoiceMode}
          className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all duration-300 shadow-lg ${
            isLiveVoiceMode 
              ? 'bg-green-500 text-white animate-pulse shadow-green-500/30' 
              : 'bg-gray-700 text-gray-200 hover:bg-gray-600'
          }`}
          title={isLiveVoiceMode ? "Switch to normal voice messages" : "Switch to live voice chat"}
        >
          <div className="flex items-center space-x-1">
            {isLiveVoiceMode ? (
              <>
                <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
                <span>LIVE</span>
              </>
            ) : (
              <span>MSG</span>
            )}
          </div>
        </button>

        <button
          onClick={handleFloatingModeToggle}
          title={isFloatingMode ? "Switch to panel" : "Switch to floating"}
          className="hidden md:inline-flex items-center justify-center px-2 py-1 rounded-full bg-gray-800/60 text-white hover:bg-gray-700/70 text-xs"
        >
          {isFloatingMode ? "Panel" : "Float"}
        </button>

        <button
          onClick={onToggle}
          title="Toggle chat"
          aria-expanded={isVisible}
          className="inline-flex items-center justify-center p-2 rounded-full bg-purple-600/90 text-white shadow-md hover:bg-purple-500 focus:outline-none"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>

      {/* Ephemeral overlay when chat is closed but floating mode is enabled */}
      {isFloatingMode && !isVisible && ephemeralQueue.length > 0 && (
        <div className="absolute top-16 right-4 z-60 pointer-events-none max-h-[300px] overflow-hidden" style={{ width: 360, maxWidth: "92%" }}>
          <div className="flex flex-col items-end space-y-2">
            {ephemeralQueue.slice(-3).map((q, idx) => (
              <div
                key={q.id}
                className="ephemeral-center px-4 py-2 rounded-md bg-black/85 backdrop-blur-md text-white text-sm shadow-2xl border border-white/15 flex items-center space-x-3"
                style={{ 
                  minWidth: 240, 
                  transform: `translateY(${idx * 10}px)`,
                  animationDelay: `${idx * 150}ms`
                }}
              >
                {/* Avatar */}
                <div className="flex-shrink-0">
                  {q.fromAvatar ? (
                    <img src={q.fromAvatar} alt={q.fromName || "avatar"} className="w-8 h-8 rounded-full object-cover border-2 border-white/25" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-600 to-blue-600 flex items-center justify-center text-xs text-white font-bold shadow-lg">{(q.fromName || "U").split(" ").map(s=>s[0]).join("").slice(0,2)}</div>
                  )}
                </div>

                <div className="text-left min-w-0 flex-1">
                  <div className="font-semibold text-sm text-white/95 truncate mb-1">{q.fromName}</div>
                  <div className="text-sm text-white/90 break-words line-clamp-2 leading-relaxed">{q.text}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Panel-mode: floating panel (full height-ish) when visible+floating */}
     {isVisible && isFloatingMode && (
  <div
    className="absolute top-12 right-4 z-50 pointer-events-auto"
    style={{ width: 360, maxWidth: "92%", height: "70vh", maxHeight: "70vh" }}
  >
    <div className="chat-glass rounded-lg overflow-hidden shadow-lg h-full flex flex-col">
      {/* header */}
      <div className="flex items-center justify-between px-4 py-3 flex-shrink-0">
        <div className="flex items-center space-x-3">
          <div className="text-white font-semibold">Chat</div>
          <div className="hidden sm:flex -space-x-2">
            {participants.slice(0, 4).map(p => (
              <Avatar key={p.user.id} className="h-7 w-7 border-2 border-transparent">
                <AvatarImage src={p.user.picture || "/placeholder.svg"} />
                <AvatarFallback className="text-xs bg-gray-700">{p.user.name.split(" ").map((n:string)=>n[0]).join("")}</AvatarFallback>
              </Avatar>
            ))}
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {/* NEW: Voice chat manager button */}
          <button
            onClick={() => setShowVoiceChatManager(!showVoiceChatManager)}
            className="inline-flex items-center justify-center p-1.5 rounded bg-transparent text-white/90 hover:bg-white/10 transition-colors"
            title="Voice chat participants"
          >
            <Users className="w-4 h-4" />
          </button>

          {/* NEW: Settings button */}
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="inline-flex items-center justify-center p-1.5 rounded bg-transparent text-white/90 hover:bg-white/10 transition-colors"
            title="Voice chat settings"
          >
            <Settings className="w-4 h-4" />
          </button>
          
          <button
            onClick={handleFloatingModeToggle}
            className="hidden md:inline-flex items-center justify-center px-2 py-1 rounded bg-transparent text-white/90 hover:bg-white/5 text-xs"
          >
            {isFloatingMode ? "Panel" : "Float"}
          </button>
        </div>
      </div>

      {/* NEW: Settings Panel - positioned outside container for floating mode */}
      {showSettings && (
        <div className="fixed top-20 right-8 z-70 w-72 bg-gray-900/95 backdrop-blur-sm rounded-lg border border-white/10 shadow-xl pointer-events-auto">
          <div className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-white font-semibold text-sm">Voice Chat Settings</h3>
              <button
                onClick={() => setShowSettings(false)}
                className="text-white/60 hover:text-white/90 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            
            {/* Auto-play voice messages */}
            <div className="space-y-2">
              <label className="flex items-center justify-between">
                <span className="text-white/90 text-sm">Auto-play voice messages</span>
                <button
                  onClick={() => setVoiceChatAutoPlay(!voiceChatAutoPlay)}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                    voiceChatAutoPlay ? 'bg-purple-600' : 'bg-gray-600'
                  }`}
                >
                  <span
                    className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                      voiceChatAutoPlay ? 'translate-x-5' : 'translate-x-1'
                    }`}
                  />
                </button>
              </label>
              <p className="text-white/60 text-xs">Automatically play voice messages from others</p>
            </div>

            {/* Voice chat volume */}
            <div className="space-y-2">
              <label className="text-white/90 text-sm flex items-center space-x-2">
                <Volume2 className="w-4 h-4" />
                <span>Voice chat volume</span>
              </label>
              <div className="flex items-center space-x-2">
                <VolumeX className="w-3 h-3 text-white/60" />
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={voiceChatVolume}
                  onChange={(e) => setVoiceChatVolume(Number(e.target.value))}
                  className="flex-1 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer slider"
                />
                <Volume2 className="w-3 h-3 text-white/60" />
              </div>
              <p className="text-white/60 text-xs">Volume level for voice messages and live chat</p>
            </div>

            {/* Live voice chat mode */}
            <div className="space-y-2">
              <label className="flex items-center justify-between">
                <span className="text-white/90 text-sm">Live voice chat mode</span>
                <button
                  onClick={() => {
                    if (isLiveVoiceMode) {
                      stopLiveVoiceChat();
                    } else {
                      startLiveVoiceChat();
                    }
                  }}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                    isLiveVoiceMode ? 'bg-green-600' : 'bg-gray-600'
                  }`}
                >
                  <span
                    className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                      isLiveVoiceMode ? 'translate-x-5' : 'translate-x-1'
                    }`}
                  />
                </button>
              </label>
              <p className="text-white/60 text-xs">
                {isLiveVoiceMode 
                  ? "Continuous voice transmission active" 
                  : "Tap mic to record and send voice messages"
                }
              </p>
            </div>

            {/* Live voice status */}
            {isLiveVoiceMode && (
              <div className="bg-green-900/30 border border-green-600/30 rounded-lg p-3">
                <div className="flex items-center space-x-2">
                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-green-400 text-sm font-medium">
                    Live mode active - Continuous transmission
                  </span>
                </div>
                <p className="text-green-300/80 text-xs mt-1">
                  Your microphone is continuously active and transmitting to others
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* center ephemeral area inside panel */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-full max-w-[86%] flex flex-col items-center space-y-2">
          {ephemeralQueue.map((q, idx) => (
            <div
              key={q.id}
              className="px-4 py-2 rounded-md bg-black/70 text-white text-center shadow-lg flex items-center space-x-3"
              style={{ transform: `translateY(${idx * 12}px)` }}
            >
              {q.fromAvatar ? (
                <img src={q.fromAvatar} alt={q.fromName || "avatar"} className="w-8 h-8 rounded-full object-cover border border-white/8" />
              ) : (
                <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center text-xs text-white">
                  {(q.fromName || "U").split(" ").map(s=>s[0]).join("").slice(0,2)}
                </div>
              )}
              <div className="text-left">
                <div className="font-medium text-sm">{q.fromName}</div>
                <div className="text-sm text-white/95">{q.text}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* messages list (scrollable) */}
      <div
        ref={chatScrollRef}
        className="hide-scrollbar overflow-y-auto px-4 pt-2"
        style={{ flex: 1 }}
      >
        <div className="space-y-3 px-1 pb-6">
          {messages.filter(m => !m.isPrivate).map((m, idx) => {
            const isOwn = m.user.id === user?.id;
            return (
              <div key={`${m.id}-${idx}`} className={`flex ${isOwn ? "justify-end" : "justify-start"}`}>
                {!isOwn && (
                  <div className="mr-2">
                    <Avatar className="h-8 w-8 flex-shrink-0">
                      <AvatarImage src={m.user.picture || "/placeholder.svg"} />
                      <AvatarFallback className="text-xs bg-gray-700">{m.user.name.split(" ").map((n:string)=>n[0]).join("")}</AvatarFallback>
                    </Avatar>
                  </div>
                )}

                <div className={`max-w-[78%] ${isOwn ? "order-1 text-right" : "order-2 text-left"}`}>
                  {!isOwn && <div className="text-xs text-white/80 mb-1">{m.user.name}</div>}

                  <div className="text-white text-sm leading-snug">
                    {m.type === "voice" ? (
                      <div className="flex items-center justify-start space-x-3">
                        <button
                          onClick={() => {
                            if (playingVoiceMessages.has(m.id)) pauseVoiceMessage(m.id);
                            else if (m.audioUrl) playVoiceMessage(m.id, m.audioUrl);
                          }}
                          className="p-1 rounded bg-white/6"
                        >
                          {playingVoiceMessages.has(m.id) ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                        </button>
                        <div className="text-white/95">{m.duration ? `${m.duration}s` : "Voice message"}</div>
                      </div>
                    ) : (
                      <div className="whitespace-pre-wrap">{m.message}</div>
                    )}
                  </div>

                  <div className={`text-[10px] mt-1 ${isOwn ? "text-white/60" : "text-white/55"}`}>{m.timestamp}</div>
                </div>

                {isOwn && (
                  <div className="ml-2">
                    <Avatar className="h-8 w-8 flex-shrink-0">
                      <AvatarImage src={m.user.picture || "/placeholder.svg"} />
                      <AvatarFallback className="text-xs bg-purple-700">{m.user.name.split(" ").map((n:string)=>n[0]).join("")}</AvatarFallback>
                    </Avatar>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* sticky bottom input + mic */}
      <div className="px-4 py-3 flex-shrink-0 bg-transparent border-t border-white/6">
        {/* NEW: Voice Mode Indicator */}
        {(isLiveVoiceMode || isRecording) && (
          <div className="px-2 py-1 mb-2 rounded-full bg-gray-800/80 border border-gray-600/50">
            <div className="flex items-center space-x-2">
              <div className={`w-2 h-2 rounded-full ${
                isLiveVoiceMode 
                  ? (isHoldingMic ? 'bg-red-500 animate-pulse' : 'bg-green-500') 
                  : 'bg-red-500 animate-pulse'
              }`} />
              <span className="text-xs text-white/90 font-medium">
                {isLiveVoiceMode 
                  ? 'Live Mode - Continuous Transmission' 
                  : `Recording... ${recordingTime.toFixed(1)}s`
                }
              </span>
              {isLiveVoiceMode && (
                <button
                  onClick={toggleVoiceMode}
                  className="text-xs text-white/70 hover:text-white/90 underline"
                >
                  Exit Live Mode
                </button>
              )}
            </div>
          </div>
        )}

        <div className="flex items-center space-x-2">
          <Input
            placeholder="Type a message..."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && message.trim()) { e.preventDefault(); sendMessage(); } }}
            className="bg-transparent border border-white/8 text-white placeholder:text-gray-300 flex-1"
            disabled={isRecording}
          />

          {/* NEW: Enhanced Voice Mode Toggle */}
          {!audioBlob && !isRecording && (
            <button
              onClick={toggleVoiceMode}
              className={`px-3 py-2 rounded-lg text-xs font-bold transition-all duration-200 ${
                isLiveVoiceMode 
                  ? 'bg-green-600 text-white shadow-lg shadow-green-600/25 hover:bg-green-500 animate-pulse' 
                  : 'bg-gray-600 text-gray-200 hover:bg-gray-500 border border-gray-500/50'
              }`}
              title={isLiveVoiceMode ? "Click to switch to normal voice messages" : "Click to switch to live voice chat"}
            >
              <div className="flex items-center space-x-1">
                {isLiveVoiceMode ? (
                  <>
                    <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
                    <span>LIVE</span>
                  </>
                ) : (
                  <>
                    <span>MSG</span>
                  </>
                )}
              </div>
            </button>
          )}

          {!audioBlob ? (
            <button
              onClick={handleMicClick}
              className={`p-2 rounded transition-colors ${
                isLiveVoiceMode 
                  ? "bg-green-600 text-white"
                  : (isRecording ? "bg-red-600 text-white" : "bg-gray-700 text-white hover:bg-gray-600")
              }`}
              title={
                isLiveVoiceMode 
                  ? "Live mode active - use LIVE/MSG button to toggle"
                  : (isRecording ? "Stop recording" : "Record voice message")
              }
            >
              {isLiveVoiceMode ? (
                <div className="flex items-center space-x-1">
                  <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
                  <Mic className="w-4 h-4" />
                </div>
              ) : isRecording ? (
                <div className="flex items-center space-x-1">
                  <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
                  <Mic className="w-4 h-4" />
                </div>
              ) : (
                <Mic className="w-4 h-4" />
              )}
            </button>
          ) : (
            <div className="flex items-center space-x-2">
              <button onClick={() => { try { const a = new Audio(URL.createObjectURL(audioBlob)); a.play(); } catch (e) { console.error(e); } }} className="p-2 rounded bg-gray-700 text-white"><Play className="w-4 h-4" /></button>
              <button onClick={() => { setAudioBlob(null); }} className="p-2 rounded bg-gray-700 text-white"><Trash2 className="w-4 h-4" /></button>
              <Button onClick={() => handleSendVoiceMessage()} className="bg-purple-600 hover:bg-purple-700 px-3" disabled={isSendingVoiceMessage}>
                {isSendingVoiceMessage ? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" />Sending...</>) : (<Send className="h-4 w-4" />)}
              </Button>
            </div>
          )}

          {!audioBlob && <Button onClick={sendMessage} className="bg-purple-600 hover:bg-purple-700 px-3 disabled:opacity-50"><Send className="h-4 w-4" /></Button>}
        </div>

        {isRecording && <div className="text-xs text-white/80 mt-2">Recording... {recordingTime.toFixed(1)}s</div>}
        {audioBlob && <div className="text-xs text-white/80 mt-2">Preview & ready to send — {formatTime(recordingTime)}</div>}
      </div>
    </div>
  </div>
)}


      {/* Panel-mode (non-floating) */}
      {isVisible && !isFloatingMode && (
        <div
          className="absolute top-12 right-4  bg-black/9 backdrop-blur-xs   z-50 transition-all duration-200 pointer-events-auto"
          style={{ width: 360, maxWidth: "92%", height: "70vh", maxHeight: "70vh" }}
        >
          <div className="chat-glass rounded-lg overflow-hidden shadow-lg h-full flex flex-col">
            {/* header */}
            <div className="flex items-center justify-between px-4 py-3 flex-shrink-0">
              <div className="flex items-center space-x-3">
                <div className="text-white font-semibold">Chat</div>
                <div className="hidden sm:flex -space-x-2">
                  {participants.slice(0, 4).map(p => (
                    <Avatar key={p.user.id} className="h-7 w-7 border-2 border-transparent">
                      <AvatarImage src={p.user.picture || "/placeholder.svg"} />
                      <AvatarFallback className="text-xs bg-gray-700">{p.user.name.split(" ").map((n:string)=>n[0]).join("")}</AvatarFallback>
                    </Avatar>
                  ))}
                </div>
              </div>

              <div className="flex items-center space-x-2">
                {/* NEW: Voice chat manager button */}
                <button
                  onClick={() => setShowVoiceChatManager(!showVoiceChatManager)}
                  className="inline-flex items-center justify-center p-1.5 rounded bg-transparent text-white/90 hover:bg-white/10 transition-colors"
                  title="Voice chat participants"
                >
                  <Users className="w-4 h-4" />
                </button>

                {/* NEW: Settings button */}
                <button
                  onClick={() => setShowSettings(!showSettings)}
                  className="inline-flex items-center justify-center p-1.5 rounded bg-transparent text-white/90 hover:bg-white/10 transition-colors"
                  title="Voice chat settings"
                >
                  <Settings className="w-4 h-4" />
                </button>
                
                <button
                  onClick={() => setIsFloatingMode(v => !v)}
                  className="hidden md:inline-flex items-center justify-center px-2 py-1 rounded bg-transparent text-white/90 hover:bg-white/5 text-xs"
                >
                  {isFloatingMode ? "Panel" : "Float"}
                </button>
              </div>
            </div>

            {/* NEW: Settings Panel for non-floating mode */}
            {showSettings && (
              <div className="absolute top-16 right-4 z-60 w-72 bg-gray-900/95 backdrop-blur-sm rounded-lg border border-white/10 shadow-xl pointer-events-auto">
                <div className="p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-white font-semibold text-sm">Voice Chat Settings</h3>
                    <button
                      onClick={() => setShowSettings(false)}
                      className="text-white/60 hover:text-white/90 transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  
                  {/* Auto-play voice messages */}
                  <div className="space-y-2">
                    <label className="flex items-center justify-between">
                      <span className="text-white/90 text-sm">Auto-play voice messages</span>
                      <button
                        onClick={() => setVoiceChatAutoPlay(!voiceChatAutoPlay)}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                          voiceChatAutoPlay ? 'bg-purple-600' : 'bg-gray-600'
                        }`}
                      >
                        <span
                          className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                            voiceChatAutoPlay ? 'translate-x-5' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </label>
                    <p className="text-white/60 text-xs">Automatically play voice messages from others</p>
                  </div>

                  {/* Voice chat volume */}
                  <div className="space-y-2">
                    <label className="text-white/90 text-sm flex items-center space-x-2">
                      <Volume2 className="w-4 h-4" />
                      <span>Voice chat volume</span>
                    </label>
                    <div className="flex items-center space-x-2">
                      <VolumeX className="w-3 h-3 text-white/60" />
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.1"
                        value={voiceChatVolume}
                        onChange={(e) => setVoiceChatVolume(Number(e.target.value))}
                        className="flex-1 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer slider"
                      />
                      <Volume2 className="w-3 h-3 text-white/60" />
                    </div>
                    <p className="text-white/60 text-xs">Volume level for voice messages and live chat</p>
                  </div>

                  {/* Live voice chat mode */}
                  <div className="space-y-2">
                    <label className="flex items-center justify-between">
                      <span className="text-white/90 text-sm">Live voice chat mode</span>
                      <button
                        onClick={() => {
                          if (isLiveVoiceMode) {
                            stopLiveVoiceChat();
                          } else {
                            startLiveVoiceChat();
                          }
                        }}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                          isLiveVoiceMode ? 'bg-green-600' : 'bg-gray-600'
                        }`}
                      >
                        <span
                          className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                            isLiveVoiceMode ? 'translate-x-5' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </label>
                    <p className="text-white/60 text-xs">
                      {isLiveVoiceMode 
                        ? "Continuous voice transmission active" 
                        : "Tap mic to record and send voice messages"
                      }
                    </p>
                  </div>

                  {/* Live voice status */}
                  {isLiveVoiceMode && (
                    <div className="bg-green-900/30 border border-green-600/30 rounded-lg p-3">
                      <div className="flex items-center space-x-2">
                        <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                        <span className="text-green-400 text-sm font-medium">
                          Live mode active - Continuous transmission
                        </span>
                      </div>
                      <p className="text-green-300/80 text-xs mt-1">
                        Your microphone is continuously active and transmitting to others
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* messages list */}
            <div ref={chatScrollRef} className="hide-scrollbar overflow-y-auto px-4 pt-2" style={{ flex: 1 }}>
              <div className="space-y-3 px-1 pb-6">
                {messages.filter(m => !m.isPrivate).map((m, idx) => {
                  const isOwn = m.user.id === user?.id;
                  return (
                    <div key={`${m.id}-${idx}`} className={`flex ${isOwn ? "justify-end" : "justify-start"}`}>
                      {!isOwn && (
                        <div className="mr-2">
                          <Avatar className="h-8 w-8 flex-shrink-0">
                            <AvatarImage src={m.user.picture || "/placeholder.svg"} />
                            <AvatarFallback className="text-xs bg-gray-700">{m.user.name.split(" ").map((n:string)=>n[0]).join("")}</AvatarFallback>
                          </Avatar>
                        </div>
                      )}

                      <div className={`max-w-[78%] ${isOwn ? "order-1 text-right" : "order-2 text-left"}`}>
                        {!isOwn && <div className="text-xs text-white/80 mb-1">{m.user.name}</div>}

                        <div className="text-white text-sm leading-snug">
                          {m.type === "voice" ? (
                            <div className="flex items-center justify-start space-x-3">
                              <button
                                onClick={() => {
                                  if (playingVoiceMessages.has(m.id)) pauseVoiceMessage(m.id);
                                  else if (m.audioUrl) playVoiceMessage(m.id, m.audioUrl);
                                }}
                                className="p-1 rounded bg-white/6"
                              >
                                {playingVoiceMessages.has(m.id) ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                              </button>
                              <div className="text-white/95">{m.duration ? `${m.duration}s` : "Voice message"}</div>
                            </div>
                          ) : (
                            <div className="whitespace-pre-wrap">{m.message}</div>
                          )}
                        </div>

                        <div className={`text-[10px] mt-1 ${isOwn ? "text-white/60" : "text-white/55"}`}>{m.timestamp}</div>
                      </div>

                      {isOwn && (
                        <div className="ml-2">
                          <Avatar className="h-8 w-8 flex-shrink-0">
                            <AvatarImage src={m.user.picture || "/placeholder.svg"} />
                            <AvatarFallback className="text-xs bg-purple-700">{m.user.name.split(" ").map((n:string)=>n[0]).join("")}</AvatarFallback>
                          </Avatar>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* sticky bottom input */}
            <div className="px-4 py-3 flex-shrink-0 bg-transparent border-t border-white/6">
              <div className="flex items-center space-x-2">
                <Input
                  placeholder="Type a message..."
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && message.trim()) { e.preventDefault(); sendMessage(); } }}
                  className="bg-transparent border border-white/8 text-white placeholder:text-gray-300 flex-1"
                  disabled={isRecording}
                />

                {!audioBlob ? (
                  <button
                    onClick={handleMicClick}
                    className={`p-2 rounded transition-colors ${
                      isLiveVoiceMode 
                        ? "bg-green-600 text-white"
                        : (isRecording ? "bg-red-600 text-white" : "bg-gray-700 text-white hover:bg-gray-600")
                    }`}
                    title={
                      isLiveVoiceMode 
                        ? "Live mode active - use LIVE/MSG button to toggle"
                        : (isRecording ? "Stop recording" : "Record voice message")
                    }
                  >
                    {isLiveVoiceMode ? (
                      <div className="flex items-center space-x-1">
                        <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
                        <Mic className="w-4 h-4" />
                      </div>
                    ) : isRecording ? (
                      <div className="flex items-center space-x-1">
                        <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
                        <Mic className="w-4 h-4" />
                      </div>
                    ) : (
                      <Mic className="w-4 h-4" />
                    )}
                  </button>
                ) : (
                  <div className="flex items-center space-x-2">
                    <button onClick={() => { try { const a = new Audio(URL.createObjectURL(audioBlob)); a.play(); } catch (e) { console.error(e); } }} className="p-2 rounded bg-gray-700 text-white"><Play className="w-4 h-4" /></button>
                    <button onClick={() => { setAudioBlob(null); }} className="p-2 rounded bg-gray-700 text-white"><Trash2 className="w-4 h-4" /></button>
                    <Button onClick={() => handleSendVoiceMessage()} className="bg-purple-600 hover:bg-purple-700 px-3" disabled={isSendingVoiceMessage}>
                      {isSendingVoiceMessage ? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" />Sending...</>) : (<Send className="h-4 w-4" />)}
                    </Button>
                  </div>
                )}

                {!audioBlob && <Button onClick={sendMessage} className="bg-purple-600 hover:bg-purple-700 px-3 disabled:opacity-50"><Send className="h-4 w-4" /></Button>}
              </div>

              {isRecording && <div className="text-xs text-white/80 mt-2">Recording... {recordingTime.toFixed(1)}s</div>}
              {audioBlob && <div className="text-xs text-white/80 mt-2">Preview & ready to send — {formatTime(recordingTime)}</div>}
            </div>
          </div>
        </div>
      )}

      {/* NEW: Voice Chat Manager */}
      <VoiceChatManager
        isVisible={showVoiceChatManager}
        onClose={() => setShowVoiceChatManager(false)}
        participants={participants}
        globalVoiceVolume={voiceChatVolume}
      />
    </>
  );
}
