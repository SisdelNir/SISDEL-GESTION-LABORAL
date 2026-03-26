const jwt = require('jsonwebtoken');
const { db } = require('../database/init');

/**
 * Middleware: Verificar token JWT
 */
function verificarToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Token de acceso requerido' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.usuario = decoded;
        next();
    } catch (err) {
        return res.status(403).json({ error: 'Token inválido o expirado' });
    }
}

/**
 * Middleware: Verificar que el usuario tenga uno de los roles permitidos
 */
function verificarRol(...rolesPermitidos) {
    return (req, res, next) => {
        if (!req.usuario) {
            return res.status(401).json({ error: 'No autenticado' });
        }

        // ROOT tiene acceso total
        if (req.usuario.rol === 'ROOT') {
            return next();
        }

        if (!rolesPermitidos.includes(req.usuario.rol)) {
            return res.status(403).json({ error: 'No tienes permisos para esta acción' });
        }

        next();
    };
}

/**
 * Middleware: Verificar acceso ROOT
 */
function verificarRoot(req, res, next) {
    if (!req.usuario || req.usuario.rol !== 'ROOT') {
        return res.status(403).json({ error: 'Acceso ROOT requerido' });
    }
    next();
}

/**
 * Middleware: Verificar que el usuario pertenece a la empresa
 */
function verificarEmpresa(req, res, next) {
    if (req.usuario.rol === 'ROOT') return next();

    const idEmpresa = req.params.id_empresa || req.body.id_empresa || req.query.id_empresa;

    if (idEmpresa && req.usuario.id_empresa !== idEmpresa) {
        return res.status(403).json({ error: 'No tienes acceso a esta empresa' });
    }

    next();
}

/**
 * Registrar acción en auditoría (async)
 */
async function registrarAuditoria(id_empresa, id_usuario, accion, descripcion) {
    try {
        await db.run(
            `INSERT INTO auditoria (id_empresa, id_usuario, accion, descripcion) VALUES (?, ?, ?, ?)`,
            id_empresa, id_usuario, accion, descripcion
        );
    } catch (err) {
        console.error('Error registrando auditoría:', err.message);
    }
}

/**
 * Registrar acceso (async)
 */
async function registrarAcceso(id_usuario, ip, dispositivo) {
    try {
        await db.run(
            `INSERT INTO accesos (id_usuario, ip, dispositivo) VALUES (?, ?, ?)`,
            id_usuario, ip, dispositivo
        );
    } catch (err) {
        console.error('Error registrando acceso:', err.message);
    }
}

module.exports = {
    verificarToken,
    verificarRol,
    verificarRoot,
    verificarEmpresa,
    registrarAuditoria,
    registrarAcceso
};
