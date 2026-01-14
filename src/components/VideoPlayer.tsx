// VideoPlayer.tsx
import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  Settings,
  SkipBack,
  SkipForward,
} from "lucide-react";
import { Channel } from "@/types";

/**
 * Simplified player focused on playback+proxy but preserving controls.
 * - HLS: Hls.js (with native fallback)
 * - DASH: Shaka Player
 * - MP4 / direct: native
 * - Youtube: iframe
 *
 * Proxy strategy: if first attempt fails for network/CORS/blocked host,
 * it will try a single proxy fallback (`BACKUP_PROXY`) once before showing an error.
 *
 * Minimal external libs loaded dynamically via <script>.
 */

const BACKUP_PROXY = "https://poohlover.serv00.net"; // your backup proxy host
const FORCE_PROXY_HOSTS = ["fl1.moveonjoy.com", "moveonjoy.com"]; // hosts that commonly require proxy

const mustProxy = (url?: string) => {
  if (!url) return false;
  try {
    const host = new URL(url).host;
    return FORCE_PROXY_HOSTS.some((h) => host.includes(h));
  } catch {
    return false;
  }
};

const withBackupProxy = (url: string) =>
  url.startsWith(BACKUP_PROXY) ? url : `${BACKUP_PROXY}/${url}`;

interface VideoPlayerProps {
  channel: Channel | null;
  onChannelChange?: (dir: "prev" | "next") => void;
}

const LoadingSpinner: React.FC = () => (
  <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 z-20">
    <div className="flex gap-1 mb-4">
      {"LOADING".split("").map((c, i) => (
        <span
          key={i}
          className="text-2xl md:text-4xl font-bold text-amber-400 animate-bounce"
          style={{ animationDelay: `${i * 0.08}s` }}
        >
          {c}
        </span>
      ))}
    </div>
    <p className="text-amber-200/60 text-sm animate-pulse">please wait...</p>
  </div>
);

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
  const [error, setError] = useState<string | null>(null);

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const [availableQualities, setAvailableQualities] = useState<string[]>(["auto"]);
  const [quality, setQuality] = useState<string>("auto");
  const [showSettings, setShowSettings] = useState(false);

  // helper to decode base64 stored urls (you used atob in other code)
  const decodeStreamUrl = (s?: string) => {
    if (!s) return "";
    try {
      // if it's base64-encoded string, atob will succeed
      const maybe = atob(s);
      // quick heuristic: if decoded contains "http" return it otherwise original
      if (maybe.startsWith("http")) return maybe;
      return s;
    } catch {
      return s;
    }
  };

  // dynamic script loader
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

  // cleanup function - destroy HLS/Shaka and reset video
  const cleanup = useCallback(() => {
    try {
      if (hlsRef.current && typeof hlsRef.current.destroy === "function") {
        hlsRef.current.destroy();
      }
    } catch {}
    hlsRef.current = null;

    try {
      if (shakaRef.current && typeof shakaRef.current.destroy === "function") {
        shakaRef.current.destroy();
      }
    } catch {}
    shakaRef.current = null;

    if (videoRef.current) {
      try {
        videoRef.current.pause();
      } catch {}
      try {
        videoRef.current.src = "";
        videoRef.current.load();
      } catch {}
    }

    setAvailableQualities(["auto"]);
    setQuality("auto");
    setError(null);
    setIsLoading(false);
  }, []);

  // Play / Pause toggles
  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (isPlaying) {
      v.pause();
    } else {
      v.play().catch((e) => {
        console.warn("Play error:", e);
      });
    }
  }, [isPlaying]);

  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setIsMuted(v.muted);
    if (!v.muted && v.volume === 0) {
      v.volume = 0.5;
      setVolume(0.5);
    }
  };

  // attach events to update UI
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => setCurrentTime(v.currentTime);
    const onDuration = () => setDuration(v.duration || 0);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onWaiting = () => setIsLoading(true);
    const onPlaying = () => setIsLoading(false);
    const onError = () => {
      const err = v.error;
      if (err) setError(`Native playback error: code ${err.code}`);
      else setError("Playback error");
    };

    v.addEventListener("timeupdate", onTime);
    v.addEventListener("durationchange", onDuration);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("waiting", onWaiting);
    v.addEventListener("playing", onPlaying);
    v.addEventListener("error", onError);

    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("durationchange", onDuration);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("waiting", onWaiting);
      v.removeEventListener("playing", onPlaying);
      v.removeEventListener("error", onError);
    };
  }, []);

  // Set volume
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = volume;
      setIsMuted(videoRef.current.muted);
    }
  }, [volume]);

  // fullscreen toggle
  const toggleFullscreen = async () => {
    try {
      if (!containerRef.current) return;
      if (!document.fullscreenElement) {
        await containerRef.current.requestFullscreen();
        setIsFullscreen(true);
      } else {
        await document.exitFullscreen();
        setIsFullscreen(false);
      }
    } catch {}
  };

  // --- Core: load stream for channel ---
  useEffect(() => {
    (async () => {
      cleanup();
      setError(null);

      if (!channel || !videoRef.current) {
        return;
      }

      setIsLoading(true);
      const v = videoRef.current;
      let triedProxy = false;

      const rawUrl = decodeStreamUrl(channel.stream_url);
      let streamUrl = rawUrl;

      const tryPlay = async (urlToTry: string) => {
        // decide based on stream_type
        if (channel.stream_type === "mpd") {
          // DASH via Shaka
          try {
            if (!(window as any).shaka) {
              await loadScript(
                "https://cdnjs.cloudflare.com/ajax/libs/shaka-player/4.7.11/shaka-player.compiled.min.js"
              );
            }
            const shaka = (window as any).shaka;
            shaka.polyfill.installAll();
            if (!shaka.Player.isBrowserSupported()) {
              throw new Error("Browser not supported for DASH (Shaka)");
            }
            const player = new shaka.Player(v);
            shakaRef.current = player;
            player.configure({
              streaming: { bufferingGoal: 10, bufferBehind: 20 },
            });
            if (channel.clearkey_kid && channel.clearkey_key) {
              player.configure({
                drm: {
                  clearKeys: {
                    [channel.clearkey_kid]: channel.clearkey_key,
                  },
                },
              });
            }
            await player.load(urlToTry);
            await v.play();
            setIsLoading(false);
            return true;
          } catch (err) {
            console.warn("DASH load failed:", err);
            throw err;
          }
        } else if (channel.stream_type === "m3u8") {
          // HLS
          try {
            const HlsLib = (window as any).Hls;
            // prefer Hls.js if supported
            if (!HlsLib) {
              await loadScript("https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.7/hls.min.js");
            }
            const HlsAfter = (window as any).Hls;
            if (HlsAfter && HlsAfter.isSupported()) {
              const hls = new HlsAfter({
                enableWorker: true,
                lowLatencyMode: false,
                startLevel: -1,
                maxBufferLength: 30,
              });
              hlsRef.current = hls;
              hls.loadSource(urlToTry);
              hls.attachMedia(v);
              let manifestParsed = false;
              await new Promise<void>((resolve, reject) => {
                const onManifest = () => {
                  manifestParsed = true;
                  // collect quality list
                  try {
                    const q = hls.levels.map((l: any) => (l.height ? `${l.height}p` : `${l.bitrate || "auto"}`));
                    setAvailableQualities(["auto", ...Array.from(new Set(q))]);
                  } catch {}
                  resolve();
                };
                const onError = (_: any, data: any) => {
                  // handle fatal errors
                  if (data && data.fatal) {
                    reject(new Error(`HLS fatal: ${data.type}:${data.details}`));
                  } else {
                    console.warn("HLS non-fatal error", data);
                  }
                };
                hls.on(HlsAfter.Events.MANIFEST_PARSED, onManifest);
                hls.on(HlsAfter.Events.ERROR, onError);
                // fallback timeout to resolve if manifestParsed didn't fire but video can play
                setTimeout(() => {
                  if (!manifestParsed) resolve();
                }, 3000);
              });
              await v.play();
              setIsLoading(false);
              return true;
            } else if (v.canPlayType("application/vnd.apple.mpegurl")) {
              // native HLS (Safari)
              v.src = urlToTry;
              await v.play();
              setIsLoading(false);
              return true;
            } else {
              throw new Error("HLS not supported on this browser");
            }
          } catch (err) {
            console.warn("HLS load failed:", err);
            throw err;
          }
        } else {
          // mp4/direct/ts/direct
          try {
            v.src = urlToTry;
            await v.play();
            setIsLoading(false);
            return true;
          } catch (err) {
            console.warn("Native load failed:", err);
            throw err;
          }
        }
      };

      // attempt playing; if mustProxy or first attempt fails, try backup proxy once
      try {
        if (mustProxy(streamUrl)) {
          // always proxy hosts that need it
          triedProxy = true;
          const proxied = withBackupProxy(streamUrl);
          await tryPlay(proxied);
        } else {
          // first normal attempt
          try {
            await tryPlay(streamUrl);
          } catch (err) {
            // fallback: try proxy once
            if (!triedProxy) {
              triedProxy = true;
              const proxied = withBackupProxy(streamUrl);
              await tryPlay(proxied);
            } else {
              throw err;
            }
          }
        }
      } catch (err: any) {
        console.error("Playback final error:", err);
        setError(
          err?.message
            ? String(err.message)
            : "Stream error occurred. Try proxy or inspect console for details."
        );
      } finally {
        setIsLoading(false);
      }
    })();

    // cleanup on unmount or channel change
    return () => {
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, cleanup]);

  // seek handler
  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = videoRef.current;
    if (!v) return;
    const to = Number(e.target.value);
    try {
      v.currentTime = to;
    } catch {}
  };

  // quality change for HLS (simple)
  const handleQualityChange = (q: string) => {
    setQuality(q);
    setShowSettings(false);
    if (hlsRef.current) {
      if (q === "auto") {
        try {
          hlsRef.current.currentLevel = -1;
        } catch {}
      } else {
        const level = hlsRef.current.levels.findIndex((l: any) => `${l.height}p` === q);
        if (level >= 0) {
          try {
            hlsRef.current.currentLevel = level;
          } catch {}
        }
      }
    }
    // for DASH/Shaka we skip for brevity (could map to variant tracks)
  };

  // small helper format time
  const formatTime = (t: number) => {
    if (!isFinite(t) || t <= 0) return "00:00";
    const m = Math.floor(t / 60)
      .toString()
      .padStart(2, "0");
    const s = Math.floor(t % 60)
      .toString()
      .padStart(2, "0");
    return `${m}:${s}`;
  };

  // YouTube handling
  if (channel?.stream_type === "youtube") {
    const url = decodeStreamUrl(channel.stream_url || "");
    const match = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([^"&?/ ]{11})/);
    const videoId = match?.[1];
    return (
      <div ref={containerRef} className="relative w-full aspect-video bg-black rounded-lg overflow-hidden">
        {!videoId ? (
          <div className="w-full h-full flex items-center justify-center text-red-400">Invalid YouTube URL</div>
        ) : (
          <iframe
            className="w-full h-full"
            src={`https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0&playsinline=1`}
            frameBorder="0"
            allow="autoplay; encrypted-media"
            allowFullScreen
          />
        )}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative w-full aspect-video bg-black rounded-lg overflow-hidden group">
      <video ref={videoRef} className="w-full h-full object-contain" playsInline />
      {(!channel || isLoading) && <LoadingSpinner />}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-30">
          <div className="text-center">
            <p className="text-red-400 text-lg font-medium mb-2">Error</p>
            <p className="text-white/60 text-sm mb-3 break-words max-w-lg">{error}</p>
            <div className="flex gap-2 justify-center">
              <button
                onClick={() => {
                  setError(null);
                  // quick reload attempt
                  try {
                    if (videoRef.current) {
                      videoRef.current.load();
                      videoRef.current.play().catch(() => {});
                    }
                  } catch {}
                }}
                className="px-4 py-2 bg-amber-600 rounded text-white"
              >
                Retry
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Controls (kept simple + similar to your UI) */}
      {channel && (
        <div
          className={`absolute inset-x-0 bottom-0 transition-transform duration-300 transform translate-y-0`}
          style={{
            background: "linear-gradient(to top, rgba(62,39,35,0.95), rgba(62,39,35,0.65), transparent)",
            borderTop: "2px solid #8d6e63",
          }}
        >
          {/* Progress */}
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
                  background: `linear-gradient(to right, #fbbf24 0%, #fbbf24 ${(currentTime / duration) * 100}%, #5d4037 ${(currentTime / duration) * 100}%, #5d4037 100%)`,
                }}
              />
            </div>
          )}

          <div className="flex items-center justify-between px-4 py-2">
            <div className="flex items-center gap-2">
              {onChannelChange && (
                <button onClick={() => onChannelChange("prev")} className="p-2 text-amber-200">
                  <SkipBack className="w-5 h-5" />
                </button>
              )}

              <button
                onClick={() => {
                  try {
                    if (videoRef.current) {
                      if (isPlaying) videoRef.current.pause();
                      else videoRef.current.play().catch(() => {});
                    }
                  } catch {}
                }}
                className="p-2 bg-amber-600/50 rounded-full text-amber-100"
              >
                {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
              </button>

              {onChannelChange && (
                <button onClick={() => onChannelChange("next")} className="p-2 text-amber-200">
                  <SkipForward className="w-5 h-5" />
                </button>
              )}

              <div className="flex items-center gap-2 ml-3">
                <button onClick={toggleMute} className="p-2 text-amber-200">
                  {isMuted || volume === 0 ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={volume}
                  onChange={(e) => setVolume(Number(e.target.value))}
                  className="w-20 hidden sm:block"
                />
                <span className="text-amber-200 text-xs md:text-sm font-mono ml-2 hidden sm:block">
                  {formatTime(currentTime)} / {formatTime(duration)}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative">
                <button onClick={() => setShowSettings((s) => !s)} className="p-2 text-amber-200">
                  <Settings className="w-5 h-5" />
                </button>
                {showSettings && (
                  <div className="absolute bottom-full right-0 mb-2 bg-amber-900/95 rounded-lg shadow-xl border border-amber-700 overflow-hidden min-w-[120px]">
                    <div className="px-3 py-2 border-b border-amber-700 text-amber-200 text-xs font-medium">Quality</div>
                    {availableQualities.map((q) => (
                      <button
                        key={q}
                        onClick={() => handleQualityChange(q)}
                        className={`w-full px-3 py-2 text-left text-sm ${quality === q ? "bg-amber-600 text-white" : "text-amber-200 hover:bg-amber-800"}`}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button onClick={toggleFullscreen} className="p-2 text-amber-200">
                {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* small channel overlay */}
      {channel && (
        <div className="absolute top-4 left-4 bg-amber-900/80 px-3 py-1 rounded-lg">
          <p className="text-amber-100 text-sm font-medium">{channel.name}</p>
        </div>
      )}
    </div>
  );
};

// global types for loaded libs
declare global {
  interface Window {
    Hls?: any;
    shaka?: any;
  }
}

export default VideoPlayer;
