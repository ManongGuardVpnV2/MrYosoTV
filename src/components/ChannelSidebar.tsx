import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Lock, ChevronRight, ChevronLeft, Search, Tv, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Channel, Category, CATEGORIES, CATEGORY_GEMS } from '@/types';

interface ChannelSidebarProps {
  selectedChannel: Channel | null;
  onChannelSelect: (channel: Channel) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

const BACKGROUND_IMAGE = 'https://d64gsuwffb70l.cloudfront.net/6966ff2969d41bac5afce556_1768357781130_1774fa95.jpg';

// Utility hook to get window size (works for SSR checks)
function useWindowSize() {
  const [size, setSize] = useState({ width: typeof window !== 'undefined' ? window.innerWidth : 1024, height: typeof window !== 'undefined' ? window.innerHeight : 768 });
  useEffect(() => {
    function onResize() {
      setSize({ width: window.innerWidth, height: window.innerHeight });
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return size;
}

const getCategoryGradient = (category: Category | null) => {
  // CATEGORY_GEMS likely contains color classes e.g. "from-amber-600 to-rose-500" — we will attempt to read it
  if (!category) return 'linear-gradient(135deg, rgba(26,15,10,0.9), rgba(45,24,16,0.9))';
  const gem = (CATEGORY_GEMS as Record<string, string>)[category as string];
  // If CATEGORY_GEMS returns tailwind classes, we fall back to a built-in gradient map
  const fallback: Record<string, string> = {
    Cignal: 'linear-gradient(135deg,#7c3aed,#f97316)',
    News: 'linear-gradient(135deg,#ef4444,#f59e0b)',
    Sports: 'linear-gradient(135deg,#10b981,#06b6d4)',
    Music: 'linear-gradient(135deg,#6366f1,#ec4899)'
  };
  return fallback[category as string] || 'linear-gradient(135deg,#5b21b6,#ef4444)';
};

const ChannelSidebar: React.FC<ChannelSidebarProps> = ({
  selectedChannel,
  onChannelSelect,
  isCollapsed,
  onToggleCollapse
}) => {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<Category>('Cignal');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const { width: windowWidth } = useWindowSize();

  // detect mobile / android
  const isMobile = windowWidth <= 768;
  const isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);

  // choose responsive width
  const sidebarWidth = useMemo(() => {
    if (isMobile) return Math.min(windowWidth, 420); // slightly smaller on very small screens
    if (windowWidth < 1280) return Math.min(360, Math.floor(windowWidth * 0.36));
    return 320; // desktop default
  }, [isMobile, windowWidth]);

  // Fetch channels
  const fetchChannels = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('channels')
        .select('*')
        .order('category')
        .order('display_order');

      if (error) throw error;
      setChannels(data || []);
    } catch (error) {
      console.error('Error fetching channels:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchChannels();
  }, [fetchChannels]);

  // prevent body scroll when drawer is open on mobile
  useEffect(() => {
    if (isMobile && !isCollapsed) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isMobile, isCollapsed]);

  // Filter channels
  const filteredChannels = useMemo(() => {
    return channels.filter(channel => {
      const matchesCategory = channel.category === selectedCategory;
      const matchesSearch = channel.name.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [channels, selectedCategory, searchQuery]);

  // Sort alphabetically (non-mutating)
  const sortedChannels = useMemo(() => {
    return [...filteredChannels].sort((a, b) => a.name.localeCompare(b.name));
  }, [filteredChannels]);

  // Fancy animated gradient "color collage" background
  const backgroundStyle: React.CSSProperties = {
    backgroundImage: `linear-gradient(135deg, rgba(26,15,10,0.9) 0%, rgba(45,24,16,0.9) 50%, rgba(26,15,10,0.9) 100%), url('${BACKGROUND_IMAGE}')`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat'
  };

  // Root container classes adapt for mobile (full-screen drawer) vs desktop (fixed sidebar)
  const containerClasses = `fixed top-0 right-0 h-full z-20 transition-transform duration-300 ease-in-out ${isCollapsed ? (isMobile ? 'translate-x-full' : 'translate-x-full') : 'translate-x-0'}`;

  return (
    <>
      {/* Toggle Button: adapt position for mobile */}
      <button
        onClick={onToggleCollapse}
        aria-expanded={!isCollapsed}
        className={`fixed z-30 transition-all duration-300 bg-amber-800 hover:bg-amber-700 text-amber-100 p-2 rounded-l-lg shadow-lg ${
          isMobile ? 'bottom-6 right-4' : isCollapsed ? 'top-1/2 -translate-y-1/2 right-0' : 'top-1/2 -translate-y-1/2 right-80 md:right-96'
        }`}
        style={{ boxShadow: '0 0 15px rgba(0,0,0,0.5)' }}
        type="button"
      >
        {isCollapsed ? (isMobile ? <ChevronLeft className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />) : (isMobile ? <ChevronRight className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />)}
      </button>

      {/* Backdrop for mobile when open */}
      {isMobile && !isCollapsed && (
        <div
          className="fixed inset-0 bg-black/50 z-20"
          onClick={onToggleCollapse}
          aria-hidden
        />
      )}

      {/* Sidebar */}
      <div
        className={containerClasses}
        style={{ width: isMobile ? '100vw' : `${sidebarWidth}px`, maxWidth: '100vw' }}
      >
        <div
          className="h-full flex flex-col"
          style={{
            ...backgroundStyle,
            borderLeft: '3px solid #5d4037',
            boxShadow: '-10px 0 30px rgba(0,0,0,0.5)'
          }}
        >
          {/* Header */}
          <div
            className="p-4 border-b border-amber-900/50 flex items-start justify-between"
            style={{
              background: 'linear-gradient(180deg, rgba(62,39,35,0.6) 0%, rgba(45,24,16,0.6) 100%)'
            }}
          >
            <div className="flex items-center gap-2">
              <Tv className="w-6 h-6 text-amber-400" />
              <h2 className="text-xl font-bold text-amber-400" style={{ textShadow: '0 0 10px rgba(251, 191, 36, 0.5)' }}>
                Channels
              </h2>
            </div>

            {/* Close button for mobile */}
            {isMobile && (
              <button onClick={onToggleCollapse} aria-label="Close sidebar" className="p-2 rounded-md">
                <X className="w-5 h-5 text-amber-200" />
              </button>
            )}
          </div>

          {/* Search + categories */}
          <div className="p-4 border-b border-amber-900/40">
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-amber-600" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search channels..."
                className="w-full pl-10 pr-4 py-2 bg-black/30 border border-amber-900/50 rounded-lg text-amber-100 placeholder-amber-700 focus:outline-none focus:border-amber-600 transition-colors text-sm"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((category) => (
                <button
                  key={category}
                  onClick={() => setSelectedCategory(category)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all transform hover:scale-105 ${
                    selectedCategory === category
                      ? `${(CATEGORY_GEMS as any)[category]} text-white shadow-lg`
                      : 'bg-amber-900/50 text-amber-300 hover:bg-amber-800/50'
                  }`}
                  style={selectedCategory === category ? { boxShadow: '0 0 15px rgba(251, 191, 36, 0.3)' } : {}}
                  type="button"
                >
                  {category}
                </button>
              ))}
            </div>
          </div>

          {/* Channel List */}
          <div className="overflow-y-auto" style={{ height: 'calc(100% - 220px)' }}>
            {isLoading ? (
              <div className="flex items-center justify-center h-32">
                <div className="flex gap-1">
                  {'LOADING'.split('').map((letter, i) => (
                    <span
                      key={i}
                      className="text-lg font-bold text-amber-400 animate-bounce"
                      style={{ animationDelay: `${i * 0.1}s` }}
                    >
                      {letter}
                    </span>
                  ))}
                </div>
              </div>
            ) : sortedChannels.length === 0 ? (
              <div className="text-center py-8 text-amber-600">
                No channels found for {selectedCategory}
              </div>
            ) : (
              <div className="p-2">
                <div className="space-y-1">
                  {sortedChannels.map((channel) => (
                    <ChannelItem
                      key={channel.id}
                      channel={channel}
                      isSelected={selectedChannel?.id === channel.id}
                      onSelect={onChannelSelect}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-3 border-t border-amber-900/50 text-center" style={{ background: 'linear-gradient(0deg, rgba(26,15,10,0.75) 0%, transparent 100%)' }}>
            <p className="text-amber-600 text-xs">
              {sortedChannels.length} channels in {selectedCategory}
            </p>
            <p className="text-amber-500 text-[10px] mt-1">{isAndroid ? 'Optimized for Android touch' : 'Desktop / Mobile optimized'}</p>
          </div>
        </div>
      </div>
    </>
  );
};

// Channel Item Component (same UI but improved a bit for touch)
const ChannelItem: React.FC<{
  channel: Channel;
  isSelected: boolean;
  onSelect: (channel: Channel) => void;
}> = ({ channel, isSelected, onSelect }) => {
  return (
    <button
      onClick={() => !channel.is_locked && onSelect(channel)}
      disabled={channel.is_locked}
      className={`w-full flex items-center gap-3 p-3 rounded-lg transition-all duration-200 focus:outline-none ${
        isSelected
          ? 'bg-gradient-to-r from-amber-700 to-amber-800 shadow-lg'
          : channel.is_locked
          ? 'bg-gray-900/50 cursor-not-allowed opacity-60'
          : 'bg-amber-950/30 hover:bg-amber-900/50'
      }`}
      style={isSelected ? { boxShadow: '0 0 15px rgba(251, 191, 36, 0.3)' } : { touchAction: 'manipulation' }}
      type="button"
    >
      <div className="w-16 h-11 rounded overflow-hidden flex-shrink-0 bg-amber-900/50" style={{ border: '2px solid #5d4037' }}>
        {channel.thumbnail_url ? (
          <img src={channel.thumbnail_url} alt={channel.name} className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Tv className="w-5 h-5 text-amber-700" />
          </div>
        )}
      </div>

      <div className="flex-1 text-left min-w-0">
        <p className={`text-sm font-medium truncate ${isSelected ? 'text-amber-100' : 'text-amber-200'}`}>{channel.name}</p>
        <p className="text-xs text-amber-500 truncate">{channel.category}</p>
      </div>

      {channel.is_locked && <Lock className="w-4 h-4 text-amber-600 flex-shrink-0" />}

      {isSelected && !channel.is_locked && (
        <div className="flex gap-0.5 ml-2">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="w-1 bg-green-400 rounded-full animate-pulse"
              style={{ height: `${8 + i * 4}px`, animationDelay: `${i * 0.15}s` }}
            />
          ))}
        </div>
      )}
    </button>
  );
};

export default ChannelSidebar;
