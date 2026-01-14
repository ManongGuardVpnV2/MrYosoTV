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

const VideoPlayer: React.FC<VideoPlayerProps> = ({ channel, onChannelChange }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const shakaPlayerRef = useRef<any>(null);
  const hlsRef = useRef<any>(null);
  
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

  // Cleanup function
  const cleanup = useCallback(() => {
    if (shakaPlayerRef.current) {
      shakaPlayerRef.current.destroy();
      shakaPlayerRef.current = null;
    }
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.src = '';
      videoRef.current.load();
    }
    setError(null);
    setAvailableQualities(['auto']);
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
            video.src = channel.stream_url;
            await video.play();
            break;
        }
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
  }, [channel, cleanup]);

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

    await player.load(ch.stream_url);
    await video.play();
  };

  // Load HLS
  const loadHLS = async (video: HTMLVideoElement, ch: Channel) => {
    if (window.Hls && window.Hls.isSupported()) {
      const hls = new window.Hls({
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        maxBufferSize: 60 * 1000 * 1000,
        maxBufferHole: 0.5,
        lowLatencyMode: false,
        startLevel: -1
      });

      hlsRef.current = hls;

      hls.loadSource(ch.stream_url);
      hls.attachMedia(video);

      hls.on(window.Hls.Events.MANIFEST_PARSED, (_: any, data: any) => {
        const qualities = data.levels.map((l: any) => `${l.height}p`);
        setAvailableQualities(['auto', ...qualities]);
        video.play();
      });

      hls.on(window.Hls.Events.ERROR, (_: any, data: any) => {
        if (data.fatal) {
          console.error('HLS error:', data);
          setError('Stream error occurred');
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = ch.stream_url;
      await video.play();
    } else {
      throw new Error('HLS not supported');
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
        videoRef.current.play();
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
  }
}

export default VideoPlayer;
