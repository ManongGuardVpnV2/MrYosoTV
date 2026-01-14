// src/components/VideoPlayer.tsx
import React, { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Channel } from "@/types";

/**
 * Merged VideoPlayer:
 * - UI from your newer VideoPlayer file
 * - Robust playback logic from the older working implementation
 * - HLS.js / Shaka / JW integration
 * - Proxy handling for hosts like moveonjoy
 * - Signed URL renewal via Supabase Edge Function "get-stream"
 * - Resume position saving
 */

interface JwOptions {
  useJw?: boolean;
  jwKey?: string;
  makeLicenseProxy?: (url: string) => string | null;
  makeProxyUrl?: (url: string) => string;
  drm?: { widevine?: string | null; playready?: string | null };
}

interface VideoPlayerProps {
  channel: Channel | null;
  onClose?: () => void;
  epgData?: Channel[] | null;
  jwOptions?: JwOptions;
}

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
    return FORCE_PROXY_HOSTS.includes(new URL(url).host) || /moveonjoy/i.test(url);
  } catch {
    return false;
  }
};

const isLowEndDevice = () => {
  const cores = navigator.hardwareConcurrency || 2;
  // @ts-ignore
  const memory = (navigator as any).deviceMemory || 2;
  return cores <= 4 || memory <= 2;
};

const RESUME_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
const RESUME_KEY_PREFIX = "ptv:resume:";

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

async function detectLlHls(url: string, makeProxy?: (u: string) => string | null) {
  try {
    const probe = makeProxy ? (makeProxy(url) ?? url) : url;
    const r = await fetch(probe, { cache: "no-store" });
    if (!r.ok) return false;
    const text = await r.text();
    if (text.includes("#EXT-X-PART") || text.includes("#EXT-X-SERVER-CONTROL")) return true;
    return false;
  } catch {
    return false;
  }
}

/* Expose library types on window for runtime checks */
declare global {
  interface Window {
    Hls?: any;
    shaka?: any;
    jwplayer?: any;
  }
}

const VideoPlayer: React.FC<VideoPlayerProps> = ({ channel, onClose, jwOptions }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const jwContainerRef = useRef<HTMLDivElement | null>(null);

  const hlsRef = useRef<any | null>(null);
  const shakaRef = useRef<any | null>(null);
  const jwRef = useRef<any | null>(null);

  const sessionIdRef = useRef<string>(() => {
    try {
      return crypto.randomUUID();
    } catch {
      return Math.random().toString(36).slice(2);
    }
  }) as React.MutableRefObject<string>;

  const streamCacheRef = useRef<Map<string, any>>(new Map());
  const streamExpiryRef = useRef<number | null>(null);

  const manifestPollIntervalRef = useRef<number | null>(null);
  const jwManifestDetachRef = useRef<(() => void) | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(Number.NaN);
  const [error, setError] = useState<string | null>(null);
  const [controlsVisible, setControlsVisible] = useState(true);

  const controlsTimerRef = useRef<number | null>(null);

  const isDesktopViewInit = (() => {
    if (typeof window === "undefined") return false;
    const wide = window.innerWidth >= 1024;
    const pointerFine = window.matchMedia && window.matchMedia("(pointer: fine)").matches;
    const isTouch = ("ontouchstart" in window) || (navigator.maxTouchPoints > 0);
    return wide && pointerFine && !isTouch;
  })();
  const [isDesktopView, setIsDesktopView] = useState<boolean>(isDesktopViewInit);

  /* helpers */
  const getStreamUrl = useCallback((ch: Channel) => {
    try {
      return atob(ch.stream_url);
    } catch {
      return ch.stream_url;
    }
  }, []);

  const loadScript = (src: string) =>
    new Promise<void>((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) {
        resolve();
        return;
      }
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = (e) => reject(e);
      document.head.appendChild(s);
    });

  const showControlsTemporarily = (ms = 2500) => {
    setControlsVisible(true);
    if (controlsTimerRef.current) {
      window.clearTimeout(controlsTimerRef.current);
      controlsTimerRef.current = null;
    }
    controlsTimerRef.current = window.setTimeout(() => setControlsVisible(false), ms) as unknown as number;
  };

  const makeProxyUrl = (src: string) => {
    if (jwOptions?.makeProxyUrl) return jwOptions.makeProxyUrl(src);
    return withBackupProxy(src);
  };

  const makeLicenseProxy = (lic?: string) => {
    if (!lic) return lic || undefined;
    if (jwOptions?.makeLicenseProxy) return jwOptions.makeLicenseProxy(lic) ?? lic;
    return `${BACKUP_PROXY}/license-proxy.php?url=${encodeURIComponent(lic)}`;
  };

  const attachManifestPoll = (masterUrl: string, cb: (fresh: string) => void, intervalSec = 8) => {
    try { if (manifestPollIntervalRef.current) { clearInterval(manifestPollIntervalRef.current); manifestPollIntervalRef.current = null; } } catch {}
    const id = window.setInterval(async () => {
      try {
        const probeUrl = jwOptions?.makeProxyUrl ? jwOptions.makeProxyUrl(masterUrl) : masterUrl;
        const r = await fetch(probeUrl, { cache: "no-store" });
        if (!r.ok) return;
        const txt = await r.text();
        const m = txt.match(/https?:\/\/[^"' ]+\.m3u8[^"' ]*/i);
        if (m?.[0]) cb(m[0]);
      } catch {}
    }, Math.max(4, intervalSec) * 1000);
    manifestPollIntervalRef.current = id as unknown as number;
    return () => {
      try { if (manifestPollIntervalRef.current) { clearInterval(manifestPollIntervalRef.current); manifestPollIntervalRef.current = null; } } catch {}
    };
  };

  useEffect(() => {
    const onResizeOrPointer = () => {
      const isTouch = (("ontouchstart" in window) || (navigator.maxTouchPoints > 0));
      const wide = window.innerWidth >= 1024;
      const pointerFine = window.matchMedia && window.matchMedia("(pointer: fine)").matches;
      setIsDesktopView(wide && pointerFine && !isTouch);
    };
    window.addEventListener("resize", onResizeOrPointer);
    if (window.matchMedia) {
      const mq = window.matchMedia("(pointer: fine)");
      const listener = (e: MediaQueryListEvent) => onResizeOrPointer();
      try { mq.addEventListener("change", listener); } catch { try { (mq as any).addListener(listener); } catch {} }
    }
    return () => {
      window.removeEventListener("resize", onResizeOrPointer);
      if (window.matchMedia) {
        const mq = window.matchMedia("(pointer: fine)");
        try { mq.removeEventListener("change", onResizeOrPointer); } catch { try { (mq as any).removeListener(onResizeOrPointer); } catch {} }
      }
    };
  }, []);

  useEffect(() => {
    if (!channel || !videoRef.current) {
      setIsLoading(false);
      return;
    }

    const v = videoRef.current;
    let cancelled = false;
    let localHlsPollDetach: (() => void) | null = null;

    setIsLoading(true);
    setError(null);

    const init = async () => {
      try {
        let streamUrl = getStreamUrl(channel);

        // Signed stream via Edge Function (if any)
        try {
          const { data: { user } } = await supabase.auth.getUser();
          const cached = streamCacheRef.current.get(channel.id);
          if (cached && cached.expiresAt > Date.now()) {
            streamUrl = cached.url;
            streamExpiryRef.current = cached.expiresAt ?? null;
          } else {
            try {
              const { data } = await supabase.functions.invoke("get-stream", {
                body: { url: streamUrl, userId: user?.id ?? null, sessionId: sessionIdRef.current },
              } as any);
              if (data?.url) {
                streamUrl = data.url;
                streamExpiryRef.current = data.expiresAt ?? null;
                streamCacheRef.current.set(channel.id, data);
              }
            } catch {}
          }
        } catch {}

        if (cancelled) return;

        // JW Player (optional)
        if (jwOptions?.useJw && jwContainerRef.current) {
          try {
            if (!(window as any).jwplayer) {
              await loadScript("https://ssl.p.jwpcdn.com/player/v/8.38.10/jwplayer.js");
            }
            if (jwOptions.jwKey) (window as any).jwplayer.key = jwOptions.jwKey;

            jwContainerRef.current.style.display = "block";
            const fastUrl = await (async () => {
              try {
                const direct = await fetch(streamUrl, { method: "GET", cache: "no-store" });
                if (direct.ok) return streamUrl;
                return makeProxyUrl(streamUrl);
              } catch {
                return makeProxyUrl(streamUrl);
              }
            })();

            const jwCfg: any = {
              file: fastUrl,
              autostart: true,
              mute: false,
              preload: "auto",
              width: "100%",
              height: "100%",
              stretching: "uniform",
              abouttext: "VideoPlayer",
              sources: [{ file: fastUrl }],
              hlsjsConfig: { lowLatencyMode: true, maxBufferLength: 45 },
            };

            const jwDrm: any = {};
            if (jwOptions.drm?.widevine) jwDrm.widevine = { url: makeLicenseProxy(jwOptions.drm.widevine) || jwOptions.drm.widevine };
            if (jwOptions.drm?.playready) jwDrm.playready = { url: makeLicenseProxy(jwOptions.drm.playready) || jwOptions.drm.playready };
            if (Object.keys(jwDrm).length) jwCfg.drm = jwDrm;

            try {
              jwRef.current = (window as any).jwplayer(jwContainerRef.current).setup(jwCfg);
            } catch {
              jwRef.current = (window as any).jwplayer(jwContainerRef.current);
              jwRef.current.setup && jwRef.current.setup(jwCfg);
            }

            jwRef.current?.on?.("ready", () => {
              try { v.pause(); v.removeAttribute("src"); v.load(); } catch {}
              try {
                const resume = loadResumePosition(channel.id);
                if (resume && jwRef.current?.seek) {
                  try { jwRef.current.seek(resume); } catch {}
                }
              } catch {}
              setIsLoading(false);
            });

            jwRef.current?.on?.("play", () => setIsPlaying(true));
            jwRef.current?.on?.("pause", () => setIsPlaying(false));

            jwRef.current?.on?.("error", async (err: any) => {
              console.warn("JW error", err);
              // Try proxy on JW error
              try {
                const prox = jwOptions?.makeProxyUrl ? jwOptions.makeProxyUrl(streamUrl) ?? makeProxyUrl(streamUrl) : makeProxyUrl(streamUrl);
                jwRef.current?.load?.([{ file: prox }]);
                return;
              } catch {}
              setError("JW Player error");
            });

            try {
              const jwManifestDetach = attachManifestPoll(streamUrl, (fresh) => {
                try {
                  const final = jwOptions?.makeProxyUrl ? jwOptions.makeProxyUrl(fresh) ?? fresh : fresh;
                  jwRef.current && jwRef.current.load && jwRef.current.load([{ file: final }]);
                } catch {}
              }, 8);
              jwManifestDetachRef.current = jwManifestDetach;
            } catch {}

            return; // JW handles playback
          } catch (jwErr) {
            console.warn("JW init failed, falling back to native/HLS/Shaka", jwErr);
            try { if (jwContainerRef.current) jwContainerRef.current.style.display = "none"; } catch {}
          }
        }

        // DASH (MPD)
        if (channel.stream_type === "mpd") {
          if (!(window as any).shaka) {
            await loadScript("https://cdnjs.cloudflare.com/ajax/libs/shaka-player/4.7.11/shaka-player.compiled.min.js");
          }
          const shaka = (window as any).shaka;
          shaka.polyfill.installAll();
          if (!shaka.Player.isBrowserSupported()) throw new Error("Browser not supported for DASH");
          const player = new shaka.Player(v);
          shakaRef.current = player;
          player.configure({
            streaming: { rebufferingGoal: 1.6, bufferingGoal: 15, bufferBehind: 30, lowLatencyMode: true },
            abr: { enabled: true, defaultBandwidthEstimate: 600_000 },
            manifest: { dash: { ignoreMinBufferTime: true } },
          });
          if (channel.drm_type === "clearkey" && channel.drm_kid && channel.drm_key) {
            player.configure({ drm: { clearKeys: { [channel.drm_kid]: channel.drm_key } } });
          }
          try { await player.load(streamUrl); } catch { await player.load(withBackupProxy(streamUrl)); }
          try {
            const resume = loadResumePosition(channel.id);
            if (resume != null) v.currentTime = resume;
          } catch {}
          await v.play();
        }
        // HLS (m3u8)
        else if (channel.stream_type === "m3u8") {
          const forceHlsJs = mustProxy(streamUrl) || /moveonjoy/i.test(streamUrl);
          if (!forceHlsJs && v.canPlayType("application/vnd.apple.mpegurl")) {
            const resume = loadResumePosition(channel.id);
            v.src = streamUrl;
            if (resume != null) v.currentTime = resume;
            await v.play();
          } else {
            if (!(window as any).Hls) {
              await loadScript("https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.7/hls.min.js");
            }
            const HlsLib = (window as any).Hls;
            if (!HlsLib || !HlsLib.isSupported()) {
              // fallback to direct
              const resume = loadResumePosition(channel.id);
              v.src = streamUrl;
              if (resume != null) v.currentTime = resume;
              await v.play();
            } else {
              const lowEnd = isLowEndDevice();
              const supportsLl = await detectLlHls(streamUrl, jwOptions?.makeProxyUrl);
              const llMode = supportsLl && !lowEnd;

              const hls = new HlsLib({
                enableWorker: !lowEnd,
                lowLatencyMode: llMode,
                autoStartLoad: true,
                startLevel: -1,
                rebufferingGoal: lowEnd ? 2.0 : 1.6,
                startFragPrefetch: !lowEnd,
                initialLiveManifestSize: lowEnd ? 3 : 1,
                maxBufferLength: lowEnd ? 40 : 24,
                backBufferLength: 30,
                maxBufferHole: 0.5,
                maxBufferSize: lowEnd ? 60 * 1000 * 1000 : 90 * 1000 * 1000,
                liveSyncDuration: llMode ? 1.5 : (lowEnd ? 6 : 3.2),
                liveMaxLatencyDuration: llMode ? 6 : (lowEnd ? 12 : 6.5),
                fragLoadingTimeOut: 20000,
                fragLoadingMaxRetry: 8,
              });

              hlsRef.current = hls;
              let triedBackup = false;

              try {
                localHlsPollDetach = attachManifestPoll(streamUrl, (fresh) => {
                  try {
                    const final = jwOptions?.makeProxyUrl ? jwOptions.makeProxyUrl(fresh) ?? fresh : fresh;
                    try { hls.stopLoad(); } catch {}
                    try { hls.loadSource(final); hls.startLoad(); } catch {}
                  } catch {}
                }, 8);
              } catch {}

              const attach = (u: string) => {
                try { hls.loadSource(u); hls.attachMedia(v); } catch { v.src = u; }
              };

              attach(streamUrl);

              hls.on(HlsLib.Events.MANIFEST_PARSED, (_: any, data: any) => {
                try {
                  const resume = loadResumePosition(channel.id);
                  if (resume != null) {
                    try { v.currentTime = resume; } catch {}
                  }
                } catch {}
                if (llMode) {
                  try { hls.currentLevel = -1; } catch {}
                } else {
                  if (lowEnd) try { hls.currentLevel = 0; } catch {}
                }
                // autoplay dance: mute first then restore
                v.muted = true;
                v.play()
                  .then(() => {
                    setTimeout(() => { v.muted = false; v.volume = 1; setIsMuted(false); setVolume(1); }, 200);
                  })
                  .catch(() => setTimeout(() => v.play().catch(() => {}), 300));
              });

              hls.on(HlsLib.Events.ERROR, (_: any, data: any) => {
                if (!data) return;
                // recoverable errors
                if (data.details === HlsLib.ErrorDetails.BUFFER_STALLED_ERROR) {
                  try { hls.startLoad(); } catch {}
                  return;
                }
                if (!data.fatal) return;

                // first try backup proxy
                if (!triedBackup) {
                  triedBackup = true;
                  try { hls.destroy(); } catch {}
                  const backup = withBackupProxy(streamUrl);
                  if (backup !== streamUrl) {
                    attach(backup);
                    return;
                  }
                }

                // network error -> likely CORS or server unreachable
                if (data.type === HlsLib.ErrorTypes.NETWORK_ERROR) {
                  setError("Stream blocked by source (network / CORS). Trying proxy may help.");
                  try { hls.startLoad(); } catch {}
                  return;
                }

                if (data.type === HlsLib.ErrorTypes.MEDIA_ERROR) {
                  try { hls.recoverMediaError(); } catch {}
                  return;
                }

                setError("Stream error. Please try again.");
              });
            }
          }
        } else {
          // direct file types (mp4, ts, direct)
          const resume = loadResumePosition(channel.id);
          v.src = streamUrl;
          if (resume != null) try { v.currentTime = resume; } catch {}
          await v.play();
        }

        setIsLoading(false);
      } catch (err: any) {
        if (cancelled) return;
        console.error("Player init error:", err);
        // Provide user with clearer message when host likely blocks:
        if (/CORS|NetworkError|403|401|net::ERR_BLOCKED_BY_CLIENT|ERR_FAILED/i.test(err?.message || "")) {
          setError("Stream blocked by source (CORS / Hotlink). Try using the proxy or a different stream.");
        } else {
          setError(err?.message ?? "Playback error");
        }
        setIsLoading(false);
      }
    };

    init();

    return () => {
      cancelled = true;
      try { if (hlsRef.current?.destroy) hlsRef.current.destroy(); } catch {}
      try { if (shakaRef.current?.destroy) shakaRef.current.destroy(); } catch {}
      try { if (jwRef.current?.remove) jwRef.current.remove(); } catch {}
      try { if (jwManifestDetachRef.current) jwManifestDetachRef.current(); } catch {}
      try { if (manifestPollIntervalRef.current) { clearInterval(manifestPollIntervalRef.current); manifestPollIntervalRef.current = null; } } catch {}
      try { if (localHlsPollDetach) localHlsPollDetach(); } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, getStreamUrl, jwOptions]);

  /* Signed URL renewal (periodic) */
  useEffect(() => {
    if (!channel) return;
    let mounted = true;
    let timerId: number | null = null;

    const renewSignedStream = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        const { data } = await supabase.functions.invoke("get-stream", {
          body: { url: getStreamUrl(channel), userId: user?.id ?? null, sessionId: sessionIdRef.current },
        } as any);
        if (!mounted) return;
        if (data?.url) {
          const newUrl: string = data.url;
          streamExpiryRef.current = data.expiresAt ?? null;
          streamCacheRef.current.set(channel.id, data);

          try {
            if (jwRef.current && typeof jwRef.current.load === "function") {
              try { jwRef.current.load([{ file: newUrl }]); setIsLoading(false); } catch { try { jwRef.current.setup && jwRef.current.setup({ file: newUrl }); } catch {} }
              return;
            }
          } catch (e) { console.warn("JW swap failed", e); }

          try {
            const HlsLib = (window as any).Hls;
            if (hlsRef.current && HlsLib && typeof hlsRef.current.loadSource === "function") {
              try { hlsRef.current.stopLoad?.(); } catch {}
              try { hlsRef.current.loadSource(newUrl); hlsRef.current.startLoad?.(); setIsLoading(false); } catch (e) { console.warn("HLS swap failed", e); }
              return;
            }
          } catch (e) { console.warn("HLS swap check error", e); }

          try {
            const v = videoRef.current;
            if (v) {
              const wasPlaying = !v.paused && !v.ended;
              v.src = newUrl;
              try { await v.play(); if (!wasPlaying) v.pause(); } catch {}
              setIsLoading(false);
            }
          } catch (e) { console.warn("Native swap failed", e); }
        }
      } catch (err) {
        console.warn("Signed stream renewal failed:", err);
      }
    };

    const scheduleRenew = () => {
      if (timerId) { clearTimeout(timerId); timerId = null; }
      const expiresAt = streamExpiryRef.current;
      const leadMs = 30_000;
      if (expiresAt && expiresAt > Date.now() + 1000) {
        const delay = Math.max(0, expiresAt - Date.now() - leadMs);
        timerId = window.setTimeout(async () => { await renewSignedStream(); if (mounted) scheduleRenew(); }, delay) as unknown as number;
      } else {
        const fallbackMs = 4 * 60 * 1000;
        timerId = window.setTimeout(async () => { await renewSignedStream(); if (mounted) scheduleRenew(); }, fallbackMs) as unknown as number;
      }
    };

    (async () => {
      try {
        const expiresAt = streamExpiryRef.current;
        if (expiresAt && expiresAt - Date.now() < 60_000) await renewSignedStream();
      } catch {}
      scheduleRenew();
    })();

    return () => { mounted = false; if (timerId) clearTimeout(timerId); };
  }, [channel, getStreamUrl]);

  /* Native events + resume saving */
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onTime = () => {
      setCurrentTime(v.currentTime);
      setDuration(v.duration || Number.NaN);
    };
    const onDuration = () => setDuration(v.duration || Number.NaN);
    const onWaiting = () => setIsLoading(true);
    const onPlaying = () => setIsLoading(false);
    const onError = () => setError("Playback error");

    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("durationchange", onDuration);
    v.addEventListener("waiting", onWaiting);
    v.addEventListener("playing", onPlaying);
    v.addEventListener("error", onError);

    let saveTimer: number | null = null;
    const scheduleSave = () => {
      if (!channel) return;
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => {
        try {
          const pos = v.currentTime;
          if (channel?.id) saveResumePosition(channel.id, pos);
        } catch {}
      }, 1500) as unknown as number;
    };

    v.addEventListener("timeupdate", scheduleSave);

    const onVisibility = () => {
      if (document.hidden) {
        try {
          const pos = v.currentTime;
          if (channel?.id) saveResumePosition(channel.id, pos);
        } catch {}
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("durationchange", onDuration);
      v.removeEventListener("waiting", onWaiting);
      v.removeEventListener("playing", onPlaying);
      v.removeEventListener("error", onError);
      v.removeEventListener("timeupdate", scheduleSave);
      if (saveTimer) clearTimeout(saveTimer);
      document.removeEventListener("visibilitychange", onVisibility);
      try { if (channel?.id && v) saveResumePosition(channel.id, v.currentTime); } catch {}
    };
  }, [channel]);

  /* Controls API */
  const togglePlay = useCallback(() => {
    if (jwRef.current) {
      try {
        const state = jwRef.current.getState?.();
        if (state === "playing") jwRef.current.pause?.(); else jwRef.current.play?.();
      } catch {}
      return;
    }
    const v = videoRef.current;
    if (!v) return;
    if (isPlaying) v.pause(); else v.play().catch(() => {});
  }, [isPlaying]);

  const seekTo = (t: number) => {
    if (jwRef.current && jwRef.current.seek) {
      try { jwRef.current.seek(t); } catch {}
      return;
    }
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min((v.duration || 0), t));
  };

  const toggleMute = () => {
    const v = videoRef.current;
    if (v) { v.muted = !isMuted; setIsMuted(!isMuted); if (!isMuted && v.volume === 0) { v.volume = 0.5; setVolume(0.5); } }
    else if (jwRef.current?.setVolume) { try { const nm = !isMuted; jwRef.current.setVolume(nm ? 0 : Math.round((volume || 1) * 100)); setIsMuted(nm); } catch {} }
  };

  const changeVolume = (v: number) => {
    const vol = Math.max(0, Math.min(1, v));
    const elm = videoRef.current;
    if (elm) { elm.volume = vol; setVolume(vol); setIsMuted(vol === 0); }
    else if (jwRef.current?.setVolume) { try { jwRef.current.setVolume(Math.round(vol * 100)); setVolume(vol); setIsMuted(vol === 0); } catch {} }
  };

  const toggleFullscreen = async () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      try { await containerRef.current.requestFullscreen(); setIsFullscreen(true); } catch {}
    } else {
      try { await document.exitFullscreen(); setIsFullscreen(false); } catch {}
    }
  };

  /* keyboard */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const active = document.activeElement;
      if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || (active as HTMLElement).isContentEditable)) return;
      if (e.code === "Space") { e.preventDefault(); togglePlay(); showControlsTemporarily(); }
      else if (e.key === "ArrowLeft") { seekTo(currentTime - 5); showControlsTemporarily(); }
      else if (e.key === "ArrowRight") { seekTo(currentTime + 5); showControlsTemporarily(); }
      else if (e.key === "ArrowUp") { changeVolume((volume || 0) + 0.1); showControlsTemporarily(); }
      else if (e.key === "ArrowDown") { changeVolume((volume || 0) - 0.1); showControlsTemporarily(); }
      else if (e.key.toLowerCase() === "m") { toggleMute(); showControlsTemporarily(); }
      else if (e.key.toLowerCase() === "f") { toggleFullscreen(); }
      else if (e.key === "Escape") { if (document.fullscreenElement) document.exitFullscreen(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, currentTime, volume, toggleMute]);

  const formatTime = (s: number) => {
    if (!isFinite(s)) return "--:--";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  };

  const getSeekBackground = () => {
    try {
      const pct = isFinite(duration) && duration > 0 ? Math.max(0, Math.min(100, (currentTime / duration) * 100)) : (duration ? 0 : Math.min(100, currentTime / (currentTime + 1) * 100));
      const track = `linear-gradient(90deg, #8b5cf6 ${pct}%, rgba(255,255,255,0.12) ${pct}%)`;
      return track;
    } catch {
      return undefined;
    }
  };

  // Render UI (keeps the design you posted)
  if (!channel) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-gray-950 relative overflow-hidden">
        <div className="flex flex-col items-center justify-center animate-fade-in">
          <img src="/logo-main.png" alt="PinoyTambayanTV" className="w-48 h-48 md:w-64 md:h-64 object-contain opacity-90" />
          <p className="mt-6 text-gray-400 font-mono tracking-widest text-sm">SELECT A CHANNEL TO START</p>
        </div>
        <style>{`
          @keyframes fadeInSmooth { from { opacity: 0; transform: scale(0.98); } to { opacity: 1; transform: scale(1); } }
          .animate-fade-in { animation: fadeInSmooth 0.6s ease-out both; }
        `}</style>
      </div>
    );
  }

  // YouTube embed short-circuit
  if (channel.stream_type === "youtube") {
    const url = getStreamUrl(channel);
    const match = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([^"&?/ ]{11})/);
    const videoId = match?.[1];
    if (!videoId) return <div className="w-full h-full flex items-center justify-center bg-black text-red-500 font-mono">INVALID YOUTUBE URL</div>;
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    return (
      <div ref={containerRef} className="w-full h-full bg-black relative">
        <iframe key={videoId} className="w-full h-full" src={`https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1&playsinline=1&origin=${encodeURIComponent(origin)}`} frameBorder="0" allow="autoplay; encrypted-media" allowFullScreen />
      </div>
    );
  }

  const containerHandlers = isDesktopView ? {
    onMouseEnter: () => { setControlsVisible(true); },
    onMouseLeave: () => { if (controlsTimerRef.current) { clearTimeout(controlsTimerRef.current); controlsTimerRef.current = null; } setControlsVisible(false); },
  } : {};

  return (
    <div
      ref={containerRef}
      className="w-full h-full bg-black relative select-none"
      onMouseMove={() => showControlsTemporarily()}
      onClick={() => showControlsTemporarily()}
      onDoubleClick={() => toggleFullscreen()}
      {...containerHandlers}
    >
      <style>{`
        .robot-btn { display:inline-flex; align-items:center; justify-content:center; background: rgba(16,16,16,0.64); border: 1px solid rgba(255,255,255,0.06); box-shadow: none; color: #fff; border-radius: 6px; padding: 6px; transition: background .12s, transform .06s;}
        .robot-btn:active { transform: translateY(1px); }
        input[type=range] { -webkit-appearance: none; appearance: none; background: transparent; }
        input[type=range]::-webkit-slider-runnable-track { height: 10px; background: rgba(255,255,255,0.12); border-radius: 6px; }
        input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; height: 14px; width: 14px; border-radius: 50%; margin-top: -2px; background: #8b5cf6; box-shadow: 0 0 0 4px rgba(139,92,246,0.12); border: 2px solid #fff; }
        @media (min-width: 1024px) {
          .controls-row { padding: 8px 18px; gap: 12px; }
        }
      `}</style>

      <video ref={videoRef} className="w-full h-full object-contain bg-black" playsInline autoPlay controls={false} />

      <div ref={(el) => { if (el && !jwContainerRef.current) jwContainerRef.current = el; }} id="jw-player-container" style={{ position: "absolute", inset: 0, display: jwOptions?.useJw ? "block" : "none" }} />

      {/* Close */}
      {onClose && (
        <button onClick={(e) => { e.stopPropagation(); onClose(); }} className="absolute top-3 right-3 z-50 robot-btn" aria-label="Close">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      )}

      {/* watermark */}
      <div className="absolute top-3 right-14 z-40 pointer-events-none">
        <img src="/logo-header.png" alt="logo" className="w-10 h-10 opacity-95 drop-shadow-xl" />
      </div>

      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-50">
          <LoadingSpinner size="lg" />
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/90 z-50">
          <div className="text-center">
            <p className="text-red-400 font-mono mb-3">{error}</p>
            <button onClick={() => window.location.reload()} className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white font-mono rounded">RETRY</button>
          </div>
        </div>
      )}

      {/* Controls */}
      <div className={`absolute left-0 right-0 bottom-0 z-50 transition-opacity ${controlsVisible ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
        <div className="backdrop-blur-sm bg-black/45 px-3 py-2 flex items-center controls-row justify-between">
          <div className="flex items-center gap-2">
            <button onClick={(e) => { e.stopPropagation(); togglePlay(); }} aria-label="Play/Pause" className="robot-btn" style={{ width: isDesktopView ? 44 : 36, height: isDesktopView ? 44 : 36 }}>
              {!isPlaying ? (
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M5 3v18l15-9L5 3z" /></svg>
              ) : (
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h4v12H6zM14 6h4v12h-4z" /></svg>
              )}
            </button>

            <div className="text-xs font-mono text-gray-300 w-14 text-left pl-1">
              {formatTime(currentTime)}
            </div>
          </div>

          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <input
              aria-label="Seek"
              type="range"
              min={0}
              max={isFinite(duration) ? duration : Math.max(0, currentTime + 1)}
              step={0.1}
              value={isFinite(duration) ? Math.min(currentTime, duration) : currentTime}
              onChange={(e) => seekTo(Number(e.target.value))}
              onMouseDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              style={{
                width: isDesktopView ? "70%" : "50%",
                maxWidth: isDesktopView ? "1200px" : "60%",
                background: getSeekBackground(),
                height: isDesktopView ? 12 : 8,
              }}
            />
          </div>

          <div className="flex items-center gap-2">
            {(isDesktopView || isFinite(duration)) && (
              <div className="text-xs font-mono text-gray-300 w-14 text-right pr-1">
                {isFinite(duration) ? formatTime(duration) : ""}
              </div>
            )}

            <button onClick={(e) => { e.stopPropagation(); toggleMute(); }} aria-label="Mute" className="robot-btn" style={{ width: isDesktopView ? 44 : 36, height: isDesktopView ? 44 : 36 }}>
              {isMuted || volume === 0 ? (
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 12l3.5 3.5-1.5 1.5L15 13.5 11.5 17H6v-10h5.5L15 10.5l4-4 1.5 1.5L16.5 12z" /></svg>
              ) : (
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M3 10v4h4l5 5V5L7 10H3zM16 12c0-1.77-.77-3.37-2-4.47v8.94A5.978 5.978 0 0 0 16 12z" /></svg>
              )}
            </button>

            <input
              aria-label="Volume"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={(e) => changeVolume(Number(e.target.value))}
              className="w-20 md:w-24"
              onMouseDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              style={{ height: isDesktopView ? 10 : 6, background: `linear-gradient(90deg,#8b5cf6 ${volume * 100}%, rgba(255,255,255,0.12) ${volume * 100}%)` }}
            />

            <button onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }} aria-label="Fullscreen" className="robot-btn" style={{ width: isDesktopView ? 44 : 36, height: isDesktopView ? 44 : 36 }}>
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={isFullscreen ? "M9 11H5a2 2 0 0 0-2 2v4" : "M3 3h6v6M21 21h-6v-6"} /></svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VideoPlayer;
