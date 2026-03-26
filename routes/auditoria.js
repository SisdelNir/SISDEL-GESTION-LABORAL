const express = require('express');
const router = express.Router();
const { db } = require('../database/init');
const { verificarToken, verificarRol } = require('../middleware/auth');

// ═══════════════════════════════════════════
// AUDITORÍA – Logs de acciones
// ═══════════════════════════════════════════

/**
 * GET /api/auditoria
 * Listar logs de auditoría con filtros
 */
router.get('/', verificarToken, verificarRol('ADMIN'), (req, res) => {
    try {
        const id_empresa = req.usuario.id_empresa;
        const { accion, usuario, desde, hasta, limite = 100 } = req.query;

        let sql = `
            SELECT a.*, u.nombre as nombre_usuario, u.rol as rol_usuario
            FROM auditoria a
            LEFT JOIN usuarios u ON a.id_usuario = u.id_usuario
            WHERE a.id_empresa = ?
        `;
        const params = [id_empresa];

        if (accion) { sql += ' AND a.accion LIKE ?'; params.push(`%${accion}%`); }
        if (usuario) { sql += ' AND u.nombre LIKE ?'; params.push(`%${usuario}%`); }
        if (desde) { sql += ' AND a.fecha >= ?'; params.push(desde); }
        if (hasta) { sql += ' AND a.fecha <= ?'; params.push(hasta + ' 23:59:59'); }

        sql += ' ORDER BY a.fecha DESC LIMIT ?';
        params.push(parseInt(limite));

        const logs = db.prepare(sql).all(...params);

        // Conteo total
        const total = db.prepare('SELECT COUNT(*) as c FROM auditoria WHERE id_empresa = ?').get(id_empresa).c;

        res.json({ logs, total });
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener auditoría' });
    }
});

/**
 * GET /api/auditoria/exportar
 * Exportar logs como CSV
 */
router.get('/exportar', verificarToken, verificarRol('ADMIN'), (req, res) => {
    try {
        const id_empresa = req.usuario.id_empresa;
        const { desde, hasta } = req.query;

        let sql = `
            SELECT a.fecha, u.nombre as usuario, u.rol, a.accion, a.descripcion
            FROM auditoria a
            LEFT JOIN usuarios u ON a.id_usuario = u.id_usuario
            WHERE a.id_empresa = ?
        `;
        const params = [id_empresa];

        if (desde) { sql += ' AND a.fecha >= ?'; params.push(desde); }
        if (hasta) { sql += ' AND a.fecha <= ?'; params.push(hasta + ' 23:59:59'); }

        sql += ' ORDER BY a.fecha DESC';

        const logs = db.prepare(sql).all(...params);

        // Generar CSV
        const header = 'Fecha,Usuario,Rol,Acción,Descripción\n';
        const rows = logs.map(l =>
            `"${l.fecha || ''}","${l.usuario || 'Sistema'}","${l.rol || ''}","${l.accion || ''}","${(l.descripcion || '').replace(/"/g, '""')}"`
        ).join('\n');

        const csv = '\uFEFF' + header + rows; // BOM para Excel

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="auditoria_${new Date().toISOString().split('T')[0]}.csv"`);
        res.send(csv);
    } catch (err) {
        res.status(500).json({ error: 'Error al exportar auditoría' });
    }
});

// ═══════════════════════════════════════════
// ACCESOS – Log de logins
// ═══════════════════════════════════════════

/**
 * GET /api/auditoria/accesos
 */
router.get('/accesos', verificarToken, verificarRol('ADMIN'), (req, res) => {
    try {
        const id_empresa = req.usuario.id_empresa;
        const { limite = 50 } = req.query;

        const accesos = db.prepare(`
            SELECT ac.*, u.nombre as nombre_usuario, u.rol
            FROM accesos ac
            JOIN usuarios u ON ac.id_usuario = u.id_usuario
            WHERE u.id_empresa = ?
            ORDER BY ac.fecha_login DESC
            LIMIT ?
        `).all(id_empresa, parseInt(limite));

        res.json(accesos);
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener accesos' });
    }
});

/**
 * GET /api/auditoria/accesos/exportar
 */
router.get('/accesos/exportar', verificarToken, verificarRol('ADMIN'), (req, res) => {
    try {
        const id_empresa = req.usuario.id_empresa;

        const accesos = db.prepare(`
            SELECT ac.fecha_login, u.nombre, u.rol, ac.ip, ac.dispositivo
            FROM accesos ac
            JOIN usuarios u ON ac.id_usuario = u.id_usuario
            WHERE u.id_empresa = ?
            ORDER BY ac.fecha_login DESC
        `).all(id_empresa);

        const header = 'Fecha Login,Usuario,Rol,IP,Dispositivo\n';
        const rows = accesos.map(a =>
            `"${a.fecha_login || ''}","${a.nombre || ''}","${a.rol || ''}","${a.ip || ''}","${(a.dispositivo || '').replace(/"/g, '""')}"`
        ).join('\n');

        const csv = '\uFEFF' + header + rows;

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="accesos_${new Date().toISOString().split('T')[0]}.csv"`);
        res.send(csv);
    } catch (err) {
        res.status(500).json({ error: 'Error al exportar accesos' });
    }
});

/**
 * GET /api/auditoria/resumen
 * Resumen de actividad de auditoría
 */
router.get('/resumen', verificarToken, verificarRol('ADMIN'), (req, res) => {
    try {
        const id_empresa = req.usuario.id_empresa;

        // Acciones por tipo
        const porAccion = db.prepare(`
            SELECT accion, COUNT(*) as total FROM auditoria 
            WHERE id_empresa = ? 
            GROUP BY accion ORDER BY total DESC LIMIT 10
        `).all(id_empresa);

        // Actividad últimas 24h
        const hace24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
        const ultimas24h = db.prepare('SELECT COUNT(*) as c FROM auditoria WHERE id_empresa = ? AND fecha >= ?').get(id_empresa, hace24h).c;

        // Actividad últimos 7 días
        const hace7d = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
        const ultimos7d = db.prepare('SELECT COUNT(*) as c FROM auditoria WHERE id_empresa = ? AND fecha >= ?').get(id_empresa, hace7d).c;

        // Total general
        const totalGeneral = db.prepare('SELECT COUNT(*) as c FROM auditoria WHERE id_empresa = ?').get(id_empresa).c;

        // Total accesos
        const totalAccesos = db.prepare(`
            SELECT COUNT(*) as c FROM accesos ac 
            JOIN usuarios u ON ac.id_usuario = u.id_usuario 
            WHERE u.id_empresa = ?
        `).get(id_empresa).c;

        // Usuarios más activos
        const usuariosMasActivos = db.prepare(`
            SELECT u.nombre, u.rol, COUNT(a.id_auditoria) as acciones
            FROM auditoria a
            JOIN usuarios u ON a.id_usuario = u.id_usuario
            WHERE a.id_empresa = ?
            GROUP BY a.id_usuario
            ORDER BY acciones DESC LIMIT 5
        `).all(id_empresa);

        res.json({
            porAccion, ultimas24h, ultimos7d, totalGeneral, totalAccesos,
            usuariosMasActivos
        });
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener resumen' });
    }
});

module.exports = router;
