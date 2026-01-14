import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Play, Pause, Volume2, VolumeX, Maximize, Minimize, Settings, SkipBack, SkipForward } from 'lucide-react';
import { Channel } from '@/types';

interface VideoPlayerProps {
  channel: Channel | null;
  onChannelChange?: (direction: 'prev' | 'next') => void;
}

// Loading spinner component
const LoadingSpinner: React.FC = () => (
  <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 z-20">
    <div className="flex gap-1 mb-4">
      {'LOADING'.split('').map((letter, i) => (
        <span 
          key={i}
          className="text-2xl md:text-4xl font-bold text-amber-400 animate-bounce"
          style={{ 
            animationDelay: `${i * 0.1}s`,
            textShadow: '0 0 10px rgba(251, 191, 36, 0.8), 0 0 20px rgba(251, 191, 36, 0.5)'
          }}
        >
          {letter}
        </span>
      ))}
    </div>
    <p className="text-amber-200/60 text-sm animate-pulse">please wait...</p>
    {/* Roots effect */}
    <div className="absolute bottom-0 left-0 right-0 h-32 overflow-hidden opacity-30">
      <svg viewBox="0 0 400 100" className="w-full h-full">
        <path d="M0,100 Q50,50 100,80 T200,60 T300,70 T400,50 L400,100 Z" fill="url(#rootGradient)" />
        <path d="M0,100 Q80,60 150,90 T250,70 T350,80 T400,60 L400,100 Z" fill="url(#rootGradient2)" />
        <defs>
          <linearGradient id="rootGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#92400e" />
            <stop offset="100%" stopColor="#451a03" />
          </linearGradient>
          <linearGradient id="rootGradient2" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#78350f" />
            <stop offset="100%" stopColor="#451a03" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  </div>
);

// Static noise component
const StaticNoise: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;
    const drawNoise = () => {
      const imageData = ctx.createImageData(canvas.width, canvas.height);
      const data = imageData.data;
      
      for (let i = 0; i < data.length; i += 4) {
        const value = Math.random() * 255;
        data[i] = value;
        data[i + 1] = value;
        data[i + 2] = value;
        data[i + 3] = 255;
      }
      
      ctx.putImageData(imageData, 0, 0);
      animationId = requestAnimationFrame(drawNoise);
    };

    drawNoise();
    return () => cancelAnimationFrame(animationId);
  }, []);

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900">
      <canvas 
        ref={canvasRef} 
        width={200} 
        height={150}
        className="w-full h-full object-cover opacity-30"
      />
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <p className="text-white/60 text-lg font-medium mb-2">No Signal</p>
        <p className="text-white/40 text-sm">Select a channel to start watching</p>
      </div>
    </div>
  );
};

/* ---------------------------
   Playback helpers & config
   --------------------------- */

const BACKUP_PROXY = "https://poohlover.serv00.net";
const FORCE_PROXY_HOSTS = [
  "fl1.moveonjoy.com",
  "linear-1147.frequency.stream",
  "origin.thetvapp.to",
];

const withBackupProxy = (url: string) =>
  url.startsWith(BACKUP_PROXY) ? url : `${BACKUP_PROXY}/${url}`;

const mustProxy = (url: string) => {
  try {
    return FORCE_PROXY_HOSTS.includes(new URL(url).host);
  } catch {
    return false;
  }
};

const RESUME_KEY_PREFIX = "ptv:resume:";
const RESUME_TTL = 7 * 24 * 60 * 60 * 1000;
function saveResumePosition(channelId: string, position: number) {
  try {
    const payload = { pos: position, ts: Date.now() };
    localStorage.setItem(`${RESUME_KEY_PREFIX}${channelId}`, JSON.stringify(payload));
  } catch {}
}
function loadResumePosition(channelId: string): number | null {
  try {
    const raw = localStorage.getItem(`${RESUME_KEY_PREFIX}${channelId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.pos !== "number" || typeof parsed.ts !== "number") return null;
    if (Date.now() - parsed.ts > RESUME_TTL) {
      localStorage.removeItem(`${RESUME_KEY_PREFIX}${channelId}`);
      return null;
    }
    return parsed.pos;
  } catch {
    return null;
  }
}

const loadJwScript = () =>
  new Promise<void>((resolve, reject) => {
    if ((window as any).jwplayer) return resolve();
    const s = document.createElement("script");
    s.src = "https://ssl.p.jwpcdn.com/player/v/8.38.10/jwplayer.js";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = reject;
    document.head.appendChild(s);
  });

const VideoPlayer: React.FC<VideoPlayerProps> = ({ channel, onChannelChange }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const shakaPlayerRef = useRef<any>(null);
  const hlsRef = useRef<any>(null);

  // JW refs
  const jwRef = useRef<any>(null);
  const jwContainerRef = useRef<HTMLDivElement | null>(null);
  const jwFailedRef = useRef<boolean>(false);
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [quality, setQuality] = useState<string>('auto');
  const [showSettings, setShowSettings] = useState(false);
  const [availableQualities, setAvailableQualities] = useState<string[]>(['auto']);

  const controlsTimeoutRef = useRef<NodeJS.Timeout>();

  // Load Shaka Player and HLS.js dynamically (keeps same behavior)
  useEffect(() => {
    const loadScripts = async () => {
      // Load Shaka Player
      if (!window.shaka) {
        const shakaScript = document.createElement('script');
        shakaScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/shaka-player/4.7.11/shaka-player.compiled.min.js';
        shakaScript.async = true;
        document.head.appendChild(shakaScript);
        await new Promise(resolve => shakaScript.onload = resolve).catch(()=>{});
      }

      // Load HLS.js
      if (!window.Hls) {
        const hlsScript = document.createElement('script');
        hlsScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.7/hls.min.js';
        hlsScript.async = true;
        document.head.appendChild(hlsScript);
        await new Promise(resolve => hlsScript.onload = resolve).catch(()=>{});
      }
    };

    loadScripts();
  }, []);

  // Cleanup function - extended to include JW cleanup
  const cleanup = useCallback(() => {
    if (shakaPlayerRef.current) {
      try { shakaPlayerRef.current.destroy(); } catch {}
      shakaPlayerRef.current = null;
    }
    if (hlsRef.current) {
      try { hlsRef.current.destroy(); } catch {}
      hlsRef.current = null;
    }
    if (jwRef.current) {
      try { jwRef.current.remove(); } catch {}
      jwRef.current = null;
    }
    if (jwContainerRef.current) {
      try { jwContainerRef.current.style.display = 'none'; } catch {}
    }
    jwFailedRef.current = false;

    if (videoRef.current) {
      try {
        videoRef.current.src = '';
        videoRef.current.load();
      } catch {}
    }
    setError(null);
    setAvailableQualities(['auto']);
  }, []);

  // Try load JW Player for HLS/MP4/direct types
  const tryLoadJW = useCallback(async (streamUrl: string, ch: Channel) => {
    if (jwFailedRef.current) return false;
    // only attempt JW for m3u8/mp4/direct/ts types (not mpd/widevine)
    const tryFor = ['m3u8','mp4','ts','direct'];
    if (!(tryFor.includes(ch.stream_type) || /(\.m3u8|\.mp4|\.ts)(\?|$)/i.test(streamUrl))) return false;

    if (!jwContainerRef.current) return false;
    try {
      await loadJwScript();
    } catch (e) {
      jwFailedRef.current = true;
      return false;
    }

    try {
      jwContainerRef.current.style.display = 'block';
      const proxied = mustProxy(streamUrl) ? withBackupProxy(streamUrl) : streamUrl;

      // create/setup jwplayer
      try {
        jwRef.current = (window as any).jwplayer(jwContainerRef.current).setup({
          file: proxied,
          autostart: true,
          mute: false,
          preload: "auto",
          width: "100%",
          height: "100%",
          stretching: "uniform",
        });
      } catch (e) {
        // some jw versions require call form
        try {
          jwRef.current = (window as any).jwplayer(jwContainerRef.current);
          jwRef.current.setup && jwRef.current.setup({ file: proxied, autostart: true });
        } catch (err) {
          jwFailedRef.current = true;
          jwContainerRef.current.style.display = 'none';
          return false;
        }
      }

      jwRef.current.on?.("ready", () => {
        try {
          const resume = loadResumePosition(ch.id);
          if (resume != null && jwRef.current?.seek) {
            try { jwRef.current.seek(resume); } catch {}
          }
        } catch {}
        setIsLoading(false);
        setIsPlaying(true);
        // ensure native video unloaded
        try { if (videoRef.current) { videoRef.current.pause(); videoRef.current.removeAttribute('src'); videoRef.current.load(); } } catch {}
      });

      jwRef.current.on?.("play", () => setIsPlaying(true));
      jwRef.current.on?.("pause", () => setIsPlaying(false));
      jwRef.current.on?.("error", (err: any) => {
        console.warn('JW error', err);
        jwFailedRef.current = true;
        try { jwRef.current.remove(); } catch {}
        jwRef.current = null;
        if (jwContainerRef.current) jwContainerRef.current.style.display = 'none';
      });

      return true;
    } catch (err) {
      jwFailedRef.current = true;
      try { if (jwContainerRef.current) jwContainerRef.current.style.display = 'none'; } catch {}
      return false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load channel
  useEffect(() => {
    if (!channel || !videoRef.current) {
      cleanup();
      return;
    }

    const loadChannel = async () => {
      setIsLoading(true);
      setError(null);
      cleanup();

      const video = videoRef.current!;

      try {
        // Try JW first for non-MPD/Widevine streams (HLS/MP4/direct/ts)
        try {
          const triedJw = await tryLoadJW(channel.stream_url, channel);
          if (triedJw) {
            // JW will handle playback; we return early
            setIsLoading(false);
            return;
          }
        } catch (e) {
          // continue to other loaders
        }

        switch (channel.stream_type) {
          case 'mpd':
            await loadMPD(video, channel);
            break;
          case 'm3u8':
            await loadHLS(video, channel);
            break;
          case 'widevine':
            await loadWidevine(video, channel);
            break;
          case 'youtube':
            // YouTube embed handled separately
            break;
          case 'mp4':
          case 'ts':
          case 'direct':
          default:
            // direct native playback
            video.src = channel.stream_url;
            // attempt resume
            try {
              const resume = loadResumePosition(channel.id);
              if (resume != null) video.currentTime = resume;
            } catch {}
            await video.play();
            break;
        }
        setIsPlaying(true);
      } catch (err: any) {
        console.error('Error loading channel:', err);
        setError(err?.message || 'Failed to load channel');
      } finally {
        setIsLoading(false);
      }
    };

    loadChannel();

    return cleanup;
  }, [channel, cleanup, tryLoadJW]);

  // Load MPD with ClearKey
  const loadMPD = async (video: HTMLVideoElement, ch: Channel) => {
    if (!window.shaka) throw new Error('Shaka Player not loaded');

    const player = new window.shaka.Player(video);
    shakaPlayerRef.current = player;

    player.configure({
      streaming: {
        bufferingGoal: 10,
        rebufferingGoal: 2,
        bufferBehind: 30,
        retryParameters: {
          maxAttempts: 5,
          baseDelay: 1000,
          backoffFactor: 2
        }
      },
      abr: {
        enabled: true,
        defaultBandwidthEstimate: 5000000
      }
    });

    // Configure ClearKey if provided
    if (ch.clearkey_kid && ch.clearkey_key) {
      player.configure({
        drm: {
          clearKeys: {
            [ch.clearkey_kid]: ch.clearkey_key
          }
        }
      });
    }

    player.addEventListener('error', (event: any) => {
      console.error('Shaka error:', event.detail);
      setError('Playback error occurred');
    });

    player.addEventListener('adaptation', () => {
      const tracks = player.getVariantTracks();
      const qualities = tracks.map((t: any) => `${t.height}p`).filter((v: string, i: number, a: string[]) => a.indexOf(v) === i);
      setAvailableQualities(['auto', ...qualities]);
    });

    try {
      await player.load(ch.stream_url);
    } catch {
      // try backup proxy
      await player.load(withBackupProxy(ch.stream_url));
    }

    try {
      const resume = loadResumePosition(ch.id);
      if (resume != null) video.currentTime = resume;
    } catch {}

    await video.play();
  };

  // Load HLS
  const loadHLS = async (video: HTMLVideoElement, ch: Channel) => {
    const streamUrl = ch.stream_url;
    const resume = loadResumePosition(ch.id);

    // Try native first when appropriate
    if (!mustProxy(streamUrl) && video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = streamUrl;
      if (resume != null) video.currentTime = resume;
      await video.play();
      return;
    }

    // Ensure Hls lib loaded
    if (!window.Hls) {
      const hlsScript = document.createElement('script');
      hlsScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.7/hls.min.js';
      hlsScript.async = true;
      document.head.appendChild(hlsScript);
      await new Promise(resolve => hlsScript.onload = resolve).catch(()=>{});
    }

    if (window.Hls && window.Hls.isSupported && window.Hls.isSupported()) {
      const HlsLib = window.Hls;
      const lowEnd = (navigator as any).hardwareConcurrency <= 4 || (navigator as any).deviceMemory <= 2;
      const hls = new HlsLib({
        enableWorker: !lowEnd,
        lowLatencyMode: false,
        startLevel: -1,
        maxBufferLength: lowEnd ? 40 : 30,
        maxBufferSize: lowEnd ? 60 * 1000 * 1000 : 90 * 1000 * 1000,
      });

      hlsRef.current = hls;
      let triedBackup = false;

      hls.loadSource(streamUrl);
      hls.attachMedia(video);

      hls.on(HlsLib.Events.MANIFEST_PARSED, (_: any, data: any) => {
        try {
          const qualities = data.levels.map((l: any) => `${l.height}p`);
          setAvailableQualities(['auto', ...qualities]);
        } catch {}
        if (resume != null) {
          try { video.currentTime = resume; } catch {}
        }
        video.play().catch(() => {});
      });

      hls.on(HlsLib.Events.ERROR, (_: any, data: any) => {
        if (!data) return;
        if (data.fatal) {
          console.error('HLS fatal error', data);
          if (!triedBackup) {
            triedBackup = true;
            try { hls.destroy(); } catch {}
            const backup = withBackupProxy(streamUrl);
            const h2 = new HlsLib();
            hlsRef.current = h2;
            h2.loadSource(backup);
            h2.attachMedia(video);
            return;
          }
          setError('Stream error occurred');
        } else {
          // try to recover non-fatal
          try { hls.recoverMediaError(); } catch {}
        }
      });
    } else {
      // fallback to native src
      video.src = streamUrl;
      if (resume != null) video.currentTime = resume;
      await video.play();
    }
  };

  // Load Widevine
  const loadWidevine = async (video: HTMLVideoElement, ch: Channel) => {
    if (!window.shaka) throw new Error('Shaka Player not loaded');

    const player = new window.shaka.Player(video);
    shakaPlayerRef.current = player;

    if (ch.license_url) {
      player.configure({
        drm: {
          servers: {
            'com.widevine.alpha': ch.license_url
          }
        }
      });
    }

    await player.load(ch.stream_url);
    await video.play();
  };

  // Video event handlers (unchanged behavior + resume save)
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => {
      setCurrentTime(video.currentTime);
      try {
        if (channel?.id) saveResumePosition(channel.id, video.currentTime);
      } catch {}
    };
    const handleDurationChange = () => setDuration(video.duration);
    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleWaiting = () => setIsLoading(true);
    const handlePlaying = () => setIsLoading(false);

    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('durationchange', handleDurationChange);
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('waiting', handleWaiting);
    video.addEventListener('playing', handlePlaying);

    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('durationchange', handleDurationChange);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('waiting', handleWaiting);
      video.removeEventListener('playing', handlePlaying);
    };
  }, [channel]);

  // Controls visibility
  const showControlsTemporarily = useCallback(() => {
    setShowControls(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    controlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying) setShowControls(false);
    }, 3000);
  }, [isPlaying]);

  // Fullscreen handling
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const togglePlay = () => {
    // if jw active
    if (jwRef.current && jwRef.current.getState) {
      try {
        const state = jwRef.current.getState();
        if (state === 'playing') jwRef.current.pause();
        else jwRef.current.play();
      } catch {}
      return;
    }

    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
    }
  };

  const toggleMute = () => {
    if (jwRef.current && jwRef.current.setVolume) {
      try {
        if (isMuted) jwRef.current.setVolume(100);
        else jwRef.current.setVolume(0);
        setIsMuted(!isMuted);
      } catch {}
      return;
    }

    if (videoRef.current) {
      videoRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseFloat(e.target.value);
    setVolume(newVolume);
    if (jwRef.current && jwRef.current.setVolume) {
      try { jwRef.current.setVolume(Math.round(newVolume * 100)); } catch {}
      setIsMuted(newVolume === 0);
      return;
    }
    if (videoRef.current) {
      videoRef.current.volume = newVolume;
      setIsMuted(newVolume === 0);
    }
  };

  const toggleFullscreen = () => {
    if (containerRef.current) {
      if (!document.fullscreenElement) {
        containerRef.current.requestFullscreen();
      } else {
        document.exitFullscreen();
      }
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);

    if (jwRef.current && jwRef.current.seek) {
      try { jwRef.current.seek(time); setCurrentTime(time); } catch {}
      return;
    }

    if (videoRef.current) {
      videoRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  const formatTime = (time: number) => {
    if (!isFinite(time)) return '00:00';
    const mins = Math.floor(time / 60);
    const secs = Math.floor(time % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleQualityChange = (q: string) => {
    setQuality(q);
    setShowSettings(false);

    if (hlsRef.current) {
      if (q === 'auto') {
        hlsRef.current.currentLevel = -1;
      } else {
        const level = hlsRef.current.levels.findIndex((l: any) => `${l.height}p` === q);
        if (level !== -1) hlsRef.current.currentLevel = level;
      }
    }

    if (shakaPlayerRef.current) {
      const tracks = shakaPlayerRef.current.getVariantTracks();
      if (q === 'auto') {
        shakaPlayerRef.current.configure({ abr: { enabled: true } });
      } else {
        const track = tracks.find((t: any) => `${t.height}p` === q);
        if (track) {
          shakaPlayerRef.current.configure({ abr: { enabled: false } });
          shakaPlayerRef.current.selectVariantTrack(track, true);
        }
      }
    }
  };

  // YouTube embed handling
  if (channel?.stream_type === 'youtube') {
    const videoId = channel.stream_url.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/)?.[1];
    
    return (
      <div 
        ref={containerRef}
        className="relative w-full aspect-video bg-black rounded-lg overflow-hidden"
        style={{ 
          boxShadow: '0 0 30px rgba(0,0,0,0.8), inset 0 0 60px rgba(139, 69, 19, 0.3)',
          border: '4px solid #5d4037'
        }}
      >
        <iframe
          src={`https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0`}
          className="w-full h-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
    );
  }

  return (
    <div 
      ref={containerRef}
      className="relative w-full aspect-video bg-black rounded-lg overflow-hidden group"
      onMouseMove={showControlsTemporarily}
      onMouseLeave={() => isPlaying && setShowControls(false)}
      style={{ 
        boxShadow: '0 0 30px rgba(0,0,0,0.8), inset 0 0 60px rgba(139, 69, 19, 0.3)',
        border: '4px solid #5d4037',
        backgroundImage: 'linear-gradient(45deg, #3e2723 25%, transparent 25%), linear-gradient(-45deg, #3e2723 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #3e2723 75%), linear-gradient(-45deg, transparent 75%, #3e2723 75%)',
        backgroundSize: '20px 20px',
        backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px'
      }}
    >
      {/* JW container (for jwplayer) */}
      <div
        ref={(el) => { if (el && !jwContainerRef.current) jwContainerRef.current = el; }}
        style={{ position: 'absolute', inset: 0, display: 'none', zIndex: 10 }}
      />

      {/* Video Element */}
      <video
        ref={videoRef}
        className="w-full h-full object-contain"
        playsInline
        onClick={togglePlay}
      />

      {/* Static Noise when no channel */}
      {!channel && <StaticNoise />}

      {/* Loading Spinner */}
      {isLoading && channel && <LoadingSpinner />}

      {/* Error Display */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-20">
          <div className="text-center">
            <p className="text-red-400 text-lg font-medium mb-2">Error</p>
            <p className="text-white/60 text-sm">{error}</p>
          </div>
        </div>
      )}

      {/* Wooden Frame Corners */}
      <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-amber-800 rounded-tl-lg" />
      <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-amber-800 rounded-tr-lg" />
      <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-amber-800 rounded-bl-lg" />
      <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-amber-800 rounded-br-lg" />

      {/* Controls Overlay */}
      {channel && (
        <div 
          className={`absolute inset-x-0 bottom-0 transition-all duration-300 ${showControls ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}
          style={{
            background: 'linear-gradient(to top, rgba(62, 39, 35, 0.95), rgba(62, 39, 35, 0.7), transparent)',
            borderTop: '2px solid #8d6e63'
          }}
        >
          {/* Progress Bar */}
          {duration > 0 && (
            <div className="px-4 pt-2">
              <input
                type="range"
                min={0}
                max={duration}
                value={currentTime}
                onChange={handleSeek}
                className="w-full h-1 appearance-none cursor-pointer rounded-full"
                style={{
                  background: `linear-gradient(to right, #fbbf24 0%, #fbbf24 ${(currentTime / duration) * 100}%, #5d4037 ${(currentTime / duration) * 100}%, #5d4037 100%)`
                }}
              />
            </div>
          )}

          {/* Control Buttons */}
          <div className="flex items-center justify-between px-4 py-2">
            <div className="flex items-center gap-2 md:gap-4">
              {/* Channel Navigation */}
              {onChannelChange && (
                <button
                  onClick={() => onChannelChange('prev')}
                  className="p-2 text-amber-200 hover:text-amber-400 transition-colors"
                >
                  <SkipBack className="w-5 h-5" />
                </button>
              )}

              {/* Play/Pause */}
              <button
                onClick={togglePlay}
                className="p-2 bg-amber-600/50 rounded-full text-amber-100 hover:bg-amber-600 transition-colors"
              >
                {isPlaying ? <Pause className="w-5 h-5 md:w-6 md:h-6" /> : <Play className="w-5 h-5 md:w-6 md:h-6" />}
              </button>

              {onChannelChange && (
                <button
                  onClick={() => onChannelChange('next')}
                  className="p-2 text-amber-200 hover:text-amber-400 transition-colors"
                >
                  <SkipForward className="w-5 h-5" />
                </button>
              )}

              {/* Volume */}
              <div className="flex items-center gap-2">
                <button
                  onClick={toggleMute}
                  className="p-2 text-amber-200 hover:text-amber-400 transition-colors"
                >
                  {isMuted || volume === 0 ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.1}
                  value={isMuted ? 0 : volume}
                  onChange={handleVolumeChange}
                  className="w-16 md:w-24 h-1 appearance-none cursor-pointer rounded-full hidden sm:block"
                  style={{
                    background: `linear-gradient(to right, #fbbf24 0%, #fbbf24 ${(isMuted ? 0 : volume) * 100}%, #5d4037 ${(isMuted ? 0 : volume) * 100}%, #5d4037 100%)`
                  }}
                />
              </div>

              {/* Time Display */}
              <span className="text-amber-200 text-xs md:text-sm font-mono hidden sm:block">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
            </div>

            <div className="flex items-center gap-2">
              {/* Quality Settings */}
              <div className="relative">
                <button
                  onClick={() => setShowSettings(!showSettings)}
                  className="p-2 text-amber-200 hover:text-amber-400 transition-colors"
                >
                  <Settings className="w-5 h-5" />
                </button>
                {showSettings && (
                  <div className="absolute bottom-full right-0 mb-2 bg-amber-900/95 rounded-lg shadow-xl border border-amber-700 overflow-hidden min-w-[120px]">
                    <div className="px-3 py-2 border-b border-amber-700 text-amber-200 text-xs font-medium">
                      Quality
                    </div>
                    {availableQualities.map((q) => (
                      <button
                        key={q}
                        onClick={() => handleQualityChange(q)}
                        className={`w-full px-3 py-2 text-left text-sm transition-colors ${
                          quality === q ? 'bg-amber-600 text-white' : 'text-amber-200 hover:bg-amber-800'
                        }`}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Fullscreen */}
              <button
                onClick={toggleFullscreen}
                className="p-2 text-amber-200 hover:text-amber-400 transition-colors"
              >
                {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Channel Info Overlay */}
      {channel && showControls && (
        <div className="absolute top-4 left-4 bg-amber-900/80 px-3 py-1 rounded-lg">
          <p className="text-amber-100 text-sm font-medium">{channel.name}</p>
        </div>
      )}
    </div>
  );
};

// Add global type declarations
declare global {
  interface Window {
    shaka: any;
    Hls: any;
    jwplayer?: any;
  }
}

export default VideoPlayer;
