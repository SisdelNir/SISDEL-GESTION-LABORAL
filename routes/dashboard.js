const express = require('express');
const router = express.Router();
const { db } = require('../database/init');
const { verificarToken, verificarRol, registrarAuditoria } = require('../middleware/auth');

// ═══════════════════════════════════════════
// DASHBOARD EJECUTIVO + KPIs
// ═══════════════════════════════════════════

router.get('/', verificarToken, async (req, res) => {
    try {
        const id_empresa = req.usuario.id_empresa;

        const totalSupervisores = (await db.get('SELECT COUNT(*) as c FROM usuarios WHERE id_empresa = ? AND rol = ? AND estado = 1', id_empresa, 'SUPERVISOR')).c;
        const totalEmpleados = (await db.get('SELECT COUNT(*) as c FROM usuarios WHERE id_empresa = ? AND rol = ? AND estado = 1', id_empresa, 'EMPLEADO')).c;

        const tareasTotal = (await db.get('SELECT COUNT(*) as c FROM tareas WHERE id_empresa = ? AND eliminado = 0', id_empresa)).c;
        const tareasPendientes = (await db.get('SELECT COUNT(*) as c FROM tareas WHERE id_empresa = ? AND estado = ? AND eliminado = 0', id_empresa, 'pendiente')).c;
        const tareasEnProceso = (await db.get('SELECT COUNT(*) as c FROM tareas WHERE id_empresa = ? AND estado = ? AND eliminado = 0', id_empresa, 'en_proceso')).c;
        const tareasFinalizadas = (await db.get('SELECT COUNT(*) as c FROM tareas WHERE id_empresa = ? AND estado IN (?,?) AND eliminado = 0', id_empresa, 'finalizada', 'finalizada_atrasada')).c;
        const tareasAtrasadas = (await db.get('SELECT COUNT(*) as c FROM tareas WHERE id_empresa = ? AND estado = ? AND eliminado = 0', id_empresa, 'atrasada')).c;
        const tareasAtiempo = (await db.get('SELECT COUNT(*) as c FROM tareas WHERE id_empresa = ? AND estado = ? AND eliminado = 0', id_empresa, 'finalizada')).c;

        const eficiencia = tareasFinalizadas > 0 ? Math.round((tareasAtiempo / tareasFinalizadas) * 100) : 0;

        const hace7dias = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
        const productividad7d = (await db.get('SELECT COUNT(*) as c FROM tareas WHERE id_empresa = ? AND estado IN (?,?) AND fecha_fin >= ? AND eliminado = 0', id_empresa, 'finalizada', 'finalizada_atrasada', hace7dias)).c;

        const tiempoPromedio = await db.get('SELECT AVG(st.tiempo_real_segundos) as avg_seg FROM seguimiento_tiempo st JOIN tareas t ON st.id_tarea = t.id_tarea WHERE t.id_empresa = ? AND st.tiempo_real_segundos > 0', id_empresa);
        const avgMinutos = tiempoPromedio && tiempoPromedio.avg_seg ? Math.round(tiempoPromedio.avg_seg / 60) : 0;

        const porPrioridad = await db.all(`
            SELECT prioridad, COUNT(*) as total FROM tareas WHERE id_empresa = ? AND eliminado = 0 GROUP BY prioridad
        `, id_empresa);

        const topEmpleados = await db.all(`
            SELECT u.nombre, u.id_usuario, 
                   COUNT(t.id_tarea) as tareas_completadas,
                   COALESCE(SUM(CASE WHEN t.estado = 'finalizada' THEN 1 ELSE 0 END), 0) as a_tiempo,
                   COALESCE(SUM(CASE WHEN t.estado = 'finalizada_atrasada' THEN 1 ELSE 0 END), 0) as atrasadas,
                   COALESCE((SELECT SUM(mp.puntos) FROM movimientos_puntos mp WHERE mp.id_usuario = u.id_usuario), 0) as puntos_total
            FROM usuarios u
            LEFT JOIN tareas t ON u.id_usuario = t.id_empleado AND t.estado IN ('finalizada','finalizada_atrasada') AND t.eliminado = 0
            WHERE u.id_empresa = ? AND u.rol = 'EMPLEADO' AND u.estado = 1
            GROUP BY u.id_usuario, u.nombre
            ORDER BY puntos_total DESC
            LIMIT 10
        `, id_empresa);

        const actividadReciente = await db.all(`
            SELECT h.*, t.titulo as tarea_titulo, u.nombre as usuario_nombre
            FROM historial_estados_tarea h
            JOIN tareas t ON h.id_tarea = t.id_tarea
            LEFT JOIN usuarios u ON h.id_usuario = u.id_usuario
            WHERE t.id_empresa = ?
            ORDER BY h.fecha DESC
            LIMIT 10
        `, id_empresa);

        const porSupervisor = await db.all(`
            SELECT u.nombre, u.id_usuario,
                   COUNT(t.id_tarea) as total_tareas,
                   COALESCE(SUM(CASE WHEN t.estado IN ('finalizada','finalizada_atrasada') THEN 1 ELSE 0 END), 0) as completadas,
                   COALESCE(SUM(CASE WHEN t.estado = 'finalizada' THEN 1 ELSE 0 END), 0) as a_tiempo
            FROM usuarios u
            LEFT JOIN tareas t ON u.id_usuario = t.id_supervisor AND t.eliminado = 0
            WHERE u.id_empresa = ? AND u.rol = 'SUPERVISOR' AND u.estado = 1
            GROUP BY u.id_usuario, u.nombre
            ORDER BY completadas DESC
        `, id_empresa);

        res.json({
            usuarios: { supervisores: totalSupervisores, empleados: totalEmpleados },
            tareas: {
                total: tareasTotal, pendientes: tareasPendientes, en_proceso: tareasEnProceso,
                finalizadas: tareasFinalizadas, atrasadas: tareasAtrasadas, a_tiempo: tareasAtiempo
            },
            kpis: { eficiencia, productividad_7d: productividad7d, tiempo_promedio_min: avgMinutos },
            porPrioridad, topEmpleados, actividadReciente, porSupervisor
        });
    } catch (err) {
        console.error('Error en dashboard:', err);
        res.status(500).json({ error: 'Error al obtener datos del dashboard' });
    }
});

// ═══════════════════════════════════════════
// RANKING / GAMIFICACIÓN
// ═══════════════════════════════════════════

router.get('/ranking', verificarToken, async (req, res) => {
    try {
        const id_empresa = req.usuario.id_empresa;

        const ranking = await db.all(`
            SELECT u.id_usuario, u.nombre, u.rol, u.foto_url,
                   COALESCE((SELECT SUM(mp.puntos) FROM movimientos_puntos mp WHERE mp.id_usuario = u.id_usuario), 0) as puntos_total,
                   (SELECT COUNT(*) FROM tareas t WHERE t.id_empleado = u.id_usuario AND t.estado = 'finalizada' AND t.eliminado = 0) as tareas_a_tiempo,
                   (SELECT COUNT(*) FROM tareas t WHERE t.id_empleado = u.id_usuario AND t.estado = 'finalizada_atrasada' AND t.eliminado = 0) as tareas_atrasadas,
                   (SELECT COUNT(*) FROM tareas t WHERE t.id_empleado = u.id_usuario AND t.estado IN ('finalizada','finalizada_atrasada') AND t.eliminado = 0) as total_completadas
            FROM usuarios u
            WHERE u.id_empresa = ? AND u.rol IN ('SUPERVISOR','EMPLEADO') AND u.estado = 1
            ORDER BY puntos_total DESC
        `, id_empresa);

        ranking.forEach((r, i) => {
            r.posicion = i + 1;
            if (i === 0) r.medalla = '🥇';
            else if (i === 1) r.medalla = '🥈';
            else if (i === 2) r.medalla = '🥉';
            else r.medalla = '';
            if (r.puntos_total >= 500) r.nivel = 'Maestro';
            else if (r.puntos_total >= 200) r.nivel = 'Experto';
            else if (r.puntos_total >= 100) r.nivel = 'Avanzado';
            else if (r.puntos_total >= 50) r.nivel = 'Intermedio';
            else r.nivel = 'Novato';
            r.eficiencia = r.total_completadas > 0 ? Math.round((r.tareas_a_tiempo / r.total_completadas) * 100) : 0;
        });

        res.json(ranking);
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener ranking' });
    }
});

router.get('/movimientos/:id_usuario', verificarToken, async (req, res) => {
    try {
        const movimientos = await db.all(`
            SELECT mp.*, t.titulo as tarea_titulo
            FROM movimientos_puntos mp LEFT JOIN tareas t ON mp.id_tarea = t.id_tarea
            WHERE mp.id_usuario = ? ORDER BY mp.fecha DESC LIMIT 50
        `, req.params.id_usuario);

        const totalRow = await db.get('SELECT COALESCE(SUM(puntos),0) as total FROM movimientos_puntos WHERE id_usuario = ?', req.params.id_usuario);
        res.json({ movimientos, totalPuntos: totalRow.total });
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener movimientos' });
    }
});

// ═══════════════════════════════════════════
// NOTIFICACIONES
// ═══════════════════════════════════════════

router.get('/notificaciones', verificarToken, async (req, res) => {
    try {
        const notificaciones = await db.all(`
            SELECT * FROM notificaciones WHERE id_usuario = ? ORDER BY fecha DESC LIMIT 50
        `, req.usuario.id_usuario);
        const noLeidasRow = await db.get('SELECT COUNT(*) as c FROM notificaciones WHERE id_usuario = ? AND leido = 0', req.usuario.id_usuario);
        res.json({ notificaciones, noLeidas: noLeidasRow.c });
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener notificaciones' });
    }
});

router.put('/notificaciones/leer-todas', verificarToken, async (req, res) => {
    try {
        await db.run('UPDATE notificaciones SET leido = 1 WHERE id_usuario = ? AND leido = 0', req.usuario.id_usuario);
        res.json({ mensaje: 'Todas las notificaciones marcadas como leídas' });
    } catch (err) {
        res.status(500).json({ error: 'Error' });
    }
});

module.exports = router;
