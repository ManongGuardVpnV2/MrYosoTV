import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Play, Pause, Volume2, VolumeX, Maximize, Minimize, Settings, SkipBack, SkipForward } from 'lucide-react';
import { Channel } from '@/types';

/**
 * VideoPlayer.tsx
 * - Keeps your UI/controls intact
 * - Replaces and hardens playback logic: JW, HLS, Shaka (MPD/Widevine), native
 * - Adds manifest polling, backup-proxy fallback, resume persistence, safe cleanup
 *
 * New optional prop:
 * - refreshStream?: (originalUrl: string) => Promise<{ url: string, expiresAt?: number } | null>
 *   Use this to plug your Supabase function that returns a renewed/signed streaming URL.
 */

interface VideoPlayerProps {
  channel: Channel | null;
  onChannelChange?: (direction: 'prev' | 'next') => void;
  // optional: when a signed/expiring stream needs refresh; returns new URL + optional expiry
  refreshStream?: (origUrl: string) => Promise<{ url: string; expiresAt?: number } | null>;
}

/* ---------------------------
   UI Components (left as-is)
   --------------------------- */

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

const StaticNoise: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId = 0;
    const drawNoise = () => {
      const w = canvas.width;
      const h = canvas.height;
      const imageData = ctx.createImageData(w, h);
      const data = imageData.data;
      for (let i = 0; i < data.length; i += 4) {
        const v = Math.random() * 255;
        data[i] = v;
        data[i + 1] = v;
        data[i + 2] = v;
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
      <canvas ref={canvasRef} width={300} height={200} className="w-full h-full object-cover opacity-30" />
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

const withBackupProxy = (url: string) => url.startsWith(BACKUP_PROXY) ? url : `${BACKUP_PROXY}/${url}`;
const mustProxy = (url: string) => {
  try { return FORCE_PROXY_HOSTS.includes(new URL(url).host); } catch { return false; }
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

const loadScript = (src: string) =>
  new Promise<void>((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = (e) => reject(e);
    document.head.appendChild(s);
  });

/* quick LL-HLS probe */
async function detectLlHls(url: string) {
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return false;
    const txt = await r.text();
    return txt.includes('#EXT-X-PART') || txt.includes('#EXT-X-SERVER-CONTROL');
  } catch { return false; }
}

/* ---------------------------
   Component
   --------------------------- */

const VideoPlayer: React.FC<VideoPlayerProps> = ({ channel, onChannelChange, refreshStream }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const shakaPlayerRef = useRef<any>(null);
  const hlsRef = useRef<any>(null);

  // JW refs
  const jwRef = useRef<any>(null);
  const jwContainerRef = useRef<HTMLDivElement | null>(null);
  const jwFailedRef = useRef<boolean>(false);

  // stream expiry + cache (for refreshStream)
  const streamExpiryRef = useRef<number | null>(null);
  const currentStreamRef = useRef<string | null>(null);

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
  const signedRenewTimerRef = useRef<number | null>(null);
  const manifestPollRef = useRef<number | null>(null);

  /* helper: try to refresh signed stream via optional prop */
  const maybeRefreshSignedStream = useCallback(async (originalUrl: string) => {
    try {
      if (!refreshStream) return originalUrl;
      const result = await refreshStream(originalUrl);
      if (result?.url) {
        if (result.expiresAt) streamExpiryRef.current = result.expiresAt;
        return result.url;
      }
    } catch (e) {
      console.warn('refreshStream failed', e);
    }
    return originalUrl;
  }, [refreshStream]);

  /* cleanup */
  const cleanup = useCallback(() => {
    try { shakaPlayerRef.current?.destroy(); } catch {}
    shakaPlayerRef.current = null;
    try { hlsRef.current?.destroy(); } catch {}
    hlsRef.current = null;

    try {
      if (jwRef.current?.remove) jwRef.current.remove();
    } catch {}
    jwRef.current = null;
    jwFailedRef.current = false;

    try {
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.removeAttribute('src');
        videoRef.current.load();
      }
    } catch {}

    // clear polls/timers
    try { if (manifestPollRef.current) { clearInterval(manifestPollRef.current); manifestPollRef.current = null; } } catch {}
    try { if (signedRenewTimerRef.current) { clearTimeout(signedRenewTimerRef.current); signedRenewTimerRef.current = null; } } catch {}

    setError(null);
    setAvailableQualities(['auto']);
  }, []);

  /* JW loader */
  const loadJwScript = useCallback(() => loadScript('https://ssl.p.jwpcdn.com/player/v/8.38.10/jwplayer.js'), []);

  const tryLoadJW = useCallback(async (streamUrl: string, ch: Channel) => {
    if (jwFailedRef.current) return false;
    const tryFor = ['m3u8', 'mp4', 'ts', 'direct'];
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
      const finalUrl = mustProxy(streamUrl) ? withBackupProxy(streamUrl) : streamUrl;

      // try usual setup
      try {
        jwRef.current = (window as any).jwplayer(jwContainerRef.current).setup({
          file: finalUrl,
          autostart: true,
          width: '100%',
          height: '100%',
          mute: false,
          preload: 'auto',
          stretching: 'uniform',
        });
      } catch (e) {
        // fallback invocation style
        try {
          jwRef.current = (window as any).jwplayer(jwContainerRef.current);
          jwRef.current.setup && jwRef.current.setup({ file: finalUrl, autostart: true });
        } catch (err) {
          jwFailedRef.current = true;
          jwContainerRef.current.style.display = 'none';
          return false;
        }
      }

      jwRef.current.on?.('ready', () => {
        try {
          const resume = loadResumePosition(ch.id);
          if (resume != null && jwRef.current?.seek) {
            try { jwRef.current.seek(resume); } catch {}
          }
        } catch {}
        setIsLoading(false);
        setIsPlaying(true);
        // make sure native is unloaded
        try {
          if (videoRef.current) { videoRef.current.pause(); videoRef.current.removeAttribute('src'); videoRef.current.load(); }
        } catch {}
      });

      jwRef.current.on?.('play', () => setIsPlaying(true));
      jwRef.current.on?.('pause', () => setIsPlaying(false));
      jwRef.current.on?.('time', (t: any) => {
        try { if (channel?.id) saveResumePosition(channel.id, Number(t?.position ?? 0)); } catch {}
      });

      jwRef.current.on?.('error', (err: any) => {
        console.warn('JW error', err);
        jwFailedRef.current = true;
        try { jwRef.current.remove(); } catch {}
        jwRef.current = null;
        if (jwContainerRef.current) jwContainerRef.current.style.display = 'none';
      });

      // optional: manifest poll for live masters to refresh JW source
      if (/\.m3u8/i.test(streamUrl)) {
        try {
          const poll = window.setInterval(async () => {
            try {
              const r = await fetch(streamUrl, { cache: 'no-store' });
              if (!r.ok) return;
              const t = await r.text();
              const m = t.match(/https?:\/\/[^'"\s]+\.m3u8[^'"\s]*/i);
              if (m?.[0]) {
                const candidate = mustProxy(m[0]) ? withBackupProxy(m[0]) : m[0];
                if (jwRef.current && typeof jwRef.current.load === 'function') {
                  try { jwRef.current.load([{ file: candidate }]); } catch {}
                }
              }
            } catch {}
          }, 8000);
          manifestPollRef.current = poll as unknown as number;
        } catch {}
      }

      return true;
    } catch (err) {
      jwFailedRef.current = true;
      try { if (jwContainerRef.current) jwContainerRef.current.style.display = 'none'; } catch {}
      return false;
    }
  }, [loadJwScript, channel]);

  /* Shaka (MPD) loader */
  const loadMPD = useCallback(async (video: HTMLVideoElement, ch: Channel) => {
    if (!(window as any).shaka) {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/shaka-player/4.7.11/shaka-player.compiled.min.js');
    }
    const shakaLib = (window as any).shaka;
    shakaLib.polyfill.installAll();
    if (!shakaLib.Player.isBrowserSupported()) throw new Error('Browser not supported for DASH');
    const player = new shakaLib.Player(video);
    shakaPlayerRef.current = player;

    player.configure({
      streaming: { bufferingGoal: 10, rebufferingGoal: 2, bufferBehind: 30 },
      abr: { enabled: true, defaultBandwidthEstimate: 5_000_000 },
    });

    if ((ch as any).clearkey_kid && (ch as any).clearkey_key) {
      player.configure({
        drm: { clearKeys: { [(ch as any).clearkey_kid]: (ch as any).clearkey_key } }
      });
    }

    player.addEventListener('error', (e: any) => {
      console.error('Shaka error', e?.detail ?? e);
      setError('Playback error occurred');
    });

    player.addEventListener('adaptation', () => {
      try {
        const tracks = player.getVariantTracks();
        const quals = tracks.map((t: any) => `${t.height}p`).filter((v: string, i: number, a: string[]) => a.indexOf(v) === i);
        setAvailableQualities(['auto', ...quals]);
      } catch {}
    });

    try { await player.load(ch.stream_url); }
    catch {
      try { await player.load(withBackupProxy(ch.stream_url)); }
      catch (err) { throw err; }
    }

    const resume = loadResumePosition(ch.id);
    if (resume != null) video.currentTime = resume;
    await video.play();
  }, []);

  /* HLS loader */
  const loadHLS = useCallback(async (video: HTMLVideoElement, ch: Channel) => {
    const streamUrl = ch.stream_url;
    const resume = loadResumePosition(ch.id);

    // prefer native if supported and not forced proxy
    if (!mustProxy(streamUrl) && video.canPlayType('application/vnd.apple.mpegurl')) {
      try {
        video.src = streamUrl;
        if (resume != null) video.currentTime = resume;
        await video.play();
        return;
      } catch {}
    }

    // load lib if needed
    if (!(window as any).Hls) {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.7/hls.min.js');
    }
    const HlsLib = (window as any).Hls;
    if (!HlsLib || !HlsLib.isSupported()) {
      // fallback to native src
      video.src = streamUrl;
      if (resume != null) video.currentTime = resume;
      await video.play();
      return;
    }

    const lowEnd = (navigator as any).hardwareConcurrency <= 4 || (navigator as any).deviceMemory <= 2;
    const supportsLL = await detectLlHls(streamUrl);
    const hls = new HlsLib({
      enableWorker: !lowEnd,
      lowLatencyMode: supportsLL && !lowEnd,
      startLevel: -1,
      maxBufferLength: lowEnd ? 40 : 30,
      maxBufferSize: lowEnd ? 60 * 1e6 : 90 * 1e6,
      backBufferLength: 30,
      maxBufferHole: 0.5,
    });
    hlsRef.current = hls;

    let triedBackup = false;

    hls.loadSource(streamUrl);
    hls.attachMedia(video);

    hls.on(HlsLib.Events.MANIFEST_PARSED, (_: any, data: any) => {
      try {
        const quals = data.levels.map((l: any) => `${l.height}p`);
        setAvailableQualities(['auto', ...quals]);
      } catch {}
      if (resume != null) { try { video.currentTime = resume; } catch {} }
      video.play().catch(() => {});
    });

    hls.on(HlsLib.Events.ERROR, (_: any, data: any) => {
      if (!data) return;
      // non-fatal -> recover
      if (!data.fatal) {
        try { hls.recoverMediaError(); } catch {}
        return;
      }
      // fatal -> try backup proxy once
      if (!triedBackup) {
        triedBackup = true;
        try { hls.destroy(); } catch {}
        const backup = withBackupProxy(streamUrl);
        const h2 = new HlsLib();
        hlsRef.current = h2;
        try { h2.loadSource(backup); h2.attachMedia(video); } catch {}
        return;
      }
      setError('Stream error occurred');
    });
  }, []);

  /* Widevine (shaka + license server) */
  const loadWidevine = useCallback(async (video: HTMLVideoElement, ch: Channel) => {
    if (!(window as any).shaka) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/shaka-player/4.7.11/shaka-player.compiled.min.js');
    const shakaLib = (window as any).shaka;
    shakaLib.polyfill.installAll();
    if (!shakaLib.Player.isBrowserSupported()) throw new Error('Browser not supported for Widevine');
    const player = new shakaLib.Player(video);
    shakaPlayerRef.current = player;

    if (ch.license_url) {
      player.configure({ drm: { servers: { 'com.widevine.alpha': ch.license_url } } });
    }

    await player.load(ch.stream_url);
    await video.play();
  }, []);

  /* ---------------------------
     Main channel loader
     --------------------------- */

  useEffect(() => {
    if (!channel || !videoRef.current) {
      cleanup();
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);
    setAvailableQualities(['auto']);
    currentStreamRef.current = channel.stream_url;

    (async () => {
      cleanup();

      const video = videoRef.current!;
      let streamUrl = channel.stream_url;

      // allow a refreshStream hook to supply a signed URL
      try {
        const maybe = await maybeRefreshSignedStream(streamUrl);
        if (maybe) streamUrl = maybe;
        currentStreamRef.current = streamUrl;
      } catch {}

      // JW first for certain stream types
      try {
        const jwUsed = await tryLoadJW(streamUrl, channel);
        if (jwUsed) {
          setIsLoading(false);
          return;
        }
      } catch (e) {
        console.warn('JW failed, falling back', e);
      }

      try {
        switch (channel.stream_type) {
          case 'mpd':
            await loadMPD(video, { ...channel, stream_url: streamUrl } as Channel);
            break;
          case 'm3u8':
            await loadHLS(video, { ...channel, stream_url: streamUrl } as Channel);
            break;
          case 'widevine':
            await loadWidevine(video, { ...channel, stream_url: streamUrl } as Channel);
            break;
          default:
            // mp4/ts/direct fallback
            video.src = streamUrl;
            try {
              const resume = loadResumePosition(channel.id);
              if (resume != null) video.currentTime = resume;
            } catch {}
            await video.play();
            break;
        }
        setIsPlaying(true);
        setIsLoading(false);
      } catch (err: any) {
        console.error('Error loading channel:', err);
        // Attempt backup proxy for direct/native fallback once
        try {
          if (streamUrl && !streamUrl.startsWith(BACKUP_PROXY)) {
            const proxyUrl = withBackupProxy(streamUrl);
            if (channel.stream_type === 'm3u8') {
              try { await loadHLS(video, { ...channel, stream_url: proxyUrl } as Channel); setIsLoading(false); return; } catch {}
            } else {
              try { video.src = proxyUrl; await video.play(); setIsLoading(false); return; } catch {}
            }
          }
        } catch {}
        setError(err?.message || 'Failed to load channel');
        setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, cleanup, tryLoadJW, loadHLS, loadMPD, loadWidevine, maybeRefreshSignedStream]);

  /* ---------------------------
     Signed-stream renewal (if streamExpiryRef set and refreshStream provided)
     --------------------------- */
  useEffect(() => {
    if (!channel || !refreshStream) return;
    let mounted = true;

    const scheduleRenew = () => {
      try { if (signedRenewTimerRef.current) { clearTimeout(signedRenewTimerRef.current); signedRenewTimerRef.current = null; } } catch {}
      const expiresAt = streamExpiryRef.current;
      const lead = 30_000;
      const fallback = 4 * 60 * 1000;

      const doRenew = async () => {
        if (!mounted) return;
        try {
          const newData = await refreshStream(currentStreamRef.current ?? channel.stream_url);
          if (newData?.url) {
            // swap into player depending on active engine
            currentStreamRef.current = newData.url;
            if (newData.expiresAt) streamExpiryRef.current = newData.expiresAt;
            // try JW swap
            try {
              if (jwRef.current && typeof jwRef.current.load === 'function') {
                jwRef.current.load([{ file: newData.url }]);
                return;
              }
            } catch {}
            // try HLS swap
            try {
              const HlsLib = (window as any).Hls;
              if (hlsRef.current && HlsLib && typeof hlsRef.current.loadSource === 'function') {
                try { hlsRef.current.stopLoad?.(); } catch {}
                hlsRef.current.loadSource(newData.url);
                hlsRef.current.startLoad?.();
                return;
              }
            } catch {}
            // fallback native
            try {
              const v = videoRef.current;
              if (v) {
                const wasPlaying = !v.paused && !v.ended;
                v.src = newData.url;
                try { await v.play(); if (!wasPlaying) v.pause(); } catch {}
              }
            } catch {}
          }
        } catch (err) { console.warn('renew failed', err); }
      };

      if (expiresAt && (expiresAt - Date.now()) > 1000) {
        const delay = Math.max(0, (expiresAt - Date.now()) - lead);
        signedRenewTimerRef.current = window.setTimeout(async () => { await doRenew(); scheduleRenew(); }, delay) as unknown as number;
      } else {
        signedRenewTimerRef.current = window.setTimeout(async () => { await doRenew(); scheduleRenew(); }, fallback) as unknown as number;
      }
    };

    scheduleRenew();

    return () => {
      mounted = false;
      try { if (signedRenewTimerRef.current) { clearTimeout(signedRenewTimerRef.current); signedRenewTimerRef.current = null; } } catch {}
    };
  }, [channel, refreshStream]);

  /* native video events & resume saving (throttled) */
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const onTime = () => {
      setCurrentTime(v.currentTime);
      try {
        if (channel?.id) saveResumePosition(channel.id, v.currentTime);
      } catch {}
    };
    const onDuration = () => setDuration(v.duration || 0);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onWaiting = () => setIsLoading(true);
    const onPlaying = () => setIsLoading(false);
    const onError = () => setError('Playback error');

    v.addEventListener('timeupdate', onTime);
    v.addEventListener('durationchange', onDuration);
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('waiting', onWaiting);
    v.addEventListener('playing', onPlaying);
    v.addEventListener('error', onError);

    return () => {
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('durationchange', onDuration);
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('waiting', onWaiting);
      v.removeEventListener('playing', onPlaying);
      v.removeEventListener('error', onError);
    };
  }, [channel]);

  /* Controls visibility */
  const showControlsTemporarily = useCallback(() => {
    setShowControls(true);
    try { if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current); } catch {}
    controlsTimeoutRef.current = window.setTimeout(() => {
      if (isPlaying) setShowControls(false);
    }, 3000) as unknown as number;
  }, [isPlaying]);

  /* Fullscreen handling */
  useEffect(() => {
    const onF = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onF);
    return () => document.removeEventListener('fullscreenchange', onF);
  }, []);

  /* Controls / APIs */
  const togglePlay = useCallback(() => {
    if (jwRef.current && jwRef.current.getState) {
      try {
        const st = jwRef.current.getState();
        if (st === 'playing') jwRef.current.pause();
        else jwRef.current.play();
      } catch {}
      return;
    }
    if (!videoRef.current) return;
    if (isPlaying) videoRef.current.pause();
    else videoRef.current.play().catch(() => {});
  }, [isPlaying]);

  const toggleMute = useCallback(() => {
    if (jwRef.current && typeof jwRef.current.setVolume === 'function') {
      try {
        if (isMuted) jwRef.current.setVolume(100);
        else jwRef.current.setVolume(0);
      } catch {}
      setIsMuted(!isMuted);
      return;
    }
    if (!videoRef.current) return;
    videoRef.current.muted = !isMuted;
    setIsMuted(!isMuted);
  }, [isMuted]);

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = Number(e.target.value);
    setVolume(newVolume);
    if (jwRef.current && typeof jwRef.current.setVolume === 'function') {
      try { jwRef.current.setVolume(Math.round(newVolume * 100)); } catch {}
      setIsMuted(newVolume === 0);
      return;
    }
    if (videoRef.current) {
      videoRef.current.volume = newVolume;
      setIsMuted(newVolume === 0);
    }
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }, []);

  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const t = Number(e.target.value);
    if (jwRef.current && typeof jwRef.current.seek === 'function') {
      try { jwRef.current.seek(t); setCurrentTime(t); } catch {}
      return;
    }
    if (videoRef.current) {
      videoRef.current.currentTime = t;
      setCurrentTime(t);
    }
  }, []);

  const formatTime = (time: number) => {
    if (!isFinite(time)) return '00:00';
    const m = Math.floor(time / 60);
    const s = Math.floor(time % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleQualityChange = (q: string) => {
    setQuality(q);
    setShowSettings(false);

    // HLS levels
    try {
      if (hlsRef.current && q !== 'auto') {
        const idx = hlsRef.current.levels.findIndex((l: any) => `${l.height}p` === q);
        if (idx !== -1) hlsRef.current.currentLevel = idx;
      } else if (hlsRef.current) {
        hlsRef.current.currentLevel = -1;
      }
    } catch {}

    // Shaka tracks
    try {
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
    } catch {}
  };

  // YouTube embed handling (unchanged)
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

  /* ---------------------------
     Render UI (kept same with small performance/UX improvements)
     --------------------------- */

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
                onChange={(e) => handleSeek(e as any)}
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
                        className={`w-full px-3 py-2 text-left text-sm transition-colors ${quality === q ? 'bg-amber-600 text-white' : 'text-amber-200 hover:bg-amber-800'}`}
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

/* global types so TS won't complain when we refer to window.Hls, window.shaka, window.jwplayer */
declare global {
  interface Window {
    shaka: any;
    Hls: any;
    jwplayer?: any;
  }
}

export default VideoPlayer;
