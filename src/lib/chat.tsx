// src/components/Chat.tsx
"use client";

import React, { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Play, Pause, Mic, Trash2, Send, Loader2 } from "lucide-react";
import type { SocketMessage, Participant } from "@/lib/socket";

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
}: Props) {
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const prevMessagesRef = useRef<string | null>(null);
  const [ephemeralQueue, setEphemeralQueue] = useState<EphemeralItem[]>([]);

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
  `;

  // autoscroll when the panel is visible and messages update
  useEffect(() => {
    const el = chatScrollRef.current;
    if (!el || !isVisible) return;
    const id = window.setTimeout(() => {
      const atBottom = el.scrollHeight - el.clientHeight <= el.scrollTop + 160;
      if (atBottom) el.scrollTop = el.scrollHeight;
    }, 80);
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

    // Show floating animation if floating mode enabled OR panel is visible (keeps old behavior)
    if (isFloatingMode || isVisible) {
      const item: EphemeralItem = {
        id: `${last.id || Date.now()}`,
        text: last.type === "voice" ? "Voice message" : (last.message || ""),
        fromId: last.user?.id,
        fromName: last.user?.name,
        fromAvatar: last.user?.picture,
      };
      setEphemeralQueue((q) => [...q, item]);

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

  // Toggle via icon only; if opening panel clear ephemeralQueue (so sender won't see leftover)
  const onToggle = () => {
    setIsVisible((v) => {
      const next = !v;
      if (next) setEphemeralQueue([]); // clear ephemeral when panel opens
      return next;
    });
  };

  return (
    <>
      <style>{styleBlock}</style>

      {/* Chat toggle icon top-right */}
      <div className="absolute top-3 right-3 z-50 flex items-center space-x-2 pointer-events-auto">
        <button
          onClick={() => setIsFloatingMode((v) => !v)}
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
        <div className="absolute top-1/3 right-4 z-60 pointer-events-none" style={{ width: 360, maxWidth: "92%" }}>
          <div className="flex flex-col items-end space-y-2">
            {ephemeralQueue.map((q, idx) => (
              <div
                key={q.id}
                className="ephemeral-center px-4 py-2 rounded-md bg-black/72 text-white text-sm shadow-lg flex items-center space-x-3"
                style={{ minWidth: 220, transform: `translateY(${idx * 12}px)` }}
              >
                {/* Avatar */}
                <div className="flex-shrink-0">
                  {q.fromAvatar ? (
                    <img src={q.fromAvatar} alt={q.fromName || "avatar"} className="w-8 h-8 rounded-full object-cover border border-white/8" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center text-xs text-white">{(q.fromName || "U").split(" ").map(s=>s[0]).join("").slice(0,2)}</div>
                  )}
                </div>

                <div className="text-left">
                  <div className="font-medium text-sm">{q.fromName}</div>
                  <div className="text-sm text-white/95">{q.text}</div>
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
          <button
            onClick={() => setIsFloatingMode(v => !v)}
            className="hidden md:inline-flex items-center justify-center px-2 py-1 rounded bg-transparent text-white/90 hover:bg-white/5 text-xs"
          >
            {isFloatingMode ? "Panel" : "Float"}
          </button>
        </div>
      </div>

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
              onMouseDown={() => { if (!isRecording) startRecording(); }}
              onMouseUp={() => { if (isRecording) stopRecording(); }}
              onMouseLeave={() => { if (isRecording) stopRecording(); }}
              className={`p-2 rounded ${isRecording ? "bg-red-600 text-white" : "bg-gray-700 text-white"}`}
              title={isRecording ? "Stop recording" : "Record voice message"}
            >
              {isRecording ? (
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
                <button
                  onClick={() => setIsFloatingMode(v => !v)}
                  className="hidden md:inline-flex items-center justify-center px-2 py-1 rounded bg-transparent text-white/90 hover:bg-white/5 text-xs"
                >
                  {isFloatingMode ? "Panel" : "Float"}
                </button>
              </div>
            </div>

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
                    onMouseDown={() => { if (!isRecording) startRecording(); }}
                    onMouseUp={() => { if (isRecording) stopRecording(); }}
                    onMouseLeave={() => { if (isRecording) stopRecording(); }}
                    className={`p-2 rounded ${isRecording ? "bg-red-600 text-white" : "bg-gray-700 text-white"}`}
                    title={isRecording ? "Stop recording" : "Record voice message"}
                  >
                    {isRecording ? (
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
    </>
  );
}
