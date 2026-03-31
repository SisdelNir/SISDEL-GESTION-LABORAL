const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { db } = require('../database/init');
const { verificarToken, verificarRol, verificarEmpresa, registrarAuditoria } = require('../middleware/auth');
const { generarCodigoAcceso } = require('../utils/codigoAcceso');

/**
 * GET /api/departamentos
 * Lista departamentos de la empresa del usuario, con su gerente si existe
 */
router.get('/', verificarToken, verificarRol('ADMIN', 'GERENTE'), async (req, res) => {
    try {
        const deptos = await db.all(
            'SELECT * FROM departamentos WHERE id_empresa = ? ORDER BY nombre',
            req.usuario.id_empresa
        );

        // Para cada depto, buscar si hay un GERENTE asignado
        const result = [];
        for (const d of deptos) {
            const gerente = await db.get(
                `SELECT id_usuario, nombre, telefono, correo, profesion, codigo_acceso 
                 FROM usuarios WHERE id_departamento = ? AND rol = 'GERENTE' AND eliminado = 0`,
                d.id_departamento
            );
            result.push({ ...d, gerente: gerente || null });
        }

        res.json(result);
    } catch (err) {
        console.error('Error listando departamentos:', err);
        res.status(500).json({ error: 'Error al listar departamentos' });
    }
});

/**
 * POST /api/departamentos/batch
 * Crear múltiples gerencias con sus responsables (usuarios GERENTE)
 */
router.post('/batch', verificarToken, verificarRol('ADMIN'), async (req, res) => {
    try {
        const { gerencias } = req.body;
        if (!Array.isArray(gerencias) || gerencias.length === 0) {
            return res.status(400).json({ error: 'No se recibieron gerencias' });
        }

        const empresa = await db.get('SELECT nombre FROM empresas WHERE id_empresa = ?', req.usuario.id_empresa);
        const nombreEmpresa = empresa?.nombre || 'Empresa';
        let creados = 0;
        const gerentesCreados = [];

        for (const g of gerencias) {
            const nombreGerencia = g.nombre_gerencia;
            if (!nombreGerencia || !nombreGerencia.trim()) continue;

            const nombreLimpio = nombreGerencia.trim();

            // Evitar duplicidades: comprobar si ya existe una gerencia con el mismo nombre
            const existe = await db.get(
                'SELECT id_departamento FROM departamentos WHERE id_empresa = ? AND LOWER(nombre) = LOWER(?)',
                req.usuario.id_empresa, 
                nombreLimpio
            );
            
            if (existe) {
                return res.status(400).json({ error: `La gerencia "${nombreLimpio}" ya existe en el sistema` });
            }

            const id_departamento = uuidv4();
            await db.run(
                'INSERT INTO departamentos (id_departamento, id_empresa, nombre, codigo_costos) VALUES (?, ?, ?, ?)',
                id_departamento, req.usuario.id_empresa, nombreLimpio, g.codigo_costos || null
            );

            // Crear usuario GERENTE si hay responsable
            const resp = g.responsable;
            if (resp && resp.nombre && resp.nombre.trim()) {
                const id_gerente = uuidv4();
                const codigo_gerente = await generarCodigoAcceso(nombreEmpresa);
                await db.run(`
                    INSERT INTO usuarios (id_usuario, id_empresa, id_departamento, nombre, telefono, correo, profesion, direccion, rol, codigo_acceso)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'GERENTE', ?)
                `, id_gerente, req.usuario.id_empresa, id_departamento, resp.nombre.trim(),
                   resp.telefono || '', resp.correo || '', resp.profesion || '', resp.direccion || '', codigo_gerente);

                gerentesCreados.push({
                    gerencia: nombreGerencia.trim(),
                    nombre: resp.nombre.trim(),
                    codigo_acceso: codigo_gerente
                });
            }
            creados++;
        }

        registrarAuditoria(req.usuario.id_empresa, req.usuario.id_usuario, 'CREAR_GERENCIAS',
            `${creados} gerencia(s) creada(s) con ${gerentesCreados.length} responsable(s)`);

        res.json({ creados, gerentes: gerentesCreados });
    } catch (err) {
        console.error('Error creando gerencias:', err);
        res.status(500).json({ error: 'Error al crear gerencias: ' + err.message });
    }
});

/**
 * GET /api/departamentos/datos-360
 * Obtiene el mapa completo de la empresa para Alta Gerencia
 */
router.get('/datos-360', verificarToken, verificarRol('ADMIN'), async (req, res) => {
    try {
        const id_empresa = req.usuario.id_empresa;
        
        // 1. Obtener Departamentos
        const departamentos = await db.all('SELECT id_departamento, nombre FROM departamentos WHERE id_empresa = ? AND estado = 1 ORDER BY nombre', id_empresa);
        
        const result = [];
        for (const depto of departamentos) {
            // 2. Obtener Supervisores de este depto
            const supervisores = await db.all('SELECT id_usuario, nombre FROM usuarios WHERE id_departamento = ? AND rol = ? AND eliminado = 0', depto.id_departamento, 'SUPERVISOR');
            
            const supsConEmp = [];
            for (const sup of supervisores) {
                // 3. Obtener Empleados de este supervisor
                const empleados = await db.all('SELECT id_usuario, nombre FROM usuarios WHERE id_jefe = ? AND eliminado = 0', sup.id_usuario);
                
                const empsConTareas = [];
                for (const emp of empleados) {
                    // 4. Obtener Tareas activas del empleado
                    const tareas = await db.all("SELECT id_tarea, titulo, estado FROM tareas WHERE id_empleado = ? AND estado NOT IN ('finalizada', 'finalizada_atrasada') AND eliminado = 0", emp.id_usuario);
                    empsConTareas.push({ ...emp, tareas });
                }
                supsConEmp.push({ ...sup, empleados: empsConTareas });
            }
            result.push({ ...depto, supervisores: supsConEmp });
        }
        
        res.json(result);
    } catch (err) {
        console.error('Error en datos-360:', err);
        res.status(500).json({ error: 'Error al obtener visión estratégica' });
    }
});

module.exports = router;
