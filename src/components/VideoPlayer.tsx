import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Play, Pause, Volume2, VolumeX, Maximize, Minimize, Settings, SkipBack, SkipForward } from 'lucide-react';
import { Channel } from '@/types';

// --- (LoadingSpinner, StaticNoise components unchanged) ---
// copy your existing LoadingSpinner and StaticNoise components here (unchanged)
// ...

const PROXY_BASE = 'https://poohlover.serv00.net/stream-proxy.php?url=';

const VideoPlayer: React.FC<{ channel: Channel | null; onChannelChange?: (direction: 'prev'|'next') => void }> = ({ channel, onChannelChange }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const shakaPlayerRef = useRef<any>(null);
  const hlsRef = useRef<any>(null);

  // state (unchanged)
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
  const [isAdPlaying, setIsAdPlaying] = useState(false);

  const controlsTimeoutRef = useRef<NodeJS.Timeout>();
  const adPlayedRef = useRef(false);

  // retry refs
  const hlsRetryCount = useRef(0);
  const shakaRetryCount = useRef(0);

  // Load player libs
  useEffect(() => {
    const loadScripts = async () => {
      if (!window.shaka) {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/shaka-player/4.7.11/shaka-player.compiled.min.js';
        s.async = true;
        document.head.appendChild(s);
        await new Promise(resolve => (s.onload = resolve));
      }
      if (!window.Hls) {
        const s2 = document.createElement('script');
        s2.src = 'https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.7/hls.min.js';
        s2.async = true;
        document.head.appendChild(s2);
        await new Promise(resolve => (s2.onload = resolve));
      }
    };
    loadScripts();
  }, []);

  // Robust cleanup
  const cleanup = useCallback(() => {
    if (shakaPlayerRef.current) {
      try { shakaPlayerRef.current.destroy(); } catch(e) { console.warn('shaka destroy', e); }
      shakaPlayerRef.current = null;
    }
    if (hlsRef.current) {
      try { hlsRef.current.destroy(); } catch(e) { console.warn('hls destroy', e); }
      hlsRef.current = null;
    }
    if (videoRef.current) {
      try {
        videoRef.current.pause();
        videoRef.current.removeAttribute('src');
        videoRef.current.load();
      } catch (e) { /* ignore */ }
    }
    setError(null);
    setAvailableQualities(['auto']);
    hlsRetryCount.current = 0;
    shakaRetryCount.current = 0;
  }, []);

  useEffect(() => { adPlayedRef.current = false; }, [channel?.stream_url]);

  // load channel
  useEffect(() => {
    if (!channel || !videoRef.current) { cleanup(); return; }
    let cancelled = false;

    const load = async () => {
      setIsLoading(true);
      setError(null);
      cleanup();
      const video = videoRef.current!;
      // small DOM tweaks to reduce initial delay
      video.preload = 'auto';
      video.crossOrigin = 'anonymous';
      video.playsInline = true;

      try {
        if (channel.ad_url && !adPlayedRef.current) {
          adPlayedRef.current = true;
          await playAd(video, channel.ad_url);
        }
        await loadMainStream(video, channel);
        if (!cancelled) {
          setIsPlaying(true);
        }
      } catch (err: any) {
        console.error('load channel error', err);
        setError(err?.message || String(err) || 'Failed to load stream');
      } finally {
        setIsLoading(false);
      }
    };

    load();
    return () => { cancelled = true; cleanup(); };
  }, [channel, cleanup]);

  // ad playback (unchanged except using resolveProxyIfNeeded)
  const playAd = async (video: HTMLVideoElement, adUrl: string) => {
    setIsAdPlaying(true);
    setIsLoading(true);
    setShowControls(true);
    const resolved = resolveProxyIfNeeded(adUrl);
    const type = await detectType(resolved);

    return new Promise<void>(async (resolve) => {
      const cleanupHandlers = () => { video.onended = null; video.onerror = null; };
      video.onended = () => { cleanupHandlers(); setIsAdPlaying(false); resolve(); };
      video.onerror = () => { console.warn('Ad error, skip'); cleanupHandlers(); setIsAdPlaying(false); resolve(); };

      try {
        if (type === 'hls') {
          if (window.Hls && window.Hls.isSupported()) {
            const hls = new window.Hls();
            hlsRef.current = hls;
            hls.loadSource(resolved);
            hls.attachMedia(video);
            hls.on(window.Hls.Events.MANIFEST_PARSED, () => video.play().catch(()=>{}));
            hls.on(window.Hls.Events.ERROR, (_:any, data:any) => { console.warn('HLS ad error', data); });
          } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = resolved;
            await video.play().catch(()=>{});
          } else {
            resolve();
          }
        } else {
          video.src = resolved;
          await video.play().catch(()=>{});
        }
      } catch (e) {
        console.warn('ad play exception', e);
        resolve();
      } finally {
        setIsLoading(false);
        setIsAdPlaying(false);
      }
    });
  };

  // resolve proxy
  const resolveProxyIfNeeded = (url: string) => {
    try {
      if (!url) return url;
      if (url.includes('poohlover.serv00.net')) return url;
      const isHttpsPage = location.protocol === 'https:';
      if (isHttpsPage && url.startsWith('http://')) return PROXY_BASE + encodeURIComponent(url);
      return url;
    } catch (e) {
      return url;
    }
  };

  // detect type (unchanged)
  const detectType = async (url: string) : Promise<'hls'|'dash'|'video'|'unknown'> => {
    try {
      const lower = url.toLowerCase();
      if (lower.includes('.m3u8') || lower.includes('playlist.m3u8') || lower.includes('master.m3u8') || lower.includes('index.m3u8')) return 'hls';
      if (lower.endsWith('.mpd')) return 'dash';
      if (lower.match(/\.(mp4|webm|ogg|mkv|ts)(\?|$)/)) return 'video';

      try {
        const head = await fetch(url, { method: 'HEAD' });
        const ct = head.headers.get('content-type') || '';
        if (ct.includes('application/vnd.apple.mpegurl') || ct.includes('application/x-mpegurl')) return 'hls';
        if (ct.includes('application/dash+xml')) return 'dash';
        if (ct.startsWith('video/')) return 'video';
      } catch {}
      try {
        const r = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-2048' } });
        const text = await r.text();
        if (text.startsWith('#EXTM3U')) return 'hls';
        if (text.includes('<MPD')) return 'dash';
        if (text.length > 0 && /\<\!DOCTYPE html\>|<html/i.test(text)) return 'unknown';
      } catch {}
      return 'unknown';
    } catch {
      return 'unknown';
    }
  };

  // main stream loader
  const loadMainStream = async (video: HTMLVideoElement, ch: Channel) => {
    const resolved = resolveProxyIfNeeded(ch.stream_url);

    // pass-through for embeds (you handled already)
    if (resolved.includes('youtube.com') || resolved.includes('youtu.be') || resolved.includes('twitch.tv')) {
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
      // fallback: try HLS then direct
      try {
        await loadHLS(video, { ...ch, stream_url: resolved });
      } catch {
        await playDirect(video, resolved);
      }
    }
  };

  const playDirect = async (video: HTMLVideoElement, url: string) => {
    video.src = url;
    video.load();
    await video.play().catch(e => console.warn('Direct play error', e));
  };

  // --------- HLS.js loader optimized for low-latency & recovery ----------
  const createHlsInstance = (configOverrides = {}) => {
    if (!window.Hls) throw new Error('HLS.js not loaded');
    const defaultConfig: any = {
      // Low-latency friendly defaults
      maxBufferLength: 12,            // seconds of buffer we keep for stability
      maxMaxBufferLength: 30,
      maxBufferSize: 60 * 1000 * 1000,
      maxBufferHole: 0.5,
      backBufferLength: 15,
      // HLS low-latency options
      lowLatencyMode: true,
      // the following help with LL-HLS / start delays
      startLevel: -1,
      capLevelToPlayerSize: true,
      startFragPrefetch: true,
      // make fetching more parallel / worker usage
      enableWorker: true,
      // retry / load options
      fragLoadingTimeOut: 20000,
      fragLoadingMaxRetry: 6,
      fragLoadingRetryDelay: 1000,
      manifestLoadingTimeOut: 20000,
      manifestLoadingMaxRetry: 3,
      // auto load
      autoStartLoad: true
    };
    return new window.Hls({ ...defaultConfig, ...configOverrides });
  };

  const loadHLS = async (video: HTMLVideoElement, ch: Channel) => {
    const resolved = ch.stream_url;
    if (!window.Hls || !window.Hls.isSupported()) {
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = resolved;
        await video.play().catch(()=>{});
        return;
      }
      throw new Error('HLS not supported in this environment');
    }

    // destroy old hls instance if any
    if (hlsRef.current) {
      try { hlsRef.current.destroy(); } catch (e) {}
      hlsRef.current = null;
    }

    const hls = createHlsInstance();
    hlsRef.current = hls;

    // attempt to attach and load with recovery strategy
    const attachAndLoad = () => {
      setIsLoading(true);
      hls.loadSource(resolved);
      hls.attachMedia(video);
    };

    attachAndLoad();

    // manifest parsed -> populate qualities and play
    hls.on(window.Hls.Events.MANIFEST_PARSED, (_:any, data:any) => {
      try {
        const qualities = data.levels.map((l:any) => (l.height ? `${l.height}p` : `${Math.round(l.bitrate/1000)}kb`));
        setAvailableQualities(['auto', ...Array.from(new Set(qualities))]);
      } catch (e) {}
      hlsRetryCount.current = 0;
      video.play().catch(() => {});
      setIsLoading(false);
    });

    // keep track of level switch for UI
    hls.on(window.Hls.Events.LEVEL_SWITCHED, () => {
      // no-op or update UI if needed
    });

    // robust error handling
    hls.on(window.Hls.Events.ERROR, (_: any, data: any) => {
      console.warn('HLS error', data);
      // non-fatal
      if (!data || !data.fatal) return;

      // handle fatal errors by trying recovery strategies
      const type = data.type;
      if (type === window.Hls.ErrorTypes.MEDIA_ERROR) {
        // try to recover from media errors
        try {
          hls.recoverMediaError();
          return;
        } catch (e) {}
      }

      if (type === window.Hls.ErrorTypes.NETWORK_ERROR || type === window.Hls.ErrorTypes.OTHER_ERROR) {
        // try restart loading a few times (exponential backoff)
        const attempt = ++hlsRetryCount.current;
        if (attempt <= 5) {
          const backoff = Math.min(60000, 1000 * Math.pow(2, attempt)); // 1s,2s,4s...
          console.info(`HLS network error: retry ${attempt} in ${backoff}ms`);
          setTimeout(() => {
            try {
              // destroy & recreate to get a fresh state
              hls.destroy();
            } catch (e) {}
            hlsRef.current = null;
            const fresh = createHlsInstance();
            hlsRef.current = fresh;
            fresh.loadSource(resolved);
            fresh.attachMedia(video);
          }, backoff);
          return;
        }
      }

      // if we get here, give up and surface an error
      setError('Playback error (HLS).');
      try { hls.destroy(); } catch (e) {}
      hlsRef.current = null;
      setIsLoading(false);
    });
  };

  // --------- Shaka (DASH) loader optimized for low-latency & recovery ----------
  const loadMPD = async (video: HTMLVideoElement, ch: Channel) => {
    if (!window.shaka) throw new Error('Shaka Player not loaded');

    // ensure old player destroyed
    if (shakaPlayerRef.current) {
      try { shakaPlayerRef.current.destroy(); } catch (e) {}
      shakaPlayerRef.current = null;
    }

    const player = new window.shaka.Player(video);
    shakaPlayerRef.current = player;

    // Configure for low latency + quick recovery
    player.configure({
      streaming: {
        bufferingGoal: 8,          // seconds we try to keep buffered
        rebufferingGoal: 1.5,     // target to recover from rebuffering quickly
        bufferBehind: 15,
        retryParameters: {
          maxAttempts: 5,
          baseDelay: 1000,
          backoffFactor: 2
        },
        lowLatencyMode: true
      },
      abr: {
        enabled: true,
        defaultBandwidthEstimate: 5_000_000 // prefer higher starting BW for quick start
      },
      manifest: {
        retryParameters: {
          maxAttempts: 3,
          baseDelay: 1000,
          backoffFactor: 2
        }
      }
    });

    // drm / clearkey support (preserve your logic)
    if ((ch as any).clearkey_kid && (ch as any).clearkey_key) {
      player.configure({
        drm: {
          clearKeys: { [(ch as any).clearkey_kid]: (ch as any).clearkey_key }
        }
      });
    }
    if ((ch as any).license_url) {
      player.configure({ drm: { servers: { 'com.widevine.alpha': (ch as any).license_url } } });
    }

    // errors
    player.addEventListener('error', (event: any) => {
      console.error('Shaka player error', event.detail);
      const code = event.detail?.code;
      // try to recover a few times
      const attempt = ++shakaRetryCount.current;
      if (attempt <= 4) {
        const backoff = Math.min(30000, 1000 * Math.pow(2, attempt));
        console.info(`Shaka error attempt ${attempt}, retrying in ${backoff}ms`);
        setTimeout(async () => {
          try {
            await player.load(ch.stream_url);
            video.play().catch(()=>{});
          } catch (e) {
            console.warn('Shaka retry failed', e);
          }
        }, backoff);
        return;
      }
      setError('Playback error (DASH).');
    });

    player.addEventListener('adaptation', () => {
      try {
        const tracks = player.getVariantTracks();
        const qualities = tracks.map((t: any) => `${t.height}p`).filter((v: string, i: number, a: string[]) => a.indexOf(v) === i);
        setAvailableQualities(['auto', ...qualities]);
      } catch (e) {}
    });

    // load
    await player.load(ch.stream_url);
    shakaRetryCount.current = 0;
    await video.play().catch(()=>{});
  };

  // video event handlers (unchanged)
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const handleTimeUpdate = () => setCurrentTime(video.currentTime);
    const handleDurationChange = () => setDuration(video.duration || 0);
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

  // controls visibility (unchanged)
  const showControlsTemporarily = useCallback(() => {
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => { if (isPlaying) setShowControls(false); }, 3000);
  }, [isPlaying]);

  // fullscreen handling (unchanged)
  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // basic controls (unchanged)
  const togglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) videoRef.current.pause();
    else videoRef.current.play().catch(()=>{});
  };
  const toggleMute = () => { if (!videoRef.current) return; videoRef.current.muted = !isMuted; setIsMuted(!isMuted); };
  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => { const newV = parseFloat(e.target.value); setVolume(newV); if (videoRef.current) { videoRef.current.volume = newV; setIsMuted(newV === 0); } };
  const toggleFullscreen = () => { if (!containerRef.current) return; if (!document.fullscreenElement) containerRef.current.requestFullscreen(); else document.exitFullscreen(); };
  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => { const t = parseFloat(e.target.value); if (videoRef.current) { videoRef.current.currentTime = t; setCurrentTime(t); } };
  const formatTime = (time: number) => { if (!isFinite(time)) return '00:00'; const mins = Math.floor(time/60); const secs = Math.floor(time%60); return `${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`; };

  const handleQualityChange = (q: string) => {
    setQuality(q);
    setShowSettings(false);
    if (hlsRef.current) {
      if (q === 'auto') hlsRef.current.currentLevel = -1;
      else {
        const level = hlsRef.current.levels.findIndex((l: any) => `${l.height}p` === q);
        if (level !== -1) hlsRef.current.currentLevel = level;
      }
    }
    if (shakaPlayerRef.current) {
      const tracks = shakaPlayerRef.current.getVariantTracks();
      if (q === 'auto') shakaPlayerRef.current.configure({ abr: { enabled: true } });
      else {
        const track = tracks.find((t: any) => `${t.height}p` === q);
        if (track) {
          shakaPlayerRef.current.configure({ abr: { enabled: false } });
          shakaPlayerRef.current.selectVariantTrack(track, /* clearBuffer */ true);
        }
      }
    }
  };

  // UI: YouTube embed handling (unchanged from your original)
  if (channel?.stream_type === 'youtube') {
    const videoId = channel.stream_url.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/)?.[1];
    return (
      <div ref={containerRef} className="relative w-full aspect-video bg-black rounded-lg overflow-hidden" style={{ boxShadow: '0 0 30px rgba(0,0,0,0.8), inset 0 0 60px rgba(139, 69, 19, 0.3)', border: '4px solid #5d4037' }}>
        <iframe src={`https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0`} className="w-full h-full" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
      </div>
    );
  }

  // --- Render: mostly unchanged UI (use your existing JSX) ---
  return (
    <div ref={containerRef} className="relative w-full aspect-video bg-black rounded-lg overflow-hidden group" onMouseMove={showControlsTemporarily} onMouseLeave={() => isPlaying && setShowControls(false)} style={{ boxShadow: '0 0 30px rgba(0,0,0,0.8), inset 0 0 60px rgba(139, 69, 19, 0.3)', border: '4px solid #5d4037', backgroundImage: 'linear-gradient(45deg, #3e2723 25%, transparent 25%), linear-gradient(-45deg, #3e2723 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #3e2723 75%), linear-gradient(-45deg, transparent 75%, #3e2723 75%)', backgroundSize: '20px 20px', backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px' }}>
      <video ref={videoRef} className="w-full h-full object-contain" playsInline onClick={togglePlay} />

      {isAdPlaying && <div className="absolute top-4 right-4 bg-black/70 text-white text-xs px-3 py-1 rounded z-30">Advertisement</div>}
      {!channel && /* your StaticNoise here */ <div/>}
      {isLoading && channel && /* your LoadingSpinner here */ <div/>}

      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-20">
          <div className="text-center">
            <p className="text-red-400 text-lg font-medium mb-2">Error</p>
            <p className="text-white/60 text-sm">{error}</p>
          </div>
        </div>
      )}

      {/* the controls / UI you provided remain unchanged — copy/paste your controls JSX here */}
      {/* ... */}
    </div>
  );
};

declare global {
  interface Window { shaka: any; Hls: any; }
}

export default VideoPlayer;
