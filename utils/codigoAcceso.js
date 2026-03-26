const { db } = require('../database/init');

/**
 * Genera código de acceso de 6 caracteres:
 * - Posición 1: Primera letra del nombre de la empresa (mayúscula)
 * - Posición 2-3: Letras aleatorias (minúsculas)
 * - Posición 4-6: Números aleatorios (0-9)
 * 
 * @param {string} nombreEmpresa - Nombre de la empresa
 * @returns {Promise<string>} Código único de 6 caracteres
 */
async function generarCodigoAcceso(nombreEmpresa) {
    const letras = 'abcdefghijklmnopqrstuvwxyz';
    let codigo;
    let intentos = 0;
    const maxIntentos = 100;

    do {
        const inicial = nombreEmpresa.trim().charAt(0).toUpperCase();
        const letra2 = letras.charAt(Math.floor(Math.random() * letras.length));
        const letra3 = letras.charAt(Math.floor(Math.random() * letras.length));
        const num1 = Math.floor(Math.random() * 10);
        const num2 = Math.floor(Math.random() * 10);
        const num3 = Math.floor(Math.random() * 10);

        codigo = `${inicial}${letra2}${letra3}${num1}${num2}${num3}`;
        intentos++;

        if (intentos >= maxIntentos) {
            throw new Error('No se pudo generar un código de acceso único');
        }
    } while (await existeCodigo(codigo));

    return codigo;
}

/**
 * Verifica si un código ya existe en la base de datos (async)
 */
async function existeCodigo(codigo) {
    const result = await db.get('SELECT COUNT(*) as count FROM usuarios WHERE codigo_acceso = ?', codigo);
    return result && result.count > 0;
}

module.exports = { generarCodigoAcceso };
