// ================================================================
// SERVICE WORKER - DENGAN DETEKSI KEKUATAN SINYAL
// Avenza-Style Navigation PWA
// ================================================================

const CACHE_NAME = 'avnza-v4';
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/manifest.json',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
];

// Konfigurasi threshold sinyal
const SIGNAL_CONFIG = {
    // Threshold dalam persentase (0-100)
    VERY_WEAK: 15,      // < 15% -> Gunakan cache selalu
    WEAK: 30,           // 15-30% -> Prioritaskan cache
    MEDIUM: 60,         // 30-60% -> Balance (network dengan timeout)
    STRONG: 80,         // 60-80% -> Network first dengan cache
    VERY_STRONG: 100    // > 80% -> Network first, cache background
};

// ============================================
// NETWORK QUALITY DETECTOR
// ============================================
class NetworkQualityDetector {
    constructor() {
        this.quality = 'unknown';
        this.signalStrength = 100;
        this.lastCheck = 0;
        this.checkInterval = 30000; // 30 detik
        this.history = [];
        this.maxHistory = 10;
    }

    // Deteksi kualitas dengan multiple methods
    async detectQuality() {
        // Method 1: Network Information API
        const networkInfo = this.getNetworkInfoAPI();
        
        // Method 2: Test download speed
        const speedTest = await this.testDownloadSpeed();
        
        // Method 3: Check connection status
        const connectionStatus = this.checkConnectionStatus();
        
        // Kombinasikan semua metode
        const combined = this.combineResults(networkInfo, speedTest, connectionStatus);
        
        this.signalStrength = combined.strength;
        this.quality = combined.quality;
        this.lastCheck = Date.now();
        
        // Simpan history
        this.history.push(combined);
        if (this.history.length > this.maxHistory) {
            this.history.shift();
        }
        
        console.log(`[SW] Signal strength: ${this.signalStrength}% (${this.quality})`);
        return combined;
    }

    // Method 1: Network Information API
    getNetworkInfoAPI() {
        try {
            // @ts-ignore - Network Information API
            const connection = navigator.connection || 
                             navigator.mozConnection || 
                             navigator.webkitConnection;
            
            if (connection) {
                let strength = 100;
                let quality = 'very-strong';
                
                // Based on effectiveType
                switch (connection.effectiveType) {
                    case 'slow-2g':
                        strength = 10;
                        quality = 'very-weak';
                        break;
                    case '2g':
                        strength = 20;
                        quality = 'weak';
                        break;
                    case '3g':
                        strength = 50;
                        quality = 'medium';
                        break;
                    case '4g':
                        strength = 80;
                        quality = 'strong';
                        break;
                    case '5g':
                        strength = 95;
                        quality = 'very-strong';
                        break;
                    default:
                        strength = 70;
                        quality = 'medium';
                }
                
                // Adjust with rtt if available
                if (connection.rtt) {
                    if (connection.rtt > 500) strength -= 20;
                    else if (connection.rtt > 300) strength -= 10;
                    else if (connection.rtt > 150) strength -= 5;
                }
                
                // Adjust with downlink speed
                if (connection.downlink) {
                    if (connection.downlink < 0.5) strength -= 30;
                    else if (connection.downlink < 1) strength -= 15;
                    else if (connection.downlink < 2) strength -= 5;
                }
                
                return {
                    strength: Math.max(0, Math.min(100, strength)),
                    quality: quality,
                    method: 'NetworkInfoAPI',
                    details: {
                        type: connection.effectiveType,
                        rtt: connection.rtt,
                        downlink: connection.downlink
                    }
                };
            }
        } catch (e) {
            console.log('[SW] NetworkInfoAPI not available');
        }
        
        return null;
    }

    // Method 2: Test download speed
    async testDownloadSpeed() {
        try {
            const startTime = Date.now();
            const testFile = 'https://www.google.com/favicon.ico';
            
            const response = await fetch(testFile, {
                mode: 'no-cors',
                cache: 'no-store'
            });
            
            const endTime = Date.now();
            const duration = endTime - startTime;
            
            let strength = 100;
            let quality = 'very-strong';
            
            if (duration > 3000) {
                strength = 10;
                quality = 'very-weak';
            } else if (duration > 1500) {
                strength = 25;
                quality = 'weak';
            } else if (duration > 700) {
                strength = 50;
                quality = 'medium';
            } else if (duration > 300) {
                strength = 75;
                quality = 'strong';
            } else {
                strength = 95;
                quality = 'very-strong';
            }
            
            return {
                strength: strength,
                quality: quality,
                method: 'SpeedTest',
                details: {
                    duration: duration,
                    size: 'unknown'
                }
            };
        } catch (e) {
            return null;
        }
    }

    // Method 3: Check connection status
    checkConnectionStatus() {
        if (navigator.onLine) {
            // Coba ping ke beberapa server
            return {
                strength: 70,
                quality: 'medium',
                method: 'ConnectionStatus',
                details: { online: true }
            };
        } else {
            return {
                strength: 0,
                quality: 'offline',
                method: 'ConnectionStatus',
                details: { online: false }
            };
        }
    }

    // Kombinasikan semua hasil
    combineResults(networkInfo, speedTest, connectionStatus) {
        const results = [];
        
        if (networkInfo) results.push(networkInfo);
        if (speedTest) results.push(speedTest);
        if (connectionStatus) results.push(connectionStatus);
        
        if (results.length === 0) {
            return {
                strength: 70,
                quality: 'medium',
                method: 'default'
            };
        }
        
        // Average strength
        const avgStrength = results.reduce((sum, r) => sum + r.strength, 0) / results.length;
        
        // Determine quality based on average strength
        let quality = 'unknown';
        if (avgStrength >= SIGNAL_CONFIG.VERY_STRONG) quality = 'very-strong';
        else if (avgStrength >= SIGNAL_CONFIG.STRONG) quality = 'strong';
        else if (avgStrength >= SIGNAL_CONFIG.MEDIUM) quality = 'medium';
        else if (avgStrength >= SIGNAL_CONFIG.WEAK) quality = 'weak';
        else if (avgStrength >= SIGNAL_CONFIG.VERY_WEAK) quality = 'very-weak';
        else quality = 'offline';
        
        return {
            strength: Math.round(avgStrength),
            quality: quality,
            method: 'combined',
            details: {
                methods: results.map(r => r.method),
                count: results.length
            }
        };
    }

    // Get cached quality (jika belum di-check)
    async getQuality() {
        // Jika sudah ada hasil dan masih fresh
        if (this.quality !== 'unknown' && (Date.now() - this.lastCheck) < this.checkInterval) {
            return {
                quality: this.quality,
                strength: this.signalStrength,
                cached: true,
                age: (Date.now() - this.lastCheck) / 1000
            };
        }
        
        // Check ulang
        const result = await this.detectQuality();
        return {
            quality: result.quality,
            strength: result.strength,
            cached: false,
            age: 0
        };
    }

    // Decision: Gunakan cache atau network?
    shouldUseCache(strength) {
        if (strength <= SIGNAL_CONFIG.VERY_WEAK) {
            return { useCache: true, reason: 'Sinyal sangat lemah (< 15%)' };
        } else if (strength <= SIGNAL_CONFIG.WEAK) {
            return { useCache: true, reason: 'Sinyal lemah (15-30%)' };
        } else if (strength <= SIGNAL_CONFIG.MEDIUM) {
            // Untuk sinyal medium, coba network dengan timeout
            return { useCache: 'timeout', reason: 'Sinyal medium (30-60%), gunakan timeout' };
        } else if (strength <= SIGNAL_CONFIG.STRONG) {
            return { useCache: false, reason: 'Sinyal kuat (60-80%)' };
        } else {
            return { useCache: false, reason: 'Sinyal sangat kuat (> 80%)' };
        }
    }
}

// ============================================
// INSTALL
// ============================================
const detector = new NetworkQualityDetector();

self.addEventListener('install', event => {
    console.log('[SW] Install event - With Signal Detection');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('[SW] Caching static assets...');
                return cache.addAll(STATIC_ASSETS);
            })
            .then(() => {
                console.log('[SW] Assets cached');
                return self.skipWaiting();
            })
            .catch(error => {
                console.error('[SW] Cache failed:', error);
            })
    );
});

// ============================================
// ACTIVATE
// ============================================
self.addEventListener('activate', event => {
    console.log('[SW] Activate event');
    event.waitUntil(
        caches.keys()
            .then(cacheNames => {
                return Promise.all(
                    cacheNames.map(cacheName => {
                        if (cacheName !== CACHE_NAME) {
                            console.log('[SW] Deleting old cache:', cacheName);
                            return caches.delete(cacheName);
                        }
                    })
                );
            })
            .then(() => {
                console.log('[SW] Ready with signal detection');
                return self.clients.claim();
            })
    );
});

// ============================================
// FETCH - DENGAN DETEKSI SINYAL
// ============================================
self.addEventListener('fetch', event => {
    const request = event.request;
    const url = new URL(request.url);

    // Skip non-GET dan internal requests
    if (request.method !== 'GET') return;
    if (url.protocol === 'chrome-extension:' || url.protocol === 'chrome:') return;
    if (url.hostname.includes('google-analytics')) return;

    // Handle dengan signal detection
    event.respondWith(handleRequestWithSignal(request));
});

// ============================================
// MAIN REQUEST HANDLER
// ============================================
async function handleRequestWithSignal(request) {
    // 1. DETEKSI KEKUATAN SINYAL
    let quality;
    try {
        quality = await detector.getQuality();
    } catch (e) {
        quality = { quality: 'unknown', strength: 50 };
    }
    
    console.log(`[SW] Signal: ${quality.strength}% (${quality.quality})`);
    
    // 2. AMBIL KEPUTUSAN
    const decision = detector.shouldUseCache(quality.strength);
    console.log(`[SW] Decision: ${decision.useCache ? 'USE CACHE' : 'USE NETWORK'} - ${decision.reason}`);
    
    // 3. EKSEKUSI BERDASARKAN KEPUTUSAN
    if (decision.useCache === true) {
        // Sinyal lemah -> PAKAI CACHE
        return handleWeakSignal(request);
    } else if (decision.useCache === 'timeout') {
        // Sinyal medium -> Coba network dengan timeout
        return handleMediumSignal(request);
    } else {
        // Sinyal kuat -> PAKAI NETWORK
        return handleStrongSignal(request);
    }
}

// ============================================
// HANDLER UNTUK SINYAL LEMAH (< 30%)
// ============================================
async function handleWeakSignal(request) {
    console.log('[SW] 🟡 Weak signal - Using cache only');
    
    // Coba dari cache
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
        return cachedResponse;
    }
    
    // Jika tidak ada di cache, coba network (dengan timeout pendek)
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 detik timeout
        
        const response = await fetch(request, { signal: controller.signal });
        clearTimeout(timeoutId);
        
        if (response && response.status === 200) {
            // Cache untuk next time
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, response.clone());
            return response;
        }
    } catch (e) {
        console.log('[SW] Network failed on weak signal');
    }
    
    // Fallback
    return getFallbackResponse(request);
}

// ============================================
// HANDLER UNTUK SINYAL MEDIUM (30-60%)
// ============================================
async function handleMediumSignal(request) {
    console.log('[SW] 🟠 Medium signal - Try network with timeout, fallback to cache');
    
    // 1. Coba network dengan timeout
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 detik timeout
        
        const response = await fetch(request, { signal: controller.signal });
        clearTimeout(timeoutId);
        
        if (response && response.status === 200) {
            // Update cache di background
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, response.clone());
            return response;
        }
    } catch (e) {
        console.log('[SW] Network timeout or error on medium signal');
    }
    
    // 2. Jika network gagal, ambil dari cache
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
        console.log('[SW] Serving from cache (medium signal)');
        return cachedResponse;
    }
    
    return getFallbackResponse(request);
}

// ============================================
// HANDLER UNTUK SINYAL KUAT (> 60%)
// ============================================
async function handleStrongSignal(request) {
    console.log('[SW] 🟢 Strong signal - Using network, caching background');
    
    try {
        const response = await fetch(request);
        
        if (response && response.status === 200) {
            // Cache di background (jangan block response)
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, response.clone());
            return response;
        }
    } catch (e) {
        console.log('[SW] Network failed on strong signal (unexpected)');
        // Fallback ke cache
        const cachedResponse = await caches.match(request);
        if (cachedResponse) return cachedResponse;
    }
    
    return getFallbackResponse(request);
}

// ============================================
// FALLBACK RESPONSE
// ============================================
async function getFallbackResponse(request) {
    const url = new URL(request.url);
    
    // HTML fallback
    if (request.headers.get('Accept')?.includes('text/html')) {
        const htmlCache = await caches.match('/index.html');
        if (htmlCache) return htmlCache;
        
        return new Response(`
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Offline - Avenza Navigation</title>
                <style>
                    body {
                        font-family: Arial, sans-serif;
                        text-align: center;
                        padding: 50px 20px;
                        background: #f5f5f5;
                        margin: 0;
                    }
                    .offline-box {
                        max-width: 400px;
                        margin: 0 auto;
                        padding: 40px 30px;
                        background: white;
                        border-radius: 15px;
                        box-shadow: 0 4px 20px rgba(0,0,0,0.1);
                    }
                    .offline-icon { font-size: 64px; margin-bottom: 10px; }
                    h1 { color: #333; margin: 10px 0; }
                    p { color: #666; line-height: 1.6; }
                    .signal-badge {
                        display: inline-block;
                        padding: 4px 12px;
                        border-radius: 20px;
                        font-size: 12px;
                        font-weight: bold;
                        margin: 10px 0;
                    }
                    .signal-weak { background: #ffeb3b; color: #333; }
                    .retry-btn {
                        padding: 12px 30px;
                        background: #4CAF50;
                        color: white;
                        border: none;
                        border-radius: 8px;
                        font-size: 16px;
                        cursor: pointer;
                        margin-top: 15px;
                        transition: background 0.3s;
                    }
                    .retry-btn:hover { background: #45a049; }
                    .small-text {
                        font-size: 12px;
                        color: #999;
                        margin-top: 20px;
                    }
                </style>
            </head>
            <body>
                <div class="offline-box">
                    <div class="offline-icon">📡</div>
                    <h1>Koneksi Terbatas</h1>
                    <div class="signal-badge signal-weak">📶 Sinyal Lemah</div>
                    <p>Koneksi internet tidak tersedia atau sinyal sangat lemah.<br>
                    Silakan coba lagi nanti atau periksa koneksi Anda.</p>
                    <button class="retry-btn" onclick="location.reload()">🔄 Coba Lagi</button>
                    <div class="small-text">Aplikasi akan tetap berjalan dengan data tersimpan</div>
                </div>
            </body>
            </html>
        `, {
            headers: { 'Content-Type': 'text/html' }
        });
    }
    
    // Image fallback
    if (request.headers.get('Accept')?.includes('image')) {
        return new Response(null, { status: 404 });
    }
    
    // Default
    return new Response('Offline - Sinyal lemah', {
        status: 503,
        statusText: 'Weak Signal',
        headers: { 'Content-Type': 'text/plain' }
    });
}

// ============================================
// MESSAGE HANDLING - Untuk komunikasi dengan client
// ============================================
self.addEventListener('message', event => {
    console.log('[SW] Message received:', event.data);
    
    switch (event.data?.type) {
        case 'CHECK_SIGNAL':
            // Kirim kekuatan sinyal ke client
            (async () => {
                const quality = await detector.getQuality();
                event.ports[0]?.postMessage({
                    type: 'SIGNAL_STRENGTH',
                    strength: quality.strength,
                    quality: quality.quality,
                    timestamp: Date.now()
                });
            })();
            break;
            
        case 'SKIP_WAITING':
            self.skipWaiting();
            break;
            
        case 'CLEAR_CACHE':
            caches.delete(CACHE_NAME);
            event.ports[0]?.postMessage({ success: true });
            break;
            
        case 'GET_CACHE_STATUS':
            caches.open(CACHE_NAME).then(cache => {
                cache.keys().then(keys => {
                    event.ports[0]?.postMessage({
                        count: keys.length,
                        cacheName: CACHE_NAME,
                        timestamp: Date.now()
                    });
                });
            });
            break;
            
        case 'SET_SIGNAL_CONFIG':
            if (event.data.config) {
                Object.assign(SIGNAL_CONFIG, event.data.config);
                event.ports[0]?.postMessage({ success: true });
            }
            break;
    }
});

// ============================================
// PUSH NOTIFICATION
// ============================================
self.addEventListener('push', event => {
    const options = {
        body: event.data ? event.data.text() : 'Ada update baru!',
        icon: '/icon-192x192.png',
        badge: '/icon-72x72.png',
        vibrate: [200, 100, 200],
        data: { dateOfArrival: Date.now() },
        actions: [
            { action: 'open', title: 'Buka Aplikasi' }
        ]
    };

    event.waitUntil(
        self.registration.showNotification('🚀 Avenza Navigation', options)
    );
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    if (event.action === 'open') {
        event.waitUntil(clients.openWindow('/'));
    }
});

// ============================================
// LOG STARTUP
// ============================================
console.log(`[SW] ✅ Service Worker with Signal Detection (${CACHE_NAME})`);
console.log('[SW] 📡 Signal thresholds:');
console.log(`    Very Weak: ${SIGNAL_CONFIG.VERY_WEAK}%`);
console.log(`    Weak: ${SIGNAL_CONFIG.WEAK}%`);
console.log(`    Medium: ${SIGNAL_CONFIG.MEDIUM}%`);
console.log(`    Strong: ${SIGNAL_CONFIG.STRONG}%`);
console.log(`    Very Strong: ${SIGNAL_CONFIG.VERY_STRONG}%`);
