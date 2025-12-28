// Offline Storage Manager using IndexedDB
const OfflineManager = {
    db: null,
    dbName: 'ZenithOffline',
    dbVersion: 2,  // Increment version for new playlists store
    
    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);
            
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve();
            };
            
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('tracks')) {
                    db.createObjectStore('tracks', { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains('metadata')) {
                    db.createObjectStore('metadata', { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains('playlists')) {
                    db.createObjectStore('playlists', { keyPath: 'id' });
                }
            };
        });
    },
    
    // Playlist Management
    async createPlaylist(name) {
        const id = 'playlist_' + Date.now();
        const playlist = { id, name, tracks: [], createdAt: Date.now() };
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('playlists', 'readwrite');
            tx.objectStore('playlists').put(playlist);
            tx.oncomplete = () => resolve(playlist);
            tx.onerror = () => reject(tx.error);
        });
    },
    
    async getAllPlaylists() {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('playlists', 'readonly');
            const request = tx.objectStore('playlists').getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    },
    
    async getPlaylist(id) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('playlists', 'readonly');
            const request = tx.objectStore('playlists').get(id);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    },
    
    async addTrackToPlaylist(playlistId, trackInfo) {
        const playlist = await this.getPlaylist(playlistId);
        if (!playlist) return false;
        
        // Check if track already in playlist
        const exists = playlist.tracks.some(t => t.trackId === trackInfo.trackId);
        if (exists) return true;
        
        playlist.tracks.push(trackInfo);
        
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('playlists', 'readwrite');
            tx.objectStore('playlists').put(playlist);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error);
        });
    },
    
    async removeTrackFromPlaylist(playlistId, trackId) {
        const playlist = await this.getPlaylist(playlistId);
        if (!playlist) return false;
        
        playlist.tracks = playlist.tracks.filter(t => t.trackId !== trackId);
        
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('playlists', 'readwrite');
            tx.objectStore('playlists').put(playlist);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error);
        });
    },
    
    async deletePlaylist(id) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('playlists', 'readwrite');
            tx.objectStore('playlists').delete(id);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    },
    
    async renamePlaylist(id, newName) {
        const playlist = await this.getPlaylist(id);
        if (!playlist) return false;
        
        playlist.name = newName;
        
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('playlists', 'readwrite');
            tx.objectStore('playlists').put(playlist);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error);
        });
    },
    
    async getPlaylistsForTrack(trackId) {
        const playlists = await this.getAllPlaylists();
        return playlists.filter(p => p.tracks.some(t => t.trackId === trackId)).map(p => p.id);
    },
    
    async saveTrack(id, audioBlob, metadata) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['tracks', 'metadata'], 'readwrite');
            tx.objectStore('tracks').put({ id, blob: audioBlob });
            tx.objectStore('metadata').put({ id, ...metadata });
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    },
    
    async getTrack(id) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('tracks', 'readonly');
            const request = tx.objectStore('tracks').get(id);
            request.onsuccess = () => resolve(request.result?.blob || null);
            request.onerror = () => reject(request.error);
        });
    },
    
    async hasTrack(id) {
        const track = await this.getTrack(id);
        return track !== null;
    },
    
    async deleteTrack(id) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['tracks', 'metadata'], 'readwrite');
            tx.objectStore('tracks').delete(id);
            tx.objectStore('metadata').delete(id);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    },
    
    async getAllMetadata() {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('metadata', 'readonly');
            const request = tx.objectStore('metadata').getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    },
    
    async getStorageUsage() {
        if ('storage' in navigator && 'estimate' in navigator.storage) {
            const estimate = await navigator.storage.estimate();
            return {
                used: estimate.usage || 0,
                quota: estimate.quota || 0
            };
        }
        return { used: 0, quota: 0 };
    },
    
    // Download a track for offline use
    async downloadTrack(url, id, metadata, onProgress) {
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error('Download failed');
            
            const contentLength = response.headers.get('content-length');
            const total = parseInt(contentLength, 10);
            let loaded = 0;
            
            const reader = response.body.getReader();
            const chunks = [];
            
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
                loaded += value.length;
                if (onProgress && total) {
                    onProgress(loaded / total);
                }
            }
            
            const blob = new Blob(chunks, { type: 'audio/mpeg' });
            await this.saveTrack(id, blob, metadata);
            return true;
        } catch (e) {
            console.error('Download error:', e);
            return false;
        }
    },
    
    // Get blob URL for offline playback
    async getOfflineUrl(id) {
        const blob = await this.getTrack(id);
        if (blob) {
            return URL.createObjectURL(blob);
        }
        return null;
    }
};

// Initialize on load
OfflineManager.init().catch(console.error);
