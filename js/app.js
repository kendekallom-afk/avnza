/* ============================================================
   mMaps - Main Application Script
   ============================================================ */

// ===== GLOBAL VARIABLES =====
let map, userLocationMarker=null, currentHeading=null, currentView='layers', waypointCount=1, latestCoords=null, activeMapId=null;
let gdalReady=false, gdal=null, activeLayers={}, scannedKmzFiles=[], defaultDirHandle=null, mapCollection=[], webpOpacity=1;

let selectedNotebookId = null;
let editingPointIndex = null;
let pePhotoObjectUrl = null;
let modalBackStatePushed = false;
let pointThumbUrls = [];
let accumulatedHeading = 0;
let lastHeading = null;
let renderedHeading = null;
let headingAnimationFrame = null;

// ===== MEASURE VARIABLES =====
let measureActive = false;
let measurePoints = [];
let measureMarkers = [];
let measureSvg = null;
let measureDist = 0;
let measureArea = 0;
let measureClosed = false;
let measureOverlay = null;

// ===== TRACKING VARIABLES =====
let isTracking = false;
let trackIntervalId = null;

// ===== PENDING FIT BOUNDS =====
let pendingFitBounds = null;

// ===== SPLASH SCREEN =====
let _splashDone = false;
let _splashMinElapsed = false;
let _splashAppReady = false;

function setSplashProgress(pct) {
    const bar = document.getElementById('splash-progress-bar');
    const label = document.getElementById('splash-percent');
    const v = Math.max(0, Math.min(100, Math.round(pct)));
    if (bar) bar.style.width = v + '%';
    if (label) label.textContent = v + '%';
}

function hideSplashScreen() {
    if (_splashDone) return;
    _splashDone = true;
    setSplashProgress(100);
    const el = document.getElementById('splash-screen');
    if (!el) return;
    setTimeout(function () {
        el.classList.add('hide');
        setTimeout(function () {
            if (el && el.parentNode) el.parentNode.removeChild(el);
        }, 350);
    }, 120);
}

function tryHideSplash() {
    if (_splashMinElapsed && _splashAppReady) hideSplashScreen();
}

function startSplashProgress() {
    const duration = 3000;
    const start = performance.now();
    function frame(now) {
        if (_splashDone) return;
        const t = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - t, 2.2);
        setSplashProgress(eased * 100);
        if (t < 1) requestAnimationFrame(frame);
        else { _splashMinElapsed = true; tryHideSplash(); }
    }
    requestAnimationFrame(frame);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startSplashProgress);
} else {
    startSplashProgress();
}

// ===== DATABASE =====
const DB_NAME='AvenzaNavDB', STORE_NAME='maps', PHOTO_STORE='photos';
function openDB(){return new Promise((resolve,reject)=>{const req=indexedDB.open(DB_NAME,4);req.onupgradeneeded=(e)=>{const db=e.target.result;if(!db.objectStoreNames.contains(STORE_NAME))db.createObjectStore(STORE_NAME,{keyPath:'id'});if(!db.objectStoreNames.contains('config'))db.createObjectStore('config');if(!db.objectStoreNames.contains(PHOTO_STORE))db.createObjectStore(PHOTO_STORE,{keyPath:'id'});};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
async function saveMapToDB(mapData){const db=await openDB();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE_NAME,'readwrite');tx.objectStore(STORE_NAME).put(mapData);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});}
async function getAllMapsFromDB(){const db=await openDB();return new Promise((resolve,reject)=>{const req=db.transaction(STORE_NAME,'readonly').objectStore(STORE_NAME).getAll();req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
async function deleteMapFromDB(id){const db=await openDB();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE_NAME,'readwrite');tx.objectStore(STORE_NAME).delete(id);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});}
function saveConfig(key,value){return openDB().then(db=>new Promise((resolve,reject)=>{const tx=db.transaction('config','readwrite');tx.objectStore('config').put(value,key);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);}));}
function getConfig(key){return openDB().then(db=>new Promise((resolve,reject)=>{const req=db.transaction('config','readonly').objectStore('config').get(key);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);}));}
async function savePhotoToDB(photoData){const db=await openDB();return new Promise((resolve,reject)=>{const tx=db.transaction(PHOTO_STORE,'readwrite');tx.objectStore(PHOTO_STORE).put(photoData);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});}
async function getPhotoFromDB(id){const db=await openDB();return new Promise((resolve,reject)=>{const req=db.transaction(PHOTO_STORE,'readonly').objectStore(PHOTO_STORE).get(id);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
async function deletePhotoFromDB(id){const db=await openDB();return new Promise((resolve,reject)=>{const tx=db.transaction(PHOTO_STORE,'readwrite');tx.objectStore(PHOTO_STORE).delete(id);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});}
async function deletePhotoQuiet(photoId){if(!photoId)return;try{await deletePhotoFromDB(photoId);}catch(e){}}

// ===== MAP INIT =====
function initMap(){
    map = L.map('map', { zoomControl: false, maxZoom: 22, rotate: true, touchRotate: true }).setView([-2.66491, 118.85193], 15);
    map.createPane('measurePane');
    map.getPane('measurePane').style.zIndex = 700;
    map.on('rotate', function() { applyHeadingRotation(); updateMeasureDotPositions(); });
    map.on('move', function(){ updateReticleCoordinates(); updateMeasureDotPositions(); });
    map.on('zoom zoomend', updateMeasureDotPositions);
    updateReticleCoordinates();
    //setBasemap('osm');
    loadAllMapsFromDB();
    window._gpsWatchId = null;
    initGPSWatcher();
    initOrientationWatcher();
    initGDAL();
}

function updateReticleCoordinates(){
    if (!map) return;
    const c = (typeof getCrosshairLatLng === 'function' && getCrosshairLatLng()) || map.getCenter();
    document.getElementById('lat').innerText = c.lat.toFixed(6);
    document.getElementById('lng').innerText = c.lng.toFixed(6);
}

// ===== ⚠️ GDAL: path sudah diubah ke lokal =====
async function initGDAL(){
    try{
        if(typeof initGdalJs!=='function'){gdalReady=false;return;}
        gdal = await initGdalJs({ path: 'libs/gdal3', useWorker: false });
        gdalReady=!!gdal;
        showNotification('✅ Mesin GIS siap',1800);
    }catch(err){console.warn('GDAL init gagal:',err);gdalReady=false;gdal=null;}
}

async function loadAllMapsFromDB(){
    try{
        mapCollection=await getAllMapsFromDB();
        renderLibraryContent();renderPointsView();
        const savedBasemap=await getConfig('basemapKey');
        if(savedBasemap)setBasemap(savedBasemap);
        const actives=mapCollection.filter(m=>m.isActive);
        actives.forEach(m=>activateMap(m.id));
        const lastView=await getLastView();
        setTimeout(function(){
            restoreLastView(lastView);
            _splashAppReady = true;
            tryHideSplash();
        }, 200);
    }catch(e){
        console.warn(e);mapCollection=[];_splashAppReady = true;tryHideSplash();
    }
}

// ===== GPS =====
function centerToGPS() {
    if (!navigator.geolocation) { alert("Geolocation tidak didukung."); return; }
    const z = map.getZoom();
    if (map.setBearing) map.setBearing(0);
    applyHeadingRotation();
    if (latestCoords) {
        map.setView([latestCoords.lat, latestCoords.lng], z);
        updateUserMarker(latestCoords.lat, latestCoords.lng);
    } else {
        navigator.geolocation.getCurrentPosition(
            function(pos) {
                latestCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                map.setView([latestCoords.lat, latestCoords.lng], z);
                updateUserMarker(latestCoords.lat, latestCoords.lng);
                applyHeadingRotation();
            },
            function(err) { console.warn("Gagal GPS:", err); alert("Tidak dapat mendapatkan lokasi GPS."); },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
    }
}

function startTrackingMode() {
    if (isTracking) return;
    isTracking = true;
    trackIntervalId = setInterval(function() {
        if (latestCoords) map.setView([latestCoords.lat, latestCoords.lng], map.getZoom());
    }, 3000);
}
function stopTrackingMode() {
    isTracking = false;
    if (trackIntervalId) { clearInterval(trackIntervalId); trackIntervalId = null; }
}

function updateUserMarker(lat,lng){
    if(userLocationMarker){userLocationMarker.setLatLng([lat,lng]);}
    else{
        const icon=L.divIcon({
            className:'custom-user-icon',
            html:`<div class="user-location-container"><div class="user-heading-wrapper" id="user-heading-wrapper"><div class="user-heading-cone"></div><div class="heading-pointer-dot"></div></div><div class="user-pulse"></div><div class="user-dot"></div></div>`,
            iconSize:[60,60], iconAnchor:[30,30]
        });
        userLocationMarker=L.marker([lat,lng],{icon}).addTo(map);
    }
}
function updateHeadingPointer() {
    const wrapper = document.getElementById('user-heading-wrapper');
    if (!wrapper) return;
    applyHeadingRotation();
}
function applyHeadingRotation() {
    const wrapper = document.getElementById('user-heading-wrapper');
    if (!wrapper) return;
    if (currentHeading === null) return;
    let mapBearing = 0;
    if (map && typeof map.getBearing === 'function') mapBearing = map.getBearing() || 0;
    const targetHeading = currentHeading + mapBearing;

    if (renderedHeading === null) renderedHeading = targetHeading;
    if (headingAnimationFrame !== null) return;

    function renderHeading() {
        const latestBearing = map && typeof map.getBearing === 'function' ? (map.getBearing() || 0) : 0;
        const latestTarget = currentHeading + latestBearing;
        const difference = latestTarget - renderedHeading;

        if (Math.abs(difference) < 0.05) {
            renderedHeading = latestTarget;
            wrapper.style.transform = 'rotate(' + renderedHeading + 'deg)';
            headingAnimationFrame = null;
            return;
        }

        renderedHeading += difference * 0.18;
        wrapper.style.transform = 'rotate(' + renderedHeading + 'deg)';
        headingAnimationFrame = requestAnimationFrame(renderHeading);
    }

    headingAnimationFrame = requestAnimationFrame(renderHeading);
}
function checkCompassStatus() {
    console.log('=== STATUS KOMPAS ===');
    console.log('Current Heading:', currentHeading);
    console.log('Wrapper Element:', document.getElementById('user-heading-wrapper'));
    console.log('Map Bearing:', map ? map.getBearing() : 'N/A');
    applyHeadingRotation();
}
function handleOrientation(event) {
    let heading = null;
    if (typeof event.webkitCompassHeading === 'number' && !isNaN(event.webkitCompassHeading)) heading = event.webkitCompassHeading;
    else if (typeof event.alpha === 'number' && !isNaN(event.alpha)) heading = 360 - event.alpha;
    if (heading === null) return;
    heading = ((heading % 360) + 360) % 360;
    if (lastHeading === null) {
        accumulatedHeading = heading;
    } else {
        const delta = ((heading - lastHeading + 540) % 360) - 180;
        accumulatedHeading += delta;
    }
    lastHeading = heading;
    currentHeading = accumulatedHeading;
    applyHeadingRotation();
}
function initOrientationWatcher() {
    if (typeof DeviceOrientationEvent === 'undefined') { console.warn('❌ DeviceOrientation tidak didukung'); return; }
    function startOrientationListeners() {
        if ('ondeviceorientationabsolute' in window) {
            window.addEventListener('deviceorientationabsolute', handleOrientation, true);
            console.log('✅ Kompas: deviceorientationabsolute');
        } else {
            window.addEventListener('deviceorientation', handleOrientation, true);
            console.log('✅ Kompas: deviceorientation');
        }
    }
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        DeviceOrientationEvent.requestPermission().then(function(response) {
            if (response === 'granted') { startOrientationListeners(); console.log('✅ Izin kompas diberikan'); }
            else console.warn('❌ Izin kompas ditolak');
        }).catch(function(err) { console.warn('❌ Gagal minta izin kompas:', err); });
    } else startOrientationListeners();
}
function refreshGPS() {
    const statusEl = document.getElementById('gps-status');
    const accuracyEl = document.getElementById('gps-accuracy');
    if (statusEl) { statusEl.textContent = 'Memperbarui...'; statusEl.className = 'value status-no-signal'; }
    if (accuracyEl) accuracyEl.textContent = '-';
    if (window._gpsWatchId) { navigator.geolocation.clearWatch(window._gpsWatchId); window._gpsWatchId = null; }
    startGPS();
}
function startGPS() {
    const statusEl = document.getElementById('gps-status');
    const accuracyEl = document.getElementById('gps-accuracy');
    const latEl = document.getElementById('lat');
    const lngEl = document.getElementById('lng');
    if (!navigator.geolocation) {
        if (statusEl) { statusEl.textContent = 'Tidak Didukung'; statusEl.className = 'value status-no-signal'; }
        if (accuracyEl) accuracyEl.textContent = 'API tidak ada';
        return;
    }
    window._gpsWatchId = navigator.geolocation.watchPosition(
        function(pos) {
            const lat = pos.coords.latitude, lng = pos.coords.longitude, acc = Math.round(pos.coords.accuracy);
            latestCoords = { lat: lat, lng: lng };
            updateUserMarker(lat, lng);
            if (latEl) latEl.innerText = lat.toFixed(6);
            if (lngEl) lngEl.innerText = lng.toFixed(6);
            if (accuracyEl) accuracyEl.textContent = '± ' + acc + ' m';
            if (statusEl) {
                if (acc <= 10) { statusEl.textContent = 'Sinyal Kuat'; statusEl.className = 'value status-strong'; }
                else if (acc <= 30) { statusEl.textContent = 'Sinyal Sedang'; statusEl.className = 'value status-medium'; }
                else { statusEl.textContent = 'Sinyal Lemah'; statusEl.className = 'value status-weak'; }
            }
        },
        function(err) {
            if (accuracyEl) accuracyEl.textContent = '-';
            if (statusEl) {
                if (err.code === 1) statusEl.textContent = 'Izin Ditolak';
                else if (err.code === 2) statusEl.textContent = 'GPS Tdk Terdeteksi';
                else statusEl.textContent = 'Mencari Sinyal...';
                statusEl.className = 'value status-no-signal';
            }
            console.warn('GPS Error:', err.message);
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
}
function initGPSWatcher() { if (!window._gpsWatchId) startGPS(); }

// ===== CROSSHAIR =====
function getCrosshairLatLng(){
    try{
        const crosshairEl = document.querySelector('.crosshair');
        const mapContainer = map.getContainer();
        if(!crosshairEl || !mapContainer) return null;
        const chRect = crosshairEl.getBoundingClientRect();
        const mapRect = mapContainer.getBoundingClientRect();
        const chCenterX = chRect.left + chRect.width/2;
        const chCenterY = chRect.top + chRect.height/2;
        return map.containerPointToLatLng([chCenterX - mapRect.left, chCenterY - mapRect.top]);
    }catch(e){ console.warn('getCrosshairLatLng gagal:', e); return null; }
}

// ===== MEASURE =====
function closeWrenchPopup() {
    const popup = document.getElementById('tools-popup');
    if (popup) popup.style.display = 'none';
}
function toggleMeasure() {
    const box = document.getElementById('measure-box');
    measureActive = !measureActive;
    if (measureActive) {
        if (box) box.style.display = 'flex';
        clearMeasure();
        ['measure-dist-row','measure-area-row','measure-undo-btn','measure-clear-btn','measure-finish-btn'].forEach(id=>{
            const el=document.getElementById(id); if(el) el.style.display='none';
        });
        if (!measureOverlay) {
            measureOverlay = L.rectangle([[-90, -180], [90, 180]], { color: 'transparent', fillColor: 'transparent', fillOpacity: 0, weight: 0, interactive: true, pane: 'measurePane' }).addTo(map);
            measureOverlay.on('click', function(e) { if (e.originalEvent) e.originalEvent.stopPropagation(); });
        }
        if (map && map.getContainer) map.getContainer().style.cursor = 'crosshair';
    } else {
        if (box) box.style.display = 'none';
        clearMeasure();
        if (measureOverlay) { map.removeLayer(measureOverlay); measureOverlay = null; }
        if (map && map.getContainer) map.getContainer().style.cursor = '';
    }
}
function undoLastPoint() {
    if (measurePoints.length === 0) return;
    measureClosed = false;
    const lastMarker = measureMarkers.pop();
    if (lastMarker && lastMarker.remove) lastMarker.remove();
    measurePoints.pop();
    redrawMeasureShape();
    updateMeasureDisplay();
}
function clearMeasure() {
    measureMarkers.forEach(m => { if (m && m.remove) m.remove(); });
    measureMarkers = [];
    if (measureSvg) measureSvg.innerHTML = '';
    measurePoints = [];
    measureDist = 0; measureArea = 0; measureClosed = false;
}
function ensureMeasureSvg() {
    if (!map) return null;
    if (measureSvg && measureSvg.parentNode) return measureSvg;
    measureSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    measureSvg.id = 'measure-svg';
    measureSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    map.getContainer().appendChild(measureSvg);
    return measureSvg;
}
function updateMeasureDotPositions() {
    if (!map || !measurePoints.length) return;
    measurePoints.forEach((p, i) => {
        const el = measureMarkers[i];
        if (!el || !el.style) return;
        const pt = map.latLngToContainerPoint([p.lat, p.lng]);
        el.style.left = pt.x + 'px';
        el.style.top = pt.y + 'px';
    });
    redrawMeasureShape();
}
function closeMeasure() {
    if (measureActive) {
        measureActive = false;
        const box = document.getElementById('measure-box');
        if (box) box.style.display = 'none';
        clearMeasure();
        if (measureOverlay) { map.removeLayer(measureOverlay); measureOverlay = null; }
        if (map && map.getContainer) map.getContainer().style.cursor = '';
        ['measure-undo-btn','measure-clear-btn','measure-finish-btn','measure-dist-row','measure-area-row'].forEach(id=>{
            const el=document.getElementById(id); if(el) el.style.display='none';
        });
    }
}
function formatDist(meters) {
    if (meters >= 1000) return (meters / 1000).toFixed(2) + ' km';
    return Math.round(meters) + ' m';
}
function formatArea(m2) {
    if (m2 >= 10000) return (m2 / 10000).toFixed(2) + ' ha';
    return Math.round(m2) + ' m²';
}
function calcArea(points) {
    if (points.length < 3) return 0;
    const R = 6371000, toRad = Math.PI / 180;
    const latCenter = points.reduce((s, p) => s + p.lat, 0) / points.length * toRad;
    const cosLat = Math.cos(latCenter);
    let area = 0;
    for (let i = 0; i < points.length; i++) {
        const a = points[i], b = points[(i + 1) % points.length];
        const x1 = a.lng * cosLat * R * toRad, y1 = a.lat * R * toRad;
        const x2 = b.lng * cosLat * R * toRad, y2 = b.lat * R * toRad;
        area += x1 * y2 - x2 * y1;
    }
    return Math.abs(area / 2);
}
function updateMeasureDisplay() {
    const distRow = document.getElementById('measure-dist-row');
    const areaRow = document.getElementById('measure-area-row');
    const distVal = document.getElementById('measure-dist-val');
    const areaVal = document.getElementById('measure-area-val');
    const undoBtn = document.getElementById('measure-undo-btn');
    const clearBtn = document.getElementById('measure-clear-btn');
    const finishBtn = document.getElementById('measure-finish-btn');
    if (measurePoints.length === 0) {
        [distRow,areaRow,undoBtn,clearBtn,finishBtn].forEach(el=>{ if(el) el.style.display='none'; });
        return;
    }
    if (undoBtn) undoBtn.style.display = 'inline-flex';
    if (clearBtn) clearBtn.style.display = 'inline-flex';
    if (finishBtn) finishBtn.style.display = 'inline-flex';
    let totalDist = 0;
    for (let i = 1; i < measurePoints.length; i++) {
        totalDist += map.distance([measurePoints[i-1].lat, measurePoints[i-1].lng], [measurePoints[i].lat, measurePoints[i].lng]);
    }
    if (measureClosed && measurePoints.length >= 3) {
        const first = measurePoints[0], last = measurePoints[measurePoints.length - 1];
        totalDist += map.distance([last.lat, last.lng], [first.lat, first.lng]);
    }
    measureDist = totalDist;
    if (distVal) distVal.textContent = formatDist(totalDist);
    if (distRow) { distRow.style.display = 'inline-flex'; distRow.style.alignItems = 'center'; distRow.style.gap = '4px'; }
    if (measurePoints.length >= 3) {
        const area = calcArea(measurePoints);
        measureArea = area;
        if (areaVal) areaVal.textContent = formatArea(area);
        if (areaRow) { areaRow.style.display = 'inline-flex'; areaRow.style.alignItems = 'center'; areaRow.style.gap = '4px'; areaRow.style.borderLeft = '1px solid rgba(255,255,255,0.2)'; areaRow.style.paddingLeft = '10px'; }
    } else { if (areaRow) areaRow.style.display = 'none'; }
}
function redrawMeasureShape() {
    const svg = ensureMeasureSvg();
    if (!svg) return;
    svg.innerHTML = '';
    if (!measurePoints.length || !map) return;
    const pts = measurePoints.map(p => map.latLngToContainerPoint([p.lat, p.lng]));
    const linePts = (measureClosed && pts.length >= 2) ? pts.concat([pts[0]]) : pts;
    if (pts.length >= 3) {
        const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        poly.setAttribute('points', pts.map(p => p.x + ',' + p.y).join(' '));
        poly.setAttribute('fill', '#7c3aed');
        poly.setAttribute('fill-opacity', '0.15');
        poly.setAttribute('stroke', 'none');
        svg.appendChild(poly);
    }
    if (linePts.length >= 2) {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        path.setAttribute('points', linePts.map(p => p.x + ',' + p.y).join(' '));
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', '#a78bfa');
        path.setAttribute('stroke-width', '3');
        path.setAttribute('stroke-dasharray', '6 4');
        path.setAttribute('stroke-linejoin', 'round');
        path.setAttribute('stroke-linecap', 'round');
        svg.appendChild(path);
    }
}
function addMeasurePointFromCrosshair() {
    if (!measureActive || !map) return;
    map.stop();
    measureClosed = false;
    const size = map.getSize();
    const px = size.x / 2, py = size.y / 2;
    const center = map.containerPointToLatLng([px, py]);
    measurePoints.push({ lat: center.lat, lng: center.lng });
    const el = document.createElement('div');
    el.className = 'measure-dot';
    el.style.left = px + 'px';
    el.style.top = py + 'px';
    map.getContainer().appendChild(el);
    measureMarkers.push(el);
    redrawMeasureShape();
    updateMeasureDisplay();
}
function closeMeasureShape() {
    if (!measureActive) return;
    if (measurePoints.length < 3) { showNotification('⚠️ Minimal 3 titik untuk menutup garis/poligon'); return; }
    measureClosed = true;
    redrawMeasureShape();
    updateMeasureDisplay();
}

// ===== ICONS =====
const waypointIconWebP = L.divIcon({
    className: 'waypoint-pin-icon',
    html: '<svg viewBox="0 0 24 24" width="32" height="32" style="filter:drop-shadow(0 2px 3px rgba(0,0,0,0.45));"><path d="M12 2C8 2 5 5 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-4-3-7-7-7z" fill="#e53935" stroke="#ffffff" stroke-width="1"/><circle cx="12" cy="9" r="2.3" fill="#ffffff"/></svg>',
    iconSize: [32, 32], iconAnchor: [16, 32], popupAnchor: [0, -30]
});
const waypointIconKMZ = L.divIcon({
    className: 'waypoint-pin-icon',
    html: '<svg viewBox="0 0 24 24" width="32" height="32" style="filter:drop-shadow(0 2px 3px rgba(0,0,0,0.45));"><path d="M12 2C8 2 5 5 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-4-3-7-7-7z" fill="#1565C0" stroke="#ffffff" stroke-width="1"/><circle cx="12" cy="9" r="2.3" fill="#ffffff"/></svg>',
    iconSize: [32, 32], iconAnchor: [16, 32], popupAnchor: [0, -30]
});
const waypointIcon = waypointIconWebP;

// ===== BASEMAP PROVIDERS =====
const BASEMAP_PROVIDERS = {
    'google_sat': { name: 'Google Satellite', url: 'https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', subdomains: ['0','1','2','3'], icon: 'icon-globe', maxNativeZoom: 20 },
    'google_map': { name: 'Google Map', url: 'https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', subdomains: ['0','1','2','3'], icon: 'icon-map', maxNativeZoom: 20 },
    'google_hybrid': { name: 'Google Hybrid', url: 'https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', subdomains: ['0','1','2','3'], icon: 'icon-layers', maxNativeZoom: 20 },
    'google_terrain': { name: 'Google Terrain', url: 'https://mt{s}.google.com/vt/lyrs=p&x={x}&y={y}&z={z}', subdomains: ['0','1','2','3'], icon: 'icon-mountain', maxNativeZoom: 16 },
    'osm': { name: 'OpenStreetMap (OSM)', url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', subdomains: ['a','b','c'], icon: 'icon-globe', maxNativeZoom: 19 }
};
function setBasemap(key) {
    const p = BASEMAP_PROVIDERS[key];
    if (!p) return;
    if (activeLayers['basemap']) map.removeLayer(activeLayers['basemap'].layer);
    const tl = L.tileLayer(p.url, {
        maxZoom: 22, maxNativeZoom: p.maxNativeZoom || 19,
        subdomains: p.subdomains || ['a','b','c'],
        attribution: p.name, updateWhenZooming: false, updateWhenIdle: true,
        keepBuffer: 2, detectRetina: false
    }).addTo(map);
    activeLayers['basemap'] = { name: p.name, layer: tl, type: 'basemap', icon: p.icon };
    saveConfig('basemapKey',key).catch(()=>{});
    updateActiveLayersUI();
}

// ===== GEO PDF CONVERSION =====
function toArrayBuffer(v){if(v instanceof ArrayBuffer)return v;if(v instanceof Uint8Array)return v.buffer.slice(v.byteOffset,v.byteOffset+v.byteLength);return new Uint8Array(v).buffer;}
function canvasToWebP(canvas,q){return new Promise((res,rej)=>{canvas.toBlob(b=>{if(b)res(b);else rej(new Error('Browser tidak mendukung WebP.'));},'image/webp',q);});}
async function cornersToLeafletBounds(corners,projectionWkt){
    if(!Array.isArray(corners)||corners.length<4)return null;
    const xy=corners.map(c=>[Number(c[0]),Number(c[1])]);
    if(xy.some(c=>!Number.isFinite(c[0])||!Number.isFinite(c[1])))return null;
    if(xy.every(c=>Math.abs(c[0])<=180&&Math.abs(c[1])<=90))return[Math.min(...xy.map(c=>c[1])),Math.min(...xy.map(c=>c[0])),Math.max(...xy.map(c=>c[1])),Math.max(...xy.map(c=>c[0]))];
    if(!projectionWkt||typeof proj4!=='function')return null;
    try{const ll=xy.map(c=>proj4(projectionWkt,'EPSG:4326',c));return[Math.min(...ll.map(c=>c[1])),Math.min(...ll.map(c=>c[0])),Math.max(...ll.map(c=>c[1])),Math.max(...ll.map(c=>c[0]))];}catch(e){return null;}
}

// ===== ⚠️ PDF Worker: path sudah diubah ke lokal =====
async function convertGeoPDFToWebP(fileData, filename, onProgress) {
    const updateProgress = typeof onProgress === 'function' ? onProgress : function() {};
    updateProgress(15);
    const src = fileData instanceof Uint8Array ? fileData : new Uint8Array(fileData);
    if (!src.byteLength) throw new Error('Data PDF kosong.');
    const bytesForGeo = src.slice(0), bytesForGdal = src.slice(0), bytesForPdf = src.slice(0);

    if (gdalReady && gdal) {
        try {
            const file = new File([bytesForGdal], filename, { type: 'application/pdf' });
            const opened = await gdal.open(file);
            updateProgress(30);
            if (opened?.datasets?.length) {
                const dataset = opened.datasets[0];
                const info = await gdal.getInfo(dataset);
                if (info?.type === 'raster' && info.corners?.length) {
                    const webpPath = await gdal.gdal_translate(dataset, ['-of', 'WEBP', '-co', 'QUALITY=90'], filename.replace(/\.[^/.]+$/, ''));
                    const webpBytes = await gdal.getFileBytes(webpPath);
                    const bounds = await cornersToLeafletBounds(info.corners, info.projectionWkt);
                    if (!bounds) throw new Error('GDAL: georeferensi tidak valid.');
                    updateProgress(90);
                    try { gdal.close(dataset); } catch (_) {}
                    updateProgress(100);
                    return { webpData: toArrayBuffer(webpBytes), metadata: { name: filename, bounds, width: info.width, height: info.height, projectionWkt: info.projectionWkt || '', source: 'gdal3.js', format: 'webp', scheme: 'image-overlay', jsonVersion: 1 } };
                }
            }
        } catch (err) { console.warn('Jalur GDAL gagal, lanjut PDF.js:', err); }
    }

    const geoCandidates = await extractAllGeoPDFGeoreferences(bytesForGeo);
    updateProgress(30);
    let selectedGeo = null;
    if (geoCandidates && geoCandidates.length > 0) {
        geoCandidates.sort((a, b) => b.score - a.score);
        selectedGeo = geoCandidates[0];
        console.log(`[GeoPDF] ✅ Memilih Peta Utama:`, selectedGeo.bounds);
    } else {
        throw new Error('Tidak ditemukan georeferensi valid di PDF.');
    }

    if (typeof pdfjsLib === 'undefined') throw new Error('PDF.js belum tersedia.');
    // ⚠️ WORKER: sudah diubah dari CDN ke lokal
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'libs/pdfjs/pdf.worker.min.js';

    const loadingTask = pdfjsLib.getDocument({ data: bytesForPdf.slice(0).buffer });
    const pdf = await loadingTask.promise;
    updateProgress(45);
    const page = await pdf.getPage(1);
    const baseViewport = page.getViewport({ scale: 1 });
    const pageWidth = baseViewport.width, pageHeight = baseViewport.height;

    const maxPixels = 18000000;
    let scale = 2.0;
    if ((pageWidth * scale) * (pageHeight * scale) > maxPixels) scale = Math.sqrt(maxPixels / (pageWidth * pageHeight));
    scale = Math.max(0.75, Math.min(scale, 3.0));

    const viewport = page.getViewport({ scale });
    const fullCanvas = document.createElement('canvas');
    fullCanvas.width = Math.ceil(viewport.width);
    fullCanvas.height = Math.ceil(viewport.height);
    const fullCtx = fullCanvas.getContext('2d', { alpha: false });
    await page.render({ canvasContext: fullCtx, viewport }).promise;
    updateProgress(75);

    let outCanvas = fullCanvas;
    let finalBounds = selectedGeo.bounds;
    let mediaBox = selectedGeo.mediaBox;

    if (mediaBox && mediaBox.length >= 4 && selectedGeo.viewportBBox) {
        const bb = selectedGeo.viewportBBox;
        const pdfX0 = Math.min(bb[0], bb[2]), pdfX1 = Math.max(bb[0], bb[2]);
        const pdfY0 = Math.min(bb[1], bb[3]), pdfY1 = Math.max(bb[1], bb[3]);
        const paperX0 = Math.min(mediaBox[0], mediaBox[2]), paperX1 = Math.max(mediaBox[0], mediaBox[2]);
        const paperY0 = Math.min(mediaBox[1], mediaBox[3]), paperY1 = Math.max(mediaBox[1], mediaBox[3]);
        const [minLat, minLon, maxLat, maxLon] = selectedGeo.bounds;
        const latSpan = maxLat - minLat, lonSpan = maxLon - minLon;
        const bboxW = pdfX1 - pdfX0, bboxH = pdfY1 - pdfY0;
        if (bboxW > 0 && bboxH > 0) {
            function getGeoFromPdf(x, y) {
                const relX = (x - pdfX0) / bboxW;
                const relY = (y - pdfY0) / bboxH;
                return [minLat + (relY * latSpan), minLon + (relX * lonSpan)];
            }
            const cBL = getGeoFromPdf(paperX0, paperY0);
            const cBR = getGeoFromPdf(paperX1, paperY0);
            const cTL = getGeoFromPdf(paperX0, paperY1);
            const cTR = getGeoFromPdf(paperX1, paperY1);
            const lats = [cBL[0], cBR[0], cTL[0], cTR[0]];
            const lons = [cBL[1], cBR[1], cTL[1], cTR[1]];
            const newMinLat = Math.min(...lats), newMaxLat = Math.max(...lats);
            const newMinLon = Math.min(...lons), newMaxLon = Math.max(...lons);
            if (newMinLat < newMaxLat && newMinLon < newMaxLon) {
                finalBounds = [newMinLat, newMinLon, newMaxLat, newMaxLon];
                console.log('[GeoPDF] 📏 Bounds Full Page berhasil dihitung ulang.');
            } else {
                console.warn('[GeoPDF] ⚠️ Perhitungan bounds gagal (terbalik), menggunakan bounds asli.');
            }
        }
    }

    const webpBlob = await canvasToWebP(outCanvas, 0.90);
    const webpData = await webpBlob.arrayBuffer();
    updateProgress(95);

    updateProgress(100);
    return {
        webpData,
        metadata: {
            name: filename, bounds: finalBounds, epsg: selectedGeo.epsg || null,
            projectionWkt: selectedGeo.projectionWkt || null,
            source: 'pdf.js + GeoPDF metadata (Full Page Adjusted)',
            format: 'webp', scheme: 'image-overlay',
            width: outCanvas.width, height: outCanvas.height,
            page: 1, pdfPages: pdf.numPages, jsonVersion: 1,
            gpts: selectedGeo.gpts || null, lpts: selectedGeo.lpts || null,
            geoSource: selectedGeo.source || null, viewportBBox: null,
            mediaBox: selectedGeo.mediaBox || null,
            needsVerticalFlip: false, cropped: false,
            role: selectedGeo.role, geoArea: selectedGeo.geoArea
        }
    };
}

// ===== GEO PDF PARSING HELPERS (fungsi-fungsi ini murni logika, tidak ada URL) =====
function bytesToLatin1(bytes){let o='';const ch=0x8000;for(let i=0;i<bytes.length;i+=ch){const e=Math.min(i+ch,bytes.length);let p='';for(let j=i;j<e;j++)p+=String.fromCharCode(bytes[j]);o+=p;}return o;}
function inflatePdfStream(bytes){if(typeof pako==='undefined')return null;try{return new TextDecoder('latin1').decode(pako.inflate(bytes));}catch(_){try{return new TextDecoder('latin1').decode(pako.inflateRaw(bytes));}catch(_){return null;}}}
function collectPdfTextLayers(fileData){
    const bytes=fileData instanceof Uint8Array?fileData:new Uint8Array(fileData);
    if(!bytes.byteLength)return[''];
    const raw=bytesToLatin1(bytes);const texts=[raw];let pos=0,sc=0;
    while(pos<raw.length&&sc<8000){
        const sp=raw.indexOf('stream',pos);if(sp<0)break;
        const b=sp>0?raw.charCodeAt(sp-1):32;const a=raw.charCodeAt(sp+6);
        if((b===47)||(a!==10&&a!==13&&a!==32&&a!==9)){pos=sp+6;continue;}
        const ds=Math.max(0,raw.lastIndexOf('<<',sp));const dict=ds>=0?raw.slice(ds,sp):'';
        const es=raw.indexOf('endstream',sp+6);if(es<0)break;
        let dStart=sp+6;
        if(raw.charCodeAt(dStart)===13&&raw.charCodeAt(dStart+1)===10)dStart+=2;
        else if(raw.charCodeAt(dStart)===10||raw.charCodeAt(dStart)===13)dStart+=1;
        if(es>dStart&&/\/FlateDecode\b/i.test(dict)){const inflated=inflatePdfStream(bytes.slice(dStart,es));if(inflated)texts.push(inflated);}
        sc++;pos=es+9;
    }
    return texts;
}
function parsePdfNumbers(v){return(v.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g)||[]).map(Number).filter(Number.isFinite);}
function resolveIndirectArray(text,objNum){const re=new RegExp('(?:^|[^0-9])'+objNum+'\\s+\\d+\\s+obj\\b','g');let m;while((m=re.exec(text))!==null){const os=m.index+m[0].length;const ep=text.indexOf('endobj',os);const end=ep>0?ep:Math.min(text.length,os+50000);const body=text.slice(os,end);const bs=body.indexOf('[');if(bs>=0){let d=0;for(let i=bs;i<body.length;i++){if(body[i]==='[')d++;else if(body[i]===']'){d--;if(d===0){const n=parsePdfNumbers(body.slice(bs+1,i));if(n.length>=2)return n;break;}}}const si=body.indexOf('stream');if(si>=0){let ds=si+6;if(body.charCodeAt(ds)===13&&body.charCodeAt(ds+1)===10)ds+=2;else if(body.charCodeAt(ds)===10||body.charCodeAt(ds)===13)ds+=1;const se=body.indexOf('endstream',ds);if(se>ds){const n=parsePdfNumbers(body.slice(ds,se));if(n.length>=2)return n;}}}}return null;}
function extractPdfArrayAfterToken(text,token,fi){const tp=text.indexOf(token,fi||0);if(tp<0)return null;const at=text.slice(tp+token.length,tp+token.length+80);const rm=at.match(/^\s*(\d+)\s+\d+\s+R\b/);if(rm){const v=resolveIndirectArray(text,rm[1]);if(v&&v.length>=2)return{values:v,start:tp,end:tp+token.length+rm[0].length};}const sw=text.slice(tp+token.length,tp+token.length+400);const br=sw.search(/\[/);if(br<0)return null;const bs=tp+token.length+br;let d=0;for(let i=bs;i<text.length&&i<bs+20000;i++){if(text[i]==='[')d++;else if(text[i]===']'){d--;if(d===0)return{values:parsePdfNumbers(text.slice(bs+1,i)),start:tp,end:i+1};}}return null;}
function extractGeoPdfCRSNear(text,start,end){const a=text.slice(Math.max(0,start-3000),Math.min(text.length,end+12000));const w=a.match(/\/WKT\s*\(([^)]{10,20000})\)/i);if(w)return{type:'wkt',value:w[1]};const e=a.match(/\/EPSG\s*[:=]?\s*(\d{4,5})\b/i)||a.match(/EPSG[:\s]*(\d{4,5})\b/i)||a.match(/\/EPSGCode\s*(\d{4,5})\b/i);if(e)return{type:'epsg',value:Number(e[1])};const u=a.match(/UTM\s*zone\s*(\d{1,2})\s*([NS])/i);if(u){const z=Number(u[1]),h=u[2].toUpperCase();return{type:'epsg',value:h==='S'?32700+z:32600+z};}const g=a.match(/\/GEOGCS\s*\(([^)]{5,200})\)/i);if(g&&/WGS.?84|ITRF/i.test(g[1]))return{type:'epsg',value:4326};return null;}
function tryReprojectPoints(pairs,crs){
    if(!crs||typeof proj4!=='function')return null;
    try{
        let s;
        if(crs.type==='epsg'){
            s='EPSG:'+crs.value;
            if(crs.value>=32646&&crs.value<=32654){const z=crs.value-32600;try{proj4.defs(s,'+proj=utm +zone='+z+' +datum=WGS84 +units=m +no_defs');}catch(_){}}
            if(crs.value>=32746&&crs.value<=32754){const z=crs.value-32700;try{proj4.defs(s,'+proj=utm +zone='+z+' +south +datum=WGS84 +units=m +no_defs');}catch(_){}}
        } else if(crs.type==='wkt')s=crs.value; else return null;
        const ll=pairs.map(c=>{const o=proj4(s,'EPSG:4326',c);return[o[1],o[0]];});
        if(ll.some(p=>!Number.isFinite(p[0])||!Number.isFinite(p[1])))return null;
        if(ll.some(p=>Math.abs(p[0])>90||Math.abs(p[1])>180))return null;
        return ll;
    }catch(e){return null;}
}
function gptsToLatLonPoints(gpts,text,start,end){
    if(!gpts||gpts.length<4||gpts.length%2!==0)return null;
    const pairs=[];for(let i=0;i<gpts.length;i+=2)pairs.push([Number(gpts[i]),Number(gpts[i+1])]);
    if(pairs.some(p=>!Number.isFinite(p[0])||!Number.isFinite(p[1])))return null;
    if(pairs.every(p=>Math.abs(p[0])<=90&&Math.abs(p[1])<=180))return pairs.map(p=>[p[0],p[1]]);
    if(pairs.every(p=>Math.abs(p[1])<=90&&Math.abs(p[0])<=180))return pairs.map(p=>[p[1],p[0]]);
    const crs=extractGeoPdfCRSNear(text,start,end);
    if(crs){
        const r=tryReprojectPoints(pairs,crs);if(r)return r;
        const sw=pairs.map(p=>[p[1],p[0]]);const r2=tryReprojectPoints(sw,crs);if(r2)return r2;
    }
    const looksUTM=pairs.every(p=>Math.abs(p[0])>180&&Math.abs(p[0])<1000000&&Math.abs(p[1])>180);
    if(looksUTM&&typeof proj4==='function'){
        const mx=pairs.reduce((s,p)=>s+p[0],0)/pairs.length;
        const my=pairs.reduce((s,p)=>s+p[1],0)/pairs.length;
        const isS=my<0||my>5000000;
        for(const z of[47,48,49,50,51,52,46,53,54]){
            const epsg=isS?32700+z:32600+z;
            const rep=tryReprojectPoints(pairs,{type:'epsg',value:epsg});
            if(rep){const ml=rep.reduce((s,p)=>s+p[1],0)/rep.length;const mt=rep.reduce((s,p)=>s+p[0],0)/rep.length;if(ml>=90&&ml<=145&&mt>=-15&&mt<=10)return rep;}
        }
    }
    return null;
}
function scoreLatLonPoints(points, text, start, hasLpts, pageInfo) {
    if (!points || points.length < 2) return { score: -1, role: 'invalid' };
    for (const p of points) {
        if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) return { score: -1, role: 'invalid' };
        if (Math.abs(p[0]) > 90 || Math.abs(p[1]) > 180) return { score: -1, role: 'invalid' };
    }
    const latSpan = Math.max(...points.map(p => p[0])) - Math.min(...points.map(p => p[0]));
    const lonSpan = Math.max(...points.map(p => p[1])) - Math.min(...points.map(p => p[1]));
    if (latSpan <= 0 || lonSpan <= 0) return { score: -1, role: 'invalid' };
    if (latSpan > 25 || lonSpan > 25) return { score: -1, role: 'invalid' };
    const geoArea = latSpan * lonSpan;
    let pageFrac = 0, bbox = null;
    if (pageInfo && pageInfo.nearbyBBox && pageInfo.mediaBox) {
        bbox = pageInfo.nearbyBBox;
        if (!isFullPageBBox(bbox, pageInfo.mediaBox)) {
            const mw = Math.abs(pageInfo.mediaBox[2] - pageInfo.mediaBox[0]) || 1;
            const mh = Math.abs(pageInfo.mediaBox[3] - pageInfo.mediaBox[1]) || 1;
            pageFrac = (Math.abs(bbox[2] - bbox[0]) * Math.abs(bbox[3] - bbox[1])) / (mw * mh);
        } else bbox = null;
    }
    let role = 'main';
    if (pageFrac >= 0.20) role = 'main';
    else if (pageFrac < 0.10 || geoArea > 5.0) role = 'inset';
    else role = 'index';
    let score = 0;
    if (/\/Subtype\s*\/GEO\b/i.test(text.slice(Math.max(0, start - 2000), Math.min(text.length, start + 3000)))) score += 1000000;
    if (/\/Measure\b/i.test(text.slice(Math.max(0, start - 2000), Math.min(text.length, start + 3000)))) score += 500000;
    score += Math.min(pageFrac * 6000000, 6000000);
    if (geoArea > 0.5) score -= 5000000;
    else if (geoArea > 0.1) score -= 1000000;
    else if (geoArea < 0.000044) score -= 3000000;
    if (points.length < 4) score -= 3000000;
    score += Math.min(points.length * 10, 200);
    const ml = points.reduce((s, p) => s + p[0], 0) / points.length;
    const mn = points.reduce((s, p) => s + p[1], 0) / points.length;
    if (ml >= -15 && ml <= 10 && mn >= 90 && mn <= 145) score += 50000;
    if (role === 'main') score += 4000000;
    if (role === 'inset') score -= 4000000;
    if (role === 'index') score -= 2000000;
    return { score, role, geoArea, pageFrac, bbox, latSpan, lonSpan };
}
function isFullPageBBox(bbox,mediaBox){if(!bbox||!mediaBox||mediaBox.length<4)return false;const mw=Math.abs(mediaBox[2]-mediaBox[0]);const mh=Math.abs(mediaBox[3]-mediaBox[1]);if(mw<1||mh<1)return false;return(Math.abs(bbox[2]-bbox[0])/mw)>0.97&&(Math.abs(bbox[3]-bbox[1])/mh)>0.97;}
function findMeasureObjectNumForGpts(text,gptsStart){const before=text.slice(Math.max(0,gptsStart-8000),gptsStart);const m=[...before.matchAll(/(?:^|[^0-9])(\d+)\s+\d+\s+obj\b/g)];if(!m.length)return null;const last=m[m.length-1];if(/endobj/i.test(before.slice(last.index)))return null;return last[1];}
function findViewportBBoxForMeasure(text,measureObjNum,mediaBox){if(!measureObjNum)return null;const re=new RegExp('/Measure\\s+'+measureObjNum+'\\s+\\d+\\s+R','g');let m;while((m=re.exec(text))!==null){const ws=Math.max(0,m.index-800);const we=Math.min(text.length,m.index+400);const win=text.slice(ws,we);const bm=win.match(/\/BBox\s*\[\s*([^\]]+)\s*\]/i);if(bm){const n=parsePdfNumbers(bm[1]);if(n.length>=4&&!isFullPageBBox(n,mediaBox))return n.slice(0,4);}}return null;}
function findNearbyViewportBBox(text, start, mediaBox) {
    const mn = findMeasureObjectNumForGpts(text, start);
    if (mn) {
        const l = findViewportBBoxForMeasure(text, mn, mediaBox);
        if (l && !isFullPageBBox(l, mediaBox)) {
            const lw = Math.abs(l[2] - l[0]), lh = Math.abs(l[3] - l[1]);
            const mw = Math.abs(mediaBox[2] - mediaBox[0]), mh = Math.abs(mediaBox[3] - mediaBox[1]);
            const frac = (lw * lh) / (mw * mh);
            if (frac >= 0.10 && frac <= 0.90) {
                console.log('[GeoPDF] ✅ BBox via Measure DITERIMA (Frac:', frac.toFixed(2), ')');
                return l;
            }
        }
    }
    const region = text.slice(Math.max(0, start - 4000), Math.min(text.length, start + 6000));
    const found = [];
    const allRe = /\/BBox\s*\[\s*([^\]]+)\s*\]/gi;
    let m;
    while ((m = allRe.exec(region)) !== null) {
        const n = parsePdfNumbers(m[1]);
        if (n.length >= 4) {
            const w = Math.abs(n[2] - n[0]), h = Math.abs(n[3] - n[1]);
            const area = w * h;
            const frac = area / (Math.abs(mediaBox[2]-mediaBox[0]) * Math.abs(mediaBox[3]-mediaBox[1]));
            if (w > 30 && h > 30 && !isFullPageBBox(n, mediaBox) && frac >= 0.10 && frac <= 0.90) found.push({ bbox: n.slice(0, 4), area: area, frac: frac });
        }
    }
    if (!found.length) return null;
    found.sort((a, b) => b.area - a.area);
    return found[0].bbox;
}
function pickBestMapFrameBBox(text, mediaBox, preferredBBox) {
    if (!mediaBox || mediaBox.length < 4) return preferredBBox || null;
    const mw = Math.abs(mediaBox[2] - mediaBox[0]), mh = Math.abs(mediaBox[3] - mediaBox[1]);
    const pageArea = mw * mh;
    if (pageArea < 1) return preferredBBox || null;
    if (preferredBBox && !isFullPageBBox(preferredBBox, mediaBox)) {
        const pw = Math.abs(preferredBBox[2] - preferredBBox[0]), ph = Math.abs(preferredBBox[3] - preferredBBox[1]);
        const pFrac = (pw * ph) / pageArea;
        if (pFrac >= 0.20 && pFrac <= 0.90) return preferredBBox;
    }
    const all = [];
    const re = /\/BBox\s*\[\s*([^\]]+)\s*\]/gi;
    let m;
    while ((m = re.exec(text)) !== null) {
        const n = parsePdfNumbers(m[1]);
        if (n.length < 4) continue;
        const w = Math.abs(n[2] - n[0]), h = Math.abs(n[3] - n[1]);
        const area = w * h;
        const frac = area / pageArea;
        if (frac < 0.15 || frac > 0.95) continue;
        if (w/h > 4 || h/w > 4) continue;
        all.push({ bbox: n.slice(0, 4), area: area, frac: frac });
    }
    if (!all.length) return (preferredBBox && !isFullPageBBox(preferredBBox, mediaBox)) ? preferredBBox : null;
    const idealCandidates = all.filter(x => x.frac >= 0.40 && x.frac <= 0.80);
    if (idealCandidates.length > 0) { idealCandidates.sort((a, b) => b.area - a.area); return idealCandidates[0].bbox; }
    all.sort((a, b) => b.area - a.area);
    return all[0].bbox;
}
function boundsFromPoints(points){const lats=points.map(p=>p[0]),lons=points.map(p=>p[1]);return[Math.min(...lats),Math.min(...lons),Math.max(...lats),Math.max(...lons)];}

async function extractAllGeoPDFGeoreferences(fileData){
    const texts=collectPdfTextLayers(fileData);
    const combinedText=texts.join('\n');
    const candidates=[];
    try{
        const gptsRegex=/\/GPTS\s*\[\s*([^\]]{8,2000})\s*\]/gi;let m;
        while((m=gptsRegex.exec(combinedText))!==null){
            const nums=parsePdfNumbers(m[1]);if(nums.length<4||nums.length%2!==0)continue;
            const start=m.index,end=m.index+m[0].length;
            const region=combinedText.slice(Math.max(0,start-600),Math.min(combinedText.length,end+600));
            let lpts=null;const lm=region.match(/\/LPTS\s*\[\s*([^\]]{4,500})\s*\]/i);if(lm)lpts=parsePdfNumbers(lm[1]);
            const points=gptsToLatLonPoints(nums,combinedText,start,end);if(!points)continue;
            let mediaBox=null;const mb=combinedText.match(/\/MediaBox\s*\[\s*([^\]]+)\s*\]/i);if(mb){const mn=parsePdfNumbers(mb[1]);if(mn.length>=4)mediaBox=mn.slice(0,4);}
            const nearbyBBox=findNearbyViewportBBox(combinedText,start,mediaBox);
            const scored=scoreLatLonPoints(points,combinedText,start,!!lpts,{mediaBox,nearbyBBox});
            if(scored.score<0)continue;
            const bounds=boundsFromPoints(points);
            if(!bounds.every(Number.isFinite)||bounds[0]<-90||bounds[2]>90||bounds[1]<-180||bounds[3]>180||bounds[0]>=bounds[2]||bounds[1]>=bounds[3])continue;
            candidates.push({score:scored.score+500000,bounds,gpts:nums,lpts,points,crs:extractGeoPdfCRSNear(combinedText,start,end),source:'GPTS-regex',role:scored.role,pageFrac:scored.pageFrac,geoArea:scored.geoArea,viewportBBox:nearbyBBox,mediaBox});
        }
    }catch(err){console.warn('[GeoPDF] PATH1 gagal:',err);}

    if(!candidates.length){
        let cursor=0,guard=0;
        while(cursor<combinedText.length&&guard<2000){
            const g=extractPdfArrayAfterToken(combinedText,'/GPTS',cursor);if(!g)break;
            const points=gptsToLatLonPoints(g.values,combinedText,g.start,g.end);
            if(points){
                let mediaBox=null;const mb=combinedText.match(/\/MediaBox\s*\[\s*([^\]]+)\s*\]/i);if(mb){const mn=parsePdfNumbers(mb[1]);if(mn.length>=4)mediaBox=mn.slice(0,4);}
                const nearbyBBox=findNearbyViewportBBox(combinedText,g.start,mediaBox);
                const scored=scoreLatLonPoints(points,combinedText,g.start,false,{mediaBox,nearbyBBox});
                if(scored.score>=0){
                    const bounds=boundsFromPoints(points);
                    if(bounds.every(Number.isFinite)&&bounds[0]>=-90&&bounds[2]<=90&&bounds[1]>=-180&&bounds[3]<=180&&bounds[0]<bounds[2]&&bounds[1]<bounds[3])
                        candidates.push({score:scored.score,bounds,gpts:g.values,lpts:null,points,crs:extractGeoPdfCRSNear(combinedText,g.start,g.end),source:'GPTS-token',role:scored.role,pageFrac:scored.pageFrac,geoArea:scored.geoArea,viewportBBox:nearbyBBox,mediaBox});
                }
            }
            cursor=g.end;guard++;
        }
    }
    if(!candidates.length)return[];
    candidates.sort((a,b)=>{const rr=r=>(r==='main'?2:r==='index'?1:0);const dr=rr(b.role)-rr(a.role);if(dr!==0)return dr;return b.score-a.score;});
    let globalMediaBox=null;const mbm=combinedText.match(/\/MediaBox\s*\[\s*([^\]]+)\s*\]/i);if(mbm){const mn=parsePdfNumbers(mbm[1]);if(mn.length>=4)globalMediaBox=mn.slice(0,4);}
    return candidates.map(c=>{
        let vp=c.viewportBBox;
        const mBox=c.mediaBox||globalMediaBox;
        if(mBox){
            vp=pickBestMapFrameBBox(combinedText,mBox,vp);
            if(vp && isFullPageBBox(vp,mBox)) vp=null;
        }
        return{
            bounds:c.bounds,gpts:c.gpts,lpts:c.lpts,points:c.points,
            projectionWkt:c.crs&&c.crs.type==='wkt'?c.crs.value:null,
            epsg:c.crs&&c.crs.type==='epsg'?c.crs.value:null,
            source:c.source,role:c.role,geoArea:c.geoArea,pageFrac:c.pageFrac,
            viewportBBox:vp,mediaBox:mBox,score:c.score
        };
    });
}

function promptUserForGeoreference(filename, candidates) {
    return new Promise((resolve, reject) => {
        window._geoSelectionResolve = resolve;
        window._geoSelectionReject = reject;
        const sorted = [...candidates].sort((a, b) => (a.geoArea || 0) - (b.geoArea || 0));
        window._geoCandidates = sorted;
        const listEl = document.getElementById('geo-select-list');
        let html = '<p style="font-size:13px;color:#555;margin-bottom:12px;"><b>' + filename + '</b><br>Pilih georeferensi yang akan digunakan:</p>';
        sorted.forEach((c, i) => {
            const isMain = (i === 0);
            const label = isMain ? '🗺️ Peta Utama' : '🔍 Insert';
            const bgColor = isMain ? '#e8f5e9' : '#fff3e0';
            const accentColor = isMain ? '#4CAF50' : '#ff9800';
            const areaStr = c.geoArea ? c.geoArea.toFixed(4) + ' deg²' : '?';
            const boundsStr = c.bounds ? c.bounds.map(b => b.toFixed(4)).join(', ') : '?';
            html += '<div class="geo-select-item" style="background:' + bgColor + ';border-left:4px solid ' + accentColor + ';" onclick="selectGeoCandidate(' + i + ')">'
                + '<div class="geo-info"><span class="geo-label" style="color:' + accentColor + ';">' + label + '</span>'
                + '<span class="geo-detail">Luas area: ' + areaStr + '</span>'
                + '<span class="geo-bounds">[' + boundsStr + ']</span></div>'
                + '<button class="add-btn" style="background:' + accentColor + ';padding:8px 14px;font-size:13px;">Pilih</button></div>';
        });
        listEl.innerHTML = html;
        document.getElementById('geopdf-select-modal').classList.add('active');
    });
}
function selectGeoCandidate(index) {
    if (window._geoSelectionResolve) {
        window._geoSelectionResolve(window._geoCandidates[index]);
        document.getElementById('geopdf-select-modal').classList.remove('active');
    }
}
function cancelGeoSelection() {
    if (window._geoSelectionReject) {
        window._geoSelectionReject(new Error('Pemilihan georeferensi dibatalkan.'));
        document.getElementById('geopdf-select-modal').classList.remove('active');
    }
}

// ===== UPLOAD =====
function uploadKMZFile(){
    const input=document.createElement('input');input.type='file';input.accept='.kmz,.kml';input.multiple=true;
    input.onchange=async(e)=>{const files=Array.from(e.target.files);for(const file of files){try{showConversionProgress(file.name,5);const data=await file.arrayBuffer();showConversionProgress(file.name,70);const m={id:'map_'+Date.now()+'_'+Math.random().toString(36).substr(2,4),name:file.name,type:file.name.endsWith('.kmz')?'kmz':'kml',fileData:data,geojson:{type:'FeatureCollection',features:[]},created:new Date().toISOString(),isActive:false,source:'upload'};await saveMapToDB(m);mapCollection.push(m);showConversionProgress(file.name,100);}catch(err){alert('Gagal upload: '+err.message);}}renderLibraryContent();renderPointsView();alert('✅ '+files.length+' file diupload!');};
    input.click();
}
function uploadGeoPDF(){
    const input=document.createElement('input');input.type='file';input.accept='.pdf,.geopdf';input.multiple=true;
    input.onchange=async(e)=>{const files=Array.from(e.target.files);for(const file of files){try{showConversionProgress(file.name,5);const data=await file.arrayBuffer();showConversionProgress(file.name,10);const result=await convertGeoPDFToWebP(data,file.name,pct=>showConversionProgress(file.name,pct));const m={id:'map_'+Date.now()+'_'+Math.random().toString(36).substr(2,4),name:file.name.replace(/\.[^/.]+$/,'')+'.webp',type:'webp_json',fileData:data,webpData:result.webpData,metadata:result.metadata,geojson:{type:'FeatureCollection',features:[]},created:new Date().toISOString(),isActive:false,source:'geopdf',isGeoPDF:true,converted:true,bounds:result.metadata.bounds,minZoom:1,maxZoom:22,jsonData:JSON.stringify(result.metadata)};await saveMapToDB(m);mapCollection.push(m);showConversionProgress(file.name,100);}catch(err){console.error('Gagal konversi GeoPDF:',err);if(err.message!=='Pemilihan georeferensi dibatalkan.')alert('Gagal konversi '+file.name+': '+err.message);}}renderLibraryContent();renderPointsView();};
    input.click();
}
function uploadWebPJSON(){
    const input=document.createElement('input');input.type='file';input.accept='.webp,.json';input.multiple=true;
    input.onchange=async(e)=>{const files=Array.from(e.target.files||[]);const wf=files.find(f=>f.name.toLowerCase().endsWith('.webp'));const jf=files.find(f=>f.name.toLowerCase().endsWith('.json'));if(!wf||!jf){alert('Pilih 2 file: .webp dan .json');return;}
    try{const wd=await wf.arrayBuffer();const meta=JSON.parse(await jf.text());const bounds=normalizeMapBounds(meta.bounds||meta.bbox||meta.extent||meta.boundingBox);if(!bounds)throw new Error('JSON tidak memiliki bounds valid.');const m={id:'map_'+Date.now()+'_'+Math.random().toString(36).substr(2,4),name:wf.name.replace(/\.[^/.]+$/,'')+'.webp',type:'webp_json',webpData:wd,tilesData:wd,metadata:{...meta,bounds,format:'webp',sourceJson:jf.name},bounds,minZoom:Number(meta.minZoom||meta.minzoom||1),maxZoom:Number(meta.maxZoom||meta.maxzoom||22),geojson:{type:'FeatureCollection',features:[]},created:new Date().toISOString(),isActive:false,source:'webp_json_upload',isGeoPDF:false,converted:true};await saveMapToDB(m);mapCollection.push(m);renderLibraryContent();renderPointsView();showNotification('✅ '+wf.name+' ditambahkan.',3500);}catch(err){alert('Gagal: '+err.message);}};
    input.click();
}
function normalizeMapBounds(v){if(!Array.isArray(v)||v.length<4)return null;const a=Number(v[0]),b=Number(v[1]),c=Number(v[2]),d=Number(v[3]);if(![a,b,c,d].every(Number.isFinite))return null;if(a>=-90&&a<=90&&c>=-90&&c<=90&&b>=-180&&b<=180&&d>=-180&&d<=180&&a<=c)return[a,b,c,d];if(a>=-180&&a<=180&&c>=-180&&c<=180&&b>=-90&&b<=90&&d>=-90&&d<=90&&b<=d)return[b,a,d,c];return null;}
function getWebPArrayBuffer(md){for(const v of[md.webpData,md.imageData,md.webPData,md.tilesData]){if(v instanceof ArrayBuffer&&v.byteLength>0)return v;if(v instanceof Uint8Array&&v.byteLength>0)return v.buffer.slice(v.byteOffset,v.byteOffset+v.byteLength);if(v&&v.buffer instanceof ArrayBuffer&&v.byteLength>0)return v.buffer.slice(v.byteOffset||0,(v.byteOffset||0)+v.byteLength);}return null;}
const GEOPDF_BOUNDS_OFFSET={dLat:0,dLon:0};
function createWebPImageLayer(mapData){
    const bytes=getWebPArrayBuffer(mapData);if(!bytes)throw new Error('Data WebP tidak ditemukan.');
    const raw=mapData.bounds||mapData.metadata?.bounds||mapData.metadata?.bbox||mapData.metadata?.extent;
    let bounds=normalizeMapBounds(raw);if(!bounds)throw new Error('Bounds WebP tidak valid.');
    const oLat=Number(mapData.metadata?.offsetLat??GEOPDF_BOUNDS_OFFSET.dLat)||0;
    const oLon=Number(mapData.metadata?.offsetLon??GEOPDF_BOUNDS_OFFSET.dLon)||0;
    if(oLat||oLon)bounds=[bounds[0]+oLat,bounds[1]+oLon,bounds[2]+oLat,bounds[3]+oLon];
    const blob=new Blob([bytes],{type:'image/webp'});const url=URL.createObjectURL(blob);
    const ib=L.latLngBounds([bounds[0],bounds[1]],[bounds[2],bounds[3]]);
    const layer=L.imageOverlay(url,ib,{opacity:1,interactive:false,crossOrigin:false,zIndex:300});
    layer._webpObjectUrl=url;
    layer.on('load',()=>console.log('✅ WebP dirender:',mapData.name));
    layer.on('error',()=>{console.error('❌ WebP gagal:',mapData.name);showNotification('❌ WebP gagal dirender.',4000);});
    return{layer,bounds:ib};
}

// ===== POINTS LAYER =====
function createPointsLayer(md) {
    const pointsLayer = L.layerGroup();
    const features = md.geojson?.features || [];
    const isKmzOrKml = md.type === 'kmz' || md.type === 'kml';
    const iconToUse = isKmzOrKml ? waypointIconKMZ : waypointIconWebP;
    features.forEach((ft, index) => {
        if (!ft.geometry || ft.geometry.type !== 'Point') return;
        const [lng, lat] = ft.geometry.coordinates;
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
        const name = ft.properties?.name || 'Titik ' + (index + 1);
        const marker = L.marker([lat, lng], { icon: iconToUse })
            .bindPopup('<div style="cursor:pointer;text-align:center;padding:4px 10px;" onclick="selectedNotebookId=\'' + md.id + '\';openPointEdit(' + index + ')"><b>' + name + '</b></div>', { closeButton: true });
        pointsLayer.addLayer(marker);
    });
    return pointsLayer;
}

function refreshActivePointsLayer(){
    const actives = mapCollection.filter(m => m.isActive);
    actives.forEach(md => {
        const entry = activeLayers[md.id];
        if (!entry) return;
        if (entry.pointsLayer) {
            map.removeLayer(entry.pointsLayer);
            entry.pointsLayer = null;
        }
        entry.pointsLayer = createPointsLayer(md);
        entry.pointsLayer.addTo(map);
    });
}

function getActiveMap(){
    if(selectedNotebookId){
        const m=mapCollection.find(x=>x.id===selectedNotebookId);
        if(m&&m.isActive)return m;
    }
    const actives=mapCollection.filter(x=>x.isActive);
    if(!actives.length)return null;
    return actives.find(x=>x.type==='webp_json')||actives.find(x=>x.type==='kmz'||x.type==='kml')||actives[0];
}

function switchNotebook(mapId){
    selectedNotebookId=mapId||null;
    renderPointsView();
    refreshActivePointsLayer();
}

// ===== POINT MANAGEMENT =====
async function movePoint(i){
    const am=getActiveMap();if(!am)return;
    const f=am.geojson?.features[i];if(!f)return;
    const others=mapCollection.filter(m=>m.isActive&&m.id!==am.id);
    if(!others.length){alert('Tidak ada peta lain yang terbuka. ON-kan dulu peta tujuannya.');return;}
    const namaTitik=f.properties?.name||('Titik '+(i+1));
    const menu=others.map((m,j)=>(j+1)+'. '+m.name.replace(/\.[^/.]+$/,'')).join('\n');
    const p=prompt('Pindahkan "'+namaTitik+'" ke peta:\n\n'+menu+'\n\nKetik nomornya:','1');
    if(p===null)return;
    const idx=parseInt(p)-1;
    if(isNaN(idx)||idx<0||idx>=others.length){alert('Nomor tidak valid.');return;}
    const target=others[idx];
    if(!target.geojson)target.geojson={type:'FeatureCollection',features:[]};
    target.geojson.features.push(f);
    am.geojson.features.splice(i,1);
    await saveMapToDB(am);
    await saveMapToDB(target);
    renderPointsView();renderLibraryContent();refreshActivePointsLayer();
    showNotification('📤 "'+namaTitik+'" dipindah ke '+target.name.replace(/\.[^/.]+$/,''));
}

async function movePointFromEditModal(){
    if(editingPointIndex===null)return;
    const idx=editingPointIndex;
    await movePoint(idx);
    closePointEdit();
}

function formatTanggal(d){
    const p=n=>String(n).padStart(2,'0');
    return p(d.getDate())+'-'+p(d.getMonth()+1)+'-'+d.getFullYear()+' '+p(d.getHours())+':'+p(d.getMinutes());
}

function openPointEdit(i){
    const am=getActiveMap();if(!am)return;
    const f=am.geojson?.features[i];if(!f)return;
    editingPointIndex=i;
    document.getElementById('pe-name').value=f.properties?.name||'';
    document.getElementById('pe-note').value=f.properties?.note||'';
    const ts=f.properties?.timestamp?new Date(f.properties.timestamp):null;
    document.getElementById('pe-time').textContent=ts?formatTanggal(ts):'-';
    const co=f.geometry.coordinates;
    document.getElementById('pe-coord').textContent=co[1].toFixed(5)+', '+co[0].toFixed(5);
    document.getElementById('point-edit-modal').classList.add('active');
    if(!modalBackStatePushed){history.pushState({modal:'point-edit'},'');modalBackStatePushed=true;}
    map.closePopup();
    refreshPhotoPreview();
}

function closePointEdit(fromBackButton){
    document.getElementById('point-edit-modal').classList.remove('active');
    editingPointIndex=null;
    if(pePhotoObjectUrl){URL.revokeObjectURL(pePhotoObjectUrl);pePhotoObjectUrl=null;}
    if(!fromBackButton&&modalBackStatePushed){modalBackStatePushed=false;history.back();}
}

async function deletePointFromEditModal(){
    if(editingPointIndex===null)return;
    const ok=await deletePoint(editingPointIndex);
    if(ok)closePointEdit();
}

function openCoordEditPopup(){
    const am=getActiveMap();
    const f=(am&&editingPointIndex!==null)?am.geojson?.features[editingPointIndex]:null;
    if(!f)return;
    const co=f.geometry.coordinates;
    document.getElementById('coord-edit-lat').value=co[1];
    document.getElementById('coord-edit-lng').value=co[0];
    document.getElementById('coord-edit-modal').classList.add('active');
}
function closeCoordEditPopup(){
    document.getElementById('coord-edit-modal').classList.remove('active');
}
async function saveCoordEdit(){
    const am=getActiveMap();if(!am||editingPointIndex===null)return;
    const f=am.geojson?.features[editingPointIndex];if(!f)return;
    const lat=parseFloat(document.getElementById('coord-edit-lat').value);
    const lng=parseFloat(document.getElementById('coord-edit-lng').value);
    if(isNaN(lat)||isNaN(lng)||lat<-90||lat>90||lng<-180||lng>180){
        alert('Koordinat tidak valid. Latitude harus -90 s/d 90, Longitude -180 s/d 180.');return;
    }
    f.geometry.coordinates=[lng,lat];
    await saveMapToDB(am);
    document.getElementById('pe-coord').textContent=lat.toFixed(5)+', '+lng.toFixed(5);
    closeCoordEditPopup();
    renderPointsView();renderLibraryContent();refreshActivePointsLayer();
    map.flyTo([lat,lng],map.getZoom());
    showNotification('✅ Koordinat diperbarui');
}

async function savePointEdit(){
    const am=getActiveMap();if(!am||editingPointIndex===null)return;
    const f=am.geojson?.features[editingPointIndex];if(!f)return;
    f.properties=f.properties||{};
    f.properties.name=document.getElementById('pe-name').value.trim()||f.properties.name||('Titik '+(editingPointIndex+1));
    f.properties.note=document.getElementById('pe-note').value;
    await saveMapToDB(am);
    closePointEdit();
    renderPointsView();renderLibraryContent();refreshActivePointsLayer();
    showNotification('✅ Perubahan disimpan');
}

// ===== PHOTO MANAGEMENT =====
async function ensureFolderPermissionOnTap(){
    const mode=await getPhotoStorageMode();
    if(mode!=='folder')return;
    const folderHandle=await getPhotoFolderHandle();
    if(!folderHandle)return;
    await verifyFolderPermission(folderHandle);
}
async function triggerPhotoCapture(){
    await ensureFolderPermissionOnTap();
    document.getElementById('photo-camera-input').click();
}
async function triggerPhotoGallery(){
    await ensureFolderPermissionOnTap();
    document.getElementById('photo-gallery-input').click();
}
async function refreshPhotoPreview(){
    const img=document.getElementById('pe-photo-preview');
    const delBtn=document.getElementById('pe-photo-delete-btn');
    if(pePhotoObjectUrl){URL.revokeObjectURL(pePhotoObjectUrl);pePhotoObjectUrl=null;}
    const am=getActiveMap();
    const f=(am&&editingPointIndex!==null)?am.geojson?.features[editingPointIndex]:null;
    const photoId=f?.properties?.photoId;
    if(photoId){
        const result=await getPhotoBlobUrl(photoId);
        if(result==='NEED_PERMISSION'){
            img.style.display='none';
            delBtn.style.display='block';
            showNotification('🔒 Tap tombol Kamera/Galeri sekali untuk izinkan akses folder lagi',4000);
            return;
        }
        if(result){
            pePhotoObjectUrl=result;
            img.src=result;
            img.style.display='block';
            delBtn.style.display='block';
            return;
        }
    }
    img.style.display='none';
    img.removeAttribute('src');
    delBtn.style.display='none';
}

function compressImage(file, maxSize = 1280, quality = 0.75) {
    return new Promise((resolve, reject) => {
        if (!file || !file.type.startsWith('image/')) { reject(new Error('File bukan gambar')); return; }
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(url);
            let width = img.naturalWidth || img.width;
            let height = img.naturalHeight || img.height;
            if (width > maxSize || height > maxSize) {
                if (width > height) { height = Math.round((height * maxSize) / width); width = maxSize; }
                else { width = Math.round((width * maxSize) / height); height = maxSize; }
            }
            const canvas = document.createElement('canvas');
            canvas.width = width; canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, width, height);
            ctx.drawImage(img, 0, 0, width, height);
            canvas.toBlob((blob) => { if (blob) resolve(blob); else reject(new Error('Gagal mengompres gambar')); }, 'image/jpeg', quality);
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Gagal memuat gambar untuk kompresi')); };
        img.src = url;
    });
}

async function handlePhotoSelected(event){
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    if (editingPointIndex === null) return;
    const am = getActiveMap();
    if (!am) return;
    const f = am.geojson?.features[editingPointIndex];
    if (!f) return;
    try {
        showNotification('⏳ Mengompres & menyimpan foto...', 2500);
        const compressedBlob = await compressImage(file, 1280, 0.75);
        const oldId = f.properties?.photoId;
        const newId = 'photo_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
        const mode = await getPhotoStorageMode();
        const folderHandle = (mode === 'folder') ? await getPhotoFolderHandle() : null;
        const canUseFolder = folderHandle && await hasFolderPermission(folderHandle);
        if (canUseFolder) {
            const filename = newId + '.jpg';
            await savePhotoToFolder(folderHandle, compressedBlob, filename);
            f.properties = f.properties || {};
            f.properties.photoId = 'folder:' + filename;
        } else {
            await savePhotoToDB({ id: newId, blob: compressedBlob, created: new Date().toISOString(), originalName: file.name || '', size: compressedBlob.size });
            f.properties = f.properties || {};
            f.properties.photoId = newId;
        }
        await saveMapToDB(am);
        if (oldId && !oldId.startsWith('folder:')) { await deletePhotoFromDB(oldId).catch(() => {}); }
        await refreshPhotoPreview();
        renderPointsView();
        const sizeKB = Math.round(compressedBlob.size / 1024);
        showNotification('✅ Foto tersimpan (' + sizeKB + ' KB)');
    } catch (err) {
        console.error(err);
        alert('Gagal menyimpan foto: ' + err.message);
    }
}

async function removePointPhoto(){
    if(editingPointIndex===null)return;
    if(!confirm('Hapus foto ini?'))return;
    const am=getActiveMap();if(!am)return;
    const f=am.geojson?.features[editingPointIndex];if(!f)return;
    const oldId=f.properties?.photoId;
    try{
        if(oldId&&oldId.startsWith('folder:')){
            const filename=oldId.substring(7);
            const folderHandle=await getPhotoFolderHandle();
            if(folderHandle&&await hasFolderPermission(folderHandle)){
                await folderHandle.removeEntry(filename).catch(()=>{});
            }
        }else if(oldId){ await deletePhotoFromDB(oldId).catch(()=>{}); }
        delete f.properties.photoId;
        await saveMapToDB(am);
        await refreshPhotoPreview();
        renderPointsView();
        showNotification('🗑️ Foto dihapus');
    }catch(err){ alert('Gagal menghapus foto: '+err.message); }
}

// ===== LIBRARY =====
function renderLibraryContent(){
    const c=document.getElementById('library-content');
    c.innerHTML='<div class="upload-btn-wrapper">'
        +'<button class="add-btn" onclick="uploadMaps()"><svg class="icon" style="width:14px;height:14px;display:inline;vertical-align:middle;"><use href="#icon-upload"></use></svg> Upload Maps</button>'
        +'</div>'
        +'<div style="font-size:12px;color:#555;margin-bottom:8px;">Total: <b>'+mapCollection.length+'</b> peta tersimpan '
        +(gdalReady?'<span style="color:#4CAF50;margin-left:8px;">✅ gdal3.js siap</span>':'<span style="color:#ff9800;margin-left:8px;">⚠️ gdal3.js tidak tersedia</span>')
        +'</div>'
        +'<div id="library-file-list"></div>';
    renderLibraryFileList();
}

function uploadMaps(){
    const input=document.createElement('input');
    input.type='file';
    input.accept='.kmz,.kml,.pdf,.geopdf,application/pdf,application/vnd.google-earth.kmz,application/vnd.google-earth.kml+xml';
    input.multiple=true;
    input.onchange=async(e)=>{
        const files=Array.from(e.target.files||[]);
        if(!files.length)return;
        let ok=0, fail=0;
        for(const file of files){
            const lower=(file.name||'').toLowerCase();
            try{
                if(lower.endsWith('.kmz')||lower.endsWith('.kml')){
                    showConversionProgress(file.name,5);
                    const data=await file.arrayBuffer();
                    showConversionProgress(file.name,70);
                    const m={id:'map_'+Date.now()+'_'+Math.random().toString(36).substr(2,4),name:file.name,type:lower.endsWith('.kmz')?'kmz':'kml',fileData:data,geojson:{type:'FeatureCollection',features:[]},created:new Date().toISOString(),isActive:false,source:'upload'};
                    await saveMapToDB(m);mapCollection.push(m);showConversionProgress(file.name,100);ok++;
                }else if(lower.endsWith('.pdf')||lower.endsWith('.geopdf')){
                    showConversionProgress(file.name,5);
                    const data=await file.arrayBuffer();
                    showConversionProgress(file.name,10);
                    const result=await convertGeoPDFToWebP(data,file.name,pct=>showConversionProgress(file.name,pct));
                    const m={id:'map_'+Date.now()+'_'+Math.random().toString(36).substr(2,4),name:file.name.replace(/\.[^/.]+$/,'')+'.webp',type:'webp_json',fileData:data,webpData:result.webpData,metadata:result.metadata,geojson:{type:'FeatureCollection',features:[]},created:new Date().toISOString(),isActive:false,source:'geopdf',isGeoPDF:true,converted:true,bounds:result.metadata.bounds,minZoom:1,maxZoom:22,jsonData:JSON.stringify(result.metadata)};
                    await saveMapToDB(m);mapCollection.push(m);showConversionProgress(file.name,100);ok++;
                }else{fail++;showNotification('⚠️ Format tidak didukung: '+file.name,3000);}
            }catch(err){
                fail++;console.error(err);
                if(err.message!=='Pemilihan georeferensi dibatalkan.')alert('Gagal memproses '+file.name+': '+err.message);
            }
        }
        renderLibraryContent();renderPointsView();
        if(ok)showNotification('✅ '+ok+' peta berhasil diupload'+(fail?' ('+fail+' gagal)':''),3500);
    };
    input.click();
}

function getMapFileIconId(mapData){
    if(mapData.type==='basemap')return mapData.icon||'icon-map';
    return mapData.type==='kmz'||mapData.type==='kml'?'icon-file-kmz':'icon-pdf';
}

function renderLibraryFileList(){
    const lc=document.getElementById('library-file-list');if(!lc)return;
    if(!mapCollection.length){lc.innerHTML='<p style="text-align:center;color:#666;font-size:13px;margin-top:20px;">📭 Belum ada file.</p>';return;}
    let h='';
    mapCollection.forEach(md=>{
        const isActive=activeLayers[md.id]!==undefined;
        const icon=getMapFileIconId(md);
        const pc=md.geojson?.features?.length||0;
        const displayName = md.name.replace(/\.[^/.]+$/, '');
        h+='<div class="file-item" style="'+(isActive?'border-left:3px solid #4CAF50;':'')+'">'
            +'<div class="file-info">'
            +'<svg class="icon"><use href="#'+icon+'"></use></svg>'
            +'<span class="file-name" title="'+md.name+'">'+displayName+'</span>'
            +'<span style="font-size:10px;color:#888;white-space:nowrap;">📍'+pc+'</span>'
            +'</div>'
            +'<div class="file-actions">'
            +(!isActive?'<button class="add-btn" onclick="activateMap(\''+md.id+'\')">Add</button>':'<button class="on-btn" onclick="deactivateMap(\''+md.id+'\')">ON</button>')
            +'<button class="delete-btn" onclick="deleteMap(\''+md.id+'\')" title="Hapus"><svg class="icon" style="width:14px;height:14px;"><use href="#icon-trash"></use></svg></button>'
            +'</div></div>';
    });
    lc.innerHTML=h;
}

// ===== FIT BOUNDS SAFE =====
function isMapViewVisible() {
    const mv = document.getElementById('map-view');
    return !!(mv && mv.classList.contains('active') && currentView === 'map');
}
function fitMapToBoundsSafe(bounds, maxZoomCap) {
    if (!map || !bounds) return;
    try {
        const b = bounds.getSouthWest ? bounds : L.latLngBounds([bounds[0], bounds[1]], [bounds[2], bounds[3]]);
        if (typeof b.isValid === 'function' && !b.isValid()) return;
        if (!isMapViewVisible()) {
            pendingFitBounds = { bounds: b, maxZoom: maxZoomCap || 18 };
            return;
        }
        map.invalidateSize();
        map.fitBounds(b, { padding: [20, 20], maxZoom: Math.min(Number(maxZoomCap) || 18, 18), animate: false });
        updateReticleCoordinates();
        pendingFitBounds = null;
    } catch (e) { console.warn('fitMapToBoundsSafe:', e); }
}

// ===== ACTIVATE / DEACTIVATE / DELETE MAP =====
function activateMap(mapId){
    const md=mapCollection.find(m=>m.id===mapId);if(!md)return;
    if(activeLayers[mapId])deactivateMap(mapId);selectedNotebookId=mapId;
    try{
        if(md.type==='kmz'||md.type==='kml'){
            const reader=new FileReader();
            reader.onload=async function(e){
                try{
                    let kmlText='';
                    if(md.type==='kmz'){const zip=await JSZip.loadAsync(md.fileData);const kf=Object.keys(zip.files).find(f=>f.toLowerCase().endsWith('.kml'));if(kf)kmlText=await zip.files[kf].async('string');else{alert('Tidak ada KML di KMZ');return;}}
                    else kmlText=new TextDecoder().decode(md.fileData);
                    const fg=parseKMLToLeaflet(kmlText);if(!fg.getLayers().length){alert('Tidak ada fitur valid.');return;}
                    fg.addTo(map);
                    const b=fg.getBounds();
                    if(b && b.isValid()) fitMapToBoundsSafe(b, 18);
                    activeLayers[mapId]={name:md.name,layer:fg};md.isActive=true;saveMapToDB(md);
                    updateActiveLayersUI();renderLibraryContent();renderPointsView();activeMapId=mapId;
                    refreshActivePointsLayer();
                    showNotification('✅ '+md.name+' diaktifkan');
                }catch(err){alert('Gagal: '+err.message);}
            };
            reader.readAsArrayBuffer(new Blob([md.fileData]));
        }else if(md.type==='webp_json'){
            try{
                const result=createWebPImageLayer(md);
                if(typeof result.layer.setOpacity==='function')result.layer.setOpacity(webpOpacity);
                result.layer.addTo(map);
                activeLayers[mapId]={name:md.name,layer:result.layer,type:'webp_json'};
                md.isActive=true;saveMapToDB(md);
                updateActiveLayersUI();renderLibraryContent();renderPointsView();activeMapId=mapId;
                refreshActivePointsLayer();
                fitMapToBoundsSafe(result.bounds, 18);
                showNotification('✅ '+md.name+' ditampilkan di peta',3000);
            }catch(err){alert('Gagal: '+err.message);}
        }else showNotification('⚠️ Format tidak didukung: '+md.type);
    }catch(err){alert('Gagal mengaktifkan: '+err.message);}
}

function deactivateMap(mapId){
    if(activeLayers[mapId]){
        const l=activeLayers[mapId].layer;
        map.removeLayer(l);
        const pl=activeLayers[mapId].pointsLayer;
        if(pl)map.removeLayer(pl);
        if(l&&l._webpObjectUrl)URL.revokeObjectURL(l._webpObjectUrl);
        delete activeLayers[mapId];
        const md=mapCollection.find(m=>m.id===mapId);
        if(md){md.isActive=false;saveMapToDB(md);}
        if(selectedNotebookId===mapId)selectedNotebookId=null;
        updateActiveLayersUI();renderLibraryContent();renderPointsView();
        if(activeMapId===mapId)activeMapId=null;
        showNotification('🗑️ Peta dinonaktifkan');
    }
}

async function deleteMap(mapId){
    const md=mapCollection.find(m=>m.id===mapId);if(!md)return;
    if(!confirm('Hapus "'+md.name+'"?'))return;
    try{
        if(activeLayers[mapId]){const l=activeLayers[mapId].layer;map.removeLayer(l);const pl=activeLayers[mapId].pointsLayer;if(pl)map.removeLayer(pl);if(l&&l._webpObjectUrl)URL.revokeObjectURL(l._webpObjectUrl);delete activeLayers[mapId];}
        if(md.geojson?.features)for(const ft of md.geojson.features)await deletePhotoQuiet(ft.properties?.photoId);
        await deleteMapFromDB(mapId);mapCollection=mapCollection.filter(m=>m.id!==mapId);
        if(activeMapId===mapId)activeMapId=null;
        updateActiveLayersUI();renderLibraryContent();renderPointsView();
        showNotification('🗑️ "'+md.name+'" dihapus');
    }catch(err){alert('Gagal menghapus: '+err.message);}
}

function updateActiveLayersUI(){
    const c=document.getElementById('active-layers');let h='';
    const orderedLayerIds=Object.keys(activeLayers).sort((a,b)=>{
        const getOrder=id=>{
            const layer=activeLayers[id];
            if(id==='basemap'||layer.type==='basemap')return 0;
            if(layer.type==='kmz'||layer.type==='kml')return 1;
            const md=mapCollection.find(m=>m.id===id);
            return md&& (md.type==='kmz'||md.type==='kml') ? 1 : 2;
        };
        return getOrder(a)-getOrder(b);
    });
    orderedLayerIds.forEach(id=>{
        const it=activeLayers[id];
        const md=mapCollection.find(m=>m.id===id);
        const icon=getMapFileIconId(md||{type:it.type});
        h+='<div class="file-item"><div class="file-info"><svg class="icon" style="width:16px;height:16px;color:#5d839e"><use href="#'+icon+'"></use></svg><span class="file-name">'+it.name.replace(/\.[^/.]+$/,'')+'</span></div><button class="remove-btn" onclick="deactivateMap(\''+id+'\')">Hapus</button></div>';
    });
    c.innerHTML=h;updateMapActiveLayersOverlay();
}

function updateMapActiveLayersOverlay(){
    const el=document.getElementById('active-layers-overlay');
    if(!el)return;
    let h='';
    Object.keys(activeLayers).forEach(id=>{
        if(id==='basemap')return;
        const it=activeLayers[id];
        const label=(it.name||'').replace(/\.[^/.]+$/,'');
        h+='<div class="active-layer-chip" title="Zoom ke '+label.replace(/"/g,'&quot;')+'" onclick="zoomToActiveLayer(\''+id+'\')">🔍 '+label+'</div>';
    });
    el.innerHTML=h;
    el.style.display=h?'flex':'none';
}

function zoomToActiveLayer(mapId){
    const entry=activeLayers[mapId];
    if(!entry||!entry.layer){showNotification('⚠️ Layer tidak ditemukan.');return;}
    const l=entry.layer;
    try{
        if(typeof l.getBounds==='function'){
            const b=l.getBounds();
            if(b&&(typeof b.isValid!=='function'||b.isValid())){
                const resetNorth=()=>{ if(map.setBearing) map.setBearing(0); };
                map.once('moveend', resetNorth);
                map.fitBounds(b,{padding:[30,30]});
                setTimeout(resetNorth, 350);
                return;
            }
        }
    }catch(e){console.warn('zoomToActiveLayer error:',e);}
    showNotification('⚠️ Layer ini tidak punya area yang bisa di-zoom.');
}

// ===== KML PARSING =====
function kmlColorToLeaflet(kc){if(!kc||kc.trim().length!==8)return{color:'#3388ff',opacity:1};const h=kc.trim();const a=parseInt(h.substring(0,2),16)/255;return{color:'#'+h.substring(6,8)+h.substring(4,6)+h.substring(2,4),opacity:isNaN(a)?1:a};}

function parseKMLToLeaflet(kmlText) {
    const parser = new DOMParser();
    const xml = parser.parseFromString(kmlText, "text/xml");
    const lg = L.featureGroup();
    const sm = {};

    const styles = xml.getElementsByTagName("Style");
    for (let i = 0; i < styles.length; i++) {
        const s = styles[i];
        const id = s.getAttribute("id");
        if (!id) continue;
        sm[id] = {};
        const ls = s.getElementsByTagName("LineStyle")[0];
        if (ls) {
            const c = ls.getElementsByTagName("color")[0]?.textContent;
            const w = ls.getElementsByTagName("width")[0]?.textContent;
            if (c) sm[id].line = kmlColorToLeaflet(c);
            if (w) sm[id].weight = parseFloat(w);
        }
        const ps = s.getElementsByTagName("PolyStyle")[0];
        if (ps) {
            const c = ps.getElementsByTagName("color")[0]?.textContent;
            const f = ps.getElementsByTagName("fill")[0]?.textContent;
            const o = ps.getElementsByTagName("outline")[0]?.textContent;
            if (c) sm[id].poly = kmlColorToLeaflet(c);
            if (f !== undefined) sm[id].hasFill = f.trim() !== '0';
            if (o !== undefined) sm[id].hasOutline = o.trim() !== '0';
        }
    }

    const sms = xml.getElementsByTagName("StyleMap");
    for (let i = 0; i < sms.length; i++) {
        const s = sms[i];
        const id = s.getAttribute("id");
        if (!id) continue;
        const pairs = s.getElementsByTagName("Pair");
        for (let j = 0; j < pairs.length; j++) {
            const key = pairs[j].getElementsByTagName("key")[0]?.textContent?.trim();
            if (key === "normal") {
                const su = pairs[j].getElementsByTagName("styleUrl")[0]?.textContent?.trim().replace("#", "");
                if (su && sm[su]) sm[id] = sm[su];
            }
        }
    }

    const pms = xml.getElementsByTagName("Placemark");
    for (let i = 0; i < pms.length; i++) {
        const pm = pms[i];
        const name = pm.getElementsByTagName("name")[0]?.textContent || "Elemen " + (i + 1);
        const su = pm.getElementsByTagName("styleUrl")[0]?.textContent?.trim().replace("#", "");
        const as = sm[su] || {};
        const lHex = as.line?.color || '#000000';
        const lOp = as.line?.opacity ?? 1;
        const fHex = as.poly?.color || lHex;
        const fOp = as.poly?.opacity ?? 0.6;

        const pts = pm.getElementsByTagName("Point");
        for (let j = 0; j < pts.length; j++) {
            const co = pts[j].getElementsByTagName("coordinates")[0];
            if (co) {
                const p = co.textContent.trim().split(",");
                if (p.length >= 2) {
                    const lng = parseFloat(p[0]), lat = parseFloat(p[1]);
                    if (!isNaN(lat) && !isNaN(lng)) {
                        L.circleMarker([lat, lng], { radius: 6, color: lHex, fillColor: fHex, fillOpacity: 0.9, weight: 1.5 }).bindPopup('<b>' + name + '</b>').addTo(lg);
                    }
                }
            }
        }
        const lines = pm.getElementsByTagName("LineString");
        for (let j = 0; j < lines.length; j++) {
            const co = lines[j].getElementsByTagName("coordinates")[0];
            if (co) {
                const ll = [];
                co.textContent.trim().split(/\s+/).forEach(c => {
                    const p = c.split(",");
                    if (p.length >= 2) {
                        const lng = parseFloat(p[0]), lat = parseFloat(p[1]);
                        if (!isNaN(lat) && !isNaN(lng)) ll.push([lat, lng]);
                    }
                });
                if (ll.length) L.polyline(ll, { color: lHex, opacity: lOp, weight: as.weight || 3 }).bindPopup('<b>' + name + '</b>').addTo(lg);
            }
        }
        const polys = pm.getElementsByTagName("Polygon");
        for (let j = 0; j < polys.length; j++) {
            const co = polys[j].getElementsByTagName("coordinates")[0];
            if (co) {
                const ll = [];
                co.textContent.trim().split(/\s+/).forEach(c => {
                    const p = c.split(",");
                    if (p.length >= 2) {
                        const lng = parseFloat(p[0]), lat = parseFloat(p[1]);
                        if (!isNaN(lat) && !isNaN(lng)) ll.push([lat, lng]);
                    }
                });
                if (ll.length) L.polygon(ll, { stroke: false, color: 'transparent', weight: 0, fill: true, fillColor: fHex, fillOpacity: fOp }).bindPopup('<b>' + name + '</b>').addTo(lg);
            }
        }
    }
    return lg;
}

// ===== POINTS VIEW =====
function renderPointsView(){
    const c=document.getElementById('points-list-container');
    const mn=document.getElementById('points-map-name');
    const am=getActiveMap();
    if(!am){document.getElementById('notebook-select').innerHTML='<option>-</option>';mn.textContent='Pilih peta terlebih dahulu';c.innerHTML='<div class="empty-points">📭 Tidak ada peta aktif.</div>';return;}
    const actives=mapCollection.filter(m=>m.isActive);
    const sel=document.getElementById('notebook-select');
    sel.innerHTML=actives.map(m=>'<option value="'+m.id+'"'+(m.id===am.id?' selected':'')+'>'+m.name.replace(/\.[^/.]+$/,'')+' ('+(m.geojson?.features?.length||0)+' titik)</option>').join('');
    mn.textContent='📄 Prioritas: '+am.name.replace(/\.[^/.]+$/,'');
    const f=am.geojson?.features||[];
    if(!f.length){c.innerHTML='<div class="empty-points">📭 Belum ada titik.</div>';return;}
    let h='';
    f.forEach((ft,i)=>{
        const co=ft.geometry.coordinates;
        const nm=ft.properties?.name||'Titik '+(i+1);
        const nt=ft.properties?.note||'';
        const pid=ft.properties?.photoId;
        const thumb=pid?'<img class="point-thumb" data-photo-id="'+pid+'" alt="foto" style="cursor:pointer;" onclick="openPhotoLightbox(\''+pid+'\')">':'<div class="point-thumb point-thumb-empty">📍</div>';
        h+='<div class="point-item">'+thumb+'<div class="point-info"><span class="point-name">'+nm+'</span><span class="point-coords">'+co[1].toFixed(6)+', '+co[0].toFixed(6)+(nt?' • '+nt:'')+'</span></div><div class="point-actions"><button onclick="openPointEdit('+i+')" title="Edit / Foto">✏️</button><button onclick="flyToPoint('+i+')" title="Lokasi">📍</button><button onclick="movePoint('+i+')" title="Pindah ke peta lain">📤</button><button class="btn-delete-point" onclick="deletePoint('+i+')" title="Hapus">✕</button></div></div>';
    });
    c.innerHTML=h;
    loadPointThumbnails();
}

async function loadPointThumbnails(){
    pointThumbUrls.forEach(u=>URL.revokeObjectURL(u));
    pointThumbUrls=[];
    const imgs=document.querySelectorAll('.point-thumb[data-photo-id]');
    for(const img of imgs){
        const id=img.getAttribute('data-photo-id');
        const url=await getPhotoBlobUrl(id);
        if(url&&url!=='NEED_PERMISSION'){
            pointThumbUrls.push(url);
            img.src=url;
        }
    }
}

function addPointFromCrosshair(){
    const am=getActiveMap();if(!am){alert('Aktifkan peta terlebih dahulu.');return;}
    const c=map.getCenter();
    const name=prompt('Nama titik:','Waypoint '+waypointCount);if(!name)return;
    const note=prompt('Catatan (opsional):','');
    if(!am.geojson)am.geojson={type:'FeatureCollection',features:[]};
    am.geojson.features.push({type:'Feature',geometry:{type:'Point',coordinates:[c.lng,c.lat]},properties:{name,note:note||'',timestamp:new Date().toISOString()}});
    saveMapToDB(am).then(()=>{waypointCount++;renderPointsView();renderLibraryContent();showNotification('✅ Titik "'+name+'" ditambahkan');});
    refreshActivePointsLayer();
}

function addWaypointAtReticle(){
    map.stop();
    const c=getCrosshairLatLng() || map.getCenter();
    waypointCount++;
    const am=getActiveMap();
    if(am){
        if(!am.geojson)am.geojson={type:'FeatureCollection',features:[]};
        am.geojson.features.push({type:'Feature',geometry:{type:'Point',coordinates:[c.lng,c.lat]},properties:{name:'Waypoint '+(waypointCount-1),note:'',timestamp:new Date().toISOString()}});
        saveMapToDB(am);renderPointsView();renderLibraryContent();refreshActivePointsLayer();
    }
}

function flyToPoint(i) {
    const am = getActiveMap();
    if (!am) return;
    const f = am.geojson?.features[i];
    if (!f || !f.geometry) return;
    const lat = f.geometry.coordinates[1];
    const lng = f.geometry.coordinates[0];
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    goToMapView();
    setTimeout(function () {
        if (!map) return;
        map.invalidateSize();
        if (map.setBearing) map.setBearing(0);
        const targetZoom = Math.max(map.getZoom(), 17);
        map.setView([lat, lng], targetZoom, { animate: true });
        updateReticleCoordinates();
    }, 250);
}

async function deletePoint(i){
    const am=getActiveMap();if(!am)return false;
    if(!confirm('Hapus titik ini?'))return false;
    const photoId=am.geojson.features[i]?.properties?.photoId;
    am.geojson.features.splice(i,1);
    await saveMapToDB(am);await deletePhotoQuiet(photoId);
    renderPointsView();renderLibraryContent();refreshActivePointsLayer();
    showNotification('🗑️ Titik dihapus');return true;
}

async function clearAllPoints(){
    const am=getActiveMap();if(!am)return;
    const c=am.geojson?.features?.length||0;
    if(!c){alert('Tidak ada titik.');return;}
    if(!confirm('Hapus semua '+c+' titik?'))return;
    for(const ft of am.geojson.features){await deletePhotoQuiet(ft.properties?.photoId);}
    am.geojson.features=[];
    await saveMapToDB(am);
    renderPointsView();renderLibraryContent();refreshActivePointsLayer();
    showNotification('🗑️ Semua titik dihapus');
}

function exportPoints(format){
    const am=getActiveMap();if(!am){alert('Aktifkan peta terlebih dahulu.');return;}
    const f=am.geojson?.features||[];
    if(!f.length){alert('Tidak ada titik.');return;}
    let content='',filename=am.name.replace(/\.[^/.]+$/,'')+'_points',mimeType='';
    switch(format){
        case'txt':content='Name\tLat\tLng\tNote\n'+f.map(x=>x.properties.name+'\t'+x.geometry.coordinates[1].toFixed(6)+'\t'+x.geometry.coordinates[0].toFixed(6)+'\t'+(x.properties.note||'')).join('\n');filename+='.txt';mimeType='text/plain';break;
        case'csv':content='Name,Lat,Lng,Note\n'+f.map(x=>'"'+x.properties.name+'",'+x.geometry.coordinates[1].toFixed(6)+','+x.geometry.coordinates[0].toFixed(6)+',"'+(x.properties.note||'')+'"').join('\n');filename+='.csv';mimeType='text/csv';break;
        case'kml':content='<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n<Document>\n<name>'+am.name+'</name>\n';f.forEach(x=>{content+='<Placemark>\n<name>'+x.properties.name+'</name>\n';if(x.properties.note)content+='<description>'+x.properties.note+'</description>\n';content+='<Point>\n<coordinates>'+x.geometry.coordinates[0]+','+x.geometry.coordinates[1]+'</coordinates>\n</Point>\n</Placemark>\n';});content+='</Document>\n</kml>';filename+='.kml';mimeType='application/vnd.google-earth.kml+xml';break;
        default:return;
    }
    const blob=new Blob([content],{type:mimeType+';charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download=filename;
    document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);
    showNotification('✅ '+filename+' diexport ('+f.length+' titik)');
}

// ===== NOTIFICATION =====
function showConversionProgress(filename, pct){
    const value=Math.max(0,Math.min(100,Math.round(Number(pct)||0)));
    const text=filename+' '+value+'%';
    const current=document.querySelector('.custom-notification');
    if(current){current.textContent=text;current.style.opacity='1';return;}
    showNotification(text,0);
}
function showNotification(msg,dur=3000){
    const e=document.querySelector('.custom-notification');if(e)e.remove();
    const n=document.createElement('div');
    n.className='custom-notification';
    n.style.cssText='position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.85);color:white;padding:10px 20px;border-radius:8px;font-size:13px;z-index:99999;max-width:90%;text-align:center;box-shadow:0 4px 12px rgba(0,0,0,0.3);backdrop-filter:blur(10px);transition:opacity 0.3s;';
    n.textContent=msg;
    document.body.appendChild(n);
    if(dur>0)setTimeout(()=>{n.style.opacity='0';setTimeout(()=>n.remove(),300);},dur);
}

// ===== VIEW NAVIGATION =====
function goToLayersView() {
    const mv = document.getElementById('map-view');
    const lv = document.getElementById('layers-view');
    const pv = document.getElementById('points-view');
    mv.classList.remove('active');lv.classList.remove('active');pv.classList.remove('active');
    lv.classList.add('active');
    currentView = 'layers';
    document.body.classList.add('in-layers-view');
    document.body.classList.remove('in-points-view');
    document.getElementById('btn-location').style.display = 'none';
    document.getElementById('btn-pin').style.display = 'none';
    document.getElementById('coords-display').style.display = 'none';
    document.getElementById('btn-manage-points').style.display = 'none';
    document.getElementById('btn-goto-layers').style.display = 'none';
    document.getElementById('btn-goto-map').style.display = 'none';
    document.getElementById('tools-wrapper').style.display = 'none';
    document.getElementById('gps-overlay').style.visibility = 'hidden';
    document.getElementById('btn-fullscreen').style.visibility = 'hidden';
    document.getElementById('opacity-control').style.visibility = 'hidden';
    document.getElementById('active-layers-overlay').style.visibility = 'hidden';
    document.getElementById('btn-goto-map').style.display = 'inline-flex';
    document.getElementById('btn-manage-points').style.display = 'inline-flex';
    saveCurrentView(currentView);
}

function goToPointsView() {
    const mv = document.getElementById('map-view');
    const lv = document.getElementById('layers-view');
    const pv = document.getElementById('points-view');
    mv.classList.remove('active');lv.classList.remove('active');pv.classList.remove('active');
    pv.classList.add('active');
    currentView = 'points';
    document.body.classList.add('in-points-view');
    document.body.classList.remove('in-layers-view');
    document.getElementById('btn-location').style.display = 'none';
    document.getElementById('btn-pin').style.display = 'none';
    document.getElementById('coords-display').style.display = 'none';
    document.getElementById('btn-manage-points').style.display = 'none';
    document.getElementById('btn-goto-layers').style.display = 'none';
    document.getElementById('btn-goto-map').style.display = 'none';
    document.getElementById('tools-wrapper').style.display = 'none';
    document.getElementById('gps-overlay').style.visibility = 'hidden';
    document.getElementById('btn-fullscreen').style.visibility = 'hidden';
    document.getElementById('opacity-control').style.visibility = 'hidden';
    document.getElementById('active-layers-overlay').style.visibility = 'hidden';
    document.getElementById('btn-goto-map').style.display = 'inline-flex';
    document.getElementById('btn-goto-layers').style.display = 'inline-flex';
    saveCurrentView(currentView);
}

function goToMapView() {
    const mv = document.getElementById('map-view');
    const lv = document.getElementById('layers-view');
    const pv = document.getElementById('points-view');
    mv.classList.remove('active');lv.classList.remove('active');pv.classList.remove('active');
    mv.classList.add('active');
    currentView = 'map';
    document.body.classList.remove('in-layers-view', 'in-points-view');
    document.getElementById('btn-location').style.display = 'none';
    document.getElementById('btn-pin').style.display = 'none';
    document.getElementById('coords-display').style.display = 'none';
    document.getElementById('btn-manage-points').style.display = 'none';
    document.getElementById('btn-goto-layers').style.display = 'none';
    document.getElementById('btn-goto-map').style.display = 'none';
    document.getElementById('tools-wrapper').style.display = 'none';
    document.getElementById('btn-location').style.display = 'inline-flex';
    document.getElementById('btn-pin').style.display = 'inline-flex';
    document.getElementById('coords-display').style.display = 'flex';
    document.getElementById('btn-manage-points').style.display = 'inline-flex';
    document.getElementById('btn-goto-layers').style.display = 'inline-flex';
    document.getElementById('tools-wrapper').style.display = 'inline-flex';
    document.getElementById('btn-goto-map').style.display = 'none';
    document.getElementById('gps-overlay').style.visibility = 'visible';
    document.getElementById('btn-fullscreen').style.visibility = 'visible';
    document.getElementById('opacity-control').style.visibility = 'visible';
    document.getElementById('active-layers-overlay').style.visibility = 'visible';
    updateMapActiveLayersOverlay();
    saveCurrentView(currentView);
    setTimeout(function () {
        if (!map) return;
        map.invalidateSize();
        if (pendingFitBounds) fitMapToBoundsSafe(pendingFitBounds.bounds, pendingFitBounds.maxZoom || 18);
        updateReticleCoordinates();
    }, 120);
}

function switchToPointsView() { if (currentView !== 'points') goToPointsView(); }
function toggleView() { goToLayersView(); }

function restoreLastView(view) {
    const mv = document.getElementById('map-view');
    const lv = document.getElementById('layers-view');
    const pv = document.getElementById('points-view');
    mv.classList.remove('active');lv.classList.remove('active');pv.classList.remove('active');
    document.getElementById('btn-location').style.display = 'none';
    document.getElementById('btn-pin').style.display = 'none';
    document.getElementById('coords-display').style.display = 'none';
    document.getElementById('btn-manage-points').style.display = 'none';
    document.getElementById('btn-goto-layers').style.display = 'none';
    document.getElementById('btn-goto-map').style.display = 'none';
    document.getElementById('tools-wrapper').style.display = 'none';
    document.getElementById('gps-overlay').style.visibility = 'hidden';
    document.getElementById('btn-fullscreen').style.visibility = 'hidden';
    document.getElementById('opacity-control').style.visibility = 'hidden';
    document.getElementById('active-layers-overlay').style.visibility = 'hidden';
    if (view === 'map') {
        mv.classList.add('active');
        document.getElementById('btn-location').style.display = 'inline-flex';
        document.getElementById('btn-pin').style.display = 'inline-flex';
        document.getElementById('coords-display').style.display = 'flex';
        document.getElementById('btn-manage-points').style.display = 'inline-flex';
        document.getElementById('btn-goto-layers').style.display = 'inline-flex';
        document.getElementById('tools-wrapper').style.display = 'inline-flex';
        document.getElementById('gps-overlay').style.visibility = 'visible';
        document.getElementById('btn-fullscreen').style.visibility = 'visible';
        document.getElementById('opacity-control').style.visibility = 'visible';
        document.getElementById('active-layers-overlay').style.visibility = 'visible';
        updateMapActiveLayersOverlay();
        currentView = 'map';
        setTimeout(() => {
            map.invalidateSize();
            if (pendingFitBounds) fitMapToBoundsSafe(pendingFitBounds.bounds, pendingFitBounds.maxZoom || 18);
            else {
                const am = getActiveMap();
                if (am && activeLayers[am.id] && activeLayers[am.id].type === 'webp_json') {
                    const l = activeLayers[am.id].layer;
                    if (l && l.getBounds && l.getBounds().isValid()) fitMapToBoundsSafe(l.getBounds(), 18);
                }
            }
            updateReticleCoordinates();
        }, 400);
    } else if (view === 'points') {
        pv.classList.add('active');
        document.getElementById('btn-goto-map').style.display = 'inline-flex';
        document.getElementById('btn-goto-layers').style.display = 'inline-flex';
        currentView = 'points';
        renderPointsView();
    } else {
        lv.classList.add('active');
        document.getElementById('btn-goto-map').style.display = 'inline-flex';
        document.getElementById('btn-manage-points').style.display = 'inline-flex';
        currentView = 'layers';
    }
}

function switchTab(tabName,event){
    document.querySelectorAll('.tab-btn').forEach(t=>t.classList.remove('active'));
    event.currentTarget.classList.add('active');
    if(tabName==='basemap') renderLibraryBasemaps();
    else renderLibraryContent();
}

function renderLibraryBasemaps(){
    const c=document.getElementById('library-content');let h='';
    Object.keys(BASEMAP_PROVIDERS).forEach(k=>{
        const it=BASEMAP_PROVIDERS[k];
        h+='<div class="file-item"><div class="file-info"><svg class="icon"><use href="#'+it.icon+'"></use></svg><span class="file-name">'+it.name+'</span></div><button class="add-btn" onclick="setBasemap(\''+k+'\')">+ Aktifkan</button></div>';
    });
    c.innerHTML=h;
}

// ===== [BAGIAN C DILANJUTKAN DI PESAN BERIKUTNYA] =====
// ===== SETTINGS =====
function openAppSettings() {
    const modal = document.getElementById('settings-modal');
    if (modal) {
        modal.classList.add('active');
        applyPhotoStorageModeUI();
        if(!modalBackStatePushed){history.pushState({modal:'settings'},'');modalBackStatePushed=true;}
    } else {
        alert("Modal pengaturan tidak ditemukan.");
    }
    const popup = document.getElementById('tools-popup');
    if (popup) popup.style.display = 'none';
}

function closeSettings(fromBackButton){
    document.getElementById('settings-modal').classList.remove('active');
    if(!fromBackButton&&modalBackStatePushed){modalBackStatePushed=false;history.back();}
}

async function savePhotoStorageMode(mode){
    try{
        const db=await openDB();
        db.transaction('config','readwrite').objectStore('config').put(mode,'photoStorageMode');
    }catch(e){console.warn(e);}
}

async function getPhotoStorageMode(){
    try{
        const db=await openDB();
        return new Promise(r=>{
            const req=db.transaction('config','readonly').objectStore('config').get('photoStorageMode');
            req.onsuccess=()=>r(req.result||'auto');
            req.onerror=()=>r('auto');
        });
    }catch(e){return 'auto';}
}

async function saveCurrentView(view){
    try{
        const db=await openDB();
        db.transaction('config','readwrite').objectStore('config').put(view,'lastView');
    }catch(e){console.warn(e);}
}

async function getLastView(){
    try{
        const db=await openDB();
        return new Promise(r=>{
            const req=db.transaction('config','readonly').objectStore('config').get('lastView');
            req.onsuccess=()=>r(req.result||'layers');
            req.onerror=()=>r('layers');
        });
    }catch(e){return 'layers';}
}

async function savePhotoFolderHandle(h){
    try{
        const db=await openDB();
        db.transaction('config','readwrite').objectStore('config').put(h,'photoFolderHandle');
    }catch(e){console.warn(e);}
}

async function getPhotoFolderHandle(){
    try{
        const db=await openDB();
        return new Promise(r=>{
            const req=db.transaction('config','readonly').objectStore('config').get('photoFolderHandle');
            req.onsuccess=()=>r(req.result||null);
            req.onerror=()=>r(null);
        });
    }catch(e){return null;}
}

async function hasFolderPermission(handle){
    if(!handle)return false;
    try{return (await handle.queryPermission({mode:'readwrite'}))==='granted';}catch(e){return false;}
}

async function getPhotoBlobUrl(photoId){
    if(!photoId)return null;
    if(photoId.startsWith('folder:')){
        const filename=photoId.substring(7);
        const folderHandle=await getPhotoFolderHandle();
        if(!folderHandle)return null;
        const ok=await hasFolderPermission(folderHandle);
        if(!ok)return 'NEED_PERMISSION';
        try{
            const fileHandle=await folderHandle.getFileHandle(filename);
            const file=await fileHandle.getFile();
            return URL.createObjectURL(file);
        }catch(e){console.warn('Gagal baca foto dari folder:',e);return null;}
    }else{
        try{
            const rec=await getPhotoFromDB(photoId);
            return (rec&&rec.blob)?URL.createObjectURL(rec.blob):null;
        }catch(e){return null;}
    }
}

let lightboxObjectUrl=null;

async function openPhotoLightbox(photoId){
    if(!photoId)return;
    const result=await getPhotoBlobUrl(photoId);
    if(result==='NEED_PERMISSION'){
        showNotification('🔒 Tap tombol Kamera/Galeri sekali untuk izinkan akses folder lagi',4000);
        return;
    }
    if(!result){
        showNotification('⚠️ Foto tidak ditemukan');
        return;
    }
    lightboxObjectUrl=result;
    document.getElementById('photo-lightbox-img').src=result;
    document.getElementById('photo-lightbox').classList.add('active');
}

function closePhotoLightbox(){
    document.getElementById('photo-lightbox').classList.remove('active');
    if(lightboxObjectUrl){URL.revokeObjectURL(lightboxObjectUrl);lightboxObjectUrl=null;}
}

function openPhotoLightboxForCurrentPoint(){
    const am=getActiveMap();
    const f=(am&&editingPointIndex!==null)?am.geojson?.features[editingPointIndex]:null;
    openPhotoLightbox(f?.properties?.photoId);
}

async function verifyFolderPermission(handle){
    if(!handle)return false;
    const opts={mode:'readwrite'};
    if((await handle.queryPermission(opts))==='granted')return true;
    if((await handle.requestPermission(opts))==='granted')return true;
    return false;
}

async function savePhotoToFolder(handle,file,filename){
    const fileHandle=await handle.getFileHandle(filename,{create:true});
    const writable=await fileHandle.createWritable();
    await writable.write(file);
    await writable.close();
}

async function selectPhotoFolder(){
    if(!isFolderStorageSupported()){alert('Fitur ini tidak didukung di perangkat/browser kamu.');return;}
    try{
        const handle=await window.showDirectoryPicker();
        await savePhotoFolderHandle(handle);
        document.getElementById('photo-folder-path-text').innerText=handle.name;
        showNotification('📁 Folder foto disimpan: '+handle.name);
    }catch(err){console.warn(err);}
}

function isFolderStorageSupported(){
    return 'showDirectoryPicker' in window;
}

async function applyPhotoStorageModeUI(){
    const supported=isFolderStorageSupported();
    const folderLabel=document.getElementById('photo-mode-folder-label');
    const pickerBox=document.getElementById('photo-folder-picker-box');
    if(!supported){
        folderLabel.style.display='none';
    }
    let mode=await getPhotoStorageMode();
    if(mode==='folder'&&!supported){
        mode='auto';
        await savePhotoStorageMode('auto');
    }
    document.getElementById(mode==='folder'?'photo-mode-folder':'photo-mode-auto').checked=true;
    pickerBox.style.display=(mode==='folder')?'flex':'none';
    const savedHandle=await getPhotoFolderHandle();
    document.getElementById('photo-folder-path-text').innerText=savedHandle?savedHandle.name:'Belum dipilih';
}

// ===== DEFAULT KMZ FOLDER =====
async function selectDefaultKMZFolder(){
    if('showDirectoryPicker' in window){
        try{
            defaultDirHandle=await window.showDirectoryPicker();
            await saveHandleToIDB(defaultDirHandle);
            document.getElementById('folder-path-text').innerText=defaultDirHandle.name;
            await scanFilesFromHandle(defaultDirHandle);
            renderKMZLibrary();
            alert("Folder disimpan!");
        }catch(err){console.warn(err);}
    }else document.getElementById('folder-fallback-input').click();
}

function handleFallbackFolderSelect(event){
    const files=Array.from(event.target.files).filter(f=>f.name.toLowerCase().endsWith('.kmz')||f.name.toLowerCase().endsWith('.kml'));
    scannedKmzFiles=files;
    defaultDirHandle={name:'Folder (sesi ini)'};
    document.getElementById('folder-path-text').innerText=defaultDirHandle.name;
    renderKMZLibrary();
    if(!files.length)alert('Tidak ada .kmz/.kml.');
}

async function saveHandleToIDB(h){
    try{
        const db=await openDB();
        db.transaction('config','readwrite').objectStore('config').put(h,'defaultKMZFolder');
    }catch(e){}
}

async function getHandleFromIDB(){
    try{
        const db=await openDB();
        return new Promise(r=>{
            const req=db.transaction('config','readonly').objectStore('config').get('defaultKMZFolder');
            req.onsuccess=()=>r(req.result);
            req.onerror=()=>r(null);
        });
    }catch(e){return null;}
}

async function scanFilesFromHandle(dh){
    scannedKmzFiles=[];
    try{
        for await(const e of dh.values())
            if(e.kind==='file'&&(e.name.endsWith('.kmz')||e.name.endsWith('.kml')))
                scannedKmzFiles.push(await e.getFile());
        renderKMZFileList();
    }catch(e){console.warn(e);}
}

function renderKMZLibrary(){
    const c=document.getElementById('library-content');
    c.innerHTML='<div style="font-size:12px;color:#555;margin-bottom:8px;">Folder: <b>'+(defaultDirHandle?defaultDirHandle.name:'Belum diatur')+'</b></div><div id="kmz-file-list"></div>';
    renderKMZFileList();
}

function renderKMZFileList(){
    const lc=document.getElementById('kmz-file-list');
    if(!lc)return;
    if(!defaultDirHandle){
        lc.innerHTML='<p style="text-align:center;color:#666;font-size:13px;margin-top:20px;">Atur folder via Settings.</p>';
        return;
    }
    if(!scannedKmzFiles.length){
        lc.innerHTML='<p style="text-align:center;color:#666;font-size:13px;margin-top:20px;">Tidak ada file .kmz/.kml.</p>';
        return;
    }
    let h='';
    scannedKmzFiles.forEach((f,i)=>{
        h+='<div class="file-item"><div class="file-info"><svg class="icon"><use href="#icon-file-code"></use></svg><span class="file-name">'+f.name.replace(/\.[^/.]+$/,'')+'</span></div><button class="add-btn" onclick="activateKMZFile('+i+')">+ Aktifkan</button></div>';
    });
    lc.innerHTML=h;
}

async function activateKMZFile(i){
    const f=scannedKmzFiles[i];
    if(!f)return;
    try{
        const d=await f.arrayBuffer();
        const m={id:'map_'+Date.now()+'_'+Math.random().toString(36).substr(2,4),name:f.name,type:f.name.endsWith('.kmz')?'kmz':'kml',fileData:d,geojson:{type:'FeatureCollection',features:[]},created:new Date().toISOString(),isActive:false,source:'folder'};
        await saveMapToDB(m);
        mapCollection.push(m);
        renderLibraryContent();
        renderPointsView();
        alert('✅ '+f.name+' disimpan!');
    }catch(e){alert('Gagal: '+e.message);}
}

// ===== RESIZE HANDLING =====
let viewportResizeTimer=null;
function handleViewportResize(){
    clearTimeout(viewportResizeTimer);
    viewportResizeTimer=setTimeout(()=>{if(map)map.invalidateSize();},150);
}
if(window.visualViewport){
    window.visualViewport.addEventListener('resize', handleViewportResize);
}
window.addEventListener('resize', handleViewportResize);
window.addEventListener('orientationchange', handleViewportResize);

// ===== OPACITY & FULLSCREEN =====
function toggleOpacityPanel(){
    const e = document.getElementById('opacity-control');
    if (e) e.classList.toggle('collapsed');
}

function toggleFullScreen(){
    const el = document.documentElement;
    const btn = document.getElementById('btn-fullscreen');
    const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement);
    if (!isFs) {
        const req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
        if (req) {
            req.call(el).then(function(){
                if (btn) btn.textContent = '[×]';
                setTimeout(function(){ if (map) map.invalidateSize(); }, 200);
            }).catch(function(){});
        }
    } else {
        const exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
        if (exit) {
            exit.call(document).then(function(){
                if (btn) btn.textContent = '[ ]';
                setTimeout(function(){ if (map) map.invalidateSize(); }, 200);
            }).catch(function(){});
        }
    }
}

function setWebPOpacity(pct){
    const v = Math.max(0, Math.min(100, Number(pct)));
    webpOpacity = v / 100;
    const l = document.getElementById('opacity-value');
    if (l) l.textContent = v + '%';
    Object.keys(activeLayers).forEach(id => {
        const item = activeLayers[id];
        if (item.type === 'webp_json' && item.layer && typeof item.layer.setOpacity === 'function') {
            item.layer.setOpacity(webpOpacity);
        }
    });
}

// ===== EVENT LISTENERS (WRENCH + MEASURE) =====
document.addEventListener('DOMContentLoaded', function() {
    // --- 1. POPUP MENU TOOLS (WRENCH) ---
    const btnTools = document.getElementById('btn-tools');
    const toolsPopup = document.getElementById('tools-popup');

    if (btnTools && toolsPopup) {
        btnTools.addEventListener('click', function(e) {
            e.stopPropagation();
            const isHidden = toolsPopup.style.display === 'none' || toolsPopup.style.display === '';
            toolsPopup.style.display = isHidden ? 'block' : 'none';
        });
        document.addEventListener('click', function(e) {
            if (toolsPopup && btnTools) {
                if (!toolsPopup.contains(e.target) && !btnTools.contains(e.target)) {
                    toolsPopup.style.display = 'none';
                }
            }
        });
    } else {
        console.warn('⚠️ Tombol Wrench atau popup tidak ditemukan!');
    }

    // --- 2. TOMBOL MEASURE DI MENU WRENCH ---
    const popupItems = document.querySelectorAll('#tools-popup .popup-item');
    popupItems.forEach(function(item) {
        const text = item.textContent.trim();
        if (text === 'Measure Distance or Area' || text.includes('Measure')) {
            item.removeAttribute('onclick');
            const newItem = item.cloneNode(true);
            item.parentNode.replaceChild(newItem, item);
            newItem.addEventListener('click', function(e) {
                e.stopPropagation();
                e.preventDefault();
                toggleMeasure();
                closeWrenchPopup();
            });
        }
    });

    // --- 3. TOMBOL UNDO ---
    const undoBtn = document.getElementById('measure-undo-btn');
    if (undoBtn) {
        const newUndoBtn = undoBtn.cloneNode(true);
        undoBtn.parentNode.replaceChild(newUndoBtn, undoBtn);
        newUndoBtn.addEventListener('pointerdown', function(e) {
            e.stopPropagation();
            e.preventDefault();
            undoLastPoint();
        }, { passive: false });
    }

    // --- 4. TOMBOL CLEAR ---
    const clearBtn = document.getElementById('measure-clear-btn');
    if (clearBtn) {
        const newClearBtn = clearBtn.cloneNode(true);
        clearBtn.parentNode.replaceChild(newClearBtn, clearBtn);
        newClearBtn.addEventListener('pointerdown', function(e) {
            e.stopPropagation();
            e.preventDefault();
            if (measureActive) {
                clearMeasure();
                updateMeasureDisplay();
                const undoBtn2 = document.getElementById('measure-undo-btn');
                const clearBtn2 = document.getElementById('measure-clear-btn');
                const distRow = document.getElementById('measure-dist-row');
                const areaRow = document.getElementById('measure-area-row');
                if (undoBtn2) undoBtn2.style.display = 'none';
                if (clearBtn2) clearBtn2.style.display = 'none';
                if (distRow) distRow.style.display = 'none';
                if (areaRow) areaRow.style.display = 'none';
            }
        });
    }

    // --- 5. TOMBOL CLOSE (X) ---
    const closeBtn = document.getElementById('measure-close-btn');
    if (closeBtn) {
        const newCloseBtn = closeBtn.cloneNode(true);
        closeBtn.parentNode.replaceChild(newCloseBtn, closeBtn);
        newCloseBtn.addEventListener('pointerdown', function(e) {
            e.stopPropagation();
            e.preventDefault();
            closeMeasure();
        });
    }

    // --- 6. TOMBOL TAMBAH TITIK (+) ---
    const addBtn = document.getElementById('measure-add-btn');
    if (addBtn) {
        const newAddBtn = addBtn.cloneNode(true);
        addBtn.parentNode.replaceChild(newAddBtn, addBtn);
        newAddBtn.addEventListener('pointerdown', function(e) {
            e.stopPropagation();
            e.preventDefault();
            addMeasurePointFromCrosshair();
        }, { passive: false });
    }

    // --- 7. TOMBOL TUTUP GARIS/POLIGON (=) ---
    const finishBtn = document.getElementById('measure-finish-btn');
    if (finishBtn) {
        const newFinishBtn = finishBtn.cloneNode(true);
        finishBtn.parentNode.replaceChild(newFinishBtn, finishBtn);
        newFinishBtn.addEventListener('pointerdown', function(e) {
            e.stopPropagation();
            e.preventDefault();
            closeMeasureShape();
        }, { passive: false });
    }
});

// ===== INIT =====
window.onload = initMap;

// Pengaman: sembunyikan splash maksimal 5 detik meski ada error
setTimeout(function () {
    _splashMinElapsed = true;
    _splashAppReady = true;
    tryHideSplash();
}, 5000);

// Back button handler
window.addEventListener('popstate', function(){
    modalBackStatePushed=false;
    const pointOpen=document.getElementById('point-edit-modal').classList.contains('active');
    const settingsOpen=document.getElementById('settings-modal').classList.contains('active');
    if(pointOpen)closePointEdit(true);
    else if(settingsOpen)closeSettings(true);
});

// ===== EXPOSE FUNCTIONS TO GLOBAL (untuk onclick di HTML) =====
window.centerToGPS = centerToGPS;
window.addWaypointAtReticle = addWaypointAtReticle;
window.goToPointsView = goToPointsView;
window.goToLayersView = goToLayersView;
window.goToMapView = goToMapView;
window.switchTab = switchTab;
window.toggleMeasure = toggleMeasure;
window.closeWrenchPopup = closeWrenchPopup;
window.openSettings = openAppSettings;
window.openAppSettings = openAppSettings;
window.closeSettings = closeSettings;
window.selectDefaultKMZFolder = selectDefaultKMZFolder;
window.handleFallbackFolderSelect = handleFallbackFolderSelect;
window.selectPhotoFolder = selectPhotoFolder;
window.savePhotoStorageMode = savePhotoStorageMode;
window.switchNotebook = switchNotebook;
window.addPointFromCrosshair = addPointFromCrosshair;
window.exportPoints = exportPoints;
window.clearAllPoints = clearAllPoints;
window.openPointEdit = openPointEdit;
window.closePointEdit = closePointEdit;
window.savePointEdit = savePointEdit;
window.deletePointFromEditModal = deletePointFromEditModal;
window.movePointFromEditModal = movePointFromEditModal;
window.openCoordEditPopup = openCoordEditPopup;
window.closeCoordEditPopup = closeCoordEditPopup;
window.saveCoordEdit = saveCoordEdit;
window.triggerPhotoCapture = triggerPhotoCapture;
window.triggerPhotoGallery = triggerPhotoGallery;
window.removePointPhoto = removePointPhoto;
window.handlePhotoSelected = handlePhotoSelected;
window.openPhotoLightbox = openPhotoLightbox;
window.openPhotoLightboxForCurrentPoint = openPhotoLightboxForCurrentPoint;
window.closePhotoLightbox = closePhotoLightbox;
window.deletePoint = deletePoint;
window.movePoint = movePoint;
window.flyToPoint = flyToPoint;
window.activateMap = activateMap;
window.deactivateMap = deactivateMap;
window.deleteMap = deleteMap;
window.zoomToActiveLayer = zoomToActiveLayer;
window.setBasemap = setBasemap;
window.uploadMaps = uploadMaps;
window.uploadKMZFile = uploadKMZFile;
window.uploadGeoPDF = uploadGeoPDF;
window.uploadWebPJSON = uploadWebPJSON;
window.toggleFullScreen = toggleFullScreen;
window.toggleOpacityPanel = toggleOpacityPanel;
window.setWebPOpacity = setWebPOpacity;
window.refreshGPS = refreshGPS;
window.selectGeoCandidate = selectGeoCandidate;
window.cancelGeoSelection = cancelGeoSelection;
window.activateKMZFile = activateKMZFile;

// ===== END OF app.js =====