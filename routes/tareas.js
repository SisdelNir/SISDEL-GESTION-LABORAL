const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { db } = require('../database/init');
const { verificarToken, verificarRol, registrarAuditoria } = require('../middleware/auth');
const { generarCodigoTarea } = require('../utils/codigoTarea');

// ═══════════════════════════════════════════
// CRUD DE TAREAS
// ═══════════════════════════════════════════

/**
 * POST /api/tareas
 */
router.post('/', verificarToken, verificarRol('ADMIN', 'SUPERVISOR', 'GERENTE'), async (req, res) => {
    try {
        const {
            titulo, descripcion, id_empleado, id_supervisor, id_tipo, prioridad,
            tiempo_estimado_minutos, requiere_evidencia,
            // Campos cliente
            tiene_cliente, codigo_cliente, nombre_cliente, telefono_cliente,
            correo_cliente, obs_cliente, fecha_seguimiento
        } = req.body;
        if (!titulo) return res.status(400).json({ error: 'El título es requerido' });

        const id_empresa = req.usuario.id_empresa;
        const id_tarea = uuidv4();
        const id_creador = req.usuario.id_usuario;
        
        let supervisorFinal = id_supervisor || (req.usuario.rol === 'SUPERVISOR' ? req.usuario.id_usuario : null);

        if (id_empleado) {
            const rel = await db.get('SELECT id_supervisor FROM supervisores_empleados WHERE id_empleado = ?', id_empleado);
            if (rel && rel.id_supervisor) supervisorFinal = rel.id_supervisor;
        }

        const config = await db.get('SELECT empleado_puede_iniciar FROM configuraciones_empresa WHERE id_empresa = ?', id_empresa);
        const empPuedeIniciar = config ? config.empleado_puede_iniciar : 1;

        let estadoInicial, fechaInic;
        if (id_empleado) {
            if (empPuedeIniciar) {
                estadoInicial = 'pendiente'; fechaInic = null;
            } else {
                estadoInicial = 'en_proceso'; fechaInic = new Date().toISOString();
            }
        } else {
            estadoInicial = 'pendiente'; fechaInic = null;
        }

        const reqEvidenciaNum = requiere_evidencia ? 1 : 0;
        const tieneClienteNum = tiene_cliente ? 1 : 0;

        // Generar código de cliente si no viene
        let codigoClienteFinal = codigo_cliente || null;
        if (tieneClienteNum && nombre_cliente && !codigoClienteFinal) {
            const letras = nombre_cliente.replace(/[^a-zA-Z]/g, '').substring(0, 3).toUpperCase().padEnd(3, 'X');
            codigoClienteFinal = letras + String(Math.floor(Math.random() * 90) + 10);
        }

        const codigo_tarea = await generarCodigoTarea(id_empresa);

        await db.run(`
            INSERT INTO tareas (id_tarea, id_empresa, codigo_tarea, titulo, descripcion, id_empleado, id_supervisor,
                id_creador, id_tipo, prioridad, tiempo_estimado_minutos, requiere_evidencia, estado, fecha_inicio,
                tiene_cliente, codigo_cliente, nombre_cliente, telefono_cliente, correo_cliente, obs_cliente, fecha_seguimiento)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, id_tarea, id_empresa, codigo_tarea, titulo, descripcion || '', id_empleado || null,
           supervisorFinal, id_creador, id_tipo || null, prioridad || 'media',
           tiempo_estimado_minutos || null, reqEvidenciaNum, estadoInicial, fechaInic,
           tieneClienteNum, codigoClienteFinal, nombre_cliente || null,
           telefono_cliente || null, correo_cliente || null, obs_cliente || null,
           fecha_seguimiento || null);

        await db.run(`
            INSERT INTO historial_estados_tarea (id_tarea, estado_nuevo, id_usuario, comentario)
            VALUES (?, 'pendiente', ?, 'Tarea creada')
        `, id_tarea, id_creador);

        if (estadoInicial === 'en_proceso' && fechaInic) {
            await db.run(`INSERT INTO seguimiento_tiempo (id_seguimiento, id_tarea, hora_inicio) VALUES (?, ?, ?)`, uuidv4(), id_tarea, fechaInic);
        } else {
            await db.run(`INSERT INTO seguimiento_tiempo (id_seguimiento, id_tarea) VALUES (?, ?)`, uuidv4(), id_tarea);
        }

        // Si tiene fecha de seguimiento → crear tarea de seguimiento automáticamente
        if (tieneClienteNum && fecha_seguimiento && nombre_cliente) {
            const idSeguimiento = uuidv4();
            const codSeg = await generarCodigoTarea(id_empresa);
            await db.run(`
                INSERT INTO tareas (id_tarea, id_empresa, codigo_tarea, titulo, descripcion, id_empleado, id_supervisor,
                    id_creador, prioridad, estado, fecha_creacion,
                    tiene_cliente, codigo_cliente, nombre_cliente, telefono_cliente, correo_cliente, fecha_seguimiento)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendiente', ?, 1, ?, ?, ?, ?, ?)
            `, idSeguimiento, id_empresa, codSeg,
               `Seguimiento cliente: ${nombre_cliente}`,
               `Seguimiento programado para el ${fecha_seguimiento} con ${nombre_cliente}`,
               id_empleado || null, supervisorFinal, id_creador,
               prioridad || 'media', new Date().toISOString(),
               codigoClienteFinal, nombre_cliente, telefono_cliente || null, correo_cliente || null, fecha_seguimiento);
            await db.run(`INSERT INTO seguimiento_tiempo (id_seguimiento, id_tarea) VALUES (?, ?)`, uuidv4(), idSeguimiento);
            if (id_empleado) {
                await db.run(`INSERT INTO notificaciones (id_notificacion, id_usuario, titulo, mensaje, tipo) VALUES (?, ?, ?, ?, 'nueva_tarea')`,
                    uuidv4(), id_empleado, '📅 Seguimiento de cliente programado',
                    `Se generó una nueva tarea: "Seguimiento cliente: ${nombre_cliente}" para el ${fecha_seguimiento}`);
            }
        }

        // Notificar al empleado
        if (id_empleado) {
            await db.run(`
                INSERT INTO notificaciones (id_notificacion, id_usuario, titulo, mensaje, tipo)
                VALUES (?, ?, ?, ?, 'nueva_tarea')
            `, uuidv4(), id_empleado, '📋 Nueva tarea asignada', `Se te asignó la tarea: "${titulo}" - Presiona Iniciar cuando estés listo`);
        }

        // Notificar al supervisor
        if (supervisorFinal) {
            await db.run(`
                INSERT INTO notificaciones (id_notificacion, id_usuario, titulo, mensaje, tipo)
                VALUES (?, ?, ?, ?, 'nueva_tarea')
            `, uuidv4(), supervisorFinal, '📋 Tarea asignada a tu equipo', `Nueva tarea: "${titulo}" ha sido asignada`);
        }

        const io = req.app.get('io');
        if (io) {
            const payload = {
                id_tarea, titulo, id_empleado, prioridad,
                estado: estadoInicial, fecha_creacion: new Date().toISOString()
            };
            io.to(`empresa_${id_empresa}`).emit('nueva_tarea', payload);
            // Notificación directa al empleado y supervisor
            if (id_empleado) io.to(`user_${id_empleado}`).emit('notificacion', { titulo: '📋 Nueva tarea asignada', mensaje: `Tarea: "${titulo}"` });
            if (supervisorFinal) io.to(`user_${supervisorFinal}`).emit('notificacion', { titulo: '📋 Tarea asignada a tu equipo', mensaje: `Tarea: "${titulo}"` });
            console.log(`📨 Emitido nueva_tarea a empresa_${id_empresa}:`, JSON.stringify(payload));
        } else {
            console.log('⚠️ Socket.IO no disponible para emitir nueva_tarea');
        }

        registrarAuditoria(id_empresa, id_creador, 'CREAR_TAREA', `Tarea "${titulo}" creada`);
        const tareaCreada = await db.get('SELECT * FROM tareas WHERE id_tarea = ?', id_tarea);
        res.status(201).json({ mensaje: 'Tarea creada exitosamente', tarea: tareaCreada });
    } catch (err) {
        console.error('Error creando tarea:', err);
        res.status(500).json({ error: 'Error al crear la tarea: ' + err.message });
    }
});

/**
 * GET /api/tareas
 */
router.get('/', verificarToken, async (req, res) => {
    try {
        const id_empresa = req.usuario.id_empresa;
        const { estado, prioridad, id_empleado, id_supervisor } = req.query;

        let query = `
            SELECT t.*,
                   emp.nombre as nombre_empleado,
                   sup.nombre as nombre_supervisor,
                   cre.nombre as nombre_creador,
                   tt.nombre as nombre_tipo,
                   tt.peso_complejidad,
                   (SELECT hora_inicio FROM seguimiento_tiempo WHERE id_tarea = t.id_tarea ORDER BY hora_inicio ASC LIMIT 1) as tiempo_inicio,
                   (SELECT hora_fin FROM seguimiento_tiempo WHERE id_tarea = t.id_tarea AND hora_fin IS NOT NULL ORDER BY hora_fin DESC LIMIT 1) as tiempo_fin,
                   (SELECT SUM(tiempo_real_segundos) FROM seguimiento_tiempo WHERE id_tarea = t.id_tarea) as tiempo_real_segundos,
                   (SELECT lat_inicio FROM seguimiento_tiempo WHERE id_tarea = t.id_tarea AND lat_inicio IS NOT NULL LIMIT 1) as lat_inicio,
                   (SELECT lng_inicio FROM seguimiento_tiempo WHERE id_tarea = t.id_tarea AND lng_inicio IS NOT NULL LIMIT 1) as lng_inicio,
                   (SELECT lat_fin FROM seguimiento_tiempo WHERE id_tarea = t.id_tarea AND lat_fin IS NOT NULL LIMIT 1) as lat_fin,
                   (SELECT lng_fin FROM seguimiento_tiempo WHERE id_tarea = t.id_tarea AND lng_fin IS NOT NULL LIMIT 1) as lng_fin,
                   (SELECT COUNT(*) FROM evidencias_tarea WHERE id_tarea = t.id_tarea) as total_evidencias,
                   (SELECT COUNT(*) FROM comentarios_tarea WHERE id_tarea = t.id_tarea) as total_comentarios
            FROM tareas t
            LEFT JOIN usuarios emp ON t.id_empleado = emp.id_usuario
            LEFT JOIN usuarios sup ON t.id_supervisor = sup.id_usuario
            LEFT JOIN usuarios cre ON t.id_creador = cre.id_usuario
            LEFT JOIN tipos_tarea tt ON t.id_tipo = tt.id_tipo
            WHERE t.id_empresa = ? AND t.eliminado = 0
        `;
        const params = [id_empresa];

        if (estado) { query += ' AND t.estado = ?'; params.push(estado); }
        if (prioridad) { query += ' AND t.prioridad = ?'; params.push(prioridad); }
        if (id_empleado) { query += ' AND t.id_empleado = ?'; params.push(id_empleado); }
        if (id_supervisor) { query += ' AND t.id_supervisor = ?'; params.push(id_supervisor); }

        if (req.usuario.rol === 'EMPLEADO') {
            query += ' AND t.id_empleado = ?';
            params.push(req.usuario.id_usuario);
        } else if (req.usuario.rol === 'SUPERVISOR') {
            query += ' AND (t.id_empleado = ? OR EXISTS (SELECT 1 FROM usuarios emp2 WHERE emp2.id_usuario = t.id_empleado AND emp2.id_jefe = ?))';
            params.push(req.usuario.id_usuario, req.usuario.id_usuario);
        } else if (req.usuario.rol === 'GERENTE') {
            // Gerente ve tareas de empleados de SU departamento/gerencia
            query += ' AND t.id_empleado IN (SELECT id_usuario FROM usuarios WHERE id_departamento = ? AND eliminado = 0)';
            params.push(req.usuario.id_departamento);
        }

        query += ` ORDER BY CASE t.prioridad WHEN 'urgente' THEN 1 WHEN 'alta' THEN 2 WHEN 'media' THEN 3 WHEN 'baja' THEN 4 END, t.fecha_creacion DESC`;

        const tareas = await db.all(query, ...params);
        res.json(tareas);
    } catch (err) {
        console.error('Error listando tareas:', err);
        res.status(500).json({ error: 'Error al listar tareas' });
    }
});

/**
 * GET /api/tareas/estadisticas
 */
router.get('/estadisticas', verificarToken, async (req, res) => {
    try {
        const id_empresa = req.usuario.id_empresa;
        const esSupervisor = req.usuario.rol === 'SUPERVISOR';
        const id_sup = req.usuario.id_usuario;

        let baseQuery, baseParams;

        if (esSupervisor) {
            // Solo tareas de empleados que reportan al supervisor + tareas propias
            baseQuery = `FROM tareas t LEFT JOIN usuarios emp ON t.id_empleado = emp.id_usuario WHERE t.id_empresa = ? AND t.eliminado = 0 AND (t.id_empleado = ? OR emp.id_jefe = ?)`;
            baseParams = [id_empresa, id_sup, id_sup];
        } else if (req.usuario.rol === 'GERENTE') {
            // Gerente: solo tareas de empleados de SU departamento
            baseQuery = `FROM tareas t JOIN usuarios u ON t.id_empleado = u.id_usuario WHERE t.id_empresa = ? AND t.eliminado = 0 AND u.id_departamento = ?`;
            baseParams = [id_empresa, req.usuario.id_departamento];
        } else {
            baseQuery = `FROM tareas t WHERE t.id_empresa = ? AND t.eliminado = 0`;
            baseParams = [id_empresa];
        }

        const total = await db.get(`SELECT COUNT(*) as c ${baseQuery}`, ...baseParams);
        const pendientes = await db.get(`SELECT COUNT(*) as c ${baseQuery} AND t.estado = 'pendiente'`, ...baseParams);
        const en_proceso = await db.get(`SELECT COUNT(*) as c ${baseQuery} AND t.estado = 'en_proceso'`, ...baseParams);
        const finalizadas = await db.get(`SELECT COUNT(*) as c ${baseQuery} AND t.estado IN ('finalizada','finalizada_atrasada')`, ...baseParams);
        const atrasadas = await db.get(`SELECT COUNT(*) as c ${baseQuery} AND t.estado = 'atrasada'`, ...baseParams);
        const finAtiempo = await db.get(`SELECT COUNT(*) as c ${baseQuery} AND t.estado = 'finalizada'`, ...baseParams);
        const urgentes = await db.get(`SELECT COUNT(*) as c ${baseQuery} AND t.prioridad = 'urgente' AND t.estado NOT IN ('finalizada','finalizada_atrasada')`, ...baseParams);

        const totalFin = finalizadas.c;
        const eficiencia = totalFin > 0 ? Math.round((finAtiempo.c / totalFin) * 100) : 0;

        res.json({
            total: total.c, pendientes: pendientes.c, en_proceso: en_proceso.c,
            finalizadas: totalFin, atrasadas: atrasadas.c, eficiencia, urgentes: urgentes.c
        });
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener estadísticas' });
    }
});



/**
 * GET /api/tareas/debug/evidencias
 * DIAGNÓSTICO: ver si hay evidencias en la BD
 */
router.get('/debug/evidencias', verificarToken, async (req, res) => {
    try {
        const total = await db.get('SELECT COUNT(*) as total FROM evidencias_tarea');
        const recientes = await db.all(`SELECT id_evidencia, id_tarea, tipo, 
            CASE WHEN contenido IS NOT NULL THEN LENGTH(contenido) ELSE 0 END as size_contenido, 
            fecha_registro FROM evidencias_tarea ORDER BY fecha_registro DESC LIMIT 10`);
        const tareasConEv = await db.all(`
            SELECT t.id_tarea, t.titulo, t.requiere_evidencia, 
                   COUNT(e.id_evidencia) as num_evidencias
            FROM tareas t
            LEFT JOIN evidencias_tarea e ON t.id_tarea = e.id_tarea
            WHERE t.id_empresa = ? AND t.eliminado = 0
            GROUP BY t.id_tarea, t.titulo, t.requiere_evidencia
            HAVING COUNT(e.id_evidencia) > 0
            ORDER BY t.fecha_creacion DESC LIMIT 20
        `, req.usuario.id_empresa);
        res.json({ 
            total_evidencias_en_bd: total ? total.total : 0,
            ultimas_10: recientes,
            tareas_con_evidencias: tareasConEv
        });
    } catch (err) {
        console.error('Error debug evidencias:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/tareas/tipos/lista
 * IMPORTANTE: debe estar ANTES de /:id
 */
router.get('/tipos/lista', verificarToken, async (req, res) => {
    try {
        const tipos = await db.all('SELECT * FROM tipos_tarea WHERE id_empresa = ?', req.usuario.id_empresa);
        res.json(tipos);
    } catch (err) {
        res.status(500).json({ error: 'Error al listar tipos' });
    }
});

/**
 * GET /api/tareas/notificaciones/mis
 * IMPORTANTE: debe estar ANTES de /:id
 */
router.get('/notificaciones/mis', verificarToken, async (req, res) => {
    try {
        const notificaciones = await db.all(`
            SELECT * FROM notificaciones WHERE id_usuario = ? ORDER BY fecha DESC LIMIT 50
        `, req.usuario.id_usuario);
        res.json(notificaciones);
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener notificaciones' });
    }
});

router.put('/notificaciones/:id/leer', verificarToken, async (req, res) => {
    try {
        await db.run('UPDATE notificaciones SET leido = 1 WHERE id_notificacion = ? AND id_usuario = ?',
            req.params.id, req.usuario.id_usuario);
        res.json({ mensaje: 'Notificación marcada como leída' });
    } catch (err) {
        res.status(500).json({ error: 'Error' });
    }
});

/**

/**
 * GET /api/tareas/:id
 */
router.get('/:id', verificarToken, async (req, res) => {
    try {
        const tarea = await db.get(`
            SELECT t.*,
                   emp.nombre as nombre_empleado,
                   sup.nombre as nombre_supervisor,
                   cre.nombre as nombre_creador,
                   tt.nombre as nombre_tipo,
                   st.hora_inicio as tiempo_inicio,
                   st.hora_fin as tiempo_fin,
                   st.tiempo_real_segundos,
                   st.lat_inicio, st.lng_inicio, st.lat_fin, st.lng_fin,
                   st.id_seguimiento
            FROM tareas t
            LEFT JOIN usuarios emp ON t.id_empleado = emp.id_usuario
            LEFT JOIN usuarios sup ON t.id_supervisor = sup.id_usuario
            LEFT JOIN usuarios cre ON t.id_creador = cre.id_usuario
            LEFT JOIN tipos_tarea tt ON t.id_tipo = tt.id_tipo
            LEFT JOIN seguimiento_tiempo st ON t.id_tarea = st.id_tarea
            WHERE t.id_tarea = ? AND t.eliminado = 0
        `, req.params.id);

        if (!tarea) return res.status(404).json({ error: 'Tarea no encontrada' });
        if (req.usuario.rol !== 'ROOT' && req.usuario.id_empresa !== tarea.id_empresa) {
            return res.status(403).json({ error: 'Sin acceso' });
        }

        const historial = await db.all(`
            SELECT h.*, u.nombre as nombre_usuario
            FROM historial_estados_tarea h LEFT JOIN usuarios u ON h.id_usuario = u.id_usuario
            WHERE h.id_tarea = ? ORDER BY h.fecha DESC
        `, req.params.id);

        // ══════════════════════════════════════════════════════
        // CRÍTICO: Usar cliente dedicado con search_path explícito
        // El pool puede tener conexiones sin el schema correcto,
        // lo que causa que evidencias y comentarios no se encuentren.
        // ══════════════════════════════════════════════════════
        let evidencias = [], comentarios = [];
        const { isPostgres } = require('../database/init');
        if (isPostgres && db.pool) {
            const client = await db.pool.connect();
            try {
                await client.query('SET search_path TO gestion_laboral, public');
                const evRes = await client.query(
                    'SELECT id_evidencia, id_tarea, tipo, fecha_registro FROM evidencias_tarea WHERE id_tarea = $1 ORDER BY fecha_registro DESC',
                    [req.params.id]
                );
                evidencias = evRes.rows;
                const comRes = await client.query(
                    `SELECT c.*, u.nombre as nombre_usuario, u.rol as rol_usuario
                     FROM comentarios_tarea c JOIN usuarios u ON c.id_usuario = u.id_usuario
                     WHERE c.id_tarea = $1 ORDER BY c.fecha ASC`,
                    [req.params.id]
                );
                comentarios = comRes.rows;
                console.log(`📊 [PG direct] Tarea ${req.params.id}: ${evidencias.length} evidencias, ${comentarios.length} comentarios`);
            } finally {
                client.release();
            }
        } else {
            evidencias = await db.all('SELECT id_evidencia, id_tarea, tipo, fecha_registro FROM evidencias_tarea WHERE id_tarea = ? ORDER BY fecha_registro DESC', req.params.id);
            comentarios = await db.all(`
                SELECT c.*, u.nombre as nombre_usuario, u.rol as rol_usuario
                FROM comentarios_tarea c JOIN usuarios u ON c.id_usuario = u.id_usuario
                WHERE c.id_tarea = ? ORDER BY c.fecha ASC
            `, req.params.id);
            console.log(`📊 [SQLite] Tarea ${req.params.id}: ${evidencias.length} evidencias, ${comentarios.length} comentarios`);
        }

        res.json({ ...tarea, historial, evidencias, comentarios });
    } catch (err) {
        console.error('❌ Error obteniendo tarea detalle:', err);
        res.status(500).json({ error: 'Error al obtener tarea' });
    }
});

// ═══════════════════════════════════════════
// FLUJO DE ESTADOS
// ═══════════════════════════════════════════

/**
 * PUT /api/tareas/:id/iniciar
 */
router.put('/:id/iniciar', verificarToken, async (req, res) => {
    try {
        const tarea = await db.get('SELECT * FROM tareas WHERE id_tarea = ? AND eliminado = 0', req.params.id);
        if (!tarea) return res.status(404).json({ error: 'Tarea no encontrada' });
        if (tarea.estado !== 'pendiente') return res.status(400).json({ error: 'Solo se pueden iniciar tareas pendientes' });

        const ahora = new Date().toISOString();
        const { lat, lng } = req.body || {};

        await db.run(`UPDATE tareas SET estado = 'en_proceso', fecha_inicio = ? WHERE id_tarea = ?`, ahora, req.params.id);
        await db.run(`UPDATE seguimiento_tiempo SET hora_inicio = ?, lat_inicio = ?, lng_inicio = ? WHERE id_tarea = ?`, ahora, lat || null, lng || null, req.params.id);
        await db.run(`INSERT INTO historial_estados_tarea (id_tarea, estado_anterior, estado_nuevo, id_usuario, comentario) VALUES (?, 'pendiente', 'en_proceso', ?, 'Tarea iniciada')`, req.params.id, req.usuario.id_usuario);

        const io = req.app.get('io');
        if (io) {
            io.to(`empresa_${tarea.id_empresa}`).emit('tarea_actualizada', {
                id_tarea: req.params.id, estado: 'en_proceso', fecha_inicio: ahora
            });
        }

        // Notificar al supervisor que su empleado inició la tarea
        if (tarea.id_supervisor && tarea.id_supervisor !== req.usuario.id_usuario) {
            await db.run(`INSERT INTO notificaciones (id_notificacion, id_usuario, titulo, mensaje, tipo) VALUES (?, ?, ?, ?, 'tarea_iniciada')`,
                uuidv4(), tarea.id_supervisor, '▶️ Tarea iniciada', `${req.usuario.nombre} inició la tarea: "${tarea.titulo}"`);
            if (io) io.to(`user_${tarea.id_supervisor}`).emit('notificacion', { titulo: '▶️ Tarea iniciada', mensaje: `${req.usuario.nombre} inició: "${tarea.titulo}"` });
        }

        registrarAuditoria(tarea.id_empresa, req.usuario.id_usuario, 'INICIAR_TAREA', `Tarea "${tarea.titulo}" iniciada`);
        res.json({ mensaje: 'Tarea iniciada', estado: 'en_proceso', fecha_inicio: ahora });
    } catch (err) {
        res.status(500).json({ error: 'Error al iniciar tarea' });
    }
});

/**
 * PUT /api/tareas/:id/finalizar
 */
router.put('/:id/finalizar', verificarToken, async (req, res) => {
    try {
        const tarea = await db.get('SELECT * FROM tareas WHERE id_tarea = ? AND eliminado = 0', req.params.id);
        if (!tarea) return res.status(404).json({ error: 'Tarea no encontrada' });
        if (tarea.estado !== 'en_proceso' && tarea.estado !== 'atrasada') {
            return res.status(400).json({ error: 'Solo se pueden finalizar tareas en proceso o atrasadas' });
        }

        // Validar si requiere evidencia de IMAGEN (compatible con PostgreSQL y SQLite)
        const reqEv = tarea.requiere_evidencia;
        if (reqEv && reqEv !== 0 && reqEv !== '0' && reqEv !== false) {
            const evidenciaCount = await db.get("SELECT COUNT(*) as total FROM evidencias_tarea WHERE id_tarea = ? AND tipo = 'imagen'", req.params.id);
            console.log(`🔍 Verificando evidencias para tarea ${req.params.id}: requiere_evidencia=${JSON.stringify(reqEv)}, imagenes_encontradas=${evidenciaCount ? evidenciaCount.total : 0}`);
            if (!evidenciaCount || evidenciaCount.total === 0) {
                return res.status(400).json({ 
                    error: 'Esta tarea requiere evidencias para finalizar',
                    reqEvidencia: true 
                });
            }
        }

        const ahora = new Date().toISOString();
        const { lat, lng } = req.body || {};

        const seguimiento = await db.get('SELECT * FROM seguimiento_tiempo WHERE id_tarea = ?', req.params.id);
        let tiempoRealSegundos = 0;
        if (seguimiento && seguimiento.hora_inicio) {
            tiempoRealSegundos = Math.round((new Date(ahora) - new Date(seguimiento.hora_inicio)) / 1000);
        }

        let estadoFinal = 'finalizada';
        if (tarea.tiempo_estimado_minutos) {
            const tiempoEstimadoSegundos = tarea.tiempo_estimado_minutos * 60;
            const config = await db.get('SELECT tolerancia_tiempo FROM configuraciones_empresa WHERE id_empresa = ?', tarea.id_empresa);
            const tolerancia = config ? config.tolerancia_tiempo : 10;
            const limiteSegundos = tiempoEstimadoSegundos * (1 + tolerancia / 100);
            if (tiempoRealSegundos > limiteSegundos) estadoFinal = 'finalizada_atrasada';
        }

        await db.run(`UPDATE tareas SET estado = ?, fecha_fin = ? WHERE id_tarea = ?`, estadoFinal, ahora, req.params.id);
        await db.run(`UPDATE seguimiento_tiempo SET hora_fin = ?, tiempo_real_segundos = ?, lat_fin = ?, lng_fin = ? WHERE id_tarea = ?`, ahora, tiempoRealSegundos, lat || null, lng || null, req.params.id);
        await db.run(`INSERT INTO historial_estados_tarea (id_tarea, estado_anterior, estado_nuevo, id_usuario, comentario) VALUES (?, ?, ?, ?, ?)`,
            req.params.id, tarea.estado, estadoFinal, req.usuario.id_usuario, `Tarea finalizada (${formatearTiempo(tiempoRealSegundos)})`);

        let puntos = estadoFinal === 'finalizada' ? 10 : 5;
        let motivo = estadoFinal === 'finalizada' ? 'TAREA_A_TIEMPO' : 'TAREA_ATRASADA';

        if (tarea.id_empleado) {
            await db.run(`INSERT INTO movimientos_puntos (id_usuario, id_tarea, puntos, motivo, descripcion) VALUES (?, ?, ?, ?, ?)`,
                tarea.id_empleado, req.params.id, puntos, motivo, `Tarea "${tarea.titulo}" ${estadoFinal === 'finalizada' ? 'a tiempo' : 'atrasada'}`);
        }

        const io = req.app.get('io');

        // Notificar al supervisor (si un empleado completó la tarea)
        if (tarea.id_supervisor) {
            await db.run(`INSERT INTO notificaciones (id_notificacion, id_usuario, titulo, mensaje, tipo) VALUES (?, ?, ?, ?, 'tarea_finalizada')`,
                uuidv4(), tarea.id_supervisor, '✅ Tarea finalizada', `La tarea "${tarea.titulo}" fue completada ${estadoFinal === 'finalizada' ? 'a tiempo ✅' : 'con retraso ⚠️'}`);
            if (io) io.to(`user_${tarea.id_supervisor}`).emit('notificacion', { titulo: '✅ Tarea finalizada', mensaje: `"${tarea.titulo}" completada` });
        }

        // Notificar al admin (toda tarea completada sube al admin)
        const admins = await db.all('SELECT id_usuario FROM usuarios WHERE id_empresa = ? AND rol = ? AND estado = 1', tarea.id_empresa, 'ADMIN');
        for (const admin of admins) {
            await db.run(`INSERT INTO notificaciones (id_notificacion, id_usuario, titulo, mensaje, tipo) VALUES (?, ?, ?, ?, 'tarea_finalizada')`,
                uuidv4(), admin.id_usuario, '✅ Tarea completada', `"${tarea.titulo}" finalizada por ${req.usuario.nombre}`);
            if (io) io.to(`user_${admin.id_usuario}`).emit('notificacion', { titulo: '✅ Tarea completada', mensaje: `"${tarea.titulo}" por ${req.usuario.nombre}` });
        }

        if (io) {
            io.to(`empresa_${tarea.id_empresa}`).emit('tarea_actualizada', {
                id_tarea: req.params.id, estado: estadoFinal, fecha_fin: ahora, tiempo_real_segundos: tiempoRealSegundos
            });
        }

        registrarAuditoria(tarea.id_empresa, req.usuario.id_usuario, 'FINALIZAR_TAREA', `Tarea "${tarea.titulo}" finalizada (${estadoFinal})`);

        res.json({
            mensaje: 'Tarea finalizada', estado: estadoFinal,
            tiempo_real_segundos: tiempoRealSegundos, tiempo_formateado: formatearTiempo(tiempoRealSegundos),
            puntos_ganados: puntos
        });
    } catch (err) {
        console.error('Error finalizando tarea:', err);
        res.status(500).json({ error: 'Error al finalizar tarea' });
    }
});

/**
 * PUT /api/tareas/:id
 */
router.put('/:id', verificarToken, verificarRol('ADMIN', 'SUPERVISOR', 'GERENTE'), async (req, res) => {
    try {
        const tarea = await db.get('SELECT * FROM tareas WHERE id_tarea = ? AND eliminado = 0', req.params.id);
        if (!tarea) return res.status(404).json({ error: 'Tarea no encontrada' });

        if (req.usuario.rol === 'SUPERVISOR') {
            const config = await db.get('SELECT supervisor_puede_modificar FROM configuraciones_empresa WHERE id_empresa = ?', req.usuario.id_empresa);
            if (config && config.supervisor_puede_modificar === 0) {
                return res.status(403).json({ error: 'Como supervisor solo tienes permisos de lectura para modificar los detalles de la tarea' });
            }
        }

        const { titulo, descripcion, id_empleado, id_supervisor, id_tipo, prioridad, tiempo_estimado_minutos } = req.body;

        await db.run(`
            UPDATE tareas SET
                titulo = COALESCE(?, titulo), descripcion = COALESCE(?, descripcion),
                id_empleado = COALESCE(?, id_empleado), id_supervisor = COALESCE(?, id_supervisor),
                id_tipo = COALESCE(?, id_tipo), prioridad = COALESCE(?, prioridad),
                tiempo_estimado_minutos = COALESCE(?, tiempo_estimado_minutos)
            WHERE id_tarea = ?
        `, titulo, descripcion, id_empleado, id_supervisor, id_tipo, prioridad, tiempo_estimado_minutos, req.params.id);

        registrarAuditoria(tarea.id_empresa, req.usuario.id_usuario, 'EDITAR_TAREA', `Tarea "${tarea.titulo}" editada`);
        const actualizada = await db.get('SELECT * FROM tareas WHERE id_tarea = ?', req.params.id);
        res.json({ mensaje: 'Tarea actualizada', tarea: actualizada });
    } catch (err) {
        res.status(500).json({ error: 'Error al actualizar tarea' });
    }
});

/**
 * DELETE /api/tareas/:id
 */
router.delete('/:id', verificarToken, verificarRol('ADMIN', 'SUPERVISOR', 'GERENTE'), async (req, res) => {
    try {
        const tarea = await db.get('SELECT * FROM tareas WHERE id_tarea = ? AND eliminado = 0', req.params.id);
        if (!tarea) return res.status(404).json({ error: 'Tarea no encontrada' });

        if (req.usuario.rol === 'SUPERVISOR') {
            const config = await db.get('SELECT supervisor_puede_modificar FROM configuraciones_empresa WHERE id_empresa = ?', req.usuario.id_empresa);
            if (config && config.supervisor_puede_modificar === 0) {
                return res.status(403).json({ error: 'Como supervisor solo tienes permisos de lectura y no puedes eliminar tareas' });
            }
        }
        await db.run('UPDATE tareas SET eliminado = 1 WHERE id_tarea = ?', req.params.id);
        registrarAuditoria(tarea.id_empresa, req.usuario.id_usuario, 'ELIMINAR_TAREA', `Tarea "${tarea.titulo}" eliminada`);
        res.json({ mensaje: 'Tarea eliminada' });
    } catch (err) {
        res.status(500).json({ error: 'Error al eliminar tarea' });
    }
});

// ═══════════════════════════════════════════
// COMENTARIOS
// ═══════════════════════════════════════════

router.post('/:id/comentarios', verificarToken, async (req, res) => {
    try {
        const { contenido } = req.body;
        if (!contenido) return res.status(400).json({ error: 'Contenido requerido' });
        const tarea = await db.get('SELECT * FROM tareas WHERE id_tarea = ? AND eliminado = 0', req.params.id);
        if (!tarea) return res.status(404).json({ error: 'Tarea no encontrada' });

        await db.run(`INSERT INTO comentarios_tarea (id_tarea, id_usuario, contenido) VALUES (?, ?, ?)`,
            req.params.id, req.usuario.id_usuario, contenido);

        const io = req.app.get('io');
        if (io) {
            io.to(`empresa_${tarea.id_empresa}`).emit('nuevo_comentario', {
                id_tarea: req.params.id, usuario: req.usuario.nombre, contenido
            });
        }
        res.status(201).json({ mensaje: 'Comentario agregado' });
    } catch (err) {
        res.status(500).json({ error: 'Error al agregar comentario' });
    }
});

// ═══════════════════════════════════════════
// EVIDENCIAS
// ═══════════════════════════════════════════

const { uploadEvidencia, setUploadTipo } = require('../middleware/uploads');

router.post('/:id/evidencias', verificarToken, setUploadTipo('evidencias'), uploadEvidencia.single('archivo'), async (req, res) => {
    try {
        const tipo = req.body.tipo || (req.file ? 'imagen' : 'texto');
        let contenido = req.body.contenido || '';
        
        // Convertir archivo a base64 para persistir en la BD (Render pierde archivos en disco)
        if (req.file) {
            const fs = require('fs');
            const filePath = req.file.path;
            const fileBuffer = fs.readFileSync(filePath);
            const base64 = fileBuffer.toString('base64');
            const mimeType = req.file.mimetype || 'image/jpeg';
            contenido = `data:${mimeType};base64,${base64}`;
            // Eliminar archivo temporal del disco
            try { fs.unlinkSync(filePath); } catch(e) {}
        }
        
        if (!contenido) return res.status(400).json({ error: 'Contenido o archivo requerido' });

        const tarea = await db.get('SELECT * FROM tareas WHERE id_tarea = ? AND eliminado = 0', req.params.id);
        if (!tarea) return res.status(404).json({ error: 'Tarea no encontrada' });

        const id_evidencia = uuidv4();
        await db.run(`INSERT INTO evidencias_tarea (id_evidencia, id_tarea, tipo, contenido) VALUES (?, ?, ?, ?)`,
            id_evidencia, req.params.id, tipo, contenido);

        const io = req.app.get('io');
        if (io) io.to(`empresa_${tarea.id_empresa}`).emit('nueva_evidencia', { id_tarea: req.params.id, tipo });
        res.status(201).json({ mensaje: 'Evidencia agregada', id_evidencia, tipo, contenido: contenido.substring(0, 50) + '...' });
    } catch (err) {
        console.error('Error subiendo evidencia:', err);
        res.status(500).json({ error: 'Error al agregar evidencia' });
    }
});

/**
 * POST /api/tareas/:id/evidencias/base64
 * Recibe imagen como base64 en JSON (sin depender de multer ni disco)
 * FIX: Asegura search_path correcto en PostgreSQL antes de INSERT
 */
router.post('/:id/evidencias/base64', verificarToken, async (req, res) => {
    try {
        const { tipo, contenido } = req.body;
        if (!contenido) return res.status(400).json({ error: 'Contenido base64 requerido' });

        const tarea = await db.get('SELECT * FROM tareas WHERE id_tarea = ? AND eliminado = 0', req.params.id);
        if (!tarea) return res.status(404).json({ error: 'Tarea no encontrada' });

        const id_evidencia = uuidv4();
        const tipoFinal = tipo || 'imagen';

        // ═══════════════════════════════════════════════════════
        // COMPRESIÓN SERVER-SIDE con sharp (segunda capa de seguridad)
        // Si el cliente ya comprimió, el resultado será igual de bueno.
        // Si por alguna razón llegó una imagen grande, aquí se recorta.
        // ═══════════════════════════════════════════════════════
        let contenidoFinal = contenido;
        if (tipoFinal === 'imagen' && contenido.startsWith('data:image')) {
            try {
                const sharp = require('sharp');
                // Extraer el buffer del base64
                const base64Data = contenido.replace(/^data:image\/\w+;base64,/, '');
                const buffer = Buffer.from(base64Data, 'base64');
                const originalKB = Math.round(buffer.length / 1024);

                const compressed = await sharp(buffer)
                    .resize({ width: 800, height: 800, fit: 'inside', withoutEnlargement: true })
                    .jpeg({ quality: 60 })
                    .toBuffer();

                const compressedKB = Math.round(compressed.length / 1024);
                contenidoFinal = 'data:image/jpeg;base64,' + compressed.toString('base64');
                console.log(`🖼️ Sharp: ${originalKB}KB → ${compressedKB}KB (-${Math.round((1 - compressedKB/originalKB)*100)}%)`);
            } catch (sharpErr) {
                // Sharp no disponible o error: usar contenido original del cliente
                console.log('⚠️ Sharp no disponible, usando compresión cliente:', sharpErr.message);
            }
        }

        // En PostgreSQL, asegurar schema correcto ANTES de insertar
        const { isPostgres } = require('../database/init');
        if (isPostgres && db.pool) {
            const client = await db.pool.connect();
            try {
                await client.query('SET search_path TO gestion_laboral, public');
                await client.query(
                    'INSERT INTO evidencias_tarea (id_evidencia, id_tarea, tipo, contenido) VALUES ($1, $2, $3, $4)',
                    [id_evidencia, req.params.id, tipoFinal, contenidoFinal]
                );
                const check = await client.query(
                    'SELECT COUNT(*) as total FROM evidencias_tarea WHERE id_evidencia = $1',
                    [id_evidencia]
                );
                const cuenta = check.rows[0] ? parseInt(check.rows[0].total) : 0;
                console.log(`✅ Evidencia guardada (PG): ${id_evidencia} | tarea: ${req.params.id} | size: ${contenidoFinal.length} chars | ok: ${cuenta > 0}`);
            } finally {
                client.release();
            }
        } else {
            await db.run(`INSERT INTO evidencias_tarea (id_evidencia, id_tarea, tipo, contenido) VALUES (?, ?, ?, ?)`,
                id_evidencia, req.params.id, tipoFinal, contenidoFinal);
            console.log(`✅ Evidencia guardada (SQLite): ${id_evidencia} (${contenidoFinal.length} chars)`);
        }

        const io = req.app.get('io');
        if (io) io.to(`empresa_${tarea.id_empresa}`).emit('nueva_evidencia', { id_tarea: req.params.id, tipo: tipoFinal });
        res.status(201).json({ mensaje: 'Evidencia agregada', id_evidencia });
    } catch (err) {
        console.error('❌ Error guardando evidencia base64:', err);
        res.status(500).json({ error: 'Error al agregar evidencia: ' + err.message });
    }
});

/**
 * GET /api/tareas/:id/evidencias/:idEv
 * Retorna el contenido (base64) de UNA evidencia individual (lazy load)
 */
router.get('/:id/evidencias/:idEv', verificarToken, async (req, res) => {
    try {
        let evidencia = null;
        const { isPostgres } = require('../database/init');
        if (isPostgres && db.pool) {
            const client = await db.pool.connect();
            try {
                await client.query('SET search_path TO gestion_laboral, public');
                const result = await client.query(
                    'SELECT * FROM evidencias_tarea WHERE id_evidencia = $1 AND id_tarea = $2',
                    [req.params.idEv, req.params.id]
                );
                evidencia = result.rows[0] || null;
            } finally {
                client.release();
            }
        } else {
            evidencia = await db.get('SELECT * FROM evidencias_tarea WHERE id_evidencia = ? AND id_tarea = ?', req.params.idEv, req.params.id);
        }
        if (!evidencia) return res.status(404).json({ error: 'Evidencia no encontrada' });
        res.json(evidencia);
    } catch (err) {
        console.error('Error obteniendo evidencia:', err);
        res.status(500).json({ error: 'Error al obtener evidencia' });
    }
});
// (Moved: tipos, notificaciones routes are now before /:id)

// ═══════════════════════════════════════════
// UTILIDADES
// ═══════════════════════════════════════════

function formatearTiempo(segundos) {
    const h = Math.floor(segundos / 3600);
    const m = Math.floor((segundos % 3600) / 60);
    const s = segundos % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

// ═══════════════════════════════════════════
// CLIENTES Y OBSERVACIONES
// ═══════════════════════════════════════════

/**
 * GET /api/tareas/clientes/buscar?q=texto
 * Busca clientes existentes en la empresa para evitar duplicados
 */
router.get('/clientes/buscar', verificarToken, async (req, res) => {
    try {
        const q = (req.query.q || '').trim();
        if (!q) return res.json([]);
        const clientes = await db.all(
            `SELECT DISTINCT codigo_cliente, nombre_cliente, telefono_cliente, correo_cliente
             FROM tareas
             WHERE id_empresa = ? AND tiene_cliente = 1 AND nombre_cliente IS NOT NULL
               AND LOWER(nombre_cliente) LIKE LOWER(?)
             ORDER BY nombre_cliente LIMIT 10`,
            req.usuario.id_empresa, `%${q}%`
        );
        res.json(clientes);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * PUT /api/tareas/:id/cliente-concluido
 * Marca el evento con el cliente como concluido (no finaliza la tarea)
 */
router.put('/:id/cliente-concluido', verificarToken, async (req, res) => {
    try {
        const tarea = await db.get('SELECT * FROM tareas WHERE id_tarea = ? AND eliminado = 0', req.params.id);
        if (!tarea) return res.status(404).json({ error: 'Tarea no encontrada' });
        await db.run('UPDATE tareas SET cliente_concluido = 1 WHERE id_tarea = ?', req.params.id);
        await db.run(
            `INSERT INTO historial_estados_tarea (id_tarea, estado_anterior, estado_nuevo, id_usuario, comentario)
             VALUES (?, ?, ?, ?, 'Evento con cliente concluido')`,
            req.params.id, tarea.estado, tarea.estado, req.usuario.id_usuario
        );
        registrarAuditoria(tarea.id_empresa, req.usuario.id_usuario, 'CLIENTE_CONCLUIDO', `Cliente ${tarea.nombre_cliente} atendido en tarea "${tarea.titulo}"`);
        res.json({ mensaje: 'Evento con cliente marcado como concluido' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * PUT /api/tareas/:id/observaciones
 * El empleado guarda sus observaciones sobre la tarea
 */
router.put('/:id/observaciones', verificarToken, async (req, res) => {
    try {
        const { observaciones_tarea } = req.body;
        const tarea = await db.get('SELECT * FROM tareas WHERE id_tarea = ? AND eliminado = 0', req.params.id);
        if (!tarea) return res.status(404).json({ error: 'Tarea no encontrada' });
        // Solo el empleado asignado puede editar observaciones
        if (tarea.id_empleado !== req.usuario.id_usuario && req.usuario.rol !== 'ADMIN') {
            return res.status(403).json({ error: 'Solo el empleado asignado puede editar las observaciones' });
        }
        await db.run('UPDATE tareas SET observaciones_tarea = ? WHERE id_tarea = ?', observaciones_tarea || '', req.params.id);
        res.json({ mensaje: 'Observaciones guardadas' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * PUT /api/tareas/:id/notas
 * El empleado guarda texto/notas adicionales sobre la tarea
 */
router.put('/:id/notas', verificarToken, async (req, res) => {
    try {
        const { notas_empleado } = req.body;
        const tarea = await db.get('SELECT * FROM tareas WHERE id_tarea = ? AND eliminado = 0', req.params.id);
        if (!tarea) return res.status(404).json({ error: 'Tarea no encontrada' });
        if (tarea.id_empleado !== req.usuario.id_usuario && req.usuario.rol !== 'ADMIN') {
            return res.status(403).json({ error: 'Solo el empleado asignado puede agregar notas' });
        }
        await db.run('UPDATE tareas SET notas_empleado = ? WHERE id_tarea = ?', notas_empleado || '', req.params.id);
        res.json({ mensaje: 'Notas guardadas' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * PUT /api/tareas/:id/seguimiento-cliente
 * Actualiza datos del cliente (obs, fecha seguimiento) y si se pone fecha,
 * crea automáticamente una nueva tarea programada para ese día.
 */
router.put('/:id/seguimiento-cliente', verificarToken, async (req, res) => {
    try {
        const { obs_cliente, fecha_seguimiento, nombre_cliente, codigo_cliente, telefono_cliente, correo_cliente } = req.body;
        const tarea = await db.get('SELECT * FROM tareas WHERE id_tarea = ? AND eliminado = 0', req.params.id);
        if (!tarea) return res.status(404).json({ error: 'Tarea no encontrada' });

        // Merge: usar los nuevos valores si vienen, si no conservar los existentes
        const nuevoNombre = nombre_cliente !== undefined ? nombre_cliente : tarea.nombre_cliente;
        const nuevoCodigo = codigo_cliente !== undefined ? codigo_cliente : tarea.codigo_cliente;
        const nuevoTel = telefono_cliente !== undefined ? telefono_cliente : tarea.telefono_cliente;
        const nuevoCorreo = correo_cliente !== undefined ? correo_cliente : tarea.correo_cliente;
        const nuevaObs = obs_cliente !== undefined ? obs_cliente : tarea.obs_cliente;
        const nuevaFecha = fecha_seguimiento !== undefined ? (fecha_seguimiento || null) : (tarea.fecha_seguimiento || null);

        // Si se registra cliente por primera vez, activar tiene_cliente = 1
        const activarCliente = nuevoNombre ? 1 : tarea.tiene_cliente;

        await db.run(
            `UPDATE tareas SET tiene_cliente = ?, nombre_cliente = ?, codigo_cliente = ?,
             telefono_cliente = ?, correo_cliente = ?, obs_cliente = ?, fecha_seguimiento = ?
             WHERE id_tarea = ?`,
            activarCliente, nuevoNombre || null, nuevoCodigo || null,
            nuevoTel || null, nuevoCorreo || null, nuevaObs || null, nuevaFecha, req.params.id
        );

        let nuevaTareaId = null;
        // Si hay fecha de seguimiento nueva y hay cliente → crear nueva tarea programada
        if (fecha_seguimiento && nuevoNombre && fecha_seguimiento !== tarea.fecha_seguimiento) {
            const { v4: uuidv4Local } = require('uuid');
            nuevaTareaId = uuidv4Local();
            const codigo_tarea = await generarCodigoTarea(req.usuario.id_empresa);
            const tituloSeguimiento = `Seguimiento cliente: ${nuevoNombre}`;
            await db.run(
                `INSERT INTO tareas (id_tarea, id_empresa, codigo_tarea, titulo, descripcion, id_empleado, id_supervisor, id_creador, prioridad, estado, fecha_creacion,
                    tiene_cliente, codigo_cliente, nombre_cliente, telefono_cliente, correo_cliente)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendiente', ?, 1, ?, ?, ?, ?)`,
                nuevaTareaId, req.usuario.id_empresa, codigo_tarea, tituloSeguimiento,
                `Seguimiento programado para cliente ${nuevoNombre} a partir de la tarea "${tarea.titulo}"`,
                tarea.id_empleado, tarea.id_supervisor, req.usuario.id_usuario,
                tarea.prioridad || 'media', new Date().toISOString(),
                nuevoCodigo, nuevoNombre, nuevoTel, nuevoCorreo
            );
            await db.run(`INSERT INTO seguimiento_tiempo (id_seguimiento, id_tarea) VALUES (?, ?)`, uuidv4Local(), nuevaTareaId);
            if (tarea.id_empleado) {
                await db.run(
                    `INSERT INTO notificaciones (id_notificacion, id_usuario, titulo, mensaje, tipo) VALUES (?, ?, ?, ?, 'nueva_tarea')`,
                    uuidv4Local(), tarea.id_empleado,
                    '📋 Seguimiento de cliente programado',
                    `Se generó una nueva tarea: "${tituloSeguimiento}" para el ${fecha_seguimiento}`
                );
            }
        }

        res.json({ mensaje: 'Seguimiento actualizado', nueva_tarea_id: nuevaTareaId });
    } catch (err) {
        console.error('Error seguimiento cliente:', err);
        res.status(500).json({ error: err.message });
    }
});

// (Moved: historial and limpiar routes are now before /:id)

module.exports = router;
