/**
 * Rutas de Plantillas de Tareas Repetitivas y Programadas
 */
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { db } = require('../database/init');
const { verificarToken, verificarRol, registrarAuditoria } = require('./auth');

// ═══════════════════════════════════════════
// PLANTILLAS REPETITIVAS
// ═══════════════════════════════════════════

/**
 * GET /api/plantillas
 */
router.get('/', verificarToken, verificarRol('ADMIN', 'SUPERVISOR'), async (req, res) => {
    try {
        const id_empresa = req.usuario.id_empresa;
        const { recurrencia } = req.query;

        let query = `
            SELECT p.*,
                   emp.nombre as nombre_empleado,
                   sup.nombre as nombre_supervisor
            FROM plantillas_tarea p
            LEFT JOIN usuarios emp ON p.id_empleado_default = emp.id_usuario
            LEFT JOIN usuarios sup ON p.id_supervisor_default = sup.id_usuario
            WHERE p.id_empresa = ?
        `;
        const params = [id_empresa];

        if (recurrencia) {
            query += ' AND p.recurrencia = ?';
            params.push(recurrencia);
        }

        query += ' ORDER BY p.activa DESC, p.fecha_creacion DESC';
        const plantillas = await db.all(query, ...params);
        res.json(plantillas);
    } catch (err) {
        console.error('Error listando plantillas:', err);
        res.status(500).json({ error: 'Error al listar plantillas' });
    }
});

/**
 * POST /api/plantillas
 */
router.post('/', verificarToken, verificarRol('ADMIN', 'SUPERVISOR'), async (req, res) => {
    try {
        const { titulo, descripcion, id_tipo, tiempo_estimado_minutos, prioridad,
                recurrencia, dias_semana, hora_creacion, id_empleado_default,
                id_supervisor_default, incluir_finsemana } = req.body;

        if (!titulo) return res.status(400).json({ error: 'Título requerido' });
        if (!recurrencia || !['diaria', 'semanal', 'mensual', 'anual'].includes(recurrencia)) {
            return res.status(400).json({ error: 'Recurrencia inválida (diaria, semanal, mensual, anual)' });
        }

        const id_plantilla = uuidv4();
        const id_empresa = req.usuario.id_empresa;
        const supFinal = id_supervisor_default || (req.usuario.rol === 'SUPERVISOR' ? req.usuario.id_usuario : null);

        await db.run(`
            INSERT INTO plantillas_tarea (id_plantilla, id_empresa, titulo, descripcion, id_tipo,
                tiempo_estimado_minutos, prioridad, recurrencia, dias_semana, hora_creacion,
                id_empleado_default, id_supervisor_default, incluir_finsemana)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, id_plantilla, id_empresa, titulo, descripcion || '', id_tipo || null,
           tiempo_estimado_minutos || null, prioridad || 'media', recurrencia,
           dias_semana || null, hora_creacion || '08:00',
           id_empleado_default || null, supFinal, incluir_finsemana !== undefined ? (incluir_finsemana ? 1 : 0) : 1);

        registrarAuditoria(id_empresa, req.usuario.id_usuario, 'CREAR_PLANTILLA', `Plantilla "${titulo}" (${recurrencia})`);
        res.status(201).json({ mensaje: 'Plantilla creada', id_plantilla });
    } catch (err) {
        console.error('Error creando plantilla:', err);
        res.status(500).json({ error: 'Error al crear plantilla' });
    }
});

/**
 * PUT /api/plantillas/:id
 */
router.put('/:id', verificarToken, verificarRol('ADMIN', 'SUPERVISOR'), async (req, res) => {
    try {
        const plantilla = await db.get('SELECT * FROM plantillas_tarea WHERE id_plantilla = ?', req.params.id);
        if (!plantilla) return res.status(404).json({ error: 'Plantilla no encontrada' });

        const { titulo, descripcion, id_tipo, tiempo_estimado_minutos, prioridad,
                recurrencia, dias_semana, hora_creacion, id_empleado_default,
                id_supervisor_default, incluir_finsemana } = req.body;

        await db.run(`
            UPDATE plantillas_tarea SET
                titulo = COALESCE(?, titulo), descripcion = COALESCE(?, descripcion),
                id_tipo = COALESCE(?, id_tipo), tiempo_estimado_minutos = COALESCE(?, tiempo_estimado_minutos),
                prioridad = COALESCE(?, prioridad), recurrencia = COALESCE(?, recurrencia),
                dias_semana = COALESCE(?, dias_semana), hora_creacion = COALESCE(?, hora_creacion),
                id_empleado_default = COALESCE(?, id_empleado_default),
                id_supervisor_default = COALESCE(?, id_supervisor_default),
                incluir_finsemana = COALESCE(?, incluir_finsemana)
            WHERE id_plantilla = ?
        `, titulo, descripcion, id_tipo, tiempo_estimado_minutos, prioridad,
           recurrencia, dias_semana, hora_creacion, id_empleado_default,
           id_supervisor_default, incluir_finsemana !== undefined ? (incluir_finsemana ? 1 : 0) : null,
           req.params.id);

        res.json({ mensaje: 'Plantilla actualizada' });
    } catch (err) {
        res.status(500).json({ error: 'Error al actualizar plantilla' });
    }
});

/**
 * PUT /api/plantillas/:id/toggle - Activar/Pausar
 */
router.put('/:id/toggle', verificarToken, verificarRol('ADMIN', 'SUPERVISOR'), async (req, res) => {
    try {
        const plantilla = await db.get('SELECT * FROM plantillas_tarea WHERE id_plantilla = ?', req.params.id);
        if (!plantilla) return res.status(404).json({ error: 'Plantilla no encontrada' });

        const nuevoEstado = plantilla.activa ? 0 : 1;
        await db.run('UPDATE plantillas_tarea SET activa = ? WHERE id_plantilla = ?', nuevoEstado, req.params.id);

        registrarAuditoria(plantilla.id_empresa, req.usuario.id_usuario, 'TOGGLE_PLANTILLA',
            `Plantilla "${plantilla.titulo}" ${nuevoEstado ? 'activada' : 'pausada'}`);
        res.json({ mensaje: nuevoEstado ? 'Plantilla activada' : 'Plantilla pausada', activa: nuevoEstado });
    } catch (err) {
        res.status(500).json({ error: 'Error al cambiar estado' });
    }
});

/**
 * DELETE /api/plantillas/:id
 */
router.delete('/:id', verificarToken, verificarRol('ADMIN', 'SUPERVISOR'), async (req, res) => {
    try {
        const plantilla = await db.get('SELECT * FROM plantillas_tarea WHERE id_plantilla = ?', req.params.id);
        if (!plantilla) return res.status(404).json({ error: 'Plantilla no encontrada' });

        await db.run('DELETE FROM plantillas_tarea WHERE id_plantilla = ?', req.params.id);
        registrarAuditoria(plantilla.id_empresa, req.usuario.id_usuario, 'ELIMINAR_PLANTILLA',
            `Plantilla "${plantilla.titulo}" eliminada`);
        res.json({ mensaje: 'Plantilla eliminada' });
    } catch (err) {
        res.status(500).json({ error: 'Error al eliminar plantilla' });
    }
});

/**
 * POST /api/plantillas/:id/ejecutar — Generar tarea manualmente desde plantilla
 */
router.post('/:id/ejecutar', verificarToken, verificarRol('ADMIN', 'SUPERVISOR'), async (req, res) => {
    try {
        const plantilla = await db.get('SELECT * FROM plantillas_tarea WHERE id_plantilla = ?', req.params.id);
        if (!plantilla) return res.status(404).json({ error: 'Plantilla no encontrada' });

        const tarea = await generarTareaDesdePlantilla(plantilla, req.usuario.id_usuario, req.app.get('io'));
        res.json({ mensaje: 'Tarea generada', tarea });
    } catch (err) {
        console.error('Error ejecutando plantilla:', err);
        res.status(500).json({ error: 'Error al generar tarea' });
    }
});

// ═══════════════════════════════════════════
// TAREAS PROGRAMADAS POR CALENDARIO
// ═══════════════════════════════════════════

/**
 * GET /api/plantillas/programadas
 */
router.get('/programadas', verificarToken, verificarRol('ADMIN', 'SUPERVISOR'), async (req, res) => {
    try {
        const id_empresa = req.usuario.id_empresa;
        const programadas = await db.all(`
            SELECT tp.*,
                   emp.nombre as nombre_empleado,
                   sup.nombre as nombre_supervisor
            FROM tareas_programadas tp
            LEFT JOIN usuarios emp ON tp.id_empleado = emp.id_usuario
            LEFT JOIN usuarios sup ON tp.id_supervisor = sup.id_usuario
            WHERE tp.id_empresa = ?
            ORDER BY tp.fecha_programada ASC
        `, id_empresa);
        res.json(programadas);
    } catch (err) {
        res.status(500).json({ error: 'Error al listar programadas' });
    }
});

/**
 * POST /api/plantillas/programadas
 */
router.post('/programadas', verificarToken, verificarRol('ADMIN', 'SUPERVISOR'), async (req, res) => {
    try {
        const { titulo, descripcion, id_tipo, tiempo_estimado_minutos, prioridad,
                id_empleado, id_supervisor, fecha_programada, hora_programada } = req.body;

        if (!titulo || !fecha_programada) {
            return res.status(400).json({ error: 'Título y fecha programada son requeridos' });
        }

        const id_programacion = uuidv4();
        const id_empresa = req.usuario.id_empresa;
        const supFinal = id_supervisor || (req.usuario.rol === 'SUPERVISOR' ? req.usuario.id_usuario : null);

        await db.run(`
            INSERT INTO tareas_programadas (id_programacion, id_empresa, titulo, descripcion, id_tipo,
                tiempo_estimado_minutos, prioridad, id_empleado, id_supervisor, id_creador,
                fecha_programada, hora_programada)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, id_programacion, id_empresa, titulo, descripcion || '', id_tipo || null,
           tiempo_estimado_minutos || null, prioridad || 'media',
           id_empleado || null, supFinal, req.usuario.id_usuario,
           fecha_programada, hora_programada || '08:00');

        registrarAuditoria(id_empresa, req.usuario.id_usuario, 'PROGRAMAR_TAREA',
            `Tarea "${titulo}" programada para ${fecha_programada}`);
        res.status(201).json({ mensaje: 'Tarea programada', id_programacion });
    } catch (err) {
        console.error('Error programando tarea:', err);
        res.status(500).json({ error: 'Error al programar tarea' });
    }
});

/**
 * DELETE /api/plantillas/programadas/:id
 */
router.delete('/programadas/:id', verificarToken, verificarRol('ADMIN', 'SUPERVISOR'), async (req, res) => {
    try {
        const prog = await db.get('SELECT * FROM tareas_programadas WHERE id_programacion = ?', req.params.id);
        if (!prog) return res.status(404).json({ error: 'Programación no encontrada' });
        if (prog.ejecutada) return res.status(400).json({ error: 'Ya fue ejecutada' });

        await db.run('DELETE FROM tareas_programadas WHERE id_programacion = ?', req.params.id);
        res.json({ mensaje: 'Programación eliminada' });
    } catch (err) {
        res.status(500).json({ error: 'Error al eliminar programación' });
    }
});

// ═══════════════════════════════════════════
// FUNCIÓN: Generar tarea real desde plantilla
// ═══════════════════════════════════════════
async function generarTareaDesdePlantilla(plantilla, id_creador, io) {
    const id_tarea = uuidv4();
    const ahora = new Date().toISOString();
    const estadoInicial = plantilla.id_empleado_default ? 'en_proceso' : 'pendiente';
    const fechaInic = plantilla.id_empleado_default ? ahora : null;

    await db.run(`
        INSERT INTO tareas (id_tarea, id_empresa, titulo, descripcion, id_empleado, id_supervisor,
            id_creador, id_tipo, prioridad, tiempo_estimado_minutos, estado, fecha_inicio)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, id_tarea, plantilla.id_empresa, plantilla.titulo, plantilla.descripcion || '',
       plantilla.id_empleado_default || null, plantilla.id_supervisor_default || null,
       id_creador, plantilla.id_tipo || null, plantilla.prioridad || 'media',
       plantilla.tiempo_estimado_minutos || null, estadoInicial, fechaInic);

    await db.run(`INSERT INTO historial_estados_tarea (id_tarea, estado_nuevo, id_usuario, comentario)
        VALUES (?, ?, ?, 'Tarea generada automáticamente desde plantilla')`, id_tarea, estadoInicial, id_creador);

    if (plantilla.id_empleado_default) {
        await db.run(`INSERT INTO seguimiento_tiempo (id_seguimiento, id_tarea, hora_inicio) VALUES (?, ?, ?)`,
            uuidv4(), id_tarea, ahora);
        await db.run(`INSERT INTO notificaciones (id_notificacion, id_usuario, titulo, mensaje, tipo)
            VALUES (?, ?, '📋 Nueva tarea asignada', ?, 'nueva_tarea')`,
            uuidv4(), plantilla.id_empleado_default, `Tarea repetitiva: "${plantilla.titulo}"`);
    } else {
        await db.run(`INSERT INTO seguimiento_tiempo (id_seguimiento, id_tarea) VALUES (?, ?)`, uuidv4(), id_tarea);
    }

    // Actualizar plantilla
    await db.run(`UPDATE plantillas_tarea SET ultima_ejecucion = ?, total_generadas = total_generadas + 1
        WHERE id_plantilla = ?`, ahora, plantilla.id_plantilla);

    if (io) {
        io.to(`empresa_${plantilla.id_empresa}`).emit('nueva_tarea', {
            id_tarea, titulo: plantilla.titulo, prioridad: plantilla.prioridad,
            estado: estadoInicial, fecha_creacion: ahora
        });
    }

    return { id_tarea, titulo: plantilla.titulo, estado: estadoInicial };
}

// ═══════════════════════════════════════════
// CRON JOB: Ejecutar plantillas y programadas
// ═══════════════════════════════════════════
async function ejecutarCronPlantillas(io) {
    const ahora = new Date();
    const horaActual = ahora.getHours();
    const diaActual = ahora.getDay(); // 0=Dom, 6=Sab
    const diaDelMes = ahora.getDate();
    const mesActual = ahora.getMonth() + 1;
    const diaDelAnio = `${String(mesActual).padStart(2,'0')}-${String(diaDelMes).padStart(2,'0')}`;
    const fechaHoy = ahora.toISOString().split('T')[0];

    try {
        // 1. Procesar plantillas repetitivas activas
        const plantillas = await db.all('SELECT * FROM plantillas_tarea WHERE activa = 1');

        for (const p of plantillas) {
            const horaProgramada = parseInt(p.hora_creacion?.split(':')[0]) || 8;
            if (horaActual !== horaProgramada) continue;

            // Verificar si ya se ejecutó hoy
            if (p.ultima_ejecucion) {
                const ultimaFecha = p.ultima_ejecucion.split('T')[0];
                if (ultimaFecha === fechaHoy) continue;
            }

            // Verificar fin de semana
            if (!p.incluir_finsemana && (diaActual === 0 || diaActual === 6)) continue;

            let debeEjecutar = false;

            switch (p.recurrencia) {
                case 'diaria':
                    debeEjecutar = true;
                    break;
                case 'semanal':
                    if (p.dias_semana) {
                        const dias = p.dias_semana.split(',').map(Number);
                        debeEjecutar = dias.includes(diaActual);
                    } else {
                        debeEjecutar = diaActual === 1; // Lunes por defecto
                    }
                    break;
                case 'mensual':
                    if (p.dias_semana) {
                        const diasMes = p.dias_semana.split(',').map(Number);
                        debeEjecutar = diasMes.includes(diaDelMes);
                    } else {
                        debeEjecutar = diaDelMes === 1;
                    }
                    break;
                case 'anual':
                    if (p.dias_semana) {
                        debeEjecutar = p.dias_semana === diaDelAnio;
                    } else {
                        debeEjecutar = diaDelMes === 1 && mesActual === 1;
                    }
                    break;
            }

            if (debeEjecutar) {
                try {
                    await generarTareaDesdePlantilla(p, p.id_supervisor_default || 'SISTEMA', io);
                    console.log(`🔄 Tarea generada desde plantilla: "${p.titulo}"`);
                } catch (e) {
                    console.error(`❌ Error generando tarea desde plantilla "${p.titulo}":`, e.message);
                }
            }
        }

        // 2. Procesar tareas programadas por calendario
        const programadas = await db.all(
            'SELECT * FROM tareas_programadas WHERE ejecutada = 0 AND fecha_programada <= ?', fechaHoy
        );

        for (const tp of programadas) {
            const horaProg = parseInt(tp.hora_programada?.split(':')[0]) || 8;
            if (horaActual < horaProg) continue;

            try {
                const id_tarea = uuidv4();
                const estadoInicial = tp.id_empleado ? 'en_proceso' : 'pendiente';
                const fechaInic = tp.id_empleado ? ahora.toISOString() : null;

                await db.run(`
                    INSERT INTO tareas (id_tarea, id_empresa, titulo, descripcion, id_empleado, id_supervisor,
                        id_creador, id_tipo, prioridad, tiempo_estimado_minutos, estado, fecha_inicio)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, id_tarea, tp.id_empresa, tp.titulo, tp.descripcion || '',
                   tp.id_empleado || null, tp.id_supervisor || null, tp.id_creador,
                   tp.id_tipo || null, tp.prioridad || 'media',
                   tp.tiempo_estimado_minutos || null, estadoInicial, fechaInic);

                await db.run(`INSERT INTO historial_estados_tarea (id_tarea, estado_nuevo, id_usuario, comentario)
                    VALUES (?, ?, ?, 'Tarea programada ejecutada')`, id_tarea, estadoInicial, tp.id_creador);

                if (tp.id_empleado) {
                    await db.run(`INSERT INTO seguimiento_tiempo (id_seguimiento, id_tarea, hora_inicio) VALUES (?, ?, ?)`,
                        uuidv4(), id_tarea, ahora.toISOString());
                    await db.run(`INSERT INTO notificaciones (id_notificacion, id_usuario, titulo, mensaje, tipo)
                        VALUES (?, ?, '📋 Tarea programada', ?, 'nueva_tarea')`,
                        uuidv4(), tp.id_empleado, `Se activó la tarea: "${tp.titulo}"`);
                } else {
                    await db.run(`INSERT INTO seguimiento_tiempo (id_seguimiento, id_tarea) VALUES (?, ?)`, uuidv4(), id_tarea);
                }

                await db.run('UPDATE tareas_programadas SET ejecutada = 1, id_tarea_generada = ? WHERE id_programacion = ?',
                    id_tarea, tp.id_programacion);

                if (io) {
                    io.to(`empresa_${tp.id_empresa}`).emit('nueva_tarea', {
                        id_tarea, titulo: tp.titulo, prioridad: tp.prioridad,
                        estado: estadoInicial, fecha_creacion: ahora.toISOString()
                    });
                }
                console.log(`📅 Tarea programada ejecutada: "${tp.titulo}"`);
            } catch (e) {
                console.error(`❌ Error ejecutando tarea programada "${tp.titulo}":`, e.message);
            }
        }
    } catch (err) {
        console.error('❌ Error en cron de plantillas:', err);
    }
}

module.exports = router;
module.exports.ejecutarCronPlantillas = ejecutarCronPlantillas;
