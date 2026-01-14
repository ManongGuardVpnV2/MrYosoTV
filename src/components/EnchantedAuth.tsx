import React, { useState, useEffect } from "react";
import { Lock, Unlock, Eye, EyeOff, Sparkles, X } from "lucide-react";
import { useAuth, generateDeviceFingerprint } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";


const DEVIL_BOOK =
  "https://d64gsuwffb70l.cloudfront.net/6966ff2969d41bac5afce556_1768357781130_1774fa95.jpg";
const ANGEL_BOOK =
  "https://d64gsuwffb70l.cloudfront.net/6966ff2969d41bac5afce556_1768357798348_299e5440.jpg";
const PADLOCK =
  "https://d64gsuwffb70l.cloudfront.net/6966ff2969d41bac5afce556_1768357839315_79c82324.png";
const FOREST_BG =
  "https://d64gsuwffb70l.cloudfront.net/6966ff2969d41bac5afce556_1768357818222_990606db.jpg";

interface EnchantedAuthProps {
  onAuthSuccess: () => void;
}

const EnchantedAuth: React.FC<EnchantedAuthProps> = ({ onAuthSuccess }) => {
  const { login } = useAuth();
  const [showModal, setShowModal] = useState(false);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "signup" | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [bookAnimation, setBookAnimation] = useState<"devil" | "angel" | null>(
    null
  );
  const [particles, setParticles] = useState<
    Array<{ id: number; x: number; y: number; delay: number }>
  >([]);

  // Form states
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  useEffect(() => {
    // Generate floating particles
    const newParticles = Array.from({ length: 30 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 100,
      delay: Math.random() * 5,
    }));
    setParticles(newParticles);
  }, []);

  const handlePadlockClick = () => {
    if (!isUnlocked) {
      setShowModal(true);
    }
  };

  const handleQuestionAnswer = (answer: "yes" | "no") => {
    if (answer === "yes") {
      setIsUnlocked(true);
      setShowModal(false);
    } else {
      setError("Mali ang sagot! Subukan muli.");
      setTimeout(() => setError(""), 2000);
    }
  };

  const handleBookClick = (book: "devil" | "angel") => {
    if (!isUnlocked) {
      setShowModal(true);
      return;
    }
    setBookAnimation(book);
    setTimeout(() => {
      setAuthMode(book === "angel" ? "login" : "signup");
      setSuccessMessage("");
      setError("");
    }, 800);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccessMessage("");
    setIsLoading(true);

    const deviceFingerprint = generateDeviceFingerprint();

    try {
      if (authMode === "signup") {
        // Validation
        if (password !== confirmPassword) {
          setError("Passwords do not match");
          setIsLoading(false);
          return;
        }
        if (password.length < 6) {
          setError("Password must be at least 6 characters");
          setIsLoading(false);
          return;
        }
        if (!username || username.trim().length === 0) {
          setError("Username is required");
          setIsLoading(false);
          return;
        }

        // 1) Create Auth user
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
        });

        if (signUpError) {
          console.error("Supabase signUp error:", signUpError);
          setError(signUpError.message || "Signup failed");
          setIsLoading(false);
          return;
        }

        const authUser = (data as any)?.user ?? null;
        if (!authUser || !authUser.id) {
          setError("Signup failed: no user returned from auth");
          setIsLoading(false);
          return;
        }

        // 2) Insert into public.users table so admin panel and other code see this user
        // Note: we store a sentinel in password_hash to indicate Auth-managed password
        const { error: insertError } = await supabase.from("users").insert({
          id: authUser.id,
          email: authUser.email,
          username: username,
          password_hash: "supabase",
          device_fingerprint: deviceFingerprint || null,
          is_admin: false,
          is_banned: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });

        if (insertError) {
          // If the insert fails because row already exists, we allow signup but show message.
          console.error("Insert into users table failed:", insertError);
          // If it's a unique violation, show a friendly message
          if (
            insertError.code === "23505" ||
            /duplicate/i.test(insertError.message || "")
          ) {
            setSuccessMessage(
              "Account created. A user record already existed — please log in."
            );
          } else {
            setError(
              insertError.message ||
                "Failed to create user record — contact support."
            );
            setIsLoading(false);
            return;
          }
        } else {
          setSuccessMessage(
            "Account created successfully! Please log in to continue."
          );
        }

        // 3) After signup, DO NOT auto-login — switch to login form per your request
        setAuthMode("login");
        // Keep the email prefilled and clear password fields for login
        setPassword("");
        setConfirmPassword("");
        // Optionally focusable: set a small delay then show message
      } else {
        // LOGIN flow uses useAuth().login for existing login logic
        const result = await login(email, password, deviceFingerprint);
        if (result.success) {
          onAuthSuccess();
        } else {
          setError(result.error || "Login failed");
        }
      }
    } catch (err: any) {
      console.error("Auth handler error:", err);
      setError(err?.message || "An unexpected error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  const closeAuthForm = () => {
    setAuthMode(null);
    setBookAnimation(null);
    setEmail("");
    setPassword("");
    setUsername("");
    setConfirmPassword("");
    setError("");
    setSuccessMessage("");
  };

  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* 3D Forest Background */}
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{
          backgroundImage: `url(${FOREST_BG})`,
          transform: "scale(1.1)",
        }}
      />

      {/* Overlay with gradient */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/60" />

      {/* Floating Particles */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {particles.map((particle) => (
          <div
            key={particle.id}
            className="absolute w-2 h-2 rounded-full bg-yellow-400/60 animate-pulse"
            style={{
              left: `${particle.x}%`,
              top: `${particle.y}%`,
              animationDelay: `${particle.delay}s`,
              boxShadow: "0 0 10px 2px rgba(255, 215, 0, 0.5)",
            }}
          />
        ))}
      </div>

      {/* Magical Mist Effect */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute bottom-0 left-0 right-0 h-64 bg-gradient-to-t from-purple-900/30 to-transparent animate-pulse" />
      </div>

      {/* Main Content */}
      <div className="relative z-10 min-h-screen flex flex-col items-center justify-center px-4">
        {/* Title */}
        <div className="text-center mb-8 animate-fade-in">
          <h1
            className="text-5xl md:text-7xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 via-amber-500 to-yellow-600 drop-shadow-lg mb-2"
            style={{ textShadow: "0 0 30px rgba(255, 215, 0, 0.5)" }}
          >
            PinoyTV
          </h1>
          <p className="text-lg md:text-xl text-amber-200/80 font-medium tracking-wider">
            Your Gateway to Premium Entertainment
          </p>
        </div>

        {/* Books and Padlock Container */}
        <div className="flex items-center justify-center gap-4 md:gap-8 lg:gap-16 relative">
          {/* Devil Book (Signup) */}
          <div
            className={`relative cursor-pointer transition-all duration-700 transform hover:scale-105 
              ${bookAnimation === "devil" ? "animate-book-open scale-110" : ""}
              ${authMode === "signup" ? "opacity-0 pointer-events-none" : ""}`}
            onClick={() => handleBookClick("devil")}
          >
            <div className="relative group">
              <img
                src={DEVIL_BOOK}
                alt="Devil's Book - Sign Up"
                className="w-32 h-44 md:w-48 md:h-64 lg:w-56 lg:h-72 object-cover rounded-lg shadow-2xl transition-transform duration-500 group-hover:rotate-y-10"
                style={{
                  boxShadow:
                    "0 0 40px rgba(220, 38, 38, 0.5), 0 20px 40px rgba(0,0,0,0.5)",
                  filter: "drop-shadow(0 0 20px rgba(220, 38, 38, 0.3))",
                }}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-red-900/60 to-transparent rounded-lg opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="absolute bottom-2 left-0 right-0 text-center">
                <span className="text-red-400 font-bold text-sm md:text-base tracking-wider drop-shadow-lg">
                  SIGN UP
                </span>
              </div>
              <div className="absolute -inset-2 bg-red-500/20 rounded-xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity -z-10" />
            </div>
          </div>

          {/* Center Padlock */}
          <div
            className={`relative cursor-pointer transition-all duration-500 transform 
              ${isUnlocked ? "scale-90 opacity-50" : "hover:scale-110 animate-bounce-slow"}`}
            onClick={handlePadlockClick}
          >
            <div className="relative">
              {isUnlocked ? (
                <Unlock
                  className="w-16 h-16 md:w-24 md:h-24 text-yellow-400 drop-shadow-lg"
                  style={{ filter: "drop-shadow(0 0 15px rgba(255, 215, 0, 0.8))" }}
                />
              ) : (
                <img
                  src={PADLOCK}
                  alt="Padlock"
                  className="w-16 h-16 md:w-24 md:h-24 object-contain"
                  style={{ filter: "drop-shadow(0 0 15px rgba(255, 215, 0, 0.8))" }}
                />
              )}
              {!isUnlocked && (
                <div className="absolute -inset-4 animate-ping-slow">
                  <Sparkles className="w-full h-full text-yellow-400/30" />
                </div>
              )}
            </div>
            <p className="text-center text-yellow-300/80 text-xs md:text-sm mt-2 font-medium">
              {isUnlocked ? "Unlocked!" : "Click to Unlock"}
            </p>
          </div>

          {/* Angel Book (Login) */}
          <div
            className={`relative cursor-pointer transition-all duration-700 transform hover:scale-105
              ${bookAnimation === "angel" ? "animate-book-open scale-110" : ""}
              ${authMode === "login" ? "opacity-0 pointer-events-none" : ""}`}
            onClick={() => handleBookClick("angel")}
          >
            <div className="relative group">
              <img
                src={ANGEL_BOOK}
                alt="Angel's Book - Login"
                className="w-32 h-44 md:w-48 md:h-64 lg:w-56 lg:h-72 object-cover rounded-lg shadow-2xl transition-transform duration-500 group-hover:rotate-y-10"
                style={{
                  boxShadow:
                    "0 0 40px rgba(234, 179, 8, 0.5), 0 20px 40px rgba(0,0,0,0.5)",
                  filter: "drop-shadow(0 0 20px rgba(234, 179, 8, 0.3))",
                }}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-yellow-900/60 to-transparent rounded-lg opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="absolute bottom-2 left-0 right-0 text-center">
                <span className="text-yellow-400 font-bold text-sm md:text-base tracking-wider drop-shadow-lg">
                  LOGIN
                </span>
              </div>
              <div className="absolute -inset-2 bg-yellow-500/20 rounded-xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity -z-10" />
            </div>
          </div>
        </div>

        {/* Instructions */}
        {!authMode && (
          <p className="text-amber-200/60 text-sm md:text-base mt-8 text-center max-w-md animate-pulse">
            Click the padlock to unlock, then choose your book to continue
          </p>
        )}
      </div>

      {/* Question Modal */}
      {showModal && !isUnlocked && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in">
          <div
            className="bg-gradient-to-br from-purple-900 via-purple-800 to-indigo-900 rounded-2xl p-6 md:p-8 max-w-md w-full shadow-2xl border border-purple-500/30 animate-scale-in"
            style={{ boxShadow: "0 0 60px rgba(147, 51, 234, 0.4)" }}
          >
            <div className="text-center">
              <Sparkles className="w-12 h-12 text-yellow-400 mx-auto mb-4 animate-spin-slow" />
              <h2 className="text-2xl md:text-3xl font-bold text-yellow-400 mb-6">
                Mystical Question
              </h2>
              <p className="text-xl md:text-2xl text-white mb-8 font-medium">
                GamayPototoy ka ba?
              </p>

              {error && (
                <div className="mb-4 p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-300 text-sm animate-shake">
                  {error}
                </div>
              )}

              <div className="flex gap-4 justify-center">
                <button
                  onClick={() => handleQuestionAnswer("yes")}
                  className="px-8 py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white font-bold rounded-xl hover:from-green-600 hover:to-emerald-700 transition-all transform hover:scale-105 shadow-lg"
                  style={{ boxShadow: "0 0 20px rgba(34, 197, 94, 0.4)" }}
                >
                  YES
                </button>
                <button
                  onClick={() => handleQuestionAnswer("no")}
                  className="px-8 py-3 bg-gradient-to-r from-red-500 to-rose-600 text-white font-bold rounded-xl hover:from-red-600 hover:to-rose-700 transition-all transform hover:scale-105 shadow-lg"
                  style={{ boxShadow: "0 0 20px rgba(239, 68, 68, 0.4)" }}
                >
                  NO
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Auth Form Modal */}
      {authMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
          <div
            className={`relative w-full max-w-md rounded-2xl p-6 md:p-8 shadow-2xl border animate-scale-in
              ${authMode === "login"
                ? "bg-gradient-to-br from-amber-900 via-yellow-900 to-amber-950 border-yellow-500/30"
                : "bg-gradient-to-br from-red-900 via-rose-900 to-red-950 border-red-500/30"}`}
            style={{
              boxShadow:
                authMode === "login"
                  ? "0 0 60px rgba(234, 179, 8, 0.3)"
                  : "0 0 60px rgba(220, 38, 38, 0.3)",
            }}
          >
            {/* Close Button */}
            <button
              onClick={closeAuthForm}
              className="absolute top-4 right-4 text-white/60 hover:text-white transition-colors"
            >
              <X className="w-6 h-6" />
            </button>

            {/* Header */}
            <div className="text-center mb-6">
              <h2
                className={`text-3xl font-bold mb-2 ${
                  authMode === "login" ? "text-yellow-400" : "text-red-400"
                }`}
              >
                {authMode === "login" ? "Angel's Portal" : "Devil's Gateway"}
              </h2>
              <p className="text-white/70">
                {authMode === "login" ? "Welcome back, traveler" : "Join the dark side"}
              </p>
            </div>

            {/* Error Message */}
            {error && (
              <div className="mb-4 p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-300 text-sm animate-shake">
                {error}
              </div>
            )}

            {/* Success Message */}
            {successMessage && (
              <div className="mb-4 p-3 bg-green-600/20 border border-green-600/40 rounded-lg text-green-200 text-sm">
                {successMessage}
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              {authMode === "signup" && (
                <div>
                  <label className="block text-white/80 text-sm font-medium mb-1">Username</label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                    className="w-full px-4 py-3 bg-black/30 border border-white/20 rounded-xl text-white placeholder-white/40 focus:outline-none focus:border-white/50 transition-colors"
                    placeholder="Enter your username"
                  />
                </div>
              )}

              <div>
                <label className="block text-white/80 text-sm font-medium mb-1">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full px-4 py-3 bg-black/30 border border-white/20 rounded-xl text-white placeholder-white/40 focus:outline-none focus:border-white/50 transition-colors"
                  placeholder="Enter your email"
                />
              </div>

              <div>
                <label className="block text-white/80 text-sm font-medium mb-1">Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="w-full px-4 py-3 bg-black/30 border border-white/20 rounded-xl text-white placeholder-white/40 focus:outline-none focus:border-white/50 transition-colors pr-12"
                    placeholder="Enter your password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white/60 hover:text-white"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              {authMode === "signup" && (
                <div>
                  <label className="block text-white/80 text-sm font-medium mb-1">Confirm Password</label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    className="w-full px-4 py-3 bg-black/30 border border-white/20 rounded-xl text-white placeholder-white/40 focus:outline-none focus:border-white/50 transition-colors"
                    placeholder="Confirm your password"
                  />
                </div>
              )}

              <button
                type="submit"
                disabled={isLoading}
                className={`w-full py-3 rounded-xl font-bold text-white transition-all transform hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed
                  ${authMode === "login"
                    ? "bg-gradient-to-r from-yellow-500 to-amber-600 hover:from-yellow-600 hover:to-amber-700"
                    : "bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-600 hover:to-rose-700"}`}
                style={{
                  boxShadow:
                    authMode === "login"
                      ? "0 0 20px rgba(234, 179, 8, 0.4)"
                      : "0 0 20px rgba(220, 38, 38, 0.4)",
                }}
              >
                {isLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Processing...
                  </span>
                ) : authMode === "login" ? (
                  "Enter the Light"
                ) : (
                  "Embrace the Darkness"
                )}
              </button>
            </form>

            {/* Switch Mode */}
            <div className="mt-6 text-center">
              <button
                onClick={() => {
                  setAuthMode(authMode === "login" ? "signup" : "login");
                  setError("");
                  setSuccessMessage("");
                }}
                className="text-white/60 hover:text-white text-sm transition-colors"
              >
                {authMode === "login"
                  ? "Don't have an account? Sign up with the Devil's Book"
                  : "Already have an account? Login with the Angel's Book"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom Animations */}
      <style>{`
        @keyframes fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes scale-in {
          from { opacity: 0; transform: scale(0.9); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes book-open {
          0% { transform: perspective(1000px) rotateY(0deg); }
          50% { transform: perspective(1000px) rotateY(-30deg); }
          100% { transform: perspective(1000px) rotateY(0deg) scale(1.1); }
        }
        @keyframes bounce-slow {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-10px); }
        }
        @keyframes ping-slow {
          0% { transform: scale(1); opacity: 1; }
          75%, 100% { transform: scale(1.5); opacity: 0; }
        }
        @keyframes spin-slow {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-5px); }
          75% { transform: translateX(5px); }
        }
        .animate-fade-in { animation: fade-in 0.3s ease-out; }
        .animate-scale-in { animation: scale-in 0.4s ease-out; }
        .animate-book-open { animation: book-open 0.8s ease-in-out; }
        .animate-bounce-slow { animation: bounce-slow 2s ease-in-out infinite; }
        .animate-ping-slow { animation: ping-slow 2s cubic-bezier(0, 0, 0.2, 1) infinite; }
        .animate-spin-slow { animation: spin-slow 3s linear infinite; }
        .animate-shake { animation: shake 0.5s ease-in-out; }
      `}</style>
    </div>
  );
};

export default EnchantedAuth;
