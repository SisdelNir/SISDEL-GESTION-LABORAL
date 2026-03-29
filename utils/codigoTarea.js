const { db } = require('../database/init');

/**
 * Genera un código de tarea automático basado en las iniciales de la empresa.
 * Formato: [INICIALES]-[NÚMERO SECUENCIAL]
 * Ej: Para "FUERZA COMERCIAL DE GUATEMALA" → FCG-0001, FCG-0002, ...
 * Se ignoran palabras comunes como "DE", "DEL", "LA", "LOS", "Y", "EL", "LAS"
 */
async function generarCodigoTarea(id_empresa) {
    // Obtener nombre de la empresa
    const empresa = await db.get('SELECT nombre FROM empresas WHERE id_empresa = ?', id_empresa);
    if (!empresa) throw new Error('Empresa no encontrada');

    // Generar iniciales: primeras letras de cada palabra significativa
    const palabrasIgnorar = ['DE', 'DEL', 'LA', 'LOS', 'LAS', 'EL', 'Y', 'E', 'EN', 'CON', 'POR', 'PARA', 'A', 'AL', 'O', 'U'];
    const palabras = empresa.nombre.toUpperCase().trim().split(/\s+/);
    const iniciales = palabras
        .filter(p => !palabrasIgnorar.includes(p))
        .map(p => p.charAt(0))
        .join('');

    // Prefijo mínimo de 2 caracteres
    const prefijo = iniciales.length >= 2 ? iniciales : empresa.nombre.toUpperCase().replace(/\s+/g, '').substring(0, 3);

    // Contar tareas existentes con código para esta empresa
    const resultado = await db.get(
        'SELECT COUNT(*) as total FROM tareas WHERE id_empresa = ? AND codigo_tarea IS NOT NULL',
        id_empresa
    );
    const siguiente = (resultado ? resultado.total : 0) + 1;

    // Formato: FCG-0001
    const numero = String(siguiente).padStart(4, '0');
    return `${prefijo}-${numero}`;
}

module.exports = { generarCodigoTarea };
