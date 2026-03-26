const express = require('express');
const router = express.Router();
const { db } = require('../database/init');
const { verificarToken, verificarRol, registrarAuditoria } = require('../middleware/auth');

// ═══════════════════════════════════════════
// DASHBOARD EJECUTIVO + KPIs
// ═══════════════════════════════════════════

/**
 * GET /api/dashboard
 * Dashboard ejecutivo con todos los KPIs
 */
router.get('/', verificarToken, (req, res) => {
    try {
        const id_empresa = req.usuario.id_empresa;

        // ── Usuarios ──
        const totalSupervisores = db.prepare('SELECT COUNT(*) as c FROM usuarios WHERE id_empresa = ? AND rol = ? AND estado = 1').get(id_empresa, 'SUPERVISOR').c;
        const totalEmpleados = db.prepare('SELECT COUNT(*) as c FROM usuarios WHERE id_empresa = ? AND rol = ? AND estado = 1').get(id_empresa, 'EMPLEADO').c;

        // ── Tareas ──
        const tareasTotal = db.prepare('SELECT COUNT(*) as c FROM tareas WHERE id_empresa = ? AND eliminado = 0').get(id_empresa).c;
        const tareasPendientes = db.prepare('SELECT COUNT(*) as c FROM tareas WHERE id_empresa = ? AND estado = ? AND eliminado = 0').get(id_empresa, 'pendiente').c;
        const tareasEnProceso = db.prepare('SELECT COUNT(*) as c FROM tareas WHERE id_empresa = ? AND estado = ? AND eliminado = 0').get(id_empresa, 'en_proceso').c;
        const tareasFinalizadas = db.prepare('SELECT COUNT(*) as c FROM tareas WHERE id_empresa = ? AND estado IN (?,?) AND eliminado = 0').get(id_empresa, 'finalizada', 'finalizada_atrasada').c;
        const tareasAtrasadas = db.prepare('SELECT COUNT(*) as c FROM tareas WHERE id_empresa = ? AND estado = ? AND eliminado = 0').get(id_empresa, 'atrasada').c;
        const tareasAtiempo = db.prepare('SELECT COUNT(*) as c FROM tareas WHERE id_empresa = ? AND estado = ? AND eliminado = 0').get(id_empresa, 'finalizada').c;

        // ── KPI: Eficiencia ──
        const eficiencia = tareasFinalizadas > 0 ? Math.round((tareasAtiempo / tareasFinalizadas) * 100) : 0;

        // ── KPI: Productividad (tareas finalizadas últimos 7 días) ──
        const hace7dias = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
        const productividad7d = db.prepare('SELECT COUNT(*) as c FROM tareas WHERE id_empresa = ? AND estado IN (?,?) AND fecha_fin >= ? AND eliminado = 0').get(id_empresa, 'finalizada', 'finalizada_atrasada', hace7dias).c;

        // ── KPI: Tiempo promedio real (en minutos) ──
        const tiempoPromedio = db.prepare('SELECT AVG(st.tiempo_real_segundos) as avg_seg FROM seguimiento_tiempo st JOIN tareas t ON st.id_tarea = t.id_tarea WHERE t.id_empresa = ? AND st.tiempo_real_segundos > 0').get(id_empresa);
        const avgMinutos = tiempoPromedio && tiempoPromedio.avg_seg ? Math.round(tiempoPromedio.avg_seg / 60) : 0;

        // ── Tareas por prioridad ──
        const porPrioridad = db.prepare(`
            SELECT prioridad, COUNT(*) as total FROM tareas 
            WHERE id_empresa = ? AND eliminado = 0 
            GROUP BY prioridad
        `).all(id_empresa);

        // ── Top empleados (por tareas completadas) ──
        const topEmpleados = db.prepare(`
            SELECT u.nombre, u.id_usuario, 
                   COUNT(t.id_tarea) as tareas_completadas,
                   COALESCE(SUM(CASE WHEN t.estado = 'finalizada' THEN 1 ELSE 0 END), 0) as a_tiempo,
                   COALESCE(SUM(CASE WHEN t.estado = 'finalizada_atrasada' THEN 1 ELSE 0 END), 0) as atrasadas,
                   COALESCE((SELECT SUM(mp.puntos) FROM movimientos_puntos mp WHERE mp.id_usuario = u.id_usuario), 0) as puntos_total
            FROM usuarios u
            LEFT JOIN tareas t ON u.id_usuario = t.id_empleado AND t.estado IN ('finalizada','finalizada_atrasada') AND t.eliminado = 0
            WHERE u.id_empresa = ? AND u.rol = 'EMPLEADO' AND u.estado = 1
            GROUP BY u.id_usuario
            ORDER BY puntos_total DESC
            LIMIT 10
        `).all(id_empresa);

        // ── Actividad reciente (últimas 10 acciones) ──
        const actividadReciente = db.prepare(`
            SELECT h.*, t.titulo as tarea_titulo, u.nombre as usuario_nombre
            FROM historial_estados_tarea h
            JOIN tareas t ON h.id_tarea = t.id_tarea
            LEFT JOIN usuarios u ON h.id_usuario = u.id_usuario
            WHERE t.id_empresa = ?
            ORDER BY h.fecha DESC
            LIMIT 10
        `).all(id_empresa);

        // ── Rendimiento por supervisor ──
        const porSupervisor = db.prepare(`
            SELECT u.nombre, u.id_usuario,
                   COUNT(t.id_tarea) as total_tareas,
                   COALESCE(SUM(CASE WHEN t.estado IN ('finalizada','finalizada_atrasada') THEN 1 ELSE 0 END), 0) as completadas,
                   COALESCE(SUM(CASE WHEN t.estado = 'finalizada' THEN 1 ELSE 0 END), 0) as a_tiempo
            FROM usuarios u
            LEFT JOIN tareas t ON u.id_usuario = t.id_supervisor AND t.eliminado = 0
            WHERE u.id_empresa = ? AND u.rol = 'SUPERVISOR' AND u.estado = 1
            GROUP BY u.id_usuario
            ORDER BY completadas DESC
        `).all(id_empresa);

        res.json({
            usuarios: { supervisores: totalSupervisores, empleados: totalEmpleados },
            tareas: {
                total: tareasTotal, pendientes: tareasPendientes, en_proceso: tareasEnProceso,
                finalizadas: tareasFinalizadas, atrasadas: tareasAtrasadas, a_tiempo: tareasAtiempo
            },
            kpis: {
                eficiencia, productividad_7d: productividad7d, 
                tiempo_promedio_min: avgMinutos
            },
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

/**
 * GET /api/dashboard/ranking
 * Ranking de gamificación por empresa
 */
router.get('/ranking', verificarToken, (req, res) => {
    try {
        const id_empresa = req.usuario.id_empresa;

        const ranking = db.prepare(`
            SELECT u.id_usuario, u.nombre, u.rol, u.foto_url,
                   COALESCE((SELECT SUM(mp.puntos) FROM movimientos_puntos mp WHERE mp.id_usuario = u.id_usuario), 0) as puntos_total,
                   (SELECT COUNT(*) FROM tareas t WHERE t.id_empleado = u.id_usuario AND t.estado = 'finalizada' AND t.eliminado = 0) as tareas_a_tiempo,
                   (SELECT COUNT(*) FROM tareas t WHERE t.id_empleado = u.id_usuario AND t.estado = 'finalizada_atrasada' AND t.eliminado = 0) as tareas_atrasadas,
                   (SELECT COUNT(*) FROM tareas t WHERE t.id_empleado = u.id_usuario AND t.estado IN ('finalizada','finalizada_atrasada') AND t.eliminado = 0) as total_completadas
            FROM usuarios u
            WHERE u.id_empresa = ? AND u.rol IN ('SUPERVISOR','EMPLEADO') AND u.estado = 1
            ORDER BY puntos_total DESC
        `).all(id_empresa);

        // Asignar posiciones y medallas
        ranking.forEach((r, i) => {
            r.posicion = i + 1;
            if (i === 0) r.medalla = '🥇';
            else if (i === 1) r.medalla = '🥈';
            else if (i === 2) r.medalla = '🥉';
            else r.medalla = '';
            // Nivel basado en puntos
            if (r.puntos_total >= 500) r.nivel = 'Maestro';
            else if (r.puntos_total >= 200) r.nivel = 'Experto';
            else if (r.puntos_total >= 100) r.nivel = 'Avanzado';
            else if (r.puntos_total >= 50) r.nivel = 'Intermedio';
            else r.nivel = 'Novato';
            // Eficiencia personal
            r.eficiencia = r.total_completadas > 0 ? Math.round((r.tareas_a_tiempo / r.total_completadas) * 100) : 0;
        });

        res.json(ranking);
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener ranking' });
    }
});

/**
 * GET /api/dashboard/movimientos/:id_usuario
 * Historial de puntos de un usuario
 */
router.get('/movimientos/:id_usuario', verificarToken, (req, res) => {
    try {
        const movimientos = db.prepare(`
            SELECT mp.*, t.titulo as tarea_titulo
            FROM movimientos_puntos mp
            LEFT JOIN tareas t ON mp.id_tarea = t.id_tarea
            WHERE mp.id_usuario = ?
            ORDER BY mp.fecha DESC
            LIMIT 50
        `).all(req.params.id_usuario);

        const totalPuntos = db.prepare('SELECT COALESCE(SUM(puntos),0) as total FROM movimientos_puntos WHERE id_usuario = ?')
            .get(req.params.id_usuario).total;

        res.json({ movimientos, totalPuntos });
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener movimientos' });
    }
});

// ═══════════════════════════════════════════
// NOTIFICACIONES
// ═══════════════════════════════════════════

/**
 * GET /api/dashboard/notificaciones
 */
router.get('/notificaciones', verificarToken, (req, res) => {
    try {
        const notificaciones = db.prepare(`
            SELECT * FROM notificaciones
            WHERE id_usuario = ?
            ORDER BY fecha DESC
            LIMIT 50
        `).all(req.usuario.id_usuario);

        const noLeidas = db.prepare('SELECT COUNT(*) as c FROM notificaciones WHERE id_usuario = ? AND leido = 0')
            .get(req.usuario.id_usuario).c;

        res.json({ notificaciones, noLeidas });
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener notificaciones' });
    }
});

/**
 * PUT /api/dashboard/notificaciones/leer-todas
 */
router.put('/notificaciones/leer-todas', verificarToken, (req, res) => {
    try {
        db.prepare('UPDATE notificaciones SET leido = 1 WHERE id_usuario = ? AND leido = 0')
            .run(req.usuario.id_usuario);
        res.json({ mensaje: 'Todas las notificaciones marcadas como leídas' });
    } catch (err) {
        res.status(500).json({ error: 'Error' });
    }
});

module.exports = router;
