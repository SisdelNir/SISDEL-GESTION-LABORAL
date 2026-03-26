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
    } else if (USUARIO.rol === 'EMPLEADO') {
        mostrarPantalla('empleado');
        document.getElementById('emp-panel-user-name').textContent = USUARIO.nombre;
        document.getElementById('emp-panel-empresa-nombre').textContent = USUARIO.nombre_empresa || 'Empresa';
        cargarTareasEmpleado();
    }
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
        admin_correo: document.getElementById('admin-correo').value.trim()
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

        container.innerHTML = tareas.map(t => {
            const esFinalizada = t.estado === 'finalizada' || t.estado === 'finalizada_atrasada';
            const enProcesoActivo = t.estado === 'en_proceso' || t.estado === 'atrasada';
            const esPendiente = t.estado === 'pendiente';
            const tiempoEst = t.tiempo_estimado_minutos ? `⏱ ${t.tiempo_estimado_minutos} min` : '';

            // Determinar clase del cronómetro
            let cronoClase = '';
            if (enProcesoActivo) cronoClase = 'corriendo';
            else if (esFinalizada) cronoClase = 'detenido';

            // Botones de acción
            let acciones = '';
            if (esPendiente) {
                acciones = `<button class="btn-crono btn-iniciar" onclick="event.stopPropagation(); iniciarTareaEmpleado('${t.id_tarea}')">▶ Iniciar</button>`;
            } else if (enProcesoActivo) {
                acciones = `<button class="btn-crono btn-completar" onclick="event.stopPropagation(); completarTareaEmpleado('${t.id_tarea}')">✅ Completar</button>`;
            }

            return `
                <div class="emp-tarea-card" id="emp-card-${t.id_tarea}">
                    <div style="display:flex;justify-content:space-between;align-items:start;">
                        <div class="tarea-titulo">${t.titulo}</div>
                        <span class="badge ${t.estado === 'finalizada' || t.estado === 'finalizada_atrasada' ? 'badge-success' : t.estado === 'en_proceso' ? 'badge-primary' : t.estado === 'atrasada' ? 'badge-danger' : 'badge-warning'}">${t.estado.replace('_', ' ')}</span>
                    </div>
                    <div class="tarea-desc">${t.descripcion || ''}</div>
                    <div class="tarea-meta">
                        <span class="badge ${t.prioridad === 'alta' ? 'badge-danger' : t.prioridad === 'media' ? 'badge-warning' : 'badge-info'}">${t.prioridad}</span>
                        ${tiempoEst ? `<span class="badge badge-info">${tiempoEst}</span>` : ''}
                        ${t.fecha_vencimiento ? `<span style="font-size:0.75rem;color:var(--text-muted);">📅 ${formatearFecha(t.fecha_vencimiento)}</span>` : ''}
                    </div>
                    <div class="crono-container">
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
        document.getElementById('stat-pendientes').textContent = stats.pendientes;
        document.getElementById('stat-en-proceso').textContent = stats.en_proceso;
        document.getElementById('stat-finalizadas').textContent = stats.finalizadas;
        document.getElementById('stat-atrasadas').textContent = stats.atrasadas;
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
        const container = document.getElementById('lista-tareas');

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
                    ${t.tiempo_estimado_minutos ? `<span class="empresa-stat">⏱ ${t.tiempo_estimado_minutos}min</span>` : ''}
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
}

function cerrarModalTarea() {
    document.getElementById('modal-tarea').style.display = 'none';
}

async function crearTarea(e) {
    e.preventDefault();
    const datos = {
        titulo: document.getElementById('tarea-titulo').value.trim(),
        descripcion: document.getElementById('tarea-descripcion').value.trim(),
        id_empleado: document.getElementById('tarea-empleado').value || undefined,
        id_supervisor: document.getElementById('tarea-supervisor').value || undefined,
        id_tipo: document.getElementById('tarea-tipo').value || undefined,
        prioridad: document.getElementById('tarea-prioridad').value,
        tiempo_estimado_minutos: parseInt(document.getElementById('tarea-tiempo').value) || undefined
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
                ${tarea.tiempo_estimado_minutos ? `<div class="dato-row"><span class="dato-label">Tiempo estimado</span><span class="dato-value">${tarea.tiempo_estimado_minutos} min</span></div>` : ''}
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
