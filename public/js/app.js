/* ═══════════════════════════════════════════════════
   GESTIÓN LABORAL - App Principal (JavaScript)
   ═══════════════════════════════════════════════════ */

const API = '';
let TOKEN = sessionStorage.getItem('gl_token') || null;
let USUARIO = JSON.parse(sessionStorage.getItem('gl_usuario') || 'null');
let socket = null;

// ═══════════════════════════════════════════
// INICIALIZACIÓN
// ═══════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
    // Enter para login unificado
    document.getElementById('input-codigo-acceso').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') loginUnificado();
    });
    
    // Listeners vista previa tiempo de tarea
    ['tarea-tiempo', 'tarea-tiempo-unidad', 'tarea-fin-semana'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', calcularTiempoEstimadoDisplay);
    });

    verificarSesion();
    inicializarSocket();
});

function inicializarSocket() {
    try {
        socket = io({ reconnection: true, reconnectionDelay: 1000, reconnectionAttempts: Infinity });
        
        socket.on('connect', () => {
            console.log('🔌 Socket conectado:', socket.id);
            // Re-unirse al cuarto de la empresa cada vez que reconecte
            if (USUARIO && USUARIO.id_empresa) {
                socket.emit('unirse_empresa', USUARIO.id_empresa);
                console.log('📡 Re-unido a empresa:', USUARIO.id_empresa);
            }
        });
        
        socket.on('disconnect', () => console.log('❌ Socket desconectado'));
        
        socket.on('nueva_tarea', async (data) => {
            console.log('📨 Evento nueva_tarea recibido:', data);
            
            if (USUARIO && ['EMPLEADO', 'SUPERVISOR'].includes(USUARIO.rol) && data.id_empleado === USUARIO.id_usuario) {
                // Verificar si la tarea es para hoy antes de alertar
                const hoyLocalStr = new Date(Date.now() - (new Date().getTimezoneOffset() * 60000)).toISOString().split('T')[0];
                let esParaHoy = true;
                
                if (data.fecha_programada || data.fecha_creacion) {
                    const fechaRef = data.fecha_programada || data.fecha_creacion;
                    let s = fechaRef.trim().replace(' ', 'T');
                    if (!s.includes('Z') && !s.includes('+')) s += 'Z';
                    const fechaObj = new Date(s);
                    const fechaLoc = new Date(fechaObj.getTime() - (fechaObj.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
                    esParaHoy = (fechaLoc === hoyLocalStr);
                }

                if (esParaHoy) {
                    console.log('✅ Tarea para hoy detectada, lanzando alerta');
                    lanzarAlertaNuevaTarea(data);
                }
                
                // Recargar siempre la lista (las futuras quedarán ocultas por el filtro de cargarTareasEmpleado)
                setTimeout(() => cargarTareasEmpleado(), 500); 
            } else if (USUARIO && (USUARIO.rol === 'ADMIN' || USUARIO.rol === 'GERENTE')) {
                if (typeof cargarTareas === 'function') cargarTareas();
            }
        });
    } catch(e) {
        console.log('Socket no disponible:', e);
    }
}

// ═══════════════════════════════════════════
// SISTEMA DE ALERTA FULLSCREEN PARA NUEVAS TAREAS
// (Inspirado en Botón de Pánico — agente.html)
// ═══════════════════════════════════════════

// Audio context global (necesario para desbloqueo en móviles)
let _tareaAudioCtx = null;
let _tareaAudioDesbloqueado = false;
let _tareasSirenInterval = null;
let _tareaAlertaAutoClose = null;

// Desbloquear audio en el primer toque/click (requisito de móviles)
function desbloquearAudioTareas() {
    if (_tareaAudioDesbloqueado) return;
    try {
        _tareaAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = _tareaAudioCtx.createOscillator();
        const gain = _tareaAudioCtx.createGain();
        gain.gain.value = 0.01;
        osc.connect(gain); gain.connect(_tareaAudioCtx.destination);
        osc.start(); osc.stop(_tareaAudioCtx.currentTime + 0.1);
        _tareaAudioDesbloqueado = true;
        console.log('🔊 Audio de alertas desbloqueado');
    } catch(e) {}
}
document.body.addEventListener('click', desbloquearAudioTareas, { once: true });
document.body.addEventListener('touchstart', desbloquearAudioTareas, { once: true });

// ═══════════════════════════════════════════
// OPTIMIZACIÓN DE IMÁGENES EN EL NAVEGADOR
// (Equivalente a Python/Pillow: resize 1024px + JPEG 70%)
// ═══════════════════════════════════════════

/**
 * Optimiza una imagen antes de subirla:
 * - Redimensiona al máximo MAX_SIZE px (proporcional, como Lanczos en Pillow)
 * - Convierte a JPEG con calidad 70% (elimina metadatos GPS, sensor, etc.)
 * - Retorna un data URL base64 listo para enviar
 *
 * @param {File} file - Archivo de imagen del input
 * @param {Object} opts - Opciones { maxSize: 1024, quality: 0.70 }
 * @returns {Promise<{base64: string, originalKB: number, optimizedKB: number}>}
 */
function optimizarImagen(file, opts = {}) {
    const maxSize = opts.maxSize || 800;   // 800px como en la propuesta
    const quality  = opts.quality  || 0.60; // 60% JPEG como en la propuesta
    
    return new Promise((resolve, reject) => {
        const originalKB = Math.round(file.size / 1024);
        const img = new Image();
        const url = URL.createObjectURL(file);
        
        img.onload = () => {
            URL.revokeObjectURL(url);
            
            // Calcular nueva dimensión manteniendo proporción
            let w = img.width;
            let h = img.height;
            const ratio = Math.min(maxSize / w, maxSize / h, 1); // nunca agrandar
            w = Math.round(w * ratio);
            h = Math.round(h * ratio);
            
            // Canvas: equivalente a Image.resize con LANCZOS
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, w, h);
            
            // Convertir a JPEG comprimido
            const base64 = canvas.toDataURL('image/jpeg', quality);
            const optimizedKB = Math.round((base64.length * 3 / 4) / 1024);
            const ahorro = Math.round((1 - optimizedKB / originalKB) * 100);
            
            console.log(`📸 ${originalKB}KB → ${optimizedKB}KB (${w}x${h}, JPEG ${Math.round(quality*100)}%, -${ahorro}%)`);
            resolve({ base64, originalKB, optimizedKB });
        };
        
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('Error al cargar la imagen para optimizar'));
        };
        
        img.src = url;
    });
}

// Sirena progresiva (tipo Botón de Pánico)
function tocarSirenaTarea(esUrgente) {
    if (!_tareaAudioCtx || !_tareaAudioDesbloqueado) {
        // Intentar crear contexto de respaldo
        try {
            _tareaAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        } catch(e) { return; }
    }
    let repeticiones = 0;
    const maxRep = esUrgente ? 10 : 6;
    const freqBase = esUrgente ? 800 : 600;
    const freqPeak = esUrgente ? 1400 : 1000;
    
    _tareasSirenInterval = setInterval(() => {
        if (repeticiones >= maxRep) { detenerSirenaTarea(); return; }
        try {
            const osc = _tareaAudioCtx.createOscillator();
            const gain = _tareaAudioCtx.createGain();
            osc.type = esUrgente ? 'square' : 'sawtooth';
            osc.frequency.setValueAtTime(freqBase, _tareaAudioCtx.currentTime);
            osc.frequency.linearRampToValueAtTime(freqPeak, _tareaAudioCtx.currentTime + 0.15);
            osc.frequency.linearRampToValueAtTime(freqBase, _tareaAudioCtx.currentTime + 0.3);
            gain.gain.setValueAtTime(0.35, _tareaAudioCtx.currentTime);
            gain.gain.linearRampToValueAtTime(0, _tareaAudioCtx.currentTime + 0.45);
            osc.connect(gain); gain.connect(_tareaAudioCtx.destination);
            osc.start(); osc.stop(_tareaAudioCtx.currentTime + 0.45);
        } catch(e) {}
        repeticiones++;
    }, 450);
}

function detenerSirenaTarea() {
    if (_tareasSirenInterval) { clearInterval(_tareasSirenInterval); _tareasSirenInterval = null; }
}

// El antiguo asegurarOverlayTarea ha sido reemplazado por mostrarAlertaTarea a pantalla completa

function lanzarAlertaNuevaTarea(data) {
    const tipo = (data.prioridad === 'urgente' || data.prioridad === 'alta') ? 'urgente' : 'normal';
    mostrarAlertaTarea(data, tipo);
}

function dismissAlertaTarea() {
    detenerSirenaTarea();
    if (navigator.vibrate) navigator.vibrate(0); // cancelar vibración
}

// ═══════════════════════════════════════════
// AUTENTICACIÓN
// ═══════════════════════════════════════════
async function verificarSesion() {
    if (!TOKEN) {
        mostrarPantalla('login');
        return;
    }

    try {
        const res = await fetchAPI('/api/auth/me');
        if (res.rol === 'ROOT') {
            USUARIO = { rol: 'ROOT', nombre: 'Programador' };
            sessionStorage.setItem('gl_usuario', JSON.stringify(USUARIO));
            mostrarPantalla('root');
            cargarEmpresas();
        } else {
            USUARIO = res;
            sessionStorage.setItem('gl_usuario', JSON.stringify(USUARIO));
            abrirPanelPorRol();
        }
    } catch(err) {
        TOKEN = null;
        sessionStorage.removeItem('gl_token');
        sessionStorage.removeItem('gl_usuario');
        mostrarPantalla('login');
    }
}

async function loginUnificado() {
    const codigo = document.getElementById('input-codigo-acceso').value.trim();

    if (!codigo) {
        mostrarErrorLogin('Ingresa tu código de acceso');
        return;
    }

    // Intentar primero como ROOT
    try {
        const resRoot = await fetch(`${API}/api/auth/root`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ codigo })
        });

        if (resRoot.ok) {
            const data = await resRoot.json();
            TOKEN = data.token;
            USUARIO = data.usuario;
            sessionStorage.setItem('gl_token', TOKEN);
            sessionStorage.setItem('gl_usuario', JSON.stringify(USUARIO));
            mostrarPantalla('root');
            cargarEmpresas();
            mostrarToast('Acceso ROOT concedido', 'success');
            return;
        }
    } catch(e) { /* no es ROOT, continuar */ }

    // Intentar como usuario normal
    try {
        const res = await fetch(`${API}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ codigo_acceso: codigo })
        });

        const data = await res.json();

        if (!res.ok) {
            mostrarErrorLogin(data.error || 'Código inválido');
            return;
        }

        TOKEN = data.token;
        USUARIO = data.usuario;
        sessionStorage.setItem('gl_token', TOKEN);
        sessionStorage.setItem('gl_usuario', JSON.stringify(USUARIO));

        // Unirse al canal de la empresa via socket
        if (socket) {
            socket.emit('unirse_empresa', USUARIO.id_empresa);
        }

        abrirPanelPorRol();
        mostrarToast(`Bienvenido, ${USUARIO.nombre}`, 'success');
    } catch(err) {
        mostrarErrorLogin('Error de conexión');
    }
}

function abrirPanelPorRol() {
    if (!USUARIO) return;
    
    // Asegurarse de re-unirse al canal de la empresa en caso de recargar la página (F5)
    if (socket && USUARIO.id_empresa) {
        socket.emit('unirse_empresa', USUARIO.id_empresa);
    }

    if (USUARIO.rol === 'ADMIN' || USUARIO.rol === 'GERENTE') {
        mostrarPantalla('admin');

        const esGerente = USUARIO.rol === 'GERENTE' && !esUsuarioRRHH() && USUARIO.nombre_departamento;

        // Izquierda: empresa + gerencia debajo (solo para gerente)
        document.getElementById('admin-empresa-nombre').textContent = USUARIO.nombre_empresa || 'Empresa';
        const deptoEl = document.getElementById('admin-depto-nombre');
        if (deptoEl) {
            if (esGerente) {
                deptoEl.textContent = USUARIO.nombre_departamento;
                deptoEl.style.display = 'block';
            } else {
                deptoEl.style.display = 'none';
            }
        }

        // Derecha: solo el nombre del usuario (sin repetir gerencia)
        document.getElementById('admin-user-name').textContent = USUARIO.nombre;

        const rolBadge = document.getElementById('admin-role-badge');
        if (rolBadge) {
            rolBadge.textContent = (USUARIO.rol === 'ADMIN' || USUARIO.rol === 'ROOT') ? 'DIRECTOR GENERAL' : 'GERENTE';
        }

        actualizarVisibilidadCreacion();
        // Gerente → panel de gráficas; Admin → panel de tareas
        cambiarPanelAdmin(USUARIO.rol === 'GERENTE' ? 'graficas-gerencia' : 'tareas');
    } else if (USUARIO.rol === 'SUPERVISOR') {
        mostrarPantalla('supervisor');
        // Derecha: solo el nombre del supervisor
        document.getElementById('sup-user-name').textContent = USUARIO.nombre;
        // Izquierda: empresa arriba, gerencia/departamento abajo
        document.getElementById('sup-empresa-nombre').textContent = USUARIO.nombre_empresa || 'Empresa';
        const supDeptoEl = document.getElementById('sup-depto-nombre');
        if (supDeptoEl) supDeptoEl.textContent = USUARIO.nombre_departamento || '';
        actualizarVisibilidadCreacion();
        cargarTareasEmpleado(); // Igual que empleado
        verificarEstadoCheckin();
        verificarUbicacionFija();
        iniciarAlertasEmpleado(); // Alertas de tareas asignadas al supervisor
        // GPS Geofencing
        verificarAccesoGPS().then(ok => { if (ok) iniciarMonitoreoGPS(); });
    } else if (USUARIO.rol === 'EMPLEADO') {
        mostrarPantalla('empleado');
        document.getElementById('emp-panel-user-name').textContent = USUARIO.nombre;
        document.getElementById('emp-panel-empresa-nombre').textContent = USUARIO.nombre_empresa || 'Empresa';
        cargarTareasEmpleado();
        verificarEstadoCheckin();
        verificarUbicacionFija();
        iniciarAlertasEmpleado();
        // GPS Geofencing
        verificarAccesoGPS().then(ok => { if (ok) iniciarMonitoreoGPS(); });
    }
}

function formatearTiempo(mins) {
    if (!mins) return '';
    if (mins >= 1440 && mins % 1440 === 0) {
        const d = mins / 1440;
        return `${d} día${d !== 1 ? 's' : ''}`;
    }
    if (mins >= 60 && mins % 60 === 0) {
        const h = mins / 60;
        return `${h} h`;
    }
    if (mins > 60) {
        const h = Math.floor(mins/60);
        const m = Math.round(mins%60);
        return `${h}h ${m}m`;
    }
    return `${mins} min`;
}

function cerrarSesion() {
    TOKEN = null;
    USUARIO = null;
    sessionStorage.removeItem('gl_token');
    sessionStorage.removeItem('gl_usuario');
    document.getElementById('input-codigo-acceso').value = '';
    mostrarPantalla('login');
    mostrarToast('Sesión cerrada', 'info');
}

// Función global para normalizar fechas de la DB a objeto Date local de forma segura (previene crash en iOS Safari)
function parseFechaDBSeguro(str) {
    if (!str) return null;
    let s = str.trim();
    // Si la base de datos devuelve solo la fecha (ej. tareas de calendario "YYYY-MM-DD")
    if (s.length === 10 && s.includes('-')) {
        // Para evitar desplazamientos de zona horaria, tratamos YYYY-MM-DD como mediodía local
        // o simplemente dejamos que el constructor de Date lo maneje. 
        // En Safari, "YYYY-MM-DD" se interpreta como UTC si no hay T.
        // Lo forzamos a un formato que Safari acepte como local: "YYYY/MM/DD 00:00:00"
        s = s.replace(/-/g, '/') + ' 00:00:00';
    } else {
        if (s.includes(' ') && !s.includes('T')) s = s.replace(' ', 'T');
        // Si tiene T pero no zona, Safari puede fallar o asumir UTC.
        // Intentamos normalizar a un formato estándar sin forzar Z si queremos local.
    }
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
}

// ═══════════════════════════════════════════
// PANEL ROOT - EMPRESAS
// ═══════════════════════════════════════════
function cambiarVistaRoot(vista) {
    document.querySelectorAll('.vista').forEach(v => v.classList.remove('activa'));
    document.getElementById(`vista-${vista}`).classList.add('activa');

    document.querySelectorAll('.menu-item').forEach(m => m.classList.remove('activo'));
    document.querySelector(`[data-view="${vista}"]`).classList.add('activo');

    if (vista === 'empresas') cargarEmpresas();
    if (vista === 'crear-empresa') {
        document.getElementById('form-empresa').reset();
        document.getElementById('form-empresa').style.display = 'block';
        document.getElementById('resultado-empresa').style.display = 'none';
    }
}

async function cargarEmpresas() {
    try {
        const empresas = await fetchAPI('/api/empresas');
        const container = document.getElementById('lista-empresas');

        if (!empresas.length) {
            container.innerHTML = `
                <div class="empty-state">
                    <svg width="64" height="64" fill="currentColor" opacity="0.3" viewBox="0 0 24 24"><path d="M12 7V3H2v18h20V7H12zM6 19H4v-2h2v2zm0-4H4v-2h2v2zm0-4H4V9h2v2zm0-4H4V5h2v2zm4 12H8v-2h2v2zm0-4H8v-2h2v2zm0-4H8V9h2v2zm0-4H8V5h2v2zm10 12h-8v-2h2v-2h-2v-2h2v-2h-2V9h8v10z"/></svg>
                    <p>No hay empresas registradas</p>
                    <button class="btn btn-primary btn-sm" onclick="cambiarVistaRoot('crear-empresa')">Crear primera empresa</button>
                </div>
            `;
            return;
        }

        container.innerHTML = empresas.map(e => `
            <div class="empresa-card glass">
                <div class="empresa-card-header" style="cursor:pointer" onclick="editarEmpresa('${e.id_empresa}')">
                    <div class="empresa-avatar">${e.nombre.charAt(0)}</div>
                    <div style="flex:1">
                        <h4>${e.nombre}</h4>
                        <span class="empresa-id">${e.identificacion_empresa || 'Sin ID'}</span>
                    </div>
                    <span style="font-size:0.7rem;padding:2px 8px;border-radius:12px;background:${e.estado === 1 ? 'rgba(0,200,83,0.2)' : 'rgba(255,82,82,0.2)'};color:${e.estado === 1 ? '#00c853' : '#ff5252'}">${e.estado === 1 ? '✅ Activa' : '⛔ Inactiva'}</span>
                </div>
                <div class="empresa-card-body">
                    <span class="empresa-stat">👤 ${e.total_supervisores || 0} Supervisores</span>
                    <span class="empresa-stat">👥 ${e.total_empleados || 0} Empleados</span>
                    <span class="empresa-stat">📋 ${e.total_usuarios || 0} Total</span>
                </div>
                <div class="empresa-card-footer" style="justify-content:space-between;align-items:center">
                    <span class="empresa-codigo">🔑 ${e.codigo_admin}</span>
                    <div style="display:flex;gap:6px">
                        <button style="background:rgba(255,255,255,0.1);border:none;padding:4px 8px;border-radius:6px;cursor:pointer;font-size:0.85rem" onclick="editarEmpresa('${e.id_empresa}')" title="Editar">✏️</button>
                        <button style="background:rgba(255,255,255,0.1);border:none;padding:4px 8px;border-radius:6px;cursor:pointer;font-size:0.85rem" onclick="toggleEstadoEmpresa('${e.id_empresa}', ${e.estado})" title="${e.estado === 1 ? 'Desactivar' : 'Activar'}">${e.estado === 1 ? '⏸️' : '▶️'}</button>
                        <button style="background:rgba(255,82,82,0.15);border:none;padding:4px 8px;border-radius:6px;cursor:pointer;font-size:0.85rem" onclick="eliminarEmpresa('${e.id_empresa}', '${e.nombre}')" title="Eliminar">🗑️</button>
                    </div>
                </div>
            </div>
        `).join('');

    } catch(err) {
        console.error('Error cargando empresas:', err);
    }
}

function previsualizarLogo(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        const preview = document.getElementById('emp-logo-preview');
        preview.src = e.target.result;
        preview.style.display = 'block';
        document.getElementById('emp-logo-text').textContent = file.name;
    };
    reader.readAsDataURL(file);
}

// ═══════════════════════════════════════════
// STEPPER - Navegación
// ═══════════════════════════════════════════
let pasoActual = 1;
const TOTAL_PASOS = 2;

function irPasoStepper(n) {
    if (n < 1 || n > TOTAL_PASOS) return;
    // Validar paso actual antes de avanzar
    if (n > pasoActual && !validarPaso(pasoActual)) return;
    
    document.querySelectorAll('.stepper-paso').forEach(p => p.style.display = 'none');
    document.getElementById(`paso-${n}`).style.display = 'block';
    
    // Actualizar indicadores
    document.querySelectorAll('.step-indicator').forEach((ind, i) => {
        ind.classList.remove('activo', 'completado');
        if (i + 1 === n) ind.classList.add('activo');
        else if (i + 1 < n) ind.classList.add('completado');
    });
    document.querySelectorAll('.step-line').forEach((line, i) => {
        line.classList.toggle('activo', i + 1 < n);
    });
    
    pasoActual = n;
    
    // Al entrar al paso 2, cargar departamentos según país
    if (n === 2) actualizarDepartamentos();
}

function siguientePaso() { irPasoStepper(pasoActual + 1); }
function anteriorPaso() { irPasoStepper(pasoActual - 1); }

function validarPaso(n) {
    if (n === 1) {
        const nombre = document.getElementById('emp-nombre').value.trim();
        const pais = document.getElementById('emp-pais').value;
        const dirGen = document.getElementById('dg-nombre').value.trim();
        if (!nombre) { mostrarToast('Nombre de empresa es requerido', 'error'); return false; }
        if (!pais) { mostrarToast('Selecciona un país', 'error'); return false; }
        if (!dirGen) { mostrarToast('Nombre del Director General es requerido', 'error'); return false; }
        return true;
    }
    return true;
}

// ═══════════════════════════════════════════
// DEPARTAMENTOS / MUNICIPIOS POR PAÍS
// ═══════════════════════════════════════════
const DATOS_PAISES = {
    GT: {
        label: 'Departamento', labelM: 'Municipio',
        deptos: {
            'Guatemala': ['Guatemala','Mixco','Villa Nueva','San Miguel Petapa','Amatitlán','Chinautla','Santa Catarina Pinula','Villa Canales','Fraijanes','San José Pinula','San Juan Sacatepéquez','San Pedro Ayampuc','San Pedro Sacatepéquez','San Raymundo','Chuarrancho','Palencia'],
            'Sacatepéquez': ['Antigua Guatemala','Jocotenango','Ciudad Vieja','San Lucas Sacatepéquez','Sumpango','Santo Domingo Xenacoj','Santiago Sacatepéquez'],
            'Chimaltenango': ['Chimaltenango','San Martín Jilotepeque','San Juan Comalapa','Patzún','Tecpán Guatemala','Patzicía'],
            'Escuintla': ['Escuintla','Santa Lucía Cotzumalguapa','Siquinalá','Tiquisate','La Democracia','La Gomera','Puerto San José'],
            'Quetzaltenango': ['Quetzaltenango','Salcajá','Olintepeque','San Carlos Sija','Almolonga','Cantel','Coatepeque','Colomba','San Juan Ostuncalco'],
            'Huehuetenango': ['Huehuetenango','Chiantla','Santa Cruz Barillas','Jacaltenango','Soloma','San Pedro Necta'],
            'San Marcos': ['San Marcos','San Pedro Sacatepéquez','Malacatán','Pajapita','Ayutla','Catarina'],
            'Alta Verapaz': ['Cobán','San Pedro Carchá','San Cristóbal Verapaz','Tactic','Tucurú','Chahal'],
            'Baja Verapaz': ['Salamá','Rabinal','Cubulco','Granados','Purulhá','San Miguel Chicaj'],
            'Petén': ['Flores','San Benito','Santa Elena','La Libertad','San Francisco','Sayaxché','Melchor de Mencos'],
            'Izabal': ['Puerto Barrios','Livingston','Morales','Los Amates','El Estor'],
            'Zacapa': ['Zacapa','Estanzuela','Río Hondo','Gualán','Teculután','Huité'],
            'Chiquimula': ['Chiquimula','Esquipulas','Jocotán','Camotán','Olopa','Quezaltepeque'],
            'Jalapa': ['Jalapa','San Pedro Pinula','Monjas','San Manuel Chaparrón'],
            'Jutiapa': ['Jutiapa','Asunción Mita','Santa Catarina Mita','Agua Blanca','Moyuta','El Progreso'],
            'Santa Rosa': ['Cuilapa','Barberena','Santa Rosa de Lima','Guazacapán','Chiquimulilla','Taxisco'],
            'Sololá': ['Sololá','Panajachel','Santiago Atitlán','San Pedro La Laguna','San Lucas Tolimán'],
            'Totonicapán': ['Totonicapán','San Cristóbal Totonicapán','Momostenango','San Francisco El Alto'],
            'Quiché': ['Santa Cruz del Quiché','Chichicastenango','Nebaj','Uspantán','Sacapulas','Joyabaj'],
            'Suchitepéquez': ['Mazatenango','San Antonio Suchitepéquez','Chicacao','Patulul','Santo Tomás La Unión'],
            'Retalhuleu': ['Retalhuleu','Champerico','San Sebastián','Santa Cruz Muluá','San Martín Zapotitlán'],
            'El Progreso': ['Guastatoya','Morazán','San Agustín Acasaguastlán','San Cristóbal Acasaguastlán','El Jícaro','Sansare']
        }
    },
    MX: {
        label: 'Estado', labelM: 'Municipio',
        deptos: {
            'Aguascalientes': ['Aguascalientes','Jesús María','Calvillo','Rincón de Romos'],
            'Baja California': ['Tijuana','Mexicali','Ensenada','Rosarito','Tecate'],
            'Baja California Sur': ['La Paz','Los Cabos','Comondú','Loreto'],
            'Campeche': ['Campeche','Ciudad del Carmen','Champotón','Calkiní'],
            'Chiapas': ['Tuxtla Gutiérrez','San Cristóbal de las Casas','Tapachula','Comitán','Palenque'],
            'Chihuahua': ['Chihuahua','Ciudad Juárez','Delicias','Cuauhtémoc','Parral'],
            'Ciudad de México': ['Álvaro Obregón','Benito Juárez','Coyoacán','Cuauhtémoc','Gustavo A. Madero','Iztapalapa','Miguel Hidalgo','Tlalpan','Xochimilco'],
            'Coahuila': ['Saltillo','Torreón','Monclova','Piedras Negras','Acuña'],
            'Colima': ['Colima','Manzanillo','Tecomán','Villa de Álvarez'],
            'Durango': ['Durango','Gómez Palacio','Lerdo','Santiago Papasquiaro'],
            'Estado de México': ['Toluca','Naucalpan','Ecatepec','Tlalnepantla','Nezahualcóyotl','Huixquilucan'],
            'Guanajuato': ['León','Guanajuato','Irapuato','Celaya','Salamanca','San Miguel de Allende'],
            'Guerrero': ['Acapulco','Chilpancingo','Iguala','Taxco','Zihuatanejo'],
            'Hidalgo': ['Pachuca','Tulancingo','Tula','Huejutla'],
            'Jalisco': ['Guadalajara','Zapopan','Tlaquepaque','Puerto Vallarta','Tonalá','Tlajomulco'],
            'Michoacán': ['Morelia','Uruapan','Zamora','Lázaro Cárdenas','Pátzcuaro'],
            'Morelos': ['Cuernavaca','Jiutepec','Cuautla','Temixco'],
            'Nayarit': ['Tepic','Bahía de Banderas','Compostela','Santiago Ixcuintla'],
            'Nuevo León': ['Monterrey','San Pedro Garza García','San Nicolás','Guadalupe','Apodaca','Santa Catarina'],
            'Oaxaca': ['Oaxaca de Juárez','Salina Cruz','Juchitán','Huatulco','Tuxtepec'],
            'Puebla': ['Puebla','Tehuacán','San Andrés Cholula','Atlixco','San Martín Texmelucan'],
            'Querétaro': ['Querétaro','San Juan del Río','El Marqués','Corregidora'],
            'Quintana Roo': ['Cancún','Playa del Carmen','Chetumal','Tulum','Cozumel'],
            'San Luis Potosí': ['San Luis Potosí','Ciudad Valles','Soledad','Matehuala'],
            'Sinaloa': ['Culiacán','Mazatlán','Los Mochis','Guasave','Navolato'],
            'Sonora': ['Hermosillo','Ciudad Obregón','Nogales','Guaymas','Navojoa'],
            'Tabasco': ['Villahermosa','Cárdenas','Comalcalco','Macuspana'],
            'Tamaulipas': ['Reynosa','Matamoros','Tampico','Nuevo Laredo','Ciudad Victoria'],
            'Tlaxcala': ['Tlaxcala','Apizaco','Huamantla','Chiautempan'],
            'Veracruz': ['Veracruz','Xalapa','Coatzacoalcos','Córdoba','Poza Rica','Boca del Río'],
            'Yucatán': ['Mérida','Valladolid','Progreso','Tizimín','Umán'],
            'Zacatecas': ['Zacatecas','Fresnillo','Guadalupe','Jerez','Río Grande']
        }
    },
    SV: {
        label: 'Departamento', labelM: 'Municipio',
        deptos: {
            'San Salvador': ['San Salvador','Mejicanos','Soyapango','Apopa','Ilopango','Ciudad Delgado','Ayutuxtepeque'],
            'La Libertad': ['Santa Tecla','Antiguo Cuscatlán','Ciudad Arce','Colón','Quezaltepeque','San Juan Opico'],
            'Santa Ana': ['Santa Ana','Metapán','Chalchuapa','Texistepeque','Candelaria de la Frontera'],
            'San Miguel': ['San Miguel','Ciudad Barrios','Chinameca','Moncagua'],
            'Usulután': ['Usulután','Jiquilisco','Santiago de María','Berlín'],
            'Sonsonate': ['Sonsonate','Izalco','Nahuizalco','Acajutla'],
            'La Paz': ['Zacatecoluca','San Luis Talpa','Olocuilta','Santiago Nonualco'],
            'Chalatenango': ['Chalatenango','Nueva Concepción','La Palma','Tejutla'],
            'Cuscatlán': ['Cojutepeque','Suchitoto','San Pedro Perulapán'],
            'Ahuachapán': ['Ahuachapán','Atiquizaya','Jujutla','Tacuba'],
            'San Vicente': ['San Vicente','Tecoluca','Apastepeque'],
            'La Unión': ['La Unión','Santa Rosa de Lima','Conchagua','El Carmen'],
            'Morazán': ['San Francisco Gotera','Jocoro','Sociedad','Corinto'],
            'Cabañas': ['Sensuntepeque','Ilobasco','Victoria','Jutiapa']
        }
    },
    HN: {
        label: 'Departamento', labelM: 'Municipio',
        deptos: {
            'Francisco Morazán': ['Tegucigalpa','Comayagüela','Valle de Ángeles','Santa Lucía'],
            'Cortés': ['San Pedro Sula','Puerto Cortés','Choloma','La Lima','Villanueva','Omoa'],
            'Atlántida': ['La Ceiba','Tela','El Porvenir','Jutiapa','San Francisco'],
            'Comayagua': ['Comayagua','Siguatepeque','La Paz','San Jerónimo'],
            'Olancho': ['Juticalpa','Catacamas','Campamento','San Francisco de la Paz'],
            'Choluteca': ['Choluteca','San Marcos de Colón','Pespire','Marcovia'],
            'Yoro': ['El Progreso','Yoro','Morazán','Olanchito','Santa Rita'],
            'Copán': ['Santa Rosa de Copán','Copán Ruinas','La Entrada','Florida'],
            'Lempira': ['Gracias','La Esperanza','Erandique','San Manuel Colohete'],
            'Intibucá': ['La Esperanza','Intibucá','Jesús de Otoro','San Juan'],
            'Valle': ['Nacaome','San Lorenzo','Amapala','Langue'],
            'Santa Bárbara': ['Santa Bárbara','San Pedro Zacapa','Macuelizo','Trinidad'],
            'La Paz': ['La Paz','Marcala','Santiago Puringla','San Pedro de Tutule'],
            'Ocotepeque': ['Ocotepeque','Nueva Ocotepeque','La Labor','Sinuapa'],
            'Colón': ['Trujillo','Tocoa','Sonaguera','Sabá'],
            'El Paraíso': ['Yuscarán','Danlí','El Paraíso','Trojes'],
            'Islas de la Bahía': ['Roatán','Utila','Guanaja','José Santos Guardiola'],
            'Gracias a Dios': ['Puerto Lempira','Brus Laguna','Ahuas','Juan Francisco Bulnes']
        }
    }
};

function actualizarDepartamentos() {
    const pais = document.getElementById('emp-pais').value;
    const selDepto = document.getElementById('emp-dir-depto');
    const selMuni = document.getElementById('emp-dir-muni');
    const grupoDepto = document.getElementById('grupo-dir-depto');
    const grupoMuni = document.getElementById('grupo-dir-muni');
    
    if (DATOS_PAISES[pais]) {
        const data = DATOS_PAISES[pais];
        // Cambiar labels
        grupoDepto.querySelector('label').textContent = data.label;
        grupoMuni.querySelector('label').textContent = data.labelM;
        // Convertir a select
        selDepto.innerHTML = '<option value="">Seleccionar...</option>';
        Object.keys(data.deptos).sort().forEach(d => {
            selDepto.innerHTML += `<option value="${d}">${d}</option>`;
        });
        selDepto.disabled = false;
        selMuni.innerHTML = '<option value="">Seleccionar...</option>';
    } else {
        // País sin datos: convertir a texto libre
        grupoDepto.querySelector('label').textContent = 'Estado / Provincia';
        grupoMuni.querySelector('label').textContent = 'Ciudad';
        selDepto.innerHTML = '<option value="">Escribir manualmente...</option>';
        selMuni.innerHTML = '<option value="">Escribir manualmente...</option>';
    }
}

function actualizarMunicipios() {
    const pais = document.getElementById('emp-pais').value;
    const depto = document.getElementById('emp-dir-depto').value;
    const selMuni = document.getElementById('emp-dir-muni');
    
    selMuni.innerHTML = '<option value="">Seleccionar...</option>';
    if (DATOS_PAISES[pais] && DATOS_PAISES[pais].deptos[depto]) {
        DATOS_PAISES[pais].deptos[depto].forEach(m => {
            selMuni.innerHTML += `<option value="${m}">${m}</option>`;
        });
    }
}

// ═══════════════════════════════════════════
// GERENCIAS DINÁMICAS
// ═══════════════════════════════════════════
let contadorGerencias = 0;

function agregarGerenciaCompleta(nombre = '') {
    contadorGerencias++;
    const lista = document.getElementById('lista-gerencias-completas');
    const div = document.createElement('div');
    div.className = 'gerencia-card-completa';
    div.id = `gerencia-c-${contadorGerencias}`;
    const n = contadorGerencias;
    div.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
            <div style="display:flex;align-items:center;gap:8px;flex:1;">
                <span style="font-size:1.1rem;">🏢</span>
                <input type="text" class="gc-nombre" placeholder="Nombre de la gerencia" value="${nombre}" style="flex:1;font-weight:600;font-size:0.95rem;">
            </div>
            <button type="button" style="background:#ef4444;color:white;border:none;border-radius:6px;width:30px;height:30px;cursor:pointer;font-size:0.9rem;" onclick="eliminarGerenciaCompleta(${n})">✕</button>
        </div>
        <p style="font-size:0.78rem;color:var(--text-muted);margin-bottom:8px;border-top:1px solid var(--border-color);padding-top:8px;">👤 Responsable de la Gerencia:</p>
        <div class="form-grid" style="gap:8px;">
            <div class="form-group">
                <label style="font-size:0.75rem;">Nombre *</label>
                <input type="text" class="gc-resp-nombre" placeholder="Nombre del Gerente">
            </div>
            <div class="form-group">
                <label style="font-size:0.75rem;">Teléfono</label>
                <input type="tel" class="gc-resp-telefono" placeholder="Teléfono">
            </div>
            <div class="form-group">
                <label style="font-size:0.75rem;">Correo</label>
                <input type="email" class="gc-resp-correo" placeholder="correo@empresa.com">
            </div>
            <div class="form-group">
                <label style="font-size:0.75rem;">Profesión</label>
                <input type="text" class="gc-resp-profesion" placeholder="Ej: Lic. Administración">
            </div>
            <div class="form-group full-width">
                <label style="font-size:0.75rem;">Dirección</label>
                <input type="text" class="gc-resp-direccion" placeholder="Dirección del responsable">
            </div>
        </div>
    `;
    lista.appendChild(div);
    document.getElementById('sin-gerencias-msg').style.display = 'none';
    if (!nombre) div.querySelector('.gc-nombre').focus();
}

function sugerirGerenciaCompleta(nombre) {
    agregarGerenciaCompleta(nombre);
    document.querySelectorAll('#gerencias-sugerencias .btn-sugerencia').forEach(btn => {
        const onclickStr = btn.getAttribute('onclick') || '';
        if (onclickStr.includes(nombre)) btn.classList.add('usada');
    });
}

function eliminarGerenciaCompleta(id) {
    const el = document.getElementById(`gerencia-c-${id}`);
    if (el) {
        const nombre = el.querySelector('.gc-nombre').value;
        el.remove();
        document.querySelectorAll('#gerencias-sugerencias .btn-sugerencia').forEach(btn => {
            const onclickStr = btn.getAttribute('onclick') || '';
            if (onclickStr.includes(nombre)) btn.classList.remove('usada');
        });
    }
    if (!document.getElementById('lista-gerencias-completas').children.length) {
        document.getElementById('sin-gerencias-msg').style.display = 'block';
    }
}

function obtenerGerenciasCompletas() {
    const items = document.querySelectorAll('.gerencia-card-completa');
    return Array.from(items).map(item => ({
        nombre_gerencia: item.querySelector('.gc-nombre').value.trim(),
        responsable: {
            nombre: item.querySelector('.gc-resp-nombre').value.trim(),
            telefono: item.querySelector('.gc-resp-telefono').value.trim(),
            correo: item.querySelector('.gc-resp-correo').value.trim(),
            profesion: item.querySelector('.gc-resp-profesion').value.trim(),
            direccion: item.querySelector('.gc-resp-direccion').value.trim()
        }
    })).filter(g => g.nombre_gerencia);
}

// ═══════════════════════════════════════════
// VALIDACIÓN NIT GUATEMALA
// ═══════════════════════════════════════════
function validarNIT(input) {
    const pais = document.getElementById('emp-pais').value;
    const feedback = document.getElementById('nit-feedback');
    if (pais !== 'GT' || !input.value.trim()) {
        feedback.textContent = '';
        return;
    }
    const nit = input.value.replace(/[^0-9kK-]/g, '');
    if (/^\d{6,10}-?[\dkK]$/.test(nit)) {
        feedback.textContent = '✅ Formato NIT válido';
        feedback.style.color = '#10b981';
    } else {
        feedback.textContent = '⚠️ Formato: 1234567-8';
        feedback.style.color = '#f59e0b';
    }
}

// ══════════════════════════════════════════════════════════════
// TABS DE OBSERVACIONES Y CLIENTE (modal detalle de tarea)
// ══════════════════════════════════════════════════════════════

function cambiarTabDetalle(tab, btn) {
    const tabs = ['comentarios','evidencias','historial','observaciones','cliente'];
    tabs.forEach(t => {
        const el = document.getElementById(`tab-${t}`);
        if (el) el.style.display = 'none';
    });
    const target = document.getElementById(`tab-${tab}`);
    if (target) target.style.display = 'block';
    document.querySelectorAll('#modal-detalle-tarea .nav-btn').forEach(b => b.classList.remove('activo'));
    if (btn) btn.classList.add('activo');
}

let _detalleActualId = null;
let _detalleActualTarea = null;

async function inicializarTabsExtra(tarea) {
    _detalleActualId = tarea.id_tarea;
    _detalleActualTarea = tarea;

    const obsEl = document.getElementById('detalle-obs-texto');
    if (obsEl) {
        obsEl.value = tarea.observaciones_tarea || '';
        const esEmpleadoAsignado = USUARIO.id_usuario === tarea.id_empleado;
        obsEl.readOnly = !esEmpleadoAsignado;
        obsEl.style.opacity = esEmpleadoAsignado ? '1' : '0.7';
        obsEl.placeholder = esEmpleadoAsignado ? 'Escribe tus observaciones...' : `Observaciones del empleado: ${tarea.nombre_empleado || ''}`;
    }

    const inputResp = document.getElementById('obs-respuesta-input');
    if (inputResp) {
        inputResp.style.display = (USUARIO.rol === 'SUPERVISOR' || USUARIO.rol === 'ADMIN' || USUARIO.rol === 'GERENTE') ? 'flex' : 'none';
    }

    await cargarRespuestasObservaciones(tarea.id_tarea, tarea);

    const tabBtnCliente = document.getElementById('tab-btn-cliente');
    if (tabBtnCliente) {
        if (tarea.tiene_cliente && parseInt(tarea.tiene_cliente) === 1) {
            tabBtnCliente.style.display = 'inline-flex';
            renderClienteTab(tarea);
        } else {
            tabBtnCliente.style.display = 'none';
        }
    }
}

function renderClienteTab(tarea) {
    const cont = document.getElementById('detalle-cliente-contenido');
    if (!cont) return;
    const concluido = tarea.cliente_concluido && parseInt(tarea.cliente_concluido) === 1;
    cont.innerHTML = `
        <div class="glass" style="padding:16px;border-radius:12px;margin-bottom:12px;border:1px solid rgba(16,185,129,0.2);">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;">
                <div>
                    <div style="font-size:1.1rem;font-weight:700;">${tarea.nombre_cliente || '—'}</div>
                    <div style="font-size:0.72rem;color:#10b981;font-weight:600;letter-spacing:1px;">Código: ${tarea.codigo_cliente || '—'}</div>
                </div>
                <span style="padding:4px 10px;border-radius:99px;font-size:0.72rem;font-weight:700;background:${concluido?'rgba(16,185,129,0.15)':'rgba(245,158,11,0.15)'};color:${concluido?'#10b981':'#f59e0b'};">
                    ${concluido ? '✅ ATENDIDO' : '⏳ PENDIENTE'}
                </span>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;font-size:0.82rem;">
                ${tarea.telefono_cliente ? `<div><span style="color:var(--text-muted);">📞 Teléfono:</span><br><strong>${tarea.telefono_cliente}</strong></div>` : ''}
                ${tarea.correo_cliente ? `<div><span style="color:var(--text-muted);">✉️ Correo:</span><br><strong>${tarea.correo_cliente}</strong></div>` : ''}
                ${tarea.fecha_seguimiento ? `<div style="grid-column:1/-1;"><span style="color:var(--text-muted);">📅 Seguimiento programado:</span><br><strong style="color:#f59e0b;">${tarea.fecha_seguimiento}</strong></div>` : ''}
            </div>
            ${tarea.obs_cliente ? `<div style="background:rgba(255,255,255,0.04);border-radius:8px;padding:10px;font-size:0.82rem;margin-bottom:12px;"><div style="color:var(--text-muted);font-size:0.72rem;margin-bottom:4px;">Observaciones:</div>${tarea.obs_cliente}</div>` : ''}
            <div style="border-top:1px solid var(--border-color);padding-top:12px;margin-top:4px;">
                <div style="display:grid;grid-template-columns:1fr auto;gap:8px;margin-bottom:8px;align-items:end;">
                    <div>
                        <label style="font-size:0.72rem;color:var(--text-muted);">📅 Nueva Fecha de Seguimiento</label>
                        <input type="date" id="cliente-nueva-fecha" style="width:100%;" value="${tarea.fecha_seguimiento||''}">
                    </div>
                    <button class="btn btn-sm" style="background:linear-gradient(135deg,#6366f1,#4f46e5);color:white;" onclick="actualizarSeguimientoCliente()">📅 Programar</button>
                </div>
                <textarea id="cliente-nueva-obs" rows="2" placeholder="Actualizar observaciones..." style="width:100%;resize:vertical;margin-bottom:8px;">${tarea.obs_cliente||''}</textarea>
                <div style="display:flex;gap:8px;justify-content:flex-end;">
                    <button class="btn btn-sm" style="background:rgba(255,255,255,0.07);" onclick="actualizarSeguimientoCliente()">💾 Guardar</button>
                    ${!concluido ? `<button class="btn btn-sm" style="background:linear-gradient(135deg,#10b981,#059669);color:white;" onclick="marcarClienteConcluido()">✅ Evento Concluido</button>` : '<span style="font-size:0.8rem;color:#10b981;">✅ Evento ya concluido</span>'}
                </div>
            </div>
        </div>`;
}

async function marcarClienteConcluido() {
    if (!_detalleActualId) return;
    if (!confirm('¿Marcar el evento con este cliente como concluido?')) return;
    try {
        await fetchAPI(`/api/tareas/${_detalleActualId}/cliente-concluido`, { method: 'PUT' });
        mostrarToast('✅ Evento con cliente marcado como concluido', 'success');
        if (_detalleActualTarea) { _detalleActualTarea.cliente_concluido = 1; renderClienteTab(_detalleActualTarea); }
    } catch(e) { mostrarToast(e.message, 'error'); }
}

async function actualizarSeguimientoCliente() {
    if (!_detalleActualId) return;
    const obs = document.getElementById('cliente-nueva-obs')?.value || '';
    const fecha = document.getElementById('cliente-nueva-fecha')?.value || '';
    try {
        const resp = await fetchAPI(`/api/tareas/${_detalleActualId}/seguimiento-cliente`, {
            method: 'PUT', body: JSON.stringify({ obs_cliente: obs, fecha_seguimiento: fecha || null })
        });
        if (_detalleActualTarea) { _detalleActualTarea.obs_cliente = obs; _detalleActualTarea.fecha_seguimiento = fecha; renderClienteTab(_detalleActualTarea); }
        mostrarToast(resp.nueva_tarea_id ? '📅 Seguimiento guardado y nueva tarea creada automáticamente ✅' : 'Seguimiento actualizado', 'success');
    } catch(e) { mostrarToast(e.message, 'error'); }
}

let _obsGuardarTimer = null;
function autoguardarObservaciones() {
    clearTimeout(_obsGuardarTimer);
    _obsGuardarTimer = setTimeout(() => guardarObservaciones(true), 2000);
}

async function guardarObservaciones(silente = false) {
    if (!_detalleActualId) return;
    const texto = document.getElementById('detalle-obs-texto')?.value || '';
    try {
        await fetchAPI(`/api/tareas/${_detalleActualId}/observaciones`, { method: 'PUT', body: JSON.stringify({ observaciones_tarea: texto }) });
        if (!silente) mostrarToast('📝 Observaciones guardadas', 'success');
    } catch(e) { if (!silente) mostrarToast(e.message, 'error'); }
}

async function cargarRespuestasObservaciones(idTarea) {
    const cont = document.getElementById('lista-obs-respuestas');
    if (!cont) return;
    try {
        const tarea = await fetchAPI(`/api/tareas/${idTarea}`);
        const comentarios = (tarea.comentarios || []).filter(c =>
            c.rol_usuario === 'SUPERVISOR' || c.rol_usuario === 'ADMIN' || c.rol_usuario === 'GERENTE'
        );
        if (!comentarios.length) { cont.innerHTML = '<div style="font-size:0.78rem;color:var(--text-muted);">Sin respuestas aún.</div>'; return; }
        cont.innerHTML = comentarios.map(c => `
            <div style="background:rgba(99,102,241,0.08);border-radius:8px;padding:8px 12px;border-left:3px solid #6366f1;">
                <div style="font-size:0.72rem;color:#6366f1;font-weight:600;margin-bottom:2px;">
                    ${c.nombre_usuario} · ${c.rol_usuario}
                    <span style="color:var(--text-muted);margin-left:6px;">${new Date(c.fecha).toLocaleString('es-MX',{hour:'2-digit',minute:'2-digit',day:'numeric',month:'short'})}</span>
                </div>
                <div style="font-size:0.82rem;">${c.contenido}</div>
            </div>`).join('');
    } catch(e) { cont.innerHTML = ''; }
}

async function enviarRespuestaObs() {
    const input = document.getElementById('input-obs-respuesta');
    if (!input || !input.value.trim() || !_detalleActualId) return;
    try {
        await fetchAPI(`/api/tareas/${_detalleActualId}/comentarios`, {
            method: 'POST', body: JSON.stringify({ contenido: `[Respuesta] ${input.value.trim()}` })
        });
        input.value = '';
        await cargarRespuestasObservaciones(_detalleActualId);
        mostrarToast('Respuesta enviada', 'success');
    } catch(e) { mostrarToast(e.message, 'error'); }
}

// ═══════════════════════════════════════════
// OBSERVACIONES INLINE (Empleado/Supervisor)
// ═══════════════════════════════════════════
let _obsInlineTimers = {};

function toggleObsInline(idTarea) {
    const panel = document.getElementById(`obs-inline-${idTarea}`);
    if (!panel) return;
    if (panel.style.display === 'none') {
        // Cerrar cualquier otro panel abierto
        document.querySelectorAll('.obs-inline-panel').forEach(p => {
            if (p.id !== `obs-inline-${idTarea}`) p.style.display = 'none';
        });
        panel.style.display = 'block';
        const textarea = document.getElementById(`obs-text-${idTarea}`);
        if (textarea) textarea.focus();
    } else {
        panel.style.display = 'none';
    }
}

function autoguardarObsInline(idTarea) {
    clearTimeout(_obsInlineTimers[idTarea]);
    const status = document.getElementById(`obs-status-${idTarea}`);
    if (status) { status.textContent = '⏳ Guardando...'; status.style.color = '#f59e0b'; }
    _obsInlineTimers[idTarea] = setTimeout(() => guardarObsInline(idTarea, true), 2000);
}

async function guardarObsInline(idTarea, silente = false) {
    const textarea = document.getElementById(`obs-text-${idTarea}`);
    if (!textarea) return;
    const texto = textarea.value || '';
    const status = document.getElementById(`obs-status-${idTarea}`);
    try {
        await fetchAPI(`/api/tareas/${idTarea}/observaciones`, {
            method: 'PUT',
            body: JSON.stringify({ observaciones_tarea: texto })
        });
        if (status) { status.textContent = '✅ Guardado'; status.style.color = '#10b981'; }
        if (!silente) mostrarToast('📝 Observaciones guardadas', 'success');
        // Actualizar el badge del botón en la tarjeta
        const card = document.getElementById(`emp-card-${idTarea}`);
        if (card) {
            const btn = card.querySelector('[onclick*="toggleObsInline"]');
            if (btn) {
                const hasBadge = btn.querySelector('span[style*="background:#10b981"]');
                if (texto.trim() && !hasBadge) {
                    btn.insertAdjacentHTML('beforeend', ' <span style="background:#10b981;color:white;font-size:0.6rem;padding:1px 6px;border-radius:99px;font-weight:700;">✓</span>');
                } else if (!texto.trim() && hasBadge) {
                    hasBadge.remove();
                }
            }
        }
        // Limpiar status después de 3s
        setTimeout(() => { if (status) status.textContent = ''; }, 3000);
    } catch(e) {
        if (status) { status.textContent = '❌ Error'; status.style.color = '#ef4444'; }
        if (!silente) mostrarToast(e.message || 'Error al guardar observaciones', 'error');
    }
}

async function crearEmpresa(e) {
    if (e && e.preventDefault) e.preventDefault();

    // Validar datos mínimos
    const nombreEmpresa = document.getElementById('emp-nombre').value.trim();
    const dgNombreVal = document.getElementById('dg-nombre').value.trim();
    if (!nombreEmpresa) { mostrarToast('Nombre de empresa es requerido', 'error'); return; }
    if (!dgNombreVal) { mostrarToast('Nombre del Director General es requerido', 'error'); return; }

    const lada = document.getElementById('emp-lada')?.value || '+502';
    const telEmpresa = document.getElementById('emp-telefono')?.value.trim() || '';
    const dgLada = document.getElementById('dg-lada')?.value || lada;
    const dgTel = document.getElementById('dg-telefono')?.value.trim() || '';

    const datos = {
        nombre: nombreEmpresa,
        identificacion_empresa: document.getElementById('emp-identificacion')?.value.trim() || '',
        pais: document.getElementById('emp-pais')?.value || 'GT',
        moneda: document.getElementById('emp-moneda')?.value || 'GTQ',
        zona_horaria: document.getElementById('emp-zona-horaria')?.value || 'America/Guatemala',
        telefono: telEmpresa ? `${lada} ${telEmpresa}` : '',
        correo: document.getElementById('emp-correo')?.value.trim() || '',
        // Dirección estructurada
        direccion_departamento: document.getElementById('emp-dir-depto')?.value || '',
        direccion_municipio: document.getElementById('emp-dir-muni')?.value || '',
        direccion_zona: document.getElementById('emp-dir-zona')?.value.trim() || '',
        direccion_exacta: document.getElementById('emp-dir-exacta')?.value.trim() || '',
        direccion: [document.getElementById('emp-dir-exacta')?.value, document.getElementById('emp-dir-zona')?.value, document.getElementById('emp-dir-muni')?.value, document.getElementById('emp-dir-depto')?.value].filter(Boolean).join(', '),
        // Director General (persona completa)
        director_general: {
            nombre: dgNombreVal,
            identificacion: document.getElementById('dg-identificacion')?.value.trim() || '',
            telefono: dgTel ? `${dgLada} ${dgTel}` : '',
            correo: document.getElementById('dg-correo')?.value.trim() || '',
            profesion: document.getElementById('dg-profesion')?.value.trim() || ''
        },
        // Compat fields
        nombre_administrador: dgNombreVal,
        nombre_director_general: dgNombreVal,
        // No gerencias en creación (se configuran después por el Director General)
        gerencias: []
    };

    // Logo: convertir a base64 optimizado
    const logoInput = document.getElementById('emp-logo-input');
    if (logoInput && logoInput.files[0]) {
        try {
            datos.logo_url = await optimizarImagenBase64(logoInput.files[0]);
        } catch(e) { console.error('Error optimizando logo:', e); }
    }

    try {
        const res = await fetchAPI('/api/empresas', {
            method: 'POST',
            body: JSON.stringify(datos)
        });

        // Mostrar resultado con TODOS los códigos
        document.getElementById('form-empresa').style.display = 'none';
        document.getElementById('resultado-empresa').style.display = 'block';
        document.getElementById('res-empresa-nombre').textContent = res.empresa.nombre;
        document.getElementById('res-admin-nombre').textContent = res.director_general.nombre;
        document.getElementById('res-codigo-admin').textContent = res.director_general.codigo_acceso;

        // Mostrar códigos de gerentes si existen
        const gerentesDiv = document.getElementById('res-gerentes-codigos');
        if (gerentesDiv && res.gerentes && res.gerentes.length > 0) {
            gerentesDiv.innerHTML = '<h4 style="margin:16px 0 10px;color:var(--text-main);">🏢 Códigos de Gerentes:</h4>' +
                res.gerentes.map(g => `
                    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:var(--bg-card);border-radius:8px;margin-bottom:6px;border:1px solid var(--border-color);">
                        <div>
                            <strong style="font-size:0.9rem;">${g.gerencia}</strong>
                            <p style="font-size:0.78rem;color:var(--text-muted);margin:2px 0 0;">${g.nombre}</p>
                        </div>
                        <span class="empresa-codigo" style="font-size:1rem;letter-spacing:2px;">${g.codigo_acceso}</span>
                    </div>
                `).join('');
            gerentesDiv.style.display = 'block';
        }

        mostrarToast('¡Empresa creada exitosamente!', 'success');
    } catch(err) {
        mostrarToast(err.message || 'Error al crear empresa', 'error');
    }
}

function actualizarPais() {
    const sel = document.getElementById('emp-pais');
    const opt = sel.options[sel.selectedIndex];
    if (!opt || !opt.value) return;

    const lada = opt.dataset.lada || '+52';
    const moneda = opt.dataset.moneda || 'MXN';
    const zona = opt.dataset.zona || 'America/Mexico_City';

    // Actualizar ladas en ambos teléfonos
    document.getElementById('emp-lada').value = lada;
    const dgLada = document.getElementById('dg-lada');
    if (dgLada) dgLada.value = lada;

    // Actualizar moneda
    const selMoneda = document.getElementById('emp-moneda');
    for (let i = 0; i < selMoneda.options.length; i++) {
        if (selMoneda.options[i].value === moneda) {
            selMoneda.selectedIndex = i;
            break;
        }
    }

    // Actualizar zona horaria
    document.getElementById('emp-zona-horaria').value = zona;
}

function verEmpresas() {
    cambiarVistaRoot('empresas');
}

function verDetalleEmpresa(id) {
    editarEmpresa(id);
}

async function editarEmpresa(id) {
    try {
        const empresa = await fetchAPI(`/api/empresas/${id}`);
        if (empresa.error) return mostrarToast(empresa.error, 'error');

        // Navegar a la vista de crear empresa
        cambiarVistaRoot('crear-empresa');

        // Cambiar título y botón
        const vistaHeader = document.querySelector('#vista-crear-empresa .vista-header h3');
        if (vistaHeader) vistaHeader.innerHTML = '✏️ Editar Empresa';

        const btnSubmit = document.getElementById('btn-crear-empresa');
        if (btnSubmit) btnSubmit.innerHTML = '<svg width="18" height="18" fill="currentColor" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg> Guardar Cambios';

        // Pre-llenar datos de empresa
        document.getElementById('emp-nombre').value = empresa.nombre || '';
        document.getElementById('emp-identificacion').value = empresa.identificacion_empresa || '';
        document.getElementById('emp-correo').value = empresa.correo || '';

        // Director General
        const dirGenInput = document.getElementById('emp-director-general');
        if (dirGenInput) dirGenInput.value = empresa.nombre_director_general || empresa.nombre_administrador || '';

        // Dirección estructurada
        if (document.getElementById('emp-dir-zona')) {
            document.getElementById('emp-dir-zona').value = empresa.direccion_zona || '';
            document.getElementById('emp-dir-exacta').value = empresa.direccion_exacta || '';
        }

        // Logo existente
        const logoPreview = document.getElementById('emp-logo-preview');
        const logoText = document.getElementById('emp-logo-text');
        if (empresa.logo_url) {
            logoPreview.src = empresa.logo_url;
            logoPreview.style.display = 'block';
            logoText.textContent = '✅ Logo actual (click para cambiar)';
        } else {
            logoPreview.style.display = 'none';
            logoText.textContent = '📤 Click para subir logotipo (JPG, PNG, WebP)';
        }

        // País
        const paisSel = document.getElementById('emp-pais');
        if (paisSel && empresa.pais) {
            paisSel.value = empresa.pais;
            actualizarPais();
            // Cargar departamentos y seleccionar el guardado
            setTimeout(() => {
                actualizarDepartamentos();
                if (empresa.direccion_departamento) {
                    document.getElementById('emp-dir-depto').value = empresa.direccion_departamento;
                    actualizarMunicipios();
                    if (empresa.direccion_municipio) {
                        document.getElementById('emp-dir-muni').value = empresa.direccion_municipio;
                    }
                }
            }, 100);
        }

        // Zona horaria
        const zonaInput = document.getElementById('emp-zona-horaria');
        if (zonaInput && empresa.zona_horaria) zonaInput.value = empresa.zona_horaria;

        // Teléfono (separar lada del número si existe)
        if (empresa.telefono) {
            const partes = empresa.telefono.split(' ');
            if (partes.length >= 2) {
                document.getElementById('emp-lada').value = partes[0];
                document.getElementById('emp-telefono').value = partes.slice(1).join(' ');
            } else {
                document.getElementById('emp-telefono').value = empresa.telefono;
            }
        }

        // Moneda
        const monedaSel = document.getElementById('emp-moneda');
        if (monedaSel && empresa.moneda) monedaSel.value = empresa.moneda;

        // Pre-llenar datos del admin
        document.getElementById('admin-nombre').value = empresa.nombre_administrador || '';
        if (document.getElementById('admin-identificacion'))
            document.getElementById('admin-identificacion').value = '';
        if (document.getElementById('admin-correo'))
            document.getElementById('admin-correo').value = '';

        // Cargar gerencias existentes
        try {
            const deptos = await fetchAPI(`/api/empresas/${id}/departamentos`);
            if (Array.isArray(deptos) && deptos.length > 0) {
                document.getElementById('lista-gerencias').innerHTML = '';
                document.getElementById('sin-gerencias-msg').style.display = 'none';
                deptos.forEach(d => agregarGerencia(d.nombre, d.codigo_costos || ''));
            }
        } catch(e) { console.error('Error cargando gerencias:', e); }

        // Resetear stepper al paso 1
        pasoActual = 1;
        irPasoStepper(1);

        // Pre-llenar configuraciones
        if (empresa.configuracion) {
            const conf = empresa.configuracion;
            const cbSupAsignar = document.getElementById('cfg-sup-asignar');
            const cbSupTerminadas = document.getElementById('cfg-sup-ver-terminadas');
            const cbEmpIniciar = document.getElementById('cfg-emp-iniciar-tarea');
            const cbSupModificar = document.getElementById('cfg-sup-modificar');
            const selFormatoHora = document.getElementById('cfg-formato-hora');
            const selModalidad = document.getElementById('cfg-modalidad-trabajo');

            if (cbSupAsignar) cbSupAsignar.checked = conf.permite_supervisor_asignar !== 0;
            if (cbSupTerminadas) cbSupTerminadas.checked = conf.supervisor_ve_terminadas !== 0;
            if (cbEmpIniciar) cbEmpIniciar.checked = conf.empleado_puede_iniciar !== 0;
            if (cbSupModificar) cbSupModificar.checked = conf.supervisor_puede_modificar !== 0;
            if (selFormatoHora) selFormatoHora.value = conf.formato_hora || '12h';
            if (selModalidad) selModalidad.value = conf.modalidad_trabajo || 'fijo';
        }

        // Cambiar el handler del formulario
        const form = document.getElementById('form-empresa');
        form.onsubmit = async function(ev) {
            ev.preventDefault();
            const lada = document.getElementById('emp-lada').value;
            const tel = document.getElementById('emp-telefono').value.trim();

            const body = {
                nombre: document.getElementById('emp-nombre').value.trim(),
                identificacion_empresa: document.getElementById('emp-identificacion').value.trim(),
                pais: document.getElementById('emp-pais').value,
                moneda: document.getElementById('emp-moneda').value,
                zona_horaria: document.getElementById('emp-zona-horaria').value,
                telefono: tel ? `${lada} ${tel}` : '',
                correo: document.getElementById('emp-correo').value.trim(),
                nombre_director_general: document.getElementById('emp-director-general')?.value.trim() || '',
                direccion_departamento: document.getElementById('emp-dir-depto')?.value || '',
                direccion_municipio: document.getElementById('emp-dir-muni')?.value || '',
                direccion_zona: document.getElementById('emp-dir-zona')?.value.trim() || '',
                direccion_exacta: document.getElementById('emp-dir-exacta')?.value.trim() || '',
                direccion: [document.getElementById('emp-dir-exacta')?.value, document.getElementById('emp-dir-zona')?.value, document.getElementById('emp-dir-muni')?.value, document.getElementById('emp-dir-depto')?.value].filter(Boolean).join(', '),
                nombre_administrador: document.getElementById('admin-nombre').value.trim()
            };

            // Logo: si se seleccionó uno nuevo, convertir a base64
            const logoInput = document.getElementById('emp-logo-input');
            if (logoInput && logoInput.files[0]) {
                try {
                    body.logo_url = await optimizarImagenBase64(logoInput.files[0]);
                } catch(e) { console.error('Error optimizando logo:', e); }
            }

            try {
                // 1. Guardar info de la empresa
                const res = await fetchAPI(`/api/empresas/${id}`, { method: 'PUT', body: JSON.stringify(body) });
                if (res.error) return mostrarToast(res.error, 'error');

                // 2. Guardar configuración general
                const configBody = {
                    permite_supervisor_asignar: document.getElementById('cfg-sup-asignar').checked,
                    formato_hora: document.getElementById('cfg-formato-hora').value,
                    supervisor_ve_terminadas: document.getElementById('cfg-sup-ver-terminadas').checked,
                    empleado_puede_iniciar: document.getElementById('cfg-emp-iniciar-tarea').checked,
                    supervisor_puede_modificar: document.getElementById('cfg-sup-modificar').checked,
                    modalidad_trabajo: document.getElementById('cfg-modalidad-trabajo').value
                };
                await fetchAPI(`/api/empresas/${id}/configuracion`, { method: 'PUT', body: JSON.stringify(configBody) });

                mostrarToast('✅ Empresa y configuración actualizadas exitosamente', 'success');

                // Restaurar formulario a modo crear
                restaurarFormularioCrear();
                cambiarVistaRoot('empresas');
            } catch(err) {
                mostrarToast('Error al actualizar: ' + err.message, 'error');
            }
        };

    } catch(err) {
        mostrarToast('Error al cargar empresa', 'error');
    }
}

function restaurarFormularioCrear() {
    const vistaHeader = document.querySelector('#vista-crear-empresa .vista-header h3');
    if (vistaHeader) vistaHeader.innerHTML = '➕ Nueva Empresa + Administrador';

    const btnSubmit = document.getElementById('btn-crear-empresa');
    if (btnSubmit) btnSubmit.innerHTML = '<svg width="18" height="18" fill="currentColor" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg> Crear Empresa';

    const form = document.getElementById('form-empresa');
    form.onsubmit = function(ev) { crearEmpresa(ev); };
    form.reset();
}

async function toggleEstadoEmpresa(id, estadoActual) {
    const accion = estadoActual === 1 ? 'desactivar' : 'activar';
    if (!confirm(`¿Estás seguro de ${accion} esta empresa?`)) return;
    try {
        const res = await fetchAPI(`/api/empresas/${id}`, { method:'PUT', body:JSON.stringify({ estado: estadoActual === 1 ? 0 : 1 }) });
        if (res.error) return mostrarToast(res.error, 'error');
        mostrarToast(`✅ Empresa ${accion === 'activar' ? 'activada' : 'desactivada'}`, 'success');
        cargarEmpresas();
    } catch(err) { mostrarToast('Error al cambiar estado', 'error'); }
}

async function eliminarEmpresa(id, nombre) {
    const m = document.createElement('div');
    m.id = 'modal-confirmar-eliminar';
    m.className = 'modal-overlay';
    m.onclick = function(ev) { if(ev.target===this) this.remove(); };
    m.innerHTML = `
        <div class="modal glass" style="max-width:400px;padding:2rem;text-align:center">
            <h3 style="color:#ff5252">⚠️ Eliminar Empresa</h3>
            <p style="margin:1rem 0">¿Estás seguro de eliminar <strong>"${nombre}"</strong>?</p>
            <p style="font-size:0.8rem;color:var(--text-muted);margin-bottom:1rem">Se desactivarán todos los usuarios y grupos asociados.</p>
            <div style="text-align:left;margin-bottom:1.5rem">
                <label style="font-size:0.85rem;font-weight:600;color:var(--text-main);display:block;margin-bottom:5px">🔐 Clave de Programador</label>
                <input type="password" id="input-clave-eliminar" placeholder="Ingresa la clave ROOT" class="input" style="width:100%;text-align:center" />
            </div>
            <div style="display:flex;gap:0.5rem;justify-content:center">
                <button class="btn btn-ghost" onclick="document.getElementById('modal-confirmar-eliminar').remove()">Cancelar</button>
                <button class="btn" style="background:#ff5252;color:white" id="btn-confirmar-eliminar">🗑️ Eliminar</button>
            </div>
        </div>
    `;
    document.body.appendChild(m);
    
    // Focus automatically on input
    setTimeout(() => document.getElementById('input-clave-eliminar').focus(), 100);

    document.getElementById('btn-confirmar-eliminar').onclick = async function() {
        const clave = document.getElementById('input-clave-eliminar').value.trim();
        if (!clave) return mostrarToast('Debes ingresar la clave de programador', 'warning');

        const btn = this;
        btn.disabled = true;
        btn.textContent = 'Eliminando...';

        const res = await fetchAPI(`/api/empresas/${id}`, { 
            method: 'DELETE',
            body: JSON.stringify({ codigo_root: clave })
        });

        if (res.error) {
            btn.disabled = false;
            btn.innerHTML = '🗑️ Eliminar';
            return mostrarToast(res.error, 'error');
        }

        mostrarToast('✅ Empresa eliminada', 'success');
        m.remove();
        cargarEmpresas();
    };
}

// ═══════════════════════════════════════════
// PANEL ADMIN
// ═══════════════════════════════════════════
function cambiarPanelAdmin(panel) {
    const container = document.getElementById('pantalla-admin');
    container.querySelectorAll('.panel').forEach(p => p.classList.remove('activa'));
    const panelEl = document.getElementById(`panel-${panel}`);
    if (panelEl) panelEl.classList.add('activa');

    if (panel === 'supervisores') cargarSupervisores();
    if (panel === 'empleados') cargarEmpleados();
    if (panel === 'dashboard') cargarDashboardAdmin();
    if (panel === 'tareas') { cargarTareas(); cargarEstadisticasTareas(); }
    if (panel === 'ranking') cargarRanking();
    if (panel === 'notificaciones') cargarNotificaciones();
    if (panel === 'auditoria') cargarAuditoria();
    if (panel === 'asistencia') cargarAsistenciaAdmin();
    if (panel === 'graficas-gerencia') cargarGraficasGerencia();
    if (panel === 'configuracion') {
        if (USUARIO.rol !== 'ADMIN') {
            mostrarToast('Acceso restringido al Director General', 'error');
            cambiarPanelAdmin('graficas-gerencia');
            return;
        }
        cargarGerenciasConfig();
    }
}

// ═══════════════════════════════════════════
// NAVEGACIÓN ADMIN: MÓDULO GENERAL
// ═══════════════════════════════════════════
function toggleModulosPanel() {
    const panel = document.getElementById('admin-modulos-panel');
    const btn = document.getElementById('btn-modulo-general');
    const isOpen = panel.classList.contains('abierto');
    if (isOpen) {
        cerrarModulosPanel();
    } else {
        actualizarVisibilidadCreacion();
        panel.classList.add('abierto');
        btn.classList.add('abierto');
    }
}

function cerrarModulosPanel() {
    const panel = document.getElementById('admin-modulos-panel');
    const btn = document.getElementById('btn-modulo-general');
    if (panel) panel.classList.remove('abierto');
    if (btn) btn.classList.remove('abierto');
}

function abrirModuloAdmin(panel) {
    cerrarModulosPanel();
    cambiarPanelAdmin(panel);
}

// ═══════════════════════════════════════════
// PANEL CONFIGURACIÓN (Gerencias post-login)
// ═══════════════════════════════════════════
let configContadorGerencias = 0;

async function cargarGerenciasConfig() {
    const lista = document.getElementById('config-lista-gerencias');
    const sinMsg = document.getElementById('config-sin-gerencias');
    try {
        const deptos = await fetchAPI('/api/departamentos');
        lista.innerHTML = '';
        configContadorGerencias = 0;
        if (!deptos || deptos.length === 0) {
            sinMsg.textContent = 'No hay gerencias configuradas. Agrega usando los botones de arriba.';
            sinMsg.style.display = 'block';
            return;
        }
        sinMsg.style.display = 'none';
        for (const d of deptos) {
            agregarGerenciaConfigExistente(d);
        }
    } catch(err) {
        sinMsg.textContent = 'Error cargando gerencias';
    }
    // Cargar config de geofence
    cargarConfigGeofence();
}

async function cargarConfigGeofence() {
    try {
        const config = await fetchAPI('/api/empresas/mi-config');
        const chk = document.getElementById('config-geofence-activo');
        const slider = document.getElementById('config-geofence-radio');
        const label = document.getElementById('config-geofence-radio-label');
        const dot = document.getElementById('config-geofence-toggle-dot');
        if (chk) {
            const activo = config.geofence_activo !== 0 && config.geofence_activo !== '0';
            chk.checked = activo;
            const toggleBg = chk.nextElementSibling;
            if (toggleBg) toggleBg.style.background = activo ? '#10b981' : '#4b5563';
        }
        if (slider) {
            slider.value = config.radio_geofence || 800;
            if (label) label.textContent = (config.radio_geofence || 800) + 'm';
        }
    } catch(e) {}
}

async function guardarConfigGeofence() {
    const chk = document.getElementById('config-geofence-activo');
    const slider = document.getElementById('config-geofence-radio');
    const geofence_activo = chk ? chk.checked : true;
    const radio_geofence = slider ? parseInt(slider.value) : 800;

    try {
        await fetchAPI(`/api/empresas/${USUARIO.id_empresa}/configuracion`, {
            method: 'PUT',
            body: JSON.stringify({ geofence_activo, radio_geofence })
        });
        mostrarToast(`✅ Configuración GPS guardada — ${geofence_activo ? 'Activo' : 'Desactivado'} · Radio: ${radio_geofence}m`, 'success');
    } catch(err) {
        mostrarToast('Error al guardar configuración GPS', 'error');
    }
}

function agregarGerenciaConfigExistente(depto) {
    configContadorGerencias++;
    const lista = document.getElementById('config-lista-gerencias');
    const n = configContadorGerencias;
    const div = document.createElement('div');
    div.className = 'gerencia-card-completa';
    div.id = `config-ger-${n}`;
    div.dataset.idDepartamento = depto.id_departamento || '';
    div.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
            <div style="display:flex;align-items:center;gap:8px;flex:1;">
                <span style="font-size:1.1rem;">🏢</span>
                <input type="text" class="gc-nombre" value="${depto.nombre || ''}" style="flex:1;font-weight:600;font-size:0.95rem;" readonly>
            </div>
            ${depto.gerente ? `<span class="empresa-codigo" style="font-size:0.85rem;">${depto.gerente.codigo_acceso}</span>` : ''}
        </div>
        ${depto.gerente ? `
        <p style="font-size:0.78rem;color:var(--text-muted);margin-bottom:8px;border-top:1px solid var(--border-color);padding-top:8px;">👤 Responsable: <strong style="color:var(--text-main);">${depto.gerente.nombre}</strong></p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:0.78rem;color:var(--text-muted);">
            <span>📞 ${depto.gerente.telefono || 'Sin teléfono'}</span>
            <span>📧 ${depto.gerente.correo || 'Sin correo'}</span>
        </div>` : '<p style="font-size:0.78rem;color:var(--text-muted);border-top:1px solid var(--border-color);padding-top:8px;">Sin responsable asignado</p>'}
    `;
    lista.appendChild(div);
    document.getElementById('config-sin-gerencias').style.display = 'none';
}

function agregarGerenciaConfig(nombre = '') {
    configContadorGerencias++;
    const lista = document.getElementById('config-lista-gerencias');
    const n = configContadorGerencias;
    const div = document.createElement('div');
    div.className = 'gerencia-card-completa';
    div.id = `config-ger-${n}`;
    div.dataset.nueva = 'true';
    div.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
            <div style="display:flex;align-items:center;gap:8px;flex:1;">
                <span style="font-size:1.1rem;">🏢</span>
                <input type="text" class="gc-nombre" placeholder="Nombre de la gerencia" value="${nombre}" style="flex:1;font-weight:600;font-size:0.95rem;">
            </div>
            <button type="button" style="background:#ef4444;color:white;border:none;border-radius:6px;width:30px;height:30px;cursor:pointer;font-size:0.9rem;" onclick="this.closest('.gerencia-card-completa').remove()">✕</button>
        </div>
        <p style="font-size:0.78rem;color:var(--text-muted);margin-bottom:8px;border-top:1px solid var(--border-color);padding-top:8px;">👤 Responsable de la Gerencia:</p>
        <div class="form-grid" style="gap:8px;">
            <div class="form-group"><label style="font-size:0.75rem;">Nombre *</label><input type="text" class="gc-resp-nombre" placeholder="Nombre del Gerente"></div>
            <div class="form-group"><label style="font-size:0.75rem;">Teléfono</label><input type="tel" class="gc-resp-telefono" placeholder="Teléfono"></div>
            <div class="form-group"><label style="font-size:0.75rem;">Correo</label><input type="email" class="gc-resp-correo" placeholder="correo@empresa.com"></div>
            <div class="form-group"><label style="font-size:0.75rem;">Profesión</label><input type="text" class="gc-resp-profesion" placeholder="Lic. Administración"></div>
            <div class="form-group full-width"><label style="font-size:0.75rem;">Dirección</label><input type="text" class="gc-resp-direccion" placeholder="Dirección del responsable"></div>
        </div>
    `;
    lista.appendChild(div);
    document.getElementById('config-sin-gerencias').style.display = 'none';
    if (!nombre) div.querySelector('.gc-nombre').focus();
}

function sugerirGerenciaConfig(nombre) {
    agregarGerenciaConfig(nombre);
    document.querySelectorAll('#config-gerencias-sugerencias .btn-sugerencia').forEach(btn => {
        const onclickStr = btn.getAttribute('onclick') || '';
        if (onclickStr.includes(nombre)) btn.classList.add('usada');
    });
}

async function guardarGerenciasConfig() {
    const nuevas = document.querySelectorAll('.gerencia-card-completa[data-nueva="true"]');
    if (nuevas.length === 0) {
        mostrarToast('No hay nuevas gerencias para guardar', 'info');
        return;
    }
    const gerencias = Array.from(nuevas).map(item => ({
        nombre_gerencia: item.querySelector('.gc-nombre').value.trim(),
        responsable: {
            nombre: item.querySelector('.gc-resp-nombre')?.value.trim() || '',
            telefono: item.querySelector('.gc-resp-telefono')?.value.trim() || '',
            correo: item.querySelector('.gc-resp-correo')?.value.trim() || '',
            profesion: item.querySelector('.gc-resp-profesion')?.value.trim() || '',
            direccion: item.querySelector('.gc-resp-direccion')?.value.trim() || ''
        }
    })).filter(g => g.nombre_gerencia);

    if (gerencias.length === 0) {
        mostrarToast('Ingresa al menos el nombre de una gerencia', 'error');
        return;
    }
    try {
        const res = await fetchAPI('/api/departamentos/batch', {
            method: 'POST',
            body: JSON.stringify({ gerencias })
        });
        if (res.error) return mostrarToast(res.error, 'error');
        mostrarToast(`${res.creados || gerencias.length} gerencia(s) creada(s) ✅`, 'success');
        cargarGerenciasConfig(); // Refresh
    } catch(err) {
        mostrarToast(err.message || 'Error al guardar gerencias', 'error');
    }
}

// ═══════════════════════════════════════════
// PANEL SUPERVISOR
// ═══════════════════════════════════════════
function cambiarPanelSupervisor(panel) {
    const container = document.getElementById('pantalla-supervisor');
    container.querySelectorAll('.panel').forEach(p => p.classList.remove('activa'));
    document.getElementById(`panel-${panel}`).classList.add('activa');

    container.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('activo'));
    container.querySelector(`[data-panel="${panel}"]`).classList.add('activo');

    if (panel === 'sup-mis-tareas') cargarTareasEmpleado();
    if (panel === 'sup-notificaciones') cargarNotificaciones();
    if (panel === 'sup-modulo') { /* no auto-load, user picks section */ }
}

// ═══ MODU SUPERVISOR: sub-secciones ═══
function cambiarSeccionModSup(seccion) {
    document.getElementById('sup-mod-sec-empleados').style.display = seccion === 'empleados' ? '' : 'none';
    document.getElementById('sup-mod-sec-tareas').style.display = seccion === 'tareas' ? '' : 'none';

    // Resaltar botón activo
    document.getElementById('sup-mod-btn-empleados').style.opacity = seccion === 'empleados' ? '1' : '0.6';
    document.getElementById('sup-mod-btn-tareas').style.opacity = seccion === 'tareas' ? '1' : '0.6';

    if (seccion === 'empleados') cargarEmpleadosModSup();
    if (seccion === 'tareas') filtrarTareasEquipoSup(''); // Cargar todas
}

async function abrirNuevaTareaSupervisor() {
    // Reusar el modal de admin con datos filtrados
    document.getElementById('form-tarea').reset();
    try {
        const usuarios = await fetchAPI('/api/usuarios?rol=EMPLEADO');
        const selEmp = document.getElementById('tarea-empleado');
        const selSup = document.getElementById('tarea-supervisor');
        selEmp.innerHTML = '<option value="">-- Seleccionar Empleado --</option>';
        usuarios.forEach(u => {
            selEmp.innerHTML += `<option value="${u.id_usuario}">${u.nombre}</option>`;
        });
        // Pre-seleccionar supervisor y ocultar campo
        selSup.innerHTML = `<option value="${USUARIO.id_usuario}">${USUARIO.nombre}</option>`;
        selSup.value = USUARIO.id_usuario;
        selSup.closest('.form-group').style.display = 'none';
    } catch(e) { console.error(e); }
    // Cargar tipos
    try {
        const tipos = await fetchAPI('/api/tareas/tipos/lista');
        const selTipo = document.getElementById('tarea-tipo');
        selTipo.innerHTML = '<option value="">-- Seleccionar tipo --</option>';
        tipos.forEach(t => {
            selTipo.innerHTML += `<option value="${t.id_tipo}">${t.nombre}</option>`;
        });
    } catch(e) {}
    document.getElementById('modal-tarea').style.display = 'flex';
}

async function cargarEmpleadosModSup() {
    try {
        const usuarios = await fetchAPI('/api/usuarios?rol=EMPLEADO');
        const container = document.getElementById('sup-mod-lista-empleados');
        if (!usuarios.length) {
            container.innerHTML = '<div class="empty-state"><p>No tienes empleados asignados</p></div>';
            return;
        }
        container.innerHTML = usuarios.map(u => `
            <div class="user-card glass">
                <div class="user-card-header">
                    <div class="user-avatar">${u.nombre.charAt(0)}</div>
                    <div>
                        <h4>${u.nombre}</h4>
                        <span class="badge badge-success">EMPLEADO</span>
                    </div>
                </div>
                <div class="user-card-body">
                    <span>📞 ${u.telefono || 'N/A'}</span>
                    <span>📧 ${u.correo || 'N/A'}</span>
                    <span>🔑 ${u.codigo_acceso}</span>
                </div>
            </div>
        `).join('');
    } catch(err) {
        console.error('Error cargando empleados mod sup:', err);
    }
}

async function filtrarTareasEquipoSup(estado) {
    try {
        let url = '/api/tareas?';
        if (estado) url += `estado=${estado}&`;
        // Incluir finalizadas_atrasadas cuando se filtran terminadas
        let tareas = await fetchAPI(url);

        if (estado === 'finalizada') {
            try {
                const atrasadas = await fetchAPI('/api/tareas?estado=finalizada_atrasada');
                tareas = [...tareas, ...atrasadas];
            } catch(e) {}
        }

        const container = document.getElementById('sup-mod-lista-tareas');

        // Excluir tareas propias del supervisor — solo del equipo
        let tareasEquipo = tareas.filter(t => t.id_empleado !== USUARIO.id_usuario);

        if (estado) {
            if (estado === 'finalizada') {
                tareasEquipo = tareasEquipo.filter(t => t.estado === 'finalizada' || t.estado === 'finalizada_atrasada');
            } else {
                tareasEquipo = tareasEquipo.filter(t => t.estado === estado);
            }
        }

        // 1. FILTRADO PARA HOY (Política del sistema)
        const hoySinHora = new Date(); hoySinHora.setHours(0,0,0,0);
        tareasEquipo = tareasEquipo.filter(t => {
            if (t.estado === 'en_proceso' || t.estado === 'atrasada') return true;
            if (['finalizada', 'finalizada_atrasada', 'cancelada'].includes(t.estado)) return true;

            const fObj = parseFechaDBSeguro(t.fecha_programada || t.fecha_creacion);
            if (!fObj) return true;
            if (fObj > hoySinHora) {
                const esHoy = fObj.getFullYear() === hoySinHora.getFullYear() && fObj.getMonth() === hoySinHora.getMonth() && fObj.getDate() === hoySinHora.getDate();
                if (!esHoy) return false;
            }
            return true;
        });

        if (!tareasEquipo.length) {
            container.innerHTML = `<div class="empty-state"><p>No hay tareas ${estado ? 'pendientes para hoy con estado "' + estado.replace('_',' ') + '"' : 'pendientes para hoy'} en tu equipo</p></div>`;
            return;
        }

        container.innerHTML = tareasEquipo.map(t => {
            const prioridadColor = {
                'urgente': '#ef4444', 'alta': '#f97316', 'media': '#6366f1', 'baja': '#10b981'
            }[t.prioridad] || '#6366f1';
            const estadoBadgeClass = {
                'pendiente': 'badge-warning', 'en_proceso': 'badge-primary',
                'finalizada': 'badge-success', 'atrasada': 'badge-danger',
                'finalizada_atrasada': 'badge-warning', 'cancelada': 'badge-info'
            }[t.estado] || 'badge-info';
            const estadoTexto = {
                'pendiente': '🟡 Pendiente', 'en_proceso': '🔵 En Proceso',
                'finalizada': '🟢 Finalizada', 'atrasada': '🔴 Atrasada',
                'finalizada_atrasada': '🟠 Fin. Atrasada', 'cancelada': '⬜ Cancelada'
            }[t.estado] || t.estado;
            let tiempoRealStr = '';
            if ((t.estado === 'finalizada' || t.estado === 'finalizada_atrasada') && t.fecha_inicio && t.fecha_fin) {
                const segs = Math.round((new Date(t.fecha_fin) - new Date(t.fecha_inicio)) / 1000);
                tiempoRealStr = formatearCronoAdmin(segs);
            }
            return `
            <div class="tarea-row-wrap" id="wrap-${t.id_tarea}">
                <div class="tarea-row glass" style="border-left:4px solid ${prioridadColor};">
                    <div class="tarea-row-prioridad" style="background:${prioridadColor}22;color:${prioridadColor};">${t.prioridad.toUpperCase()}</div>
                    <div class="tarea-row-main">
                        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                            ${t.codigo_tarea ? `<span style="font-size:0.68rem;font-weight:700;color:var(--accent-primary);background:rgba(99,102,241,0.15);padding:2px 8px;border-radius:6px;">${t.codigo_tarea}</span>` : ''}
                            <span style="font-size:0.95rem;font-weight:700;">${t.titulo}</span>
                            <span class="badge ${estadoBadgeClass}" style="font-size:0.65rem;">${estadoTexto}</span>
                            ${t.nombre_tipo ? `<span style="font-size:0.7rem;color:var(--text-muted);background:rgba(255,255,255,0.06);padding:2px 7px;border-radius:10px;">${t.nombre_tipo}</span>` : ''}
                        </div>
                        ${t.descripcion ? `<div style="font-size:0.77rem;color:var(--text-secondary);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:350px;" title="${t.descripcion}">${t.descripcion}</div>` : ''}
                    </div>
                    <div class="tarea-row-info">
                        ${t.nombre_empleado ? `<span class="empresa-stat">👤 ${t.nombre_empleado}</span>` : '<span class="empresa-stat" style="opacity:0.4;">Sin asignar</span>'}
                        ${t.nombre_supervisor ? `<span class="empresa-stat">👁 ${t.nombre_supervisor}</span>` : ''}
                        ${tiempoRealStr ? `<span class="empresa-stat" style="color:#00ff88;font-weight:600;">⏱ ${tiempoRealStr}</span>` : (t.tiempo_estimado_minutos ? `<span class="empresa-stat">⏳ ${formatearTiempo(t.tiempo_estimado_minutos)}</span>` : '')}
                        ${t.total_evidencias > 0 ? `<span class="empresa-stat" style="color:#a78bfa;">📸 ${t.total_evidencias}</span>` : ''}
                        ${t.total_comentarios > 0 ? `<span class="empresa-stat" style="color:#60a5fa;">💬 ${t.total_comentarios}</span>` : ''}
                    </div>
                    <div class="tarea-row-fecha">
                        <span style="font-size:0.7rem;color:var(--text-muted);">📅 ${formatearFecha(t.fecha_creacion)}</span>
                        <span style="font-size:0.68rem;color:#a78bfa;">🕐 ${formatearHoraEmpresa(t.fecha_creacion)}</span>
                        ${t.fecha_fin ? `<span style="font-size:0.68rem;color:#10b981;">✅ ${formatearFecha(t.fecha_fin)}</span>` : ''}
                        <button class="btn-expand-tarea" onclick="event.stopPropagation();toggleDetalleTarea('${t.id_tarea}')" title="Ver detalles">
                            <span id="icon-expand-${t.id_tarea}">▼</span>
                        </button>
                    </div>
                </div>
                <div id="detalle-${t.id_tarea}" class="tarea-detalle-panel" style="display:none;">
                    <div class="tarea-detalle-loading">⏳ Cargando detalles...</div>
                </div>
            </div>`;
        }).join('');
    } catch(err) {
        console.error('Error filtrando tareas equipo:', err);
    }
}

async function cargarDashboardSupervisor() {
    try {
        const data = await fetchAPI('/api/dashboard');
        document.getElementById('sup-stat-empleados').textContent = data.usuarios.empleados;
        document.getElementById('sup-stat-tareas').textContent = data.tareas.pendientes + data.tareas.en_proceso;
        document.getElementById('sup-stat-completadas').textContent = data.tareas.finalizadas;

        // Tareas recientes
        document.getElementById('sup-tareas-recientes').innerHTML = data.actividadReciente.length ?
            data.actividadReciente.map(a => `
                <div style="padding:8px 0;border-bottom:1px solid var(--border-color);">
                    <div style="font-size:0.85rem;"><strong>${a.usuario_nombre || 'Sistema'}</strong> · ${a.estado_nuevo}</div>
                    <div style="font-size:0.78rem;color:var(--text-muted);">${a.tarea_titulo} · ${formatearFechaHora(a.fecha)}</div>
                </div>
            `).join('') : '<p style="color:var(--text-muted);font-size:0.85rem;">Sin actividad reciente</p>';

        // Cargar tareas asignadas al supervisor
        cargarMisTareasAsignadasSupervisor();
    } catch(err) {
        console.error('Error cargando dashboard supervisor:', err);
    }
}

// Variable global para filtro de tareas del supervisor
window.SUP_FILTRO_MIS_TAREAS = null;

async function cargarMisTareasAsignadasSupervisor() {
    try {
        const todasTareas = await fetchAPI('/api/tareas');
        const misTareasRaw = todasTareas.filter(t => t.id_empleado === USUARIO.id_usuario);

        // 1. FILTRADO PARA HOY (Sincronizado)
        const hoySinHora = new Date(); hoySinHora.setHours(0,0,0,0);
        const misTareas = misTareasRaw.filter(t => {
            if (['en_proceso', 'atrasada'].includes(t.estado)) return true;
            if (['finalizada', 'finalizada_atrasada', 'cancelada'].includes(t.estado)) return true; // para el historial
            
            // Pendientes: solo si son para hoy o ya pasaron
            const fObj = parseFechaDBSeguro(t.fecha_programada || t.fecha_creacion);
            if (!fObj) return true;
            if (fObj > hoySinHora) {
                const esHoy = fObj.getFullYear() === hoySinHora.getFullYear() && fObj.getMonth() === hoySinHora.getMonth() && fObj.getDate() === hoySinHora.getDate();
                if (!esHoy) return false;
            }
            return true;
        });

        // 2. Estadísticas basadas en la lista filtrada
        const pendientes = misTareas.filter(t => t.estado === 'pendiente').length;
        const enProceso = misTareas.filter(t => t.estado === 'en_proceso').length;
        const finalizadas = misTareas.filter(t => t.estado === 'finalizada' || t.estado === 'finalizada_atrasada').length;
        const atrasadas = misTareas.filter(t => t.estado === 'atrasada').length;

        const elPend = document.getElementById('sup-mis-stat-pendientes');
        const elProc = document.getElementById('sup-mis-stat-proceso');
        const elFin = document.getElementById('sup-mis-stat-finalizadas');
        const elAtr = document.getElementById('sup-mis-stat-atrasadas');
        if (elPend) elPend.textContent = pendientes;
        if (elProc) elProc.textContent = enProceso;
        if (elFin) elFin.textContent = finalizadas;
        if (elAtr) elAtr.textContent = atrasadas;

        // Dashboard "Mis Tareas Asignadas" (solo activas, sin filtro)
        const containerDash = document.getElementById('sup-mis-tareas-asignadas');
        if (containerDash) {
            const activas = misTareas.filter(t => !['finalizada', 'finalizada_atrasada', 'cancelada'].includes(t.estado));
            containerDash.innerHTML = activas.length 
                ? renderTareasSupCards(activas) 
                : '<p style="color:var(--text-muted);font-size:0.85rem;">No tienes tareas para el día de hoy</p>';
            iniciarCronosSupervisor(activas);
        }

        // Tareas panel (con filtro)  
        const containerLista = document.getElementById('sup-mis-tareas-lista');
        if (containerLista) {
            let tareasVista = misTareas;
            if (window.SUP_FILTRO_MIS_TAREAS) {
                if (window.SUP_FILTRO_MIS_TAREAS === 'finalizada') {
                    tareasVista = misTareas.filter(t => t.estado === 'finalizada' || t.estado === 'finalizada_atrasada');
                } else {
                    tareasVista = misTareas.filter(t => t.estado === window.SUP_FILTRO_MIS_TAREAS);
                }
            } else {
                // Sin filtro = solo activas
                tareasVista = misTareas.filter(t => !['finalizada', 'finalizada_atrasada', 'cancelada'].includes(t.estado));
            }
            containerLista.innerHTML = tareasVista.length 
                ? renderTareasSupCards(tareasVista) 
                : '<p style="color:var(--text-muted);font-size:0.85rem;">No hay tareas en este filtro</p>';
            iniciarCronosSupervisor(tareasVista);
        }
    } catch(err) {
        console.error('Error cargando tareas asignadas supervisor:', err);
    }
}

function filtrarMisTareasSup(estado) {
    // Toggle: si ya está seleccionado, quitar filtro
    if (window.SUP_FILTRO_MIS_TAREAS === estado) {
        window.SUP_FILTRO_MIS_TAREAS = null;
    } else {
        window.SUP_FILTRO_MIS_TAREAS = estado;
    }
    // Highlight visual
    document.querySelectorAll('#panel-sup-tareas .stat-card').forEach(c => c.style.outline = 'none');
    if (window.SUP_FILTRO_MIS_TAREAS) {
        const idx = {'pendiente':0,'en_proceso':1,'finalizada':2,'atrasada':3}[window.SUP_FILTRO_MIS_TAREAS];
        const cards = document.querySelectorAll('#panel-sup-tareas .stat-card');
        if (cards[idx]) cards[idx].style.outline = '2px solid var(--accent-primary)';
    }
    cargarMisTareasAsignadasSupervisor();
}

function renderTareasSupCards(tareas) {
    // Cargar config  
    return tareas.map(t => {
        const prioColor = { 'urgente':'#ef4444','alta':'#f97316','media':'#6366f1','baja':'#10b981' }[t.prioridad] || '#6366f1';
        const estadoTexto = { 'pendiente':'🟡 Pendiente','en_proceso':'🔵 En Proceso','atrasada':'🔴 Atrasada',
            'finalizada':'🟢 Finalizada','finalizada_atrasada':'🟠 Fin. Atrasada' }[t.estado] || t.estado;

        let acciones = '';
        if (t.estado === 'pendiente') {
            acciones = `<button class="btn btn-sm" style="background:#10b981;color:white;font-weight:600;" onclick="event.stopPropagation(); iniciarTareaEmpleado('${t.id_tarea}')">▶ Iniciar</button>`;
        } else if (t.estado === 'en_proceso') {
            acciones = `
                <div style="display:flex;align-items:center;gap:8px;">
                    <span id="sup-crono-${t.id_tarea}" style="font-family:monospace;font-size:0.9rem;color:#00ff88;font-weight:700;">00:00:00</span>
                    <button class="btn btn-sm" style="background:#ef4444;color:white;font-weight:600;" onclick="event.stopPropagation(); completarTareaEmpleado('${t.id_tarea}')">⏹ Finalizar</button>
                </div>`;
        }

        // Evidencias
        let evidenciaBtns = '';
        const reqEv = t.requiere_evidencia === 1 || t.requiere_evidencia === '1' || t.requiere_evidencia === true;
        if (reqEv && t.estado === 'en_proceso') {
            const cantEv = t.total_evidencias || 0;
            evidenciaBtns = `
                <div style="display:flex;align-items:center;gap:6px;margin-top:6px;padding:6px 10px;background:rgba(59,130,246,0.1);border:1px solid rgba(59,130,246,0.3);border-radius:8px;">
                    <button class="btn-crono" onclick="event.stopPropagation(); subirImagenRapida('${t.id_tarea}')" style="background:#3b82f6;color:white;font-weight:700;padding:6px 12px;border-radius:8px;font-size:0.75rem;border:none;cursor:pointer;">
                        📸 Subir Foto
                    </button>
                    <span style="font-size:0.7rem;color:${cantEv > 0 ? '#10b981' : '#ef4444'};font-weight:700;">
                        ${cantEv > 0 ? '✅ ' + cantEv + ' foto(s)' : '⚠️ Sin fotos (obligatorio)'}
                    </span>
                </div>`;
        }

        let tiempoInfo = '';
        if (t.tiempo_estimado_minutos) tiempoInfo = `<span style="font-size:0.72rem;color:var(--text-muted);">⏳ Est: ${formatearTiempo(t.tiempo_estimado_minutos)}</span>`;

        let tiempoRealStr = '';
        if ((t.estado === 'finalizada' || t.estado === 'finalizada_atrasada') && t.fecha_inicio && t.fecha_fin) {
            const segs = Math.round((new Date(t.fecha_fin) - new Date(t.fecha_inicio)) / 1000);
            tiempoRealStr = `<span style="font-size:0.72rem;color:#00ff88;font-weight:600;">⏱ ${formatearCronoAdmin(segs)}</span>`;
        }

        return `
        <div style="padding:12px;border-radius:10px;border-left:4px solid ${prioColor};background:rgba(255,255,255,0.03);margin-bottom:8px;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
                <div style="flex:1;">
                    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                        ${t.codigo_tarea ? `<span style="font-size:0.68rem;font-weight:700;color:var(--accent-primary);background:rgba(99,102,241,0.15);padding:2px 8px;border-radius:6px;">${t.codigo_tarea}</span>` : ''}
                        <span style="font-weight:700;font-size:0.9rem;">${t.titulo}</span>
                        <span style="font-size:0.7rem;padding:2px 6px;border-radius:6px;background:${prioColor}22;color:${prioColor};">${t.prioridad.toUpperCase()}</span>
                    </div>
                    <div style="display:flex;gap:12px;margin-top:4px;align-items:center;flex-wrap:wrap;">
                        <span style="font-size:0.72rem;">${estadoTexto}</span>
                        ${tiempoInfo}
                        ${tiempoRealStr}
                        <span style="font-size:0.68rem;color:var(--text-muted);">📅 ${formatearFecha(t.fecha_creacion)}</span>
                        ${t.fecha_inicio ? `<span style="font-size:0.68rem;color:#3b82f6;">▶ ${formatearFecha(t.fecha_inicio)}</span>` : ''}
                        ${t.fecha_fin ? `<span style="font-size:0.68rem;color:#10b981;">✅ ${formatearFecha(t.fecha_fin)}</span>` : ''}
                    </div>
                    ${evidenciaBtns}
                </div>
                <div>${acciones}</div>
            </div>
        </div>`;
    }).join('');
}

function iniciarCronosSupervisor(tareas) {
    // Limpiar cronómetros anteriores de supervisor
    Object.keys(cronoIntervalos).filter(k => k.startsWith('sup-')).forEach(k => {
        clearInterval(cronoIntervalos[k]);
        delete cronoIntervalos[k];
    });
    tareas.filter(t => t.estado === 'en_proceso' && t.fecha_inicio).forEach(t => {
        const el = document.getElementById(`sup-crono-${t.id_tarea}`);
        if (el) {
            const inicio = parseFechaDBSeguro(t.fecha_inicio);
            if (!inicio) return;
            const intervalo = setInterval(() => {
                const segs = Math.max(0, Math.round((Date.now() - inicio.getTime()) / 1000));
                const h = String(Math.floor(segs/3600)).padStart(2,'0');
                const m = String(Math.floor((segs%3600)/60)).padStart(2,'0');
                const s = String(segs%60).padStart(2,'0');
                el.textContent = `${h}:${m}:${s}`;
            }, 1000);
            cronoIntervalos[`sup-${t.id_tarea}`] = intervalo;
        }
    });
}

async function cargarEmpleadosSupervisor() {
    try {
        const usuarios = await fetchAPI('/api/usuarios?rol=EMPLEADO');
        // Usar el ID del contenedor del panel de supervisor real
        const container = document.getElementById('sup-mod-lista-empleados') || document.getElementById('sup-lista-empleados');
        if (!container) return;
        if (!usuarios.length) {
            container.innerHTML = '<div class="empty-state"><p>No tienes empleados asignados</p></div>';
            return;
        }
        container.innerHTML = usuarios.map(u => `
            <div class="user-card glass">
                <div class="user-card-header">
                    <div class="user-avatar">${u.nombre.charAt(0)}</div>
                    <div>
                        <h4>${u.nombre}</h4>
                        <span class="badge badge-success">EMPLEADO</span>
                    </div>
                </div>
                <div class="user-card-body">
                    <span>📞 ${u.telefono || 'N/A'}</span>
                    <span>📧 ${u.correo || 'N/A'}</span>
                    <span>🔑 ${u.codigo_acceso}</span>
                </div>
            </div>
        `).join('');
    } catch(err) {
        console.error('Error cargando empleados supervisor:', err);
    }
}

// ═══════════════════════════════════════════
// PANEL EMPLEADO
// ═══════════════════════════════════════════
function cambiarPanelEmpleado(panel) {
    const container = document.getElementById('pantalla-empleado');
    container.querySelectorAll('.panel').forEach(p => p.classList.remove('activa'));
    document.getElementById(`panel-${panel}`).classList.add('activa');

    container.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('activo'));
    container.querySelector(`[data-panel="${panel}"]`).classList.add('activo');

    if (panel === 'emp-mis-tareas') cargarTareasEmpleado();
    if (panel === 'emp-notificaciones') cargarNotificaciones();
}

// Objeto global para los intervalos de cronómetros
const cronoIntervalos = {};
const tareasYaAlertadas = new Set();
let intervaloAlertasEmpleado = null;

// ═══════════════════════════════════════════
// SISTEMA DE ALERTAS Y NOTIFICACIONES (EMPLEADO)
// ═══════════════════════════════════════════
function alertaSonoraYVibracion(tipo) {
    // Vibración (móvil)
    try {
        if (navigator.vibrate) {
            if (tipo === 'urgente') {
                navigator.vibrate([300, 100, 300, 100, 500]); // patrón urgente
            } else {
                navigator.vibrate([200, 100, 200]); // patrón normal
            }
        }
    } catch(e) {}

    // Sonido con Web Audio API
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (tipo === 'urgente') {
            // Alarma urgente: 3 beeps agudos
            [0, 0.25, 0.5].forEach(delay => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.frequency.value = 880;
                osc.type = 'square';
                gain.gain.value = 0.3;
                osc.start(ctx.currentTime + delay);
                osc.stop(ctx.currentTime + delay + 0.15);
            });
        } else {
            // Notificación suave: 2 tonos
            [0, 0.2].forEach((delay, i) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.frequency.value = i === 0 ? 523 : 659;
                osc.type = 'sine';
                gain.gain.value = 0.2;
                osc.start(ctx.currentTime + delay);
                osc.stop(ctx.currentTime + delay + 0.15);
            });
        }
    } catch(e) {}
}

function mostrarAlertaTarea(tarea, tipo) {
    // Evitar múltiples alertas de la misma tarea
    if (document.getElementById(`modal-alerta-tarea-${tarea.id_tarea}`)) return;

    const esUrgente = tipo === 'urgente';
    const bgGrad = esUrgente
        ? 'linear-gradient(135deg, rgba(220,38,38,0.98), rgba(153,27,27,0.98))'
        : 'linear-gradient(135deg, rgba(37,99,235,0.98), rgba(30,58,138,0.98))';
    const emoji = esUrgente ? '🚨' : '⏰';
    const titulo = esUrgente ? '¡NUEVA TAREA URGENTE!' : '¡NUEVA TAREA ASIGNADA!';
    const sombra = esUrgente ? 'rgba(239,68,68,0.6)' : 'rgba(59,130,246,0.6)';

    // Crear overlay de pantalla completa
    const overlay = document.createElement('div');
    overlay.id = `modal-alerta-tarea-${tarea.id_tarea}`;
    overlay.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
        background: rgba(0,0,0,0.85);
        backdrop-filter: blur(8px);
        z-index: 99999;
        display: flex; justify-content: center; align-items: center;
        opacity: 0; transition: opacity 0.3s ease;
    `;

    // Modal interior
    const modal = document.createElement('div');
    modal.style.cssText = `
        background: ${bgGrad};
        width: 90%; max-width: 500px;
        border-radius: 20px;
        padding: 40px 30px;
        text-align: center;
        color: white;
        box-shadow: 0 20px 50px ${sombra}, inset 0 0 0 1px rgba(255,255,255,0.2);
        transform: scale(0.9) translateY(20px);
        transition: transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        animation: modalAlertaPulse 2s infinite;
    `;

    // Determinar si puede iniciar (basado en rol o config si estuviera disponible)
    const puedeIniciar = (USUARIO.rol === 'EMPLEADO' || USUARIO.rol === 'SUPERVISOR');

    modal.innerHTML = `
        <div style="font-size: 5rem; line-height: 1; margin-bottom: 20px; animation: shakeEmoji 0.5s infinite;">
            ${emoji}
        </div>
        <h2 style="font-size: 1.8rem; font-weight: 900; letter-spacing: 1px; margin: 0 0 10px 0; text-transform: uppercase;">
            ${titulo}
        </h2>
        <div style="background: rgba(0,0,0,0.2); border-radius: 12px; padding: 20px; margin: 25px 0; border: 1px solid rgba(255,255,255,0.1);">
            <p style="font-size: 1.4rem; font-weight: 800; margin: 0 0 10px 0;">${tarea.titulo}</p>
            <p style="font-size: 0.95rem; opacity: 0.9; margin: 0;"><strong>Prioridad:</strong> ${tarea.prioridad.toUpperCase()}</p>
            ${tarea.descripcion ? `<p style="font-size: 0.95rem; opacity: 0.9; margin: 10px 0 0 0; font-style:italic;">"${tarea.descripcion}"</p>` : ''}
        </div>
        
        <div style="display: flex; flex-direction: column; gap: 12px; justify-content: center; align-items: center; width: 100%;">
            <button id="btn-cerrar-alerta-${tarea.id_tarea}" style="
                background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3);
                color: white; padding: 12px 24px; border-radius: 10px; font-size: 1rem;
                font-weight: 600; cursor: pointer; opacity: 0.8;
            ">
                Entendido
            </button>
        </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Animación de entrada
    requestAnimationFrame(() => {
        overlay.style.opacity = '1';
        modal.style.transform = 'scale(1) translateY(0)';
    });

    const limpiarAlerta = () => {
        detenerSirenaTarea();
        if (navigator.vibrate) navigator.vibrate(0);
        overlay.style.opacity = '0';
        modal.style.transform = 'scale(0.9) translateY(20px)';
        setTimeout(() => overlay.remove(), 300);
    };

    // Evento Iniciar
    const btnIni = document.getElementById(`btn-iniciar-alerta-${tarea.id_tarea}`);
    if (btnIni) {
        btnIni.onclick = async () => {
            limpiarAlerta();
            if (typeof iniciarTareaEmpleado === 'function') {
                await iniciarTareaEmpleado(tarea.id_tarea);
            }
        };
    }

    // Evento Cerrar
    document.getElementById(`btn-cerrar-alerta-${tarea.id_tarea}`).onclick = limpiarAlerta;

    // Agregar sirena, vibración agresiva y notificaciones push
    tocarSirenaTarea(esUrgente);
    if (navigator.vibrate) {
        if (esUrgente) {
            navigator.vibrate([500, 200, 500, 200, 500, 200, 800, 300, 800, 300, 1000]);
        } else {
            navigator.vibrate([400, 150, 400, 150, 600, 200, 600]);
        }
    }
    if ('Notification' in window && Notification.permission === 'granted') {
        try {
            new Notification(titulo, {
                body: `${tarea.titulo}\nPrioridad: ${(tarea.prioridad || 'media').toUpperCase()}`,
                tag: 'nueva-tarea',
                requireInteraction: true,
                vibrate: [500, 200, 500, 200, 500]
            });
        } catch(e) {}
    } else if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
    
    // NOTA: NO hay setTimeout para auto-cerrar. Exige que el usuario haga clic.
}

// Inyectar estilos de animación
(function() {
    if (document.getElementById('alerta-styles')) return;
    const style = document.createElement('style');
    style.id = 'alerta-styles';
    style.textContent = `
        @keyframes modalAlertaPulse {
            0%, 100% { box-shadow: 0 20px 50px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(255,255,255,0.2); }
            50% { box-shadow: 0 20px 70px rgba(255,255,255,0.2), inset 0 0 0 2px rgba(255,255,255,0.4); }
        }
        @keyframes shakeEmoji {
            0%,100% { transform:rotate(0) scale(1); }
            25% { transform:rotate(-15deg) scale(1.1); }
            75% { transform:rotate(15deg) scale(1.1); }
        }
    `;
    document.head.appendChild(style);
})();

async function verificarAlertasTareas() {
    if (!USUARIO || !['EMPLEADO', 'SUPERVISOR'].includes(USUARIO.rol)) return;
    try {
        let tareas = await fetchAPI('/api/tareas');

        // Para supervisor: solo alertar por sus propias tareas, no las del equipo
        if (USUARIO.rol === 'SUPERVISOR') {
            tareas = tareas.filter(t => t.id_empleado === USUARIO.id_usuario);
        }

        const hoyStr = new Date().toISOString().slice(0, 10); // "2026-03-30"

        tareas.forEach(t => {
            if (tareasYaAlertadas.has(t.id_tarea)) return;
            if (['finalizada', 'finalizada_atrasada', 'cancelada'].includes(t.estado)) return;

            // Solo alertar por tareas del DÍA DE HOY
            const fechaTarea = (t.fecha_programada || t.fecha_creacion || '').slice(0, 10);
            const esDeHoy = fechaTarea === hoyStr;

            if (t.estado === 'pendiente' && esDeHoy) {
                tareasYaAlertadas.add(t.id_tarea);
                const esUrgente = t.prioridad === 'urgente' || t.prioridad === 'alta';
                alertaSonoraYVibracion(esUrgente ? 'urgente' : 'normal');
                mostrarAlertaTarea(t, esUrgente ? 'urgente' : 'normal');
                return;
            }

            // Marcar tareas no-hoy o ya iniciadas como vistas (sin alertar)
            if (t.estado !== 'pendiente' || !esDeHoy) {
                tareasYaAlertadas.add(t.id_tarea);
            }
        });
    } catch(e) {}
}

function iniciarAlertasEmpleado() {
    if (intervaloAlertasEmpleado) clearInterval(intervaloAlertasEmpleado);
    // Primero: semillar tareas existentes para no alertar en masa al abrir
    fetchAPI('/api/tareas').then(tareas => {
        if (USUARIO.rol === 'SUPERVISOR') {
            tareas = tareas.filter(t => t.id_empleado === USUARIO.id_usuario);
        }
        tareas.forEach(t => tareasYaAlertadas.add(t.id_tarea));
        console.log(`🔕 Semilladas ${tareasYaAlertadas.size} tareas existentes (no alertarán)`);
        // AHORA sí iniciar polling — solo tareas NUEVAS activarán alerta
        intervaloAlertasEmpleado = setInterval(verificarAlertasTareas, 30000); // cada 30s
    }).catch(e => {
        // Si falla el seed, iniciar polling normal después de 5 segundos
        setTimeout(() => verificarAlertasTareas(), 5000);
        intervaloAlertasEmpleado = setInterval(verificarAlertasTareas, 30000);
    });
}

async function cargarTareasEmpleado() {
    try {
        let tareasRaw = await fetchAPI('/api/tareas');

        // Para supervisor: solo mostrar sus propias tareas (no las del equipo)
        if (USUARIO.rol === 'SUPERVISOR') {
            tareasRaw = tareasRaw.filter(t => t.id_empleado === USUARIO.id_usuario);
        }

        // 1. FILTRADO PARA HOY (Sincronizado con KPIs)
        const hoySinHora = new Date(); hoySinHora.setHours(0,0,0,0);
        let tareas = tareasRaw.filter(t => {
            if (t.estado === 'en_proceso' || t.estado === 'atrasada') return true;
            if (['finalizada', 'finalizada_atrasada', 'cancelada'].includes(t.estado)) return false;

            // Pendientes: solo si son para hoy o ya pasaron
            // Prioridad: fecha_seguimiento > fecha_programada > fecha_creacion
            const fechaRef = t.fecha_seguimiento || t.fecha_programada || t.fecha_creacion;
            const fObj = parseFechaDBSeguro(fechaRef);
            if (!fObj) return true;
            if (fObj > hoySinHora) {
                const esHoy = fObj.getFullYear() === hoySinHora.getFullYear() && fObj.getMonth() === hoySinHora.getMonth() && fObj.getDate() === hoySinHora.getDate();
                if (!esHoy) return false;
            }
            return true;
        });

        // 2. Estadísticas
        const pendientes  = tareas.filter(t => t.estado === 'pendiente').length;
        const enProceso   = tareas.filter(t => t.estado === 'en_proceso').length;
        const atrasadas   = tareas.filter(t => t.estado === 'atrasada').length;
        // Finalizadas: contar desde tareasRaw porque 'tareas' las excluye por design
        const finalizadas = tareasRaw.filter(t => t.estado === 'finalizada' || t.estado === 'finalizada_atrasada').length;

        // Cargar config de empresa
        let empPuedeIniciar = true;
        try {
            const config = await fetchAPI('/api/empresas/mi-config');
            empPuedeIniciar = config.empleado_puede_iniciar !== 0 && config.empleado_puede_iniciar !== false;
            window.FORMATO_HORA_EMPRESA = config.formato_hora || '12h';
        } catch(e) {}

        // Usar IDs correctos según rol
        const prefix = USUARIO.rol === 'SUPERVISOR' ? 'sup' : 'emp';
        const elP = document.getElementById(`${prefix}-stat-pendientes`); if(elP) elP.textContent = pendientes;
        const elPr = document.getElementById(`${prefix}-stat-proceso`); if(elPr) elPr.textContent = enProceso;
        const elF = document.getElementById(`${prefix}-stat-finalizadas`); if(elF) elF.textContent = finalizadas;
        const elA = document.getElementById(`${prefix}-stat-atrasadas`); if(elA) elA.textContent = atrasadas;

        // Limpiar intervalos anteriores
        Object.keys(cronoIntervalos).forEach(k => {
            clearInterval(cronoIntervalos[k]);
            delete cronoIntervalos[k];
        });

        const container = document.getElementById(`${prefix}-lista-tareas`);

        // (El filtrado de HOY y cálculo de KPIs ya se realizó arriba sincronizadamente)
        
        // Determinar qué tareas mostrar según el filtro activo
        let tareasVista = [];
        if (window.EMP_FILTRO_TAREAS) {
            if (window.EMP_FILTRO_TAREAS === 'finalizada') {
                // Historial: todas las finalizadas del usuario (sin límite de fecha)
                tareasVista = tareasRaw.filter(t => t.estado === 'finalizada' || t.estado === 'finalizada_atrasada');
            } else {
                tareasVista = tareas.filter(t => t.estado === window.EMP_FILTRO_TAREAS);
            }
        } else {
            // Sin filtro = solo activas hoy (sin terminadas/canceladas)
            tareasVista = tareas.filter(t => !['finalizada', 'finalizada_atrasada', 'cancelada'].includes(t.estado));
        }

        // Disparar alertas para tareas urgentes de hoy que estén pendientes
        tareasVista.forEach(t => {
            if (t.prioridad === 'urgente' && t.estado === 'pendiente' && !tareasYaAlertadas.has(t.id_tarea)) {
                tareasYaAlertadas.add(t.id_tarea);
                alertaSonoraYVibracion('urgente');
                mostrarAlertaTarea(t, 'urgente');
            }
        });

        if (!tareasVista.length) {
            container.innerHTML = '<div class="empty-state"><p>' + (window.EMP_FILTRO_TAREAS ? 'No hay tareas con este filtro para hoy' : 'No tienes tareas pendientes para el día de hoy') + '</p></div>';
            return;
        }

        // (Rogue method calls removed)

        // Si empleado NO puede iniciar → auto-iniciar tareas pendientes
        if (!empPuedeIniciar) {
            const pendientesArr = tareas.filter(t => t.estado === 'pendiente');
            for (const t of pendientesArr) {
                try {
                    await fetchAPI(`/api/tareas/${t.id_tarea}/estado`, {
                        method: 'PUT',
                        body: JSON.stringify({ estado: 'en_proceso' })
                    });
                    t.estado = 'en_proceso';
                    t.fecha_inicio = t.fecha_creacion; // cronómetro desde asignación
                } catch(e) {}
            }
        }

        container.innerHTML = tareasVista.map(t => {
            const esFinalizada = t.estado === 'finalizada' || t.estado === 'finalizada_atrasada';
            const enProcesoActivo = t.estado === 'en_proceso' || t.estado === 'atrasada';
            const esPendiente = t.estado === 'pendiente';
            const tiempoEst = t.tiempo_estimado_minutos ? `⏱ ${formatearTiempo(t.tiempo_estimado_minutos)}` : '';

            // Determinar clase del cronómetro
            let cronoClase = '';
            if (enProcesoActivo) cronoClase = 'corriendo';
            else if (esFinalizada) cronoClase = 'detenido';

            // Botones de acción según config
            let acciones = '';
            if (empPuedeIniciar) {
                // Modo manual: Iniciar → Completar
                if (esPendiente) {
                    acciones = `<button class="btn-crono btn-iniciar" onclick="event.stopPropagation(); iniciarTareaEmpleado('${t.id_tarea}')">▶ Iniciar</button>`;
                } else if (enProcesoActivo) {
                    acciones = `<button class="btn-crono btn-completar" onclick="event.stopPropagation(); completarTareaEmpleado('${t.id_tarea}')">✅ Completar</button>`;
                }
            } else {
                // Modo automático: solo botón Terminada
                if (enProcesoActivo) {
                    acciones = `<button class="btn-crono btn-completar" onclick="event.stopPropagation(); completarTareaEmpleado('${t.id_tarea}')">✅ Terminada</button>`;
                }
            }

            // Evidencia: mostrar botón de subir foto si la tarea lo requiere y está activa
            let evidenciaBtns = '';
            const reqEv = t.requiere_evidencia === 1 || t.requiere_evidencia === '1' || t.requiere_evidencia === true;
            if (reqEv && enProcesoActivo) {
                const cantEv = t.total_evidencias || 0;
                evidenciaBtns = `
                    <div style="display:flex;align-items:center;gap:6px;margin-top:6px;padding:6px 10px;background:rgba(59,130,246,0.1);border:1px solid rgba(59,130,246,0.3);border-radius:8px;">
                        <button class="btn-crono" onclick="event.stopPropagation(); subirImagenRapida('${t.id_tarea}')" style="background:#3b82f6;color:white;font-weight:700;padding:6px 12px;border-radius:8px;font-size:0.75rem;border:none;cursor:pointer;">
                            📸 Subir Foto
                        </button>
                        <span style="font-size:0.7rem;color:${cantEv > 0 ? '#10b981' : '#ef4444'};font-weight:700;">
                            ${cantEv > 0 ? '✅ ' + cantEv + ' foto(s)' : '⚠️ Sin fotos (obligatorio)'}
                        </span>
                    </div>
                `;
            } else if (reqEv && esPendiente) {
                evidenciaBtns = `
                    <div style="margin-top:6px;font-size:0.7rem;color:#f59e0b;font-weight:600;">📸 Esta tarea requiere fotos de constancia</div>
                `;
            }

            // Botón 👤 Cliente (si la tarea requiere seguimiento de cliente)
            let clienteBtn = '';
            const tieneCliente = t.tiene_cliente === 1 || t.tiene_cliente === '1' || t.tiene_cliente === true;
            if (tieneCliente) {
                const concluido = t.cliente_concluido === 1 || t.cliente_concluido === '1';
                clienteBtn = `
                    <div style="margin-top:8px;">
                        <button onclick="event.stopPropagation(); abrirModalCliente('${t.id_tarea}')"
                            style="width:100%;padding:8px 14px;border-radius:9px;border:none;cursor:pointer;font-size:0.8rem;font-weight:700;
                                   background:${concluido ? 'linear-gradient(135deg,rgba(16,185,129,0.15),rgba(16,185,129,0.08))' : 'linear-gradient(135deg,rgba(16,185,129,0.2),rgba(16,185,129,0.1))'};
                                   color:${concluido ? '#10b981' : '#34d399'};
                                   border:1px solid ${concluido ? 'rgba(16,185,129,0.3)' : 'rgba(52,211,153,0.4)'};
                                   display:flex;align-items:center;justify-content:center;gap:6px;">
                            ${concluido ? '✅ Cliente Atendido' : '👤 Datos del Cliente'}
                            ${t.nombre_cliente ? `<span style="font-weight:400;font-size:0.72rem;opacity:0.8;">· ${t.nombre_cliente}</span>` : '<span style="font-weight:400;font-size:0.72rem;opacity:0.7;">· Pendiente de registro</span>'}
                        </button>
                    </div>`;
            }

            // Botón de observaciones inline
            const tieneObs = t.observaciones_tarea && t.observaciones_tarea.trim().length > 0;
            const obsBtn = `
                <div style="margin-top:8px;">
                    <button onclick="event.stopPropagation(); toggleObsInline('${t.id_tarea}')"
                        style="width:100%;padding:7px 14px;border-radius:9px;border:none;cursor:pointer;font-size:0.78rem;font-weight:600;
                               background:${tieneObs ? 'linear-gradient(135deg,rgba(99,102,241,0.15),rgba(99,102,241,0.08))' : 'linear-gradient(135deg,rgba(139,92,246,0.12),rgba(139,92,246,0.06))'};
                               color:${tieneObs ? '#6366f1' : '#a78bfa'};
                               border:1px solid ${tieneObs ? 'rgba(99,102,241,0.3)' : 'rgba(139,92,246,0.25)'};
                               display:flex;align-items:center;justify-content:center;gap:6px;transition:all 0.2s;">
                        📝 Observaciones ${tieneObs ? '<span style="background:#10b981;color:white;font-size:0.6rem;padding:1px 6px;border-radius:99px;font-weight:700;">✓</span>' : ''}
                    </button>
                </div>`;


            return `
                <div class="emp-tarea-card" id="emp-card-${t.id_tarea}">
                    <div class="tarea-info">
                        <div style="display:flex;align-items:center;gap:8px;margin-bottom:2px;">
                            <div class="tarea-titulo">${t.titulo}</div>
                            <span class="badge ${t.estado === 'finalizada' || t.estado === 'finalizada_atrasada' ? 'badge-success' : t.estado === 'en_proceso' ? 'badge-primary' : t.estado === 'atrasada' ? 'badge-danger' : 'badge-warning'}" style="font-size:0.7rem;">${t.estado.replace('_', ' ')}</span>
                        </div>
                        ${t.descripcion ? `<div class="tarea-desc">${t.descripcion}</div>` : ''}
                        <div class="tarea-meta">
                            <span class="badge" style="background: ${t.prioridad === 'urgente' ? '#ef4444' : t.prioridad === 'alta' ? '#f97316' : t.prioridad === 'media' ? '#f59e0b' : '#10b981'}; color: white; font-size:0.68rem;">${t.prioridad.toUpperCase()}</span>
                            ${tiempoEst ? `<span class="badge badge-info" style="font-size:0.68rem;">${tiempoEst}</span>` : ''}
                            ${t.fecha_vencimiento ? `<span style="font-size:0.7rem;color:var(--text-muted);">📅 ${formatearFecha(t.fecha_vencimiento)}</span>` : ''}
                            ${t.fecha_creacion ? `<span style="font-size:0.65rem;color:#a78bfa;">🕐 ${formatearHoraEmpresa(t.fecha_creacion)}</span>` : ''}
                        </div>
                        ${evidenciaBtns}
                        ${clienteBtn}
                        ${obsBtn}
                    </div>
                    <div class="crono-container" style="flex-shrink:0;margin:0;padding:10px 14px;min-width:auto;flex-wrap:wrap;justify-content:center;">
                        <span style="font-size:1rem;">⏱</span>
                        <span class="crono-display ${cronoClase}" id="crono-${t.id_tarea}" data-inicio="${t.fecha_inicio || ''}" data-fin="${t.fecha_fin || ''}" style="font-size:1.4rem;min-width:110px;">00:00:00</span>
                        <div class="crono-acciones">${acciones}</div>
                    </div>
                </div>
                <!-- Panel de observaciones inline (colapsado por defecto) -->
                <div id="obs-inline-${t.id_tarea}" class="obs-inline-panel" style="display:none;margin:-6px 0 10px 0;padding:14px 16px;background:linear-gradient(135deg,rgba(99,102,241,0.06),rgba(139,92,246,0.04));border:1px solid rgba(99,102,241,0.2);border-radius:0 0 14px 14px;animation:slideDown 0.25s ease;">
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
                        <span style="font-size:0.78rem;font-weight:700;color:#6366f1;">📝 Tus Observaciones</span>
                        <span id="obs-status-${t.id_tarea}" style="font-size:0.65rem;color:var(--text-muted);"></span>
                    </div>
                    <textarea id="obs-text-${t.id_tarea}" rows="3"
                        placeholder="Escribe tus observaciones, problemas, notas importantes..."
                        style="width:100%;resize:vertical;border:1px solid rgba(99,102,241,0.25);border-radius:8px;background:rgba(99,102,241,0.04);font-size:0.82rem;padding:10px;color:var(--text-main);font-family:inherit;"
                        oninput="autoguardarObsInline('${t.id_tarea}')">${t.observaciones_tarea || ''}</textarea>
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;">
                        <span style="font-size:0.68rem;color:var(--text-muted);">💡 Se guarda automáticamente</span>
                        <button class="btn btn-sm" onclick="guardarObsInline('${t.id_tarea}')"
                            style="background:linear-gradient(135deg,#6366f1,#4f46e5);color:white;font-size:0.72rem;padding:5px 14px;border-radius:8px;">
                            💾 Guardar
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        // Iniciar cronómetros activos
        tareasVista.forEach(t => {
            const enProcesoActivo = t.estado === 'en_proceso' || t.estado === 'atrasada';
            const esFinalizada = t.estado === 'finalizada' || t.estado === 'finalizada_atrasada';

            if (enProcesoActivo && t.fecha_inicio) {
                const di = parseFechaDBSeguro(t.fecha_inicio);
                if (di) iniciarCrono(t.id_tarea, di);
            } else if (esFinalizada && t.fecha_inicio && t.fecha_fin) {
                const di = parseFechaDBSeguro(t.fecha_inicio);
                const df = parseFechaDBSeguro(t.fecha_fin);
                if (di && df) {
                    const segs = Math.max(0, Math.round((df - di) / 1000));
                    const el = document.getElementById(`crono-${t.id_tarea}`);
                    if (el) el.textContent = formatearCrono(segs);
                }
            }
        });
    } catch(err) {
        console.error('Error cargando tareas empleado:', err);
    }
}

function formatearCrono(totalSegundos) {
    const h = Math.floor(totalSegundos / 3600);
    const m = Math.floor((totalSegundos % 3600) / 60);
    const s = totalSegundos % 60;
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}
// Alias para el panel admin
const formatearCronoAdmin = formatearCrono;

function iniciarCrono(idTarea, fechaInicio) {
    // Limpiar intervalo previo
    if (cronoIntervalos[idTarea]) clearInterval(cronoIntervalos[idTarea]);

    function actualizarCrono() {
        const el = document.getElementById(`crono-${idTarea}`);
        if (!el) { clearInterval(cronoIntervalos[idTarea]); return; }
        const segs = Math.max(0, Math.round((Date.now() - fechaInicio.getTime()) / 1000));
        el.textContent = formatearCrono(segs);
    }

    actualizarCrono(); // inicial
    cronoIntervalos[idTarea] = setInterval(actualizarCrono, 1000);
}

async function iniciarTareaEmpleado(idTarea) {
    try {
        const res = await fetchAPI(`/api/tareas/${idTarea}/iniciar`, { method: 'PUT' });
        mostrarToast('⏱ Tarea iniciada — ¡el cronómetro corre!', 'success');
        cargarTareasEmpleado();
        // Si es supervisor, también recargar su panel
        if (USUARIO.rol === 'SUPERVISOR') cargarMisTareasAsignadasSupervisor();
    } catch(err) {
        mostrarToast(err.message || 'Error al iniciar tarea', 'error');
    }
}

async function completarTareaEmpleado(idTarea) {
    if (!confirm('¿Seguro que deseas marcar esta tarea como completada?')) return;
    try {
        const res = await fetchAPI(`/api/tareas/${idTarea}/finalizar`, { method: 'PUT' });
        // Detener cronómetro
        if (cronoIntervalos[idTarea]) {
            clearInterval(cronoIntervalos[idTarea]);
            delete cronoIntervalos[idTarea];
        }
        const el = document.getElementById(`crono-${idTarea}`);
        if (el) {
            el.classList.remove('corriendo');
            el.classList.add('detenido');
        }
        mostrarToast('✅ ¡Tarea completada! Buen trabajo', 'success');
        cargarTareasEmpleado();
        // Si es supervisor, también recargar su panel
        if (USUARIO.rol === 'SUPERVISOR') cargarMisTareasAsignadasSupervisor();
    } catch(err) {
        if (err.message && err.message.includes('evidencias para finalizar')) {
            Swal.fire({
                icon: 'warning',
                title: 'Faltan Evidencias',
                text: 'Esta tarea requiere que subas imágenes de constancia antes de poder finalizarla.',
                confirmButtonText: '📸 Subir Imágen Ahora',
                confirmButtonColor: '#3b82f6',
                showCancelButton: true,
                cancelButtonText: 'Cancelar'
            }).then((result) => {
                if (result.isConfirmed) subirImagenRapida(idTarea);
            });
        } else {
            mostrarToast(err.message || 'Error al completar tarea', 'error');
        }
    }
}

async function cargarDashboardAdmin() {
    try {
        const data = await fetchAPI('/api/dashboard');

        // KPI Cards
        document.getElementById('stat-supervisores').textContent = data.usuarios.supervisores;
        document.getElementById('stat-empleados').textContent = data.usuarios.empleados;
        document.getElementById('stat-tareas').textContent = data.tareas.pendientes + data.tareas.en_proceso;
        document.getElementById('stat-eficiencia').textContent = data.kpis.eficiencia + '%';
        document.getElementById('stat-productividad').textContent = data.kpis.productividad_7d;
        document.getElementById('stat-tiempo-prom').textContent = data.kpis.tiempo_promedio_min + 'm';

        // Estado de tareas (barras)
        const maxT = Math.max(data.tareas.pendientes, data.tareas.en_proceso, data.tareas.finalizadas, data.tareas.atrasadas, 1);
        document.getElementById('dash-estado-tareas').innerHTML = [
            {label:'Pendientes', val:data.tareas.pendientes, color:'#f59e0b', emoji:'🟡'},
            {label:'En Proceso', val:data.tareas.en_proceso, color:'#3b82f6', emoji:'🔵'},
            {label:'Finalizadas', val:data.tareas.finalizadas, color:'#10b981', emoji:'🟢'},
            {label:'Atrasadas', val:data.tareas.atrasadas, color:'#ef4444', emoji:'🔴'}
        ].map(i => `
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
                <span style="width:90px;font-size:0.82rem;color:var(--text-secondary);">${i.emoji} ${i.label}</span>
                <div style="flex:1;height:24px;background:rgba(255,255,255,0.05);border-radius:12px;overflow:hidden;">
                    <div style="width:${(i.val/maxT)*100}%;height:100%;background:${i.color};border-radius:12px;transition:width 0.5s;display:flex;align-items:center;justify-content:flex-end;padding-right:8px;">
                        <span style="font-size:0.75rem;font-weight:700;color:white;">${i.val}</span>
                    </div>
                </div>
            </div>
        `).join('');

        // Actividad reciente
        document.getElementById('dash-actividad').innerHTML = data.actividadReciente.length ?
            data.actividadReciente.map(a => `
                <div style="padding:8px 0;border-bottom:1px solid var(--border-color);">
                    <div style="font-size:0.85rem;"><strong>${a.usuario_nombre || 'Sistema'}</strong> · ${a.estado_nuevo}</div>
                    <div style="font-size:0.78rem;color:var(--text-muted);">${a.tarea_titulo} · ${formatearFechaHora(a.fecha)}</div>
                </div>
            `).join('') : '<p style="color:var(--text-muted);font-size:0.85rem;">Sin actividad reciente</p>';

        // Top empleados
        document.getElementById('dash-top-empleados').innerHTML = data.topEmpleados.length ?
            data.topEmpleados.map((e, i) => `
                <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border-color);">
                    <span style="font-size:1.1rem;width:24px;">${i===0?'🥇':i===1?'🥈':i===2?'🥉':(i+1)+'.'}</span>
                    <span style="flex:1;font-size:0.88rem;font-weight:500;">${e.nombre}</span>
                    <span class="badge badge-success" style="font-size:0.75rem;">${e.puntos_total} pts</span>
                    <span style="font-size:0.78rem;color:var(--text-muted);">${e.tareas_completadas} tareas</span>
                </div>
            `).join('') : '<p style="color:var(--text-muted);font-size:0.85rem;">Sin empleados aún</p>';

        // Supervisores
        document.getElementById('dash-supervisores').innerHTML = data.porSupervisor.length ?
            data.porSupervisor.map(s => {
                const eff = s.total_tareas > 0 ? Math.round((s.a_tiempo / Math.max(s.completadas,1)) * 100) : 0;
                return `
                <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border-color);">
                    <div style="flex:1;">
                        <span style="font-size:0.88rem;font-weight:500;display:block;">${s.nombre}</span>
                        <small style="color:var(--text-muted);font-size:0.7rem;text-transform:uppercase;">${s.nombre_departamento || 'Sin Depto'}</small>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted);">${s.completadas}/${s.total_tareas} tareas</span>
                    <span class="badge ${eff >= 80 ? 'badge-success' : eff >= 50 ? 'badge-warning' : 'badge-danger'}">${eff}% ef.</span>
                </div>`;
            }).join('') : '<p style="color:var(--text-muted);font-size:0.85rem;">Sin supervisores aún</p>';

        // --- EXCLUSIVO ALTA GERENCIA: INSIGHTS IA ---
        const aiPanel = document.getElementById('ai-insights-panel');
        const aiContent = document.getElementById('ai-insights-content');
        if (aiPanel && data.iaInsights && data.iaInsights.length > 0) {
            aiPanel.style.display = 'block';
            aiContent.innerHTML = data.iaInsights.map(insight => `
                <div style="padding:12px;border-radius:10px;background:rgba(255,255,255,0.03);border-left:4px solid ${insight.tipo==='success'?'#10b981':insight.tipo==='warning'?'#f59e0b':'#6366f1'};display:flex;gap:12px;align-items:flex-start;">
                    <span style="font-size:1.2rem;">${insight.tipo==='success'?'🚀':insight.tipo==='warning'?'⚠️':'ℹ️'}</span>
                    <div style="font-size:0.85rem;line-height:1.4;color:var(--text-secondary);">${insight.texto}</div>
                </div>
            `).join('');
        } else if (aiPanel) {
            aiPanel.style.display = 'none';
        }

    } catch(err) {
        console.error('Error cargando dashboard:', err);
    }
}

// ═══════════════════════════════════════════
// RANKING / GAMIFICACIÓN
// ═══════════════════════════════════════════
async function cargarRanking() {
    try {
        const ranking = await fetchAPI('/api/dashboard/ranking');
        const podio = document.getElementById('ranking-podio');
        const tabla = document.getElementById('ranking-tabla');

        if (!ranking.length) {
            podio.innerHTML = '';
            tabla.innerHTML = '<div class="empty-state"><p>Sin datos de ranking aún</p></div>';
            return;
        }

        // Podio (top 3)
        const top3 = ranking.slice(0, 3);
        const podioOrder = [1, 0, 2]; // plata, oro, bronce
        const heights = { 0: '160px', 1: '120px', 2: '100px' };
        const bgColors = { 0: 'linear-gradient(135deg,#f59e0b,#d97706)', 1: 'linear-gradient(135deg,#9ca3af,#6b7280)', 2: 'linear-gradient(135deg,#d97706,#92400e)' };

        podio.innerHTML = podioOrder.map(idx => {
            const r = top3[idx];
            if (!r) return '';
            return `
                <div style="text-align:center;animation:fadeInUp 0.4s ease ${idx*0.15}s both;">
                    <div style="font-size:2rem;margin-bottom:4px;">${r.medalla}</div>
                    <div style="font-weight:700;font-size:0.9rem;margin-bottom:4px;">${r.nombre}</div>
                    <div style="font-size:0.78rem;color:var(--accent-amber);font-weight:600;">${r.puntos_total} pts</div>
                    <div style="width:90px;height:${heights[idx]};background:${bgColors[idx]};border-radius:12px 12px 0 0;margin-top:8px;display:flex;flex-direction:column;justify-content:center;align-items:center;">
                        <span style="font-size:1.5rem;font-weight:800;color:white;">#${r.posicion}</span>
                        <span style="font-size:0.7rem;color:rgba(255,255,255,0.8);">${r.nivel}</span>
                    </div>
                </div>`;
        }).join('');

        // Tabla completa
        tabla.innerHTML = `
            <table class="tabla">
                <thead>
                    <tr>
                        <th>#</th>
                        <th>Nombre</th>
                        <th>Rol</th>
                        <th>Puntos</th>
                        <th>Nivel</th>
                        <th>Completadas</th>
                        <th>Eficiencia</th>
                    </tr>
                </thead>
                <tbody>
                    ${ranking.map(r => `
                        <tr>
                            <td>${r.medalla || r.posicion}</td>
                            <td><strong>${r.nombre}</strong></td>
                            <td><span class="badge ${r.rol==='SUPERVISOR'?'badge-primary':'badge-info'}">${r.rol}</span></td>
                            <td><strong style="color:var(--accent-amber);">${r.puntos_total}</strong></td>
                            <td><span class="badge ${r.nivel==='Maestro'?'badge-warning':r.nivel==='Experto'?'badge-primary':r.nivel==='Avanzado'?'badge-success':'badge-info'}">${r.nivel}</span></td>
                            <td>${r.total_completadas} (${r.tareas_a_tiempo}✅ ${r.tareas_atrasadas}⚠️)</td>
                            <td><span class="badge ${r.eficiencia>=80?'badge-success':r.eficiencia>=50?'badge-warning':'badge-danger'}">${r.eficiencia}%</span></td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>`;
    } catch(err) {
        console.error('Error cargando ranking:', err);
    }
}

// ═══════════════════════════════════════════
// ALTA GERENCIA: VISIÓN GLOBAL 360°
// ═══════════════════════════════════════════

// Caché para búsqueda local rápida en la vista 360
let DATA_VISTA_360 = [];

async function abrirVisionGlobal360() {
    try {
        mostrarCargando();
        document.getElementById('modal-vision-360').style.display = 'flex';
        
        // Carga jerárquica masiva desde el nuevo endpoint
        const response = await fetchAPI('/api/departamentos/datos-360');
        DATA_VISTA_360 = response || [];
        
        dibujarVista360(DATA_VISTA_360);
        ocultarCargando();
    } catch(err) {
        ocultarCargando();
        console.error('Error 360:', err);
        mostrarToast('Error al cargar visión estratégica', 'error');
    }
}

function cerrarModal(id) {
    const el = document.getElementById(id);
    if(el) el.style.display = 'none';
}

function dibujarVista360(data) {
    const container = document.getElementById('vision-360-container');
    if (!data || !data.length) {
        container.innerHTML = '<div class="empty-state"><p>No hay datos estructurales aún.</p></div>';
        return;
    }

    container.innerHTML = data.map(dep => `
        <div class="gerencia-group" style="margin-bottom:25px;border:1px solid rgba(255,255,255,0.05);border-radius:12px;background:rgba(255,255,255,0.02);overflow:hidden;">
            <div style="background:rgba(99,102,241,0.15);padding:12px 18px;display:flex;justify-content:space-between;align-items:center;">
                <h4 style="margin:0;color:var(--primary);letter-spacing:1px;font-size:1rem;font-weight:700;">🏢 GERENCIA: ${dep.nombre.toUpperCase()}</h4>
                <span class="badge" style="background:var(--primary);color:white;">${dep.supervisores.length} Directores Inmediatos</span>
            </div>
            
            <div style="padding:15px;display:grid;grid-template-columns:repeat(auto-fill, minmax(450px, 1fr));gap:20px;">
                ${dep.supervisores.length ? dep.supervisores.map(sup => `
                    <div style="background:rgba(0,0,0,0.25);border-radius:10px;padding:15px;border:1px solid rgba(255,255,255,0.03);">
                        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;border-bottom:1px solid rgba(255,255,255,0.05);padding-bottom:10px;">
                            <span style="font-size:1.3rem;">👤</span>
                            <div>
                                <strong style="color:var(--text-secondary);font-size:0.95rem;display:block;">${sup.nombre}</strong>
                                <small style="color:var(--accent-primary);text-transform:uppercase;font-size:0.65rem;font-weight:700;">Supervisor Directo</small>
                            </div>
                        </div>
                        
                        <div style="display:grid;grid-template-columns:1fr;gap:12px;">
                            ${sup.empleados.length ? sup.empleados.map(emp => `
                                <div class="glass" style="padding:12px;border-radius:8px;border:1px solid rgba(255,255,255,0.04);background:rgba(255,255,255,0.01);">
                                    <div style="font-weight:700;font-size:0.88rem;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;">
                                        <span style="color:var(--text-primary);"><span style="margin-right:6px;">👨‍🔧</span>${emp.nombre}</span>
                                        <span class="badge ${emp.tareas.length ? 'badge-primary' : 'badge-ghost'}" style="font-size:0.7rem;">${emp.tareas.length} Activas</span>
                                    </div>
                                    <div style="display:flex;flex-direction:column;gap:6px;">
                                        ${emp.tareas.length ? emp.tareas.map(t => `
                                            <div style="padding:6px 8px;background:rgba(255,255,255,0.03);border-radius:4px;display:flex;justify-content:space-between;align-items:center;">
                                                <span style="color:var(--text-muted);font-size:0.78rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:260px;">• ${t.titulo}</span>
                                                <span class="badge-status ${t.estado.replace('_','-')}" style="font-size:0.55rem;padding:2px 6px;">${t.estado.toUpperCase()}</span>
                                            </div>
                                        `).join('') : '<div style="color:var(--text-muted);font-size:0.78rem;font-style:italic;padding-left:10px;">Sin operación activa...</div>'}
                                    </div>
                                </div>
                            `).join('') : '<div style="color:var(--text-muted);font-size:0.78rem;font-style:italic;text-align:center;">No tiene empleados asignados</div>'}
                        </div>
                    </div>
                `).join('') : '<div class="empty-state" style="padding:20px;grid-column:1/-1;"><small>No hay supervisores en esta gerencia.</small></div>'}
            </div>
        </div>
    `).join('');
}

function filtrarVista360() {
    const busqueda = document.getElementById('busqueda-360').value.toLowerCase();
    if (!busqueda) {
        dibujarVista360(DATA_VISTA_360);
        return;
    }

    const filtrado = DATA_VISTA_360.map(dep => {
        const supFiltrados = dep.supervisores.map(sup => {
            const empFiltrados = sup.empleados.filter(emp => 
                emp.nombre.toLowerCase().includes(busqueda) || 
                emp.tareas.some(t => t.titulo.toLowerCase().includes(busqueda))
            );
            return { ...sup, empleados: empFiltrados };
        }).filter(sup => sup.nombre.toLowerCase().includes(busqueda) || sup.empleados.length > 0);
        
        return { ...dep, supervisores: supFiltrados };
    }).filter(dep => dep.nombre.toLowerCase().includes(busqueda) || dep.supervisores.length > 0);

    dibujarVista360(filtrado);
}

// ═══════════════════════════════════════════
// NOTIFICACIONES
// ═══════════════════════════════════════════
async function cargarNotificaciones() {
    try {
        const data = await fetchAPI('/api/dashboard/notificaciones');
        const container = document.getElementById('lista-notificaciones');
        const badge = document.getElementById('notif-badge-header');

        // Actualizar badge
        badge.textContent = data.noLeidas > 0 ? `(${data.noLeidas})` : '';

        if (!data.notificaciones.length) {
            container.innerHTML = '<div class="empty-state"><p>No tienes notificaciones</p></div>';
            return;
        }

        container.innerHTML = data.notificaciones.map(n => `
            <div class="glass" style="padding:14px 20px;border-radius:var(--radius-md);margin-bottom:8px;border-left:3px solid ${n.leido ? 'var(--border-color)' : 'var(--accent-primary)'};opacity:${n.leido ? 0.6 : 1};">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <strong style="font-size:0.9rem;">${n.titulo}</strong>
                    <span style="font-size:0.75rem;color:var(--text-muted);">${formatearFechaHora(n.fecha)}</span>
                </div>
                <p style="font-size:0.85rem;color:var(--text-secondary);margin-top:4px;">${n.mensaje}</p>
                ${!n.leido ? `<span class="badge badge-primary" style="margin-top:6px;">Nueva</span>` : ''}
            </div>
        `).join('');
    } catch(err) {
        console.error('Error cargando notificaciones:', err);
    }
}

async function marcarTodasLeidas() {
    try {
        await fetchAPI('/api/dashboard/notificaciones/leer-todas', { method: 'PUT' });
        cargarNotificaciones();
        mostrarToast('Notificaciones marcadas como leídas', 'success');
    } catch(e) {}
}

// ═══════════════════════════════════════════
// AUDITORÍA
// ═══════════════════════════════════════════
async function cargarAuditoria() {
    try {
        // Cargar resumen
        const resumen = await fetchAPI('/api/auditoria/resumen');
        document.getElementById('stat-audit-total').textContent = resumen.totalGeneral;
        document.getElementById('stat-audit-24h').textContent = resumen.ultimas24h;
        document.getElementById('stat-audit-7d').textContent = resumen.ultimos7d;
        document.getElementById('stat-audit-accesos').textContent = resumen.totalAccesos;

        // Cargar logs con filtros
        const accion = document.getElementById('filtro-audit-accion').value;
        const usuario = document.getElementById('filtro-audit-usuario').value;
        const desde = document.getElementById('filtro-audit-desde').value;
        const hasta = document.getElementById('filtro-audit-hasta').value;

        let url = '/api/auditoria?limite=100';
        if (accion) url += `&accion=${encodeURIComponent(accion)}`;
        if (usuario) url += `&usuario=${encodeURIComponent(usuario)}`;
        if (desde) url += `&desde=${desde}`;
        if (hasta) url += `&hasta=${hasta}`;

        const data = await fetchAPI(url);

        document.getElementById('audit-logs-tabla').innerHTML = data.logs.length ? `
            <table class="tabla">
                <thead><tr><th>Fecha</th><th>Usuario</th><th>Rol</th><th>Acción</th><th>Descripción</th></tr></thead>
                <tbody>
                    ${data.logs.map(l => `
                        <tr>
                            <td style="font-size:0.78rem;white-space:nowrap;">${formatearFechaHora(l.fecha)}</td>
                            <td><strong>${l.nombre_usuario || 'Sistema'}</strong></td>
                            <td><span class="badge ${l.rol_usuario==='ADMIN'?'badge-primary':l.rol_usuario==='SUPERVISOR'?'badge-info':'badge-success'}">${l.rol_usuario || '-'}</span></td>
                            <td><span class="badge badge-warning" style="font-size:0.72rem;">${l.accion}</span></td>
                            <td style="font-size:0.82rem;color:var(--text-secondary);max-width:300px;">${l.descripcion || ''}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        ` : '<div class="empty-state"><p>No hay logs de auditoría</p></div>';

        // Cargar accesos
        const accesos = await fetchAPI('/api/auditoria/accesos?limite=50');
        document.getElementById('audit-accesos-tabla').innerHTML = accesos.length ? `
            <table class="tabla">
                <thead><tr><th>Fecha Login</th><th>Usuario</th><th>Rol</th><th>IP</th><th>Dispositivo</th></tr></thead>
                <tbody>
                    ${accesos.map(a => `
                        <tr>
                            <td style="font-size:0.78rem;white-space:nowrap;">${formatearFechaHora(a.fecha_login)}</td>
                            <td><strong>${a.nombre_usuario}</strong></td>
                            <td><span class="badge badge-info">${a.rol}</span></td>
                            <td style="font-size:0.82rem;">${a.ip || '-'}</td>
                            <td style="font-size:0.82rem;color:var(--text-muted);max-width:200px;overflow:hidden;text-overflow:ellipsis;">${a.dispositivo || '-'}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        ` : '<div class="empty-state"><p>No hay registros de acceso</p></div>';

    } catch(err) {
        console.error('Error cargando auditoría:', err);
    }
}

function mostrarTabAudit(tab) {
    if (tab === 'logs') {
        document.getElementById('audit-logs-container').style.display = 'block';
        document.getElementById('audit-accesos-container').style.display = 'none';
        document.getElementById('tab-logs').className = 'btn btn-sm btn-primary';
        document.getElementById('tab-accesos').className = 'btn btn-sm btn-ghost';
    } else {
        document.getElementById('audit-logs-container').style.display = 'none';
        document.getElementById('audit-accesos-container').style.display = 'block';
        document.getElementById('tab-logs').className = 'btn btn-sm btn-ghost';
        document.getElementById('tab-accesos').className = 'btn btn-sm btn-primary';
    }
}

function exportarAuditoria() {
    const desde = document.getElementById('filtro-audit-desde').value;
    const hasta = document.getElementById('filtro-audit-hasta').value;
    let url = '/api/auditoria/exportar?';
    if (desde) url += `desde=${desde}&`;
    if (hasta) url += `hasta=${hasta}&`;
    window.open(url, '_blank');
    mostrarToast('Descargando CSV de auditoría...', 'success');
}

function exportarAccesos() {
    window.open('/api/auditoria/accesos/exportar', '_blank');
    mostrarToast('Descargando CSV de accesos...', 'success');
}

async function cargarSupervisores() {
    try {
        const usuarios = await fetchAPI('/api/usuarios?rol=SUPERVISOR');
        const container = document.getElementById('lista-supervisores');

        if (!usuarios.length) {
            container.innerHTML = '<div class="empty-state"><p>No hay supervisores registrados</p></div>';
            return;
        }

        container.innerHTML = `
            <table class="tabla">
                <thead>
                    <tr>
                        <th>Nombre</th>
                        <th>Código</th>
                        <th>Teléfono</th>
                        <th>Correo</th>
                        <th>Empleados</th>
                        <th>Estado</th>
                        <th>Acciones</th>
                    </tr>
                </thead>
                <tbody>
                    ${usuarios.map(u => `
                        <tr>
                            <td><strong>${u.nombre}</strong></td>
                            <td><span class="empresa-codigo">${u.codigo_acceso}</span></td>
                            <td>${u.telefono || '-'}</td>
                            <td>${u.correo || '-'}</td>
                            <td><span class="badge badge-info">${u.total_empleados || 0}</span></td>
                            <td><span class="badge ${u.estado ? 'badge-success' : 'badge-danger'}">${u.estado ? 'Activo' : 'Inactivo'}</span></td>
                            <td>
                                <div style="display:flex;gap:6px;flex-wrap:wrap;">
                                    ${USUARIO.rol === 'ADMIN' ? `<button class="btn btn-sm" style="background:linear-gradient(135deg,#10b981,#059669);color:white;font-size:0.72rem;padding:5px 10px;" onclick="cambiarRolUsuario('${u.id_usuario}', 'GERENTE', '${u.nombre.replace(/'/g, "\\'")}')" title="Promover a Gerente">👔 Gerente</button>` : ''}
                                    <button class="btn btn-sm" style="background:linear-gradient(135deg,#f59e0b,#d97706);color:white;font-size:0.72rem;padding:5px 10px;" onclick="cambiarRolUsuario('${u.id_usuario}', 'EMPLEADO', '${u.nombre.replace(/'/g, "\\'")}')" title="Degradar a Empleado">⬇️ Empleado</button>
                                    <button class="btn btn-sm" style="background:linear-gradient(135deg,#3b82f6,#2563eb);color:white;font-size:0.72rem;padding:5px 10px;" onclick="abrirEditarUsuario('${u.id_usuario}')" title="Editar">✏️</button>
                                    <button class="btn btn-sm" style="background:linear-gradient(135deg,#ef4444,#dc2626);color:white;font-size:0.72rem;padding:5px 10px;" onclick="eliminarUsuario('${u.id_usuario}', '${u.nombre.replace(/'/g, "\\'")}')" title="Eliminar">🗑️</button>
                                </div>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    } catch(err) {
        console.error('Error cargando supervisores:', err);
    }
}

// ----------------------------------------------------
// ASIGNAR EMPLEADOS A SUPERVISOR
// ----------------------------------------------------
async function abrirModalAsignarEmpleados(idSupervisor, nombreSupervisor) {
    document.getElementById('asignar-emp-id-supervisor').value = idSupervisor;
    document.getElementById('asignar-emp-nombre').textContent = nombreSupervisor;
    document.getElementById('modal-asignar-empleados').style.display = 'flex';
    document.getElementById('lista-checks-empleados').innerHTML = '<div style="text-align:center;padding:20px;">Cargando empleados... ⏳</div>';
    document.getElementById('btn-submit-asignar').disabled = true;

    try {
        // Obtener todos los empleados de la empresa
        const empleados = await fetchAPI('/api/usuarios?rol=EMPLEADO');
        // Obtener los asignados actualmente a este supervisor
        const asignados = await fetchAPI(`/api/empresas/supervisores/${idSupervisor}/empleados`);
        
        let html = '';
        if (empleados.length === 0) {
            html = '<div style="text-align:center;padding:10px;color:var(--text-muted)">No hay empleados registrados en la empresa.</div>';
        } else {
            // Filtrar: Solo mostrar si NO tienen supervisor O si el supervisor es el actual (para poder desmarcar)
            const empleadosDisponibles = empleados.filter(emp => {
                return !emp.supervisor || emp.supervisor.id_supervisor === idSupervisor;
            });

            if (empleadosDisponibles.length === 0) {
                html = '<div style="text-align:center;padding:10px;color:var(--text-muted)">Todos los empleados ya tienen un supervisor asignado.</div>';
            } else {
                empleadosDisponibles.forEach(emp => {
                    const checked = asignados.includes(emp.id_usuario) ? 'checked' : '';
                    html += `
                        <label style="display:flex;align-items:center;gap:10px;padding:12px;border-radius:10px;transition:0.2s;cursor:pointer;border:1px solid var(--border-color);margin-bottom:6px;" onmouseover="this.style.background='var(--bg-hover)'" onmouseout="this.style.background='transparent'">
                            <input type="checkbox" name="emp_asignado" value="${emp.id_usuario}" ${checked} style="width:20px;height:20px;accent-color:var(--accent-primary);">
                            <div style="display:flex;flex-direction:column;">
                                <span style="font-weight:700;font-size:0.95rem;color:var(--text-primary);">${emp.nombre}</span>
                                <span style="font-size:0.75rem;color:var(--text-muted);">Cód: ${emp.codigo_acceso}</span>
                            </div>
                        </label>
                    `;
                });
            }
        }
        document.getElementById('lista-checks-empleados').innerHTML = html;
        document.getElementById('btn-submit-asignar').disabled = false;
    } catch(err) {
        document.getElementById('lista-checks-empleados').innerHTML = `<div style="color:var(--danger);padding:10px;text-align:center;">Error: ${err.message}</div>`;
    }
}

function cerrarModalAsignarEmpleados() {
    document.getElementById('modal-asignar-empleados').style.display = 'none';
}

async function guardarAsignacionEmpleados(e) {
    e.preventDefault();
    const idSupervisor = document.getElementById('asignar-emp-id-supervisor').value;
    const btnSubmit = document.getElementById('btn-submit-asignar');
    
    // Recopilar checkboxes seleccionados
    const checkboxes = document.querySelectorAll('input[name="emp_asignado"]:checked');
    const empleadosSeleccionados = Array.from(checkboxes).map(chk => chk.value);

    try {
        btnSubmit.disabled = true;
        btnSubmit.innerHTML = 'Guardando... <span class="spinner"></span>';
        
        await fetchAPI(`/api/empresas/supervisores/${idSupervisor}/empleados`, {
            method: 'POST',
            body: JSON.stringify({ empleados: empleadosSeleccionados })
        });
        
        mostrarToast('Empleados asignados correctamente', 'success');
        cerrarModalAsignarEmpleados();
        
        // Refrescar la tabla para actualizar la columna "Empleados"
        cargarSupervisores();
    } catch(err) {
        mostrarToast(err.message || 'Error al guardar asignación', 'error');
    } finally {
        btnSubmit.disabled = false;
        btnSubmit.innerText = 'Guardar Cambios';
    }
}

async function cargarEmpleados() {
    try {
        const usuarios = await fetchAPI('/api/usuarios?rol=EMPLEADO');
        const container = document.getElementById('lista-empleados');

        if (!usuarios.length) {
            container.innerHTML = '<div class="empty-state"><p>No hay empleados registrados</p></div>';
            return;
        }

        container.innerHTML = `
            <table class="tabla">
                <thead>
                    <tr>
                        <th>Nombre</th>
                        <th>Código</th>
                        <th>Teléfono</th>
                        <th>Supervisor</th>
                        <th>Estado</th>
                        <th>Acciones</th>
                    </tr>
                </thead>
                <tbody>
                    ${usuarios.map(u => `
                        <tr>
                            <td><strong>${u.nombre}</strong></td>
                            <td><span class="empresa-codigo">${u.codigo_acceso}</span></td>
                            <td>${u.telefono || '-'}</td>
                            <td>${u.supervisor ? u.supervisor.nombre_supervisor : '<span style="color:var(--text-muted)">Sin asignar</span>'}</td>
                            <td><span class="badge ${u.estado ? 'badge-success' : 'badge-danger'}">${u.estado ? 'Activo' : 'Inactivo'}</span></td>
                            <td>
                                <div style="display:flex;gap:6px;flex-wrap:wrap;">
                                    <button class="btn btn-sm" style="background:linear-gradient(135deg,#8b5cf6,#6d28d9);color:white;font-size:0.72rem;padding:5px 10px;" onclick="cambiarRolUsuario('${u.id_usuario}', 'SUPERVISOR', '${u.nombre.replace(/'/g, "\\'")}')" title="Promover a Supervisor">⬆️ Supervisor</button>
                                    <button class="btn btn-sm" style="background:linear-gradient(135deg,#3b82f6,#2563eb);color:white;font-size:0.72rem;padding:5px 10px;" onclick="abrirEditarUsuario('${u.id_usuario}')" title="Editar">✏️</button>
                                    <button class="btn btn-sm" style="background:linear-gradient(135deg,#ef4444,#dc2626);color:white;font-size:0.72rem;padding:5px 10px;" onclick="eliminarUsuario('${u.id_usuario}', '${u.nombre.replace(/'/g, "\\'")}')" title="Eliminar">🗑️</button>
                                </div>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    } catch(err) {
        console.error('Error cargando empleados:', err);
    }
}

async function cambiarRolUsuario(idUsuario, nuevoRol, nombre) {
    const accion = nuevoRol === 'SUPERVISOR' ? 'PROMOVER a Supervisor' : nuevoRol === 'GERENTE' ? 'PROMOVER a Gerente' : 'CAMBIAR a Empleado';
    if (!confirm(`¿${accion} a "${nombre}"?\n\nSu código de acceso se mantendrá.`)) return;
    try {
        await fetchAPI(`/api/usuarios/${idUsuario}/rol`, {
            method: 'PUT',
            body: JSON.stringify({ rol: nuevoRol })
        });
        mostrarToast(`${nombre} ahora es ${nuevoRol}`, 'success');
        cargarSupervisores();
        cargarEmpleados();
    } catch(err) {
        mostrarToast(err.message || 'Error al cambiar rol', 'error');
    }
}

// ═══════════════════════════════════════════
// EDITAR / ELIMINAR USUARIOS
// ═══════════════════════════════════════════
async function abrirEditarUsuario(idUsuario) {
    try {
        const usuarios = await fetchAPI('/api/usuarios');
        const u = usuarios.find(x => x.id_usuario === idUsuario);
        if (!u) return mostrarToast('Usuario no encontrado', 'error');
        
        document.getElementById('editar-usu-id').value = u.id_usuario;
        document.getElementById('editar-usu-nombre').value = u.nombre || '';
        document.getElementById('editar-usu-identificacion').value = u.identificacion || '';
        document.getElementById('editar-usu-telefono').value = u.telefono || '';
        document.getElementById('editar-usu-correo').value = u.correo || '';
        document.getElementById('editar-usu-estado').value = u.estado ? '1' : '0';
        document.getElementById('editar-usu-titulo').textContent = `✏️ Editar ${u.rol === 'SUPERVISOR' ? 'Supervisor' : u.rol === 'GERENTE' ? 'Gerente' : 'Empleado'}: ${u.nombre}`;
        document.getElementById('modal-editar-usuario').style.display = 'flex';
    } catch(err) {
        mostrarToast('Error cargando datos del usuario', 'error');
    }
}

function cerrarModalEditarUsuario() {
    document.getElementById('modal-editar-usuario').style.display = 'none';
}

async function guardarEdicionUsuario(e) {
    e.preventDefault();
    const id = document.getElementById('editar-usu-id').value;
    const body = {
        nombre: document.getElementById('editar-usu-nombre').value.trim(),
        identificacion: document.getElementById('editar-usu-identificacion').value.trim(),
        telefono: document.getElementById('editar-usu-telefono').value.trim(),
        correo: document.getElementById('editar-usu-correo').value.trim(),
        estado: parseInt(document.getElementById('editar-usu-estado').value)
    };
    if (!body.nombre) return mostrarToast('El nombre es requerido', 'error');
    try {
        const res = await fetchAPI(`/api/usuarios/${id}`, { method: 'PUT', body: JSON.stringify(body) });
        if (res.error) return mostrarToast(res.error, 'error');
        mostrarToast('Usuario actualizado ✅', 'success');
        cerrarModalEditarUsuario();
        cargarSupervisores();
        cargarEmpleados();
    } catch(err) {
        mostrarToast(err.message || 'Error al guardar', 'error');
    }
}

async function eliminarUsuario(idUsuario, nombre) {
    if (!confirm(`⚠️ ¿Eliminar a "${nombre}"?\n\nEsta acción NO se puede deshacer.\nEl usuario quedará inactivo permanentemente.`)) return;
    try {
        const res = await fetchAPI(`/api/usuarios/${idUsuario}`, { method: 'DELETE' });
        if (res.error) return mostrarToast(res.error, 'error');
        mostrarToast(`"${nombre}" eliminado correctamente`, 'success');
        cargarSupervisores();
        cargarEmpleados();
    } catch(err) {
        mostrarToast(err.message || 'Error al eliminar', 'error');
    }
}

// ═══════════════════════════════════════════
// GESTIÓN DE USUARIOS (Modal)
// ═══════════════════════════════════════════
// Helper: Detectar si el usuario es del área de RRHH o Administración Central
function esUsuarioRRHH() {
    if (!USUARIO) return false;
    if (USUARIO.rol === 'ADMIN' || USUARIO.rol === 'ROOT') return true;
    
    const depto = (USUARIO.nombre_departamento || '').toUpperCase();
    const nombre = (USUARIO.nombre || '').toUpperCase();
    
    // Términos comunes para RRHH
    const keywords = ['RRHH', 'RECURSOS HUMANOS', 'TALENTO HUMANO', 'HUMANOS', 'PERSONAL', 'ADMINISTRACION'];
    const esRRHH = keywords.some(k => depto.includes(k) || nombre.includes(k));
    
    return esRRHH;
}

// Ocultar botones de creación si no es RRHH o ADMIN
function actualizarVisibilidadCreacion() {
    if (!USUARIO) return;
    const esRRHH = esUsuarioRRHH();
    const esAdmin = (USUARIO.rol === 'ADMIN' || USUARIO.rol === 'ROOT');
    
    // Botones "Nuevo Supervisor" y "Nuevo Empleado" - Visibles para RRHH y Admin
    document.querySelectorAll('.btn-sm').forEach(btn => {
        if (btn.textContent.includes('Nuevo Supervisor') || btn.textContent.includes('Nuevo Empleado')) {
            btn.style.display = esRRHH ? 'inline-flex' : 'none';
        }
    });

    // Botón "Visión Global 360°" - Solo para el Director General (no para RRHH)
    const btn360 = document.querySelector('button[onclick="abrirVisionGlobal360()"]');
    if (btn360) {
        btn360.style.display = esAdmin ? 'inline-flex' : 'none';
    }
    
    // Si no es admin, cerrar/ocultar el modal 360 por si acaso quedó abierto
    if (!esAdmin) {
        const modal360 = document.getElementById('modal-vision-360');
        if (modal360) modal360.style.display = 'none';
    }

    // Sidebar de configuración - Solo Director General
    const menuCfg = document.getElementById('menu-configuracion');
    if (menuCfg) {
        menuCfg.style.display = esAdmin ? 'block' : 'none';
    }

    // Botón "Resumen de Tareas" en sidebar - Solo para Gerente
    const menuResumenGerencia = document.getElementById('menu-resumen-gerencia');
    if (menuResumenGerencia) {
        const esGerente = USUARIO.rol === 'GERENTE';
        if (esGerente) {
            menuResumenGerencia.textContent = `📋 Reporte-Tareas`;
            menuResumenGerencia.style.display = 'block';
        } else {
            menuResumenGerencia.style.display = 'none';
        }
    }
}

// Cargar jefes disponibles (Supervisores, Gerentes y Director) según el departamento destino
async function cargarSupervisoresPorDepto(idDepto) {
    const selectJefe = document.getElementById('usu-jefe');
    if (!idDepto) {
        selectJefe.innerHTML = '<option value="">-- Seleccionar Gerencia Primero --</option>';
        return;
    }
    
    const rolNuevo = document.getElementById('usu-rol').value;

    try {
        selectJefe.innerHTML = '<option value="">Cargando jefes...</option>';
        
        let html = '<option value="">-- Sin Jefe (Directo) --</option>';
        let idGerenteFocus = null;

        // 1. Cargar el Director General (ADMIN) - Siempre disponible como opción superior
        try {
            const admins = await fetchAPI('/api/usuarios?rol=ADMIN');
            admins.forEach(a => {
                html += `<option value="${a.id_usuario}">${a.nombre} (Director General)</option>`;
            });
        } catch(e) {}

        let dActual = null;
        // 2. Cargar el Gerente de esta área
        try {
            const deptos = await fetchAPI('/api/departamentos');
            dActual = deptos.find(d => d.id_departamento === idDepto);
            if (dActual && dActual.gerente) {
                html += `<option value="${dActual.gerente.id_usuario}">${dActual.gerente.nombre} (Gerente directo - ${dActual.nombre})</option>`;
                idGerenteFocus = dActual.gerente.id_usuario;
            }
        } catch(e) {}

        // 3. Si es para un EMPLEADO, también cargar los SUPERVISORES del área
        if (rolNuevo === 'EMPLEADO') {
            try {
                const supervisores = await fetchAPI(`/api/usuarios?rol=SUPERVISOR&departamento=${idDepto}`);
                supervisores.forEach(s => {
                    const deptoName = dActual ? dActual.nombre : 'Área';
                    html += `<option value="${s.id_usuario}">${s.nombre} (Supervisor - ${deptoName})</option>`;
                });
                
                // Si estamos creando un Empleado y hay supervisores, preferimos auto-seleccionar al primer supervisor
                if (supervisores.length > 0) {
                    idGerenteFocus = supervisores[0].id_usuario;
                }
            } catch(e) {}
        }
        
        selectJefe.innerHTML = html;
        if (idGerenteFocus) {
            selectJefe.value = idGerenteFocus;
        }
        
    } catch(e) {
        console.error('Error cargando jefes por depto:', e);
        selectJefe.innerHTML = '<option value="">-- Error al cargar jefes --</option>';
    }
}

async function mostrarFormularioUsuario(rol) {
    try {
        document.getElementById('usu-rol').value = rol;
        document.getElementById('modal-usuario-titulo').textContent = `Nuevo ${rol === 'SUPERVISOR' ? 'Supervisor' : 'Empleado'}`;
        document.getElementById('form-usuario').reset();
        document.getElementById('form-usuario').style.display = 'block';
        document.getElementById('resultado-usuario').style.display = 'none';

        // OPEN MODAL FIRST
        document.getElementById('modal-usuario').style.display = 'flex';

        document.getElementById('usu-lada').value = '+502'; // Default
        
        // 1. Manejo de Gerencia/Departamento de Destino
        const rrhh = esUsuarioRRHH();
        const grupoDepto = document.getElementById('grupo-usu-depto');
        const selectDepto = document.getElementById('usu-depto');
        
        if (rrhh) {
            grupoDepto.style.display = 'block';
            selectDepto.innerHTML = '<option value="">Cargando departamentos...</option>';
            try {
                const deptos = await fetchAPI('/api/departamentos');
                selectDepto.innerHTML = '<option value="">-- Seleccionar Destino --</option>';
                deptos.forEach(d => {
                    selectDepto.innerHTML += `<option value="${d.id_departamento}">${d.nombre}</option>`;
                });
                // Auto-seleccionar mi depto por defecto si soy RRHH
                if (USUARIO.id_departamento) selectDepto.value = USUARIO.id_departamento;
            } catch(e) { console.log('Error deptos:', e); }
        } else {
            grupoDepto.style.display = 'none';
        }

        // 2. Lógica de jefes inmediatos
        const grupoJefe = document.getElementById('grupo-jefe');
        const selectJefe = document.getElementById('usu-jefe');
        const labelJefe = document.getElementById('label-jefe');
        
        if (rol === 'EMPLEADO') {
            grupoJefe.style.display = 'block';
            labelJefe.textContent = 'Jefe Inmediato (Supervisor, Gerente o Director)';
            
            if (rrhh) {
                // RRHH debe seleccionar depto primero
                if (selectDepto.value) await cargarSupervisoresPorDepto(selectDepto.value);
                else selectJefe.innerHTML = '<option value="">-- Selecciona Gerencia Primero --</option>';
            } else {
                // Caso legado o respaldo (auto-asignado)
                selectJefe.innerHTML = `<option value="${USUARIO.id_usuario}" selected>${USUARIO.nombre} (Asignación Directa)</option>`;
            }
        } else if (rol === 'SUPERVISOR') {
            grupoJefe.style.display = 'block';
            labelJefe.textContent = 'Jefe Inmediato (Gerente o Director)';
            
            if (rrhh) {
                if (selectDepto.value) await cargarSupervisoresPorDepto(selectDepto.value);
                else selectJefe.innerHTML = '<option value="">-- Selecciona Gerencia Primero --</option>';
            } else {
                selectJefe.innerHTML = `<option value="${USUARIO.id_usuario}" selected>${USUARIO.nombre} (Gerente/Director)</option>`;
            }
        } else {
            grupoJefe.style.display = 'none';
        }

    } catch(err) {
        console.error('Error abriendo formulario usuario:', err);
        document.getElementById('modal-usuario').style.display = 'flex';
    }
}

function cerrarModalUsuario() {
    document.getElementById('modal-usuario').style.display = 'none';
    // Refrescar lista
    if (USUARIO && (USUARIO.rol === 'ADMIN' || USUARIO.rol === 'GERENTE')) {
        const panelActual = document.querySelector('.nav-btn.activo');
        if (panelActual) {
            const panel = panelActual.dataset.panel;
            if (panel === 'supervisores') cargarSupervisores();
            if (panel === 'empleados') cargarEmpleados();
        }
        cargarEmpleados();
    } else if (USUARIO && USUARIO.rol === 'SUPERVISOR') {
        // Refrescar paneles de supervisor
        if (typeof cargarEmpleadosModSup === 'function') cargarEmpleadosModSup();
        if (typeof cargarDashboardSupervisor === 'function') cargarDashboardSupervisor();
        // Si hay una lista genérica también
        if (typeof cargarEmpleadosSupervisor === 'function') cargarEmpleadosSupervisor();
    }
}

async function crearUsuario(e) {
    e.preventDefault();

    const lada = document.getElementById('usu-lada').value.trim();
    const tel = document.getElementById('usu-telefono').value.trim();
    const telefonoCompleto = tel ? `${lada} ${tel}` : '';

    const datos = {
        nombre: document.getElementById('usu-nombre').value.trim(),
        identificacion: document.getElementById('usu-identificacion').value.trim(),
        telefono: telefonoCompleto,
        correo: document.getElementById('usu-correo').value.trim(),
        rol: document.getElementById('usu-rol').value,
        id_departamento: document.getElementById('usu-depto').value || undefined,
        id_jefe: document.getElementById('usu-jefe').value || undefined
    };

    try {
        const res = await fetchAPI('/api/usuarios', {
            method: 'POST',
            body: JSON.stringify(datos)
        });

        // Mostrar resultado con código
        document.getElementById('form-usuario').style.display = 'none';
        document.getElementById('resultado-usuario').style.display = 'block';
        document.getElementById('res-usu-nombre').textContent = res.usuario.nombre;
        document.getElementById('res-usu-rol').textContent = res.usuario.rol;
        document.getElementById('res-usu-codigo').textContent = res.usuario.codigo_acceso;

        mostrarToast(`${datos.rol === 'SUPERVISOR' ? 'Supervisor' : 'Empleado'} creado exitosamente`, 'success');
    } catch(err) {
        mostrarToast(err.message || 'Error al crear usuario', 'error');
    }
}

// ═══════════════════════════════════════════
// GESTIÓN DE TAREAS
// ═══════════════════════════════════════════
let TAREA_ACTUAL = null;
let CRONOMETRO_INTERVAL = null;

async function cargarEstadisticasTareas() {
    try {
        const stats = await fetchAPI('/api/tareas/estadisticas');
        if (USUARIO.rol === 'ADMIN' || USUARIO.rol === 'GERENTE') {
            const elP = document.getElementById('stat-pendientes'); if(elP) elP.textContent = stats.pendientes;
            const elEp = document.getElementById('stat-en-proceso'); if(elEp) elEp.textContent = stats.en_proceso;
            const elF = document.getElementById('stat-finalizadas'); if(elF) elF.textContent = stats.finalizadas;
            const elA = document.getElementById('stat-atrasadas'); if(elA) elA.textContent = stats.atrasadas;
        } else if (USUARIO.rol === 'SUPERVISOR') {
            // Actualizar status cards del equipo
            const elP = document.getElementById('sup-equipo-pendientes'); if(elP) elP.textContent = stats.pendientes;
            const elEp = document.getElementById('sup-equipo-proceso'); if(elEp) elEp.textContent = stats.en_proceso;
            const elF = document.getElementById('sup-equipo-finalizadas'); if(elF) elF.textContent = stats.finalizadas;
            const elA = document.getElementById('sup-equipo-atrasadas'); if(elA) elA.textContent = stats.atrasadas;
        }
    } catch(e) {}
}

// Filtrar tareas del equipo del supervisor por estado (clic en status cards)
let _filtroEquipoSupActual = null;
function filtrarTareasSupEquipo(estado) {
    if (_filtroEquipoSupActual === estado) {
        _filtroEquipoSupActual = null; // Toggle off
    } else {
        _filtroEquipoSupActual = estado;
    }
    window.FILTRO_ESTADO_ACTUAL = _filtroEquipoSupActual || '';
    cargarTareas();
}

async function cargarTareas() {
    try {
        const estado = window.FILTRO_ESTADO_ACTUAL || '';
        const prioridad = document.getElementById('filtro-prioridad')?.value || '';

        let url = '/api/tareas?';
        if (estado === 'finalizada') {
            url += `estado=finalizada&`;
        } else if (estado) {
            url += `estado=${estado}&`;
        }
        if (prioridad) url += `prioridad=${prioridad}&`;

        let tareas = await fetchAPI(url);
        // Supervisor usa cargarTareasEmpleado() para Mis Tareas, no esta función
        if (USUARIO.rol === 'SUPERVISOR') return;
        const containerId = 'lista-tareas';
        const container = document.getElementById(containerId);
        if (!container) return;

        cargarEstadisticasTareas();

        if (!estado) {
            tareas = tareas.filter(t => !['finalizada', 'finalizada_atrasada', 'cancelada'].includes(t.estado));
        }
        if (estado === 'finalizada') {
            const urlAtrasada = '/api/tareas?estado=finalizada_atrasada' + (prioridad ? `&prioridad=${prioridad}` : '');
            try {
                const tareasAtrasadas = await fetchAPI(urlAtrasada);
                tareas = [...tareas, ...tareasAtrasadas];
                tareas.sort((a,b) => new Date(b.fecha_creacion) - new Date(a.fecha_creacion));
            } catch(e) {}
            // Limitar a las 20 más recientes
            tareas = tareas.slice(0, 20);
        }

        if (!tareas.length) {
            container.innerHTML = '<div class="empty-state"><p>No hay tareas' + (estado ? ` "${estado.replace('_',' ')}"` : '') + '</p></div>';
            return;
        }

        container.innerHTML = tareas.map(t => {
            const prioridadColor = {
                'urgente': '#ef4444', 'alta': '#f97316', 'media': '#6366f1', 'baja': '#10b981'
            }[t.prioridad] || '#6366f1';
            const estadoBadgeClass = {
                'pendiente': 'badge-warning', 'en_proceso': 'badge-primary',
                'finalizada': 'badge-success', 'atrasada': 'badge-danger',
                'finalizada_atrasada': 'badge-warning', 'cancelada': 'badge-info'
            }[t.estado] || 'badge-info';
            const estadoTexto = {
                'pendiente': '🟡 Pendiente', 'en_proceso': '🔵 En Proceso',
                'finalizada': '🟢 Finalizada', 'atrasada': '🔴 Atrasada',
                'finalizada_atrasada': '🟠 Fin. Atrasada', 'cancelada': '⬜ Cancelada'
            }[t.estado] || t.estado;

            let tiempoRealStr = '';
            if ((t.estado === 'finalizada' || t.estado === 'finalizada_atrasada') && t.fecha_inicio && t.fecha_fin) {
                const segs = Math.round((new Date(t.fecha_fin) - new Date(t.fecha_inicio)) / 1000);
                tiempoRealStr = formatearCronoAdmin(segs);
            }

            const hasBadge = t.total_evidencias > 0 || t.total_comentarios > 0;

            return `
            <div class="tarea-row-wrap" id="wrap-${t.id_tarea}">
                <div class="tarea-row glass" style="border-left:4px solid ${prioridadColor};">
                    <!-- Prioridad -->
                    <div class="tarea-row-prioridad" style="background:${prioridadColor}22;color:${prioridadColor};">${t.prioridad.toUpperCase()}</div>

                    <!-- Info principal -->
                    <div class="tarea-row-main">
                        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                            ${t.codigo_tarea ? `<span style="font-size:0.68rem;font-weight:700;color:var(--accent-primary);background:rgba(99,102,241,0.15);padding:2px 8px;border-radius:6px;letter-spacing:0.5px;">${t.codigo_tarea}</span>` : ''}
                            <span style="font-size:0.95rem;font-weight:700;">${t.titulo}</span>
                            <span class="badge ${estadoBadgeClass}" style="font-size:0.65rem;">${estadoTexto}</span>
                            ${t.nombre_tipo ? `<span style="font-size:0.7rem;color:var(--text-muted);background:rgba(255,255,255,0.06);padding:2px 7px;border-radius:10px;">${t.nombre_tipo}</span>` : ''}
                        </div>
                        ${t.descripcion ? `<div style="font-size:0.77rem;color:var(--text-secondary);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:350px;" title="${t.descripcion}">${t.descripcion}</div>` : ''}
                    </div>

                    <!-- Info rápida -->
                    <div class="tarea-row-info">
                        ${t.nombre_empleado ? `<span class="empresa-stat">👤 ${t.nombre_empleado}</span>` : '<span class="empresa-stat" style="opacity:0.4;">Sin asignar</span>'}
                        ${t.nombre_supervisor ? `<span class="empresa-stat">👁 ${t.nombre_supervisor}</span>` : ''}
                        ${tiempoRealStr ? `<span class="empresa-stat" style="color:#00ff88;font-weight:600;">⏱ ${tiempoRealStr}</span>` : (t.tiempo_estimado_minutos ? `<span class="empresa-stat">⏳ ${formatearTiempo(t.tiempo_estimado_minutos)}</span>` : '')}
                        ${t.total_evidencias > 0 ? `<span class="empresa-stat" style="color:#a78bfa;">📸 ${t.total_evidencias}</span>` : ''}
                        ${t.total_comentarios > 0 ? `<span class="empresa-stat" style="color:#60a5fa;">💬 ${t.total_comentarios}</span>` : ''}
                    </div>

                    <!-- Fecha + botón expand -->
                    <div class="tarea-row-fecha">
                        <span style="font-size:0.7rem;color:var(--text-muted);">📅 ${formatearFecha(t.fecha_creacion)}</span>
                        <span style="font-size:0.68rem;color:#a78bfa;">🕐 ${formatearHoraEmpresa(t.fecha_creacion)}</span>
                        ${t.fecha_fin ? `<span style="font-size:0.68rem;color:#10b981;">✅ ${formatearFecha(t.fecha_fin)}</span>` : ''}
                        <button class="btn-expand-tarea" onclick="event.stopPropagation();toggleDetalleTarea('${t.id_tarea}')" title="Ver detalles">
                            <span id="icon-expand-${t.id_tarea}">▼</span>
                        </button>
                    </div>
                </div>

                <!-- Panel expandible (oculto por defecto) -->
                <div id="detalle-${t.id_tarea}" class="tarea-detalle-panel" style="display:none;">
                    <div class="tarea-detalle-loading">⏳ Cargando detalles...</div>
                </div>
            </div>`;
        }).join('');
    } catch(err) {
        console.error('Error cargando tareas:', err);
    }
}

// Toggle panel de detalles inline
async function toggleDetalleTarea(idTarea) {
    const panel = document.getElementById(`detalle-${idTarea}`);
    const icon = document.getElementById(`icon-expand-${idTarea}`);
    const wrap = document.getElementById(`wrap-${idTarea}`);
    if (!panel) return;

    const isOpen = panel.style.display !== 'none';
    if (isOpen) {
        panel.style.display = 'none';
        icon.textContent = '▼';
        wrap.classList.remove('expanded');
        return;
    }

    // Abrir y cargar
    panel.style.display = 'block';
    icon.textContent = '▲';
    wrap.classList.add('expanded');
    panel.innerHTML = '<div class="tarea-detalle-loading">⏳ Cargando detalles...</div>';

    try {
        const data = await fetchAPI(`/api/tareas/${idTarea}`);
        const t = data;

        // Timestamps
        const fmtDT = (d) => d ? `${formatearFecha(d)} · ${formatearHoraEmpresa(d)}` : '<em style="color:var(--text-muted)">—</em>';

        // Calcular duración real
        let duracionHTML = '';
        if (t.fecha_inicio && t.fecha_fin) {
            const segs = Math.round((new Date(t.fecha_fin) - new Date(t.fecha_inicio)) / 1000);
            duracionHTML = `<span style="color:#00ff88;font-weight:700;">${formatearCronoAdmin(segs)}</span>`;
        }

        // ¿A tiempo o tarde?
        let eficienciaHTML = '';
        if (t.estado === 'finalizada') eficienciaHTML = `<span class="badge badge-success">✅ A tiempo</span>`;
        else if (t.estado === 'finalizada_atrasada') eficienciaHTML = `<span class="badge badge-danger">⚠️ Con atraso</span>`;

        // Evidencias (lazy load: solo metadatos vienen en la respuesta, contenido se carga individualmente)
        let evidenciasHTML = '';
        if (t.evidencias && t.evidencias.length > 0) {
            evidenciasHTML = `
            <div class="detalle-seccion">
                <div class="detalle-seccion-titulo">📸 Evidencias (${t.evidencias.length})</div>
                <div class="detalle-evidencias-grid" id="evidencias-grid-${idTarea}">
                    ${t.evidencias.map(ev => {
                        const isImg = ev.tipo === 'imagen';
                        if (isImg) {
                            return `<div class="evidencia-thumb" id="ev-thumb-${ev.id_evidencia}" style="min-height:80px;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.03);border-radius:8px;">
                                <span style="font-size:0.7rem;color:var(--text-muted);">⏳ Cargando...</span>
                            </div>`;
                        } else if (ev.tipo === 'texto') {
                            return `<div class="evidencia-texto" id="ev-thumb-${ev.id_evidencia}">📝 Cargando...</div>`;
                        }
                        return `<div class="evidencia-archivo" id="ev-thumb-${ev.id_evidencia}">📎 ${ev.tipo || 'Archivo'}</div>`;
                    }).join('')}
                </div>
            </div>`;
            // Lazy load: cargar cada evidencia individualmente después de renderizar
            setTimeout(() => {
                t.evidencias.forEach(ev => {
                    fetchAPI(`/api/tareas/${idTarea}/evidencias/${ev.id_evidencia}`).then(evData => {
                        const thumb = document.getElementById(`ev-thumb-${ev.id_evidencia}`);
                        if (!thumb) return;
                        const isImg = evData.tipo === 'imagen';
                        if (isImg && evData.contenido) {
                            thumb.innerHTML = `<img src="${evData.contenido}" alt="evidencia" loading="lazy" style="width:100%;height:100%;object-fit:cover;border-radius:8px;">
                                <div class="evidencia-overlay">🔍 Ver</div>`;
                            thumb.style.cursor = 'pointer';
                            thumb.onclick = () => abrirImagenCompleta(evData.contenido);
                        } else if (evData.contenido) {
                            thumb.innerHTML = `<a href="${evData.contenido}" target="_blank" style="color:var(--accent-primary);">📎 ${evData.tipo || 'Archivo'}</a>`;
                        } else if (evData.texto) {
                            thumb.innerHTML = `📝 ${evData.texto}`;
                        }
                    }).catch(err => {
                        const thumb = document.getElementById(`ev-thumb-${ev.id_evidencia}`);
                        if (thumb) thumb.innerHTML = `<span style="font-size:0.7rem;color:var(--danger);">❌ Error</span>`;
                    });
                });
            }, 100);
        } else {
            evidenciasHTML = `<div class="detalle-seccion"><div class="detalle-seccion-titulo">📸 Evidencias</div><p style="font-size:0.8rem;color:var(--text-muted);margin:0;">Sin evidencias registradas</p></div>`;
        }

        // Comentarios
        let comentariosHTML = '';
        if (t.comentarios && t.comentarios.length > 0) {
            comentariosHTML = `
            <div class="detalle-seccion">
                <div class="detalle-seccion-titulo">💬 Comentarios (${t.comentarios.length})</div>
                <div style="display:flex;flex-direction:column;gap:6px;">
                    ${t.comentarios.map(c => `
                    <div style="padding:8px 12px;background:rgba(255,255,255,0.04);border-radius:8px;border-left:2px solid rgba(99,102,241,0.4);">
                        <div style="font-size:0.75rem;color:var(--accent-primary-hover);font-weight:600;margin-bottom:3px;">
                            ${c.nombre_usuario || 'Usuario'} · <span style="color:var(--text-muted);font-weight:400;">${formatearFechaHora(c.fecha)}</span>
                        </div>
                        <div style="font-size:0.82rem;color:var(--text-secondary);">${c.comentario}</div>
                    </div>`).join('')}
                </div>
            </div>`;
        }



        // ── Sección: Observaciones del empleado ──
        const obsHTML = `
            <div class="detalle-seccion" style="margin-top:12px;">
                <div class="detalle-seccion-titulo">📝 Observaciones del Empleado</div>
                ${t.observaciones_tarea
                    ? `<p style="font-size:0.82rem;color:var(--text-secondary);margin:0;line-height:1.6;background:rgba(99,102,241,0.06);padding:10px;border-radius:8px;border-left:3px solid #6366f1;">${t.observaciones_tarea}</p>`
                    : `<p style="font-size:0.78rem;color:var(--text-muted);margin:0;font-style:italic;">Sin observaciones</p>`
                }
            </div>`;

        // ── Sección: Cliente (si aplica) ──
        let clienteHTML = '';
        if (t.tiene_cliente && parseInt(t.tiene_cliente) === 1) {
            const concluido = t.cliente_concluido && parseInt(t.cliente_concluido) === 1;
            clienteHTML = `
            <div class="detalle-seccion" style="margin-top:12px;">
                <div class="detalle-seccion-titulo">👤 Cliente</div>
                <div style="background:rgba(16,185,129,0.07);border:1px solid rgba(16,185,129,0.2);border-radius:10px;padding:12px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                        <div>
                            <div style="font-weight:700;">${t.nombre_cliente||'—'}</div>
                            <div style="font-size:0.7rem;color:#10b981;font-weight:600;">Código: ${t.codigo_cliente||'—'}</div>
                        </div>
                        <span style="padding:3px 8px;border-radius:99px;font-size:0.7rem;font-weight:700;background:${concluido?'rgba(16,185,129,0.15)':'rgba(245,158,11,0.15)'};color:${concluido?'#10b981':'#f59e0b'};">
                            ${concluido?'✅ ATENDIDO':'⏳ PENDIENTE'}
                        </span>
                    </div>
                    <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:0.8rem;margin-bottom:8px;">
                        ${t.telefono_cliente?`<span>📞 ${t.telefono_cliente}</span>`:''}
                        ${t.correo_cliente?`<span>✉️ ${t.correo_cliente}</span>`:''}
                        ${t.fecha_seguimiento?`<span style="color:#f59e0b;">📅 Seguimiento: ${t.fecha_seguimiento}</span>`:''}
                    </div>
                    ${t.obs_cliente?`<p style="font-size:0.78rem;color:var(--text-secondary);margin:0 0 8px;border-top:1px solid rgba(255,255,255,0.07);padding-top:8px;">${t.obs_cliente}</p>`:''}
                    ${!concluido?`<button class="btn btn-sm" style="background:linear-gradient(135deg,#10b981,#059669);color:white;font-size:0.75rem;" onclick="_detalleActualId='${t.id_tarea}';_detalleActualTarea=${JSON.stringify({...t,observaciones_tarea:undefined,historial:undefined,evidencias:undefined,comentarios:undefined}).replace(/</g,'&lt;')};marcarClienteConcluido()">✅ Marcar Evento Concluido</button>`:''}
                </div>
            </div>`;
        }

        panel.innerHTML = `
        <div class="tarea-detalle-content">
            <!-- Fila de timestamps -->
            <div class="detalle-timestamps">
                <div class="detalle-ts-item">
                    <div class="detalle-ts-label">📋 Asignada</div>
                    <div class="detalle-ts-val">${fmtDT(t.fecha_creacion)}</div>
                </div>
                <div class="detalle-ts-sep">→</div>
                <div class="detalle-ts-item">
                    <div class="detalle-ts-label">▶ Iniciada</div>
                    <div class="detalle-ts-val">${fmtDT(t.fecha_inicio)}</div>
                </div>
                <div class="detalle-ts-sep">→</div>
                <div class="detalle-ts-item">
                    <div class="detalle-ts-label">✅ Terminada</div>
                    <div class="detalle-ts-val">${fmtDT(t.fecha_fin)}</div>
                </div>
                ${duracionHTML ? `
                <div class="detalle-ts-sep">⏱</div>
                <div class="detalle-ts-item">
                    <div class="detalle-ts-label">Duración real</div>
                    <div class="detalle-ts-val">${duracionHTML} ${eficienciaHTML}</div>
                </div>` : ''}
            </div>

            <!-- Descripción completa -->
            ${t.descripcion ? `<div class="detalle-seccion"><div class="detalle-seccion-titulo">📝 Descripción</div><p style="font-size:0.85rem;color:var(--text-secondary);margin:0;line-height:1.6;">${t.descripcion}</p></div>` : ''}

            <!-- Cliente (si aplica) -->
            ${clienteHTML}

            <!-- Observaciones del empleado -->
            ${obsHTML}

            <!-- Evidencias + Comentarios en 2 col -->
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:12px;">
                ${evidenciasHTML}
                ${comentariosHTML || '<div></div>'}
            </div>
        </div>`;
    } catch(err) {
        panel.innerHTML = '<div style="padding:12px;color:var(--accent-red);font-size:0.85rem;">Error al cargar detalles</div>';
    }
}

// Abrir imagen a pantalla completa
function abrirImagenCompleta(src) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:9999;background:rgba(0,0,0,0.9);display:flex;align-items:center;justify-content:center;cursor:zoom-out;backdrop-filter:blur(8px);';
    overlay.innerHTML = `<img src="${src}" style="max-width:90vw;max-height:90vh;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,0.8);animation:fadeInUp 0.3s ease;">`;
    overlay.onclick = () => overlay.remove();
    document.body.appendChild(overlay);
}


async function mostrarFormularioTarea() {
    document.getElementById('form-tarea').reset();
    
    const supGroup = document.getElementById('tarea-supervisor')?.closest('.form-group');
    if (supGroup) supGroup.style.display = '';

    // Valores por defecto
    document.getElementById('tarea-tiempo').value = 1;
    document.getElementById('tarea-tiempo-unidad').value = 60;

    // Cargar empleados y supervisores
    try {
        const usuarios = await fetchAPI('/api/usuarios');
        const selEmp = document.getElementById('tarea-empleado');
        const selSup = document.getElementById('tarea-supervisor');
        
        selEmp.innerHTML = '<option value="">-- Seleccionar Empleado --</option>';
        selSup.innerHTML = '<option value="">-- Seleccionar Supervisor --</option>';
        
        // 1. Si es GERENTE, agregarse como opción principal de supervisor
        if (USUARIO.rol === 'GERENTE') {
            selSup.innerHTML += `<option value="${USUARIO.id_usuario}" selected>${USUARIO.nombre} (Gerente)</option>`;
        }

        usuarios.forEach(u => {
            if (u.rol === 'EMPLEADO') {
                const idSup = u.id_jefe || (u.supervisor && u.supervisor.id_supervisor) || '';
                selEmp.innerHTML += `<option value="${u.id_usuario}" data-supervisor="${idSup}">${u.nombre}</option>`;
            }
            if (u.rol === 'SUPERVISOR') {
                selSup.innerHTML += `<option value="${u.id_usuario}">${u.nombre}</option>`;
                // Los supervisores también pueden ser asignados como empleados de una tarea
                selEmp.innerHTML += `<option value="${u.id_usuario}" data-supervisor="${u.id_usuario}">[SUP] ${u.nombre}</option>`;
            }
        });

        // Event listener para auto-seleccionar supervisor al cambiar empleado
        selEmp.onchange = function() {
            const opt = this.options[this.selectedIndex];
            if (!opt || !opt.value) return;
            
            const idSup = opt.getAttribute('data-supervisor');
            console.log(`📡 Auto-asignando supervisor para ${opt.text}:`, idSup);
            
            if (idSup && idSup !== 'null' && idSup !== 'undefined') {
                // Verificar que el supervisor exista en el select antes de asignarlo
                const exists = Array.from(selSup.options).some(o => o.value === idSup);
                if (exists) {
                    selSup.value = idSup;
                }
            } else if (USUARIO.rol === 'GERENTE') {
                // Si no tiene jefe asignado y el creador es Gerente, mantenerse él como jefe
                selSup.value = USUARIO.id_usuario;
            }
        };
    } catch(e) { console.error('Error cargando selects de tarea:', e); }
    // Cargar tipos
    try {
        const tipos = await fetchAPI('/api/tareas/tipos/lista');
        const selTipo = document.getElementById('tarea-tipo');
        selTipo.innerHTML = '<option value="">-- Seleccionar tipo --</option>';
        tipos.forEach(t => { 
            const isSelected = (t.nombre && t.nombre.toLowerCase().includes('operativa')) ? 'selected' : '';
            selTipo.innerHTML += `<option value="${t.id_tipo}" ${isSelected}>${t.nombre}</option>`; 
        });
    } catch(e) {}
    
    // Si no se seleccionó nada, intentar forzar la selección de 'operativa'
    const selTipo = document.getElementById('tarea-tipo');
    if (selTipo && !selTipo.value) {
        for (let opt of selTipo.options) {
            if (opt.text.toLowerCase().includes('operativa')) {
                opt.selected = true;
                break;
            }
        }
    }
    document.getElementById('modal-tarea').style.display = 'flex';
    document.getElementById('tarea-tiempo-preview').style.display = 'none'; // reset preview
}

function calcularTiempoEstimadoDisplay() {
    const raw = parseInt(document.getElementById('tarea-tiempo').value);
    const unidad = parseInt(document.getElementById('tarea-tiempo-unidad').value) || 1;
    const finSemana = document.getElementById('tarea-fin-semana').checked;
    const prevDiv = document.getElementById('tarea-tiempo-preview');
    const prevSpan = document.getElementById('tarea-preview-val');

    if (!raw || isNaN(raw) || raw <= 0) {
        if(prevDiv) prevDiv.style.display = 'none';
        return;
    }

    let finalMins = raw * unidad;
    if (!finSemana) {
        let diasEv = Math.ceil(finalMins / 1440);
        let ex = 0;
        let cal = new Date();
        while (diasEv > 0) {
            cal.setDate(cal.getDate() + 1);
            if (cal.getDay() === 0 || cal.getDay() === 6) ex++;
            else diasEv--;
        }
        finalMins += (ex * 1440);
    }
    
    if(prevSpan) prevSpan.textContent = formatearTiempo(finalMins);
    if(prevDiv) prevDiv.style.display = 'block';
    
    return finalMins;
}

function cerrarModalTarea() {
    document.getElementById('modal-tarea').style.display = 'none';
}

async function crearTarea(e) {
    e.preventDefault();
    const tiempoEstFinal = calcularTiempoEstimadoDisplay() || undefined;

    const tieneCliente = document.getElementById('tarea-tiene-cliente')?.checked;
    
    const datos = {
        titulo: document.getElementById('tarea-titulo').value.trim(),
        descripcion: document.getElementById('tarea-descripcion').value.trim(),
        id_empleado: document.getElementById('tarea-empleado').value || undefined,
        id_supervisor: document.getElementById('tarea-supervisor').value || undefined,
        id_tipo: document.getElementById('tarea-tipo').value || undefined,
        prioridad: document.getElementById('tarea-prioridad').value,
        tiempo_estimado_minutos: tiempoEstFinal,
        requiere_evidencia: document.getElementById('tarea-req-evidencia') ? document.getElementById('tarea-req-evidencia').checked : false,
        // Al crear la tarea ahora solo enviamos el flag de que sí requiere cliente
        tiene_cliente: tieneCliente ? 1 : 0
    };

    try {
        const resp = await fetchAPI('/api/tareas', { method: 'POST', body: JSON.stringify(datos) });
        cerrarModalTarea();
        
        // Resetear campo
        if (document.getElementById('tarea-tiene-cliente')) document.getElementById('tarea-tiene-cliente').checked = false;
        
        // Restaurar campo supervisor si estaba oculto
        const supGroup = document.getElementById('tarea-supervisor')?.closest('.form-group');
        if (supGroup) supGroup.style.display = '';
        
        // Recargar panel según rol
        if (USUARIO.rol === 'SUPERVISOR') {
            filtrarTareasEquipoSup('');
        } else {
            cargarTareas();
        }
        const msg = datos.fecha_seguimiento
            ? 'Tarea creada ✅ — Se generó una tarea de seguimiento para el cliente'
            : 'Tarea creada exitosamente ✅';
        mostrarToast(msg, 'success');
    } catch(err) {
        mostrarToast(err.message || 'Error al crear tarea', 'error');
    }
}

async function verDetalleTarea(id) {
    try {
        const tarea = await fetchAPI(`/api/tareas/${id}`);
        TAREA_ACTUAL = tarea;

        document.getElementById('detalle-titulo').textContent = tarea.titulo;

        // Info
        const estadoEmoji = { 'pendiente':'🟡','en_proceso':'🔵','finalizada':'🟢','atrasada':'🔴','finalizada_atrasada':'🟠' }[tarea.estado]||'⚪';
        document.getElementById('detalle-info').innerHTML = `
            <div class="resultado-datos">
                <div class="dato-row"><span class="dato-label">Estado</span><span class="dato-value">${estadoEmoji} ${tarea.estado.replace('_',' ')}</span></div>
                <div class="dato-row"><span class="dato-label">Prioridad</span><span class="dato-value">${tarea.prioridad}</span></div>
                ${tarea.descripcion ? `<div class="dato-row"><span class="dato-label">Descripción</span><span class="dato-value">${tarea.descripcion}</span></div>` : ''}
                ${tarea.nombre_empleado ? `<div class="dato-row"><span class="dato-label">Empleado</span><span class="dato-value">${tarea.nombre_empleado}</span></div>` : ''}
                ${tarea.nombre_supervisor ? `<div class="dato-row"><span class="dato-label">Supervisor</span><span class="dato-value">${tarea.nombre_supervisor}</span></div>` : ''}
                ${tarea.tiempo_estimado_minutos ? `<div class="dato-row"><span class="dato-label" style="font-weight:600">Tiempo estimado</span><span class="dato-value" style="color:var(--primary);font-weight:700">${formatearTiempo(tarea.tiempo_estimado_minutos)}</span></div>` : ''}
                ${tarea.tiempo_real_segundos ? `<div class="dato-row"><span class="dato-label">Tiempo real</span><span class="dato-value">${formatearTiempoHMS(tarea.tiempo_real_segundos)}</span></div>` : ''}
            </div>`;

        // Acciones
        let acciones = '';
        if (tarea.estado === 'pendiente') {
            acciones += `<button class="btn btn-primary btn-sm" onclick="iniciarTarea('${tarea.id_tarea}')">▶️ Iniciar Tarea</button>`;
        }
        if (tarea.estado === 'en_proceso' || tarea.estado === 'atrasada') {
            acciones += `<button class="btn btn-success btn-sm" onclick="finalizarTarea('${tarea.id_tarea}')">✅ Finalizar Tarea</button>`;
        }
        
        let puedeModificar = true;
        if (sessionStorage.getItem('ROL') === 'SUPERVISOR' && window.SUPERVISOR_PUEDE_MODIFICAR === false) {
            puedeModificar = false;
        }

        if (puedeModificar) {
            // El backend no tiene un 'Editar Tarea' directamente desde Detalles, pero sí Eliminar.
            acciones += `<button class="btn btn-danger btn-sm" onclick="eliminarTarea('${tarea.id_tarea}')">🗑 Eliminar</button>`;
        }
        document.getElementById('detalle-acciones').innerHTML = acciones;

        // Cronómetro
        if (tarea.estado === 'en_proceso' && tarea.tiempo_inicio) {
            iniciarCronometro(tarea.tiempo_inicio, tarea.tiempo_estimado_minutos);
        } else {
            detenerCronometro();
        }

        // Comentarios
        renderizarComentarios(tarea.comentarios || []);
        // Evidencias
        renderizarEvidencias(tarea.evidencias || []);
        // Historial
        renderizarHistorial(tarea.historial || []);

        document.getElementById('modal-detalle-tarea').style.display = 'flex';
    } catch(err) {
        mostrarToast('Error al cargar tarea', 'error');
    }
}

function cerrarDetalleTarea() {
    document.getElementById('modal-detalle-tarea').style.display = 'none';
    detenerCronometro();
    TAREA_ACTUAL = null;
    cargarTareas();
}

async function iniciarTarea(id) {
    try {
        let body = {};
        // Intentar capturar GPS
        if (navigator.geolocation) {
            try {
                const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, {timeout:5000}));
                body.lat = pos.coords.latitude;
                body.lng = pos.coords.longitude;
            } catch(e) {}
        }
        await fetchAPI(`/api/tareas/${id}/iniciar`, { method: 'PUT', body: JSON.stringify(body) });
        mostrarToast('¡Tarea iniciada! Cronómetro en marcha', 'success');
        verDetalleTarea(id);
    } catch(err) {
        mostrarToast(err.message, 'error');
    }
}

async function finalizarTarea(id) {
    try {
        let body = {};
        if (navigator.geolocation) {
            try {
                const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, {timeout:5000}));
                body.lat = pos.coords.latitude;
                body.lng = pos.coords.longitude;
            } catch(e) {}
        }
        const res = await fetchAPI(`/api/tareas/${id}/finalizar`, { method: 'PUT', body: JSON.stringify(body) });
        mostrarToast(`Tarea finalizada en ${res.tiempo_formateado} · +${res.puntos_ganados} pts`, 'success');
        verDetalleTarea(id);
    } catch(err) {
        if (err.message && err.message.includes('evidencias para finalizar')) {
            Swal.fire({
                icon: 'warning',
                title: 'Faltan Evidencias',
                text: 'Esta tarea requiere evidencias fotográficas antes de poder finalizarse.',
                confirmButtonText: '📸 Subir Imágen Ahora',
                confirmButtonColor: '#3b82f6',
                showCancelButton: true,
                cancelButtonText: 'Cancelar'
            }).then((result) => {
                if (result.isConfirmed) subirImagenRapida(id);
            });
        } else {
            mostrarToast(err.message, 'error');
        }
    }
}

async function subirImagenRapida(idTarea) {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.multiple = true;
    
    fileInput.onchange = async (e) => {
        const files = Array.from(e.target.files);
        if (!files.length) return;
        
        Swal.fire({ 
            title: 'Optimizando...', 
            html: `<p>Comprimiendo ${files.length} imagen(es)...</p><p style="font-size:0.8rem;color:#999;">Redimensionando y comprimiendo para envío rápido</p>`, 
            allowOutsideClick: false, 
            didOpen: () => { Swal.showLoading() } 
        });
        
        let subidas = 0;
        let errores = 0;
        let totalOriginalKB = 0;
        let totalOptimizedKB = 0;
        
        for (const file of files) {
            try {
                // 🖼️ OPTIMIZAR: resize 1024px + JPEG 70% (como Pillow en Python)
                const { base64, originalKB, optimizedKB } = await optimizarImagen(file, {
                    maxSize: 1024,
                    quality: 0.70
                });
                totalOriginalKB += originalKB;
                totalOptimizedKB += optimizedKB;
                
                const resp = await fetch(`/api/tareas/${idTarea}/evidencias/base64`, {
                    method: 'POST', 
                    headers: { 
                        'Authorization': `Bearer ${TOKEN}`,
                        'Content-Type': 'application/json'
                    }, 
                    body: JSON.stringify({ tipo: 'imagen', contenido: base64 })
                });
                if (!resp.ok) {
                    const err = await resp.json().catch(() => ({}));
                    console.error('Error subiendo evidencia:', err);
                    throw new Error(err.error || 'Error');
                }
                subidas++;
            } catch(err) { 
                console.error('Error procesando imagen:', err);
                errores++;
            }
        }
        
        Swal.close();
        if (subidas > 0) {
            const ahorro = totalOriginalKB > 0 ? Math.round((1 - totalOptimizedKB / totalOriginalKB) * 100) : 0;
            const msgAhorro = ahorro > 0 
                ? `(${totalOriginalKB}KB → ${totalOptimizedKB}KB, -${ahorro}%)` 
                : '';
            mostrarToast(`📸 ${subidas} foto(s) subida(s) ✅ ${msgAhorro}${errores > 0 ? ` · ${errores} fallidas` : ''}`, 'success');
        } else {
            mostrarToast('Error al subir imágenes. Intenta de nuevo.', 'error');
        }
        // Recargar la lista de tareas del empleado para actualizar el contador de fotos
        if (typeof cargarTareasEmpleado === 'function') cargarTareasEmpleado();
        // Si estaba viendo el detalle abierto, recargar
        if (TAREA_ACTUAL && TAREA_ACTUAL.id_tarea === idTarea) verDetalleTarea(idTarea);
    };
    fileInput.click();
}

async function eliminarTarea(id) {
    if (!confirm('¿Eliminar esta tarea?')) return;
    try {
        await fetchAPI(`/api/tareas/${id}`, { method: 'DELETE' });
        cerrarDetalleTarea();
        mostrarToast('Tarea eliminada', 'info');
    } catch(err) {
        mostrarToast(err.message, 'error');
    }
}

// Cronómetro
function iniciarCronometro(horaInicio, tiempoEstimadoMin) {
    detenerCronometro();
    const container = document.getElementById('detalle-cronometro');
    container.style.display = 'block';
    const inicio = new Date(horaInicio).getTime();
    const estimadoSeg = (tiempoEstimadoMin || 0) * 60;

    function actualizar() {
        const ahora = Date.now();
        const transcurrido = Math.floor((ahora - inicio) / 1000);
        let color = '#10b981'; // verde
        if (estimadoSeg > 0) {
            const pct = transcurrido / estimadoSeg;
            if (pct >= 1) color = '#ef4444'; // rojo
            else if (pct >= 0.8) color = '#f59e0b'; // amarillo
        }
        container.innerHTML = `
            <div style="text-align:center;padding:16px;">
                <div style="font-size:0.8rem;color:var(--text-secondary);margin-bottom:4px;">⏱ Tiempo transcurrido</div>
                <div style="font-size:2rem;font-weight:800;color:${color};font-family:monospace;">${formatearTiempoHMS(transcurrido)}</div>
                ${estimadoSeg > 0 ? `<div style="font-size:0.8rem;color:var(--text-muted);margin-top:4px;">Estimado: ${formatearTiempoHMS(estimadoSeg)}</div>` : ''}
            </div>`;
    }
    actualizar();
    CRONOMETRO_INTERVAL = setInterval(actualizar, 1000);
}

function detenerCronometro() {
    if (CRONOMETRO_INTERVAL) { clearInterval(CRONOMETRO_INTERVAL); CRONOMETRO_INTERVAL = null; }
    const container = document.getElementById('detalle-cronometro');
    if (container) container.style.display = 'none';
}

// Tabs detalle
function cambiarTabDetalle(tab, btn) {
    document.querySelectorAll('.tab-detalle').forEach(t => t.style.display = 'none');
    document.getElementById(`tab-${tab}`).style.display = 'block';
    btn.parentElement.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('activo'));
    btn.classList.add('activo');
}

// Comentarios
function renderizarComentarios(comentarios) {
    const container = document.getElementById('lista-comentarios');
    if (!comentarios.length) { container.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;">Sin comentarios</p>'; return; }
    container.innerHTML = comentarios.map(c => `
        <div style="padding:8px 0;border-bottom:1px solid var(--border-color);">
            <div style="display:flex;justify-content:space-between;">
                <strong style="font-size:0.85rem;">${c.nombre_usuario}</strong>
                <span style="font-size:0.75rem;color:var(--text-muted);">${formatearFechaHora(c.fecha)}</span>
            </div>
            <p style="font-size:0.88rem;color:var(--text-secondary);margin-top:4px;">${c.contenido}</p>
        </div>
    `).join('');
}

async function enviarComentario() {
    const input = document.getElementById('input-comentario');
    const contenido = input.value.trim();
    if (!contenido || !TAREA_ACTUAL) return;
    try {
        await fetchAPI(`/api/tareas/${TAREA_ACTUAL.id_tarea}/comentarios`, {
            method: 'POST', body: JSON.stringify({ contenido })
        });
        input.value = '';
        verDetalleTarea(TAREA_ACTUAL.id_tarea);
    } catch(e) { mostrarToast('Error al enviar comentario', 'error'); }
}

// Evidencias (lazy load: contenido se carga individualmente)
function renderizarEvidencias(evidencias) {
    const container = document.getElementById('lista-evidencias');
    if (!evidencias.length) { container.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;">Sin evidencias</p>'; return; }
    container.innerHTML = evidencias.map(ev => `
        <div style="padding:8px 0;border-bottom:1px solid var(--border-color);" id="modal-ev-${ev.id_evidencia}">
            <span class="badge ${ev.tipo === 'imagen' ? 'badge-info' : 'badge-primary'}" style="margin-bottom:4px;">${ev.tipo === 'imagen' ? '📸 Imagen' : '📝 Texto'}</span>
            <div style="margin-top:6px;min-height:40px;display:flex;align-items:center;">
                <span style="font-size:0.8rem;color:var(--text-muted);">⏳ Cargando contenido...</span>
            </div>
            <span style="font-size:0.75rem;color:var(--text-muted);">${formatearFechaHora(ev.fecha_registro)}</span>
        </div>
    `).join('');

    // Lazy load each evidence
    if (TAREA_ACTUAL) {
        evidencias.forEach(ev => {
            fetchAPI(`/api/tareas/${TAREA_ACTUAL.id_tarea}/evidencias/${ev.id_evidencia}`).then(evData => {
                const el = document.getElementById(`modal-ev-${ev.id_evidencia}`);
                if (!el) return;
                const contentDiv = el.querySelector('div[style*="min-height"]');
                if (!contentDiv) return;
                if (evData.tipo === 'imagen' && evData.contenido) {
                    contentDiv.innerHTML = `<img src="${evData.contenido}" alt="Evidencia" style="max-width:200px;max-height:150px;border-radius:8px;border:1px solid var(--border-color);cursor:pointer;" onclick="abrirImagenCompleta('${evData.contenido.replace(/'/g, "\\'")}')" >`;
                } else if (evData.contenido) {
                    contentDiv.innerHTML = `<p style="font-size:0.88rem;color:var(--text-secondary);margin:0;">${evData.contenido.substring(0, 200)}</p>`;
                }
            }).catch(() => {
                const el = document.getElementById(`modal-ev-${ev.id_evidencia}`);
                if (el) {
                    const contentDiv = el.querySelector('div[style*="min-height"]');
                    if (contentDiv) contentDiv.innerHTML = `<span style="color:var(--danger);font-size:0.8rem;">❌ Error al cargar</span>`;
                }
            });
        });
    }
}

async function enviarEvidencia() {
    const input = document.getElementById('input-evidencia-texto');
    const contenido = input.value.trim();
    if (!contenido || !TAREA_ACTUAL) return;
    try {
        await fetchAPI(`/api/tareas/${TAREA_ACTUAL.id_tarea}/evidencias`, {
            method: 'POST', body: JSON.stringify({ tipo: 'texto', contenido })
        });
        input.value = '';
        verDetalleTarea(TAREA_ACTUAL.id_tarea);
        mostrarToast('Evidencia agregada', 'success');
    } catch(e) { mostrarToast('Error al agregar evidencia', 'error'); }
}

async function subirImagenEvidencia() {
    if (!TAREA_ACTUAL) return;
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.multiple = true;
    
    fileInput.onchange = async (e) => {
        const files = Array.from(e.target.files);
        if (!files.length) return;
        
        Swal.fire({ 
            title: 'Optimizando...', 
            html: `<p>Comprimiendo e subiendo ${files.length} imagen(es)...</p>`, 
            allowOutsideClick: false, 
            didOpen: () => { Swal.showLoading() } 
        });
        
        let subidas = 0;
        
        for (const file of files) {
            try {
                // 🖼️ OPTIMIZAR: resize 1024px + JPEG 70%
                const { base64 } = await optimizarImagen(file, { maxSize: 1024, quality: 0.70 });
                
                const resp = await fetch(`/api/tareas/${TAREA_ACTUAL.id_tarea}/evidencias/base64`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ tipo: 'imagen', contenido: base64 })
                });
                if (resp.ok) subidas++;
            } catch(err) {
                console.error("Error optimizando o subiendo imagen:", err);
            }
        }
        
        Swal.close();
        
        if (subidas > 0) {
            verDetalleTarea(TAREA_ACTUAL.id_tarea);
            mostrarToast(`📸 ${subidas} Imagen(es) subida(s) correctamente`, 'success');
        } else {
            mostrarToast('Error al subir imágenes. Intente de nuevo.', 'error');
        }
    };
    fileInput.click();
}

// Historial
function renderizarHistorial(historial) {
    const container = document.getElementById('lista-historial');
    if (!historial.length) { container.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;">Sin historial</p>'; return; }
    container.innerHTML = historial.map(h => `
        <div style="padding:8px 0;border-bottom:1px solid var(--border-color);display:flex;align-items:center;gap:10px;">
            <div style="width:8px;height:8px;border-radius:50%;background:var(--accent-primary);flex-shrink:0;"></div>
            <div style="flex:1;">
                <span style="font-size:0.85rem;">${h.estado_anterior ? h.estado_anterior+' → ' : ''}${h.estado_nuevo}</span>
                ${h.comentario ? `<span style="font-size:0.8rem;color:var(--text-muted);"> · ${h.comentario}</span>` : ''}
                <div style="font-size:0.75rem;color:var(--text-muted);">${h.nombre_usuario || ''} · ${formatearFechaHora(h.fecha)}</div>
            </div>
        </div>
    `).join('');
}

function formatearTiempoHMS(segundos) {
    const h = Math.floor(segundos / 3600);
    const m = Math.floor((segundos % 3600) / 60);
    const s = segundos % 60;
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function formatearFechaHora(fecha) {
    if (!fecha) return '';
    const d = new Date(fecha);
    return d.toLocaleString('es-MX', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
}

// ═══════════════════════════════════════════
// UTILIDADES
// ═══════════════════════════════════════════
async function fetchAPI(url, options = {}) {
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers
    };

    if (TOKEN) {
        headers['Authorization'] = `Bearer ${TOKEN}`;
    }

    const res = await fetch(`${API}${url}`, { ...options, headers });
    const data = await res.json();

    if (!res.ok) {
        throw new Error(data.error || 'Error en la solicitud');
    }

    return data;
}

function mostrarPantalla(nombre) {
    document.querySelectorAll('.pantalla').forEach(p => p.classList.remove('activa'));
    document.getElementById(`pantalla-${nombre}`).classList.add('activa');
}

function mostrarErrorLogin(mensaje) {
    const el = document.getElementById('login-error');
    el.textContent = mensaje;
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 4000);
}

function mostrarToast(mensaje, tipo = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${tipo}`;
    toast.innerHTML = `
        ${tipo === 'success' ? '✅' : tipo === 'error' ? '❌' : 'ℹ️'}
        <span>${mensaje}</span>
    `;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease forwards';
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

function formatearFecha(fecha) {
    if (!fecha) return '';
    const d = new Date(fecha);
    return d.toLocaleDateString('es-MX', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
    });
}

// ═══════════════════════════════════════════
// PLANTILLAS REPETITIVAS Y PROGRAMADAS
// ═══════════════════════════════════════════
let PLANTILLA_TAB_ACTUAL = 'diaria';

async function abrirModalPlantillas() {
    document.getElementById('modal-plantillas').style.display = 'flex';
    
    // Valores por defecto
    ['plt-tiempo', 'cal-tiempo'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = 1;
    });
    ['plt-tiempo-unidad', 'cal-tiempo-unidad'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = 60;
    });
    // Cargar empleados y supervisores en los selects
    try {
        const usuarios = await fetchAPI('/api/usuarios');
        const empSelects = ['plt-empleado', 'cal-empleado'];
        const supSelects = ['plt-supervisor', 'cal-supervisor'];

        // Poblar selects de empleados con data-supervisor
        empSelects.forEach(selId => {
            const sel = document.getElementById(selId);
            if (!sel) return;
            sel.innerHTML = '<option value="">-- Seleccionar empleado --</option>';
            // 1. Empleados
            usuarios.filter(u => u.rol === 'EMPLEADO').forEach(u => {
                const idSup = u.id_jefe || (u.supervisor && u.supervisor.id_supervisor) || '';
                sel.innerHTML += `<option value="${u.id_usuario}" data-supervisor="${idSup}">${u.nombre}</option>`;
            });
            // 2. También agregar supervisores como asignables (pueden auto-asignarse tareas)
            usuarios.filter(u => u.rol === 'SUPERVISOR').forEach(u => {
                // Un supervisor no suele tener un jefe por encima, pero puede actuar como empleado
                sel.innerHTML += `<option value="${u.id_usuario}" data-supervisor="${u.id_usuario}">[SUP] ${u.nombre}</option>`;
            });
        });

        // Poblar selects de supervisores y asegurar visibilidad
        supSelects.forEach(selId => {
            const sel = document.getElementById(selId);
            if (!sel) return;
            
            // Asegurar que el grupo sea visible para Admin/Gerente
            const group = sel.closest('.form-group');
            if (group && (USUARIO.rol === 'ADMIN' || USUARIO.rol === 'GERENTE')) {
                group.style.display = '';
            }

            sel.innerHTML = '<option value="">-- Seleccionar --</option>';
            usuarios.filter(u => u.rol === 'SUPERVISOR' || u.rol === 'GERENTE').forEach(u => {
                sel.innerHTML += `<option value="${u.id_usuario}">${u.nombre} (${u.rol})</option>`;
            });
        });

        // Auto-selecionar supervisor al elegir empleado
        function setupAutoSupervisor(empId, supId) {
            const selEmp = document.getElementById(empId);
            const selSup = document.getElementById(supId);
            if (!selEmp || !selSup) return;

            // Si el usuario actual es SUPERVISOR, pre-seleccionarlo a él mismo
            if (USUARIO && USUARIO.rol === 'SUPERVISOR') {
                selSup.value = USUARIO.id_usuario;
            }

            selEmp.addEventListener('change', function() {
                const opt = this.options[this.selectedIndex];
                if (!opt || !opt.value) return;

                const idSup = opt.getAttribute('data-supervisor');
                console.log(`📡 Auto-selección de supervisor para ${opt.text}:`, idSup);

                if (idSup && idSup !== 'null' && idSup !== 'undefined') {
                    // Solo cambiar si el supervisor existe en el select
                    const exists = Array.from(selSup.options).some(o => o.value === idSup);
                    if (exists) {
                        selSup.value = idSup;
                    }
                } else if (USUARIO && USUARIO.rol === 'SUPERVISOR') {
                    // Si no tiene jefe asignado pero el que crea es supervisor, dejar al creador
                    selSup.value = USUARIO.id_usuario;
                }
            });
        }
        setupAutoSupervisor('plt-empleado', 'plt-supervisor');
        setupAutoSupervisor('cal-empleado', 'cal-supervisor');
    } catch(e) {}

    // Cargar tipos de tarea
    try {
        const tipos = await fetchAPI('/api/tareas/tipos/lista');
        ['plt-tipo', 'cal-tipo'].forEach(selId => {
            const sel = document.getElementById(selId);
            if (!sel) return;
            sel.innerHTML = '<option value="">-- Seleccionar tipo --</option>';
            tipos.forEach(t => {
                const isSelected = (t.nombre && t.nombre.toLowerCase().includes('operativa')) ? 'selected' : '';
                sel.innerHTML += `<option value="${t.id_tipo}" ${isSelected}>${t.nombre}</option>`;
            });
        });
    } catch(e) {}

    // Forzar selección de 'operativa' si no hay nada seleccionado
    ['plt-tipo', 'cal-tipo'].forEach(id => {
        const sel = document.getElementById(id);
        if (sel && !sel.value) {
            for (let opt of sel.options) {
                if (opt.text.toLowerCase().includes('operativa')) {
                    opt.selected = true;
                    break;
                }
            }
        }
    });

    cambiarTabPlantilla('diaria', document.querySelector('#modal-plantillas .nav-btn'));
}

function cerrarModalPlantillas() {
    document.getElementById('modal-plantillas').style.display = 'none';
}

function cambiarTabPlantilla(tab, btn) {
    PLANTILLA_TAB_ACTUAL = tab;
    // Actualizar botones activos
    document.querySelectorAll('#modal-plantillas .nav-btn').forEach(b => b.classList.remove('activo'));
    if (btn) btn.classList.add('activo');

    const formPlantilla = document.getElementById('form-plantilla-container');
    const formCalendario = document.getElementById('form-calendario-container');
    const listaContainer = document.getElementById('lista-plantillas-container');

    if (tab === 'calendario') {
        formPlantilla.style.display = 'none';
        formCalendario.style.display = 'block';
        listaContainer.style.display = 'none';
        cargarTareasProgramadas();
        return;
    }

    formPlantilla.style.display = 'block';
    formCalendario.style.display = 'none';
    listaContainer.style.display = 'block';

    document.getElementById('plt-recurrencia').value = tab;

    // Mostrar/ocultar opciones específicas
    document.getElementById('plt-dias-semana-container').style.display = tab === 'semanal' ? 'block' : 'none';
    document.getElementById('plt-dia-mes-container').style.display = tab === 'mensual' ? 'block' : 'none';
    document.getElementById('plt-fecha-anual-container').style.display = tab === 'anual' ? 'block' : 'none';

    const titulosTab = { 'diaria': '📋 Plantillas Diarias', 'semanal': '📋 Plantillas Semanales', 'mensual': '📋 Plantillas Mensuales', 'anual': '📋 Plantillas Anuales' };
    document.getElementById('titulo-lista-plantillas').textContent = titulosTab[tab] || '📋 Plantillas';

    cargarPlantillas(tab);
}

async function cargarPlantillas(recurrencia) {
    try {
        const plantillas = await fetchAPI(`/api/plantillas?recurrencia=${recurrencia}`);
        const container = document.getElementById('lista-plantillas');

        if (!plantillas.length) {
            container.innerHTML = '<div class="empty-state"><p>No hay plantillas de este tipo</p></div>';
            return;
        }

        const diasNombre = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
        const prioridadColor = { 'urgente': '#ef4444', 'alta': '#f97316', 'media': '#f59e0b', 'baja': '#10b981' };

        function hora24a12(h24) {
            if (!h24) return '7:00 AM';
            const [hh, mm] = h24.split(':');
            let h = parseInt(hh);
            const ampm = h >= 12 ? 'PM' : 'AM';
            if (h === 0) h = 12;
            else if (h > 12) h -= 12;
            return `${h}:${mm || '00'} ${ampm}`;
        }

        container.innerHTML = plantillas.map(p => {
            let frecInfo = '';
            if (p.recurrencia === 'semanal' && p.dias_semana) {
                frecInfo = p.dias_semana.split(',').map(d => diasNombre[parseInt(d)]).join(', ');
            } else if (p.recurrencia === 'mensual' && p.dias_semana) {
                frecInfo = `Día ${p.dias_semana} de cada mes`;
            } else if (p.recurrencia === 'anual' && p.dias_semana) {
                frecInfo = `Fecha: ${p.dias_semana}`;
            }

            return `
            <div class="empresa-card glass" style="border-left:3px solid ${prioridadColor[p.prioridad] || '#6366f1'}; opacity:${p.activa ? '1' : '0.5'}; margin-bottom:8px;">
                <div class="empresa-card-header">
                    <div class="empresa-avatar" style="background:${p.activa ? 'linear-gradient(135deg,#8b5cf6,#6d28d9)' : '#555'};font-size:1rem;">${p.activa ? '🔄' : '⏸'}</div>
                    <div style="flex:1;">
                        <h4 style="margin:0;">${p.titulo}</h4>
                        <span class="empresa-id" style="font-size:0.75rem;">
                            ${p.nombre_empleado ? `👤 ${p.nombre_empleado}` : 'Sin asignar'} · 
                            ⏰ ${hora24a12(p.hora_creacion)} ·
                            ${frecInfo ? frecInfo : p.recurrencia}
                        </span>
                    </div>
                    <div style="display:flex;flex-direction:column;align-items:flex-end;gap:2px;">
                        <span class="badge" style="background:${prioridadColor[p.prioridad]}22;color:${prioridadColor[p.prioridad]};font-size:0.7rem;">${p.prioridad.toUpperCase()}</span>
                        <span style="font-size:0.65rem;color:var(--text-muted);">Generadas: ${p.total_generadas || 0}</span>
                    </div>
                </div>
                <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;">
                    <button class="btn btn-sm" style="font-size:0.72rem;padding:4px 8px;background:${p.activa ? '#f59e0b' : '#10b981'};color:white;" onclick="togglePlantilla('${p.id_plantilla}')">
                        ${p.activa ? '⏸ Pausar' : '▶ Activar'}
                    </button>
                    <button class="btn btn-sm" style="font-size:0.72rem;padding:4px 8px;background:#3b82f6;color:white;" onclick="ejecutarPlantilla('${p.id_plantilla}')">
                        ⚡ Ejecutar ahora
                    </button>
                    <button class="btn btn-sm" style="font-size:0.72rem;padding:4px 8px;background:#8b5cf6;color:white;" onclick="editarPlantilla('${p.id_plantilla}','${encodeURIComponent(p.titulo)}','${encodeURIComponent(p.descripcion||'')}','${p.prioridad}','${p.hora_creacion||'07:00'}','${p.id_empleado_default||''}','${p.id_supervisor_default||''}','${p.tiempo_estimado_minutos||''}','${p.incluir_finsemana}','${p.dias_semana||''}')">
                        ✏️ Modificar
                    </button>
                    <button class="btn btn-sm" style="font-size:0.72rem;padding:4px 8px;background:#ef4444;color:white;" onclick="eliminarPlantilla('${p.id_plantilla}')">
                        🗑 Eliminar
                    </button>
                </div>
            </div>`;
        }).join('');
    } catch (err) {
        console.error('Error cargando plantillas:', err);
    }
}

function obtenerHora12a24() {
    let h = parseInt(document.getElementById('plt-hora-h').value);
    const m = document.getElementById('plt-hora-m').value;
    const ampm = document.getElementById('plt-hora-ampm').value;
    if (ampm === 'PM' && h !== 12) h += 12;
    if (ampm === 'AM' && h === 12) h = 0;
    return `${String(h).padStart(2,'0')}:${m}`;
}

let PLANTILLA_EDITANDO_ID = null;

async function crearPlantilla(e) {
    e.preventDefault();
    const recurrencia = document.getElementById('plt-recurrencia').value;
    const tiempoRaw = parseInt(document.getElementById('plt-tiempo').value);
    const unidad = parseInt(document.getElementById('plt-tiempo-unidad').value) || 1;

    let dias_semana = null;
    if (recurrencia === 'semanal') {
        const checks = document.querySelectorAll('.plt-dia-check:checked');
        dias_semana = Array.from(checks).map(c => c.value).join(',');
        if (!dias_semana) { mostrarToast('Selecciona al menos un día de la semana', 'error'); return; }
    } else if (recurrencia === 'mensual') {
        dias_semana = document.getElementById('plt-dia-mes').value;
    } else if (recurrencia === 'anual') {
        dias_semana = document.getElementById('plt-fecha-anual').value;
    }

    const datos = {
        titulo: document.getElementById('plt-titulo').value.trim(),
        descripcion: document.getElementById('plt-descripcion').value.trim(),
        id_empleado_default: document.getElementById('plt-empleado').value || undefined,
        id_supervisor_default: document.getElementById('plt-supervisor').value || undefined,
        id_tipo: document.getElementById('plt-tipo')?.value || undefined,
        prioridad: document.getElementById('plt-prioridad').value,
        recurrencia,
        dias_semana,
        hora_creacion: obtenerHora12a24(),
        tiempo_estimado_minutos: tiempoRaw ? (tiempoRaw * unidad) : undefined,
        incluir_finsemana: document.getElementById('plt-finsemana').checked,
        requiere_evidencia: document.getElementById('plt-req-evidencia')?.checked || false
    };

    try {
        if (PLANTILLA_EDITANDO_ID) {
            await fetchAPI(`/api/plantillas/${PLANTILLA_EDITANDO_ID}`, { method: 'PUT', body: JSON.stringify(datos) });
            mostrarToast('Plantilla modificada exitosamente', 'success');
            PLANTILLA_EDITANDO_ID = null;
            document.querySelector('#form-plantilla button[type="submit"]').innerHTML = '💾 Guardar';
        } else {
            await fetchAPI('/api/plantillas', { method: 'POST', body: JSON.stringify(datos) });
            mostrarToast('Plantilla creada exitosamente', 'success');
        }
        document.getElementById('form-plantilla').reset();
        document.getElementById('plt-recurrencia').value = recurrencia;
        cargarPlantillas(recurrencia);
    } catch (err) {
        mostrarToast(err.message || 'Error al guardar plantilla', 'error');
    }
}

async function togglePlantilla(id) {
    try {
        const res = await fetchAPI(`/api/plantillas/${id}/toggle`, { method: 'PUT' });
        mostrarToast(res.activa ? 'Plantilla activada' : 'Plantilla pausada', 'success');
        cargarPlantillas(PLANTILLA_TAB_ACTUAL);
    } catch (err) {
        mostrarToast('Error al cambiar estado', 'error');
    }
}

async function ejecutarPlantilla(id) {
    if (!confirm('¿Generar tarea ahora desde esta plantilla?')) return;
    try {
        await fetchAPI(`/api/plantillas/${id}/ejecutar`, { method: 'POST' });
        mostrarToast('Tarea generada exitosamente', 'success');
        cargarPlantillas(PLANTILLA_TAB_ACTUAL);
        cargarTareas();
    } catch (err) {
        mostrarToast('Error al generar tarea', 'error');
    }
}

function editarPlantilla(id, tituloEnc, descEnc, prioridad, hora24, empId, supId, minutos, finSemana, dias) {
    PLANTILLA_EDITANDO_ID = id;
    document.getElementById('plt-titulo').value = decodeURIComponent(tituloEnc);
    document.getElementById('plt-descripcion').value = decodeURIComponent(descEnc);
    document.getElementById('plt-prioridad').value = prioridad || 'media';

    // Setear hora en formato 12h
    if (hora24) {
        const [hh, mm] = hora24.split(':');
        let h = parseInt(hh);
        const ampm = h >= 12 ? 'PM' : 'AM';
        if (h === 0) h = 12;
        else if (h > 12) h -= 12;
        document.getElementById('plt-hora-h').value = h;
        document.getElementById('plt-hora-m').value = mm || '00';
        document.getElementById('plt-hora-ampm').value = ampm;
    }

    if (empId) document.getElementById('plt-empleado').value = empId;
    if (supId) document.getElementById('plt-supervisor').value = supId;
    if (minutos) {
        const m = parseInt(minutos);
        if (m >= 1440 && m % 1440 === 0) {
            document.getElementById('plt-tiempo').value = m / 1440;
            document.getElementById('plt-tiempo-unidad').value = '1440';
        } else if (m >= 60) {
            document.getElementById('plt-tiempo').value = m / 60;
            document.getElementById('plt-tiempo-unidad').value = '60';
        } else {
            document.getElementById('plt-tiempo').value = m;
            document.getElementById('plt-tiempo-unidad').value = '1';
        }
    }
    document.getElementById('plt-finsemana').checked = finSemana === '1';

    document.querySelector('#form-plantilla button[type="submit"]').innerHTML = '✏️ Modificar';
    document.getElementById('form-plantilla-container').scrollIntoView({ behavior: 'smooth' });
    mostrarToast('Editando plantilla — modifica los campos y presiona Modificar', 'info');
}

async function eliminarPlantilla(id) {
    if (!confirm('¿Eliminar esta plantilla permanentemente?')) return;
    try {
        await fetchAPI(`/api/plantillas/${id}`, { method: 'DELETE' });
        mostrarToast('Plantilla eliminada', 'success');
        cargarPlantillas(PLANTILLA_TAB_ACTUAL);
    } catch (err) {
        mostrarToast('Error al eliminar', 'error');
    }
}

// ═══════════════════════════════════════════
// TAREAS PROGRAMADAS POR CALENDARIO
// ═══════════════════════════════════════════
async function programarTareaCalendario(e) {
    e.preventDefault();
    const tiempoRaw = parseInt(document.getElementById('cal-tiempo').value);
    const unidad = parseInt(document.getElementById('cal-tiempo-unidad').value) || 1;

    const datos = {
        titulo: document.getElementById('cal-titulo').value.trim(),
        fecha_programada: document.getElementById('cal-fecha').value,
        hora_programada: document.getElementById('cal-hora').value || '08:00',
        id_empleado: document.getElementById('cal-empleado').value || undefined,
        id_supervisor: document.getElementById('cal-supervisor')?.value || undefined,
        id_tipo: document.getElementById('cal-tipo')?.value || undefined,
        prioridad: document.getElementById('cal-prioridad').value,
        tiempo_estimado_minutos: tiempoRaw ? (tiempoRaw * unidad) : undefined,
        requiere_evidencia: document.getElementById('cal-req-evidencia')?.checked || false
    };

    try {
        await fetchAPI('/api/plantillas/programadas', { method: 'POST', body: JSON.stringify(datos) });
        mostrarToast('Tarea programada exitosamente', 'success');
        document.getElementById('form-programar').reset();
        cargarTareasProgramadas();
    } catch (err) {
        mostrarToast(err.message || 'Error al programar', 'error');
    }
}

async function cargarTareasProgramadas() {
    try {
        const programadas = await fetchAPI('/api/plantillas/programadas');
        const container = document.getElementById('lista-programadas');

        if (!programadas.length) {
            container.innerHTML = '<div class="empty-state"><p>No hay tareas programadas</p></div>';
            return;
        }

        const prioridadColor = { 'urgente': '#ef4444', 'alta': '#f97316', 'media': '#f59e0b', 'baja': '#10b981' };

        container.innerHTML = programadas.map(tp => `
            <div class="empresa-card glass" style="border-left:3px solid ${tp.ejecutada ? '#10b981' : prioridadColor[tp.prioridad] || '#6366f1'}; margin-bottom:8px; opacity:${tp.ejecutada ? '0.6' : '1'};">
                <div class="empresa-card-header">
                    <div class="empresa-avatar" style="background:${tp.ejecutada ? '#10b981' : '#f59e0b'};font-size:1rem;">${tp.ejecutada ? '✅' : '📅'}</div>
                    <div style="flex:1;">
                        <h4 style="margin:0;">${tp.titulo}</h4>
                        <span class="empresa-id" style="font-size:0.75rem;">
                            📅 ${formatearFecha(tp.fecha_programada)} · ⏰ ${tp.hora_programada || '08:00'}
                            ${tp.nombre_empleado ? ` · 👤 ${tp.nombre_empleado}` : ''}
                        </span>
                    </div>
                    <span class="badge" style="background:${tp.ejecutada ? '#10b98122' : prioridadColor[tp.prioridad] + '22'};color:${tp.ejecutada ? '#10b981' : prioridadColor[tp.prioridad]};font-size:0.7rem;">
                        ${tp.ejecutada ? 'EJECUTADA' : tp.prioridad.toUpperCase()}
                    </span>
                </div>
                ${!tp.ejecutada ? `
                <div style="margin-top:6px;">
                    <button class="btn btn-sm" style="font-size:0.72rem;padding:4px 8px;background:#ef4444;color:white;" onclick="eliminarProgramada('${tp.id_programacion}')">🗑 Cancelar</button>
                </div>` : ''}
            </div>
        `).join('');
    } catch (err) {
        console.error('Error cargando programadas:', err);
    }
}

async function eliminarProgramada(id) {
    if (!confirm('¿Cancelar esta tarea programada?')) return;
    try {
        await fetchAPI(`/api/plantillas/programadas/${id}`, { method: 'DELETE' });
        mostrarToast('Tarea programada cancelada', 'success');
        cargarTareasProgramadas();
    } catch (err) {
        mostrarToast('Error al cancelar', 'error');
    }
}

// ═══════════════════════════════════════════
// ASISTENCIA (CHECK-IN / CHECK-OUT)
// ═══════════════════════════════════════════
let CHECKIN_ACTIVO = false;

async function verificarEstadoCheckin() {
    try {
        const res = await fetchAPI('/api/asistencia/estado');
        if (res.presente && res.registro) {
            CHECKIN_ACTIVO = true;
            actualizarUICheckin(true);
            ocultarOverlayPresente();
        } else {
            CHECKIN_ACTIVO = false;
            actualizarUICheckin(false);
            // Mostrar overlay obligatorio para empleados
            if (USUARIO && USUARIO.rol === 'EMPLEADO') {
                mostrarOverlayPresente();
            }
        }
    } catch(e) {}
}

function mostrarOverlayPresente() {
    // Remover si ya existe
    let overlay = document.getElementById('overlay-presente');
    if (overlay) overlay.remove();

    overlay = document.createElement('div');
    overlay.id = 'overlay-presente';
    overlay.style.cssText = `
        position:fixed;top:0;left:0;width:100%;height:100%;z-index:9999;
        background:linear-gradient(135deg,#0f0a1e 0%,#1a1035 50%,#0d0817 100%);
        display:flex;flex-direction:column;align-items:center;justify-content:center;
        transition:opacity 0.5s ease;
    `;
    overlay.innerHTML = `
        <div style="text-align:center;padding:20px;">
            <div style="font-size:3rem;margin-bottom:10px;">👋</div>
            <h2 style="color:white;font-size:1.5rem;margin-bottom:5px;">¡Buenos días, ${USUARIO?.nombre || 'Empleado'}!</h2>
            <p style="color:#a78bfa;font-size:0.85rem;margin-bottom:30px;">Para iniciar tus labores, marca tu asistencia</p>
            <button id="btn-overlay-presente" onclick="registrarPresenteDesdeOverlay()" style="
                padding:20px 50px;font-size:1.3rem;font-weight:bold;
                background:linear-gradient(135deg,#10b981,#059669);
                color:white;border:none;border-radius:16px;cursor:pointer;
                box-shadow:0 0 30px rgba(16,185,129,0.4),0 8px 25px rgba(0,0,0,0.3);
                animation:pulsePresente 2s infinite;
                transition:transform 0.2s;
            ">
                📍 PRESENTE
            </button>
            <p style="color:#6b7280;font-size:0.7rem;margin-top:15px;">Se registrará tu ubicación GPS, fecha y hora</p>
        </div>
        <style>
            @keyframes pulsePresente {
                0%,100% { box-shadow:0 0 30px rgba(16,185,129,0.4),0 8px 25px rgba(0,0,0,0.3); }
                50% { box-shadow:0 0 50px rgba(16,185,129,0.6),0 8px 35px rgba(0,0,0,0.4); transform:scale(1.03); }
            }
            #btn-overlay-presente:active { transform:scale(0.95) !important; }
        </style>
    `;
    document.body.appendChild(overlay);
}

function ocultarOverlayPresente() {
    const overlay = document.getElementById('overlay-presente');
    if (overlay) {
        overlay.style.opacity = '0';
        setTimeout(() => overlay.remove(), 500);
    }
}

async function registrarPresenteDesdeOverlay() {
    const btn = document.getElementById('btn-overlay-presente');
    if (btn) {
        btn.textContent = '⏳ Registrando...';
        btn.disabled = true;
    }

    // Obtener GPS
    let lat = null, lng = null;
    try {
        const pos = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000, enableHighAccuracy: true });
        });
        lat = pos.coords.latitude;
        lng = pos.coords.longitude;
    } catch(e) {}

    try {
        await fetchAPI('/api/asistencia/entrada', {
            method: 'POST',
            body: JSON.stringify({ lat, lng })
        });
        CHECKIN_ACTIVO = true;
        actualizarUICheckin(true);
        ocultarOverlayPresente();
        mostrarToast('✅ ¡Asistencia registrada! Buen día de trabajo', 'success');
        cargarTareasEmpleado();
    } catch(err) {
        if (btn) {
            btn.textContent = '📍 PRESENTE';
            btn.disabled = false;
        }
        mostrarToast('Error al registrar asistencia', 'error');
    }
}

// ═══════════════════════════════════════════
// UBICACIÓN FIJA DEL EMPLEADO
// ═══════════════════════════════════════════
async function verificarUbicacionFija() {
    try {
        const config = await fetchAPI('/api/empresas/mi-config');
        if (config.modalidad_trabajo !== 'fijo') return;

        const ubicacion = await fetchAPI('/api/usuarios/mi-ubicacion');
        if (ubicacion.lat && ubicacion.lng) {
            // Ya tiene ubicación registrada - mostrar badge
            const container = document.getElementById('emp-ubicacion-info');
            if (container) {
                container.innerHTML = `
                    <div style="font-size:0.7rem;color:#10b981;padding:6px 10px;background:rgba(16,185,129,0.1);border-radius:8px;border:1px solid rgba(16,185,129,0.2);margin:8px 0;display:flex;align-items:center;gap:6px;">
                        📍 <strong>${ubicacion.nombre || 'Ubicación registrada'}</strong>
                        <button onclick="configurarUbicacionFija()" style="margin-left:auto;background:none;border:none;color:#a78bfa;font-size:0.65rem;cursor:pointer;text-decoration:underline;">Actualizar</button>
                    </div>
                `;
            }
        } else {
            // No tiene ubicación - mostrar botón obligatorio
            const container = document.getElementById('emp-ubicacion-info');
            if (container) {
                container.innerHTML = `
                    <div style="padding:10px;background:rgba(245,158,11,0.1);border-radius:8px;border:1px solid rgba(245,158,11,0.3);margin:8px 0;text-align:center;">
                        <p style="font-size:0.75rem;color:#f59e0b;margin-bottom:8px;">⚠️ Debes registrar tu ubicación de trabajo</p>
                        <button onclick="configurarUbicacionFija()" style="padding:8px 20px;background:linear-gradient(135deg,#f59e0b,#d97706);color:white;border:none;border-radius:8px;cursor:pointer;font-weight:bold;font-size:0.8rem;">
                            📍 Registrar mi ubicación
                        </button>
                    </div>
                `;
            }
        }
    } catch(e) {
        console.log('Error verificando ubicación:', e);
    }
}

async function configurarUbicacionFija() {
    mostrarToast('📡 Obteniendo tu ubicación GPS...', 'info');
    
    let lat = null, lng = null;
    try {
        const pos = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000, enableHighAccuracy: true });
        });
        lat = pos.coords.latitude;
        lng = pos.coords.longitude;
    } catch(e) {
        mostrarToast('❌ No se pudo obtener tu ubicación. Permite el acceso GPS.', 'error');
        return;
    }

    // Reverse geocoding para obtener nombre del lugar
    let nombreLugar = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    try {
        const geoRes = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`);
        const geoData = await geoRes.json();
        if (geoData.display_name) {
            const parts = geoData.display_name.split(',');
            nombreLugar = parts.slice(0, 3).join(',').trim();
        }
    } catch(e) {}

    try {
        await fetchAPI('/api/usuarios/mi-ubicacion', {
            method: 'PUT',
            body: JSON.stringify({ lat, lng, nombre: nombreLugar })
        });
        mostrarToast(`✅ Ubicación registrada: ${nombreLugar}`, 'success');
        verificarUbicacionFija();
    } catch(err) {
        mostrarToast('Error al guardar ubicación', 'error');
    }
}

// ═══════════════════════════════════════════
// GEOFENCING GPS — MONITOREO CONTINUO
// ═══════════════════════════════════════════
let _geoWatchId = null;
let _geoStrikesConsecutivos = 0;
let _geoConfig = { radio: 800, activo: true };

/**
 * Fórmula Haversine: distancia en metros entre dos puntos GPS
 */
function calcularDistanciaHaversine(lat1, lng1, lat2, lng2) {
    const R = 6371000; // Radio de la tierra en metros
    const toRad = deg => deg * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Verificar acceso GPS antes de permitir uso del sistema
 * Si el usuario requiere GPS y no lo tiene activo, bloquea acceso
 */
async function verificarAccesoGPS() {
    if (!USUARIO || (USUARIO.rol !== 'EMPLEADO' && USUARIO.rol !== 'SUPERVISOR')) return true;
    if (USUARIO.requiere_gps !== 1 && USUARIO.requiere_gps !== '1') return true;

    // Cargar config de geofence
    try {
        const config = await fetchAPI('/api/empresas/mi-config');
        _geoConfig.radio = config.radio_geofence || 800;
        _geoConfig.activo = config.geofence_activo !== 0 && config.geofence_activo !== '0';
    } catch(e) {}

    if (!_geoConfig.activo) return true;

    // Verificar que el navegador soporta y tiene permiso GPS
    if (!navigator.geolocation) {
        mostrarOverlayGPS('Tu navegador no soporta GPS. Se requiere GPS activo para usar el sistema.');
        return false;
    }

    try {
        await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000, enableHighAccuracy: true });
        });
        return true;
    } catch(e) {
        mostrarOverlayGPS('Debes activar el GPS y permitir acceso a tu ubicación para iniciar sesión de trabajo.');
        return false;
    }
}

function mostrarOverlayGPS(mensaje) {
    // Remover si ya existe
    const existente = document.getElementById('overlay-gps-bloqueado');
    if (existente) existente.remove();

    const overlay = document.createElement('div');
    overlay.id = 'overlay-gps-bloqueado';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:99999;background:rgba(0,0,0,0.92);display:flex;align-items:center;justify-content:center;padding:20px;';
    overlay.innerHTML = `
        <div style="text-align:center;max-width:380px;">
            <div style="font-size:4rem;margin-bottom:16px;">📍</div>
            <h2 style="color:#ef4444;font-size:1.3rem;margin-bottom:12px;">GPS Requerido</h2>
            <p style="color:var(--text-secondary);font-size:0.9rem;margin-bottom:24px;line-height:1.6;">${mensaje}</p>
            <button onclick="reintenrarGPS()" style="padding:12px 30px;background:linear-gradient(135deg,#6366f1,#4f46e5);color:white;border:none;border-radius:10px;font-size:0.9rem;font-weight:700;cursor:pointer;margin-bottom:10px;">
                🔄 Reintentar
            </button>
            <br>
            <button onclick="cerrarSesionGeofence('GPS_DENEGADO')" style="padding:8px 20px;background:none;color:#a78bfa;border:1px solid rgba(139,92,246,0.3);border-radius:8px;font-size:0.78rem;cursor:pointer;margin-top:8px;">
                Cerrar Sesión
            </button>
        </div>
    `;
    document.body.appendChild(overlay);
}

async function reintenrarGPS() {
    const overlay = document.getElementById('overlay-gps-bloqueado');
    try {
        await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000, enableHighAccuracy: true });
        });
        if (overlay) overlay.remove();
        mostrarToast('✅ GPS activado correctamente', 'success');
        iniciarMonitoreoGPS();
    } catch(e) {
        mostrarToast('❌ GPS sigue desactivado. Permite el acceso en la configuración de tu navegador.', 'error');
    }
}

/**
 * Iniciar monitoreo continuo de GPS con geofencing
 * Usa watchPosition para detectar salida del perímetro
 */
async function iniciarMonitoreoGPS() {
    if (!USUARIO || (USUARIO.rol !== 'EMPLEADO' && USUARIO.rol !== 'SUPERVISOR')) return;
    if (USUARIO.requiere_gps !== 1 && USUARIO.requiere_gps !== '1') return;
    if (!_geoConfig.activo) return;

    // Detener monitoreo anterior si existe
    if (_geoWatchId !== null) {
        navigator.geolocation.clearWatch(_geoWatchId);
        _geoWatchId = null;
    }
    _geoStrikesConsecutivos = 0;

    // Obtener coordenadas del lugar de trabajo
    const ubLat = USUARIO.ubicacion_fija_lat;
    const ubLng = USUARIO.ubicacion_fija_lng;

    if (!ubLat || !ubLng) {
        // No tiene ubicación registrada — no monitorear pero mostrar aviso
        console.log('⚠️ Geofence: usuario sin ubicación fija registrada');
        return;
    }

    const radio = _geoConfig.radio || 800;

    // Mostrar banner de estado GPS
    mostrarBannerGPS('dentro', 0);

    // Monitoreo continuo
    _geoWatchId = navigator.geolocation.watchPosition(
        (pos) => {
            const distancia = calcularDistanciaHaversine(ubLat, ubLng, pos.coords.latitude, pos.coords.longitude);
            console.log(`📡 GPS: ${Math.round(distancia)}m del trabajo (radio: ${radio}m)`);

            if (distancia > radio) {
                _geoStrikesConsecutivos++;
                console.log(`⚠️ FUERA del perímetro — Strike ${_geoStrikesConsecutivos}/3`);

                if (_geoStrikesConsecutivos === 1) {
                    mostrarBannerGPS('advertencia', distancia);
                    mostrarToast(`⚠️ Estás a ${Math.round(distancia)}m — fuera del perímetro (${radio}m)`, 'error');
                } else if (_geoStrikesConsecutivos === 2) {
                    mostrarBannerGPS('peligro', distancia);
                    mostrarToast('🚨 ¡REGRESA al área de trabajo! Próxima lectura cerrará tu sesión.', 'error');
                } else if (_geoStrikesConsecutivos >= 3) {
                    // 3 strikes → cerrar sesión
                    enviarAlertaGeofence('FUERA_PERIMETRO', pos.coords.latitude, pos.coords.longitude, distancia);
                    cerrarSesionGeofence('FUERA_PERIMETRO');
                }
            } else {
                // Dentro del perímetro — resetear strikes
                if (_geoStrikesConsecutivos > 0) {
                    mostrarToast('✅ De vuelta en el área de trabajo', 'success');
                }
                _geoStrikesConsecutivos = 0;
                mostrarBannerGPS('dentro', distancia);
            }
        },
        (err) => {
            // Error de GPS = posible desactivación
            console.error('❌ GPS error:', err.code, err.message);
            if (err.code === 1) { // PERMISSION_DENIED
                enviarAlertaGeofence('GPS_DESACTIVADO', null, null, 0);
                cerrarSesionGeofence('GPS_DESACTIVADO');
            } else if (err.code === 2) { // POSITION_UNAVAILABLE
                mostrarBannerGPS('sinsenal', 0);
                mostrarToast('⚠️ Señal GPS perdida. Asegúrate de tener el GPS activo.', 'error');
            }
        },
        {
            enableHighAccuracy: true,
            timeout: 30000,
            maximumAge: 15000 // Cachear posición por 15s
        }
    );

    console.log(`🛰️ Geofencing iniciado — Radio: ${radio}m — WatchID: ${_geoWatchId}`);
}

function mostrarBannerGPS(estado, distancia) {
    const prefix = USUARIO.rol === 'SUPERVISOR' ? 'sup' : 'emp';
    let container = document.getElementById(`${prefix}-gps-banner`);

    // Crear container si no existe
    if (!container) {
        const panelLista = document.getElementById(`${prefix}-lista-tareas`);
        if (!panelLista) return;
        container = document.createElement('div');
        container.id = `${prefix}-gps-banner`;
        panelLista.parentElement.insertBefore(container, panelLista);
    }

    const distTxt = distancia > 0 ? `${Math.round(distancia)}m` : '';
    let html = '';

    if (estado === 'dentro') {
        html = `<div style="display:flex;align-items:center;gap:8px;padding:8px 14px;margin-bottom:10px;border-radius:10px;background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.25);font-size:0.75rem;color:#10b981;font-weight:600;">
            <span style="animation:cronoPulse 2s infinite;">📍</span> Dentro del área de trabajo ${distTxt ? `· ${distTxt}` : ''} <span style="margin-left:auto;font-size:0.65rem;color:var(--text-muted);">GPS activo</span>
        </div>`;
    } else if (estado === 'advertencia') {
        html = `<div style="display:flex;align-items:center;gap:8px;padding:10px 14px;margin-bottom:10px;border-radius:10px;background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.35);font-size:0.78rem;color:#f59e0b;font-weight:700;">
            ⚠️ Fuera del perímetro · ${distTxt} <span style="margin-left:auto;font-size:0.65rem;">Strike 1/3</span>
        </div>`;
    } else if (estado === 'peligro') {
        html = `<div style="display:flex;align-items:center;gap:8px;padding:10px 14px;margin-bottom:10px;border-radius:10px;background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.4);font-size:0.82rem;color:#ef4444;font-weight:800;animation:cronoPulse 0.5s infinite;">
            🚨 ¡REGRESA AL ÁREA! · ${distTxt} <span style="margin-left:auto;font-size:0.7rem;">Strike 2/3</span>
        </div>`;
    } else if (estado === 'sinsenal') {
        html = `<div style="display:flex;align-items:center;gap:8px;padding:8px 14px;margin-bottom:10px;border-radius:10px;background:rgba(139,92,246,0.1);border:1px solid rgba(139,92,246,0.25);font-size:0.75rem;color:#a78bfa;font-weight:600;">
            📡 Señal GPS débil — reconectando...
        </div>`;
    }

    container.innerHTML = html;
}

async function enviarAlertaGeofence(motivo, lat, lng, distancia) {
    try {
        await fetchAPI('/api/usuarios/alerta-geofence', {
            method: 'POST',
            body: JSON.stringify({ motivo, lat, lng, distancia })
        });
    } catch(e) { console.error('Error enviando alerta geofence:', e); }
}

function cerrarSesionGeofence(motivo) {
    // Detener monitoreo GPS
    if (_geoWatchId !== null) {
        navigator.geolocation.clearWatch(_geoWatchId);
        _geoWatchId = null;
    }

    // Limpiar sesión
    sessionStorage.removeItem('gl_token');
    sessionStorage.removeItem('gl_usuario');
    TOKEN = null;
    USUARIO = null;

    // Mostrar pantalla de login con mensaje
    const mensajes = {
        'FUERA_PERIMETRO': '🚨 Tu sesión fue cerrada porque te alejaste del área de trabajo autorizada. Se notificó a tu supervisor.',
        'GPS_DESACTIVADO': '🚨 Tu sesión fue cerrada porque el GPS fue desactivado. Se requiere GPS activo durante la jornada laboral.',
        'GPS_DENEGADO': '⚠️ Sesión cerrada. Activa el GPS para poder trabajar.'
    };

    mostrarPantalla('login');

    // Remover overlay si existe
    const overlay = document.getElementById('overlay-gps-bloqueado');
    if (overlay) overlay.remove();

    // Mostrar alerta prominente en la pantalla de login
    setTimeout(() => {
        const loginCard = document.querySelector('.login-card');
        if (loginCard) {
            const alerta = document.createElement('div');
            alerta.style.cssText = 'padding:14px 18px;margin-bottom:16px;border-radius:10px;background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.35);font-size:0.82rem;color:#ef4444;font-weight:600;text-align:center;line-height:1.5;';
            alerta.textContent = mensajes[motivo] || '🚨 Sesión cerrada por política de seguridad GPS.';
            loginCard.insertBefore(alerta, loginCard.firstChild);
        }
    }, 300);
}

function actualizarUICheckin(presente) {
    const btnEmp = document.getElementById('emp-btn-checkin');
    const btnSup = document.getElementById('sup-btn-checkin');
    const widgetEmp = document.getElementById('emp-checkin-widget');
    const widgetSup = document.getElementById('sup-checkin-widget');
    const labelEmp = document.getElementById('emp-checkin-label');
    const labelSup = document.getElementById('sup-checkin-label');

    const btns = [btnEmp, btnSup].filter(Boolean);
    const widgets = [widgetEmp, widgetSup].filter(Boolean);
    const labels = [labelEmp, labelSup].filter(Boolean);

    if (presente) {
        btns.forEach(btn => {
            btn.textContent = '🚪 Saliendo del lugar de trabajo';
            btn.style.background = '#ef4444';
        });
        widgets.forEach(w => {
            w.style.background = 'linear-gradient(135deg,rgba(239,68,68,0.15),rgba(239,68,68,0.05))';
            w.style.borderColor = 'rgba(239,68,68,0.3)';
        });
        labels.forEach(l => {
            l.innerHTML = '✅ <strong style="color:#10b981;">PRESENTE</strong> en lugar de trabajo';
        });
    } else {
        btns.forEach(btn => {
            btn.textContent = '📍 Reportarme Presente';
            btn.style.background = '#10b981';
        });
        widgets.forEach(w => {
            w.style.background = 'linear-gradient(135deg,rgba(16,185,129,0.15),rgba(16,185,129,0.05))';
            w.style.borderColor = 'rgba(16,185,129,0.3)';
        });
        labels.forEach(l => l.textContent = '📍 Control de asistencia');
    }
}

async function toggleCheckin() {
    // Obtener coordenadas GPS
    let lat = null, lng = null;
    try {
        const pos = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000, enableHighAccuracy: true });
        });
        lat = pos.coords.latitude;
        lng = pos.coords.longitude;
    } catch(e) {
        // GPS no disponible, continuar sin coordenadas
        console.log('GPS no disponible:', e.message);
    }

    if (!CHECKIN_ACTIVO) {
        // CHECK-IN
        try {
            const res = await fetchAPI('/api/asistencia/entrada', {
                method: 'POST',
                body: JSON.stringify({ lat, lng })
            });
            CHECKIN_ACTIVO = true;
            actualizarUICheckin(true);
            mostrarToast('✅ Te reportaste presente correctamente', 'success');
        } catch(err) {
            mostrarToast(err.message || 'Error al registrar entrada', 'error');
        }
    } else {
        // CHECK-OUT
        if (!confirm('¿Confirmas que te retiras del lugar de trabajo?')) return;
        try {
            const res = await fetchAPI('/api/asistencia/salida', {
                method: 'POST',
                body: JSON.stringify({ lat, lng })
            });
            CHECKIN_ACTIVO = false;
            actualizarUICheckin(false);
            mostrarToast('🚪 Salida registrada correctamente', 'success');
        } catch(err) {
            mostrarToast(err.message || 'Error al registrar salida', 'error');
        }
    }
}

// ═══════════════════════════════════════════
// ASISTENCIA - VISTA ADMIN
// ═══════════════════════════════════════════
async function cargarAsistenciaAdmin() {
    try {
        const fecha = document.getElementById('filtro-asistencia-fecha')?.value || '';
        let url = '/api/asistencia';
        if (fecha) url += `?fecha=${fecha}`;

        const registros = await fetchAPI(url);

        // Stats
        const presentes = registros.filter(r => r.estado === 'presente').length;
        const salieron = registros.filter(r => r.estado === 'salida').length;
        const elP = document.getElementById('ast-presentes'); if(elP) elP.textContent = presentes;
        const elS = document.getElementById('ast-salieron'); if(elS) elS.textContent = salieron;
        const elT = document.getElementById('ast-total'); if(elT) elT.textContent = registros.length;

        const container = document.getElementById('tabla-asistencia');
        if (!registros.length) {
            container.innerHTML = '<div class="empty-state"><p>No hay registros de asistencia</p></div>';
            return;
        }

        container.innerHTML = `
            <table style="width:100%;border-collapse:collapse;font-size:0.8rem;">
                <thead>
                    <tr style="border-bottom:2px solid var(--border-color);text-align:left;">
                        <th style="padding:8px 6px;">👤 Nombre</th>
                        <th style="padding:8px 6px;">📱 Teléfono</th>
                        <th style="padding:8px 6px;">📅 Fecha</th>
                        <th style="padding:8px 6px;">🟢 Entrada</th>
                        <th style="padding:8px 6px;">🔴 Salida</th>
                        <th style="padding:8px 6px;">⏱ Duración</th>
                        <th style="padding:8px 6px;">📍 Ubicación</th>
                        <th style="padding:8px 6px;">Estado</th>
                    </tr>
                </thead>
                <tbody>
                    ${registros.map(r => {
                        const horaEnt = r.hora_entrada ? new Date(r.hora_entrada).toLocaleTimeString('es-MX', {hour:'2-digit',minute:'2-digit'}) : '-';
                        const horaSal = r.hora_salida ? new Date(r.hora_salida).toLocaleTimeString('es-MX', {hour:'2-digit',minute:'2-digit'}) : '-';
                        const duracion = r.duracion_minutos ? `${Math.floor(r.duracion_minutos/60)}h ${r.duracion_minutos%60}m` : '—';
                        const ubicacion = r.lat_entrada ? `<a href="https://maps.google.com/?q=${r.lat_entrada},${r.lng_entrada}" target="_blank" style="color:#3b82f6;text-decoration:none;">📍 Ver mapa</a>` : '—';
                        const estadoColor = r.estado === 'presente' ? '#10b981' : '#6366f1';
                        const estadoTexto = r.estado === 'presente' ? '✅ Presente' : '📤 Salió';
                        return `<tr style="border-bottom:1px solid var(--border-color);">
                            <td style="padding:8px 6px;font-weight:500;">${r.nombre_usuario || '—'}</td>
                            <td style="padding:8px 6px;">${r.telefono || '—'}</td>
                            <td style="padding:8px 6px;">${formatearFecha(r.fecha)}</td>
                            <td style="padding:8px 6px;color:#10b981;">${horaEnt}</td>
                            <td style="padding:8px 6px;color:#ef4444;">${horaSal}</td>
                            <td style="padding:8px 6px;font-weight:600;">${duracion}</td>
                            <td style="padding:8px 6px;">${ubicacion}</td>
                            <td style="padding:8px 6px;"><span style="color:${estadoColor};font-weight:600;font-size:0.72rem;">${estadoTexto}</span></td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>
        `;
    } catch (err) {
        console.error('Error cargando asistencia:', err);
    }
}

// ═══════════════════════════════════════════
// CONFIGURACIÓN EMPRESA Y PERMISOS
// ═══════════════════════════════════════════
window.FORMATO_HORA_EMPRESA = '12h'; // default

async function verificarPermisosSupervisor() {
    try {
        const config = await fetchAPI('/api/empresas/mi-config');

        // Guardar configuración globalmente
        window.FORMATO_HORA_EMPRESA = config.formato_hora || '12h';
        window.SUPERVISOR_PUEDE_MODIFICAR = config.supervisor_puede_modificar !== 0;

        const supContainer = document.getElementById('pantalla-supervisor');
        if (!supContainer) return;

        // Permisos de asignación de tareas
        const btnContainer = document.getElementById('sup-btns-crear-tareas');

        if (!config.permite_supervisor_asignar) {
            if (btnContainer) btnContainer.style.display = 'none';
        } else {
            if (btnContainer) btnContainer.style.display = 'flex';
        }

        // Visibilidad de tareas terminadas para supervisor
        const tareasTerminadas = supContainer.querySelectorAll('.tarea-finalizada, .tarea-completada');
        const btnTerminadas = supContainer.querySelector('button[onclick*="terminadas"], button[onclick*="finalizadas"]');
        if (!config.supervisor_ve_terminadas) {
            tareasTerminadas.forEach(el => el.style.display = 'none');
            if (btnTerminadas) btnTerminadas.style.display = 'none';
        }
    } catch(e) {
        console.log('No se pudo verificar permisos:', e);
    }
}

function formatearHoraEmpresa(fechaStr) {
    if (!fechaStr) return '—';
    let s = fechaStr.trim();
    if (s.includes(' ') && !s.includes('T')) s = s.replace(' ', 'T');
    if (!s.includes('Z') && !s.includes('+')) s += 'Z';
    const d = new Date(s);
    if (isNaN(d)) return '—';
    if (window.FORMATO_HORA_EMPRESA === '24h') {
        return d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false });
    }
    return d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: true });
}

// ═══════════════════════════════════════════
// HISTORIAL DE TAREAS (ADMIN)
// ═══════════════════════════════════════════
function filtrarTareasPorEstado(estado) {
    // Toggle: si ya está activo el mismo filtro, quitar filtro
    if (window.FILTRO_ESTADO_ACTUAL === estado) {
        window.FILTRO_ESTADO_ACTUAL = '';
        estado = '';
    } else {
        window.FILTRO_ESTADO_ACTUAL = estado;
    }

    cargarTareas();

    // Resaltar la tarjeta activa
    document.querySelectorAll('#panel-tareas .stat-card').forEach(card => {
        card.style.outline = '';
        card.style.outlineOffset = '';
    });
    if (estado) {
        const labels = { 'pendiente': 'Pendientes', 'en_proceso': 'En Proceso', 'finalizada': 'Finalizadas', 'atrasada': 'Atrasadas' };
        document.querySelectorAll('#panel-tareas .stat-card').forEach(card => {
            const label = card.querySelector('.stat-label');
            if (label && label.textContent === labels[estado]) {
                card.style.outline = '2px solid var(--accent-primary)';
                card.style.outlineOffset = '2px';
            }
        });
        mostrarToast(`Mostrando: ${labels[estado] || estado}`, 'info');
    } else {
        mostrarToast('Mostrando todas las tareas', 'info');
    }

    // Scroll al listado
    const lista = document.getElementById('lista-tareas');
    if (lista) lista.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ═══════════════════════════════════════════
// HISTORIAL COMPLETO DE TAREAS FINALIZADAS
// ═══════════════════════════════════════════
async function abrirHistorialTareas() {
    mostrarToast('Cargando historial...', 'info');
    try {
        let tareas = await fetchAPI('/api/tareas?estado=finalizada');
        try {
            const atrasadas = await fetchAPI('/api/tareas?estado=finalizada_atrasada');
            tareas = [...tareas, ...atrasadas];
        } catch(e) {}
        tareas.sort((a,b) => new Date(b.fecha_fin || b.fecha_creacion) - new Date(a.fecha_fin || a.fecha_creacion));

        let modal = document.getElementById('modal-historial-tareas');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'modal-historial-tareas';
            document.body.appendChild(modal);
        }

        const tarjetas = tareas.map(t => {
            const prioridadColor = {
                'urgente': '#ef4444', 'alta': '#f97316', 'media': '#6366f1', 'baja': '#10b981'
            }[t.prioridad] || '#6366f1';
            const estadoBadgeClass = {
                'finalizada': 'badge-success', 'finalizada_atrasada': 'badge-warning'
            }[t.estado] || 'badge-success';
            const estadoTexto = t.estado === 'finalizada_atrasada' ? '🟠 Fin. Atrasada' : '🟢 Finalizada';

            let tiempoRealStr = '';
            if (t.fecha_inicio && t.fecha_fin) {
                const segs = Math.round((new Date(t.fecha_fin) - new Date(t.fecha_inicio)) / 1000);
                tiempoRealStr = formatearCronoAdmin(segs);
            }

            return `
            <div class="tarea-row-wrap historial-card" data-search="${(t.codigo_tarea || '').toLowerCase()} ${(t.titulo || '').toLowerCase()} ${(t.nombre_empleado || '').toLowerCase()} ${(t.nombre_supervisor || '').toLowerCase()}" style="cursor:pointer;" onclick="document.getElementById('modal-historial-tareas').style.display='none'; filtrarTareasPorEstado('finalizada'); setTimeout(()=>toggleDetalleTarea('${t.id_tarea}'),500);">
                <div class="tarea-row glass" style="border-left:4px solid ${prioridadColor};">
                    <!-- Prioridad -->
                    <div class="tarea-row-prioridad" style="background:${prioridadColor}22;color:${prioridadColor};">${t.prioridad.toUpperCase()}</div>

                    <!-- Info principal -->
                    <div class="tarea-row-main">
                        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                            ${t.codigo_tarea ? `<span style="font-size:0.68rem;font-weight:700;color:var(--accent-primary);background:rgba(99,102,241,0.15);padding:2px 8px;border-radius:6px;letter-spacing:0.5px;">${t.codigo_tarea}</span>` : ''}
                            <span style="font-size:0.95rem;font-weight:700;">${t.titulo}</span>
                            <span class="badge ${estadoBadgeClass}" style="font-size:0.65rem;">${estadoTexto}</span>
                            ${t.nombre_tipo ? `<span style="font-size:0.7rem;color:var(--text-muted);background:rgba(255,255,255,0.06);padding:2px 7px;border-radius:10px;">${t.nombre_tipo}</span>` : ''}
                        </div>
                        ${t.descripcion ? `<div style="font-size:0.77rem;color:var(--text-secondary);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:350px;" title="${t.descripcion}">${t.descripcion}</div>` : ''}
                    </div>

                    <!-- Info rápida -->
                    <div class="tarea-row-info">
                        ${t.nombre_empleado ? `<span class="empresa-stat">👤 ${t.nombre_empleado}</span>` : '<span class="empresa-stat" style="opacity:0.4;">Sin asignar</span>'}
                        ${t.nombre_supervisor ? `<span class="empresa-stat">👁 ${t.nombre_supervisor}</span>` : ''}
                        ${tiempoRealStr ? `<span class="empresa-stat" style="color:#00ff88;font-weight:600;">⏱ ${tiempoRealStr}</span>` : (t.tiempo_estimado_minutos ? `<span class="empresa-stat">⏳ ${formatearTiempo(t.tiempo_estimado_minutos)}</span>` : '')}
                        ${t.total_evidencias > 0 ? `<span class="empresa-stat" style="color:#a78bfa;">📸 ${t.total_evidencias}</span>` : ''}
                        ${t.total_comentarios > 0 ? `<span class="empresa-stat" style="color:#60a5fa;">💬 ${t.total_comentarios}</span>` : ''}
                    </div>

                    <!-- Fechas completas -->
                    <div class="tarea-row-fecha" style="min-width:160px;">
                        <span style="font-size:0.68rem;color:var(--text-muted);">📅 Asignada: ${formatearFecha(t.fecha_creacion)}</span>
                        ${t.fecha_inicio ? `<span style="font-size:0.68rem;color:#3b82f6;">▶ Inicio: ${formatearFecha(t.fecha_inicio)}</span>` : ''}
                        ${t.fecha_fin ? `<span style="font-size:0.68rem;color:#10b981;">✅ Fin: ${formatearFecha(t.fecha_fin)}</span>` : ''}
                    </div>
                </div>
            </div>`;
        }).join('');

        modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.88);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
        modal.innerHTML = `
            <div style="max-width:1100px;width:100%;max-height:90vh;display:flex;flex-direction:column;background:var(--bg-card);border-radius:16px;border:1px solid var(--border-color);overflow:hidden;">
                <div style="display:flex;justify-content:space-between;align-items:center;padding:18px 22px;border-bottom:1px solid var(--border-color);">
                    <div>
                        <h3 style="margin:0;font-size:1.1rem;">📜 Historial de Tareas Finalizadas</h3>
                        <span style="font-size:0.78rem;color:var(--text-muted);" id="historial-count">${tareas.length} tareas completadas en total</span>
                    </div>
                    <button onclick="document.getElementById('modal-historial-tareas').style.display='none'" style="background:none;border:none;color:white;font-size:1.4rem;cursor:pointer;">✕</button>
                </div>
                <div style="padding:12px 22px 0;border-bottom:1px solid var(--border-color);padding-bottom:12px;">
                    <input type="text" id="historial-busqueda" placeholder="🔍 Buscar por No. tarea, empleado o supervisor..." 
                        style="width:100%;padding:10px 16px;background:rgba(15,15,35,0.6);border:1px solid var(--border-color);border-radius:10px;color:var(--text-primary);font-size:0.88rem;outline:none;"
                        oninput="filtrarHistorialBusqueda(this.value)">
                </div>
                <div style="overflow-y:auto;flex:1;padding:12px 16px;">
                    <div class="grid-cards" id="historial-grid">
                        ${tarjetas || '<div class="empty-state"><p>No hay tareas finalizadas</p></div>'}
                    </div>
                </div>
            </div>
        `;
    } catch(err) {
        mostrarToast('Error al cargar historial: ' + (err.message || ''), 'error');
    }
}

function filtrarHistorialBusqueda(texto) {
    const busqueda = texto.toLowerCase().trim();
    const cards = document.querySelectorAll('#historial-grid .historial-card');
    let visibles = 0;
    cards.forEach(card => {
        const data = card.getAttribute('data-search') || '';
        const match = !busqueda || data.includes(busqueda);
        card.style.display = match ? '' : 'none';
        if (match) visibles++;
    });
    const countEl = document.getElementById('historial-count');
    if (countEl) countEl.textContent = busqueda ? `${visibles} resultado(s) de ${cards.length}` : `${cards.length} tareas completadas en total`;
}

async function verEvidenciasTarea(idTarea) {
    try {
        const data = await fetchAPI(`/api/tareas/${idTarea}`);
        if (!data.evidencias || !data.evidencias.length) {
            mostrarToast('No hay evidencias para esta tarea', 'info');
            return;
        }
        // Crear modal con evidencias
        let modal = document.getElementById('modal-evidencias');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'modal-evidencias';
            document.body.appendChild(modal);
        }
        modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;';
        modal.innerHTML = `
            <div style="max-width:600px;width:100%;max-height:85vh;overflow-y:auto;background:var(--bg-card);border-radius:12px;padding:20px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:15px;">
                    <h3 style="margin:0;font-size:1rem;">📸 Evidencias: ${data.titulo}</h3>
                    <button onclick="document.getElementById('modal-evidencias').style.display='none'" style="background:none;border:none;color:white;font-size:1.3rem;cursor:pointer;">✕</button>
                </div>
                ${data.evidencias.map(e => `
                    <div style="margin-bottom:12px;border:1px solid var(--border-color);border-radius:8px;overflow:hidden;">
                        ${e.tipo === 'imagen' || (e.url && e.url.match(/\.(jpg|jpeg|png|gif|webp)/i))
                            ? `<img src="${e.url}" style="width:100%;max-height:300px;object-fit:cover;" />`
                            : `<div style="padding:12px;background:rgba(59,130,246,0.08);"><a href="${e.url}" target="_blank" style="color:#3b82f6;">📎 ${e.nombre || 'Archivo'}</a></div>`
                        }
                        <div style="padding:8px;font-size:0.72rem;color:var(--text-muted);">
                            ${e.descripcion || ''} · ${new Date(e.fecha_creacion).toLocaleString('es-MX')}
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    } catch(e) {
        mostrarToast('Error al cargar evidencias', 'error');
    }
}

// ══════════════════════════════════════════════════════════════
// MODAL DE CLIENTE (para Empleado / Supervisor como empleado)
// ══════════════════════════════════════════════════════════════
let _clienteModalIdTarea = null;

async function abrirModalCliente(idTarea) {
    _clienteModalIdTarea = idTarea;
    const modal = document.getElementById('modal-cliente-emp');
    if (!modal) return;

    // Limpiar formulario
    ['cli-nombre','cli-codigo','cli-telefono','cli-correo','cli-obs','cli-fecha-seguimiento'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    document.getElementById('cli-sugerencias').style.display = 'none';
    document.getElementById('cli-btn-concluir').style.display = 'none';
    const banner = document.getElementById('cli-estado-banner');
    banner.style.display = 'none';
    modal.style.display = 'flex';

    // Cargar datos existentes si ya fueron registrados
    try {
        const tarea = await fetchAPI(`/api/tareas/${idTarea}`);
        if (tarea.nombre_cliente) {
            document.getElementById('cli-nombre').value = tarea.nombre_cliente || '';
            document.getElementById('cli-codigo').value = tarea.codigo_cliente || '';
            document.getElementById('cli-telefono').value = tarea.telefono_cliente || '';
            document.getElementById('cli-correo').value = tarea.correo_cliente || '';
            document.getElementById('cli-obs').value = tarea.obs_cliente || '';
            document.getElementById('cli-fecha-seguimiento').value = tarea.fecha_seguimiento || '';
        }
        const concluido = tarea.cliente_concluido === 1 || tarea.cliente_concluido === '1';
        if (concluido) {
            banner.textContent = '✅ Este evento con el cliente ya fue marcado como concluido';
            banner.style.display = 'block';
            banner.style.background = 'rgba(16,185,129,0.15)';
            banner.style.color = '#10b981';
            ['cli-nombre','cli-telefono','cli-correo','cli-obs','cli-fecha-seguimiento'].forEach(id => {
                const el = document.getElementById(id); if (el) el.readOnly = true;
            });
        } else {
            ['cli-nombre','cli-telefono','cli-correo','cli-obs','cli-fecha-seguimiento'].forEach(id => {
                const el = document.getElementById(id); if (el) el.readOnly = false;
            });
            if (tarea.nombre_cliente) document.getElementById('cli-btn-concluir').style.display = 'inline-flex';
        }
    } catch(e) {}
}

function cerrarModalCliente() {
    const modal = document.getElementById('modal-cliente-emp');
    if (modal) modal.style.display = 'none';
    _clienteModalIdTarea = null;
}

let _cliSugTimer = null;
async function buscarClientesSugerencias_emp(q) {
    const box = document.getElementById('cli-sugerencias');
    if (!box) return;
    clearTimeout(_cliSugTimer);
    if (q.length < 2) { box.style.display = 'none'; return; }
    _cliSugTimer = setTimeout(async () => {
        try {
            const res = await fetchAPI(`/api/tareas/clientes/buscar?q=${encodeURIComponent(q)}`);
            if (!res.length) { box.style.display = 'none'; return; }
            box.innerHTML = res.map(c => `
                <div onclick="seleccionarClienteExistente_emp(${JSON.stringify(c).replace(/"/g,'&quot;')})"
                     style="padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--border-color);font-size:0.82rem;"
                     onmouseover="this.style.background='rgba(16,185,129,0.1)'" onmouseout="this.style.background=''">
                    <strong>${c.nombre_cliente}</strong>
                    <span style="color:#10b981;font-size:0.72rem;margin-left:6px;">${c.codigo_cliente}</span>
                    ${c.telefono_cliente ? `<span style="color:var(--text-muted);margin-left:6px;">📞${c.telefono_cliente}</span>` : ''}
                </div>`).join('');
            box.style.display = 'block';
        } catch(e) {}
    }, 300);
}

function seleccionarClienteExistente_emp(c) {
    document.getElementById('cli-nombre').value = c.nombre_cliente || '';
    document.getElementById('cli-codigo').value = c.codigo_cliente || '';
    document.getElementById('cli-telefono').value = c.telefono_cliente || '';
    document.getElementById('cli-correo').value = c.correo_cliente || '';
    document.getElementById('cli-sugerencias').style.display = 'none';
    document.getElementById('cli-btn-concluir').style.display = 'inline-flex';
}

async function guardarDatosCliente() {
    if (!_clienteModalIdTarea) return;
    const nombre = document.getElementById('cli-nombre').value.trim();
    if (!nombre) { mostrarToast('Ingresa el nombre del cliente', 'error'); document.getElementById('cli-nombre').focus(); return; }

    let codigo = document.getElementById('cli-codigo').value.trim();
    if (!codigo) {
        const letras = nombre.replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑ]/g,'').substring(0,3).toUpperCase().padEnd(3,'X');
        codigo = letras + String(Math.floor(Math.random()*90)+10);
        document.getElementById('cli-codigo').value = codigo;
    }
    const fecha = document.getElementById('cli-fecha-seguimiento').value || null;
    try {
        const resp = await fetchAPI(`/api/tareas/${_clienteModalIdTarea}/seguimiento-cliente`, {
            method: 'PUT',
            body: JSON.stringify({
                nombre_cliente: nombre,
                codigo_cliente: codigo,
                telefono_cliente: document.getElementById('cli-telefono').value.trim() || null,
                correo_cliente: document.getElementById('cli-correo').value.trim() || null,
                obs_cliente: document.getElementById('cli-obs').value.trim() || null,
                fecha_seguimiento: fecha
            })
        });
        document.getElementById('cli-btn-concluir').style.display = 'inline-flex';
        const msg = resp.nueva_tarea_id
            ? '✅ Datos guardados — Nueva tarea de seguimiento creada automáticamente'
            : '✅ Datos del cliente guardados';
        mostrarToast(msg, 'success');
        cargarTareasEmpleado();
    } catch(e) { mostrarToast(e.message, 'error'); }
}

async function concluirEventoCliente() {
    if (!_clienteModalIdTarea) return;
    if (!confirm('¿Marcar el evento con este cliente como concluido?')) return;
    try {
        await fetchAPI(`/api/tareas/${_clienteModalIdTarea}/cliente-concluido`, { method: 'PUT' });
        mostrarToast('✅ Evento con cliente marcado como concluido', 'success');
        cerrarModalCliente();
        cargarTareasEmpleado();
    } catch(e) { mostrarToast(e.message, 'error'); }
}
