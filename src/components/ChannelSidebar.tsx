import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Lock, ChevronRight, ChevronLeft, Search, Tv } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Channel, Category, CATEGORIES, CATEGORY_GEMS } from '@/types';

interface ChannelSidebarProps {
  selectedChannel: Channel | null;
  onChannelSelect: (channel: Channel) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

const BACKGROUND_IMAGE = 'https://d64gsuwffb70l.cloudfront.net/6966ff2969d41bac5afce556_1768357781130_1774fa95.jpg';

const ChannelSidebar: React.FC<ChannelSidebarProps> = ({
  selectedChannel,
  onChannelSelect,
  isCollapsed,
  onToggleCollapse
}) => {
  const [channels, setChannels] = useState<Channel[]>([]);
  // Default to "Cignal" and remove the "All" option
  const [selectedCategory, setSelectedCategory] = useState<Category>('Cignal');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);

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

  return (
    <>
      {/* Toggle Button */}
      <button
        onClick={onToggleCollapse}
        className={`fixed z-30 top-1/2 -translate-y-1/2 transition-all duration-300 bg-amber-800 hover:bg-amber-700 text-amber-100 p-2 rounded-l-lg shadow-lg ${
          isCollapsed ? 'right-0' : 'right-80 md:right-96'
        }`}
        style={{ boxShadow: '0 0 15px rgba(0,0,0,0.5)' }}
        type="button"
      >
        {isCollapsed ? <ChevronLeft className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
      </button>

      {/* Sidebar */}
      <div
        className={`fixed top-0 right-0 h-full z-20 transition-transform duration-300 ease-in-out ${
          isCollapsed ? 'translate-x-full' : 'translate-x-0'
        }`}
        style={{
          width: '320px',
          maxWidth: '100vw',
          // Gradient overlay on top of the provided "devil" background image
          backgroundImage: `linear-gradient(135deg, rgba(26,15,10,0.9) 0%, rgba(45,24,16,0.9) 50%, rgba(26,15,10,0.9) 100%), url('${BACKGROUND_IMAGE}')`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
          borderLeft: '3px solid #5d4037',
          boxShadow: '-10px 0 30px rgba(0,0,0,0.5)'
        }}
      >
        {/* Header */}
        <div 
          className="p-4 border-b border-amber-900/50"
          style={{
            background: 'linear-gradient(180deg, rgba(62,39,35,0.6) 0%, rgba(45,24,16,0.6) 100%)'
          }}
        >
          <div className="flex items-center gap-2 mb-4">
            <Tv className="w-6 h-6 text-amber-400" />
            <h2 className="text-xl font-bold text-amber-400" style={{ textShadow: '0 0 10px rgba(251, 191, 36, 0.5)' }}>
              Channels
            </h2>
          </div>

          {/* Search */}
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-amber-600" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search channels..."
              className="w-full pl-10 pr-4 py-2 bg-black/30 border border-amber-900/50 rounded-lg text-amber-100 placeholder-amber-700 focus:outline-none focus:border-amber-600 transition-colors text-sm"
            />
          </div>

          {/* Category Pills (removed 'All', default is Cignal) */}
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((category) => (
              <button
                key={category}
                onClick={() => setSelectedCategory(category)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all transform hover:scale-105 ${
                  selectedCategory === category
                    ? `${CATEGORY_GEMS[category]} text-white shadow-lg`
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
        <div 
          className="overflow-y-auto"
          style={{ height: 'calc(100% - 200px)' }}
        >
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
              {/* Alphabetical flat view for the selected single category (Cignal by default) */}
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
        <div 
          className="absolute bottom-0 left-0 right-0 p-3 border-t border-amber-900/50 text-center"
          style={{ background: 'linear-gradient(0deg, rgba(26,15,10,0.75) 0%, transparent 100%)' }}
        >
          <p className="text-amber-600 text-xs">
            {sortedChannels.length} channels in {selectedCategory}
          </p>
        </div>
      </div>
    </>
  );
};

// Channel Item Component
const ChannelItem: React.FC<{
  channel: Channel;
  isSelected: boolean;
  onSelect: (channel: Channel) => void;
}> = ({ channel, isSelected, onSelect }) => {
  return (
    <button
      onClick={() => !channel.is_locked && onSelect(channel)}
      disabled={channel.is_locked}
      className={`w-full flex items-center gap-3 p-2 rounded-lg transition-all duration-200 ${
        isSelected
          ? 'bg-gradient-to-r from-amber-700 to-amber-800 shadow-lg'
          : channel.is_locked
          ? 'bg-gray-900/50 cursor-not-allowed opacity-60'
          : 'bg-amber-950/30 hover:bg-amber-900/50'
      }`}
      style={isSelected ? { boxShadow: '0 0 15px rgba(251, 191, 36, 0.3)' } : {}}
      type="button"
    >
      {/* Thumbnail */}
      <div 
        className="w-14 h-10 rounded overflow-hidden flex-shrink-0 bg-amber-900/50"
        style={{ border: '2px solid #5d4037' }}
      >
        {channel.thumbnail_url ? (
          <img
            src={channel.thumbnail_url}
            alt={channel.name}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Tv className="w-5 h-5 text-amber-700" />
          </div>
        )}
      </div>

      {/* Channel Info */}
      <div className="flex-1 text-left min-w-0">
        <p className={`text-sm font-medium truncate ${isSelected ? 'text-amber-100' : 'text-amber-200'}`}>
          {channel.name}
        </p>
        <p className="text-xs text-amber-500 truncate">
          {channel.category}
        </p>
      </div>

      {/* Lock Icon */}
      {channel.is_locked && (
        <Lock className="w-4 h-4 text-amber-600 flex-shrink-0" />
      )}

      {/* Playing Indicator */}
      {isSelected && !channel.is_locked && (
        <div className="flex gap-0.5">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="w-1 bg-green-400 rounded-full animate-pulse"
              style={{
                height: `${8 + i * 4}px`,
                animationDelay: `${i * 0.15}s`
              }}
            />
          ))}
        </div>
      )}
    </button>
  );
};

export default ChannelSidebar;
