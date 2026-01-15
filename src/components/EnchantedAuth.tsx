// src/components/EnchantedAuth.tsx
import React, { useEffect, useRef, useState } from "react";
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
const OPEN_SOUND = "https://actions.google.com/sounds/v1/cartoon/wood_plank_flicks.ogg";

interface EnchantedAuthProps {
  onAuthSuccess: () => void;
}

const EnchantedAuth: React.FC<EnchantedAuthProps> = ({ onAuthSuccess }) => {
  const { login } = useAuth();

  // Gate & book states
  const [showModal, setShowModal] = useState(false);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [bookOpen, setBookOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState<"login" | "signup">("login"); // right=login, left=signup
  const [animatingFlip, setAnimatingFlip] = useState(false);

  // Form states
  const [authMode, setAuthMode] = useState<"login" | "signup" | null>(null); // kept for modal fallback
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [bookAnimation, setBookAnimation] = useState<"devil" | "angel" | null>(null);

  // Particles
  const [particles, setParticles] = useState<
    Array<{ id: number; left: number; top: number; delay: number; size: number }>
  >([]);

  // Inputs
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // Audio
  const openAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    // particles
    const arr = Array.from({ length: 24 }, (_, i) => ({
      id: i,
      left: Math.random() * 80 + 10,
      top: Math.random() * 70 + 15,
      delay: Math.random() * 3,
      size: Math.random() * 6 + 2,
    }));
    setParticles(arr);

    // audio
    openAudioRef.current = new Audio(OPEN_SOUND);
    openAudioRef.current.volume = 0.55;
  }, []);

  // Helper: reset forms
  const resetForms = () => {
    setEmail("");
    setPassword("");
    setUsername("");
    setConfirmPassword("");
    setError("");
    setSuccessMessage("");
    setAuthMode(null);
    setBookAnimation(null);
  };

  // Padlock logic
  const handlePadlockClick = () => {
    if (!isUnlocked) {
      setShowModal(true);
    } else {
      // already unlocked — open book right away
      if (!bookOpen) {
        try {
          openAudioRef.current?.play().catch(() => {});
        } catch {}
        setBookOpen(true);
        setCurrentPage("login");
      }
    }
  };

  const handleQuestionAnswer = (answer: "yes" | "no") => {
    if (answer === "yes") {
      setIsUnlocked(true);
      setShowModal(false);
      // Play open sound and open book after tiny delay to let sound trigger
      setTimeout(() => {
        try {
          openAudioRef.current?.play().catch(() => {});
        } catch {}
        setBookOpen(true);
        setCurrentPage("login");
      }, 240);
    } else {
      setError("Mali ang sagot! Subukan muli.");
      setTimeout(() => setError(""), 2000);
    }
  };

  // Clicking a cover (visual) to flip to that page
  const handleBookClick = (book: "devil" | "angel") => {
    if (!isUnlocked) {
      setShowModal(true);
      return;
    }
    // If the book isn't open yet, open it and set page
    if (!bookOpen) {
      try {
        openAudioRef.current?.play().catch(() => {});
      } catch {}
      setBookOpen(true);
      // small delay for entrance
      setTimeout(() => {
        setCurrentPage(book === "angel" ? "login" : "signup");
      }, 220);
      return;
    }

    // If already open, flip
    const target = book === "angel" ? "login" : "signup";
    flipTo(target);
  };

  // Flip animation control
  const flipTo = (page: "login" | "signup") => {
    if (animatingFlip || currentPage === page) return;
    setAnimatingFlip(true);
    // toggle transform on pages wrapper (we rely on currentPage for final state)
    // give CSS animation time (match with CSS duration)
    setTimeout(() => {
      setCurrentPage(page);
      setAnimatingFlip(false);
    }, 900);
  };

  // Submit handler (keeps your Supabase and useAuth logic)
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccessMessage("");
    setIsLoading(true);

    const deviceFingerprint = generateDeviceFingerprint();

    try {
      if (currentPage === "signup") {
        // Signup validations
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

        // Supabase signup
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

        setSuccessMessage("Account created successfully! Please log in to continue.");
        // Switch to login after a short pause
        setTimeout(() => {
          setCurrentPage("login");
          setPassword("");
          setConfirmPassword("");
        }, 800);
      } else {
        // LOGIN using useAuth().login
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
    resetForms();
  };

  return (
    <div className="min-h-screen relative overflow-hidden bg-black">
      {/* 3D Forest Background */}
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{
          backgroundImage: `url(${FOREST_BG})`,
          transform: "scale(1.1)",
        }}
      />

      {/* Overlay gradient */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/60" />

      {/* Floating Particles (background) */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {particles.map((p) => (
          <div
            key={p.id}
            className="absolute rounded-full"
            style={{
              width: `${p.size}px`,
              height: `${p.size}px`,
              left: `${p.left}%`,
              top: `${p.top}%`,
              animation: `floatUp 6s infinite ${p.delay}s linear`,
              background:
                currentPage === "signup"
                  ? "radial-gradient(circle, rgba(255,120,120,0.95), rgba(255,40,40,0.35))"
                  : "radial-gradient(circle, rgba(255,230,120,0.95), rgba(255,200,70,0.35))",
              boxShadow: "0 0 12px rgba(255,255,255,0.06)",
              opacity: 0.95,
            }}
          />
        ))}
      </div>

      {/* Mist */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute bottom-0 left-0 right-0 h-64 bg-gradient-to-t from-purple-900/30 to-transparent animate-pulse" />
      </div>

      {/* Main content */}
      <div className="relative z-10 min-h-screen flex flex-col items-center justify-center px-4 py-12">
        {/* Title */}
        <div className="text-center mb-8 animate-fade-in">
          <h1
            className="text-4xl md:text-6xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 via-amber-500 to-yellow-600 mb-2"
            style={{ textShadow: "0 0 30px rgba(255,215,0,0.45)" }}
          >
            PinoyTV
          </h1>
          <p className="text-sm md:text-base text-amber-200/80">Your Gateway to Premium Entertainment</p>
        </div>

        {/* Books + Padlock */}
        <div className="flex items-center justify-center gap-6 md:gap-12 lg:gap-20 relative">
          {/* Devil Book (cover) */}
          <div
            className={`relative cursor-pointer transition-transform duration-500 transform ${bookAnimation === "devil" ? "scale-105" : ""}`}
            onClick={() => handleBookClick("devil")}
            aria-hidden
          >
            <img
              src={DEVIL_BOOK}
              alt="Devil's Book - Sign Up"
              className="w-28 h-40 md:w-44 md:h-60 lg:w-52 lg:h-68 object-cover rounded-lg shadow-2xl"
              style={{
                boxShadow: "0 0 40px rgba(220,38,38,0.45)",
                filter: "drop-shadow(0 0 18px rgba(220,38,38,0.28))",
              }}
            />
            <div className="absolute bottom-2 left-0 right-0 text-center">
              <span className="text-red-400 font-bold text-xs md:text-sm drop-shadow">SIGN UP</span>
            </div>
          </div>

          {/* Padlock */}
          <div
            className={`relative cursor-pointer transition-transform duration-500 ${isUnlocked ? "scale-90 opacity-60" : "hover:scale-110 animate-bounce-slow"}`}
            onClick={handlePadlockClick}
          >
            <div className="relative">
              {isUnlocked ? (
                <Unlock className="w-16 h-16 md:w-24 md:h-24 text-yellow-400" />
              ) : (
                <img src={PADLOCK} alt="Padlock" className="w-16 h-16 md:w-24 md:h-24 object-contain" />
              )}
              {!isUnlocked && (
                <div className="absolute -inset-4">
                  <Sparkles className="w-full h-full text-yellow-400/30" />
                </div>
              )}
            </div>
            <p className="text-center text-yellow-300/80 text-xs md:text-sm mt-2"> {isUnlocked ? "Unlocked!" : "Click to Unlock"}</p>
          </div>

          {/* Angel Book (cover) */}
          <div
            className={`relative cursor-pointer transition-transform duration-500 transform ${bookAnimation === "angel" ? "scale-105" : ""}`}
            onClick={() => handleBookClick("angel")}
            aria-hidden
          >
            <img
              src={ANGEL_BOOK}
              alt="Angel's Book - Login"
              className="w-28 h-40 md:w-44 md:h-60 lg:w-52 lg:h-68 object-cover rounded-lg shadow-2xl"
              style={{
                boxShadow: "0 0 40px rgba(234,179,8,0.4)",
                filter: "drop-shadow(0 0 18px rgba(234,179,8,0.28))",
              }}
            />
            <div className="absolute bottom-2 left-0 right-0 text-center">
              <span className="text-yellow-400 font-bold text-xs md:text-sm drop-shadow">LOGIN</span>
            </div>
          </div>
        </div>

        {/* Instruction */}
        {!bookOpen && (
          <p className="text-amber-200/60 text-sm md:text-base mt-8 text-center animate-pulse">Click the padlock to unlock, then choose your book to continue</p>
        )}

        {/* BOOK UI (Open) */}
        {bookOpen && (
          <div className="mt-8 w-full flex justify-center px-4">
            <div
              className="relative perspective"
              style={{ perspective: "2000px", width: "100%", maxWidth: 980 }}
            >
              <div
                className="book-wrapper mx-auto"
                style={{
                  width: "min(92vw, 860px)",
                  height: "min(62vw, 520px)",
                  maxHeight: 560,
                  transformStyle: "preserve-3d",
                  position: "relative",
                }}
              >
                {/* Pages container: rotating this shows left or right content */}
                <div
                  className="pages absolute inset-0"
                  style={{
                    transform: currentPage === "signup" ? "rotateY(-180deg)" : "rotateY(0deg)",
                    transition: "transform 0.9s cubic-bezier(.2,.9,.3,1)",
                    transformStyle: "preserve-3d",
                    borderRadius: 18,
                    overflow: "hidden",
                  }}
                >
                  {/* LEFT PAGE (SIGNUP) */}
                  <div
                    className="page left absolute top-0 left-0 h-full"
                    style={{
                      width: "50%",
                      transformOrigin: "right center",
                      transform: "rotateY(180deg)",
                      backfaceVisibility: "hidden",
                    }}
                  >
                    {/* page-inner counter-rotates to avoid mirrored content */}
                    <div
                      className="page-inner relative h-full"
                      style={{
                        transform: "rotateY(180deg)",
                        backfaceVisibility: "hidden",
                        backgroundImage: `url(${DEVIL_BOOK})`,
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                        boxShadow: "inset 0 0 80px rgba(0,0,0,0.6), 0 20px 60px rgba(0,0,0,0.6)",
                        borderTopLeftRadius: 18,
                        borderBottomLeftRadius: 18,
                        overflow: "hidden",
                      }}
                    >
                      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/60" />
                      <div className="relative z-10 h-full p-6 md:p-8 flex flex-col">
                        <div className="flex items-start justify-between">
                          <h3 className="text-xl md:text-2xl font-bold text-rose-200">Devil's Gateway</h3>
                          <button
                            onClick={() => {
                              setBookOpen(false);
                              resetForms();
                            }}
                            className="text-white/60 hover:text-white"
                            aria-label="Close book"
                          >
                            <X />
                          </button>
                        </div>

                        <form onSubmit={handleSubmit} className="mt-4 flex-1 flex flex-col gap-3">
                          <label className="text-sm text-white/80">Username</label>
                          <input
                            className="rounded-md p-2 bg-black/40 text-white placeholder-white/60 focus:outline-none"
                            placeholder="Choose a username"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            required
                          />

                          <label className="text-sm text-white/80">Email</label>
                          <input
                            type="email"
                            className="rounded-md p-2 bg-black/40 text-white placeholder-white/60 focus:outline-none"
                            placeholder="you@example.com"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                          />

                          <label className="text-sm text-white/80">Password</label>
                          <div className="relative">
                            <input
                              type="password"
                              className="rounded-md p-2 bg-black/40 text-white placeholder-white/60 focus:outline-none w-full pr-10"
                              placeholder="Minimum 6 characters"
                              value={password}
                              onChange={(e) => setPassword(e.target.value)}
                              required
                            />
                          </div>

                          <label className="text-sm text-white/80">Confirm Password</label>
                          <input
                            type="password"
                            className="rounded-md p-2 bg-black/40 text-white placeholder-white/60 focus:outline-none"
                            placeholder="Repeat password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            required
                          />

                          {error && <div className="text-sm text-red-300 mt-1">{error}</div>}
                          {successMessage && <div className="text-sm text-green-300 mt-1">{successMessage}</div>}

                          <div className="mt-auto">
                            <button
                              type="submit"
                              disabled={isLoading}
                              className="w-full py-2 rounded-md bg-gradient-to-r from-red-500 to-rose-600 text-white font-semibold"
                            >
                              {isLoading ? "Processing..." : "Embrace the Darkness"}
                            </button>

                            <button
                              type="button"
                              onClick={() => flipTo("login")}
                              className="mt-3 w-full text-sm text-white/80 underline"
                            >
                              Already have an account? Go to Login →
                            </button>
                          </div>
                        </form>
                      </div>
                    </div>
                  </div>

                  {/* RIGHT PAGE (LOGIN) */}
                  <div
                    className="page right absolute top-0 right:0 h-full"
                    style={{
                      width: "50%",
                      left: "50%",
                      transformOrigin: "left center",
                      backfaceVisibility: "hidden",
                    }}
                  >
                    <div
                      className="page-inner relative h-full"
                      style={{
                        backgroundImage: `url(${ANGEL_BOOK})`,
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                        boxShadow: "inset 0 0 60px rgba(0,0,0,0.45), 0 20px 60px rgba(0,0,0,0.6)",
                        borderTopRightRadius: 18,
                        borderBottomRightRadius: 18,
                        overflow: "hidden",
                      }}
                    >
                      <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-black/40" />
                      <div className="relative z-10 h-full p-6 md:p-8 flex flex-col">
                        <div className="flex items-start justify-between">
                          <h3 className="text-xl md:text-2xl font-bold text-yellow-50">Angel's Portal</h3>
                          <button
                            onClick={() => {
                              setBookOpen(false);
                              resetForms();
                            }}
                            className="text-white/60 hover:text-white"
                            aria-label="Close book"
                          >
                            <X />
                          </button>
                        </div>

                        <form onSubmit={handleSubmit} className="mt-4 flex-1 flex flex-col gap-3">
                          <label className="text-sm text-white/90">Email</label>
                          <input
                            type="email"
                            className="rounded-md p-2 bg-black/40 text-white placeholder-white/60 focus:outline-none"
                            placeholder="you@example.com"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                          />

                          <label className="text-sm text-white/90">Password</label>
                          <div className="relative">
                            <input
                              type={showPassword ? "text" : "password"}
                              className="rounded-md p-2 bg-black/40 text-white placeholder-white/60 focus:outline-none w-full pr-10"
                              placeholder="Your password"
                              value={password}
                              onChange={(e) => setPassword(e.target.value)}
                              required
                            />
                            <button
                              type="button"
                              onClick={() => setShowPassword((s) => !s)}
                              className="absolute right-2 top-1/2 -translate-y-1/2 text-white/70"
                              aria-label="Toggle password visibility"
                            >
                              {showPassword ? <EyeOff /> : <Eye />}
                            </button>
                          </div>

                          {error && <div className="text-sm text-red-300 mt-1">{error}</div>}

                          <div className="mt-auto">
                            <button
                              type="submit"
                              disabled={isLoading}
                              className="w-full py-2 rounded-md bg-gradient-to-r from-yellow-400 to-amber-500 text-white font-semibold"
                            >
                              {isLoading ? "Signing in..." : "Enter the Light"}
                            </button>

                            <button
                              type="button"
                              onClick={() => flipTo("signup")}
                              className="mt-3 w-full text-sm text-white/80 underline"
                            >
                              Don't have an account? Sign up with the Devil's Book →
                            </button>
                          </div>
                        </form>
                      </div>
                    </div>
                  </div>

                  {/* Particles layer between pages */}
                  <div
                    aria-hidden
                    className="particles absolute inset-0 pointer-events-none"
                    style={{ zIndex: 15 }}
                  >
                    {/* already rendered globally, duplicates avoided */}
                  </div>

                  {/* Page curl visual (edge) */}
                  <div
                    className="page-curl absolute top-0"
                    style={{ left: "48%", height: "100%", width: "6%", zIndex: 20, pointerEvents: "none" }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Padlock Modal */}
      {showModal && !isUnlocked && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div
            className="bg-gradient-to-br from-purple-900 via-purple-800 to-indigo-900 rounded-2xl p-6 md:p-8 max-w-md w-full shadow-2xl border border-purple-500/30"
            style={{ boxShadow: "0 0 60px rgba(147,51,234,0.4)" }}
          >
            <div className="text-center">
              <Sparkles className="w-12 h-12 text-yellow-400 mx-auto mb-4 animate-spin-slow" />
              <h2 className="text-2xl md:text-3xl font-bold text-yellow-400 mb-4">Mystical Question</h2>
              <p className="text-xl md:text-2xl text-white mb-6 font-medium">GamayPototoy ka ba?</p>

              {error && <div className="mb-4 p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-300 text-sm">{error}</div>}

              <div className="flex gap-4 justify-center">
                <button
                  onClick={() => handleQuestionAnswer("yes")}
                  className="px-6 py-3 bg-gradient-to-r from-emerald-500 to-green-600 text-white font-bold rounded-xl shadow"
                >
                  YES
                </button>
                <button
                  onClick={() => handleQuestionAnswer("no")}
                  className="px-6 py-3 bg-gradient-to-r from-red-500 to-rose-600 text-white font-bold rounded-xl shadow"
                >
                  NO
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* (Optional) Auth mode modal fallback — kept in case you open via other UI */}
      {authMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div
            className={`relative w-full max-w-md rounded-2xl p-6 md:p-8 shadow-2xl border ${
              authMode === "login" ? "bg-gradient-to-br from-amber-900 via-yellow-900 to-amber-950 border-yellow-500/30" : "bg-gradient-to-br from-red-900 via-rose-900 to-red-950 border-red-500/30"
            }`}
            style={{ boxShadow: authMode === "login" ? "0 0 60px rgba(234,179,8,0.3)" : "0 0 60px rgba(220,38,38,0.3)" }}
          >
            <button onClick={closeAuthForm} className="absolute top-4 right-4 text-white/60 hover:text-white">
              <X className="w-6 h-6" />
            </button>

            <div className="text-center mb-6">
              <h2 className={`text-3xl font-bold mb-2 ${authMode === "login" ? "text-yellow-400" : "text-red-400"}`}>
                {authMode === "login" ? "Angel's Portal" : "Devil's Gateway"}
              </h2>
              <p className="text-white/70">{authMode === "login" ? "Welcome back, traveler" : "Join the dark side"}</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {authMode === "signup" && (
                <div>
                  <label className="block text-white/80 text-sm font-medium mb-1">Username</label>
                  <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} required className="w-full px-4 py-3 bg-black/30 border border-white/20 rounded-xl text-white placeholder-white/40" placeholder="Enter your username" />
                </div>
              )}

              <div>
                <label className="block text-white/80 text-sm font-medium mb-1">Email</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="w-full px-4 py-3 bg-black/30 border border-white/20 rounded-xl text-white placeholder-white/40" placeholder="Enter your email" />
              </div>

              <div>
                <label className="block text-white/80 text-sm font-medium mb-1">Password</label>
                <div className="relative">
                  <input type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} required className="w-full px-4 py-3 bg-black/30 border border-white/20 rounded-xl text-white placeholder-white/40 pr-12" placeholder="Enter your password" />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/60">{showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}</button>
                </div>
              </div>

              {authMode === "signup" && (
                <div>
                  <label className="block text-white/80 text-sm font-medium mb-1">Confirm Password</label>
                  <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required className="w-full px-4 py-3 bg-black/30 border border-white/20 rounded-xl text-white placeholder-white/40" placeholder="Confirm your password" />
                </div>
              )}

              <button type="submit" disabled={isLoading} className={`w-full py-3 rounded-xl font-bold text-white ${authMode === "login" ? "bg-gradient-to-r from-yellow-500 to-amber-600" : "bg-gradient-to-r from-red-500 to-rose-600"}`}>
                {isLoading ? "Processing..." : authMode === "login" ? "Enter the Light" : "Embrace the Darkness"}
              </button>
            </form>

            <div className="mt-6 text-center">
              <button onClick={() => { setAuthMode(authMode === "login" ? "signup" : "login"); setError(""); setSuccessMessage(""); }} className="text-white/60 hover:text-white text-sm">
                {authMode === "login" ? "Don't have an account? Sign up with the Devil's Book" : "Already have an account? Login with the Angel's Book"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Inline Styles */}
      <style>{`
        @keyframes floatUp {
          0% { transform: translateY(0) scale(0.95); opacity: 0; }
          8% { opacity: 0.85; }
          50% { transform: translateY(-10px) scale(1.05); opacity: 0.95; }
          100% { transform: translateY(-60px) scale(0.8); opacity: 0; }
        }

        @keyframes fade-in { from { opacity: 0 } to { opacity: 1 } }
        @keyframes scale-in { from { opacity: 0; transform: scale(.98) } to { opacity: 1; transform: scale(1) } }
        @keyframes book-open { 0% { transform: perspective(1000px) rotateY(0deg) } 50% { transform: perspective(1000px) rotateY(-30deg) } 100% { transform: perspective(1000px) rotateY(0deg) scale(1.05) } }
        @keyframes bounce-slow { 0%,100%{ transform: translateY(0) } 50%{ transform: translateY(-10px) } }
        @keyframes ping-slow { 0%{ transform: scale(1); opacity: 1 } 75%,100%{ transform: scale(1.5); opacity: 0 } }
        @keyframes spin-slow { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
        @keyframes shake { 0%,100%{ transform: translateX(0) } 25%{ transform: translateX(-5px) } 75%{ transform: translateX(5px) } }

        .animate-fade-in { animation: fade-in 0.32s ease-out; }
        .animate-scale-in { animation: scale-in 0.36s ease-out; }
        .animate-book-open { animation: book-open 0.8s ease-in-out; }
        .animate-bounce-slow { animation: bounce-slow 2s ease-in-out infinite; }
        .animate-ping-slow { animation: ping-slow 2s cubic-bezier(0,0,0.2,1) infinite; }
        .animate-spin-slow { animation: spin-slow 3s linear infinite; }
        .animate-shake { animation: shake 0.5s ease-in-out; }

        /* Page curl: subtle gradient on the edge */
        .page-curl::before {
          content: "";
          position: absolute;
          inset: 0;
          background: linear-gradient(90deg, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0.04) 40%, rgba(0,0,0,0.12) 100%);
          transform-origin: left center;
          transition: transform 0.9s cubic-bezier(.2,.9,.3,1), opacity 0.6s;
          opacity: 0.9;
        }

        /* responsive */
        @media (max-width: 768px) {
          .book-wrapper { width: 94vw !important; height: 74vw !important; }
          .page-inner { padding: 14px !important; }
        }
      `}</style>
    </div>
  );
};

export default EnchantedAuth;
