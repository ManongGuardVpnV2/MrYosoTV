import { useLocation, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { Home, ArrowLeft } from "lucide-react";

const NotFound = () => {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    console.error(
      "404 Error: User attempted to access non-existent route:",
      location.pathname
    );
  }, [location.pathname]);

  return (
    <div 
      className="min-h-screen flex items-center justify-center p-4"
      style={{
        background: 'linear-gradient(135deg, #1a0f0a 0%, #2d1810 50%, #1a0f0a 100%)'
      }}
    >
      {/* Floating particles */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        {Array.from({ length: 15 }).map((_, i) => (
          <div
            key={i}
            className="absolute w-2 h-2 rounded-full bg-amber-400/30 animate-pulse"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              animationDelay: `${Math.random() * 3}s`
            }}
          />
        ))}
      </div>

      <div 
        className="relative text-center p-8 md:p-12 rounded-2xl max-w-md w-full"
        style={{
          background: 'linear-gradient(135deg, rgba(62, 39, 35, 0.9) 0%, rgba(45, 24, 16, 0.9) 100%)',
          border: '3px solid #5d4037',
          boxShadow: '0 0 40px rgba(0,0,0,0.5), inset 0 0 60px rgba(139, 69, 19, 0.2)'
        }}
      >
        {/* Wooden corners */}
        <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-amber-700 rounded-tl-xl" />
        <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-amber-700 rounded-tr-xl" />
        <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-amber-700 rounded-bl-xl" />
        <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-amber-700 rounded-br-xl" />

        {/* 404 Number */}
        <h1 
          className="text-7xl md:text-9xl font-bold mb-4 text-transparent bg-clip-text bg-gradient-to-b from-amber-400 to-amber-700"
          style={{ textShadow: '0 0 30px rgba(251, 191, 36, 0.5)' }}
        >
          404
        </h1>

        {/* Message */}
        <p className="text-xl md:text-2xl text-amber-200 mb-2 font-medium">
          Lost in the Enchanted Forest
        </p>
        <p className="text-amber-400/70 mb-8">
          The page you're looking for has vanished into the mystical realm.
        </p>

        {/* Buttons */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center justify-center gap-2 px-6 py-3 bg-amber-900/50 text-amber-200 rounded-xl hover:bg-amber-900/70 transition-all border border-amber-700/50"
          >
            <ArrowLeft className="w-5 h-5" />
            Go Back
          </button>
          <button
            onClick={() => navigate('/')}
            className="flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-amber-600 to-amber-700 text-white rounded-xl hover:from-amber-700 hover:to-amber-800 transition-all shadow-lg"
            style={{ boxShadow: '0 0 20px rgba(251, 191, 36, 0.3)' }}
          >
            <Home className="w-5 h-5" />
            Return Home
          </button>
        </div>
      </div>
    </div>
  );
};

export default NotFound;
