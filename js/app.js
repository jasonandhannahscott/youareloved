// ZENITH APP.JS - VERSION 5.0 - UI & SHUFFLE FIXES
// If you don't see "VERSION 5.0" in console, clear browser cache!
console.log('=== ZENITH APP.JS VERSION 5.0 LOADED ===');

const $ = (id) => document.getElementById(id);
const qs = (s) => document.querySelector(s);
const qsa = (s) => document.querySelectorAll(s);

const APP = {
    initialized: false,
    hasInteracted: false,
    playlist: null, 
    radioData: null, 
    radioPlaylist: [], 
    radioArtists: [],
    userPlaylists: [],
    cachedUrls: new Set(),
    swReady: false,
    pageVisible: true,
    isBackgrounded: false, // Track if app is in background/locked
    isMobile: /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent),
    isIOS: /iPhone|iPad|iPod/i.test(navigator.userAgent),
    isAndroid: /Android/i.test(navigator.userAgent),
    isPWA: window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true,
    deferredPrompt: null, // Store PWA install prompt
    shuffleDebounce: false, // Prevent rapid shuffle clicks
    
    currentBand: 'radio', 
    currentIndex: 0,
    currentTrackSrc: null,
    nextTrackHowl: null,
    nextTrackSrc: null,
    recentBandSwitch: false,
    pendingIndex: -1,
        
    audioContext: null, gainNode: null, staticNode: null,
    staticGain: null, musicGain: null, currentHowl: null,
    isPlaying: false, isDragging: false, isTransitioning: false,
    
    sectionWidth: 150, 
    volume: 0.8, 
    expandTimer: null,
    volumeSliderTimeout: null,
    bandSwitchTimer: null,
    positionTimer: null,
    
    // User settings
    settings: {
        startWithShuffle: true  // Default: start with random playback
    },

    radioState: {
        isShuffled: true, 
        viewMode: 'tracks', 
        activeGenre: null,
        activeArtistFilter: null,
        lastArtistIndex: 0
    },

    virtualState: {
        poolSize: 24, 
        pool: [],            
        totalWidth: 0,
        visibleRange: { start: 0, end: 0 }
    }
};

// NEW: Inject styles for high contrast buttons AND Install Button
function injectCustomStyles() {
    const style = document.createElement('style');
    style.textContent = `
        /* ========================================
           PROGRAM ITEM CARDS - COMPLETE OVERRIDE
           ======================================== */
        
        /* Remove the old ::after NOW PLAYING indicator */
        .program-item.active-track::after {
            display: none !important;
        }
        
        /* Base card layout - horizontal flex */
        .program-item {
            display: flex !important;
            flex-direction: row !important;
            align-items: flex-start !important;
            justify-content: space-between !important;
            padding: 12px 15px !important;
            gap: 12px !important;
        }
        
        /* Song info section - left side */
        .program-item-main {
            flex: 1 1 auto !important;
            min-width: 0 !important;
            display: flex !important;
            flex-direction: column !important;
            gap: 2px !important;
        }
        
        .program-item-main .artist {
            font-size: 1.1rem !important;
            font-weight: 600 !important;
            color: var(--dark-walnut) !important;
            line-height: 1.2 !important;
        }
        
        .program-item-main .title {
            font-size: 0.95rem !important;
            font-weight: 400 !important;
            color: #555 !important;
            line-height: 1.3 !important;
        }
        
        /* Actions section - right side, stacked buttons */
        .program-item-actions {
            display: flex !important;
            flex-direction: column !important;
            align-items: flex-end !important;
            gap: 5px !important;
            flex-shrink: 0 !important;
        }
        
        /* All action buttons - clean text style */
        .program-item-actions button,
        .program-item-actions .now-playing-indicator {
            background: transparent !important;
            border: 1px solid rgba(0,0,0,0.2) !important;
            border-radius: 3px !important;
            padding: 4px 10px !important;
            font-size: 0.65rem !important;
            font-weight: 600 !important;
            font-family: 'Oswald', sans-serif !important;
            text-transform: uppercase !important;
            letter-spacing: 0.5px !important;
            cursor: pointer !important;
            color: #666 !important;
            white-space: nowrap !important;
            width: auto !important;
            height: auto !important;
            line-height: 1.2 !important;
            transition: all 0.15s ease !important;
            position: relative !important;
            overflow: hidden !important;
        }
        
        .program-item-actions button:hover {
            background: var(--brass-gold) !important;
            border-color: var(--brass-gold) !important;
            color: #fff !important;
        }
        
        /* Now Playing indicator - GOLD styling */
        .now-playing-indicator {
            background: transparent !important;
            border: 2px solid var(--brass-gold) !important;
            color: var(--brass-gold) !important;
            cursor: default !important;
            font-weight: 700 !important;
            padding: 6px 12px !important;
            font-size: 0.7rem !important;
        }
        
        /* Download button progress fill */
        .download-track-btn::before {
            content: '';
            position: absolute;
            left: 0;
            top: 0;
            height: 100%;
            width: 0%;
            background: var(--brass-gold);
            transition: width 0.3s ease;
            z-index: -1;
        }
        
        .download-track-btn.downloading {
            border-color: var(--brass-gold) !important;
            color: #333 !important;
        }
        
        .download-track-btn.downloading::before {
            animation: download-progress 3s ease-out forwards;
        }
        
        @keyframes download-progress {
            0% { width: 0%; background: var(--brass-gold); }
            90% { width: 90%; background: var(--brass-gold); }
            100% { width: 100%; background: #4CAF50; }
        }
        
        /* Downloaded state */
        .program-item-actions button.downloaded {
            color: #2e7d32 !important;
            border-color: #2e7d32 !important;
            background: rgba(46, 125, 50, 0.1) !important;
        }
        
        .program-item-actions button.downloaded::before {
            width: 100% !important;
            background: rgba(46, 125, 50, 0.15) !important;
            animation: none !important;
        }
        
        /* Remove button - red hover */
        .remove-from-playlist-btn:hover {
            background: #c41e3a !important;
            border-color: #c41e3a !important;
            color: #fff !important;
        }
        
        /* Active track highlight */
        .program-item.active-track {
            background: rgba(212, 175, 55, 0.15) !important;
            border-left: 4px solid var(--brass-gold) !important;
        }
        
        .program-item.active-track .artist {
            color: #000 !important;
        }
        
        /* ========================================
           ARTIST LIST ITEMS
           ======================================== */
        .artist-list-item-content {
            display: flex;
            justify-content: space-between;
            align-items: center;
            width: 100%;
        }
        .artist-actions {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .download-artist-btn {
            background: transparent !important;
            border: 1px solid rgba(0,0,0,0.2) !important;
            border-radius: 3px !important;
            padding: 4px 10px !important;
            font-size: 0.65rem !important;
            font-weight: 600 !important;
            font-family: 'Oswald', sans-serif !important;
            text-transform: uppercase !important;
            color: #666 !important;
            cursor: pointer !important;
            width: auto !important;
            height: auto !important;
        }
        .download-artist-btn:hover {
            background: var(--brass-gold) !important;
            border-color: var(--brass-gold) !important;
            color: #fff !important;
        }
        
        /* ========================================
           SHUFFLE BUTTON - RED BORDER WHEN ACTIVE
           ======================================== */
        .shuffle-btn-icon.active {
            border-color: var(--needle-red) !important;
            border-width: 2px !important;
        }
        .shuffle-btn-icon.active .shuffle-mask {
            /* No animation, just the red color */
        }
        
        /* ========================================
           SETTINGS PANEL
           ======================================== */
        .settings-btn {
            position: absolute;
            top: 15px;
            right: 15px;
            background: rgba(0,0,0,0.4);
            border: 1px solid rgba(212, 175, 55, 0.5);
            border-radius: 50%;
            color: rgba(255,255,255,0.7);
            font-size: 1.4rem;
            cursor: pointer;
            padding: 8px;
            width: 40px;
            height: 40px;
            transition: color 0.2s, transform 0.2s, background 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 100;
        }
        .settings-btn:hover {
            color: var(--brass-gold);
            background: rgba(0,0,0,0.6);
            transform: rotate(30deg);
        }
        
        /* Radio Now Playing Display */
        .radio-now-playing {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            text-align: center;
            z-index: 50;
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.5s ease;
            width: 90%;
            max-width: 600px;
        }
        .radio-now-playing.visible {
            opacity: 1;
        }
        .radio-now-playing .now-playing-artist {
            font-family: 'Oswald', sans-serif;
            font-size: clamp(2rem, 6vw, 3.5rem);
            font-weight: 700;
            color: var(--dark-walnut);
            text-transform: uppercase;
            letter-spacing: 0.1em;
            text-shadow: 2px 2px 4px rgba(255,255,255,0.3), 0 0 20px rgba(212,175,55,0.2);
            margin-bottom: 0.5rem;
            line-height: 1.2;
            word-wrap: break-word;
        }
        .radio-now-playing .now-playing-title {
            font-family: 'Crimson Text', serif;
            font-size: clamp(1.4rem, 4vw, 2.2rem);
            font-weight: 600;
            color: var(--dark-walnut);
            font-style: italic;
            line-height: 1.3;
            text-shadow: 1px 1px 2px rgba(255,255,255,0.3);
            word-wrap: break-word;
        }
        
        .settings-panel {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            background: linear-gradient(to bottom, #1a1815, #2a2520);
            border-bottom: 2px solid var(--brass-gold);
            padding: 20px;
            z-index: 3000;
            font-family: 'Oswald', sans-serif;
            color: #ddd;
            transform: translateY(-100%);
            transition: transform 0.3s ease;
            max-height: 80vh;
            overflow-y: auto;
        }
        .settings-panel.active {
            display: block;
            transform: translateY(0);
        }
        
        .settings-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            padding-bottom: 10px;
            border-bottom: 1px solid rgba(255,255,255,0.1);
        }
        .settings-title {
            font-size: 1.3rem;
            color: var(--brass-gold);
            letter-spacing: 0.1em;
            text-transform: uppercase;
        }
        .settings-close {
            position: absolute;
            top: 15px;
            right: 15px;
            background: rgba(0,0,0,0.4);
            border: 1px solid rgba(212, 175, 55, 0.5);
            border-radius: 50%;
            color: rgba(255,255,255,0.7);
            font-size: 1.2rem;
            width: 40px;
            height: 40px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s;
        }
        .settings-close:hover {
            color: #fff;
            background: rgba(0,0,0,0.6);
        }
        
        .setting-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px 0;
            border-bottom: 1px solid rgba(255,255,255,0.05);
        }
        .setting-label {
            font-size: 0.95rem;
            color: #ccc;
        }
        .setting-description {
            font-size: 0.75rem;
            color: #888;
            margin-top: 3px;
        }
        
        /* Settings Action Button */
        .setting-action-btn {
            background: transparent;
            border: 1px solid var(--brass-gold);
            color: var(--brass-gold);
            padding: 8px 16px;
            font-family: 'Oswald', sans-serif;
            font-size: 0.85rem;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            cursor: pointer;
            border-radius: 4px;
            transition: all 0.2s;
        }
        .setting-action-btn:hover {
            background: var(--brass-gold);
            color: #000;
        }
        .setting-action-btn:disabled {
            opacity: 0.4;
            cursor: not-allowed;
        }
        
        /* Toggle Switch */
        .toggle-switch {
            position: relative;
            width: 50px;
            height: 26px;
            flex-shrink: 0;
        }
        .toggle-switch input {
            opacity: 0;
            width: 0;
            height: 0;
        }
        .toggle-slider {
            position: absolute;
            cursor: pointer;
            top: 0; left: 0; right: 0; bottom: 0;
            background: #444;
            border-radius: 26px;
            transition: 0.3s;
        }
        .toggle-slider::before {
            position: absolute;
            content: "";
            height: 20px;
            width: 20px;
            left: 3px;
            bottom: 3px;
            background: #888;
            border-radius: 50%;
            transition: 0.3s;
        }
        .toggle-switch input:checked + .toggle-slider {
            background: var(--brass-gold);
        }
        .toggle-switch input:checked + .toggle-slider::before {
            transform: translateX(24px);
            background: #fff;
        }
        
        /* ========================================
           PWA INSTALL BUTTON
           ======================================== */
        .install-pwa-btn {
            display: none;
            position: fixed;
            bottom: 30px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 9999;
            width: auto;
            min-width: 200px;
            padding: 12px 24px;
            background: #4CAF50;
            color: white;
            border: none;
            border-radius: 50px;
            box-shadow: 0 4px 15px rgba(0,0,0,0.5);
            font-family: inherit;
            font-weight: bold;
            font-size: 1rem;
            text-transform: uppercase;
            letter-spacing: 1px;
            cursor: pointer;
            transition: transform 0.2s, background 0.2s;
        }
        .install-pwa-btn:hover {
            background: #45a049;
            transform: translateX(-50%) scale(1.05);
        }
        .install-pwa-btn.visible {
            display: block;
            animation: slideUp 0.8s cubic-bezier(0.2, 0.8, 0.2, 1);
        }
        @keyframes slideUp {
            from { bottom: -80px; opacity: 0; }
            to { bottom: 30px; opacity: 1; }
        }
    `;
    document.head.appendChild(style);
}

function getSecureUrl(path) {
    const encoded = encodeURIComponent(path).replace(/'/g, '%27');
    return 'serve.php?file=' + encoded;
}

function shouldEnableStatic() {
    if (APP.isMobile && !APP.pageVisible) {
        return false;
    }
    return true;
}

function setStaticGain(value) {
    if (!APP.staticGain) return;
    if (shouldEnableStatic()) {
        APP.staticGain.gain.value = value;
    } else {
        APP.staticGain.gain.value = 0;
    }
}

function setupVisibilityHandler() {
    document.addEventListener('visibilitychange', () => {
        APP.pageVisible = !document.hidden;
        APP.isBackgrounded = document.hidden;
        
        if (APP.isMobile && document.hidden && APP.staticGain) {
            APP.staticGain.gain.value = 0;
        }
        
        console.log('[Visibility] Page visible:', APP.pageVisible, 'Backgrounded:', APP.isBackgrounded);
    });
    
    window.addEventListener('blur', () => {
        if (APP.isMobile) {
            APP.pageVisible = false;
            APP.isBackgrounded = true;
            if (APP.staticGain) APP.staticGain.gain.value = 0;
        }
    });
    
    window.addEventListener('focus', () => {
        APP.pageVisible = true;
        APP.isBackgrounded = false;
    });
}

// Check if we should use simple transitions (for PWA background mode)
function shouldUseSimpleTransitions() {
    // Use simple transitions if:
    // 1. Mobile device AND page is backgrounded/not visible
    // 2. Running as installed PWA on mobile
    return APP.isMobile && (APP.isBackgrounded || !APP.pageVisible);
}

function cleanPath(path) {
    if (!path) return '';
    return path.replace(/\\/g, '/').replace(/\/\//g, '/');
}

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

function hideOnboardingHints() {
    if (APP.hasInteracted) return;
    APP.hasInteracted = true;
    qsa('.scroll-indicator').forEach(el => el.classList.add('hidden'));
}

async function initializeApp() {
    if (APP.initialized) return;
    APP.initialized = true;
    
    console.log('[initializeApp] Starting, default currentBand:', APP.currentBand);

    injectCustomStyles(); 
    loadSettings();       // Load user settings first
    loadUserPlaylists();
    registerServiceWorker();
    setupPWA(); // Initialize PWA Install Listeners
    setupVisibilityHandler();
    
    // Always try to restore shuffle state and track info
    // Only skip restoring position if startWithShuffle is true
    restorePlaybackState();
    const shouldRestorePosition = !APP.settings.startWithShuffle;

    try {
        const plResponse = await fetch('serve.php?file=playlist.json');
        if (plResponse.status === 401 || plResponse.status === 403) {
            console.error("Auth failed during init");
            APP.initialized = false;
            return;
        }
        APP.playlist = await plResponse.json();
        console.log('[initializeApp] Loaded playlist.json');
        
        try {
            const radioResponse = await fetch('serve.php?file=radio.json');
            if (radioResponse.ok) {
                APP.radioData = await radioResponse.json();
                processRadioData();
                console.log('[initializeApp] Loaded radio.json');
            }
        } catch (e) { console.warn("Failed to load radio.json", e); }

        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        APP.audioContext = new AudioCtx();
        APP.gainNode = APP.audioContext.createGain();
        APP.gainNode.gain.value = APP.volume;
        APP.gainNode.connect(APP.audioContext.destination);
        
        APP.musicGain = APP.audioContext.createGain();
        APP.staticGain = APP.audioContext.createGain();
        APP.musicGain.connect(APP.gainNode);
        APP.staticGain.connect(APP.gainNode);
        
        createStaticNoise();
        $('video-player').addEventListener('ended', handleAutoplay);
        
        setupControls();
        setupMediaSession();
        createSettingsPanel();  // Create settings UI
        addSettingsButton();    // Add gear icon
        
        const shuffleBtn = $('shuffle-btn');
        if (shuffleBtn && APP.radioState.isShuffled) {
            shuffleBtn.classList.add('active');
        }
        
        // Determine start index
        let startIndex = 0;
        
        if (shouldRestorePosition) {
            // If we have track info from last session, try to find it in the (possibly reshuffled) playlist
            if (APP.pendingRestoreTrackId) {
                const foundIndex = findTrackInPlaylist(APP.pendingRestoreTrackId, APP.pendingRestoreTrackArtist);
                if (foundIndex >= 0) {
                    startIndex = foundIndex;
                    console.log('[Restore] Found last track at index:', foundIndex);
                } else {
                    startIndex = APP.pendingRestoreIndex || 0;
                    console.log('[Restore] Track not found, using saved index:', startIndex);
                }
            } else {
                startIndex = APP.pendingRestoreIndex || 0;
            }
        }
        
        console.log('[initializeApp] About to buildDial, currentBand:', APP.currentBand);
        buildDial();
        gsap.to('.radio-cabinet', { opacity: 1, duration: 1.5, ease: 'power2.out' });
        
        APP.isPlaying = true;
        console.log('[initializeApp] About to loadTrack(' + startIndex + '), currentBand:', APP.currentBand);
        loadTrack(startIndex);
        
        // If restoring position, seek to saved time after track loads
        if (shouldRestorePosition && APP.pendingRestoreTime && APP.pendingRestoreTime > 0) {
            setTimeout(() => {
                if (APP.currentHowl && APP.currentHowl.duration() > APP.pendingRestoreTime) {
                    APP.currentHowl.seek(APP.pendingRestoreTime);
                    console.log('[Restore] Seeked to', APP.pendingRestoreTime);
                }
                APP.pendingRestoreTime = 0;
            }, 1000);
        }
        
        // Save playback state periodically and on page unload
        setInterval(savePlaybackState, 30000); // Every 30 seconds
        window.addEventListener('beforeunload', savePlaybackState);
        window.addEventListener('pagehide', savePlaybackState);
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) savePlaybackState();
        });
        
    } catch (error) {
        console.error('Failed to initialize app:', error);
        APP.initialized = false;
    }
}

// =========================================================================
// PWA INSTALLATION LOGIC (UPDATED)
// =========================================================================

function setupPWA() {
    // 1. Check if already installed (standalone mode)
    if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true) {
        console.log("App is running in standalone mode (already installed).");
        APP.isPWA = true;
        return; 
    }

    // 2. Create the Install Button in DOM (Floating on body)
    // We attach it to body so it floats over the main UI (initial power screen)
    const installBtn = document.createElement('button');
    installBtn.className = 'install-pwa-btn';
    installBtn.id = 'pwa-install-btn';
    installBtn.innerHTML = '&#8595; Install App';
    
    document.body.appendChild(installBtn);

    installBtn.addEventListener('click', async () => {
        if (!APP.deferredPrompt) return;
        // Show the install prompt
        APP.deferredPrompt.prompt();
        // Wait for the user to respond to the prompt
        const { outcome } = await APP.deferredPrompt.userChoice;
        console.log(`User response to the install prompt: ${outcome}`);
        // We've used the prompt, so it can't be used again, discard it
        APP.deferredPrompt = null;
        // Hide the button
        installBtn.classList.remove('visible');
    });

    // 3. Listen for the browser event that says "Hey, this app is installable!"
    window.addEventListener('beforeinstallprompt', (e) => {
        // Prevent Chrome 67+ from automatically showing the mini-infobar
        e.preventDefault();
        // Stash the event so it can be triggered later.
        APP.deferredPrompt = e;
        console.log("PWA Install Prompt captured!");
        
        // For Android mobile users, ALWAYS show the install button on every visit
        if (APP.isAndroid && APP.isMobile) {
            const btn = document.getElementById('pwa-install-btn');
            if (btn) {
                btn.classList.add('visible');
                console.log("Showing install prompt for Android user");
            }
        }
    });

    // 4. Listen for successful installation
    window.addEventListener('appinstalled', () => {
        // Clear prompt
        APP.deferredPrompt = null;
        APP.isPWA = true;
        // Hide button
        const btn = document.getElementById('pwa-install-btn');
        if (btn) btn.classList.remove('visible');
        console.log('PWA was successfully installed');
    });
}

// =========================================================================
// MEDIA SESSION API
// =========================================================================

function setupMediaSession() {
    if (!('mediaSession' in navigator)) return;

    const actionHandlers = [
        ['play',        () => { 
            APP.isPlaying = true; 
            if(APP.currentHowl) APP.currentHowl.play(); 
            updatePlaybackState(); 
        }],
        ['pause',       () => { 
            APP.isPlaying = false; 
            if(APP.currentHowl) APP.currentHowl.pause(); 
            updatePlaybackState(); 
        }],
        ['previoustrack', () => { 
            hideOnboardingHints();
            if(APP.currentIndex > 0) tuneToStation(APP.currentIndex - 1); 
        }],
        ['nexttrack',     () => { 
            hideOnboardingHints();
            const list = getCurrentTrackList();
            if(APP.currentIndex < list.length - 1) tuneToStation(APP.currentIndex + 1);
            else if (list.length > 0) tuneToStation(0); 
        }],
        ['stop',        () => { 
            APP.isPlaying = false; 
            if(APP.currentHowl) APP.currentHowl.stop(); 
            updatePlaybackState(); 
        }],
        ['seekto',      (details) => {
            if (APP.currentHowl && details.seekTime) {
                APP.currentHowl.seek(details.seekTime);
                updatePositionState();
            }
        }],
        ['seekbackward', (details) => {
            const skipTime = details.seekOffset || 10;
            if (APP.currentHowl) {
                const current = APP.currentHowl.seek();
                APP.currentHowl.seek(Math.max(0, current - skipTime));
                updatePositionState();
            }
        }],
        ['seekforward', (details) => {
            const skipTime = details.seekOffset || 10;
            if (APP.currentHowl) {
                const current = APP.currentHowl.seek();
                APP.currentHowl.seek(current + skipTime);
                updatePositionState();
            }
        }]
    ];

    for (const [action, handler] of actionHandlers) {
        try {
            navigator.mediaSession.setActionHandler(action, handler);
        } catch (error) {
            console.warn(`The media session action "${action}" is not supported yet.`);
        }
    }
}

function updateMediaSessionMetadata(track) {
    if (!('mediaSession' in navigator) || !track) return;

    const title = track.title || track.Title || 'Unknown Title';
    const artist = track.artist || track.Artist || 'Zenith Companion';
    const album = APP.currentBand === 'radio' ? 'Radio' : 
                  (APP.currentBand.startsWith('playlist_') ? 'Custom Playlist' : 'Audiobook');

    navigator.mediaSession.metadata = new MediaMetadata({
        title: title,
        artist: artist,
        album: album,
        artwork: [
            { src: 'icons/icon-96.png',   sizes: '96x96',   type: 'image/png' },
            { src: 'icons/icon-128.png',  sizes: '128x128', type: 'image/png' },
            { src: 'icons/icon-192.png',  sizes: '192x192', type: 'image/png' },
            { src: 'icons/icon-512.png',  sizes: '512x512', type: 'image/png' }
        ]
    });
    
    updatePlaybackState();
}

function updatePlaybackState() {
    if (!('mediaSession' in navigator)) return;
    
    navigator.mediaSession.playbackState = APP.isPlaying ? "playing" : "paused";
    updatePositionState();
}

function updatePositionState() {
    if (!('mediaSession' in navigator) || !APP.currentHowl || !APP.isPlaying) return;
    
    const duration = APP.currentHowl.duration();
    const position = APP.currentHowl.seek();
    
    // Validate: duration must be a finite positive number, position must be valid and less than duration
    // On mobile HTML5 audio, duration can be Infinity or 0 before metadata loads
    if (duration && 
        isFinite(duration) && 
        duration > 0 && 
        !isNaN(position) && 
        position >= 0 && 
        position <= duration) {
        try {
            navigator.mediaSession.setPositionState({
                duration: duration,
                playbackRate: 1.0,
                position: Math.min(position, duration) // Ensure position never exceeds duration
            });
        } catch(e) {
            console.warn("Error updating position state", e);
        }
    }
}

function startPositionUpdater() {
    if (APP.positionTimer) clearInterval(APP.positionTimer);
    APP.positionTimer = setInterval(() => {
        if (APP.isPlaying) {
            updatePositionState();
        }
    }, 1000); 
}

// =========================================================================
// APP LOGIC
// =========================================================================

function getCurrentTrackList() {
    if (APP.currentBand === 'radio') return APP.radioPlaylist;
    return APP.playlist[APP.currentBand] || [];
}

function processRadioData() {
    if (!APP.radioData) return;

    let tracks = APP.radioData.filter(t => {
        if (APP.radioState.activeArtistFilter) return t.ParentFolder === APP.radioState.activeArtistFilter;
        if (APP.radioState.activeGenre) return t.Genre === APP.radioState.activeGenre;
        return true;
    });

    if (APP.radioState.isShuffled) {
        tracks = shuffleArray([...tracks]);
    } else {
        tracks.sort((a, b) => (a.ParentFolder + a.Title).localeCompare(b.ParentFolder + b.Title));
    }

    APP.radioPlaylist = tracks;

    const artistMap = new Map();
    APP.radioPlaylist.forEach((track, index) => {
        const key = track.ParentFolder || 'Unknown';
        if (!artistMap.has(key)) {
            artistMap.set(key, {
                folder: key,
                artist: track.Artist || 'Unknown Artist',
                firstSongIndex: index,
                songCount: 0
            });
        }
        artistMap.get(key).songCount++;
    });
    
    APP.radioArtists = Array.from(artistMap.values());
}

function loadUserPlaylists() {
    try {
        const stored = localStorage.getItem('zenith_playlists');
        APP.userPlaylists = stored ? JSON.parse(stored) : [];
    } catch (e) {
        console.warn('Failed to load playlists from localStorage', e);
        APP.userPlaylists = [];
    }
}

function saveUserPlaylists() {
    try {
        localStorage.setItem('zenith_playlists', JSON.stringify(APP.userPlaylists));
    } catch (e) {
        console.warn('Failed to save playlists to localStorage', e);
    }
}

// =========================================================================
// SETTINGS & PLAYBACK STATE MANAGEMENT
// =========================================================================

function loadSettings() {
    try {
        const stored = localStorage.getItem('zenith_settings');
        if (stored) {
            APP.settings = {...APP.settings, ...JSON.parse(stored)};
        }
    } catch (e) {
        console.warn('Failed to load settings', e);
    }
}

function saveSettings() {
    try {
        localStorage.setItem('zenith_settings', JSON.stringify(APP.settings));
    } catch (e) {
        console.warn('Failed to save settings', e);
    }
}

function savePlaybackState() {
    try {
        const list = getCurrentTrackList();
        const currentTrack = list && list[APP.currentIndex];
        
        const state = {
            band: APP.currentBand,
            index: APP.currentIndex,
            time: APP.currentHowl ? APP.currentHowl.seek() : 0,
            artistFilter: APP.radioState.activeArtistFilter,
            genreFilter: APP.radioState.activeGenre,
            isShuffled: APP.radioState.isShuffled,
            timestamp: Date.now(),
            // Save track identifying info to find it after reshuffle
            currentTrackId: currentTrack ? (currentTrack.src_audio || (currentTrack.Title || currentTrack.title)) : null,
            currentTrackArtist: currentTrack ? (currentTrack.Artist || currentTrack.artist) : null
        };
        localStorage.setItem('zenith_playback_state', JSON.stringify(state));
    } catch (e) {
        console.warn('Failed to save playback state', e);
    }
}

function loadPlaybackState() {
    try {
        const stored = localStorage.getItem('zenith_playback_state');
        return stored ? JSON.parse(stored) : null;
    } catch (e) {
        console.warn('Failed to load playback state', e);
        return null;
    }
}

function restorePlaybackState() {
    const state = loadPlaybackState();
    if (!state) return false;
    
    // Only restore if within last 7 days
    if (Date.now() - state.timestamp > 7 * 24 * 60 * 60 * 1000) return false;
    
    console.log('[Restore] Restoring playback state:', state);
    
    // Restore shuffle state
    APP.radioState.isShuffled = state.isShuffled;
    const shuffleBtn = $('shuffle-btn');
    if (shuffleBtn) {
        shuffleBtn.classList.toggle('active', state.isShuffled);
    }
    
    // Restore filters
    APP.radioState.activeArtistFilter = state.artistFilter || null;
    APP.radioState.activeGenre = state.genreFilter || null;
    
    // Restore band
    APP.currentBand = state.band || 'radio';
    
    // If it's a playlist band, ensure it exists
    if (APP.currentBand.startsWith('playlist_')) {
        const playlistId = APP.currentBand.replace('playlist_', '');
        const playlist = APP.userPlaylists.find(p => p.id === playlistId);
        if (!playlist) {
            APP.currentBand = 'radio';
        } else {
            APP.playlist[APP.currentBand] = playlist.tracks;
        }
    }
    
    // Store track info to find after playlist is loaded (for reshuffled playlists)
    APP.pendingRestoreTrackId = state.currentTrackId;
    APP.pendingRestoreTrackArtist = state.currentTrackArtist;
    
    // Restore index (will be applied after data loads)
    APP.pendingRestoreIndex = state.index || 0;
    APP.pendingRestoreTime = state.time || 0;
    
    return true;
}

// Find the index of a track by its ID/info after reshuffle
function findTrackInPlaylist(trackId, trackArtist) {
    if (!trackId) return -1;
    
    const list = getCurrentTrackList();
    if (!list || !list.length) return -1;
    
    for (let i = 0; i < list.length; i++) {
        const t = list[i];
        const id = t.src_audio || (t.Title || t.title);
        const artist = t.Artist || t.artist;
        
        if (id === trackId && (!trackArtist || artist === trackArtist)) {
            return i;
        }
    }
    
    return -1;
}

function createSettingsPanel() {
    const panel = document.createElement('div');
    panel.className = 'settings-panel';
    panel.id = 'settings-panel';
    
    // Check if we should show the install option
    const showInstallOption = APP.isAndroid && !APP.isPWA;
    
    panel.innerHTML = `
        <div class="settings-header">
            <span class="settings-title">⚙ Settings</span>
            <button class="settings-close" id="settings-close">✕</button>
        </div>
        
        <div class="setting-item">
            <div>
                <div class="setting-label">Start with random playback</div>
                <div class="setting-description">When enabled, starts fresh each session. When disabled, resumes where you left off.</div>
            </div>
            <label class="toggle-switch">
                <input type="checkbox" id="setting-shuffle-start" ${APP.settings.startWithShuffle ? 'checked' : ''}>
                <span class="toggle-slider"></span>
            </label>
        </div>
        
        ${showInstallOption ? `
        <div class="setting-item" id="install-app-setting">
            <div>
                <div class="setting-label">Install App</div>
                <div class="setting-description">Add to home screen for offline access and better experience.</div>
            </div>
            <button class="setting-action-btn" id="setting-install-btn">Install</button>
        </div>
        ` : ''}
        
        ${APP.isPWA ? `
        <div class="setting-item">
            <div>
                <div class="setting-label">App Installed</div>
                <div class="setting-description">You're running the installed app. To reinstall, remove from home screen first.</div>
            </div>
            <span style="color: #4CAF50; font-size: 1.2rem;">✓</span>
        </div>
        ` : ''}
    `;
    
    document.body.appendChild(panel);
    
    // Event listeners
    $('settings-close').addEventListener('click', closeSettings);
    
    $('setting-shuffle-start').addEventListener('change', (e) => {
        APP.settings.startWithShuffle = e.target.checked;
        saveSettings();
    });
    
    // Install button handler
    const installBtn = $('setting-install-btn');
    if (installBtn) {
        installBtn.addEventListener('click', async () => {
            if (APP.deferredPrompt) {
                // Use the stored prompt
                APP.deferredPrompt.prompt();
                const { outcome } = await APP.deferredPrompt.userChoice;
                console.log(`User response to install prompt: ${outcome}`);
                APP.deferredPrompt = null;
                
                if (outcome === 'accepted') {
                    installBtn.textContent = 'Installing...';
                    installBtn.disabled = true;
                }
            } else {
                // No prompt available - show manual instructions
                alert('To install the app:\n\n1. Tap the browser menu (⋮)\n2. Select "Add to Home Screen"\n3. Tap "Add"\n\nThe app will appear on your home screen!');
            }
        });
    }
    
    // Close when clicking outside
    document.addEventListener('click', (e) => {
        if (panel.classList.contains('active') && 
            !panel.contains(e.target) && 
            !e.target.classList.contains('settings-btn')) {
            closeSettings();
        }
    });
}

function openSettings() {
    $('settings-panel').classList.add('active');
}

function closeSettings() {
    $('settings-panel').classList.remove('active');
}

function addSettingsButton() {
    // Add gear button to the speaker grille (top right)
    const speakerGrille = qs('.speaker-grille');
    if (speakerGrille && !$('settings-btn')) {
        const settingsBtn = document.createElement('button');
        settingsBtn.className = 'settings-btn';
        settingsBtn.id = 'settings-btn';
        settingsBtn.innerHTML = '⚙';
        settingsBtn.title = 'Settings';
        settingsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openSettings();
        });
        speakerGrille.appendChild(settingsBtn);
    }
    
    // Also add the radio now playing display to the speaker grille
    if (speakerGrille && !$('radio-now-playing')) {
        const nowPlaying = document.createElement('div');
        nowPlaying.className = 'radio-now-playing';
        nowPlaying.id = 'radio-now-playing';
        nowPlaying.innerHTML = `
            <div class="now-playing-artist"></div>
            <div class="now-playing-title"></div>
        `;
        speakerGrille.appendChild(nowPlaying);
    }
}
function createPlaylist(name) {
    const playlist = {
        id: Date.now().toString(),
        name: name.trim(),
        tracks: [],
        createdAt: new Date().toISOString()
    };
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
    
    const trackId = track.src_audio || track.Title + track.Artist;
    const exists = playlist.tracks.some(t => (t.src_audio || t.Title + t.Artist) === trackId);
    if (!exists) {
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
    const trackId = track.src_audio || track.Title + track.Artist;
    return playlist.tracks.some(t => (t.src_audio || t.Title + t.Artist) === trackId);
}

function closePlaylistPopover() {
    const existing = document.querySelector('.playlist-popover');
    if (existing) existing.remove();
}

function showPlaylistPopover(track, buttonEl) {
    closePlaylistPopover();
    
    const popover = document.createElement('div');
    popover.className = 'playlist-popover';
    
    let html = '<div class="playlist-popover-header">Add to Playlist</div>';
    html += '<div class="playlist-popover-list">';
    
    if (APP.userPlaylists.length === 0) {
        html += '<div class="playlist-popover-empty">No playlists yet</div>';
    } else {
        APP.userPlaylists.forEach(pl => {
            const isInPlaylist = isTrackInPlaylist(pl.id, track);
            html += `<label class="playlist-popover-item ${isInPlaylist ? 'in-playlist' : ''}" data-playlist-id="${pl.id}">
                <input type="checkbox" ${isInPlaylist ? 'checked' : ''}>
                <span class="playlist-name">${pl.name}</span>
                <span class="track-count">${pl.tracks.length}</span>
            </label>`;
        });
    }
    
    html += '</div>';
    popover.innerHTML = html;
    
    document.body.appendChild(popover);
    
    const rect = buttonEl.getBoundingClientRect();
    const popoverRect = popover.getBoundingClientRect();
    
    let left = rect.left - popoverRect.width - 10;
    let top = rect.top + (rect.height / 2) - (popoverRect.height / 2);
    
    if (left < 10) {
        left = rect.right + 10;
    }
    if (top < 10) top = 10;
    if (top + popoverRect.height > window.innerHeight - 10) {
        top = window.innerHeight - popoverRect.height - 10;
    }
    
    popover.style.left = left + 'px';
    popover.style.top = top + 'px';
    
    popover.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            const item = e.target.closest('.playlist-popover-item');
            const playlistId = item.dataset.playlistId;
            
            if (e.target.checked) {
                addTrackToPlaylist(playlistId, track);
                item.classList.add('in-playlist');
                item.querySelector('.track-count').textContent = 
                    APP.userPlaylists.find(p => p.id === playlistId).tracks.length;
            } else {
                const playlist = APP.userPlaylists.find(p => p.id === playlistId);
                const trackId = track.src_audio || track.Title + track.Artist;
                const idx = playlist.tracks.findIndex(t => (t.src_audio || t.Title + t.Artist) === trackId);
                if (idx !== -1) {
                    removeTrackFromPlaylist(playlistId, idx);
                }
                item.classList.remove('in-playlist');
                item.querySelector('.track-count').textContent = playlist.tracks.length;
            }
        });
    });
    
    setTimeout(() => {
        const closeHandler = (e) => {
            if (!popover.contains(e.target) && e.target !== buttonEl && !e.target.classList.contains('add-to-playlist-btn')) {
                e.preventDefault();
                e.stopPropagation();
                closePlaylistPopover();
                document.removeEventListener('click', closeHandler, true);
                document.removeEventListener('touchstart', closeHandler, true);
            }
        };
        document.addEventListener('click', closeHandler, true);
        document.addEventListener('touchstart', closeHandler, true);
    }, 10);
}

// Service Worker & Offline Functions
function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js')
            .then((registration) => {
                console.log('[App] Service Worker registered:', registration.scope);
                APP.swReady = true;
                
                if (navigator.serviceWorker.controller) {
                    navigator.serviceWorker.controller.postMessage({ type: 'GET_CACHED_URLS' });
                }
                
                registration.update();
                setInterval(() => registration.update(), 60000);
                
                if (registration.waiting) {
                    registration.waiting.postMessage({ type: 'SKIP_WAITING' });
                }
                
                registration.addEventListener('updatefound', () => {
                    const newWorker = registration.installing;
                    newWorker.addEventListener('statechange', () => {
                        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            newWorker.postMessage({ type: 'SKIP_WAITING' });
                        }
                    });
                });
            })
            .catch((error) => {
                console.warn('[App] Service Worker registration failed:', error);
            });
        
        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (!refreshing) {
                refreshing = true;
                window.location.reload();
            }
        });
        
        navigator.serviceWorker.addEventListener('message', (event) => {
            if (event.data.type === 'CACHED_URLS_LIST') {
                APP.cachedUrls = new Set(event.data.urls);
                updateOfflineIndicators();
            }
            if (event.data.type === 'AUDIO_CACHED') {
                APP.cachedUrls.add(event.data.url);
                updateOfflineIndicators();
                updateDownloadProgress();
            }
            if (event.data.type === 'AUDIO_UNCACHED') {
                APP.cachedUrls.delete(event.data.url);
                updateOfflineIndicators();
            }
            if (event.data.type === 'AUDIO_CACHE_FAILED') {
                console.warn('[App] Failed to cache:', event.data.url);
                updateDownloadProgress();
            }
            if (event.data.type === 'AUDIO_CACHE_CLEARED') {
                APP.cachedUrls.clear();
                updateOfflineIndicators();
            }
        });
    }
}

function getTrackAudioUrl(track) {
    let srcAudio;
    const rawSrc = track.src_audio;
    
    if (track.sourceType === 'radio' || (track.ParentFolder && !track.sourceType)) {
        srcAudio = 'radio/' + cleanPath(rawSrc);
    } else if (track.sourceType === 'book1') {
        srcAudio = 'Book 1/' + cleanPath(rawSrc).replace(/^book\s?1\//i, '');
    } else if (track.sourceType === 'book2') {
        srcAudio = 'Book 2/' + cleanPath(rawSrc).replace(/^book\s?2\//i, '');
    } else if (rawSrc) {
        if (rawSrc.toLowerCase().includes('book 1') || rawSrc.toLowerCase().includes('book1')) {
            srcAudio = 'Book 1/' + cleanPath(rawSrc).replace(/^book\s?1\//i, '');
        } else if (rawSrc.toLowerCase().includes('book 2') || rawSrc.toLowerCase().includes('book2')) {
            srcAudio = 'Book 2/' + cleanPath(rawSrc).replace(/^book\s?2\//i, '');
        } else {
            srcAudio = cleanPath(rawSrc);
        }
    }
    return srcAudio ? getSecureUrl(srcAudio) : null;
}

function isTrackCached(track) {
    const url = getTrackAudioUrl(track);
    if (!url) return false;
    const absoluteUrl = new URL(url, window.location.origin).href;
    return APP.cachedUrls.has(url) || APP.cachedUrls.has(absoluteUrl);
}

function cacheTrack(track, callback) {
    if (!APP.swReady || !navigator.serviceWorker.controller) {
        if (callback) callback(false);
        return;
    }
    const url = getTrackAudioUrl(track);
    if (!url) {
        if (callback) callback(false);
        return;
    }
    const absoluteUrl = new URL(url, window.location.origin).href;
    navigator.serviceWorker.controller.postMessage({
        type: 'CACHE_AUDIO',
        urls: [absoluteUrl]
    });
    if (callback) callback(true);
}

function uncacheTrack(track, callback) {
    if (!APP.swReady || !navigator.serviceWorker.controller) {
        if (callback) callback(false);
        return;
    }
    const url = getTrackAudioUrl(track);
    if (!url) {
        if (callback) callback(false);
        return;
    }
    const absoluteUrl = new URL(url, window.location.origin).href;
    navigator.serviceWorker.controller.postMessage({
        type: 'UNCACHE_AUDIO',
        url: absoluteUrl
    });
    if (callback) callback(true);
}

function cachePlaylistTracks(playlistId) {
    const playlist = APP.userPlaylists.find(p => p.id === playlistId);
    if (!playlist || !APP.swReady) return;
    
    const urls = playlist.tracks
        .map(track => getTrackAudioUrl(track))
        .filter(url => url)
        .map(url => new URL(url, window.location.origin).href);
    
    if (urls.length === 0) return;
    
    APP.downloadProgress = { 
        total: urls.length, 
        completed: 0, 
        id: playlistId,
        type: 'playlist'
    };
    
    navigator.serviceWorker.controller.postMessage({
        type: 'CACHE_AUDIO',
        urls: urls
    });
    
    showDownloadProgress(playlist.name);
}

function cacheArtistTracks(artistName) {
    if (!APP.swReady || !APP.radioData) return;

    const tracks = APP.radioData.filter(t => t.ParentFolder === artistName);
    const urls = tracks
        .map(track => {
             // Mimic getTrackAudioUrl logic specifically for radio tracks to be safe
             // Since these come from APP.radioData, they are always Radio tracks
             const rawSrc = track.src_audio;
             const srcAudio = 'radio/' + cleanPath(rawSrc);
             return getSecureUrl(srcAudio);
        })
        .filter(url => url)
        .map(url => new URL(url, window.location.origin).href);

    if (urls.length === 0) return;

    APP.downloadProgress = {
        total: urls.length,
        completed: 0,
        id: artistName,
        type: 'artist',
        tracks: tracks // Store reference to tracks for checking cache status later
    };

    navigator.serviceWorker.controller.postMessage({
        type: 'CACHE_AUDIO',
        urls: urls
    });

    showDownloadProgress("Artist: " + artistName.replace(/^\d+\s-\s/, ''));
}

function updateDownloadProgress() {
    if (!APP.downloadProgress) return;
    
    let cachedCount = 0;
    
    if (APP.downloadProgress.type === 'artist') {
        const tracks = APP.downloadProgress.tracks;
        if (tracks) {
            tracks.forEach(track => {
                // We need to construct the check similarly to getTrackAudioUrl
                // But for radio items in radioData, we know the structure
                const rawSrc = track.src_audio;
                const srcAudio = 'radio/' + cleanPath(rawSrc);
                const url = getSecureUrl(srcAudio);
                if (url) {
                    const absUrl = new URL(url, window.location.origin).href;
                    if(APP.cachedUrls.has(url) || APP.cachedUrls.has(absUrl)) cachedCount++;
                }
            });
        }
    } else {
        // Playlist
        const playlist = APP.userPlaylists.find(p => p.id === APP.downloadProgress.id);
        if (playlist) {
            playlist.tracks.forEach(track => {
                if (isTrackCached(track)) cachedCount++;
            });
        }
    }
    
    APP.downloadProgress.completed = cachedCount;
    
    const progressEl = document.querySelector('.download-progress-bar-fill');
    const textEl = document.querySelector('.download-progress-text');
    
    if (progressEl && textEl) {
        const percent = (cachedCount / APP.downloadProgress.total) * 100;
        progressEl.style.width = percent + '%';
        textEl.textContent = `Downloading: ${cachedCount} / ${APP.downloadProgress.total}`;
        
        if (cachedCount >= APP.downloadProgress.total) {
            setTimeout(hideDownloadProgress, 1500);
        }
    }
}

function showDownloadProgress(playlistName) {
    hideDownloadProgress();
    const progressDiv = document.createElement('div');
    progressDiv.className = 'download-progress-overlay';
    progressDiv.innerHTML = `
        <div class="download-progress-content">
            <div class="download-progress-title">Downloading "${playlistName}"</div>
            <div class="download-progress-bar">
                <div class="download-progress-bar-fill"></div>
            </div>
            <div class="download-progress-text">Downloading: 0 / ${APP.downloadProgress.total}</div>
            <button class="download-progress-close">Close</button>
        </div>
    `;
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
                if (isTrackCached(track)) el.classList.add('cached');
                else el.classList.remove('cached');
            } catch (e) {}
        }
    });
    document.querySelectorAll('.download-track-btn').forEach(btn => {
        const trackData = btn.dataset.track;
        if (trackData) {
            try {
                const track = JSON.parse(trackData);
                if (isTrackCached(track)) {
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
    // Update artist buttons if possible, but that's complex since it's partial status
}

function createStaticNoise() {
    if (APP.staticNode) {
        try { APP.staticNode.stop(); } catch(e){}
        APP.staticNode.disconnect();
    }
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

function buildDial() {
    const container = $('main-dial-container');
    const isRadio = (APP.currentBand === 'radio');

    if (Draggable.get("#dial-track")) Draggable.get("#dial-track").kill();
    if (Draggable.get("#fm-track")) Draggable.get("#fm-track").kill();
    if (Draggable.get("#am-proxy")) Draggable.get("#am-proxy").kill();

    const indicatorClass = APP.hasInteracted ? 'scroll-indicator hidden' : 'scroll-indicator';

    if (isRadio) {
        container.classList.add('dual-mode');
        
        const itemWidth = APP.sectionWidth || 150;
        const screenWidth = container.offsetWidth || window.innerWidth;
        const neededPool = Math.ceil(screenWidth / itemWidth) * 3;
        APP.virtualState.poolSize = Math.max(24, neededPool);

        const totalWidth = APP.radioPlaylist.length * itemWidth;

        let poolHTML = '';
        for(let i=0; i<APP.virtualState.poolSize; i++) {
            poolHTML += `<div class="station virtual-item" data-pool-index="${i}" style="will-change: transform, opacity;">
                            <div class="title"></div>
                         </div>`;
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

        $('guide-controls').classList.add('visible');
        const excerpt = $('excerpt-display');
        if(excerpt) { excerpt.innerHTML = ''; excerpt.style.display = 'none'; }
        
        // Show the radio now playing display
        const radioNowPlaying = $('radio-now-playing');
        if (radioNowPlaying) radioNowPlaying.classList.add('visible');
        
        APP.virtualState.pool = Array.from(document.querySelectorAll('.virtual-item'));

        setTimeout(() => {
            const ref = qs('#fm-track .station');
            if (ref && ref.offsetWidth > 0) APP.sectionWidth = ref.offsetWidth;
            const amProxy = $('am-proxy');
            if (amProxy) amProxy.style.width = (APP.radioPlaylist.length * APP.sectionWidth) + "px";
            
            setupDualDraggables();
            renderVirtualDial(APP.currentIndex * -APP.sectionWidth);
        }, 50);

    } else {
        container.classList.remove('dual-mode');
        $('guide-controls').classList.remove('visible');
        
        const excerpt = $('excerpt-display');
        if(excerpt) excerpt.style.display = '';
        
        // Hide the radio now playing display
        const radioNowPlaying = $('radio-now-playing');
        if (radioNowPlaying) radioNowPlaying.classList.remove('visible');
        
        container.innerHTML = `
            <div class="${indicatorClass} left" id="scroll-left">&#x300A;</div>
            <div class="${indicatorClass} right" id="scroll-right">&#x27EB;</div>
            <div class="needle"></div>
            <div class="dial-track" id="dial-track"></div>
        `;

        // Get the list. If it's a user playlist, we pull from APP.playlist with the custom ID
        const playlist = getCurrentTrackList();
        
        $('dial-track').innerHTML = playlist && playlist.length ? playlist.map((item, index) => `
            <div class="station" data-index="${index}">
                <div class="artist">${item.artist || item.Artist}</div>
                <div class="title">${item.title || item.Title}</div>
            </div>
        `).join('') : '<div class="station" style="width:100%"><div class="title">No Signal</div></div>';
        
        setTimeout(() => {
            const firstStation = qs('#dial-track .station');
            if (firstStation && firstStation.offsetWidth > 0) APP.sectionWidth = firstStation.offsetWidth;
            setupSingleDraggable();
        }, 50);
    }
    updateArrowButtons();
}

function updateActiveStations(track) {
    if (!track) return;
    const stations = track.querySelectorAll('.station');
    const container = track.parentElement;
    const halfScreen = container.offsetWidth / 2;
    const centerOffset = halfScreen;
    const currentX = gsap.getProperty(track, 'x');
    
    const activeZone = halfScreen + APP.sectionWidth; 
    const maxRotation = 50; 
    const maxDepth = 150; 

    stations.forEach((station, index) => {
        const stationX = currentX + (index * APP.sectionWidth) + APP.sectionWidth / 2;
        const dist = Math.abs(stationX - centerOffset);
        
        if (dist > activeZone) {
            station.style.opacity = 0;
            return; 
        }

        const rawRotation = (stationX - centerOffset) / halfScreen * maxRotation;
        const rotation = Math.max(-60, Math.min(60, rawRotation));
        const normalizedDistance = dist / activeZone; 
        const scale = 1.0 - (Math.pow(normalizedDistance, 2) * 0.35);
        
        let opacity = Math.cos(normalizedDistance * (Math.PI / 2)) * 1.2;
        opacity = Math.max(0, Math.min(1, opacity));

        station.style.transform = `
            translateZ(${-200}px) 
            rotateY(${rotation}deg) 
            translateZ(${200 - (normalizedDistance * maxDepth)}px) 
            scale(${scale})
        `;
        station.style.opacity = opacity;
        
        dist < APP.sectionWidth / 2 ? station.classList.add('active') : station.classList.remove('active');
    });
}

function renderVirtualDial(currentX) {
    if (!APP.radioPlaylist.length) return;
    const container = $('main-dial-container');
    if (!container || container.offsetWidth === 0) return; 

    const centerOffset = container.offsetWidth / 2;
    const itemWidth = APP.sectionWidth || 150;
    const activeZone = (container.offsetWidth / 2) + itemWidth; 

    const virtualCenter = -currentX;
    const centerIndex = Math.round(virtualCenter / itemWidth);
    const halfPool = Math.floor(APP.virtualState.poolSize / 2);
    const renderStart = centerIndex - halfPool;
    
    APP.virtualState.pool.forEach((el, i) => {
        const dataIndex = renderStart + i;
        
        if (dataIndex < 0 || dataIndex >= APP.radioPlaylist.length) {
            el.style.opacity = 0; 
            return;
        }

        const xPos = currentX + (dataIndex * itemWidth) + centerOffset - (itemWidth/2);
        
        const prevIndex = el.dataset.renderedIndex;
        if (prevIndex != dataIndex) {
            const track = APP.radioPlaylist[dataIndex];
            
            const artistEl = el.querySelector('.artist');
            if (artistEl) artistEl.textContent = track.artist || track.Artist || '';
            
            const titleEl = el.querySelector('.title');
            if (titleEl) titleEl.textContent = track.title || track.Title; 
            
            el.dataset.renderedIndex = dataIndex;
            
            const genre = track.genre || track.Genre; 
            el.style.color = (genre === 'News' || genre === 'Sports') ? '#ff6b35' : '';
        }

        const dist = Math.abs(xPos - centerOffset + (itemWidth/2)); 
        
        if (dist > activeZone) {
            el.style.opacity = 0;
            return;
        }

        const normalizedDist = dist / activeZone;
        const rawRotation = (xPos - centerOffset + itemWidth/2) / (container.offsetWidth/2) * 50;
        const rotation = Math.max(-60, Math.min(60, rawRotation));
        const scale = 1.0 - (Math.pow(normalizedDist, 2) * 0.3); 
        
        let opacity = Math.cos(normalizedDist * (Math.PI / 2)) * 1.2;
        opacity = Math.max(0, Math.min(1, opacity));

        dist < itemWidth / 2 ? el.classList.add('active') : el.classList.remove('active');
        
        el.style.transform = `
            translate3d(${xPos}px, 0, -200px) 
            rotateY(${rotation}deg)
            translateZ(${200 - (normalizedDist * 100)}px) 
            scale(${scale})
        `;
        el.style.opacity = opacity;
    });
}

function preloadNextTrack(currentIndex) {
    // Disabled logic preserved
    return;
}

function setupSingleDraggable() {
    const track = $('dial-track');
    if(!track) return;
    const container = track.parentElement;
    const list = getCurrentTrackList();
    
    setupGenericDraggable(track, container, list, (idx) => {
         APP.currentIndex = idx;
         loadTrack(idx, false);
    }, (idx) => {
         APP.currentIndex = idx;
         loadTrack(idx, true);
    });
    
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
        APP.musicGain.gain.value = (1 - distanceToSnap) * APP.volume;
        setStaticGain(APP.isPlaying ? (distanceToSnap * 0.3 * APP.volume) : 0);

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
        (idx) => { 
            const artist = APP.radioArtists[idx];
            if (artist) {
                if (APP.radioState.lastArtistIndex !== idx) {
                    APP.radioState.lastArtistIndex = idx;
                    APP.currentIndex = artist.firstSongIndex;
                    snapVirtualTo(APP.currentIndex, true);
                }
            }
        }, 
        (idx) => { 
            const artist = APP.radioArtists[idx];
            if (artist) {
                APP.currentIndex = artist.firstSongIndex;
                snapVirtualTo(APP.currentIndex, false, () => {
                    loadTrack(APP.currentIndex, false); 
                });
            }
        }
    );

    let lastX = 0;
    let lastTime = 0;
    let velocity = 0;
    let trackerId = null;
    const momentumFactor = 300;

    Draggable.create(amProxy, {
        type: 'x', 
        trigger: amProxy.parentElement,
        bounds: { minX: minX, maxX: maxX },
        inertia: false, 
        edgeResistance: 0.7,
        onPress: function() {
            hideOnboardingHints();
            gsap.killTweensOf(amProxy);
            APP.isTransitioning = false;
            APP.isDragging = true;
            lastX = this.x;
            lastTime = Date.now();
            velocity = 0;
            const trackVelocity = () => {
                const now = Date.now();
                const dt = now - lastTime;
                if (dt > 0) {
                    const dx = this.x - lastX;
                    velocity = (dx / dt) * 0.6 + velocity * 0.4;
                    lastX = this.x;
                    lastTime = now;
                }
                if (this.isPressed) trackerId = requestAnimationFrame(trackVelocity);
            };
            trackVelocity();
        },
        onDrag: function() { handleVirtualDrag(this.x); },
        onDragEnd: function() { 
            cancelAnimationFrame(trackerId);
            APP.isDragging = false;
            const throwDist = (Math.abs(velocity) > 0.2) ? (velocity * momentumFactor) : 0;
            let finalIndex = Math.round(-(this.x + throwDist) / APP.sectionWidth);
            finalIndex = Math.max(0, Math.min(finalIndex, totalItems - 1));
            APP.currentIndex = finalIndex;
            snapVirtualTo(finalIndex, false, () => loadTrack(finalIndex, false));
        }
    });

    const currentSong = APP.radioPlaylist[APP.currentIndex];
    let artistIdx = 0;
    if (currentSong) {
        artistIdx = APP.radioArtists.findIndex(a => a.folder === currentSong.ParentFolder);
    }
    if (artistIdx !== -1) APP.radioState.lastArtistIndex = artistIdx;

    snapVirtualTo(APP.currentIndex, true);
    snapToPosition(fmTrack, fmTrack.parentElement, artistIdx !== -1 ? artistIdx : 0, true);
    updateActiveStations(fmTrack);
}

function setupGenericDraggable(track, container, dataList, onDragCallback, onEndCallback) {
    if (!dataList || dataList.length === 0) return;
    
    const totalWidth = dataList.length * APP.sectionWidth;
    const centerOffset = container.offsetWidth / 2;
    const minX = centerOffset - totalWidth + APP.sectionWidth / 2;
    const maxX = centerOffset - APP.sectionWidth / 2;
    
    let lastX = 0;
    let lastTime = 0;
    let velocity = 0;
    let trackerId = null;
    const momentumFactor = 300;

    Draggable.create(track, {
        type: 'x', 
        trigger: container, 
        bounds: { minX: minX, maxX: maxX },
        edgeResistance: 0.7,
        inertia: false,
        onPress: function() {
            hideOnboardingHints();
            gsap.killTweensOf(track);
            APP.isTransitioning = false;
            APP.isDragging = true;
            lastX = this.x;
            lastTime = Date.now();
            velocity = 0;
            const trackVelocity = () => {
                const now = Date.now();
                const dt = now - lastTime;
                if (dt > 0) {
                    const dx = this.x - lastX;
                    velocity = (dx / dt) * 0.6 + velocity * 0.4;
                    lastX = this.x;
                    lastTime = now;
                }
                if (this.isPressed) trackerId = requestAnimationFrame(trackVelocity);
            };
            trackVelocity();
        },
        onDrag: function() {
            APP.isDragging = true;
            updateActiveStations(track);
            const rawDestination = this.x;
            const offset = centerOffset - rawDestination - APP.sectionWidth / 2;
            let currentIndex = Math.round(offset / APP.sectionWidth);
            currentIndex = Math.max(0, Math.min(currentIndex, dataList.length - 1));
            if (onDragCallback) onDragCallback(currentIndex);
        },
        onDragEnd: function() {
            cancelAnimationFrame(trackerId);
            APP.isDragging = false;
            const throwDist = (Math.abs(velocity) > 0.2) ? (velocity * momentumFactor) : 0;
            const rawDestination = this.x + throwDist;
            const offset = centerOffset - rawDestination - APP.sectionWidth / 2;
            let finalIndex = Math.round(offset / APP.sectionWidth);
            finalIndex = Math.max(0, Math.min(finalIndex, dataList.length - 1));
            
            snapToPosition(track, container, finalIndex, false, () => {
                if (onEndCallback) onEndCallback(finalIndex);
            }, false);
        }
    });
}

function snapToPosition(track, container, index, immediate = false, onComplete = null, forceTransition = false) {
    const centerOffset = container.offsetWidth / 2;
    const targetX = centerOffset - (index * APP.sectionWidth) - APP.sectionWidth / 2;
    
    const duration = forceTransition ? 2.0 : 0.5;
    const ease = forceTransition ? 'power4.out' : 'power2.out';
    let hasSwapped = false;

    if (forceTransition) APP.isTransitioning = true;
    
    if (immediate) {
        gsap.set(track, { x: targetX });
        if (onComplete) onComplete();
        APP.isTransitioning = false;
    } else {
        gsap.to(track, {
            x: targetX, duration: duration, ease: ease,
            onUpdate: function() {
                if (track.id.includes('am-track') || track.id === 'dial-track') { 
                    if (forceTransition) {
                        if (!hasSwapped) {
                            hasSwapped = true;
                            APP.currentIndex = index;
                            loadTrack(index, true, true); 
                        }
                        const p = this.progress(); 
                        const staticMax = 0.6 * APP.volume;
                        const intensity = Math.sin(p * Math.PI); 
                        APP.musicGain.gain.value = APP.volume * (1 - (intensity * 0.5));
                        setStaticGain(intensity * staticMax);
                    } else if (!APP.isDragging) {
                        const dist = Math.abs(gsap.getProperty(track, 'x') - targetX);
                        const normDist = Math.min(dist / (APP.sectionWidth / 2), 1);
                        APP.musicGain.gain.value = (1 - normDist) * APP.volume;
                        setStaticGain(APP.isPlaying ? (normDist * 0.6 * APP.volume) : 0);
                    }
                }
                updateActiveStations(track);
            },
            onComplete: () => {
                if (track.id.includes('am-track') || track.id === 'dial-track') {
                    setStaticGain(0);
                    APP.musicGain.gain.value = APP.isPlaying ? APP.volume : 0;
                    APP.isTransitioning = false;
                }
                if (onComplete) onComplete();
            }
        });
    }
}

function snapVirtualTo(index, immediate = false, onComplete = null, forceTransition = false) {
    const amProxy = $('am-proxy');
    const targetX = -(index * APP.sectionWidth);
    
    const duration = forceTransition ? 2.0 : 0.5; 
    const ease = forceTransition ? 'power4.out' : 'power2.out';

    if (immediate) {
        gsap.set(amProxy, { x: targetX });
        renderVirtualDial(targetX);
        if(onComplete) onComplete();
        APP.isTransitioning = false;
    } else {
        let hasSwapped = false;
        gsap.to(amProxy, {
            x: targetX, 
            duration: duration, 
            ease: ease,
            overwrite: true,
            onUpdate: function() {
                const currentX = gsap.getProperty(amProxy, 'x');
                if (forceTransition) {
                    if (!hasSwapped) {
                        hasSwapped = true;
                        APP.currentIndex = index;
                        loadTrack(index, true, true); 
                    }
                    const p = this.progress(); 
                    const staticMax = 0.6 * APP.volume;
                    const intensity = Math.sin(p * Math.PI); 
                    APP.musicGain.gain.value = APP.volume * (1 - (intensity * 0.5));
                    setStaticGain(intensity * staticMax);
                } else {
                    const dist = Math.abs(currentX - targetX);
                    const normDist = Math.min(dist / (APP.sectionWidth / 2), 1);
                    APP.musicGain.gain.value = (1 - normDist) * APP.volume;
                    setStaticGain(APP.isPlaying ? (normDist * 0.6 * APP.volume) : 0);
                }
                renderVirtualDial(currentX);
            },
            onComplete: () => {
                if (!forceTransition) {
                    setStaticGain(0);
                    APP.musicGain.gain.value = APP.isPlaying ? APP.volume : 0;
                    APP.isTransitioning = false;
                }
                if (onComplete) onComplete();
            }
        });
    }
}

function loadTrack(index, updateLayout = true, skipGainReset = false) {
    if (APP.loadTimer) clearTimeout(APP.loadTimer);
    APP.pendingIndex = index;

    let track, srcAudio, srcVideo, isVideo;
    const list = getCurrentTrackList();
    
    if (!list || !list[index]) return;

    track = list[index];
    
    console.log('[loadTrack] Playing:', track.Title || track.title);

    // Update Media Session Metadata
    updateMediaSessionMetadata(track);
    
    // Update Radio Now Playing Display
    updateRadioNowPlaying(track);
    
    // Update Now Playing indicator in program guide if open
    updateProgramGuideNowPlaying(index);

    if (APP.currentBand === 'radio') {
        srcAudio = 'radio/' + cleanPath(track.src_audio);
        srcVideo = null; isVideo = false;
    } else {
        // Book 1, Book 2, or Custom Playlist
        const folderName = (APP.currentBand === 'book1') ? 'Book 1' : 
                           (APP.currentBand === 'book2') ? 'Book 2' : '';
        
        let rawSrc = track.src_audio;
        // Fix pathing if it's from a playlist but needs Book folder context
        if (track.sourceType === 'book1') rawSrc = 'Book 1/' + cleanPath(rawSrc).replace(/^book\s?1\//i,'');
        else if (track.sourceType === 'book2') rawSrc = 'Book 2/' + cleanPath(rawSrc).replace(/^book\s?2\//i,'');
        else if (track.src_audio && !folderName) rawSrc = cleanPath(track.src_audio);
        else rawSrc = folderName ? folderName + '/' + track.src_audio.replace(/^book\s?[12]\//i,'') : track.src_audio;

        srcAudio = cleanPath(rawSrc);
        srcVideo = track.src_video ? cleanPath(track.src_video) : null;
        isVideo = (srcVideo && /\.(mp4|mkv|webm)$/i.test(srcVideo));
    }
    
    if (srcAudio === APP.currentTrackSrc && !isVideo) {
        if (updateLayout) updateInterfaceLayout(false);
        return;
    }
    
    APP.currentTrackSrc = srcAudio;
    const excerptDisplay = $('excerpt-display');
    
    if (APP.currentBand !== 'radio' && excerptDisplay && track.excerpt) {
        excerptDisplay.innerHTML = `<span class="page-ref">Page ${track.page}</span><p>${track.excerpt}</p>`;
        excerptDisplay.scrollTop = 0;
        if(!isVideo) excerptDisplay.classList.remove('fade-out');
    }
    if (updateLayout) updateInterfaceLayout(isVideo);

    const videoPlayer = $('video-player');

    if (isVideo) {
        if (APP.currentHowl) { APP.currentHowl.stop(); APP.currentHowl.unload(); }
        videoPlayer.src = getSecureUrl(srcVideo);
        videoPlayer.load();
        videoPlayer.muted = false;
        videoPlayer.volume = APP.volume;
        if (APP.isPlaying) {
             videoPlayer.play().catch(()=>{});
             updatePlaybackState(); // Update MediaSession
        }
        return;
    } else if (videoPlayer) {
        videoPlayer.pause();
        videoPlayer.removeAttribute('src');
        videoPlayer.load();
    }

    let newHowl;
    const targetUrl = getSecureUrl(srcAudio);
    
    if (APP.nextTrackHowl) {
        APP.nextTrackHowl.unload();
        APP.nextTrackHowl = null;
        APP.nextTrackSrc = null;
    }
    
    newHowl = new Howl({
        src: [targetUrl],
        format: ['mp3'], html5: true,
        onend: handleAutoplay,
        onplay: () => { 
            APP.isPlaying = true; 
            updatePlaybackState(); 
            startPositionUpdater(); // START UPDATING POSITION
        },
        onpause: () => { APP.isPlaying = false; updatePlaybackState(); },
        onstop: () => { APP.isPlaying = false; updatePlaybackState(); },
        onload: function() {
            if (APP.currentHowl !== this) { this.unload(); return; }
            // Audio metadata is now loaded - update position state with valid duration
            if (APP.isPlaying) {
                updatePositionState();
            }
        }
    });

    if (APP.currentHowl) {
        // If backgrounded, skip the fade transition - just stop and play new track
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
        APP.currentHowl.play();
        // Skip fade-in if backgrounded
        if (!shouldUseSimpleTransitions()) {
            APP.currentHowl.fade(0, APP.volume, 500);
        }
        updatePlaybackState(); // Update MediaSession
    }

    if (APP.currentHowl._sounds.length > 0 && APP.currentHowl._sounds[0]._node && APP.audioContext) {
        try {
            const source = APP.audioContext.createMediaElementSource(APP.currentHowl._sounds[0]._node);
            source.connect(APP.musicGain);
        } catch(e) { /* already connected */ }
    }

    preloadNextTrack(index);
    APP.recentBandSwitch = false;
}

// Update the radio now playing display in the speaker grille
function updateRadioNowPlaying(track) {
    const display = $('radio-now-playing');
    if (!display) return;
    
    if (APP.currentBand === 'radio' && track) {
        const artist = track.artist || track.Artist || 'Unknown Artist';
        const title = track.title || track.Title || 'Unknown Track';
        
        display.querySelector('.now-playing-artist').textContent = artist;
        display.querySelector('.now-playing-title').textContent = title;
        display.classList.add('visible');
    } else {
        display.classList.remove('visible');
    }
}

// Update the now playing indicator in the program guide
function updateProgramGuideNowPlaying(currentIndex) {
    const content = $('program-guide-content');
    if (!content) return;
    
    // Remove old active-track classes and now-playing indicators
    content.querySelectorAll('.program-item.active-track').forEach(item => {
        item.classList.remove('active-track');
        const indicator = item.querySelector('.now-playing-indicator');
        if (indicator) indicator.remove();
    });
    
    // Add new active-track class
    const items = content.querySelectorAll('.program-item[data-index]');
    items.forEach(item => {
        const idx = parseInt(item.dataset.index);
        if (idx === currentIndex) {
            item.classList.add('active-track');
            // Add now playing indicator if not already there
            const actions = item.querySelector('.program-item-actions');
            if (actions && !actions.querySelector('.now-playing-indicator')) {
                const indicator = document.createElement('div');
                indicator.className = 'now-playing-indicator';
                indicator.textContent = '▶ Playing';
                actions.insertBefore(indicator, actions.firstChild);
            }
        }
    });
}

function handleAutoplay() {
    const nextIndex = APP.currentIndex + 1;
    const list = getCurrentTrackList();
    const max = list.length;
    
    // If phone is backgrounded/locked, use simple direct playback
    if (shouldUseSimpleTransitions()) {
        console.log('[Autoplay] Using simple transition (backgrounded)');
        if (nextIndex < max) {
            APP.currentIndex = nextIndex;
            loadTrack(nextIndex, false, true); // Simple load, no layout update
        } else if (max > 0) {
            APP.currentIndex = 0;
            loadTrack(0, false, true);
        }
    } else {
        // Normal animated transition
        if (nextIndex < max) tuneToStation(nextIndex);
        else if (max > 0) tuneToStation(0); // Loop back
    }
}

function tuneToStation(index) {
    console.log('[tuneToStation] index:', index, 'currentBand:', APP.currentBand);
    
    if (APP.bandSwitchTimer) {
        clearTimeout(APP.bandSwitchTimer);
        APP.bandSwitchTimer = null;
    }
    
    if (APP.currentBand === 'radio') {
        const fmTrack = $('fm-track');
        const song = APP.radioPlaylist[index];
        let artistIdx = 0;
        if (song) artistIdx = APP.radioArtists.findIndex(a => a.folder === song.ParentFolder);
        snapVirtualTo(index, false, null, true);
        if (artistIdx !== -1) snapToPosition(fmTrack, fmTrack.parentElement, artistIdx, false, null, true);
    } else {
        const track = $('dial-track');
        if (track) snapToPosition(track, track.parentElement, index, false, null, true);
        else loadTrack(index, true, true); // Fallback if dial not rendered yet
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
        const referenceStation = qs('.station');
        if(referenceStation && referenceStation.offsetWidth > 0) {
            APP.sectionWidth = referenceStation.offsetWidth;
        }

        if(APP.currentBand === 'radio') {
            setupDualDraggables();
            snapVirtualTo(APP.currentIndex, true);
            
            const fmTrack = $('fm-track');
            const song = APP.radioPlaylist[APP.currentIndex];
            if(song && fmTrack) {
                const artistIdx = APP.radioArtists.findIndex(a => a.folder === song.ParentFolder);
                if(artistIdx !== -1) {
                    snapToPosition(fmTrack, fmTrack.parentElement, artistIdx, true);
                }
            }
        } else {
            setupSingleDraggable();
            const track = $('dial-track');
            if(track) {
                snapToPosition(track, track.parentElement, APP.currentIndex, true);
            }
        }
    }, 850);
}

function updateArrowButtons() {
    const left = $('left-arrow'), right = $('right-arrow');
    const list = getCurrentTrackList();
    const max = list.length;
    
    // Use opacity for disabled state, keep color consistent
    if (APP.currentIndex === 0) {
        left.style.opacity = '0.3';
        left.style.pointerEvents = 'none';
    } else {
        left.style.opacity = '1';
        left.style.pointerEvents = 'auto';
    }
    
    if (APP.currentIndex === max - 1) {
        right.style.opacity = '0.3';
        right.style.pointerEvents = 'none';
    } else {
        right.style.opacity = '1';
        right.style.pointerEvents = 'auto';
    }
    
    // Ensure consistent gold color for both arrows
    left.style.color = 'var(--brass-gold)';
    right.style.color = 'var(--brass-gold)';
}

function setupControls() {
    const volSlider = $('volume-slider');
    const volGroup = qs('.volume-control-group');
    const showVolumeSlider = () => { volGroup.classList.add('show-slider'); clearTimeout(APP.volumeSliderTimeout); };
    const hideVolumeSlider = () => { clearTimeout(APP.volumeSliderTimeout); APP.volumeSliderTimeout = setTimeout(() => { volGroup.classList.remove('show-slider'); }, 1500); };
    const hideVolumeSliderNow = () => { clearTimeout(APP.volumeSliderTimeout); volGroup.classList.remove('show-slider'); };

    volSlider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        APP.volume = val;
        if(APP.gainNode) APP.gainNode.gain.value = APP.volume;
        const vid = $('video-player');
        if(vid) vid.volume = val;

        if (val === 0 && APP.isPlaying) {
            APP.isPlaying = false;
            updatePlaybackState();
            if(APP.currentHowl) APP.currentHowl.pause();
            if(vid) vid.pause();
        } else if (val > 0 && !APP.isPlaying) {
            APP.isPlaying = true;
            updatePlaybackState();
            if(APP.audioContext.state === 'suspended') APP.audioContext.resume();
            if(APP.currentHowl) APP.currentHowl.play();
            if(vid) vid.play().catch(()=>{});
        }
        showVolumeSlider();
    });
    volSlider.addEventListener('change', hideVolumeSlider);
    volSlider.addEventListener('touchend', hideVolumeSlider);

    let touchStartY = 0;
    let startVolume = 0;

    volGroup.addEventListener('touchstart', (e) => {
        touchStartY = e.touches[0].clientY;
        startVolume = parseFloat(volSlider.value);
        showVolumeSlider();
        volGroup.classList.add('interacting');
    }, { passive: false });

    volGroup.addEventListener('touchmove', (e) => {
        if (!volGroup.classList.contains('interacting')) return;
        e.preventDefault();
        const currentY = e.touches[0].clientY;
        const deltaY = touchStartY - currentY;
        const sensitivity = 0.005; 
        let newVol = startVolume + (deltaY * sensitivity);
        newVol = Math.max(0, Math.min(1, newVol));

        APP.volume = newVol;
        volSlider.value = newVol;

        if(APP.gainNode) APP.gainNode.gain.value = newVol;
        const vid = $('video-player');
        if(vid) vid.volume = newVol;
        
        // Update state based on volume
        if (newVol === 0 && APP.isPlaying) {
            APP.isPlaying = false;
            updatePlaybackState();
        } else if (newVol > 0 && !APP.isPlaying) {
            APP.isPlaying = true;
            updatePlaybackState();
        }

    }, { passive: false });

    volGroup.addEventListener('touchend', (e) => {
        volGroup.classList.remove('interacting');
        hideVolumeSlider();
    });

    $('volume-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        if (volGroup.classList.contains('show-slider')) hideVolumeSlider();
        else { showVolumeSlider(); hideVolumeSlider(); }
    });

    volGroup.addEventListener('mouseenter', showVolumeSlider);
    volGroup.addEventListener('mouseleave', hideVolumeSlider);
    document.addEventListener('touchstart', (e) => { if (!volGroup.contains(e.target)) hideVolumeSliderNow(); }, { passive: true });

    qs('.piano-keys-group').addEventListener('click', (e) => {
        if (e.target.classList.contains('band-btn')) {
            const newBand = e.target.dataset.band;
            console.log('[Band Switch] Switching from', APP.currentBand, 'to', newBand);
            
            qsa('.band-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            APP.currentBand = newBand;
            APP.currentIndex = 0;
            APP.recentBandSwitch = true;
            
            if (APP.nextTrackHowl) {
                APP.nextTrackHowl.unload();
                APP.nextTrackHowl = null;
            }
            APP.nextTrackSrc = null;
            if (APP.bandSwitchTimer) clearTimeout(APP.bandSwitchTimer);
            
            buildDial();
            APP.bandSwitchTimer = setTimeout(() => {
                APP.bandSwitchTimer = null;
                loadTrack(0);
            }, 100);
        }
    });

    $('left-arrow').addEventListener('click', () => { 
        hideOnboardingHints();
        if (APP.bandSwitchTimer) { clearTimeout(APP.bandSwitchTimer); APP.bandSwitchTimer = null; }
        if(APP.currentIndex > 0) tuneToStation(APP.currentIndex - 1); 
    });
    $('right-arrow').addEventListener('click', () => { 
        hideOnboardingHints();
        if (APP.bandSwitchTimer) { clearTimeout(APP.bandSwitchTimer); APP.bandSwitchTimer = null; }
        const list = getCurrentTrackList();
        if(APP.currentIndex < list.length - 1) tuneToStation(APP.currentIndex + 1); 
    });

    $('guide-btn').addEventListener('click', openProgramGuide);
    $('close-guide').addEventListener('click', closeProgramGuide);
    $('modal-overlay').addEventListener('click', closeProgramGuide);

    qsa('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            qsa('.tab-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            APP.radioState.viewMode = e.target.dataset.view;
            openProgramGuide(); 
        });
    });

    $('shuffle-btn').addEventListener('click', (e) => {
        // Debounce rapid clicks
        if (APP.shuffleDebounce) return;
        APP.shuffleDebounce = true;
        setTimeout(() => { APP.shuffleDebounce = false; }, 500);
        
        // Stop any current transitions/loading
        if (APP.isTransitioning) {
            gsap.killTweensOf('#am-proxy');
            gsap.killTweensOf('#dial-track');
            gsap.killTweensOf('#fm-track');
            APP.isTransitioning = false;
        }
        
        // Clear any pending band switch
        if (APP.bandSwitchTimer) {
            clearTimeout(APP.bandSwitchTimer);
            APP.bandSwitchTimer = null;
        }
        
        APP.radioState.isShuffled = !APP.radioState.isShuffled;
        e.currentTarget.classList.toggle('active');
        processRadioData();
        
        if(APP.currentBand === 'radio') {
            APP.currentIndex = 0;
            APP.currentTrackSrc = null; // Reset so loadTrack doesn't skip
            buildDial();
            
            // Ensure we're playing and load fresh
            APP.isPlaying = true;
            loadTrack(0, true, false);
        }

        if (APP.radioState.viewMode === 'tracks') {
            renderTrackList();
        } else if (APP.radioState.viewMode === 'artists') {
            renderArtistList();
        }
    });
}

function openProgramGuide() {
    if (APP.currentBand === 'book1' || APP.currentBand === 'book2') {
        renderBookList();
    } else if (APP.currentBand.startsWith('playlist_')) {
        // Find which playlist we are in
        const pid = APP.currentBand.replace('playlist_', '');
        renderPlaylistTracks(pid);
        // Force tab to playlists
        qsa('.tab-btn').forEach(b => b.classList.remove('active'));
        qs('.tab-btn[data-view="playlists"]').classList.add('active');
    } else {
        // Radio logic
        if (APP.radioState.viewMode === 'artists') renderArtistList();
        else if (APP.radioState.viewMode === 'genres') renderGenreList();
        else if (APP.radioState.viewMode === 'playlists') renderPlaylistList();
        else renderTrackList();
    }
    $('modal-overlay').classList.add('active');
    $('program-guide').classList.add('active');
}

function renderBookList() {
    const content = $('program-guide-content');
    const list = APP.playlist[APP.currentBand] || [];
    const showDownload = !APP.isIOS; // Only show download on Android
    
    content.innerHTML = list.map((track, index) => {
        const trackWithSource = {...track, sourceType: APP.currentBand};
        const trackJson = JSON.stringify(trackWithSource).replace(/"/g, '&quot;');
        const isCurrentTrack = index === APP.currentIndex;
        return `
        <div class="program-item ${isCurrentTrack ? 'active-track' : ''}" data-index="${index}">
            <div class="program-item-main">
                <div class="artist">${track.artist}</div>
                <div class="title">${track.title}</div>
            </div>
            <div class="program-item-actions">
                ${isCurrentTrack ? '<div class="now-playing-indicator">▶ Playing</div>' : ''}
                ${showDownload ? `<button class="download-track-btn" data-track='${trackJson}' data-track-index="${index}">Download</button>` : ''}
                <button class="add-to-playlist-btn" data-track-index="${index}">+ Playlist</button>
            </div>
        </div>`;
    }).join('');

    content.querySelectorAll('.program-item-main').forEach(item => {
        item.addEventListener('click', () => {
            hideOnboardingHints();
            const programItem = item.closest('.program-item');
            tuneToStation(parseInt(programItem.dataset.index));
            closeProgramGuide();
        });
    });
    
    bindListButtonEvents(content, list);
    updateOfflineIndicators();
    setTimeout(() => {
        const activeItem = content.querySelector('.active-track');
        if (activeItem) activeItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
}

function renderTrackList() {
    const content = $('program-guide-content');
    const showDownload = !APP.isIOS; // Only show download on Android
    
    content.innerHTML = APP.radioPlaylist.map((track, index) => {
        const artist = track.artist || track.Artist;
        const title = track.title || track.Title;
        const trackWithSource = {...track, sourceType: 'radio'};
        const trackJson = JSON.stringify(trackWithSource).replace(/"/g, '&quot;');
        const isCurrentTrack = index === APP.currentIndex;
        return `
        <div class="program-item ${isCurrentTrack ? 'active-track' : ''}" data-index="${index}">
            <div class="program-item-main">
                <div class="artist">${artist}</div>
                <div class="title">${title}</div>
            </div>
            <div class="program-item-actions">
                ${isCurrentTrack ? '<div class="now-playing-indicator">▶ Playing</div>' : ''}
                ${showDownload ? `<button class="download-track-btn" data-track='${trackJson}' data-track-index="${index}">Download</button>` : ''}
                <button class="add-to-playlist-btn" data-track-index="${index}">+ Playlist</button>
            </div>
        </div>`;
    }).join('');

    content.querySelectorAll('.program-item-main').forEach(item => {
        item.addEventListener('click', () => {
            hideOnboardingHints(); 
            const programItem = item.closest('.program-item');
            tuneToStation(parseInt(programItem.dataset.index));
            closeProgramGuide();
        });
    });

    bindListButtonEvents(content, APP.radioPlaylist);
    updateOfflineIndicators();
    setTimeout(() => {
        const activeItem = content.querySelector('.active-track');
        if (activeItem) activeItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
}

function bindListButtonEvents(content, list) {
    content.querySelectorAll('.add-to-playlist-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const trackIndex = parseInt(btn.dataset.trackIndex);
            // Ensure we have correct source context
            const track = {...list[trackIndex]};
            if(!track.sourceType) track.sourceType = APP.currentBand;
            showPlaylistPopover(track, btn);
        });
    });

    content.querySelectorAll('.download-track-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const track = JSON.parse(btn.dataset.track.replace(/&quot;/g, '"'));
            if (isTrackCached(track)) {
                if (confirm('Remove this track from offline storage?')) {
                    uncacheTrack(track);
                    btn.classList.remove('downloaded');
                    btn.textContent = 'Download';
                }
            } else {
                // Check if service worker is ready
                if (!APP.swReady || !navigator.serviceWorker.controller) {
                    console.warn('[Download] Service worker not ready yet');
                    alert('Downloads will be available shortly. Please try again in a moment.');
                    return;
                }
                
                btn.classList.add('downloading');
                btn.textContent = 'Downloading...';
                cacheTrack(track, (success) => {
                    if (!success) {
                        btn.classList.remove('downloading');
                        btn.textContent = 'Download';
                        console.warn('[Download] Failed to initiate download');
                    }
                    // The 'downloaded' class will be added by updateOfflineIndicators when SW confirms
                });
            }
        });
    });
}

function renderArtistList() {
    const content = $('program-guide-content');
    const showDownload = !APP.isIOS; // Only show download on Android
    const artists = {};
    APP.radioData.forEach(t => {
        const pf = t.ParentFolder;
        if(!artists[pf]) artists[pf] = 0;
        artists[pf]++;
    });
    const sortedArtists = Object.keys(artists).sort();
    content.innerHTML = sortedArtists.map(artist => `
        <div class="filter-item ${APP.radioState.activeArtistFilter === artist ? 'active-filter' : ''}" data-artist="${artist}">
            <div class="artist-list-item-content">
                <div class="name">${artist.replace(/^\d+\s-\s/, '')}</div>
                <div class="artist-actions">
                    ${showDownload ? `<button class="download-artist-btn" data-artist-folder="${artist}">Download</button>` : ''}
                    <div class="count">${artists[artist]}</div>
                </div>
            </div>
        </div>
    `).join('');

    // Attach listeners
    content.querySelectorAll('.filter-item').forEach(item => {
        // Main item click (filtering)
        item.addEventListener('click', (e) => {
            if (e.target.classList.contains('download-artist-btn')) return;
            APP.radioState.activeArtistFilter = item.dataset.artist;
            APP.radioState.activeGenre = null; 
            APP.radioState.viewMode = 'tracks';
            qs('.tab-btn[data-view="tracks"]').click();
            processRadioData();
            APP.currentIndex = 0;
            buildDial();
            loadTrack(0);
            closeProgramGuide();
        });
    });

    // Download button listeners
    content.querySelectorAll('.download-artist-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const artistFolder = btn.dataset.artistFolder;
            cacheArtistTracks(artistFolder);
        });
    });
}

function renderGenreList() {
    const content = $('program-guide-content');
    const genres = {};
    APP.radioData.forEach(t => {
        const g = t.Genre || 'Unknown';
        if(!genres[g]) genres[g] = 0;
        genres[g]++;
    });
    const sortedGenres = Object.keys(genres).sort();
    let html = `<div class="filter-item ${!APP.radioState.activeGenre ? 'active-filter' : ''}" data-genre="ALL">
            <div class="name">ALL GENRES</div>
            <div class="count">${APP.radioData.length}</div>
        </div>`;
    html += sortedGenres.map(g => `
        <div class="filter-item ${APP.radioState.activeGenre === g ? 'active-filter' : ''}" data-genre="${g}">
            <div class="name">${g}</div>
            <div class="count">${genres[g]}</div>
        </div>
    `).join('');
    content.innerHTML = html;
    content.querySelectorAll('.filter-item').forEach(item => {
        item.addEventListener('click', () => {
            const g = item.dataset.genre;
            APP.radioState.activeGenre = (g === 'ALL') ? null : g;
            APP.radioState.activeArtistFilter = null; 
            APP.radioState.viewMode = 'tracks';
            qs('.tab-btn[data-view="tracks"]').click();
            processRadioData();
            APP.currentIndex = 0;
            buildDial();
            loadTrack(0);
            closeProgramGuide();
        });
    });
}

function renderPlaylistList() {
    const content = $('program-guide-content');
    const showDownload = !APP.isIOS; // Only show download on Android
    
    let html = `<div class="playlist-actions">
        <button class="create-playlist-btn" id="create-playlist-btn">+ New Playlist</button>
    </div>`;
    
    if (APP.userPlaylists.length === 0) {
        html += '<div class="playlist-empty-state">No playlists yet. Create one to save your favorite songs!</div>';
    } else {
        html += APP.userPlaylists.map(pl => {
            const cachedCount = pl.tracks.filter(t => isTrackCached(t)).length;
            const allCached = cachedCount === pl.tracks.length && pl.tracks.length > 0;
            return `
            <div class="filter-item playlist-list-item" data-playlist-id="${pl.id}">
                <div class="playlist-info">
                    <div class="name">${pl.name}</div>
                    ${showDownload ? `<div class="offline-status">${cachedCount}/${pl.tracks.length} offline</div>` : `<div class="offline-status">${pl.tracks.length} tracks</div>`}
                </div>
                <div class="playlist-meta">
                    ${showDownload ? `<button class="download-playlist-btn ${allCached ? 'downloaded' : ''}" data-playlist-id="${pl.id}" title="${allCached ? 'All downloaded' : 'Download all for offline'}">&#x2193;</button>` : ''}
                    <button class="delete-playlist-btn" data-playlist-id="${pl.id}" title="Delete playlist">&#x00d7;</button>
                </div>
            </div>`;
        }).join('');
    }
    
    content.innerHTML = html;
    
    $('create-playlist-btn').addEventListener('click', () => {
        showCreatePlaylistDialog();
    });
    
    content.querySelectorAll('.playlist-list-item').forEach(item => {
        item.addEventListener('click', (e) => {
            if (e.target.classList.contains('delete-playlist-btn') || 
                e.target.classList.contains('download-playlist-btn')) return;
            const playlistId = item.dataset.playlistId;
            renderPlaylistTracks(playlistId);
        });
    });
    
    content.querySelectorAll('.download-playlist-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const playlistId = btn.dataset.playlistId;
            cachePlaylistTracks(playlistId);
        });
    });
    
    content.querySelectorAll('.delete-playlist-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const playlistId = btn.dataset.playlistId;
            const playlist = APP.userPlaylists.find(p => p.id === playlistId);
            if (confirm(`Delete playlist "${playlist.name}"?`)) {
                deletePlaylist(playlistId);
                renderPlaylistList();
            }
        });
    });
}

function renderPlaylistTracks(playlistId) {
    const content = $('program-guide-content');
    const playlist = APP.userPlaylists.find(p => p.id === playlistId);
    const showDownload = !APP.isIOS; // Only show download on Android
    
    if (!playlist) {
        renderPlaylistList();
        return;
    }
    
    const cachedCount = playlist.tracks.filter(t => isTrackCached(t)).length;
    const allCached = cachedCount === playlist.tracks.length && playlist.tracks.length > 0;
    
    // Check if this playlist is currently active/playing
    const isPlayingThis = (APP.currentBand === 'playlist_' + playlistId);
    
    let html = `<div class="playlist-header-bar">
        <button class="back-to-playlists-btn">← Back</button>
        <div class="playlist-title">${playlist.name}</div>
        <div style="display:flex; gap:10px;">
             ${playlist.tracks.length > 0 ? `<button class="download-all-btn play-playlist-btn ${isPlayingThis ? 'playing-mode' : ''}" data-playlist-id="${playlistId}" title="Play Playlist">
                ${isPlayingThis ? 'Playing' : '▶ Play'}
             </button>` : ''}
             ${showDownload && playlist.tracks.length > 0 ? `<button class="download-all-btn ${allCached ? 'downloaded' : ''}" data-playlist-id="${playlistId}" title="${allCached ? 'All downloaded' : 'Download all'}">↓ All</button>` : ''}
        </div>
    </div>`;
    
    if (playlist.tracks.length === 0) {
        html += '<div class="playlist-empty-state">This playlist is empty. Add songs from the Tracks view or from Book I/II!</div>';
    } else {
        html += playlist.tracks.map((track, index) => {
            const artist = track.artist || track.Artist;
            const title = track.title || track.Title;
            const isCached = isTrackCached(track);
            const trackJson = JSON.stringify(track).replace(/"/g, '&quot;');
            
            // Highlight active track if playing this playlist
            const isActive = isPlayingThis && (APP.currentIndex === index);
            
            return `
            <div class="program-item playlist-track-item ${isActive ? 'active-track' : ''}" data-track-index="${index}" data-playlist-id="${playlistId}">
                <div class="program-item-main">
                    <div class="artist">${artist}</div>
                    <div class="title">${title}</div>
                </div>
                <div class="program-item-actions">
                    ${isActive ? '<div class="now-playing-indicator">▶ Playing</div>' : ''}
                    ${showDownload ? `<button class="download-track-btn ${isCached ? 'downloaded' : ''}" data-track='${trackJson}' data-track-index="${index}">${isCached ? 'Downloaded' : 'Download'}</button>` : ''}
                    <button class="remove-from-playlist-btn" data-track-index="${index}">Remove</button>
                </div>
            </div>`;
        }).join('');
    }
    
    content.innerHTML = html;
    
    content.querySelector('.back-to-playlists-btn').addEventListener('click', () => {
        renderPlaylistList();
    });
    
    const playBtn = content.querySelector('.play-playlist-btn');
    if (playBtn) {
        playBtn.addEventListener('click', (e) => {
             e.stopPropagation();
             // Switch context to this playlist!
             const pid = btn.dataset.playlistId || playlistId;
             console.log('[Playlist] Switching to playlist mode:', pid);
             
             // Unload current state
             qsa('.band-btn').forEach(b => b.classList.remove('active')); // Deselect piano keys
             
             // Register this playlist in APP.playlist so buildDial finds it
             const bandKey = 'playlist_' + pid;
             APP.playlist[bandKey] = playlist.tracks;
             APP.currentBand = bandKey;
             
             APP.currentIndex = 0;
             buildDial();
             loadTrack(0);
             closeProgramGuide();
        });
    }

    const downloadAllBtn = content.querySelector('.download-all-btn:not(.play-playlist-btn)');
    if (downloadAllBtn) {
        downloadAllBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            cachePlaylistTracks(playlistId);
        });
    }
    
    content.querySelectorAll('.program-item-main').forEach(item => {
        item.addEventListener('click', () => {
            const trackItem = item.closest('.playlist-track-item');
            const trackIndex = parseInt(trackItem.dataset.trackIndex);
            
            // NEW BEHAVIOR: 
            // If we are already in this playlist mode, just tune.
            // If not, switch mode to this playlist and play.
            const bandKey = 'playlist_' + playlistId;
            
            if (APP.currentBand === bandKey) {
                hideOnboardingHints();
                tuneToStation(trackIndex);
                closeProgramGuide();
            } else {
                // Switch to playlist mode
                qsa('.band-btn').forEach(b => b.classList.remove('active'));
                
                APP.playlist[bandKey] = playlist.tracks;
                APP.currentBand = bandKey;
                
                APP.currentIndex = trackIndex;
                buildDial();
                loadTrack(trackIndex);
                closeProgramGuide();
            }
        });
    });
    
    content.querySelectorAll('.download-track-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const track = JSON.parse(btn.dataset.track.replace(/&quot;/g, '"'));
            if (isTrackCached(track)) {
                if (confirm('Remove this track from offline storage?')) {
                    uncacheTrack(track);
                    btn.classList.remove('downloaded');
                }
            } else {
                cacheTrack(track);
                btn.classList.add('downloading');
                setTimeout(() => btn.classList.remove('downloading'), 2000);
            }
        });
    });
    
    content.querySelectorAll('.remove-from-playlist-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const trackIndex = parseInt(btn.dataset.trackIndex);
            removeTrackFromPlaylist(playlistId, trackIndex);
            // Update the live playlist if playing
            if (APP.currentBand === 'playlist_' + playlistId) {
                 APP.playlist[APP.currentBand] = playlist.tracks; // Refresh ref
                 // If we removed the currently playing track, weirdness happens, but handled for now by standard refresh
            }
            renderPlaylistTracks(playlistId);
        });
    });
}

function showCreatePlaylistDialog() {
    const dialog = document.createElement('div');
    dialog.className = 'create-playlist-dialog';
    dialog.innerHTML = `
        <div class="create-playlist-dialog-content">
            <div class="create-playlist-dialog-header">New Playlist</div>
            <input type="text" id="new-playlist-name" placeholder="Playlist name" maxlength="50" autofocus>
            <div class="create-playlist-dialog-actions">
                <button class="dialog-cancel-btn">Cancel</button>
                <button class="dialog-create-btn">Create</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(dialog);
    
    const input = dialog.querySelector('#new-playlist-name');
    input.focus();
    
    const createPlaylistFromDialog = () => {
        const name = input.value.trim();
        if (name) {
            createPlaylist(name);
            dialog.remove();
            renderPlaylistList();
        }
    };
    
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') createPlaylistFromDialog();
    });
    
    dialog.querySelector('.dialog-create-btn').addEventListener('click', createPlaylistFromDialog);
    
    dialog.querySelector('.dialog-cancel-btn').addEventListener('click', () => {
        dialog.remove();
    });
    
    dialog.addEventListener('click', (e) => {
        if (e.target === dialog) dialog.remove();
    });
}

function closeProgramGuide() {
    $('modal-overlay').classList.remove('active');
    $('program-guide').classList.remove('active');
}

window.addEventListener('resize', () => {
    const f = qs('.station');
    if(f && f.offsetWidth > 0) APP.sectionWidth = f.offsetWidth;
    if(APP.currentBand === 'radio') {
        setupDualDraggables();
        renderVirtualDial(APP.currentIndex * -APP.sectionWidth);
    } else {
        setupSingleDraggable();
    }
});