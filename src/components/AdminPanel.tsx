import React, { useState, useEffect, useCallback } from 'react';
import { 
  Users, Tv, Bell, Plus, Trash2, Lock, Unlock, Ban, 
  CheckCircle, X, Eye, Activity, Settings, LogOut, Edit2, Save
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { User, Channel, UserActivity, Notification, CATEGORIES, Category } from '@/types';
import { useAuth } from '@/contexts/AuthContext';

interface AdminPanelProps {
  onClose: () => void;
}

type Tab = 'channels' | 'users' | 'activity' | 'notifications';

const AdminPanel: React.FC<AdminPanelProps> = ({ onClose }) => {
  const { logout } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>('channels');
  const [channels, setChannels] = useState<Channel[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [activities, setActivities] = useState<UserActivity[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAddChannel, setShowAddChannel] = useState(false);
  const [showAddNotification, setShowAddNotification] = useState(false);
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null);

  // Channel form state
  const [channelForm, setChannelForm] = useState({
    name: '',
    category: 'Cignal' as Category,
    stream_url: '',
    stream_type: 'm3u8' as Channel['stream_type'],
    clearkey_kid: '',
    clearkey_key: '',
    license_url: '',
    thumbnail_url: '',
    is_locked: false
  });

  // Notification form state
  const [notificationForm, setNotificationForm] = useState({
    title: '',
    message: ''
  });

  // Fetch data
  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [channelsRes, usersRes, activitiesRes, notificationsRes] = await Promise.all([
        supabase.from('channels').select('*').order('category').order('display_order'),
        supabase.from('users').select('*').order('created_at', { ascending: false }),
        supabase.from('user_activity').select('*, users(username, email), channels(name)').order('created_at', { ascending: false }).limit(100),
        supabase.from('notifications').select('*').order('created_at', { ascending: false })
      ]);

      if (channelsRes.data) setChannels(channelsRes.data);
      if (usersRes.data) setUsers(usersRes.data);
      if (activitiesRes.data) setActivities(activitiesRes.data as any);
      if (notificationsRes.data) setNotifications(notificationsRes.data);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();

    // Real-time subscriptions
    const activitySubscription = supabase
      .channel('activity_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_activity' }, () => {
        fetchData();
      })
      .subscribe();

    return () => {
      activitySubscription.unsubscribe();
    };
  }, [fetchData]);

  // Channel operations
  const handleAddChannel = async () => {
    try {
      const { error } = await supabase.from('channels').insert({
        ...channelForm,
        display_order: channels.length + 1
      });

      if (error) throw error;

      setShowAddChannel(false);
      resetChannelForm();
      fetchData();
    } catch (error) {
      console.error('Error adding channel:', error);
    }
  };

  const handleUpdateChannel = async () => {
    if (!editingChannel) return;

    try {
      const { error } = await supabase
        .from('channels')
        .update(channelForm)
        .eq('id', editingChannel.id);

      if (error) throw error;

      setEditingChannel(null);
      resetChannelForm();
      fetchData();
    } catch (error) {
      console.error('Error updating channel:', error);
    }
  };

  const handleDeleteChannel = async (id: string) => {
    if (!confirm('Are you sure you want to delete this channel?')) return;

    try {
      const { error } = await supabase.from('channels').delete().eq('id', id);
      if (error) throw error;
      fetchData();
    } catch (error) {
      console.error('Error deleting channel:', error);
    }
  };

  const handleToggleLock = async (channel: Channel) => {
    try {
      const { error } = await supabase
        .from('channels')
        .update({ is_locked: !channel.is_locked })
        .eq('id', channel.id);

      if (error) throw error;
      fetchData();
    } catch (error) {
      console.error('Error toggling lock:', error);
    }
  };

  const resetChannelForm = () => {
    setChannelForm({
      name: '',
      category: 'Cignal',
      stream_url: '',
      stream_type: 'm3u8',
      clearkey_kid: '',
      clearkey_key: '',
      license_url: '',
      thumbnail_url: '',
      is_locked: false
    });
  };

  // User operations
  const handleToggleBan = async (user: User) => {
    try {
      const { error } = await supabase
        .from('users')
        .update({ is_banned: !user.is_banned })
        .eq('id', user.id);

      if (error) throw error;
      fetchData();
    } catch (error) {
      console.error('Error toggling ban:', error);
    }
  };

  // Notification operations
  const handleAddNotification = async () => {
    try {
      const { error } = await supabase.from('notifications').insert({
        ...notificationForm,
        is_active: true
      });

      if (error) throw error;

      setShowAddNotification(false);
      setNotificationForm({ title: '', message: '' });
      fetchData();
    } catch (error) {
      console.error('Error adding notification:', error);
    }
  };

  const handleDeleteNotification = async (id: string) => {
    try {
      const { error } = await supabase.from('notifications').delete().eq('id', id);
      if (error) throw error;
      fetchData();
    } catch (error) {
      console.error('Error deleting notification:', error);
    }
  };

  const startEditChannel = (channel: Channel) => {
    setEditingChannel(channel);
    setChannelForm({
      name: channel.name,
      category: channel.category as Category,
      stream_url: channel.stream_url,
      stream_type: channel.stream_type,
      clearkey_kid: channel.clearkey_kid || '',
      clearkey_key: channel.clearkey_key || '',
      license_url: channel.license_url || '',
      thumbnail_url: channel.thumbnail_url || '',
      is_locked: channel.is_locked
    });
  };

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'channels', label: 'Channels', icon: <Tv className="w-4 h-4" /> },
    { id: 'users', label: 'Users', icon: <Users className="w-4 h-4" /> },
    { id: 'activity', label: 'Activity', icon: <Activity className="w-4 h-4" /> },
    { id: 'notifications', label: 'Notifications', icon: <Bell className="w-4 h-4" /> }
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm overflow-auto">
      <div className="min-h-screen p-4 md:p-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Settings className="w-8 h-8 text-amber-400" />
            <h1 className="text-2xl md:text-3xl font-bold text-amber-400">Admin Panel</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { logout(); onClose(); }}
              className="flex items-center gap-2 px-4 py-2 bg-red-600/20 text-red-400 rounded-lg hover:bg-red-600/30 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">Logout</span>
            </button>
            <button
              onClick={onClose}
              className="p-2 text-amber-400 hover:bg-amber-900/50 rounded-lg transition-colors"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex flex-wrap gap-2 mb-6 border-b border-amber-900/50 pb-4">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all ${
                activeTab === tab.id
                  ? 'bg-amber-600 text-white'
                  : 'bg-amber-900/30 text-amber-300 hover:bg-amber-900/50'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <div className="flex gap-1">
              {'LOADING'.split('').map((letter, i) => (
                <span 
                  key={i}
                  className="text-2xl font-bold text-amber-400 animate-bounce"
                  style={{ animationDelay: `${i * 0.1}s` }}
                >
                  {letter}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <>
            {/* Channels Tab */}
            {activeTab === 'channels' && (
              <div>
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-xl text-amber-200">Manage Channels ({channels.length})</h2>
                  <button
                    onClick={() => setShowAddChannel(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    Add Channel
                  </button>
                </div>

                {/* Channel Form Modal */}
                {(showAddChannel || editingChannel) && (
                  <div className="fixed inset-0 z-60 bg-black/80 flex items-center justify-center p-4">
                    <div className="bg-amber-950 rounded-xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-amber-800">
                      <h3 className="text-xl font-bold text-amber-400 mb-4">
                        {editingChannel ? 'Edit Channel' : 'Add New Channel'}
                      </h3>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-amber-300 text-sm mb-1">Name</label>
                          <input
                            type="text"
                            value={channelForm.name}
                            onChange={(e) => setChannelForm({ ...channelForm, name: e.target.value })}
                            className="w-full px-3 py-2 bg-black/30 border border-amber-800 rounded-lg text-amber-100"
                          />
                        </div>

                        <div>
                          <label className="block text-amber-300 text-sm mb-1">Category</label>
                          <select
                            value={channelForm.category}
                            onChange={(e) => setChannelForm({ ...channelForm, category: e.target.value as Category })}
                            className="w-full px-3 py-2 bg-black/30 border border-amber-800 rounded-lg text-amber-100"
                          >
                            {CATEGORIES.map((cat) => (
                              <option key={cat} value={cat}>{cat}</option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="block text-amber-300 text-sm mb-1">Stream Type</label>
                          <select
                            value={channelForm.stream_type}
                            onChange={(e) => setChannelForm({ ...channelForm, stream_type: e.target.value as Channel['stream_type'] })}
                            className="w-full px-3 py-2 bg-black/30 border border-amber-800 rounded-lg text-amber-100"
                          >
                            <option value="m3u8">M3U8 (HLS)</option>
                            <option value="mpd">MPD (DASH)</option>
                            <option value="mp4">MP4</option>
                            <option value="youtube">YouTube</option>
                            <option value="ts">TS</option>
                            <option value="direct">Direct</option>
                            <option value="widevine">Widevine</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-amber-300 text-sm mb-1">Thumbnail URL</label>
                          <input
                            type="text"
                            value={channelForm.thumbnail_url}
                            onChange={(e) => setChannelForm({ ...channelForm, thumbnail_url: e.target.value })}
                            className="w-full px-3 py-2 bg-black/30 border border-amber-800 rounded-lg text-amber-100"
                          />
                        </div>

                        <div className="md:col-span-2">
                          <label className="block text-amber-300 text-sm mb-1">Stream URL</label>
                          <input
                            type="text"
                            value={channelForm.stream_url}
                            onChange={(e) => setChannelForm({ ...channelForm, stream_url: e.target.value })}
                            className="w-full px-3 py-2 bg-black/30 border border-amber-800 rounded-lg text-amber-100"
                          />
                        </div>

                        {channelForm.stream_type === 'mpd' && (
                          <>
                            <div>
                              <label className="block text-amber-300 text-sm mb-1">ClearKey KID</label>
                              <input
                                type="text"
                                value={channelForm.clearkey_kid}
                                onChange={(e) => setChannelForm({ ...channelForm, clearkey_kid: e.target.value })}
                                className="w-full px-3 py-2 bg-black/30 border border-amber-800 rounded-lg text-amber-100"
                                placeholder="Key ID (hex)"
                              />
                            </div>
                            <div>
                              <label className="block text-amber-300 text-sm mb-1">ClearKey Key</label>
                              <input
                                type="text"
                                value={channelForm.clearkey_key}
                                onChange={(e) => setChannelForm({ ...channelForm, clearkey_key: e.target.value })}
                                className="w-full px-3 py-2 bg-black/30 border border-amber-800 rounded-lg text-amber-100"
                                placeholder="Key (hex)"
                              />
                            </div>
                          </>
                        )}

                        {channelForm.stream_type === 'widevine' && (
                          <div className="md:col-span-2">
                            <label className="block text-amber-300 text-sm mb-1">License URL</label>
                            <input
                              type="text"
                              value={channelForm.license_url}
                              onChange={(e) => setChannelForm({ ...channelForm, license_url: e.target.value })}
                              className="w-full px-3 py-2 bg-black/30 border border-amber-800 rounded-lg text-amber-100"
                            />
                          </div>
                        )}

                        <div className="md:col-span-2">
                          <label className="flex items-center gap-2 text-amber-300">
                            <input
                              type="checkbox"
                              checked={channelForm.is_locked}
                              onChange={(e) => setChannelForm({ ...channelForm, is_locked: e.target.checked })}
                              className="w-4 h-4"
                            />
                            Lock Channel
                          </label>
                        </div>
                      </div>

                      <div className="flex justify-end gap-3 mt-6">
                        <button
                          onClick={() => { setShowAddChannel(false); setEditingChannel(null); resetChannelForm(); }}
                          className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={editingChannel ? handleUpdateChannel : handleAddChannel}
                          className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700"
                        >
                          <Save className="w-4 h-4" />
                          {editingChannel ? 'Update' : 'Save'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Channels Table */}
                <div className="bg-amber-950/50 rounded-xl overflow-hidden border border-amber-900/50">
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="bg-amber-900/50">
                          <th className="px-4 py-3 text-left text-amber-300 text-sm">Name</th>
                          <th className="px-4 py-3 text-left text-amber-300 text-sm">Category</th>
                          <th className="px-4 py-3 text-left text-amber-300 text-sm">Type</th>
                          <th className="px-4 py-3 text-left text-amber-300 text-sm">Status</th>
                          <th className="px-4 py-3 text-right text-amber-300 text-sm">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {channels.map((channel) => (
                          <tr key={channel.id} className="border-t border-amber-900/30 hover:bg-amber-900/20">
                            <td className="px-4 py-3 text-amber-100">{channel.name}</td>
                            <td className="px-4 py-3 text-amber-300">{channel.category}</td>
                            <td className="px-4 py-3 text-amber-300 uppercase text-xs">{channel.stream_type}</td>
                            <td className="px-4 py-3">
                              {channel.is_locked ? (
                                <span className="flex items-center gap-1 text-red-400 text-sm">
                                  <Lock className="w-3 h-3" /> Locked
                                </span>
                              ) : (
                                <span className="flex items-center gap-1 text-green-400 text-sm">
                                  <Unlock className="w-3 h-3" /> Active
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex justify-end gap-2">
                                <button
                                  onClick={() => startEditChannel(channel)}
                                  className="p-2 text-blue-400 hover:bg-blue-900/30 rounded-lg"
                                >
                                  <Edit2 className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => handleToggleLock(channel)}
                                  className={`p-2 rounded-lg ${channel.is_locked ? 'text-green-400 hover:bg-green-900/30' : 'text-yellow-400 hover:bg-yellow-900/30'}`}
                                >
                                  {channel.is_locked ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                                </button>
                                <button
                                  onClick={() => handleDeleteChannel(channel.id)}
                                  className="p-2 text-red-400 hover:bg-red-900/30 rounded-lg"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* Users Tab */}
            {activeTab === 'users' && (
              <div>
                <h2 className="text-xl text-amber-200 mb-4">Manage Users ({users.length})</h2>
                <div className="bg-amber-950/50 rounded-xl overflow-hidden border border-amber-900/50">
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="bg-amber-900/50">
                          <th className="px-4 py-3 text-left text-amber-300 text-sm">Username</th>
                          <th className="px-4 py-3 text-left text-amber-300 text-sm">Email</th>
                          <th className="px-4 py-3 text-left text-amber-300 text-sm">Status</th>
                          <th className="px-4 py-3 text-left text-amber-300 text-sm">Last Activity</th>
                          <th className="px-4 py-3 text-left text-amber-300 text-sm">Watching</th>
                          <th className="px-4 py-3 text-right text-amber-300 text-sm">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {users.map((user) => (
                          <tr key={user.id} className="border-t border-amber-900/30 hover:bg-amber-900/20">
                            <td className="px-4 py-3 text-amber-100">
                              {user.username}
                              {user.is_admin && (
                                <span className="ml-2 px-2 py-0.5 bg-amber-600 text-white text-xs rounded">Admin</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-amber-300">{user.email}</td>
                            <td className="px-4 py-3">
                              {user.is_banned ? (
                                <span className="flex items-center gap-1 text-red-400 text-sm">
                                  <Ban className="w-3 h-3" /> Banned
                                </span>
                              ) : (
                                <span className="flex items-center gap-1 text-green-400 text-sm">
                                  <CheckCircle className="w-3 h-3" /> Active
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-amber-400 text-sm">
                              {new Date(user.last_activity).toLocaleString()}
                            </td>
                            <td className="px-4 py-3 text-amber-300 text-sm">
                              {user.current_channel ? (
                                <span className="flex items-center gap-1">
                                  <Eye className="w-3 h-3 text-green-400" />
                                  Watching
                                </span>
                              ) : '-'}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex justify-end gap-2">
                                {!user.is_admin && (
                                  <button
                                    onClick={() => handleToggleBan(user)}
                                    className={`p-2 rounded-lg ${user.is_banned ? 'text-green-400 hover:bg-green-900/30' : 'text-red-400 hover:bg-red-900/30'}`}
                                  >
                                    {user.is_banned ? <CheckCircle className="w-4 h-4" /> : <Ban className="w-4 h-4" />}
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* Activity Tab */}
            {activeTab === 'activity' && (
              <div>
                <h2 className="text-xl text-amber-200 mb-4">User Activity Log</h2>
                <div className="bg-amber-950/50 rounded-xl overflow-hidden border border-amber-900/50">
                  <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
                    <table className="w-full">
                      <thead className="sticky top-0 bg-amber-900/90">
                        <tr>
                          <th className="px-4 py-3 text-left text-amber-300 text-sm">Time</th>
                          <th className="px-4 py-3 text-left text-amber-300 text-sm">User</th>
                          <th className="px-4 py-3 text-left text-amber-300 text-sm">Action</th>
                          <th className="px-4 py-3 text-left text-amber-300 text-sm">Details</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activities.map((activity) => (
                          <tr key={activity.id} className="border-t border-amber-900/30 hover:bg-amber-900/20">
                            <td className="px-4 py-3 text-amber-400 text-sm">
                              {new Date(activity.created_at).toLocaleString()}
                            </td>
                            <td className="px-4 py-3 text-amber-100">
                              {(activity as any).users?.username || 'Unknown'}
                            </td>
                            <td className="px-4 py-3">
                              <span className={`px-2 py-1 rounded text-xs font-medium ${
                                activity.action === 'login' ? 'bg-green-900/50 text-green-300' :
                                activity.action === 'logout' ? 'bg-gray-900/50 text-gray-300' :
                                activity.action === 'watch' ? 'bg-blue-900/50 text-blue-300' :
                                'bg-amber-900/50 text-amber-300'
                              }`}>
                                {activity.action}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-amber-300 text-sm">
                              {(activity as any).channels?.name || (activity.details ? JSON.stringify(activity.details) : '-')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* Notifications Tab */}
            {activeTab === 'notifications' && (
              <div>
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-xl text-amber-200">Notifications ({notifications.length})</h2>
                  <button
                    onClick={() => setShowAddNotification(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    Add Notification
                  </button>
                </div>

                {/* Add Notification Modal */}
                {showAddNotification && (
                  <div className="fixed inset-0 z-60 bg-black/80 flex items-center justify-center p-4">
                    <div className="bg-amber-950 rounded-xl p-6 max-w-md w-full border border-amber-800">
                      <h3 className="text-xl font-bold text-amber-400 mb-4">Add Notification</h3>
                      
                      <div className="space-y-4">
                        <div>
                          <label className="block text-amber-300 text-sm mb-1">Title</label>
                          <input
                            type="text"
                            value={notificationForm.title}
                            onChange={(e) => setNotificationForm({ ...notificationForm, title: e.target.value })}
                            className="w-full px-3 py-2 bg-black/30 border border-amber-800 rounded-lg text-amber-100"
                          />
                        </div>
                        <div>
                          <label className="block text-amber-300 text-sm mb-1">Message</label>
                          <textarea
                            value={notificationForm.message}
                            onChange={(e) => setNotificationForm({ ...notificationForm, message: e.target.value })}
                            rows={3}
                            className="w-full px-3 py-2 bg-black/30 border border-amber-800 rounded-lg text-amber-100"
                          />
                        </div>
                      </div>

                      <div className="flex justify-end gap-3 mt-6">
                        <button
                          onClick={() => setShowAddNotification(false)}
                          className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleAddNotification}
                          className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700"
                        >
                          Send
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Notifications List */}
                <div className="space-y-3">
                  {notifications.map((notification) => (
                    <div
                      key={notification.id}
                      className="bg-amber-950/50 rounded-xl p-4 border border-amber-900/50 flex justify-between items-start"
                    >
                      <div>
                        <h3 className="text-amber-100 font-medium">{notification.title}</h3>
                        <p className="text-amber-300 text-sm mt-1">{notification.message}</p>
                        <p className="text-amber-600 text-xs mt-2">
                          {new Date(notification.created_at).toLocaleString()}
                        </p>
                      </div>
                      <button
                        onClick={() => handleDeleteNotification(notification.id)}
                        className="p-2 text-red-400 hover:bg-red-900/30 rounded-lg"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default AdminPanel;
