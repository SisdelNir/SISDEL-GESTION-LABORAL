/**
 * Database Abstraction Layer
 * Soporta SQLite (local) y PostgreSQL (producción/Render)
 * Detecta automáticamente DATABASE_URL para PostgreSQL
 */

const isPostgres = !!process.env.DATABASE_URL;

let db;

if (isPostgres) {
    // ═══════════════════════════════════════════
    // PostgreSQL (Render / Producción)
    // Usa schema 'gestion_laboral' para no chocar con otros proyectos
    // ═══════════════════════════════════════════
    const { Pool } = require('pg');
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_URL.includes('render.com') ? { rejectUnauthorized: false } : false
    });

    // Convertir placeholders ? → $1, $2, ...
    function convertPlaceholders(sql) {
        let i = 0;
        return sql.replace(/\?/g, () => `$${++i}`);
    }

    // Convertir SQL de SQLite a PostgreSQL
    function convertSQL(sql) {
        let pgSQL = convertPlaceholders(sql);
        // INTEGER PRIMARY KEY AUTOINCREMENT → SERIAL PRIMARY KEY
        pgSQL = pgSQL.replace(/INTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT/gi, 'SERIAL PRIMARY KEY');
        // datetime('now', 'localtime') → NOW()
        pgSQL = pgSQL.replace(/datetime\('now',\s*'localtime'\)/gi, 'NOW()');
        pgSQL = pgSQL.replace(/datetime\('now'\)/gi, 'NOW()');
        // INSERT OR IGNORE → INSERT ... ON CONFLICT DO NOTHING
        pgSQL = pgSQL.replace(/INSERT\s+OR\s+IGNORE/gi, 'INSERT');
        // BOOLEAN integers
        return pgSQL;
    }

    db = {
        get: async function(sql, ...params) {
            const pgSQL = convertSQL(sql);
            const flatParams = params.flat();
            const result = await pool.query(pgSQL, flatParams);
            return result.rows[0] || null;
        },
        all: async function(sql, ...params) {
            const pgSQL = convertSQL(sql);
            const flatParams = params.flat();
            const result = await pool.query(pgSQL, flatParams);
            return result.rows;
        },
        run: async function(sql, ...params) {
            const pgSQL = convertSQL(sql);
            const flatParams = params.flat();
            const result = await pool.query(pgSQL, flatParams);
            return { changes: result.rowCount, lastInsertRowid: null };
        },
        exec: async function(sql) {
            // Dividir múltiples sentencias y ejecutar una por una
            const statements = sql.split(';').filter(s => s.trim() && !s.trim().startsWith('--'));
            for (const stmt of statements) {
                if (stmt.trim()) {
                    try {
                        let pgStmt = stmt.trim();
                        pgStmt = pgStmt.replace(/INTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT/gi, 'SERIAL PRIMARY KEY');
                        pgStmt = pgStmt.replace(/datetime\('now',\s*'localtime'\)/gi, 'NOW()');
                        pgStmt = pgStmt.replace(/datetime\('now'\)/gi, 'NOW()');
                        pgStmt = pgStmt.replace(/INSERT\s+OR\s+IGNORE/gi, 'INSERT');
                        await pool.query(pgStmt);
                    } catch(e) {
                        // Ignorar errores de "ya existe" 
                        if (!e.message.includes('already exists') && !e.message.includes('duplicate')) {
                            console.warn('⚠️ SQL warning:', e.message.substring(0, 100));
                        }
                    }
                }
            }
        },
        pool: pool
    };

    console.log('🐘 Modo PostgreSQL (DATABASE_URL detectada)');

} else {
    // ═══════════════════════════════════════════
    // SQLite (Desarrollo Local)
    // ═══════════════════════════════════════════
    const Database = require('better-sqlite3');
    const path = require('path');
    const fs = require('fs');

    const dataDir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    const dbPath = path.join(dataDir, 'gestion_laboral.db');
    const sqlite = new Database(dbPath);
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');

    // Wrapper async que envuelve las llamadas síncronas de better-sqlite3
    db = {
        get: async function(sql, ...params) {
            return sqlite.prepare(sql).get(...params.flat());
        },
        all: async function(sql, ...params) {
            return sqlite.prepare(sql).all(...params.flat());
        },
        run: async function(sql, ...params) {
            return sqlite.prepare(sql).run(...params.flat());
        },
        exec: async function(sql) {
            return sqlite.exec(sql);
        },
        sqlite: sqlite
    };

    console.log('📦 Modo SQLite (desarrollo local)');
}

// ═══════════════════════════════════════════
// Inicialización del esquema
// ═══════════════════════════════════════════
async function inicializarDB() {
    // En PostgreSQL, crear schema separado para no chocar con otros proyectos
    if (isPostgres) {
        try {
            await db.pool.query('CREATE SCHEMA IF NOT EXISTS gestion_laboral');
            await db.pool.query('SET search_path TO gestion_laboral, public');
            // Configurar search_path para TODAS las conexiones futuras del pool
            db.pool.on('connect', (client) => {
                client.query('SET search_path TO gestion_laboral, public');
            });
        } catch(e) {
            console.warn('⚠️ Schema warning:', e.message);
        }
    }

    await db.exec(`
        CREATE TABLE IF NOT EXISTS empresas (
            id_empresa TEXT PRIMARY KEY,
            nombre TEXT NOT NULL,
            identificacion_empresa TEXT,
            nombre_administrador TEXT NOT NULL,
            pais TEXT DEFAULT 'MX',
            moneda TEXT DEFAULT 'MXN',
            zona_horaria TEXT DEFAULT 'America/Mexico_City',
            telefono TEXT,
            correo TEXT,
            direccion TEXT,
            logo_url TEXT,
            codigo_admin TEXT NOT NULL,
            estado INTEGER DEFAULT 1,
            eliminado INTEGER DEFAULT 0,
            fecha_eliminacion TEXT,
            fecha_creacion TEXT DEFAULT ${isPostgres ? 'NOW()' : "(datetime('now', 'localtime'))"}
        )
    `);

    await db.exec(`
        CREATE TABLE IF NOT EXISTS departamentos (
            id_departamento TEXT PRIMARY KEY,
            id_empresa TEXT NOT NULL,
            nombre TEXT NOT NULL,
            descripcion TEXT,
            id_responsable TEXT,
            estado INTEGER DEFAULT 1,
            fecha_creacion TEXT DEFAULT ${isPostgres ? 'NOW()' : "(datetime('now', 'localtime'))"},
            FOREIGN KEY (id_empresa) REFERENCES empresas(id_empresa)
        )
    `);

    await db.exec(`
        CREATE TABLE IF NOT EXISTS usuarios (
            id_usuario TEXT PRIMARY KEY,
            id_empresa TEXT NOT NULL,
            identificacion TEXT,
            nombre TEXT NOT NULL,
            telefono TEXT,
            correo TEXT,
            foto_url TEXT,
            rol TEXT NOT NULL,
            codigo_acceso TEXT UNIQUE NOT NULL,
            password_hash TEXT,
            id_departamento TEXT,
            estado INTEGER DEFAULT 1,
            intentos_fallidos INTEGER DEFAULT 0,
            bloqueado_hasta TEXT,
            eliminado INTEGER DEFAULT 0,
            fecha_eliminacion TEXT,
            eliminado_por TEXT,
            fecha_creacion TEXT DEFAULT ${isPostgres ? 'NOW()' : "(datetime('now', 'localtime'))"},
            FOREIGN KEY (id_empresa) REFERENCES empresas(id_empresa)
        )
    `);

    await db.exec(`
        CREATE TABLE IF NOT EXISTS sesiones (
            id_sesion TEXT PRIMARY KEY,
            id_usuario TEXT NOT NULL,
            refresh_token TEXT NOT NULL,
            dispositivo TEXT,
            ip TEXT,
            fecha_creacion TEXT DEFAULT ${isPostgres ? 'NOW()' : "(datetime('now', 'localtime'))"},
            fecha_expiracion TEXT NOT NULL,
            activa INTEGER DEFAULT 1,
            FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario)
        )
    `);

    await db.exec(`
        CREATE TABLE IF NOT EXISTS permisos (
            id_permiso ${isPostgres ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT'},
            codigo TEXT UNIQUE NOT NULL,
            descripcion TEXT
        )
    `);

    await db.exec(`
        CREATE TABLE IF NOT EXISTS rol_permisos (
            id_rol TEXT NOT NULL,
            id_permiso INTEGER NOT NULL,
            id_empresa TEXT NOT NULL,
            PRIMARY KEY (id_rol, id_permiso, id_empresa)
        )
    `);

    await db.exec(`
        CREATE TABLE IF NOT EXISTS permisos_usuario (
            id_usuario TEXT NOT NULL,
            id_permiso INTEGER NOT NULL,
            concedido INTEGER DEFAULT 1,
            PRIMARY KEY (id_usuario, id_permiso)
        )
    `);

    await db.exec(`
        CREATE TABLE IF NOT EXISTS supervisores_empleados (
            id_relacion TEXT PRIMARY KEY,
            id_supervisor TEXT NOT NULL,
            id_empleado TEXT NOT NULL,
            fecha_asignacion TEXT DEFAULT ${isPostgres ? 'NOW()' : "(datetime('now', 'localtime'))"}
        )
    `);

    await db.exec(`
        CREATE TABLE IF NOT EXISTS tipos_tarea (
            id_tipo TEXT PRIMARY KEY,
            id_empresa TEXT NOT NULL,
            nombre TEXT NOT NULL,
            descripcion TEXT,
            peso_complejidad INTEGER DEFAULT 1,
            fecha_creacion TEXT DEFAULT ${isPostgres ? 'NOW()' : "(datetime('now', 'localtime'))"},
            FOREIGN KEY (id_empresa) REFERENCES empresas(id_empresa)
        )
    `);

    await db.exec(`
        CREATE TABLE IF NOT EXISTS tareas (
            id_tarea TEXT PRIMARY KEY,
            id_empresa TEXT NOT NULL,
            titulo TEXT NOT NULL,
            descripcion TEXT,
            id_empleado TEXT,
            id_supervisor TEXT,
            id_creador TEXT NOT NULL,
            id_tipo TEXT,
            prioridad TEXT DEFAULT 'media',
            tiempo_estimado_minutos INTEGER,
            requiere_evidencia INTEGER DEFAULT 0,
            estado TEXT DEFAULT 'pendiente',
            fecha_creacion TEXT DEFAULT ${isPostgres ? 'NOW()' : "(datetime('now', 'localtime'))"},
            fecha_inicio TEXT,
            fecha_fin TEXT,
            eliminado INTEGER DEFAULT 0,
            FOREIGN KEY (id_empresa) REFERENCES empresas(id_empresa)
        )
    `);

    await db.exec(`
        CREATE TABLE IF NOT EXISTS historial_estados_tarea (
            id ${isPostgres ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT'},
            id_tarea TEXT NOT NULL,
            estado_anterior TEXT,
            estado_nuevo TEXT NOT NULL,
            id_usuario TEXT,
            comentario TEXT,
            fecha TEXT DEFAULT ${isPostgres ? 'NOW()' : "(datetime('now', 'localtime'))"}
        )
    `);

    await db.exec(`
        CREATE TABLE IF NOT EXISTS seguimiento_tiempo (
            id_seguimiento TEXT PRIMARY KEY,
            id_tarea TEXT NOT NULL,
            hora_inicio TEXT,
            hora_fin TEXT,
            tiempo_real_segundos INTEGER,
            lat_inicio REAL,
            lng_inicio REAL,
            lat_fin REAL,
            lng_fin REAL
        )
    `);

    await db.exec(`
        CREATE TABLE IF NOT EXISTS evidencias_tarea (
            id_evidencia TEXT PRIMARY KEY,
            id_tarea TEXT NOT NULL,
            tipo TEXT,
            contenido TEXT,
            fecha_registro TEXT DEFAULT ${isPostgres ? 'NOW()' : "(datetime('now', 'localtime'))"}
        )
    `);

    await db.exec(`
        CREATE TABLE IF NOT EXISTS comentarios_tarea (
            id ${isPostgres ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT'},
            id_tarea TEXT NOT NULL,
            id_usuario TEXT NOT NULL,
            contenido TEXT NOT NULL,
            fecha TEXT DEFAULT ${isPostgres ? 'NOW()' : "(datetime('now', 'localtime'))"}
        )
    `);

    await db.exec(`
        CREATE TABLE IF NOT EXISTS notificaciones (
            id_notificacion TEXT PRIMARY KEY,
            id_usuario TEXT NOT NULL,
            titulo TEXT,
            mensaje TEXT,
            tipo TEXT,
            leido INTEGER DEFAULT 0,
            fecha TEXT DEFAULT ${isPostgres ? 'NOW()' : "(datetime('now', 'localtime'))"}
        )
    `);

    await db.exec(`
        CREATE TABLE IF NOT EXISTS plantillas_tarea (
            id_plantilla TEXT PRIMARY KEY,
            id_empresa TEXT NOT NULL,
            titulo TEXT NOT NULL,
            descripcion TEXT,
            id_tipo TEXT,
            tiempo_estimado_minutos INTEGER,
            prioridad TEXT DEFAULT 'media',
            recurrencia TEXT,
            dias_semana TEXT,
            hora_creacion TEXT,
            id_empleado_default TEXT,
            id_supervisor_default TEXT,
            activa INTEGER DEFAULT 1,
            incluir_finsemana INTEGER DEFAULT 1,
            ultima_ejecucion TEXT,
            total_generadas INTEGER DEFAULT 0,
            fecha_creacion TEXT DEFAULT ${isPostgres ? 'NOW()' : "(datetime('now', 'localtime'))"}
        )
    `);

    // Migración: columnas nuevas para plantillas_tarea
    const migracionesPlantillas = [
        'ALTER TABLE plantillas_tarea ADD COLUMN incluir_finsemana INTEGER DEFAULT 1',
        'ALTER TABLE plantillas_tarea ADD COLUMN ultima_ejecucion TEXT',
        'ALTER TABLE plantillas_tarea ADD COLUMN total_generadas INTEGER DEFAULT 0'
    ];
    for (const mig of migracionesPlantillas) {
        try { await db.run(mig); } catch(e) { /* ya existe */ }
    }

    await db.exec(`
        CREATE TABLE IF NOT EXISTS tareas_programadas (
            id_programacion TEXT PRIMARY KEY,
            id_empresa TEXT NOT NULL,
            titulo TEXT NOT NULL,
            descripcion TEXT,
            id_tipo TEXT,
            tiempo_estimado_minutos INTEGER,
            prioridad TEXT DEFAULT 'media',
            id_empleado TEXT,
            id_supervisor TEXT,
            id_creador TEXT NOT NULL,
            fecha_programada TEXT NOT NULL,
            hora_programada TEXT DEFAULT '08:00',
            ejecutada INTEGER DEFAULT 0,
            id_tarea_generada TEXT,
            fecha_creacion TEXT DEFAULT ${isPostgres ? 'NOW()' : "(datetime('now', 'localtime'))"},
            FOREIGN KEY (id_empresa) REFERENCES empresas(id_empresa)
        )
    `);

    await db.exec(`
        CREATE TABLE IF NOT EXISTS movimientos_puntos (
            id ${isPostgres ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT'},
            id_usuario TEXT NOT NULL,
            id_tarea TEXT,
            puntos INTEGER NOT NULL,
            motivo TEXT NOT NULL,
            descripcion TEXT,
            fecha TEXT DEFAULT ${isPostgres ? 'NOW()' : "(datetime('now', 'localtime'))"}
        )
    `);

    await db.exec(`
        CREATE TABLE IF NOT EXISTS configuraciones_empresa (
            id_config TEXT PRIMARY KEY,
            id_empresa TEXT UNIQUE NOT NULL,
            usa_evidencias INTEGER DEFAULT 1,
            tolerancia_tiempo INTEGER DEFAULT 10,
            permite_supervisor_asignar INTEGER DEFAULT 1,
            formato_hora TEXT DEFAULT '12h',
            supervisor_ve_terminadas INTEGER DEFAULT 1,
            empleado_puede_iniciar INTEGER DEFAULT 1,
            modalidad_trabajo TEXT DEFAULT 'fijo',
            usa_gamificacion INTEGER DEFAULT 1,
            usa_geolocalizacion INTEGER DEFAULT 1,
            personalizacion_json TEXT DEFAULT '{}'
        )
    `);

    // Migración: nuevas columnas en configuraciones_empresa
    const migracionesConfig = [
        "ALTER TABLE configuraciones_empresa ADD COLUMN formato_hora TEXT DEFAULT '12h'",
        "ALTER TABLE configuraciones_empresa ADD COLUMN supervisor_ve_terminadas INTEGER DEFAULT 1",
        "ALTER TABLE configuraciones_empresa ADD COLUMN empleado_puede_iniciar INTEGER DEFAULT 1",
        "ALTER TABLE configuraciones_empresa ADD COLUMN modalidad_trabajo TEXT DEFAULT 'fijo'"
    ];
    for (const mig of migracionesConfig) {
        try { await db.run(mig); } catch(e) { /* ya existe */ }
    }

    // Migración: ubicación fija del empleado
    const migracionesUsuarios = [
        'ALTER TABLE usuarios ADD COLUMN ubicacion_fija_lat REAL',
        'ALTER TABLE usuarios ADD COLUMN ubicacion_fija_lng REAL',
        "ALTER TABLE usuarios ADD COLUMN ubicacion_fija_nombre TEXT DEFAULT ''"
    ];
    for (const mig of migracionesUsuarios) {
        try { await db.run(mig); } catch(e) { /* ya existe */ }
    }

    // Migración: requerir evidencia en tareas
    try {
        await db.run("ALTER TABLE tareas ADD COLUMN requiere_evidencia INTEGER DEFAULT 0");
    } catch(e) { /* ya existe */ }

    await db.exec(`
        CREATE TABLE IF NOT EXISTS auditoria (
            id_auditoria ${isPostgres ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT'},
            id_empresa TEXT,
            id_usuario TEXT,
            accion TEXT NOT NULL,
            descripcion TEXT,
            fecha TEXT DEFAULT ${isPostgres ? 'NOW()' : "(datetime('now', 'localtime'))"}
        )
    `);

    await db.exec(`
        CREATE TABLE IF NOT EXISTS accesos (
            id_acceso ${isPostgres ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT'},
            id_usuario TEXT,
            fecha_login TEXT DEFAULT ${isPostgres ? 'NOW()' : "(datetime('now', 'localtime'))"},
            ip TEXT,
            dispositivo TEXT
        )
    `);

    await db.exec(`
        CREATE TABLE IF NOT EXISTS asistencia (
            id_asistencia TEXT PRIMARY KEY,
            id_empresa TEXT NOT NULL,
            id_usuario TEXT NOT NULL,
            nombre_usuario TEXT,
            telefono TEXT,
            fecha TEXT NOT NULL,
            hora_entrada TEXT,
            hora_salida TEXT,
            lat_entrada REAL,
            lng_entrada REAL,
            lat_salida REAL,
            lng_salida REAL,
            duracion_minutos INTEGER,
            estado TEXT DEFAULT 'presente',
            fecha_creacion TEXT DEFAULT ${isPostgres ? 'NOW()' : "(datetime('now', 'localtime'))"},
            FOREIGN KEY (id_empresa) REFERENCES empresas(id_empresa),
            FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario)
        )
    `);

    // Índices
    const indices = [
        'CREATE INDEX IF NOT EXISTS idx_tareas_empresa_estado ON tareas(id_empresa, estado)',
        'CREATE INDEX IF NOT EXISTS idx_tareas_empleado ON tareas(id_empleado, estado)',
        'CREATE INDEX IF NOT EXISTS idx_tareas_supervisor ON tareas(id_supervisor, estado)',
        'CREATE INDEX IF NOT EXISTS idx_usuarios_empresa_rol ON usuarios(id_empresa, rol)',
        'CREATE INDEX IF NOT EXISTS idx_usuarios_codigo ON usuarios(codigo_acceso)',
        'CREATE INDEX IF NOT EXISTS idx_notificaciones_usuario ON notificaciones(id_usuario, leido)',
        'CREATE INDEX IF NOT EXISTS idx_auditoria_empresa ON auditoria(id_empresa, fecha)',
        'CREATE INDEX IF NOT EXISTS idx_seguimiento_tarea ON seguimiento_tiempo(id_tarea)',
        'CREATE INDEX IF NOT EXISTS idx_evidencias_tarea ON evidencias_tarea(id_tarea)',
        'CREATE INDEX IF NOT EXISTS idx_historial_tarea ON historial_estados_tarea(id_tarea)',
        'CREATE INDEX IF NOT EXISTS idx_movimientos_usuario ON movimientos_puntos(id_usuario)',
        'CREATE INDEX IF NOT EXISTS idx_supervisores_empleados_sup ON supervisores_empleados(id_supervisor)',
        'CREATE INDEX IF NOT EXISTS idx_supervisores_empleados_emp ON supervisores_empleados(id_empleado)'
    ];

    for (const idx of indices) {
        await db.exec(idx);
    }

    // Permisos base
    const permisosBase = [
        ['ASIGNAR_TAREAS', 'Puede asignar tareas a empleados'],
        ['VER_REPORTES', 'Puede ver reportes de productividad'],
        ['GESTIONAR_EMPLEADOS', 'Puede crear y editar empleados'],
        ['VER_TODOS_EMPLEADOS', 'Puede ver todos los empleados de la empresa'],
        ['GESTIONAR_TIPOS_TAREA', 'Puede crear tipos de tarea'],
        ['VER_EVIDENCIAS', 'Puede ver evidencias de tareas'],
        ['GESTIONAR_DEPARTAMENTOS', 'Puede crear y editar departamentos'],
        ['VER_DASHBOARD', 'Puede ver el dashboard ejecutivo'],
        ['GESTIONAR_CONFIGURACION', 'Puede modificar configuración de empresa'],
        ['VER_AUDITORIA', 'Puede ver logs de auditoría']
    ];

    for (const [codigo, descripcion] of permisosBase) {
        try {
            if (isPostgres) {
                await db.run(`INSERT INTO permisos (codigo, descripcion) VALUES (?, ?) ON CONFLICT (codigo) DO NOTHING`, codigo, descripcion);
            } else {
                await db.run(`INSERT OR IGNORE INTO permisos (codigo, descripcion) VALUES (?, ?)`, codigo, descripcion);
            }
        } catch(e) { /* ya existe */ }
    }

    console.log('✅ Base de datos inicializada correctamente');
}

module.exports = { db, inicializarDB, isPostgres };
