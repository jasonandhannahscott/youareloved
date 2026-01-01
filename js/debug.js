// ZENITH DEBUG MODULE v3
// Comprehensive debugging with navigation, sparklines, categorized metrics, and enhanced logging
// See DEBUG_MODULE_PLAN.md for full specification

const Debug = (() => {
    // =========================================================================
    // STATE & CONFIGURATION
    // =========================================================================
    const VERSION = '4.0';
    const STORAGE_KEY = 'zenith_debug_state';
    const MAX_HISTORY = 60; // 60 seconds of sparkline history
    const MAX_LOG_ENTRIES = 500;
    const REFRESH_RATE = 1000; // 1 second metric collection
    
    const state = {
        enabled: false,
        collapsed: false,
        corner: 'top-left', // 'top-left' | 'top-right' | 'bottom-right' | 'bottom-left'
        activeTab: 'playback',
        deviceView: 'auto',
        refreshInterval: null,
        seekbarInterval: null,
        // New: floating/popout modes
        mode: 'docked', // 'docked' | 'floating' | 'popout'
        floatX: 100,
        floatY: 100,
        isDragging: false,
        dragOffsetX: 0,
        dragOffsetY: 0,
        popoutWindow: null,
        popoutChannel: null
    };
    
    // Rolling metric history (60 seconds)
    const metrics = {
        playbackState: [],
        howlState: [],
        audioContextState: [],
        networkState: [],
        visibilityState: [],
        swReady: [],
        wakeLock: [],
        bufferHealth: [],
        isBackgrounded: []
    };
    
    // Log storage with filtering
    const logs = {
        entries: [],
        filteredEntries: [],
        isPaused: false,
        searchQuery: '',
        levelFilter: 3, // 0=errors, 1=warnings, 2=info, 3=all
        expandedEntries: new Set(),
        categories: {
            PLAYBACK: true, AUDIO: true, TRACK: true, STATE: true,
            PWA: true, UI: true, TRANSPORT: true, INIT: true,
            WARN: true, ERROR: true
        }
    };
    
    // DOM references
    let overlay = null;
    let logContainer = null;
    
    // Unicode icons (avoid emoji conversion issues on mobile)
    const ARROW_UP = '\u2191';
    const ARROW_DOWN = '\u2193';
    const COLLAPSE = '\u2212';
    const EXPAND = '\u002B';
    
    const ICONS = {
        TRANSPORT: '\uD83C\uDFDB\uFE0F',
        PLAYBACK: '\u25B6\uFE0F',
        TRACK: '\uD83C\uDFB5',
        STATE: '\uD83D\uDCCA',
        PWA: '\uD83D\uDCF1',
        AUDIO: '\uD83D\uDD0A',
        UI: '\uD83D\uDDBC\uFE0F',
        ERROR: '\u274C',
        WARN: '\u26A0\uFE0F',
        INIT: '\uD83D\uDE80'
    };
    
    const TAB_ICONS = {
        playback: '\u25B6\uFE0F',
        audio: '\uD83D\uDD0A',
        media: '\uD83D\uDCF2',  // Mobile phone with arrow - for Media Session / Android
        network: '\uD83D\uDCE1',
        pwa: '\uD83D\uDCF1',
        device: '\uD83D\uDCBB',
        logs: '\uD83D\uDCCB'
    };
    
    const SPARKLINE_COLORS = {
        green: '#22c55e',
        amber: '#f59e0b',
        red: '#ef4444'
    };
    
    // =========================================================================
    // SPARKLINE RENDERER
    // =========================================================================
    const SparklineRenderer = {
        stateToRow(stateValue, type) {
            const maps = {
                playback: { 
                    playing: 2, loading: 1, transitioning: 1, 
                    paused: 1, dragging: 1, stopped: 0, error: 0, idle: 0 
                },
                audioContext: { running: 2, suspended: 1, closed: 0 },
                network: { online_sw: 2, online: 1, offline: 0 },
                visibility: { visible_fg: 2, visible_bg: 1, hidden: 0 },
                howl: { playing: 2, paused: 1, none: 0 },
                wakeLock: { active: 2, none: 0 },
                background: { foreground: 2, background: 0 },
                generic: { active: 2, ready: 2, pending: 1, none: 0 }
            };
            return maps[type]?.[stateValue] ?? 1;
        },
        
        render(history, type) {
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('class', 'debug-spark');
            svg.setAttribute('width', '60');
            svg.setAttribute('height', '3');
            svg.setAttribute('viewBox', '0 0 60 3');
            
            const data = history.slice(-60);
            const startX = 60 - data.length;
            
            data.forEach((stateValue, i) => {
                const row = this.stateToRow(stateValue, type);
                const color = row === 2 ? SPARKLINE_COLORS.green : 
                              row === 1 ? SPARKLINE_COLORS.amber : SPARKLINE_COLORS.red;
                const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                rect.setAttribute('x', startX + i);
                rect.setAttribute('y', 2 - row);
                rect.setAttribute('width', 1);
                rect.setAttribute('height', 1);
                rect.setAttribute('fill', color);
                svg.appendChild(rect);
            });
            
            return svg;
        },
        
        // Taller sparkline for buffer health (percentage-based, 20px tall)
        renderBuffer(history) {
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('class', 'debug-spark-buffer');
            svg.setAttribute('width', '60');
            svg.setAttribute('height', '20');
            svg.setAttribute('viewBox', '0 0 60 20');
            
            const data = history.slice(-60);
            const startX = 60 - data.length;
            
            data.forEach((percent, i) => {
                // percent is 0-100, height is 20px (1px = 5%)
                const height = Math.max(1, Math.round(percent / 5));
                const color = percent >= 50 ? SPARKLINE_COLORS.green : 
                              percent >= 20 ? SPARKLINE_COLORS.amber : SPARKLINE_COLORS.red;
                const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                rect.setAttribute('x', startX + i);
                rect.setAttribute('y', 20 - height);
                rect.setAttribute('width', 1);
                rect.setAttribute('height', height);
                rect.setAttribute('fill', color);
                svg.appendChild(rect);
            });
            
            return svg;
        },
        
        // Convert history to simple array format for popout transfer
        historyToArray(history) {
            return history.slice(-60);
        }
    };
    
    // Render all sparklines as HTML strings for popout window
    function renderSparklineStrings() {
        return {
            playback: SparklineRenderer.render(metrics.playbackState || [], 'playback').outerHTML,
            howl: SparklineRenderer.render(metrics.howlState || [], 'howl').outerHTML,
            audioContext: SparklineRenderer.render(metrics.audioContextState || [], 'audioContext').outerHTML,
            network: SparklineRenderer.render(metrics.networkState || [], 'network').outerHTML,
            visibility: SparklineRenderer.render(metrics.visibilityState || [], 'visibility').outerHTML,
            wakeLock: SparklineRenderer.render(metrics.wakeLock || [], 'wakeLock').outerHTML,
            background: SparklineRenderer.render(metrics.isBackgrounded || [], 'background').outerHTML,
            buffer: SparklineRenderer.renderBuffer(metrics.bufferHealth || []).outerHTML
        };
    }
    
    // =========================================================================
    // METRIC COLLECTORS
    // =========================================================================
    const MetricCollectors = {
        playbackState() {
            if (typeof PlaybackState !== 'undefined') {
                return PlaybackState.current;
            }
            if (APP.isPlaying) return 'playing';
            if (APP.manuallyPaused) return 'paused';
            return 'idle';
        },
        
        howlState() {
            if (!APP.currentHowl) return 'none';
            if (APP.currentHowl.playing()) return 'playing';
            return 'paused';
        },
        
        audioContextState() {
            if (typeof AudioEngine !== 'undefined') {
                return AudioEngine.getState();
            }
            return APP.audioContext?.state || 'closed';
        },
        
        networkState() {
            if (!APP.isOnline) return 'offline';
            if (APP.swReady) return 'online_sw';
            return 'online';
        },
        
        visibilityState() {
            if (!APP.pageVisible) return 'hidden';
            if (APP.isBackgrounded) return 'visible_bg';
            return 'visible_fg';
        },
        
        swReady() {
            return APP.swReady ? 'ready' : 'pending';
        },
        
        wakeLock() {
            return APP.wakeLock ? 'active' : 'none';
        },
        
        bufferHealth() {
            // Returns 0-100 percentage for buffer health
            if (!APP.currentHowl || !APP.currentHowl._sounds?.[0]) return 0;
            const audio = APP.currentHowl._sounds[0]._node;
            if (!audio || !audio.buffered?.length) return 0;
            try {
                const currentTime = audio.currentTime;
                const bufferedEnd = audio.buffered.end(audio.buffered.length - 1);
                const bufferAhead = bufferedEnd - currentTime;
                // Scale: 0s = 0%, 30s+ = 100%
                return Math.min(100, Math.round((bufferAhead / 30) * 100));
            } catch (e) {
                return 0;
            }
        },
        
        isBackgrounded() {
            return APP.isBackgrounded ? 'background' : 'foreground';
        }
    };
    
    function collectMetrics() {
        Object.keys(MetricCollectors).forEach(key => {
            const value = MetricCollectors[key]();
            metrics[key === 'audioContextState' ? 'audioContextState' : key] = 
                metrics[key === 'audioContextState' ? 'audioContextState' : key] || [];
            const arr = metrics[key];
            arr.push(value);
            if (arr.length > MAX_HISTORY) arr.shift();
        });
    }
    
    // Collect full state for popout window
    function collectFullState() {
        const list = typeof getCurrentTrackList === 'function' ? getCurrentTrackList() : [];
        const track = list?.[APP.currentIndex];
        let nextIndex = -1;
        if (list && list.length > 0) {
            nextIndex = (APP.currentIndex + 1) < list.length ? (APP.currentIndex + 1) : 0;
        }
        const nextTrack = nextIndex >= 0 ? list[nextIndex] : null;
        
        let position = 0, duration = 0;
        if (APP.currentHowl) {
            position = APP.currentHowl.seek() || 0;
            duration = APP.currentHowl.duration() || 0;
        }
        
        const buffer = getBufferHealth();
        const netQuality = getNetworkQuality();
        
        return {
            // Playback
            playbackState: MetricCollectors.playbackState(),
            howlState: MetricCollectors.howlState(),
            position: position,
            duration: duration,
            volume: APP.volume || 0,
            band: APP.currentBand,
            trackCount: list?.length || 0,
            currentIndex: APP.currentIndex,
            nextIndex: nextIndex,
            trackArtist: track ? Track.getArtist(track) : null,
            trackTitle: track ? Track.getTitle(track) : null,
            nextArtist: nextTrack ? Track.getArtist(nextTrack) : null,
            nextTitle: nextTrack ? Track.getTitle(nextTrack) : null,
            bufferSeconds: buffer?.seconds || 0,
            bufferHealth: buffer?.health || 'unknown',
            manuallyPaused: APP.manuallyPaused,
            isTransitioning: APP.isTransitioning,
            
            // Audio
            audioContextState: MetricCollectors.audioContextState(),
            sampleRate: APP.audioContext?.sampleRate || 0,
            masterGain: APP.gainNode?.gain?.value || 0,
            musicGain: APP.musicGain?.gain?.value || 0,
            staticGain: APP.staticGain?.gain?.value || 0,
            staticNodeActive: !!APP.staticNode,
            
            // Network
            isOnline: APP.isOnline,
            connectionType: netQuality.type || 'unknown',
            downlink: netQuality.downlink || 0,
            rtt: netQuality.rtt || 0,
            swReady: APP.swReady,
            cachedUrls: APP.cachedUrls?.size || 0,
            
            // PWA
            pageVisible: APP.pageVisible,
            isBackgrounded: APP.isBackgrounded,
            isPWA: APP.isPWA,
            wakeLock: MetricCollectors.wakeLock(),
            
            // Device
            isIOS: APP.isIOS,
            isAndroid: APP.isAndroid,
            isMobile: APP.isMobile,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
            pixelRatio: window.devicePixelRatio
        };
    }
    
    // =========================================================================
    // DEVICE DETECTION & WARNINGS
    // =========================================================================
    const DeviceMode = {
        detect() {
            if (APP.isMobile) return 'mobile';
            if (window.innerWidth <= 768) return 'mobile';
            return 'desktop';
        },
        
        getWarnings() {
            const warnings = [];
            
            if (APP.isIOS) {
                warnings.push({
                    level: 'warn',
                    message: 'iOS Safari may pause audio when backgrounded'
                });
                if (!APP.isPWA) {
                    warnings.push({
                        level: 'info',
                        message: 'Install as PWA for better background audio'
                    });
                }
            }
            
            if (APP.isAndroid && !APP.isPWA) {
                warnings.push({
                    level: 'info',
                    message: 'PWA mode recommended for background playback'
                });
            }
            
            const audioState = MetricCollectors.audioContextState();
            if (audioState === 'suspended') {
                warnings.push({
                    level: 'error',
                    message: 'AudioContext suspended - tap to resume'
                });
            }
            
            return warnings;
        }
    };
    
    // =========================================================================
    // STORAGE METRICS
    // =========================================================================
    async function getStorageMetrics() {
        if (!navigator.storage?.estimate) return null;
        try {
            const { usage, quota } = await navigator.storage.estimate();
            return {
                usedMB: Math.round(usage / 1024 / 1024),
                quotaMB: Math.round(quota / 1024 / 1024),
                percentUsed: Math.round((usage / quota) * 100)
            };
        } catch (e) {
            return null;
        }
    }
    
    // =========================================================================
    // NETWORK QUALITY
    // =========================================================================
    function getNetworkQuality() {
        const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        if (!conn) return { available: false };
        
        return {
            available: true,
            type: conn.effectiveType || 'unknown',
            downlink: conn.downlink || 0,
            rtt: conn.rtt || 0,
            saveData: conn.saveData || false
        };
    }
    
    // =========================================================================
    // BUFFER HEALTH
    // =========================================================================
    function getBufferHealth() {
        if (!APP.currentHowl || !APP.currentHowl._sounds?.[0]) return null;
        const audio = APP.currentHowl._sounds[0]._node;
        if (!audio || !audio.buffered?.length) return { seconds: 0, health: 'unknown' };
        
        try {
            const currentTime = audio.currentTime;
            const bufferedEnd = audio.buffered.end(audio.buffered.length - 1);
            const bufferAhead = bufferedEnd - currentTime;
            
            return {
                seconds: bufferAhead.toFixed(1),
                health: bufferAhead > 30 ? 'good' : bufferAhead > 10 ? 'warn' : 'critical'
            };
        } catch (e) {
            return { seconds: 0, health: 'unknown' };
        }
    }
    
    // =========================================================================
    // PANEL CONTENT GENERATORS
    // =========================================================================
    const Panels = {
        playback() {
            const playbackState = MetricCollectors.playbackState();
            const howlState = MetricCollectors.howlState();
            const buffer = getBufferHealth();
            const list = typeof getCurrentTrackList === 'function' ? getCurrentTrackList() : [];
            const track = list?.[APP.currentIndex];
            
            // Calculate next index with wrap-around (same logic as handleAutoplay)
            let nextIndex = -1;
            if (list && list.length > 0) {
                nextIndex = (APP.currentIndex + 1) < list.length ? (APP.currentIndex + 1) : 0;
            }
            const nextTrack = nextIndex >= 0 ? list[nextIndex] : null;
            
            let position = '0:00';
            let duration = '0:00';
            let percent = 0;
            
            if (APP.currentHowl) {
                const pos = APP.currentHowl.seek() || 0;
                const dur = APP.currentHowl.duration() || 0;
                position = formatTime(pos);
                duration = formatTime(dur);
                percent = dur > 0 ? (pos / dur) * 100 : 0;
            }
            
            return `
                <div class="debug-panel-title">PLAYBACK</div>
                <div class="debug-metric-row">
                    <div class="debug-metric-header">
                        <span class="debug-metric-key">State</span>
                        <span class="debug-metric-val ${getStateClass(playbackState)}">${playbackState}</span>
                    </div>
                    ${SparklineRenderer.render(metrics.playbackState || [], 'playback').outerHTML}
                </div>
                <div class="debug-metric-row">
                    <div class="debug-metric-header">
                        <span class="debug-metric-key">Howl</span>
                        <span class="debug-metric-val ${getStateClass(howlState)}">${howlState}</span>
                    </div>
                    ${SparklineRenderer.render(metrics.howlState || [], 'howl').outerHTML}
                </div>
                ${buffer ? `
                <div class="debug-metric-row">
                    <div class="debug-metric-header">
                        <span class="debug-metric-key">Buffer</span>
                        <span class="debug-metric-val ${buffer.health}">${buffer.seconds}s ahead</span>
                    </div>
                    ${SparklineRenderer.renderBuffer(metrics.bufferHealth || []).outerHTML}
                </div>
                ` : ''}
                <div class="debug-metric-row">
                    <div class="debug-metric-header">
                        <span class="debug-metric-key">Position</span>
                        <span class="debug-metric-val">${position} / ${duration}</span>
                    </div>
                    <div class="debug-progress-mini">
                        <div class="debug-progress-mini-fill" style="width: ${percent}%"></div>
                    </div>
                </div>
                <div class="debug-metric-simple">
                    <span class="debug-metric-key">Volume</span>
                    <span class="debug-metric-val">${Math.round((APP.volume || 0) * 100)}%</span>
                </div>
                <div class="debug-metric-simple">
                    <span class="debug-metric-key">Band</span>
                    <span class="debug-metric-val">${APP.currentBand} (${list?.length || 0} tracks)</span>
                </div>
                <div class="debug-metric-simple">
                    <span class="debug-metric-key">Index</span>
                    <span class="debug-metric-val">${APP.currentIndex}${nextIndex >= 0 ? ` → ${nextIndex}` : ''} / ${list?.length || 0}</span>
                </div>
                <div class="debug-metric-simple">
                    <span class="debug-metric-key">Transitioning</span>
                    <span class="debug-metric-val ${APP.isTransitioning ? 'warn' : ''}">${APP.isTransitioning ? 'YES' : 'no'}</span>
                </div>
                <div class="debug-metric-simple">
                    <span class="debug-metric-key">Paused</span>
                    <span class="debug-metric-val ${APP.manuallyPaused ? 'warn' : ''}">${APP.manuallyPaused ? 'YES' : 'no'}</span>
                </div>
                ${track ? `
                <div class="debug-metric-track">
                    <span class="debug-metric-key">Track</span>
                    <span class="debug-metric-val">${Track.getArtist(track)} - ${Track.getTitle(track)}</span>
                </div>
                ` : ''}
                ${nextTrack ? `
                <div class="debug-metric-track">
                    <span class="debug-metric-key">Next</span>
                    <span class="debug-metric-val">${Track.getArtist(nextTrack)} - ${Track.getTitle(nextTrack)}</span>
                </div>
                ` : ''}
            `;
        },
        
        audio() {
            const contextState = MetricCollectors.audioContextState();
            const sampleRate = APP.audioContext?.sampleRate || 'N/A';
            const masterGain = APP.gainNode?.gain?.value?.toFixed(2) || '0.00';
            const musicGain = APP.musicGain?.gain?.value?.toFixed(2) || '0.00';
            const staticGain = APP.staticGain?.gain?.value?.toFixed(2) || '0.00';
            
            return `
                <div class="debug-panel-title">AUDIO ENGINE</div>
                <div class="debug-metric-row">
                    <div class="debug-metric-header">
                        <span class="debug-metric-key">Context</span>
                        <span class="debug-metric-val ${getStateClass(contextState)}">${contextState}</span>
                    </div>
                    ${SparklineRenderer.render(metrics.audioContextState || [], 'audioContext').outerHTML}
                </div>
                <div class="debug-metric-simple">
                    <span class="debug-metric-key">Sample Rate</span>
                    <span class="debug-metric-val">${sampleRate} Hz</span>
                </div>
                <div class="debug-section">
                    <div class="debug-section-title">Gain Nodes</div>
                    <div class="debug-gain-row">
                        <span class="debug-gain-label">Master</span>
                        <div class="debug-gain-bar"><div class="debug-gain-fill" style="width: ${masterGain * 100}%"></div></div>
                        <span class="debug-gain-val">${masterGain}</span>
                    </div>
                    <div class="debug-gain-row">
                        <span class="debug-gain-label">Music</span>
                        <div class="debug-gain-bar"><div class="debug-gain-fill" style="width: ${musicGain * 100}%"></div></div>
                        <span class="debug-gain-val">${musicGain}</span>
                    </div>
                    <div class="debug-gain-row">
                        <span class="debug-gain-label">Static</span>
                        <div class="debug-gain-bar"><div class="debug-gain-fill static" style="width: ${staticGain * 100}%"></div></div>
                        <span class="debug-gain-val">${staticGain}</span>
                    </div>
                </div>
                <div class="debug-metric-simple">
                    <span class="debug-metric-key">Static Node</span>
                    <span class="debug-metric-val">${APP.staticNode ? 'active | looping' : 'none'}</span>
                </div>
            `;
        },
        
        async network() {
            const networkState = MetricCollectors.networkState();
            const netQuality = getNetworkQuality();
            const storage = await getStorageMetrics();
            
            return `
                <div class="debug-panel-title">NETWORK / CACHE</div>
                <div class="debug-metric-row">
                    <div class="debug-metric-header">
                        <span class="debug-metric-key">Online</span>
                        <span class="debug-metric-val ${APP.isOnline ? 'good' : 'bad'}">${APP.isOnline}</span>
                    </div>
                    ${SparklineRenderer.render(metrics.networkState || [], 'network').outerHTML}
                </div>
                ${netQuality.available ? `
                <div class="debug-metric-simple">
                    <span class="debug-metric-key">Connection</span>
                    <span class="debug-metric-val">${netQuality.type} @ ${netQuality.downlink} Mbps | RTT: ${netQuality.rtt}ms</span>
                </div>
                ` : ''}
                <div class="debug-section">
                    <div class="debug-section-title">Service Worker</div>
                    <div class="debug-metric-simple">
                        <span class="debug-metric-key">Status</span>
                        <span class="debug-metric-val ${APP.swReady ? 'good' : 'warn'}">${APP.swReady ? 'active' : 'pending'}</span>
                    </div>
                </div>
                <div class="debug-section">
                    <div class="debug-section-title">Cache Storage</div>
                    <div class="debug-metric-simple">
                        <span class="debug-metric-key">Cached URLs</span>
                        <span class="debug-metric-val">${APP.cachedUrls?.size || 0} files</span>
                    </div>
                    ${storage ? `
                    <div class="debug-metric-simple">
                        <span class="debug-metric-key">Storage Used</span>
                        <span class="debug-metric-val">${storage.usedMB} MB / ${storage.quotaMB} MB (${storage.percentUsed}%)</span>
                    </div>
                    <div class="debug-progress-mini">
                        <div class="debug-progress-mini-fill ${storage.percentUsed > 90 ? 'warn' : ''}" style="width: ${storage.percentUsed}%"></div>
                    </div>
                    ` : ''}
                </div>
            `;
        },
        
        pwa() {
            const visState = MetricCollectors.visibilityState();
            const wakeLockState = MetricCollectors.wakeLock();
            
            return `
                <div class="debug-panel-title">PWA / LIFECYCLE</div>
                <div class="debug-metric-row">
                    <div class="debug-metric-header">
                        <span class="debug-metric-key">Visibility</span>
                        <span class="debug-metric-val ${getStateClass(APP.pageVisible ? 'visible' : 'hidden')}">${APP.pageVisible ? 'visible' : 'hidden'}</span>
                    </div>
                    ${SparklineRenderer.render(metrics.visibilityState || [], 'visibility').outerHTML}
                </div>
                <div class="debug-metric-row">
                    <div class="debug-metric-header">
                        <span class="debug-metric-key">Background</span>
                        <span class="debug-metric-val ${APP.isBackgrounded ? 'warn' : 'good'}">${APP.isBackgrounded}</span>
                    </div>
                    ${SparklineRenderer.render(metrics.isBackgrounded || [], 'background').outerHTML}
                </div>
                <div class="debug-metric-simple">
                    <span class="debug-metric-key">PWA Mode</span>
                    <span class="debug-metric-val ${APP.isPWA ? 'good' : ''}">${APP.isPWA}</span>
                </div>
                <div class="debug-metric-row">
                    <div class="debug-metric-header">
                        <span class="debug-metric-key">Wake Lock</span>
                        <span class="debug-metric-val ${wakeLockState === 'active' ? 'good' : ''}">${wakeLockState}</span>
                    </div>
                    ${SparklineRenderer.render(metrics.wakeLock || [], 'wakeLock').outerHTML}
                </div>
                <div class="debug-metric-simple">
                    <span class="debug-metric-key">Install</span>
                    <span class="debug-metric-val">${APP.deferredPrompt ? 'available' : 'N/A'}</span>
                </div>
            `;
        },
        
        media() {
            // Media Session API status
            const hasMediaSession = 'mediaSession' in navigator;
            const mediaSessionState = hasMediaSession ? navigator.mediaSession.playbackState : 'unsupported';
            const metadata = hasMediaSession ? navigator.mediaSession.metadata : null;
            
            // Track source detection (stream vs cache)
            const list = typeof getCurrentTrackList === 'function' ? getCurrentTrackList() : [];
            const track = list?.[APP.currentIndex];
            let trackUrl = '';
            let isCached = false;
            let cacheStatus = 'unknown';
            let isExplicitDownload = false;
            
            if (track) {
                // Build the URL same as loadTrack does
                const bandsAvailable = typeof BANDS !== 'undefined';
                const isRadio = bandsAvailable && APP.currentBand === BANDS.RADIO;
                const isBook1 = bandsAvailable && (APP.currentBand === BANDS.BOOK1 || track.sourceType === BANDS.BOOK1);
                const isBook2 = bandsAvailable && (APP.currentBand === BANDS.BOOK2 || track.sourceType === BANDS.BOOK2);
                
                if (isRadio) {
                    trackUrl = 'serve.php?file=radio/' + encodeURIComponent(track.src_audio);
                } else {
                    const folderName = isBook1 ? 'Book 1' : isBook2 ? 'Book 2' : '';
                    let rawSrc = track.src_audio;
                    if (isBook1) rawSrc = 'Book 1/' + rawSrc.replace(/^book\s?1\//i, '');
                    else if (isBook2) rawSrc = 'Book 2/' + rawSrc.replace(/^book\s?2\//i, '');
                    else if (folderName) rawSrc = folderName + '/' + track.src_audio.replace(/^book\s?[12]\//i, '');
                    trackUrl = 'serve.php?file=' + encodeURIComponent(rawSrc);
                }
                
                // Check cache status
                if (APP.cachedUrls) {
                    const absUrl = new URL(trackUrl, window.location.origin).href;
                    isCached = APP.cachedUrls.has(trackUrl) || APP.cachedUrls.has(absUrl);
                    cacheStatus = isCached ? 'cached' : 'streaming';
                }
                
                // Check if explicitly downloaded
                if (typeof isTrackDownloaded === 'function') {
                    isExplicitDownload = isTrackDownloaded(track);
                }
            }
            
            // Audio element info
            let audioSrc = '';
            let audioReadyState = 'N/A';
            let audioNetworkState = 'N/A';
            let audioPaused = 'N/A';
            const READY_STATES = ['HAVE_NOTHING', 'HAVE_METADATA', 'HAVE_CURRENT_DATA', 'HAVE_FUTURE_DATA', 'HAVE_ENOUGH_DATA'];
            const NETWORK_STATES = ['NETWORK_EMPTY', 'NETWORK_IDLE', 'NETWORK_LOADING', 'NETWORK_NO_SOURCE'];
            
            if (APP.currentHowl && APP.currentHowl._sounds?.[0]?._node) {
                const audio = APP.currentHowl._sounds[0]._node;
                audioSrc = audio.src || audio.currentSrc || '';
                audioReadyState = READY_STATES[audio.readyState] || audio.readyState;
                audioNetworkState = NETWORK_STATES[audio.networkState] || audio.networkState;
                audioPaused = audio.paused;
            }
            
            // Howl state
            const howlPlaying = APP.currentHowl?.playing() || false;
            const howlState = APP.currentHowl?.state() || 'none';
            
            // Android-specific detection
            const isAndroid = APP.isAndroid || /Android/i.test(navigator.userAgent);
            const isAndroidAuto = isAndroid && 
                                  (window.matchMedia('(display-mode: standalone)').matches ||
                                   document.referrer.includes('android-app://'));
            
            // Audio focus detection (best effort)
            let audioFocusHint = 'unknown';
            if (hasMediaSession && metadata) {
                if (mediaSessionState === 'playing' && howlPlaying) {
                    audioFocusHint = 'likely have focus';
                } else if (mediaSessionState === 'playing' && !howlPlaying) {
                    audioFocusHint = 'MISMATCH - may have lost focus';
                } else if (mediaSessionState === 'paused' && !howlPlaying) {
                    audioFocusHint = 'paused (normal)';
                } else {
                    audioFocusHint = 'uncertain';
                }
            }
            
            // State mismatch detection
            const hasMismatch = (mediaSessionState === 'playing' && !howlPlaying) ||
                               (mediaSessionState === 'paused' && howlPlaying) ||
                               (APP.isPlaying && !howlPlaying && !APP.isTransitioning);
            
            return `
                <div class="debug-panel-title">MEDIA SESSION / ANDROID</div>
                
                <div class="debug-section">
                    <div class="debug-section-title">\uD83D\uDCBE Track Source</div>
                    <div class="debug-metric-simple">
                        <span class="debug-metric-key">Playing From</span>
                        <span class="debug-metric-val ${isCached ? 'good' : 'warn'}" style="font-weight: bold; font-size: 12px;">
                            ${cacheStatus.toUpperCase()}
                            ${isExplicitDownload ? ' (downloaded)' : isCached ? ' (auto-cached)' : ''}
                        </span>
                    </div>
                    <div class="debug-metric-simple">
                        <span class="debug-metric-key">Cached URLs</span>
                        <span class="debug-metric-val">${APP.cachedUrls?.size || 0} files</span>
                    </div>
                </div>
                
                <div class="debug-section ${hasMismatch ? 'debug-warnings' : ''}">
                    <div class="debug-section-title">Media Session API ${hasMismatch ? '\u26A0 MISMATCH' : ''}</div>
                    <div class="debug-metric-simple">
                        <span class="debug-metric-key">API Supported</span>
                        <span class="debug-metric-val ${hasMediaSession ? 'good' : 'bad'}">${hasMediaSession}</span>
                    </div>
                    <div class="debug-metric-simple">
                        <span class="debug-metric-key">Session State</span>
                        <span class="debug-metric-val ${mediaSessionState === 'playing' ? 'good' : mediaSessionState === 'paused' ? 'warn' : ''}">${mediaSessionState}</span>
                    </div>
                    <div class="debug-metric-simple">
                        <span class="debug-metric-key">Howl Playing</span>
                        <span class="debug-metric-val ${howlPlaying ? 'good' : 'warn'}">${howlPlaying}</span>
                    </div>
                    <div class="debug-metric-simple">
                        <span class="debug-metric-key">APP.isPlaying</span>
                        <span class="debug-metric-val ${APP.isPlaying ? 'good' : 'warn'}">${APP.isPlaying}</span>
                    </div>
                    <div class="debug-metric-simple">
                        <span class="debug-metric-key">Audio Focus</span>
                        <span class="debug-metric-val ${audioFocusHint.includes('MISMATCH') ? 'bad' : audioFocusHint.includes('likely') ? 'good' : ''}">${audioFocusHint}</span>
                    </div>
                    ${metadata ? `
                    <div class="debug-metric-simple">
                        <span class="debug-metric-key">Metadata</span>
                        <span class="debug-metric-val">${metadata.title || 'none'} - ${metadata.artist || 'none'}</span>
                    </div>
                    ` : `
                    <div class="debug-metric-simple">
                        <span class="debug-metric-key">Metadata</span>
                        <span class="debug-metric-val bad">NOT SET</span>
                    </div>
                    `}
                </div>
                
                <div class="debug-section">
                    <div class="debug-section-title">\uD83D\uDD0A Audio Element State</div>
                    <div class="debug-metric-simple">
                        <span class="debug-metric-key">Ready State</span>
                        <span class="debug-metric-val">${audioReadyState}</span>
                    </div>
                    <div class="debug-metric-simple">
                        <span class="debug-metric-key">Network State</span>
                        <span class="debug-metric-val">${audioNetworkState}</span>
                    </div>
                    <div class="debug-metric-simple">
                        <span class="debug-metric-key">Element Paused</span>
                        <span class="debug-metric-val">${audioPaused}</span>
                    </div>
                    <div class="debug-metric-simple">
                        <span class="debug-metric-key">Howl State</span>
                        <span class="debug-metric-val">${howlState}</span>
                    </div>
                </div>
                
                <div class="debug-section">
                    <div class="debug-section-title">\uD83E\uDD16 Android Detection</div>
                    <div class="debug-metric-simple">
                        <span class="debug-metric-key">Is Android</span>
                        <span class="debug-metric-val">${isAndroid}</span>
                    </div>
                    <div class="debug-metric-simple">
                        <span class="debug-metric-key">Android Auto Hint</span>
                        <span class="debug-metric-val ${isAndroidAuto ? 'warn' : ''}">${isAndroidAuto ? 'POSSIBLE' : 'no'}</span>
                    </div>
                    <div class="debug-metric-simple">
                        <span class="debug-metric-key">PWA Mode</span>
                        <span class="debug-metric-val">${APP.isPWA}</span>
                    </div>
                    <div class="debug-metric-simple">
                        <span class="debug-metric-key">Page Visible</span>
                        <span class="debug-metric-val">${APP.pageVisible}</span>
                    </div>
                </div>
                
                <div class="debug-section debug-media-actions">
                    <div class="debug-section-title">\u2699\uFE0F Media Controls</div>
                    <div class="debug-action-grid">
                        <button class="debug-action-btn primary" id="debug-media-reclaim" title="Reclaim audio focus from other apps">
                            \uD83C\uDFAF Reclaim Focus
                        </button>
                        <button class="debug-action-btn" id="debug-media-reregister" title="Re-register all media session handlers">
                            \uD83D\uDD04 Re-register Handlers
                        </button>
                        <button class="debug-action-btn" id="debug-media-refresh" title="Force refresh metadata">
                            \uD83C\uDFB5 Refresh Metadata
                        </button>
                        <button class="debug-action-btn" id="debug-media-set-playing" title="Set state to playing">
                            \u25B6 Force Playing
                        </button>
                        <button class="debug-action-btn" id="debug-media-set-paused" title="Set state to paused">
                            \u23F8 Force Paused
                        </button>
                        <button class="debug-action-btn" id="debug-media-touch-audio" title="Touch audio element">
                            \uD83D\uDC46 Touch Audio
                        </button>
                        <button class="debug-action-btn" id="debug-media-resume-ctx" title="Resume AudioContext">
                            \u26A1 Resume Context
                        </button>
                        <button class="debug-action-btn" id="debug-media-full-reset" title="Full media session reset">
                            \uD83D\uDD03 Full Reset
                        </button>
                    </div>
                </div>
                
                <div class="debug-metric-track debug-url-display">
                    <span class="debug-metric-key">Audio URL</span>
                    <span class="debug-metric-val">${audioSrc ? audioSrc.substring(0, 80) + '...' : 'none'}</span>
                </div>
            `;
        },
        
        device() {
            const mode = DeviceMode.detect();
            const warnings = DeviceMode.getWarnings();
            
            return `
                <div class="debug-panel-title">DEVICE / PLATFORM</div>
                <div class="debug-device-toggle">
                    <button class="debug-device-btn ${mode === 'mobile' ? 'active' : ''}" data-mode="mobile">Mobile</button>
                    <button class="debug-device-btn ${mode === 'desktop' ? 'active' : ''}" data-mode="desktop">Desktop</button>
                </div>
                <div class="debug-section">
                    <div class="debug-section-title">Platform</div>
                    <div class="debug-metric-simple">
                        <span class="debug-metric-key">iOS</span>
                        <span class="debug-metric-val">${APP.isIOS}</span>
                    </div>
                    <div class="debug-metric-simple">
                        <span class="debug-metric-key">Android</span>
                        <span class="debug-metric-val">${APP.isAndroid}</span>
                    </div>
                    <div class="debug-metric-simple">
                        <span class="debug-metric-key">Mobile</span>
                        <span class="debug-metric-val">${APP.isMobile}</span>
                    </div>
                    <div class="debug-metric-simple">
                        <span class="debug-metric-key">PWA Mode</span>
                        <span class="debug-metric-val">${APP.isPWA}</span>
                    </div>
                    <div class="debug-metric-simple">
                        <span class="debug-metric-key">Viewport</span>
                        <span class="debug-metric-val">${window.innerWidth} × ${window.innerHeight} @ ${window.devicePixelRatio}x</span>
                    </div>
                </div>
                ${warnings.length > 0 ? `
                <div class="debug-section debug-warnings">
                    <div class="debug-section-title">\u26A0 Platform Warnings</div>
                    ${warnings.map(w => `
                        <div class="debug-warning ${w.level}">
                            <span class="debug-warning-icon">${w.level === 'error' ? '\u274C' : w.level === 'warn' ? '\u26A0' : '\u2139'}</span>
                            <span class="debug-warning-msg">${w.message}</span>
                        </div>
                    `).join('')}
                </div>
                ` : ''}
            `;
        },
        
        logs() {
            return `
                <div class="debug-log-header">
                    <input type="text" class="debug-log-search" id="debug-log-search" placeholder="Search logs..." value="${logs.searchQuery}">
                    <select class="debug-log-level" id="debug-log-level">
                        <option value="3" ${logs.levelFilter === 3 ? 'selected' : ''}>All</option>
                        <option value="2" ${logs.levelFilter === 2 ? 'selected' : ''}>Info+</option>
                        <option value="1" ${logs.levelFilter === 1 ? 'selected' : ''}>Warn+</option>
                        <option value="0" ${logs.levelFilter === 0 ? 'selected' : ''}>Errors</option>
                    </select>
                    <button class="debug-log-btn" id="debug-log-pause">${logs.isPaused ? '\u25B6' : '\u23F8'}</button>
                    <button class="debug-log-btn" id="debug-log-export">\uD83D\uDCCB</button>
                    <button class="debug-log-btn" id="debug-log-clear">\uD83D\uDDD1</button>
                </div>
                <div class="debug-cat-toggles" id="debug-cat-toggles">
                    ${Object.keys(logs.categories).map(cat => `
                        <button class="debug-cat-btn ${logs.categories[cat] ? 'active' : ''}" data-cat="${cat}">
                            ${ICONS[cat] || ''} ${cat}
                        </button>
                    `).join('')}
                </div>
                <div class="debug-log-container" id="debug-log-container"></div>
                <div class="debug-log-status" id="debug-log-status">
                    ${logs.filteredEntries.length} of ${logs.entries.length} entries${logs.isPaused ? ' (PAUSED)' : ''}
                </div>
            `;
        }
    };
    
    // =========================================================================
    // HELPER FUNCTIONS
    // =========================================================================
    function formatTime(seconds) {
        if (!seconds || !isFinite(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }
    
    function timestamp() {
        return new Date().toTimeString().substr(0, 12);
    }
    
    function getStateClass(stateValue) {
        const goodStates = ['playing', 'running', 'active', 'ready', 'visible', 'online_sw', 'true'];
        const warnStates = ['loading', 'transitioning', 'paused', 'suspended', 'pending', 'online', 'visible_bg'];
        const badStates = ['stopped', 'error', 'closed', 'none', 'offline', 'hidden', 'false'];
        
        if (goodStates.includes(stateValue)) return 'good';
        if (warnStates.includes(stateValue)) return 'warn';
        if (badStates.includes(stateValue)) return 'bad';
        return '';
    }
    
    function loadState() {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                const data = JSON.parse(saved);
                state.corner = data.corner || 'top-left';
                state.collapsed = data.collapsed === true;
                state.activeTab = data.activeTab || 'playback';
                state.floatX = data.floatX || 100;
                state.floatY = data.floatY || 100;
                // Don't restore mode - always start docked
                return true;
            }
        } catch (e) {}
        return false;
    }
    
    function saveState() {
        try {
            if (state.enabled) {
                localStorage.setItem(STORAGE_KEY, JSON.stringify({
                    corner: state.corner,
                    collapsed: state.collapsed,
                    activeTab: state.activeTab,
                    floatX: state.floatX,
                    floatY: state.floatY
                }));
            }
        } catch (e) {}
    }
    
    function clearSavedState() {
        try {
            localStorage.removeItem(STORAGE_KEY);
        } catch (e) {}
    }
    
    // =========================================================================
    // LOG FILTERING & RENDERING
    // =========================================================================
    function applyLogFilters() {
        const levelMap = { ERROR: 0, WARN: 1 };
        
        logs.filteredEntries = logs.entries.filter(entry => {
            // Category filter
            if (!logs.categories[entry.category]) return false;
            
            // Level filter
            const entryLevel = levelMap[entry.category] ?? 2;
            if (entryLevel > logs.levelFilter) return false;
            
            // Search filter
            if (logs.searchQuery) {
                const searchable = `${entry.category} ${entry.message} ${JSON.stringify(entry.data)}`.toLowerCase();
                if (!searchable.includes(logs.searchQuery.toLowerCase())) return false;
            }
            
            return true;
        });
    }
    
    function renderLogEntries() {
        const container = document.getElementById('debug-log-container');
        if (!container) return;
        
        applyLogFilters();
        
        container.innerHTML = logs.filteredEntries.slice(0, 100).map(entry => {
            const hasData = entry.data !== null && entry.data !== undefined;
            const isExpanded = logs.expandedEntries.has(entry.id);
            
            return `
                <div class="debug-log-entry ${entry.category} ${hasData ? 'has-data' : ''} ${isExpanded ? 'expanded' : ''}" data-id="${entry.id}">
                    <div class="debug-log-entry-header" ${hasData ? `onclick="Debug._toggleLogEntry('${entry.id}')"` : ''}>
                        <span class="debug-log-time">${entry.timeString}</span>
                        ${hasData ? `<span class="debug-log-expand">${isExpanded ? '\u25BC' : '\u25B6'}</span>` : '<span class="debug-log-expand"></span>'}
                        <span class="debug-log-icon">${ICONS[entry.category] || ''}</span>
                        <span class="debug-log-cat">${entry.category}</span>
                        <span class="debug-log-msg">${entry.message}</span>
                    </div>
                    ${hasData ? `
                        <div class="debug-log-data ${isExpanded ? 'visible' : ''}">
                            <pre>${JSON.stringify(entry.data, null, 2)}</pre>
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');
        
        const status = document.getElementById('debug-log-status');
        if (status) {
            status.textContent = `${logs.filteredEntries.length} of ${logs.entries.length} entries${logs.isPaused ? ' (PAUSED)' : ''}`;
        }
    }
    
    function setupLogListeners() {
        const search = document.getElementById('debug-log-search');
        const level = document.getElementById('debug-log-level');
        const pause = document.getElementById('debug-log-pause');
        const exportBtn = document.getElementById('debug-log-export');
        const clear = document.getElementById('debug-log-clear');
        const catToggles = document.getElementById('debug-cat-toggles');
        
        if (search) {
            search.oninput = (e) => {
                logs.searchQuery = e.target.value;
                renderLogEntries();
            };
        }
        
        if (level) {
            level.onchange = (e) => {
                logs.levelFilter = parseInt(e.target.value);
                renderLogEntries();
            };
        }
        
        if (pause) {
            pause.onclick = () => {
                logs.isPaused = !logs.isPaused;
                pause.textContent = logs.isPaused ? '\u25B6' : '\u23F8';
                renderLogEntries();
            };
        }
        
        if (exportBtn) {
            exportBtn.onclick = async () => {
                const text = logs.entries.map(e => 
                    `[${e.timeString}] ${e.category.padEnd(10)} ${e.message}${e.data ? ' | ' + JSON.stringify(e.data) : ''}`
                ).join('\n');
                await navigator.clipboard.writeText(text);
                if (typeof showToast === 'function') {
                    showToast('Logs copied to clipboard', 2000, 'success');
                }
            };
        }
        
        if (clear) {
            clear.onclick = () => {
                logs.entries = [];
                logs.filteredEntries = [];
                logs.expandedEntries.clear();
                renderLogEntries();
            };
        }
        
        if (catToggles) {
            catToggles.querySelectorAll('.debug-cat-btn').forEach(btn => {
                btn.onclick = () => {
                    const cat = btn.dataset.cat;
                    logs.categories[cat] = !logs.categories[cat];
                    btn.classList.toggle('active', logs.categories[cat]);
                    renderLogEntries();
                };
            });
        }
    }
    
    // =========================================================================
    // OVERLAY CREATION & MANAGEMENT
    // =========================================================================
    function createOverlay() {
        if (overlay) return;
        
        loadState();
        
        overlay = document.createElement('div');
        overlay.id = 'debug-overlay';
        overlay.className = `debug-v3 corner-${state.corner} ${state.collapsed ? 'collapsed' : ''}`;
        
        overlay.innerHTML = `
            <div class="debug-header" id="debug-header">
                <button class="debug-btn debug-collapse-btn" id="debug-collapse" title="Collapse">${state.collapsed ? EXPAND : COLLAPSE}</button>
                <button class="debug-btn debug-corner-btn" id="debug-corner" title="Rotate corner (clockwise)">\u21BB</button>
                <span class="debug-title">Debug v${VERSION}</span>
                <div class="debug-controls">
                    <button class="debug-btn" id="debug-float" title="Float window">\u2922</button>
                    <button class="debug-btn" id="debug-popout" title="Pop out">\u2197</button>
                    <button class="debug-btn" id="debug-close" title="Close">\u2715</button>
                </div>
            </div>
            <div class="debug-seekbar-container" id="debug-seekbar-container">
                <span class="debug-seek-time" id="debug-seek-current">0:00</span>
                <div class="debug-seekbar" id="debug-seekbar">
                    <div class="debug-seekbar-fill" id="debug-seekbar-fill"></div>
                    <div class="debug-seekbar-handle" id="debug-seekbar-handle"></div>
                </div>
                <span class="debug-seek-time" id="debug-seek-duration">0:00</span>
            </div>
            <div class="debug-nav" id="debug-nav">
                ${Object.keys(TAB_ICONS).map(tab => `
                    <button class="debug-nav-tab ${state.activeTab === tab ? 'active' : ''}" data-tab="${tab}">
                        ${TAB_ICONS[tab]}
                    </button>
                `).join('')}
            </div>
            <div class="debug-content" id="debug-content"></div>
        `;
        
        // Create styles
        const style = document.createElement('style');
        style.id = 'debug-styles-v3';
        style.textContent = getStyles();
        
        document.head.appendChild(style);
        document.body.appendChild(overlay);
        
        // Set up event listeners
        document.getElementById('debug-collapse').addEventListener('click', toggleCollapse);
        document.getElementById('debug-corner').addEventListener('click', rotateCorner);
        document.getElementById('debug-close').addEventListener('click', disable);
        document.getElementById('debug-float').addEventListener('click', toggleFloat);
        document.getElementById('debug-popout').addEventListener('click', popOut);
        
        // Drag functionality for floating mode
        const header = document.getElementById('debug-header');
        header.addEventListener('mousedown', startDrag);
        header.addEventListener('touchstart', startDrag, { passive: false });
        
        document.getElementById('debug-nav').addEventListener('click', (e) => {
            const tab = e.target.closest('.debug-nav-tab');
            if (tab) {
                setTab(tab.dataset.tab);
            }
        });
        
        // Set up seek bar interaction
        setupSeekBar();
        
        // Initial render
        renderPanel();
        startUpdaters();
    }
    
    // =========================================================================
    // SEEK BAR FUNCTIONALITY
    // =========================================================================
    function setupSeekBar() {
        const seekbar = document.getElementById('debug-seekbar');
        if (!seekbar) return;
        
        let isSeeking = false;
        
        function getSeekPosition(e) {
            const rect = seekbar.getBoundingClientRect();
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            let percent = (clientX - rect.left) / rect.width;
            return Math.max(0, Math.min(1, percent));
        }
        
        function seekTo(percent) {
            if (!APP.currentHowl) return;
            const duration = APP.currentHowl.duration() || 0;
            if (duration > 0) {
                const seekTime = percent * duration;
                APP.currentHowl.seek(seekTime);
                updateSeekBar(); // Immediate visual feedback
            }
        }
        
        function startSeek(e) {
            e.preventDefault();
            isSeeking = true;
            seekbar.classList.add('seeking');
            const percent = getSeekPosition(e);
            updateSeekBarVisual(percent);
        }
        
        function doSeek(e) {
            if (!isSeeking) return;
            e.preventDefault();
            const percent = getSeekPosition(e);
            updateSeekBarVisual(percent);
        }
        
        function endSeek(e) {
            if (!isSeeking) return;
            isSeeking = false;
            seekbar.classList.remove('seeking');
            const percent = getSeekPosition(e.changedTouches ? e.changedTouches[0] : e);
            seekTo(percent);
        }
        
        function updateSeekBarVisual(percent) {
            const fill = document.getElementById('debug-seekbar-fill');
            const handle = document.getElementById('debug-seekbar-handle');
            if (fill) fill.style.width = (percent * 100) + '%';
            if (handle) handle.style.left = (percent * 100) + '%';
            
            // Update time display during seek
            if (APP.currentHowl) {
                const duration = APP.currentHowl.duration() || 0;
                const currentEl = document.getElementById('debug-seek-current');
                if (currentEl) currentEl.textContent = formatTime(percent * duration);
            }
        }
        
        seekbar.addEventListener('mousedown', startSeek);
        seekbar.addEventListener('touchstart', startSeek, { passive: false });
        
        document.addEventListener('mousemove', doSeek);
        document.addEventListener('touchmove', doSeek, { passive: false });
        
        document.addEventListener('mouseup', endSeek);
        document.addEventListener('touchend', endSeek);
        
        // Click to seek (for simple clicks without drag)
        seekbar.addEventListener('click', (e) => {
            if (!isSeeking) {
                const percent = getSeekPosition(e);
                seekTo(percent);
            }
        });
    }
    
    function updateSeekBar() {
        const fill = document.getElementById('debug-seekbar-fill');
        const handle = document.getElementById('debug-seekbar-handle');
        const currentEl = document.getElementById('debug-seek-current');
        const durationEl = document.getElementById('debug-seek-duration');
        const seekbar = document.getElementById('debug-seekbar');
        
        if (!fill || !currentEl || !durationEl) return;
        
        // Don't update while user is seeking
        if (seekbar?.classList.contains('seeking')) return;
        
        let position = 0;
        let duration = 0;
        let percent = 0;
        
        if (APP.currentHowl) {
            position = APP.currentHowl.seek() || 0;
            duration = APP.currentHowl.duration() || 0;
            percent = duration > 0 ? (position / duration) * 100 : 0;
        }
        
        fill.style.width = percent + '%';
        if (handle) handle.style.left = percent + '%';
        currentEl.textContent = formatTime(position);
        durationEl.textContent = formatTime(duration);
    }
    
    // =========================================================================
    // FLOATING MODE - DRAG FUNCTIONALITY
    // =========================================================================
    function startDrag(e) {
        if (state.mode !== 'floating') return;
        if (e.target.closest('.debug-btn')) return; // Don't drag when clicking buttons
        
        e.preventDefault();
        state.isDragging = true;
        
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        
        const rect = overlay.getBoundingClientRect();
        state.dragOffsetX = clientX - rect.left;
        state.dragOffsetY = clientY - rect.top;
        
        document.addEventListener('mousemove', doDrag);
        document.addEventListener('mouseup', endDrag);
        document.addEventListener('touchmove', doDrag, { passive: false });
        document.addEventListener('touchend', endDrag);
        
        overlay.style.cursor = 'grabbing';
    }
    
    function doDrag(e) {
        if (!state.isDragging) return;
        e.preventDefault();
        
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        
        let newX = clientX - state.dragOffsetX;
        let newY = clientY - state.dragOffsetY;
        
        // Keep within viewport bounds
        const maxX = window.innerWidth - overlay.offsetWidth;
        const maxY = window.innerHeight - overlay.offsetHeight;
        newX = Math.max(0, Math.min(newX, maxX));
        newY = Math.max(0, Math.min(newY, maxY));
        
        state.floatX = newX;
        state.floatY = newY;
        
        overlay.style.left = newX + 'px';
        overlay.style.top = newY + 'px';
    }
    
    function endDrag() {
        state.isDragging = false;
        document.removeEventListener('mousemove', doDrag);
        document.removeEventListener('mouseup', endDrag);
        document.removeEventListener('touchmove', doDrag);
        document.removeEventListener('touchend', endDrag);
        
        if (overlay) overlay.style.cursor = '';
        saveState();
    }
    
    function toggleFloat() {
        if (state.mode === 'floating') {
            // Return to docked mode
            state.mode = 'docked';
            overlay.classList.remove('floating');
            overlay.style.left = '';
            overlay.style.top = '';
            overlay.style.right = '';
            overlay.style.bottom = '';
            overlay.style.transform = '';
            
            // Re-add corner class
            overlay.classList.add('corner-' + state.corner);
            
            const floatBtn = document.getElementById('debug-float');
            if (floatBtn) {
                floatBtn.innerHTML = '\u2922'; // ⤢
                floatBtn.title = 'Float window';
            }
            
            // Show corner button in docked mode
            const cornerBtn = document.getElementById('debug-corner');
            if (cornerBtn) cornerBtn.style.display = '';
        } else {
            // Enter floating mode
            state.mode = 'floating';
            
            // Remove corner classes
            overlay.classList.remove('corner-top-left', 'corner-top-right', 'corner-bottom-right', 'corner-bottom-left');
            overlay.classList.add('floating');
            
            // Clear docked positioning and set float position
            overlay.style.top = state.floatY + 'px';
            overlay.style.left = state.floatX + 'px';
            overlay.style.right = 'auto';
            overlay.style.bottom = 'auto';
            overlay.style.transform = 'none';
            
            const floatBtn = document.getElementById('debug-float');
            if (floatBtn) {
                floatBtn.innerHTML = '\u2906'; // ⤆ dock icon
                floatBtn.title = 'Dock window';
            }
            
            // Hide corner button in floating mode (not needed)
            const cornerBtn = document.getElementById('debug-corner');
            if (cornerBtn) cornerBtn.style.display = 'none';
        }
        saveState();
    }
    
    // =========================================================================
    // POP-OUT WINDOW
    // =========================================================================
    function popOut() {
        // Ensure broadcast channel exists (should be created in enable())
        if (!state.popoutChannel) {
            state.popoutChannel = new BroadcastChannel('zenith_debug_popout');
            state.popoutChannel.onmessage = (e) => {
                if (e.data.type === 'REDOCK') {
                    reDock();
                }
            };
        }
        
        const html = generatePopoutHTML();
        const blob = new Blob([html], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        
        state.popoutWindow = window.open(url, 'ZenithDebug', 
            'width=500,height=600,menubar=no,toolbar=no,location=no,status=no,resizable=yes');
        
        if (state.popoutWindow) {
            state.mode = 'popout';
            // Hide the main overlay
            if (overlay) overlay.style.display = 'none';
            
            // Send initial state
            setTimeout(() => {
                sendToPopout('INIT', {
                    metrics: { ...metrics },
                    sparklines: renderSparklineStrings(),
                    state: collectFullState(),
                    logs: logs.entries.slice(0, 100),
                    activeTab: state.activeTab
                });
            }, 500);
            
            // Check if popout was closed
            const checkClosed = setInterval(() => {
                if (state.popoutWindow?.closed) {
                    clearInterval(checkClosed);
                    reDock();
                }
            }, 500);
        }
    }
    
    function sendToPopout(type, data) {
        if (state.popoutChannel && state.popoutWindow && !state.popoutWindow.closed) {
            state.popoutChannel.postMessage({ type, data, timestamp: Date.now() });
        }
    }
    
    function reDock() {
        state.mode = 'docked';
        
        if (state.popoutWindow && !state.popoutWindow.closed) {
            state.popoutWindow.close();
        }
        state.popoutWindow = null;
        
        // Note: Don't close popoutChannel here - it's managed by enable/disable
        
        // Show the main overlay again
        if (overlay) {
            overlay.style.display = '';
            overlay.classList.remove('floating');
            overlay.style.left = '';
            overlay.style.top = '';
            overlay.style.right = '';
            overlay.style.bottom = '';
            overlay.style.transform = '';
            
            // Re-add corner class
            overlay.classList.add('corner-' + state.corner);
        }
        
        // Reset float button
        const floatBtn = document.getElementById('debug-float');
        if (floatBtn) {
            floatBtn.innerHTML = '\u2922';
            floatBtn.title = 'Float window';
        }
        
        const cornerBtn = document.getElementById('debug-corner');
        if (cornerBtn) cornerBtn.style.display = '';
    }
    
    function generatePopoutHTML() {
        return `<!DOCTYPE html>
<html>
<head>
    <title>Zenith Debug</title>
    <meta charset="UTF-8">
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            background: #0a0a0a;
            color: #0f0;
            font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
            font-size: 11px;
            padding: 10px;
            height: 100vh;
            display: flex;
            flex-direction: column;
        }
        .header {
            display: flex;
            align-items: center;
            padding: 8px;
            background: #111;
            border: 1px solid #0f0;
            border-radius: 4px;
            margin-bottom: 10px;
            gap: 8px;
        }
        .title { flex: 1; font-weight: bold; font-size: 12px; }
        .btn {
            background: #222;
            color: #0f0;
            border: 1px solid #0f0;
            padding: 4px 10px;
            border-radius: 4px;
            cursor: pointer;
            font-family: inherit;
        }
        .btn:hover { background: #0f0; color: #000; }
        .nav {
            display: flex;
            gap: 4px;
            margin-bottom: 10px;
            flex-wrap: wrap;
        }
        .nav-tab {
            background: transparent;
            border: 1px solid #444;
            color: #888;
            padding: 6px 10px;
            border-radius: 3px;
            cursor: pointer;
            font-size: 10px;
            text-transform: uppercase;
        }
        .nav-tab:hover { border-color: #666; color: #aaa; }
        .nav-tab.active { background: #0f0; border-color: #0f0; color: #000; }
        .content {
            flex: 1;
            overflow-y: auto;
            background: #111;
            border: 1px solid #333;
            border-radius: 4px;
            padding: 10px;
        }
        .metric-row { margin-bottom: 6px; display: flex; justify-content: space-between; align-items: center; }
        .metric-row-spark { display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px; }
        .metric-key { color: #888; font-size: 10px; text-transform: uppercase; }
        .metric-val { font-weight: 500; color: #0f0; text-align: right; transition: color 1s ease; }
        .metric-val.good { color: #22c55e; }
        .metric-val.warn { color: #f59e0b; }
        .metric-val.bad { color: #ef4444; }
        .section { background: rgba(0,0,0,0.3); border: 1px solid #333; border-radius: 4px; padding: 8px; margin-bottom: 10px; }
        .section-title { font-size: 10px; color: #0f0; text-transform: uppercase; margin-bottom: 6px; border-bottom: 1px solid #333; padding-bottom: 4px; }
        .log-entry { padding: 4px 0; border-bottom: 1px solid #1a1a1a; font-size: 10px; word-break: break-word; }
        .log-entry.ERROR { color: #ef4444; }
        .log-entry.WARN { color: #f59e0b; }
        .log-time { color: #666; margin-right: 8px; }
        .log-cat { color: #0f0; margin-right: 8px; font-weight: bold; }
        .status { text-align: center; color: #666; padding: 10px; font-size: 10px; }
        .progress-bar { height: 4px; background: #333; border-radius: 2px; margin-top: 4px; }
        .progress-fill { height: 100%; background: #0f0; border-radius: 2px; transition: width 0.3s; }
        .gain-row { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
        .gain-label { width: 50px; color: #888; font-size: 10px; }
        .gain-bar { flex: 1; height: 6px; background: #333; border-radius: 3px; }
        .gain-fill { height: 100%; background: #0f0; border-radius: 3px; }
        .gain-fill.static { background: #f59e0b; }
        .gain-val { width: 35px; text-align: right; font-size: 10px; }
        .track-info { color: #888; font-size: 10px; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .seekbar-container { display: flex; align-items: center; gap: 8px; padding: 8px; background: rgba(0,0,0,0.5); border: 1px solid #333; border-radius: 4px; margin-bottom: 10px; }
        .seek-time { font-size: 10px; color: #888; min-width: 32px; font-variant-numeric: tabular-nums; }
        .seek-time:last-child { text-align: right; }
        .seekbar { flex: 1; height: 8px; background: #333; border-radius: 4px; position: relative; }
        .seekbar-fill { height: 100%; background: linear-gradient(90deg, #0a0, #0f0); border-radius: 4px; width: 0%; transition: width 0.25s linear; }
        .debug-spark { display: block; margin: 2px 0 6px 0; border-radius: 1px; opacity: 0.9; }
        .debug-spark-buffer { display: block; margin: 4px 0 6px 0; border-radius: 2px; opacity: 0.9; background: rgba(0,0,0,0.3); }
    </style>
</head>
<body>
    <div class="header">
        <span class="title">Zenith Debug (Pop-out)</span>
        <button class="btn" onclick="reDock()">Dock</button>
    </div>
    <div class="seekbar-container" id="seekbar-container">
        <span class="seek-time" id="seek-current">0:00</span>
        <div class="seekbar" id="seekbar">
            <div class="seekbar-fill" id="seekbar-fill"></div>
        </div>
        <span class="seek-time" id="seek-duration">0:00</span>
    </div>
    <div class="nav" id="nav"></div>
    <div class="content" id="content">
        <div class="status">Connecting to main window...</div>
    </div>
    <script>
        var TABS = ['playback', 'audio', 'network', 'pwa', 'device', 'logs'];
        var activeTab = 'playback';
        var currentData = { metrics: {}, logs: [], state: {}, sparklines: {} };
        
        var channel = new BroadcastChannel('zenith_debug_popout');
        
        channel.onmessage = function(e) {
            console.log('Popout received:', e.data.type);
            if (e.data.type === 'INIT') {
                currentData.metrics = e.data.data.metrics || {};
                currentData.state = e.data.data.state || {};
                currentData.sparklines = e.data.data.sparklines || {};
                currentData.logs = e.data.data.logs || [];
                activeTab = e.data.data.activeTab || 'playback';
                renderNav();
                renderContent();
            } else if (e.data.type === 'UPDATE') {
                currentData.metrics = e.data.data.metrics || {};
                currentData.state = e.data.data.state || {};
                currentData.sparklines = e.data.data.sparklines || {};
                renderContent();
            } else if (e.data.type === 'LOG') {
                currentData.logs.unshift(e.data.data);
                if (currentData.logs.length > 100) currentData.logs.pop();
                if (activeTab === 'logs') renderContent();
            } else if (e.data.type === 'CLOSE') {
                window.close();
            }
        };
        
        function renderNav() {
            document.getElementById('nav').innerHTML = TABS.map(function(tab) {
                return '<button class="nav-tab ' + (activeTab === tab ? 'active' : '') + '" data-tab="' + tab + '">' + tab + '</button>';
            }).join('');
            
            document.querySelectorAll('.nav-tab').forEach(function(btn) {
                btn.onclick = function() {
                    activeTab = this.dataset.tab;
                    renderNav();
                    renderContent();
                };
            });
        }
        
        function formatTime(sec) {
            if (!sec || isNaN(sec)) return '0:00';
            var m = Math.floor(sec / 60);
            var s = Math.floor(sec % 60);
            return m + ':' + (s < 10 ? '0' : '') + s;
        }
        
        function stateClass(val) {
            if (val === 'playing' || val === 'running' || val === 'active' || val === true || val === 'true' || val === 'visible') return 'good';
            if (val === 'paused' || val === 'suspended' || val === 'pending' || val === false || val === 'false') return 'warn';
            if (val === 'stopped' || val === 'closed' || val === 'error' || val === 'hidden') return 'bad';
            return '';
        }
        
        function row(key, val, cls) {
            return '<div class="metric-row"><span class="metric-key">' + key + '</span><span class="metric-val ' + (cls || stateClass(val)) + '">' + val + '</span></div>';
        }
        
        function updateSeekBar() {
            var s = currentData.state || {};
            var pos = s.position || 0;
            var dur = s.duration || 0;
            var pct = dur > 0 ? (pos / dur * 100) : 0;
            
            var fill = document.getElementById('seekbar-fill');
            var currentEl = document.getElementById('seek-current');
            var durationEl = document.getElementById('seek-duration');
            
            if (fill) fill.style.width = pct + '%';
            if (currentEl) currentEl.textContent = formatTime(pos);
            if (durationEl) durationEl.textContent = formatTime(dur);
        }
        
        function renderContent() {
            var el = document.getElementById('content');
            var s = currentData.state || {};
            var sp = currentData.sparklines || {};
            var html = '';
            
            // Always update seek bar
            updateSeekBar();
            
            if (activeTab === 'logs') {
                if (!currentData.logs || currentData.logs.length === 0) {
                    html = '<div class="status">No logs yet</div>';
                } else {
                    html = currentData.logs.map(function(l) {
                        return '<div class="log-entry ' + l.category + '"><span class="log-time">' + l.timeString + '</span><span class="log-cat">' + l.category + '</span>' + l.message + '</div>';
                    }).join('');
                }
            } else if (activeTab === 'playback') {
                var pos = s.position || 0;
                var dur = s.duration || 0;
                var pct = dur > 0 ? (pos / dur * 100) : 0;
                
                html = '<div class="section"><div class="section-title">Playback State</div>' +
                    '<div class="metric-row-spark"><span class="metric-key">State</span><span class="metric-val ' + stateClass(s.playbackState) + '">' + (s.playbackState || 'unknown') + '</span></div>' +
                    (sp.playback || '') +
                    '<div class="metric-row-spark"><span class="metric-key">Howl</span><span class="metric-val ' + stateClass(s.howlState) + '">' + (s.howlState || 'none') + '</span></div>' +
                    (sp.howl || '') +
                    '<div class="metric-row-spark"><span class="metric-key">Buffer</span><span class="metric-val ' + (s.bufferHealth || '') + '">' + (s.bufferSeconds || 0) + 's ahead</span></div>' +
                    (sp.buffer || '') +
                    '</div>' +
                    '<div class="section"><div class="section-title">Position</div>' +
                    row('Time', formatTime(pos) + ' / ' + formatTime(dur)) +
                    '<div class="progress-bar"><div class="progress-fill" style="width:' + pct + '%"></div></div>' +
                    '</div>' +
                    '<div class="section"><div class="section-title">Track Info</div>' +
                    row('Volume', Math.round((s.volume || 0) * 100) + '%') +
                    row('Band', s.band || 'N/A') +
                    row('Index', s.currentIndex + (s.nextIndex >= 0 ? ' -> ' + s.nextIndex : '') + ' / ' + s.trackCount) +
                    row('Transitioning', s.isTransitioning) +
                    row('Paused', s.manuallyPaused) +
                    (s.trackArtist ? '<div class="track-info">Now: ' + s.trackArtist + ' - ' + s.trackTitle + '</div>' : '') +
                    (s.nextArtist ? '<div class="track-info">Next: ' + s.nextArtist + ' - ' + s.nextTitle + '</div>' : '') +
                    '</div>';
            } else if (activeTab === 'audio') {
                var masterPct = Math.round((s.masterGain || 0) * 100);
                var musicPct = Math.round((s.musicGain || 0) * 100);
                var staticPct = Math.round((s.staticGain || 0) * 100);
                
                html = '<div class="section"><div class="section-title">Audio Context</div>' +
                    '<div class="metric-row-spark"><span class="metric-key">State</span><span class="metric-val ' + stateClass(s.audioContextState) + '">' + (s.audioContextState || 'unknown') + '</span></div>' +
                    (sp.audioContext || '') +
                    row('Sample Rate', (s.sampleRate || 0) + ' Hz') +
                    '</div>' +
                    '<div class="section"><div class="section-title">Gain Nodes</div>' +
                    '<div class="gain-row"><span class="gain-label">Master</span><div class="gain-bar"><div class="gain-fill" style="width:' + masterPct + '%"></div></div><span class="gain-val">' + (s.masterGain || 0).toFixed(2) + '</span></div>' +
                    '<div class="gain-row"><span class="gain-label">Music</span><div class="gain-bar"><div class="gain-fill" style="width:' + musicPct + '%"></div></div><span class="gain-val">' + (s.musicGain || 0).toFixed(2) + '</span></div>' +
                    '<div class="gain-row"><span class="gain-label">Static</span><div class="gain-bar"><div class="gain-fill static" style="width:' + staticPct + '%"></div></div><span class="gain-val">' + (s.staticGain || 0).toFixed(2) + '</span></div>' +
                    '</div>' +
                    '<div class="section"><div class="section-title">Nodes</div>' +
                    row('Static Node', s.staticNodeActive ? 'active' : 'none') +
                    '</div>';
            } else if (activeTab === 'network') {
                html = '<div class="section"><div class="section-title">Connection</div>' +
                    '<div class="metric-row-spark"><span class="metric-key">Online</span><span class="metric-val ' + stateClass(s.isOnline) + '">' + s.isOnline + '</span></div>' +
                    (sp.network || '') +
                    row('Type', s.connectionType || 'unknown') +
                    row('Downlink', (s.downlink || 0) + ' Mbps') +
                    row('RTT', (s.rtt || 0) + ' ms') +
                    '</div>' +
                    '<div class="section"><div class="section-title">Service Worker</div>' +
                    row('Ready', s.swReady) +
                    row('Cached URLs', s.cachedUrls || 0) +
                    '</div>';
            } else if (activeTab === 'pwa') {
                html = '<div class="section"><div class="section-title">Lifecycle</div>' +
                    '<div class="metric-row-spark"><span class="metric-key">Visibility</span><span class="metric-val ' + stateClass(s.pageVisible ? 'visible' : 'hidden') + '">' + (s.pageVisible ? 'visible' : 'hidden') + '</span></div>' +
                    (sp.visibility || '') +
                    '<div class="metric-row-spark"><span class="metric-key">Background</span><span class="metric-val ' + (s.isBackgrounded ? 'warn' : 'good') + '">' + s.isBackgrounded + '</span></div>' +
                    (sp.background || '') +
                    row('PWA Mode', s.isPWA) +
                    '<div class="metric-row-spark"><span class="metric-key">Wake Lock</span><span class="metric-val ' + (s.wakeLock === 'active' ? 'good' : '') + '">' + (s.wakeLock || 'none') + '</span></div>' +
                    (sp.wakeLock || '') +
                    '</div>';
            } else if (activeTab === 'device') {
                html = '<div class="section"><div class="section-title">Platform</div>' +
                    row('iOS', s.isIOS) +
                    row('Android', s.isAndroid) +
                    row('Mobile', s.isMobile) +
                    row('PWA Mode', s.isPWA) +
                    '</div>' +
                    '<div class="section"><div class="section-title">Display</div>' +
                    row('Viewport', (s.viewportWidth || 0) + ' x ' + (s.viewportHeight || 0)) +
                    row('Pixel Ratio', (s.pixelRatio || 1) + 'x') +
                    '</div>';
            }
            
            el.innerHTML = html || '<div class="status">No data</div>';
        }
        
        function reDock() {
            channel.postMessage({ type: 'REDOCK' });
            window.close();
        }
        
        renderNav();
        document.getElementById('content').innerHTML = '<div class="status">Waiting for data from main window...</div>';
    </script>
</body>
</html>`;
    }
    
    function destroyOverlay() {
        stopUpdaters();
        if (overlay) {
            overlay.remove();
            overlay = null;
        }
        const style = document.getElementById('debug-styles-v3');
        if (style) style.remove();
    }
    
    // =========================================================================
    // PANEL RENDERING
    // =========================================================================
    async function renderPanel() {
        const content = document.getElementById('debug-content');
        if (!content) return;
        
        let html = '';
        
        switch (state.activeTab) {
            case 'playback':
                html = Panels.playback();
                break;
            case 'audio':
                html = Panels.audio();
                break;
            case 'media':
                html = Panels.media();
                break;
            case 'network':
                html = await Panels.network();
                break;
            case 'pwa':
                html = Panels.pwa();
                break;
            case 'device':
                html = Panels.device();
                break;
            case 'logs':
                html = Panels.logs();
                break;
        }
        
        content.innerHTML = html;
        
        // Set up log-specific listeners
        if (state.activeTab === 'logs') {
            setupLogListeners();
            renderLogEntries();
        }
        
        // Set up media panel listeners
        if (state.activeTab === 'media') {
            setupMediaListeners();
        }
    }
    
    function setupMediaListeners() {
        // Safe toast helper
        const toast = (msg, duration, type) => {
            if (typeof showToast === 'function') {
                showToast(msg, duration, type);
            } else {
                console.log('[Debug Toast]', type, msg);
            }
        };
        
        // Refresh metadata button
        const refreshBtn = document.getElementById('debug-media-refresh');
        if (refreshBtn) {
            refreshBtn.onclick = () => {
                log('AUDIO', 'Manual metadata refresh triggered');
                if (typeof updateMediaSessionMetadata === 'function') {
                    const list = typeof getCurrentTrackList === 'function' ? getCurrentTrackList() : [];
                    const track = list?.[APP.currentIndex];
                    if (track) {
                        updateMediaSessionMetadata(track);
                        toast('Media metadata refreshed', 2000, 'success');
                    }
                }
                renderPanel();
            };
        }
        
        // Reclaim focus button
        const reclaimBtn = document.getElementById('debug-media-reclaim');
        if (reclaimBtn) {
            reclaimBtn.onclick = async () => {
                log('AUDIO', 'Attempting to reclaim audio focus');
                try {
                    // Resume AudioContext first
                    if (APP.audioContext?.state === 'suspended') {
                        await APP.audioContext.resume();
                        log('AUDIO', 'AudioContext resumed');
                    }
                    
                    // If we have a Howl, touch it
                    if (APP.currentHowl) {
                        const wasPlaying = APP.currentHowl.playing();
                        if (wasPlaying) {
                            // Brief pause/play to reclaim focus
                            APP.currentHowl.pause();
                            await new Promise(r => setTimeout(r, 100));
                            APP.currentHowl.play();
                        } else {
                            // Start playing to claim focus
                            APP.currentHowl.play();
                            APP.isPlaying = true;
                        }
                    }
                    
                    // Re-set media session state
                    if ('mediaSession' in navigator) {
                        navigator.mediaSession.playbackState = 'playing';
                        
                        // Force metadata refresh
                        const list = typeof getCurrentTrackList === 'function' ? getCurrentTrackList() : [];
                        const track = list?.[APP.currentIndex];
                        if (track && typeof updateMediaSessionMetadata === 'function') {
                            updateMediaSessionMetadata(track);
                        }
                    }
                    
                    toast('Audio focus reclaimed', 2000, 'success');
                } catch (e) {
                    error('Failed to reclaim focus', e);
                    toast('Failed to reclaim focus: ' + e.message, 3000, 'error');
                }
                renderPanel();
            };
        }
        
        // Set playing button
        const setPlayingBtn = document.getElementById('debug-media-set-playing');
        if (setPlayingBtn) {
            setPlayingBtn.onclick = () => {
                if ('mediaSession' in navigator) {
                    navigator.mediaSession.playbackState = 'playing';
                    log('AUDIO', 'Media Session state set to playing');
                    toast('State set to playing', 2000, 'info');
                }
                renderPanel();
            };
        }
        
        // Set paused button
        const setPausedBtn = document.getElementById('debug-media-set-paused');
        if (setPausedBtn) {
            setPausedBtn.onclick = () => {
                if ('mediaSession' in navigator) {
                    navigator.mediaSession.playbackState = 'paused';
                    log('AUDIO', 'Media Session state set to paused');
                    toast('State set to paused', 2000, 'info');
                }
                renderPanel();
            };
        }
        
        // Touch audio element button
        const touchAudioBtn = document.getElementById('debug-media-touch-audio');
        if (touchAudioBtn) {
            touchAudioBtn.onclick = async () => {
                log('AUDIO', 'Touching audio element');
                if (APP.currentHowl && APP.currentHowl._sounds?.[0]?._node) {
                    const audio = APP.currentHowl._sounds[0]._node;
                    try {
                        // Simulate user interaction
                        await audio.play();
                        toast('Audio element touched', 2000, 'success');
                    } catch (e) {
                        // If already playing, that's fine
                        if (e.name !== 'AbortError') {
                            error('Touch audio failed', e);
                        }
                    }
                } else {
                    toast('No audio element available', 2000, 'warn');
                }
                renderPanel();
            };
        }
        
        // Resume context button
        const resumeCtxBtn = document.getElementById('debug-media-resume-ctx');
        if (resumeCtxBtn) {
            resumeCtxBtn.onclick = async () => {
                log('AUDIO', 'Manual AudioContext resume');
                if (APP.audioContext) {
                    try {
                        await APP.audioContext.resume();
                        toast('AudioContext state: ' + APP.audioContext.state, 2000, 'success');
                    } catch (e) {
                        error('Resume failed', e);
                        toast('Resume failed: ' + e.message, 3000, 'error');
                    }
                } else {
                    toast('No AudioContext', 2000, 'warn');
                }
                renderPanel();
            };
        }
        
        // Re-register media session handlers button
        const reregisterBtn = document.getElementById('debug-media-reregister');
        if (reregisterBtn) {
            reregisterBtn.onclick = () => {
                log('AUDIO', 'Re-registering media session handlers');
                if (typeof setupMediaSession === 'function') {
                    setupMediaSession();
                    // Also refresh metadata
                    const list = typeof getCurrentTrackList === 'function' ? getCurrentTrackList() : [];
                    const track = list?.[APP.currentIndex];
                    if (track && typeof updateMediaSessionMetadata === 'function') {
                        updateMediaSessionMetadata(track);
                    }
                    toast('Media session handlers re-registered', 2000, 'success');
                } else {
                    toast('setupMediaSession not available', 2000, 'warn');
                }
                renderPanel();
            };
        }
        
        // Full reset button
        const fullResetBtn = document.getElementById('debug-media-full-reset');
        if (fullResetBtn) {
            fullResetBtn.onclick = async () => {
                log('AUDIO', 'Full media session reset initiated');
                try {
                    // 1. Stop current playback briefly
                    const wasPlaying = APP.currentHowl?.playing();
                    if (APP.currentHowl) {
                        APP.currentHowl.pause();
                    }
                    
                    // 2. Resume AudioContext
                    if (APP.audioContext?.state === 'suspended') {
                        await APP.audioContext.resume();
                        log('AUDIO', 'AudioContext resumed');
                    }
                    
                    // 3. Re-register all handlers
                    if (typeof setupMediaSession === 'function') {
                        setupMediaSession();
                    }
                    
                    // 4. Refresh metadata
                    const list = typeof getCurrentTrackList === 'function' ? getCurrentTrackList() : [];
                    const track = list?.[APP.currentIndex];
                    if (track && typeof updateMediaSessionMetadata === 'function') {
                        updateMediaSessionMetadata(track);
                    }
                    
                    // 5. Short delay then restart if was playing
                    await new Promise(r => setTimeout(r, 200));
                    
                    if (wasPlaying && APP.currentHowl) {
                        APP.currentHowl.play();
                        APP.isPlaying = true;
                        if ('mediaSession' in navigator) {
                            navigator.mediaSession.playbackState = 'playing';
                        }
                    }
                    
                    // 6. Update position state
                    if (typeof updatePositionState === 'function') {
                        updatePositionState();
                    }
                    
                    toast('Full media session reset complete', 2000, 'success');
                } catch (e) {
                    error('Full reset failed', e);
                    toast('Reset failed: ' + e.message, 3000, 'error');
                }
                renderPanel();
            };
        }
    }
    
    function setTab(tabName) {
        if (!TAB_ICONS[tabName]) return;
        
        state.activeTab = tabName;
        saveState();
        
        // Update nav
        document.querySelectorAll('.debug-nav-tab').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tabName);
        });
        
        renderPanel();
    }
    
    // Progress functions kept for backward API compatibility
    function handleProgressClick(e) {
        // No longer used - progress bar removed
    }
    
    function updateProgress() {
        // No longer used - progress bar removed
        // Progress is now shown inline in the Playback panel
    }
    
    // =========================================================================
    // UPDATERS
    // =========================================================================
    function startUpdaters() {
        // Metric collection every 1s
        state.refreshInterval = setInterval(() => {
            collectMetrics();
            
            // Send to popout window if open
            if (state.mode === 'popout' && state.popoutWindow && !state.popoutWindow.closed) {
                sendToPopout('UPDATE', { 
                    metrics: { ...metrics },
                    sparklines: renderSparklineStrings(),
                    state: collectFullState()
                });
            }
            
            if (state.activeTab !== 'logs' && state.mode !== 'popout') {
                renderPanel();
            }
        }, REFRESH_RATE);
        
        // Seek bar update every 250ms for smoother position tracking
        state.seekbarInterval = setInterval(() => {
            if (state.mode !== 'popout') {
                updateSeekBar();
            }
        }, 250);
    }
    
    function stopUpdaters() {
        if (state.refreshInterval) {
            clearInterval(state.refreshInterval);
            state.refreshInterval = null;
        }
        if (state.seekbarInterval) {
            clearInterval(state.seekbarInterval);
            state.seekbarInterval = null;
        }
    }
    
    // =========================================================================
    // POSITION & COLLAPSE TOGGLES
    // =========================================================================
    function rotateCorner() {
        if (!overlay) return;
        const corners = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];
        const currentIdx = corners.indexOf(state.corner);
        state.corner = corners[(currentIdx + 1) % 4];
        
        // Remove all corner classes and add the current one
        overlay.classList.remove('corner-top-left', 'corner-top-right', 'corner-bottom-right', 'corner-bottom-left');
        overlay.classList.add('corner-' + state.corner);
        
        const btn = document.getElementById('debug-corner');
        if (btn) btn.title = 'Move to ' + corners[(currentIdx + 2) % 4].replace('-', ' ');
        
        saveState();
    }
    
    function toggleCollapse() {
        if (!overlay) return;
        state.collapsed = !state.collapsed;
        overlay.classList.toggle('collapsed', state.collapsed);
        
        const btn = document.getElementById('debug-collapse');
        if (btn) btn.textContent = state.collapsed ? EXPAND : COLLAPSE;
        
        saveState();
    }
    
    // =========================================================================
    // LOGGING
    // =========================================================================
    function addLogEntry(category, message, data) {
        const entry = {
            id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            timestamp: Date.now(),
            timeString: timestamp(),
            category,
            message,
            data
        };
        
        logs.entries.unshift(entry);
        if (logs.entries.length > MAX_LOG_ENTRIES) {
            logs.entries = logs.entries.slice(0, MAX_LOG_ENTRIES);
        }
        
        // Send to popout window if open
        if (state.mode === 'popout' && state.popoutWindow && !state.popoutWindow.closed) {
            sendToPopout('LOG', entry);
        }
        
        if (!logs.isPaused && state.activeTab === 'logs' && state.mode !== 'popout') {
            renderLogEntries();
        }
    }
    
    function log(category, message, data = null) {
        if (!state.enabled) return;
        addLogEntry(category, message, data);
    }
    
    function error(message, err = null) {
        if (state.enabled) {
            addLogEntry('ERROR', message, err?.message || err);
        }
        console.error(`[Zenith Error] ${message}`, err || '');
    }
    
    function warn(message, data = null) {
        if (!state.enabled) return;
        addLogEntry('WARN', message, data);
    }
    
    // =========================================================================
    // PUBLIC API
    // =========================================================================
    function enable() {
        if (state.enabled) return;
        state.enabled = true;
        createOverlay();
        
        // Set up broadcast channel listener for popout communication
        if (!state.popoutChannel) {
            state.popoutChannel = new BroadcastChannel('zenith_debug_popout');
            state.popoutChannel.onmessage = (e) => {
                if (e.data.type === 'REDOCK') {
                    reDock();
                }
            };
        }
        
        log('INIT', 'Debug mode enabled');
        saveState();
    }
    
    function disable() {
        if (!state.enabled) return;
        log('INIT', 'Debug mode disabled');
        
        // Close popout if open
        if (state.popoutWindow && !state.popoutWindow.closed) {
            state.popoutWindow.close();
        }
        state.popoutWindow = null;
        
        // Close broadcast channel
        if (state.popoutChannel) {
            state.popoutChannel.close();
            state.popoutChannel = null;
        }
        
        state.mode = 'docked';
        state.enabled = false;
        clearSavedState();
        destroyOverlay();
    }
    
    function isEnabled() {
        return state.enabled;
    }
    
    function toggle() {
        if (state.enabled) disable();
        else enable();
    }
    
    // Initialize from settings when APP is ready
    function initFromSettings() {
        if (typeof APP !== 'undefined' && APP.settings?.debugMode) {
            enable();
        }
    }
    
    setTimeout(initFromSettings, 500);
    document.addEventListener('DOMContentLoaded', () => setTimeout(initFromSettings, 1000));
    
    // =========================================================================
    // STYLES
    // =========================================================================
    function getStyles() {
        return `
/* Debug Overlay v3 */
#debug-overlay.debug-v3 {
    position: fixed;
    width: 100%;
    max-width: 500px;
    height: 40vh;
    max-height: 400px;
    background: rgba(0, 0, 0, 0.92);
    color: #0f0;
    font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
    font-size: 11px;
    z-index: 99999;
    display: flex;
    flex-direction: column;
    border: 2px solid #0f0;
    transition: height 0.3s ease;
}

/* Corner positioning */
#debug-overlay.debug-v3.corner-top-left {
    top: 0; left: 0; right: auto; bottom: auto;
    border-top: none; border-left: none;
    border-radius: 0 0 8px 0;
}

#debug-overlay.debug-v3.corner-top-right {
    top: 0; right: 0; left: auto; bottom: auto;
    border-top: none; border-right: none;
    border-radius: 0 0 0 8px;
}

#debug-overlay.debug-v3.corner-bottom-right {
    bottom: 0; right: 0; left: auto; top: auto;
    border-bottom: none; border-right: none;
    border-radius: 8px 0 0 0;
}

#debug-overlay.debug-v3.corner-bottom-left {
    bottom: 0; left: 0; right: auto; top: auto;
    border-bottom: none; border-left: none;
    border-radius: 0 8px 0 0;
}

/* Floating mode */
#debug-overlay.debug-v3.floating {
    position: fixed;
    transform: none;
    border: 2px solid #0f0;
    border-radius: 8px;
    box-shadow: 0 10px 40px rgba(0, 255, 0, 0.2), 0 0 0 1px rgba(0, 0, 0, 0.5);
    resize: both;
    overflow: auto;
    min-width: 300px;
    min-height: 200px;
}

#debug-overlay.debug-v3.floating .debug-header {
    cursor: grab;
    user-select: none;
}

#debug-overlay.debug-v3.floating .debug-header:active {
    cursor: grabbing;
}

#debug-overlay.debug-v3.collapsed {
    height: auto;
    max-height: none;
}

#debug-overlay.debug-v3.collapsed .debug-nav,
#debug-overlay.debug-v3.collapsed .debug-content,
#debug-overlay.debug-v3.collapsed .debug-seekbar-container {
    display: none;
}

/* Seek Bar */
.debug-v3 .debug-seekbar-container {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    background: rgba(0, 0, 0, 0.5);
    border-bottom: 1px solid #333;
    flex-shrink: 0;
}

.debug-v3 .debug-seek-time {
    font-size: 10px;
    color: #888;
    min-width: 32px;
    font-variant-numeric: tabular-nums;
}

.debug-v3 .debug-seek-time:last-child {
    text-align: right;
}

.debug-v3 .debug-seekbar {
    flex: 1;
    height: 8px;
    background: #333;
    border-radius: 4px;
    cursor: pointer;
    position: relative;
    overflow: visible;
}

.debug-v3 .debug-seekbar:hover {
    background: #444;
}

.debug-v3 .debug-seekbar.seeking {
    background: #444;
}

.debug-v3 .debug-seekbar-fill {
    height: 100%;
    background: linear-gradient(90deg, #0a0, #0f0);
    border-radius: 4px;
    width: 0%;
    transition: width 0.1s linear;
    pointer-events: none;
}

.debug-v3 .debug-seekbar.seeking .debug-seekbar-fill {
    transition: none;
}

.debug-v3 .debug-seekbar-handle {
    position: absolute;
    top: 50%;
    left: 0%;
    width: 14px;
    height: 14px;
    background: #0f0;
    border: 2px solid #000;
    border-radius: 50%;
    transform: translate(-50%, -50%);
    opacity: 0;
    transition: opacity 0.15s, transform 0.15s;
    pointer-events: none;
    box-shadow: 0 0 4px rgba(0, 255, 0, 0.5);
}

.debug-v3 .debug-seekbar:hover .debug-seekbar-handle,
.debug-v3 .debug-seekbar.seeking .debug-seekbar-handle {
    opacity: 1;
}

.debug-v3 .debug-seekbar.seeking .debug-seekbar-handle {
    transform: translate(-50%, -50%) scale(1.2);
}

/* Header */
.debug-v3 .debug-header {
    display: flex;
    align-items: center;
    padding: 6px 10px;
    background: rgba(17, 17, 17, 0.98);
    border-bottom: 1px solid #333;
    flex-shrink: 0;
    gap: 6px;
}

.debug-v3 .debug-title {
    font-weight: bold;
    font-size: 12px;
    flex: 1;
    text-align: center;
}

.debug-v3 .debug-controls {
    display: flex;
    gap: 6px;
}

.debug-v3 .debug-btn {
    background: #222;
    color: #0f0;
    border: 1px solid #0f0;
    padding: 4px 8px;
    border-radius: 4px;
    font-family: inherit;
    font-size: 11px;
    cursor: pointer;
    min-width: 28px;
    text-align: center;
}

.debug-v3 .debug-btn:active { background: #0f0; color: #000; }

/* Navigation */
.debug-v3 .debug-nav {
    display: flex;
    gap: 2px;
    padding: 4px 8px;
    background: rgba(0, 0, 0, 0.4);
    border-bottom: 1px solid #333;
    flex-shrink: 0;
}

.debug-v3 .debug-nav-tab {
    background: transparent;
    border: 1px solid #444;
    color: #888;
    padding: 6px 10px;
    font-size: 12px;
    border-radius: 3px;
    cursor: pointer;
    transition: all 0.15s;
}

.debug-v3 .debug-nav-tab:hover {
    border-color: #666;
    color: #aaa;
}

.debug-v3 .debug-nav-tab.active {
    background: #0f0;
    border-color: #0f0;
    color: #000;
}

/* Content */
.debug-v3 .debug-content {
    flex: 1;
    overflow-y: auto;
    padding: 10px;
}

/* Panel Title */
.debug-v3 .debug-panel-title {
    font-size: 12px;
    font-weight: bold;
    color: #0f0;
    margin-bottom: 10px;
    padding-bottom: 6px;
    border-bottom: 1px solid #333;
}

/* Metric Rows */
.debug-v3 .debug-metric-row {
    margin-bottom: 10px;
}

.debug-v3 .debug-metric-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 2px;
}

.debug-v3 .debug-metric-key {
    color: #888;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

.debug-v3 .debug-metric-val {
    font-size: 11px;
    font-weight: 500;
    transition: color 1s ease;
}

.debug-v3 .debug-metric-val.good { color: #22c55e; }
.debug-v3 .debug-metric-val.warn { color: #f59e0b; }
.debug-v3 .debug-metric-val.bad { color: #ef4444; }

.debug-v3 .debug-metric-simple {
    display: flex;
    justify-content: space-between;
    padding: 3px 0;
    border-bottom: 1px solid #1a1a1a;
}

.debug-v3 .debug-metric-track {
    padding: 4px 0;
    border-bottom: 1px solid #1a1a1a;
}

.debug-v3 .debug-metric-track .debug-metric-val {
    display: block;
    color: #ccc;
    font-size: 10px;
    margin-top: 2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

/* Sparklines */
.debug-v3 .debug-spark {
    display: block;
    margin-top: 2px;
    border-radius: 1px;
    opacity: 0.9;
}

.debug-v3 .debug-spark-buffer {
    display: block;
    margin-top: 4px;
    border-radius: 2px;
    opacity: 0.9;
    background: rgba(0, 0, 0, 0.3);
}

/* Progress bars */
.debug-v3 .debug-progress-mini {
    height: 4px;
    background: #333;
    border-radius: 2px;
    overflow: hidden;
    margin-top: 4px;
}

.debug-v3 .debug-progress-mini-fill {
    height: 100%;
    background: #0f0;
    transition: width 0.2s linear;
}

.debug-v3 .debug-progress-mini-fill.warn {
    background: #f59e0b;
}

/* Sections */
.debug-v3 .debug-section {
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid #333;
    border-radius: 4px;
    padding: 8px;
    margin: 10px 0;
}

.debug-v3 .debug-section-title {
    font-size: 10px;
    color: #666;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 6px;
}

/* Gain bars */
.debug-v3 .debug-gain-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 3px 0;
}

.debug-v3 .debug-gain-label {
    width: 50px;
    color: #888;
    font-size: 10px;
}

.debug-v3 .debug-gain-bar {
    flex: 1;
    height: 6px;
    background: #333;
    border-radius: 3px;
    overflow: hidden;
}

.debug-v3 .debug-gain-fill {
    height: 100%;
    background: #0f0;
    transition: width 0.1s;
}

.debug-v3 .debug-gain-fill.static {
    background: #f59e0b;
}

.debug-v3 .debug-gain-val {
    width: 35px;
    text-align: right;
    font-size: 10px;
    color: #0f0;
}

/* Device toggle */
.debug-v3 .debug-device-toggle {
    display: flex;
    gap: 6px;
    margin-bottom: 10px;
}

.debug-v3 .debug-device-btn {
    flex: 1;
    padding: 6px;
    background: #222;
    border: 1px solid #444;
    border-radius: 4px;
    color: #888;
    font-family: inherit;
    font-size: 11px;
    cursor: pointer;
}

.debug-v3 .debug-device-btn.active {
    background: #0f0;
    border-color: #0f0;
    color: #000;
}

/* Warnings */
.debug-v3 .debug-warnings {
    border-color: #f59e0b;
}

.debug-v3 .debug-warning {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    padding: 4px 0;
    font-size: 10px;
}

.debug-v3 .debug-warning.error { color: #ef4444; }
.debug-v3 .debug-warning.warn { color: #f59e0b; }
.debug-v3 .debug-warning.info { color: #3b82f6; }

/* Logs Panel */
.debug-v3 .debug-log-header {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 6px 0;
    border-bottom: 1px solid #333;
    margin-bottom: 6px;
}

.debug-v3 .debug-log-search {
    flex: 1;
    min-width: 120px;
    padding: 4px 8px;
    background: #222;
    border: 1px solid #444;
    border-radius: 3px;
    color: #0f0;
    font-family: inherit;
    font-size: 11px;
}

.debug-v3 .debug-log-search:focus {
    border-color: #0f0;
    outline: none;
}

.debug-v3 .debug-log-level {
    padding: 4px;
    background: #222;
    border: 1px solid #444;
    border-radius: 3px;
    color: #0f0;
    font-family: inherit;
    font-size: 10px;
}

.debug-v3 .debug-log-btn {
    padding: 4px 8px;
    background: #222;
    border: 1px solid #444;
    border-radius: 3px;
    color: #0f0;
    cursor: pointer;
    font-size: 12px;
}

.debug-v3 .debug-log-btn:hover {
    border-color: #0f0;
}

.debug-v3 .debug-cat-toggles {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 6px 0;
    border-bottom: 1px solid #333;
    margin-bottom: 6px;
}

.debug-v3 .debug-cat-btn {
    padding: 2px 6px;
    background: transparent;
    border: 1px solid #444;
    border-radius: 3px;
    color: #666;
    font-size: 10px;
    cursor: pointer;
    transition: all 0.15s;
}

.debug-v3 .debug-cat-btn.active {
    border-color: #0f0;
    color: #0f0;
}

.debug-v3 .debug-log-container {
    flex: 1;
    overflow-y: auto;
    max-height: calc(40vh - 180px);
}

.debug-v3 .debug-log-entry {
    padding: 4px 0;
    border-bottom: 1px solid #1a1a1a;
}

.debug-v3 .debug-log-entry.has-data {
    cursor: pointer;
}

.debug-v3 .debug-log-entry:hover {
    background: rgba(255, 255, 255, 0.03);
}

.debug-v3 .debug-log-entry-header {
    display: flex;
    align-items: flex-start;
    gap: 6px;
}

.debug-v3 .debug-log-time {
    color: #666;
    font-size: 10px;
    flex-shrink: 0;
}

.debug-v3 .debug-log-expand {
    width: 12px;
    color: #666;
    font-size: 10px;
    flex-shrink: 0;
}

.debug-v3 .debug-log-icon {
    flex-shrink: 0;
}

.debug-v3 .debug-log-cat {
    width: 70px;
    flex-shrink: 0;
    color: #888;
    font-size: 10px;
}

.debug-v3 .debug-log-msg {
    color: #ccc;
    flex: 1;
    word-break: break-word;
}

.debug-v3 .debug-log-entry.ERROR .debug-log-cat,
.debug-v3 .debug-log-entry.ERROR .debug-log-msg { color: #ef4444; }

.debug-v3 .debug-log-entry.WARN .debug-log-cat,
.debug-v3 .debug-log-entry.WARN .debug-log-msg { color: #f59e0b; }

.debug-v3 .debug-log-data {
    display: none;
    margin: 4px 0 4px 24px;
    padding: 6px 8px;
    background: rgba(0, 0, 0, 0.3);
    border-radius: 3px;
    font-size: 10px;
    color: #888;
    max-height: 150px;
    overflow: auto;
}

.debug-v3 .debug-log-data.visible {
    display: block;
}

.debug-v3 .debug-log-data pre {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-all;
}

.debug-v3 .debug-log-status {
    padding: 4px 0;
    text-align: center;
    color: #666;
    font-size: 10px;
    border-top: 1px solid #333;
}

/* Media Panel Styles */
.debug-v3 .debug-action-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
    margin-top: 8px;
}

.debug-v3 .debug-action-btn {
    padding: 8px 6px;
    background: #1a1a1a;
    border: 1px solid #333;
    border-radius: 4px;
    color: #0f0;
    font-family: inherit;
    font-size: 10px;
    cursor: pointer;
    transition: all 0.15s;
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.debug-v3 .debug-action-btn:hover {
    background: #222;
    border-color: #0f0;
}

.debug-v3 .debug-action-btn:active {
    background: #0f0;
    color: #000;
}

.debug-v3 .debug-action-btn.primary {
    background: #1a3a1a;
    border-color: #0f0;
    font-weight: bold;
    grid-column: span 2;
}

.debug-v3 .debug-action-btn.primary:hover {
    background: #0f0;
    color: #000;
}

.debug-v3 .debug-media-actions {
    border-color: #3b82f6;
}

.debug-v3 .debug-ua {
    font-size: 8px;
    word-break: break-all;
    color: #666;
}

.debug-v3 .debug-url-display {
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid #333;
}

.debug-v3 .debug-url-display .debug-metric-val {
    font-size: 8px;
    word-break: break-all;
    color: #666;
}
        `;
    }
    
    // =========================================================================
    // EXPOSE INTERNAL METHODS FOR HTML ONCLICK
    // =========================================================================
    function _toggleLogEntry(id) {
        if (logs.expandedEntries.has(id)) {
            logs.expandedEntries.delete(id);
        } else {
            logs.expandedEntries.add(id);
        }
        renderLogEntries();
    }
    
    // =========================================================================
    // RETURN PUBLIC API
    // =========================================================================
    return {
        enable,
        disable,
        toggle,
        isEnabled,
        log,
        error,
        warn,
        updateProgress,
        setTab,
        getMetrics: () => ({ ...metrics }),
        
        // Category shortcuts
        TRANSPORT: (msg, data) => log('TRANSPORT', msg, data),
        PLAYBACK: (msg, data) => log('PLAYBACK', msg, data),
        TRACK: (msg, data) => log('TRACK', msg, data),
        STATE: (msg, data) => log('STATE', msg, data),
        PWA: (msg, data) => log('PWA', msg, data),
        AUDIO: (msg, data) => log('AUDIO', msg, data),
        UI: (msg, data) => log('UI', msg, data),
        INIT: (msg, data) => log('INIT', msg, data),
        
        // Internal methods exposed for HTML onclick
        _toggleLogEntry
    };
})();

window.Debug = Debug;
