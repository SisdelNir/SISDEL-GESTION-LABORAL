-- ============================================================
-- BOTÓN DE PÁNICO — Esquema de Base de Datos PostgreSQL
-- Sistema de Emergencia Ciudadana con Centro de Monitoreo
-- ============================================================

-- Extensión para UUIDs
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- 1. USUARIOS (Perfil central del ciudadano)
-- ============================================================
CREATE TABLE usuarios (
    id_usuario UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nombre_completo VARCHAR(150) NOT NULL,
    telefono_principal VARCHAR(20) NOT NULL UNIQUE,
    email VARCHAR(100),
    fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    activo BOOLEAN DEFAULT TRUE
);

-- ============================================================
-- 2. CONTACTOS DE EMERGENCIA (Máx 10 por usuario, con prioridad)
-- ============================================================
CREATE TABLE contactos_emergencia (
    id_contacto SERIAL PRIMARY KEY,
    id_usuario UUID NOT NULL REFERENCES usuarios(id_usuario) ON DELETE CASCADE,
    nombre_contacto VARCHAR(150) NOT NULL,
    telefono VARCHAR(20) NOT NULL,
    relacion VARCHAR(50),                -- Ej: 'Madre', 'Esposo', 'Amigo'
    nivel_prioridad INT CHECK (nivel_prioridad BETWEEN 1 AND 10),
    notificar_sms BOOLEAN DEFAULT TRUE,
    notificar_push BOOLEAN DEFAULT TRUE,
    UNIQUE (id_usuario, nivel_prioridad) -- No duplicar prioridades por usuario
);

-- ============================================================
-- 3. PERFIL MÉDICO (Datos críticos de salud)
-- ============================================================
CREATE TABLE perfil_medico (
    id_perfil SERIAL PRIMARY KEY,
    id_usuario UUID NOT NULL UNIQUE REFERENCES usuarios(id_usuario) ON DELETE CASCADE,
    tipo_sangre VARCHAR(5),              -- Ej: 'O+', 'A-', 'AB+'
    enfermedades_cronicas TEXT,          -- Ej: 'Hipertensión, Diabetes Tipo 2'
    alergias TEXT,                       -- Ej: 'Penicilina, Mariscos'
    medicamentos_actuales TEXT,          -- Ej: 'Enalapril 10mg, Metformina 850mg'
    ultima_crisis TEXT,                  -- Ej: 'Crisis hipertensiva hace 3 meses'
    contacto_medico VARCHAR(150),        -- Nombre del médico tratante
    telefono_medico VARCHAR(20),
    notas_adicionales TEXT,
    ultima_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 4. EMERGENCIAS (Registro de eventos de pánico)
-- ============================================================
CREATE TABLE emergencias (
    id_emergencia UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    id_usuario UUID NOT NULL REFERENCES usuarios(id_usuario),
    tipo_emergencia VARCHAR(20) NOT NULL CHECK (tipo_emergencia IN ('VIOLENCIA', 'SALUD')),
    gps_latitud DECIMAL(10, 8),
    gps_longitud DECIMAL(11, 8),
    direccion_aproximada TEXT,
    estatus VARCHAR(30) DEFAULT 'ACTIVA'
        CHECK (estatus IN ('ACTIVA', 'EN_CAMINO', 'EN_SITIO', 'RESUELTA', 'FALSA_ALARMA', 'CANCELADA')),
    metodo_disparo VARCHAR(20) DEFAULT 'APP'
        CHECK (metodo_disparo IN ('APP', 'BOTON_FISICO', 'HEARTBEAT')),
    resumen_medico TEXT,                 -- Resumen auto-generado si tipo=SALUD
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_resolucion TIMESTAMP
);

-- ============================================================
-- 5. EVIDENCIAS (Vault inmutable de pruebas cifradas)
-- ============================================================
CREATE TABLE evidencias (
    id_evidencia SERIAL PRIMARY KEY,
    id_emergencia UUID NOT NULL REFERENCES emergencias(id_emergencia) ON DELETE CASCADE,
    tipo_media VARCHAR(10) NOT NULL CHECK (tipo_media IN ('AUDIO', 'IMAGEN', 'VIDEO')),
    url_media TEXT NOT NULL,
    formato VARCHAR(10),                 -- Ej: 'opus', 'webp', 'jpg'
    tamano_bytes BIGINT,
    cifrado_e2ee BOOLEAN DEFAULT TRUE,
    hash_verificacion VARCHAR(128),      -- SHA-512 para integridad
    subido_exitosamente BOOLEAN DEFAULT FALSE,
    fecha_captura TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_subida TIMESTAMP
);

-- ============================================================
-- 6. OPERADORES (Centro de Monitoreo)
-- ============================================================
CREATE TABLE operadores (
    id_operador SERIAL PRIMARY KEY,
    nombre_operador VARCHAR(100) NOT NULL,
    rol VARCHAR(20) DEFAULT 'OPERADOR'
        CHECK (rol IN ('OPERADOR', 'ADMIN', 'SUPERVISOR')),
    usuario_acceso VARCHAR(50) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    activo BOOLEAN DEFAULT TRUE,
    ultimo_login TIMESTAMP,
    fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 7. DESPACHO DE UNIDADES (Asignación de patrulla/ambulancia)
-- ============================================================
CREATE TABLE despacho_unidades (
    id_despacho SERIAL PRIMARY KEY,
    id_emergencia UUID NOT NULL REFERENCES emergencias(id_emergencia),
    id_operador INT NOT NULL REFERENCES operadores(id_operador),
    tipo_unidad VARCHAR(20) DEFAULT 'PATRULLA'
        CHECK (tipo_unidad IN ('PATRULLA', 'AMBULANCIA', 'BOMBEROS', 'PROTECCION_CIVIL')),
    unidad_asignada VARCHAR(50),         -- Placa o ID de la unidad
    notas_operador TEXT,
    hora_despacho TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    hora_llegada TIMESTAMP,
    estatus_final VARCHAR(50)
        CHECK (estatus_final IN ('DESPACHADA', 'EN_CAMINO', 'EN_SITIO', 'SITUACION_CONTROLADA', 'CANCELADA'))
);

-- ============================================================
-- 8. HEARTBEAT SESIONES (Sistema "Hombre Muerto")
-- ============================================================
CREATE TABLE heartbeat_sesiones (
    id_sesion SERIAL PRIMARY KEY,
    id_usuario UUID NOT NULL REFERENCES usuarios(id_usuario),
    activa BOOLEAN DEFAULT TRUE,
    intervalo_segundos INT DEFAULT 60,   -- Cada cuánto debe hacer "ping" el celular
    ultimo_ping TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    alerta_disparada BOOLEAN DEFAULT FALSE,
    fecha_inicio TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_fin TIMESTAMP
);

-- ============================================================
-- ÍNDICES PARA RENDIMIENTO
-- ============================================================
CREATE INDEX idx_emergencias_estatus ON emergencias(estatus);
CREATE INDEX idx_emergencias_usuario ON emergencias(id_usuario);
CREATE INDEX idx_emergencias_fecha ON emergencias(fecha_creacion DESC);
CREATE INDEX idx_contactos_usuario ON contactos_emergencia(id_usuario);
CREATE INDEX idx_evidencias_emergencia ON evidencias(id_emergencia);
CREATE INDEX idx_despacho_emergencia ON despacho_unidades(id_emergencia);
CREATE INDEX idx_heartbeat_usuario ON heartbeat_sesiones(id_usuario, activa);
