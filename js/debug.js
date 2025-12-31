// ZENITH DEBUG MODULE v2
// Visual on-screen debugging for mobile with progress bar

const Debug = (() => {
    let enabled = false;
    let collapsed = false;
    let overlay = null;
    let logContainer = null;
    let stateContainer = null;
    let progressContainer = null;
    let isAtTop = true; // Default to top
    const MAX_VISIBLE_LOGS = 30;
    
    // Storage key for remembering state
    const STORAGE_KEY = 'zenith_debug_state';
    
    // Unicode code points for arrows (avoids emoji conversion on mobile)
    const ARROW_UP = '\u2191';   // ↑
    const ARROW_DOWN = '\u2193'; // ↓
    const COLLAPSE = '\u2212';   // −
    const EXPAND = '\u002B';     // +
    
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
    
    function timestamp() {
        const d = new Date();
        return d.toTimeString().substr(0, 8);
    }
    
    function loadState() {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                const state = JSON.parse(saved);
                isAtTop = state.isAtTop !== false; // Default true
                collapsed = state.collapsed === true;
                return true;
            }
        } catch (e) {}
        return false;
    }
    
    // Track if state panel should be shown
    let stateVisible = true; // Default to visible
    
    function saveState() {
        try {
            // Only save if debug is open (so refresh while closed stays closed)
            if (enabled) {
                localStorage.setItem(STORAGE_KEY, JSON.stringify({
                    isAtTop,
                    collapsed
                }));
            }
        } catch (e) {}
    }
    
    function clearSavedState() {
        try {
            localStorage.removeItem(STORAGE_KEY);
        } catch (e) {}
    }
    
    function createOverlay() {
        if (overlay) return;
        
        // Load saved state
        loadState();
        
        overlay = document.createElement('div');
        overlay.id = 'debug-overlay';
        overlay.className = isAtTop ? 'at-top' : '';
        if (collapsed) overlay.classList.add('collapsed');
        
        overlay.innerHTML = `
            <div class="debug-header">
                <button class="debug-btn debug-collapse-btn" id="debug-collapse">${collapsed ? EXPAND : COLLAPSE}</button>
                <button class="debug-btn debug-position-btn" id="debug-position">${isAtTop ? ARROW_DOWN : ARROW_UP}</button>
                <span class="debug-title">\uD83D\uDC1B Debug</span>
                <div class="debug-controls">
                    <button class="debug-btn" id="debug-clear">Clear</button>
                    <button class="debug-btn" id="debug-state">State</button>
                    <button class="debug-btn" id="debug-close">\u2715</button>
                </div>
            </div>
            <div class="debug-logs" id="debug-logs"></div>
        `;
        
        // Create floating state panel (separate from main overlay)
        stateContainer = document.createElement('div');
        stateContainer.id = 'debug-state-panel';
        stateContainer.className = 'debug-state-floating';
        updateStatePosition();
        
        // Create progress bar container
        progressContainer = document.createElement('div');
        progressContainer.id = 'debug-progress';
        progressContainer.className = 'debug-progress-bar';
        updateProgressPosition();
        progressContainer.innerHTML = `
            <div class="debug-progress-track">
                <div class="debug-progress-fill" id="debug-progress-fill"></div>
            </div>
            <div class="debug-progress-time">
                <span id="debug-time-current">0:00</span>
                <span id="debug-time-duration">0:00</span>
            </div>
        `;
        
        const style = document.createElement('style');
        style.id = 'debug-styles';
        style.textContent = `
            #debug-overlay {
                position: fixed;
                bottom: 0; left: 0; right: 0;
                height: 35vh;
                background: rgba(0, 0, 0, 0.75);
                color: #0f0;
                font-family: monospace;
                font-size: 11px;
                z-index: 99999;
                display: flex;
                flex-direction: column;
                border-top: 2px solid #0f0;
                pointer-events: none;
                transition: height 0.3s ease;
            }
            #debug-overlay.at-top {
                top: 0; bottom: auto;
                border-top: none;
                border-bottom: 2px solid #0f0;
            }
            #debug-overlay.collapsed {
                height: auto;
            }
            #debug-overlay.collapsed .debug-logs {
                display: none;
            }
            .debug-header {
                display: flex;
                align-items: center;
                padding: 6px 10px;
                background: rgba(17, 17, 17, 0.95);
                border-bottom: 1px solid #333;
                flex-shrink: 0;
                pointer-events: auto;
                gap: 6px;
            }
            #debug-overlay.at-top .debug-header {
                order: 0;
            }
            #debug-overlay.at-top .debug-logs {
                order: 1;
            }
            .debug-title { 
                font-weight: bold; 
                font-size: 13px; 
                flex: 1; 
                text-align: center;
                pointer-events: none;
            }
            .debug-controls { 
                display: flex; 
                gap: 6px; 
            }
            .debug-btn {
                background: #333;
                color: #0f0;
                border: 1px solid #0f0;
                padding: 4px 8px;
                border-radius: 4px;
                font-family: monospace;
                font-size: 11px;
                cursor: pointer;
                pointer-events: auto;
                min-width: 28px;
                text-align: center;
            }
            .debug-btn:active { background: #0f0; color: #000; }
            .debug-collapse-btn, .debug-position-btn {
                font-size: 14px;
                font-weight: bold;
                padding: 4px 6px;
            }
            
            /* Floating state panel */
            .debug-state-floating {
                display: none;
                position: fixed;
                background: rgba(0, 0, 0, 0.7);
                color: #0f0;
                font-family: monospace;
                font-size: 10px;
                z-index: 99998;
                padding: 8px 12px;
                border: 1px solid #0f0;
                border-radius: 4px;
                max-width: 250px;
                max-height: 40vh;
                overflow-y: auto;
                pointer-events: none;
            }
            .debug-state-floating.visible { display: block; }
            .debug-state-floating.at-top-left {
                top: 10px; left: 10px; bottom: auto;
            }
            .debug-state-floating.at-bottom-left {
                bottom: 10px; left: 10px; top: auto;
            }
            .debug-state-row {
                display: flex;
                justify-content: space-between;
                padding: 2px 0;
                border-bottom: 1px solid #222;
                gap: 10px;
            }
            .debug-state-key { color: #888; white-space: nowrap; }
            .debug-state-val { color: #0f0; text-align: right; }
            .debug-state-val.false { color: #f55; }
            .debug-state-val.true { color: #5f5; }
            
            /* Progress bar */
            .debug-progress-bar {
                position: fixed;
                left: 0; right: 0;
                height: 24px;
                background: rgba(0, 0, 0, 0.85);
                z-index: 99997;
                padding: 4px 10px;
                display: flex;
                align-items: center;
                gap: 10px;
                pointer-events: none;
                border: 1px solid #0f0;
            }
            .debug-progress-bar.at-bottom {
                bottom: 35vh;
                border-bottom: none;
            }
            .debug-progress-bar.at-top {
                top: 35vh;
                border-top: none;
            }
            .debug-progress-bar.collapsed-bottom {
                bottom: 32px;
            }
            .debug-progress-bar.collapsed-top {
                top: 32px;
            }
            .debug-progress-track {
                flex: 1;
                height: 6px;
                background: #333;
                border-radius: 3px;
                overflow: hidden;
                pointer-events: auto;
                cursor: pointer;
            }
            .debug-progress-fill {
                height: 100%;
                background: #0f0;
                width: 0%;
                transition: width 0.2s linear;
            }
            .debug-progress-time {
                display: flex;
                gap: 8px;
                font-size: 10px;
                color: #0f0;
                font-family: monospace;
            }
            
            /* Logs */
            .debug-logs {
                flex: 1;
                overflow-y: auto;
                padding: 6px 10px;
                pointer-events: auto;
            }
            .debug-log {
                padding: 3px 0;
                border-bottom: 1px solid #222;
                word-break: break-word;
            }
            .debug-log .time { color: #666; margin-right: 6px; }
            .debug-log .icon { margin-right: 4px; }
            .debug-log .msg { color: #ccc; }
            .debug-log .data { color: #888; font-size: 10px; display: block; margin-left: 20px; }
            .debug-log.ERROR { color: #f55; }
            .debug-log.ERROR .msg { color: #f55; }
            .debug-log.WARN { color: #fa0; }
            .debug-log.WARN .msg { color: #fa0; }
        `;
        
        document.head.appendChild(style);
        document.body.appendChild(overlay);
        document.body.appendChild(stateContainer);
        document.body.appendChild(progressContainer);
        
        logContainer = document.getElementById('debug-logs');
        
        // Event listeners
        document.getElementById('debug-clear').addEventListener('click', clearLogs);
        document.getElementById('debug-state').addEventListener('click', toggleState);
        document.getElementById('debug-close').addEventListener('click', disable);
        document.getElementById('debug-position').addEventListener('click', togglePosition);
        document.getElementById('debug-collapse').addEventListener('click', toggleCollapse);
        
        // Progress bar click to seek
        progressContainer.querySelector('.debug-progress-track').addEventListener('click', handleProgressClick);
        
        // Start progress updater
        startProgressUpdater();
        
        // Show state panel by default
        stateContainer.classList.add('visible');
        updateStatePanel();
    }
    
    function updateStatePosition() {
        if (!stateContainer) return;
        stateContainer.classList.remove('at-top-left', 'at-bottom-left');
        // State is opposite of debug panel
        if (isAtTop) {
            stateContainer.classList.add('at-bottom-left');
        } else {
            stateContainer.classList.add('at-top-left');
        }
    }
    
    function updateProgressPosition() {
        if (!progressContainer) return;
        progressContainer.classList.remove('at-top', 'at-bottom', 'collapsed-top', 'collapsed-bottom');
        
        if (collapsed) {
            progressContainer.classList.add(isAtTop ? 'collapsed-top' : 'collapsed-bottom');
        } else {
            progressContainer.classList.add(isAtTop ? 'at-top' : 'at-bottom');
        }
    }
    
    function togglePosition() {
        if (!overlay) return;
        isAtTop = !isAtTop;
        overlay.classList.toggle('at-top', isAtTop);
        
        const btn = document.getElementById('debug-position');
        if (btn) {
            btn.textContent = isAtTop ? ARROW_DOWN : ARROW_UP;
        }
        
        updateStatePosition();
        updateProgressPosition();
        saveState();
    }
    
    function toggleCollapse() {
        if (!overlay) return;
        collapsed = !collapsed;
        overlay.classList.toggle('collapsed', collapsed);
        
        const btn = document.getElementById('debug-collapse');
        if (btn) {
            btn.textContent = collapsed ? EXPAND : COLLAPSE;
        }
        
        updateProgressPosition();
        saveState();
    }
    
    function handleProgressClick(e) {
        if (!APP.currentHowl) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const percent = (e.clientX - rect.left) / rect.width;
        const duration = APP.currentHowl.duration();
        if (duration && isFinite(duration)) {
            const seekTime = percent * duration;
            APP.currentHowl.seek(seekTime);
            updateProgress();
        }
    }
    
    function formatTime(seconds) {
        if (!seconds || !isFinite(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }
    
    function updateProgress() {
        if (!progressContainer || !enabled) return;
        
        const fill = document.getElementById('debug-progress-fill');
        const current = document.getElementById('debug-time-current');
        const duration = document.getElementById('debug-time-duration');
        
        if (!fill || !current || !duration) return;
        
        if (APP.currentHowl) {
            const pos = APP.currentHowl.seek() || 0;
            const dur = APP.currentHowl.duration() || 0;
            
            if (dur > 0 && isFinite(dur)) {
                const percent = (pos / dur) * 100;
                fill.style.width = `${Math.min(100, percent)}%`;
                current.textContent = formatTime(pos);
                duration.textContent = formatTime(dur);
            }
        } else {
            fill.style.width = '0%';
            current.textContent = '0:00';
            duration.textContent = '0:00';
        }
    }
    
    let progressInterval = null;
    function startProgressUpdater() {
        if (progressInterval) clearInterval(progressInterval);
        progressInterval = setInterval(updateProgress, 250);
    }
    
    function stopProgressUpdater() {
        if (progressInterval) {
            clearInterval(progressInterval);
            progressInterval = null;
        }
    }
    
    function destroyOverlay() {
        stopProgressUpdater();
        if (overlay) {
            overlay.remove();
            overlay = null;
            logContainer = null;
        }
        if (stateContainer) {
            stateContainer.remove();
            stateContainer = null;
        }
        if (progressContainer) {
            progressContainer.remove();
            progressContainer = null;
        }
        const style = document.getElementById('debug-styles');
        if (style) style.remove();
    }
    
    function addLogEntry(category, message, data) {
        if (!logContainer) return;
        
        const entry = document.createElement('div');
        entry.className = `debug-log ${category}`;
        
        let dataStr = '';
        if (data !== null && data !== undefined) {
            try {
                if (typeof data === 'object') {
                    dataStr = JSON.stringify(data);
                } else {
                    dataStr = String(data);
                }
            } catch (e) {
                dataStr = '[object]';
            }
        }
        
        entry.innerHTML = `
            <span class="time">${timestamp()}</span>
            <span class="icon">${ICONS[category] || '\uD83D\uDCDD'}</span>
            <span class="msg">${message}</span>
            ${dataStr ? `<span class="data">${dataStr}</span>` : ''}
        `;
        
        logContainer.insertBefore(entry, logContainer.firstChild);
        
        // Trim old logs
        while (logContainer.children.length > MAX_VISIBLE_LOGS) {
            logContainer.removeChild(logContainer.lastChild);
        }
    }
    
    function clearLogs() {
        if (logContainer) logContainer.innerHTML = '';
    }
    
    function toggleState() {
        if (!stateContainer) return;
        stateContainer.classList.toggle('visible');
        if (stateContainer.classList.contains('visible')) {
            updateStatePanel();
        }
    }
    
    function updateStatePanel() {
        if (!stateContainer) return;
        
        const states = [
            ['initialized', APP.initialized],
            ['isPlaying', APP.isPlaying],
            ['manuallyPaused', APP.manuallyPaused],
            ['isTransitioning', APP.isTransitioning],
            ['currentBand', APP.currentBand],
            ['currentIndex', APP.currentIndex],
            ['loadId', APP.loadId],
            ['volume', APP.volume?.toFixed(2)],
            ['Howl exists', !!APP.currentHowl],
            ['Howl playing', APP.currentHowl?.playing() ?? false],
            ['AudioContext', APP.audioContext?.state ?? 'none'],
            ['pageVisible', APP.pageVisible],
            ['isBackgrounded', APP.isBackgrounded],
            ['isOnline', APP.isOnline],
            ['wakeLock', APP.wakeLock ? 'active' : 'none'],
            ['swReady', APP.swReady],
            ['trackList length', getCurrentTrackList?.()?.length ?? 0],
        ];
        
        stateContainer.innerHTML = states.map(([key, val]) => {
            let valClass = '';
            if (val === true) valClass = 'true';
            else if (val === false) valClass = 'false';
            return `<div class="debug-state-row">
                <span class="debug-state-key">${key}</span>
                <span class="debug-state-val ${valClass}">${val}</span>
            </div>`;
        }).join('');
    }
    
    function log(category, message, data = null) {
        if (!enabled) return;
        addLogEntry(category, message, data);
        // Also update state panel if visible
        if (stateContainer?.classList.contains('visible')) {
            updateStatePanel();
        }
    }
    
    function error(message, err = null) {
        // Errors always log, even if debug disabled
        if (enabled) {
            addLogEntry('ERROR', message, err?.message || err);
        }
        console.error(`[Zenith Error] ${message}`, err || '');
    }
    
    function warn(message, data = null) {
        if (!enabled) return;
        addLogEntry('WARN', message, data);
    }
    
    function enable() {
        if (enabled) return; // Already enabled
        enabled = true;
        createOverlay();
        log('INIT', 'Debug mode enabled');
        saveState();
    }
    
    function disable() {
        if (!enabled) return; // Already disabled
        log('INIT', 'Debug mode disabled');
        enabled = false;
        clearSavedState(); // Clear saved state so it stays closed on refresh
        destroyOverlay();
    }
    
    function isEnabled() {
        return enabled;
    }
    
    function toggle() {
        if (enabled) disable();
        else enable();
    }
    
    // Initialize from settings when APP is ready
    function initFromSettings() {
        if (typeof APP !== 'undefined' && APP.settings?.debugMode) {
            enable();
        }
    }
    
    // Check settings after a delay (APP may not exist yet)
    setTimeout(initFromSettings, 500);
    document.addEventListener('DOMContentLoaded', () => setTimeout(initFromSettings, 1000));
    
    return {
        enable,
        disable,
        toggle,
        isEnabled,
        log,
        error,
        warn,
        updateProgress,
        // Category shortcuts
        TRANSPORT: (msg, data) => log('TRANSPORT', msg, data),
        PLAYBACK: (msg, data) => log('PLAYBACK', msg, data),
        TRACK: (msg, data) => log('TRACK', msg, data),
        STATE: (msg, data) => log('STATE', msg, data),
        PWA: (msg, data) => log('PWA', msg, data),
        AUDIO: (msg, data) => log('AUDIO', msg, data),
        UI: (msg, data) => log('UI', msg, data),
        INIT: (msg, data) => log('INIT', msg, data)
    };
})();

window.Debug = Debug;
