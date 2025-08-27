"use client";

import React, { useEffect, useState, useRef } from 'react';
import VoiceChatAudio from './VoiceChatAudio';
import { X, Users } from 'lucide-react';

interface VoiceStream {
  peerId: string;
  stream: MediaStream;
  participantName: string;
  participantAvatar?: string;
}

interface VoiceChatManagerProps {
  isVisible: boolean;
  onClose: () => void;
  participants: Array<{
    user: {
      id: string;
      name: string;
      picture?: string;
    };
  }>;
  globalVoiceVolume: number;
}

export default function VoiceChatManager({
  isVisible,
  onClose,
  participants,
  globalVoiceVolume
}: VoiceChatManagerProps) {
  const [voiceStreams, setVoiceStreams] = useState<VoiceStream[]>([]);
  const [individualVolumes, setIndividualVolumes] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    // Set up WebRTC voice chat callbacks
    const webrtcManager = (window as any).webrtcManager;
    if (webrtcManager) {
      webrtcManager.setVoiceChatCallbacks({
        onVoiceStreamReceived: (peerId: string, stream: MediaStream) => {
          const participant = participants.find(p => p.user.id === peerId);
          if (participant) {
            const voiceStream: VoiceStream = {
              peerId,
              stream,
              participantName: participant.user.name,
              participantAvatar: participant.user.picture
            };

            setVoiceStreams(prev => {
              // Remove existing stream for this peer if any
              const filtered = prev.filter(vs => vs.peerId !== peerId);
              return [...filtered, voiceStream];
            });

            // Set default volume for new participant
            setIndividualVolumes(prev => {
              const newMap = new Map(prev);
              if (!newMap.has(peerId)) {
                newMap.set(peerId, globalVoiceVolume);
              }
              return newMap;
            });
          }
        },
        onVoiceStreamEnded: (peerId: string) => {
          setVoiceStreams(prev => prev.filter(vs => vs.peerId !== peerId));
          setIndividualVolumes(prev => {
            const newMap = new Map(prev);
            newMap.delete(peerId);
            return newMap;
          });
        }
      });
    }

    return () => {
      // Cleanup callbacks
      if (webrtcManager) {
        webrtcManager.setVoiceChatCallbacks({});
      }
    };
  }, [participants, globalVoiceVolume]);

  const handleVolumeChange = (peerId: string, volume: number) => {
    setIndividualVolumes(prev => {
      const newMap = new Map(prev);
      newMap.set(peerId, volume);
      return newMap;
    });
  };

  if (!isVisible || voiceStreams.length === 0) {
    return null;
  }

  return (
    <div className="fixed bottom-20 right-4 z-50 w-80 max-h-96 bg-gray-900/95 backdrop-blur-sm rounded-lg border border-white/10 shadow-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-gray-700/50">
        <div className="flex items-center space-x-2">
          <Users className="w-4 h-4 text-purple-400" />
          <span className="text-white font-medium text-sm">
            Voice Chat ({voiceStreams.length})
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-white transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Voice Streams */}
      <div className="max-h-80 overflow-y-auto p-3 space-y-3">
        {voiceStreams.map(voiceStream => (
          <VoiceChatAudio
            key={voiceStream.peerId}
            peerId={voiceStream.peerId}
            stream={voiceStream.stream}
            volume={individualVolumes.get(voiceStream.peerId) || globalVoiceVolume}
            onVolumeChange={(volume) => handleVolumeChange(voiceStream.peerId, volume)}
            participantName={voiceStream.participantName}
            participantAvatar={voiceStream.participantAvatar}
          />
        ))}
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-gray-700/50 bg-gray-800/30">
        <div className="text-xs text-gray-400 text-center">
          Live voice chat active • Video volume automatically lowered
        </div>
      </div>
    </div>
  );
}