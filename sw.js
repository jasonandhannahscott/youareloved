const CACHE_NAME = 'zenith-v1';
const AUDIO_CACHE_NAME = 'zenith-audio-v1';

const APP_SHELL = [
    './',
    './index.php',
    './css/styles.css',
    './js/app.js',
    './js/auth-gate.js',
    './js/init.js',
    './manifest.json',
    './icons/icon-192.png',
    './icons/icon-512.png'
];

const EXTERNAL_ASSETS = [
    'https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/gsap.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/Draggable.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/howler/2.2.3/howler.min.js',
    'https://fonts.googleapis.com/css2?family=Crimson+Text:ital,wght@0,400;0,600;1,400&family=Oswald:wght@300;400;500;600;700&display=swap'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('Caching app shell');
            return cache.addAll(APP_SHELL).catch(err => {
                console.warn('Some app shell assets failed to cache:', err);
            });
        })
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME && cacheName !== AUDIO_CACHE_NAME) {
                        console.log('Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    
    // Handle audio file requests (serve.php with file parameter)
    if (url.pathname.includes('serve.php') && url.searchParams.has('file')) {
        const filePath = url.searchParams.get('file');
        
        // Check if it's an audio file
        if (filePath.match(/\.(mp3|wav|ogg|m4a)$/i) || 
            filePath.includes('Book 1/') || 
            filePath.includes('Book 2/') || 
            filePath.includes('radio/')) {
            
            event.respondWith(
                caches.open(AUDIO_CACHE_NAME).then((cache) => {
                    return cache.match(event.request).then((cachedResponse) => {
                        if (cachedResponse) {
                            console.log('Serving from audio cache:', filePath);
                            return cachedResponse;
                        }
                        
                        return fetch(event.request).then((networkResponse) => {
                            if (networkResponse.ok) {
                                cache.put(event.request, networkResponse.clone());
                            }
                            return networkResponse;
                        }).catch(() => {
                            console.warn('Audio not available offline:', filePath);
                            return new Response('Audio not available offline', { status: 503 });
                        });
                    });
                })
            );
            return;
        }
    }
    
    // Handle JSON data files
    if (url.pathname.includes('serve.php') && 
        (url.searchParams.get('file') === 'playlist.json' || 
         url.searchParams.get('file') === 'radio.json')) {
        event.respondWith(
            caches.open(CACHE_NAME).then((cache) => {
                return fetch(event.request).then((networkResponse) => {
                    if (networkResponse.ok) {
                        cache.put(event.request, networkResponse.clone());
                    }
                    return networkResponse;
                }).catch(() => {
                    return cache.match(event.request);
                });
            })
        );
        return;
    }
    
    // Network first for PHP/dynamic content
    if (url.pathname.endsWith('.php')) {
        event.respondWith(
            fetch(event.request).catch(() => {
                return caches.match(event.request).then((cachedResponse) => {
                    return cachedResponse || caches.match('./');
                });
            })
        );
        return;
    }
    
    // Cache first for static assets
    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) {
                return cachedResponse;
            }
            
            return fetch(event.request).then((networkResponse) => {
                if (networkResponse.ok && 
                    (event.request.url.includes('.css') || 
                     event.request.url.includes('.js') ||
                     event.request.url.includes('.png') ||
                     event.request.url.includes('.woff'))) {
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, networkResponse.clone());
                    });
                }
                return networkResponse;
            }).catch(() => {
                // Return offline fallback if available
                if (event.request.destination === 'document') {
                    return caches.match('./');
                }
            });
        })
    );
});

// Handle messages from the main app
self.addEventListener('message', (event) => {
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
                    console.warn('Failed to cache audio:', url, err);
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
});
