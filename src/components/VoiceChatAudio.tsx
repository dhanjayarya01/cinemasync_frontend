"use client";

import React, { useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX, Mic, MicOff } from 'lucide-react';

interface VoiceChatAudioProps {
  peerId: string;
  stream: MediaStream;
  volume: number;
  onVolumeChange?: (volume: number) => void;
  participantName?: string;
  participantAvatar?: string;
}

export default function VoiceChatAudio({
  peerId,
  stream,
  volume,
  onVolumeChange,
  participantName = 'Unknown',
  participantAvatar
}: VoiceChatAudioProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !stream) return;

    audio.srcObject = stream;
    audio.volume = volume;
    audio.autoplay = true;
    audio.playsInline = true;

    // Monitor audio activity
    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    let animationId: number;

    const checkAudioActivity = () => {
      analyser.getByteFrequencyData(dataArray);
      const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
      setIsActive(average > 10); // Threshold for voice activity
      animationId = requestAnimationFrame(checkAudioActivity);
    };

    checkAudioActivity();

    return () => {
      if (animationId) {
        cancelAnimationFrame(animationId);
      }
      audioContext.close();
      if (audio.srcObject) {
        audio.srcObject = null;
      }
    };
  }, [stream]);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.volume = isMuted ? 0 : volume;
    }
  }, [volume, isMuted]);

  const toggleMute = () => {
    setIsMuted(!isMuted);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = Number(e.target.value);
    onVolumeChange?.(newVolume);
  };

  return (
    <div className="flex items-center space-x-3 p-3 bg-gray-800/50 rounded-lg border border-gray-700/50">
      <audio ref={audioRef} />
      
      {/* Participant Avatar */}
      <div className="relative">
        {participantAvatar ? (
          <img 
            src={participantAvatar} 
            alt={participantName} 
            className="w-10 h-10 rounded-full object-cover"
          />
        ) : (
          <div className="w-10 h-10 rounded-full bg-gray-600 flex items-center justify-center text-white text-sm font-medium">
            {participantName.split(' ').map(n => n[0]).join('').slice(0, 2)}
          </div>
        )}
        
        {/* Voice Activity Indicator */}
        {isActive && (
          <div className="absolute -top-1 -right-1 w-4 h-4 bg-green-500 rounded-full animate-pulse flex items-center justify-center">
            <Mic className="w-2 h-2 text-white" />
          </div>
        )}
      </div>

      {/* Participant Info */}
      <div className="flex-1 min-w-0">
        <div className="text-white text-sm font-medium truncate">
          {participantName}
        </div>
        <div className="text-gray-400 text-xs">
          {isActive ? 'Speaking...' : 'Connected'}
        </div>
      </div>

      {/* Volume Control */}
      <div className="flex items-center space-x-2">
        <button
          onClick={toggleMute}
          className="p-1 rounded hover:bg-gray-700/50 transition-colors"
          title={isMuted ? 'Unmute' : 'Mute'}
        >
          {isMuted ? (
            <VolumeX className="w-4 h-4 text-gray-400" />
          ) : (
            <Volume2 className="w-4 h-4 text-white" />
          )}
        </button>
        
        <input
          type="range"
          min="0"
          max="1"
          step="0.1"
          value={volume}
          onChange={handleVolumeChange}
          className="w-16 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer slider"
          title="Volume"
        />
      </div>
    </div>
  );
}