// ZENITH DEBUG MODULE v3
// Comprehensive debugging with navigation, sparklines, categorized metrics, and enhanced logging
// See DEBUG_MODULE_PLAN.md for full specification

const Debug = (() => {
    // =========================================================================
    // STATE & CONFIGURATION
    // =========================================================================
    const VERSION = '3.0';
    const STORAGE_KEY = 'zenith_debug_state';
    const MAX_HISTORY = 60; // 60 seconds of sparkline history
    const MAX_LOG_ENTRIES = 500;
    const REFRESH_RATE = 1000; // 1 second metric collection
    
    const state = {
        enabled: false,
        collapsed: false,
        position: 'top',
        activeTab: 'playback',
        deviceView: 'auto',
        refreshInterval: null,
        progressInterval: null
    };
    
    // Rolling metric history (60 seconds)
    const metrics = {
        playbackState: [],
        howlState: [],
        audioContextState: [],
        networkState: [],
        visibilityState: [],
        swReady: [],
        wakeLock: []
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
        }
    };
    
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
            const nextTrack = list?.[APP.currentIndex + 1];
            
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
                    <span class="debug-metric-val">${APP.currentIndex} / ${list?.length || 0}</span>
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
                </div>
                <div class="debug-metric-simple">
                    <span class="debug-metric-key">PWA Mode</span>
                    <span class="debug-metric-val ${APP.isPWA ? 'good' : ''}">${APP.isPWA}</span>
                </div>
                <div class="debug-metric-simple">
                    <span class="debug-metric-key">Wake Lock</span>
                    <span class="debug-metric-val ${wakeLockState === 'active' ? 'good' : ''}">${wakeLockState}</span>
                </div>
                <div class="debug-metric-simple">
                    <span class="debug-metric-key">Install</span>
                    <span class="debug-metric-val">${APP.deferredPrompt ? 'available' : 'N/A'}</span>
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
                state.position = data.position || 'bottom';
                state.collapsed = data.collapsed === true;
                state.activeTab = data.activeTab || 'playback';
                return true;
            }
        } catch (e) {}
        return false;
    }
    
    function saveState() {
        try {
            if (state.enabled) {
                localStorage.setItem(STORAGE_KEY, JSON.stringify({
                    position: state.position,
                    collapsed: state.collapsed,
                    activeTab: state.activeTab
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
        overlay.className = `debug-v3 ${state.position === 'top' ? 'at-top' : ''} ${state.collapsed ? 'collapsed' : ''}`;
        
        overlay.innerHTML = `
            <div class="debug-header">
                <button class="debug-btn debug-collapse-btn" id="debug-collapse">${state.collapsed ? EXPAND : COLLAPSE}</button>
                <button class="debug-btn debug-position-btn" id="debug-position">${state.position === 'top' ? ARROW_DOWN : ARROW_UP}</button>
                <span class="debug-title">\uD83D\uDC1B Debug v${VERSION}</span>
                <div class="debug-controls">
                    <button class="debug-btn" id="debug-close">\u2715</button>
                </div>
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
        document.getElementById('debug-position').addEventListener('click', togglePosition);
        document.getElementById('debug-close').addEventListener('click', disable);
        
        document.getElementById('debug-nav').addEventListener('click', (e) => {
            const tab = e.target.closest('.debug-nav-tab');
            if (tab) {
                setTab(tab.dataset.tab);
            }
        });
        
        // Initial render
        renderPanel();
        startUpdaters();
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
            if (state.activeTab !== 'logs') {
                renderPanel();
            }
        }, REFRESH_RATE);
    }
    
    function stopUpdaters() {
        if (state.refreshInterval) {
            clearInterval(state.refreshInterval);
            state.refreshInterval = null;
        }
    }
    
    // =========================================================================
    // POSITION & COLLAPSE TOGGLES
    // =========================================================================
    function togglePosition() {
        if (!overlay) return;
        state.position = state.position === 'top' ? 'bottom' : 'top';
        overlay.classList.toggle('at-top', state.position === 'top');
        
        const btn = document.getElementById('debug-position');
        if (btn) btn.textContent = state.position === 'top' ? ARROW_DOWN : ARROW_UP;
        
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
        
        if (!logs.isPaused && state.activeTab === 'logs') {
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
        log('INIT', 'Debug mode enabled');
        saveState();
    }
    
    function disable() {
        if (!state.enabled) return;
        log('INIT', 'Debug mode disabled');
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
    top: 0; left: 50%;
    transform: translateX(-50%);
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
    border-top: none;
    border-radius: 0 0 8px 8px;
    transition: height 0.3s ease;
}

#debug-overlay.debug-v3.at-top {
    top: 0; bottom: auto;
    border-top: none;
    border-bottom: 2px solid #0f0;
    border-radius: 0 0 8px 8px;
}

#debug-overlay.debug-v3:not(.at-top) {
    top: auto; bottom: 0;
    border-bottom: none;
    border-top: 2px solid #0f0;
    border-radius: 8px 8px 0 0;
}

#debug-overlay.debug-v3.collapsed {
    height: auto;
    max-height: none;
}

#debug-overlay.debug-v3.collapsed .debug-nav,
#debug-overlay.debug-v3.collapsed .debug-content,
#debug-overlay.debug-v3.collapsed .debug-progress-bar {
    display: none;
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
