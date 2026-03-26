const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// En Render, usar el disco persistente montado en /opt/render/project/src/data
// Localmente, usar la carpeta ./data
const dataDir = process.env.RENDER ? '/opt/render/project/src/data' : path.join(__dirname, '..', 'data');

// Crear carpeta data si no existe
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'gestion_laboral.db');
const db = new Database(dbPath);

// Activar WAL mode y foreign keys
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function inicializarDB() {
    db.exec(`
        -- ═══════════════════════════════════════════
        -- 1. EMPRESAS
        -- ═══════════════════════════════════════════
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
            fecha_creacion TEXT DEFAULT (datetime('now', 'localtime'))
        );

        -- ═══════════════════════════════════════════
        -- 2. DEPARTAMENTOS
        -- ═══════════════════════════════════════════
        CREATE TABLE IF NOT EXISTS departamentos (
            id_departamento TEXT PRIMARY KEY,
            id_empresa TEXT NOT NULL,
            nombre TEXT NOT NULL,
            descripcion TEXT,
            id_responsable TEXT,
            estado INTEGER DEFAULT 1,
            fecha_creacion TEXT DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (id_empresa) REFERENCES empresas(id_empresa)
        );

        -- ═══════════════════════════════════════════
        -- 3. USUARIOS
        -- ═══════════════════════════════════════════
        CREATE TABLE IF NOT EXISTS usuarios (
            id_usuario TEXT PRIMARY KEY,
            id_empresa TEXT NOT NULL,
            identificacion TEXT,
            nombre TEXT NOT NULL,
            telefono TEXT,
            correo TEXT,
            foto_url TEXT,
            rol TEXT NOT NULL CHECK (rol IN ('ADMIN', 'SUPERVISOR', 'EMPLEADO')),
            codigo_acceso TEXT UNIQUE NOT NULL,
            password_hash TEXT,
            id_departamento TEXT,
            estado INTEGER DEFAULT 1,
            intentos_fallidos INTEGER DEFAULT 0,
            bloqueado_hasta TEXT,
            eliminado INTEGER DEFAULT 0,
            fecha_eliminacion TEXT,
            eliminado_por TEXT,
            fecha_creacion TEXT DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (id_empresa) REFERENCES empresas(id_empresa),
            FOREIGN KEY (id_departamento) REFERENCES departamentos(id_departamento)
        );

        -- ═══════════════════════════════════════════
        -- 4. SESIONES
        -- ═══════════════════════════════════════════
        CREATE TABLE IF NOT EXISTS sesiones (
            id_sesion TEXT PRIMARY KEY,
            id_usuario TEXT NOT NULL,
            refresh_token TEXT NOT NULL,
            dispositivo TEXT,
            ip TEXT,
            fecha_creacion TEXT DEFAULT (datetime('now', 'localtime')),
            fecha_expiracion TEXT NOT NULL,
            activa INTEGER DEFAULT 1,
            FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario)
        );

        -- ═══════════════════════════════════════════
        -- 5. PERMISOS (RBAC)
        -- ═══════════════════════════════════════════
        CREATE TABLE IF NOT EXISTS permisos (
            id_permiso INTEGER PRIMARY KEY AUTOINCREMENT,
            codigo TEXT UNIQUE NOT NULL,
            descripcion TEXT
        );

        CREATE TABLE IF NOT EXISTS rol_permisos (
            id_rol TEXT NOT NULL,
            id_permiso INTEGER NOT NULL,
            id_empresa TEXT NOT NULL,
            PRIMARY KEY (id_rol, id_permiso, id_empresa),
            FOREIGN KEY (id_permiso) REFERENCES permisos(id_permiso),
            FOREIGN KEY (id_empresa) REFERENCES empresas(id_empresa)
        );

        CREATE TABLE IF NOT EXISTS permisos_usuario (
            id_usuario TEXT NOT NULL,
            id_permiso INTEGER NOT NULL,
            concedido INTEGER DEFAULT 1,
            PRIMARY KEY (id_usuario, id_permiso),
            FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario),
            FOREIGN KEY (id_permiso) REFERENCES permisos(id_permiso)
        );

        -- ═══════════════════════════════════════════
        -- 6. RELACIÓN SUPERVISOR - EMPLEADO
        -- ═══════════════════════════════════════════
        CREATE TABLE IF NOT EXISTS supervisores_empleados (
            id_relacion TEXT PRIMARY KEY,
            id_supervisor TEXT NOT NULL,
            id_empleado TEXT NOT NULL,
            fecha_asignacion TEXT DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (id_supervisor) REFERENCES usuarios(id_usuario),
            FOREIGN KEY (id_empleado) REFERENCES usuarios(id_usuario)
        );

        -- ═══════════════════════════════════════════
        -- 7. TIPOS DE TAREA
        -- ═══════════════════════════════════════════
        CREATE TABLE IF NOT EXISTS tipos_tarea (
            id_tipo TEXT PRIMARY KEY,
            id_empresa TEXT NOT NULL,
            nombre TEXT NOT NULL,
            descripcion TEXT,
            peso_complejidad INTEGER DEFAULT 1,
            fecha_creacion TEXT DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (id_empresa) REFERENCES empresas(id_empresa)
        );

        -- ═══════════════════════════════════════════
        -- 8. TAREAS
        -- ═══════════════════════════════════════════
        CREATE TABLE IF NOT EXISTS tareas (
            id_tarea TEXT PRIMARY KEY,
            id_empresa TEXT NOT NULL,
            titulo TEXT NOT NULL,
            descripcion TEXT,
            id_empleado TEXT,
            id_supervisor TEXT,
            id_creador TEXT NOT NULL,
            id_tipo TEXT,
            prioridad TEXT DEFAULT 'media' CHECK (prioridad IN ('baja', 'media', 'alta', 'urgente')),
            tiempo_estimado_minutos INTEGER,
            estado TEXT DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'en_proceso', 'finalizada', 'atrasada', 'finalizada_atrasada')),
            fecha_creacion TEXT DEFAULT (datetime('now', 'localtime')),
            fecha_inicio TEXT,
            fecha_fin TEXT,
            eliminado INTEGER DEFAULT 0,
            FOREIGN KEY (id_empresa) REFERENCES empresas(id_empresa),
            FOREIGN KEY (id_empleado) REFERENCES usuarios(id_usuario),
            FOREIGN KEY (id_supervisor) REFERENCES usuarios(id_usuario),
            FOREIGN KEY (id_creador) REFERENCES usuarios(id_usuario),
            FOREIGN KEY (id_tipo) REFERENCES tipos_tarea(id_tipo)
        );

        -- ═══════════════════════════════════════════
        -- 9. HISTORIAL DE ESTADOS DE TAREA
        -- ═══════════════════════════════════════════
        CREATE TABLE IF NOT EXISTS historial_estados_tarea (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            id_tarea TEXT NOT NULL,
            estado_anterior TEXT,
            estado_nuevo TEXT NOT NULL,
            id_usuario TEXT,
            comentario TEXT,
            fecha TEXT DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (id_tarea) REFERENCES tareas(id_tarea),
            FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario)
        );

        -- ═══════════════════════════════════════════
        -- 10. SEGUIMIENTO DE TIEMPO + GEOLOCALIZACIÓN
        -- ═══════════════════════════════════════════
        CREATE TABLE IF NOT EXISTS seguimiento_tiempo (
            id_seguimiento TEXT PRIMARY KEY,
            id_tarea TEXT NOT NULL,
            hora_inicio TEXT,
            hora_fin TEXT,
            tiempo_real_segundos INTEGER,
            lat_inicio REAL,
            lng_inicio REAL,
            lat_fin REAL,
            lng_fin REAL,
            FOREIGN KEY (id_tarea) REFERENCES tareas(id_tarea)
        );

        -- ═══════════════════════════════════════════
        -- 11. EVIDENCIAS
        -- ═══════════════════════════════════════════
        CREATE TABLE IF NOT EXISTS evidencias_tarea (
            id_evidencia TEXT PRIMARY KEY,
            id_tarea TEXT NOT NULL,
            tipo TEXT CHECK (tipo IN ('imagen', 'texto')),
            contenido TEXT,
            fecha_registro TEXT DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (id_tarea) REFERENCES tareas(id_tarea)
        );

        -- ═══════════════════════════════════════════
        -- 12. COMENTARIOS EN TAREAS
        -- ═══════════════════════════════════════════
        CREATE TABLE IF NOT EXISTS comentarios_tarea (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            id_tarea TEXT NOT NULL,
            id_usuario TEXT NOT NULL,
            contenido TEXT NOT NULL,
            fecha TEXT DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (id_tarea) REFERENCES tareas(id_tarea),
            FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario)
        );

        -- ═══════════════════════════════════════════
        -- 13. NOTIFICACIONES
        -- ═══════════════════════════════════════════
        CREATE TABLE IF NOT EXISTS notificaciones (
            id_notificacion TEXT PRIMARY KEY,
            id_usuario TEXT NOT NULL,
            titulo TEXT,
            mensaje TEXT,
            tipo TEXT,
            leido INTEGER DEFAULT 0,
            fecha TEXT DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario)
        );

        -- ═══════════════════════════════════════════
        -- 14. PLANTILLAS DE TAREAS (RECURRENCIA)
        -- ═══════════════════════════════════════════
        CREATE TABLE IF NOT EXISTS plantillas_tarea (
            id_plantilla TEXT PRIMARY KEY,
            id_empresa TEXT NOT NULL,
            titulo TEXT NOT NULL,
            descripcion TEXT,
            id_tipo TEXT,
            tiempo_estimado_minutos INTEGER,
            prioridad TEXT DEFAULT 'media',
            recurrencia TEXT CHECK (recurrencia IN ('diaria', 'semanal', 'mensual', 'personalizada')),
            dias_semana TEXT,
            hora_creacion TEXT,
            id_empleado_default TEXT,
            id_supervisor_default TEXT,
            activa INTEGER DEFAULT 1,
            fecha_creacion TEXT DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (id_empresa) REFERENCES empresas(id_empresa)
        );

        -- ═══════════════════════════════════════════
        -- 15. GAMIFICACIÓN (MOVIMIENTOS DE PUNTOS)
        -- ═══════════════════════════════════════════
        CREATE TABLE IF NOT EXISTS movimientos_puntos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            id_usuario TEXT NOT NULL,
            id_tarea TEXT,
            puntos INTEGER NOT NULL,
            motivo TEXT NOT NULL,
            descripcion TEXT,
            fecha TEXT DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario),
            FOREIGN KEY (id_tarea) REFERENCES tareas(id_tarea)
        );

        -- ═══════════════════════════════════════════
        -- 16. CONFIGURACIÓN POR EMPRESA
        -- ═══════════════════════════════════════════
        CREATE TABLE IF NOT EXISTS configuraciones_empresa (
            id_config TEXT PRIMARY KEY,
            id_empresa TEXT UNIQUE NOT NULL,
            usa_evidencias INTEGER DEFAULT 1,
            tolerancia_tiempo INTEGER DEFAULT 10,
            permite_supervisor_asignar INTEGER DEFAULT 1,
            usa_gamificacion INTEGER DEFAULT 1,
            usa_geolocalizacion INTEGER DEFAULT 1,
            personalizacion_json TEXT DEFAULT '{}',
            FOREIGN KEY (id_empresa) REFERENCES empresas(id_empresa)
        );

        -- ═══════════════════════════════════════════
        -- 17. AUDITORÍA
        -- ═══════════════════════════════════════════
        CREATE TABLE IF NOT EXISTS auditoria (
            id_auditoria INTEGER PRIMARY KEY AUTOINCREMENT,
            id_empresa TEXT,
            id_usuario TEXT,
            accion TEXT NOT NULL,
            descripcion TEXT,
            fecha TEXT DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (id_empresa) REFERENCES empresas(id_empresa),
            FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario)
        );

        -- ═══════════════════════════════════════════
        -- 18. LOG DE ACCESOS
        -- ═══════════════════════════════════════════
        CREATE TABLE IF NOT EXISTS accesos (
            id_acceso INTEGER PRIMARY KEY AUTOINCREMENT,
            id_usuario TEXT,
            fecha_login TEXT DEFAULT (datetime('now', 'localtime')),
            ip TEXT,
            dispositivo TEXT,
            FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario)
        );

        -- ═══════════════════════════════════════════
        -- ÍNDICES CRÍTICOS
        -- ═══════════════════════════════════════════
        CREATE INDEX IF NOT EXISTS idx_tareas_empresa_estado ON tareas(id_empresa, estado);
        CREATE INDEX IF NOT EXISTS idx_tareas_empleado ON tareas(id_empleado, estado);
        CREATE INDEX IF NOT EXISTS idx_tareas_supervisor ON tareas(id_supervisor, estado);
        CREATE INDEX IF NOT EXISTS idx_usuarios_empresa_rol ON usuarios(id_empresa, rol);
        CREATE INDEX IF NOT EXISTS idx_usuarios_codigo ON usuarios(codigo_acceso);
        CREATE INDEX IF NOT EXISTS idx_notificaciones_usuario ON notificaciones(id_usuario, leido);
        CREATE INDEX IF NOT EXISTS idx_auditoria_empresa ON auditoria(id_empresa, fecha);
        CREATE INDEX IF NOT EXISTS idx_seguimiento_tarea ON seguimiento_tiempo(id_tarea);
        CREATE INDEX IF NOT EXISTS idx_evidencias_tarea ON evidencias_tarea(id_tarea);
        CREATE INDEX IF NOT EXISTS idx_historial_tarea ON historial_estados_tarea(id_tarea);
        CREATE INDEX IF NOT EXISTS idx_movimientos_usuario ON movimientos_puntos(id_usuario);
        CREATE INDEX IF NOT EXISTS idx_supervisores_empleados_sup ON supervisores_empleados(id_supervisor);
        CREATE INDEX IF NOT EXISTS idx_supervisores_empleados_emp ON supervisores_empleados(id_empleado);
    `);

    // Insertar permisos base si no existen
    const permisosBase = [
        { codigo: 'ASIGNAR_TAREAS', descripcion: 'Puede asignar tareas a empleados' },
        { codigo: 'VER_REPORTES', descripcion: 'Puede ver reportes de productividad' },
        { codigo: 'GESTIONAR_EMPLEADOS', descripcion: 'Puede crear y editar empleados' },
        { codigo: 'VER_TODOS_EMPLEADOS', descripcion: 'Puede ver todos los empleados de la empresa' },
        { codigo: 'GESTIONAR_TIPOS_TAREA', descripcion: 'Puede crear tipos de tarea' },
        { codigo: 'VER_EVIDENCIAS', descripcion: 'Puede ver evidencias de tareas' },
        { codigo: 'GESTIONAR_DEPARTAMENTOS', descripcion: 'Puede crear y editar departamentos' },
        { codigo: 'VER_DASHBOARD', descripcion: 'Puede ver el dashboard ejecutivo' },
        { codigo: 'GESTIONAR_CONFIGURACION', descripcion: 'Puede modificar configuración de empresa' },
        { codigo: 'VER_AUDITORIA', descripcion: 'Puede ver logs de auditoría' }
    ];

    const insertPermiso = db.prepare(`
        INSERT OR IGNORE INTO permisos (codigo, descripcion) VALUES (?, ?)
    `);

    for (const p of permisosBase) {
        insertPermiso.run(p.codigo, p.descripcion);
    }
    // ═══════════════════════════════════════════
    // MIGRACIONES (agregar columnas a tablas existentes)
    // ═══════════════════════════════════════════
    const migraciones = [
        "ALTER TABLE empresas ADD COLUMN pais TEXT DEFAULT 'MX'",
        "ALTER TABLE empresas ADD COLUMN moneda TEXT DEFAULT 'MXN'",
        "ALTER TABLE empresas ADD COLUMN zona_horaria TEXT DEFAULT 'America/Mexico_City'"
    ];

    for (const sql of migraciones) {
        try { db.exec(sql); } catch(e) { /* columna ya existe */ }
    }

    console.log('✅ Base de datos inicializada correctamente');
}

module.exports = { db, inicializarDB };
