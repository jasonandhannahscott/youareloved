// ZENITH SERVICE WORKER - v3
// Network-first for app files, cache-first for audio only
const CACHE_VERSION = 3;
const CACHE_NAME = `zenith-app-v${CACHE_VERSION}`;
const AUDIO_CACHE_NAME = 'zenith-audio-v1';

// These get precached but served network-first
const APP_SHELL = [
    './',
    './index.php',
    './css/styles.css',
    './js/app.js',
    './js/auth-gate.js',
    './js/init.js',
    './js/offline.js',
    './manifest.json'
];

// External CDN assets - cache-first since they're versioned
const EXTERNAL_ASSETS = [
    'https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/gsap.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/Draggable.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/howler/2.2.3/howler.min.js'
];

self.addEventListener('install', (event) => {
    console.log(`[SW] Installing version ${CACHE_VERSION}`);
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[SW] Precaching app shell');
            return cache.addAll(APP_SHELL).catch(err => {
                console.warn('[SW] Some app shell assets failed to cache:', err);
            });
        })
    );
    // Force immediate activation - don't wait for old SW to stop
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    console.log(`[SW] Activating version ${CACHE_VERSION}`);
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    // Delete any cache that isn't current version (except audio cache)
                    if (cacheName !== CACHE_NAME && cacheName !== AUDIO_CACHE_NAME) {
                        console.log('[SW] Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => {
            console.log('[SW] Claiming clients');
            // Take control of all pages immediately
            return self.clients.claim();
        }).then(() => {
            // Notify all clients that SW was updated
            return self.clients.matchAll().then(clients => {
                clients.forEach(client => {
                    client.postMessage({
                        type: 'SW_UPDATED',
                        version: CACHE_VERSION
                    });
                });
            });
        })
    );
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    
    // Skip non-GET requests
    if (event.request.method !== 'GET') {
        return;
    }

    // AUDIO FILES: Cache-first (these are large and don't change)
    if (url.pathname.includes('serve.php') && url.searchParams.has('file')) {
        const filePath = url.searchParams.get('file');
        
        if (filePath.match(/\.(mp3|wav|ogg|m4a)$/i) || 
            filePath.includes('Book 1/') || 
            filePath.includes('Book 2/') || 
            filePath.includes('radio/')) {
            
            event.respondWith(
                caches.open(AUDIO_CACHE_NAME).then((cache) => {
                    return cache.match(event.request).then((cachedResponse) => {
                        if (cachedResponse) {
                            return cachedResponse;
                        }
                        return fetch(event.request).then((networkResponse) => {
                            if (networkResponse.ok) {
                                cache.put(event.request, networkResponse.clone());
                            }
                            return networkResponse;
                        }).catch(() => {
                            return new Response('Audio not available offline', { status: 503 });
                        });
                    });
                })
            );
            return;
        }
    }
    
    // JSON DATA: Network-first, cache as fallback
    if (url.pathname.includes('serve.php') && 
        (url.searchParams.get('file') === 'playlist.json' || 
         url.searchParams.get('file') === 'radio.json')) {
        event.respondWith(
            fetch(event.request).then((networkResponse) => {
                if (networkResponse.ok) {
                    const responseClone = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseClone);
                    });
                }
                return networkResponse;
            }).catch(() => {
                return caches.match(event.request);
            })
        );
        return;
    }

    // EXTERNAL CDN ASSETS: Cache-first (they're versioned in URL)
    if (url.hostname === 'cdnjs.cloudflare.com' || 
        url.hostname === 'fonts.googleapis.com' ||
        url.hostname === 'fonts.gstatic.com') {
        event.respondWith(
            caches.match(event.request).then((cachedResponse) => {
                if (cachedResponse) {
                    return cachedResponse;
                }
                return fetch(event.request).then((networkResponse) => {
                    if (networkResponse.ok) {
                        const responseClone = networkResponse.clone();
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(event.request, responseClone);
                        });
                    }
                    return networkResponse;
                });
            })
        );
        return;
    }

    // ALL APP FILES (PHP, JS, CSS, etc): Network-first with cache fallback
    // This ensures users always get fresh content when online
    event.respondWith(
        fetch(event.request).then((networkResponse) => {
            // Cache successful responses for offline use
            if (networkResponse.ok) {
                const responseClone = networkResponse.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put(event.request, responseClone);
                });
            }
            return networkResponse;
        }).catch(() => {
            // Offline - try to serve from cache
            return caches.match(event.request).then((cachedResponse) => {
                if (cachedResponse) {
                    return cachedResponse;
                }
                // Last resort for navigation requests
                if (event.request.destination === 'document') {
                    return caches.match('./');
                }
                return new Response('Offline', { status: 503 });
            });
        })
    );
});

// Handle messages from the main app
self.addEventListener('message', (event) => {
    if (event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
    
    if (event.data.type === 'CACHE_AUDIO') {
        const urls = event.data.urls;
        caches.open(AUDIO_CACHE_NAME).then((cache) => {
            urls.forEach(url => {
                fetch(url).then(response => {
                    if (response.ok) {
                        cache.put(url, response);
                        self.clients.matchAll().then(clients => {
                            clients.forEach(client => {
                                client.postMessage({
                                    type: 'AUDIO_CACHED',
                                    url: url
                                });
                            });
                        });
                    }
                }).catch(err => {
                    console.warn('[SW] Failed to cache audio:', url, err);
                    self.clients.matchAll().then(clients => {
                        clients.forEach(client => {
                            client.postMessage({
                                type: 'AUDIO_CACHE_FAILED',
                                url: url,
                                error: err.message
                            });
                        });
                    });
                });
            });
        });
    }
    
    if (event.data.type === 'UNCACHE_AUDIO') {
        const url = event.data.url;
        caches.open(AUDIO_CACHE_NAME).then((cache) => {
            cache.delete(url).then(() => {
                self.clients.matchAll().then(clients => {
                    clients.forEach(client => {
                        client.postMessage({
                            type: 'AUDIO_UNCACHED',
                            url: url
                        });
                    });
                });
            });
        });
    }
    
    if (event.data.type === 'GET_CACHED_URLS') {
        caches.open(AUDIO_CACHE_NAME).then((cache) => {
            cache.keys().then(requests => {
                const urls = requests.map(req => req.url);
                self.clients.matchAll().then(clients => {
                    clients.forEach(client => {
                        client.postMessage({
                            type: 'CACHED_URLS_LIST',
                            urls: urls
                        });
                    });
                });
            });
        });
    }
    
    if (event.data.type === 'CLEAR_AUDIO_CACHE') {
        caches.delete(AUDIO_CACHE_NAME).then(() => {
            self.clients.matchAll().then(clients => {
                clients.forEach(client => {
                    client.postMessage({
                        type: 'AUDIO_CACHE_CLEARED'
                    });
                });
            });
        });
    }
    
    if (event.data.type === 'GET_VERSION') {
        event.source.postMessage({
            type: 'SW_VERSION',
            version: CACHE_VERSION
        });
    }
});
