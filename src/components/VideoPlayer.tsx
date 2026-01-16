import React, { useEffect, useRef, useState, useCallback } from 'react'; 
import { Play, Pause, Volume2, VolumeX, Maximize, Minimize, Settings, SkipBack, SkipForward, Power } from 'lucide-react';
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

const PROXY_BASE = 'https://poohlover.serv00.net/stream-proxy.php?url='; // Your unified proxy endpoint

const VideoPlayer: React.FC<VideoPlayerProps> = ({ channel, onChannelChange }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const shakaPlayerRef = useRef<any>(null);
  const hlsRef = useRef<any>(null);
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false); // start true to match autoplay-muted behavior
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
  const [isAdPlaying, setIsAdPlaying] = useState(false);

  // NEW: Stream enabled (On/Off)
  const [isStreamEnabled, setIsStreamEnabled] = useState(true);

  const controlsTimeoutRef = useRef<NodeJS.Timeout>();
  const adPlayedRef = useRef(false);

  // WATCHDOG: detect freeze / stall
  const lastProgressRef = useRef<{ time: number; currentTime: number }>({ time: Date.now(), currentTime: 0 });
  const watchdogIntervalRef = useRef<number | null>(null);

  // Load Shaka Player and HLS.js dynamically
  useEffect(() => {
    const loadScripts = async () => {
      // Load Shaka Player
      if (!window.shaka) {
        const shakaScript = document.createElement('script');
        shakaScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/shaka-player/4.7.11/shaka-player.compiled.min.js';
        shakaScript.async = true;
        document.head.appendChild(shakaScript);
        await new Promise(resolve => shakaScript.onload = resolve);
      }

      // Load HLS.js
      if (!window.Hls) {
        const hlsScript = document.createElement('script');
        hlsScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.7/hls.min.js';
        hlsScript.async = true;
        document.head.appendChild(hlsScript);
        await new Promise(resolve => hlsScript.onload = resolve);
      }
    };

    loadScripts();
  }, []);

  // Auto-unlock audio on first user gesture (mousemove / touchstart / click / keydown)
  useEffect(() => {
    const unlockAudio = () => {
      const v = videoRef.current;
      if (!v) return;
      if (v.muted) {
        try {
          v.muted = false;
        } catch {}
        setIsMuted(false);
      }
      // clean up listeners (they were added with { once: true } but remove just in case)
      window.removeEventListener('mousemove', unlockAudio);
      window.removeEventListener('touchstart', unlockAudio);
      window.removeEventListener('click', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
    };

    // Listen once for each allowed gesture (passive where appropriate)
    window.addEventListener('mousemove', unlockAudio, { once: true, passive: true } as any);
    window.addEventListener('touchstart', unlockAudio, { once: true, passive: true } as any);
    window.addEventListener('click', unlockAudio, { once: true, passive: true } as any);
    window.addEventListener('keydown', unlockAudio, { once: true, passive: true } as any);

    return () => {
      window.removeEventListener('mousemove', unlockAudio);
      window.removeEventListener('touchstart', unlockAudio);
      window.removeEventListener('click', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
    };
  }, []);

  // Cleanup function
  const cleanup = useCallback(() => {
    // stop watchdog
    if (watchdogIntervalRef.current) {
      clearInterval(watchdogIntervalRef.current);
      watchdogIntervalRef.current = null;
    }

    if (shakaPlayerRef.current) {
      try { shakaPlayerRef.current.destroy(); } catch(e){ console.warn('shaka destroy', e); }
      shakaPlayerRef.current = null;
    }
    if (hlsRef.current) {
      try { hlsRef.current.destroy(); } catch(e){ console.warn('hls destroy', e); }
      hlsRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.src = '';
      try { videoRef.current.load(); } catch(e) { /* ignore */ }
    }
    setError(null);
    setAvailableQualities(['auto']);
    setIsPlaying(false);
    setIsAdPlaying(false);
  }, []);

  // Reset ad flag when channel changes
  useEffect(() => {
    adPlayedRef.current = false;
    // If a new channel arrives, re-enable stream by default
    setIsStreamEnabled(true);
  }, [channel?.stream_url]);

  // Load channel (with ad support) - respects isStreamEnabled
  useEffect(() => {
    if (!channel || !videoRef.current) {
      cleanup();
      return;
    }

    if (!isStreamEnabled) {
      cleanup();
      return;
    }

    const loadChannel = async () => {
      setIsLoading(true);
      setError(null);
      cleanup();

      const video = videoRef.current!;

      // Ensure autoplay starts muted and React state reflects that
      try {
        video.muted = false;
      } catch {}
      setIsMuted(false);

      try {
        // first: attempt to play ad if present and not yet played
        if (channel.ad_url && !adPlayedRef.current) {
          adPlayedRef.current = true;
          await playAd(video, channel.ad_url);
        }

        // then load main stream
        await loadMainStream(video, channel);
        setIsPlaying(true);
      } catch (err: any) {
        console.error('Error loading channel:', err);
        setError(err.message || 'Failed to load channel');
      } finally {
        setIsLoading(false);
      }
    };

    loadChannel();

    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, isStreamEnabled]);

  // Play the ad (supports MP4 or M3U8 proxied URLs)
  const playAd = async (video: HTMLVideoElement, adUrl: string) => {
    try {
      setIsAdPlaying(true);
      setShowControls(true);
      setIsLoading(true);

      const resolved = resolveProxyIfNeeded(adUrl);

      // detect ad type quickly
      const type = await detectType(resolved);

      return new Promise<void>(async (resolve, reject) => {
        const cleanupHandlers = () => {
          video.onended = null;
          video.onerror = null;
        };

        video.onended = () => {
          cleanupHandlers();
          setIsAdPlaying(false);
          resolve();
        };

        video.onerror = (e) => {
          console.warn('Ad playback error, skipping ad', e);
          cleanupHandlers();
          setIsAdPlaying(false);
          resolve(); // resolve so we continue to main stream
        };

        try {
          if (type === 'hls') {
            // use HLS.js for ad manifest
            if (window.Hls && window.Hls.isSupported()) {
              const hls = new window.Hls();
              hlsRef.current = hls;
              hls.loadSource(resolved);
              hls.attachMedia(video);
              hls.on(window.Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
              hls.on(window.Hls.Events.ERROR, (_: any, data: any) => {
                console.warn('HLS ad error:', data);
              });
            } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
              video.src = resolved;
              await video.play().catch(() => {});
            } else {
              console.warn('HLS not supported for ad');
              resolve();
            }
          } else {
            // direct mp4 or other video
            video.src = resolved;
            await video.play().catch(() => {});
          }
        } catch (e) {
          console.warn('Ad play exception:', e);
          cleanupHandlers();
          setIsAdPlaying(false);
          resolve();
        } finally {
          setIsLoading(false);
        }
      });
    } finally {
      setIsAdPlaying(false);
      setIsLoading(false);
    }
  };

  // Resolve proxy only if needed (prevents double-wrapping)
  const resolveProxyIfNeeded = (url: string) => {
    try {
      // If already points to our proxy, return as-is
      if (url.includes('poohlover.serv00.net')) return url;

      const isHttpsPage = location.protocol === 'https:';
      // If page is HTTPS and url is HTTP (mixed content), proxy it
      if (isHttpsPage && url.startsWith('http://')) {
        return PROXY_BASE + encodeURIComponent(url);
      }

      return url;
    } catch (e) {
      return url;
    }
  };

  // detect stream type: 'hls' | 'dash' | 'video' | 'unknown'
  const detectType = async (url: string) : Promise<'hls'|'dash'|'video'|'unknown'> => {
    try {
      // Quick pattern checks
      const lower = url.toLowerCase();
      if (lower.includes('.m3u8') || lower.includes('playlist.m3u8') || lower.includes('master.m3u8') || lower.includes('index.m3u8')) return 'hls';
      if (lower.endsWith('.mpd')) return 'dash';
      if (lower.match(/\.(mp4|webm|ogg|mkv|ts)(\?|$)/)) return 'video';

      // Try HEAD, but many servers/proxies block it
      try {
        const head = await fetch(url, { method: 'HEAD' });
        const ct = head.headers.get('content-type') || '';
        if (ct.includes('application/vnd.apple.mpegurl') || ct.includes('application/x-mpegurl')) return 'hls';
        if (ct.includes('application/dash+xml')) return 'dash';
        if (ct.startsWith('video/')) return 'video';
      } catch (e) {
        // ignore
      }

      // Fall back to small range GET and inspect text
      try {
        const r = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-2048' } });
        const text = await r.text();
        if (text.startsWith('#EXTM3U')) return 'hls';
        if (text.includes('<MPD')) return 'dash';
        if (text.length > 0 && /\<!DOCTYPE html\>|<html/i.test(text)) return 'unknown';
      } catch (e) {
        // ignore
      }

      return 'unknown';
    } catch (e) {
      return 'unknown';
    }
  };

  // Load the main stream (MP4 / HLS / DASH / direct)
  const loadMainStream = async (video: HTMLVideoElement, ch: Channel) => {
    const resolved = resolveProxyIfNeeded(ch.stream_url);

    // embed platforms
    if (resolved.includes('youtube.com') || resolved.includes('youtu.be') || resolved.includes('twitch.tv')) {
      // handing back to parent render (will render iframe)
      return;
    }

    const type = await detectType(resolved);

    if (type === 'dash' || ch.stream_type === 'mpd') {
      await loadMPD(video, { ...ch, stream_url: resolved });
    } else if (type === 'hls' || ch.stream_type === 'm3u8') {
      await loadHLS(video, { ...ch, stream_url: resolved });
    } else if (type === 'video' || ch.stream_type === 'mp4' || ch.stream_type === 'direct') {
      await playDirect(video, resolved);
    } else {
      // fallback: try HLS, then direct
      try {
        await loadHLS(video, { ...ch, stream_url: resolved });
      } catch {
        await playDirect(video, resolved);
      }
    }
  };

  // Play direct video
  const playDirect = async (video: HTMLVideoElement, url: string) => {
    // Optimize: allow immediate preload and muted autoplay attempt to reduce delay
    video.preload = 'auto';
    try { video.muted = false; } catch {}
    setIsMuted(false);
    video.src = url;
    await video.play().catch(e => console.warn('Direct play error', e));
    // restore muted state to UI preference if needed (we keep autoplay-muted; unmute unlocked via gesture)
    // Do not programmatically unmute here — browsers will block it if no gesture
  };

  // Load HLS: tuned for low latency + robust error recovery
  const loadHLS = async (video: HTMLVideoElement, ch: Channel) => {
    // If native HLS is supported (Safari), prefer native (it's often the lowest-latency)
    if (!window.Hls) {
      if (video.canPlayType && video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = ch.stream_url;
        video.preload = 'auto';
        try { video.muted = false; } catch {}
        setIsMuted(false);
        await video.play().catch(()=>{});
        return;
      }
      throw new Error('HLS not supported');
    }

    // Cleanup previous
    if (hlsRef.current) {
      try { hlsRef.current.destroy(); } catch (e) { console.warn('hls destroy', e); }
      hlsRef.current = null;
    }

    // HLS.js configuration tuned for fast start and low-latency live
    const hlsConfig = {
      enableWorker: true,
      maxBufferLength: 25,            // keep buffer reasonably low to reduce latency
      maxMaxBufferLength: 45,
      maxBufferSize: 60 * 1000 * 1000,
      maxBufferHole: 0.5,
      lowLatencyMode: true,           // enable LL-HLS support when available
      liveSyncDuration: 3,            // target distance from live (seconds)
      liveMaxLatencyDuration: 12,     // upper bound on latency to live edge
      startLevel: -1,
      startFragPrefetch: true,
      capLevelToPlayerSize: true,
      // nudgeOffset and nudgeMaxRetry are helpful in some network cases
      nudgeOffset: 0.1,
      nudgeMaxRetry: 3
    };

    const hls = new window.Hls(hlsConfig);
    hlsRef.current = hls;

    // attach and load
    hls.loadSource(ch.stream_url);
    hls.attachMedia(video);

    // attempt immediate autoplay via muted trick (improves "no autoplay" on some browsers)
    video.preload = 'auto';
    try { video.muted = false; } catch {}
    setIsMuted(false);
    try { await video.play().catch(()=>{}); } catch {}

    // HLS event handlers - populate qualities and add robust error recovery
    hls.on(window.Hls.Events.MANIFEST_PARSED, (_: any, data: any) => {
      try {
        const qualities = (data.levels || []).map((l: any) => `${l.height || l.name || 'auto'}p`);
        setAvailableQualities(Array.from(new Set(['auto', ...qualities])));
        // start loading from live edge
        hls.startLoad(-1);
        // if we can autoplay, try; otherwise UI play will work
        video.play().catch(()=>{});
      } finally {
        setIsLoading(false);
      }
    });

    // When fragments buffered, clear loading UI
    hls.on(window.Hls.Events.FRAG_BUFFERED, () => {
      setIsLoading(false);
    });

    // Listen to level updated to reflect resolution changes
    hls.on(window.Hls.Events.LEVEL_SWITCHED, () => {
      // nothing here, but could be used to set current quality
    });

    // Error handling - aggressive recovery for network/media errors
    hls.on(window.Hls.Events.ERROR, (_: any, data: any) => {
      console.warn('HLS error event:', data);
      if (!data || !data.fatal) return;

      try {
        // Try to auto-recover common fatal error types
        if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR) {
          // attempt to restart loading
          try {
            hls.startLoad();
            setTimeout(() => { /* Let the loader settle */ }, 500);
          } catch (e) {
            console.warn('hls network recovery failed', e);
            try { hls.destroy(); } catch {}
          }
        } else if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR) {
          try {
            hls.recoverMediaError();
          } catch (e) {
            console.warn('hls media recovery error', e);
            try { hls.destroy(); } catch {}
          }
        } else {
          // fallback: full reload of hls instance
          try {
            hls.destroy();
            // re-create and re-attach one time
            const newHls = new window.Hls(hlsConfig);
            hlsRef.current = newHls;
            newHls.loadSource(ch.stream_url);
            newHls.attachMedia(video);
            newHls.startLoad(-1);
          } catch (e) {
            console.error('hls full reload failed', e);
            setError('Stream error occurred');
          }
        }
      } catch (e) {
        console.error('hls error handling broken', e);
      }
    });

    // Keep last-progress for watchdog
    lastProgressRef.current = { time: Date.now(), currentTime: video.currentTime || 0 };

    // Start a lightweight watchdog to detect stalls (no progress for X seconds)
    if (watchdogIntervalRef.current) {
      clearInterval(watchdogIntervalRef.current);
      watchdogIntervalRef.current = null;
    }
    watchdogIntervalRef.current = window.setInterval(() => {
      try {
        const now = Date.now();
        const prev = lastProgressRef.current;
        if (video.paused || video.seeking || isAdPlaying) {
          lastProgressRef.current = { time: now, currentTime: video.currentTime };
          return;
        }
        // If no progress in >6s while playing, attempt recovery
        if (video.currentTime === prev.currentTime && now - prev.time > 6000) {
          console.warn('Watchdog: detected stall, attempting recovery');
          // try media error recovery
          try { hls.recoverMediaError(); } catch(e){ console.warn('recoverMediaError failed', e); }
          // if still stalled, try restarting load
          try { hls.stopLoad(); hls.startLoad(-1); } catch(e){ console.warn('hls restart failed', e); }
          lastProgressRef.current = { time: Date.now(), currentTime: video.currentTime };
        } else {
          // progress observed -> update
          lastProgressRef.current = { time: now, currentTime: video.currentTime };
        }
      } catch (e) {
        // ignore
      }
    }, 2500);
  };

  // Load MPD (DASH) with Shaka
  const loadMPD = async (video: HTMLVideoElement, ch: Channel) => {
    if (!window.shaka) throw new Error('Shaka Player not loaded');

    // Cleanup previous
    if (shakaPlayerRef.current) {
      try { shakaPlayerRef.current.destroy(); } catch(e) { console.warn('old shaka destroy', e); }
      shakaPlayerRef.current = null;
    }

    const player = new window.shaka.Player(video);
    shakaPlayerRef.current = player;

    // Configure Shaka for low latency + robust behavior
    player.configure({
      streaming: {
        lowLatencyMode: true,      // enable LL-DASH/Low-latency behavior when the manifest supports it
        bufferingGoal: 10,         // seconds - keep this moderate to reduce latency
        rebufferingGoal: 1,        // seconds - attempt to rebuffer quickly
        bufferBehind: 30,
        smallGapLimit: 0.5,
        ignoreMinBufferTime: true
      },
      abr: {
        enabled: true,
        defaultBandwidthEstimate: 5000000, // bias initial selection toward higher BW to avoid slow startup switching
      },
      manifest: {
        retryParameters: {
          maxAttempts: 5,
          baseDelay: 1000,
          backoffFactor: 2
        }
      }
    });

    // Configure ClearKey if provided
    if ((ch as any).clearkey_kid && (ch as any).clearkey_key) {
      player.configure({
        drm: {
          clearKeys: {
            [(ch as any).clearkey_kid]: (ch as any).clearkey_key
          }
        }
      });
    }

    if ((ch as any).license_url) {
      player.configure({ drm: { servers: { 'com.widevine.alpha': (ch as any).license_url } } });
    }

    player.addEventListener('error', (event: any) => {
      console.error('Shaka error:', event.detail);
      setError('Playback error occurred');
      // Attempt a soft recovery on network errors
      try {
        const severity = event.detail && event.detail.severity;
        if (severity === window.shaka.util.Error.Severity.RECOVERABLE) {
          // try to reconfigure ABR to be more conservative
          player.configure({ abr: { enabled: true, defaultBandwidthEstimate: 1000000 } });
        } else {
          // fatal -> try reloading manifest once
          player.unload().then(() => player.load(ch.stream_url)).catch(e => console.warn('shaka reload failed', e));
        }
      } catch(e){}
    });

    player.addEventListener('adaptation', () => {
      const tracks = player.getVariantTracks();
      const qualities = tracks.map((t: any) => `${t.height}p`).filter((v: string, i: number, a: string[]) => a.indexOf(v) === i);
      setAvailableQualities(['auto', ...qualities]);
    });

    // Start load
    try {
      await player.load(ch.stream_url);
      video.preload = 'auto';
      try { video.muted = false; } catch {}
      setIsMuted(false);
      await video.play().catch(()=>{});
    } catch (e) {
      console.error('Shaka load/play failed', e);
      setError('Failed to load DASH stream');
    }

    // Watchdog for Shaka: watch for stalls and try to recover by reducing quality
    lastProgressRef.current = { time: Date.now(), currentTime: video.currentTime || 0 };
    if (watchdogIntervalRef.current) {
      clearInterval(watchdogIntervalRef.current);
      watchdogIntervalRef.current = null;
    }
    watchdogIntervalRef.current = window.setInterval(() => {
      try {
        const now = Date.now();
        const prev = lastProgressRef.current;
        if (video.paused || video.seeking || isAdPlaying) {
          lastProgressRef.current = { time: now, currentTime: video.currentTime };
          return;
        }
        if (video.currentTime === prev.currentTime && now - prev.time > 6000) {
          console.warn('Watchdog (shaka): detected stall, attempting recovery');
          // Try lowering ABR aggressiveness or selecting lower track
          try {
            const tracks = shakaPlayerRef.current.getVariantTracks().filter((t:any) => t.allowed);
            const sorted = tracks.sort((a:any,b:any)=>a.bandwidth-b.bandwidth);
            if (sorted.length) {
              const lowest = sorted[0];
              shakaPlayerRef.current.configure({ abr: { enabled: false } });
              shakaPlayerRef.current.selectVariantTrack(lowest, /*clearBuffer=*/ true);
            } else {
              // fallback: reload manifest
              shakaPlayerRef.current.reload();
            }
          } catch (e) {
            console.warn('shaka watchdog recovery failed', e);
            try { shakaPlayerRef.current.reload(); } catch {}
          }
          lastProgressRef.current = { time: Date.now(), currentTime: video.currentTime };
        } else {
          lastProgressRef.current = { time: now, currentTime: video.currentTime };
        }
      } catch (e) {}
    }, 2500);
  };

  // Video event handlers
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => setCurrentTime(video.currentTime);
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
  }, []);

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

// NEW: attach pointer/touch listeners for mobile smooth show/hide
useEffect(() => {
const el = containerRef.current;
if (!el) return;


const onTouch = (e: Event) => {
// touch is a gesture that should reveal controls briefly
showControlsTemporarily();
};


el.addEventListener('touchstart', onTouch, { passive: true });
el.addEventListener('pointermove', showControlsTemporarily as any, { passive: true });


return () => {
el.removeEventListener('touchstart', onTouch as any);
el.removeEventListener('pointermove', showControlsTemporarily as any);
};
}, [showControlsTemporarily]);

  // Fullscreen handling
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        // Some browsers block autoplay if not muted; attempt play and swallow errors
        if (videoRef.current.paused) {
          videoRef.current.play().catch(()=>{});
        }
      }
    }
  };

  const toggleMute = () => {
    if (videoRef.current) {
      videoRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseFloat(e.target.value);
    setVolume(newVolume);
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
        hlsRef.current.loadLevel = -1;
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

  // Stream On/Off toggle handler
  const toggleStreamEnabled = () => {
    if (isStreamEnabled) {
      // turn off: immediately cleanup and keep overlay visible
      cleanup();
      setIsStreamEnabled(false);
      setShowControls(true);
    } else {
      // turn on: enable and allow useEffect to load channel
      setIsStreamEnabled(true);
      // keep controls visible so user sees loading
      setShowControls(true);
    }
  };

  // YouTube embed handling
  if (channel?.stream_type === 'youtube') {
    const videoId = channel.stream_url.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/)?.[1];
    
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
      {/* Video Element */}
      <video
        ref={videoRef}
        className="w-full h-full object-contain"
        playsInline
        onClick={togglePlay}
      />

      {/* Ad badge */}
      {isAdPlaying && (
        <div className="absolute top-4 right-4 bg-black/70 text-white text-xs px-3 py-1 rounded z-30">Advertisement</div>
      )}

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
              {/* NEW: On Stream indicator (left of settings) */}
              <div className="flex items-center gap-2 mr-1">
                <button
                  onClick={toggleStreamEnabled}
                  className={`flex items-center gap-2 px-2 py-1 rounded-md text-sm font-medium transition-all ${isStreamEnabled ? 'bg-emerald-700/80 text-emerald-100' : 'bg-red-800/80 text-red-200'}`}
                  aria-pressed={isStreamEnabled}
                  title={isStreamEnabled ? 'Turn stream off' : 'Turn stream on'}
                >
                  <span className={`w-2 h-2 rounded-full ${isStreamEnabled ? 'bg-emerald-400' : 'bg-red-400'} block`} />
                  
                </button>
              </div>

              {/* Quality Settings */}
              <div className="relative">
                <button
                  onClick={() => setShowSettings(!showSettings)}
                  className="p-2 text-amber-200 hover:text-amber-400 transition-colors"
                >
                  <Settings className="w-5 h-5" />
                </button>
                {showSettings && (
                  <div className="absolute bottom-full right-0 mb-2 bg-amber-900/95 rounded-lg shadow-xl border border-amber-700 overflow-hidden min-w-[120px] sm:min-w-[160px]">
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

              {/* Power (explicit shutdown) - visible on md+ to avoid crowding mobile */}
              <button
                onClick={() => { toggleStreamEnabled(); /* keep same handler but a clearer affordance */ }}
                className="hidden md:inline-flex items-center p-2 ml-1 text-amber-200 hover:text-amber-400 transition-colors"
                title={isStreamEnabled ? 'Shutdown stream' : 'Start stream'}
              >
                <Power className="w-5 h-5" />
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
  }
}

export default VideoPlayer;
