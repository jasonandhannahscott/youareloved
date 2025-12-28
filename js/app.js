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
    isMobile: /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent), 
    
    currentBand: 'book1', 
    currentIndex: 0,
    currentTrackSrc: null,
    nextTrackHowl: null,
    nextTrackIndex: -1,
    pendingIndex: -1,
        
    audioContext: null, gainNode: null, staticNode: null,
    staticGain: null, musicGain: null, currentHowl: null,
    isPlaying: false, isDragging: false, isTransitioning: false,
    
    sectionWidth: 150, 
    volume: 0.8, 
    expandTimer: null,
    volumeSliderTimeout: null,

    radioState: {
        isShuffled: false,
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

function getSecureUrl(path) {
    const encoded = encodeURIComponent(path).replace(/'/g, '%27');
    return 'serve.php?file=' + encoded;
}

function shouldEnableStatic() {
    // Disable static on mobile when page is not visible (screen locked or backgrounded)
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
        
        // If page becomes hidden on mobile, mute static immediately
        if (APP.isMobile && document.hidden && APP.staticGain) {
            APP.staticGain.gain.value = 0;
        }
    });
    
    // Also handle page blur/focus for additional coverage
    window.addEventListener('blur', () => {
        if (APP.isMobile) {
            APP.pageVisible = false;
            if (APP.staticGain) APP.staticGain.gain.value = 0;
        }
    });
    
    window.addEventListener('focus', () => {
        APP.pageVisible = true;
    });
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

    loadUserPlaylists();
    registerServiceWorker();
    setupVisibilityHandler();

    try {
        const plResponse = await fetch('serve.php?file=playlist.json');
        if (plResponse.status === 401 || plResponse.status === 403) {
            console.error("Auth failed during init");
            APP.initialized = false;
            return;
        }
        APP.playlist = await plResponse.json();
        
        try {
            const radioResponse = await fetch('serve.php?file=radio.json');
            if (radioResponse.ok) {
                APP.radioData = await radioResponse.json();
                processRadioData();
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
        buildDial();
        gsap.to('.radio-cabinet', { opacity: 1, duration: 1.5, ease: 'power2.out' });
        
        APP.isPlaying = true;
        loadTrack(0);
        
    } catch (error) {
        console.error('Failed to initialize app:', error);
        APP.initialized = false;
    }
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
                console.log('Service Worker registered:', registration.scope);
                APP.swReady = true;
                
                // Request cached URLs list
                if (navigator.serviceWorker.controller) {
                    navigator.serviceWorker.controller.postMessage({ type: 'GET_CACHED_URLS' });
                }
            })
            .catch((error) => {
                console.warn('Service Worker registration failed:', error);
            });
        
        // Listen for messages from service worker
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
                console.warn('Failed to cache:', event.data.url);
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
    if (track.sourceType === 'radio' || track.ParentFolder) {
        srcAudio = 'radio/' + cleanPath(track.src_audio);
    } else if (track.sourceType === 'book1') {
        srcAudio = 'Book 1/' + cleanPath(track.src_audio).replace(/^book\s?1\//i, '');
    } else if (track.sourceType === 'book2') {
        srcAudio = 'Book 2/' + cleanPath(track.src_audio).replace(/^book\s?2\//i, '');
    } else if (track.src_audio) {
        // Try to detect from src_audio path
        if (track.src_audio.toLowerCase().includes('book 1') || track.src_audio.toLowerCase().includes('book1')) {
            srcAudio = 'Book 1/' + cleanPath(track.src_audio).replace(/^book\s?1\//i, '');
        } else if (track.src_audio.toLowerCase().includes('book 2') || track.src_audio.toLowerCase().includes('book2')) {
            srcAudio = 'Book 2/' + cleanPath(track.src_audio).replace(/^book\s?2\//i, '');
        } else {
            srcAudio = cleanPath(track.src_audio);
        }
    }
    return srcAudio ? getSecureUrl(srcAudio) : null;
}

function isTrackCached(track) {
    const url = getTrackAudioUrl(track);
    if (!url) return false;
    
    // Check both absolute and relative URLs
    const absoluteUrl = new URL(url, window.location.origin).href;
    return APP.cachedUrls.has(url) || APP.cachedUrls.has(absoluteUrl);
}

function cacheTrack(track, callback) {
    if (!APP.swReady || !navigator.serviceWorker.controller) {
        console.warn('Service worker not ready');
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
    
    APP.downloadProgress = { total: urls.length, completed: 0, playlistId };
    
    navigator.serviceWorker.controller.postMessage({
        type: 'CACHE_AUDIO',
        urls: urls
    });
    
    showDownloadProgress(playlist.name);
}

function updateDownloadProgress() {
    if (!APP.downloadProgress) return;
    
    const playlist = APP.userPlaylists.find(p => p.id === APP.downloadProgress.playlistId);
    if (!playlist) return;
    
    let cachedCount = 0;
    playlist.tracks.forEach(track => {
        if (isTrackCached(track)) cachedCount++;
    });
    
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
    // Update any visible offline indicators in the UI
    document.querySelectorAll('[data-track-cached]').forEach(el => {
        const trackData = el.dataset.trackCached;
        if (trackData) {
            try {
                const track = JSON.parse(trackData);
                if (isTrackCached(track)) {
                    el.classList.add('cached');
                } else {
                    el.classList.remove('cached');
                }
            } catch (e) {}
        }
    });
    
    // Update download buttons
    document.querySelectorAll('.download-track-btn').forEach(btn => {
        const trackData = btn.dataset.track;
        if (trackData) {
            try {
                const track = JSON.parse(trackData);
                if (isTrackCached(track)) {
                    btn.classList.add('downloaded');
                    btn.title = 'Downloaded for offline';
                } else {
                    btn.classList.remove('downloaded');
                    btn.title = 'Download for offline';
                }
            } catch (e) {}
        }
    });
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
        
        container.innerHTML = `
            <div class="${indicatorClass} left" id="scroll-left">&#x300A;</div>
            <div class="${indicatorClass} right" id="scroll-right">&#x27EB;</div>
            <div class="needle"></div>
            <div class="dial-track" id="dial-track"></div>
        `;

        const playlist = APP.playlist[APP.currentBand];
        $('dial-track').innerHTML = playlist ? playlist.map((item, index) => `
            <div class="station" data-index="${index}">
                <div class="artist">${item.artist}</div>
                <div class="title">${item.title}</div>
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
        const maxRotation = 50;
        const rawRotation = (xPos - centerOffset + itemWidth/2) / (container.offsetWidth/2) * maxRotation;
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
    const list = (APP.currentBand === 'radio') ? APP.radioPlaylist : APP.playlist[APP.currentBand];
    if (!list) return;
    
    const nextIndex = (currentIndex + 1) % list.length;

    if (APP.nextTrackIndex === nextIndex && APP.nextTrackHowl && APP.nextTrackHowl.state() === 'loaded') {
        return;
    }

    if (APP.nextTrackHowl) {
        APP.nextTrackHowl.unload();
    }

    let srcAudio;
    const track = list[nextIndex];
    if (APP.currentBand === 'radio') {
        srcAudio = 'radio/' + cleanPath(track.src_audio);
    } else {
        const folderName = (APP.currentBand === 'book1') ? 'Book 1' : 'Book 2';
        const path = track.src_audio ? folderName + '/' + track.src_audio.replace(/^book\s?[12]\//i,'') : null;
        srcAudio = cleanPath(path);
    }

    if (!srcAudio) return;

    APP.nextTrackIndex = nextIndex;
    APP.nextTrackHowl = new Howl({
        src: [getSecureUrl(srcAudio)],
        format: ['mp3'], html5: true,
        preload: true,
        autoplay: false,
        onloaderror: function() {
            console.warn("Failed to preload next track");
        }
    });
}

function setupSingleDraggable() {
    const track = $('dial-track');
    if(!track) return;
    const container = track.parentElement;
    const list = APP.playlist[APP.currentBand];
    
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
        setStaticGain(APP.isPlaying ? (distanceToSnap * 0.6 * APP.volume) : 0);

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

        onDrag: function() { 
            handleVirtualDrag(this.x); 
        },

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
    const list = (APP.currentBand === 'radio') ? APP.radioPlaylist : APP.playlist[APP.currentBand];
    if (!list || !list[index]) return;

    track = list[index];

    if (APP.currentBand === 'radio') {
        srcAudio = 'radio/' + cleanPath(track.src_audio);
        srcVideo = null; isVideo = false;
    } else {
        const folderName = (APP.currentBand === 'book1') ? 'Book 1' : 'Book 2';
        const ensureFolderPath = (path) => path ? folderName + '/' + path.replace(/^book\s?[12]\//i,'') : path;
        srcAudio = ensureFolderPath(cleanPath(track.src_audio));
        srcVideo = ensureFolderPath(cleanPath(track.src_video));
        isVideo = (srcVideo && /\.(mp4|mkv|webm)$/i.test(srcVideo));
    }

    if (srcAudio === APP.currentTrackSrc && !isVideo) {
        if (updateLayout) updateInterfaceLayout(false);
        return;
    }
    
    APP.currentTrackSrc = srcAudio;
    const excerptDisplay = $('excerpt-display');
    
    if (APP.currentBand !== 'radio' && excerptDisplay) {
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
        if (APP.isPlaying) videoPlayer.play().catch(()=>{});
        return;
    } else if (videoPlayer) {
        videoPlayer.pause();
        videoPlayer.removeAttribute('src');
        videoPlayer.load();
    }

    let newHowl;
    if (APP.nextTrackIndex === index && APP.nextTrackHowl) {
        console.log("Using preloaded track!");
        newHowl = APP.nextTrackHowl;
        APP.nextTrackHowl = null;
        APP.nextTrackIndex = -1;
        newHowl.off('end'); 
        newHowl.on('end', handleAutoplay);
    } else {
        newHowl = new Howl({
            src: [getSecureUrl(srcAudio)],
            format: ['mp3'], html5: true,
            onend: handleAutoplay,
            onload: function() {
                if (APP.currentHowl !== this) { this.unload(); return; }
            }
        });
    }

    if (APP.currentHowl) {
        if (APP.currentHowl.playing()) {
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
        APP.currentHowl.fade(0, APP.volume, 500);
    }

    if (APP.currentHowl._sounds.length > 0 && APP.currentHowl._sounds[0]._node && APP.audioContext) {
        try {
            const source = APP.audioContext.createMediaElementSource(APP.currentHowl._sounds[0]._node);
            source.connect(APP.musicGain);
        } catch(e) { /* already connected */ }
    }

    preloadNextTrack(index);
}

function handleAutoplay() {
    const nextIndex = APP.currentIndex + 1;
    const max = APP.currentBand === 'radio' ? APP.radioPlaylist.length : APP.playlist[APP.currentBand].length;
    if (nextIndex < max) tuneToStation(nextIndex);
}

function tuneToStation(index) {
    if (APP.currentBand === 'radio') {
        const fmTrack = $('fm-track');
        const song = APP.radioPlaylist[index];
        let artistIdx = 0;
        if (song) artistIdx = APP.radioArtists.findIndex(a => a.folder === song.ParentFolder);
        snapVirtualTo(index, false, null, true);
        if (artistIdx !== -1) snapToPosition(fmTrack, fmTrack.parentElement, artistIdx, false, null, true);
    } else {
        const track = $('dial-track');
        snapToPosition(track, track.parentElement, index, false, null, true);
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
    let max = 0;
    if(APP.currentBand === 'radio') max = APP.radioPlaylist.length;
    else if(APP.playlist && APP.playlist[APP.currentBand]) max = APP.playlist[APP.currentBand].length;
    left.style.opacity = APP.currentIndex === 0 ? '0.3' : '1';
    right.style.opacity = APP.currentIndex === max - 1 ? '0.3' : '1';
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
            if(APP.currentHowl) APP.currentHowl.pause();
            if(vid) vid.pause();
        } else if (val > 0 && !APP.isPlaying) {
            APP.isPlaying = true;
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

        if (newVol === 0 && APP.isPlaying) {
            APP.isPlaying = false;
            if(APP.currentHowl) APP.currentHowl.pause();
            if(vid) vid.pause();
        } else if (newVol > 0 && !APP.isPlaying) {
            APP.isPlaying = true;
            if(APP.audioContext.state === 'suspended') APP.audioContext.resume();
            if(APP.currentHowl) APP.currentHowl.play();
            if(vid) vid.play().catch(()=>{});
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
            qsa('.band-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            APP.currentBand = e.target.dataset.band;
            APP.currentIndex = 0;
            buildDial();
            setTimeout(() => loadTrack(0), 100);
        }
    });

    $('left-arrow').addEventListener('click', () => { 
        hideOnboardingHints();
        if(APP.currentIndex > 0) tuneToStation(APP.currentIndex - 1); 
    });
    $('right-arrow').addEventListener('click', () => { 
        hideOnboardingHints();
        const max = APP.currentBand === 'radio' ? APP.radioPlaylist.length : APP.playlist[APP.currentBand].length;
        if(APP.currentIndex < max - 1) tuneToStation(APP.currentIndex + 1); 
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
        APP.radioState.isShuffled = !APP.radioState.isShuffled;
        e.currentTarget.classList.toggle('active');
        processRadioData();
        
        if(APP.currentBand === 'radio') {
            APP.currentIndex = 0; 
            buildDial();
            loadTrack(0);
        }

        if (APP.radioState.viewMode === 'tracks') {
            renderTrackList();
        } else if (APP.radioState.viewMode === 'artists') {
            renderArtistList();
        }
    });
}

function openProgramGuide() {
    if(APP.currentBand !== 'radio') {
        renderBookList();
    } else {
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
    
    content.innerHTML = list.map((track, index) => {
        const trackWithSource = {...track, sourceType: APP.currentBand};
        const trackJson = JSON.stringify(trackWithSource).replace(/"/g, '&quot;');
        return `
        <div class="program-item ${index === APP.currentIndex ? 'active-track' : ''}" data-index="${index}">
            <div class="program-item-main">
                <div class="artist">${track.artist}</div>
                <div class="title">${track.title}</div>
            </div>
            <div class="program-item-actions">
                <button class="download-track-btn" data-track='${trackJson}' data-track-index="${index}" title="Download for offline">↓</button>
                <button class="add-to-playlist-btn" data-track-index="${index}" title="Add to playlist">+</button>
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

    content.querySelectorAll('.add-to-playlist-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const trackIndex = parseInt(btn.dataset.trackIndex);
            const track = {...list[trackIndex], sourceType: APP.currentBand};
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
                }
            } else {
                cacheTrack(track);
                btn.classList.add('downloading');
                setTimeout(() => btn.classList.remove('downloading'), 2000);
            }
        });
    });

    updateOfflineIndicators();

    setTimeout(() => {
        const activeItem = content.querySelector('.active-track');
        if (activeItem) {
            activeItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, 100);
}

function renderTrackList() {
    const content = $('program-guide-content');
    
    content.innerHTML = APP.radioPlaylist.map((track, index) => {
        const artist = track.artist || track.Artist;
        const title = track.title || track.Title;
        const trackWithSource = {...track, sourceType: 'radio'};
        const trackJson = JSON.stringify(trackWithSource).replace(/"/g, '&quot;');
        return `
        <div class="program-item ${index === APP.currentIndex ? 'active-track' : ''}" data-index="${index}">
            <div class="program-item-main">
                <div class="artist">${artist}</div>
                <div class="title">${title}</div>
            </div>
            <div class="program-item-actions">
                <button class="download-track-btn" data-track='${trackJson}' data-track-index="${index}" title="Download for offline">↓</button>
                <button class="add-to-playlist-btn" data-track-index="${index}" title="Add to playlist">+</button>
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

    content.querySelectorAll('.add-to-playlist-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const trackIndex = parseInt(btn.dataset.trackIndex);
            const track = {...APP.radioPlaylist[trackIndex], sourceType: 'radio'};
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
                }
            } else {
                cacheTrack(track);
                btn.classList.add('downloading');
                setTimeout(() => btn.classList.remove('downloading'), 2000);
            }
        });
    });

    updateOfflineIndicators();

    setTimeout(() => {
        const activeItem = content.querySelector('.active-track');
        if (activeItem) {
            activeItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, 100);
}

function renderArtistList() {
    const content = $('program-guide-content');
    const artists = {};
    APP.radioData.forEach(t => {
        const pf = t.ParentFolder;
        if(!artists[pf]) artists[pf] = 0;
        artists[pf]++;
    });
    const sortedArtists = Object.keys(artists).sort();
    content.innerHTML = sortedArtists.map(artist => `
        <div class="filter-item ${APP.radioState.activeArtistFilter === artist ? 'active-filter' : ''}" data-artist="${artist}">
            <div class="name">${artist.replace(/^\d+\s-\s/, '')}</div>
            <div class="count">${artists[artist]}</div>
        </div>
    `).join('');
    content.querySelectorAll('.filter-item').forEach(item => {
        item.addEventListener('click', () => {
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
    
    let html = `<div class="playlist-actions">
        <button class="create-playlist-btn" id="create-playlist-btn">+ New Playlist</button>
    </div>`;
    
    if (APP.userPlaylists.length === 0) {
        html += '<div class="playlist-empty-state">No playlists yet. Create one to save songs for offline listening!</div>';
    } else {
        html += APP.userPlaylists.map(pl => {
            const cachedCount = pl.tracks.filter(t => isTrackCached(t)).length;
            const allCached = cachedCount === pl.tracks.length && pl.tracks.length > 0;
            return `
            <div class="filter-item playlist-list-item" data-playlist-id="${pl.id}">
                <div class="playlist-info">
                    <div class="name">${pl.name}</div>
                    <div class="offline-status">${cachedCount}/${pl.tracks.length} offline</div>
                </div>
                <div class="playlist-meta">
                    <button class="download-playlist-btn ${allCached ? 'downloaded' : ''}" data-playlist-id="${pl.id}" title="${allCached ? 'All downloaded' : 'Download all for offline'}">↓</button>
                    <button class="delete-playlist-btn" data-playlist-id="${pl.id}" title="Delete playlist">×</button>
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
    
    if (!playlist) {
        renderPlaylistList();
        return;
    }
    
    const cachedCount = playlist.tracks.filter(t => isTrackCached(t)).length;
    const allCached = cachedCount === playlist.tracks.length && playlist.tracks.length > 0;
    
    let html = `<div class="playlist-header-bar">
        <button class="back-to-playlists-btn">← Back</button>
        <div class="playlist-title">${playlist.name}</div>
        ${playlist.tracks.length > 0 ? `<button class="download-all-btn ${allCached ? 'downloaded' : ''}" data-playlist-id="${playlistId}" title="${allCached ? 'All downloaded' : 'Download all'}">↓ All</button>` : ''}
    </div>`;
    
    if (playlist.tracks.length === 0) {
        html += '<div class="playlist-empty-state">This playlist is empty. Add songs from the Tracks view or from Book I/II!</div>';
    } else {
        html += playlist.tracks.map((track, index) => {
            const artist = track.artist || track.Artist;
            const title = track.title || track.Title;
            const isCached = isTrackCached(track);
            const trackJson = JSON.stringify(track).replace(/"/g, '&quot;');
            return `
            <div class="program-item playlist-track-item" data-track-index="${index}" data-playlist-id="${playlistId}">
                <div class="program-item-main">
                    <div class="artist">${artist}</div>
                    <div class="title">${title}</div>
                </div>
                <div class="program-item-actions">
                    <button class="download-track-btn ${isCached ? 'downloaded' : ''}" data-track='${trackJson}' data-track-index="${index}" title="${isCached ? 'Downloaded' : 'Download'}">↓</button>
                    <button class="remove-from-playlist-btn" data-track-index="${index}" title="Remove from playlist">×</button>
                </div>
            </div>`;
        }).join('');
    }
    
    content.innerHTML = html;
    
    content.querySelector('.back-to-playlists-btn').addEventListener('click', () => {
        renderPlaylistList();
    });
    
    const downloadAllBtn = content.querySelector('.download-all-btn');
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
            const track = playlist.tracks[trackIndex];
            
            // First try to find in current radio playlist
            let foundIndex = APP.radioPlaylist.findIndex(t => 
                (t.src_audio || t.Title + t.Artist) === (track.src_audio || track.Title + track.Artist)
            );
            
            if (foundIndex !== -1 && APP.currentBand === 'radio') {
                hideOnboardingHints();
                tuneToStation(foundIndex);
                closeProgramGuide();
                return;
            }
            
            // Check if it's from a book
            if (track.sourceType === 'book1' || track.sourceType === 'book2') {
                const bookPlaylist = APP.playlist[track.sourceType];
                if (bookPlaylist) {
                    foundIndex = bookPlaylist.findIndex(t => 
                        (t.src_audio || t.title + t.artist) === (track.src_audio || track.title + track.artist)
                    );
                    if (foundIndex !== -1) {
                        // Switch to the correct band
                        APP.currentBand = track.sourceType;
                        qsa('.band-btn').forEach(b => b.classList.remove('active'));
                        const bandBtn = qs(`.band-btn[data-band="${track.sourceType}"]`);
                        if (bandBtn) bandBtn.classList.add('active');
                        buildDial();
                        hideOnboardingHints();
                        setTimeout(() => tuneToStation(foundIndex), 100);
                        closeProgramGuide();
                        return;
                    }
                }
            }
            
            // Try radio as fallback
            foundIndex = APP.radioData ? APP.radioData.findIndex(t => 
                (t.src_audio || t.Title + t.Artist) === (track.src_audio || track.Title + track.Artist)
            ) : -1;
            
            if (foundIndex !== -1) {
                APP.currentBand = 'radio';
                qsa('.band-btn').forEach(b => b.classList.remove('active'));
                const bandBtn = qs('.band-btn[data-band="radio"]');
                if (bandBtn) bandBtn.classList.add('active');
                APP.radioState.activeArtistFilter = null;
                APP.radioState.activeGenre = null;
                processRadioData();
                buildDial();
                
                // Find the index in the processed playlist
                const processedIndex = APP.radioPlaylist.findIndex(t => 
                    (t.src_audio || t.Title + t.Artist) === (track.src_audio || track.Title + track.Artist)
                );
                
                if (processedIndex !== -1) {
                    hideOnboardingHints();
                    setTimeout(() => tuneToStation(processedIndex), 100);
                    closeProgramGuide();
                }
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
