// ZENITH - AUDIO ENGINE MODULE
// Handles AudioContext, gain nodes, static noise generation, and audio routing

const AudioEngine = {
    context: null,
    masterGain: null,
    musicGain: null,
    staticGain: null,
    staticNode: null,
    
    /**
     * Initialize the Web Audio API context and gain nodes
     * @returns {boolean} Success status
     */
    init() {
        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            this.context = new AudioCtx();
            
            // Master gain (controlled by volume)
            this.masterGain = this.context.createGain();
            this.masterGain.gain.value = APP.volume;
            this.masterGain.connect(this.context.destination);
            
            // Music gain (for crossfades and transitions)
            this.musicGain = this.context.createGain();
            this.musicGain.connect(this.masterGain);
            
            // Static noise gain
            this.staticGain = this.context.createGain();
            this.staticGain.gain.value = 0;
            this.staticGain.connect(this.masterGain);
            
            // Create static noise
            this.createStaticNoise();
            
            // Update APP references for backward compatibility
            APP.audioContext = this.context;
            APP.gainNode = this.masterGain;
            APP.musicGain = this.musicGain;
            APP.staticGain = this.staticGain;
            APP.staticNode = this.staticNode;
            
            console.log('[AudioEngine] Initialized successfully');
            return true;
        } catch (e) {
            console.error('[AudioEngine] Failed to initialize:', e);
            return false;
        }
    },
    
    /**
     * Create looping white noise for radio static effect
     */
    createStaticNoise() {
        // Clean up existing node
        if (this.staticNode) {
            try { this.staticNode.stop(); } catch(e) {}
            this.staticNode.disconnect();
        }
        
        const bufferSize = 2 * this.context.sampleRate;
        const noiseBuffer = this.context.createBuffer(1, bufferSize, this.context.sampleRate);
        const output = noiseBuffer.getChannelData(0);
        
        // Generate white noise
        for (let i = 0; i < bufferSize; i++) {
            output[i] = Math.random() * 2 - 1;
        }
        
        const whiteNoise = this.context.createBufferSource();
        whiteNoise.buffer = noiseBuffer;
        whiteNoise.loop = true;
        whiteNoise.connect(this.staticGain);
        whiteNoise.start(0);
        
        this.staticNode = whiteNoise;
        APP.staticNode = whiteNoise;
    },
    
    /**
     * Resume audio context if suspended (required for autoplay policies)
     * Also handles Android audio focus recovery scenarios
     * @returns {Promise<boolean>} Success status
     */
    async resume() {
        if (!this.context) return false;
        
        const state = this.context.state;
        console.log('[AudioEngine] Resume requested, current state:', state);
        
        if (state === 'running') {
            return true;
        }
        
        if (state === 'suspended' || state === 'interrupted') {
            try {
                await this.context.resume();
                console.log('[AudioEngine] Context resumed, new state:', this.context.state);
                
                // Recreate static noise if needed (can get disconnected on Android)
                if (this.staticNode && this.context.state === 'running') {
                    try {
                        // Verify static node is still valid
                        const testGain = this.staticGain?.gain?.value;
                        if (typeof testGain !== 'number') {
                            console.log('[AudioEngine] Recreating static noise after resume');
                            this.createStaticNoise();
                        }
                    } catch (e) {
                        console.log('[AudioEngine] Static node invalid, recreating');
                        this.createStaticNoise();
                    }
                }
                
                return this.context.state === 'running';
            } catch (e) {
                console.error('[AudioEngine] Resume failed:', e);
                return false;
            }
        }
        
        return false;
    },
    
    /**
     * Set master volume
     * @param {number} value - Volume level 0-1
     */
    setVolume(value) {
        APP.volume = value;
        if (this.masterGain) {
            this.masterGain.gain.value = value;
        }
    },
    
    /**
     * Set static noise level (with mobile/background check)
     * @param {number} value - Static gain level
     */
    setStaticGain(value) {
        if (!this.staticGain) return;
        
        // Guard against NaN/Infinity (can happen if APP.volume is undefined)
        if (!Number.isFinite(value)) {
            value = 0;
        }
        
        // Don't play static on mobile when backgrounded
        const shouldEnable = !(APP.isMobile && !APP.pageVisible);
        this.staticGain.gain.value = shouldEnable ? value : 0;
    },
    
    /**
     * Set music gain level
     * @param {number} value - Music gain level
     */
    setMusicGain(value) {
        if (!this.musicGain) return;
        
        // Guard against NaN/Infinity
        if (!Number.isFinite(value)) {
            value = 0;
        }
        
        this.musicGain.gain.value = value;
    },
    
    /**
     * Connect a media element (Howl audio node) to the music gain
     * @param {HTMLAudioElement} mediaElement - Audio element to connect
     */
    connectMediaElement(mediaElement) {
        if (!mediaElement || !this.context) return;
        
        try {
            const source = this.context.createMediaElementSource(mediaElement);
            source.connect(this.musicGain);
        } catch (e) {
            // May already be connected or not supported
        }
    },
    
    /**
     * Smoothly transition static for dial tuning effect
     * @param {number} distanceToSnap - Distance from snap point (normalized 0-1)
     * @param {number} maxStaticLevel - Maximum static level (default 0.3)
     */
    applyTuningEffect(distanceToSnap, maxStaticLevel = 0.3) {
        // Guard against early calls before APP.volume is set
        const volume = APP.volume || 0;
        
        // Static effect should play during tuning transitions
        // even if playback hasn't started yet (to indicate "between stations")
        const isPlaying = (typeof PlaybackState !== 'undefined') 
            ? PlaybackState.is('playing') 
            : APP.isPlaying;
        
        // Always apply static during tuning (the radio "noise" between stations)
        this.setStaticGain(distanceToSnap * maxStaticLevel * volume);
        
        // Only affect music gain if we're playing
        if (isPlaying) {
            this.setMusicGain((1 - distanceToSnap) * volume);
        }
    },
    
    /**
     * Clear tuning effect (return to normal playback)
     */
    clearTuningEffect() {
        this.setStaticGain(0);
        
        // Check playing state - use PlaybackState if available, otherwise APP.isPlaying
        const isPlaying = (typeof PlaybackState !== 'undefined') 
            ? PlaybackState.is('playing') 
            : APP.isPlaying;
            
        if (isPlaying) {
            this.setMusicGain(APP.volume);
        }
    },
    
    /**
     * Get the current audio context state
     * @returns {string} 'suspended', 'running', or 'closed'
     */
    getState() {
        return this.context?.state || 'closed';
    }
};
