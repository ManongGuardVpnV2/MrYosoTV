import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { User } from '@/types';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string, deviceFingerprint: string) => Promise<{ success: boolean; error?: string }>;
  signup: (email: string, password: string, username: string, deviceFingerprint: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  updateActivity: (action: string, channelId?: string, details?: Record<string, unknown>) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Generate device fingerprint
export const generateDeviceFingerprint = (): string => {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.textBaseline = 'top';
    ctx.font = '14px Arial';
    ctx.fillText('PinoyTV', 2, 2);
  }
  const canvasData = canvas.toDataURL();
  
  const screenData = `${window.screen.width}x${window.screen.height}x${window.screen.colorDepth}`;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const language = navigator.language;
  const platform = navigator.platform;
  
  const combined = `${canvasData}-${screenData}-${timezone}-${language}-${platform}`;
  
  // Simple hash function
  let hash = 0;
  for (let i = 0; i < combined.length; i++) {
    const char = combined.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  
  return Math.abs(hash).toString(36) + Date.now().toString(36);
};

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Check for stored session
    const storedUser = localStorage.getItem('pinoytv_user');
    if (storedUser) {
      try {
        const parsedUser = JSON.parse(storedUser);
        setUser(parsedUser);
        // Update last activity
        supabase
          .from('users')
          .update({ last_activity: new Date().toISOString() })
          .eq('id', parsedUser.id)
          .then(() => {});
      } catch {
        localStorage.removeItem('pinoytv_user');
      }
    }
    setIsLoading(false);
  }, []);

  const login = async (email: string, password: string, deviceFingerprint: string): Promise<{ success: boolean; error?: string }> => {
    try {
      // Find user
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('*')
        .eq('email', email.toLowerCase())
        .single();

      if (userError || !userData) {
        return { success: false, error: 'Invalid email or password' };
      }

      // Check password (simple comparison for demo - in production use bcrypt)
      if (userData.password_hash !== password) {
        return { success: false, error: 'Invalid email or password' };
      }

      // Check if banned
      if (userData.is_banned) {
        return { success: false, error: 'Your account has been banned' };
      }

      // Check device fingerprint (one account per device)
      if (userData.device_fingerprint && userData.device_fingerprint !== deviceFingerprint) {
        // Check if there's an active session on another device
        const { data: sessions } = await supabase
          .from('user_sessions')
          .select('*')
          .eq('user_id', userData.id)
          .eq('is_active', true)
          .neq('device_fingerprint', deviceFingerprint);

        if (sessions && sessions.length > 0) {
          return { success: false, error: 'This account is already logged in on another device' };
        }
      }

      // Update user with device fingerprint
      await supabase
        .from('users')
        .update({ 
          device_fingerprint: deviceFingerprint,
          last_activity: new Date().toISOString()
        })
        .eq('id', userData.id);

      // Create session
      await supabase
        .from('user_sessions')
        .upsert({
          user_id: userData.id,
          device_fingerprint: deviceFingerprint,
          is_active: true,
          last_seen: new Date().toISOString()
        });

      // Log activity
      await supabase
        .from('user_activity')
        .insert({
          user_id: userData.id,
          action: 'login',
          details: { device: deviceFingerprint }
        });

      const loggedInUser = { ...userData, device_fingerprint: deviceFingerprint };
      setUser(loggedInUser);
      localStorage.setItem('pinoytv_user', JSON.stringify(loggedInUser));

      return { success: true };
    } catch (error) {
      console.error('Login error:', error);
      return { success: false, error: 'An error occurred during login' };
    }
  };

  const signup = async (email: string, password: string, username: string, deviceFingerprint: string): Promise<{ success: boolean; error?: string }> => {
    try {
      // Check if email exists
      const { data: existingUser } = await supabase
        .from('users')
        .select('id')
        .eq('email', email.toLowerCase())
        .single();

      if (existingUser) {
        return { success: false, error: 'Email already registered' };
      }

      // Create user
      const { data: newUser, error: createError } = await supabase
        .from('users')
        .insert({
          email: email.toLowerCase(),
          password_hash: password, // In production, hash this
          username,
          device_fingerprint: deviceFingerprint,
          is_banned: false,
          is_admin: false,
          last_activity: new Date().toISOString()
        })
        .select()
        .single();

      if (createError || !newUser) {
        return { success: false, error: 'Failed to create account' };
      }

      // Create session
      await supabase
        .from('user_sessions')
        .insert({
          user_id: newUser.id,
          device_fingerprint: deviceFingerprint,
          is_active: true
        });

      // Log activity
      await supabase
        .from('user_activity')
        .insert({
          user_id: newUser.id,
          action: 'signup',
          details: { device: deviceFingerprint }
        });

      setUser(newUser);
      localStorage.setItem('pinoytv_user', JSON.stringify(newUser));

      return { success: true };
    } catch (error) {
      console.error('Signup error:', error);
      return { success: false, error: 'An error occurred during signup' };
    }
  };

  const logout = async () => {
    if (user) {
      // Deactivate session
      await supabase
        .from('user_sessions')
        .update({ is_active: false })
        .eq('user_id', user.id);

      // Log activity
      await supabase
        .from('user_activity')
        .insert({
          user_id: user.id,
          action: 'logout'
        });
    }

    setUser(null);
    localStorage.removeItem('pinoytv_user');
  };

  const updateActivity = async (action: string, channelId?: string, details?: Record<string, unknown>) => {
    if (user) {
      await supabase
        .from('user_activity')
        .insert({
          user_id: user.id,
          action,
          channel_id: channelId,
          details
        });

      await supabase
        .from('users')
        .update({ 
          last_activity: new Date().toISOString(),
          current_channel: channelId || null
        })
        .eq('id', user.id);
    }
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, login, signup, logout, updateActivity }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
