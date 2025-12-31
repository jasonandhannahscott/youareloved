// ZENITH APP.JS - VERSION 6.3 - REFACTORED
// Depends on: state.js, dial-renderer.js, audio-engine.js, playback-state.js
console.log('=== ZENITH APP.JS VERSION 6.3 LOADED ===');

// ============================================================================
// ADDITIONAL UTILITIES & LEGACY COMPATIBILITY
// ============================================================================
// Event binding helper
function bindEvents(selector, event, handler, parent = document) {
    parent.querySelectorAll(selector).forEach(el => el.addEventListener(event, handler));
}

// Legacy aliases for backward compatibility
function escapeTrackJson(track) { return TrackJSON.encode(track); }
function parseTrackJson(str) { return TrackJSON.decode(str); }

// ============================================================================
// INSTANCE & BROADCAST CHANNEL
// ============================================================================
const INSTANCE_ID = Date.now() + '-' + Math.random().toString(36).substr(2, 9);
let broadcastChannel = null;

// ============================================================================
// BROADCAST CHANNEL (Cross-tab communication)
// ============================================================================
function setupBroadcastChannel() {
    if (!('BroadcastChannel' in window)) return;
    broadcastChannel = new BroadcastChannel('zenith_playback');
    broadcastChannel.onmessage = e => {
        if (e.data.senderId === INSTANCE_ID) return;
        if (e.data.type === 'playback_started') {
            showToast('Another Zenith tab started playing', 3000, 'info');
            stopPlayback(true);
        }
    };
}

function notifyPlaybackStarted() {
    if (broadcastChannel) broadcastChannel.postMessage({ type: 'playback_started', senderId: INSTANCE_ID });
}

// ============================================================================
// TOAST NOTIFICATIONS
// ============================================================================
function showToast(message, duration = CONFIG.TOAST_DURATION.medium, type = 'info') {
    let container = $('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => { toast.classList.add('toast--fade'); setTimeout(() => toast.remove(), 300); }, duration);
}

// ============================================================================
// STORAGE MANAGEMENT
// ============================================================================
async function requestPersistentStorage() {
    if (!navigator.storage?.persist) return;
    try {
        const isPersisted = await navigator.storage.persisted();
        if (!isPersisted && (APP.isPWA || APP.isMobile)) {
            const granted = await navigator.storage.persist();
            if (granted) showToast('Offline storage enabled', 3000, 'success');
        }
    } catch (e) { console.warn('[Storage] Error:', e); }
}

async function checkStorageQuota(showWarning = true) {
    if (!navigator.storage?.estimate) return null;
    try {
        const { usage, quota } = await navigator.storage.estimate();
        const usedMB = Math.round(usage / 1024 / 1024);
        const quotaMB = Math.round(quota / 1024 / 1024);
        const availableMB = quotaMB - usedMB;
        const percentUsed = Math.round((usage / quota) * 100);
        console.log(`[Storage] Used: ${usedMB}MB / ${quotaMB}MB (${percentUsed}%)`);
        if (showWarning && (availableMB < 100 || percentUsed > 90)) {
            showToast(`Storage running low: ${availableMB}MB free`, 8000, 'error');
        }
        return { usedMB, quotaMB, availableMB, percentUsed };
    } catch (e) { console.warn('[Storage] Error:', e); return null; }
}

// Settings
function loadSettings() {
    APP.settings = { ...APP.settings, ...Storage.get('zenith_settings', {}) };
    // Enable debug mode if setting is on
    if (APP.settings.debugMode && typeof Debug !== 'undefined') {
        Debug.enable();
    }
}
function saveSettings() {
    Storage.set('zenith_settings', APP.settings);
}

// Playback State
function savePlaybackState() {
    const list = getCurrentTrackList();
    const track = list?.[APP.currentIndex];
    Storage.set('zenith_playback_state', {
        band: APP.currentBand, index: APP.currentIndex,
        time: APP.currentHowl ? APP.currentHowl.seek() : 0,
        volume: APP.volume, artistFilter: APP.radioState.activeArtistFilter,
        genreFilter: APP.radioState.activeGenre, isShuffled: APP.radioState.isShuffled,
        timestamp: Date.now(),
        currentTrackId: track ? Track.getId(track) : null,
        currentTrackArtist: track ? Track.getArtist(track) : null
    });
}

function loadPlaybackState() {
    return Storage.get('zenith_playback_state', null);
}

function restorePlaybackState() {
    const state = loadPlaybackState();
    if (!state || Date.now() - state.timestamp > CONFIG.STATE_EXPIRY_MS) return false;
    
    // Only restore shuffle state if explicitly defined in saved state
    if (typeof state.isShuffled === 'boolean') {
        APP.radioState.isShuffled = state.isShuffled;
    }
    // If state.isShuffled is undefined, keep the default (true)
    
    const shuffleBtn = $('shuffle-btn');
    if (shuffleBtn) shuffleBtn.classList.toggle('active', APP.radioState.isShuffled);
    
    if (!APP.settings.startWithShuffle) {
        APP.radioState.activeArtistFilter = state.artistFilter || null;
        APP.radioState.activeGenre = state.genreFilter || null;
        APP.currentBand = state.band || BANDS.RADIO;
        
        if (BANDS.isPlaylist(APP.currentBand)) {
            const pid = BANDS.getPlaylistId(APP.currentBand);
            const playlist = APP.userPlaylists.find(p => p.id === pid);
            if (!playlist) APP.currentBand = BANDS.RADIO;
            else APP.playlist[APP.currentBand] = playlist.tracks;
        }
        
        APP.pendingRestoreTrackId = state.currentTrackId;
        APP.pendingRestoreTrackArtist = state.currentTrackArtist;
        APP.pendingRestoreIndex = state.index || 0;
        APP.pendingRestoreTime = state.time || 0;
        // Restore volume but ensure minimum volume to prevent silent playback
        if (typeof state.volume === 'number') {
            APP.volume = APP.pendingRestoreVolume = Math.max(state.volume, CONFIG.MIN_VOLUME);
        }
    } else {
        APP.currentBand = BANDS.RADIO;
    }
    return true;
}

function findTrackInPlaylist(trackId, trackArtist) {
    if (!trackId) return -1;
    const list = getCurrentTrackList();
    if (!list?.length) return -1;
    for (let i = 0; i < list.length; i++) {
        const t = list[i];
        const id = Track.getId(t);
        const artist = Track.getArtist(t);
        if (id === trackId && (!trackArtist || artist === trackArtist)) return i;
    }
    return -1;
}

// User Playlists
function loadUserPlaylists() {
    APP.userPlaylists = Storage.get('zenith_playlists', []);
}
function saveUserPlaylists() {
    Storage.set('zenith_playlists', APP.userPlaylists);
}

// Explicit Downloads Tracking
function loadExplicitDownloads() {
    const data = Storage.get('zenith_explicit_downloads', null);
    if (data) APP.explicitDownloads = new Set(data);
}
function saveExplicitDownloads() {
    Storage.set('zenith_explicit_downloads', [...APP.explicitDownloads]);
}

// ============================================================================
// VISIBILITY, LIFECYCLE & WAKE LOCK HANDLING
// ============================================================================

// Wake Lock management
async function requestWakeLock() {
    if (!('wakeLock' in navigator)) {
        Debug.STATE('Wake Lock API not supported');
        return;
    }
    
    // Only request if playing and we don't already have one
    if (!APP.isPlaying || APP.wakeLock) return;
    
    try {
        APP.wakeLock = await navigator.wakeLock.request('screen');
        Debug.STATE('Wake lock acquired');
        
        APP.wakeLock.addEventListener('release', () => {
            Debug.STATE('Wake lock released');
            APP.wakeLock = null;
        });
    } catch (err) {
        Debug.warn('Wake lock request failed', err.message);
        APP.wakeLock = null;
    }
}

function releaseWakeLock() {
    if (APP.wakeLock) {
        APP.wakeLock.release().catch(() => {});
        APP.wakeLock = null;
        Debug.STATE('Wake lock manually released');
    }
}

// AudioContext state monitoring
function setupAudioContextMonitoring() {
    if (!APP.audioContext) return;
    
    APP.audioContext.addEventListener('statechange', () => {
        const state = APP.audioContext.state;
        Debug.AUDIO('AudioContext state changed', { state });
        
        if (state === 'interrupted') {
            // iOS-specific: phone call, Siri, etc.
            APP.wasPlayingBeforeInterrupt = APP.isPlaying;
            APP.interruptedAt = Date.now();
            Debug.STATE('Audio interrupted, was playing:', APP.wasPlayingBeforeInterrupt);
        }
        
        if (state === 'running') {
            // Context resumed - check if we should auto-resume playback
            if (APP.wasPlayingBeforeInterrupt) {
                Debug.STATE('Audio context running again, attempting playback recovery');
                setTimeout(() => recoverPlaybackAfterInterrupt(), 100);
            }
        }
        
        if (state === 'suspended') {
            Debug.STATE('AudioContext suspended');
            // Track that we need to resume on next play attempt
            APP.audioContextNeedsResume = true;
        }
    });
}

/**
 * Ensure AudioContext is in 'running' state before playback
 * Critical for Android audio focus recovery after other apps have played audio
 * @returns {Promise<boolean>} true if context is running
 */
async function ensureAudioContextRunning() {
    const ctx = APP.audioContext || AudioEngine?.context;
    if (!ctx) {
        Debug.warn('No AudioContext available');
        return false;
    }
    
    const state = ctx.state;
    Debug.AUDIO('ensureAudioContextRunning', { currentState: state });
    
    if (state === 'running') {
        APP.audioContextNeedsResume = false;
        return true;
    }
    
    if (state === 'suspended' || state === 'interrupted') {
        try {
            Debug.AUDIO('Resuming AudioContext...');
            await ctx.resume();
            Debug.AUDIO('AudioContext resumed successfully', { newState: ctx.state });
            APP.audioContextNeedsResume = false;
            
            // Recreate static noise if needed (can get disconnected on Android)
            if (AudioEngine?.staticNode) {
                try {
                    // Check if static node is still connected
                    if (AudioEngine.staticNode.context?.state !== 'running') {
                        AudioEngine.createStaticNoise();
                    }
                } catch (e) {
                    Debug.warn('Static noise recreation failed', e);
                }
            }
            
            return ctx.state === 'running';
        } catch (err) {
            Debug.error('AudioContext resume failed', err);
            // On Android, may need user gesture - flag for retry on next interaction
            APP.audioContextNeedsResume = true;
            return false;
        }
    }
    
    if (state === 'closed') {
        Debug.error('AudioContext is closed - cannot resume');
        return false;
    }
    
    return false;
}

// Playback recovery after interruption
async function recoverPlaybackAfterInterrupt() {
    if (!APP.wasPlayingBeforeInterrupt) return;
    
    Debug.STATE('Recovering playback after interrupt');
    APP.wasPlayingBeforeInterrupt = false;
    
    try {
        // Resume audio context using the robust helper
        const contextReady = await ensureAudioContextRunning();
        
        if (!contextReady) {
            Debug.warn('Context not ready after interrupt recovery attempt');
            // Will retry on next user interaction
            return;
        }
        
        // Check if Howl is still valid and try to resume
        if (APP.currentHowl) {
            if (!APP.currentHowl.playing()) {
                APP.currentHowl.play();
                APP.isPlaying = true;
                APP.manuallyPaused = false;
                updatePlaybackState();
                updateTransportButtonStates();
                updateGrillePlaybackUI();
                requestWakeLock();
                Debug.PLAYBACK('Playback recovered after interrupt');
            }
        }
    } catch (err) {
        Debug.error('Playback recovery failed', err);
    }
}

// Recovery from sleep/background
async function recoverFromSleep() {
    Debug.STATE('Recovering from sleep/background');
    
    // 1. Resume AudioContext if suspended
    const contextReady = await ensureAudioContextRunning();
    if (contextReady) {
        Debug.AUDIO('AudioContext ready after wake');
    } else {
        Debug.warn('AudioContext not ready after wake - will retry on interaction');
    }
    
    // 2. Check if Howl stopped unexpectedly while we were supposed to be playing
    if (APP.isPlaying && APP.currentHowl && !APP.currentHowl.playing() && !APP.manuallyPaused) {
        Debug.PLAYBACK('Howl stopped unexpectedly, attempting recovery');
        
        // Ensure context is ready before attempting replay
        if (contextReady) {
            try {
                APP.currentHowl.play();
            } catch (e) {
                Debug.warn('Howl play failed, reloading track');
                // Reload the track as last resort
                loadTrack(APP.currentIndex, false, true);
            }
        } else {
            Debug.warn('Cannot resume playback - AudioContext not running');
        }
    }
    
    // 3. Re-sync Media Session position
    updatePositionState();
    
    // 4. Re-request wake lock if playing
    if (APP.isPlaying) {
        requestWakeLock();
    }
    
    // 5. Restart position updater
    if (APP.isPlaying) {
        startPositionUpdater();
    }
}

function setupVisibilityHandler() {
    APP.lastFrameTime = performance.now();
    Debug.INIT('Setting up visibility handler');
    
    // Frame-based background detection (catches throttling)
    function frameCheck() {
        if (!APP.frameCheckActive) return;
        const now = performance.now();
        const delta = now - APP.lastFrameTime;
        const wasBackgrounded = APP.isBackgrounded;
        if (delta > 200 && !APP.isBackgrounded) { APP.isBackgrounded = true; APP.pageVisible = false; }
        else if (delta < 50) { APP.isBackgrounded = document.hidden; APP.pageVisible = !document.hidden; }
        if (wasBackgrounded !== APP.isBackgrounded) {
            Debug.STATE('Background state changed', { isBackgrounded: APP.isBackgrounded, pageVisible: APP.pageVisible });
        }
        APP.lastFrameTime = now;
        requestAnimationFrame(frameCheck);
    }
    requestAnimationFrame(frameCheck);
    
    // Standard visibility change
    document.addEventListener('visibilitychange', () => {
        APP.pageVisible = !document.hidden;
        APP.isBackgrounded = document.hidden;
        Debug.STATE('Visibility changed', { hidden: document.hidden, pageVisible: APP.pageVisible });
        
        if (document.hidden) {
            // Going to background
            if (APP.staticGain) APP.staticGain.gain.value = 0;
            savePlaybackState();
        } else {
            // Coming back to foreground
            recoverFromSleep();
        }
    });
    
    // Window blur/focus
    window.addEventListener('blur', () => { 
        Debug.STATE('Window blur');
        APP.pageVisible = false; 
        APP.isBackgrounded = true; 
        if (APP.staticGain) APP.staticGain.gain.value = 0; 
    });
    
    window.addEventListener('focus', () => { 
        Debug.STATE('Window focus');
        APP.pageVisible = true; 
        APP.isBackgrounded = false;
        // Slight delay to let browser settle
        setTimeout(recoverFromSleep, 100);
    });
    
    // Page Lifecycle API - freeze/resume (modern browsers)
    if ('onfreeze' in document) {
        document.addEventListener('freeze', () => {
            Debug.STATE('Page frozen (Page Lifecycle API)');
            APP.frozenAt = Date.now();
            APP.wasPlayingBeforeFreeze = APP.isPlaying;
            savePlaybackState();
            // Stop position updater to save resources
            if (APP.positionTimer) {
                clearInterval(APP.positionTimer);
                APP.positionTimer = null;
            }
        });
        
        document.addEventListener('resume', () => {
            Debug.STATE('Page resumed (Page Lifecycle API)', { 
                frozenFor: APP.frozenAt ? Date.now() - APP.frozenAt : 'unknown',
                wasPlaying: APP.wasPlayingBeforeFreeze 
            });
            
            // Full recovery after freeze
            recoverFromSleep();
            
            // If we were playing before freeze, ensure playback continues
            if (APP.wasPlayingBeforeFreeze && !APP.manuallyPaused) {
                setTimeout(() => {
                    if (!APP.currentHowl?.playing()) {
                        Debug.PLAYBACK('Restarting playback after freeze');
                        playPlayback();
                    }
                }, 200);
            }
            
            APP.frozenAt = null;
            APP.wasPlayingBeforeFreeze = false;
        });
        
        Debug.INIT('Page Lifecycle API supported and handlers registered');
    } else {
        Debug.INIT('Page Lifecycle API not supported');
    }
    
    // Handle page show (back/forward cache restoration)
    window.addEventListener('pageshow', (event) => {
        if (event.persisted) {
            Debug.STATE('Page restored from bfcache');
            recoverFromSleep();
        }
    });
    
    // Network status monitoring
    window.addEventListener('online', () => {
        Debug.STATE('Network online');
        APP.isOnline = true;
        
        // If we have a pending retry, try now
        if (APP.pendingNetworkRetry) {
            Debug.PLAYBACK('Retrying failed load after network restore');
            APP.pendingNetworkRetry = false;
            loadTrack(APP.currentIndex, false, true);
        }
    });
    
    window.addEventListener('offline', () => {
        Debug.STATE('Network offline');
        APP.isOnline = false;
    });
    
    // Initialize online status
    APP.isOnline = navigator.onLine;
}

function shouldUseSimpleTransitions() {
    if (document.hidden || APP.isBackgrounded || !APP.pageVisible) return true;
    const timeSinceLastFrame = performance.now() - (APP.lastFrameTime || 0);
    return timeSinceLastFrame > 100;
}

function shouldEnableStatic() {
    return !(APP.isMobile && !APP.pageVisible);
}

function setStaticGain(value) {
    // Use AudioEngine if available, otherwise fall back to APP.staticGain
    if (typeof AudioEngine !== 'undefined' && AudioEngine.staticGain) {
        AudioEngine.setStaticGain(value);
    } else if (APP.staticGain) {
        APP.staticGain.gain.value = shouldEnableStatic() ? value : 0;
    }
}

// ============================================================================
// AUDIO ENGINE
// ============================================================================
function createStaticNoise() {
    if (APP.staticNode) { try { APP.staticNode.stop(); } catch(e){} APP.staticNode.disconnect(); }
    const bufferSize = 2 * APP.audioContext.sampleRate;
    const noiseBuffer = APP.audioContext.createBuffer(1, bufferSize, APP.audioContext.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) output[i] = Math.random() * 2 - 1;
    
    const whiteNoise = APP.audioContext.createBufferSource();
    whiteNoise.buffer = noiseBuffer;
    whiteNoise.loop = true;
    whiteNoise.connect(APP.staticGain);
    APP.staticNode = whiteNoise;
    APP.staticGain.gain.value = 0;
    whiteNoise.start(0);
}

// ============================================================================
// MEDIA SESSION API
// ============================================================================
function setupMediaSession() {
    if (!('mediaSession' in navigator)) return;

    const handlers = [
        ['play', async () => { 
            Debug.TRANSPORT('MediaSession play action');
            // CRITICAL: Must resume AudioContext before playing (Android audio focus recovery)
            await ensureAudioContextRunning();
            APP.isPlaying = true; 
            APP.manuallyPaused = false;
            if (APP.currentHowl) {
                APP.currentHowl.play(); 
            } else {
                // No Howl loaded - load current track
                loadTrack(APP.currentIndex, false);
            }
            updatePlaybackState(); 
            updateTransportButtonStates();
            updateGrillePlaybackUI();
            requestWakeLock();
        }],
        ['pause', () => { 
            Debug.TRANSPORT('MediaSession pause action');
            APP.isPlaying = false; 
            APP.manuallyPaused = true;
            APP.currentHowl?.pause(); 
            updatePlaybackState(); 
            updateTransportButtonStates();
            updateGrillePlaybackUI();
            releaseWakeLock();
        }],
        ['previoustrack', () => { hideOnboardingHints(); const list = getCurrentTrackList(); if (list && list.length > 0) { const newIndex = APP.currentIndex > 0 ? APP.currentIndex - 1 : list.length - 1; tuneToStation(newIndex); } }],
        ['nexttrack', () => { hideOnboardingHints(); const list = getCurrentTrackList(); if (list && list.length > 0) { const newIndex = APP.currentIndex < list.length - 1 ? APP.currentIndex + 1 : 0; tuneToStation(newIndex); } }],
        ['stop', () => { 
            Debug.TRANSPORT('MediaSession stop action');
            APP.isPlaying = false; 
            APP.manuallyPaused = true;
            APP.currentHowl?.stop(); 
            updatePlaybackState(); 
            updateTransportButtonStates();
            updateGrillePlaybackUI();
            releaseWakeLock();
        }],
        ['seekto', d => { if (APP.currentHowl && d.seekTime) { APP.currentHowl.seek(d.seekTime); updatePositionState(); } }],
        ['seekbackward', d => { const skip = d.seekOffset || 10; if (APP.currentHowl) { APP.currentHowl.seek(Math.max(0, APP.currentHowl.seek() - skip)); updatePositionState(); } }],
        ['seekforward', d => { const skip = d.seekOffset || 10; if (APP.currentHowl) { APP.currentHowl.seek(APP.currentHowl.seek() + skip); updatePositionState(); } }]
    ];

    handlers.forEach(([action, handler]) => {
        try { navigator.mediaSession.setActionHandler(action, handler); } catch (e) {}
    });
}

function updateMediaSessionMetadata(track) {
    if (!('mediaSession' in navigator) || !track) return;
    const title = Track.getTitle(track);
    const artist = Track.getArtist(track);
    const album = APP.currentBand === BANDS.RADIO ? 'Radio' : BANDS.isPlaylist(APP.currentBand) ? 'Custom Playlist' : 'Audiobook';

    navigator.mediaSession.metadata = new MediaMetadata({
        title, artist, album,
        artwork: [
            { src: 'icons/icon-96.png', sizes: '96x96', type: 'image/png' },
            { src: 'icons/icon-128.png', sizes: '128x128', type: 'image/png' },
            { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }
        ]
    });
    updatePlaybackState();
}

function updatePlaybackState() {
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = APP.isPlaying ? 'playing' : 'paused';
    updatePositionState();
    updateGrillePlaybackUI();
}

function updatePositionState() {
    if (!('mediaSession' in navigator)) return;
    
    // Update even when paused to keep lock screen in sync
    if (!APP.currentHowl) return;
    
    try {
        const duration = APP.currentHowl.duration();
        const position = APP.currentHowl.seek();
        
        // Validate values before setting
        if (typeof duration === 'number' && isFinite(duration) && duration > 0 &&
            typeof position === 'number' && isFinite(position) && position >= 0) {
            
            const safePosition = Math.max(0, Math.min(position, duration));
            
            navigator.mediaSession.setPositionState({ 
                duration, 
                playbackRate: 1.0, 
                position: safePosition 
            });
        }
    } catch(e) {
        // Position state not supported or invalid - fail silently
        Debug.warn('setPositionState failed', e.message);
    }
}

function startPositionUpdater() {
    if (APP.positionTimer) clearInterval(APP.positionTimer);
    
    // Update position state more frequently for better sync
    APP.positionTimer = setInterval(() => { 
        if (APP.isPlaying && APP.currentHowl) {
            updatePositionState();
            
            // Also verify Howl is actually playing (recovery check)
            if (!APP.currentHowl.playing() && !APP.manuallyPaused && !APP.isTransitioning) {
                Debug.warn('Position updater detected stopped Howl, attempting recovery');
                recoverFromSleep();
            }
        }
    }, 1000);
}

// ============================================================================
// PLAYBACK CONTROLS
// ============================================================================
function resumePlayback() {
    Debug.TRANSPORT('resumePlayback()', { hasHowl: !!APP.currentHowl, wasPlaying: APP.isPlaying });
    if (!APP.currentHowl) return;
    // Use AudioEngine if available
    if (typeof AudioEngine !== 'undefined') {
        AudioEngine.resume();
    } else if (APP.audioContext?.state === 'suspended') {
        APP.audioContext.resume();
    }
    notifyPlaybackStarted();
    APP.currentHowl.play();
    APP.isPlaying = true;
    const vid = $('video-player');
    if (vid?.src) vid.play().catch(() => {});
    updatePlaybackState();
    startPositionUpdater();
    requestWakeLock();
}

function pausePlayback() {
    Debug.TRANSPORT('pausePlayback()', { wasPlaying: APP.isPlaying });
    APP.currentHowl?.pause();
    APP.isPlaying = false;
    $('video-player')?.pause();
    updatePlaybackState();
    releaseWakeLock();
}

async function playPlayback() {
    Debug.TRANSPORT('playPlayback()', { hasHowl: !!APP.currentHowl, currentIndex: APP.currentIndex });
    notifyPlaybackStarted();
    
    // CRITICAL: Await AudioContext resume before attempting playback
    // This fixes Android audio focus issues when switching from other apps
    const contextReady = await ensureAudioContextRunning();
    if (!contextReady) {
        Debug.warn('AudioContext not ready, playback may fail');
        // Still try to play - some browsers auto-resume on play()
    }
    
    APP.manuallyPaused = false;
    
    if (APP.currentHowl) { 
        APP.currentHowl.play(); 
        APP.isPlaying = true; 
    } else { 
        APP.isPlaying = true; 
        loadTrack(APP.currentIndex, false); 
    }
    const vid = $('video-player');
    if (vid?.src) vid.play().catch(() => {});
    updatePlaybackState();
    updateGrillePlaybackUI();
    startPositionUpdater();
    requestWakeLock();
}

function stopPlayback(skipBroadcast = false) {
    Debug.TRANSPORT('stopPlayback()', { wasPlaying: APP.isPlaying });
    APP.currentHowl?.stop();
    APP.isPlaying = false;
    const vid = $('video-player');
    if (vid) { vid.pause(); vid.currentTime = 0; }
    updatePlaybackState();
    updateGrillePlaybackUI();
    releaseWakeLock();
}

function updateGrillePlaybackUI() {
    const nowPlaying = $('radio-now-playing');
    const powerBtn = $('grille-power-btn');
    
    if (APP.currentBand === BANDS.RADIO) {
        if (APP.isPlaying) {
            nowPlaying?.classList.add('visible');
            powerBtn?.classList.remove('visible');
        } else if (APP.manuallyPaused) {
            nowPlaying?.classList.remove('visible');
            powerBtn?.classList.remove('visible');
        } else {
            nowPlaying?.classList.remove('visible');
            powerBtn?.classList.add('visible');
        }
    } else {
        nowPlaying?.classList.remove('visible');
        powerBtn?.classList.remove('visible');
    }
}

function updateRadioNowPlaying(track) {
    const display = $('radio-now-playing');
    if (!display) return;
    if (APP.currentBand === BANDS.RADIO && track) {
        display.querySelector('.now-playing-artist').textContent = Track.getArtist(track);
        display.querySelector('.now-playing-title').textContent = Track.getTitle(track);
        updateGrillePlaybackUI();
    } else {
        display.classList.remove('visible');
    }
}

function updateVolumeKnobRotation(volume) {
    const knob = $('volume-btn');
    if (knob) knob.style.transform = `rotate(${-135 + volume * 270}deg)`;
}

function updateTransportButtonStates() {
    ['stop-btn', 'pause-btn', 'play-btn'].forEach(id => $(id)?.classList.remove('active'));
    $(APP.isPlaying ? 'play-btn' : 'pause-btn')?.classList.add('active');
}

function updateArrowButtons() {
    // Arrows are always enabled since playlists wrap around
    const left = $('left-arrow'), right = $('right-arrow');
    if (left) { left.style.opacity = '1'; left.style.pointerEvents = 'auto'; }
    if (right) { right.style.opacity = '1'; right.style.pointerEvents = 'auto'; }
}

// ============================================================================
// TRACK MANAGEMENT
// ============================================================================
function getCurrentTrackList() {
    if (APP.currentBand === BANDS.RADIO) return APP.radioPlaylist;
    return APP.playlist?.[APP.currentBand] || [];
}

function processRadioData() {
    if (!APP.radioData) return;
    let tracks = APP.radioData.filter(t => {
        if (APP.radioState.activeArtistFilter) return t.ParentFolder === APP.radioState.activeArtistFilter;
        if (APP.radioState.activeGenre) return t.Genre === APP.radioState.activeGenre;
        return true;
    });
    
    if (APP.radioState.isShuffled) tracks = shuffleArray([...tracks]);
    else tracks.sort((a, b) => (a.ParentFolder + a.Title).localeCompare(b.ParentFolder + b.Title));
    
    APP.radioPlaylist = tracks;
    
    const artistMap = new Map();
    APP.radioPlaylist.forEach((track, index) => {
        const key = Track.getFolder(track);
        if (!artistMap.has(key)) artistMap.set(key, { folder: key, artist: Track.getArtist(track), firstSongIndex: index, songCount: 0 });
        artistMap.get(key).songCount++;
    });
    APP.radioArtists = Array.from(artistMap.values());
}

function getTrackAudioUrl(track) {
    const rawSrc = track.src_audio;
    if (!rawSrc) return null;
    
    let srcAudio;
    if (track.sourceType === BANDS.RADIO || (track.ParentFolder && !track.sourceType)) {
        srcAudio = 'radio/' + cleanPath(rawSrc);
    } else if (track.sourceType === BANDS.BOOK1) {
        srcAudio = 'Book 1/' + cleanPath(rawSrc).replace(/^book\s?1\//i, '');
    } else if (track.sourceType === BANDS.BOOK2) {
        srcAudio = 'Book 2/' + cleanPath(rawSrc).replace(/^book\s?2\//i, '');
    } else if (rawSrc.toLowerCase().includes('book 1') || rawSrc.toLowerCase().includes('book1')) {
        srcAudio = 'Book 1/' + cleanPath(rawSrc).replace(/^book\s?1\//i, '');
    } else if (rawSrc.toLowerCase().includes('book 2') || rawSrc.toLowerCase().includes('book2')) {
        srcAudio = 'Book 2/' + cleanPath(rawSrc).replace(/^book\s?2\//i, '');
    } else {
        srcAudio = cleanPath(rawSrc);
    }
    return srcAudio ? getSecureUrl(srcAudio) : null;
}

function isTrackCached(track) {
    const url = getTrackAudioUrl(track);
    if (!url) return false;
    const absUrl = new URL(url, window.location.origin).href;
    return APP.cachedUrls.has(url) || APP.cachedUrls.has(absUrl);
}

function isTrackDownloaded(track) {
    const url = getTrackAudioUrl(track);
    if (!url) return false;
    const absUrl = new URL(url, window.location.origin).href;
    return APP.explicitDownloads.has(url) || APP.explicitDownloads.has(absUrl);
}

function markTrackAsDownloaded(track) {
    const url = getTrackAudioUrl(track);
    if (url) { APP.explicitDownloads.add(new URL(url, window.location.origin).href); saveExplicitDownloads(); }
}

function unmarkTrackAsDownloaded(track) {
    const url = getTrackAudioUrl(track);
    if (url) { const absUrl = new URL(url, window.location.origin).href; APP.explicitDownloads.delete(absUrl); APP.explicitDownloads.delete(url); saveExplicitDownloads(); }
}

function switchToBand(newBand) {
    APP.currentBand = newBand;
    APP.currentIndex = 0;
    APP.recentBandSwitch = true;
    if (APP.nextTrackHowl) { APP.nextTrackHowl.unload(); APP.nextTrackHowl = null; }
    APP.nextTrackSrc = null;
    if (APP.bandSwitchTimer) clearTimeout(APP.bandSwitchTimer);
    buildDial();
    APP.bandSwitchTimer = setTimeout(() => { APP.bandSwitchTimer = null; loadTrack(0); }, 100);
}

// ============================================================================
// TRACK LOADING & AUTOPLAY
// ============================================================================
function loadTrack(index, updateLayout = true, skipGainReset = false) {
    if (APP.loadTimer) clearTimeout(APP.loadTimer);
    APP.pendingIndex = index;
    APP.currentIndex = index; // Ensure currentIndex is in sync
    
    // Increment load ID to invalidate any pending callbacks from previous loads
    APP.loadId++;
    const thisLoadId = APP.loadId;
    
    const list = getCurrentTrackList();
    const track = list?.[index];
    if (!track) {
        Debug.warn('loadTrack: No track at index', { index, listLength: list?.length });
        return;
    }
    
    Debug.TRACK('loadTrack', { 
        index, 
        title: Track.getTitle(track), 
        artist: Track.getArtist(track),
        band: APP.currentBand,
        isPlaying: APP.isPlaying,
        loadId: thisLoadId
    });
    
    updateMediaSessionMetadata(track);
    updateRadioNowPlaying(track);
    updateProgramGuideNowPlaying(index);
    
    let srcAudio, srcVideo, isVideo;
    
    if (APP.currentBand === BANDS.RADIO) {
        srcAudio = 'radio/' + cleanPath(track.src_audio);
        srcVideo = null; isVideo = false;
    } else {
        const folderName = APP.currentBand === BANDS.BOOK1 ? 'Book 1' : APP.currentBand === BANDS.BOOK2 ? 'Book 2' : '';
        let rawSrc = track.src_audio;
        
        if (track.sourceType === BANDS.BOOK1) rawSrc = 'Book 1/' + cleanPath(rawSrc).replace(/^book\s?1\//i, '');
        else if (track.sourceType === BANDS.BOOK2) rawSrc = 'Book 2/' + cleanPath(rawSrc).replace(/^book\s?2\//i, '');
        else if (!folderName) rawSrc = cleanPath(track.src_audio);
        else rawSrc = folderName + '/' + track.src_audio.replace(/^book\s?[12]\//i, '');
        
        srcAudio = cleanPath(rawSrc);
        srcVideo = track.src_video ? cleanPath(track.src_video) : null;
        isVideo = srcVideo && /\.(mp4|mkv|webm)$/i.test(srcVideo);
    }
    
    if (srcAudio === APP.currentTrackSrc && !isVideo) {
        if (updateLayout) updateInterfaceLayout(false);
        return;
    }
    
    APP.currentTrackSrc = srcAudio;
    const excerptDisplay = $('excerpt-display');
    
    // Show excerpts only for Book I/II (not for Radio or Playlists)
    const showExcerpt = (APP.currentBand === BANDS.BOOK1 || APP.currentBand === BANDS.BOOK2) && track.excerpt;
    if (showExcerpt && excerptDisplay) {
        excerptDisplay.innerHTML = `<span class="page-ref">Page ${track.page}</span><p>${track.excerpt}</p>`;
        requestAnimationFrame(() => excerptDisplay.scrollTop = 0);
        if (!isVideo) excerptDisplay.classList.remove('fade-out');
        excerptDisplay.style.display = '';
    } else if (excerptDisplay) {
        // Hide excerpt display for Radio and Playlists
        excerptDisplay.innerHTML = '';
        excerptDisplay.style.display = 'none';
    }
    if (updateLayout) updateInterfaceLayout(isVideo);
    
    const videoPlayer = $('video-player');
    
    // Clean up any pending video error handler from previous loads
    if (APP.pendingVideoErrorHandler) {
        videoPlayer?.removeEventListener('error', APP.pendingVideoErrorHandler);
        APP.pendingVideoErrorHandler = null;
    }
    
    if (isVideo) {
        if (APP.currentHowl) { APP.currentHowl.stop(); APP.currentHowl.unload(); }
        
        // Store audio fallback info AND the intended playback state
        APP.videoFallbackAudio = srcAudio;
        APP.videoFallbackIndex = index;
        const shouldPlayOnFallback = APP.isPlaying; // Capture intent at load time
        const capturedLoadId = thisLoadId; // Capture load ID for this specific load
        
        // Set up error handler for video fallback to MP3
        const handleVideoError = () => {
            // Check if this load is still current - if not, ignore
            if (APP.loadId !== capturedLoadId) {
                Debug.warn('Video error handler ignored (stale load)', { capturedLoadId, currentLoadId: APP.loadId });
                videoPlayer.removeEventListener('error', handleVideoError);
                APP.pendingVideoErrorHandler = null;
                return;
            }
            
            Debug.warn('Video failed to load, falling back to MP3', { video: srcVideo, audio: srcAudio, shouldPlay: shouldPlayOnFallback });
            videoPlayer.removeEventListener('error', handleVideoError);
            APP.pendingVideoErrorHandler = null;
            videoPlayer.pause();
            videoPlayer.removeAttribute('src');
            videoPlayer.load();
            
            // Update UI to non-video mode
            updateInterfaceLayout(false);
            
            // Load the audio fallback instead - double check load ID is still current
            if (APP.videoFallbackAudio && APP.loadId === capturedLoadId) {
                const targetUrl = getSecureUrl(APP.videoFallbackAudio);
                const fallbackHowl = new Howl({
                    src: [targetUrl], format: ['mp3'], html5: true,
                    onend: () => { Debug.PLAYBACK('Howl onend (fallback)', { currentIndex: APP.currentIndex }); setTimeout(handleAutoplay, 100); },
                    onplay: () => { Debug.PLAYBACK('Howl onplay (fallback)'); APP.isPlaying = true; APP.manuallyPaused = false; updatePlaybackState(); updateTransportButtonStates(); updateGrillePlaybackUI(); startPositionUpdater(); requestWakeLock(); },
                    onpause: () => { Debug.PLAYBACK('Howl onpause (fallback)'); APP.isPlaying = false; updatePlaybackState(); updateTransportButtonStates(); if (APP.manuallyPaused) updateGrillePlaybackUI(); },
                    onstop: () => { Debug.PLAYBACK('Howl onstop (fallback)', { isTransitioning: APP.isTransitioning }); if (APP.isTransitioning) return; APP.isPlaying = false; updatePlaybackState(); updateTransportButtonStates(); },
                    onload: function() { Debug.AUDIO('Howl onload (fallback)'); if (APP.currentHowl !== this) { this.unload(); return; } if (APP.isPlaying) updatePositionState(); },
                    onloaderror: (id, error) => { Debug.error('Fallback Howl load error', error); if (APP.loadId === capturedLoadId) setTimeout(handleAutoplay, 500); },
                    onplayerror: (id, error) => { Debug.error('Fallback Howl play error', error); APP.currentHowl?.once('unlock', () => APP.currentHowl?.play()); }
                });
                
                APP.currentHowl = fallbackHowl;
                APP.currentTrackSrc = APP.videoFallbackAudio;
                
                // Use captured intent OR current state - if either says play, play
                if (shouldPlayOnFallback || APP.isPlaying) {
                    APP.isPlaying = true;
                    notifyPlaybackStarted();
                    APP.currentHowl.play();
                    updatePlaybackState();
                    updateTransportButtonStates();
                    Debug.PLAYBACK('Fallback audio started', { shouldPlayOnFallback, wasPlaying: APP.isPlaying });
                } else {
                    Debug.PLAYBACK('Fallback audio NOT auto-started (paused state)', { shouldPlayOnFallback, isPlaying: APP.isPlaying });
                }
            }
        };
        
        // Store handler reference for cleanup on next load
        APP.pendingVideoErrorHandler = handleVideoError;
        videoPlayer.addEventListener('error', handleVideoError, { once: true });
        videoPlayer.src = getSecureUrl(srcVideo);
        videoPlayer.load();
        videoPlayer.muted = false;
        videoPlayer.volume = APP.volume;
        if (APP.isPlaying) { videoPlayer.play().catch(() => {}); updatePlaybackState(); }
        return;
    } else if (videoPlayer) {
        videoPlayer.pause();
        videoPlayer.removeAttribute('src');
        videoPlayer.load();
    }
    
    if (APP.nextTrackHowl) { APP.nextTrackHowl.unload(); APP.nextTrackHowl = null; APP.nextTrackSrc = null; }
    
    const targetUrl = getSecureUrl(srcAudio);
    Debug.AUDIO('Creating Howl', { url: targetUrl, isPlaying: APP.isPlaying, loadId: thisLoadId });
    
    // Track retry attempts for this URL
    if (!APP.loadRetryCount) APP.loadRetryCount = {};
    const retryKey = srcAudio;
    const capturedLoadId = thisLoadId; // Capture for callbacks
    
    const newHowl = new Howl({
        src: [targetUrl], format: ['mp3'], html5: true,
        onend: () => { 
            // Only autoplay if this load is still current
            if (APP.loadId !== capturedLoadId) return;
            Debug.PLAYBACK('Howl onend', { currentIndex: APP.currentIndex }); 
            setTimeout(handleAutoplay, 100); 
        },
        onplay: () => { 
            Debug.PLAYBACK('Howl onplay'); 
            APP.isPlaying = true; 
            APP.manuallyPaused = false; 
            // Clear retry count on successful play
            APP.loadRetryCount[retryKey] = 0;
            updatePlaybackState(); 
            updateTransportButtonStates(); 
            updateGrillePlaybackUI(); 
            startPositionUpdater();
            // Request wake lock to keep screen on during playback
            requestWakeLock();
        },
        onpause: () => { 
            Debug.PLAYBACK('Howl onpause'); 
            APP.isPlaying = false; 
            updatePlaybackState(); 
            updateTransportButtonStates(); 
            if (APP.manuallyPaused) {
                updateGrillePlaybackUI();
                releaseWakeLock();
            }
        },
        onstop: () => { 
            Debug.PLAYBACK('Howl onstop', { isTransitioning: APP.isTransitioning }); 
            if (APP.isTransitioning) return; 
            APP.isPlaying = false; 
            updatePlaybackState(); 
            updateTransportButtonStates();
            // Note: Don't release wake lock here - only release on explicit pause/stop
            // Otherwise track transitions would release it prematurely
        },
        onload: function() { 
            Debug.AUDIO('Howl onload'); 
            // Clear retry count on successful load
            APP.loadRetryCount[retryKey] = 0;
            if (APP.currentHowl !== this) { this.unload(); return; } 
            if (APP.isPlaying) updatePositionState(); 
        },
        onloaderror: (id, error) => { 
            // Ignore errors from stale loads
            if (APP.loadId !== capturedLoadId) {
                Debug.warn('Howl load error ignored (stale load)', { capturedLoadId, currentLoadId: APP.loadId });
                return;
            }
            
            Debug.error('Howl load error', { error, online: APP.isOnline, retryCount: APP.loadRetryCount[retryKey] || 0 });
            
            const currentRetries = APP.loadRetryCount[retryKey] || 0;
            const MAX_RETRIES = 3;
            
            if (!APP.isOnline) {
                // Offline - mark for retry when back online
                Debug.STATE('Offline, will retry when network restored');
                APP.pendingNetworkRetry = true;
                showToast('Connection lost. Will retry when online.', 5000, 'error');
            } else if (currentRetries < MAX_RETRIES) {
                // Online but failed - retry with exponential backoff
                APP.loadRetryCount[retryKey] = currentRetries + 1;
                const delay = Math.min(1000 * Math.pow(2, currentRetries), 8000);
                Debug.PLAYBACK(`Retrying load in ${delay}ms (attempt ${currentRetries + 1}/${MAX_RETRIES})`);
                
                setTimeout(() => {
                    // Double-check load is still current before retrying
                    if (APP.loadId === capturedLoadId && APP.currentIndex === index) {
                        Debug.PLAYBACK('Executing retry');
                        loadTrack(index, false, true);
                    }
                }, delay);
            } else {
                // Max retries exceeded - skip to next track
                Debug.warn('Max retries exceeded, skipping track');
                APP.loadRetryCount[retryKey] = 0;
                showToast('Track unavailable, skipping...', 3000, 'error');
                setTimeout(handleAutoplay, 500);
            }
        },
        onplayerror: async (id, error) => { 
            Debug.error('Howl play error', error); 
            
            // Try to recover by resuming audio context
            const contextReady = await ensureAudioContextRunning();
            
            if (contextReady) {
                Debug.PLAYBACK('AudioContext resumed after play error, retrying');
                // Small delay to let the context settle
                setTimeout(() => {
                    if (APP.currentHowl && !APP.currentHowl.playing()) {
                        APP.currentHowl.play();
                    }
                }, 100);
            } else {
                Debug.warn('AudioContext still not ready, waiting for unlock');
                // Wait for user unlock (gesture required on some browsers/platforms)
                APP.currentHowl?.once('unlock', () => {
                    Debug.PLAYBACK('Howl unlocked, attempting play');
                    APP.currentHowl?.play();
                });
            }
        }
    });
    
    if (APP.currentHowl) {
        if (shouldUseSimpleTransitions()) {
            APP.currentHowl.stop();
            APP.currentHowl.unload();
        } else if (APP.currentHowl.playing()) {
            if (APP.fadingHowl) APP.fadingHowl.unload();
            APP.fadingHowl = APP.currentHowl;
            APP.fadingHowl.fade(APP.fadingHowl.volume(), 0, 1500);
            setTimeout(() => { if (APP.fadingHowl) APP.fadingHowl.unload(); }, 1500);
        } else {
            APP.currentHowl.unload();
        }
    }
    
    APP.currentHowl = newHowl;
    
    if (APP.isPlaying) {
        Debug.PLAYBACK('Starting playback', { volume: APP.volume });
        notifyPlaybackStarted();
        APP.currentHowl.play();
        if (!shouldUseSimpleTransitions()) APP.currentHowl.fade(0, APP.volume, 500);
        updatePlaybackState();
        updateTransportButtonStates();
    }
    
    if (APP.currentHowl._sounds.length > 0 && APP.currentHowl._sounds[0]._node && APP.audioContext) {
        try { APP.audioContext.createMediaElementSource(APP.currentHowl._sounds[0]._node).connect(APP.musicGain); } catch(e) {}
    }
    
    APP.recentBandSwitch = false;
}

function handleAutoplay() {
    Debug.PLAYBACK('handleAutoplay triggered', { currentIndex: APP.currentIndex, isRepeat: APP.radioState.isRepeat });
    
    const list = getCurrentTrackList();
    if (!list || list.length === 0) {
        Debug.warn('handleAutoplay: No tracks in list');
        APP.isPlaying = false;
        updatePlaybackState();
        updateTransportButtonStates();
        updateGrillePlaybackUI();
        return;
    }
    
    const max = list.length;
    const currentIdx = APP.currentIndex;
    let nextIndex;
    
    // Determine next track - wrap around if at end
    if (currentIdx + 1 < max) {
        nextIndex = currentIdx + 1;
    } else {
        // At end of playlist - wrap to beginning
        nextIndex = 0;
        Debug.PLAYBACK('Reached end of playlist, wrapping to start');
    }
    
    // Reset manuallyPaused since song ended naturally
    APP.manuallyPaused = false;
    
    const isSimple = shouldUseSimpleTransitions();
    Debug.PLAYBACK('Starting next track', { 
        fromIndex: currentIdx, 
        toIndex: nextIndex, 
        isSimple, 
        isRepeat: APP.radioState.isRepeat,
        trackTitle: Track.getTitle(list[nextIndex])
    });
    
    if (isSimple) {
        // Background mode: skip static effect, just load directly
        Debug.PLAYBACK('Background: advancing to next track', { nextIndex });
        APP.currentIndex = nextIndex; 
        APP.isTransitioning = true; 
        APP.isPlaying = true;
        loadTrack(nextIndex, false, true); 
        APP.isTransitioning = false;
    } else {
        // Foreground mode: use tuneToStation with static effect
        Debug.PLAYBACK('Foreground: advancing with static effect', { nextIndex });
        APP.isTransitioning = true;
        APP.isPlaying = true;
        tuneToStationWithStatic(nextIndex);
        // isTransitioning will be cleared when the tune animation completes
        setTimeout(() => { APP.isTransitioning = false; }, 600);
    }
}

// Tune to station with static transition effect (for autoplay in foreground)
function tuneToStationWithStatic(index) {
    if (APP.bandSwitchTimer) { clearTimeout(APP.bandSwitchTimer); APP.bandSwitchTimer = null; }
    
    // Set the current index before animation
    APP.currentIndex = index;
    
    if (APP.currentBand === BANDS.RADIO) {
        const fmTrack = $('fm-track');
        const song = APP.radioPlaylist[index];
        let artistIdx = song ? APP.radioArtists.findIndex(a => a.folder === song.ParentFolder) : 0;
        snapVirtualTo(index, false, null, true); // loadAudio=true triggers static and load
        if (artistIdx !== -1) snapToPosition(fmTrack, fmTrack.parentElement, artistIdx, false, null, false);
    } else {
        const track = $('dial-track');
        if (track) snapToPosition(track, track.parentElement, index, false, null, true);
        else loadTrack(index, true, true);
    }
}

function tuneToStation(index) {
    if (APP.bandSwitchTimer) { clearTimeout(APP.bandSwitchTimer); APP.bandSwitchTimer = null; }
    
    if (APP.currentBand === BANDS.RADIO) {
        const fmTrack = $('fm-track');
        const song = APP.radioPlaylist[index];
        let artistIdx = song ? APP.radioArtists.findIndex(a => a.folder === song.ParentFolder) : 0;
        snapVirtualTo(index, false, null, true);
        if (artistIdx !== -1) snapToPosition(fmTrack, fmTrack.parentElement, artistIdx, false, null, true);
    } else {
        const track = $('dial-track');
        if (track) snapToPosition(track, track.parentElement, index, false, null, true);
        else loadTrack(index, true, true);
    }
}

function updateInterfaceLayout(isVideo) {
    const grille = qs('.speaker-grille');
    const controls = qs('.control-strip');
    
    if (isVideo) {
        grille.classList.add('maximized', 'video-mode');
        controls.classList.add('minimized');
        $('video-overlay').classList.add('active');
    } else {
        grille.classList.remove('maximized', 'video-mode');
        controls.classList.remove('minimized');
        $('video-overlay').classList.remove('active');
    }
    
    setTimeout(() => {
        const ref = qs('.station');
        if (ref?.offsetWidth > 0) APP.sectionWidth = ref.offsetWidth;

        if (APP.currentBand === BANDS.RADIO) {
            setupDualDraggables();
            // REFACTORED:
            DialRenderer.animateSnap($('am-proxy'), -(APP.currentIndex * APP.sectionWidth), {
                immediate: true,
                onUpdate: () => DialRenderer.renderVirtualPool(APP.virtualState.pool, APP.radioPlaylist, -(APP.currentIndex * APP.sectionWidth), $('main-dial-container').offsetWidth, APP.sectionWidth)
            });

            const fmTrack = $('fm-track');
            const song = APP.radioPlaylist[APP.currentIndex];
            if (song && fmTrack) {
                const artistIdx = APP.radioArtists.findIndex(a => a.folder === song.ParentFolder);
                if (artistIdx !== -1) {
                    // REFACTORED:
                    DialRenderer.animateSnap(fmTrack, ($('main-dial-container').offsetWidth/2) - (artistIdx * APP.sectionWidth) - APP.sectionWidth/2, {
                        immediate: true,
                        onUpdate: () => DialRenderer.updateStationStyles(fmTrack.parentElement, fmTrack, APP.sectionWidth)
                    });
                }
            }
        } else {
            setupSingleDraggable();
            const track = $('dial-track');
            if (track) {
                // REFACTORED:
                DialRenderer.animateSnap(track, ($('main-dial-container').offsetWidth/2) - (APP.currentIndex * APP.sectionWidth) - APP.sectionWidth/2, {
                    immediate: true,
                    onUpdate: () => DialRenderer.updateStationStyles(track.parentElement, track, APP.sectionWidth)
                });
            }
        }
    }, 850);
}

// ============================================================================
// DIAL UI
// ============================================================================
function hideOnboardingHints() {
    if (APP.hasInteracted) return;
    APP.hasInteracted = true;
    qsa('.scroll-indicator').forEach(el => el.classList.add('hidden'));
}

function buildDial() {
    const container = $('main-dial-container');
    const isRadio = APP.currentBand === BANDS.RADIO;
    
    if (Draggable.get("#dial-track")) Draggable.get("#dial-track").kill();
    if (Draggable.get("#fm-track")) Draggable.get("#fm-track").kill();
    if (Draggable.get("#am-proxy")) Draggable.get("#am-proxy").kill();
    
    const indicatorClass = APP.hasInteracted ? 'scroll-indicator hidden' : 'scroll-indicator';
    
    if (isRadio) {
        container.classList.add('dual-mode');
        
        const itemWidth = APP.sectionWidth || 150;
        const screenWidth = container.offsetWidth || window.innerWidth;
        APP.virtualState.poolSize = Math.max(24, Math.ceil(screenWidth / itemWidth) * 3);
        const totalWidth = APP.radioPlaylist.length * itemWidth;
        
        let poolHTML = '';
        for (let i = 0; i < APP.virtualState.poolSize; i++) {
            poolHTML += `<div class="station virtual-item" data-pool-index="${i}" style="will-change:transform,opacity;"><div class="title"></div></div>`;
        }
        
        container.innerHTML = `
            <div class="band-label fm-label">FM</div>
            <div class="band-label am-label">AM</div>
            <div class="radio-band fm-band">
                <div class="${indicatorClass} left">&#x300A;</div>
                <div class="${indicatorClass} right">&#x27EB;</div>
                <div class="dial-track" id="fm-track">
                    ${APP.radioArtists.map((a, i) => `<div class="station" data-index="${i}"><div class="artist">${a.artist}</div></div>`).join('')}
                </div>
            </div>
            <div class="radio-band am-band">
                <div class="${indicatorClass} left">&#x300A;</div>
                <div class="${indicatorClass} right">&#x27EB;</div>
                <div class="virtual-proxy" id="am-proxy" style="width:${totalWidth}px;"></div>
                <div class="dial-track" id="am-track">${poolHTML}</div>
            </div>
            <div class="needle"></div>
        `;
        
        const excerpt = $('excerpt-display');
        if (excerpt) { excerpt.innerHTML = ''; excerpt.style.display = 'none'; }
        updateGrillePlaybackUI();
        
        APP.virtualState.pool = Array.from(document.querySelectorAll('.virtual-item'));
        
        setTimeout(() => {
			const ref = qs('#fm-track .station');
			if (ref?.offsetWidth > 0) APP.sectionWidth = ref.offsetWidth;
			const amProxy = $('am-proxy');
			if (amProxy) amProxy.style.width = (APP.radioPlaylist.length * APP.sectionWidth) + 'px';
			
			setupDualDraggables();
			
			DialRenderer.renderVirtualPool(
				APP.virtualState.pool,
				APP.radioPlaylist,
				APP.currentIndex * -APP.sectionWidth,
				container.offsetWidth,
				APP.sectionWidth
			);
		}, 50);
    } else {
        container.classList.remove('dual-mode');
        const excerpt = $('excerpt-display');
        if (excerpt) excerpt.style.display = '';
        updateGrillePlaybackUI();
        
        const playlist = getCurrentTrackList();
        container.innerHTML = `
            <div class="${indicatorClass} left" id="scroll-left">&#x300A;</div>
            <div class="${indicatorClass} right" id="scroll-right">&#x27EB;</div>
            <div class="needle"></div>
            <div class="dial-track" id="dial-track">
                ${playlist?.length ? playlist.map((item, i) => `<div class="station" data-index="${i}"><div class="artist">${Track.getArtist(item)}</div><div class="title">${Track.getTitle(item)}</div></div>`).join('') : '<div class="station" style="width:100%"><div class="title">No Signal</div></div>'}
            </div>
        `;
        
        setTimeout(() => {
            const first = qs('#dial-track .station');
            if (first?.offsetWidth > 0) APP.sectionWidth = first.offsetWidth;
            setupSingleDraggable();
        }, 50);
    }
    
    updateArrowButtons();
    setupDialScrollIndicators();
}

function setupDialScrollIndicators() {
    const container = $('main-dial-container');
    if (!container) return;
    
    container.querySelectorAll('.scroll-indicator.left').forEach(el => {
        const clone = el.cloneNode(true);
        el.parentNode.replaceChild(clone, el);
    });
    container.querySelectorAll('.scroll-indicator.right').forEach(el => {
        const clone = el.cloneNode(true);
        el.parentNode.replaceChild(clone, el);
    });
    
    container.querySelectorAll('.scroll-indicator.left').forEach(el => {
        el.addEventListener('click', e => { e.stopPropagation(); handleDialIndicatorClick('left', el); });
    });
    container.querySelectorAll('.scroll-indicator.right').forEach(el => {
        el.addEventListener('click', e => { e.stopPropagation(); handleDialIndicatorClick('right', el); });
    });
}

function handleDialIndicatorClick(direction, element) {
    hideOnboardingHints();
    const parentBand = element.closest('.radio-band');
    const isFmBand = parentBand?.classList.contains('fm-band');
    const isAmBand = parentBand?.classList.contains('am-band');
    
    Debug.UI('Dial indicator clicked', { direction, isFmBand, isAmBand, currentBand: APP.currentBand });
    
    // Force restart the CSS animation after click
    // This fixes animation getting stuck after interaction
    setTimeout(() => {
        element.style.animation = 'none';
        element.offsetHeight; // Trigger reflow
        element.style.animation = '';
    }, 100);
    
    // Start playback if not playing
    if (!APP.isPlaying) {
        APP.isPlaying = true;
        APP.manuallyPaused = false;
    }
    
    if (APP.currentBand === BANDS.RADIO) {
        if (isFmBand) {
            // FM band - navigate by artist with wrap-around
            const maxArtist = APP.radioArtists.length - 1;
            let newIndex;
            if (direction === 'left') {
                newIndex = APP.radioState.lastArtistIndex > 0 ? APP.radioState.lastArtistIndex - 1 : maxArtist;
            } else {
                newIndex = APP.radioState.lastArtistIndex < maxArtist ? APP.radioState.lastArtistIndex + 1 : 0;
            }
            APP.radioState.lastArtistIndex = newIndex;
            const artist = APP.radioArtists[newIndex];
            if (artist) {
                APP.currentIndex = artist.firstSongIndex;
                snapVirtualTo(APP.currentIndex, false, null, true);
                const fmTrack = $('fm-track');
                if (fmTrack) snapToPosition(fmTrack, fmTrack.parentElement, newIndex, false);
            }
        } else if (isAmBand) {
            // AM band - navigate by track with wrap-around
            const list = getCurrentTrackList();
            const maxTrack = list.length - 1;
            let newIndex;
            if (direction === 'left') {
                newIndex = APP.currentIndex > 0 ? APP.currentIndex - 1 : maxTrack;
            } else {
                newIndex = APP.currentIndex < maxTrack ? APP.currentIndex + 1 : 0;
            }
            if (newIndex !== APP.currentIndex) tuneToStation(newIndex);
        } else {
            // Radio band but not in FM/AM sub-band - treat as AM (track navigation)
            const list = getCurrentTrackList();
            const maxTrack = list.length - 1;
            let newIndex;
            if (direction === 'left') {
                newIndex = APP.currentIndex > 0 ? APP.currentIndex - 1 : maxTrack;
            } else {
                newIndex = APP.currentIndex < maxTrack ? APP.currentIndex + 1 : 0;
            }
            if (newIndex !== APP.currentIndex) tuneToStation(newIndex);
        }
    } else {
        // Non-radio bands (Book 1, Book 2, Playlists) - wrap-around
        const list = getCurrentTrackList();
        if (!list || list.length === 0) return;
        const maxTrack = list.length - 1;
        let newIndex;
        if (direction === 'left') {
            newIndex = APP.currentIndex > 0 ? APP.currentIndex - 1 : maxTrack;
        } else {
            newIndex = APP.currentIndex < maxTrack ? APP.currentIndex + 1 : 0;
        }
        if (newIndex !== APP.currentIndex) tuneToStation(newIndex);
    }
}

function setupSingleDraggable() {
    const track = $('dial-track');
    if (!track) return;
    const container = track.parentElement;
    const list = getCurrentTrackList();
    
    // onDrag callback should NOT load track - only update index for UI feedback
    // onDragEnd callback loads the track
    setupGenericDraggable(track, container, list, idx => { APP.currentIndex = idx; }, idx => { APP.currentIndex = idx; loadTrack(idx, true); });
    
    const centerOffset = container.offsetWidth / 2;
    gsap.set(track, { x: centerOffset - (APP.currentIndex * APP.sectionWidth) - APP.sectionWidth / 2 });
    updateActiveStations(track);
}

function setupDualDraggables() {
    const fmTrack = $('fm-track');
    const amProxy = $('am-proxy');
    const totalItems = APP.radioPlaylist.length;
    const totalWidth = totalItems * APP.sectionWidth;
    const minX = -(totalWidth - APP.sectionWidth);
    const maxX = 0;
    
    function handleVirtualDrag(x) {
        APP.isDragging = true;
        const rawIndex = -x / APP.sectionWidth;
        const clampedIndex = Math.max(0, Math.min(Math.round(rawIndex), totalItems - 1));
        const distanceToSnap = Math.abs(rawIndex - clampedIndex);
        const volume = APP.volume || 0; // Guard against undefined
        
        // Only affect music gain if playing
        if (APP.isPlaying && APP.musicGain) {
            APP.musicGain.gain.value = (1 - distanceToSnap) * volume;
        }
        // Always play static during tuning to indicate "between stations"
        setStaticGain(distanceToSnap * 0.15 * volume);
        renderVirtualDial(x);
        
        if (clampedIndex !== APP.currentIndex) {
            APP.currentIndex = clampedIndex;
            const song = APP.radioPlaylist[clampedIndex];
            if (song) {
                const artistIndex = APP.radioArtists.findIndex(a => a.folder === song.ParentFolder);
                if (artistIndex !== -1 && artistIndex !== APP.radioState.lastArtistIndex) {
                    APP.radioState.lastArtistIndex = artistIndex;
                    snapToPosition(fmTrack, fmTrack.parentElement, artistIndex, false);
                    updateActiveStations(fmTrack);
                }
            }
        }
    }
    
    setupGenericDraggable(fmTrack, fmTrack.parentElement, APP.radioArtists,
        idx => {
            const artist = APP.radioArtists[idx];
            if (artist && APP.radioState.lastArtistIndex !== idx) {
                APP.radioState.lastArtistIndex = idx;
                APP.currentIndex = artist.firstSongIndex;
                snapVirtualTo(APP.currentIndex, true);
            }
        },
        idx => {
            const artist = APP.radioArtists[idx];
            if (artist) {
                APP.currentIndex = artist.firstSongIndex;
                snapVirtualTo(APP.currentIndex, false, () => loadTrack(APP.currentIndex, false));
            }
        }
    );
    
    let lastX = 0, lastTime = 0, velocity = 0, trackerId = null;
    let amStartIndex = -1; // Track starting index for AM band
    const momentumFactor = 300;
    
    Draggable.create(amProxy, {
        type: 'x', trigger: amProxy.parentElement,
        bounds: { minX, maxX }, inertia: false, edgeResistance: 0.7,
        onPress: function() {
            hideOnboardingHints();
            gsap.killTweensOf(amProxy);
            APP.isTransitioning = false;
            APP.isDragging = true;
            lastX = this.x; lastTime = Date.now(); velocity = 0;
            // Remember starting index
            amStartIndex = Math.round(-this.x / APP.sectionWidth);
            amStartIndex = Math.max(0, Math.min(amStartIndex, totalItems - 1));
            const trackVelocity = () => {
                const now = Date.now();
                const dt = now - lastTime;
                if (dt > 0) { velocity = ((this.x - lastX) / dt) * 0.6 + velocity * 0.4; lastX = this.x; lastTime = now; }
                if (this.isPressed) trackerId = requestAnimationFrame(trackVelocity);
            };
            trackVelocity();
        },
        onDrag: function() { handleVirtualDrag(this.x); },
        onDragEnd: function() {
            cancelAnimationFrame(trackerId);
            APP.isDragging = false;
            const throwDist = Math.abs(velocity) > 0.2 ? velocity * momentumFactor : 0;
            let finalIndex = Math.round(-(this.x + throwDist) / APP.sectionWidth);
            finalIndex = Math.max(0, Math.min(finalIndex, totalItems - 1));
            
            // If user swiped to a different track, start playback
            const shouldStartPlayback = finalIndex !== amStartIndex || !APP.isPlaying;
            if (shouldStartPlayback) {
                APP.isPlaying = true;
                APP.manuallyPaused = false;
            }
            
            APP.currentIndex = finalIndex;
            snapVirtualTo(finalIndex, false, () => loadTrack(finalIndex, false));
        }
    });
    
    const currentSong = APP.radioPlaylist[APP.currentIndex];
    let artistIdx = currentSong ? APP.radioArtists.findIndex(a => a.folder === currentSong.ParentFolder) : 0;
    if (artistIdx !== -1) APP.radioState.lastArtistIndex = artistIdx;
    
    snapVirtualTo(APP.currentIndex, true);
    snapToPosition(fmTrack, fmTrack.parentElement, artistIdx !== -1 ? artistIdx : 0, true);
    updateActiveStations(fmTrack);
}

function setupGenericDraggable(track, container, dataList, onDragCallback, onEndCallback) {
    if (!dataList?.length) return;
    
    const totalWidth = dataList.length * APP.sectionWidth;
    const centerOffset = container.offsetWidth / 2;
    const minX = centerOffset - totalWidth + APP.sectionWidth / 2;
    const maxX = centerOffset - APP.sectionWidth / 2;
    
    let lastX = 0, lastTime = 0, velocity = 0, trackerId = null;
    let startIndex = -1; // Track starting index
    const momentumFactor = 300;
    
    Draggable.create(track, {
        type: 'x', trigger: container,
        bounds: { minX, maxX }, edgeResistance: 0.7, inertia: false,
        onPress: function() {
            hideOnboardingHints();
            gsap.killTweensOf(track);
            APP.isTransitioning = false;
            APP.isDragging = true;
            lastX = this.x; lastTime = Date.now(); velocity = 0;
            // Remember starting index
            const offset = centerOffset - this.x - APP.sectionWidth / 2;
            startIndex = Math.max(0, Math.min(Math.round(offset / APP.sectionWidth), dataList.length - 1));
            const trackVelocity = () => {
                const now = Date.now();
                const dt = now - lastTime;
                if (dt > 0) { velocity = ((this.x - lastX) / dt) * 0.6 + velocity * 0.4; lastX = this.x; lastTime = now; }
                if (this.isPressed) trackerId = requestAnimationFrame(trackVelocity);
            };
            trackVelocity();
        },
        onDrag: function() {
			APP.isDragging = true;

			DialRenderer.updateStationStyles(container, track, APP.sectionWidth);
			
			const offset = centerOffset - this.x - APP.sectionWidth / 2;
			let currentIndex = Math.max(0, Math.min(Math.round(offset / APP.sectionWidth), dataList.length - 1));
			if (onDragCallback) onDragCallback(currentIndex);
		},
		onDragEnd: function() {
			cancelAnimationFrame(trackerId);
			APP.isDragging = false;
			
			// Calculate where to land
			const throwDist = Math.abs(velocity) > 0.2 ? velocity * momentumFactor : 0;
			const offset = centerOffset - (this.x + throwDist) - APP.sectionWidth / 2;
			let finalIndex = Math.max(0, Math.min(Math.round(offset / APP.sectionWidth), dataList.length - 1));
			
			// Calculate exact target X position
			const targetX = centerOffset - (finalIndex * APP.sectionWidth) - APP.sectionWidth / 2;

			// If user swiped to a different track, start playback
			const shouldStartPlayback = finalIndex !== startIndex || !APP.isPlaying;
			if (shouldStartPlayback) {
			    APP.isPlaying = true;
			    APP.manuallyPaused = false;
			}

			// NEW: Use unified animateSnap
			DialRenderer.animateSnap(track, targetX, {
				duration: 0.5,
				ease: 'power2.out',
				trackAudio: true, // Enable static/volume dip during snap
				onUpdate: () => DialRenderer.updateStationStyles(container, track, APP.sectionWidth),
				onComplete: () => { 
					if (onEndCallback) onEndCallback(finalIndex); 
				}
			});
		}
	});
}
// ============================================================================
// DIAL HELPER FUNCTIONS (Wrappers for DialRenderer)
// ============================================================================

/**
 * Update active station styling for physical dial elements (non-virtualized)
 */
function updateActiveStations(trackElement) {
    if (!trackElement) return;
    const container = trackElement.parentElement;
    DialRenderer.updateStationStyles(container, trackElement, APP.sectionWidth);
}

/**
 * Render the virtual dial (AM band) at a given x position
 */
function renderVirtualDial(x) {
    if (!APP.virtualState.pool.length) return;
    const container = $('main-dial-container');
    if (!container) return;
    
    DialRenderer.renderVirtualPool(
        APP.virtualState.pool,
        APP.radioPlaylist,
        x,
        container.offsetWidth,
        APP.sectionWidth
    );
}

/**
 * Snap physical dial to a specific index position
 * Legacy wrapper for DialRenderer.animateSnap
 */
function snapToPosition(track, container, index, immediate = false, callback = null, loadAudio = false) {
    if (!track || !container) return;
    
    const centerOffset = container.offsetWidth / 2;
    const targetX = centerOffset - (index * APP.sectionWidth) - APP.sectionWidth / 2;
    
    DialRenderer.animateSnap(track, targetX, {
        immediate: immediate,
        trackAudio: loadAudio && !immediate,
        onUpdate: () => DialRenderer.updateStationStyles(container, track, APP.sectionWidth),
        onComplete: () => {
            if (loadAudio) loadTrack(index, false);
            if (callback) callback();
        }
    });
}

/**
 * Snap virtual dial (AM band) to a specific index position
 * Legacy wrapper for DialRenderer.animateSnap
 */
function snapVirtualTo(index, immediate = false, callback = null, loadAudio = false) {
    const amProxy = $('am-proxy');
    if (!amProxy) return;
    
    const targetX = -(index * APP.sectionWidth);
    
    DialRenderer.animateSnap(amProxy, targetX, {
        immediate: immediate,
        trackAudio: loadAudio && !immediate,
        onUpdate: () => renderVirtualDial(gsap.getProperty(amProxy, 'x')),
        onComplete: () => {
            if (loadAudio) loadTrack(index, false);
            if (callback) callback();
        }
    });
}

// ============================================================================
// PROGRAM GUIDE
// ============================================================================
function updateProgramGuideNowPlaying(currentIndex) {
    const content = $('program-guide-content');
    if (!content) return;
    const playIcon = `<svg viewBox="0 0 24 24" width="12" height="12" style="vertical-align: middle; margin-right: 4px;"><polygon fill="currentColor" points="8,5 19,12 8,19"></polygon></svg>`;
    content.querySelectorAll('.program-item.active-track').forEach(item => {
        item.classList.remove('active-track');
        item.querySelector('.now-playing-indicator')?.remove();
    });
    content.querySelectorAll('.program-item[data-index]').forEach(item => {
        if (parseInt(item.dataset.index) === currentIndex) {
            item.classList.add('active-track');
            const actions = item.querySelector('.program-item-actions');
            if (actions && !actions.querySelector('.now-playing-indicator')) {
                const indicator = document.createElement('div');
                indicator.className = 'now-playing-indicator';
                indicator.innerHTML = `${playIcon}Playing`;
                actions.insertBefore(indicator, actions.firstChild);
            }
        }
    });
}

function openProgramGuide() {
    $('shuffle-btn')?.classList.toggle('active', APP.radioState.isShuffled);
    $('repeat-btn')?.classList.toggle('active', APP.radioState.isRepeat);
    
    qsa('.tab-btn').forEach(b => b.classList.remove('active'));
    const view = APP.radioState.viewMode;
    
    if (view === BANDS.BOOK1 || view === BANDS.BOOK2) {
        if (APP.currentBand !== view) switchToBand(view);
        qs(`.tab-btn[data-view="${view}"]`)?.classList.add('active');
        renderBookList();
    } else if (APP.currentBand === BANDS.BOOK1 || APP.currentBand === BANDS.BOOK2) {
        qs(`.tab-btn[data-view="${APP.currentBand}"]`)?.classList.add('active');
        renderBookList();
    } else if (BANDS.isPlaylist(APP.currentBand)) {
        renderPlaylistTracks(BANDS.getPlaylistId(APP.currentBand));
        qs('.tab-btn[data-view="playlists"]')?.classList.add('active');
    } else {
        qs(`.tab-btn[data-view="${APP.radioState.viewMode}"]`)?.classList.add('active');
        if (APP.radioState.viewMode === 'artists') renderArtistList();
        else if (APP.radioState.viewMode === 'genres') renderGenreList();
        else if (APP.radioState.viewMode === 'playlists') renderPlaylistList();
        else renderTrackList();
    }
    
    $('modal-overlay').classList.add('active');
    $('program-guide').classList.add('active');
}

function closeProgramGuide() {
    $('modal-overlay').classList.remove('active');
    $('program-guide').classList.remove('active');
}

function renderListContent(list, sourceType = null) {
    const showDownload = !APP.isIOS && APP.isMobile;
    const playIcon = `<svg viewBox="0 0 24 24" width="12" height="12" style="vertical-align: middle; margin-right: 4px;"><polygon fill="currentColor" points="8,5 19,12 8,19"></polygon></svg>`;
    return list.map((track, index) => {
        const trackWithSource = {...track, sourceType: sourceType || APP.currentBand};
        const trackJson = TrackJSON.encode(trackWithSource);
        const isCurrentTrack = index === APP.currentIndex;
        return `
        <div class="program-item ${isCurrentTrack ? 'active-track' : ''}" data-index="${index}">
            <div class="program-item-main">
                <div class="artist">${Track.getArtist(track)}</div>
                <div class="title">${Track.getTitle(track)}</div>
            </div>
            <div class="program-item-actions">
                ${isCurrentTrack ? `<div class="now-playing-indicator">${playIcon}Playing</div>` : ''}
                ${showDownload ? `<button class="download-track-btn" data-track='${trackJson}' data-track-index="${index}">Download</button>` : ''}
                <button class="add-to-playlist-btn" data-track-index="${index}">+ Playlist</button>
            </div>
        </div>`;
    }).join('');
}

// Unified download button handler - reduces duplicate code
function handleDownloadButtonClick(btn, track) {
    if (isTrackDownloaded(track)) {
        if (confirm('Remove this track from offline storage?')) {
            uncacheTrack(track);
            btn.classList.remove('downloaded');
            btn.textContent = 'Download';
            showToast('Track removed from downloads', 2000, 'info');
        }
    } else {
        if (!APP.swReady || !navigator.serviceWorker.controller) {
            showToast('Service worker not ready. Try again shortly.', 5000, 'error');
            return;
        }
        checkStorageQuota(true);
        showToast(`Downloading: ${Track.getDisplayName(track)}`, 3000, 'info');
        btn.classList.add('downloading');
        btn.textContent = 'Downloading...';
        cacheTrack(track, success => {
            if (!success) { 
                btn.classList.remove('downloading'); 
                btn.textContent = 'Download'; 
                showToast('Failed to start download', 5000, 'error'); 
            }
        });
    }
}

function bindListEvents(content, list, sourceType = null) {
    content.querySelectorAll('.program-item-main').forEach(item => {
        item.addEventListener('click', () => {
            hideOnboardingHints();
            const trackIndex = parseInt(item.closest('.program-item').dataset.index);
            
            // If viewing radio tracks but currently in a different band, switch to radio
            if (sourceType === BANDS.RADIO && APP.currentBand !== BANDS.RADIO) {
                APP.currentBand = BANDS.RADIO;
                APP.currentTrackSrc = null;
                buildDial();
            }
            
            APP.isPlaying = true;
            APP.manuallyPaused = false;
            tuneToStation(trackIndex);
            closeProgramGuide();
        });
    });
    
    content.querySelectorAll('.add-to-playlist-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const track = {...list[parseInt(btn.dataset.trackIndex)]};
            if (!track.sourceType) track.sourceType = sourceType || APP.currentBand;
            showPlaylistPopover(track, btn);
        });
    });
    
    content.querySelectorAll('.download-track-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const track = TrackJSON.decode(btn.dataset.track);
            if (!track) { showToast('Error: Invalid track data', 3000, 'error'); return; }
            handleDownloadButtonClick(btn, track);
        });
    });
    
    updateOfflineIndicators();
    Timers.set('scroll-to-active', () => content.querySelector('.active-track')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
}

function renderBookList() {
    const content = $('program-guide-content');
    content.innerHTML = renderListContent(APP.playlist[APP.currentBand] || [], APP.currentBand);
    bindListEvents(content, APP.playlist[APP.currentBand] || []);
}

function renderTrackList() {
    const content = $('program-guide-content');
    content.innerHTML = renderListContent(APP.radioPlaylist, BANDS.RADIO);
    bindListEvents(content, APP.radioPlaylist, BANDS.RADIO);
}

function renderArtistList() {
    const content = $('program-guide-content');
    const showDownload = !APP.isIOS && APP.isMobile;
    const artists = {};
    APP.radioData.forEach(t => { const pf = t.ParentFolder; if (!artists[pf]) artists[pf] = 0; artists[pf]++; });
    
    content.innerHTML = Object.keys(artists).sort().map(artist => `
        <div class="filter-item ${APP.radioState.activeArtistFilter === artist ? 'active-filter' : ''}" data-artist="${artist}">
            <div class="artist-list-item-content">
                <div class="name">${artist.replace(/^\d+\s-\s/, '')}</div>
                <div class="artist-actions">
                    <button class="add-artist-to-playlist-btn" data-artist-folder="${artist}">+ Playlist</button>
                    ${showDownload ? `<button class="download-artist-btn" data-artist-folder="${artist}">Download</button>` : ''}
                    <div class="count">${artists[artist]}</div>
                </div>
            </div>
        </div>
    `).join('');
    
    content.querySelectorAll('.filter-item').forEach(item => {
        item.addEventListener('click', e => {
            if (e.target.classList.contains('download-artist-btn') || e.target.classList.contains('add-artist-to-playlist-btn')) return;
            // Switch to Radio band when selecting an artist filter
            APP.currentBand = BANDS.RADIO;
            APP.radioState.activeArtistFilter = item.dataset.artist;
            APP.radioState.activeGenre = null;
            APP.radioState.viewMode = 'tracks';
            qs('.tab-btn[data-view="tracks"]').click();
            processRadioData();
            APP.currentIndex = 0;
            APP.currentTrackSrc = null;
            buildDial();
            APP.isPlaying = true;
            loadTrack(0);
            closeProgramGuide();
        });
    });
    
    content.querySelectorAll('.download-artist-btn').forEach(btn => {
        btn.addEventListener('click', e => { e.stopPropagation(); cacheArtistTracks(btn.dataset.artistFolder); });
    });
    
    // Add artist to playlist button handler
    content.querySelectorAll('.add-artist-to-playlist-btn').forEach(btn => {
        btn.addEventListener('click', e => { 
            e.stopPropagation(); 
            showAddArtistToPlaylistPopover(btn.dataset.artistFolder, btn);
        });
    });
}

// Show popover to add all artist's tracks to a playlist
function showAddArtistToPlaylistPopover(artistFolder, buttonEl) {
    closePlaylistPopover();
    
    const artistTracks = APP.radioData.filter(t => t.ParentFolder === artistFolder);
    const artistName = artistFolder.replace(/^\d+\s-\s/, '');
    
    // Create backdrop to capture all clicks outside the popover
    const backdrop = document.createElement('div');
    backdrop.className = 'playlist-popover-backdrop';
    document.body.appendChild(backdrop);
    
    const popover = document.createElement('div');
    popover.className = 'playlist-popover';
    
    let html = `<div class="playlist-popover-header">Add "${artistName}" (${artistTracks.length} tracks)</div><div class="playlist-popover-list">`;
    html += '<div class="playlist-popover-create-new">+ Create New Playlist</div>';
    if (APP.userPlaylists.length === 0) {
        html += '<div class="playlist-popover-empty">No playlists yet</div>';
    } else {
        APP.userPlaylists.forEach(pl => {
            html += `<div class="playlist-popover-item playlist-add-artist" data-playlist-id="${pl.id}">
                <span class="playlist-name">${pl.name}</span>
                <span class="track-count">${pl.tracks.length}</span></div>`;
        });
    }
    html += '</div>';
    popover.innerHTML = html;
    document.body.appendChild(popover);
    
    const rect = buttonEl.getBoundingClientRect();
    const popRect = popover.getBoundingClientRect();
    let left = rect.left - popRect.width - 10;
    let top = rect.top + rect.height / 2 - popRect.height / 2;
    if (left < 10) left = rect.right + 10;
    if (top < 10) top = 10;
    if (top + popRect.height > window.innerHeight - 10) top = window.innerHeight - popRect.height - 10;
    popover.style.left = left + 'px';
    popover.style.top = top + 'px';
    
    // Handle "Create New Playlist" click
    popover.querySelector('.playlist-popover-create-new')?.addEventListener('click', e => {
        e.stopPropagation();
        closePlaylistPopover();
        showCreatePlaylistDialogWithArtist(artistFolder, artistTracks);
    });
    
    // Handle playlist selection
    popover.querySelectorAll('.playlist-add-artist').forEach(item => {
        item.addEventListener('click', e => {
            e.stopPropagation();
            const pid = item.dataset.playlistId;
            const playlist = APP.userPlaylists.find(p => p.id === pid);
            let addedCount = 0;
            artistTracks.forEach(track => {
                const trackWithSource = {...track, sourceType: BANDS.RADIO};
                if (addTrackToPlaylist(pid, trackWithSource)) addedCount++;
            });
            showToast(`Added ${addedCount} tracks to "${playlist.name}"`, 2500, 'success');
            closePlaylistPopover();
        });
    });
    
    popover.addEventListener('click', e => e.stopPropagation());
    
    // Backdrop click closes the popover
    backdrop.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        closePlaylistPopover();
    });
    
    backdrop.addEventListener('touchend', e => {
        e.preventDefault();
        e.stopPropagation();
        closePlaylistPopover();
    });
}

// Create playlist dialog with automatic artist tracks addition
function showCreatePlaylistDialogWithArtist(artistFolder, artistTracks) {
    const artistName = artistFolder.replace(/^\d+\s-\s/, '');
    const dialog = document.createElement('div');
    dialog.className = 'create-playlist-dialog';
    dialog.innerHTML = `<div class="create-playlist-dialog-content">
        <div class="create-playlist-dialog-header">New Playlist</div>
        <input type="text" id="new-playlist-name" placeholder="Playlist name" maxlength="50" value="${artistName}" autofocus>
        <div class="create-playlist-dialog-actions">
            <button class="dialog-cancel-btn">Cancel</button>
            <button class="dialog-create-btn">Create & Add ${artistTracks.length} Tracks</button>
        </div></div>`;
    
    document.body.appendChild(dialog);
    const input = dialog.querySelector('#new-playlist-name');
    input.focus();
    input.select();
    
    const create = () => { 
        const name = input.value.trim(); 
        if (name) { 
            const playlist = createPlaylist(name);
            let addedCount = 0;
            artistTracks.forEach(track => {
                const trackWithSource = {...track, sourceType: BANDS.RADIO};
                if (addTrackToPlaylist(playlist.id, trackWithSource)) addedCount++;
            });
            showToast(`Created "${name}" with ${addedCount} tracks`, 2500, 'success');
            dialog.remove(); 
        } 
    };
    input.addEventListener('keypress', e => { if (e.key === 'Enter') create(); });
    dialog.querySelector('.dialog-create-btn').addEventListener('click', create);
    dialog.querySelector('.dialog-cancel-btn').addEventListener('click', () => dialog.remove());
    dialog.addEventListener('click', e => { if (e.target === dialog) dialog.remove(); });
}

function renderGenreList() {
    const content = $('program-guide-content');
    const genres = {};
    APP.radioData.forEach(t => { const g = t.Genre || 'Unknown'; if (!genres[g]) genres[g] = 0; genres[g]++; });
    
    content.innerHTML = `<div class="filter-item ${!APP.radioState.activeGenre ? 'active-filter' : ''}" data-genre="ALL"><div class="name">ALL GENRES</div><div class="count">${APP.radioData.length}</div></div>` +
        Object.keys(genres).sort().map(g => `<div class="filter-item ${APP.radioState.activeGenre === g ? 'active-filter' : ''}" data-genre="${g}"><div class="name">${g}</div><div class="count">${genres[g]}</div></div>`).join('');
    
    content.querySelectorAll('.filter-item').forEach(item => {
        item.addEventListener('click', () => {
            // Switch to Radio band when selecting a genre filter
            APP.currentBand = BANDS.RADIO;
            APP.radioState.activeGenre = item.dataset.genre === 'ALL' ? null : item.dataset.genre;
            APP.radioState.activeArtistFilter = null;
            APP.radioState.viewMode = 'tracks';
            qs('.tab-btn[data-view="tracks"]').click();
            processRadioData();
            APP.currentIndex = 0;
            APP.currentTrackSrc = null;
            buildDial();
            APP.isPlaying = true;
            loadTrack(0);
            closeProgramGuide();
        });
    });
}

// ============================================================================
// PLAYLISTS
// ============================================================================
function createPlaylist(name) {
    const playlist = { id: Date.now().toString(), name: name.trim(), tracks: [], createdAt: new Date().toISOString() };
    APP.userPlaylists.push(playlist);
    saveUserPlaylists();
    return playlist;
}

function deletePlaylist(playlistId) {
    APP.userPlaylists = APP.userPlaylists.filter(p => p.id !== playlistId);
    saveUserPlaylists();
}

function addTrackToPlaylist(playlistId, track) {
    const playlist = APP.userPlaylists.find(p => p.id === playlistId);
    if (!playlist) return false;
    const trackId = Track.getId(track);
    if (!playlist.tracks.some(t => Track.getId(t) === trackId)) {
        playlist.tracks.push({...track});
        saveUserPlaylists();
        return true;
    }
    return false;
}

function removeTrackFromPlaylist(playlistId, trackIndex) {
    const playlist = APP.userPlaylists.find(p => p.id === playlistId);
    if (playlist && trackIndex >= 0 && trackIndex < playlist.tracks.length) {
        playlist.tracks.splice(trackIndex, 1);
        saveUserPlaylists();
    }
}

function isTrackInPlaylist(playlistId, track) {
    const playlist = APP.userPlaylists.find(p => p.id === playlistId);
    if (!playlist) return false;
    const trackId = Track.getId(track);
    return playlist.tracks.some(t => Track.getId(t) === trackId);
}

function closePlaylistPopover() {
    document.querySelector('.playlist-popover-backdrop')?.remove();
    document.querySelector('.playlist-popover')?.remove();
}

function showPlaylistPopover(track, buttonEl) {
    closePlaylistPopover();
    
    // Create backdrop to capture all clicks outside the popover
    const backdrop = document.createElement('div');
    backdrop.className = 'playlist-popover-backdrop';
    document.body.appendChild(backdrop);
    
    const popover = document.createElement('div');
    popover.className = 'playlist-popover';
    
    let html = '<div class="playlist-popover-header">Add to Playlist</div><div class="playlist-popover-list">';
    // Add "Create New Playlist" option at the top
    html += '<div class="playlist-popover-create-new">+ Create New Playlist</div>';
    if (APP.userPlaylists.length === 0) {
        html += '<div class="playlist-popover-empty">No playlists yet</div>';
    } else {
        APP.userPlaylists.forEach(pl => {
            const isIn = isTrackInPlaylist(pl.id, track);
            html += `<label class="playlist-popover-item ${isIn ? 'in-playlist' : ''}" data-playlist-id="${pl.id}">
                <input type="checkbox" ${isIn ? 'checked' : ''}><span class="playlist-name">${pl.name}</span>
                <span class="track-count">${pl.tracks.length}</span></label>`;
        });
    }
    html += '</div>';
    popover.innerHTML = html;
    document.body.appendChild(popover);
    
    const rect = buttonEl.getBoundingClientRect();
    const popRect = popover.getBoundingClientRect();
    let left = rect.left - popRect.width - 10;
    let top = rect.top + rect.height / 2 - popRect.height / 2;
    if (left < 10) left = rect.right + 10;
    if (top < 10) top = 10;
    if (top + popRect.height > window.innerHeight - 10) top = window.innerHeight - popRect.height - 10;
    popover.style.left = left + 'px';
    popover.style.top = top + 'px';
    
    // Handle "Create New Playlist" click
    popover.querySelector('.playlist-popover-create-new')?.addEventListener('click', e => {
        e.stopPropagation();
        closePlaylistPopover();
        showCreatePlaylistDialogWithTrack(track);
    });
    
    popover.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
        checkbox.addEventListener('change', e => {
            e.stopPropagation();
            const item = e.target.closest('.playlist-popover-item');
            const pid = item.dataset.playlistId;
            if (e.target.checked) {
                const added = addTrackToPlaylist(pid, track);
                if (added) {
                    item.classList.add('in-playlist');
                    showToast(`Added to "${APP.userPlaylists.find(p => p.id === pid).name}"`, 2000, 'success');
                }
            } else {
                const playlist = APP.userPlaylists.find(p => p.id === pid);
                const trackId = Track.getId(track);
                const idx = playlist.tracks.findIndex(t => Track.getId(t) === trackId);
                if (idx !== -1) removeTrackFromPlaylist(pid, idx);
                item.classList.remove('in-playlist');
            }
            item.querySelector('.track-count').textContent = APP.userPlaylists.find(p => p.id === pid).tracks.length;
        });
    });
    
    // Prevent clicks inside popover from closing it
    popover.addEventListener('click', e => {
        e.stopPropagation();
    });
    
    // Backdrop click closes the popover
    backdrop.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        closePlaylistPopover();
    });
    
    backdrop.addEventListener('touchend', e => {
        e.preventDefault();
        e.stopPropagation();
        closePlaylistPopover();
    });
}

// Create playlist dialog with automatic track addition
function showCreatePlaylistDialogWithTrack(track) {
    const dialog = document.createElement('div');
    dialog.className = 'create-playlist-dialog';
    dialog.innerHTML = `<div class="create-playlist-dialog-content">
        <div class="create-playlist-dialog-header">New Playlist</div>
        <input type="text" id="new-playlist-name" placeholder="Playlist name" maxlength="50" autofocus>
        <div class="create-playlist-dialog-actions">
            <button class="dialog-cancel-btn">Cancel</button>
            <button class="dialog-create-btn">Create & Add</button>
        </div></div>`;
    
    document.body.appendChild(dialog);
    const input = dialog.querySelector('#new-playlist-name');
    input.focus();
    
    const create = () => { 
        const name = input.value.trim(); 
        if (name) { 
            const playlist = createPlaylist(name); 
            addTrackToPlaylist(playlist.id, track);
            showToast(`Created "${name}" and added track`, 2500, 'success');
            dialog.remove(); 
        } 
    };
    input.addEventListener('keypress', e => { if (e.key === 'Enter') create(); });
    dialog.querySelector('.dialog-create-btn').addEventListener('click', create);
    dialog.querySelector('.dialog-cancel-btn').addEventListener('click', () => dialog.remove());
    dialog.addEventListener('click', e => { if (e.target === dialog) dialog.remove(); });
}

function renderPlaylistList() {
    const content = $('program-guide-content');
    const showDownload = !APP.isIOS && APP.isMobile;
    
    let html = '<div class="playlist-actions"><button class="create-playlist-btn" id="create-playlist-btn">+ New Playlist</button></div>';
    if (APP.userPlaylists.length === 0) {
        html += '<div class="playlist-empty-state">No playlists yet. Create one to save your favorite songs!</div>';
    } else {
        html += APP.userPlaylists.map(pl => {
            const downloadedCount = pl.tracks.filter(t => isTrackDownloaded(t)).length;
            const allDownloaded = downloadedCount === pl.tracks.length && pl.tracks.length > 0;
            return `<div class="filter-item playlist-list-item" data-playlist-id="${pl.id}">
                <div class="playlist-info"><div class="name">${pl.name}</div>
                <div class="offline-status">${showDownload ? `${downloadedCount}/${pl.tracks.length} offline` : `${pl.tracks.length} tracks`}</div></div>
                <div class="playlist-meta">
                    ${showDownload ? `<button class="download-playlist-btn ${allDownloaded ? 'downloaded' : ''}" data-playlist-id="${pl.id}">&#x2193;</button>` : ''}
                    <button class="delete-playlist-btn" data-playlist-id="${pl.id}">&#x00d7;</button>
                </div></div>`;
        }).join('');
    }
    
    content.innerHTML = html;
    
    $('create-playlist-btn').addEventListener('click', showCreatePlaylistDialog);
    content.querySelectorAll('.playlist-list-item').forEach(item => {
        item.addEventListener('click', e => {
            if (e.target.classList.contains('delete-playlist-btn') || e.target.classList.contains('download-playlist-btn')) return;
            renderPlaylistTracks(item.dataset.playlistId);
        });
    });
    content.querySelectorAll('.download-playlist-btn').forEach(btn => {
        btn.addEventListener('click', e => { e.stopPropagation(); cachePlaylistTracks(btn.dataset.playlistId); });
    });
    content.querySelectorAll('.delete-playlist-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const pl = APP.userPlaylists.find(p => p.id === btn.dataset.playlistId);
            if (confirm(`Delete playlist "${pl.name}"?`)) { deletePlaylist(btn.dataset.playlistId); renderPlaylistList(); }
        });
    });
}

function renderPlaylistTracks(playlistId) {
    const content = $('program-guide-content');
    const playlist = APP.userPlaylists.find(p => p.id === playlistId);
    if (!playlist) { renderPlaylistList(); return; }
    
    const showDownload = !APP.isIOS && APP.isMobile;
    const isPlayingThis = APP.currentBand === BANDS.toPlaylistBand(playlistId);
    const downloadedCount = playlist.tracks.filter(t => isTrackDownloaded(t)).length;
    const allDownloaded = downloadedCount === playlist.tracks.length && playlist.tracks.length > 0;
    
    let html = `<div class="playlist-header-bar">
        <button class="back-to-playlists-btn">← Back</button>
        <div class="playlist-title">${playlist.name}</div>
        <div style="display:flex;gap:10px;">
            ${playlist.tracks.length > 0 ? `<button class="download-all-btn play-playlist-btn ${isPlayingThis ? 'playing-mode' : ''}" data-playlist-id="${playlistId}">${isPlayingThis ? 'Playing' : '▶ Play'}</button>` : ''}
            ${showDownload && playlist.tracks.length > 0 ? `<button class="download-all-btn ${allDownloaded ? 'downloaded' : ''}" data-playlist-id="${playlistId}">↓ All</button>` : ''}
        </div></div>`;
    
    const playIcon = `<svg viewBox="0 0 24 24" width="12" height="12" style="vertical-align: middle; margin-right: 4px;"><polygon fill="currentColor" points="8,5 19,12 8,19"></polygon></svg>`;
    
    if (playlist.tracks.length === 0) {
        html += '<div class="playlist-empty-state">This playlist is empty. Add songs from the Tracks view!</div>';
    } else {
        html += playlist.tracks.map((track, index) => {
            const isActive = isPlayingThis && APP.currentIndex === index;
            const trackJson = TrackJSON.encode(track);
            return `<div class="program-item playlist-track-item ${isActive ? 'active-track' : ''}" data-track-index="${index}" data-playlist-id="${playlistId}">
                <div class="program-item-main"><div class="artist">${Track.getArtist(track)}</div><div class="title">${Track.getTitle(track)}</div></div>
                <div class="program-item-actions">
                    ${isActive ? `<div class="now-playing-indicator">${playIcon}Playing</div>` : ''}
                    ${showDownload ? `<button class="download-track-btn ${isTrackDownloaded(track) ? 'downloaded' : ''}" data-track='${trackJson}'>${isTrackDownloaded(track) ? 'Downloaded' : 'Download'}</button>` : ''}
                    <button class="remove-from-playlist-btn" data-track-index="${index}">Remove</button>
                </div></div>`;
        }).join('');
    }
    
    content.innerHTML = html;
    
    content.querySelector('.back-to-playlists-btn').addEventListener('click', renderPlaylistList);
    
    const playBtn = content.querySelector('.play-playlist-btn');
    if (playBtn) {
        playBtn.addEventListener('click', e => {
            e.stopPropagation();
            const bandKey = BANDS.toPlaylistBand(playlistId);
            APP.playlist[bandKey] = playlist.tracks;
            APP.currentBand = bandKey;
            APP.currentIndex = 0;
            buildDial();
            loadTrack(0);
            closeProgramGuide();
        });
    }
    
    const downloadAllBtn = content.querySelector('.download-all-btn:not(.play-playlist-btn)');
    if (downloadAllBtn) downloadAllBtn.addEventListener('click', e => { e.stopPropagation(); cachePlaylistTracks(playlistId); });
    
    content.querySelectorAll('.program-item-main').forEach(item => {
        item.addEventListener('click', () => {
            const trackItem = item.closest('.playlist-track-item');
            const trackIndex = parseInt(trackItem.dataset.trackIndex);
            const bandKey = BANDS.toPlaylistBand(playlistId);
            
            if (APP.currentBand === bandKey) {
                tuneToStation(trackIndex);
            } else {
                APP.playlist[bandKey] = playlist.tracks;
                APP.currentBand = bandKey;
                APP.currentIndex = trackIndex;
                buildDial();
                loadTrack(trackIndex);
            }
            closeProgramGuide();
        });
    });
    
    content.querySelectorAll('.download-track-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const track = TrackJSON.decode(btn.dataset.track);
            if (!track) { showToast('Error: Invalid track data', 3000, 'error'); return; }
            handleDownloadButtonClick(btn, track);
        });
    });
    
    content.querySelectorAll('.remove-from-playlist-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            removeTrackFromPlaylist(playlistId, parseInt(btn.dataset.trackIndex));
            if (APP.currentBand === BANDS.toPlaylistBand(playlistId)) APP.playlist[APP.currentBand] = playlist.tracks;
            renderPlaylistTracks(playlistId);
        });
    });
}

function showCreatePlaylistDialog() {
    const dialog = document.createElement('div');
    dialog.className = 'create-playlist-dialog';
    dialog.innerHTML = `<div class="create-playlist-dialog-content">
        <div class="create-playlist-dialog-header">New Playlist</div>
        <input type="text" id="new-playlist-name" placeholder="Playlist name" maxlength="50" autofocus>
        <div class="create-playlist-dialog-actions">
            <button class="dialog-cancel-btn">Cancel</button>
            <button class="dialog-create-btn">Create</button>
        </div></div>`;
    
    document.body.appendChild(dialog);
    const input = dialog.querySelector('#new-playlist-name');
    input.focus();
    
    const create = () => { const name = input.value.trim(); if (name) { createPlaylist(name); dialog.remove(); renderPlaylistList(); } };
    input.addEventListener('keypress', e => { if (e.key === 'Enter') create(); });
    dialog.querySelector('.dialog-create-btn').addEventListener('click', create);
    dialog.querySelector('.dialog-cancel-btn').addEventListener('click', () => dialog.remove());
    dialog.addEventListener('click', e => { if (e.target === dialog) dialog.remove(); });
}

// =========================================================================
// OFFLINE CACHING FUNCTIONS
// =========================================================================

function cacheTrack(track, callback) {
    if (!APP.swReady || !navigator.serviceWorker.controller) { if (callback) callback(false); return; }
    const url = getTrackAudioUrl(track);
    if (!url) { if (callback) callback(false); return; }
    const absoluteUrl = new URL(url, window.location.origin).href;
    navigator.serviceWorker.controller.postMessage({ type: SW_MSG.CACHE_AUDIO, urls: [absoluteUrl] });
    markTrackAsDownloaded(track);
    if (callback) callback(true);
}

function uncacheTrack(track, callback) {
    if (!APP.swReady || !navigator.serviceWorker.controller) { if (callback) callback(false); return; }
    const url = getTrackAudioUrl(track);
    if (!url) { if (callback) callback(false); return; }
    const absoluteUrl = new URL(url, window.location.origin).href;
    navigator.serviceWorker.controller.postMessage({ type: SW_MSG.UNCACHE_AUDIO, url: absoluteUrl });
    unmarkTrackAsDownloaded(track);
    if (callback) callback(true);
}

function cachePlaylistTracks(playlistId) {
    const playlist = APP.userPlaylists.find(p => p.id === playlistId);
    if (!playlist || !APP.swReady) return;
    const urls = playlist.tracks.map(track => getTrackAudioUrl(track)).filter(url => url).map(url => new URL(url, window.location.origin).href);
    if (urls.length === 0) return;
    playlist.tracks.forEach(track => markTrackAsDownloaded(track));
    APP.downloadProgress = { total: urls.length, completed: 0, id: playlistId, type: 'playlist' };
    navigator.serviceWorker.controller.postMessage({ type: SW_MSG.CACHE_AUDIO, urls: urls });
    showDownloadProgress(playlist.name);
}

function cacheArtistTracks(artistName) {
    if (!APP.swReady || !APP.radioData) return;
    const tracks = APP.radioData.filter(t => t.ParentFolder === artistName);
    const urls = tracks.map(track => {
        const srcAudio = 'radio/' + cleanPath(track.src_audio);
        return getSecureUrl(srcAudio);
    }).filter(url => url).map(url => new URL(url, window.location.origin).href);
    if (urls.length === 0) return;
    tracks.forEach(track => { const trackWithSource = {...track, sourceType: BANDS.RADIO}; markTrackAsDownloaded(trackWithSource); });
    APP.downloadProgress = { total: urls.length, completed: 0, id: artistName, type: 'artist', tracks: tracks };
    navigator.serviceWorker.controller.postMessage({ type: SW_MSG.CACHE_AUDIO, urls: urls });
    showDownloadProgress("Artist: " + artistName.replace(/^\d+\s-\s/, ''));
}

function updateDownloadProgress() {
    if (!APP.downloadProgress) return;
    let cachedCount = 0;
    if (APP.downloadProgress.type === 'artist') {
        const tracks = APP.downloadProgress.tracks;
        if (tracks) {
            tracks.forEach(track => {
                const srcAudio = 'radio/' + cleanPath(track.src_audio);
                const url = getSecureUrl(srcAudio);
                if (url) {
                    const absUrl = new URL(url, window.location.origin).href;
                    if (APP.cachedUrls.has(url) || APP.cachedUrls.has(absUrl)) cachedCount++;
                }
            });
        }
    } else {
        const playlist = APP.userPlaylists.find(p => p.id === APP.downloadProgress.id);
        if (playlist) playlist.tracks.forEach(track => { if (isTrackCached(track)) cachedCount++; });
    }
    APP.downloadProgress.completed = cachedCount;
    const progressEl = document.querySelector('.download-progress-bar-fill');
    const textEl = document.querySelector('.download-progress-text');
    if (progressEl && textEl) {
        const percent = (cachedCount / APP.downloadProgress.total) * 100;
        progressEl.style.width = percent + '%';
        textEl.textContent = `Downloading: ${cachedCount} / ${APP.downloadProgress.total}`;
        if (cachedCount >= APP.downloadProgress.total) setTimeout(hideDownloadProgress, 1500);
    }
}

function showDownloadProgress(playlistName) {
    hideDownloadProgress();
    const progressDiv = document.createElement('div');
    progressDiv.className = 'download-progress-overlay';
    progressDiv.innerHTML = `<div class="download-progress-content">
        <div class="download-progress-title">Downloading "${playlistName}"</div>
        <div class="download-progress-bar"><div class="download-progress-bar-fill"></div></div>
        <div class="download-progress-text">Downloading: 0 / ${APP.downloadProgress.total}</div>
        <button class="download-progress-close">Close</button></div>`;
    document.body.appendChild(progressDiv);
    progressDiv.querySelector('.download-progress-close').addEventListener('click', hideDownloadProgress);
}

function hideDownloadProgress() {
    const overlay = document.querySelector('.download-progress-overlay');
    if (overlay) overlay.remove();
    APP.downloadProgress = null;
}

function updateOfflineIndicators() {
    document.querySelectorAll('[data-track-cached]').forEach(el => {
        const trackData = el.dataset.trackCached;
        if (trackData) {
            try {
                const track = JSON.parse(trackData);
                if (isTrackDownloaded(track)) el.classList.add('cached');
                else el.classList.remove('cached');
            } catch (e) {}
        }
    });
    document.querySelectorAll('.download-track-btn').forEach(btn => {
        const trackData = btn.dataset.track;
        if (trackData) {
            try {
                const track = JSON.parse(trackData);
                if (isTrackDownloaded(track)) {
                    btn.classList.remove('downloading');
                    btn.classList.add('downloaded');
                    btn.textContent = 'Downloaded';
                } else if (!btn.classList.contains('downloading')) {
                    btn.classList.remove('downloaded');
                    btn.textContent = 'Download';
                }
            } catch (e) {}
        }
    });
}

function preloadNextTrack(currentIndex) {
    const list = getCurrentTrackList();
    if (list && list[currentIndex + 1]) {
        const nextUrl = getTrackAudioUrl(list[currentIndex + 1]);
        if (nextUrl) new Audio().src = nextUrl;
    }
}

// =========================================================================
// SEARCH OVERLAY
// =========================================================================

let lastSearchResults = {};

function createSearchOverlay() {
    if ($('search-overlay')) return;
    const overlay = document.createElement('div');
    overlay.className = 'search-overlay';
    overlay.id = 'search-overlay';
    const searchIcon = `<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>`;
    const closeIcon = `<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`;
    overlay.innerHTML = `<div class="search-header">
        <span class="search-icon">${searchIcon}</span>
        <input type="text" class="search-input" id="search-input" placeholder="Search tracks, artists, genres...">
        <button class="search-close-btn" id="search-close-btn">${closeIcon}</button></div>
        <div class="search-category-tabs" id="search-category-tabs">
            <div class="search-category-tab" data-category="tracks">Tracks</div>
            <div class="search-category-tab" data-category="book1">Book I</div>
            <div class="search-category-tab" data-category="book2">Book II</div>
            <div class="search-category-tab" data-category="artists">Artists</div>
            <div class="search-category-tab" data-category="genres">Genres</div>
            <div class="search-category-tab" data-category="playlists">Playlists</div></div>
        <div class="search-results" id="search-results"></div>`;
    document.body.appendChild(overlay);
    $('search-close-btn').addEventListener('click', closeSearchOverlay);
    const searchInput = $('search-input');
    let searchTimeout = null;
    searchInput.addEventListener('input', (e) => { clearTimeout(searchTimeout); searchTimeout = setTimeout(() => performSearch(e.target.value), 200); });
    qsa('.search-category-tab').forEach(tab => { tab.addEventListener('click', (e) => filterSearchResults(e.target.dataset.category)); });
}

function openSearchOverlay() {
    createSearchOverlay();
    $('search-overlay').classList.add('active');
    $('search-input').focus();
    $('search-input').value = '';
    $('search-results').innerHTML = '<div style="text-align: center; padding: 40px; color: #888;">Type to search...</div>';
    qsa('.search-category-tab').forEach(tab => tab.classList.remove('active', 'has-results'));
}

function closeSearchOverlay() {
    $('search-overlay').classList.remove('active');
    closeProgramGuide();
}

function performSearch(query) {
    const results = $('search-results');
    if (!query || query.length < 2) {
        results.innerHTML = '<div style="text-align: center; padding: 40px; color: #888;">Type at least 2 characters...</div>';
        qsa('.search-category-tab').forEach(tab => tab.classList.remove('has-results'));
        lastSearchResults = {};
        return;
    }
    const q = query.toLowerCase();
    lastSearchResults = { tracks: [], book1: [], book2: [], artists: [], genres: [], playlists: [] };
    if (APP.radioPlaylist) {
        APP.radioPlaylist.forEach((track, index) => {
            const artist = Track.getArtist(track).toLowerCase();
            const title = Track.getTitle(track).toLowerCase();
            if (artist.includes(q) || title.includes(q)) lastSearchResults.tracks.push({ ...track, index, category: 'tracks' });
        });
    }
    if (APP.playlist && APP.playlist.book1) {
        APP.playlist.book1.forEach((track, index) => {
            const artist = Track.getArtist(track).toLowerCase();
            const title = Track.getTitle(track).toLowerCase();
            if (artist.includes(q) || title.includes(q)) lastSearchResults.book1.push({ ...track, index, category: BANDS.BOOK1 });
        });
    }
    if (APP.playlist && APP.playlist.book2) {
        APP.playlist.book2.forEach((track, index) => {
            const artist = Track.getArtist(track).toLowerCase();
            const title = Track.getTitle(track).toLowerCase();
            if (artist.includes(q) || title.includes(q)) lastSearchResults.book2.push({ ...track, index, category: BANDS.BOOK2 });
        });
    }
    if (APP.radioArtists) {
        APP.radioArtists.forEach((artist, index) => {
            if (artist.artist.toLowerCase().includes(q)) lastSearchResults.artists.push({ ...artist, index, category: 'artists' });
        });
    }
    if (APP.radioData) {
        const genres = [...new Set(APP.radioData.map(t => t.Genre).filter(g => g))];
        genres.forEach(genre => { if (genre.toLowerCase().includes(q)) lastSearchResults.genres.push({ name: genre, category: 'genres' }); });
    }
    if (APP.userPlaylists) {
        APP.userPlaylists.forEach(playlist => {
            if (playlist.name.toLowerCase().includes(q)) lastSearchResults.playlists.push({ ...playlist, category: 'playlists' });
        });
    }
    qsa('.search-category-tab').forEach(tab => {
        const category = tab.dataset.category;
        tab.classList.toggle('has-results', lastSearchResults[category] && lastSearchResults[category].length > 0);
    });
    renderAllSearchResults();
}

function renderAllSearchResults() {
    const results = $('search-results');
    let html = '';
    let totalResults = 0;
    Object.keys(lastSearchResults).forEach(category => {
        lastSearchResults[category].forEach(item => { totalResults++; html += renderSearchResultItem(item, category); });
    });
    if (totalResults === 0) results.innerHTML = '<div style="text-align: center; padding: 40px; color: #888;">No results found</div>';
    else { results.innerHTML = html; bindSearchResultClicks(); }
}

function filterSearchResults(category) {
    qsa('.search-category-tab').forEach(tab => tab.classList.remove('active'));
    qs(`.search-category-tab[data-category="${category}"]`).classList.add('active');
    const results = $('search-results');
    const items = lastSearchResults[category] || [];
    if (items.length === 0) { results.innerHTML = '<div style="text-align: center; padding: 40px; color: #888;">No results in this category</div>'; return; }
    let html = '';
    items.forEach(item => { html += renderSearchResultItem(item, category); });
    results.innerHTML = html;
    bindSearchResultClicks();
}

function renderSearchResultItem(item, category) {
    const artist = Track.getArtist(item) !== 'Unknown Artist' ? Track.getArtist(item) : (item.name || '');
    const title = Track.getTitle(item) !== 'Unknown Title' ? Track.getTitle(item) : '';
    const categoryLabel = category.charAt(0).toUpperCase() + category.slice(1);
    return `<div class="search-result-item" data-category="${category}" data-index="${item.index !== undefined ? item.index : ''}" data-id="${item.id || ''}" data-name="${item.name || ''}">
        <div class="result-artist">${artist}</div>${title ? `<div class="result-title">${title}</div>` : ''}
        <div class="result-category">${categoryLabel}</div></div>`;
}

function bindSearchResultClicks() {
    qsa('.search-result-item').forEach(item => {
        item.addEventListener('click', () => {
            const category = item.dataset.category;
            const index = parseInt(item.dataset.index);
            closeSearchOverlay();
            if (category === 'tracks') { switchToBand(BANDS.RADIO); setTimeout(() => tuneToStation(index), 100); }
            else if (category === BANDS.BOOK1 || category === BANDS.BOOK2) { switchToBand(category); setTimeout(() => tuneToStation(index), 100); }
            else if (category === 'artists') {
                APP.radioState.activeArtistFilter = item.dataset.name || item.querySelector('.result-artist').textContent;
                processRadioData(); switchToBand(BANDS.RADIO); setTimeout(() => tuneToStation(0), 100);
            } else if (category === 'genres') {
                APP.radioState.activeGenre = item.dataset.name || item.querySelector('.result-artist').textContent;
                processRadioData(); switchToBand(BANDS.RADIO); setTimeout(() => tuneToStation(0), 100);
            } else if (category === 'playlists') {
                const playlistId = item.dataset.id;
                if (playlistId) switchToBand(BANDS.toPlaylistBand(playlistId));
            }
        });
    });
}

// =========================================================================
// SETTINGS PANEL
// =========================================================================

function createSettingsPanel() {
    const panel = document.createElement('div');
    panel.className = 'settings-panel';
    panel.id = 'settings-panel';
    const showInstallOption = !APP.isPWA && !APP.isIOS;
    const menuIcon = `<svg viewBox="0 0 24 24" width="18" height="18" style="vertical-align: middle; margin-right: 8px;"><path fill="currentColor" d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/></svg>`;
    panel.innerHTML = `<div class="settings-header">
        <span class="settings-title">${menuIcon}Menu</span>
        <button class="settings-close" id="settings-close">✕</button></div>
        <div class="setting-item"><div>
            <div class="setting-label">Start with random playback</div>
            <div class="setting-description">When enabled, starts fresh each session. When disabled, resumes where you left off.</div></div>
            <label class="toggle-switch"><input type="checkbox" id="setting-shuffle-start" ${APP.settings.startWithShuffle ? 'checked' : ''}><span class="toggle-slider"></span></label></div>
        <div class="setting-item"><div>
            <div class="setting-label">🐛 Debug Mode</div>
            <div class="setting-description">Show on-screen debug panel with live app state and event log.</div></div>
            <label class="toggle-switch"><input type="checkbox" id="setting-debug-mode" ${APP.settings.debugMode ? 'checked' : ''}><span class="toggle-slider"></span></label></div>
        ${APP.isPWA ? `<div class="setting-item"><div>
            <div class="setting-label">&#x1F5D1; Refresh App Cache</div>
            <div class="setting-description">Update app files while keeping your downloaded songs.</div></div>
            <button class="setting-action-btn" id="setting-refresh-cache-btn">Refresh</button></div>
        <div class="setting-item"><div>
            <div class="setting-label">&#x1F504; Delete Offline Songs</div>
            <div class="setting-description">Remove all downloaded songs to free up storage space.</div></div>
            <button class="setting-action-btn" id="setting-delete-cache-btn" style="border-color: #c41e3a; color: #c41e3a;">Delete</button></div>` : ''}
        ${showInstallOption ? `<div class="setting-item" id="install-app-setting"><div>
            <div class="setting-label">Install App</div>
            <div class="setting-description">Add to home screen for offline access and better experience.</div></div>
            <button class="setting-action-btn" id="setting-install-btn">Install</button></div>` : ''}
        ${APP.isPWA ? `<div class="setting-item"><div>
            <div class="setting-label">App Installed</div>
            <div class="setting-description">You're running the installed app. To reinstall, remove from home screen first.</div></div>
            <span style="color: #4CAF50; font-size: 1.2rem;">✓</span></div>` : ''}`;
    document.body.appendChild(panel);
    $('settings-close').addEventListener('click', closeSettings);
    $('setting-shuffle-start').addEventListener('change', (e) => { APP.settings.startWithShuffle = e.target.checked; saveSettings(); });
    $('setting-debug-mode').addEventListener('change', (e) => { 
        APP.settings.debugMode = e.target.checked; 
        saveSettings(); 
        if (e.target.checked) Debug.enable();
        else Debug.disable();
    });
    const refreshBtn = $('setting-refresh-cache-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', async () => {
            refreshBtn.textContent = 'Refreshing...'; refreshBtn.disabled = true;
            if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
                navigator.serviceWorker.controller.postMessage({ type: SW_MSG.REFRESH_APP_CACHE });
                Timers.set('refresh-toast', () => { 
                    showToast('App cache refreshed! Reloading...', 2000, 'success'); 
                    Timers.set('refresh-reload', () => window.location.reload(), 2000); 
                }, 1000);
            } else { showToast('Service worker not available', 3000, 'error'); refreshBtn.textContent = 'Refresh'; refreshBtn.disabled = false; }
        });
    }
    const deleteBtn = $('setting-delete-cache-btn');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', () => {
            if (confirm('Are you sure you want to delete all offline songs? This cannot be undone.')) {
                deleteBtn.textContent = 'Deleting...'; deleteBtn.disabled = true;
                if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
                    navigator.serviceWorker.controller.postMessage({ type: SW_MSG.DELETE_AUDIO_CACHE });
                    APP.explicitDownloads.clear(); saveExplicitDownloads();
                    Timers.set('delete-complete', () => { 
                        showToast('Offline songs deleted', 3000, 'success'); 
                        deleteBtn.textContent = 'Delete'; 
                        deleteBtn.disabled = false; 
                        closeSettings(); 
                    }, 1000);
                } else { showToast('Service worker not available', 3000, 'error'); deleteBtn.textContent = 'Delete'; deleteBtn.disabled = false; }
            }
        });
    }
    const installBtn = $('setting-install-btn');
    if (installBtn) {
        installBtn.addEventListener('click', async () => {
            if (APP.deferredPrompt) {
                APP.deferredPrompt.prompt();
                const { outcome } = await APP.deferredPrompt.userChoice;
                APP.deferredPrompt = null;
                if (outcome === 'accepted') { installBtn.textContent = 'Installing...'; installBtn.disabled = true; }
            } else { alert('To install the app:\n\n1. Tap the browser menu (⋮)\n2. Select "Add to Home Screen"\n3. Tap "Add"\n\nThe app will appear on your home screen!'); }
        });
    }
    document.addEventListener('click', (e) => {
        if (panel.classList.contains('active') && !panel.contains(e.target) && !e.target.classList.contains('settings-btn')) closeSettings();
    });
}

function openSettings() { $('settings-panel').classList.add('active'); }
function closeSettings() { $('settings-panel').classList.remove('active'); }

function addSettingsButton() {
    const speakerGrille = qs('.speaker-grille');
    if (speakerGrille && !$('settings-btn')) {
        const settingsBtn = document.createElement('button');
        settingsBtn.className = 'settings-btn'; settingsBtn.id = 'settings-btn';
        settingsBtn.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/></svg>`; 
        settingsBtn.title = 'Menu';
        settingsBtn.addEventListener('click', (e) => { e.stopPropagation(); openSettings(); });
        speakerGrille.appendChild(settingsBtn);
    }
    if (speakerGrille && !$('radio-now-playing')) {
        const nowPlaying = document.createElement('div');
        nowPlaying.className = 'radio-now-playing'; nowPlaying.id = 'radio-now-playing';
        nowPlaying.innerHTML = `<div class="now-playing-artist"></div><div class="now-playing-title"></div>`;
        speakerGrille.appendChild(nowPlaying);
    }
    if (speakerGrille && !$('grille-power-btn')) {
        const powerBtn = document.createElement('div');
        powerBtn.className = 'grille-power-btn'; powerBtn.id = 'grille-power-btn'; powerBtn.title = 'Resume playback';
        powerBtn.innerHTML = `<svg viewBox="0 0 24 24" class="grille-play-icon" aria-hidden="true"><polygon points="8,5 19,12 8,19"></polygon></svg>`;
        powerBtn.addEventListener('click', (e) => { e.stopPropagation(); APP.manuallyPaused = false; resumePlayback(); });
        speakerGrille.appendChild(powerBtn);
    }
}

// =========================================================================
// CONTROLS SETUP
// =========================================================================

function setupControls() {
    // CRITICAL: Add a one-time listener to resume AudioContext on first user interaction
    // This is essential for Android after other apps have had audio focus
    const resumeAudioOnInteraction = async () => {
        if (APP.audioContextNeedsResume) {
            Debug.AUDIO('User interaction detected, attempting AudioContext resume');
            await ensureAudioContextRunning();
        }
    };
    
    // Listen on multiple events to catch any user interaction
    ['click', 'touchstart', 'keydown'].forEach(event => {
        document.addEventListener(event, resumeAudioOnInteraction, { once: false, passive: true });
    });
    
    const volSlider = $('volume-slider');
    const volGroup = qs('.volume-control-group');
    const showVolumeSlider = () => { volGroup.classList.add('show-slider'); clearTimeout(APP.volumeSliderTimeout); };
    const hideVolumeSlider = () => { clearTimeout(APP.volumeSliderTimeout); APP.volumeSliderTimeout = setTimeout(() => volGroup.classList.remove('show-slider'), 1500); };
    const hideVolumeSliderNow = () => { clearTimeout(APP.volumeSliderTimeout); volGroup.classList.remove('show-slider'); };

    volSlider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        APP.volume = val;
        if (APP.gainNode) APP.gainNode.gain.value = APP.volume;
        const vid = $('video-player');
        if (vid) vid.volume = val;
        updateVolumeKnobRotation(val);
        showVolumeSlider();
    });
    volSlider.addEventListener('change', hideVolumeSlider);
    volSlider.addEventListener('touchend', hideVolumeSlider);
    volSlider.addEventListener('mousedown', (e) => { e.stopPropagation(); volGroup.classList.add('interacting'); });
    volSlider.addEventListener('mouseup', () => volGroup.classList.remove('interacting'));
    volSlider.addEventListener('dragstart', (e) => e.preventDefault());

    let touchStartY = 0, startVolume = 0;
    volGroup.addEventListener('touchstart', (e) => { touchStartY = e.touches[0].clientY; startVolume = parseFloat(volSlider.value); showVolumeSlider(); volGroup.classList.add('interacting'); }, { passive: false });
    volGroup.addEventListener('touchmove', (e) => {
        if (!volGroup.classList.contains('interacting')) return;
        e.preventDefault();
        const deltaY = touchStartY - e.touches[0].clientY;
        let newVol = Math.max(0, Math.min(1, startVolume + (deltaY * 0.005)));
        APP.volume = newVol; volSlider.value = newVol;
        if (APP.gainNode) APP.gainNode.gain.value = newVol;
        const vid = $('video-player'); if (vid) vid.volume = newVol;
        updateVolumeKnobRotation(newVol);
    }, { passive: false });
    volGroup.addEventListener('touchend', () => { volGroup.classList.remove('interacting'); hideVolumeSlider(); });
    $('volume-btn').addEventListener('click', (e) => { e.stopPropagation(); if (volGroup.classList.contains('show-slider')) hideVolumeSlider(); else { showVolumeSlider(); hideVolumeSlider(); } });
    volGroup.addEventListener('mouseenter', showVolumeSlider);
    volGroup.addEventListener('mouseleave', hideVolumeSlider);
    document.addEventListener('touchstart', (e) => { if (!volGroup.contains(e.target)) hideVolumeSliderNow(); }, { passive: true });

    $('stop-btn').addEventListener('click', () => { APP.manuallyPaused = true; stopPlayback(); updateTransportButtonStates(); });
    $('pause-btn').addEventListener('click', () => { APP.manuallyPaused = true; pausePlayback(); updateTransportButtonStates(); });
    $('play-btn').addEventListener('click', () => { APP.manuallyPaused = false; playPlayback(); updateTransportButtonStates(); });
    $('left-arrow').addEventListener('click', () => { 
        hideOnboardingHints(); 
        if (APP.bandSwitchTimer) { clearTimeout(APP.bandSwitchTimer); APP.bandSwitchTimer = null; } 
        const list = getCurrentTrackList();
        if (list && list.length > 0) {
            if (!APP.isPlaying) { APP.isPlaying = true; APP.manuallyPaused = false; }
            // Wrap around to last track if at beginning
            const newIndex = APP.currentIndex > 0 ? APP.currentIndex - 1 : list.length - 1;
            tuneToStation(newIndex); 
        }
    });
    $('right-arrow').addEventListener('click', () => { 
        hideOnboardingHints(); 
        if (APP.bandSwitchTimer) { clearTimeout(APP.bandSwitchTimer); APP.bandSwitchTimer = null; } 
        const list = getCurrentTrackList(); 
        if (list && list.length > 0) {
            if (!APP.isPlaying) { APP.isPlaying = true; APP.manuallyPaused = false; }
            // Wrap around to first track if at end
            const newIndex = APP.currentIndex < list.length - 1 ? APP.currentIndex + 1 : 0;
            tuneToStation(newIndex); 
        }
    });
    $('guide-btn').addEventListener('click', openProgramGuide);
    $('close-guide').addEventListener('click', closeProgramGuide);
    $('modal-overlay').addEventListener('click', closeProgramGuide);

    qsa('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent event bubbling
            qsa('.tab-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            const view = e.target.dataset.view;
            APP.radioState.viewMode = view;
            
            if (view === BANDS.BOOK1 || view === BANDS.BOOK2) {
                // Disable shuffle for guided Book experience
                if (APP.radioState.isShuffled) {
                    APP.radioState.isShuffled = false;
                    $('shuffle-btn')?.classList.remove('active');
                }
                // Switch to the book and ensure we start at track 0
                APP.currentBand = view;
                APP.currentIndex = 0;
                APP.recentBandSwitch = true;
                if (APP.nextTrackHowl) { APP.nextTrackHowl.unload(); APP.nextTrackHowl = null; }
                APP.nextTrackSrc = null;
                APP.currentTrackSrc = null; // Force reload even if same track
                if (APP.bandSwitchTimer) clearTimeout(APP.bandSwitchTimer);
                buildDial();
                APP.isPlaying = true;
                APP.manuallyPaused = false;
                APP.bandSwitchTimer = setTimeout(() => { APP.bandSwitchTimer = null; loadTrack(0); }, 100);
                closeProgramGuide();
            }
            else if (view === 'playlists') {
                // Just render the list - don't stop music
                renderPlaylistList();
            }
            else if (view === 'tracks') {
                // Just render the list - actual band switch happens when user picks a track
                renderTrackList();
            }
            else if (view === 'artists') {
                // Just render the list - actual band switch happens when user picks an artist
                renderArtistList();
            }
            else if (view === 'genres') {
                // Just render the list - actual band switch happens when user picks a genre
                renderGenreList();
            }
        });
    });

    $('shuffle-btn').addEventListener('click', (e) => {
        if (APP.shuffleDebounce) return;
        APP.shuffleDebounce = true; setTimeout(() => APP.shuffleDebounce = false, 500);
        if (APP.isTransitioning) { gsap.killTweensOf('#am-proxy'); gsap.killTweensOf('#dial-track'); gsap.killTweensOf('#fm-track'); APP.isTransitioning = false; }
        if (APP.bandSwitchTimer) { clearTimeout(APP.bandSwitchTimer); APP.bandSwitchTimer = null; }
        APP.radioState.isShuffled = !APP.radioState.isShuffled;
        e.currentTarget.classList.toggle('active');
        // Toast confirmation
        showToast(APP.radioState.isShuffled ? 'Shuffle ON' : 'Shuffle OFF', 2000, 'info');
        processRadioData();
        if (APP.currentBand === BANDS.RADIO) { APP.currentIndex = 0; APP.currentTrackSrc = null; buildDial(); APP.isPlaying = true; APP.isTransitioning = true; loadTrack(0, true, false); APP.isTransitioning = false; }
        if (APP.radioState.viewMode === 'tracks') renderTrackList();
        else if (APP.radioState.viewMode === 'artists') renderArtistList();
    });

    $('repeat-btn').addEventListener('click', (e) => { 
        APP.radioState.isRepeat = !APP.radioState.isRepeat; 
        e.currentTarget.classList.toggle('active', APP.radioState.isRepeat); 
        // Toast confirmation
        showToast(APP.radioState.isRepeat ? 'Repeat ON' : 'Repeat OFF', 2000, 'info');
    });
    $('search-btn').addEventListener('click', () => openSearchOverlay());
}

// =========================================================================
// PWA & SERVICE WORKER
// =========================================================================

function setupPWA() {
    if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true) { APP.isPWA = true; return; }
    const installBtn = document.createElement('button');
    installBtn.className = 'install-pwa-btn'; installBtn.id = 'pwa-install-btn'; installBtn.innerHTML = '&#8595; Install App';
    document.body.appendChild(installBtn);
    installBtn.addEventListener('click', async () => {
        if (!APP.deferredPrompt) return;
        APP.deferredPrompt.prompt();
        const { outcome } = await APP.deferredPrompt.userChoice;
        APP.deferredPrompt = null;
        installBtn.classList.remove('visible');
    });
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault(); APP.deferredPrompt = e;
        const btn = document.getElementById('pwa-install-btn');
        if (btn) btn.classList.add('visible');
    });
    window.addEventListener('appinstalled', () => {
        APP.deferredPrompt = null; APP.isPWA = true;
        const btn = document.getElementById('pwa-install-btn');
        if (btn) btn.classList.remove('visible');
    });
}

function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        Debug.PWA('Registering service worker');
        navigator.serviceWorker.register('sw.js').then((registration) => {
            APP.swReady = true;
            Debug.PWA('Service worker registered', { scope: registration.scope });
            if (navigator.serviceWorker.controller) navigator.serviceWorker.controller.postMessage({ type: SW_MSG.GET_CACHED_URLS });
            registration.update();
            setInterval(() => registration.update(), 60000);
            if (registration.waiting) {
                Debug.PWA('SW waiting, skipping');
                registration.waiting.postMessage({ type: SW_MSG.SKIP_WAITING });
            }
            registration.addEventListener('updatefound', () => {
                Debug.PWA('SW update found');
                const newWorker = registration.installing;
                newWorker.addEventListener('statechange', () => {
                    Debug.PWA('New SW state', { state: newWorker.state });
                    if (newWorker.state === 'installed' && navigator.serviceWorker.controller) newWorker.postMessage({ type: SW_MSG.SKIP_WAITING });
                });
            });
        }).catch((error) => { Debug.error('Service Worker registration failed', error); });

        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => { 
            Debug.PWA('Controller change, reloading');
            if (!refreshing) { refreshing = true; window.location.reload(); } 
        });
        navigator.serviceWorker.addEventListener('message', (event) => {
            Debug.PWA('SW message', { type: event.data.type });
            if (event.data.type === SW_MSG.CACHED_URLS_LIST) { APP.cachedUrls = new Set(event.data.urls); updateOfflineIndicators(); }
            if (event.data.type === SW_MSG.AUDIO_CACHED) {
                APP.cachedUrls.add(event.data.url);
                try {
                    const urlObj = new URL(event.data.url, window.location.origin);
                    const filePath = urlObj.searchParams.get('file') || event.data.url;
                    const filename = filePath.split('/').pop();
                    showToast(`Downloaded: ${decodeURIComponent(filename)}`, 4000, 'success');
                } catch (e) { showToast('Download complete', 3000, 'success'); }
                updateOfflineIndicators(); updateDownloadProgress();
            }
            if (event.data.type === SW_MSG.AUDIO_UNCACHED) { APP.cachedUrls.delete(event.data.url); updateOfflineIndicators(); }
            if (event.data.type === SW_MSG.AUDIO_CACHE_FAILED) { showToast('Download failed. Check connection.', 5000, 'error'); updateDownloadProgress(); }
            if (event.data.type === SW_MSG.AUDIO_CACHE_CLEARED) { APP.cachedUrls.clear(); updateOfflineIndicators(); }
        });
    } else {
        Debug.warn('Service Worker not supported');
    }
}

// =========================================================================
// INITIALIZATION
// =========================================================================

async function initializeApp() {
    if (APP.initialized) return;
    APP.initialized = true;
    Debug.INIT('initializeApp started');
    loadSettings();
    loadUserPlaylists();
    loadExplicitDownloads();
    registerServiceWorker();
    setupPWA();
    setupVisibilityHandler();
    setupBroadcastChannel();
    requestPersistentStorage();
    checkStorageQuota();
    restorePlaybackState();
    const shouldRestorePosition = !APP.settings.startWithShuffle;
    Debug.INIT('State restored', { shouldRestorePosition, band: APP.currentBand });

    try {
        const plResponse = await fetch('serve.php?file=playlist.json');
        if (plResponse.status === 401 || plResponse.status === 403) { APP.initialized = false; Debug.error('Playlist fetch unauthorized'); return; }
        APP.playlist = await plResponse.json();
        Debug.INIT('Playlist loaded', { tracks: Object.keys(APP.playlist).length });
        try {
            const radioResponse = await fetch('serve.php?file=radio.json');
            if (radioResponse.ok) { APP.radioData = await radioResponse.json(); processRadioData(); Debug.INIT('Radio data loaded', { tracks: APP.radioPlaylist?.length }); }
        } catch (e) { Debug.warn("Failed to load radio.json", e); }

        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        
        // Initialize Audio Engine (new module)
        if (AudioEngine.init()) {
            // Audio engine handles APP.audioContext, APP.gainNode, etc.
        } else {
            // Fallback to legacy initialization
            APP.audioContext = new AudioCtx();
            APP.gainNode = APP.audioContext.createGain();
            APP.gainNode.gain.value = APP.volume;
            APP.gainNode.connect(APP.audioContext.destination);
            APP.musicGain = APP.audioContext.createGain();
            APP.staticGain = APP.audioContext.createGain();
            APP.musicGain.connect(APP.gainNode);
            APP.staticGain.connect(APP.gainNode);
            createStaticNoise();
        }
        
        // Set up AudioContext state monitoring for interrupt handling
        setupAudioContextMonitoring();
        
        $('video-player').addEventListener('ended', handleAutoplay);
        setupControls();
        setupMediaSession();
        createSettingsPanel();
        addSettingsButton();

        if (shouldRestorePosition && typeof APP.pendingRestoreVolume === 'number') {
            APP.volume = APP.pendingRestoreVolume;
        }
        // Ensure minimum volume to prevent silent playback
        if (APP.volume < CONFIG.MIN_VOLUME) APP.volume = CONFIG.DEFAULT_VOLUME;
        
        // Apply volume to gain node and slider
        if (APP.gainNode) APP.gainNode.gain.value = APP.volume;
        const volSlider = $('volume-slider');
        if (volSlider) volSlider.value = APP.volume;
        
        updateVolumeKnobRotation(APP.volume);
        const shuffleBtn = $('shuffle-btn');
        if (shuffleBtn && APP.radioState.isShuffled) shuffleBtn.classList.add('active');

        let startIndex = 0;
        if (shouldRestorePosition) {
            if (APP.pendingRestoreTrackId) {
                const foundIndex = findTrackInPlaylist(APP.pendingRestoreTrackId, APP.pendingRestoreTrackArtist);
                if (foundIndex >= 0) startIndex = foundIndex;
                else startIndex = APP.pendingRestoreIndex || 0;
            } else startIndex = APP.pendingRestoreIndex || 0;
        } else {
            const list = getCurrentTrackList();
            if (list && list.length > 0) startIndex = Math.floor(Math.random() * list.length);
        }

        APP.currentIndex = startIndex;
        buildDial();
        gsap.to('.radio-cabinet', { opacity: 1, duration: 1.5, ease: 'power2.out' });
        APP.isPlaying = true;
        loadTrack(startIndex);

        if (shouldRestorePosition && APP.pendingRestoreTime && APP.pendingRestoreTime > 0) {
            setTimeout(() => {
                if (APP.currentHowl && APP.currentHowl.duration() > APP.pendingRestoreTime) APP.currentHowl.seek(APP.pendingRestoreTime);
                APP.pendingRestoreTime = 0;
            }, 1000);
        }

        setInterval(savePlaybackState, 30000);
        window.addEventListener('beforeunload', savePlaybackState);
        window.addEventListener('pagehide', savePlaybackState);
        document.addEventListener('visibilitychange', () => { if (document.hidden) savePlaybackState(); });
    } catch (error) {
        console.error('Failed to initialize app:', error);
        APP.initialized = false;
    }
}

// =========================================================================
// WINDOW RESIZE
// =========================================================================

window.addEventListener('resize', () => {
    const f = qs('.station');
    if (f && f.offsetWidth > 0) APP.sectionWidth = f.offsetWidth;
    if (APP.currentBand === BANDS.RADIO) { setupDualDraggables(); renderVirtualDial(APP.currentIndex * -APP.sectionWidth); }
    else setupSingleDraggable();
});
