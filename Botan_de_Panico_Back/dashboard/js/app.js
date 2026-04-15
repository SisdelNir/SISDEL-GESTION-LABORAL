/**
 * Botón de Pánico — Dashboard App
 * Mapa en tiempo real, gestión de emergencias, despacho de unidades
 */

// ============================================================
// GLOBAL STATE
// ============================================================
let map = null;
let markers = {};
let emergencias = [];
let selectedEmergency = null;
const POLLING_INTERVAL = 5000; // 5 seconds
const DEFAULT_CENTER = [19.4326, -99.1332]; // CDMX
const DEFAULT_ZOOM = 12;

// ============================================================
// DASHBOARD INITIALIZATION
// ============================================================
function initDashboard() {
    initMap();
    startClock();
    fetchEmergencias();

    // Start polling for real-time updates
    window.pollingInterval = setInterval(fetchEmergencias, POLLING_INTERVAL);

    // Create toast container
    if (!document.querySelector('.toast-container')) {
        const container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
}

// ============================================================
// MAP INITIALIZATION (Leaflet + OpenStreetMap)
// ============================================================
function initMap() {
    map = L.map('map', {
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        zoomControl: false
    });

    // Light map tiles (CartoDB Positron) for lighter UI theme
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19
    }).addTo(map);

    // Remove the dark filter since we're using a dark tile layer
    document.querySelector('.leaflet-tile-pane').style.filter = 'none';

    // Add zoom control to bottom right
    L.control.zoom({ position: 'bottomright' }).addTo(map);
}

function centerMap() {
    map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
}

// ============================================================
// REAL-TIME DATA FETCHING
// ============================================================
async function fetchEmergencias() {
    try {
        const res = await fetch(`${API_BASE}/api/emergencias/`);
        const data = await res.json();

        const prevCount = emergencias.filter(e =>
            ['ACTIVA', 'EN_CAMINO', 'EN_SITIO'].includes(e.estatus)
        ).length;

        emergencias = data;

        const newCount = emergencias.filter(e =>
            ['ACTIVA', 'EN_CAMINO', 'EN_SITIO'].includes(e.estatus)
        ).length;

        // Show toast for new emergencies
        if (newCount > prevCount && prevCount > 0) {
            showToast('🚨 ¡NUEVA EMERGENCIA DETECTADA!', 'alert');
            playAlertSound();
        }

        updateStats();
        updateMarkers();
        updateEmergencyList();

        // If we have a selected emergency, refresh its detail
        if (selectedEmergency) {
            const updated = emergencias.find(e => e.id_emergencia === selectedEmergency.id_emergencia);
            if (updated) {
                selectedEmergency = updated;
            }
        }

    } catch (err) {
        console.error('Error fetching emergencias:', err);
    }
}

// ============================================================
// STATS UPDATE
// ============================================================
function updateStats() {
    const activas = emergencias.filter(e => e.estatus === 'ACTIVA').length;
    const enCamino = emergencias.filter(e => e.estatus === 'EN_CAMINO').length;
    const resueltas = emergencias.filter(e => e.estatus === 'RESUELTA').length;

    document.querySelector('#stat-activas .stat-number').textContent = activas;
    document.querySelector('#stat-encamino .stat-number').textContent = enCamino;
    document.querySelector('#stat-resueltas .stat-number').textContent = resueltas;
    document.querySelector('#stat-total .stat-number').textContent = emergencias.length;
}

// ============================================================
// MAP MARKERS
// ============================================================
function updateMarkers() {
    // Only show active/en_camino/en_sitio emergencies on map
    const activeEmergencies = emergencias.filter(e =>
        ['ACTIVA', 'EN_CAMINO', 'EN_SITIO'].includes(e.estatus)
    );

    // Remove markers that are no longer active
    Object.keys(markers).forEach(id => {
        if (!activeEmergencies.find(e => e.id_emergencia === id)) {
            map.removeLayer(markers[id]);
            delete markers[id];
        }
    });

    // Add/update markers
    activeEmergencies.forEach(emergencia => {
        if (!emergencia.gps_latitud || !emergencia.gps_longitud) return;

        const lat = emergencia.gps_latitud;
        const lng = emergencia.gps_longitud;
        const isViolence = emergencia.tipo_emergencia === 'VIOLENCIA';
        const isActive = emergencia.estatus === 'ACTIVA';

        // Custom HTML marker
        const markerClass = isViolence ? 'marker-violence' : 'marker-health';
        const activeClass = isActive ? 'marker-active' : '';

        const icon = L.divIcon({
            className: 'marker-emergency',
            html: `<div class="marker-dot ${markerClass} ${activeClass}"></div>`,
            iconSize: [24, 24],
            iconAnchor: [12, 12]
        });

        if (markers[emergencia.id_emergencia]) {
            // Update existing marker
            markers[emergencia.id_emergencia].setLatLng([lat, lng]);
            markers[emergencia.id_emergencia].setIcon(icon);
        } else {
            // Create new marker
            const marker = L.marker([lat, lng], { icon })
                .addTo(map)
                .on('click', () => showEmergencyDetail(emergencia.id_emergencia));

            // Tooltip
            marker.bindTooltip(
                `<strong>${emergencia.nombre_usuario || 'Ciudadano'}</strong><br>${emergencia.tipo_emergencia}`,
                { direction: 'top', offset: [0, -16] }
            );

            markers[emergencia.id_emergencia] = marker;
        }
    });
}

// ============================================================
// EMERGENCY LIST (Side Panel)
// ============================================================
function updateEmergencyList() {
    const listEl = document.getElementById('emergencias-list');
    const emptyEl = document.getElementById('panel-empty');

    // Only show in list view
    if (selectedEmergency) return;

    const activeEmergencies = emergencias.filter(e =>
        ['ACTIVA', 'EN_CAMINO', 'EN_SITIO'].includes(e.estatus)
    );

    if (activeEmergencies.length === 0) {
        emptyEl.style.display = 'flex';
        listEl.innerHTML = '';
        return;
    }

    emptyEl.style.display = 'none';

    listEl.innerHTML = activeEmergencies.map(e => {
        const isViolence = e.tipo_emergencia === 'VIOLENCIA';
        const time = formatTime(e.fecha_creacion);
        const statusClass = `status-${e.estatus}`;

        return `
            <div class="emergency-card tipo-${e.tipo_emergencia} ${e.estatus === 'ACTIVA' ? 'card-activa' : ''}"
                 onclick="showEmergencyDetail('${e.id_emergencia}')">
                <div class="card-header">
                    <span class="card-type-badge badge-${e.tipo_emergencia}">
                        ${isViolence ? '🚨 VIOLENCIA' : '🚑 SALUD'}
                    </span>
                    <span class="card-time">${time}</span>
                </div>
                <div class="card-name">${e.nombre_usuario || 'Ciudadano'}</div>
                <div class="card-location">
                    📍 ${e.gps_latitud?.toFixed(4) || 'N/A'}, ${e.gps_longitud?.toFixed(4) || 'N/A'}
                </div>
                <div class="card-status">
                    <div class="status-indicator ${statusClass}">
                        <span class="status-dot"></span>
                        <span>${formatStatus(e.estatus)}</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// ============================================================
// EMERGENCY DETAIL VIEW
// ============================================================
async function showEmergencyDetail(id_emergencia) {
    try {
        const res = await fetch(`${API_BASE}/api/emergencias/${id_emergencia}`);
        const data = await res.json();

        selectedEmergency = data;

        // Switch to detail view
        document.getElementById('panel-list').style.display = 'none';
        document.getElementById('panel-detail').style.display = 'block';
        document.getElementById('btn-close-detail').style.display = 'block';
        document.getElementById('panel-title').textContent = 'Detalle de Emergencia';

        // Populate detail fields
        const isViolence = data.tipo_emergencia === 'VIOLENCIA';
        const badge = document.getElementById('detail-badge');
        badge.textContent = isViolence ? '🚨 VIOLENCIA' : '🚑 EMERGENCIA DE SALUD';
        badge.className = `detail-badge badge-${data.tipo_emergencia}`;

        document.getElementById('detail-nombre').textContent = data.nombre_usuario || 'Desconocido';
        document.getElementById('detail-telefono').textContent = data.telefono_usuario || 'N/A';
        document.getElementById('detail-coords').textContent =
            `${data.gps_latitud?.toFixed(6) || 'N/A'}, ${data.gps_longitud?.toFixed(6) || 'N/A'}`;
        document.getElementById('detail-direccion').textContent = data.direccion_aproximada || 'Sin dirección registrada';

        // Medical summary
        const medicoSection = document.getElementById('detail-medico-section');
        if (data.resumen_medico) {
            medicoSection.style.display = 'block';
            document.getElementById('detail-resumen-medico').textContent = data.resumen_medico;
        } else {
            medicoSection.style.display = 'none';
        }

        // Event info
        const estatusEl = document.getElementById('detail-estatus');
        estatusEl.textContent = formatStatus(data.estatus);
        estatusEl.className = `field-value status-badge badge-${data.tipo_emergencia}`;

        document.getElementById('detail-metodo').textContent = formatMetodo(data.metodo_disparo);
        document.getElementById('detail-hora').textContent = formatDateTime(data.fecha_creacion);

        // Center map on emergency
        if (data.gps_latitud && data.gps_longitud) {
            map.flyTo([data.gps_latitud, data.gps_longitud], 15, { duration: 1 });
        }

    } catch (err) {
        console.error('Error loading emergency detail:', err);
        showToast('Error al cargar el detalle', 'alert');
    }
}

function closeDetail() {
    selectedEmergency = null;
    document.getElementById('panel-list').style.display = 'block';
    document.getElementById('panel-detail').style.display = 'none';
    document.getElementById('btn-close-detail').style.display = 'none';
    document.getElementById('panel-title').textContent = 'Emergencias Activas';
    updateEmergencyList();
}

// ============================================================
// DISPATCH UNIT
// ============================================================
function despacharUnidad() {
    document.getElementById('dispatch-modal').style.display = 'flex';
}

function cerrarModal() {
    document.getElementById('dispatch-modal').style.display = 'none';
}

async function confirmarDespacho() {
    if (!selectedEmergency || !currentOperator) return;

    const tipo = document.getElementById('dispatch-tipo').value;
    const unidad = document.getElementById('dispatch-unidad').value.trim();
    const notas = document.getElementById('dispatch-notas').value.trim();

    try {
        const res = await fetch(`${API_BASE}/api/despacho/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id_emergencia: selectedEmergency.id_emergencia,
                id_operador: currentOperator.id_operador,
                tipo_unidad: tipo,
                unidad_asignada: unidad || null,
                notas_operador: notas || null
            })
        });

        if (res.ok) {
            showToast(`🚓 Unidad ${unidad || tipo} despachada exitosamente`, 'success');
            cerrarModal();
            // Refresh data
            await fetchEmergencias();
            if (selectedEmergency) {
                showEmergencyDetail(selectedEmergency.id_emergencia);
            }
        } else {
            const err = await res.json();
            showToast(err.detail || 'Error al despachar', 'alert');
        }
    } catch (err) {
        showToast('Error de conexión', 'alert');
    }
}

// ============================================================
// STATUS UPDATES
// ============================================================
async function resolverEmergencia() {
    if (!selectedEmergency) return;
    await updateEmergencyStatus(selectedEmergency.id_emergencia, 'RESUELTA');
    showToast('✅ Emergencia marcada como RESUELTA', 'success');
    closeDetail();
}

async function falsaAlarma() {
    if (!selectedEmergency) return;
    await updateEmergencyStatus(selectedEmergency.id_emergencia, 'FALSA_ALARMA');
    showToast('❌ Marcada como FALSA ALARMA', 'info');
    closeDetail();
}

async function updateEmergencyStatus(id, estatus) {
    try {
        await fetch(`${API_BASE}/api/emergencias/${id}/estatus`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ estatus })
        });
        await fetchEmergencias();
    } catch (err) {
        console.error('Error updating status:', err);
    }
}

// ============================================================
// SIMULATE EMERGENCY (for testing)
// ============================================================
async function simularEmergencia() {
    try {
        // Get first user from database
        const usersRes = await fetch(`${API_BASE}/api/usuarios/`);
        const users = await usersRes.json();

        if (users.length === 0) {
            showToast('No hay usuarios registrados para simular', 'alert');
            return;
        }

        const user = users[0];
        const tipos = ['VIOLENCIA', 'SALUD'];
        const tipo = tipos[Math.floor(Math.random() * tipos.length)];

        // Random coordinates around CDMX
        const lat = 19.4326 + (Math.random() - 0.5) * 0.08;
        const lng = -99.1332 + (Math.random() - 0.5) * 0.08;

        const res = await fetch(`${API_BASE}/api/emergencias/disparar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id_usuario: user.id_usuario,
                tipo_emergencia: tipo,
                gps_latitud: lat,
                gps_longitud: lng,
                metodo_disparo: 'APP'
            })
        });

        if (res.ok) {
            showToast(`🚨 Emergencia simulada: ${tipo}`, 'alert');
            playAlertSound();
            await fetchEmergencias();
        }
    } catch (err) {
        showToast('Error al simular emergencia', 'alert');
        console.error(err);
    }
}

// ============================================================
// UTILITIES
// ============================================================

function formatTime(isoString) {
    if (!isoString) return 'N/A';
    const date = new Date(isoString);
    return date.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}

function formatDateTime(isoString) {
    if (!isoString) return 'N/A';
    const date = new Date(isoString);
    return date.toLocaleString('es-MX', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
}

function formatStatus(status) {
    const map = {
        'ACTIVA': '🔴 Activa',
        'EN_CAMINO': '🟠 En Camino',
        'EN_SITIO': '🔵 En Sitio',
        'RESUELTA': '🟢 Resuelta',
        'FALSA_ALARMA': '⚪ Falsa Alarma',
        'CANCELADA': '⚫ Cancelada'
    };
    return map[status] || status;
}

function formatMetodo(metodo) {
    const map = {
        'APP': '📱 Aplicación',
        'BOTON_FISICO': '🔘 Botón Físico',
        'HEARTBEAT': '💓 Heartbeat (Auto)'
    };
    return map[metodo] || metodo;
}

// ============================================================
// CLOCK
// ============================================================
function startClock() {
    function updateClock() {
        const now = new Date();
        document.getElementById('clock').textContent = now.toLocaleString('es-MX', {
            weekday: 'short',
            day: '2-digit',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    }
    updateClock();
    setInterval(updateClock, 1000);
}

// ============================================================
// TOAST NOTIFICATIONS
// ============================================================
function showToast(message, type = 'info') {
    const container = document.querySelector('.toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span>${message}</span>`;

    container.appendChild(toast);

    // Auto-remove after 5 seconds
    setTimeout(() => {
        toast.style.animation = 'toastOut 0.4s ease forwards';
        setTimeout(() => toast.remove(), 400);
    }, 5000);
}

// ============================================================
// ALERT SOUND (Web Audio API)
// ============================================================
function playAlertSound() {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

        // Create a simple alert beep
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(880, audioCtx.currentTime);
        gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime);

        oscillator.start();

        // Two short beeps
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.15);
        gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime + 0.2);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.35);

        oscillator.stop(audioCtx.currentTime + 0.4);
    } catch (e) {
        // Silently fail if audio is not supported
    }
}
