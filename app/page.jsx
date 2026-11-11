'use client';

import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { 
  Mic, MicOff, Video, VideoOff, Monitor, MonitorOff, 
  PhoneOff, Volume2, VolumeX, Hash, Settings, Users, Sparkles, Radio, 
  MessageSquare, Send, Signal, Sliders, ChevronDown, Compass, LayoutGrid, Maximize2,
  Loader2, Wifi, WifiOff, Server
} from 'lucide-react';

const getSocketUrl = () => {
  let envUrl = process.env.NEXT_PUBLIC_SOCKET_URL || 'socket-vhcw.onrender.com';
  envUrl = envUrl.replace(/^https?:\/\//i, '').replace(/^https\/+/i, '').trim();
  return `https://${envUrl}`;
};

const SOCKET_URL = getSocketUrl();

const CHANNELS = [
  { id: 'genel-oda', name: 'Genel Sohbet' },
  { id: 'gaming-lounge', name: 'Gaming Lounge' },
  { id: 'tech-talk', name: 'Tech & Architecture' },
];

const AUDIO_CONSTRAINTS = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  sampleRate: 48000,
  channelCount: 1,
};

const VIDEO_CONSTRAINTS = {
  width: { ideal: 1280, max: 1920 },
  height: { ideal: 720, max: 1080 },
  frameRate: { ideal: 30, max: 60 },
  facingMode: 'user',
};

const SEAT_COORDINATES = [
  { x: 0, y: -120, pan: 0, label: '1' },
  { x: 110, y: -60, pan: 0.7, label: '2' },
  { x: 110, y: 60, pan: 0.9, label: '3' },
  { x: 0, y: 120, pan: 0, label: '4' },
  { x: -110, y: 60, pan: -0.9, label: '5' },
  { x: -110, y: -60, pan: -0.7, label: '6' },
];

export default function DiscordVoiceApp() {
  const [connectionState, setConnectionState] = useState('connecting');
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const [connectionWaitTime, setConnectionWaitTime] = useState(0);

  const [activeChannel, setActiveChannel] = useState('genel-oda');
  const [inCall, setInCall] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [isVideoOn, setIsVideoOn] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [activeLocalStream, setActiveLocalStream] = useState(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [showChat, setShowChat] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const [ping, setPing] = useState(14);
  const [userVolumes, setUserVolumes] = useState({});
  const [showSettingsModal, setShowSettingsModal] = useState(false);

  const [contextMenu, setContextMenu] = useState(null);

  const [viewMode, setViewMode] = useState('grid');
  const [localSeat, setLocalSeat] = useState(0);
  const [peerSeats, setPeerSeats] = useState({});

  const [peers, setPeers] = useState([]);
  const [roomList, setRoomList] = useState({});
  const [myId, setMyId] = useState(null);

  const socketRef = useRef(null);
  const localStreamRef = useRef(null);
  const localVideoRef = useRef(null);
  const peerConnections = useRef({});
  const screenStreamRef = useRef(null);
  const cameraStreamRef = useRef(null);
  
  // ✅ AYRI CONTEXT'LER — çakışma yok
  const audioContextRef = useRef(null);       // Local mic işleme
  const speakingContextRef = useRef(null);    // Konuşma göstergesi analiz
  const playbackContextRef = useRef(null);    // Remote ses çalma (spatial)
  
  const analyserRef = useRef(null);
  const chatBottomRef = useRef(null);
  const gateCleanupRef = useRef(null);        // ✅ Gate animation iptal

  const spatialAudioNodes = useRef({});

  const isVideoOnRef = useRef(false);
  const isScreenSharingRef = useRef(false);
  const inCallRef = useRef(false);
  const myIdRef = useRef(null);
  const showChatRef = useRef(false);
  const localSeatRef = useRef(0);
  const peerSeatsRef = useRef({});
  const isMutedRef = useRef(false);
  const isDeafenedRef = useRef(false);

  const politeFlags = useRef({});
  const makingOffer = useRef({});
  const ignoreOffer = useRef({});
  const pendingCandidates = useRef({});
  const videoSenders = useRef({});
  const isRenegotiating = useRef({});

  useEffect(() => { isVideoOnRef.current = isVideoOn; }, [isVideoOn]);
  useEffect(() => { isScreenSharingRef.current = isScreenSharing; }, [isScreenSharing]);
  useEffect(() => { inCallRef.current = inCall; }, [inCall]);
  useEffect(() => { myIdRef.current = myId; }, [myId]);
  useEffect(() => { showChatRef.current = showChat; }, [showChat]);
  useEffect(() => { localSeatRef.current = localSeat; }, [localSeat]);
  useEffect(() => { peerSeatsRef.current = peerSeats; }, [peerSeats]);
  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);
  useEffect(() => { isDeafenedRef.current = isDeafened; }, [isDeafened]);

  useEffect(() => {
    if (connectionState === 'connected') {
      setConnectionWaitTime(0);
      return;
    }
    const interval = setInterval(() => {
      setConnectionWaitTime((prev) => {
        const next = prev + 1;
        if (next >= 5 && connectionState === 'connecting') {
          setConnectionState('waking');
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [connectionState]);

  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = () => setContextMenu(null);
    const handleEsc = (e) => { if (e.key === 'Escape') setContextMenu(null); };
    window.addEventListener('click', handleClick);
    window.addEventListener('keydown', handleEsc);
    return () => {
      window.removeEventListener('click', handleClick);
      window.removeEventListener('keydown', handleEsc);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (showChat && unreadCount > 0) {
      setUnreadCount(0);
    }
  }, [showChat]);

  // ==================== SES İŞLEME (GELİŞMİŞ GÜRÜLTÜ ENGELLEME) ====================
  const applyAudioProcessing = async (rawStream) => {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    await audioCtx.resume();
    audioContextRef.current = audioCtx;

    const source = audioCtx.createMediaStreamSource(rawStream);

    // 1️⃣ HIGH-PASS — bas uğultu (rüzgar, fan, masa vuruntusu)
    const highpass = audioCtx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 120;
    highpass.Q.value = 0.7;

    // 2️⃣ LOW-PASS — tiz tıslama (sibilance, nefes)
    const lowpass = audioCtx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 6500;
    lowpass.Q.value = 0.7;

    // 3️⃣ PEQ — konuşma bandını güçlendir (1-3 kHz)
    const presence = audioCtx.createBiquadFilter();
    presence.type = 'peaking';
    presence.frequency.value = 2000;
    presence.Q.value = 1.0;
    presence.gain.value = 4;

    // 4️⃣ PEQ — klavye bölgesini bastır (4-6 kHz)
    const keyboardCut = audioCtx.createBiquadFilter();
    keyboardCut.type = 'peaking';
    keyboardCut.frequency.value = 5000;
    keyboardCut.Q.value = 2.0;
    keyboardCut.gain.value = -8;

    // 5️⃣ COMPRESSOR — ani sesleri bastır
    const compressor = audioCtx.createDynamicsCompressor();
    compressor.threshold.value = -35;
    compressor.knee.value = 10;
    compressor.ratio.value = 20;
    compressor.attack.value = 0.001;
    compressor.release.value = 0.25;

    // 6️⃣ NOISE GATE — sessizlikte mikrofonu sustur (hysteresis)
    const noiseGate = audioCtx.createGain();
    noiseGate.gain.value = 1;

    // ✅ AYRI analyser — speaking effect ile karışmasın
    const gateAnalyser = audioCtx.createAnalyser();
    gateAnalyser.fftSize = 512;
    const gateData = new Uint8Array(gateAnalyser.frequencyBinCount);

    const GATE_THRESHOLD = 25;
    const GATE_HYSTERESIS = 0.7;   // kapanma için threshold * 0.7
    const GATE_ATTACK = 0.05;
    const GATE_RELEASE = 0.3;
    
    let isGateOpen = true;
    let gateAnimationId;

    const checkGate = () => {
      // ✅ Context kapandıysa dur
      if (audioCtx.state === 'closed') return;
      
      gateAnalyser.getByteFrequencyData(gateData);
      let sum = 0;
      for (let i = 0; i < gateData.length; i++) sum += gateData[i];
      const avg = sum / gateData.length;

      // ✅ Hysteresis: açılmak için yüksek, kapanmak için düşük eşik
      if (avg > GATE_THRESHOLD && !isGateOpen) {
        isGateOpen = true;
        noiseGate.gain.setTargetAtTime(1, audioCtx.currentTime, GATE_ATTACK);
      } else if (avg < GATE_THRESHOLD * GATE_HYSTERESIS && isGateOpen) {
        isGateOpen = false;
        noiseGate.gain.setTargetAtTime(0.05, audioCtx.currentTime, GATE_RELEASE);
      }
      
      gateAnimationId = requestAnimationFrame(checkGate);
    };

    // Hat: source → highpass → lowpass → presence → keyboardCut → compressor → noiseGate → destination
    const destination = audioCtx.createMediaStreamDestination();
    source.connect(highpass);
    highpass.connect(lowpass);
    lowpass.connect(presence);
    presence.connect(keyboardCut);
    keyboardCut.connect(compressor);
    compressor.connect(noiseGate);
    noiseGate.connect(destination);

    // ✅ Gate analyser'ı compressor'dan sonra bağla (gate için)
    compressor.connect(gateAnalyser);

    checkGate();

    // ✅ Cleanup kaydet
    gateCleanupRef.current = () => {
      cancelAnimationFrame(gateAnimationId);
    };

    return destination.stream;
  };

  // ==================== YARDIMCILAR ====================
  const getOutgoingVideoTrack = () => {
    if (isScreenSharingRef.current && screenStreamRef.current) {
      return screenStreamRef.current.getVideoTracks()[0] || null;
    }
    if (isVideoOnRef.current && cameraStreamRef.current) {
      return cameraStreamRef.current.getVideoTracks()[0] || null;
    }
    return null;
  };

  // ✅ Mekânsal ses — AYRI playback context ile
  const setupSpatialAudio = (peerId, stream) => {
    try {
      // ✅ Playback için ayrı context kullan
      if (!playbackContextRef.current || playbackContextRef.current.state === 'closed') {
        playbackContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      }
      const audioCtx = playbackContextRef.current;
      if (audioCtx.state === 'suspended') audioCtx.resume();

      // Eski node'ları temizle
      if (spatialAudioNodes.current[peerId]) {
        try {
          spatialAudioNodes.current[peerId].source?.disconnect();
          spatialAudioNodes.current[peerId].panner?.disconnect();
          spatialAudioNodes.current[peerId].gain?.disconnect();
        } catch (e) {}
        delete spatialAudioNodes.current[peerId];
      }

      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) return;

      const audioOnlyStream = new MediaStream(audioTracks);
      const source = audioCtx.createMediaStreamSource(audioOnlyStream);
      
      const panner = audioCtx.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = 1;
      panner.maxDistance = 10000;
      panner.rolloffFactor = 1.2;
      panner.coneInnerAngle = 360;
      panner.coneOuterAngle = 0;
      panner.coneOuterGain = 0;
      panner.positionX.value = 0;
      panner.positionY.value = 0;
      panner.positionZ.value = -1;

      const gain = audioCtx.createGain();
      gain.gain.value = userVolumes[peerId] ?? 1;

      source.connect(gain);
      gain.connect(panner);
      panner.connect(audioCtx.destination);

      spatialAudioNodes.current[peerId] = { source, panner, gain };

      updateSpatialPosition(peerId);
    } catch (e) {
      console.error(`[Spatial] ${peerId} setup hatası:`, e);
    }
  };

  const updateSpatialPosition = (peerId) => {
    const nodes = spatialAudioNodes.current[peerId];
    if (!nodes || !nodes.panner) return;

    const peerSeat = peerSeatsRef.current[peerId] ?? 0;
    const mySeat = localSeatRef.current;

    if (peerSeat === mySeat) {
      nodes.panner.positionX.value = 0;
      nodes.panner.positionY.value = 0;
      nodes.panner.positionZ.value = -1;
      return;
    }

    const peerCoord = SEAT_COORDINATES[peerSeat] || SEAT_COORDINATES[0];
    const myCoord = SEAT_COORDINATES[mySeat] || SEAT_COORDINATES[0];
    
    const relX = peerCoord.x - myCoord.x;
    const relY = peerCoord.y - myCoord.y;
    
    nodes.panner.positionX.value = relX / 100;
    nodes.panner.positionY.value = relY / 100;
    nodes.panner.positionZ.value = -Math.abs(relY) / 100 - 1;
  };

  const updateSpatialGain = (peerId, volume) => {
    const nodes = spatialAudioNodes.current[peerId];
    if (nodes?.gain) {
      try {
        nodes.gain.gain.value = volume;
      } catch (e) {}
    }
  };

  const cleanupSpatialAudio = (peerId) => {
    const nodes = spatialAudioNodes.current[peerId];
    if (!nodes) return;
    try {
      nodes.source?.disconnect();
      nodes.panner?.disconnect();
      nodes.gain?.disconnect();
    } catch (e) {}
    delete spatialAudioNodes.current[peerId];
  };

  // ==================== WEBRTC ====================
  const createPeerConnection = (userId, isPolite = false) => {
    if (peerConnections.current[userId]) return peerConnections.current[userId];

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    });

    peerConnections.current[userId] = pc;
    politeFlags.current[userId] = isPolite;
    makingOffer.current[userId] = false;
    ignoreOffer.current[userId] = false;
    pendingCandidates.current[userId] = [];
    isRenegotiating.current[userId] = false;

    pc.onicecandidate = (event) => {
      if (event.candidate && socketRef.current) {
        socketRef.current.emit('ice-candidate', { target: userId, candidate: event.candidate });
      }
    };

    pc.ontrack = (event) => {
      const remoteStream = event.streams[0];
      
      const updatePeer = () => {
        setPeers((prev) => {
          const existing = prev.find((p) => p.id === userId);
          if (existing) {
            return prev.map(p => p.id === userId ? { ...p, stream: remoteStream } : p);
          }
          return [...prev, { id: userId, stream: remoteStream }];
        });
      };
      
      event.track.onunmute = updatePeer;
      event.track.onmute = updatePeer;
      
      updatePeer();

      if (event.track.kind === 'audio') {
        setTimeout(() => setupSpatialAudio(userId, remoteStream), 100);
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        if (peerConnections.current[userId] === pc) {
          pc.close();
          delete peerConnections.current[userId];
          delete videoSenders.current[userId];
          cleanupSpatialAudio(userId);
          setPeers((prev) => prev.filter((p) => p.id !== userId));
        }
      }
    };

    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current);
      });
    }

    const activeVideo = getOutgoingVideoTrack();
    if (activeVideo) {
      const videoSender = pc.addTrack(activeVideo, localStreamRef.current);
      videoSenders.current[userId] = videoSender;
    }

    return pc;
  };

  const sendOffer = async (userId) => {
    const pc = peerConnections.current[userId];
    if (!pc || !socketRef.current) return;
    if (pc.signalingState !== 'stable') return;
    if (isRenegotiating.current[userId]) return;
    
    isRenegotiating.current[userId] = true;
    try {
      makingOffer.current[userId] = true;
      const offer = await pc.createOffer();
      if (pc.signalingState !== 'stable') {
        makingOffer.current[userId] = false;
        isRenegotiating.current[userId] = false;
        return;
      }
      await pc.setLocalDescription(offer);
      socketRef.current.emit('offer', { target: userId, signal: pc.localDescription });
    } catch (e) {
      console.error('Offer hatası:', e);
    } finally {
      makingOffer.current[userId] = false;
      setTimeout(() => { isRenegotiating.current[userId] = false; }, 500);
    }
  };

  const attachVideoToPeer = async (peerId, videoTrack, stream) => {
    const pc = peerConnections.current[peerId];
    if (!pc) return;
    
    try {
      const sender = pc.addTrack(videoTrack, stream);
      videoSenders.current[peerId] = sender;
      await new Promise(r => setTimeout(r, 100));
      await sendOffer(peerId);
    } catch (e) {
      console.error(`[Video] ${peerId} addTrack HATA:`, e);
    }
  };

  const detachVideoFromPeer = async (peerId) => {
    const pc = peerConnections.current[peerId];
    const sender = videoSenders.current[peerId];
    if (!pc || !sender) return;
    
    try {
      pc.removeTrack(sender);
      delete videoSenders.current[peerId];
      await new Promise(r => setTimeout(r, 100));
      await sendOffer(peerId);
    } catch (e) {
      console.error(`[Video] ${peerId} removeTrack HATA:`, e);
    }
  };

  // ==================== BİLDİRİM SESİ ====================
  const playNotificationSound = () => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.08);
      
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.25);
      
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.25);
      
      setTimeout(() => ctx.close(), 300);
    } catch (e) {}
  };

  // ==================== SOCKET ====================
  useEffect(() => {
    if (socketRef.current) return;

    setConnectionState('connecting');

    const newSocket = io(SOCKET_URL, {
      transports: ['polling', 'websocket'],
      reconnection: true,
      reconnectionAttempts: 20,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
    });
    socketRef.current = newSocket;

    newSocket.on('connect', () => {
      setMyId(newSocket.id);
      myIdRef.current = newSocket.id;
      setConnectionState('connected');
      setConnectionAttempt(0);
      setConnectionWaitTime(0);
    });

    newSocket.on('disconnect', (reason) => {
      if (reason !== 'io client disconnect') {
        setConnectionState('connecting');
      }
    });

    newSocket.on('connect_error', (err) => {
      setConnectionAttempt((prev) => prev + 1);
      if (connectionWaitTime >= 5) {
        setConnectionState('waking');
      }
    });

    newSocket.on('reconnect_attempt', (attempt) => {
      setConnectionAttempt(attempt);
    });

    newSocket.on('room-list', (list) => {
      setRoomList(list || {});
    });

    newSocket.on('existing-members', async ({ members }) => {
      if (!members || members.length === 0) return;

      for (const peerId of members) {
        if (peerId === newSocket.id) continue;
        if (!peerConnections.current[peerId]) {
          createPeerConnection(peerId, false);
          try {
            await sendOffer(peerId);
          } catch (err) {
            setTimeout(() => {
              if (peerConnections.current[peerId]) sendOffer(peerId);
            }, 500);
          }
        }
      }
    });

    newSocket.on('user-connected', (userId) => {
      playSfx('join');
      setMessages((prev) => [...prev, { 
        user: 'Sistem', 
        text: `Kullanıcı odaya katıldı (${userId.slice(0, 4)})`, 
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        isSystem: true,
      }]);

      if (!peerConnections.current[userId]) {
        createPeerConnection(userId, true);
      }
    });

    newSocket.on('offer', async (data) => {
      const { caller, signal } = data;
      let pc = peerConnections.current[caller];
      if (!pc) {
        pc = createPeerConnection(caller, true);
      }

      try {
        const offerCollision = makingOffer.current[caller] || pc.signalingState !== 'stable';
        ignoreOffer.current[caller] = !politeFlags.current[caller] && offerCollision;

        if (ignoreOffer.current[caller]) return;

        if (offerCollision && politeFlags.current[caller]) {
          await Promise.all([
            pc.setLocalDescription({ type: 'rollback' }),
            pc.setRemoteDescription(new RTCSessionDescription(signal)),
          ]);
        } else {
          await pc.setRemoteDescription(new RTCSessionDescription(signal));
        }

        for (const c of pendingCandidates.current[caller] || []) {
          try { await pc.addIceCandidate(c); } catch (e) {}
        }
        pendingCandidates.current[caller] = [];

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        newSocket.emit('answer', { target: caller, signal: pc.localDescription });
      } catch (e) {
        console.error('[Offer] Hata:', e);
      }
    });

    newSocket.on('answer', async (data) => {
      const pc = peerConnections.current[data.id];
      if (!pc) return;
      try {
        if (pc.signalingState === 'have-local-offer') {
          await pc.setRemoteDescription(new RTCSessionDescription(data.signal));
          for (const c of pendingCandidates.current[data.id] || []) {
            try { await pc.addIceCandidate(c); } catch (e) {}
          }
          pendingCandidates.current[data.id] = [];
        }
      } catch (e) {
        console.error('[Answer] Hata:', e);
      }
    });

    newSocket.on('ice-candidate', async (data) => {
      const pc = peerConnections.current[data.id];
      const candidate = new RTCIceCandidate(data.candidate);
      if (!pc) {
        if (!pendingCandidates.current[data.id]) pendingCandidates.current[data.id] = [];
        pendingCandidates.current[data.id].push(candidate);
        return;
      }
      try {
        if (pc.remoteDescription && pc.remoteDescription.type) {
          await pc.addIceCandidate(candidate);
        } else {
          if (!pendingCandidates.current[data.id]) pendingCandidates.current[data.id] = [];
          pendingCandidates.current[data.id].push(candidate);
        }
      } catch (e) {
        if (e.name !== 'OperationError') console.warn('ICE hatası:', e);
      }
    });

    newSocket.on('chat-message', (msg) => {
      setMessages((prev) => [...prev, msg]);
      
      if (!showChatRef.current) {
        setUnreadCount((prev) => prev + 1);
        playNotificationSound();
      }
    });

    newSocket.on('seat-update', (data) => {
      setPeerSeats((prev) => {
        const next = { ...prev, [data.userId]: data.seat };
        peerSeatsRef.current = next;
        setTimeout(() => updateSpatialPosition(data.userId), 50);
        return next;
      });
    });

    newSocket.on('user-disconnected', (userId) => {
      playSfx('leave');
      setMessages((prev) => [...prev, { 
        user: 'Sistem', 
        text: `Kullanıcı odadan ayrıldı (${userId.slice(0, 4)})`, 
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        isSystem: true,
      }]);

      if (peerConnections.current[userId]) {
        peerConnections.current[userId].close();
        delete peerConnections.current[userId];
        delete politeFlags.current[userId];
        delete makingOffer.current[userId];
        delete ignoreOffer.current[userId];
        delete pendingCandidates.current[userId];
        delete videoSenders.current[userId];
        delete isRenegotiating.current[userId];
        cleanupSpatialAudio(userId);
      }
      setPeers((prev) => prev.filter((p) => p.id !== userId));
      setPeerSeats((prev) => {
        const copy = { ...prev };
        delete copy[userId];
        return copy;
      });
    });

    const pingInterval = setInterval(() => {
      setPing(Math.floor(Math.random() * 15) + 10);
    }, 4000);

    const handleBeforeUnload = () => newSocket.disconnect();
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      clearInterval(pingInterval);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      newSocket.disconnect();
      socketRef.current = null;
    };
  }, []);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, showChat]);

  // ==================== KONUŞMA GÖSTERGESİ (AYRI CONTEXT) ====================
  useEffect(() => {
    if (!activeLocalStream || isMuted || isDeafened) {
      setIsSpeaking(false);
      return;
    }
    const audioTracks = activeLocalStream.getAudioTracks();
    if (audioTracks.length === 0) {
      setIsSpeaking(false);
      return;
    }
    try {
      // ✅ AYRI context — local mic ctx ile çakışmaz
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      speakingContextRef.current = audioCtx;
      const analyser = audioCtx.createAnalyser();
      analyserRef.current = analyser;
      analyser.fftSize = 512;
      const microphone = audioCtx.createMediaStreamSource(activeLocalStream);
      microphone.connect(analyser);
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      let animationId;
      const checkAudioLevel = () => {
        if (audioCtx.state === 'closed') return;
        analyserRef.current.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) sum += dataArray[i];
        setIsSpeaking(sum / bufferLength > 15);
        animationId = requestAnimationFrame(checkAudioLevel);
      };
      checkAudioLevel();
      return () => {
        cancelAnimationFrame(animationId);
        if (audioCtx && audioCtx.state !== 'closed') audioCtx.close().catch(() => {});
        speakingContextRef.current = null;
        analyserRef.current = null;
      };
    } catch (e) {
      console.error("Audio API hatası:", e);
      setIsSpeaking(false);
    }
  }, [activeLocalStream, isMuted, isDeafened]);

  useEffect(() => {
    if (localVideoRef.current && activeLocalStream) {
      localVideoRef.current.srcObject = activeLocalStream;
      localVideoRef.current.play().catch(() => {});
    }
  }, [activeLocalStream, isScreenSharing, isVideoOn]);

  // ==================== SES EFEKTLERİ ====================
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
      setTimeout(() => ctx.close().catch(() => {}), 300);
    } catch (e) {}
  };

  // ==================== ARAMA KONTROLLERİ ====================
  const startCall = async (channelId) => {
    if (inCallRef.current) return;
    if (connectionState !== 'connected') {
      alert('Sunucuya bağlanılıyor, lütfen bekleyin...');
      return;
    }
    inCallRef.current = true;

    const socket = socketRef.current;
    if (!socket) {
      inCallRef.current = false;
      return;
    }

    try {
      setActiveChannel(channelId);
      playSfx('join');

      const rawStream = await navigator.mediaDevices.getUserMedia({
        audio: AUDIO_CONSTRAINTS,
        video: false,
      });
      const processedStream = await applyAudioProcessing(rawStream);

      localStreamRef.current = processedStream;
      setActiveLocalStream(processedStream);
      setInCall(true);

      const doJoin = () => {
        socket.emit('join-room', channelId);
        socket.emit('update-seat', { seat: localSeat });
      };

      if (socket.connected) doJoin();
      else socket.once('connect', doJoin);
    } catch (err) {
      console.error('Medya erişim hatası:', err);
      inCallRef.current = false;
    }
  };

  const endCall = () => {
    inCallRef.current = false;
    playSfx('leave');

    if (socketRef.current) socketRef.current.emit('leave-room');

    // ✅ TÜM CONTEXT'LERİ TEMİZLE
    if (gateCleanupRef.current) {
      gateCleanupRef.current();
      gateCleanupRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    if (speakingContextRef.current && speakingContextRef.current.state !== 'closed') {
      speakingContextRef.current.close().catch(() => {});
      speakingContextRef.current = null;
    }
    if (playbackContextRef.current && playbackContextRef.current.state !== 'closed') {
      playbackContextRef.current.close().catch(() => {});
      playbackContextRef.current = null;
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
    }
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((t) => t.stop());
      cameraStreamRef.current = null;
    }
    Object.values(peerConnections.current).forEach((pc) => pc.close());
    peerConnections.current = {};
    politeFlags.current = {};
    makingOffer.current = {};
    ignoreOffer.current = {};
    pendingCandidates.current = {};
    videoSenders.current = {};
    isRenegotiating.current = {};

    Object.keys(spatialAudioNodes.current).forEach(cleanupSpatialAudio);

    setPeers([]);
    setInCall(false);
    setIsVideoOn(false);
    setIsScreenSharing(false);
    setActiveLocalStream(null);
    setIsSpeaking(false);
  };

  const changeSeat = (seatIndex) => {
    setLocalSeat(seatIndex);
    localSeatRef.current = seatIndex;
    if (socketRef.current) socketRef.current.emit('update-seat', { seat: seatIndex });
    
    setTimeout(() => {
      Object.keys(spatialAudioNodes.current).forEach(peerId => {
        updateSpatialPosition(peerId);
      });
    }, 100);
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

  const toggleVideo = async () => {
    if (!localStreamRef.current) return;

    if (!isVideoOn) {
      if (isScreenSharingRef.current) stopScreenShare();

      try {
        const camStream = await navigator.mediaDevices.getUserMedia({ video: VIDEO_CONSTRAINTS });
        cameraStreamRef.current = camStream;
        const videoTrack = camStream.getVideoTracks()[0];

        for (const peerId of Object.keys(peerConnections.current)) {
          await attachVideoToPeer(peerId, videoTrack, localStreamRef.current);
        }

        const combinedStream = new MediaStream([
          ...localStreamRef.current.getAudioTracks(),
          videoTrack,
        ]);
        setActiveLocalStream(combinedStream);
        setIsVideoOn(true);

        videoTrack.onended = () => {
          if (isVideoOnRef.current) toggleVideo();
        };
      } catch (e) {
        console.error('Kamera açılamadı:', e);
      }
    } else {
      const videoTrack = cameraStreamRef.current?.getVideoTracks()[0];
      if (videoTrack) videoTrack.stop();
      cameraStreamRef.current = null;

      for (const peerId of Object.keys(peerConnections.current)) {
        await detachVideoFromPeer(peerId);
      }

      setIsVideoOn(false);
      setActiveLocalStream(localStreamRef.current);
    }
  };

  const toggleScreenShare = async () => {
    if (!isScreenSharing) {
      if (isVideoOnRef.current) {
        const camTrack = cameraStreamRef.current?.getVideoTracks()[0];
        if (camTrack) camTrack.stop();
        cameraStreamRef.current = null;
        setIsVideoOn(false);
      }

      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            frameRate: { ideal: 60, max: 60 },
            width: { ideal: 1920, max: 3840 },
            height: { ideal: 1080, max: 2160 },
          },
          audio: true,
        });

        screenStreamRef.current = screenStream;
        const screenTrack = screenStream.getVideoTracks()[0];

        for (const peerId of Object.keys(peerConnections.current)) {
          await attachVideoToPeer(peerId, screenTrack, screenStream);
        }

        setIsScreenSharing(true);

        const combinedStream = new MediaStream([
          ...localStreamRef.current.getAudioTracks(),
          ...screenStream.getVideoTracks(),
        ]);
        setActiveLocalStream(combinedStream);

        screenTrack.onended = () => {
          if (isScreenSharingRef.current) stopScreenShare();
        };
      } catch (err) {
        console.error('Ekran paylaşımı hatası:', err);
      }
    } else {
      await stopScreenShare();
    }
  };

  const stopScreenShare = async () => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
    }
    setIsScreenSharing(false);

    for (const peerId of Object.keys(peerConnections.current)) {
      await detachVideoFromPeer(peerId);
    }

    setActiveLocalStream(localStreamRef.current);
  };

  const sendMessage = (e) => {
    e.preventDefault();
    if (!newMessage.trim() || !socketRef.current) return;
    const msgData = { 
      user: 'Cem Dev', 
      text: newMessage, 
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
    };
    socketRef.current.emit('chat-message', msgData);
    setMessages((prev) => [...prev, msgData]);
    setNewMessage('');
  };

  const updatePeerVolume = (peerId, vol) => {
    setUserVolumes((prev) => ({ ...prev, [peerId]: vol }));
    updateSpatialGain(peerId, vol);
  };

  const handleUserRightClick = (e, userId) => {
    e.preventDefault();
    e.stopPropagation();
    if (userId === myId) return;
    setContextMenu({
      userId,
      x: e.clientX,
      y: e.clientY,
    });
  };

  const activePeerWithVideo = peers.find((p) => {
    if (!p.stream) return false;
    return p.stream.getVideoTracks().some(
      (track) => track.readyState === 'live' && !track.muted
    );
  });

  const isLocalBroadcasting = isVideoOn || isScreenSharing;
  const isAnyBroadcastActive = !!activePeerWithVideo || isLocalBroadcasting;

  const getChannelUsers = (channelId) => {
    return roomList[channelId] || [];
  };

  // ==================== LOADER ====================
  if (connectionState !== 'connected') {
    return (
      <div className="flex h-screen w-screen bg-[#313338] text-[#dbdee1] overflow-hidden font-sans select-none items-center justify-center relative">
        <div className="absolute inset-0 opacity-5" style={{
          backgroundImage: 'radial-gradient(circle at 1px 1px, #dbdee1 1px, transparent 0)',
          backgroundSize: '40px 40px'
        }} />

        <div className="relative z-10 flex flex-col items-center max-w-md px-6">
          <div className="w-20 h-20 bg-[#5865f2] rounded-[28px] flex items-center justify-center shadow-2xl mb-8 animate-pulse">
            <Sparkles size={40} className="text-white" />
          </div>

          <h1 className="text-2xl font-bold text-white mb-2">Stuck Voice Hub</h1>
          <p className="text-sm text-[#949ba4] mb-8">Sesli sohbet platformu</p>

          <div className="w-16 h-16 rounded-full bg-[#2b2d31] border-2 border-[#35373c] flex items-center justify-center mb-6 relative">
            {connectionState === 'waking' ? (
              <Server size={28} className="text-[#faa61a] animate-pulse" />
            ) : connectionState === 'error' ? (
              <WifiOff size={28} className="text-[#ed4245]" />
            ) : (
              <Loader2 size={28} className="text-[#5865f2] animate-spin" />
            )}
            <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-[#5865f2] animate-spin" 
                 style={{ animationDuration: '1.5s' }} />
          </div>

          <div className="text-center mb-6">
            {connectionState === 'connecting' && connectionAttempt === 0 && (
              <>
                <p className="text-white font-semibold mb-1">Sunucuya bağlanılıyor</p>
                <p className="text-xs text-[#949ba4]">Sesli sohbet için hazırlanıyor...</p>
              </>
            )}
            
            {connectionState === 'connecting' && connectionAttempt > 0 && (
              <>
                <p className="text-white font-semibold mb-1">Yeniden bağlanılıyor</p>
                <p className="text-xs text-[#949ba4]">
                  Deneme {connectionAttempt}... 
                  {connectionAttempt > 2 && ' (sunucu uyanıyor olabilir)'}
                </p>
              </>
            )}

            {connectionState === 'waking' && (
              <>
                <p className="text-[#faa61a] font-semibold mb-1 flex items-center justify-center gap-2">
                  <Server size={16} /> Sunucu uyanıyor
                </p>
                <p className="text-xs text-[#949ba4] leading-relaxed">
                  Ücretsiz hosting ilk bağlantıda ~30 saniye sürebilir.<br />
                  Lütfen sayfayı kapatmayın.
                </p>
              </>
            )}
          </div>

          <div className="w-full max-w-xs bg-[#1e1f22] rounded-full h-1.5 overflow-hidden mb-3">
            <div 
              className={`h-full rounded-full transition-all duration-500 ${
                connectionState === 'waking' ? 'bg-[#faa61a]' : 'bg-[#5865f2]'
              }`}
              style={{ width: `${Math.min(connectionWaitTime * 8 + 10, 95)}%` }} 
            />
          </div>

          <p className="text-[10px] text-[#80848e]">
            {connectionWaitTime > 0 ? `${connectionWaitTime}s` : 'Başlatılıyor...'}
            {connectionState === 'waking' && ' · Sabırla bekleyin'}
          </p>
        </div>
      </div>
    );
  }

  // ==================== ANA UYGULAMA ====================
  return (
    <div className="flex h-screen w-screen bg-[#313338] text-[#dbdee1] overflow-hidden font-sans select-none">
      
      <div className="w-[72px] bg-[#1e1f22] flex flex-col items-center py-3 gap-3 shrink-0 z-30">
        <div className="w-12 h-12 bg-[#5865f2] hover:bg-[#4752c4] rounded-[24px] hover:rounded-[16px] transition-all duration-200 flex items-center justify-center text-white cursor-pointer shadow-lg">
          <Sparkles size={24} />
        </div>
        <div className="w-8 h-[2px] bg-[#35363c] rounded-full" />
        <div className="w-12 h-12 bg-[#2b2d31] hover:bg-[#23a55a] hover:rounded-[16px] rounded-[24px] transition-all duration-200 flex items-center justify-center text-[#23a55a] hover:text-white cursor-pointer">
          <Radio size={24} />
        </div>
      </div>

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
            const usersInChannel = getChannelUsers(channel.id);
            
            return (
              <div key={channel.id} className="mb-1">
                <div
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

                {usersInChannel.length > 0 && (
                  <div className="ml-6 mt-0.5 space-y-0.5">
                    {usersInChannel.map((userId, idx) => {
                      const isMe = userId === myId;
                      const peer = peers.find(p => p.id === userId);
                      const peerHasVideo = peer?.stream?.getVideoTracks().some(
                        t => t.readyState === 'live' && !t.muted
                      );
                      const displayName = isMe ? 'Sen' : `Kullanıcı ${userId.slice(0, 4)}`;
                      const currentVol = userVolumes[userId] ?? 1.0;
                      
                      return (
                        <div
                          key={userId + '-' + idx}
                          onContextMenu={(e) => handleUserRightClick(e, userId)}
                          className={`flex items-center gap-2 px-2 py-1 rounded text-xs transition-all ${
                            isMe ? 'text-[#23a55a] font-medium' : 'text-[#b5bac1] hover:bg-[#35373c]/50 cursor-context-menu'
                          }`}
                          title={!isMe ? 'Sağ tıklayarak ses seviyesini ayarla' : ''}
                        >
                          <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0 ${
                            isMe ? 'bg-[#23a55a] text-white' : 'bg-indigo-600 text-white'
                          }`}>
                            {(isMe ? 'S' : userId.slice(0, 1)).toUpperCase()}
                          </div>
                          <span className="truncate flex-1">{displayName}</span>
                          {!isMe && currentVol !== 1.0 && (
                            <span className={`text-[9px] font-bold ${currentVol === 0 ? 'text-[#ed4245]' : 'text-[#faa61a]'}`}>
                              {Math.round(currentVol * 100)}%
                            </span>
                          )}
                          {peerHasVideo && <Video size={11} className="text-[#23a55a]" />}
                          {isMe && isSpeaking && <Volume2 size={11} className="text-[#23a55a] animate-pulse" />}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

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

      <div className="flex-1 flex flex-col bg-[#313338] relative min-w-0">
        
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
                className={`relative p-1.5 rounded-md transition-colors ${showChat ? 'bg-[#35373c] text-white' : 'text-[#b5bac1] hover:text-white'}`}
                title={showChat ? 'Sohbeti kapat' : 'Sohbeti aç'}
              >
                <MessageSquare size={20} />
                {!showChat && unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] bg-[#ed4245] text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1 animate-pulse shadow-lg">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </button>
            )}

            {inCall && (
              <span className="text-xs bg-[#23a55a]/10 text-[#23a55a] border border-[#23a55a]/20 px-2.5 py-1 rounded-full font-medium flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#23a55a] animate-pulse" /> Ses Bağlandı
              </span>
            )}
          </div>
        </div>

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
              <div className="w-full h-full flex flex-col gap-3">
                
                {isAnyBroadcastActive ? (
                  <>
                    <div className="flex-1 rounded-xl bg-[#111214] border border-[#1f2023] relative overflow-hidden flex items-center justify-center shadow-2xl">
                      {activePeerWithVideo ? (
                        <MainStreamViewer stream={activePeerWithVideo.stream} id={activePeerWithVideo.id} isDeafened={isDeafened} volume={userVolumes[activePeerWithVideo.id] ?? 1} />
                      ) : (
                        <div className="relative w-full h-full flex items-center justify-center bg-black group">
                          <video ref={localVideoRef} autoPlay playsInline muted={true} className="w-full h-full object-contain" />
                          <div className="absolute bottom-3 left-3 bg-black/60 backdrop-blur-md px-3 py-1 rounded-md text-xs text-white font-medium border border-white/10 z-10">
                            <span className="w-2 h-2 rounded-full bg-[#23a55a]" /> Sen (Yayın Yapıyorsun)
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="h-36 w-full flex gap-3 overflow-x-auto shrink-0 pb-1">
                      {activePeerWithVideo && (
                        <div className="relative flex flex-col items-center justify-center rounded-xl bg-[#111214] border border-[#1f2023] h-full aspect-video overflow-hidden shrink-0">
                          <video 
                            ref={(el) => { if (el && activeLocalStream) el.srcObject = activeLocalStream; }} 
                            autoPlay 
                            playsInline 
                            muted={true} 
                            className={`w-full h-full object-contain bg-black ${isLocalBroadcasting ? 'block' : 'hidden'}`} 
                          />
                          {!isLocalBroadcasting && (
                            <div className="flex flex-col items-center gap-1">
                              <div className="w-10 h-10 rounded-full bg-[#5865f2] flex items-center justify-center text-white font-bold text-xs">KC</div>
                              <span className="text-xs text-[#949ba4]">Cem Dev (Sen)</span>
                            </div>
                          )}
                          <div className="absolute bottom-2 left-2 bg-black/60 px-2 py-0.5 rounded text-[10px] text-white">Sen</div>
                        </div>
                      )}

                      {peers.filter(p => !activePeerWithVideo || p.id !== activePeerWithVideo.id).map((peer) => (
                        <div key={peer.id} className="h-full aspect-video shrink-0">
                          <RemoteUserCard 
                            stream={peer.stream} 
                            id={peer.id} 
                            isDeafened={isDeafened} 
                            volume={userVolumes[peer.id] ?? 1}
                            isSmall 
                          />
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="w-full h-full grid grid-cols-1 md:grid-cols-2 p-4 gap-4 items-center justify-center overflow-y-auto">
                    <div className="relative flex flex-col items-center justify-center rounded-xl bg-[#1e1f22] border border-[#2b2d31] w-full h-full aspect-video shadow-lg">
                      <div className={`w-20 h-20 rounded-full bg-[#5865f2] flex items-center justify-center text-white font-bold text-2xl shadow-xl transition-all ${isSpeaking ? 'ring-4 ring-[#23a55a]' : ''}`}>
                        KC
                      </div>
                      <span className="text-sm font-semibold text-[#dbdee1] mt-2">Cem Dev (Sen)</span>
                      <div className="absolute bottom-3 left-3 bg-black/60 backdrop-blur-md px-3 py-1 rounded-md text-xs text-white font-medium border border-white/10">
                        <span className="w-2 h-2 rounded-full bg-[#23a55a]" /> Ses Bağlı
                      </div>
                    </div>

                    {peers.map((peer) => (
                      <RemoteUserCard 
                        key={peer.id} 
                        stream={peer.stream} 
                        id={peer.id} 
                        isDeafened={isDeafened} 
                        volume={userVolumes[peer.id] ?? 1}
                      />
                    ))}
                  </div>
                )}

              </div>
            ) : (
              <div className="w-full h-full bg-[#111214] rounded-2xl border border-[#1f2023] relative flex items-center justify-center shadow-2xl overflow-hidden">
                <div className="absolute top-6 left-6 bg-[#1e1f22]/80 backdrop-blur-md border border-[#2b2d31] px-4 py-2 rounded-xl text-xs text-[#949ba4] flex items-center gap-2 z-20">
                  <Compass size={16} className="text-[#23a55a] animate-spin" />
                  <span>Mekânsal Ses Aktif: Masadaki koltuğunu değiştirerek ses yönünü ve uzaklığını ayarlayabilirsin.</span>
                </div>

                <div className="absolute top-6 right-6 bg-[#1e1f22]/80 backdrop-blur-md border border-[#2b2d31] px-3 py-1.5 rounded-lg text-xs text-[#949ba4] z-20">
                  <span className="text-[#23a55a] font-bold">🎧 Kulaklık önerilir</span>
                </div>

                <div className="w-64 h-64 rounded-full border-4 border-dashed border-[#35363c] bg-[#1a1b1e] flex items-center justify-center relative shadow-inner">
                  <span className="text-xs font-bold text-[#80848e] tracking-widest uppercase">Stuck Conference</span>

                  {SEAT_COORDINATES.map((seat, idx) => {
                    const isMySeat = localSeat === idx;
                    const occupantPeer = peers.find(p => (peerSeats[p.id] ?? 0) === idx);

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

                <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-[#1e1f22]/90 backdrop-blur-md border border-[#2b2d31] px-4 py-2 rounded-lg text-xs text-[#949ba4] z-20 flex items-center gap-3">
                  <span className="flex items-center gap-1">
                    <div className="w-3 h-3 rounded-full bg-[#5865f2]" /> Sen
                  </span>
                  <span className="flex items-center gap-1">
                    <div className="w-3 h-3 rounded-full bg-[#23a55a]" /> Dolu
                  </span>
                  <span className="flex items-center gap-1">
                    <div className="w-3 h-3 rounded-full bg-[#2b2d31] border border-[#3f4147]" /> Boş
                  </span>
                </div>
              </div>
            )}
          </div>

          {inCall && showChat && (
            <div className="w-80 bg-[#313338] border-l border-[#1f2023] flex flex-col shrink-0 z-20">
              <div className="h-10 border-b border-[#1f2023] px-3 flex items-center justify-between text-xs font-bold text-white shadow-sm">
                <span>Oda Sohbeti</span>
                <button 
                  onClick={() => setShowChat(false)}
                  className="text-[#949ba4] hover:text-white transition-colors p-0.5 rounded"
                  title="Kapat"
                >
                  ✕
                </button>
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
                      <span className={`text-xs font-bold ${m.user === 'Sistem' ? 'text-[#23a55a]' : 'text-white'}`}>{m.user}</span>
                      <span className="text-[10px] text-[#949ba4]">{m.time}</span>
                    </div>
                    <span className={`text-sm mt-0.5 break-words ${m.user === 'Sistem' ? 'text-[#23a55a]/90 italic text-xs' : 'text-[#dbdee1]'}`}>{m.text}</span>
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

      {contextMenu && (
        <div
          className="fixed z-[100] bg-[#111214] border border-[#2b2d31] rounded-lg shadow-2xl p-3 w-64"
          style={{
            left: Math.min(contextMenu.x, window.innerWidth - 280),
            top: Math.min(contextMenu.y, window.innerHeight - 180),
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-indigo-600 flex items-center justify-center text-white font-bold text-[10px]">
                {contextMenu.userId.slice(0, 2).toUpperCase()}
              </div>
              <span className="text-xs font-bold text-white">Kullanıcı {contextMenu.userId.slice(0, 4)}</span>
            </div>
            <button 
              onClick={() => setContextMenu(null)} 
              className="text-[#949ba4] hover:text-white transition-colors"
            >
              ✕
            </button>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-[#949ba4] font-medium">Ses Seviyesi</span>
              <span className={`text-xs font-bold ${(userVolumes[contextMenu.userId] ?? 1) === 0 ? 'text-[#ed4245]' : 'text-[#23a55a]'}`}>
                {Math.round((userVolumes[contextMenu.userId] ?? 1) * 100)}%
              </span>
            </div>
            
            <input
              type="range"
              min="0"
              max="200"
              step="5"
              value={Math.round((userVolumes[contextMenu.userId] ?? 1) * 100)}
              onChange={(e) => updatePeerVolume(contextMenu.userId, parseInt(e.target.value) / 100)}
              className="w-full h-2 bg-[#2b2d31] rounded-lg appearance-none cursor-pointer accent-[#23a55a]"
            />

            <div className="flex items-center justify-between gap-1 mt-1">
              {[0, 25, 50, 100, 150, 200].map((val) => (
                <button
                  key={val}
                  onClick={() => updatePeerVolume(contextMenu.userId, val / 100)}
                  className={`flex-1 text-[9px] font-bold py-1 rounded transition-all ${
                    Math.round((userVolumes[contextMenu.userId] ?? 1) * 100) === val
                      ? 'bg-[#5865f2] text-white'
                      : 'bg-[#2b2d31] text-[#949ba4] hover:bg-[#35373c] hover:text-white'
                  }`}
                >
                  {val}%
                </button>
              ))}
            </div>

            <div className="pt-2 border-t border-[#2b2d31] flex items-center justify-between">
              <button
                onClick={() => updatePeerVolume(contextMenu.userId, 0)}
                className="text-[10px] text-[#ed4245] hover:text-[#c9383b] font-medium flex items-center gap-1 transition-colors"
              >
                <VolumeX size={12} /> Sustur
              </button>
              <button
                onClick={() => updatePeerVolume(contextMenu.userId, 1)}
                className="text-[10px] text-[#23a55a] hover:text-[#1f8c4c] font-medium flex items-center gap-1 transition-colors"
              >
                <Volume2 size={12} /> Sıfırla
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

// ==================== ALT BİLEŞENLER ====================

function MainStreamViewer({ stream, id, isDeafened, volume = 1 }) {
  const videoRef = useRef(null);
  const containerRef = useRef(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.muted = isDeafened;
      videoRef.current.volume = Math.min(Math.max(volume, 0), 1);
      videoRef.current.play().catch(() => {});
    }
  }, [stream, isDeafened, volume]);

  const toggleFullScreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen();
    }
  };

  return (
    <div ref={containerRef} className="relative w-full h-full flex items-center justify-center bg-black group">
      <video ref={videoRef} autoPlay playsInline muted={isDeafened} className="w-full h-full object-contain" />
      
      <div className="absolute bottom-3 left-3 bg-black/60 backdrop-blur-md px-3 py-1 rounded-md text-xs text-white font-medium flex items-center gap-2 border border-white/10 z-10">
        <span className="w-2 h-2 rounded-full bg-[#23a55a] animate-pulse" />
        Yayın Yapan: Kullanıcı ({id.slice(0, 4)})
        {volume !== 1 && (
          <span className="text-[#faa61a] font-bold">· {Math.round(volume * 100)}%</span>
        )}
      </div>

      <button 
        onClick={toggleFullScreen}
        className="absolute top-4 right-4 bg-black/60 hover:bg-black/80 text-white p-2 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity border border-white/10 flex items-center gap-1.5 text-xs shadow-lg"
        title="Tam Ekran Yap"
      >
        <Maximize2 size={16} /> Tam Ekran
      </button>
    </div>
  );
}

function RemoteUserCard({ stream, id, isDeafened, volume, isSmall }) {
  const videoRef = useRef(null);
  const [hasActiveVideo, setHasActiveVideo] = useState(false);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.muted = true; // ✅ Ses WebAudio'dan geliyor
      videoRef.current.play().catch(() => {});
    }
  }, [stream]);

  useEffect(() => {
    if (!stream) {
      setHasActiveVideo(false);
      return;
    }
    
    const check = () => {
      const videoTracks = stream.getVideoTracks();
      setHasActiveVideo(videoTracks.some(t => t.readyState === 'live' && !t.muted));
    };
    check();

    const videoTracks = stream.getVideoTracks();
    videoTracks.forEach(t => {
      t.onunmute = check;
      t.onmute = check;
      t.onended = check;
    });

    const interval = setInterval(check, 500);
    return () => {
      clearInterval(interval);
      videoTracks.forEach(t => {
        t.onunmute = null;
        t.onmute = null;
        t.onended = null;
      });
    };
  }, [stream]);

  return (
    <div className={`bg-[#111214] rounded-xl relative flex items-center justify-center border border-[#1f2023] overflow-hidden shadow-md transition-all ${isSmall ? 'h-full w-full' : 'w-full h-full aspect-video'}`}>
      <video 
        ref={videoRef} 
        autoPlay 
        playsInline 
        muted={true} 
        className={`w-full h-full object-contain bg-black ${hasActiveVideo ? 'block' : 'hidden'}`} 
      />
      
      {!hasActiveVideo && (
        <div className="flex flex-col items-center gap-1">
          <div className="w-12 h-12 rounded-full bg-indigo-600 flex items-center justify-center text-white font-bold text-sm">
            {id.slice(0, 2).toUpperCase()}
          </div>
          <span className="text-xs text-[#949ba4]">Kullanıcı ({id.slice(0, 4)})</span>
        </div>
      )}
      
      <div className="absolute bottom-2 left-2 bg-black/60 backdrop-blur-md px-2 py-0.5 rounded text-[10px] text-white font-medium border border-white/10 z-10 flex items-center gap-1">
        Kullanıcı ({id.slice(0, 4)})
        {volume !== 1 && volume !== undefined && (
          <span className={`font-bold ${volume === 0 ? 'text-[#ed4245]' : 'text-[#faa61a]'}`}>
            · {Math.round(volume * 100)}%
          </span>
        )}
      </div>
    </div>
  );
}