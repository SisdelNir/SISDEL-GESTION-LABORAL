/* ═══════════════════════════════════════════════════
   GESTIÓN LABORAL - App Principal (JavaScript)
   ═══════════════════════════════════════════════════ */

const API = '';
let TOKEN = localStorage.getItem('gl_token') || null;
let USUARIO = JSON.parse(localStorage.getItem('gl_usuario') || 'null');
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
        socket = io();
        socket.on('connect', () => console.log('🔌 Socket conectado'));
        socket.on('disconnect', () => console.log('❌ Socket desconectado'));
    } catch(e) {
        console.log('Socket no disponible');
    }
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
            localStorage.setItem('gl_usuario', JSON.stringify(USUARIO));
            mostrarPantalla('root');
            cargarEmpresas();
        } else {
            USUARIO = res;
            localStorage.setItem('gl_usuario', JSON.stringify(USUARIO));
            abrirPanelPorRol();
        }
    } catch(err) {
        TOKEN = null;
        localStorage.removeItem('gl_token');
        localStorage.removeItem('gl_usuario');
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
            localStorage.setItem('gl_token', TOKEN);
            localStorage.setItem('gl_usuario', JSON.stringify(USUARIO));
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
        localStorage.setItem('gl_token', TOKEN);
        localStorage.setItem('gl_usuario', JSON.stringify(USUARIO));

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

    if (USUARIO.rol === 'ADMIN') {
        mostrarPantalla('admin');
        document.getElementById('admin-user-name').textContent = USUARIO.nombre;
        document.getElementById('admin-empresa-nombre').textContent = USUARIO.nombre_empresa || 'Empresa';
        cargarDashboardAdmin();
    } else if (USUARIO.rol === 'SUPERVISOR') {
        mostrarPantalla('supervisor');
        document.getElementById('sup-user-name').textContent = USUARIO.nombre;
        document.getElementById('sup-empresa-nombre').textContent = USUARIO.nombre_empresa || 'Empresa';
        cargarDashboardSupervisor();
        verificarEstadoCheckin();
        verificarPermisosSupervisor();
    } else if (USUARIO.rol === 'EMPLEADO') {
        mostrarPantalla('empleado');
        document.getElementById('emp-panel-user-name').textContent = USUARIO.nombre;
        document.getElementById('emp-panel-empresa-nombre').textContent = USUARIO.nombre_empresa || 'Empresa';
        cargarTareasEmpleado();
        verificarEstadoCheckin();
        verificarUbicacionFija();
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
    localStorage.removeItem('gl_token');
    localStorage.removeItem('gl_usuario');
    document.getElementById('input-codigo-acceso').value = '';
    mostrarPantalla('login');
    mostrarToast('Sesión cerrada', 'info');
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

async function crearEmpresa(e) {
    e.preventDefault();

    const lada = document.getElementById('emp-lada').value;
    const telEmpresa = document.getElementById('emp-telefono').value.trim();
    const ladaAdmin = document.getElementById('admin-lada').value;
    const telAdmin = document.getElementById('admin-telefono').value.trim();

    const datos = {
        nombre: document.getElementById('emp-nombre').value.trim(),
        identificacion_empresa: document.getElementById('emp-identificacion').value.trim(),
        pais: document.getElementById('emp-pais').value,
        moneda: document.getElementById('emp-moneda').value,
        zona_horaria: document.getElementById('emp-zona-horaria').value,
        telefono: telEmpresa ? `${lada} ${telEmpresa}` : '',
        correo: document.getElementById('emp-correo').value.trim(),
        direccion: document.getElementById('emp-direccion').value.trim(),
        nombre_administrador: document.getElementById('admin-nombre').value.trim(),
        admin_identificacion: document.getElementById('admin-identificacion').value.trim(),
        admin_telefono: telAdmin ? `${ladaAdmin} ${telAdmin}` : '',
        admin_correo: document.getElementById('admin-correo').value.trim(),
        permite_supervisor_asignar: document.getElementById('cfg-sup-asignar').checked,
        formato_hora: document.getElementById('cfg-formato-hora').value,
        supervisor_ve_terminadas: document.getElementById('cfg-sup-ver-terminadas').checked,
        empleado_puede_iniciar: document.getElementById('cfg-emp-iniciar-tarea').checked,
        modalidad_trabajo: document.getElementById('cfg-modalidad-trabajo').value
    };

    try {
        const res = await fetchAPI('/api/empresas', {
            method: 'POST',
            body: JSON.stringify(datos)
        });

        // Mostrar resultado
        document.getElementById('form-empresa').style.display = 'none';
        document.getElementById('resultado-empresa').style.display = 'block';
        document.getElementById('res-empresa-nombre').textContent = res.empresa.nombre;
        document.getElementById('res-admin-nombre').textContent = res.administrador.nombre;
        document.getElementById('res-codigo-admin').textContent = res.administrador.codigo_acceso;

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
    document.getElementById('admin-lada').value = lada;

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
        document.getElementById('emp-direccion').value = empresa.direccion || '';

        // País
        const paisSel = document.getElementById('emp-pais');
        if (paisSel && empresa.pais) {
            paisSel.value = empresa.pais;
            actualizarPais();
        }

        // Moneda
        const monedaSel = document.getElementById('emp-moneda');
        if (monedaSel && empresa.moneda) monedaSel.value = empresa.moneda;

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

        // Pre-llenar datos del admin
        document.getElementById('admin-nombre').value = empresa.nombre_administrador || '';
        if (document.getElementById('admin-identificacion'))
            document.getElementById('admin-identificacion').value = '';
        if (document.getElementById('admin-correo'))
            document.getElementById('admin-correo').value = '';

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
                direccion: document.getElementById('emp-direccion').value.trim(),
                nombre_administrador: document.getElementById('admin-nombre').value.trim()
            };

            try {
                const res = await fetchAPI(`/api/empresas/${id}`, { method: 'PUT', body: JSON.stringify(body) });
                if (res.error) return mostrarToast(res.error, 'error');
                mostrarToast('✅ Empresa actualizada exitosamente', 'success');

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
            <p style="font-size:0.8rem;color:var(--text-muted)">Se desactivarán todos los usuarios</p>
            <div style="display:flex;gap:0.5rem;justify-content:center;margin-top:1.5rem">
                <button class="btn btn-ghost" onclick="document.getElementById('modal-confirmar-eliminar').remove()">Cancelar</button>
                <button class="btn" style="background:#ff5252;color:white" id="btn-confirmar-eliminar">🗑️ Eliminar</button>
            </div>
        </div>
    `;
    document.body.appendChild(m);
    document.getElementById('btn-confirmar-eliminar').onclick = async function() {
        const res = await fetchAPI(`/api/empresas/${id}`, { method:'DELETE' });
        if (res.error) return mostrarToast(res.error, 'error');
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
    document.getElementById(`panel-${panel}`).classList.add('activa');

    container.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('activo'));
    container.querySelector(`[data-panel="${panel}"]`).classList.add('activo');

    if (panel === 'supervisores') cargarSupervisores();
    if (panel === 'empleados') cargarEmpleados();
    if (panel === 'dashboard') cargarDashboardAdmin();
    if (panel === 'tareas') { cargarTareas(); cargarEstadisticasTareas(); }
    if (panel === 'ranking') cargarRanking();
    if (panel === 'notificaciones') cargarNotificaciones();
    if (panel === 'auditoria') cargarAuditoria();
    if (panel === 'asistencia') cargarAsistenciaAdmin();
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

    if (panel === 'sup-dashboard') cargarDashboardSupervisor();
    if (panel === 'sup-empleados') cargarEmpleadosSupervisor();
    if (panel === 'sup-tareas') { cargarTareas(); cargarEstadisticasTareas(); }
    if (panel === 'sup-notificaciones') cargarNotificaciones();
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
    } catch(err) {
        console.error('Error cargando dashboard supervisor:', err);
    }
}

async function cargarEmpleadosSupervisor() {
    try {
        const usuarios = await fetchAPI('/api/usuarios?rol=EMPLEADO');
        const container = document.getElementById('sup-lista-empleados');
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

async function cargarTareasEmpleado() {
    try {
        const tareas = await fetchAPI('/api/tareas');

        // Cargar config de empresa
        let empPuedeIniciar = true;
        try {
            const config = await fetchAPI('/api/empresas/mi-config');
            empPuedeIniciar = config.empleado_puede_iniciar !== 0 && config.empleado_puede_iniciar !== false;
            window.FORMATO_HORA_EMPRESA = config.formato_hora || '12h';
        } catch(e) {}

        // Estadísticas
        const pendientes = tareas.filter(t => t.estado === 'pendiente').length;
        const enProceso = tareas.filter(t => t.estado === 'en_proceso').length;
        const finalizadas = tareas.filter(t => t.estado === 'finalizada' || t.estado === 'finalizada_atrasada').length;
        const atrasadas = tareas.filter(t => t.estado === 'atrasada').length;

        document.getElementById('emp-stat-pendientes').textContent = pendientes;
        document.getElementById('emp-stat-proceso').textContent = enProceso;
        document.getElementById('emp-stat-finalizadas').textContent = finalizadas;
        document.getElementById('emp-stat-atrasadas').textContent = atrasadas;

        // Limpiar intervalos anteriores
        Object.keys(cronoIntervalos).forEach(k => {
            clearInterval(cronoIntervalos[k]);
            delete cronoIntervalos[k];
        });

        const container = document.getElementById('emp-lista-tareas');
        if (!tareas.length) {
            container.innerHTML = '<div class="empty-state"><p>No tienes tareas asignadas</p></div>';
            return;
        }

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

        container.innerHTML = tareas.map(t => {
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

            return `
                <div class="emp-tarea-card" id="emp-card-${t.id_tarea}">
                    <div style="display:flex;justify-content:space-between;align-items:start;">
                        <div class="tarea-titulo">${t.titulo}</div>
                        <span class="badge ${t.estado === 'finalizada' || t.estado === 'finalizada_atrasada' ? 'badge-success' : t.estado === 'en_proceso' ? 'badge-primary' : t.estado === 'atrasada' ? 'badge-danger' : 'badge-warning'}">${t.estado.replace('_', ' ')}</span>
                    </div>
                    <div class="tarea-desc">${t.descripcion || ''}</div>
                    <div class="tarea-meta">
                        <span class="badge" style="background: ${t.prioridad === 'urgente' ? '#ef4444' : t.prioridad === 'alta' ? '#f97316' : t.prioridad === 'media' ? '#f59e0b' : '#10b981'}; color: white; display:inline-block;">${t.prioridad.toUpperCase()}</span>
                        ${tiempoEst ? `<span class="badge badge-info">${tiempoEst}</span>` : ''}
                        ${t.fecha_vencimiento ? `<span style="font-size:0.75rem;color:var(--text-muted);">📅 ${formatearFecha(t.fecha_vencimiento)}</span>` : ''}
                    </div>
                    <div class="crono-container">
                        ${t.fecha_creacion ? `<div style="font-size:0.6rem;color:#a78bfa;letter-spacing:0.3px;margin-bottom:2px;text-align:center;width:100%;">📅 ${new Date(t.fecha_creacion).toLocaleDateString('es-MX',{day:'2-digit',month:'short',year:'numeric'})} · 🕐 ${formatearHoraEmpresa(t.fecha_creacion)}</div>` : ''}
                        <span style="font-size:1.2rem;">⏱</span>
                        <span class="crono-display ${cronoClase}" id="crono-${t.id_tarea}" data-inicio="${t.fecha_inicio || ''}" data-fin="${t.fecha_fin || ''}">00:00:00</span>
                        <div class="crono-acciones">${acciones}</div>
                    </div>
                </div>
            `;
        }).join('');

        // Iniciar cronómetros activos
        tareas.forEach(t => {
            const enProcesoActivo = t.estado === 'en_proceso' || t.estado === 'atrasada';
            const esFinalizada = t.estado === 'finalizada' || t.estado === 'finalizada_atrasada';

            if (enProcesoActivo && t.fecha_inicio) {
                iniciarCrono(t.id_tarea, new Date(t.fecha_inicio));
            } else if (esFinalizada && t.fecha_inicio && t.fecha_fin) {
                // Mostrar tiempo final congelado
                const segs = Math.round((new Date(t.fecha_fin) - new Date(t.fecha_inicio)) / 1000);
                const el = document.getElementById(`crono-${t.id_tarea}`);
                if (el) el.textContent = formatearCrono(segs);
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
    } catch(err) {
        mostrarToast(err.message || 'Error al completar tarea', 'error');
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
                    <span style="flex:1;font-size:0.88rem;font-weight:500;">${s.nombre}</span>
                    <span style="font-size:0.78rem;color:var(--text-muted);">${s.completadas}/${s.total_tareas} tareas</span>
                    <span class="badge ${eff >= 80 ? 'badge-success' : eff >= 50 ? 'badge-warning' : 'badge-danger'}">${eff}% ef.</span>
                </div>`;
            }).join('') : '<p style="color:var(--text-muted);font-size:0.85rem;">Sin supervisores aún</p>';

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
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    } catch(err) {
        console.error('Error cargando supervisores:', err);
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
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    } catch(err) {
        console.error('Error cargando empleados:', err);
    }
}

// ═══════════════════════════════════════════
// GESTIÓN DE USUARIOS (Modal)
// ═══════════════════════════════════════════
async function mostrarFormularioUsuario(rol) {
    document.getElementById('usu-rol').value = rol;
    document.getElementById('modal-usuario-titulo').textContent = `Nuevo ${rol === 'SUPERVISOR' ? 'Supervisor' : 'Empleado'}`;
    document.getElementById('form-usuario').reset();
    document.getElementById('form-usuario').style.display = 'block';
    document.getElementById('resultado-usuario').style.display = 'none';

    document.getElementById('usu-lada').value = '+52'; // Por defecto
    if (USUARIO && USUARIO.id_empresa) {
        fetchAPI(`/api/empresas/${USUARIO.id_empresa}`).then(emp => {
            if (emp) {
                // Mapeo básico de países a LADAS por si no hay teléfono guardado
                const ladas = {
                    'MX': '+52', 'GT': '+502', 'SV': '+503', 'HN': '+504',
                    'NI': '+505', 'CR': '+506', 'PA': '+507', 'CO': '+57',
                    'VE': '+58', 'EC': '+593', 'PE': '+51', 'BO': '+591',
                    'CL': '+56', 'AR': '+54', 'UY': '+598', 'PY': '+595',
                    'BR': '+55', 'DO': '+1', 'CU': '+53', 'PR': '+1',
                    'ES': '+34', 'US': '+1'
                };
                if (emp.pais && ladas[emp.pais]) {
                    document.getElementById('usu-lada').value = ladas[emp.pais];
                } else if (emp.telefono && emp.telefono.includes(' ')) {
                    document.getElementById('usu-lada').value = emp.telefono.split(' ')[0];
                }
            }
        }).catch(()=>console.log('No se pudo obtener lada'));
    }

    // Si es empleado, mostrar selector de supervisor
    const grupoSupervisor = document.getElementById('grupo-supervisor');
    if (rol === 'EMPLEADO') {
        grupoSupervisor.style.display = 'block';
        // Cargar supervisores disponibles
        try {
            const supervisores = await fetchAPI('/api/usuarios?rol=SUPERVISOR');
            const select = document.getElementById('usu-supervisor');
            select.innerHTML = '<option value="">-- Sin supervisor asignado --</option>';
            supervisores.forEach(s => {
                select.innerHTML += `<option value="${s.id_usuario}">${s.nombre}</option>`;
            });
        } catch(e) {}
    } else {
        grupoSupervisor.style.display = 'none';
    }

    document.getElementById('modal-usuario').style.display = 'flex';
}

function cerrarModalUsuario() {
    document.getElementById('modal-usuario').style.display = 'none';
    // Refrescar lista
    if (USUARIO && USUARIO.rol === 'ADMIN') {
        const panelActual = document.querySelector('.nav-btn.activo');
        if (panelActual) {
            const panel = panelActual.dataset.panel;
            if (panel === 'supervisores') cargarSupervisores();
            if (panel === 'empleados') cargarEmpleados();
            cargarDashboardAdmin();
        }
    } else if (USUARIO && USUARIO.rol === 'SUPERVISOR') {
        cargarEmpleadosSupervisor();
        cargarDashboardSupervisor();
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
        id_supervisor: document.getElementById('usu-supervisor').value || undefined
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
        if (USUARIO.rol === 'ADMIN') {
            const elP = document.getElementById('stat-pendientes'); if(elP) elP.textContent = stats.pendientes;
            const elEp = document.getElementById('stat-en-proceso'); if(elEp) elEp.textContent = stats.en_proceso;
            const elF = document.getElementById('stat-finalizadas'); if(elF) elF.textContent = stats.finalizadas;
            const elA = document.getElementById('stat-atrasadas'); if(elA) elA.textContent = stats.atrasadas;
        } else if (USUARIO.rol === 'SUPERVISOR') {
            const supStats = document.getElementById('sup-estadisticas-tareas');
            if (supStats) {
                supStats.innerHTML = `
                <div class="stats-grid" style="grid-template-columns:repeat(4,1fr);">
                    <div class="stat-card glass"><div class="stat-icon" style="background:linear-gradient(135deg,#f59e0b,#d97706)">🟡</div><div class="stat-info"><span class="stat-value">${stats.pendientes}</span><span class="stat-label">Pendientes</span></div></div>
                    <div class="stat-card glass"><div class="stat-icon" style="background:linear-gradient(135deg,#3b82f6,#2563eb)">🔵</div><div class="stat-info"><span class="stat-value">${stats.en_proceso}</span><span class="stat-label">En Proceso</span></div></div>
                    <div class="stat-card glass"><div class="stat-icon" style="background:linear-gradient(135deg,#10b981,#059669)">🟢</div><div class="stat-info"><span class="stat-value">${stats.finalizadas}</span><span class="stat-label">Finalizadas</span></div></div>
                    <div class="stat-card glass"><div class="stat-icon" style="background:linear-gradient(135deg,#ef4444,#dc2626)">🔴</div><div class="stat-info"><span class="stat-value">${stats.atrasadas}</span><span class="stat-label">Atrasadas</span></div></div>
                </div>`;
            }
        }
    } catch(e) {}
}

async function cargarTareas() {
    try {
        const estado = document.getElementById('filtro-estado')?.value || '';
        const prioridad = document.getElementById('filtro-prioridad')?.value || '';
        let url = '/api/tareas?';
        if (estado) url += `estado=${estado}&`;
        if (prioridad) url += `prioridad=${prioridad}&`;

        const tareas = await fetchAPI(url);
        const container = document.getElementById(USUARIO.rol === 'SUPERVISOR' ? 'sup-lista-tareas' : 'lista-tareas');
        
        if (!container) return;

        cargarEstadisticasTareas();

        if (!tareas.length) {
            container.innerHTML = '<div class="empty-state"><p>No hay tareas que mostrar</p></div>';
            return;
        }

        container.innerHTML = tareas.map(t => {
            const prioridadColor = {
                'urgente': '#ef4444', 'alta': '#f59e0b', 'media': '#6366f1', 'baja': '#10b981'
            }[t.prioridad] || '#6366f1';
            const estadoEmoji = {
                'pendiente': '🟡', 'en_proceso': '🔵', 'finalizada': '🟢',
                'atrasada': '🔴', 'finalizada_atrasada': '🟠'
            }[t.estado] || '⚪';
            const estadoTexto = {
                'pendiente': 'Pendiente', 'en_proceso': 'En Proceso', 'finalizada': 'Finalizada',
                'atrasada': 'Atrasada', 'finalizada_atrasada': 'Finalizada (atrasada)'
            }[t.estado] || t.estado;

            return `
            <div class="empresa-card glass" onclick="verDetalleTarea('${t.id_tarea}')" style="border-left:3px solid ${prioridadColor};">
                <div class="empresa-card-header">
                    <div class="empresa-avatar" style="background:${prioridadColor};font-size:1rem;">${t.prioridad === 'urgente' ? '🔥' : '📋'}</div>
                    <div>
                        <h4>${t.titulo}</h4>
                        <span class="empresa-id">${t.nombre_tipo || 'Sin tipo'} · ${estadoEmoji} ${estadoTexto}</span>
                    </div>
                </div>
                <div class="empresa-card-body">
                    ${t.nombre_empleado ? `<span class="empresa-stat">👤 ${t.nombre_empleado}</span>` : ''}
                    ${t.nombre_supervisor ? `<span class="empresa-stat">👁 ${t.nombre_supervisor}</span>` : ''}
                    ${t.tiempo_estimado_minutos ? `<span class="empresa-stat">⏱ ${formatearTiempo(t.tiempo_estimado_minutos)}</span>` : ''}
                    ${t.total_evidencias > 0 ? `<span class="empresa-stat">📸 ${t.total_evidencias}</span>` : ''}
                    ${t.total_comentarios > 0 ? `<span class="empresa-stat">💬 ${t.total_comentarios}</span>` : ''}
                </div>
                <div class="empresa-card-footer">
                    <span class="badge" style="background:${prioridadColor}22;color:${prioridadColor};">${t.prioridad.toUpperCase()}</span>
                    <span style="font-size:0.75rem;color:var(--text-muted)">${formatearFecha(t.fecha_creacion)}</span>
                </div>
            </div>`;
        }).join('');
    } catch(err) {
        console.error('Error cargando tareas:', err);
    }
}

async function mostrarFormularioTarea() {
    document.getElementById('form-tarea').reset();
    // Cargar empleados
    try {
        const usuarios = await fetchAPI('/api/usuarios');
        const selEmp = document.getElementById('tarea-empleado');
        const selSup = document.getElementById('tarea-supervisor');
        selEmp.innerHTML = '<option value="">-- Seleccionar --</option>';
        selSup.innerHTML = '<option value="">-- Seleccionar --</option>';
        usuarios.forEach(u => {
            if (u.rol === 'EMPLEADO') selEmp.innerHTML += `<option value="${u.id_usuario}">${u.nombre}</option>`;
            if (u.rol === 'SUPERVISOR') selSup.innerHTML += `<option value="${u.id_usuario}">${u.nombre}</option>`;
        });
    } catch(e) {}
    // Cargar tipos
    try {
        const tipos = await fetchAPI('/api/tareas/tipos/lista');
        const selTipo = document.getElementById('tarea-tipo');
        selTipo.innerHTML = '<option value="">-- Seleccionar tipo --</option>';
        tipos.forEach(t => { selTipo.innerHTML += `<option value="${t.id_tipo}">${t.nombre}</option>`; });
    } catch(e) {}
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

    const datos = {
        titulo: document.getElementById('tarea-titulo').value.trim(),
        descripcion: document.getElementById('tarea-descripcion').value.trim(),
        id_empleado: document.getElementById('tarea-empleado').value || undefined,
        id_supervisor: document.getElementById('tarea-supervisor').value || undefined,
        id_tipo: document.getElementById('tarea-tipo').value || undefined,
        prioridad: document.getElementById('tarea-prioridad').value,
        tiempo_estimado_minutos: tiempoEstFinal
    };
    try {
        await fetchAPI('/api/tareas', { method: 'POST', body: JSON.stringify(datos) });
        cerrarModalTarea();
        cargarTareas();
        mostrarToast('Tarea creada exitosamente', 'success');
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
        acciones += `<button class="btn btn-danger btn-sm" onclick="eliminarTarea('${tarea.id_tarea}')">🗑 Eliminar</button>`;
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
        mostrarToast(err.message, 'error');
    }
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

// Evidencias (texto + imágenes)
function renderizarEvidencias(evidencias) {
    const container = document.getElementById('lista-evidencias');
    if (!evidencias.length) { container.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;">Sin evidencias</p>'; return; }
    container.innerHTML = evidencias.map(ev => `
        <div style="padding:8px 0;border-bottom:1px solid var(--border-color);">
            <span class="badge ${ev.tipo === 'imagen' ? 'badge-info' : 'badge-primary'}" style="margin-bottom:4px;">${ev.tipo === 'imagen' ? '📸 Imagen' : '📝 Texto'}</span>
            ${ev.tipo === 'imagen' && ev.contenido.startsWith('/uploads/')
                ? `<div style="margin-top:6px;"><a href="${ev.contenido}" target="_blank"><img src="${ev.contenido}" alt="Evidencia" style="max-width:200px;max-height:150px;border-radius:8px;border:1px solid var(--border-color);cursor:pointer;"></a></div>`
                : `<p style="font-size:0.88rem;color:var(--text-secondary);margin-top:4px;">${ev.contenido}</p>`
            }
            <span style="font-size:0.75rem;color:var(--text-muted);">${formatearFechaHora(ev.fecha_registro)}</span>
        </div>
    `).join('');
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
    fileInput.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const formData = new FormData();
        formData.append('archivo', file);
        formData.append('tipo', 'imagen');
        try {
            const resp = await fetch(`/api/tareas/${TAREA_ACTUAL.id_tarea}/evidencias`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${TOKEN}` },
                body: formData
            });
            if (!resp.ok) throw new Error('Error al subir imagen');
            verDetalleTarea(TAREA_ACTUAL.id_tarea);
            mostrarToast('📸 Imagen subida exitosamente', 'success');
        } catch(err) { mostrarToast('Error al subir imagen', 'error'); }
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
    // Cargar empleados y supervisores en los selects
    try {
        const usuarios = await fetchAPI('/api/usuarios');
        ['plt-empleado', 'plt-supervisor', 'cal-empleado'].forEach(selId => {
            const sel = document.getElementById(selId);
            if (!sel) return;
            sel.innerHTML = '<option value="">-- Seleccionar --</option>';
            usuarios.forEach(u => {
                if (selId.includes('supervisor') && u.rol === 'SUPERVISOR') {
                    sel.innerHTML += `<option value="${u.id_usuario}">${u.nombre}</option>`;
                } else if (!selId.includes('supervisor') && u.rol === 'EMPLEADO') {
                    sel.innerHTML += `<option value="${u.id_usuario}">${u.nombre}</option>`;
                }
            });
        });
    } catch(e) {}
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
        prioridad: document.getElementById('plt-prioridad').value,
        recurrencia,
        dias_semana,
        hora_creacion: obtenerHora12a24(),
        tiempo_estimado_minutos: tiempoRaw ? (tiempoRaw * unidad) : undefined,
        incluir_finsemana: document.getElementById('plt-finsemana').checked
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
        prioridad: document.getElementById('cal-prioridad').value,
        tiempo_estimado_minutos: tiempoRaw ? (tiempoRaw * unidad) : undefined
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

        // Guardar formato de hora globalmente
        window.FORMATO_HORA_EMPRESA = config.formato_hora || '12h';

        const supContainer = document.getElementById('pantalla-supervisor');
        if (!supContainer) return;

        // Permisos de asignación de tareas
        const botonesNuevaTarea = supContainer.querySelectorAll('button[onclick*="mostrarFormularioTarea"]');
        const botonesRepetitivas = supContainer.querySelectorAll('button[onclick*="abrirModalPlantillas"]');

        if (!config.permite_supervisor_asignar) {
            botonesNuevaTarea.forEach(btn => btn.style.display = 'none');
            botonesRepetitivas.forEach(btn => btn.style.display = 'none');
        } else {
            botonesNuevaTarea.forEach(btn => btn.style.display = '');
            botonesRepetitivas.forEach(btn => btn.style.display = '');
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
    const d = new Date(fechaStr);
    if (window.FORMATO_HORA_EMPRESA === '24h') {
        return d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false });
    }
    return d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: true });
}

// ═══════════════════════════════════════════
// HISTORIAL DE TAREAS (ADMIN)
// ═══════════════════════════════════════════
function toggleHistorialTareas() {
    const panel = document.getElementById('panel-historial-tareas');
    const btn = document.getElementById('btn-historial-tareas');
    if (panel.style.display === 'none') {
        panel.style.display = 'block';
        btn.innerHTML = '📜 Ocultar Historial';
        btn.style.background = 'linear-gradient(135deg,#ef4444,#dc2626)';
        cargarHistorialTareas();
    } else {
        panel.style.display = 'none';
        btn.innerHTML = '📜 Historial';
        btn.style.background = 'linear-gradient(135deg,#6366f1,#4f46e5)';
    }
}

async function cargarHistorialTareas() {
    try {
        const desde = document.getElementById('historial-fecha-desde')?.value || '';
        const hasta = document.getElementById('historial-fecha-hasta')?.value || '';
        const filtroEstado = document.getElementById('historial-filtro-estado')?.value || '';
        let url = '/api/tareas/historial';
        const params = [];
        if (desde) params.push(`desde=${desde}`);
        if (hasta) params.push(`hasta=${hasta}`);
        if (params.length) url += '?' + params.join('&');

        let tareas = await fetchAPI(url);
        const container = document.getElementById('tabla-historial-tareas');

        // Filtrar por estado si se seleccionó
        if (filtroEstado) {
            tareas = tareas.filter(t => t.estado === filtroEstado);
        }

        if (!tareas.length) {
            container.innerHTML = '<div class="empty-state"><p>No hay registros en el historial</p></div>';
            return;
        }

        const prioridadColor = { 'urgente': '#ef4444', 'alta': '#f97316', 'media': '#f59e0b', 'baja': '#10b981' };
        const estadoColor = {
            'pendiente': '#f59e0b', 'en_proceso': '#3b82f6', 'finalizada': '#10b981',
            'finalizada_atrasada': '#f97316', 'atrasada': '#ef4444', 'cancelada': '#6b7280'
        };
        const estadoLabel = {
            'pendiente': '🟡 Pendiente', 'en_proceso': '🔵 En Proceso', 'finalizada': '✅ Completada',
            'finalizada_atrasada': '⚠️ Atrasada', 'atrasada': '🔴 Atrasada', 'cancelada': '⬜ Cancelada'
        };

        function fh(f) {
            if (!f) return '<span style="color:#4b5563;">—</span>';
            const d = new Date(f);
            return `<span style="font-size:0.65rem;">${d.toLocaleDateString('es-MX',{day:'2-digit',month:'short',year:'numeric'})}</span><br><span style="color:#a78bfa;font-size:0.63rem;">${d.toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit',hour12: window.FORMATO_HORA_EMPRESA !== '24h'})}</span>`;
        }

        function fmtDur(seg) {
            if (!seg) return '<span style="color:#4b5563;">—</span>';
            seg = parseInt(seg);
            const h = Math.floor(seg / 3600);
            const m = Math.floor((seg % 3600) / 60);
            const s = seg % 60;
            if (h > 0) return `<span style="color:#f59e0b;font-weight:700;">${h}h ${m}m</span>`;
            if (m > 0) return `<span style="color:#10b981;font-weight:700;">${m}m ${s}s</span>`;
            return `<span style="color:#3b82f6;font-weight:700;">${s}s</span>`;
        }

        container.innerHTML = `
            <div style="overflow-x:auto;max-width:100%;">
            <table style="width:100%;border-collapse:collapse;font-size:0.72rem;min-width:900px;">
                <thead>
                    <tr style="border-bottom:2px solid rgba(139,92,246,0.3);text-align:left;background:rgba(139,92,246,0.05);">
                        <th style="padding:10px 6px;white-space:nowrap;">🔑 Código</th>
                        <th style="padding:10px 6px;white-space:nowrap;">👤 Empleado</th>
                        <th style="padding:10px 6px;white-space:nowrap;">📱 Teléfono</th>
                        <th style="padding:10px 6px;white-space:nowrap;">📋 Tarea</th>
                        <th style="padding:10px 6px;white-space:nowrap;">📅 Asignada</th>
                        <th style="padding:10px 6px;white-space:nowrap;">▶️ Inicio</th>
                        <th style="padding:10px 6px;white-space:nowrap;">⏹️ Fin</th>
                        <th style="padding:10px 6px;white-space:nowrap;">⏱️ Duración</th>
                        <th style="padding:10px 6px;white-space:nowrap;">📸 Evidencias</th>
                        <th style="padding:10px 6px;white-space:nowrap;">⚡ Prioridad</th>
                        <th style="padding:10px 6px;white-space:nowrap;">📊 Estado</th>
                        <th style="padding:10px 6px;white-space:nowrap;">👁️ Supervisor</th>
                    </tr>
                </thead>
                <tbody>
                    ${tareas.map((t, i) => {
                        const pColor = prioridadColor[t.prioridad] || '#6366f1';
                        const eColor = estadoColor[t.estado] || '#6b7280';
                        const eLabel = estadoLabel[t.estado] || t.estado;
                        const bgRow = i % 2 === 0 ? 'rgba(139,92,246,0.02)' : 'transparent';
                        return `<tr style="border-bottom:1px solid var(--border-color);background:${bgRow};transition:background 0.2s;" onmouseover="this.style.background='rgba(139,92,246,0.08)'" onmouseout="this.style.background='${bgRow}'">
                            <td style="padding:8px 6px;"><span style="background:rgba(139,92,246,0.15);color:#a78bfa;padding:3px 8px;border-radius:6px;font-weight:700;font-family:monospace;font-size:0.7rem;">${t.codigo_empleado || '—'}</span></td>
                            <td style="padding:8px 6px;font-weight:600;white-space:nowrap;">${t.nombre_empleado || '—'}</td>
                            <td style="padding:8px 6px;font-size:0.68rem;">${t.telefono_empleado ? `<a href="https://wa.me/${(t.telefono_empleado||'').replace(/[^0-9]/g,'')}" target="_blank" style="color:#25d366;text-decoration:none;" title="Enviar WhatsApp">${t.telefono_empleado}</a>` : '—'}</td>
                            <td style="padding:8px 6px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500;" title="${t.titulo}">${t.titulo}</td>
                            <td style="padding:8px 6px;">${fh(t.fecha_creacion)}</td>
                            <td style="padding:8px 6px;">${fh(t.hora_inicio_real || t.fecha_inicio)}</td>
                            <td style="padding:8px 6px;">${fh(t.hora_fin_real || t.fecha_fin)}</td>
                            <td style="padding:8px 6px;text-align:center;">${fmtDur(t.tiempo_total_segundos)}</td>
                            <td style="padding:8px 6px;text-align:center;">
                                ${t.total_evidencias > 0 
                                    ? `<button onclick="verEvidenciasTarea('${t.id_tarea}')" style="background:rgba(59,130,246,0.15);color:#3b82f6;border:none;padding:3px 8px;border-radius:6px;cursor:pointer;font-size:0.68rem;font-weight:600;">📸 ${t.total_evidencias}</button>` 
                                    : '<span style="color:#4b5563;font-size:0.65rem;">Sin foto</span>'}
                            </td>
                            <td style="padding:8px 6px;"><span style="background:${pColor}18;color:${pColor};padding:2px 7px;border-radius:5px;font-size:0.65rem;font-weight:700;">${(t.prioridad||'media').toUpperCase()}</span></td>
                            <td style="padding:8px 6px;"><span style="color:${eColor};font-weight:700;font-size:0.68rem;">${eLabel}</span></td>
                            <td style="padding:8px 6px;font-size:0.68rem;color:var(--text-muted);">${t.nombre_supervisor || '—'}</td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;padding:10px;font-size:0.72rem;color:var(--text-muted);border-top:1px solid var(--border-color);margin-top:4px;">
                <span>📊 Total: <strong style="color:white;">${tareas.length}</strong> tareas</span>
                <span>✅ ${tareas.filter(t=>t.estado==='finalizada').length} completadas · 🔴 ${tareas.filter(t=>t.estado==='atrasada'||t.estado==='finalizada_atrasada').length} atrasadas</span>
            </div>
        `;
    } catch (err) {
        console.error('Error cargando historial:', err);
    }
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

