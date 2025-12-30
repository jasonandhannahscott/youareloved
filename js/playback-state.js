// ZENITH - PLAYBACK STATE MACHINE
// Replaces boolean flags (isPlaying, isTransitioning, isDragging, manuallyPaused)
// with a proper state machine for clearer state management

const PlaybackState = {
    // Valid states
    STATES: {
        IDLE: 'idle',           // Not playing, not paused by user
        PLAYING: 'playing',     // Actively playing audio
        PAUSED: 'paused',       // User initiated pause
        STOPPED: 'stopped',     // User initiated stop
        TRANSITIONING: 'transitioning', // Between tracks/stations
        DRAGGING: 'dragging',   // User dragging dial
        LOADING: 'loading'      // Loading new track
    },
    
    // Current state
    _current: 'idle',
    
    // Previous state (for returning after transitioning/dragging)
    _previous: 'idle',
    
    // Whether user manually paused (separate from state)
    _manuallyPaused: false,
    
    // State change listeners
    _listeners: [],
    
    /**
     * Get current state
     * @returns {string} Current state
     */
    get current() {
        return this._current;
    },
    
    /**
     * Check if in a specific state
     * @param {string} state - State to check
     * @returns {boolean}
     */
    is(state) {
        return this._current === state;
    },
    
    /**
     * Check if currently in any "active" state (playing or transitioning)
     * @returns {boolean}
     */
    isActive() {
        return this._current === this.STATES.PLAYING || 
               this._current === this.STATES.TRANSITIONING ||
               this._current === this.STATES.DRAGGING ||
               this._current === this.STATES.LOADING;
    },
    
    /**
     * Check if playback should continue (not stopped or paused)
     * @returns {boolean}
     */
    shouldPlay() {
        return this._current !== this.STATES.STOPPED && 
               this._current !== this.STATES.PAUSED &&
               this._current !== this.STATES.IDLE;
    },
    
    /**
     * Check if user manually paused
     * @returns {boolean}
     */
    get manuallyPaused() {
        return this._manuallyPaused;
    },
    
    /**
     * Transition to a new state
     * @param {string} newState - Target state
     * @param {Object} options - Transition options
     */
    transition(newState, options = {}) {
        const { manual = false, preservePrevious = false } = options;
        
        if (!Object.values(this.STATES).includes(newState)) {
            console.warn(`[PlaybackState] Invalid state: ${newState}`);
            return;
        }
        
        const oldState = this._current;
        
        // Don't transition to same state unless forced
        if (oldState === newState && !options.force) return;
        
        // Save previous state for temporary states
        if (!preservePrevious && 
            (newState === this.STATES.TRANSITIONING || newState === this.STATES.DRAGGING)) {
            this._previous = oldState;
        }
        
        this._current = newState;
        
        // Track manual pause/stop
        if (manual && (newState === this.STATES.PAUSED || newState === this.STATES.STOPPED)) {
            this._manuallyPaused = true;
        } else if (newState === this.STATES.PLAYING) {
            this._manuallyPaused = false;
        }
        
        // Update legacy APP flags for backward compatibility
        this._syncLegacyFlags();
        
        // Notify listeners
        this._notifyListeners(oldState, newState);
        
        console.log(`[PlaybackState] ${oldState} → ${newState}${manual ? ' (manual)' : ''}`);
    },
    
    /**
     * Return to previous state (after transitioning/dragging)
     */
    restore() {
        if (this._previous) {
            this.transition(this._previous, { preservePrevious: true });
            this._previous = null;
        }
    },
    
    // Convenience methods for common transitions
    
    play() {
        this.transition(this.STATES.PLAYING);
    },
    
    pause(manual = false) {
        this.transition(this.STATES.PAUSED, { manual });
    },
    
    stop(manual = false) {
        this.transition(this.STATES.STOPPED, { manual });
    },
    
    startTransition() {
        this.transition(this.STATES.TRANSITIONING);
    },
    
    endTransition() {
        this.restore();
    },
    
    startDragging() {
        this.transition(this.STATES.DRAGGING);
    },
    
    endDragging() {
        this.restore();
    },
    
    startLoading() {
        this.transition(this.STATES.LOADING);
    },
    
    /**
     * Register a state change listener
     * @param {Function} callback - Called with (oldState, newState)
     * @returns {Function} Unsubscribe function
     */
    onChange(callback) {
        this._listeners.push(callback);
        return () => {
            this._listeners = this._listeners.filter(l => l !== callback);
        };
    },
    
    /**
     * Sync with legacy APP boolean flags
     * @private
     */
    _syncLegacyFlags() {
        APP.isPlaying = this._current === this.STATES.PLAYING;
        APP.isTransitioning = this._current === this.STATES.TRANSITIONING;
        APP.isDragging = this._current === this.STATES.DRAGGING;
        APP.manuallyPaused = this._manuallyPaused;
    },
    
    /**
     * Initialize state from legacy APP flags (for initial load)
     */
    initFromLegacy() {
        if (APP.isPlaying) {
            this._current = this.STATES.PLAYING;
        } else if (APP.manuallyPaused) {
            this._current = this.STATES.PAUSED;
            this._manuallyPaused = true;
        }
        console.log(`[PlaybackState] Initialized from legacy: ${this._current}`);
    },
    
    /**
     * Notify all listeners of state change
     * @private
     */
    _notifyListeners(oldState, newState) {
        this._listeners.forEach(callback => {
            try {
                callback(oldState, newState);
            } catch (e) {
                console.error('[PlaybackState] Listener error:', e);
            }
        });
    },
    
    /**
     * Get debug info
     * @returns {Object}
     */
    debug() {
        return {
            current: this._current,
            previous: this._previous,
            manuallyPaused: this._manuallyPaused,
            legacySync: {
                isPlaying: APP.isPlaying,
                isTransitioning: APP.isTransitioning,
                isDragging: APP.isDragging,
                manuallyPaused: APP.manuallyPaused
            }
        };
    }
};

// Freeze the STATES object to prevent modification
Object.freeze(PlaybackState.STATES);
