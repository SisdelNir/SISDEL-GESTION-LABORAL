/**
 * Vecino JS — Botón de Pánico SISDEL
 * Soporta: acceso con clave personal ó acceso directo con link (?inst=...)
 */

const API = (window.location.hostname === 'localhost' || window.location.protocol === 'file:') ? 'http://localhost:8000' : 'https://boton-de-panico-sisdel.onrender.com';  // Local o Render
let vecinoData   = null;   // datos del vecino
let instData     = null;   // datos de la institución (del URL o de la clave)
let gpsLat       = null;
let gpsLon       = null;
let holdInterval = null;
let holdProgress = 0;

// ── SINCRONIZACIÓN DE VOZ ──────────────────────
function sincronizarVozAlerta(voz) {
    if (!voz) return;
    const cfg = JSON.parse(localStorage.getItem('sisdel_config') || '{}');
    cfg.audioGrabado = voz;
    localStorage.setItem('sisdel_config', JSON.stringify(cfg));
    // Refrescar visibilidad del botón si el modal está abierto
    const btnEscuchar = document.getElementById('btn-escuchar');
    if (btnEscuchar) btnEscuchar.style.display = 'block';
}

// ── LADA / PAÍS ────────────────────────────────
function actualizarLada() {
    const codigo = document.getElementById('reg-pais')?.value || '502';
    const badge  = document.getElementById('lada-badge');
    if (badge) badge.textContent = '+' + codigo;
    document.querySelectorAll('.lada-fam').forEach(el => el.textContent = '+' + codigo);
}

function leerContactosFamiliares() {
    const codigo = document.getElementById('reg-pais')?.value || '502';
    const contactos = [];
    for (let i = 1; i <= 5; i++) {
        const nombre = document.getElementById(`fam-nombre-${i}`)?.value.trim() || '';
        const tel    = (document.getElementById(`fam-tel-${i}`)?.value || '').replace(/\D/g,'');
        if (tel) contactos.push({ nombre, telefono: codigo + tel });
    }
    return contactos;
}

function cargarContactosFamiliaresEnForm(contactos) {
    if (!contactos) return;
    for (let i = 0; i < 5; i++) {
        const c = contactos[i] || {};
        const nombreEl = document.getElementById(`fam-nombre-${i+1}`);
        const telEl    = document.getElementById(`fam-tel-${i+1}`);
        if (nombreEl) nombreEl.value = c.nombre || '';
        // Quitar lada del tel al mostrarlo en el campo
        if (telEl && c.telefono) {
            const codigo = document.getElementById('reg-pais')?.value || '502';
            telEl.value = c.telefono.replace(new RegExp('^' + codigo), '');
        }
    }
}
let modoVecinoLogin = false;  // true cuando vecino accede con su código
const HOLD_MS    = 3000;

// ── INIT ──────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    // Leer ?inst= del URL
    const params    = new URLSearchParams(window.location.search);
    const instId    = params.get('inst');
    const modoLink  = !!instId; // true = accedió por link
    const modoAdmin = params.get('admin') === '1'; // true = abierto desde panel admin

    // Intentar cargar datos de la institución para mostrar su nombre
    if (instId) {
        try {
            const res  = await fetch(`${API}/api/programador/instituciones`);
            const list = await res.json();
            instData   = list.find(i => i.id_institucion === instId) || null;
            if (instData) {
                document.getElementById('inst-nombre-label').textContent = instData.nombre_institucion;
            }
        } catch { /* sin servidor, continuar */ }
    }

    // Si es modo admin → ir directo al formulario de registro (nuevo vecino)
    if (modoAdmin && instId) {
        mostrarPaso('paso-registro');
        // Mostrar barra admin (búsqueda + botón Ver Vecinos) y botón X
        const adminTools = document.getElementById('admin-tools');
        if (adminTools) adminTools.style.display = 'flex';
        const btnX = document.getElementById('btn-cerrar-form');
        if (btnX) btnX.style.display = 'flex';
        return;
    }

    // Si es modo vecino → cargar datos e ir al botón de pánico
    const modoVecino = params.get('vecino') === '1';
    const numIdParam = params.get('numid');
    if (modoVecino && instId && numIdParam) {
        modoVecinoLogin = true;
        try {
            const res = await fetch(`${API}/api/vecinos/buscar/${instId}/${encodeURIComponent(numIdParam)}`);
            if (res.ok) {
                const v = await res.json();
                vecinoData = v;
                instData   = instData || { id_institucion: instId };
                sessionStorage.setItem('sisdel_vecino', JSON.stringify(vecinoData));
                mostrarPaso('paso-panico');
                iniciarPasoParanica();
            } else {
                mostrarPaso('paso-registro');
            }
        } catch {
            mostrarPaso('paso-registro');
        }
        return;
    }

    // Enter en clave
    document.getElementById('inp-clave').addEventListener('keydown', e => {
        if (e.key === 'Enter') validarClave();
    });

    // ¿Hay sesión previa guardada?
    const savedVecino = sessionStorage.getItem('sisdel_vecino');
    const savedInst   = sessionStorage.getItem('sisdel_vecino_inst');

    if (savedVecino) {
        vecinoData = JSON.parse(savedVecino);
        sincronizarVozAlerta(vecinoData.voz_alerta);
        if (savedInst) instData = JSON.parse(savedInst);
        mostrarPaso('paso-panico');
        iniciarPasoParanica();
        return;
    }

    // Si vino con link Y hay datos en localStorage → pre-cargar
    if (modoLink) {
        const localData = localStorage.getItem(`sisdel_vecino_${instId}`);
        if (localData) {
            vecinoData = JSON.parse(localData);
            sessionStorage.setItem('sisdel_vecino', JSON.stringify(vecinoData));
            mostrarPaso('paso-panico');
            iniciarPasoParanica();
        }
        // Si no hay datos locales → mostrar clave input con opción de saltar
    }
});

// ── PASOS ─────────────────────────────────────────
function mostrarPaso(id) {
    ['paso-clave','paso-registro','paso-panico'].forEach(p => {
        document.getElementById(p).style.display = p === id ? 'flex' : 'none';
    });
}
function mostrarError(elId, msg) {
    const el = document.getElementById(elId);
    el.textContent = msg; el.style.display = 'block';
    setTimeout(() => el.style.display='none', 4000);
}

// ── PASO 1A: CON CLAVE ────────────────────────────
async function validarClave() {
    const clave = document.getElementById('inp-clave').value.trim().toUpperCase();
    if (clave.length !== 6) { mostrarError('error-clave','La clave debe tener 6 caracteres'); return; }

    const btn = document.getElementById('btn-validar');
    btn.disabled = true; btn.textContent = 'Verificando...';

    const params = new URLSearchParams(window.location.search);
    const instId = params.get('inst') || null;

    try {
        const res  = await fetch(`${API}/api/vecinos/claves/validar`, {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ clave, id_institucion: instId })
        });
        const data = await res.json();

        if (data.valida) {
            sessionStorage.setItem('sisdel_clave_vecino', clave);
            // Guardar inst para scope de emergencias
            if (data.vecino) {
                // Ya registrado → ir directo a pánico
                vecinoData = data.vecino;
                sincronizarVozAlerta(vecinoData.voz_alerta);
                sessionStorage.setItem('sisdel_vecino', JSON.stringify(vecinoData));
                mostrarPaso('paso-panico');
                iniciarPasoParanica();
            } else {
                // Primera vez → formulario
                mostrarPaso('paso-registro');
            }
        } else {
            mostrarError('error-clave','Clave inválida. Solicítela al coordinador de su colonia.');
        }
    } catch {
        mostrarError('error-clave','Sin conexión. Intente con el link directo o más tarde.');
    } finally {
        btn.disabled = false; btn.textContent = 'Continuar →';
    }
}

// ── PASO 1B: ACCESO SOLO CON LINK ─────────────────
function accederSinClave() {
    const params = new URLSearchParams(window.location.search);
    const instId = params.get('inst');
    if (!instId) {
        mostrarError('error-clave','Este link no contiene un código de institución válido.');
        return;
    }
    mostrarPaso('paso-registro');
}

// ── PASO 2: REGISTRO ──────────────────────────────

// Auto-relleno al salir del campo de identificación
async function buscarVecinoPorId() {
    const numId = document.getElementById('reg-id').value.trim();
    const hintEl = document.getElementById('hint-id');
    if (!numId || numId.length < 2) { hintEl.style.display='none'; return; }

    const params = new URLSearchParams(window.location.search);
    const instId = params.get('inst') || (instData && instData.id_institucion) || '';
    if (!instId) return;

    try {
        const res = await fetch(`${API}/api/vecinos/buscar/${instId}/${encodeURIComponent(numId)}`);
        if (res.ok) {
            const v = await res.json();
            document.getElementById('reg-nombre').value   = v.nombre || '';
            document.getElementById('reg-telefono').value  = v.telefono || '';
            document.getElementById('reg-dir').value       = v.direccion || '';
            document.getElementById('reg-correo').value    = v.correo || '';
            document.getElementById('reg-sexo').value      = v.sexo || '';
            document.getElementById('reg-edad').value      = v.edad || '';
            hintEl.textContent = '✅ Vecino encontrado — datos auto-rellenados';
            hintEl.className = 'v-hint found';
            hintEl.style.display = 'block';
            // Guardar id_vecino para poder Modificar/Eliminar
            window._vecinoEditId = v.id_vecino;
            // ⭐ Cargar familiares: primero del objeto vecino (nuevo backend),
            // si no están disponibles, llamar al endpoint /contactos (backend viejo)
            const contactosDelVecino = [];
            for (let i = 1; i <= 5; i++) {
                const tel = (v[`fam_tel_${i}`] || '').trim();
                if (tel) contactosDelVecino.push({ nombre: v[`fam_nombre_${i}`] || '', telefono: tel });
            }
            if (contactosDelVecino.length > 0) {
                // Nuevo backend: datos vienen en el objeto vecino
                sincronizarVozAlerta(v.voz_alerta);
                cargarContactosFamiliaresEnForm(contactosDelVecino);
                sessionStorage.setItem('sisdel_familiares', JSON.stringify(contactosDelVecino));
            } else if (v.id_vecino) {
                // Viejo backend: pedir los contactos por separado
                fetch(`${API}/api/vecinos/${v.id_vecino}/contactos`)
                    .then(r => r.ok ? r.json() : [])
                    .then(contactos => {
                        if (Array.isArray(contactos) && contactos.length) {
                            cargarContactosFamiliaresEnForm(contactos);
                            sessionStorage.setItem('sisdel_familiares', JSON.stringify(contactos));
                        }
                    }).catch(() => {});
            }
            // Mostrar botones si es admin
            const modoAdmin = new URLSearchParams(window.location.search).get('admin') === '1';
            if (modoAdmin) {
                document.getElementById('btn-guardar')?.setAttribute('style','flex:2;display:none');
                document.getElementById('btn-modificar')?.style.setProperty('display','inline-flex');
                document.getElementById('btn-eliminar')?.style.setProperty('display','inline-flex');
            }
        } else {
            hintEl.textContent = 'Nuevo vecino — complete todos los campos';
            hintEl.className = 'v-hint notfound';
            hintEl.style.display = 'block';
            window._vecinoEditId = null;
            // Limpiar campos de contactos
            for (let i = 1; i <= 5; i++) {
                const n = document.getElementById(`fam-nombre-${i}`);
                const t = document.getElementById(`fam-tel-${i}`);
                if (n) n.value = '';
                if (t) t.value = '';
            }
            // Restaurar botón guardar
            document.getElementById('btn-guardar')?.removeAttribute('style');
            document.getElementById('btn-modificar')?.style.setProperty('display','none');
            document.getElementById('btn-eliminar')?.style.setProperty('display','none');
        }
    } catch {
        hintEl.style.display = 'none';
    }
}

async function registrarVecino() {
    const nombre   = document.getElementById('reg-nombre').value.trim();
    const telefono = document.getElementById('reg-telefono').value.trim();
    const numId    = document.getElementById('reg-id').value.trim();
    const dir      = document.getElementById('reg-dir').value.trim();
    const sexo     = document.getElementById('reg-sexo').value;
    const edad     = parseInt(document.getElementById('reg-edad').value) || 0;
    const correo   = document.getElementById('reg-correo').value.trim();
    const waNum    = (document.getElementById('reg-whatsapp')?.value || '').replace(/\D/g,'');

    if (!nombre || !telefono || !numId) {
        mostrarError('error-registro','Nombre, teléfono e identificación son obligatorios');
        return;
    }

    const params = new URLSearchParams(window.location.search);
    const instId = params.get('inst') || (instData && instData.id_institucion) || null;
    const clave  = sessionStorage.getItem('sisdel_clave_vecino') || '';

    const payload = {
        id_institucion: instId || '',
        nombre, telefono, num_identificacion: numId,
        direccion: dir, sexo, edad, correo,
        clave_acceso: clave
    };
    // Incluir familiares directamente en el payload del vecino
    const contactosFam = leerContactosFamiliares();
    for (let i = 0; i < 5; i++) {
        const c = contactosFam[i] || {};
        payload[`fam_nombre_${i+1}`] = c.nombre   || '';
        payload[`fam_tel_${i+1}`]    = c.telefono || '';
    }
    // Guardar WhatsApp localmente (no se envía al backend)
    if (waNum) sessionStorage.setItem('sisdel_wa', waNum);

    try {
        const res = await fetch(`${API}/api/vecinos/registro`, {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            vecinoData = await res.json();
            sincronizarVozAlerta(vecinoData.voz_alerta);
        } else {
            const err = await res.json();
            // Pydantic devuelve detail como array de objetos
            let msg = 'Error al registrar';
            if (typeof err.detail === 'string') {
                msg = err.detail;
            } else if (Array.isArray(err.detail)) {
                msg = err.detail.map(e => e.msg || e.message || JSON.stringify(e)).join(', ');
            }
            mostrarError('error-registro', msg);
            return;
        }
    } catch {
        vecinoData = { nombre, telefono, num_identificacion: numId, direccion: dir,
                       sexo, edad, correo, id_institucion: instId, codigo_vecino: '' };
    }

    sessionStorage.setItem('sisdel_vecino', JSON.stringify(vecinoData));
    if (instId) localStorage.setItem(`sisdel_vecino_${instId}`, JSON.stringify(vecinoData));
    if (instData) sessionStorage.setItem('sisdel_vecino_inst', JSON.stringify(instData));

    // Guardar contactos en caché local (ya se enviaron en el payload al backend)
    const famCache = leerContactosFamiliares();
    if (famCache.length) {
        sessionStorage.setItem('sisdel_familiares', JSON.stringify(famCache));
        if (instId) localStorage.setItem(`sisdel_familiares_${instId}`, JSON.stringify(famCache));
    }

    // Si es vecino actualizando → volver al botón de pánico
    if (modoVecinoLogin) {
        mostrarPaso('paso-panico');
        iniciarPasoParanica();
        return;
    }

    // Mostrar código generado si existe (solo en primer registro)
    const codigo = vecinoData.codigo_vecino || '';
    if (codigo) {
        document.getElementById('codigo-generado-val').textContent = codigo;
        document.getElementById('codigo-generado-box').style.display = 'block';
        // Ocultar botón guardar
        const btnGuardar = document.querySelector('.btn-registrar');
        if (btnGuardar) btnGuardar.style.display = 'none';
    } else {
        mostrarPaso('paso-panico');
        iniciarPasoParanica();
    }
}

function continuarDespuesRegistro() {
    mostrarPaso('paso-panico');
    iniciarPasoParanica();
}

// ── GPS ENGINE v3 — ROBUSTO CON REINTENTOS ───────────────
let _gpsRetryTimer = null;
let _watchId = null;

function requestLocationPermission() {
    if (navigator.permissions) {
        navigator.permissions.query({ name: 'geolocation' }).then(result => {
            if (result.state === 'prompt') {
                navigator.geolocation.getCurrentPosition(() => {}, () => {}, { enableHighAccuracy: false });
            } else if (result.state === 'denied') {
                alert('⚠️ IMPORTANTE: Activa la ubicación en los ajustes de tu teléfono para que el botón de pánico pueda enviar tus coordenadas reales a la central.');
            }
        }).catch(() => {
            navigator.geolocation.getCurrentPosition(() => {}, () => {}, { enableHighAccuracy: false });
        });
    } else {
        navigator.geolocation.getCurrentPosition(() => {}, () => {}, { enableHighAccuracy: false });
    }
}

function _actualizarBarraGPS(lat, lon, accuracy) {
    const statusEl = document.getElementById('gps-status');
    const dot      = document.getElementById('gps-dot');
    if (!statusEl || !dot) return;
    const acc = accuracy ? ` (±${Math.round(accuracy)}m)` : '';
    statusEl.textContent = `📍 ${lat.toFixed(5)}, ${lon.toFixed(5)}${acc}`;
    dot.style.background = '#00d68f';
}

function _errorBarraGPS(msg) {
    const statusEl = document.getElementById('gps-status');
    const dot      = document.getElementById('gps-dot');
    if (!statusEl || !dot) return;
    statusEl.textContent = msg;
    dot.style.background = '#ff8c00';
}

function ensureLocation() {
    return new Promise((resolve) => {
        // Ya tenemos coordenadas -> resolver inmediatamente
        if (gpsLat !== null && gpsLon !== null) {
            return resolve();
        }

        // Intento directo SIN caché y SIN alta precisión (usa WiFi/celular, funciona bajo techo)
        navigator.geolocation.getCurrentPosition(
            pos => {
                gpsLat = pos.coords.latitude;
                gpsLon = pos.coords.longitude;
                _actualizarBarraGPS(gpsLat, gpsLon, pos.coords.accuracy);
                resolve();
            },
            () => {
                // Último recurso: esperar hasta 6 segundos a que watchPosition capture algo
                let waited = 0;
                const poll = setInterval(() => {
                    waited += 500;
                    if (gpsLat !== null && gpsLon !== null) {
                        clearInterval(poll);
                        resolve();
                    } else if (waited >= 6000) {
                        clearInterval(poll);
                        console.warn('GPS: se agotó el tiempo máximo de espera');
                        resolve(); // enviar sin coordenadas como última opción
                    }
                }, 500);
            },
            { enableHighAccuracy: false, timeout: 8000, maximumAge: 0 }
        );
    });
}

// ── PASO 3: PÁNICO ────────────────────────────────
function iniciarPasoParanica() {
    if (!vecinoData) return;
    requestLocationPermission();
    document.getElementById('vecino-nombre-bar').textContent = vecinoData.nombre || 'Vecino';
    vecinoData.whatsapp_emergencia = sessionStorage.getItem('sisdel_wa') || vecinoData.whatsapp_emergencia || '';
    const yaEnSession = sessionStorage.getItem('sisdel_familiares');
    if (!yaEnSession && instData?.id_institucion) {
        const localFam = localStorage.getItem(`sisdel_familiares_${instData.id_institucion}`);
        if (localFam) sessionStorage.setItem('sisdel_familiares', localFam);
    }
    if (vecinoData.id_vecino && !sessionStorage.getItem('sisdel_familiares')) {
        fetch(`${API}/api/vecinos/${vecinoData.id_vecino}/contactos`)
            .then(r => r.ok ? r.json() : [])
            .then(contactos => {
                if (contactos.length) {
                    sessionStorage.setItem('sisdel_familiares', JSON.stringify(contactos));
                    mostrarBotonWAmasivo();
                }
            }).catch(() => {});
    } else if (sessionStorage.getItem('sisdel_familiares')) {
        mostrarBotonWAmasivo();
    }
    obtenerGPS();

    // ── AUTO-ACTIVAR funciones según config guardada ──
    const cfg = JSON.parse(localStorage.getItem('sisdel_config') || '{}');
    if (cfg.agitar) {
        // pequeño delay para que el DOM esté listo
        setTimeout(() => toggleShakeDetection(), 300);
    }
    if (cfg.voz) {
        const ind = document.getElementById('voz-indicador');
        if (ind) ind.style.display = 'block';
        setTimeout(() => iniciarEscuchaVoz(), 500);
    }
}

function obtenerGPS() {
    const statusEl = document.getElementById('gps-status');
    const dot      = document.getElementById('gps-dot');

    if (!navigator.geolocation) {
        if (statusEl) statusEl.textContent = '⚠️ GPS no soportado en este navegador.';
        if (dot) dot.style.background = '#ff3b3b';
        return;
    }

    if (statusEl) statusEl.textContent = '📡 Obteniendo ubicación...';
    if (dot) dot.style.background = '#ff8c00';

    // ═══ CAPA 1: Posición rápida (WiFi / antenas celulares) ═══
    navigator.geolocation.getCurrentPosition(
        pos => {
            gpsLat = pos.coords.latitude;
            gpsLon = pos.coords.longitude;
            _actualizarBarraGPS(gpsLat, gpsLon, pos.coords.accuracy);
            console.log('GPS Capa 1 OK:', gpsLat, gpsLon);
        },
        err => {
            console.warn('GPS Capa 1 falló:', err.message || err.code);
            _errorBarraGPS('🟡 Buscando señal GPS...');
            // Reintentar Capa 1 automáticamente
            _programarReintentoGPS();
        },
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 30000 }
    );

    // ═══ CAPA 2: Rastreo continuo por satélite (más preciso pero más lento) ═══
    if (_watchId !== null) {
        navigator.geolocation.clearWatch(_watchId);
    }
    _watchId = navigator.geolocation.watchPosition(
        pos => {
            gpsLat = pos.coords.latitude;
            gpsLon = pos.coords.longitude;
            _actualizarBarraGPS(gpsLat, gpsLon, pos.coords.accuracy);
            // Si teníamos reintentos programados, los cancelamos porque ya tenemos señal
            if (_gpsRetryTimer) { clearInterval(_gpsRetryTimer); _gpsRetryTimer = null; }
        },
        err => {
            console.warn('GPS Capa 2 error:', err.message || err.code);
            if (err.code === 1) {
                // Permiso denegado
                if (statusEl) statusEl.textContent = '⚠️ Permiso de ubicación denegado. Actívalo en ajustes.';
                if (dot) dot.style.background = '#ff3b3b';
            } else if (gpsLat === null) {
                _errorBarraGPS('🟡 Buscando señal GPS... presione el botón si hay peligro');
                _programarReintentoGPS();
            }
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
    );
}

function _programarReintentoGPS() {
    // Solo programar si no hay reintentos activos y no tenemos coordenadas
    if (_gpsRetryTimer || (gpsLat !== null && gpsLon !== null)) return;
    
    _gpsRetryTimer = setInterval(() => {
        if (gpsLat !== null && gpsLon !== null) {
            // Ya tenemos coordenadas, cancelar reintentos
            clearInterval(_gpsRetryTimer);
            _gpsRetryTimer = null;
            return;
        }
        console.log('GPS: reintentando obtener ubicación...');
        navigator.geolocation.getCurrentPosition(
            pos => {
                gpsLat = pos.coords.latitude;
                gpsLon = pos.coords.longitude;
                _actualizarBarraGPS(gpsLat, gpsLon, pos.coords.accuracy);
                clearInterval(_gpsRetryTimer);
                _gpsRetryTimer = null;
                console.log('GPS reintento OK:', gpsLat, gpsLon);
            },
            err => {
                console.warn('GPS reintento falló:', err.message || err.code);
            },
            { enableHighAccuracy: false, timeout: 8000, maximumAge: 0 }
        );
    }, 5000);
}

function editarDatos() {
    if (vecinoData) {
        document.getElementById('reg-nombre').value   = vecinoData.nombre || '';
        document.getElementById('reg-telefono').value = vecinoData.telefono || '';
        document.getElementById('reg-id').value       = vecinoData.num_identificacion || '';
        document.getElementById('reg-dir').value      = vecinoData.direccion || '';
        document.getElementById('reg-correo').value   = vecinoData.correo || '';
        document.getElementById('reg-sexo').value     = vecinoData.sexo || '';
        document.getElementById('reg-edad').value     = vecinoData.edad || '';

        // ⭐ Cargar contactos: primero sessionStorage, luego backend
        const cachedFam = sessionStorage.getItem('sisdel_familiares');
        if (cachedFam) {
            cargarContactosFamiliaresEnForm(JSON.parse(cachedFam));
        } else if (vecinoData.id_vecino) {
            fetch(`${API}/api/vecinos/${vecinoData.id_vecino}/contactos`)
                .then(r => r.ok ? r.json() : [])
                .then(contactos => {
                    if (contactos.length) {
                        cargarContactosFamiliaresEnForm(contactos);
                        sessionStorage.setItem('sisdel_familiares', JSON.stringify(contactos));
                    }
                }).catch(() => {});
        }
    }

    // Si vino del login como vecino → bloquear campos de identidad
    if (modoVecinoLogin) {
        ['reg-id','reg-nombre','reg-correo','reg-edad'].forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.readOnly = true; el.style.opacity = '0.5'; }
        });
        const sexoEl = document.getElementById('reg-sexo');
        if (sexoEl) { sexoEl.disabled = true; sexoEl.style.opacity = '0.5'; }
        document.getElementById('hint-id').style.display = 'none';
        const btn = document.querySelector('.btn-registrar');
        if (btn) btn.textContent = '💾 Actualizar Datos';
    }

    // Reset UI
    document.getElementById('codigo-generado-box').style.display = 'none';
    const btnGuardar = document.querySelector('.btn-registrar');
    if (btnGuardar) btnGuardar.style.display = 'block';
    mostrarPaso('paso-registro');
}

// ── HOLD TO PANIC ─────────────────────────────────
function iniciarPanico(e) {
    e.preventDefault();
    document.getElementById('btn-panico').classList.add('pressing');
    document.getElementById('hold-bar-wrap').style.display = 'block';
    document.getElementById('hint-panico').textContent = '¡Mantén presionado!';
    holdProgress = 0;
    const start = Date.now();
    holdInterval = setInterval(() => {
        holdProgress = Math.min(((Date.now()-start)/HOLD_MS)*100, 100);
        document.getElementById('hold-bar').style.width = holdProgress+'%';
        if (holdProgress >= 100) { clearInterval(holdInterval); holdInterval=null; enviarAlerta(); }
    }, 50);
}
function cancelarPanico(e) {
    e.preventDefault();
    document.getElementById('btn-panico').classList.remove('pressing');
    if (holdInterval) { clearInterval(holdInterval); holdInterval=null; }
    if (holdProgress < 100) {
        document.getElementById('hold-bar-wrap').style.display='none';
        document.getElementById('hold-bar').style.width='0%';
        document.getElementById('hint-panico').textContent='Mantén presionado 3 segundos para enviar alerta';
    }
}

let _alertaCount = 0;          // cuántas alertas se han enviado
let _countdownInterval = null; // temporizador auto-cierre

async function enviarAlerta(fuente) {
    if (!vecinoData) return;
    if (_alertaCount >= 10) {
        alert('Has enviado 10 alertas. El panel ya fue notificado. Mantén la calma.');
        return;
    }

    try {
        await ensureLocation();
    } catch (e) {
        console.warn('Alerta enviada sin señal GPS:', e);
    }

    _alertaCount++;
    const instId = vecinoData.id_institucion || new URLSearchParams(window.location.search).get('inst') || '';

    // Asegurar que tengamos el id_vecino (a veces se pierde en el estado pero está en storage)
    let finalIdVecino = vecinoData.id_vecino;
    if (!finalIdVecino) {
        const saved = JSON.parse(sessionStorage.getItem('sisdel_vecino') || '{}');
        finalIdVecino = saved.id_vecino || null;
    }

    const payload = {
        id_institucion:    instId,
        id_vecino:         finalIdVecino,
        nombre_vecino:     vecinoData.nombre        || 'Sin nombre',
        telefono_vecino:   vecinoData.telefono      || 'Sin teléfono',
        num_identificacion:vecinoData.num_identificacion || 'Sin ID',
        direccion_vecino:  vecinoData.direccion     || '',
        gps_latitud:       gpsLat,
        gps_longitud:      gpsLon,
        direccion_aproximada: gpsLat ? `${gpsLat.toFixed(6)}, ${gpsLon.toFixed(6)}` : 'Sin coordenadas'
    };

    if (navigator.vibrate) navigator.vibrate([200,100,200,100,500]);

    // 🔊 Reproducir audio de alerta pregrabado (NO reproducir si la alerta vino de voz)
    if (fuente !== 'voz') {
        try {
            const cfg = JSON.parse(localStorage.getItem('sisdel_config') || '{}');
            if (cfg.audioGrabado) {
                const audioAlerta = new Audio(cfg.audioGrabado);
                audioAlerta.volume = 1.0;
                let repeticiones = 0;
                audioAlerta.onended = () => {
                    repeticiones++;
                    if (repeticiones < 3) audioAlerta.play().catch(() => {});
                };
                audioAlerta.play().catch(err => console.warn('No se pudo reproducir audio:', err));
            }
        } catch (e) { console.warn('Error audio alerta:', e); }
    }

    // Mostrar overlay con contador
    document.getElementById('env-alerta-num').textContent = `Alerta #${_alertaCount} de 10`;
    document.getElementById('env-coords').textContent =
        gpsLat ? `📍 ${gpsLat.toFixed(6)}, ${gpsLon.toFixed(6)}` : '📍 Sin coordenadas GPS';
    // Mostrar/ocultar botón "enviar otra"
    const btnOtra = document.getElementById('btn-otra-alerta');
    if (btnOtra) btnOtra.style.display = _alertaCount < 10 ? 'inline-block' : 'none';

    document.getElementById('overlay-enviado').style.display='flex';

    // Auto-cierre en 5 segundos
    let secs = 5;
    const cdEl = document.getElementById('env-countdown');
    if (_countdownInterval) clearInterval(_countdownInterval);
    if (cdEl) {
        cdEl.textContent = `Cerrando en ${secs}s...`;
        _countdownInterval = setInterval(() => {
            secs--;
            if (secs <= 0) { clearInterval(_countdownInterval); ocultarConfirmacion(); }
            else if (cdEl) cdEl.textContent = `Cerrando en ${secs}s...`;
        }, 1000);
    }

    // Reset botón
    document.getElementById('btn-panico').classList.remove('pressing');
    document.getElementById('hold-bar-wrap').style.display='none';
    document.getElementById('hold-bar').style.width='0%';
    document.getElementById('hint-panico').textContent='Mantén presionado 3 segundos para enviar alerta';

    // Enviar al backend
    try {
        await fetch(`${API}/api/emergencias/`, {
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify(payload)
        });
    } catch {
        const pendientes = JSON.parse(localStorage.getItem('sisdel_pendientes')||'[]');
        pendientes.push({...payload, ts: new Date().toISOString()});
        localStorage.setItem('sisdel_pendientes', JSON.stringify(pendientes));
    }

    // WhatsApp: mostrar botones directos en el overlay (evita bloqueador de pop-ups)
    const loc        = gpsLat ? `https://maps.google.com/?q=${gpsLat},${gpsLon}` : 'Sin GPS';
    const textoWA    = `🚨‼️ ME URGE AYUDA ‼️🚨\n⚠️ AMENAZA DE VIOLENCIA ⚠️\n\n${vecinoData.nombre} necesita ayuda URGENTE.\n📍 Ubicación: ${loc}\n📱 Tel: ${vecinoData.telefono}\n\n🆘 POR FAVOR LLAMA O VEN DE INMEDIATO 🆘`;
    const familiares = JSON.parse(sessionStorage.getItem('sisdel_familiares') || '[]');
    const waNumber   = vecinoData.whatsapp_emergencia;

    // Construir lista de contactos a notificar
    const contactosWA = [...familiares];
    if (waNumber && !familiares.length) contactosWA.push({ nombre: 'Familiar', telefono: waNumber });

    const waBotones = document.getElementById('wa-botones');
    const waSection = document.getElementById('wa-familiares');
    if (waBotones && contactosWA.length > 0) {
        waBotones.innerHTML = contactosWA.map(fam => {
            const url = `whatsapp://send?phone=${fam.telefono}&text=${encodeURIComponent(textoWA)}`;
            return `<a href="${url}" target="_blank" rel="noopener"
                style="display:block;background:#25d366;color:#fff;text-align:center;padding:.5rem 1rem;
                       border-radius:10px;font-weight:700;font-size:.88rem;text-decoration:none;">
                💬 Avisar a ${fam.nombre || fam.telefono}
            </a>`;
        }).join('');
        if (waSection) waSection.style.display = 'block';
    } else if (waSection) {
        waSection.style.display = 'none';
    }
}

function enviarOtraAlerta() {
    if (_countdownInterval) clearInterval(_countdownInterval);
    ocultarConfirmacion();
    // Pequeña pausa antes de enviar (UX)
    setTimeout(() => enviarAlerta(), 300);
}

function ocultarConfirmacion() {
    if (_countdownInterval) { clearInterval(_countdownInterval); _countdownInterval = null; }
    const cdEl = document.getElementById('env-countdown');
    if (cdEl) cdEl.textContent = '';
    document.getElementById('overlay-enviado').style.display='none';
}

// ── GUARDAR SOLO CONTACTOS DE EMERGENCIA ─────────────────
async function guardarSoloContactos() {
    const btn       = document.getElementById('btn-guardar-contactos');
    const statusEl  = document.getElementById('contactos-status');
    const contactos = leerContactosFamiliares();

    if (!contactos.length) {
        statusEl.textContent = '⚠️ Agrega al menos un contacto con teléfono';
        statusEl.style.color = '#ff8c00';
        statusEl.style.display = 'block';
        setTimeout(() => statusEl.style.display = 'none', 3000);
        return;
    }

    // Feedback visual: cargando
    btn.textContent = '⏳ Guardando...';
    btn.style.opacity = '0.7';

    // Guardar siempre en sessionStorage y localStorage (respaldo)
    sessionStorage.setItem('sisdel_familiares', JSON.stringify(contactos));
    const params = new URLSearchParams(window.location.search);
    const instId = params.get('inst') || instData?.id_institucion || '';
    if (instId) localStorage.setItem(`sisdel_familiares_${instId}`, JSON.stringify(contactos));

    // Guardar en backend si tenemos id_vecino
    const idVecino = vecinoData?.id_vecino || window._vecinoEditId;
    if (idVecino) {
        try {
            const r = await fetch(`${API}/api/vecinos/${idVecino}/contactos`, {
                method: 'POST', headers: {'Content-Type':'application/json'},
                body: JSON.stringify(contactos)
            });
            if (r.ok) {
                btn.textContent = '✅ ¡Contactos Guardados!';
                btn.style.background = 'linear-gradient(135deg,#00d68f,#00a870)';
                btn.style.opacity = '1';
                statusEl.textContent = `✅ ${contactos.length} contacto(s) guardados permanentemente en la nube`;
                statusEl.style.color = '#00d68f';
                statusEl.style.display = 'block';
                setTimeout(() => {
                    btn.textContent = '💾 Guardar Contactos de Emergencia';
                    statusEl.style.display = 'none';
                }, 3000);
                return;
            }
        } catch {}
    }

    // Sin backend (guardado solo local)
    btn.textContent = '✅ Guardado localmente';
    btn.style.opacity = '1';
    statusEl.textContent = `💾 ${contactos.length} contacto(s) guardados en este dispositivo`;
    statusEl.style.color = '#4da6ff';
    statusEl.style.display = 'block';
    setTimeout(() => {
        btn.textContent = '💾 Guardar Contactos de Emergencia';
        statusEl.style.display = 'none';
    }, 3000);
}

// ── BOTÓN WHATSAPP MASIVO ────────────────────────────────
// ── BOTONES WHATSAPP INDIVIDUALES (PANTALLA PRINCIPAL) ──────────────────
function mostrarBotonWAmasivo() {
    const familiares = JSON.parse(sessionStorage.getItem('sisdel_familiares') || '[]');
    if (familiares.length === 0) return;
    
    const container = document.getElementById('wa-botones-main');
    const hint = document.getElementById('wa-masivo-hint');
    
    if (container) {
        const nombre = vecinoData?.nombre || 'Un vecino';
        const loc = gpsLat ? `https://maps.google.com/?q=${gpsLat},${gpsLon}` : 'Sin GPS disponible';
        const texto  = `🚨‼️ ME URGE AYUDA ‼️🚨\n⚠️ AMENAZA DE VIOLENCIA ⚠️\n\n${nombre} necesita ayuda URGENTE.\n📍 Ubicación: ${loc}\n📱 Tel: ${vecinoData?.telefono || ''}\n\n🆘 POR FAVOR LLAMA O VEN DE INMEDIATO 🆘`;

        container.innerHTML = familiares.map(fam => {
            const url = `whatsapp://send?phone=${fam.telefono}&text=${encodeURIComponent(texto)}`;
            return `<a href="${url}" target="_blank" rel="noopener"
                style="display:flex; align-items:center; justify-content:center; gap:.5rem;
                       background:#25d366; color:#fff; padding:.8rem 1rem;
                       border-radius:12px; font-weight:800; font-size:1rem; text-decoration:none;
                       box-shadow:0 4px 15px rgba(37,211,102,0.3); transition:transform 0.1s;">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                    <path d="M12 0C5.373 0 0 5.373 0 12c0 2.127.558 4.126 1.533 5.857L.057 23.704a.75.75 0 00.92.92l5.847-1.476A11.943 11.943 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.75a9.693 9.693 0 01-4.944-1.355l-.354-.21-3.668.926.944-3.565-.23-.366A9.693 9.693 0 012.25 12C2.25 6.615 6.615 2.25 12 2.25S21.75 6.615 21.75 12 17.385 21.75 12 21.75z"/>
                </svg>
                Avisar a ${fam.nombre || fam.telefono}
            </a>`;
        }).join('');
        
        container.style.display = 'flex';
    }
    if (hint) hint.style.display = 'block';
}

// ── LISTA DE VECINOS (solo admin) ─────────────────────────

let _todosVecinos = [];

let _busquedaTimeout = null;
async function busquedaRapidaVecino(texto) {
    const container = document.getElementById('resultado-busqueda');
    if (!container) return;

    texto = texto.trim().toLowerCase();
    if (texto.length < 2) {
        container.style.display = 'none';
        container.innerHTML = '';
        return;
    }

    // Cargar vecinos si no los tenemos aún
    if (!_todosVecinos || !_todosVecinos.length) {
        const params = new URLSearchParams(window.location.search);
        const instId = params.get('inst');
        if (!instId) return;
        try {
            const res = await fetch(`${API}/api/vecinos/${instId}`);
            _todosVecinos = await res.json();
        } catch { return; }
    }

    // Filtrar por nombre, teléfono o documento
    const resultados = _todosVecinos.filter(v => {
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
        <div onclick="seleccionarBusquedaRapida('${v.num_identificacion}')" 
             style="padding:.55rem 1rem; cursor:pointer; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #1a1f3e; transition:background .2s;"
             onmouseover="this.style.background='rgba(77,166,255,.1)'" onmouseout="this.style.background='transparent'">
            <div>
                <span style="font-weight:700; color:#fff; font-size:.85rem;">${v.nombre}</span>
                <span style="color:#6b7294; font-size:.75rem; margin-left:.5rem;">Doc: ${v.num_identificacion}</span>
            </div>
            <span style="font-family:monospace; color:#7c5cfc; font-size:.8rem;">${v.telefono}</span>
        </div>
    `).join('');
    container.style.display = 'block';
}

function seleccionarBusquedaRapida(numId) {
    // Llenar el campo de identificación y disparar búsqueda
    const inp = document.getElementById('reg-id');
    if (inp) {
        inp.value = numId;
        buscarVecinoPorId();
    }
    // Cerrar resultados
    const container = document.getElementById('resultado-busqueda');
    if (container) { container.style.display = 'none'; container.innerHTML = ''; }
    const busq = document.getElementById('busqueda-rapida');
    if (busq) busq.value = '';
}

async function abrirListaVecinos() {
    const params = new URLSearchParams(window.location.search);
    const instId = params.get('inst');
    if (!instId) return;

    // Nombre instón en cabecera
    const nombreEl = document.getElementById('modal-inst-nombre');
    if (instData) nombreEl.textContent = instData.nombre_institucion || '';

    // Limpiar
    document.getElementById('buscar-vecino-lista').value = '';
    document.getElementById('vecinos-tbody').innerHTML = '<tr><td colspan="8" style="text-align:center;padding:1.5rem;color:#6b7294;">Cargando...</td></tr>';
    document.getElementById('modal-vecinos').style.display = 'block';
    document.body.style.overflow = 'hidden';

    try {
        const res = await fetch(`${API}/api/vecinos/${instId}`);
        _todosVecinos = await res.json();
        renderTablaVecinos(_todosVecinos);
    } catch {
        document.getElementById('vecinos-tbody').innerHTML = '<tr><td colspan="8" style="text-align:center;color:#ff3b3b;padding:1rem;">Error al cargar vecinos</td></tr>';
    }
}

function renderTablaVecinos(lista) {
    const tbody = document.getElementById('vecinos-tbody');
    const vacio = document.getElementById('vecinos-vacio');
    if (!lista.length) {
        tbody.innerHTML = '';
        vacio.style.display = 'block';
        return;
    }
    vacio.style.display = 'none';
    tbody.innerHTML = lista.map((v, i) => {
        // Contar familiares registrados
        let countFam = 0;
        for (let n = 1; n <= 5; n++) if ((v[`fam_tel_${n}`]||'').trim()) countFam++;
        const btnFam = `<button onclick='mostrarFamiliares(${JSON.stringify(JSON.stringify(v))})'
            style="background:${countFam ? 'rgba(0,214,143,.15)' : 'rgba(107,114,148,.1)'};
                   border:1px solid ${countFam ? '#00d68f' : '#3a3f6e'};
                   border-radius:8px; padding:.25rem .55rem;
                   color:${countFam ? '#00d68f' : '#6b7294'};
                   font-size:.75rem; cursor:pointer; white-space:nowrap;">
            👨‍👩‍👧 ${countFam ? countFam : '—'}
        </button>`;
        return `
        <tr style="border-bottom:1px solid #1a1f3e; ${i%2===0 ? 'background:rgba(30,35,70,.4)' : ''}">
            <td style="padding:.55rem .8rem; color:#4da6ff; font-weight:700;">${i+1}</td>
            <td style="padding:.55rem .8rem; font-weight:600;">${v.nombre}</td>
            <td style="padding:.55rem .8rem; font-family:monospace; color:#7c5cfc;">${v.num_identificacion}</td>
            <td style="padding:.55rem .8rem;">${v.telefono}</td>
            <td style="padding:.55rem .8rem; text-align:center;">${v.sexo || '—'}</td>
            <td style="padding:.55rem .8rem; text-align:center;">${v.edad || '—'}</td>
            <td style="padding:.55rem .8rem; color:#6b7294;">${v.direccion || '—'}</td>
            <td style="padding:.55rem .8rem; font-family:monospace; font-weight:800; color:#00d68f; letter-spacing:3px;">${v.codigo_vecino || '—'}</td>
            <td style="padding:.55rem .8rem; text-align:center;">${btnFam}</td>
        </tr>`;
    }).join('');
}

function mostrarFamiliares(vJson) {
    const v = JSON.parse(vJson);
    document.getElementById('modal-fam-titulo').textContent = `👨‍👩‍👧 Familiares de ${v.nombre}`;
    const lista = document.getElementById('modal-fam-lista');
    const vacio = document.getElementById('modal-fam-vacio');
    lista.innerHTML = '';
    let count = 0;
    for (let i = 1; i <= 5; i++) {
        const nombre = (v[`fam_nombre_${i}`] || '').trim();
        const tel    = (v[`fam_tel_${i}`]    || '').trim();
        if (!tel) continue;
        count++;
        lista.innerHTML += `
            <div style="background:#1a1f3e; border-radius:10px; padding:.65rem 1rem;
                        display:flex; align-items:center; justify-content:space-between; gap:.5rem;">
                <div>
                    <p style="margin:0; font-weight:700; color:#ccd6f6; font-size:.88rem;"
                    >${nombre || `Familiar ${i}`}</p>
                    <p style="margin:0; color:#4da6ff; font-size:.82rem; font-family:monospace;">📱 ${tel}</p>
                </div>
                <a href="whatsapp://send?phone=${tel}" target="_blank"
                   style="background:#25d366; border:none; border-radius:8px; padding:.3rem .65rem;
                          color:#fff; font-size:.78rem; font-weight:700; text-decoration:none;">WA</a>
            </div>`;
    }
    vacio.style.display  = count ? 'none'  : 'block';
    lista.style.display  = count ? 'flex'  : 'none';
    const modal = document.getElementById('modal-familiares');
    modal.style.display = 'flex';
}

function cerrarModalFamiliares() {
    document.getElementById('modal-familiares').style.display = 'none';
}

function filtrarVecinos() {
    const q = document.getElementById('buscar-vecino-lista').value.toLowerCase().trim();
    if (!q) { renderTablaVecinos(_todosVecinos); return; }
    const filtrados = _todosVecinos.filter(v =>
        (v.nombre||'').toLowerCase().includes(q) ||
        (v.num_identificacion||'').toLowerCase().includes(q) ||
        (v.telefono||'').toLowerCase().includes(q) ||
        (v.codigo_vecino||'').toLowerCase().includes(q)
    );
    renderTablaVecinos(filtrados);
}

function cerrarListaVecinos() {
    document.getElementById('modal-vecinos').style.display = 'none';
    document.body.style.overflow = '';
}

// ── BOTÓN X / CERRAR FORMULARIO ─────────────────────────
function cerrarFormulario() {
    // Guardar contactos automáticamente al salir
    const idVecino = vecinoData?.id_vecino || window._vecinoEditId;
    if (idVecino) {
        const contactos = leerContactosFamiliares();
        if (contactos.length) {
            const params = new URLSearchParams(window.location.search);
            const instId = params.get('inst') || instData?.id_institucion || '';
            sessionStorage.setItem('sisdel_familiares', JSON.stringify(contactos));
            if (instId) localStorage.setItem(`sisdel_familiares_${instId}`, JSON.stringify(contactos));
            fetch(`${API}/api/vecinos/${idVecino}/contactos`, {
                method: 'POST', headers: {'Content-Type':'application/json'},
                body: JSON.stringify(contactos)
            }).catch(() => {});
        }
    }
    if (vecinoData) {
        // Vecino vuelve al botón de pánico
        mostrarPaso('paso-panico');
        iniciarPasoParanica();
    } else {
        // Admin: cerrar pestaña o ir atrás
        if (window.history.length > 1) window.history.back();
        else window.close();
    }
}

// ── MODIFICAR VECINO (admin) ─────────────────────────────
async function modificarVecino() {
    const id = window._vecinoEditId;
    if (!id) { alert('Busca primero al vecino por su documento.'); return; }

    const lada   = document.getElementById('reg-pais')?.value || '502';
    const telRaw = document.getElementById('reg-telefono').value.replace(/\D/g,'');

    // Leer familiares del formulario e incluirlos en el mismo PUT
    const familiares = leerContactosFamiliares();
    const data = {
        nombre:    document.getElementById('reg-nombre').value.trim(),
        telefono:  lada + telRaw,
        direccion: document.getElementById('reg-dir').value.trim(),
        sexo:      document.getElementById('reg-sexo').value,
        edad:      parseInt(document.getElementById('reg-edad').value) || 0,
        correo:    document.getElementById('reg-correo').value.trim()
    };
    // Agregar familiares directamente al payload (igual que en registro)
    for (let i = 0; i < 5; i++) {
        const c = familiares[i] || {};
        data[`fam_nombre_${i+1}`] = c.nombre   || '';
        data[`fam_tel_${i+1}`]    = c.telefono || '';
    }

    try {
        const res = await fetch(`${API}/api/vecinos/${id}`, {
            method: 'PUT', headers: {'Content-Type':'application/json'},
            body: JSON.stringify(data)
        });
        if (res.ok) {
            // Actualizar caché local
            const params = new URLSearchParams(window.location.search);
            const instId = params.get('inst') || instData?.id_institucion || '';
            if (familiares.length) {
                sessionStorage.setItem('sisdel_familiares', JSON.stringify(familiares));
                if (instId) localStorage.setItem(`sisdel_familiares_${instId}`, JSON.stringify(familiares));
            }
            // También guardar via endpoint /contactos (compatibilidad con backend viejo)
            fetch(`${API}/api/vecinos/${id}/contactos`, {
                method: 'POST', headers: {'Content-Type':'application/json'},
                body: JSON.stringify(familiares)
            }).catch(() => {});
            const hintEl = document.getElementById('hint-id');
            hintEl.textContent = '✅ Datos y familiares guardados correctamente';
            hintEl.style.color = '#00d68f';
            hintEl.style.display = 'block';
            setTimeout(() => hintEl.style.display = 'none', 3000);
        } else {
            alert('Error al modificar el vecino.');
        }
    } catch {
        alert('Sin conexión al servidor.');
    }
}

// ── ELIMINAR VECINO (admin) ──────────────────────────────
async function eliminarVecino() {
    const id     = window._vecinoEditId;
    const nombre = document.getElementById('reg-nombre').value || 'este vecino';
    if (!id) { alert('Busca primero al vecino por su documento.'); return; }
    if (!confirm(`⚠️ ¿Eliminar permanentemente a ${nombre}?\n\nEsta acción no se puede deshacer.`)) return;

    try {
        const res = await fetch(`${API}/api/vecinos/${id}`, { method: 'DELETE' });
        if (res.ok) {
            alert(`✅ ${nombre} eliminado correctamente.`);
            // Limpiar formulario
            ['reg-id','reg-nombre','reg-telefono','reg-dir','reg-correo','reg-edad'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.value = '';
            });
            document.getElementById('reg-sexo').value = '';
            window._vecinoEditId = null;
            document.getElementById('btn-guardar')?.removeAttribute('style');
            document.getElementById('btn-modificar')?.style.setProperty('display','none');
            document.getElementById('btn-eliminar')?.style.setProperty('display','none');
            document.getElementById('hint-id').style.display = 'none';
        } else {
            alert('Error al eliminar. Intente de nuevo.');
        }
    } catch {
        alert('Sin conexión al servidor.');
    }
}

// ══ ALERTA POR COMANDO DE VOZ ══
function dispararAlertaPorVoz() {
    // Solo funciona si estamos en la pantalla del pánico y hay datos del vecino
    if (!vecinoData) return;
    const pasoP = document.getElementById('paso-panico');
    if (!pasoP || pasoP.style.display === 'none') return;

    console.log('🚨🎙️ ALERTA ACTIVADA POR VOZ');

    // Vibración fuerte inmediata
    if (navigator.vibrate) {
        navigator.vibrate([500, 200, 500, 200, 1000]);
    }

    // Detener reconocimiento de voz temporalmente
    if (typeof detenerReconocimientoVoz === 'function') {
        detenerReconocimientoVoz();
    }

    // Enviar la alerta
    enviarAlerta('voz');

    // Reiniciar voz después de 10 segundos
    setTimeout(() => {
        const cfg = JSON.parse(localStorage.getItem('sisdel_config') || '{}');
        if (cfg.voz && typeof iniciarReconocimientoVoz === 'function') {
            iniciarReconocimientoVoz();
        }
    }, 10000);
}
