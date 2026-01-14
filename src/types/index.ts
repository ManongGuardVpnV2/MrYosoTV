// Type definitions for PinoyTV

export interface User {
  id: string;
  email: string;
  username: string;
  device_fingerprint?: string;
  is_banned: boolean;
  is_admin: boolean;
  last_activity: string;
  current_channel?: string;
  created_at: string;
}

export interface Channel {
  id: string;
  name: string;
  category: string;
  stream_url: string;
  stream_type: 'mpd' | 'm3u8' | 'mp4' | 'youtube' | 'ts' | 'direct' | 'widevine';
  clearkey_kid?: string;
  clearkey_key?: string;
  license_url?: string;
  thumbnail_url?: string;
  is_locked: boolean;
  display_order: number;
  created_at: string;
}

export interface UserSession {
  id: string;
  user_id: string;
  device_fingerprint: string;
  is_active: boolean;
  created_at: string;
  last_seen: string;
}

export interface UserActivity {
  id: string;
  user_id: string;
  action: string;
  channel_id?: string;
  details?: Record<string, unknown>;
  created_at: string;
  user?: User;
  channel?: Channel;
}

export interface Notification {
  id: string;
  title: string;
  message: string;
  is_active: boolean;
  created_at: string;
}

export type Category = 'Cignal' | 'Converge' | 'Movies' | 'Kids' | 'News' | 'Sports' | 'Comedy' | 'Music' | 'Documentary';

export const CATEGORIES: Category[] = ['Cignal', 'Converge', 'Movies', 'Kids', 'News', 'Sports', 'Comedy', 'Music', 'Documentary'];

export const CATEGORY_COLORS: Record<Category, string> = {
  Cignal: 'from-purple-600 to-purple-800',
  Converge: 'from-blue-600 to-blue-800',
  Movies: 'from-red-600 to-red-800',
  Kids: 'from-orange-500 to-orange-700',
  News: 'from-green-600 to-green-800',
  Sports: 'from-red-700 to-red-900',
  Comedy: 'from-pink-600 to-pink-800',
  Music: 'from-cyan-600 to-cyan-800',
  Documentary: 'from-amber-700 to-amber-900'
};

export const CATEGORY_GEMS: Record<Category, string> = {
  Cignal: 'bg-gradient-to-br from-purple-400 via-purple-600 to-purple-900 shadow-purple-500/50',
  Converge: 'bg-gradient-to-br from-blue-400 via-blue-600 to-blue-900 shadow-blue-500/50',
  Movies: 'bg-gradient-to-br from-red-400 via-red-600 to-red-900 shadow-red-500/50',
  Kids: 'bg-gradient-to-br from-orange-400 via-orange-500 to-orange-700 shadow-orange-500/50',
  News: 'bg-gradient-to-br from-green-400 via-green-600 to-green-900 shadow-green-500/50',
  Sports: 'bg-gradient-to-br from-rose-400 via-rose-600 to-rose-900 shadow-rose-500/50',
  Comedy: 'bg-gradient-to-br from-pink-400 via-pink-600 to-pink-900 shadow-pink-500/50',
  Music: 'bg-gradient-to-br from-cyan-400 via-cyan-600 to-cyan-900 shadow-cyan-500/50',
  Documentary: 'bg-gradient-to-br from-amber-500 via-amber-700 to-amber-900 shadow-amber-500/50'
};
