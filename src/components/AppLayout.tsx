import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import EnchantedAuth from './EnchantedAuth';
import MainApp from './MainApp';

// Security utilities
const SecurityLayer: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  useEffect(() => {
    // Anti-DevTools detection (disabled for development - enable in production)
    const detectDevTools = () => {
      const threshold = 160;
      const widthThreshold = window.outerWidth - window.innerWidth > threshold;
      const heightThreshold = window.outerHeight - window.innerHeight > threshold;
      
      if (widthThreshold || heightThreshold) {
        // DevTools detected - you can add custom handling here
        // console.clear();
      }
    };

    // Disable right-click context menu
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    // Disable keyboard shortcuts for DevTools
    const handleKeyDown = (e: KeyboardEvent) => {
      // F12
      if (e.key === 'F12') {
        e.preventDefault();
      }
      // Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+Shift+C
      if (e.ctrlKey && e.shiftKey && ['I', 'J', 'C'].includes(e.key)) {
        e.preventDefault();
      }
      // Ctrl+U (view source)
      if (e.ctrlKey && e.key === 'u') {
        e.preventDefault();
      }
    };

    // Add event listeners
    window.addEventListener('resize', detectDevTools);
    document.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('keydown', handleKeyDown);

    // Initial check
    detectDevTools();

    return () => {
      window.removeEventListener('resize', detectDevTools);
      document.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  return <>{children}</>;
};

// Main App Content with Auth Check
const AppContent: React.FC = () => {
  const { user, isLoading } = useAuth();
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    if (user && !user.is_banned) {
      setIsAuthenticated(true);
    } else {
      setIsAuthenticated(false);
    }
  }, [user]);

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-amber-950 via-stone-900 to-amber-950 flex items-center justify-center">
        <div className="text-center">
          <div className="flex gap-1 justify-center mb-4">
            {'PINOYTV'.split('').map((letter, i) => (
              <span 
                key={i}
                className="text-4xl md:text-6xl font-bold text-amber-400 animate-bounce"
                style={{ 
                  animationDelay: `${i * 0.1}s`,
                  textShadow: '0 0 20px rgba(251, 191, 36, 0.8)'
                }}
              >
                {letter}
              </span>
            ))}
          </div>
          <p className="text-amber-300/60 animate-pulse">Loading...</p>
        </div>
      </div>
    );
  }

  // Banned user
  if (user?.is_banned) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-950 via-stone-900 to-red-950 flex items-center justify-center p-4">
        <div className="text-center max-w-md">
          <div className="w-24 h-24 mx-auto mb-6 rounded-full bg-red-900/50 flex items-center justify-center">
            <svg className="w-12 h-12 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-red-400 mb-4">Account Banned</h1>
          <p className="text-red-300/70 mb-6">
            Your account has been suspended. Please contact support if you believe this is an error.
          </p>
          <button
            onClick={() => {
              localStorage.removeItem('pinoytv_user');
              window.location.reload();
            }}
            className="px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
          >
            Return to Login
          </button>
        </div>
      </div>
    );
  }

  // Show auth or main app
  return isAuthenticated ? (
    <MainApp />
  ) : (
    <EnchantedAuth onAuthSuccess={() => setIsAuthenticated(true)} />
  );
};

// Root Layout Component
const AppLayout: React.FC = () => {
  return (
    <SecurityLayer>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </SecurityLayer>
  );
};

export default AppLayout;
