/**
 * Panel Central JS — Botón de Pánico SISDEL
 * Scoped por institución desde sessionStorage
 */

const API = (window.location.hostname === 'localhost' || window.location.protocol === 'file:') ? 'http://localhost:8000' : 'https://boton-de-panico-sisdel.onrender.com';  // Local o Render
let INST  = null;
let mapaL = null;
let marcadores = {};
let alertaActual = null;
let filtro = 'todas';
let _alertasVistas = new Set();   // IDs de emergencias ya vistas
let _audioCtx = null;             // Web Audio para alarma

// ── INIT ──────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    if (sessionStorage.getItem('sisdel_tipo') !== 'institucion') {
        window.location.href = 'index.html'; return;
    }
    INST = JSON.parse(sessionStorage.getItem('sisdel_inst'));
    document.getElementById('inst-name-label').textContent = INST.nombre_institucion;
    document.title = `🚨 ${INST.nombre_institucion} — Panel SISDEL`;

    iniciarReloj();
    iniciarMapa();
    pedirPermisoNotificacion();
    cargarAlertas();
    cargarVecinos();
    // Refresco cada 5 segundos
    setInterval(() => { cargarAlertas(); }, 5000);
    // Keep-alive: ping a Render cada 4 minutos para evitar que duerma
    setInterval(() => { fetch(`${API}/health`).catch(()=>{}); }, 4 * 60 * 1000);
});


function logout() { sessionStorage.clear(); window.location.href = 'index.html'; }

function abrirRegistroVecino() {
    const base = window.location.pathname.replace('panel.html','');
    const url = `${base}vecino.html?inst=${INST.id_institucion}&admin=1`;
    window.open(url, '_blank');
}

// ── RELOJ ─────────────────────────────────────────
function iniciarReloj() {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone; // zona del dispositivo
    const tick = () => {
        document.getElementById('clock').textContent =
            new Date().toLocaleTimeString([], { hour12: false, timeZone: tz });
    };
    tick(); setInterval(tick, 1000);
}

// ── MAPA ──────────────────────────────────────────
function iniciarMapa() {
    // Centro: Guatemala (ajusta según tu país)
    mapaL = L.map('mapa').setView([14.6349, -90.5069], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        {attribution:'© OpenStreetMap'}).addTo(mapaL);
}
function centrarMapa() { if(mapaL) mapaL.setView([14.6349,-90.5069],12); }

function abrirMapa() {
    document.getElementById('modal-mapa').style.display='flex';
    if(mapaL) {
        setTimeout(() => {
            mapaL.invalidateSize();
            centrarMapa();
        }, 100);
    }
}
function cerrarMapa(e) {
    if (e && e.target!==document.getElementById('modal-mapa')) return;
    document.getElementById('modal-mapa').style.display='none';
}

function verMapaRapido(lat, lon) {
    document.getElementById('modal-mapa').style.display='flex';
    if(mapaL) {
        setTimeout(() => {
            mapaL.invalidateSize();
            mapaL.setView([lat, lon], 16);
        }, 100);
    }
}

async function avisarFamiliares(id_vecino, nombre_vecino, locUrl) {
    if (!id_vecino) { alert('No hay ID de vecino válido en esta emergencia.'); return; }
    
    document.getElementById('avisar-body').innerHTML = '<p style="color:#6b7294;font-size:.85rem;text-align:center;">Buscando contactos...</p>';
    document.getElementById('modal-avisar').style.display='flex';
    
    try {
        const res = await fetch(`${API}/api/vecinos/${id_vecino}/contactos`);
        const contactos = await res.json();
        
        if (!contactos || !contactos.length) {
            document.getElementById('avisar-body').innerHTML = '<p style="color:#ff3b3b;font-size:.85rem;text-align:center;">Este vecino no tiene familiares registrados.</p>';
            return;
        }
        
        const textoWA = `🚨 INFO DE CENTRAL SISDEL 🚨\n\nHemos recibido una Alerta de Pánico de *${nombre_vecino}*.\n📍 Ubicación: ${locUrl}\n\nNuestras unidades están siendo notificadas para verificar la situación.`;
        
        document.getElementById('avisar-body').innerHTML = contactos.map(c => {
            const num = c.telefono.replace(/\D/g, '');
            const urlWeb = `https://wa.me/${num}?text=${encodeURIComponent(textoWA)}`;
            
            return `
                <a href="${urlWeb}" target="_blank" rel="noopener"
                   style="display:flex; align-items:center; justify-content:center; gap:.5rem;
                          background:#25d366; color:#fff; padding:.6rem;
                          border-radius:8px; font-weight:700; font-size:.85rem; text-decoration:none;">
                   <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                        <path d="M12 0C5.373 0 0 5.373 0 12c0 2.127.558 4.126 1.533 5.857L.057 23.704a.75.75 0 00.92.92l5.847-1.476A11.943 11.943 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.75a9.693 9.693 0 01-4.944-1.355l-.354-.21-3.668.926.944-3.565-.23-.366A9.693 9.693 0 012.25 12C2.25 6.615 6.615 2.25 12 2.25S21.75 6.615 21.75 12 17.385 21.75 12 21.75z"/>
                    </svg>
                   Avisar a ${c.nombre || c.telefono}
                </a>
            `;
        }).join('');
        
    } catch {
        document.getElementById('avisar-body').innerHTML = '<p style="color:#ff3b3b;font-size:.85rem;text-align:center;">Error de conexión.</p>';
    }
}

function cerrarAvisar(e) {
    if (e && e.target!==document.getElementById('modal-avisar')) return;
    document.getElementById('modal-avisar').style.display='none';
}

function ponerMarcador(e) {
    if (!mapaL || !e.gps_latitud || !e.gps_longitud) return;
    if (marcadores[e.id_emergencia]) mapaL.removeLayer(marcadores[e.id_emergencia]);
    const c = e.estatus==='ACTIVA'?'#ff3b3b':e.estatus==='EN_CAMINO'?'#ff8c00':'#00d68f';
    const icon = L.divIcon({
        html:`<div style="background:${c};width:14px;height:14px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 8px ${c}"></div>`,
        iconSize:[14,14], className:''
    });
    marcadores[e.id_emergencia] = L.marker([e.gps_latitud,e.gps_longitud],{icon})
        .bindPopup(`<b>🚨 ${e.nombre_vecino}</b><br>📱 ${e.telefono_vecino}<br>📍 ${e.direccion_aproximada||'Sin coords'}`)
        .addTo(mapaL);
}

// ── ALARMA SONORA ─────────────────────────────────
function pedirPermisoNotificacion() {
    if ('Notification' in window && Notification.permission === 'default')
        Notification.requestPermission();
}

function sonarAlarma() {
    try {
        if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        [0, 0.3, 0.6].forEach(t => {
            const osc = _audioCtx.createOscillator();
            const gain = _audioCtx.createGain();
            osc.connect(gain); gain.connect(_audioCtx.destination);
            osc.type = 'square';
            osc.frequency.setValueAtTime(880, _audioCtx.currentTime + t);
            gain.gain.setValueAtTime(0.4, _audioCtx.currentTime + t);
            gain.gain.exponentialRampToValueAtTime(0.001, _audioCtx.currentTime + t + 0.25);
            osc.start(_audioCtx.currentTime + t);
            osc.stop(_audioCtx.currentTime + t + 0.25);
        });
    } catch {}
}

function mostrarFlashAlerta(nombre) {
    // Eliminar flash previo si existe
    const prev = document.getElementById('sisdel-flash-alerta');
    if (prev) prev.remove();

    const flash = document.createElement('div');
    flash.id = 'sisdel-flash-alerta';
    flash.innerHTML = `
        <div style="position:fixed;inset:0;z-index:99999;pointer-events:none;display:flex;align-items:center;justify-content:center;background:rgba(255,59,59,.08);animation:flashBg 3s ease forwards;">
            <div style="display:flex;flex-direction:column;align-items:center;gap:1rem;animation:flashPop .4s cubic-bezier(.175,.885,.32,1.275);">
                <div style="width:180px;height:180px;border-radius:50%;background:rgba(255,59,59,.85);display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 0 rgba(255,59,59,.9);animation:flashRing 1s ease-out 3;font-size:4rem;">🚨</div>
                <div style="background:rgba(255,59,59,.9);color:#fff;font-size:1.4rem;font-weight:900;padding:.6rem 2rem;border-radius:14px;letter-spacing:3px;text-shadow:0 2px 6px rgba(0,0,0,.4);box-shadow:0 4px 24px rgba(255,59,59,.5);">⚠️ NUEVA ALERTA</div>
                <div style="color:#fff;font-size:1rem;font-weight:700;background:rgba(0,0,0,.45);padding:.35rem 1rem;border-radius:8px;">${nombre}</div>
            </div>
        </div>`;
    document.body.appendChild(flash);

    // Auto-remove after 3s
    setTimeout(() => flash.remove(), 3000);

    // Inject keyframes once
    if (!document.getElementById('sisdel-flash-style')) {
        const s = document.createElement('style');
        s.id = 'sisdel-flash-style';
        s.textContent = `
            @keyframes flashRing {
                0%   { box-shadow: 0 0 0 0 rgba(255,59,59,.9); }
                70%  { box-shadow: 0 0 0 60px rgba(255,59,59,0); }
                100% { box-shadow: 0 0 0 0 rgba(255,59,59,0); }
            }
            @keyframes flashPop {
                0%   { transform: scale(0); opacity: 0; }
                70%  { transform: scale(1.08); }
                100% { transform: scale(1); opacity: 1; }
            }
            @keyframes flashBg {
                0%   { background: rgba(255,59,59,.12); }
                100% { background: rgba(255,59,59,0); }
            }`;
        document.head.appendChild(s);
    }
}

function notificarNuevaEmergencia(nombre) {
    sonarAlarma();
    mostrarFlashAlerta(nombre);
    let n = 0, orig = document.title;
    const iv = setInterval(() => {
        document.title = n++ % 2 === 0 ? '🚨 ¡NUEVA ALERTA!' : orig;
        if (n >= 12) { clearInterval(iv); document.title = orig; }
    }, 500);
    if ('Notification' in window && Notification.permission === 'granted')
        new Notification('🚨 ALERTA DE PÁNICO', { body: nombre, icon: '/favicon.ico' });
}

function setConexion(ok) {
    const el = document.getElementById('conexion-status');
    if (!el) return;
    el.textContent = ok ? '🟢 Conectado' : '🔴 Sin conexión';
    el.style.color  = ok ? '#00d68f' : '#ff3b3b';
}

// ── ALERTAS ───────────────────────────────────────
async function cargarAlertas() {
    try {
        const res = await fetch(`${API}/api/emergencias/${INST.id_institucion}`);
        const alertas = await res.json();

        // Detectar nuevas ACTIVAS no vistas antes
        const nuevas = alertas.filter(a => a.estatus === 'ACTIVA' && !_alertasVistas.has(a.id_emergencia));
        if (nuevas.length > 0 && _alertasVistas.size > 0) {
            nuevas.forEach(a => notificarNuevaEmergencia(a.nombre_vecino));
        }
        alertas.forEach(a => _alertasVistas.add(a.id_emergencia));

        renderAlertas(alertas);
        alertas.forEach(ponerMarcador);
        actualizarStats(alertas);
        setConexion(true);
    } catch { setConexion(false); }
}

function actualizarStats(alertas) {
    document.getElementById('sp-activas').textContent = alertas.filter(a=>a.estatus==='ACTIVA').length;
    document.getElementById('sp-camino').textContent  = alertas.filter(a=>a.estatus==='EN_CAMINO').length;
    document.getElementById('sp-atend').textContent   = alertas.filter(a=>a.estatus==='ATENDIDA').length;
}

function setFiltro(f,btn) {
    filtro=f;
    document.querySelectorAll('.ftab').forEach(t=>t.classList.remove('active'));
    btn.classList.add('active');
    cargarAlertas();
}

function renderAlertas(alertas) {
    // Filtrar: alertas ATENDIDA y FALSA_ALARMA van al historial, no a la tabla principal
    const activas = alertas.filter(a => a.estatus === 'ACTIVA' || a.estatus === 'EN_CAMINO');
    let lista = filtro === 'todas' ? activas : activas.filter(a => a.estatus === filtro);
    const tbody = document.getElementById('alertas-tbody');

    if (!lista.length) {
        tbody.innerHTML=`<tr><td colspan="9"><div class="empty-state"><span style="font-size:2rem">🛡️</span><p>Sin emergencias ${filtro!=='todas'?'con este estado':''}</p></div></td></tr>`;
        return;
    }

    tbody.innerHTML = lista.map((a,i) => {
        const rowCls = a.estatus==='ACTIVA'?'row-activa':a.estatus==='EN_CAMINO'?'row-camino':a.estatus==='ATENDIDA'?'row-atendida':'';
        const tz   = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const hora = new Date(a.fecha_creacion + 'Z').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz });
        const gps    = a.gps_latitud ? `${a.gps_latitud.toFixed(4)},${a.gps_longitud.toFixed(4)}` : '—';
        const locUrl = a.gps_latitud ? `https://maps.google.com/?q=${a.gps_latitud},${a.gps_longitud}` : 'Sin GPS';
        const vecNombre = (a.nombre_vecino || '').replace(/'/g,"\\'").replace(/"/g,"&quot;");

        return `<tr class="${rowCls}">
            <td><span style="font-family:monospace; color:#4da6ff; font-weight:700; font-size:.75rem;">${a.numero_caso || (i+1)}</span></td>
            <td><span class="badge badge-${a.estatus}">${a.estatus.replace('_',' ')}</span></td>
            <td><strong>${a.nombre_vecino}</strong></td>
            <td>${a.telefono_vecino}</td>
            <td>${a.num_identificacion}</td>
            <td>${a.direccion_vecino||a.direccion_aproximada||'—'}</td>
            <td style="font-family:monospace;font-size:.72rem">${gps}</td>
            <td style="font-size:.72rem">${hora}</td>
            <td>
                <div style="display:flex; gap:.35rem; align-items:center;">
                    <button class="btn-ver" onclick="verDet('${a.id_emergencia}')" title="Detalle completo">👁️ Ver</button>
                    ${a.gps_latitud ? `<button class="btn-ver" style="color:#00d68f; background:rgba(0,214,143,.12); border-color:rgba(0,214,143,.3);" onclick="verMapaRapido(${a.gps_latitud}, ${a.gps_longitud})" title="Ver en mapa">🗺️ Mapa</button>` : ''}
                    <button class="btn-ver" style="color:#ff8c00; background:rgba(255,140,0,.12); border-color:rgba(255,140,0,.3);" onclick="avisarFamiliares('${a.id_vecino}', '${vecNombre}', '${locUrl}')" title="Avisar a familiares">💬 Avisar</button>
                </div>
            </td>
        </tr>`;
    }).join('');
}

// ── DETALLE ───────────────────────────────────────
let _detTimerInterval = null;
let _agentesAsignados = [];  // lista de agentes asignados a la alerta actual
let _slotsAsignados = {};    // {1: {doc, nombre, ...}, 2: {...}, ...}

async function verDet(id) {
    try {
        const res = await fetch(`${API}/api/emergencias/${INST.id_institucion}`);
        const lista = await res.json();
        alertaActual = lista.find(a=>a.id_emergencia===id);
    } catch { return; }
    if (!alertaActual) return;
    const a = alertaActual;
    const mUrl = a.gps_latitud ? `https://maps.google.com/?q=${a.gps_latitud},${a.gps_longitud}` : null;

    // Limpiar agentes asignados al abrir nueva alerta
    _agentesAsignados = [];
    _slotsAsignados = {};

    document.getElementById('det-body').innerHTML = `
    <div class="det-grid">
        <div class="det-item"><div class="det-label">Vecino</div><div class="det-val">👤 ${a.nombre_vecino}</div></div>
        <div class="det-item"><div class="det-label">Teléfono</div><div class="det-val">📱 ${a.telefono_vecino}</div></div>
        <div class="det-item"><div class="det-label">Identificación</div><div class="det-val">🪪 ${a.num_identificacion}</div></div>
        <div class="det-item"><div class="det-label">Estado</div><div class="det-val"><span class="badge badge-${a.estatus}">${a.estatus.replace('_',' ')}</span></div></div>
        <div class="det-item det-full"><div class="det-label">Dirección</div><div class="det-val">${a.direccion_vecino||'—'} ${a.direccion_aproximada||''}</div></div>
        <div class="det-item det-full">
            <div class="det-label">Coordenadas GPS</div>
            <div class="det-val">📍 ${a.gps_latitud?`${a.gps_latitud.toFixed(6)}, ${a.gps_longitud.toFixed(6)}`:'No disponible'}</div>
            ${mUrl?`<a class="map-link" href="${mUrl}" target="_blank">🗺️ Abrir en Google Maps</a>`:''}
        </div>
        <div class="det-item"><div class="det-label">Fecha / Hora</div><div class="det-val">${new Date(a.fecha_creacion + 'Z').toLocaleString([], { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })}</div></div>
        ${a.notas_operador?`<div class="det-item"><div class="det-label">Notas</div><div class="det-val">${a.notas_operador}</div></div>`:''}
    </div>

    <!-- Reloj de Tiempo de Respuesta -->
    <div style="margin-top:1rem; padding:.6rem 1rem; background:rgba(255,59,59,.06); border:1px solid rgba(255,59,59,.25); border-radius:10px; display:flex; justify-content:space-between; align-items:center;">
        <div>
            <div style="font-size:.7rem; color:#ff3b3b; text-transform:uppercase; font-weight:700; letter-spacing:.5px;">⏱️ TIEMPO DE RESPUESTA</div>
        </div>
        <div id="det-timer" style="font-family:monospace; font-size:1.4rem; font-weight:900; color:#ff3b3b; letter-spacing:2px;">00:00:00</div>
    </div>

    <!-- Asignación de Agentes (4 slots) -->
    <div style="margin-top:1rem; padding:.8rem; background:rgba(255,165,0,.06); border:1px solid rgba(255,165,0,.2); border-radius:10px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:.7rem;">
            <div class="det-label" style="color:#ffa500; font-weight:700;">👮 ASIGNACIÓN DE AGENTES</div>
            <div style="font-family:monospace; font-size:.9rem; font-weight:900; color:#4da6ff; background:rgba(77,166,255,.1); padding:.2rem .6rem; border-radius:6px; border:1px solid rgba(77,166,255,.3);">📋 CASO ${a.numero_caso || '—'}</div>
        </div>
        ${[1,2,3,4].map(s => `
        <div id="slot-${s}" style="margin-bottom:.4rem; padding:.4rem .6rem; background:#0b0d17; border:1px solid #2a2d45; border-radius:8px; display:flex; align-items:center; gap:.4rem; position:relative;">
            <span style="background:rgba(255,165,0,.2); color:#ffa500; width:22px; height:22px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:.65rem; font-weight:900; flex-shrink:0;">${s}</span>
            <div id="slot-${s}-info" style="flex:1; display:none;">
                <div style="font-weight:700; color:#00d68f; font-size:.78rem;" id="slot-${s}-nombre"></div>
                <div style="font-size:.62rem; color:#6b7294;" id="slot-${s}-detalle"></div>
            </div>
            <input type="text" id="slot-${s}-buscar" placeholder="Buscar agente..."
                   oninput="buscarParaSlot(${s}, this.value)"
                   style="flex:1; background:transparent; border:none; color:#fff; font-size:.78rem; outline:none;">
            <div id="slot-${s}-resultados" style="display:none; position:absolute; top:100%; left:0; right:0; margin-top:2px; background:#111325; border:1px solid #2a2d45; border-radius:8px; max-height:160px; overflow-y:auto; z-index:999; box-shadow:0 8px 24px rgba(0,0,0,.5);"></div>
        </div>
        `).join('')}
    </div>`;

    // Iniciar reloj de respuesta
    iniciarTimerRespuesta(a);

    // Cargar asignaciones existentes desde BD
    cargarAsignacionesExistentes(a.id_emergencia);

    document.getElementById('modal-det').style.display='flex';
    if (mapaL && a.gps_latitud) { mapaL.setView([a.gps_latitud,a.gps_longitud],16); if(marcadores[id]) marcadores[id].openPopup(); }
}

function iniciarTimerRespuesta(alerta) {
    if (_detTimerInterval) clearInterval(_detTimerInterval);
    const inicio = new Date(alerta.fecha_creacion + 'Z').getTime();

    // Check if it's already solved
    if (alerta.estatus === 'ATENDIDA' || alerta.estatus === 'FALSA_ALARMA' || alerta.estatus === 'CANCELADA') {
        const att = alerta.fecha_atencion || alerta.fecha_actualizacion;
        let diff = 0;
        if (att) {
            const atendido = new Date(att + (!att.endsWith('Z') ? 'Z' : '')).getTime();
            diff = atendido - inicio;
        } else {
            diff = Date.now() - inicio; 
        }
        
        const el = document.getElementById('det-timer');
        if (!el) return;
        const h = Math.floor(diff / 3600000);
        const m = Math.floor((diff % 3600000) / 60000);
        const s = Math.floor((diff % 60000) / 1000);
        el.textContent = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
        el.style.color = '#00d68f';
        el.parentElement.style.background = 'rgba(0,214,143,.06)';
        el.parentElement.style.borderColor = 'rgba(0,214,143,.25)';
        return;
    }

    const tick = () => {
        const el = document.getElementById('det-timer');
        if (!el) { clearInterval(_detTimerInterval); return; }
        const diff = Date.now() - inicio;
        const h = Math.floor(diff / 3600000);
        const m = Math.floor((diff % 3600000) / 60000);
        const s = Math.floor((diff % 60000) / 1000);
        el.textContent = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;

        // Color según tiempo: verde <5min, amarillo 5-15min, rojo >15min
        const mins = diff / 60000;
        if (mins < 5) { el.style.color = '#00d68f'; }
        else if (mins < 15) { el.style.color = '#ffa500'; }
        else { el.style.color = '#ff3b3b'; }
    };
    tick();
    _detTimerInterval = setInterval(tick, 1000);
}

function renderAgentesAsignados() {
    const el = document.getElementById('det-agentes-lista');
    if (!el) return;
    if (!_agentesAsignados.length) {
        el.innerHTML = '<div style="padding:.4rem; color:#6b7294; font-size:.75rem; text-align:center;">Sin agentes asignados aún</div>';
        return;
    }
    el.innerHTML = _agentesAsignados.map((ag, i) => `
        <div style="padding:.4rem .6rem; background:rgba(0,214,143,.08); border:1px solid rgba(0,214,143,.2); border-radius:8px; margin-bottom:.4rem; display:flex; justify-content:space-between; align-items:center;">
            <div style="display:flex; align-items:center; gap:.4rem;">
                <span style="background:#00d68f; color:#0b0d17; width:20px; height:20px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:.65rem; font-weight:900;">${i+1}</span>
                <div>
                    <div style="font-weight:700; color:#00d68f; font-size:.8rem;">${ag.nombre}</div>
                    <div style="font-size:.65rem; color:#6b7294;">Doc: ${ag.doc} | ${ag.puesto}</div>
                </div>
            </div>
            <div style="text-align:right;">
                <div style="font-family:monospace; color:#ffa500; font-weight:700; font-size:.78rem;">${ag.codigo}</div>
                <div style="font-size:.65rem; color:#6b7294;">📱 ${ag.telefono}</div>
            </div>
        </div>
    `).join('');
}

function closeDet(e) {
    if (e && e.target!==document.getElementById('modal-det')) return;
    if (_detTimerInterval) { clearInterval(_detTimerInterval); _detTimerInterval = null; }
    document.getElementById('modal-det').style.display='none'; alertaActual=null;
}
async function cambiarEstatus(estatus) {
    if (!alertaActual) return;
    try {
        // Guardar asignaciones de agentes pendientes
        for (const slot of Object.keys(_slotsAsignados)) {
            const ag = _slotsAsignados[slot];
            await fetch(`${API}/api/agentes/asignar`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id_emergencia: alertaActual.id_emergencia,
                    id_institucion: INST.id_institucion,
                    num_identificacion: ag.doc,
                    slot: parseInt(slot)
                })
            });
        }
        // Cambiar estatus
        await fetch(`${API}/api/emergencias/${alertaActual.id_emergencia}/estatus`,{
            method:'PATCH', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({estatus})
        });
        closeDet(); await cargarAlertas();
    } catch { alert('Error al actualizar.'); }
}

// ── VECINOS ───────────────────────────────────────
let _vecinosCache = [];
async function cargarVecinos() {
    try {
        const res = await fetch(`${API}/api/vecinos/${INST.id_institucion}`);
        const vec = await res.json();
        _vecinosCache = vec;
        document.getElementById('sp-vec').textContent = vec.length;
        const tbody = document.getElementById('vecinos-tbody');
        if (tbody) {
            if (!vec.length) { tbody.innerHTML=`<tr><td colspan="6"><div class="empty-state"><p>Sin vecinos registrados</p></div></td></tr>`; return; }
            tbody.innerHTML = vec.map((v,i)=>`
                <tr>
                    <td>${i+1}</td>
                    <td><strong>${v.nombre}</strong></td>
                    <td>${v.telefono}</td>
                    <td>${v.num_identificacion}</td>
                    <td>${v.direccion||'—'}</td>
                    <td style="font-size:.72rem">${new Date(v.fecha_registro + 'Z').toLocaleDateString([], { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })}</td>
                </tr>`).join('');
        }
    } catch { }
}

// ── BÚSQUEDA RÁPIDA EN PANEL ──────────────────────
async function buscarVecinoPanel(texto) {
    const container = document.getElementById('panel-busqueda-resultados');
    if (!container) return;

    texto = texto.trim().toLowerCase();
    if (texto.length < 2) {
        container.style.display = 'none';
        container.innerHTML = '';
        return;
    }

    // Usar caché o cargar
    if (!_vecinosCache.length) {
        try {
            const res = await fetch(`${API}/api/vecinos/${INST.id_institucion}`);
            _vecinosCache = await res.json();
        } catch { return; }
    }

    const resultados = _vecinosCache.filter(v => {
        const nombre = (v.nombre || '').toLowerCase();
        const tel = (v.telefono || '').toLowerCase();
        const doc = (v.num_identificacion || '').toLowerCase();
        return nombre.includes(texto) || tel.includes(texto) || doc.includes(texto);
    });

    if (!resultados.length) {
        container.innerHTML = '<div style="padding:.7rem 1rem; color:#6b7294; font-size:.8rem;">No se encontró ningún vecino</div>';
        container.style.display = 'block';
        return;
    }

    container.innerHTML = resultados.slice(0, 8).map(v => `
        <div onclick="document.getElementById('panel-busqueda').value=''; document.getElementById('panel-busqueda-resultados').style.display='none';"
             style="padding:.55rem 1rem; cursor:pointer; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #1a1f3e; transition:background .2s;"
             onmouseover="this.style.background='rgba(77,166,255,.1)'" onmouseout="this.style.background='transparent'">
            <div>
                <span style="font-weight:700; color:#fff; font-size:.82rem;">${v.nombre}</span>
                <span style="color:#6b7294; font-size:.72rem; margin-left:.4rem;">Doc: ${v.num_identificacion}</span>
            </div>
            <div style="text-align:right;">
                <span style="font-family:monospace; color:#7c5cfc; font-size:.78rem;">${v.telefono}</span>
                <div style="font-size:.65rem; color:#6b7294;">${v.direccion || '—'}</div>
            </div>
        </div>
    `).join('');
    container.style.display = 'block';
}

// Cerrar resultados al hacer clic fuera
document.addEventListener('click', (e) => {
    const container = document.getElementById('panel-busqueda-resultados');
    const input = document.getElementById('panel-busqueda');
    if (container && input && !container.contains(e.target) && e.target !== input) {
        container.style.display = 'none';
    }
});

// ── HISTORIAL ─────────────────────────────────────
let _historialAlertas = [];

async function abrirHistorial() {
    document.getElementById('historial-busqueda').value = '';
    document.getElementById('historial-tbody').innerHTML = '<tr><td colspan="8" style="text-align:center; padding:2rem; color:#6b7294;">Cargando...</td></tr>';
    document.getElementById('modal-historial').style.display = 'flex';

    try {
        const res = await fetch(`${API}/api/emergencias/${INST.id_institucion}`);
        const todas = await res.json();
        _historialAlertas = todas.filter(a => a.estatus === 'ATENDIDA' || a.estatus === 'FALSA_ALARMA');
        renderHistorial(_historialAlertas);
    } catch {
        document.getElementById('historial-tbody').innerHTML = '<tr><td colspan="8" style="text-align:center; color:#ff3b3b; padding:1rem;">Error al cargar historial</td></tr>';
    }
}

function cerrarHistorial(e) {
    if (e && e.target !== document.getElementById('modal-historial')) return;
    document.getElementById('modal-historial').style.display = 'none';
}

function filtrarHistorial(texto) {
    texto = texto.trim().toLowerCase();
    if (texto.length < 2) {
        renderHistorial(_historialAlertas);
        return;
    }
    const filtrados = _historialAlertas.filter(a => {
        return (a.nombre_vecino || '').toLowerCase().includes(texto)
            || (a.telefono_vecino || '').toLowerCase().includes(texto)
            || (a.num_identificacion || '').toLowerCase().includes(texto);
    });
    renderHistorial(filtrados);
}

function renderHistorial(lista) {
    const tbody = document.getElementById('historial-tbody');
    const countEl = document.getElementById('historial-count');
    if (countEl) countEl.textContent = `${lista.length} registro${lista.length !== 1 ? 's' : ''}`;

    if (!lista.length) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:2rem; color:#6b7294;">No se encontraron alertas</td></tr>';
        return;
    }

    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    tbody.innerHTML = lista.map((a, i) => {
        const badgeColor = a.estatus === 'ATENDIDA' ? 'background:rgba(0,214,143,.15);color:#00d68f;border:1px solid rgba(0,214,143,.3);' : 'background:rgba(255,59,59,.15);color:#ff3b3b;border:1px solid rgba(255,59,59,.3);';
        const fechaStr = new Date(a.fecha_creacion + 'Z').toLocaleString([], {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz
        });

        // Calcular tiempo de respuesta
        let tiempoResp = '—';
        let tiempoColor = '#6b7294';
        if (a.fecha_atencion && a.fecha_creacion) {
            const inicio = new Date(a.fecha_creacion + 'Z').getTime();
            const fin = new Date(a.fecha_atencion + 'Z').getTime();
            const diff = fin - inicio;
            if (diff > 0) {
                const h = Math.floor(diff / 3600000);
                const m = Math.floor((diff % 3600000) / 60000);
                const s = Math.floor((diff % 60000) / 1000);
                tiempoResp = h > 0 ? `${h}h ${m}m ${s}s` : m > 0 ? `${m}m ${s}s` : `${s}s`;
                const mins = diff / 60000;
                tiempoColor = mins < 5 ? '#00d68f' : mins < 15 ? '#ffa500' : '#ff3b3b';
            }
        }

        return `<tr style="border-bottom:1px solid #1a1f3e; ${i % 2 === 0 ? 'background:rgba(30,35,70,.3)' : ''}">
            <td style="padding:.5rem .7rem;"><span style="font-family:monospace; color:#4da6ff; font-weight:700; font-size:.72rem;">${a.numero_caso || (i + 1)}</span></td>
            <td style="padding:.5rem .7rem;"><span style="${badgeColor} padding:.2rem .5rem; border-radius:6px; font-size:.7rem; font-weight:700;">${a.estatus.replace('_', ' ')}</span></td>
            <td style="padding:.5rem .7rem; font-weight:600;">${a.nombre_vecino}</td>
            <td style="padding:.5rem .7rem;">${a.telefono_vecino}</td>
            <td style="padding:.5rem .7rem; font-family:monospace; color:#7c5cfc;">${a.num_identificacion}</td>
            <td style="padding:.5rem .7rem; font-size:.72rem;">${fechaStr}</td>
            <td style="padding:.5rem .7rem; font-family:monospace; font-weight:700; color:${tiempoColor}; font-size:.78rem;">${tiempoResp}</td>
            <td style="padding:.5rem .7rem;">
                <button onclick="cerrarHistorial(); setTimeout(()=>verDet('${a.id_emergencia}'),200);"
                    style="background:rgba(77,166,255,.12); border:1px solid rgba(77,166,255,.3); color:#4da6ff; padding:.2rem .5rem; border-radius:6px; font-size:.68rem; font-weight:700; cursor:pointer;">
                    👁️ Ver
                </button>
            </td>
        </tr>`;
    }).join('');
}

// ── CLAVES ────────────────────────────────────────
function abrirClaves() {
    const base = window.location.origin + window.location.pathname.replace('panel.html','');
    const link = `${base}vecino.html?inst=${INST.id_institucion}`;
    document.getElementById('link-vecino-val').textContent = link;
    document.getElementById('clave-box').style.display='none';
    document.getElementById('modal-claves').style.display='flex';
    cargarClaves();
}
function closeClaves(e) {
    if (e && e.target!==document.getElementById('modal-claves')) return;
    document.getElementById('modal-claves').style.display='none';
}
function copiarLink() {
    const v = document.getElementById('link-vecino-val').textContent;
    navigator.clipboard.writeText(v).catch(()=>prompt('Copie:',v));
}

async function generarClave() {
    const desc = document.getElementById('clave-desc').value.trim();
    try {
        const res = await fetch(`${API}/api/vecinos/claves`,{
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({id_institucion:INST.id_institucion, descripcion:desc})
        });
        const c = await res.json();
        document.getElementById('clave-val').textContent = c.clave;
        document.getElementById('clave-box').style.display='block';
        document.getElementById('clave-desc').value='';
        await cargarClaves();
    } catch { alert('Error al generar clave.'); }
}
function copiarClave() {
    const v = document.getElementById('clave-val').textContent;
    navigator.clipboard.writeText(v).catch(()=>prompt('Copie:',v));
}

async function cargarClaves() {
    try {
        const res = await fetch(`${API}/api/vecinos/claves/${INST.id_institucion}`);
        const claves = await res.json();
        const el = document.getElementById('claves-list');
        if (!claves.length) { el.innerHTML='<p style="color:#6b7294;font-size:.82rem;">No hay claves generadas aún.</p>'; return; }
        el.innerHTML = claves.map(c=>`
            <div class="clave-item">
                <span class="clave-code">${c.clave}</span>
                <span class="clave-desc">${c.descripcion||'Sin descripción'}</span>
                <span class="${c.usada?'badge-usada':'badge-libre'}">${c.usada?'Usada':'Libre'}</span>
                <button class="btn-del" onclick="eliminarClave(${c.id_clave})">🗑</button>
            </div>`).join('');
    } catch { document.getElementById('claves-list').innerHTML='<p style="color:#6b7294;font-size:.82rem;">Sin conexión.</p>'; }
}
async function eliminarClave(id) {
    if (!confirm('¿Eliminar clave?')) return;
    try { await fetch(`${API}/api/vecinos/claves/${id}`,{method:'DELETE'}); await cargarClaves(); }
    catch { alert('Error al eliminar.'); }
}

// ── AGENTES DE SEGURIDAD ──────────────────────────
let _agentesCache = [];

function abrirRegistroAgente() {
    document.getElementById('form-agente').reset();
    document.getElementById('ag-pais').value = 'Guatemala';
    document.getElementById('ag-codigo-box').style.display = 'none';
    document.getElementById('ag-lista').style.display = 'none';
    document.getElementById('modal-agente').style.display = 'flex';
}

function cerrarModalAgente(e) {
    if (e && e.target !== document.getElementById('modal-agente')) return;
    document.getElementById('modal-agente').style.display = 'none';
}

async function guardarAgente(e) {
    e.preventDefault();
    const btn = document.getElementById('ag-btn-guardar');
    btn.disabled = true;
    btn.textContent = '⏳ Guardando...';

    const data = {
        id_institucion: INST.id_institucion,
        num_identificacion: document.getElementById('ag-doc').value.trim(),
        nombre: document.getElementById('ag-nombre').value.trim().toUpperCase(),
        telefono: document.getElementById('ag-tel').value.trim(),
        edad: parseInt(document.getElementById('ag-edad').value) || 0,
        sexo: document.getElementById('ag-sexo').value,
        pais: document.getElementById('ag-pais').value.trim(),
        puesto: document.getElementById('ag-puesto').value.trim(),
        jefe_inmediato: document.getElementById('ag-jefe').value.trim()
    };

    try {
        const res = await fetch(`${API}/api/agentes/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || 'Error al guardar');
        }
        const agente = await res.json();

        // Mostrar código generado
        document.getElementById('ag-codigo-val').textContent = agente.codigo_agente;
        document.getElementById('ag-codigo-box').style.display = 'block';

        btn.textContent = '✅ Guardado';
        btn.style.background = 'linear-gradient(135deg,#00d68f,#00b877)';

        setTimeout(() => {
            btn.disabled = false;
            btn.textContent = '💾 Guardar Agente';
            btn.style.background = 'linear-gradient(135deg,#ffa500,#ff8c00)';
        }, 2000);

    } catch (err) {
        alert('Error: ' + err.message);
        btn.disabled = false;
        btn.textContent = '💾 Guardar Agente';
    }
}

async function verListaAgentes() {
    const listaDiv = document.getElementById('ag-lista');
    listaDiv.style.display = listaDiv.style.display === 'none' ? 'block' : 'none';
    if (listaDiv.style.display === 'none') return;

    document.getElementById('ag-lista-body').innerHTML = '<p style="color:#6b7294;font-size:.82rem;text-align:center;">Cargando...</p>';

    try {
        const res = await fetch(`${API}/api/agentes/lista/${INST.id_institucion}`);
        _agentesCache = await res.json();
        renderListaAgentes(_agentesCache);
    } catch {
        document.getElementById('ag-lista-body').innerHTML = '<p style="color:#ff3b3b;font-size:.82rem;">Error al cargar</p>';
    }
}

function filtrarAgentes(texto) {
    texto = texto.trim().toLowerCase();
    if (texto.length < 2) { renderListaAgentes(_agentesCache); return; }
    const filtrados = _agentesCache.filter(a => {
        return (a.nombre || '').toLowerCase().includes(texto)
            || (a.telefono || '').toLowerCase().includes(texto)
            || (a.num_identificacion || '').toLowerCase().includes(texto);
    });
    renderListaAgentes(filtrados);
}

function renderListaAgentes(lista) {
    const countEl = document.getElementById('ag-count');
    if (countEl) countEl.textContent = `(${lista.length})`;

    if (!lista.length) {
        document.getElementById('ag-lista-body').innerHTML = '<p style="color:#6b7294;font-size:.82rem;text-align:center;">No se encontraron agentes</p>';
        return;
    }

    document.getElementById('ag-lista-body').innerHTML = lista.map(a => `
        <div style="padding:.5rem .7rem; border-bottom:1px solid #1a1f3e; display:flex; justify-content:space-between; align-items:center;">
            <div>
                <div style="font-weight:700; color:#fff; font-size:.82rem;">${a.nombre}</div>
                <div style="font-size:.7rem; color:#6b7294;">Doc: ${a.num_identificacion} | ${a.puesto || 'Sin puesto'}</div>
            </div>
            <div style="text-align:right;">
                <div style="font-family:monospace; color:#ffa500; font-size:.8rem; font-weight:700;">${a.codigo_agente}</div>
                <div style="font-size:.68rem; color:#6b7294;">📱 ${a.telefono}</div>
            </div>
        </div>
    `).join('');
}

// ── ASIGNACIÓN DE AGENTES POR SLOT (1-4) ─────────

async function buscarParaSlot(slot, texto) {
    const container = document.getElementById(`slot-${slot}-resultados`);
    if (!container) return;

    texto = texto.trim().toLowerCase();
    if (texto.length < 2) {
        container.style.display = 'none';
        container.innerHTML = '';
        return;
    }

    // Cargar agentes si no están en caché
    if (!_agentesCache.length) {
        try {
            const res = await fetch(`${API}/api/agentes/lista/${INST.id_institucion}`);
            _agentesCache = await res.json();
        } catch { return; }
    }

    const resultados = _agentesCache.filter(a => {
        return (a.nombre || '').toLowerCase().includes(texto)
            || (a.num_identificacion || '').toLowerCase().includes(texto)
            || (a.telefono || '').toLowerCase().includes(texto);
    });

    if (!resultados.length) {
        container.innerHTML = '<div style="padding:.5rem .7rem; color:#6b7294; font-size:.75rem;">No encontrado</div>';
        container.style.display = 'block';
        return;
    }

    container.innerHTML = resultados.slice(0, 5).map(ag => `
        <div onclick="asignarEnSlot(${slot}, '${ag.nombre}', '${ag.telefono}', '${ag.num_identificacion}', '${ag.puesto || ''}', '${ag.codigo_agente}')"
             style="padding:.4rem .7rem; cursor:pointer; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #1a1f3e; transition:background .15s;"
             onmouseover="this.style.background='rgba(255,165,0,.1)'" onmouseout="this.style.background='transparent'">
            <div>
                <span style="font-weight:700; color:#fff; font-size:.75rem;">${ag.nombre}</span>
                <span style="font-size:.62rem; color:#6b7294; margin-left:.2rem;">${ag.puesto || ''}</span>
            </div>
            <span style="font-family:monospace; color:#ffa500; font-size:.7rem; font-weight:700;">${ag.codigo_agente}</span>
        </div>
    `).join('');
    container.style.display = 'block';
}

async function asignarEnSlot(slot, nombre, telefono, doc, puesto, codigo) {
    // Ocultar resultados
    const container = document.getElementById(`slot-${slot}-resultados`);
    const input = document.getElementById(`slot-${slot}-buscar`);
    if (container) container.style.display = 'none';
    if (input) input.style.display = 'none';

    // Guardar en memoria para persistir al cambiar estatus
    _slotsAsignados[slot] = { nombre, telefono, doc, puesto, codigo };

    // Mostrar info del agente en el slot
    const info = document.getElementById(`slot-${slot}-info`);
    const nombreEl = document.getElementById(`slot-${slot}-nombre`);
    const detalleEl = document.getElementById(`slot-${slot}-detalle`);
    if (info && nombreEl && detalleEl) {
        info.style.display = 'block';
        nombreEl.textContent = `✅ ${nombre}`;
        detalleEl.textContent = `${codigo} | 📱 ${telefono} | ${puesto}`;
    }

    // Cambiar borde a verde
    const slotDiv = document.getElementById(`slot-${slot}`);
    if (slotDiv) slotDiv.style.borderColor = 'rgba(0,214,143,.4)';

    // Persistir en backend inmediatamente también
    if (!alertaActual) return;
    try {
        await fetch(`${API}/api/agentes/asignar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id_emergencia: alertaActual.id_emergencia,
                id_institucion: INST.id_institucion,
                num_identificacion: doc,
                slot: slot
            })
        });
    } catch (err) {
        console.error('Error al asignar agente:', err);
    }
}

async function cargarAsignacionesExistentes(idEmergencia) {
    try {
        const res = await fetch(`${API}/api/agentes/asignaciones/${idEmergencia}`);
        if (!res.ok) return;
        const asignaciones = await res.json();
        for (const a of asignaciones) {
            const input = document.getElementById(`slot-${a.slot}-buscar`);
            const info = document.getElementById(`slot-${a.slot}-info`);
            const nombreEl = document.getElementById(`slot-${a.slot}-nombre`);
            const detalleEl = document.getElementById(`slot-${a.slot}-detalle`);
            const slotDiv = document.getElementById(`slot-${a.slot}`);
            if (input) input.style.display = 'none';
            if (info && nombreEl && detalleEl) {
                info.style.display = 'block';
                nombreEl.textContent = `✅ ${a.nombre}`;
                detalleEl.textContent = `${a.codigo_agente} | 📱 ${a.telefono} | ${a.puesto}`;
            }
            if (slotDiv) slotDiv.style.borderColor = 'rgba(0,214,143,.4)';
        }
    } catch (err) {
        console.error('Error cargando asignaciones:', err);
    }
}

async function guardarAsignaciones() {
    if (!alertaActual) return;
    const slots = Object.keys(_slotsAsignados);
    if (!slots.length) {
        alert('No hay agentes nuevos para guardar');
        return;
    }
    try {
        for (const slot of slots) {
            const ag = _slotsAsignados[slot];
            await fetch(`${API}/api/agentes/asignar`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id_emergencia: alertaActual.id_emergencia,
                    id_institucion: INST.id_institucion,
                    num_identificacion: ag.doc,
                    slot: parseInt(slot)
                })
            });
        }
        alert(`✅ ${slots.length} agente(s) guardado(s) correctamente`);
    } catch (err) {
        alert('Error al guardar asignaciones');
        console.error(err);
    }
}
