/**
 * Rutas de Asistencia (Check-in / Check-out)
 */
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { db } = require('../database/init');
const { verificarToken, registrarAuditoria } = require('../middleware/auth');

/**
 * GET /api/asistencia/estado — Verificar si el usuario ya está presente hoy
 */
router.get('/estado', verificarToken, async (req, res) => {
    try {
        const id_usuario = req.usuario.id_usuario;
        const hoy = new Date().toISOString().split('T')[0];

        const registro = await db.get(
            'SELECT * FROM asistencia WHERE id_usuario = ? AND fecha = ? AND estado = ?',
            id_usuario, hoy, 'presente'
        );

        res.json({ presente: !!registro, registro: registro || null });
    } catch (err) {
        res.status(500).json({ error: 'Error al verificar estado' });
    }
});

/**
 * POST /api/asistencia/entrada — Registrar entrada
 */
router.post('/entrada', verificarToken, async (req, res) => {
    try {
        const id_usuario = req.usuario.id_usuario;
        const id_empresa = req.usuario.id_empresa;
        const hoy = new Date().toISOString().split('T')[0];
        const ahora = new Date().toISOString();
        const { lat, lng } = req.body || {};

        // Verificar que no haya ya un registro abierto hoy
        const existente = await db.get(
            'SELECT * FROM asistencia WHERE id_usuario = ? AND fecha = ? AND estado = ?',
            id_usuario, hoy, 'presente'
        );
        if (existente) return res.status(400).json({ error: 'Ya estás registrado como presente hoy' });

        // Obtener datos del usuario
        const usuario = await db.get('SELECT nombre, telefono FROM usuarios WHERE id_usuario = ?', id_usuario);

        const id_asistencia = uuidv4();
        await db.run(`
            INSERT INTO asistencia (id_asistencia, id_empresa, id_usuario, nombre_usuario, telefono, fecha, hora_entrada, lat_entrada, lng_entrada, estado)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'presente')
        `, id_asistencia, id_empresa, id_usuario, usuario?.nombre || '', usuario?.telefono || '', hoy, ahora, lat || null, lng || null);

        registrarAuditoria(id_empresa, id_usuario, 'CHECK_IN', `${usuario?.nombre} se reportó presente`);

        const io = req.app.get('io');
        if (io) {
            io.to(`empresa_${id_empresa}`).emit('asistencia_update', {
                tipo: 'entrada', id_usuario, nombre: usuario?.nombre, fecha: hoy, hora: ahora
            });
        }

        res.json({ mensaje: 'Entrada registrada', id_asistencia, hora_entrada: ahora });
    } catch (err) {
        console.error('Error registrando entrada:', err);
        res.status(500).json({ error: 'Error al registrar entrada' });
    }
});

/**
 * POST /api/asistencia/salida — Registrar salida
 */
router.post('/salida', verificarToken, async (req, res) => {
    try {
        const id_usuario = req.usuario.id_usuario;
        const id_empresa = req.usuario.id_empresa;
        const hoy = new Date().toISOString().split('T')[0];
        const ahora = new Date().toISOString();
        const { lat, lng } = req.body || {};

        const registro = await db.get(
            'SELECT * FROM asistencia WHERE id_usuario = ? AND fecha = ? AND estado = ?',
            id_usuario, hoy, 'presente'
        );
        if (!registro) return res.status(400).json({ error: 'No hay registro de entrada para hoy' });

        // Calcular duración
        const entrada = new Date(registro.hora_entrada);
        const salida = new Date(ahora);
        const duracionMin = Math.round((salida - entrada) / 60000);

        await db.run(`
            UPDATE asistencia SET hora_salida = ?, lat_salida = ?, lng_salida = ?, duracion_minutos = ?, estado = 'salida'
            WHERE id_asistencia = ?
        `, ahora, lat || null, lng || null, duracionMin, registro.id_asistencia);

        registrarAuditoria(id_empresa, id_usuario, 'CHECK_OUT', `${registro.nombre_usuario} salió del lugar de trabajo (${duracionMin} min)`);

        const io = req.app.get('io');
        if (io) {
            io.to(`empresa_${id_empresa}`).emit('asistencia_update', {
                tipo: 'salida', id_usuario, nombre: registro.nombre_usuario, fecha: hoy, hora: ahora, duracion: duracionMin
            });
        }

        res.json({ mensaje: 'Salida registrada', duracion_minutos: duracionMin });
    } catch (err) {
        console.error('Error registrando salida:', err);
        res.status(500).json({ error: 'Error al registrar salida' });
    }
});

/**
 * GET /api/asistencia — Listar asistencia (Admin)
 */
router.get('/', verificarToken, async (req, res) => {
    try {
        const id_empresa = req.usuario.id_empresa;
        const { fecha, id_usuario } = req.query;

        let query = `SELECT * FROM asistencia WHERE id_empresa = ?`;
        const params = [id_empresa];

        if (req.usuario.rol === 'GERENTE') {
            query += ` AND id_usuario IN (SELECT id_usuario FROM usuarios WHERE id_departamento = ?)`;
            params.push(req.usuario.id_departamento);
        } else if (req.usuario.rol === 'SUPERVISOR') {
            const tieneAccesoGlobal = await db.get(`
                SELECT 1 FROM permisos_usuario pu
                JOIN permisos p ON pu.id_permiso = p.id_permiso
                WHERE pu.id_usuario = ? AND p.codigo = 'VER_TODOS_EMPLEADOS' AND pu.concedido = 1
            `, req.usuario.id_usuario);

            if (!tieneAccesoGlobal) {
                query += ` AND (id_usuario = ? OR id_usuario IN (
                    SELECT id_empleado FROM supervisores_empleados WHERE id_supervisor = ?
                ))`;
                params.push(req.usuario.id_usuario, req.usuario.id_usuario);
            }
        }

        if (fecha) {
            query += ' AND fecha = ?';
            params.push(fecha);
        }
        if (id_usuario) {
            query += ' AND id_usuario = ?';
            params.push(id_usuario);
        }

        query += ' ORDER BY fecha DESC, hora_entrada DESC';
        const registros = await db.all(query, ...params);
        res.json(registros);
    } catch (err) {
        res.status(500).json({ error: 'Error al listar asistencia' });
    }
});

module.exports = router;
