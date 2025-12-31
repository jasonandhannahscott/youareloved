// ZENITH - SHARED STATE & CONFIGURATION
// Extracted from app.js

// ============================================================================
// CONFIGURATION
// ============================================================================
const CONFIG = {
    SECTION_WIDTH_DEFAULT: 180,
    DEFAULT_VOLUME: 1.0,
    MIN_VOLUME: 0.1, // Minimum volume to prevent silent playback
    STATE_EXPIRY_MS: 7 * 24 * 60 * 60 * 1000, // 7 days
    TOAST_DURATION: { short: 3000, medium: 5000, long: 8000 },
    ANIMATION: { snap: 0.5, transition: 2.0, fade: 1500 },
    VIRTUAL_POOL_MIN: 24,
    MOMENTUM_FACTOR: 300,
    STORAGE_WARNING_MB: 100,
    STORAGE_WARNING_PERCENT: 90,
    POSITION_UPDATE_INTERVAL: 1000,
    STATE_SAVE_INTERVAL: 30000,
    SW_UPDATE_INTERVAL: 60000,
    SEARCH_DEBOUNCE_MS: 200,
    SEARCH_MIN_CHARS: 2,
    // New constants for Refactor #2 & #8
    MAX_ROTATION: 50,
    MAX_DEPTH: 150,
    EDGE_RESISTANCE: 0.7
};

const BANDS = {
    RADIO: 'radio',
    BOOK1: 'book1',
    BOOK2: 'book2',
    PLAYLIST_PREFIX: 'playlist_',
    isPlaylist: band => band?.startsWith('playlist_'),
    getPlaylistId: band => band?.replace('playlist_', ''),
    toPlaylistBand: id => 'playlist_' + id
};

const SW_MSG = {
    SKIP_WAITING: 'SKIP_WAITING',
    CACHE_AUDIO: 'CACHE_AUDIO',
    UNCACHE_AUDIO: 'UNCACHE_AUDIO',
    GET_CACHED_URLS: 'GET_CACHED_URLS',
    REFRESH_APP_CACHE: 'REFRESH_APP_CACHE',
    DELETE_AUDIO_CACHE: 'DELETE_AUDIO_CACHE',
    CACHED_URLS_LIST: 'CACHED_URLS_LIST',
    AUDIO_CACHED: 'AUDIO_CACHED',
    AUDIO_UNCACHED: 'AUDIO_UNCACHED',
    AUDIO_CACHE_FAILED: 'AUDIO_CACHE_FAILED',
    AUDIO_CACHE_CLEARED: 'AUDIO_CACHE_CLEARED'
};

// ============================================================================
// GLOBAL APPLICATION STATE
// ============================================================================
const APP = {
    initialized: false, hasInteracted: false,
    playlist: null, radioData: null, radioPlaylist: [], radioArtists: [], userPlaylists: [],
    cachedUrls: new Set(), explicitDownloads: new Set(), swReady: false,
    pageVisible: true, isBackgrounded: false, lastFrameTime: 0, frameCheckActive: true,
    
    // Network and lifecycle state
    isOnline: true,
    pendingNetworkRetry: false,
    loadRetryCount: {},
    wakeLock: null,
    wasPlayingBeforeInterrupt: false,
    wasPlayingBeforeFreeze: false,
    interruptedAt: null,
    frozenAt: null,
    
    isMobile: /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent),
    isIOS: /iPhone|iPad|iPod/i.test(navigator.userAgent),
    isAndroid: /Android/i.test(navigator.userAgent),
    isPWA: window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true,
    deferredPrompt: null,
    
    currentBand: BANDS.RADIO, currentIndex: 0, currentTrackSrc: null,
    nextTrackHowl: null, nextTrackSrc: null, recentBandSwitch: false, pendingIndex: -1,
    loadId: 0, pendingVideoErrorHandler: null,
    
    audioContext: null, gainNode: null, staticNode: null, staticGain: null, musicGain: null,
    currentHowl: null, fadingHowl: null,
    isPlaying: false, isDragging: false, isTransitioning: false, manuallyPaused: false,
    
    sectionWidth: CONFIG.SECTION_WIDTH_DEFAULT, volume: CONFIG.DEFAULT_VOLUME,
    expandTimer: null, volumeSliderTimeout: null, bandSwitchTimer: null, positionTimer: null, loadTimer: null,
    shuffleDebounce: false, downloadProgress: null,
    
    settings: { startWithShuffle: true, debugMode: false },
    radioState: { isShuffled: true, isRepeat: false, viewMode: 'tracks', activeGenre: null, activeArtistFilter: null, lastArtistIndex: 0 },
    virtualState: { poolSize: CONFIG.VIRTUAL_POOL_MIN, pool: [], totalWidth: 0, visibleRange: { start: 0, end: 0 } }
};

// ============================================================================
// UTILITIES
// ============================================================================
const $ = id => document.getElementById(id);
const qs = s => document.querySelector(s);
const qsa = s => document.querySelectorAll(s);
const cleanPath = p => p ? p.replace(/\\/g, '/').replace(/\/\//g, '/') : '';
const getSecureUrl = p => 'serve.php?file=' + encodeURIComponent(p).replace(/'/g, '%27');
const shuffleArray = arr => { for(let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };

const Track = {
    getArtist: t => t?.artist || t?.Artist || 'Unknown Artist',
    getTitle: t => t?.title || t?.Title || 'Unknown Title',
    getId: t => t?.src_audio || (Track.getTitle(t) + Track.getArtist(t)),
    getGenre: t => t?.genre || t?.Genre || 'Unknown',
    getFolder: t => t?.ParentFolder || 'Unknown',
    getPage: t => t?.page || '',
    getExcerpt: t => t?.excerpt || '',
    hasVideo: t => t?.src_video && /\.(mp4|mkv|webm)$/i.test(t.src_video),
    getDisplayName: t => `${Track.getArtist(t)} - ${Track.getTitle(t)}`
};

const TrackJSON = {
    encode: track => JSON.stringify(track).replace(/"/g, '&quot;').replace(/'/g, '&#39;'),
    decode: str => { try { return JSON.parse(str.replace(/&quot;/g, '"').replace(/&#39;/g, "'")); } catch { return null; } }
};

const Storage = {
    get(key, fallback = null) {
        try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } 
        catch { return fallback; }
    },
    set(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); return true; } 
        catch { return false; }
    }
};

const Timers = {
    active: {},
    set(name, fn, delay) {
        this.clear(name);
        this.active[name] = setTimeout(fn, delay);
        return this.active[name];
    },
    setInterval(name, fn, delay) {
        this.clear(name);
        this.active[name] = setInterval(fn, delay);
        return this.active[name];
    },
    clear(name) {
        if (this.active[name]) {
            clearTimeout(this.active[name]);
            clearInterval(this.active[name]);
            delete this.active[name];
        }
    },
    clearAll() {
        Object.keys(this.active).forEach(name => this.clear(name));
    }
};