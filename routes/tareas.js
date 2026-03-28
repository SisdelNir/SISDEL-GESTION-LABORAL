const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { db } = require('../database/init');
const { verificarToken, verificarRol, registrarAuditoria } = require('../middleware/auth');

// ═══════════════════════════════════════════
// CRUD DE TAREAS
// ═══════════════════════════════════════════

/**
 * POST /api/tareas
 */
router.post('/', verificarToken, verificarRol('ADMIN', 'SUPERVISOR'), async (req, res) => {
    try {
        const { titulo, descripcion, id_empleado, id_supervisor, id_tipo, prioridad, tiempo_estimado_minutos, requiere_evidencia } = req.body;
        if (!titulo) return res.status(400).json({ error: 'El título es requerido' });

        const id_empresa = req.usuario.id_empresa;
        const id_tarea = uuidv4();
        const id_creador = req.usuario.id_usuario;
        
        let supervisorFinal = id_supervisor || (req.usuario.rol === 'SUPERVISOR' ? req.usuario.id_usuario : null);

        // Auto-asignación de supervisor: si hay empleado, buscar su supervisor asignado en la BD
        if (id_empleado) {
            const rel = await db.get('SELECT id_supervisor FROM supervisores_empleados WHERE id_empleado = ?', id_empleado);
            if (rel && rel.id_supervisor) {
                supervisorFinal = rel.id_supervisor;
            }
        }

        // Verificar config de empresa: ¿el empleado puede presionar botón iniciar?
        const config = await db.get('SELECT empleado_puede_iniciar FROM configuraciones_empresa WHERE id_empresa = ?', id_empresa);
        const empPuedeIniciar = config ? config.empleado_puede_iniciar : 1;

        // Si empleado puede iniciar → tarea queda pendiente para que él la inicie
        // Si NO puede iniciar → tarea arranca automáticamente en en_proceso
        let estadoInicial, fechaInic;
        if (id_empleado) {
            if (empPuedeIniciar) {
                estadoInicial = 'pendiente';
                fechaInic = null;
            } else {
                estadoInicial = 'en_proceso';
                fechaInic = new Date().toISOString();
            }
        } else {
            estadoInicial = 'pendiente';
            fechaInic = null;
        }

        const reqEvidenciaNum = requiere_evidencia ? 1 : 0;

        await db.run(`
            INSERT INTO tareas (id_tarea, id_empresa, titulo, descripcion, id_empleado, id_supervisor, id_creador, id_tipo, prioridad, tiempo_estimado_minutos, requiere_evidencia, estado, fecha_inicio)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, id_tarea, id_empresa, titulo, descripcion || '', id_empleado || null, supervisorFinal, id_creador, id_tipo || null, prioridad || 'media', tiempo_estimado_minutos || null, reqEvidenciaNum, estadoInicial, fechaInic);

        await db.run(`
            INSERT INTO historial_estados_tarea (id_tarea, estado_nuevo, id_usuario, comentario)
            VALUES (?, 'pendiente', ?, 'Tarea creada')
        `, id_tarea, id_creador);

        if (estadoInicial === 'en_proceso' && fechaInic) {
            await db.run(`INSERT INTO seguimiento_tiempo (id_seguimiento, id_tarea, hora_inicio) VALUES (?, ?, ?)`, uuidv4(), id_tarea, fechaInic);
        } else {
            await db.run(`INSERT INTO seguimiento_tiempo (id_seguimiento, id_tarea) VALUES (?, ?)`, uuidv4(), id_tarea);
        }

        if (id_empleado) {
            await db.run(`
                INSERT INTO notificaciones (id_notificacion, id_usuario, titulo, mensaje, tipo)
                VALUES (?, ?, ?, ?, 'nueva_tarea')
            `, uuidv4(), id_empleado, '📋 Nueva tarea asignada', `Se te asignó la tarea: "${titulo}"`);
        }

        const io = req.app.get('io');
        if (io) {
            io.to(`empresa_${id_empresa}`).emit('nueva_tarea', {
                id_tarea, titulo, id_empleado, prioridad,
                estado: estadoInicial, fecha_creacion: ahoraDate
            });
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
            query += ' AND (t.id_supervisor = ? OR t.id_creador = ?)';
            params.push(req.usuario.id_usuario, req.usuario.id_usuario);
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

        const total = await db.get('SELECT COUNT(*) as c FROM tareas WHERE id_empresa = ? AND eliminado = 0', id_empresa);
        const pendientes = await db.get('SELECT COUNT(*) as c FROM tareas WHERE id_empresa = ? AND estado = ? AND eliminado = 0', id_empresa, 'pendiente');
        const en_proceso = await db.get('SELECT COUNT(*) as c FROM tareas WHERE id_empresa = ? AND estado = ? AND eliminado = 0', id_empresa, 'en_proceso');
        const finalizadas = await db.get('SELECT COUNT(*) as c FROM tareas WHERE id_empresa = ? AND estado IN (?,?) AND eliminado = 0', id_empresa, 'finalizada', 'finalizada_atrasada');
        const atrasadas = await db.get('SELECT COUNT(*) as c FROM tareas WHERE id_empresa = ? AND estado = ? AND eliminado = 0', id_empresa, 'atrasada');
        const finAtiempo = await db.get('SELECT COUNT(*) as c FROM tareas WHERE id_empresa = ? AND estado = ? AND eliminado = 0', id_empresa, 'finalizada');
        const urgentes = await db.get('SELECT COUNT(*) as c FROM tareas WHERE id_empresa = ? AND prioridad = ? AND estado NOT IN (?,?) AND eliminado = 0', id_empresa, 'urgente', 'finalizada', 'finalizada_atrasada');

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
 * GET /api/tareas/historial — Historial completo de tareas (Admin)
 * IMPORTANTE: debe estar ANTES de /:id
 */
router.get('/historial', verificarToken, verificarRol('ADMIN'), async (req, res) => {
    try {
        const { desde, hasta } = req.query;
        let query = `
            SELECT t.*,
                ue.nombre AS nombre_empleado,
                ue.codigo_acceso AS codigo_empleado,
                ue.telefono AS telefono_empleado,
                us.nombre AS nombre_supervisor,
                uc.nombre AS nombre_creador,
                (SELECT hora_inicio FROM seguimiento_tiempo WHERE id_tarea = t.id_tarea ORDER BY hora_inicio ASC LIMIT 1) AS hora_inicio_real,
                (SELECT hora_fin FROM seguimiento_tiempo WHERE id_tarea = t.id_tarea AND hora_fin IS NOT NULL ORDER BY hora_fin DESC LIMIT 1) AS hora_fin_real,
                (SELECT SUM(COALESCE(duracion_segundos, tiempo_real_segundos, 0)) FROM seguimiento_tiempo WHERE id_tarea = t.id_tarea) AS tiempo_total_segundos,
                (SELECT COUNT(*) FROM evidencias_tarea WHERE id_tarea = t.id_tarea) AS total_evidencias
            FROM tareas t
            LEFT JOIN usuarios ue ON t.id_empleado = ue.id_usuario
            LEFT JOIN usuarios us ON t.id_supervisor = us.id_usuario
            LEFT JOIN usuarios uc ON t.id_creador = uc.id_usuario
            WHERE t.id_empresa = ?
              AND t.estado IN ('finalizada', 'finalizada_atrasada', 'cancelada')
        `;
        const params = [req.usuario.id_empresa];

        if (desde) { query += ' AND t.fecha_creacion >= ?'; params.push(desde); }
        if (hasta) { query += ' AND t.fecha_creacion <= ?'; params.push(hasta + ' 23:59:59'); }

        query += ' ORDER BY t.fecha_creacion DESC';

        const tareas = await db.all(query, ...params);
        res.json(tareas);
    } catch (err) {
        console.error('Error historial:', err);
        res.status(500).json({ error: 'Error al obtener historial' });
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
 * DELETE /api/tareas/limpiar — Eliminar TODAS las tareas de la empresa (Admin)
 * IMPORTANTE: debe estar ANTES de /:id
 */
router.delete('/limpiar', verificarToken, verificarRol('ADMIN'), async (req, res) => {
    try {
        const id_empresa = req.usuario.id_empresa;
        const tareas = await db.all('SELECT id_tarea FROM tareas WHERE id_empresa = ?', id_empresa);
        const ids = tareas.map(t => t.id_tarea);
        
        if (ids.length === 0) {
            return res.json({ mensaje: 'No hay tareas que eliminar', eliminadas: 0 });
        }
        
        for (const id of ids) {
            await db.run('DELETE FROM seguimiento_tiempo WHERE id_tarea = ?', id);
            await db.run('DELETE FROM evidencias_tarea WHERE id_tarea = ?', id);
            await db.run('DELETE FROM comentarios_tarea WHERE id_tarea = ?', id);
            await db.run('DELETE FROM historial_estados_tarea WHERE id_tarea = ?', id);
            await db.run('DELETE FROM movimientos_puntos WHERE id_tarea = ?', id);
        }
        
        await db.run('DELETE FROM tareas WHERE id_empresa = ?', id_empresa);
        await db.run("DELETE FROM notificaciones WHERE id_usuario IN (SELECT id_usuario FROM usuarios WHERE id_empresa = ?) AND tipo IN ('nueva_tarea', 'tarea_finalizada')", id_empresa);
        
        registrarAuditoria(id_empresa, req.usuario.id_usuario, 'LIMPIAR_TAREAS', `Se eliminaron ${ids.length} tareas y datos relacionados`);
        res.json({ mensaje: `Se eliminaron ${ids.length} tareas exitosamente`, eliminadas: ids.length });
    } catch (err) {
        console.error('Error limpiando tareas:', err);
        res.status(500).json({ error: 'Error al limpiar tareas: ' + err.message });
    }
});

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

        const evidencias = await db.all('SELECT * FROM evidencias_tarea WHERE id_tarea = ? ORDER BY fecha_registro DESC', req.params.id);

        const comentarios = await db.all(`
            SELECT c.*, u.nombre as nombre_usuario, u.rol as rol_usuario
            FROM comentarios_tarea c JOIN usuarios u ON c.id_usuario = u.id_usuario
            WHERE c.id_tarea = ? ORDER BY c.fecha ASC
        `, req.params.id);

        res.json({ ...tarea, historial, evidencias, comentarios });
    } catch (err) {
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

        // Validar si requiere evidencia
        if (tarea.requiere_evidencia === 1 || tarea.requiere_evidencia === '1' || tarea.requiere_evidencia === true) {
            const evidenciaCount = await db.get('SELECT COUNT(*) as total FROM evidencias_tarea WHERE id_tarea = ?', req.params.id);
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

        if (tarea.id_supervisor) {
            await db.run(`INSERT INTO notificaciones (id_notificacion, id_usuario, titulo, mensaje, tipo) VALUES (?, ?, ?, ?, 'tarea_finalizada')`,
                uuidv4(), tarea.id_supervisor, '✅ Tarea finalizada', `La tarea "${tarea.titulo}" fue finalizada`);
        }

        const io = req.app.get('io');
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
router.put('/:id', verificarToken, verificarRol('ADMIN', 'SUPERVISOR'), async (req, res) => {
    try {
        const tarea = await db.get('SELECT * FROM tareas WHERE id_tarea = ? AND eliminado = 0', req.params.id);
        if (!tarea) return res.status(404).json({ error: 'Tarea no encontrada' });

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
router.delete('/:id', verificarToken, verificarRol('ADMIN', 'SUPERVISOR'), async (req, res) => {
    try {
        const tarea = await db.get('SELECT * FROM tareas WHERE id_tarea = ? AND eliminado = 0', req.params.id);
        if (!tarea) return res.status(404).json({ error: 'Tarea no encontrada' });
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
        if (req.file) contenido = `/uploads/evidencias/${req.file.filename}`;
        if (!contenido) return res.status(400).json({ error: 'Contenido o archivo requerido' });

        const tarea = await db.get('SELECT * FROM tareas WHERE id_tarea = ? AND eliminado = 0', req.params.id);
        if (!tarea) return res.status(404).json({ error: 'Tarea no encontrada' });

        const id_evidencia = uuidv4();
        await db.run(`INSERT INTO evidencias_tarea (id_evidencia, id_tarea, tipo, contenido) VALUES (?, ?, ?, ?)`,
            id_evidencia, req.params.id, tipo, contenido);

        const io = req.app.get('io');
        if (io) io.to(`empresa_${tarea.id_empresa}`).emit('nueva_evidencia', { id_tarea: req.params.id, tipo });
        res.status(201).json({ mensaje: 'Evidencia agregada', id_evidencia, tipo, contenido });
    } catch (err) {
        res.status(500).json({ error: 'Error al agregar evidencia' });
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

// (Moved: historial and limpiar routes are now before /:id)

module.exports = router;
