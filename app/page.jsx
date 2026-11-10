'use client';

import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { 
  Mic, MicOff, Video, VideoOff, Monitor, MonitorOff, 
  PhoneOff, Volume2, VolumeX, Hash, Settings, Users, Sparkles, Radio, 
  MessageSquare, Send, Signal, Sliders, ChevronDown, Compass, LayoutGrid
} from 'lucide-react';

let socket;

const CHANNELS = [
  { id: 'genel-oda', name: 'Genel Sohbet' },
  { id: 'gaming-lounge', name: 'Gaming Lounge' },
  { id: 'tech-talk', name: 'Tech & Architecture' },
];

export default function DiscordVoiceApp() {
  const [activeChannel, setActiveChannel] = useState('genel-oda');
  const [inCall, setInCall] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [isVideoOn, setIsVideoOn] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [activeLocalStream, setActiveLocalStream] = useState(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  
  // Metin Sohbeti & Ayarlar
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [showChat, setShowChat] = useState(true);
  const [ping, setPing] = useState(14);
  const [userVolumes, setUserVolumes] = useState({});
  const [showSettingsModal, setShowSettingsModal] = useState(false);

  // Mekânsal Ses / Masa Modu State'leri
  const [viewMode, setViewMode] = useState('grid'); // 'grid' veya 'spatial'
  const [localSeat, setLocalSeat] = useState(0); // Masadaki koltuk pozisyonu (0-5 arası)
  const [peerSeats, setPeerSeats] = useState({}); // { peerId: seatIndex }

  const [peers, setPeers] = useState([]);

  const localStreamRef = useRef(null);
  const localVideoRef = useRef(null);
  const peerConnections = useRef({});
  const screenStreamRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const chatBottomRef = useRef(null);

  useEffect(() => {
    socket = io();

    const pingInterval = setInterval(() => {
      setPing(Math.floor(Math.random() * 15) + 10);
    }, 4000);

    socket.on('user-connected', async (userId) => {
      playSfx('join');
      const pc = createPeerConnection(userId);
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => pc.addTrack(track, localStreamRef.current));
      }
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('offer', { target: userId, signal: offer });
    });

    socket.on('offer', async (data) => {
      const pc = createPeerConnection(data.caller);
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => pc.addTrack(track, localStreamRef.current));
      }
      await pc.setRemoteDescription(new RTCSessionDescription(data.signal));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('answer', { target: data.caller, signal: answer });
    });

    socket.on('answer', async (data) => {
      const pc = peerConnections.current[data.id];
      if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(data.signal));
      }
    });

    socket.on('ice-candidate', async (data) => {
      const pc = peerConnections.current[data.id];
      if (pc) {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      }
    });

    socket.on('chat-message', (msg) => {
      setMessages((prev) => [...prev, msg]);
    });

    socket.on('seat-update', (data) => {
      setPeerSeats((prev) => ({ ...prev, [data.userId]: data.seat }));
    });

    socket.on('user-disconnected', (userId) => {
      playSfx('leave');
      if (peerConnections.current[userId]) {
        peerConnections.current[userId].close();
        delete peerConnections.current[userId];
      }
      setPeers((prev) => prev.filter((p) => p.id !== userId));
      setPeerSeats((prev) => {
        const copy = { ...prev };
        delete copy[userId];
        return copy;
      });
    });

    return () => {
      clearInterval(pingInterval);
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, showChat]);

  // Web Audio API ile Yankısız Konuşma Algılama
  useEffect(() => {
    if (!activeLocalStream || isMuted || isDeafened) {
      setIsSpeaking(false);
      return;
    }

    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      audioContextRef.current = audioCtx;
      
      const analyser = audioCtx.createAnalyser();
      analyserRef.current = analyser;
      analyser.fftSize = 512;

      const microphone = audioCtx.createMediaStreamSource(activeLocalStream);
      microphone.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      let animationId;
      const checkAudioLevel = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        let average = sum / bufferLength;
        setIsSpeaking(average > 12);
        animationId = requestAnimationFrame(checkAudioLevel);
      };

      checkAudioLevel();

      return () => {
        cancelAnimationFrame(animationId);
        if (audioCtx && audioCtx.state !== 'closed') {
          audioCtx.close();
        }
      };
    } catch (e) {
      console.error("Audio API hatası:", e);
    }
  }, [activeLocalStream, isMuted, isDeafened]);

  useEffect(() => {
    if (localVideoRef.current && activeLocalStream) {
      localVideoRef.current.srcObject = activeLocalStream;
      localVideoRef.current.play().catch((err) => console.log("Play hatası:", err));
    }
  }, [activeLocalStream, isScreenSharing, isVideoOn]);

  const playSfx = (type) => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      if (type === 'join') {
        osc.frequency.setValueAtTime(440, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15);
      } else {
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.15);
      }

      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    } catch (e) {}
  };

  const createPeerConnection = (userId) => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });

    peerConnections.current[userId] = pc;

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('ice-candidate', { target: userId, candidate: event.candidate });
      }
    };

    pc.ontrack = (event) => {
      setPeers((prev) => {
        if (prev.find((p) => p.id === userId)) return prev;
        return [...prev, { id: userId, stream: event.streams[0] }];
      });
    };

    return pc;
  };

  const startCall = async (channelId) => {
    try {
      setActiveChannel(channelId);
      playSfx('join');
      
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 48000
        }, 
        video: true 
      });

      stream.getVideoTracks()[0].enabled = false;
      
      localStreamRef.current = stream;
      setActiveLocalStream(stream);
      setInCall(true);
      socket.emit('join-room', channelId);
      socket.emit('update-seat', { seat: localSeat });
    } catch (err) {
      console.error('Medya erişim hatası:', err);
    }
  };

  const endCall = () => {
    playSfx('leave');
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((track) => track.stop());
    }
    Object.values(peerConnections.current).forEach((pc) => pc.close());
    peerConnections.current = {};
    setPeers([]);
    setInCall(false);
    setIsVideoOn(false);
    setIsScreenSharing(false);
    setActiveLocalStream(null);
    setIsSpeaking(false);
  };

  const changeSeat = (seatIndex) => {
    setLocalSeat(seatIndex);
    socket.emit('update-seat', { seat: seatIndex });
  };

  const toggleMute = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = isMuted;
        setIsMuted(!isMuted);
      }
    }
  };

  const toggleDeafen = () => {
    const newDeafState = !isDeafened;
    setIsDeafened(newDeafState);
    if (newDeafState && !isMuted) {
      setIsMuted(true);
      if (localStreamRef.current) {
        const audioTrack = localStreamRef.current.getAudioTracks()[0];
        if (audioTrack) audioTrack.enabled = false;
      }
    }
  };

  const toggleVideo = () => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !isVideoOn;
        setIsVideoOn(!isVideoOn);
        if (!isScreenSharing) {
          setActiveLocalStream(localStreamRef.current);
        }
      }
    }
  };

  const toggleScreenShare = async () => {
    if (!isScreenSharing) {
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            frameRate: { ideal: 60, max: 60 },
            width: { ideal: 1920, max: 3840 },
            height: { ideal: 1080, max: 2160 }
          },
          audio: true
        });

        screenStreamRef.current = screenStream;
        setIsScreenSharing(true);
        setActiveLocalStream(screenStream);

        const screenTrack = screenStream.getVideoTracks()[0];

        Object.values(peerConnections.current).forEach((pc) => {
          const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
          if (sender) {
            sender.replaceTrack(screenTrack);
          } else {
            pc.addTrack(screenTrack, screenStream);
          }
        });

        screenTrack.onended = () => {
          stopScreenShare();
        };
      } catch (err) {
        console.error('Ekran paylaşımı hatası:', err);
      }
    } else {
      stopScreenShare();
    }
  };

  const stopScreenShare = () => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop());
    }
    setIsScreenSharing(false);
    setActiveLocalStream(localStreamRef.current);
  };

  const sendMessage = (e) => {
    e.preventDefault();
    if (!newMessage.trim()) return;
    const msgData = { user: 'Cem Dev', text: newMessage, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) };
    socket.emit('chat-message', msgData);
    setMessages((prev) => [...prev, msgData]);
    setNewMessage('');
  };

  const updatePeerVolume = (peerId, vol) => {
    setUserVolumes((prev) => ({ ...prev, [peerId]: vol }));
  };

  // Mekânsal Ses Hesaplama: Koltuk indekslerine göre X, Y konumları ve ses panning derecesi (-1 ile 1 arası)
  // Masanın 6 koltuğu için açısal koordinatlar
  const seatCoordinates = [
    { x: 0, y: -120, pan: 0 },    // 0: Üst
    { x: 110, y: -60, pan: 0.6 },  // 1: Sağ Üst
    { x: 110, y: 60, pan: 0.9 },   // 2: Sağ Alt
    { x: 0, y: 120, pan: 0 },      // 3: Alt
    { x: -110, y: 60, pan: -0.9 }, // 4: Sol Alt
    { x: -110, y: -60, pan: -0.6 } // 5: Sol Üst
  ];

  const getSpatialPan = (peerId) => {
    const peerSeat = peerSeats[peerId] ?? 1;
    const diff = (peerSeat - localSeat + 6) % 6;
    if (diff === 1 || diff === 2) return 0.8; // Sağ taraf
    if (diff === 4 || diff === 5) return -0.8; // Sol taraf
    return 0; // Karşı veya aynı
  };

  const isAnyStreamActive = isScreenSharing || isVideoOn || peers.some(p => p.stream?.getVideoTracks()?.length > 0);

  return (
    <div className="flex h-screen w-screen bg-[#313338] text-[#dbdee1] overflow-hidden font-sans select-none">
      
      {/* Sol İkon Barı */}
      <div className="w-[72px] bg-[#1e1f22] flex flex-col items-center py-3 gap-3 shrink-0 z-30">
        <div className="w-12 h-12 bg-[#5865f2] hover:bg-[#4752c4] rounded-[24px] hover:rounded-[16px] transition-all duration-200 flex items-center justify-center text-white cursor-pointer shadow-lg">
          <Sparkles size={24} />
        </div>
        <div className="w-8 h-[2px] bg-[#35363c] rounded-full" />
        <div className="w-12 h-12 bg-[#2b2d31] hover:bg-[#23a55a] hover:rounded-[16px] rounded-[24px] transition-all duration-200 flex items-center justify-center text-[#23a55a] hover:text-white cursor-pointer">
          <Radio size={24} />
        </div>
      </div>

      {/* Kanal Paneli */}
      <div className="w-60 bg-[#2b2d31] flex flex-col border-r border-[#1f2023] shrink-0 z-20">
        <div className="h-12 border-b border-[#1f2023] flex items-center justify-between px-4 font-bold text-white shadow-sm shrink-0">
          <span>Stuck Voice Hub</span>
          <ChevronDown size={16} className="text-[#949ba4] cursor-pointer" />
        </div>

        <div className="flex-1 p-2 space-y-1 overflow-y-auto">
          <div className="text-[11px] font-bold text-[#949ba4] px-2 py-1 uppercase tracking-wider">
            Ses Kanalları
          </div>
          {CHANNELS.map((channel) => {
            const isCurrentActive = inCall && activeChannel === channel.id;
            return (
              <div
                key={channel.id}
                onClick={() => !inCall && startCall(channel.id)}
                className={`flex items-center justify-between px-2 py-2 rounded-md transition-all ${
                  isCurrentActive 
                    ? 'bg-[#35373c] text-white font-medium' 
                    : 'hover:bg-[#35373c]/50 hover:text-[#dbdee1] text-[#949ba4] cursor-pointer'
                }`}
              >
                <div className="flex items-center gap-2 truncate">
                  <Volume2 size={18} className={isCurrentActive ? 'text-[#23a55a]' : 'text-[#80848e]'} />
                  <span className="text-sm truncate">{channel.name}</span>
                </div>
                {isCurrentActive && <span className="w-2 h-2 rounded-full bg-[#23a55a] animate-pulse" />}
              </div>
            );
          })}
        </div>

        {/* Profil Barı */}
        <div className="h-14 bg-[#232428] px-3 flex items-center justify-between shrink-0 border-t border-[#1f2023]">
          <div className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-full bg-[#5865f2] flex items-center justify-center text-white font-bold text-xs transition-all ${isSpeaking ? 'ring-2 ring-[#23a55a]' : ''}`}>
              KC
            </div>
            <div className="flex flex-col">
              <span className="text-xs font-bold text-white leading-tight flex items-center gap-1">
                Cem Dev 
                <span className="text-[9px] text-[#23a55a] flex items-center"><Signal size={10} /> {ping}ms</span>
              </span>
              <span className="text-[10px] text-[#949ba4]">Çevrimiçi</span>
            </div>
          </div>
          <button onClick={() => setShowSettingsModal(true)} className="text-[#b5bac1] hover:text-white transition-colors">
            <Settings size={18} />
          </button>
        </div>
      </div>

      {/* Ana Sahne */}
      <div className="flex-1 flex flex-col bg-[#313338] relative min-w-0">
        
        {/* Üst Bar ve Görünüm Modu Değiştirici */}
        <div className="h-12 border-b border-[#1f2023] flex items-center justify-between px-4 font-bold text-white bg-[#313338] shadow-sm shrink-0">
          <div className="flex items-center gap-2">
            <Hash size={20} className="text-[#80848e]" />
            <span>{CHANNELS.find(c => c.id === activeChannel)?.name}</span>
          </div>

          <div className="flex items-center gap-3">
            {inCall && (
              <div className="bg-[#1e1f22] p-1 rounded-lg flex items-center gap-1 border border-[#2b2d31]">
                <button 
                  onClick={() => setViewMode('grid')} 
                  className={`px-3 py-1 rounded text-xs font-medium flex items-center gap-1.5 transition-all ${viewMode === 'grid' ? 'bg-[#5865f2] text-white shadow' : 'text-[#949ba4] hover:text-white'}`}
                >
                  <LayoutGrid size={14} /> Grid Modu
                </button>
                <button 
                  onClick={() => setViewMode('spatial')} 
                  className={`px-3 py-1 rounded text-xs font-medium flex items-center gap-1.5 transition-all ${viewMode === 'spatial' ? 'bg-[#23a55a] text-white shadow' : 'text-[#949ba4] hover:text-white'}`}
                >
                  <Compass size={14} /> Masa & Mekânsal Ses
                </button>
              </div>
            )}

            {inCall && (
              <button 
                onClick={() => setShowChat(!showChat)} 
                className={`p-1.5 rounded-md transition-colors ${showChat ? 'bg-[#35373c] text-white' : 'text-[#b5bac1] hover:text-white'}`}
              >
                <MessageSquare size={20} />
              </button>
            )}

            {inCall && (
              <span className="text-xs bg-[#23a55a]/10 text-[#23a55a] border border-[#23a55a]/20 px-2.5 py-1 rounded-full font-medium flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#23a55a] animate-pulse" /> Ses Bağlandı
              </span>
            )}
          </div>
        </div>

        {/* Ana İçerik / Görünüm */}
        <div className="flex-1 flex min-h-0 relative overflow-hidden">
          
          <div className="flex-1 p-3 flex gap-3 min-h-0 relative overflow-hidden items-center justify-center">
            {!inCall ? (
              <div className="m-auto text-center space-y-3">
                <div className="w-16 h-16 bg-[#2b2d31] rounded-full flex items-center justify-center mx-auto text-[#80848e]">
                  <Volume2 size={32} />
                </div>
                <p className="text-[#949ba4] text-sm">Sohbete başlamak için bir ses kanalına katılın.</p>
                <button 
                  onClick={() => startCall('genel-oda')} 
                  className="px-6 py-2.5 bg-[#23a55a] hover:bg-[#1f8c4c] text-white font-medium rounded-md shadow-lg transition-all"
                >
                  Kanala Katıl
                </button>
              </div>
            ) : viewMode === 'grid' ? (
              // 1. Klasik Grid Modu
              <div className="w-full h-full flex flex-col md:flex-row gap-3">
                <div className={`flex-1 rounded-xl bg-[#111214] border border-[#1f2023] relative overflow-hidden flex items-center justify-center shadow-2xl transition-all ${!isAnyStreamActive ? 'grid grid-cols-1 md:grid-cols-2 p-3 gap-3 bg-transparent border-none shadow-none' : ''}`}>
                  <div className={`relative flex items-center justify-center overflow-hidden rounded-xl bg-[#111214] border border-[#1f2023] w-full h-full ${!isAnyStreamActive ? 'aspect-video' : ''}`}>
                    <video 
                      ref={localVideoRef} 
                      autoPlay 
                      playsInline 
                      muted={true} 
                      className={`w-full h-full object-contain bg-black ${isVideoOn || isScreenSharing ? 'block' : 'hidden'}`} 
                    />
                    {!(isVideoOn || isScreenSharing) && (
                      <div className="flex flex-col items-center gap-2">
                        <div className={`w-20 h-20 rounded-full bg-[#5865f2] flex items-center justify-center text-white font-bold text-2xl shadow-xl transition-all ${isSpeaking ? 'ring-4 ring-[#23a55a]' : 'ring-4 ring-[#5865f2]/20'}`}>
                          KC
                        </div>
                        <span className="text-sm font-semibold text-[#dbdee1]">Cem Dev</span>
                      </div>
                    )}
                    <div className="absolute bottom-3 left-3 bg-black/60 backdrop-blur-md px-3 py-1 rounded-md text-xs text-white font-medium flex items-center gap-2 border border-white/10 z-10">
                      <span className="w-2 h-2 rounded-full bg-[#23a55a]" />
                      Sen {isScreenSharing ? '(Canlı Yayın)' : isVideoOn ? '(Kamera)' : ''}
                    </div>
                  </div>
                </div>

                {isAnyStreamActive && (
                  <div className="w-full md:w-64 flex md:flex-col gap-2 overflow-y-auto shrink-0">
                    {peers.map((peer) => (
                      <RemoteUserCard 
                        key={peer.id} 
                        stream={peer.stream} 
                        id={peer.id} 
                        isDeafened={isDeafened} 
                        volume={userVolumes[peer.id] ?? 1}
                        onVolumeChange={updatePeerVolume}
                        isSmall 
                      />
                    ))}
                  </div>
                )}
                {!isAnyStreamActive && peers.map((peer) => (
                  <RemoteUserCard 
                    key={peer.id} 
                    stream={peer.stream} 
                    id={peer.id} 
                    isDeafened={isDeafened} 
                    volume={userVolumes[peer.id] ?? 1}
                    onVolumeChange={updatePeerVolume}
                  />
                ))}
              </div>
            ) : (
              // 2. YENİ: Masa & Mekânsal Ses Modu (Spatial Audio / Proximity)
              <div className="w-full h-full bg-[#111214] rounded-2xl border border-[#1f2023] relative flex items-center justify-center shadow-2xl overflow-hidden">
                <div className="absolute top-6 left-6 bg-[#1e1f22]/80 backdrop-blur-md border border-[#2b2d31] px-4 py-2 rounded-xl text-xs text-[#949ba4] flex items-center gap-2 z-20">
                  <Compass size={16} className="text-[#23a55a] animate-spin" />
                  <span>Mekânsal Ses Aktif: Masadaki koltuğunu değiştirerek ses yönünü ve uzaklığını ayarlayabilirsin.</span>
                </div>

                {/* Yuvarlak Masa */}
                <div className="w-64 h-64 rounded-full border-4 border-dashed border-[#35363c] bg-[#1a1b1e] flex items-center justify-center relative shadow-inner">
                  <span className="text-xs font-bold text-[#80848e] tracking-widest uppercase">Stuck Conference</span>

                  {/* 6 Adet Koltuk Yerleşimi */}
                  {seatCoordinates.map((seat, idx) => {
                    const isMySeat = localSeat === idx;
                    const occupantPeer = peers.find(p => (peerSeats[p.id] ?? 1) === idx);

                    return (
                      <div 
                        key={idx}
                        onClick={() => changeSeat(idx)}
                        style={{ transform: `translate(${seat.x}px, ${seat.y}px)` }}
                        className={`absolute w-14 h-14 rounded-full flex items-center justify-center cursor-pointer transition-all border-2 shadow-lg ${
                          isMySeat 
                            ? 'bg-[#5865f2] border-white text-white ring-4 ring-[#5865f2]/30 scale-110 z-10' 
                            : occupantPeer 
                            ? 'bg-[#23a55a] border-white text-white' 
                            : 'bg-[#2b2d31] border-[#3f4147] text-[#949ba4] hover:border-[#5865f2]'
                        }`}
                        title={isMySeat ? "Senin Koltuğun" : occupantPeer ? `Kullanıcı (${occupantPeer.id.slice(0,4)})` : "Boş Koltuk (Oturmak için tıkla)"}
                      >
                        <span className="text-xs font-bold">
                          {isMySeat ? 'SEN' : occupantPeer ? occupantPeer.id.slice(0, 2).toUpperCase() : `#${idx+1}`}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Metin Sohbeti Yan Paneli */}
          {inCall && showChat && (
            <div className="w-80 bg-[#313338] border-l border-[#1f2023] flex flex-col shrink-0 z-20">
              <div className="h-10 border-b border-[#1f2023] px-3 flex items-center text-xs font-bold text-white shadow-sm">
                Oda Sohbeti
              </div>
              <div className="flex-1 p-3 overflow-y-auto space-y-3">
                {messages.length === 0 && (
                  <div className="text-center text-[#949ba4] text-xs mt-10">
                    Henüz mesaj yok. İlk mesajı sen gönder!
                  </div>
                )}
                {messages.map((m, idx) => (
                  <div key={idx} className="flex flex-col">
                    <div className="flex items-baseline gap-2">
                      <span className="text-xs font-bold text-white">{m.user}</span>
                      <span className="text-[10px] text-[#949ba4]">{m.time}</span>
                    </div>
                    <span className="text-sm text-[#dbdee1] mt-0.5 break-words">{m.text}</span>
                  </div>
                ))}
                <div ref={chatBottomRef} />
              </div>
              <form onSubmit={sendMessage} className="p-3 bg-[#313338]">
                <div className="bg-[#383a40] rounded-lg px-3 py-2 flex items-center gap-2">
                  <input 
                    type="text" 
                    value={newMessage} 
                    onChange={(e) => setNewMessage(e.target.value)} 
                    placeholder="Mesaj gönder..." 
                    className="bg-transparent text-sm text-white focus:outline-none w-full"
                  />
                  <button type="submit" className="text-[#949ba4] hover:text-white transition-colors">
                    <Send size={16} />
                  </button>
                </div>
              </form>
            </div>
          )}

        </div>

        {/* Alt Yüzen Kontrol Paneli */}
        {inCall && (
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-[#1e1f22]/90 backdrop-blur-md px-6 py-3 rounded-2xl border border-[#2b2d31] flex items-center gap-4 shadow-2xl z-40">
            <button 
              onClick={toggleMute} 
              className={`p-3 rounded-full transition-all ${isMuted ? 'bg-[#ed4245] text-white hover:bg-[#c9383b]' : 'bg-[#2b2d31] hover:bg-[#35373c] text-white'}`}
            >
              {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
            </button>

            <button 
              onClick={toggleDeafen} 
              className={`p-3 rounded-full transition-all ${isDeafened ? 'bg-[#ed4245] text-white hover:bg-[#c9383b]' : 'bg-[#2b2d31] hover:bg-[#35373c] text-white'}`}
            >
              {isDeafened ? <VolumeX size={20} /> : <Volume2 size={20} />}
            </button>

            <button 
              onClick={toggleVideo} 
              className={`p-3 rounded-full transition-all ${isVideoOn ? 'bg-[#23a55a] text-white hover:bg-[#1f8c4c]' : 'bg-[#2b2d31] hover:bg-[#35373c] text-white'}`}
            >
              {isVideoOn ? <Video size={20} /> : <VideoOff size={20} />}
            </button>

            <button 
              onClick={toggleScreenShare} 
              className={`p-3 rounded-full transition-all ${isScreenSharing ? 'bg-[#23a55a] text-white animate-pulse' : 'bg-[#2b2d31] hover:bg-[#35373c] text-white'}`}
            >
              {isScreenSharing ? <Monitor size={20} /> : <MonitorOff size={20} />}
            </button>

            <div className="w-[1px] h-6 bg-[#35363c]" />

            <button 
              onClick={endCall} 
              className="p-3 bg-[#ed4245] hover:bg-[#c9383b] text-white rounded-full transition-all shadow-md"
            >
              <PhoneOff size={20} />
            </button>
          </div>
        )}

      </div>

      {/* Ses ve Gürültü Ayarları Modalı */}
      {showSettingsModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-[#313338] w-[480px] rounded-2xl border border-[#1f2023] p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-[#1f2023] pb-3">
              <h2 className="text-lg font-bold text-white flex items-center gap-2"><Sliders size={20} /> Ses ve Gürültü Ayarları</h2>
              <button onClick={() => setShowSettingsModal(false)} className="text-[#b5bac1] hover:text-white">✕</button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-bold text-[#949ba4] uppercase tracking-wider">Yapay Zeka Gürültü Baskılama</label>
                <div className="mt-2 p-3 bg-[#2b2d31] rounded-lg border border-[#1f2023] flex items-center justify-between">
                  <span className="text-sm text-white">Krisp / WebRTC Donanımsal Filtreleme</span>
                  <span className="px-2.5 py-1 bg-[#23a55a]/20 text-[#23a55a] text-xs font-semibold rounded-full">Aktif</span>
                </div>
              </div>
            </div>
            <div className="pt-4 border-t border-[#1f2023] flex justify-end">
              <button 
                onClick={() => setShowSettingsModal(false)}
                className="px-5 py-2 bg-[#5865f2] hover:bg-[#4752c4] text-white text-sm font-medium rounded-md transition-all"
              >
                Tamam
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

function RemoteUserCard({ stream, id, isDeafened, volume, onVolumeChange, isSmall }) {
  const videoRef = useRef(null);
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);
  const hasVideo = stream?.getVideoTracks()?.length > 0;

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.muted = isDeafened;
      videoRef.current.volume = volume;
      videoRef.current.play().catch(err => console.log("Remote play error:", err));
    }
  }, [stream, isDeafened, volume]);

  return (
    <div 
      onContextMenu={(e) => { e.preventDefault(); setShowVolumeSlider(!showVolumeSlider); }}
      className={`bg-[#111214] rounded-xl relative flex items-center justify-center border border-[#1f2023] overflow-hidden shadow-md transition-all ${isSmall ? 'h-36 w-full' : 'w-full h-full aspect-video'}`}
    >
      <video ref={videoRef} autoPlay playsInline muted={isDeafened} className={`w-full h-full object-contain bg-black ${hasVideo ? 'block' : 'hidden'}`} />
      
      {!hasVideo && (
        <div className="flex flex-col items-center gap-1">
          <div className="w-12 h-12 rounded-full bg-indigo-600 flex items-center justify-center text-white font-bold text-sm">
            {id.slice(0, 2).toUpperCase()}
          </div>
          <span className="text-xs text-[#949ba4]">Kullanıcı ({id.slice(0, 4)})</span>
        </div>
      )}
      
      <div className="absolute bottom-2 left-2 bg-black/60 backdrop-blur-md px-2 py-0.5 rounded text-[10px] text-white font-medium border border-white/10 flex items-center gap-2">
        <span>Kullanıcı ({id.slice(0, 4)})</span>
      </div>

      {showVolumeSlider && (
        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm z-30 flex flex-col items-center justify-center p-4 gap-2">
          <span className="text-xs text-white font-bold">Kullanıcı Ses Seviyesi</span>
          <input 
            type="range" 
            min="0" 
            max="1" 
            step="0.05" 
            value={volume} 
            onChange={(e) => onVolumeChange(id, parseFloat(e.target.value))}
            className="w-32 accent-[#5865f2] cursor-pointer"
          />
          <button 
            onClick={() => setShowVolumeSlider(false)} 
            className="mt-2 px-3 py-1 bg-[#2b2d31] hover:bg-[#35373c] text-white text-xs rounded-md"
          >
            Kapat
          </button>
        </div>
      )}
    </div>
  );
}