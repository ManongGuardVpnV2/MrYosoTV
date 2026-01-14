// src/contexts/AuthContext.tsx
import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { User } from "@/types";

/**
 * AuthContext - uses Supabase Auth for credential validation.
 *
 * Important:
 * - Signup uses supabase.auth.signUp(...) only. Do NOT insert into public.users from the client.
 * - A DB trigger (auth.users -> public.users) should auto-create a profile row.
 * - Login uses supabase.auth.signInWithPassword(...) to validate credentials.
 */

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string, deviceFingerprint: string) => Promise<{ success: boolean; error?: string }>;
  signup: (email: string, password: string, username: string, deviceFingerprint: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  updateActivity: (action: string, channelId?: string, details?: Record<string, unknown>) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Generate device fingerprint (kept from your original)
export const generateDeviceFingerprint = (): string => {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.textBaseline = "top";
    ctx.font = "14px Arial";
    ctx.fillText("PinoyTV", 2, 2);
  }
  const canvasData = canvas.toDataURL();
  const screenData = `${window.screen.width}x${window.screen.height}x${window.screen.colorDepth}`;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const language = navigator.language;
  const platform = navigator.platform;
  const combined = `${canvasData}-${screenData}-${timezone}-${language}-${platform}`;

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
    // Rehydrate user from localStorage (if any)
    const storedUser = localStorage.getItem("pinoytv_user");
    if (storedUser) {
      try {
        const parsedUser = JSON.parse(storedUser) as User;
        setUser(parsedUser);
        // update last_activity (best-effort, ignore errors)
        supabase
          .from("users")
          .update({ last_activity: new Date().toISOString() })
          .eq("id", parsedUser.id)
          .then(() => {});
      } catch {
        localStorage.removeItem("pinoytv_user");
        setUser(null);
      }
    }
    setIsLoading(false);

    // Optional: listen to auth changes to clear local state on sign out from other tab
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        setUser(null);
        localStorage.removeItem("pinoytv_user");
      }
    });
    return () => {
      listener?.subscription?.unsubscribe?.();
    };
  }, []);

  /**
   * LOGIN
   * - Authenticate using Supabase Auth (signInWithPassword)
   * - Then fetch profile from public.users (created by DB trigger)
   * - Check ban/device constraints
   * - Update last_activity and create a session row + activity log
   */
  const login = async (email: string, password: string, deviceFingerprint: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const normalizedEmail = email.trim().toLowerCase();

      // 1) Authenticate (password checked here)
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });

      if (authError || !authData?.user) {
        console.error("Supabase auth error:", authError);
        // don't leak specifics — keep UX-friendly message
        return { success: false, error: "Invalid email or password" };
      }

      const authUser = authData.user;

      // 2) Fetch the user's profile in public.users (trigger should have created it)
      const { data: profile, error: profileError } = await supabase
        .from("users")
        .select("*")
        .eq("id", authUser.id)
        .single();

      if (profileError || !profile) {
        console.error("Profile fetch error:", profileError);
        return { success: false, error: "User profile not found (contact support)" };
      }

      // 3) Check banned status
      if (profile.is_banned) {
        // Sign out from auth session for safety
        await supabase.auth.signOut();
        return { success: false, error: "Your account has been banned" };
      }

      // 4) Device lock: if profile has a device_fingerprint and differs from current, check active sessions
      if (profile.device_fingerprint && profile.device_fingerprint !== deviceFingerprint) {
        const { data: otherSessions, error: sessionsError } = await supabase
          .from("user_sessions")
          .select("*")
          .eq("user_id", profile.id)
          .eq("is_active", true)
          .neq("device_fingerprint", deviceFingerprint)
          .limit(1);

        if (sessionsError) {
          console.error("Error checking sessions:", sessionsError);
          // fallback: allow login (or block — choose your policy). We'll block to match your original design.
          return { success: false, error: "This account is already logged in on another device" };
        }

        if (otherSessions && otherSessions.length > 0) {
          // Logout the just-created auth session
          await supabase.auth.signOut();
          return { success: false, error: "This account is already logged in on another device" };
        }
      }

      // 5) Update user profile with device fingerprint + last_activity
      await supabase
        .from("users")
        .update({
          device_fingerprint: deviceFingerprint,
          last_activity: new Date().toISOString(),
        })
        .eq("id", profile.id);

      // 6) Insert a user session record (you may prefer upsert if you have a unique constraint)
      await supabase.from("user_sessions").insert({
        user_id: profile.id,
        device_fingerprint: deviceFingerprint,
        is_active: true,
        last_seen: new Date().toISOString(),
      });

      // 7) Log activity
      await supabase.from("user_activity").insert({
        user_id: profile.id,
        action: "login",
        details: { device: deviceFingerprint },
      });

      // 8) Persist profile locally for UI
      const loggedInUser: User = { ...profile, device_fingerprint: deviceFingerprint };
      setUser(loggedInUser);
      localStorage.setItem("pinoytv_user", JSON.stringify(loggedInUser));

      return { success: true };
    } catch (err: any) {
      console.error("Login error:", err);
      return { success: false, error: "An error occurred during login" };
    }
  };

  /**
   * SIGNUP
   * - Create auth user via supabase.auth.signUp(...)
   * - Do NOT insert into public.users here if you use DB trigger; the trigger will create the profile.
   * - Return success/failure to the caller.
   */
  const signup = async (email: string, password: string, username: string, deviceFingerprint: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const normalizedEmail = email.trim().toLowerCase();

      // Create auth user
      const { data, error } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
      });

      if (error) {
        console.error("Supabase signUp error:", error);
        return { success: false, error: error.message || "Signup failed" };
      }

      // At this point auth user is created. If you have confirmation enabled, user must confirm their email.
      // The DB trigger (if configured) will create the public.users profile automatically.
      // We do not create public.users from the client to avoid RLS/security issues.

      return { success: true };
    } catch (err: any) {
      console.error("Signup crashed:", err);
      return { success: false, error: "An error occurred during signup" };
    }
  };

  /**
   * LOGOUT
   */
  const logout = async () => {
    try {
      if (user) {
        // Deactivate all sessions for this user on this device (best-effort)
        await supabase
          .from("user_sessions")
          .update({ is_active: false })
          .eq("user_id", user.id)
          .eq("device_fingerprint", user.device_fingerprint || null);

        // Log activity
        await supabase
          .from("user_activity")
          .insert({
            user_id: user.id,
            action: "logout",
          });
      }
    } catch (err) {
      console.error("Logout cleanup error:", err);
    } finally {
      // Sign out from Supabase Auth client
      try {
        await supabase.auth.signOut();
      } catch (er) {
        console.warn("Supabase signOut error:", er);
      }
      setUser(null);
      localStorage.removeItem("pinoytv_user");
    }
  };

  /**
   * updateActivity: helper to log actions and update user row
   */
  const updateActivity = async (action: string, channelId?: string, details?: Record<string, unknown>) => {
    if (!user) return;
    try {
      await supabase.from("user_activity").insert({
        user_id: user.id,
        action,
        channel_id: channelId || null,
        details: details || null,
      });

      await supabase.from("users").update({
        last_activity: new Date().toISOString(),
        current_channel: channelId || null,
      }).eq("id", user.id);
    } catch (err) {
      console.error("updateActivity error:", err);
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
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
