// src/components/EnchantedAuth.tsx
import React, { useEffect, useRef, useState } from "react";
import { Lock, Unlock, Eye, EyeOff, Sparkles, X } from "lucide-react";
import { useAuth, generateDeviceFingerprint } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";

const ANGEL_BG =
  "https://d64gsuwffb70l.cloudfront.net/6966ff2969d41bac5afce556_1768357798348_299e5440.jpg";
const DEVIL_BG =
  "https://d64gsuwffb70l.cloudfront.net/6966ff2969d41bac5afce556_1768357781130_1774fa95.jpg";
const PADLOCK =
  "https://d64gsuwffb70l.cloudfront.net/6966ff2969d41bac5afce556_1768357839315_79c82324.png";
// gentle open sound (public)
const OPEN_SOUND =
  "https://actions.google.com/sounds/v1/cartoon/wood_plank_flicks.ogg";

interface EnchantedAuthProps {
  onAuthSuccess: () => void;
}

const EnchantedAuth: React.FC<EnchantedAuthProps> = ({ onAuthSuccess }) => {
  const { login } = useAuth();

  // Unlock + book states
  const [showQuestion, setShowQuestion] = useState(true);
  const [unlocked, setUnlocked] = useState(false);
  const [bookOpen, setBookOpen] = useState(false); // when true, the book opens
  const [currentPage, setCurrentPage] = useState<"login" | "signup">("login"); // right = login, left = signup
  const [animatingFlip, setAnimatingFlip] = useState(false);

  // Form states
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [username, setUsername] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // UX states
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // Particles
  const [particles, setParticles] = useState<
    Array<{ id: number; left: number; top: number; delay: number; size: number }>
  >([]);
  useEffect(() => {
    const arr = Array.from({ length: 20 }, (_, i) => ({
      id: i,
      left: Math.random() * 80 + 10,
      top: Math.random() * 70 + 10,
      delay: Math.random() * 3,
      size: Math.random() * 6 + 3,
    }));
    setParticles(arr);
  }, []);

  // Audio ref
  const openAudioRef = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    openAudioRef.current = new Audio(OPEN_SOUND);
    openAudioRef.current.volume = 0.55;
  }, []);

  // Helpers
  const resetForms = () => {
    setEmail("");
    setPassword("");
    setUsername("");
    setConfirmPassword("");
    setError("");
    setSuccessMessage("");
  };

  // Question flow (padlock)
  const handleAnswer = (ans: "yes" | "no") => {
    if (ans === "yes") {
      setUnlocked(true);
      setShowQuestion(false);
      // small delay, then open the book and play sound
      setTimeout(() => {
        // play sound (catch for autoplay restrictions)
        try {
          openAudioRef.current?.play().catch(() => {
            /* ignore autoplay block — user gesture usually allows play on click */
          });
        } catch {}
        setBookOpen(true);
        // ensure login page visible first
        setCurrentPage("login");
      }, 450);
    } else {
      setError("Mali ang sagot! Subukan muli.");
      setTimeout(() => setError(""), 2000);
    }
  };

  // Flip to signup (left page) or login (right page)
  const flipTo = (page: "login" | "signup") => {
    if (animatingFlip) return;
    if (page === currentPage) return;
    setAnimatingFlip(true);
    // flip animation works by toggling .flipped class on .book
    setTimeout(() => {
      setCurrentPage(page);
      setAnimatingFlip(false);
    }, 900); // match CSS animation duration
  };

  // SUBMIT handlers: use supabase signup and your useAuth().login
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccessMessage("");
    setIsLoading(true);

    const deviceFingerprint = generateDeviceFingerprint();

    try {
      if (currentPage === "signup") {
        // validations
        if (!username || username.trim().length === 0) {
          setError("Username is required");
          setIsLoading(false);
          return;
        }
        if (password.length < 6) {
          setError("Password must be at least 6 characters");
          setIsLoading(false);
          return;
        }
        if (password !== confirmPassword) {
          setError("Passwords do not match");
          setIsLoading(false);
          return;
        }

        // Create auth user using Supabase
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

        // success - prompt them to login
        setSuccessMessage("Account created successfully! Please log in.");
        // switch softly to login after a moment
        setTimeout(() => {
          setCurrentPage("login");
          setPassword("");
          setConfirmPassword("");
        }, 900);
      } else {
        // LOGIN via your auth context
        const result = await login(email, password, deviceFingerprint);
        if (result?.success) {
          onAuthSuccess();
        } else {
          setError(result?.error || "Login failed");
        }
      }
    } catch (err: any) {
      console.error("Auth handler error:", err);
      setError(err?.message || "An unexpected error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen relative bg-gradient-to-b from-[#050408] via-[#0b0710] to-[#030206] flex items-center justify-center overflow-hidden px-4">
      {/* Background glow */}
      <div className="absolute inset-0 pointer-events-none">
        <div
          style={{
            background:
              "radial-gradient(circle at 20% 20%, rgba(255,215,0,0.06), transparent 12%), radial-gradient(circle at 80% 80%, rgba(220,38,38,0.04), transparent 15%)",
          }}
          className="w-full h-full"
        />
      </div>

      {/* Center content */}
      <div className="relative z-10 w-full max-w-4xl flex flex-col items-center gap-6">
        {/* Title */}
        <div className="text-center">
          <h1 className="text-3xl md:text-5xl font-extrabold bg-clip-text text-transparent bg-gradient-to-r from-yellow-300 via-amber-400 to-yellow-500 drop-shadow-lg">
            PinoyTV — The Enchanted Library
          </h1>
          <p className="text-sm md:text-base text-amber-200/70 mt-1">Choose your path — but unlock first.</p>
        </div>

        {/* Padlock / Question */}
        {!bookOpen && (
          <div className="w-full flex flex-col items-center gap-4">
            <div
              className={`relative rounded-xl p-6 md:p-8 flex flex-col items-center bg-black/40 border border-white/5 shadow-xl`}
              style={{ backdropFilter: "blur(6px)" }}
            >
              <div className="mb-3">
                {!unlocked ? (
                  <img src={PADLOCK} alt="Padlock" className="w-20 h-20 md:w-24 md:h-24" />
                ) : (
                  <Unlock className="w-20 h-20 md:w-24 md:h-24 text-yellow-300" />
                )}
              </div>

              <h2 className="text-lg md:text-xl font-semibold text-amber-100 mb-2">
                {unlocked ? "The lock yielded..." : "Mystical Question"}
              </h2>
              <p className="text-sm md:text-base text-white/80 mb-4">GamayPototoy ka ba?</p>

              {error && (
                <div className="mb-3 px-3 py-2 bg-red-600/20 border border-red-600/40 text-red-200 rounded">
                  {error}
                </div>
              )}

              <div className="flex gap-4">
                <button
                  onClick={() => handleAnswer("yes")}
                  className="px-5 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-green-600 text-white font-semibold shadow"
                >
                  YES
                </button>
                <button
                  onClick={() => handleAnswer("no")}
                  className="px-5 py-2 rounded-xl bg-gradient-to-r from-red-500 to-rose-600 text-white font-semibold shadow"
                >
                  NO
                </button>
              </div>
            </div>

            <p className="text-xs text-amber-200/60">Tap YES to unlock the enchanted book.</p>
          </div>
        )}

        {/* Book */}
        {bookOpen && (
          <div className="w-full flex justify-center">
            <div
              className="relative perspective"
              style={{ perspective: "2000px", width: "100%", maxWidth: 980 }}
            >
              {/* Book box: responsive size */}
              <div
                className={`book relative mx-auto`}
                style={{
                  width: "min(92vw, 860px)",
                  height: "min(62vw, 520px)",
                  maxHeight: 560,
                  transformStyle: "preserve-3d",
                }}
              >
                {/* Pages wrapper (we rotate this to flip) */}
                <div
                  className={`pages absolute inset-0 transition-transform duration-900 ease-in-out`}
                  // flip when currentPage === "signup" so left page is visible (book rotated)
                  style={{
                    transform: currentPage === "signup" ? "rotateY(-180deg)" : "rotateY(0deg)",
                    transformStyle: "preserve-3d",
                    borderRadius: 16,
                    overflow: "visible",
                  }}
                >
                  {/* Left Page (Sign Up) */}
                  <div
                    className="page left absolute top-0 left-0 h-full"
                    style={{
                      width: "50%",
                      backgroundImage: `url(${DEVIL_BG})`,
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                      transformOrigin: "right center",
                      transform: "translateZ(0) rotateY(180deg)",
                      boxShadow: "inset 0 0 80px rgba(0,0,0,0.6), 0 20px 60px rgba(0,0,0,0.6)",
                      borderRadius: 12,
                      overflow: "hidden",
                    }}
                  >
                    {/* subtle overlay */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/60" />

                    <div className="relative z-10 h-full p-6 md:p-8 flex flex-col">
                      <div className="flex items-start justify-between">
                        <h3 className="text-lg md:text-2xl font-bold text-red-200 drop-shadow">Devil's Gateway</h3>
                        <button
                          onClick={() => {
                            setBookOpen(false);
                            resetForms();
                            setShowQuestion(false);
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
                        <input
                          type="password"
                          className="rounded-md p-2 bg-black/40 text-white placeholder-white/60 focus:outline-none"
                          placeholder="Minimum 6 characters"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          required
                        />
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

                  {/* Right Page (Login) */}
                  <div
                    className="page right absolute top-0 right-0 h-full"
                    style={{
                      width: "50%",
                      left: "50%",
                      backgroundImage: `url(${ANGEL_BG})`,
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                      transformOrigin: "left center",
                      boxShadow: "inset 0 0 60px rgba(0,0,0,0.45), 0 20px 60px rgba(0,0,0,0.6)",
                      borderRadius: 12,
                      overflow: "hidden",
                    }}
                  >
                    <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-black/40" />
                    <div className="relative z-10 h-full p-6 md:p-8 flex flex-col">
                      <div className="flex items-start justify-between">
                        <h3 className="text-lg md:text-2xl font-bold text-yellow-50 drop-shadow">Angel's Portal</h3>
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => {
                              setBookOpen(false);
                              resetForms();
                              setShowQuestion(false);
                            }}
                            className="text-white/60 hover:text-white"
                            aria-label="Close book"
                          >
                            <X />
                          </button>
                        </div>
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
                            className="rounded-md p-2 pr-10 bg-black/40 text-white placeholder-white/60 focus:outline-none w-full"
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

                  {/* Particles layer between pages */}
                  <div
                    aria-hidden
                    className="particles absolute top-0 left-0 w-full h-full pointer-events-none"
                    style={{ zIndex: 15 }}
                  >
                    {particles.map((p) => (
                      <span
                        key={p.id}
                        style={{
                          position: "absolute",
                          left: `${p.left}%`,
                          top: `${p.top}%`,
                          width: `${p.size}px`,
                          height: `${p.size}px`,
                          borderRadius: "999px",
                          background:
                            currentPage === "signup"
                              ? "radial-gradient(circle, rgba(255,120,120,0.95), rgba(255,40,40,0.4))"
                              : "radial-gradient(circle, rgba(255,230,120,0.95), rgba(255,200,70,0.35))",
                          boxShadow:
                            "0 0 10px rgba(255,255,255,0.08), 0 0 18px rgba(255,255,255,0.04)",
                          opacity: 0.9,
                          animation: `floatUp 6s infinite ${p.delay}s linear`,
                          transform: "translateY(0)",
                          zIndex: 16,
                        }}
                      />
                    ))}
                  </div>

                  {/* Page curl visual on the turning edge (right inner) */}
                  <div
                    className="page-curl absolute top-0 left-[48%] h-full"
                    style={{ width: "6%", zIndex: 20, pointerEvents: "none" }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Inline Styles & Animations */}
      <style>{`
        /* Responsive helpers */
        @media (max-width: 768px) {
          .page { padding: 16px !important; }
        }

        /* Pages (front/back surfaces mimic book pages) */
        .pages .page::after {
          /* subtle paper edge */
          content: "";
          position: absolute;
          inset: 0;
          box-shadow: inset 0 0 0 2px rgba(255,255,255,0.02);
          pointer-events: none;
        }

        /* Page curl simulation - uses gradient & transform to fake curl */
        .page-curl::before {
          content: "";
          position: absolute;
          inset: 0;
          background:
            linear-gradient(90deg, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0.04) 40%, rgba(0,0,0,0.15) 100%);
          transform-origin: left center;
          transition: transform 0.9s cubic-bezier(.2,.9,.3,1), opacity 0.6s;
          opacity: 0.9;
        }

        /* When on signup, the pages rotate so curl animates naturally */
        .pages[style*="rotateY(-180deg)"] .page-curl::before {
          transform: rotateY(180deg) scaleX(-1);
          opacity: 1;
        }

        /* Particle animation */
        @keyframes floatUp {
          0% { transform: translateY(0) scale(0.9); opacity: 0; }
          10% { opacity: 1; }
          50% { transform: translateY(-10px) scale(1.05); opacity: 0.95; }
          100% { transform: translateY(-60px) scale(0.8); opacity: 0; }
        }

        /* Smooth flip (slight page bend while flipping) */
        .pages {
          will-change: transform;
          perspective: 2000px;
        }

        /* Tiny 3D tilt when switching pages for realism */
        .pages[style*="rotateY(-180deg)"] {
          box-shadow: -40px 40px 80px rgba(0,0,0,0.6), inset -10px 0 40px rgba(0,0,0,0.2);
        }

        .pages[style*="rotateY(0deg)"] {
          box-shadow: 40px 40px 80px rgba(0,0,0,0.6), inset 10px 0 40px rgba(0,0,0,0.2);
        }

        /* small accessibility: disable pointer events during flip */
        .pages[style*="rotateY(-180deg)"], .pages[style*="rotateY(0deg)"] {
          pointer-events: auto;
        }

        /* A gentle entrance */
        .book { animation: bookEntrance 420ms cubic-bezier(.2,.9,.3,1) both; }
        @keyframes bookEntrance {
          from { transform: translateY(20px) scale(0.98); opacity: 0; }
          to { transform: translateY(0) scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
};

export default EnchantedAuth;
