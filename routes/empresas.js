const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { db, isPostgres } = require('../database/init');
const { verificarToken, verificarRoot, registrarAuditoria } = require('../middleware/auth');
const { generarCodigoAcceso } = require('../utils/codigoAcceso');

/**
 * POST /api/empresas
 * Crear empresa + administrador automático (solo ROOT)
 */
router.post('/', verificarToken, verificarRoot, async (req, res) => {
    try {
        const {
            nombre, identificacion_empresa, nombre_administrador,
            pais, moneda, zona_horaria, telefono, correo, direccion,
            admin_identificacion, admin_telefono, admin_correo,
            permite_supervisor_asignar, formato_hora, supervisor_ve_terminadas
        } = req.body;

        if (!nombre || !nombre_administrador) {
            return res.status(400).json({ error: 'Nombre de empresa y nombre del administrador son requeridos' });
        }

        const id_empresa = uuidv4();
        const id_usuario = uuidv4();
        const id_config = uuidv4();
        const codigo_admin = await generarCodigoAcceso(nombre);

        await db.run(`
            INSERT INTO empresas (id_empresa, nombre, identificacion_empresa, nombre_administrador, pais, moneda, zona_horaria, telefono, correo, direccion, codigo_admin)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, id_empresa, nombre, identificacion_empresa || '', nombre_administrador, pais || 'MX', moneda || 'MXN', zona_horaria || 'America/Mexico_City', telefono || '', correo || '', direccion || '', codigo_admin);

        await db.run(`
            INSERT INTO usuarios (id_usuario, id_empresa, identificacion, nombre, telefono, correo, rol, codigo_acceso)
            VALUES (?, ?, ?, ?, ?, ?, 'ADMIN', ?)
        `, id_usuario, id_empresa, admin_identificacion || identificacion_empresa || '', nombre_administrador, admin_telefono || telefono || '', admin_correo || correo || '', codigo_admin);

        await db.run(`
            INSERT INTO configuraciones_empresa (id_config, id_empresa, permite_supervisor_asignar, formato_hora, supervisor_ve_terminadas) VALUES (?, ?, ?, ?, ?)
        `, id_config, id_empresa,
           permite_supervisor_asignar !== undefined ? (permite_supervisor_asignar ? 1 : 0) : 1,
           formato_hora || '12h',
           supervisor_ve_terminadas !== undefined ? (supervisor_ve_terminadas ? 1 : 0) : 1);

        const tiposDefault = [
            { nombre: 'Operativa', descripcion: 'Tareas operativas del día a día', peso: 1 },
            { nombre: 'Administrativa', descripcion: 'Tareas administrativas y de gestión', peso: 2 },
            { nombre: 'Crítica', descripcion: 'Tareas urgentes y de alta prioridad', peso: 3 }
        ];

        for (const tipo of tiposDefault) {
            await db.run(`
                INSERT INTO tipos_tarea (id_tipo, id_empresa, nombre, descripcion, peso_complejidad) VALUES (?, ?, ?, ?, ?)
            `, uuidv4(), id_empresa, tipo.nombre, tipo.descripcion, tipo.peso);
        }

        const permisos = await db.all('SELECT id_permiso FROM permisos');
        for (const p of permisos) {
            try {
                if (isPostgres) {
                    await db.run(`INSERT INTO rol_permisos (id_rol, id_permiso, id_empresa) VALUES (?, ?, ?) ON CONFLICT DO NOTHING`, 'ADMIN', p.id_permiso, id_empresa);
                } else {
                    await db.run(`INSERT OR IGNORE INTO rol_permisos (id_rol, id_permiso, id_empresa) VALUES (?, ?, ?)`, 'ADMIN', p.id_permiso, id_empresa);
                }
            } catch(e) { /* ya existe */ }
        }

        registrarAuditoria(id_empresa, 'ROOT', 'CREAR_EMPRESA', `Empresa "${nombre}" creada con admin "${nombre_administrador}"`);

        res.status(201).json({
            mensaje: 'Empresa creada exitosamente',
            empresa: {
                id_empresa, nombre, identificacion_empresa, nombre_administrador,
                codigo_admin, estado: 1, fecha_creacion: new Date().toISOString()
            },
            administrador: {
                id_usuario, nombre: nombre_administrador, rol: 'ADMIN', codigo_acceso: codigo_admin
            }
        });
    } catch (err) {
        console.error('Error creando empresa:', err);
        res.status(500).json({ error: 'Error al crear la empresa: ' + err.message });
    }
});

/**
 * GET /api/empresas
 */
router.get('/', verificarToken, verificarRoot, async (req, res) => {
    try {
        const empresas = await db.all(`
            SELECT e.*, 
                   (SELECT COUNT(*) FROM usuarios WHERE id_empresa = e.id_empresa AND eliminado = 0) as total_usuarios,
                   (SELECT COUNT(*) FROM usuarios WHERE id_empresa = e.id_empresa AND rol = 'SUPERVISOR' AND eliminado = 0) as total_supervisores,
                   (SELECT COUNT(*) FROM usuarios WHERE id_empresa = e.id_empresa AND rol = 'EMPLEADO' AND eliminado = 0) as total_empleados
            FROM empresas e
            WHERE e.eliminado = 0
            ORDER BY e.fecha_creacion DESC
        `);
        res.json(empresas);
    } catch (err) {
        console.error('Error listando empresas:', err);
        res.status(500).json({ error: 'Error al listar empresas' });
    }
});

/**
 * GET /api/empresas/:id
 */
router.get('/:id', verificarToken, async (req, res) => {
    try {
        const empresa = await db.get(`
            SELECT e.*, 
                   (SELECT COUNT(*) FROM usuarios WHERE id_empresa = e.id_empresa AND eliminado = 0) as total_usuarios,
                   (SELECT COUNT(*) FROM usuarios WHERE id_empresa = e.id_empresa AND rol = 'SUPERVISOR' AND eliminado = 0) as total_supervisores,
                   (SELECT COUNT(*) FROM usuarios WHERE id_empresa = e.id_empresa AND rol = 'EMPLEADO' AND eliminado = 0) as total_empleados
            FROM empresas e
            WHERE e.id_empresa = ? AND e.eliminado = 0
        `, req.params.id);

        if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
        if (req.usuario.rol !== 'ROOT' && req.usuario.id_empresa !== empresa.id_empresa) {
            return res.status(403).json({ error: 'No tienes acceso a esta empresa' });
        }

        const config = await db.get('SELECT * FROM configuraciones_empresa WHERE id_empresa = ?', empresa.id_empresa);
        res.json({ ...empresa, configuracion: config });
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener empresa' });
    }
});

/**
 * PUT /api/empresas/:id
 */
router.put('/:id', verificarToken, async (req, res) => {
    try {
        const idEmpresa = req.params.id;
        if (req.usuario.rol !== 'ROOT' && req.usuario.rol !== 'ADMIN') {
            return res.status(403).json({ error: 'No tienes permisos' });
        }
        if (req.usuario.rol === 'ADMIN' && req.usuario.id_empresa !== idEmpresa) {
            return res.status(403).json({ error: 'No tienes acceso a esta empresa' });
        }

        const { nombre, identificacion_empresa, pais, moneda, zona_horaria, telefono, correo, direccion } = req.body;

        await db.run(`
            UPDATE empresas SET
                nombre = COALESCE(?, nombre),
                identificacion_empresa = COALESCE(?, identificacion_empresa),
                pais = COALESCE(?, pais),
                moneda = COALESCE(?, moneda),
                zona_horaria = COALESCE(?, zona_horaria),
                telefono = COALESCE(?, telefono),
                correo = COALESCE(?, correo),
                direccion = COALESCE(?, direccion)
            WHERE id_empresa = ? AND eliminado = 0
        `, nombre, identificacion_empresa, pais, moneda, zona_horaria, telefono, correo, direccion, idEmpresa);

        registrarAuditoria(idEmpresa, req.usuario.id_usuario, 'EDITAR_EMPRESA', `Empresa actualizada`);
        const empresaActualizada = await db.get('SELECT * FROM empresas WHERE id_empresa = ?', idEmpresa);
        res.json({ mensaje: 'Empresa actualizada', empresa: empresaActualizada });
    } catch (err) {
        res.status(500).json({ error: 'Error al actualizar empresa' });
    }
});

/**
 * PUT /api/empresas/:id/configuracion
 */
router.put('/:id/configuracion', verificarToken, async (req, res) => {
    try {
        const idEmpresa = req.params.id;
        if (req.usuario.rol !== 'ROOT' && req.usuario.rol !== 'ADMIN') {
            return res.status(403).json({ error: 'No tienes permisos' });
        }
        if (req.usuario.rol === 'ADMIN' && req.usuario.id_empresa !== idEmpresa) {
            return res.status(403).json({ error: 'No tienes acceso a esta empresa' });
        }

        const { usa_evidencias, tolerancia_tiempo, permite_supervisor_asignar, usa_gamificacion, usa_geolocalizacion } = req.body;

        await db.run(`
            UPDATE configuraciones_empresa SET
                usa_evidencias = COALESCE(?, usa_evidencias),
                tolerancia_tiempo = COALESCE(?, tolerancia_tiempo),
                permite_supervisor_asignar = COALESCE(?, permite_supervisor_asignar),
                usa_gamificacion = COALESCE(?, usa_gamificacion),
                usa_geolocalizacion = COALESCE(?, usa_geolocalizacion)
            WHERE id_empresa = ?
        `,
            usa_evidencias !== undefined ? (usa_evidencias ? 1 : 0) : null,
            tolerancia_tiempo || null,
            permite_supervisor_asignar !== undefined ? (permite_supervisor_asignar ? 1 : 0) : null,
            usa_gamificacion !== undefined ? (usa_gamificacion ? 1 : 0) : null,
            usa_geolocalizacion !== undefined ? (usa_geolocalizacion ? 1 : 0) : null,
            idEmpresa
        );

        registrarAuditoria(idEmpresa, req.usuario.id_usuario, 'EDITAR_CONFIG', 'Configuración de empresa actualizada');
        const config = await db.get('SELECT * FROM configuraciones_empresa WHERE id_empresa = ?', idEmpresa);
        res.json({ mensaje: 'Configuración actualizada', configuracion: config });
    } catch (err) {
        res.status(500).json({ error: 'Error al actualizar configuración' });
    }
});

/**
 * DELETE /api/empresas/:id (Soft Delete)
 */
router.delete('/:id', verificarToken, verificarRoot, async (req, res) => {
    try {
        const idEmpresa = req.params.id;
        const ahora = new Date().toISOString();
        await db.run(`UPDATE empresas SET eliminado = 1, fecha_eliminacion = ? WHERE id_empresa = ?`, ahora, idEmpresa);
        await db.run(`UPDATE usuarios SET estado = 0 WHERE id_empresa = ?`, idEmpresa);
        registrarAuditoria(idEmpresa, 'ROOT', 'ELIMINAR_EMPRESA', `Empresa eliminada (soft delete)`);
        res.json({ mensaje: 'Empresa eliminada correctamente' });
    } catch (err) {
        res.status(500).json({ error: 'Error al eliminar empresa' });
    }
});

/**
 * GET /api/empresas/mi-config — Config de la empresa del usuario autenticado
 */
router.get('/mi-config', verificarToken, async (req, res) => {
    try {
        const config = await db.get('SELECT * FROM configuraciones_empresa WHERE id_empresa = ?', req.usuario.id_empresa);
        res.json(config || { permite_supervisor_asignar: 1 });
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener configuración' });
    }
});

module.exports = router;
