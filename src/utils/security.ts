// Security utilities for PinoyTV

// Anti-DevTools detection
export const initAntiDevTools = () => {
  let devToolsOpen = false;

  const threshold = 160;

  const emitEvent = (isOpen: boolean) => {
    if (devToolsOpen !== isOpen) {
      devToolsOpen = isOpen;
      window.dispatchEvent(new CustomEvent('devtoolschange', { detail: { isOpen } }));
    }
  };

  // Method 1: Window size difference
  const checkWindowSize = () => {
    const widthThreshold = window.outerWidth - window.innerWidth > threshold;
    const heightThreshold = window.outerHeight - window.innerHeight > threshold;
    return widthThreshold || heightThreshold;
  };

  // Method 2: Console timing
  const checkConsoleTiming = () => {
    const start = performance.now();
    console.profile?.();
    console.profileEnd?.();
    return performance.now() - start > 10;
  };

  // Combined check
  const check = () => {
    const isOpen = checkWindowSize() || checkConsoleTiming();
    emitEvent(isOpen);
  };

  // Run checks periodically
  setInterval(check, 1000);

  // Initial check
  check();
};

// Anti-brute force protection
export const createRateLimiter = (maxAttempts: number, windowMs: number) => {
  const attempts = new Map<string, { count: number; resetTime: number }>();

  return {
    check: (key: string): boolean => {
      const now = Date.now();
      const record = attempts.get(key);

      if (!record || now > record.resetTime) {
        attempts.set(key, { count: 1, resetTime: now + windowMs });
        return true;
      }

      if (record.count >= maxAttempts) {
        return false;
      }

      record.count++;
      return true;
    },
    reset: (key: string) => {
      attempts.delete(key);
    },
    getRemainingAttempts: (key: string): number => {
      const record = attempts.get(key);
      if (!record || Date.now() > record.resetTime) {
        return maxAttempts;
      }
      return Math.max(0, maxAttempts - record.count);
    }
  };
};

// Disable console methods in production
export const disableConsole = () => {
  if (process.env.NODE_ENV === 'production') {
    const noop = () => {};
    console.log = noop;
    console.warn = noop;
    console.error = noop;
    console.info = noop;
    console.debug = noop;
    console.trace = noop;
    console.dir = noop;
    console.dirxml = noop;
    console.group = noop;
    console.groupCollapsed = noop;
    console.groupEnd = noop;
    console.time = noop;
    console.timeEnd = noop;
    console.timeLog = noop;
    console.clear = noop;
    console.count = noop;
    console.countReset = noop;
    console.assert = noop;
    console.table = noop;
  }
};

// Disable text selection
export const disableTextSelection = () => {
  document.body.style.userSelect = 'none';
  document.body.style.webkitUserSelect = 'none';
  (document.body.style as any).msUserSelect = 'none';
  (document.body.style as any).mozUserSelect = 'none';
};

// Disable drag
export const disableDrag = () => {
  document.addEventListener('dragstart', (e) => e.preventDefault());
};

// Disable copy/paste
export const disableCopyPaste = () => {
  document.addEventListener('copy', (e) => e.preventDefault());
  document.addEventListener('paste', (e) => e.preventDefault());
  document.addEventListener('cut', (e) => e.preventDefault());
};

// Initialize all security measures
export const initSecurity = () => {
  // Only enable in production
  if (process.env.NODE_ENV === 'production') {
    initAntiDevTools();
    disableConsole();
    disableTextSelection();
    disableDrag();
    disableCopyPaste();
  }
};

export default initSecurity;
