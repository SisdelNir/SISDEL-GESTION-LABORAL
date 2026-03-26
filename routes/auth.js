const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { db } = require('../database/init');
const { verificarToken, registrarAcceso } = require('../middleware/auth');

/**
 * POST /api/auth/root
 * Login ROOT con clave de programador (1122)
 */
router.post('/root', (req, res) => {
    try {
        const { codigo } = req.body;

        if (!codigo) {
            return res.status(400).json({ error: 'Código requerido' });
        }

        if (codigo !== process.env.ROOT_CODE) {
            return res.status(401).json({ error: 'Código ROOT incorrecto' });
        }

        const token = jwt.sign(
            { rol: 'ROOT', id_usuario: 'ROOT' },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({
            mensaje: 'Acceso ROOT concedido',
            token,
            usuario: { rol: 'ROOT', nombre: 'Programador' }
        });
    } catch (err) {
        res.status(500).json({ error: 'Error en autenticación ROOT' });
    }
});

/**
 * POST /api/auth/login
 * Login de usuario con código de acceso
 */
router.post('/login', async (req, res) => {
    try {
        const { codigo_acceso } = req.body;

        if (!codigo_acceso) {
            return res.status(400).json({ error: 'Código de acceso requerido' });
        }

        const usuario = await db.get(`
            SELECT u.*, e.nombre as nombre_empresa, e.logo_url as logo_empresa
            FROM usuarios u
            JOIN empresas e ON u.id_empresa = e.id_empresa
            WHERE u.codigo_acceso = ? AND u.eliminado = 0 AND u.estado = 1
        `, codigo_acceso);

        if (!usuario) {
            return res.status(401).json({ error: 'Código de acceso inválido' });
        }

        // Verificar bloqueo
        if (usuario.bloqueado_hasta) {
            const bloqueoHasta = new Date(usuario.bloqueado_hasta);
            if (bloqueoHasta > new Date()) {
                const minutosRestantes = Math.ceil((bloqueoHasta - new Date()) / 60000);
                return res.status(423).json({
                    error: `Cuenta bloqueada. Intenta en ${minutosRestantes} minutos`
                });
            }
            // Desbloquear si ya pasó el tiempo
            await db.run('UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id_usuario = ?',
                usuario.id_usuario);
        }

        // Verificar empresa activa
        const empresa = await db.get('SELECT * FROM empresas WHERE id_empresa = ? AND eliminado = 0',
            usuario.id_empresa);

        if (!empresa) {
            return res.status(403).json({ error: 'La empresa está desactivada' });
        }

        const token = jwt.sign(
            {
                id_usuario: usuario.id_usuario,
                id_empresa: usuario.id_empresa,
                rol: usuario.rol,
                nombre: usuario.nombre
            },
            process.env.JWT_SECRET,
            { expiresIn: '12h' }
        );

        // Registrar acceso
        const ip = req.ip || req.connection.remoteAddress;
        const dispositivo = req.headers['user-agent'] || 'Desconocido';
        registrarAcceso(usuario.id_usuario, ip, dispositivo);

        // Obtener configuración de empresa
        const config = await db.get('SELECT * FROM configuraciones_empresa WHERE id_empresa = ?',
            usuario.id_empresa);

        res.json({
            mensaje: 'Inicio de sesión exitoso',
            token,
            usuario: {
                id_usuario: usuario.id_usuario,
                nombre: usuario.nombre,
                rol: usuario.rol,
                correo: usuario.correo,
                telefono: usuario.telefono,
                foto_url: usuario.foto_url,
                codigo_acceso: usuario.codigo_acceso,
                id_empresa: usuario.id_empresa,
                nombre_empresa: usuario.nombre_empresa,
                logo_empresa: usuario.logo_empresa
            },
            configuracion: config || {}
        });
    } catch (err) {
        console.error('Error en login:', err);
        res.status(500).json({ error: 'Error en autenticación' });
    }
});

/**
 * POST /api/auth/logout
 */
router.post('/logout', verificarToken, (req, res) => {
    res.json({ mensaje: 'Sesión cerrada correctamente' });
});

/**
 * GET /api/auth/me
 * Obtener datos del usuario autenticado
 */
router.get('/me', verificarToken, async (req, res) => {
    try {
        if (req.usuario.rol === 'ROOT') {
            return res.json({ rol: 'ROOT', nombre: 'Programador' });
        }

        const usuario = await db.get(`
            SELECT u.*, e.nombre as nombre_empresa, e.logo_url as logo_empresa
            FROM usuarios u
            JOIN empresas e ON u.id_empresa = e.id_empresa
            WHERE u.id_usuario = ? AND u.eliminado = 0
        `, req.usuario.id_usuario);

        if (!usuario) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        res.json({
            id_usuario: usuario.id_usuario,
            nombre: usuario.nombre,
            rol: usuario.rol,
            correo: usuario.correo,
            telefono: usuario.telefono,
            foto_url: usuario.foto_url,
            codigo_acceso: usuario.codigo_acceso,
            id_empresa: usuario.id_empresa,
            nombre_empresa: usuario.nombre_empresa,
            logo_empresa: usuario.logo_empresa
        });
    } catch (err) {
        res.status(500).json({ error: 'Error obteniendo datos de usuario' });
    }
});

module.exports = router;
