const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { db } = require('../database/init');
const { verificarToken, verificarRol, verificarEmpresa, registrarAuditoria } = require('../middleware/auth');
const { generarCodigoAcceso } = require('../utils/codigoAcceso');

/**
 * POST /api/usuarios
 * Crear usuario (supervisor o empleado)
 */
router.post('/', verificarToken, verificarRol('ADMIN', 'SUPERVISOR'), (req, res) => {
    try {
        const {
            nombre,
            identificacion,
            telefono,
            correo,
            rol,
            id_departamento,
            id_supervisor
        } = req.body;

        if (!nombre || !rol) {
            return res.status(400).json({ error: 'Nombre y rol son requeridos' });
        }

        if (!['SUPERVISOR', 'EMPLEADO'].includes(rol)) {
            return res.status(400).json({ error: 'Rol debe ser SUPERVISOR o EMPLEADO' });
        }

        // Solo ADMIN puede crear supervisores
        if (rol === 'SUPERVISOR' && req.usuario.rol !== 'ADMIN') {
            return res.status(403).json({ error: 'Solo el administrador puede crear supervisores' });
        }

        const id_empresa = req.usuario.id_empresa;

        // Obtener nombre de empresa para generar código
        const empresa = db.prepare('SELECT nombre FROM empresas WHERE id_empresa = ?').get(id_empresa);
        if (!empresa) {
            return res.status(404).json({ error: 'Empresa no encontrada' });
        }

        const id_usuario = uuidv4();
        const codigo_acceso = generarCodigoAcceso(empresa.nombre);

        db.prepare(`
            INSERT INTO usuarios (id_usuario, id_empresa, identificacion, nombre, telefono, correo, rol, codigo_acceso, id_departamento)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id_usuario, id_empresa, identificacion || '', nombre, telefono || '', correo || '', rol, codigo_acceso, id_departamento || null);

        // Si es empleado y se especificó supervisor, crear relación
        if (rol === 'EMPLEADO' && id_supervisor) {
            db.prepare(`
                INSERT INTO supervisores_empleados (id_relacion, id_supervisor, id_empleado)
                VALUES (?, ?, ?)
            `).run(uuidv4(), id_supervisor, id_usuario);
        }

        // Si es supervisor, asignar permisos por defecto
        if (rol === 'SUPERVISOR') {
            const permisosDefault = ['ASIGNAR_TAREAS', 'VER_REPORTES', 'VER_EVIDENCIAS'];
            const permisos = db.prepare(`SELECT id_permiso FROM permisos WHERE codigo IN (${permisosDefault.map(() => '?').join(',')})`).all(...permisosDefault);

            const insertPermiso = db.prepare('INSERT OR IGNORE INTO rol_permisos (id_rol, id_permiso, id_empresa) VALUES (?, ?, ?)');
            for (const p of permisos) {
                insertPermiso.run('SUPERVISOR', p.id_permiso, id_empresa);
            }
        }

        registrarAuditoria(id_empresa, req.usuario.id_usuario, 'CREAR_USUARIO', `Usuario "${nombre}" creado con rol ${rol}`);

        res.status(201).json({
            mensaje: 'Usuario creado exitosamente',
            usuario: {
                id_usuario,
                nombre,
                rol,
                codigo_acceso,
                id_empresa
            }
        });
    } catch (err) {
        console.error('Error creando usuario:', err);
        res.status(500).json({ error: 'Error al crear usuario: ' + err.message });
    }
});

/**
 * GET /api/usuarios
 * Listar usuarios de la empresa
 */
router.get('/', verificarToken, verificarRol('ADMIN', 'SUPERVISOR'), (req, res) => {
    try {
        const id_empresa = req.usuario.id_empresa;
        const { rol, departamento } = req.query;

        let query = `
            SELECT u.*, d.nombre as nombre_departamento
            FROM usuarios u
            LEFT JOIN departamentos d ON u.id_departamento = d.id_departamento
            WHERE u.id_empresa = ? AND u.eliminado = 0
        `;
        const params = [id_empresa];

        if (rol) {
            query += ' AND u.rol = ?';
            params.push(rol);
        }

        if (departamento) {
            query += ' AND u.id_departamento = ?';
            params.push(departamento);
        }

        // Si es supervisor, solo ver sus empleados asignados
        if (req.usuario.rol === 'SUPERVISOR') {
            // Verificar si tiene acceso global
            const tieneAccesoGlobal = db.prepare(`
                SELECT 1 FROM permisos_usuario pu
                JOIN permisos p ON pu.id_permiso = p.id_permiso
                WHERE pu.id_usuario = ? AND p.codigo = 'VER_TODOS_EMPLEADOS' AND pu.concedido = 1
            `).get(req.usuario.id_usuario);

            if (!tieneAccesoGlobal) {
                query += ` AND (u.id_usuario = ? OR u.id_usuario IN (
                    SELECT id_empleado FROM supervisores_empleados WHERE id_supervisor = ?
                ))`;
                params.push(req.usuario.id_usuario, req.usuario.id_usuario);
            }
        }

        query += ' ORDER BY u.rol, u.nombre';

        const usuarios = db.prepare(query).all(...params);

        // Para cada supervisor, contar empleados asignados
        const result = usuarios.map(u => {
            if (u.rol === 'SUPERVISOR') {
                const empleados = db.prepare(`
                    SELECT COUNT(*) as total FROM supervisores_empleados WHERE id_supervisor = ?
                `).get(u.id_usuario);
                return { ...u, total_empleados: empleados.total };
            }
            if (u.rol === 'EMPLEADO') {
                const supervisor = db.prepare(`
                    SELECT u.nombre as nombre_supervisor, u.id_usuario as id_supervisor
                    FROM supervisores_empleados se
                    JOIN usuarios u ON se.id_supervisor = u.id_usuario
                    WHERE se.id_empleado = ?
                `).get(u.id_usuario);
                return { ...u, supervisor: supervisor || null };
            }
            return u;
        });

        res.json(result);
    } catch (err) {
        console.error('Error listando usuarios:', err);
        res.status(500).json({ error: 'Error al listar usuarios' });
    }
});

/**
 * GET /api/usuarios/:id
 * Detalle de usuario
 */
router.get('/:id', verificarToken, (req, res) => {
    try {
        const usuario = db.prepare(`
            SELECT u.*, d.nombre as nombre_departamento
            FROM usuarios u
            LEFT JOIN departamentos d ON u.id_departamento = d.id_departamento
            WHERE u.id_usuario = ? AND u.eliminado = 0
        `).get(req.params.id);

        if (!usuario) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        // Verificar acceso
        if (req.usuario.rol !== 'ROOT' && req.usuario.id_empresa !== usuario.id_empresa) {
            return res.status(403).json({ error: 'No tienes acceso' });
        }

        res.json(usuario);
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener usuario' });
    }
});

/**
 * PUT /api/usuarios/:id
 * Editar usuario
 */
router.put('/:id', verificarToken, verificarRol('ADMIN', 'SUPERVISOR'), (req, res) => {
    try {
        const { nombre, identificacion, telefono, correo, id_departamento, estado } = req.body;

        const usuario = db.prepare('SELECT * FROM usuarios WHERE id_usuario = ? AND eliminado = 0').get(req.params.id);
        if (!usuario) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        if (req.usuario.rol !== 'ROOT' && req.usuario.id_empresa !== usuario.id_empresa) {
            return res.status(403).json({ error: 'No tienes acceso' });
        }

        db.prepare(`
            UPDATE usuarios SET
                nombre = COALESCE(?, nombre),
                identificacion = COALESCE(?, identificacion),
                telefono = COALESCE(?, telefono),
                correo = COALESCE(?, correo),
                id_departamento = COALESCE(?, id_departamento),
                estado = COALESCE(?, estado)
            WHERE id_usuario = ?
        `).run(nombre, identificacion, telefono, correo, id_departamento, estado, req.params.id);

        registrarAuditoria(usuario.id_empresa, req.usuario.id_usuario, 'EDITAR_USUARIO', `Usuario "${usuario.nombre}" actualizado`);

        const actualizado = db.prepare('SELECT * FROM usuarios WHERE id_usuario = ?').get(req.params.id);
        res.json({ mensaje: 'Usuario actualizado', usuario: actualizado });
    } catch (err) {
        res.status(500).json({ error: 'Error al actualizar usuario' });
    }
});

/**
 * DELETE /api/usuarios/:id (Soft Delete)
 */
router.delete('/:id', verificarToken, verificarRol('ADMIN'), (req, res) => {
    try {
        const usuario = db.prepare('SELECT * FROM usuarios WHERE id_usuario = ? AND eliminado = 0').get(req.params.id);
        if (!usuario) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        if (req.usuario.id_empresa !== usuario.id_empresa) {
            return res.status(403).json({ error: 'No tienes acceso' });
        }

        // No permitir eliminar admins
        if (usuario.rol === 'ADMIN') {
            return res.status(400).json({ error: 'No se puede eliminar al administrador' });
        }

        db.prepare(`
            UPDATE usuarios SET eliminado = 1, fecha_eliminacion = datetime('now','localtime'), eliminado_por = ?
            WHERE id_usuario = ?
        `).run(req.usuario.id_usuario, req.params.id);

        registrarAuditoria(usuario.id_empresa, req.usuario.id_usuario, 'ELIMINAR_USUARIO', `Usuario "${usuario.nombre}" eliminado`);

        res.json({ mensaje: 'Usuario eliminado correctamente' });
    } catch (err) {
        res.status(500).json({ error: 'Error al eliminar usuario' });
    }
});

/**
 * POST /api/usuarios/asignar-supervisor
 * Asignar empleado a supervisor
 */
router.post('/asignar-supervisor', verificarToken, verificarRol('ADMIN'), (req, res) => {
    try {
        const { id_supervisor, id_empleado } = req.body;

        if (!id_supervisor || !id_empleado) {
            return res.status(400).json({ error: 'Se requiere id_supervisor e id_empleado' });
        }

        // Verificar que ambos existen y son de la misma empresa
        const supervisor = db.prepare('SELECT * FROM usuarios WHERE id_usuario = ? AND rol = ? AND eliminado = 0').get(id_supervisor, 'SUPERVISOR');
        const empleado = db.prepare('SELECT * FROM usuarios WHERE id_usuario = ? AND rol = ? AND eliminado = 0').get(id_empleado, 'EMPLEADO');

        if (!supervisor) return res.status(404).json({ error: 'Supervisor no encontrado' });
        if (!empleado) return res.status(404).json({ error: 'Empleado no encontrado' });
        if (supervisor.id_empresa !== empleado.id_empresa) return res.status(400).json({ error: 'Usuarios de diferentes empresas' });

        // Verificar que no exista ya la relación
        const existe = db.prepare('SELECT 1 FROM supervisores_empleados WHERE id_supervisor = ? AND id_empleado = ?')
            .get(id_supervisor, id_empleado);

        if (existe) {
            return res.status(400).json({ error: 'Esta asignación ya existe' });
        }

        db.prepare(`
            INSERT INTO supervisores_empleados (id_relacion, id_supervisor, id_empleado)
            VALUES (?, ?, ?)
        `).run(uuidv4(), id_supervisor, id_empleado);

        registrarAuditoria(req.usuario.id_empresa, req.usuario.id_usuario, 'ASIGNAR_SUPERVISOR',
            `Empleado "${empleado.nombre}" asignado a supervisor "${supervisor.nombre}"`);

        res.json({ mensaje: 'Empleado asignado al supervisor correctamente' });
    } catch (err) {
        res.status(500).json({ error: 'Error al asignar supervisor' });
    }
});

module.exports = router;
