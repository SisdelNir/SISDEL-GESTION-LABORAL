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
            nombre, identificacion_empresa, nombre_administrador, nombre_director_general,
            pais, moneda, zona_horaria, telefono, correo, direccion, logo_url,
            direccion_departamento, direccion_municipio, direccion_zona, direccion_exacta,
            admin_identificacion, admin_telefono, admin_correo,
            director_general, // { nombre, identificacion, telefono, correo, profesion }
            permite_supervisor_asignar, formato_hora, supervisor_ve_terminadas, empleado_puede_iniciar, supervisor_puede_modificar, modalidad_trabajo,
            gerencias // Array de { nombre_gerencia, responsable: { nombre, telefono, correo, profesion, direccion } }
        } = req.body;

        // Director General data (new format or legacy)
        const dgNombre = director_general?.nombre || nombre_administrador || nombre_director_general;
        const dgIdentificacion = director_general?.identificacion || admin_identificacion || '';
        const dgTelefono = director_general?.telefono || admin_telefono || telefono || '';
        const dgCorreo = director_general?.correo || admin_correo || correo || '';
        const dgProfesion = director_general?.profesion || '';

        if (!nombre || !dgNombre) {
            return res.status(400).json({ error: 'Nombre de empresa y Director General son requeridos' });
        }

        const id_empresa = uuidv4();
        const id_usuario_dg = uuidv4();
        const id_config = uuidv4();
        const codigo_dg = await generarCodigoAcceso(nombre);

        await db.run(`
            INSERT INTO empresas (id_empresa, nombre, identificacion_empresa, nombre_administrador, nombre_director_general, pais, moneda, zona_horaria, telefono, correo, direccion, direccion_departamento, direccion_municipio, direccion_zona, direccion_exacta, codigo_admin, logo_url)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, id_empresa, nombre, identificacion_empresa || '', dgNombre, dgNombre, pais || 'MX', moneda || 'MXN', zona_horaria || 'America/Mexico_City', telefono || '', correo || '', direccion || '', direccion_departamento || null, direccion_municipio || null, direccion_zona || null, direccion_exacta || null, codigo_dg, logo_url || null);

        // Crear Director General como usuario ADMIN
        await db.run(`
            INSERT INTO usuarios (id_usuario, id_empresa, identificacion, nombre, telefono, correo, rol, codigo_acceso, profesion)
            VALUES (?, ?, ?, ?, ?, ?, 'ADMIN', ?, ?)
        `, id_usuario_dg, id_empresa, dgIdentificacion, dgNombre, dgTelefono, dgCorreo, codigo_dg, dgProfesion);

        // Crear gerencias + usuarios GERENTE
        const gerentesCreados = [];
        if (Array.isArray(gerencias) && gerencias.length > 0) {
            for (const g of gerencias) {
                const nombreGerencia = g.nombre_gerencia || g.nombre;
                if (!nombreGerencia || !nombreGerencia.trim()) continue;
                
                const id_departamento = uuidv4();
                await db.run(`
                    INSERT INTO departamentos (id_departamento, id_empresa, nombre, codigo_costos) VALUES (?, ?, ?, ?)
                `, id_departamento, id_empresa, nombreGerencia.trim(), g.codigo_costos || null);

                // Crear usuario GERENTE si hay responsable
                const resp = g.responsable;
                if (resp && resp.nombre && resp.nombre.trim()) {
                    const id_gerente = uuidv4();
                    const codigo_gerente = await generarCodigoAcceso(nombre);
                    await db.run(`
                        INSERT INTO usuarios (id_usuario, id_empresa, id_departamento, nombre, telefono, correo, profesion, direccion, rol, codigo_acceso)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'GERENTE', ?)
                    `, id_gerente, id_empresa, id_departamento, resp.nombre.trim(), resp.telefono || '', resp.correo || '', resp.profesion || '', resp.direccion || '', codigo_gerente);
                    
                    gerentesCreados.push({
                        gerencia: nombreGerencia.trim(),
                        nombre: resp.nombre.trim(),
                        codigo_acceso: codigo_gerente,
                        id_usuario: id_gerente,
                        id_departamento
                    });
                }
            }
        }

        // Config empresa (defaults)
        await db.run(`
            INSERT INTO configuraciones_empresa (id_config, id_empresa, permite_supervisor_asignar, formato_hora, supervisor_ve_terminadas, empleado_puede_iniciar, supervisor_puede_modificar, modalidad_trabajo) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, id_config, id_empresa,
           permite_supervisor_asignar !== undefined ? (permite_supervisor_asignar ? 1 : 0) : 1,
           formato_hora || '12h',
           supervisor_ve_terminadas !== undefined ? (supervisor_ve_terminadas ? 1 : 0) : 1,
           empleado_puede_iniciar !== undefined ? (empleado_puede_iniciar ? 1 : 0) : 1,
           supervisor_puede_modificar !== undefined ? (supervisor_puede_modificar ? 1 : 0) : 1,
           modalidad_trabajo || 'fijo');

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

        registrarAuditoria(id_empresa, 'ROOT', 'CREAR_EMPRESA', `Empresa "${nombre}" creada con Director General "${dgNombre}" y ${gerentesCreados.length} gerencias`);

        res.status(201).json({
            mensaje: 'Empresa creada exitosamente',
            empresa: {
                id_empresa, nombre, identificacion_empresa,
                codigo_admin: codigo_dg, estado: 1, fecha_creacion: new Date().toISOString()
            },
            director_general: {
                id_usuario: id_usuario_dg, nombre: dgNombre, rol: 'DIRECTOR GENERAL', codigo_acceso: codigo_dg
            },
            gerentes: gerentesCreados
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
 * GET /api/empresas/mi-config — Config de la empresa del usuario autenticado
 * IMPORTANTE: debe estar ANTES de /:id para no ser capturada por el wildcard
 */
router.get('/mi-config', verificarToken, async (req, res) => {
    try {
        const config = await db.get('SELECT * FROM configuraciones_empresa WHERE id_empresa = ?', req.usuario.id_empresa);
        res.json(config || { permite_supervisor_asignar: 1, empleado_puede_iniciar: 1 });
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener configuración' });
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

        const { nombre, identificacion_empresa, pais, moneda, zona_horaria, telefono, correo, direccion, logo_url,
                nombre_director_general, direccion_departamento, direccion_municipio, direccion_zona, direccion_exacta } = req.body;

        await db.run(`
            UPDATE empresas SET
                nombre = COALESCE(?, nombre),
                identificacion_empresa = COALESCE(?, identificacion_empresa),
                pais = COALESCE(?, pais),
                moneda = COALESCE(?, moneda),
                zona_horaria = COALESCE(?, zona_horaria),
                telefono = COALESCE(?, telefono),
                correo = COALESCE(?, correo),
                direccion = COALESCE(?, direccion),
                logo_url = COALESCE(?, logo_url),
                nombre_director_general = COALESCE(?, nombre_director_general),
                nombre_administrador = COALESCE(?, nombre_administrador),
                direccion_departamento = COALESCE(?, direccion_departamento),
                direccion_municipio = COALESCE(?, direccion_municipio),
                direccion_zona = COALESCE(?, direccion_zona),
                direccion_exacta = COALESCE(?, direccion_exacta)
            WHERE id_empresa = ? AND eliminado = 0
        `, nombre, identificacion_empresa, pais, moneda, zona_horaria, telefono, correo, direccion, logo_url || null,
           nombre_director_general || null, nombre_director_general || null,
           direccion_departamento || null, direccion_municipio || null, direccion_zona || null, direccion_exacta || null, idEmpresa);

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

        const { usa_evidencias, tolerancia_tiempo, permite_supervisor_asignar, usa_gamificacion, usa_geolocalizacion, formato_hora, supervisor_ve_terminadas, empleado_puede_iniciar, supervisor_puede_modificar, modalidad_trabajo } = req.body;

        await db.run(`
            UPDATE configuraciones_empresa SET
                usa_evidencias = COALESCE(?, usa_evidencias),
                tolerancia_tiempo = COALESCE(?, tolerancia_tiempo),
                permite_supervisor_asignar = COALESCE(?, permite_supervisor_asignar),
                usa_gamificacion = COALESCE(?, usa_gamificacion),
                usa_geolocalizacion = COALESCE(?, usa_geolocalizacion),
                formato_hora = COALESCE(?, formato_hora),
                supervisor_ve_terminadas = COALESCE(?, supervisor_ve_terminadas),
                empleado_puede_iniciar = COALESCE(?, empleado_puede_iniciar),
                supervisor_puede_modificar = COALESCE(?, supervisor_puede_modificar),
                modalidad_trabajo = COALESCE(?, modalidad_trabajo)
            WHERE id_empresa = ?
        `,
            usa_evidencias !== undefined ? (usa_evidencias ? 1 : 0) : null,
            tolerancia_tiempo || null,
            permite_supervisor_asignar !== undefined ? (permite_supervisor_asignar ? 1 : 0) : null,
            usa_gamificacion !== undefined ? (usa_gamificacion ? 1 : 0) : null,
            usa_geolocalizacion !== undefined ? (usa_geolocalizacion ? 1 : 0) : null,
            formato_hora || null,
            supervisor_ve_terminadas !== undefined ? (supervisor_ve_terminadas ? 1 : 0) : null,
            empleado_puede_iniciar !== undefined ? (empleado_puede_iniciar ? 1 : 0) : null,
            supervisor_puede_modificar !== undefined ? (supervisor_puede_modificar ? 1 : 0) : null,
            modalidad_trabajo || null,
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
 * GET /api/empresas/:id/departamentos — Obtener gerencias/departamentos de una empresa
 */
router.get('/:id/departamentos', verificarToken, async (req, res) => {
    try {
        const deptos = await db.all(
            'SELECT * FROM departamentos WHERE id_empresa = ? AND estado = 1 ORDER BY nombre',
            req.params.id
        );
        res.json(deptos);
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener departamentos' });
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
 * GET /api/empresas/supervisores/:id/empleados
 * Obtiene los empleados asignados a un supervisor
 */
router.get('/supervisores/:id/empleados', verificarToken, async (req, res) => {
    try {
        const idSupervisor = req.params.id;
        const relaciones = await db.all('SELECT id_empleado FROM supervisores_empleados WHERE id_supervisor = ?', idSupervisor);
        res.json(relaciones.map(r => r.id_empleado));
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener empleados asignados' });
    }
});

/**
 * POST /api/empresas/supervisores/:id/empleados
 * Asigna empleados a un supervisor (requiere ROOT o ADMIN)
 */
router.post('/supervisores/:id/empleados', verificarToken, async (req, res) => {
    try {
        const idSupervisor = req.params.id;
        const { empleados } = req.body; // Array de IDs de empleados
        
        let esRRHH = false;
        if (req.usuario.rol === 'GERENTE') {
            const depto = await db.get('SELECT nombre FROM departamentos WHERE id_departamento = ?', req.usuario.id_departamento);
            const nombreDepto = (depto?.nombre || '').toUpperCase();
            if (nombreDepto.includes('RRHH') || nombreDepto.includes('RECURSOS HUMANOS')) {
                esRRHH = true;
            }
        }

        if (req.usuario.rol !== 'ROOT' && req.usuario.rol !== 'ADMIN' && !esRRHH) {
            return res.status(403).json({ error: 'No tienes permisos para asignar empleados' });
        }

        if (!Array.isArray(empleados)) {
            return res.status(400).json({ error: 'Lista de empleados inválida' });
        }

        // 1. Eliminar relaciones existentes DE ESTE supervisor
        await db.run('DELETE FROM supervisores_empleados WHERE id_supervisor = ?', idSupervisor);

        // 2. Si se están enviando empleados nuevos, también eliminarlos de otros supervisores para que solo tengan uno
        if (empleados.length > 0) {
            const placeholders = empleados.map(() => '?').join(',');
            await db.run(`DELETE FROM supervisores_empleados WHERE id_empleado IN (${placeholders})`, ...empleados);

            // 3. Insertar las nuevas asociaciones
            for (const id_empleado of empleados) {
                await db.run(`
                    INSERT INTO supervisores_empleados (id_relacion, id_supervisor, id_empleado)
                    VALUES (?, ?, ?)
                `, uuidv4(), idSupervisor, id_empleado);
            }
        }

        res.json({ mensaje: 'Empleados asignados exitosamente al supervisor' });
    } catch (err) {
        console.error('Error asignando empleados:', err);
        res.status(500).json({ error: 'Error al asignar empleados' });
    }
});

module.exports = router;
