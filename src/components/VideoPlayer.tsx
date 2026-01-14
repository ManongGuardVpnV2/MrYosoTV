// VideoPlayer.tsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Pause, Volume2, VolumeX, Maximize, Minimize, Settings, SkipBack, SkipForward } from 'lucide-react';
import { Channel } from '@/types';

/**
 * HLS-only player (Shaka for DASH/MPD), no JW.
 * - Auto reconnect when TS/fragments stall
 * - Segment watchdog + retry/backoff + backup-proxy fallback
 * - Resume position saved in localStorage
 *
 * Props:
 *  - channel: Channel | null
 *  - onChannelChange?: (direction) => void
 *  - refreshStream?: (url) => Promise<{ url:string, expiresAt?:number } | null>
 */

interface VideoPlayerProps {
  channel: Channel | null;
  onChannelChange?: (direction: 'prev' | 'next') => void;
  refreshStream?: (origUrl: string) => Promise<{ url: string; expiresAt?: number } | null>;
}

/* --------------------------- UI pieces (kept similar to yours) --------------------------- */

const LoadingSpinner: React.FC<{ size?: 'sm' | 'lg' }> = ({ size = 'sm' }) => (
  <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 z-20">
    <div className={`flex gap-1 mb-4 ${size === 'lg' ? 'text-4xl' : 'text-2xl'}`}>
      {'LOADING'.split('').map((letter, i) => (
        <span
          key={i}
          className="font-bold text-amber-400 animate-bounce"
          style={{
            animationDelay: `${i * 0.08}s`,
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
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    const draw = () => {
      const w = canvas.width = canvas.offsetWidth || 300;
      const h = canvas.height = canvas.offsetHeight || 150;
      const id = ctx.createImageData(w, h);
      const d = id.data;
      for (let i = 0; i < d.length; i += 4) {
        const v = (Math.random() * 255) | 0;
        d[i] = d[i + 1] = d[i + 2] = v;
        d[i + 3] = 255;
      }
      ctx.putImageData(id, 0, 0);
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

/* --------------------------- playback helpers & config --------------------------- */

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
    localStorage.setItem(`${RESUME_KEY_PREFIX}${channelId}`, JSON.stringify({ pos: position, ts: Date.now() }));
  } catch {}
}
function loadResumePosition(channelId: string): number | null {
  try {
    const raw = localStorage.getItem(`${RESUME_KEY_PREFIX}${channelId}`);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p || typeof p.pos !== 'number' || typeof p.ts !== 'number') return null;
    if (Date.now() - p.ts > RESUME_TTL) { localStorage.removeItem(`${RESUME_KEY_PREFIX}${channelId}`); return null; }
    return p.pos;
  } catch { return null; }
}

const loadScript = (src: string) => new Promise<void>((resolve, reject) => {
  if (document.querySelector(`script[src="${src}"]`)) return resolve();
  const s = document.createElement('script');
  s.src = src;
  s.async = true;
  s.onload = () => resolve();
  s.onerror = (e) => reject(e);
  document.head.appendChild(s);
});

/* quick probe for LL-HLS (optional) */
async function detectLlHls(url: string) {
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return false;
    const txt = await r.text();
    return txt.includes('#EXT-X-PART') || txt.includes('#EXT-X-SERVER-CONTROL');
  } catch { return false; }
}

/* --------------------------- Component --------------------------- */

const VideoPlayer: React.FC<VideoPlayerProps> = ({ channel, onChannelChange, refreshStream }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const hlsRef = useRef<any | null>(null);
  const shakaRef = useRef<any | null>(null);

  // state
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
  const [availableQualities, setAvailableQualities] = useState<string[]>(['auto']);

  // recon/watchdog state (refs)
  const lastFragTimeRef = useRef<number>(Date.now());
  const fragWatchdogTimerRef = useRef<number | null>(null);
  const reconnectAttemptsRef = useRef<number>(0);
  const signedExpiryRef = useRef<number | null>(null);
  const currentStreamRef = useRef<string | null>(null);
  const manifestPollRef = useRef<number | null>(null);

  const controlsTimeoutRef = useRef<number | null>(null);

  // utility to create Hls instance
  const createHls = useCallback((streamUrl: string) => {
    const HlsLib = (window as any).Hls;
    if (!HlsLib) return null;

    const lowEnd = (navigator as any).hardwareConcurrency <= 4 || (navigator as any).deviceMemory <= 2;

    const hls = new HlsLib({
      enableWorker: false, // worker sometimes problematic with some IPTV servers
      lowLatencyMode: false,
      startLevel: -1,
      maxBufferLength: lowEnd ? 40 : 30,
      maxMaxBufferLength: lowEnd ? 60 : 90,
      backBufferLength: 30,
      maxBufferHole: 0.5,
      fragLoadingTimeOut: 20000,
      fragLoadingMaxRetry: 6,
      manifestLoadingMaxRetry: 4,
      levelLoadingMaxRetry: 4
    });

    return hls;
  }, []);

  /* ------------------- HLS loader + watchdog + reconnect ------------------- */

  const startFragWatchdog = useCallback((hls: any, streamUrl: string, ch: Channel) => {
    // clear old
    try { if (fragWatchdogTimerRef.current) { clearInterval(fragWatchdogTimerRef.current); fragWatchdogTimerRef.current = null; } } catch {}
    lastFragTimeRef.current = Date.now();

    const checkInterval = 5000; // check every 5s
    const stallThreshold = 12_000; // if no fragments for 12s => consider stalled

    fragWatchdogTimerRef.current = window.setInterval(async () => {
      try {
        const now = Date.now();
        const last = lastFragTimeRef.current;
        const v = videoRef.current;
        // only check if playing / loading live
        if (!v) return;
        const isStalled = (now - last) > stallThreshold && (!v.paused && !v.ended);
        if (!isStalled) return;

        console.warn('Fragment watchdog detected stall — attempting recovery', { streamUrl, lastDiff: now - last });

        // try lightweight recover first
        try { hls.recoverMediaError?.(); } catch (e) { console.warn('hls.recoverMediaError failed', e); }

        // if too many attempts -> full reload (with backoff + backup proxy)
        reconnectAttemptsRef.current = (reconnectAttemptsRef.current || 0) + 1;
        const attempt = reconnectAttemptsRef.current;
        const backoffMs = Math.min(30_000, 2000 * attempt);

        if (attempt <= 2) {
          // give it some time
          await new Promise(r => setTimeout(r, backoffMs));
          try { hls.startLoad?.(); } catch { try { hls.loadSource(streamUrl); hls.attachMedia(videoRef.current); } catch {} }
          return;
        }

        // attempt full reload with backup proxy
        try {
          const backup = withBackupProxy(streamUrl);
          try { hls.destroy(); } catch {}
          hlsRef.current = createHls(streamUrl);
          const h2 = hlsRef.current;
          h2.loadSource(backup);
          h2.attachMedia(videoRef.current);
          // reset attempts on success
          reconnectAttemptsRef.current = 0;
        } catch (e) {
          console.warn('Full HLS reload failed', e);
        }
      } catch (watchErr) {
        console.warn('watchdog error', watchErr);
      }
    }, checkInterval) as unknown as number;
  }, [createHls]);

  const stopFragWatchdog = useCallback(() => {
    try { if (fragWatchdogTimerRef.current) { clearInterval(fragWatchdogTimerRef.current); fragWatchdogTimerRef.current = null; } } catch {}
    reconnectAttemptsRef.current = 0;
  }, []);

  const loadHLS = useCallback(async (video: HTMLVideoElement, ch: Channel, preferProxy = false) => {
    // ensure Hls lib
    if (!(window as any).Hls) {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.7/hls.min.js');
    }
    const HlsLib = (window as any).Hls;
    if (!HlsLib || !HlsLib.isSupported()) {
      // fallback to native
      try {
        video.src = ch.stream_url;
        const resume = loadResumePosition(ch.id);
        if (resume != null) video.currentTime = resume;
        await video.play().catch(() => {});
        return;
      } catch (e) {
        throw e;
      }
    }

    // create hls
    const hls = createHls(ch.stream_url);
    if (!hls) throw new Error('Hls not available');
    hlsRef.current = hls;
    let triedBackup = false;
    let streamUrl = ch.stream_url;

    // if mustProxy -> force backup proxy used URL
    if (preferProxy || mustProxy(streamUrl)) {
      streamUrl = withBackupProxy(streamUrl);
    }

    // attach events
    hls.on(HlsLib.Events.MANIFEST_PARSED, (_: any, data: any) => {
      try {
        const quals = (data?.levels || []).map((l: any) => (l.height ? `${l.height}p` : `${Math.round((l?.bitrate || 0) / 1000)}kbps`));
        setAvailableQualities(['auto', ...Array.from(new Set(quals))]);
      } catch {}
      // attempt to set resumePosition if present
      try {
        const resume = loadResumePosition(ch.id);
        if (resume != null) {
          try { video.currentTime = resume; } catch {}
        }
      } catch {}
      video.play().catch(() => {});
    });

    // update lastFragTime on fragment events
    const markFragment = () => { lastFragTimeRef.current = Date.now(); reconnectAttemptsRef.current = 0; };
    hls.on(HlsLib.Events.FRAG_LOADED, markFragment);
    hls.on(HlsLib.Events.FRAG_BUFFERED, markFragment);
    hls.on(HlsLib.Events.FRAG_PARSING_METADATA, markFragment);
    hls.on(HlsLib.Events.FRAG_PARSED, markFragment);

    hls.on(HlsLib.Events.ERROR, async (_: any, data: any) => {
      console.warn('HLS error event', data);
      // recover non-fatal
      if (!data) return;
      if (!data.fatal) {
        try { hls.recoverMediaError?.(); } catch {}
        return;
      }

      // fatal errors: try a controlled recovery flow
      // 1) try recoverMediaError()
      // 2) if that fails, try reload source
      // 3) if that fails, try backup proxy
      try {
        try { hls.recoverMediaError?.(); } catch (e) { /* ignore */ }

        // if network error or other fatal, reload or use backup on second attempt
        reconnectAttemptsRef.current = (reconnectAttemptsRef.current || 0) + 1;
        const attempt = reconnectAttemptsRef.current;
        if (attempt <= 2) {
          try {
            hls.startLoad?.();
            return;
          } catch {}
        }

        if (!triedBackup) {
          triedBackup = true;
          try {
            hls.destroy();
          } catch {}
          const backup = withBackupProxy(ch.stream_url);
          hlsRef.current = createHls(backup);
          hlsRef.current.loadSource(backup);
          hlsRef.current.attachMedia(video);
          startFragWatchdog(hlsRef.current, backup, ch);
          return;
        }

        // if still fatal after backup, throw to upper handler
        setError('Stream error occurred (HLS fatal)');
      } catch (err) {
        console.error('HLS fatal handling error', err);
        setError('Stream error occurred');
      }
    });

    // finally load & attach
    try {
      hls.loadSource(streamUrl);
    } catch (e) {
      // try backup proxy automatically
      try {
        const backup = withBackupProxy(ch.stream_url);
        hls.loadSource(backup);
        streamUrl = backup;
      } catch (ee) {
        throw ee;
      }
    }
    hls.attachMedia(video);

    // start fragment watchdog
    startFragWatchdog(hls, streamUrl, ch);
  }, [createHls, startFragWatchdog]);

  /* ------------------- MPD / Widevine via Shaka ------------------- */
  const loadMPD = useCallback(async (video: HTMLVideoElement, ch: Channel) => {
    if (!(window as any).shaka) {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/shaka-player/4.7.11/shaka-player.compiled.min.js');
    }
    const shakaLib = (window as any).shaka;
    shakaLib.polyfill.installAll();
    if (!shakaLib.Player.isBrowserSupported()) throw new Error('DASH not supported');

    const player = new shakaLib.Player(video);
    shakaRef.current = player;

    player.configure({
      streaming: { bufferingGoal: 10, rebufferingGoal: 2, bufferBehind: 30 },
      abr: { enabled: true, defaultBandwidthEstimate: 5_000_000 }
    });

    if ((ch as any).clearkey_kid && (ch as any).clearkey_key) {
      player.configure({ drm: { clearKeys: { [(ch as any).clearkey_kid]: (ch as any).clearkey_key } } });
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

    // try load mpd, fallback to proxy if needed
    try { await player.load(ch.stream_url); }
    catch {
      try { await player.load(withBackupProxy(ch.stream_url)); }
      catch (err) { throw err; }
    }

    const resume = loadResumePosition(ch.id);
    if (resume != null) video.currentTime = resume;
    await video.play();
  }, []);

  /* --------------------------- main loader effect --------------------------- */
  useEffect(() => {
    if (!channel || !videoRef.current) {
      // cleanup
      try { hlsRef.current?.destroy(); } catch {}
      try { shakaRef.current?.destroy(); } catch {}
      stopFragWatchdog();
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);
    setAvailableQualities(['auto']);
    currentStreamRef.current = channel.stream_url;

    (async () => {
      // cleanup first
      try { hlsRef.current?.destroy(); } catch {}
      try { shakaRef.current?.destroy(); } catch {}
      stopFragWatchdog();

      const video = videoRef.current!;
      let streamUrl = channel.stream_url;

      // allow refreshStream hook to return signed URL
      if (refreshStream) {
        try {
          const res = await refreshStream(streamUrl);
          if (res?.url) {
            streamUrl = res.url;
            if (res.expiresAt) signedExpiryRef.current = res.expiresAt;
            currentStreamRef.current = streamUrl;
          }
        } catch (e) {
          console.warn('refreshStream failed', e);
        }
      }

      // choose engine by extension/type
      try {
        // MPD / DASH / Widevine
        if (channel.stream_type === 'mpd' || /\.mpd(\?|$)/i.test(streamUrl)) {
          await loadMPD(video, { ...channel, stream_url: streamUrl } as Channel);
          setIsPlaying(true);
          setIsLoading(false);
          return;
        }

        // HLS (.m3u8) -> enforce HLS.js usage (NO JW)
        if (channel.stream_type === 'm3u8' || /\.m3u8(\?|$)/i.test(streamUrl)) {
          await loadHLS(video, { ...channel, stream_url: streamUrl } as Channel);
          setIsPlaying(true);
          setIsLoading(false);
          return;
        }

        // fallback: direct/native (mp4/ts/direct)
        try {
          video.src = streamUrl;
          const resume = loadResumePosition(channel.id);
          if (resume != null) video.currentTime = resume;
          await video.play().catch(() => {});
          setIsPlaying(true);
          setIsLoading(false);
          return;
        } catch (err) {
          // try backup proxy for fallback
          const backup = withBackupProxy(streamUrl);
          video.src = backup;
          await video.play().catch(() => {});
          setIsPlaying(true);
          setIsLoading(false);
          return;
        }
      } catch (err: any) {
        console.error('Main loader error', err);
        // final attempt: if HLS failed and we haven't tried backup proxy -> try it
        try {
          if ((channel.stream_type === 'm3u8' || /\.m3u8(\?|$)/i.test(streamUrl)) && !streamUrl.startsWith(BACKUP_PROXY)) {
            try {
              await loadHLS(video, { ...channel, stream_url: withBackupProxy(streamUrl) } as Channel, true);
              setIsPlaying(true);
              setIsLoading(false);
              return;
            } catch (e) { /* fall-through */ }
          }
        } catch {}
        setError(err?.message || 'Failed to load channel');
        setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      try { hlsRef.current?.destroy(); } catch {}
      try { shakaRef.current?.destroy(); } catch {}
      stopFragWatchdog();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, loadHLS, loadMPD, loadWidevine, refreshStream]);

  /* Signed URL renewal (if refreshStream provided and expiresAt set) */
  useEffect(() => {
    if (!channel || !refreshStream) return;
    let mounted = true;
    let timerId: number | null = null;

    const scheduleRenew = () => {
      try { if (timerId) clearTimeout(timerId); } catch {}
      const expiresAt = signedExpiryRef.current;
      const lead = 30_000;
      const fallback = 4 * 60 * 1000;
      const doRenew = async () => {
        if (!mounted) return;
        try {
          const newData = await refreshStream(currentStreamRef.current ?? channel.stream_url);
          if (newData?.url) {
            currentStreamRef.current = newData.url;
            if (newData.expiresAt) signedExpiryRef.current = newData.expiresAt;
            // swap into active engine if possible
            try {
              if (hlsRef.current && typeof hlsRef.current.loadSource === 'function') {
                hlsRef.current.stopLoad?.();
                hlsRef.current.loadSource(newData.url);
                hlsRef.current.startLoad?.();
                return;
              }
            } catch {}
            try {
              if (shakaRef.current && typeof shakaRef.current.load === 'function') {
                shakaRef.current.load(newData.url);
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
        } catch (err) {
          console.warn('Signed stream renew failed', err);
        }
      };

      if (expiresAt && expiresAt - Date.now() > 1000) {
        const delay = Math.max(0, (expiresAt - Date.now()) - lead);
        timerId = window.setTimeout(async () => { await doRenew(); scheduleRenew(); }, delay) as unknown as number;
      } else {
        timerId = window.setTimeout(async () => { await doRenew(); scheduleRenew(); }, fallback) as unknown as number;
      }
    };

    scheduleRenew();

    return () => {
      mounted = false;
      try { if (timerId) clearTimeout(timerId); } catch {}
    };
  }, [channel, refreshStream]);

  /* native video events + resume saving */
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => {
      setCurrentTime(v.currentTime);
      try { if (channel?.id) saveResumePosition(channel.id, v.currentTime); } catch {}
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

  /* controls visibility */
  const showControlsTemporarily = useCallback(() => {
    setShowControls(true);
    try { if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current); } catch {}
    controlsTimeoutRef.current = window.setTimeout(() => {
      if (isPlaying) setShowControls(false);
    }, 3000) as unknown as number;
  }, [isPlaying]);

  /* fullscreen */
  useEffect(() => {
    const onF = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onF);
    return () => document.removeEventListener('fullscreenchange', onF);
  }, []);

  /* control handlers */
  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (isPlaying) v.pause(); else v.play().catch(() => {});
  }, [isPlaying]);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !isMuted;
    setIsMuted(!isMuted);
  }, [isMuted]);

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const nv = Number(e.target.value);
    setVolume(nv);
    const v = videoRef.current;
    if (v) { v.volume = nv; setIsMuted(nv === 0); }
    // HLS-level volume isn't required because we drive native media element
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
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = t;
    setCurrentTime(t);
  }, []);

  const formatTime = (time: number) => {
    if (!isFinite(time) || time <= 0) return '00:00';
    const m = Math.floor(time / 60);
    const s = Math.floor(time % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleQualityChange = (q: string) => {
    setQuality(q);
    // set HLS level or Shaka track
    try {
      if (hlsRef.current) {
        if (q === 'auto') hlsRef.current.currentLevel = -1;
        else {
          const idx = hlsRef.current.levels.findIndex((l: any) => `${l.height}p` === q);
          if (idx !== -1) hlsRef.current.currentLevel = idx;
        }
      }
    } catch {}
    try {
      if (shakaRef.current) {
        if (q === 'auto') shakaRef.current.configure({ abr: { enabled: true } });
        else {
          const tracks = shakaRef.current.getVariantTracks();
          const t = tracks.find((tr: any) => `${tr.height}p` === q);
          if (t) { shakaRef.current.configure({ abr: { enabled: false } }); shakaRef.current.selectVariantTrack(t, true); }
        }
      }
    } catch {}
  };

  /* render */
  if (channel?.stream_type === 'youtube') {
    const videoId = channel.stream_url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([^"&?/ ]{11})/)?.[1];
    if (!videoId) return <div className="w-full h-full flex items-center justify-center bg-black text-red-500 font-mono">INVALID YOUTUBE URL</div>;
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return (
      <div ref={containerRef} className="relative w-full aspect-video bg-black rounded-lg overflow-hidden" style={{ boxShadow: '0 0 30px rgba(0,0,0,0.8)', border: '4px solid #5d4037' }}>
        <iframe className="w-full h-full" src={`https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1&playsinline=1&origin=${encodeURIComponent(origin)}`} frameBorder="0" allow="autoplay; encrypted-media" allowFullScreen />
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
      <video
        ref={videoRef}
        className="w-full h-full object-contain"
        playsInline
        onClick={togglePlay}
      />

      {!channel && <StaticNoise />}

      {isLoading && channel && <LoadingSpinner size="lg" />}

      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-20">
          <div className="text-center">
            <p className="text-red-400 text-lg font-medium mb-2">Error</p>
            <p className="text-white/60 text-sm">{error}</p>
          </div>
        </div>
      )}

      {/* corners */}
      <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-amber-800 rounded-tl-lg" />
      <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-amber-800 rounded-tr-lg" />
      <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-amber-800 rounded-bl-lg" />
      <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-amber-800 rounded-br-lg" />

      {/* controls overlay */}
      {channel && (
        <div className={`absolute inset-x-0 bottom-0 transition-all duration-300 ${showControls ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}
          style={{ background: 'linear-gradient(to top, rgba(62,39,35,0.95), rgba(62,39,35,0.7), transparent)', borderTop: '2px solid #8d6e63' }}>
          {/* progress */}
          {duration > 0 && (
            <div className="px-4 pt-2">
              <input type="range" min={0} max={duration} value={currentTime} onChange={handleSeek}
                className="w-full h-1 appearance-none cursor-pointer rounded-full"
                style={{
                  background: `linear-gradient(to right, #fbbf24 0%, #fbbf24 ${(currentTime / Math.max(1, duration)) * 100}%, #5d4037 ${(currentTime / Math.max(1, duration)) * 100}%, #5d4037 100%)`
                }} />
            </div>
          )}

          <div className="flex items-center justify-between px-4 py-2">
            <div className="flex items-center gap-2 md:gap-4">
              {onChannelChange && (
                <button onClick={() => onChannelChange('prev')} className="p-2 text-amber-200 hover:text-amber-400 transition-colors">
                  <SkipBack className="w-5 h-5" />
                </button>
              )}

              <button onClick={togglePlay} className="p-2 bg-amber-600/50 rounded-full text-amber-100 hover:bg-amber-600 transition-colors">
                {isPlaying ? <Pause className="w-5 h-5 md:w-6 md:h-6" /> : <Play className="w-5 h-5 md:w-6 md:h-6" />}
              </button>

              {onChannelChange && (
                <button onClick={() => onChannelChange('next')} className="p-2 text-amber-200 hover:text-amber-400 transition-colors">
                  <SkipForward className="w-5 h-5" />
                </button>
              )}

              <div className="flex items-center gap-2">
                <button onClick={toggleMute} className="p-2 text-amber-200 hover:text-amber-400 transition-colors">
                  {isMuted || volume === 0 ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                </button>
                <input type="range" min={0} max={1} step={0.05} value={isMuted ? 0 : volume}
                  onChange={handleVolumeChange} className="w-16 md:w-24 h-1 appearance-none cursor-pointer rounded-full hidden sm:block"
                  style={{ background: `linear-gradient(to right, #fbbf24 0%, #fbbf24 ${(isMuted ? 0 : volume) * 100}%, #5d4037 ${(isMuted ? 0 : volume) * 100}%, #5d4037 100%)` }} />
              </div>

              <span className="text-amber-200 text-xs md:text-sm font-mono hidden sm:block">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative">
                <button onClick={() => {/* show quality popup handled below */}} className="p-2 text-amber-200 hover:text-amber-400 transition-colors">
                  <Settings className="w-5 h-5" />
                </button>
                {/* quality menu (simple) */}
                <div className="absolute bottom-full right-0 mb-2 bg-amber-900/95 rounded-lg shadow-xl border border-amber-700 overflow-hidden min-w-[120px]">
                  <div className="px-3 py-2 border-b border-amber-700 text-amber-200 text-xs font-medium">Quality</div>
                  {availableQualities.map((q) => (
                    <button key={q} onClick={() => handleQualityChange(q)} className={`w-full px-3 py-2 text-left text-sm ${quality === q ? 'bg-amber-600 text-white' : 'text-amber-200 hover:bg-amber-800'}`}>
                      {q}
                    </button>
                  ))}
                </div>
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

/* global types */
declare global {
  interface Window { shaka: any; Hls: any; }
}

export default VideoPlayer;
