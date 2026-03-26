const express = require('express');
const router = express.Router();
const { db } = require('../database/init');
const { verificarToken, verificarRol } = require('../middleware/auth');

// ═══════════════════════════════════════════
// AUDITORÍA – Logs de acciones
// ═══════════════════════════════════════════

router.get('/', verificarToken, verificarRol('ADMIN'), async (req, res) => {
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

        const logs = await db.all(sql, ...params);
        const totalRow = await db.get('SELECT COUNT(*) as c FROM auditoria WHERE id_empresa = ?', id_empresa);
        res.json({ logs, total: totalRow.c });
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener auditoría' });
    }
});

router.get('/exportar', verificarToken, verificarRol('ADMIN'), async (req, res) => {
    try {
        const id_empresa = req.usuario.id_empresa;
        const { desde, hasta } = req.query;

        let sql = `
            SELECT a.fecha, u.nombre as usuario, u.rol, a.accion, a.descripcion
            FROM auditoria a LEFT JOIN usuarios u ON a.id_usuario = u.id_usuario
            WHERE a.id_empresa = ?
        `;
        const params = [id_empresa];
        if (desde) { sql += ' AND a.fecha >= ?'; params.push(desde); }
        if (hasta) { sql += ' AND a.fecha <= ?'; params.push(hasta + ' 23:59:59'); }
        sql += ' ORDER BY a.fecha DESC';

        const logs = await db.all(sql, ...params);

        const header = 'Fecha,Usuario,Rol,Acción,Descripción\n';
        const rows = logs.map(l =>
            `"${l.fecha || ''}","${l.usuario || 'Sistema'}","${l.rol || ''}","${l.accion || ''}","${(l.descripcion || '').replace(/"/g, '""')}"`
        ).join('\n');

        const csv = '\uFEFF' + header + rows;
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="auditoria_${new Date().toISOString().split('T')[0]}.csv"`);
        res.send(csv);
    } catch (err) {
        res.status(500).json({ error: 'Error al exportar auditoría' });
    }
});

// ═══════════════════════════════════════════
// ACCESOS
// ═══════════════════════════════════════════

router.get('/accesos', verificarToken, verificarRol('ADMIN'), async (req, res) => {
    try {
        const id_empresa = req.usuario.id_empresa;
        const { limite = 50 } = req.query;
        const accesos = await db.all(`
            SELECT ac.*, u.nombre as nombre_usuario, u.rol
            FROM accesos ac JOIN usuarios u ON ac.id_usuario = u.id_usuario
            WHERE u.id_empresa = ? ORDER BY ac.fecha_login DESC LIMIT ?
        `, id_empresa, parseInt(limite));
        res.json(accesos);
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener accesos' });
    }
});

router.get('/accesos/exportar', verificarToken, verificarRol('ADMIN'), async (req, res) => {
    try {
        const id_empresa = req.usuario.id_empresa;
        const accesos = await db.all(`
            SELECT ac.fecha_login, u.nombre, u.rol, ac.ip, ac.dispositivo
            FROM accesos ac JOIN usuarios u ON ac.id_usuario = u.id_usuario
            WHERE u.id_empresa = ? ORDER BY ac.fecha_login DESC
        `, id_empresa);

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

router.get('/resumen', verificarToken, verificarRol('ADMIN'), async (req, res) => {
    try {
        const id_empresa = req.usuario.id_empresa;

        const porAccion = await db.all(`
            SELECT accion, COUNT(*) as total FROM auditoria WHERE id_empresa = ? GROUP BY accion ORDER BY total DESC LIMIT 10
        `, id_empresa);

        const hace24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
        const ultimas24h = (await db.get('SELECT COUNT(*) as c FROM auditoria WHERE id_empresa = ? AND fecha >= ?', id_empresa, hace24h)).c;

        const hace7d = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
        const ultimos7d = (await db.get('SELECT COUNT(*) as c FROM auditoria WHERE id_empresa = ? AND fecha >= ?', id_empresa, hace7d)).c;

        const totalGeneral = (await db.get('SELECT COUNT(*) as c FROM auditoria WHERE id_empresa = ?', id_empresa)).c;

        const totalAccesos = (await db.get(`
            SELECT COUNT(*) as c FROM accesos ac JOIN usuarios u ON ac.id_usuario = u.id_usuario WHERE u.id_empresa = ?
        `, id_empresa)).c;

        const usuariosMasActivos = await db.all(`
            SELECT u.nombre, u.rol, COUNT(a.id_auditoria) as acciones
            FROM auditoria a JOIN usuarios u ON a.id_usuario = u.id_usuario
            WHERE a.id_empresa = ? GROUP BY a.id_usuario, u.nombre, u.rol ORDER BY acciones DESC LIMIT 5
        `, id_empresa);

        res.json({ porAccion, ultimas24h, ultimos7d, totalGeneral, totalAccesos, usuariosMasActivos });
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener resumen' });
    }
});

module.exports = router;
