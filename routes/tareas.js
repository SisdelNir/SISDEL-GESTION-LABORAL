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
 * Crear nueva tarea
 */
router.post('/', verificarToken, verificarRol('ADMIN', 'SUPERVISOR'), (req, res) => {
    try {
        const {
            titulo, descripcion, id_empleado, id_supervisor,
            id_tipo, prioridad, tiempo_estimado_minutos
        } = req.body;

        if (!titulo) {
            return res.status(400).json({ error: 'El título es requerido' });
        }

        const id_empresa = req.usuario.id_empresa;
        const id_tarea = uuidv4();
        const id_creador = req.usuario.id_usuario;

        // Si es supervisor, asignarse como supervisor
        const supervisorFinal = id_supervisor || (req.usuario.rol === 'SUPERVISOR' ? req.usuario.id_usuario : null);

        db.prepare(`
            INSERT INTO tareas (id_tarea, id_empresa, titulo, descripcion, id_empleado, id_supervisor, id_creador, id_tipo, prioridad, tiempo_estimado_minutos)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id_tarea, id_empresa, titulo, descripcion || '', id_empleado || null, supervisorFinal, id_creador, id_tipo || null, prioridad || 'media', tiempo_estimado_minutos || null);

        // Registrar historial de estado
        db.prepare(`
            INSERT INTO historial_estados_tarea (id_tarea, estado_nuevo, id_usuario, comentario)
            VALUES (?, 'pendiente', ?, 'Tarea creada')
        `).run(id_tarea, id_creador);

        // Crear seguimiento de tiempo
        db.prepare(`
            INSERT INTO seguimiento_tiempo (id_seguimiento, id_tarea)
            VALUES (?, ?)
        `).run(uuidv4(), id_tarea);

        // Crear notificación para el empleado
        if (id_empleado) {
            db.prepare(`
                INSERT INTO notificaciones (id_notificacion, id_usuario, titulo, mensaje, tipo)
                VALUES (?, ?, ?, ?, 'nueva_tarea')
            `).run(uuidv4(), id_empleado, '📋 Nueva tarea asignada', `Se te asignó la tarea: "${titulo}"`, );
        }

        // Notificar por socket
        const io = req.app.get('io');
        if (io) {
            io.to(`empresa_${id_empresa}`).emit('nueva_tarea', {
                id_tarea, titulo, id_empleado, prioridad,
                estado: 'pendiente', fecha_creacion: new Date().toISOString()
            });
        }

        registrarAuditoria(id_empresa, id_creador, 'CREAR_TAREA', `Tarea "${titulo}" creada`);

        const tareaCreada = db.prepare('SELECT * FROM tareas WHERE id_tarea = ?').get(id_tarea);
        res.status(201).json({ mensaje: 'Tarea creada exitosamente', tarea: tareaCreada });
    } catch (err) {
        console.error('Error creando tarea:', err);
        res.status(500).json({ error: 'Error al crear la tarea: ' + err.message });
    }
});

/**
 * GET /api/tareas
 * Listar tareas (filtradas por rol y empresa)
 */
router.get('/', verificarToken, (req, res) => {
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
                   st.hora_inicio as tiempo_inicio,
                   st.hora_fin as tiempo_fin,
                   st.tiempo_real_segundos,
                   st.lat_inicio, st.lng_inicio, st.lat_fin, st.lng_fin,
                   (SELECT COUNT(*) FROM evidencias_tarea WHERE id_tarea = t.id_tarea) as total_evidencias,
                   (SELECT COUNT(*) FROM comentarios_tarea WHERE id_tarea = t.id_tarea) as total_comentarios
            FROM tareas t
            LEFT JOIN usuarios emp ON t.id_empleado = emp.id_usuario
            LEFT JOIN usuarios sup ON t.id_supervisor = sup.id_usuario
            LEFT JOIN usuarios cre ON t.id_creador = cre.id_usuario
            LEFT JOIN tipos_tarea tt ON t.id_tipo = tt.id_tipo
            LEFT JOIN seguimiento_tiempo st ON t.id_tarea = st.id_tarea
            WHERE t.id_empresa = ? AND t.eliminado = 0
        `;
        const params = [id_empresa];

        // Filtros
        if (estado) { query += ' AND t.estado = ?'; params.push(estado); }
        if (prioridad) { query += ' AND t.prioridad = ?'; params.push(prioridad); }
        if (id_empleado) { query += ' AND t.id_empleado = ?'; params.push(id_empleado); }
        if (id_supervisor) { query += ' AND t.id_supervisor = ?'; params.push(id_supervisor); }

        // Filtro por rol
        if (req.usuario.rol === 'EMPLEADO') {
            query += ' AND t.id_empleado = ?';
            params.push(req.usuario.id_usuario);
        } else if (req.usuario.rol === 'SUPERVISOR') {
            query += ' AND (t.id_supervisor = ? OR t.id_creador = ?)';
            params.push(req.usuario.id_usuario, req.usuario.id_usuario);
        }

        query += ' ORDER BY CASE t.prioridad WHEN \'urgente\' THEN 1 WHEN \'alta\' THEN 2 WHEN \'media\' THEN 3 WHEN \'baja\' THEN 4 END, t.fecha_creacion DESC';

        const tareas = db.prepare(query).all(...params);
        res.json(tareas);
    } catch (err) {
        console.error('Error listando tareas:', err);
        res.status(500).json({ error: 'Error al listar tareas' });
    }
});

/**
 * GET /api/tareas/estadisticas
 * Estadísticas de tareas de la empresa
 */
router.get('/estadisticas', verificarToken, (req, res) => {
    try {
        const id_empresa = req.usuario.id_empresa;

        const stats = {
            total: db.prepare('SELECT COUNT(*) as c FROM tareas WHERE id_empresa = ? AND eliminado = 0').get(id_empresa).c,
            pendientes: db.prepare('SELECT COUNT(*) as c FROM tareas WHERE id_empresa = ? AND estado = ? AND eliminado = 0').get(id_empresa, 'pendiente').c,
            en_proceso: db.prepare('SELECT COUNT(*) as c FROM tareas WHERE id_empresa = ? AND estado = ? AND eliminado = 0').get(id_empresa, 'en_proceso').c,
            finalizadas: db.prepare('SELECT COUNT(*) as c FROM tareas WHERE id_empresa = ? AND estado IN (?,?) AND eliminado = 0').get(id_empresa, 'finalizada', 'finalizada_atrasada').c,
            atrasadas: db.prepare('SELECT COUNT(*) as c FROM tareas WHERE id_empresa = ? AND estado = ? AND eliminado = 0').get(id_empresa, 'atrasada').c
        };

        // Eficiencia: % finalizadas a tiempo
        const finAtiempo = db.prepare('SELECT COUNT(*) as c FROM tareas WHERE id_empresa = ? AND estado = ? AND eliminado = 0').get(id_empresa, 'finalizada').c;
        const totalFin = stats.finalizadas;
        stats.eficiencia = totalFin > 0 ? Math.round((finAtiempo / totalFin) * 100) : 0;

        // Por prioridad
        stats.urgentes = db.prepare('SELECT COUNT(*) as c FROM tareas WHERE id_empresa = ? AND prioridad = ? AND estado NOT IN (?,?) AND eliminado = 0').get(id_empresa, 'urgente', 'finalizada', 'finalizada_atrasada').c;

        res.json(stats);
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener estadísticas' });
    }
});

/**
 * GET /api/tareas/:id
 * Detalle de tarea con historial, evidencias y comentarios
 */
router.get('/:id', verificarToken, (req, res) => {
    try {
        const tarea = db.prepare(`
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
        `).get(req.params.id);

        if (!tarea) {
            return res.status(404).json({ error: 'Tarea no encontrada' });
        }

        if (req.usuario.rol !== 'ROOT' && req.usuario.id_empresa !== tarea.id_empresa) {
            return res.status(403).json({ error: 'Sin acceso' });
        }

        // Historial
        const historial = db.prepare(`
            SELECT h.*, u.nombre as nombre_usuario
            FROM historial_estados_tarea h
            LEFT JOIN usuarios u ON h.id_usuario = u.id_usuario
            WHERE h.id_tarea = ?
            ORDER BY h.fecha DESC
        `).all(req.params.id);

        // Evidencias
        const evidencias = db.prepare(`
            SELECT * FROM evidencias_tarea WHERE id_tarea = ? ORDER BY fecha_registro DESC
        `).all(req.params.id);

        // Comentarios
        const comentarios = db.prepare(`
            SELECT c.*, u.nombre as nombre_usuario, u.rol as rol_usuario
            FROM comentarios_tarea c
            JOIN usuarios u ON c.id_usuario = u.id_usuario
            WHERE c.id_tarea = ?
            ORDER BY c.fecha ASC
        `).all(req.params.id);

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
 * Empleado inicia la tarea → en_proceso
 */
router.put('/:id/iniciar', verificarToken, (req, res) => {
    try {
        const tarea = db.prepare('SELECT * FROM tareas WHERE id_tarea = ? AND eliminado = 0').get(req.params.id);
        if (!tarea) return res.status(404).json({ error: 'Tarea no encontrada' });

        if (tarea.estado !== 'pendiente') {
            return res.status(400).json({ error: 'Solo se pueden iniciar tareas pendientes' });
        }

        const ahora = new Date().toISOString();
        const { lat, lng } = req.body || {};

        // Actualizar tarea
        db.prepare(`UPDATE tareas SET estado = 'en_proceso', fecha_inicio = ? WHERE id_tarea = ?`)
            .run(ahora, req.params.id);

        // Actualizar seguimiento
        db.prepare(`UPDATE seguimiento_tiempo SET hora_inicio = ?, lat_inicio = ?, lng_inicio = ? WHERE id_tarea = ?`)
            .run(ahora, lat || null, lng || null, req.params.id);

        // Historial
        db.prepare(`INSERT INTO historial_estados_tarea (id_tarea, estado_anterior, estado_nuevo, id_usuario, comentario) VALUES (?, 'pendiente', 'en_proceso', ?, 'Tarea iniciada')`)
            .run(req.params.id, req.usuario.id_usuario);

        // Socket
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
 * Empleado finaliza la tarea
 */
router.put('/:id/finalizar', verificarToken, (req, res) => {
    try {
        const tarea = db.prepare('SELECT * FROM tareas WHERE id_tarea = ? AND eliminado = 0').get(req.params.id);
        if (!tarea) return res.status(404).json({ error: 'Tarea no encontrada' });

        if (tarea.estado !== 'en_proceso' && tarea.estado !== 'atrasada') {
            return res.status(400).json({ error: 'Solo se pueden finalizar tareas en proceso o atrasadas' });
        }

        const ahora = new Date().toISOString();
        const { lat, lng } = req.body || {};

        // Calcular tiempo real
        const seguimiento = db.prepare('SELECT * FROM seguimiento_tiempo WHERE id_tarea = ?').get(req.params.id);
        let tiempoRealSegundos = 0;
        if (seguimiento && seguimiento.hora_inicio) {
            tiempoRealSegundos = Math.round((new Date(ahora) - new Date(seguimiento.hora_inicio)) / 1000);
        }

        // Determinar si se completó a tiempo
        let estadoFinal = 'finalizada';
        if (tarea.tiempo_estimado_minutos) {
            const tiempoEstimadoSegundos = tarea.tiempo_estimado_minutos * 60;
            // Obtener tolerancia de la empresa
            const config = db.prepare('SELECT tolerancia_tiempo FROM configuraciones_empresa WHERE id_empresa = ?').get(tarea.id_empresa);
            const tolerancia = config ? config.tolerancia_tiempo : 10;
            const limiteSegundos = tiempoEstimadoSegundos * (1 + tolerancia / 100);

            if (tiempoRealSegundos > limiteSegundos) {
                estadoFinal = 'finalizada_atrasada';
            }
        }

        // Actualizar tarea
        db.prepare(`UPDATE tareas SET estado = ?, fecha_fin = ? WHERE id_tarea = ?`)
            .run(estadoFinal, ahora, req.params.id);

        // Actualizar seguimiento
        db.prepare(`UPDATE seguimiento_tiempo SET hora_fin = ?, tiempo_real_segundos = ?, lat_fin = ?, lng_fin = ? WHERE id_tarea = ?`)
            .run(ahora, tiempoRealSegundos, lat || null, lng || null, req.params.id);

        // Historial
        db.prepare(`INSERT INTO historial_estados_tarea (id_tarea, estado_anterior, estado_nuevo, id_usuario, comentario) VALUES (?, ?, ?, ?, ?)`)
            .run(req.params.id, tarea.estado, estadoFinal, req.usuario.id_usuario, `Tarea finalizada (${formatearTiempo(tiempoRealSegundos)})`);

        // Gamificación
        let puntos = 0;
        let motivo = '';
        if (estadoFinal === 'finalizada') {
            puntos = 10;
            motivo = 'TAREA_A_TIEMPO';
        } else {
            puntos = 5;
            motivo = 'TAREA_ATRASADA';
        }

        if (tarea.id_empleado) {
            db.prepare(`INSERT INTO movimientos_puntos (id_usuario, id_tarea, puntos, motivo, descripcion) VALUES (?, ?, ?, ?, ?)`)
                .run(tarea.id_empleado, req.params.id, puntos, motivo, `Tarea "${tarea.titulo}" ${estadoFinal === 'finalizada' ? 'a tiempo' : 'atrasada'}`);
        }

        // Notificar al supervisor
        if (tarea.id_supervisor) {
            db.prepare(`INSERT INTO notificaciones (id_notificacion, id_usuario, titulo, mensaje, tipo) VALUES (?, ?, ?, ?, 'tarea_finalizada')`)
                .run(uuidv4(), tarea.id_supervisor, '✅ Tarea finalizada', `La tarea "${tarea.titulo}" fue finalizada`);
        }

        // Socket
        const io = req.app.get('io');
        if (io) {
            io.to(`empresa_${tarea.id_empresa}`).emit('tarea_actualizada', {
                id_tarea: req.params.id, estado: estadoFinal, fecha_fin: ahora, tiempo_real_segundos: tiempoRealSegundos
            });
        }

        registrarAuditoria(tarea.id_empresa, req.usuario.id_usuario, 'FINALIZAR_TAREA', `Tarea "${tarea.titulo}" finalizada (${estadoFinal})`);

        res.json({
            mensaje: 'Tarea finalizada',
            estado: estadoFinal,
            tiempo_real_segundos: tiempoRealSegundos,
            tiempo_formateado: formatearTiempo(tiempoRealSegundos),
            puntos_ganados: puntos
        });
    } catch (err) {
        console.error('Error finalizando tarea:', err);
        res.status(500).json({ error: 'Error al finalizar tarea' });
    }
});

/**
 * PUT /api/tareas/:id
 * Editar tarea
 */
router.put('/:id', verificarToken, verificarRol('ADMIN', 'SUPERVISOR'), (req, res) => {
    try {
        const tarea = db.prepare('SELECT * FROM tareas WHERE id_tarea = ? AND eliminado = 0').get(req.params.id);
        if (!tarea) return res.status(404).json({ error: 'Tarea no encontrada' });

        const { titulo, descripcion, id_empleado, id_supervisor, id_tipo, prioridad, tiempo_estimado_minutos } = req.body;

        db.prepare(`
            UPDATE tareas SET
                titulo = COALESCE(?, titulo),
                descripcion = COALESCE(?, descripcion),
                id_empleado = COALESCE(?, id_empleado),
                id_supervisor = COALESCE(?, id_supervisor),
                id_tipo = COALESCE(?, id_tipo),
                prioridad = COALESCE(?, prioridad),
                tiempo_estimado_minutos = COALESCE(?, tiempo_estimado_minutos)
            WHERE id_tarea = ?
        `).run(titulo, descripcion, id_empleado, id_supervisor, id_tipo, prioridad, tiempo_estimado_minutos, req.params.id);

        registrarAuditoria(tarea.id_empresa, req.usuario.id_usuario, 'EDITAR_TAREA', `Tarea "${tarea.titulo}" editada`);

        const actualizada = db.prepare('SELECT * FROM tareas WHERE id_tarea = ?').get(req.params.id);
        res.json({ mensaje: 'Tarea actualizada', tarea: actualizada });
    } catch (err) {
        res.status(500).json({ error: 'Error al actualizar tarea' });
    }
});

/**
 * DELETE /api/tareas/:id (Soft Delete)
 */
router.delete('/:id', verificarToken, verificarRol('ADMIN', 'SUPERVISOR'), (req, res) => {
    try {
        const tarea = db.prepare('SELECT * FROM tareas WHERE id_tarea = ? AND eliminado = 0').get(req.params.id);
        if (!tarea) return res.status(404).json({ error: 'Tarea no encontrada' });

        db.prepare('UPDATE tareas SET eliminado = 1 WHERE id_tarea = ?').run(req.params.id);
        registrarAuditoria(tarea.id_empresa, req.usuario.id_usuario, 'ELIMINAR_TAREA', `Tarea "${tarea.titulo}" eliminada`);

        res.json({ mensaje: 'Tarea eliminada' });
    } catch (err) {
        res.status(500).json({ error: 'Error al eliminar tarea' });
    }
});

// ═══════════════════════════════════════════
// COMENTARIOS
// ═══════════════════════════════════════════

/**
 * POST /api/tareas/:id/comentarios
 */
router.post('/:id/comentarios', verificarToken, (req, res) => {
    try {
        const { contenido } = req.body;
        if (!contenido) return res.status(400).json({ error: 'Contenido requerido' });

        const tarea = db.prepare('SELECT * FROM tareas WHERE id_tarea = ? AND eliminado = 0').get(req.params.id);
        if (!tarea) return res.status(404).json({ error: 'Tarea no encontrada' });

        db.prepare(`INSERT INTO comentarios_tarea (id_tarea, id_usuario, contenido) VALUES (?, ?, ?)`)
            .run(req.params.id, req.usuario.id_usuario, contenido);

        // Socket
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
// EVIDENCIAS (texto + imágenes)
// ═══════════════════════════════════════════

const { uploadEvidencia, setUploadTipo } = require('../middleware/uploads');

/**
 * POST /api/tareas/:id/evidencias
 * Soporta texto o imagen (multipart/form-data)
 */
router.post('/:id/evidencias', verificarToken, setUploadTipo('evidencias'), uploadEvidencia.single('archivo'), (req, res) => {
    try {
        const tipo = req.body.tipo || (req.file ? 'imagen' : 'texto');
        let contenido = req.body.contenido || '';

        // Si se subió un archivo, guardar la URL
        if (req.file) {
            contenido = `/uploads/evidencias/${req.file.filename}`;
        }

        if (!contenido) return res.status(400).json({ error: 'Contenido o archivo requerido' });

        const tarea = db.prepare('SELECT * FROM tareas WHERE id_tarea = ? AND eliminado = 0').get(req.params.id);
        if (!tarea) return res.status(404).json({ error: 'Tarea no encontrada' });

        const id_evidencia = uuidv4();
        db.prepare(`INSERT INTO evidencias_tarea (id_evidencia, id_tarea, tipo, contenido) VALUES (?, ?, ?, ?)`)
            .run(id_evidencia, req.params.id, tipo, contenido);

        // Socket
        const io = req.app.get('io');
        if (io) {
            io.to(`empresa_${tarea.id_empresa}`).emit('nueva_evidencia', {
                id_tarea: req.params.id, tipo
            });
        }

        res.status(201).json({ mensaje: 'Evidencia agregada', id_evidencia, tipo, contenido });
    } catch (err) {
        res.status(500).json({ error: 'Error al agregar evidencia' });
    }
});

// ═══════════════════════════════════════════
// TIPOS DE TAREA
// ═══════════════════════════════════════════

/**
 * GET /api/tareas/tipos/lista
 */
router.get('/tipos/lista', verificarToken, (req, res) => {
    try {
        const tipos = db.prepare('SELECT * FROM tipos_tarea WHERE id_empresa = ?').all(req.usuario.id_empresa);
        res.json(tipos);
    } catch (err) {
        res.status(500).json({ error: 'Error al listar tipos' });
    }
});

// ═══════════════════════════════════════════
// NOTIFICACIONES
// ═══════════════════════════════════════════

/**
 * GET /api/tareas/notificaciones/mis
 */
router.get('/notificaciones/mis', verificarToken, (req, res) => {
    try {
        const notificaciones = db.prepare(`
            SELECT * FROM notificaciones
            WHERE id_usuario = ?
            ORDER BY fecha DESC
            LIMIT 50
        `).all(req.usuario.id_usuario);
        res.json(notificaciones);
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener notificaciones' });
    }
});

/**
 * PUT /api/tareas/notificaciones/:id/leer
 */
router.put('/notificaciones/:id/leer', verificarToken, (req, res) => {
    try {
        db.prepare('UPDATE notificaciones SET leido = 1 WHERE id_notificacion = ? AND id_usuario = ?')
            .run(req.params.id, req.usuario.id_usuario);
        res.json({ mensaje: 'Notificación marcada como leída' });
    } catch (err) {
        res.status(500).json({ error: 'Error' });
    }
});

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

module.exports = router;
