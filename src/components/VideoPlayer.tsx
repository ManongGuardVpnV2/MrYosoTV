import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Play, Pause, Volume2, VolumeX, Maximize, Minimize, Settings, SkipBack, SkipForward } from 'lucide-react';
import { Channel } from '@/types';

interface VideoPlayerProps {
  channel: Channel | null;
  onChannelChange?: (direction: 'prev' | 'next') => void;
}

/**
 * Minimal, focused VideoPlayer
 * - Keeps your UI/controls intact
 * - Playback logic for m3u8 (HLS), mpd (DASH), mp4/direct
 * - Proxy fallback (backup proxy) on fatal network/CORS errors
 * - Loads Hls.js / Shaka dynamically when needed
 *
 * Note: This intentionally removes JW, signed URL logic, resume, polling, etc.
 */

/* ----- Proxy helpers ----- */
const BACKUP_PROXY = 'https://poohlover.serv00.net';
const FORCE_PROXY_HOSTS = ['fl1.moveonjoy.com', 'moveonjoy.com', 'linear-1147.frequency.stream'];

const withBackupProxy = (url: string) => (url.startsWith(BACKUP_PROXY) ? url : `${BACKUP_PROXY}/${url}`);

const mustProxy = (url: string) => {
  try {
    const host = new URL(url).host;
    return FORCE_PROXY_HOSTS.some(h => host.includes(h)) || /moveonjoy/i.test(host);
  } catch {
    return false;
  }
};

/* ----- Loading spinner + static noise (kept from your UI) ----- */
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
  </div>
);

const StaticNoise: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    const draw = () => {
      const w = canvas.width = canvas.clientWidth;
      const h = canvas.height = canvas.clientHeight;
      const imageData = ctx.createImageData(w, h);
      const d = imageData.data;
      for (let i = 0; i < d.length; i += 4) {
        const v = Math.floor(Math.random() * 255);
        d[i] = d[i + 1] = d[i + 2] = v;
        d[i + 3] = 255;
      }
      ctx.putImageData(imageData, 0, 0);
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900">
      <canvas ref={canvasRef} className="w-full h-full object-cover opacity-30" />
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <p className="text-white/60 text-lg font-medium mb-2">No Signal</p>
        <p className="text-white/40 text-sm">Select a channel to start watching</p>
      </div>
    </div>
  );
};

/* ----- VideoPlayer component ----- */
const VideoPlayer: React.FC<VideoPlayerProps> = ({ channel, onChannelChange }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hlsRef = useRef<any | null>(null);
  const shakaRef = useRef<any | null>(null);

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

  const controlsTimeoutRef = useRef<number | null>(null);

  /* Dynamically load Hls.js and Shaka when component mounts */
  useEffect(() => {
    const inserted: HTMLScriptElement[] = [];
    const addScript = (src: string) =>
      new Promise<void>((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) return resolve();
        const s = document.createElement('script');
        s.src = src;
        s.async = true;
        s.onload = () => resolve();
        s.onerror = (e) => reject(e);
        document.head.appendChild(s);
        inserted.push(s);
      });

    let canceled = false;
    (async () => {
      try {
        if (!(window as any).Hls) {
          await addScript('https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.7/hls.min.js');
        }
        if (!(window as any).shaka) {
          await addScript('https://cdnjs.cloudflare.com/ajax/libs/shaka-player/4.7.11/shaka-player.compiled.min.js');
        }
      } catch (err) {
        // non-fatal: playback fallbacks will be used
        console.warn('Error loading playback libs:', err);
      } finally {
        if (canceled) {
          // remove scripts if unmounted quickly
          inserted.forEach(s => s.remove());
        }
      }
    })();

    return () => {
      canceled = true;
    };
  }, []);

  /* Helper: decode base64 if stream_url is stored encoded, otherwise return as-is */
  const getStreamUrl = useCallback((ch: Channel) => {
    try {
      // if the stream_url is base64 encoded, decode, otherwise return raw
      return atob(ch.stream_url);
    } catch {
      return ch.stream_url;
    }
  }, []);

  /* Cleanup function to destroy hls/shaka and clear video */
  const cleanup = useCallback(() => {
    try {
      if (hlsRef.current) {
        try { hlsRef.current.destroy(); } catch {}
        hlsRef.current = null;
      }
    } catch {}
    try {
      if (shakaRef.current) {
        try { shakaRef.current.destroy(); } catch {}
        shakaRef.current = null;
      }
    } catch {}
    if (videoRef.current) {
      try {
        videoRef.current.pause();
        videoRef.current.removeAttribute('src');
        videoRef.current.load();
      } catch {}
    }
    setAvailableQualities(['auto']);
    setError(null);
  }, []);

  /* Core: load channel stream with proxy fallback */
  useEffect(() => {
    if (!channel || !videoRef.current) {
      cleanup();
      return;
    }

    let cancelled = false;
    let triedProxy = false;

    const tryProxy = (url: string) => {
      triedProxy = true;
      return withBackupProxy(url);
    };

    const attachHls = async (url: string) => {
      const HlsLib = (window as any).Hls;
      if (!HlsLib || !HlsLib.isSupported()) {
        // fallback to native
        videoRef.current!.src = url;
        await videoRef.current!.play().catch(() => {});
        return;
      }

      const hls = new HlsLib({
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        maxBufferSize: 60 * 1000 * 1000,
        maxBufferHole: 0.5,
        lowLatencyMode: false,
        startLevel: -1,
      });

      hlsRef.current = hls;
      hls.loadSource(url);
      hls.attachMedia(videoRef.current!);

      hls.on(HlsLib.Events.MANIFEST_PARSED, (_: any, data: any) => {
        const qs = (data?.levels || []).map((l: any) => `${l.height || l.bitrate}p`);
        setAvailableQualities(['auto', ...Array.from(new Set(qs))]);
        videoRef.current!.play().catch(() => {});
      });

      hls.on(HlsLib.Events.ERROR, (_: any, ev: any) => {
        console.warn('HLS error', ev);
        if (!ev || !ev.fatal) return;
        // On fatal error: try proxy once then error out
        if (!triedProxy) {
          const prox = tryProxy(url);
          try {
            hls.destroy();
          } catch {}
          hlsRef.current = null;
          attachHls(prox).catch(() => {
            setError('Stream error occurred (HLS).');
          });
          return;
        }
        setError('Stream error occurred (HLS).');
      });
    };

    const attachMpd = async (url: string) => {
      const shaka = (window as any).shaka;
      if (!shaka) {
        // if shaka not loaded, try using video element directly or proxy fallback
        try {
          videoRef.current!.src = url;
          await videoRef.current!.play().catch(() => {});
          return;
        } catch {
          if (!triedProxy) {
            const prox = tryProxy(url);
            return attachMpd(prox);
          }
          setError('DASH playback not supported');
          return;
        }
      }

      try {
        shaka.polyfill.installAll?.();
        if (!shaka.Player.isBrowserSupported()) {
          setError('DASH not supported in this browser');
          return;
        }
        const player = new shaka.Player(videoRef.current);
        shakaRef.current = player;
        player.addEventListener('error', (e: any) => {
          console.error('Shaka error', e);
          // try proxy once
          if (!triedProxy) {
            const prox = tryProxy(url);
            try { player.destroy(); } catch {}
            shakaRef.current = null;
            return attachMpd(prox);
          }
          setError('Playback error (DASH)');
        });
        await player.load(url);
        const tracks = player.getVariantTracks?.() || [];
        const qs = tracks.map((t: any) => `${t.height || t.bandwidth}p`);
        setAvailableQualities(['auto', ...Array.from(new Set(qs))]);
        await videoRef.current!.play().catch(() => {});
      } catch (err) {
        console.warn('Shaka load error', err);
        if (!triedProxy) {
          const prox = tryProxy(url);
          return attachMpd(prox);
        }
        setError('DASH playback failed');
      }
    };

    const load = async () => {
      setIsLoading(true);
      setError(null);
      cleanup();

      const url = getStreamUrl(channel);
      let finalUrl = url;

      // Some hosts are known to require a proxy — use it early
      if (mustProxy(url)) finalUrl = withBackupProxy(url);

      try {
        if (channel.stream_type === 'm3u8') {
          await attachHls(finalUrl);
        } else if (channel.stream_type === 'mpd') {
          await attachMpd(finalUrl);
        } else {
          // direct file (mp4/ts/direct)
          try {
            videoRef.current!.src = finalUrl;
            await videoRef.current!.play();
          } catch (err) {
            // try proxy
            if (!triedProxy) {
              finalUrl = tryProxy(finalUrl);
              try {
                videoRef.current!.src = finalUrl;
                await videoRef.current!.play();
              } catch {
                setError('Playback failed');
              }
            } else {
              setError('Playback failed');
            }
          }
        }
      } catch (err: any) {
        console.error('Load stream error', err);
        if (!triedProxy) {
          finalUrl = tryProxy(finalUrl);
          // retry once with proxy
          try {
            if (channel.stream_type === 'm3u8') {
              await attachHls(finalUrl);
            } else if (channel.stream_type === 'mpd') {
              await attachMpd(finalUrl);
            } else {
              videoRef.current!.src = finalUrl;
              await videoRef.current!.play();
            }
          } catch (e) {
            setError((e as any)?.message || 'Failed to load stream (proxy attempt failed)');
          }
        } else {
          setError(err.message || 'Failed to load stream');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    load();

    return () => {
      cancelled = true;
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, cleanup, getStreamUrl]);

  /* Video native event handlers */
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const onTime = () => setCurrentTime(v.currentTime);
    const onDuration = () => setDuration(v.duration || 0);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onWaiting = () => setIsLoading(true);
    const onPlaying = () => setIsLoading(false);

    v.addEventListener('timeupdate', onTime);
    v.addEventListener('durationchange', onDuration);
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('waiting', onWaiting);
    v.addEventListener('playing', onPlaying);

    return () => {
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('durationchange', onDuration);
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('waiting', onWaiting);
      v.removeEventListener('playing', onPlaying);
    };
  }, []);

  /* Controls visibility */
  const showControlsTemporarily = useCallback(() => {
    setShowControls(true);
    if (controlsTimeoutRef.current) window.clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = window.setTimeout(() => {
      setShowControls(false);
    }, 3000) as unknown as number;
  }, []);

  /* Fullscreen handler */
  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  /* Playback control functions (kept UI behavior) */
  const togglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) videoRef.current.pause();
    else videoRef.current.play().catch(() => {});
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    videoRef.current.muted = !isMuted;
    setIsMuted(!isMuted);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    if (videoRef.current) {
      videoRef.current.volume = val;
      setIsMuted(val === 0);
    }
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) containerRef.current.requestFullscreen().catch(() => {});
    else document.exitFullscreen().catch(() => {});
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const t = parseFloat(e.target.value);
    if (videoRef.current) {
      videoRef.current.currentTime = t;
      setCurrentTime(t);
    }
  };

  const formatTime = (time: number) => {
    if (!isFinite(time) || time <= 0) return '00:00';
    const m = Math.floor(time / 60);
    const s = Math.floor(time % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const handleQualityChange = (q: string) => {
    setQuality(q);
    setShowSettings(false);
    // Basic HLS / Shaka quality switching (if supported)
    if (hlsRef.current) {
      if (q === 'auto') hlsRef.current.currentLevel = -1;
      else {
        const level = hlsRef.current.levels?.findIndex((l: any) => `${l.height || l.bitrate}p` === q);
        if (level !== -1) hlsRef.current.currentLevel = level;
      }
    }
    if (shakaRef.current) {
      const tracks = shakaRef.current.getVariantTracks?.() || [];
      if (q === 'auto') shakaRef.current.configure({ abr: { enabled: true } });
      else {
        const track = tracks.find((t: any) => `${t.height || t.bandwidth}p` === q);
        if (track) {
          shakaRef.current.configure({ abr: { enabled: false } });
          shakaRef.current.selectVariantTrack(track, true);
        }
      }
    }
  };

  // YouTube short-circuit
  if (channel?.stream_type === 'youtube') {
    const videoId = (channel.stream_url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([^"&?/ ]{11})/) || [])[1];
    return (
      <div ref={containerRef} className="relative w-full aspect-video bg-black rounded-lg overflow-hidden" style={{ boxShadow: '0 0 30px rgba(0,0,0,0.8)', border: '4px solid #5d4037' }}>
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
      onMouseLeave={() => setShowControls(false)}
      style={{
        boxShadow: '0 0 30px rgba(0,0,0,0.8), inset 0 0 60px rgba(139, 69, 19, 0.3)',
        border: '4px solid #5d4037'
      }}
    >
      <video ref={videoRef} className="w-full h-full object-contain" playsInline onClick={togglePlay} />

      {!channel && <StaticNoise />}

      {isLoading && channel && <LoadingSpinner />}

      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-20">
          <div className="text-center">
            <p className="text-red-400 text-lg font-medium mb-2">Error</p>
            <p className="text-white/60 text-sm">{error}</p>
          </div>
        </div>
      )}

      {/* Controls Overlay (keeps your original controls) */}
      {channel && (
        <div className={`absolute inset-x-0 bottom-0 transition-all duration-300 ${showControls ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`} style={{ background: 'linear-gradient(to top, rgba(62, 39, 35, 0.95), rgba(62, 39, 35, 0.7), transparent)', borderTop: '2px solid #8d6e63' }}>
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
                  background: `linear-gradient(to right, #fbbf24 0%, #fbbf24 ${(currentTime / (duration || 1)) * 100}%, #5d4037 ${(currentTime / (duration || 1)) * 100}%, #5d4037 100%)`
                }}
              />
            </div>
          )}

          <div className="flex items-center justify-between px-4 py-2">
            <div className="flex items-center gap-2 md:gap-4">
              {onChannelChange && (
                <button onClick={() => onChannelChange('prev')} className="p-2 text-amber-200 hover:text-amber-400 transition-colors"><SkipBack className="w-5 h-5" /></button>
              )}

              <button onClick={togglePlay} className="p-2 bg-amber-600/50 rounded-full text-amber-100 hover:bg-amber-600 transition-colors">
                {isPlaying ? <Pause className="w-5 h-5 md:w-6 md:h-6" /> : <Play className="w-5 h-5 md:w-6 md:h-6" />}
              </button>

              {onChannelChange && (
                <button onClick={() => onChannelChange('next')} className="p-2 text-amber-200 hover:text-amber-400 transition-colors"><SkipForward className="w-5 h-5" /></button>
              )}

              <div className="flex items-center gap-2">
                <button onClick={toggleMute} className="p-2 text-amber-200 hover:text-amber-400 transition-colors">
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

              <span className="text-amber-200 text-xs md:text-sm font-mono hidden sm:block">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative">
                <button onClick={() => setShowSettings(!showSettings)} className="p-2 text-amber-200 hover:text-amber-400 transition-colors">
                  <Settings className="w-5 h-5" />
                </button>
                {showSettings && (
                  <div className="absolute bottom-full right-0 mb-2 bg-amber-900/95 rounded-lg shadow-xl border border-amber-700 overflow-hidden min-w-[120px]">
                    <div className="px-3 py-2 border-b border-amber-700 text-amber-200 text-xs font-medium">Quality</div>
                    {availableQualities.map(q => (
                      <button key={q} onClick={() => handleQualityChange(q)} className={`w-full px-3 py-2 text-left text-sm ${quality === q ? 'bg-amber-600 text-white' : 'text-amber-200 hover:bg-amber-800'}`}>{q}</button>
                    ))}
                  </div>
                )}
              </div>

              <button onClick={toggleFullscreen} className="p-2 text-amber-200 hover:text-amber-400 transition-colors">
                {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
              </button>
            </div>
          </div>
        </div>
      )}

      {channel && showControls && (
        <div className="absolute top-4 left-4 bg-amber-900/80 px-3 py-1 rounded-lg">
          <p className="text-amber-100 text-sm font-medium">{channel.name}</p>
        </div>
      )}
    </div>
  );
};

/* Add minimal window types for runtime checks */
declare global {
  interface Window {
    Hls?: any;
    shaka?: any;
  }
}

export default VideoPlayer;
