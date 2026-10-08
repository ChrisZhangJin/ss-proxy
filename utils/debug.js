/**
 * Debug Utility
 * Controls console logging based on debug mode
 */

// Set to false for production, true for development
const DEBUG_MODE = true;

/**
 * Debug logger that respects DEBUG_MODE flag
 */
const debug = {
  log: (...args) => {
    if (DEBUG_MODE) {
      console.log(...args);
    }
  },

  warn: (...args) => {
    if (DEBUG_MODE) {
      console.warn(...args);
    }
  },

  error: (...args) => {
    // Always log errors regardless of debug mode
    console.error(...args);
  },

  info: (...args) => {
    if (DEBUG_MODE) {
      console.info(...args);
    }
  }
};

// Export for use in other modules
export { DEBUG_MODE, debug };
