const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { db, isPostgres } = require('../database/init');
const { verificarToken, verificarRol, verificarEmpresa, registrarAuditoria } = require('../middleware/auth');
const { generarCodigoAcceso } = require('../utils/codigoAcceso');

/**
 * POST /api/usuarios
 */
router.post('/', verificarToken, verificarRol('ADMIN', 'SUPERVISOR', 'GERENTE'), async (req, res) => {
    try {
        const { nombre, identificacion, telefono, correo, rol, id_departamento, id_jefe } = req.body;

        if (!nombre || !rol) return res.status(400).json({ error: 'Nombre y rol son requeridos' });
        if (!['SUPERVISOR', 'EMPLEADO'].includes(rol)) return res.status(400).json({ error: 'Rol debe ser SUPERVISOR o EMPLEADO' });
        if (rol === 'SUPERVISOR' && req.usuario.rol !== 'ADMIN' && req.usuario.rol !== 'GERENTE') {
            return res.status(403).json({ error: 'Solo el administrador o gerente puede crear supervisores' });
        }

        // GERENTE auto-asigna su departamento a los usuarios que crea
        const deptoFinal = req.usuario.rol === 'GERENTE' ? req.usuario.id_departamento : (id_departamento || null);

        const id_empresa = req.usuario.id_empresa;
        const empresa = await db.get('SELECT nombre FROM empresas WHERE id_empresa = ?', id_empresa);
        if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });

        const id_usuario = uuidv4();
        const codigo_acceso = await generarCodigoAcceso(empresa.nombre);

        await db.run(`
            INSERT INTO usuarios (id_usuario, id_empresa, identificacion, nombre, telefono, correo, rol, codigo_acceso, id_departamento, id_jefe)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, id_usuario, id_empresa, identificacion || '', nombre, telefono || '', correo || '', rol, codigo_acceso, deptoFinal, id_jefe || null);

        if (rol === 'EMPLEADO' && id_jefe) {
            await db.run(`
                INSERT INTO supervisores_empleados (id_relacion, id_supervisor, id_empleado) VALUES (?, ?, ?)
            `, uuidv4(), id_jefe, id_usuario);
        }

        if (rol === 'SUPERVISOR') {
            const permisosDefault = ['ASIGNAR_TAREAS', 'VER_REPORTES', 'VER_EVIDENCIAS'];
            const placeholders = permisosDefault.map(() => '?').join(',');
            const permisos = await db.all(`SELECT id_permiso FROM permisos WHERE codigo IN (${placeholders})`, ...permisosDefault);
            for (const p of permisos) {
                try {
                    if (isPostgres) {
                        await db.run('INSERT INTO rol_permisos (id_rol, id_permiso, id_empresa) VALUES (?, ?, ?) ON CONFLICT DO NOTHING', 'SUPERVISOR', p.id_permiso, id_empresa);
                    } else {
                        await db.run('INSERT OR IGNORE INTO rol_permisos (id_rol, id_permiso, id_empresa) VALUES (?, ?, ?)', 'SUPERVISOR', p.id_permiso, id_empresa);
                    }
                } catch(e) {}
            }
        }

        registrarAuditoria(id_empresa, req.usuario.id_usuario, 'CREAR_USUARIO', `Usuario "${nombre}" creado con rol ${rol}`);

        res.status(201).json({
            mensaje: 'Usuario creado exitosamente',
            usuario: { id_usuario, nombre, rol, codigo_acceso, id_empresa }
        });
    } catch (err) {
        console.error('Error creando usuario:', err);
        res.status(500).json({ error: 'Error al crear usuario: ' + err.message });
    }
});

/**
 * GET /api/usuarios
 */
router.get('/', verificarToken, verificarRol('ADMIN', 'SUPERVISOR', 'GERENTE'), async (req, res) => {
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

        if (rol) { query += ' AND u.rol = ?'; params.push(rol); }
        if (departamento) { query += ' AND u.id_departamento = ?'; params.push(departamento); }

        if (req.usuario.rol === 'GERENTE') {
            // Gerente solo ve usuarios de SU departamento/gerencia
            query += ' AND u.id_departamento = ?';
            params.push(req.usuario.id_departamento);
        } else if (req.usuario.rol === 'SUPERVISOR') {
            const tieneAccesoGlobal = await db.get(`
                SELECT 1 FROM permisos_usuario pu
                JOIN permisos p ON pu.id_permiso = p.id_permiso
                WHERE pu.id_usuario = ? AND p.codigo = 'VER_TODOS_EMPLEADOS' AND pu.concedido = 1
            `, req.usuario.id_usuario);

            if (!tieneAccesoGlobal) {
                query += ` AND (u.id_usuario = ? OR u.id_usuario IN (
                    SELECT id_empleado FROM supervisores_empleados WHERE id_supervisor = ?
                ))`;
                params.push(req.usuario.id_usuario, req.usuario.id_usuario);
            }
        }

        query += ' ORDER BY u.rol, u.nombre';
        const usuarios = await db.all(query, ...params);

        // Enriquecer datos
        const result = [];
        for (const u of usuarios) {
            if (u.rol === 'SUPERVISOR') {
                const empleados = await db.get(`SELECT COUNT(*) as total FROM supervisores_empleados WHERE id_supervisor = ?`, u.id_usuario);
                result.push({ ...u, total_empleados: empleados ? empleados.total : 0 });
            } else if (u.rol === 'EMPLEADO') {
                const supervisor = await db.get(`
                    SELECT u.nombre as nombre_supervisor, u.id_usuario as id_supervisor
                    FROM supervisores_empleados se
                    JOIN usuarios u ON se.id_supervisor = u.id_usuario
                    WHERE se.id_empleado = ?
                `, u.id_usuario);
                result.push({ ...u, supervisor: supervisor || null });
            } else {
                result.push(u);
            }
        }

        res.json(result);
    } catch (err) {
        console.error('Error listando usuarios:', err);
        res.status(500).json({ error: 'Error al listar usuarios' });
    }
});

/**
 * GET /api/usuarios/:id
 */
router.get('/:id', verificarToken, async (req, res) => {
    try {
        const usuario = await db.get(`
            SELECT u.*, d.nombre as nombre_departamento
            FROM usuarios u
            LEFT JOIN departamentos d ON u.id_departamento = d.id_departamento
            WHERE u.id_usuario = ? AND u.eliminado = 0
        `, req.params.id);

        if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });
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
 */
router.put('/:id', verificarToken, verificarRol('ADMIN', 'SUPERVISOR', 'GERENTE'), async (req, res) => {
    try {
        const { nombre, identificacion, telefono, correo, id_departamento, id_jefe, estado } = req.body;
        const usuario = await db.get('SELECT * FROM usuarios WHERE id_usuario = ? AND eliminado = 0', req.params.id);
        if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });
        if (req.usuario.rol !== 'ROOT' && req.usuario.id_empresa !== usuario.id_empresa) {
            return res.status(403).json({ error: 'No tienes acceso' });
        }

        await db.run(`
            UPDATE usuarios SET
                nombre = COALESCE(?, nombre), identificacion = COALESCE(?, identificacion),
                telefono = COALESCE(?, telefono), correo = COALESCE(?, correo),
                id_departamento = COALESCE(?, id_departamento), id_jefe = COALESCE(?, id_jefe),
                estado = COALESCE(?, estado)
            WHERE id_usuario = ?
        `, nombre, identificacion, telefono, correo, id_departamento, id_jefe, estado, req.params.id);

        if (usuario.rol === 'EMPLEADO' && id_jefe) {
            // Eliminar supervisor actual y asignar el nuevo
            await db.run(`DELETE FROM supervisores_empleados WHERE id_empleado = ?`, req.params.id);
            await db.run(`
                INSERT INTO supervisores_empleados (id_relacion, id_supervisor, id_empleado) VALUES (?, ?, ?)
            `, uuidv4(), id_jefe, req.params.id);
        }

        registrarAuditoria(usuario.id_empresa, req.usuario.id_usuario, 'EDITAR_USUARIO', `Usuario "${usuario.nombre}" actualizado`);
        const actualizado = await db.get('SELECT * FROM usuarios WHERE id_usuario = ?', req.params.id);
        res.json({ mensaje: 'Usuario actualizado', usuario: actualizado });
    } catch (err) {
        res.status(500).json({ error: 'Error al actualizar usuario' });
    }
});

/**
 * DELETE /api/usuarios/:id
 */
router.delete('/:id', verificarToken, verificarRol('ADMIN', 'GERENTE'), async (req, res) => {
    try {
        const usuario = await db.get('SELECT * FROM usuarios WHERE id_usuario = ? AND eliminado = 0', req.params.id);
        if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });
        if (req.usuario.id_empresa !== usuario.id_empresa) return res.status(403).json({ error: 'No tienes acceso' });
        if (usuario.rol === 'ADMIN') return res.status(400).json({ error: 'No se puede eliminar al administrador' });

        const ahora = new Date().toISOString();
        await db.run(`UPDATE usuarios SET eliminado = 1, fecha_eliminacion = ?, eliminado_por = ? WHERE id_usuario = ?`,
            ahora, req.usuario.id_usuario, req.params.id);

        registrarAuditoria(usuario.id_empresa, req.usuario.id_usuario, 'ELIMINAR_USUARIO', `Usuario "${usuario.nombre}" eliminado`);
        res.json({ mensaje: 'Usuario eliminado correctamente' });
    } catch (err) {
        res.status(500).json({ error: 'Error al eliminar usuario' });
    }
});

/**
 * PUT /api/usuarios/:id/rol — Cambiar rol (Promover/Degradar)
 */
router.put('/:id/rol', verificarToken, verificarRol('ADMIN', 'GERENTE'), async (req, res) => {
    try {
        const { rol } = req.body;
        if (!rol || !['SUPERVISOR', 'EMPLEADO', 'GERENTE'].includes(rol)) {
            return res.status(400).json({ error: 'Rol debe ser SUPERVISOR, EMPLEADO o GERENTE' });
        }
        // Solo ADMIN puede promover a GERENTE
        if (rol === 'GERENTE' && req.usuario.rol !== 'ADMIN' && req.usuario.rol !== 'ROOT') {
            return res.status(403).json({ error: 'Solo el administrador puede promover a Gerente' });
        }

        const usuario = await db.get('SELECT * FROM usuarios WHERE id_usuario = ? AND eliminado = 0', req.params.id);
        if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });
        if (req.usuario.id_empresa !== usuario.id_empresa) return res.status(403).json({ error: 'No tienes acceso' });
        if (usuario.rol === rol) return res.status(400).json({ error: `El usuario ya es ${rol}` });
        if (usuario.rol === 'ADMIN') return res.status(400).json({ error: 'No se puede cambiar el rol del administrador' });

        const rolAnterior = usuario.rol;

        // Cambiar rol
        await db.run('UPDATE usuarios SET rol = ? WHERE id_usuario = ?', rol, req.params.id);

        if (rol === 'SUPERVISOR') {
            // Promovido a supervisor: quitar relación con su supervisor anterior
            await db.run('DELETE FROM supervisores_empleados WHERE id_empleado = ?', req.params.id);
            // Asignar permisos default de supervisor
            const permisosDefault = ['ASIGNAR_TAREAS', 'VER_REPORTES', 'VER_EVIDENCIAS'];
            const placeholders = permisosDefault.map(() => '?').join(',');
            const permisos = await db.all(`SELECT id_permiso FROM permisos WHERE codigo IN (${placeholders})`, ...permisosDefault);
            for (const p of permisos) {
                try {
                    if (isPostgres) {
                        await db.run('INSERT INTO rol_permisos (id_rol, id_permiso, id_empresa) VALUES (?, ?, ?) ON CONFLICT DO NOTHING', 'SUPERVISOR', p.id_permiso, usuario.id_empresa);
                    } else {
                        await db.run('INSERT OR IGNORE INTO rol_permisos (id_rol, id_permiso, id_empresa) VALUES (?, ?, ?)', 'SUPERVISOR', p.id_permiso, usuario.id_empresa);
                    }
                } catch(e) {}
            }
        } else {
            // Degradado a empleado: liberar sus empleados asignados
            await db.run('DELETE FROM supervisores_empleados WHERE id_supervisor = ?', req.params.id);
        }

        registrarAuditoria(usuario.id_empresa, req.usuario.id_usuario, 'CAMBIAR_ROL',
            `"${usuario.nombre}" cambiado de ${rolAnterior} a ${rol}`);

        res.json({ mensaje: `${usuario.nombre} ahora es ${rol}`, rol });
    } catch (err) {
        console.error('Error cambiando rol:', err);
        res.status(500).json({ error: 'Error al cambiar rol' });
    }
});

/**
 * POST /api/usuarios/asignar-supervisor
 */
router.post('/asignar-supervisor', verificarToken, verificarRol('ADMIN', 'GERENTE'), async (req, res) => {
    try {
        const { id_supervisor, id_empleado } = req.body;
        if (!id_supervisor || !id_empleado) return res.status(400).json({ error: 'Se requiere id_supervisor e id_empleado' });

        const supervisor = await db.get('SELECT * FROM usuarios WHERE id_usuario = ? AND rol = ? AND eliminado = 0', id_supervisor, 'SUPERVISOR');
        const empleado = await db.get('SELECT * FROM usuarios WHERE id_usuario = ? AND rol = ? AND eliminado = 0', id_empleado, 'EMPLEADO');

        if (!supervisor) return res.status(404).json({ error: 'Supervisor no encontrado' });
        if (!empleado) return res.status(404).json({ error: 'Empleado no encontrado' });
        if (supervisor.id_empresa !== empleado.id_empresa) return res.status(400).json({ error: 'Usuarios de diferentes empresas' });

        const existe = await db.get('SELECT 1 FROM supervisores_empleados WHERE id_supervisor = ? AND id_empleado = ?', id_supervisor, id_empleado);
        if (existe) return res.status(400).json({ error: 'Esta asignación ya existe' });

        await db.run(`INSERT INTO supervisores_empleados (id_relacion, id_supervisor, id_empleado) VALUES (?, ?, ?)`,
            uuidv4(), id_supervisor, id_empleado);

        registrarAuditoria(req.usuario.id_empresa, req.usuario.id_usuario, 'ASIGNAR_SUPERVISOR',
            `Empleado "${empleado.nombre}" asignado a supervisor "${supervisor.nombre}"`);
        res.json({ mensaje: 'Empleado asignado al supervisor correctamente' });
    } catch (err) {
        res.status(500).json({ error: 'Error al asignar supervisor' });
    }
});
/**
 * PUT /api/usuarios/mi-ubicacion — Guardar ubicación fija del empleado
 */
router.put('/mi-ubicacion', verificarToken, async (req, res) => {
    try {
        const { lat, lng, nombre } = req.body;
        if (!lat || !lng) return res.status(400).json({ error: 'Se requiere latitud y longitud' });

        await db.run(`
            UPDATE usuarios SET ubicacion_fija_lat = ?, ubicacion_fija_lng = ?, ubicacion_fija_nombre = ? WHERE id_usuario = ?
        `, lat, lng, nombre || '', req.usuario.id_usuario);

        registrarAuditoria(req.usuario.id_empresa, req.usuario.id_usuario, 'UBICACION_FIJA', `Ubicación de trabajo registrada: ${nombre || 'GPS'} (${lat}, ${lng})`);

        res.json({ mensaje: 'Ubicación registrada', lat, lng, nombre });
    } catch (err) {
        console.error('Error guardando ubicación:', err);
        res.status(500).json({ error: 'Error al guardar ubicación' });
    }
});

/**
 * GET /api/usuarios/mi-ubicacion — Obtener ubicación fija del empleado
 */
router.get('/mi-ubicacion', verificarToken, async (req, res) => {
    try {
        const usuario = await db.get(
            'SELECT ubicacion_fija_lat, ubicacion_fija_lng, ubicacion_fija_nombre FROM usuarios WHERE id_usuario = ?',
            req.usuario.id_usuario
        );
        res.json({
            lat: usuario?.ubicacion_fija_lat || null,
            lng: usuario?.ubicacion_fija_lng || null,
            nombre: usuario?.ubicacion_fija_nombre || ''
        });
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener ubicación' });
    }
});

module.exports = router;
