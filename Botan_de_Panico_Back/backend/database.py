"""
Botón de Pánico SISDEL — Base de Datos
Soporta PostgreSQL (Render) y SQLite (local)
"""

import uuid, random, string, os, json
from datetime import datetime
from typing import List, Optional
from contextlib import contextmanager

CLAVE_PROGRAMADOR = "1122"
NOMBRE_SISTEMA    = "Botón de Pánico SISDEL"

# ── Detectar motor ──────────────────────────────────────────
DATABASE_URL = os.environ.get("DATABASE_URL", "")
USE_PG = DATABASE_URL.startswith("postgresql")

if USE_PG:
    import psycopg2
    import psycopg2.extras
else:
    import sqlite3
    _DATA_DIR = "/data" if os.path.isdir("/data") else os.path.dirname(__file__)
    DB_PATH = os.path.join(_DATA_DIR, "sisdel.db")


def generar_clave_6(nombre: str = None) -> str:
    letras = [c for c in (nombre or '').upper() if c.isalpha()]
    if letras and len(letras) >= 2:
        l1, l3 = letras[0], letras[-1]
    else:
        l1 = random.choice(string.ascii_uppercase)
        l3 = random.choice(string.ascii_uppercase)
    l2   = random.choice(string.ascii_uppercase)
    nums = ''.join(random.choices(string.digits, k=3))
    return f"{l1}{l2}{l3}{nums}"


def generar_codigo_agente(nombre_institucion: str, nombre_agente: str) -> str:
    """Código 6 chars: 1ra letra institución + letra azar + 1ra letra agente + 3 nums azar"""
    l1 = next((c for c in (nombre_institucion or '').upper() if c.isalpha()), random.choice(string.ascii_uppercase))
    l2 = random.choice(string.ascii_uppercase)
    l3 = next((c for c in (nombre_agente or '').upper() if c.isalpha()), random.choice(string.ascii_uppercase))
    nums = ''.join(random.choices(string.digits, k=3))
    return f"{l1}{l2}{l3}{nums}"


# ── Parámetro placeholder ──────────────────────────────────
# PostgreSQL usa %s, SQLite usa ?
PH = "%s" if USE_PG else "?"


def _ph(sql_with_qmark: str) -> str:
    """Convierte SQL con ? placeholders a %s si es PostgreSQL."""
    if USE_PG:
        return sql_with_qmark.replace("?", "%s")
    return sql_with_qmark


@contextmanager
def get_conn():
    if USE_PG:
        conn = psycopg2.connect(DATABASE_URL)
        conn.autocommit = False
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()
    else:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()


def _fetchone(conn, sql, params=()):
    """Ejecuta y retorna una fila como dict."""
    if USE_PG:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(sql, params)
        row = cur.fetchone()
        cur.close()
        return dict(row) if row else None
    else:
        row = conn.execute(sql, params).fetchone()
        return dict(row) if row else None


def _fetchall(conn, sql, params=()):
    """Ejecuta y retorna todas las filas como list[dict]."""
    if USE_PG:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(sql, params)
        rows = cur.fetchall()
        cur.close()
        return [dict(r) for r in rows]
    else:
        rows = conn.execute(sql, params).fetchall()
        return [dict(r) for r in rows]


def _execute(conn, sql, params=()):
    """Ejecuta SQL y retorna el cursor."""
    if USE_PG:
        cur = conn.cursor()
        cur.execute(sql, params)
        return cur
    else:
        return conn.execute(sql, params)


# ── Init DB ─────────────────────────────────────────────────

def init_db():
    """Crea las tablas si no existen."""
    with get_conn() as conn:
        if USE_PG:
            _execute(conn, """
            CREATE TABLE IF NOT EXISTS instituciones (
                id_institucion    TEXT PRIMARY KEY,
                nombre_institucion TEXT NOT NULL,
                nombre_admin      TEXT NOT NULL,
                telefono          TEXT DEFAULT '',
                correo            TEXT DEFAULT '',
                direccion         TEXT DEFAULT '',
                pais              TEXT DEFAULT '502',
                clave_acceso      TEXT NOT NULL,
                activo            BOOLEAN DEFAULT TRUE,
                fecha_registro    TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS claves_vecinos (
                id_clave        SERIAL PRIMARY KEY,
                clave           TEXT NOT NULL,
                id_institucion  TEXT NOT NULL REFERENCES instituciones(id_institucion),
                descripcion     TEXT DEFAULT '',
                usada           BOOLEAN DEFAULT FALSE,
                id_vecino       TEXT,
                fecha_creacion  TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS vecinos (
                id_vecino          TEXT PRIMARY KEY,
                id_institucion     TEXT NOT NULL REFERENCES instituciones(id_institucion),
                nombre             TEXT NOT NULL,
                telefono           TEXT NOT NULL,
                num_identificacion TEXT NOT NULL,
                direccion          TEXT DEFAULT '',
                sexo               TEXT DEFAULT '',
                edad               INTEGER DEFAULT 0,
                correo             TEXT DEFAULT '',
                codigo_vecino      TEXT DEFAULT '',
                clave_acceso       TEXT DEFAULT '',
                activo             BOOLEAN DEFAULT TRUE,
                fecha_registro     TEXT NOT NULL,
                fam_nombre_1       TEXT DEFAULT '',
                fam_tel_1          TEXT DEFAULT '',
                fam_nombre_2       TEXT DEFAULT '',
                fam_tel_2          TEXT DEFAULT '',
                fam_nombre_3       TEXT DEFAULT '',
                fam_tel_3          TEXT DEFAULT '',
                fam_nombre_4       TEXT DEFAULT '',
                fam_tel_4          TEXT DEFAULT '',
                fam_nombre_5       TEXT DEFAULT '',
                fam_nombre_5       TEXT DEFAULT '',
                fam_tel_5          TEXT DEFAULT '',
                voz_alerta         TEXT DEFAULT '',
                UNIQUE (id_institucion, num_identificacion)
            );

            CREATE TABLE IF NOT EXISTS emergencias (
                id_emergencia        TEXT PRIMARY KEY,
                id_institucion       TEXT NOT NULL REFERENCES instituciones(id_institucion),
                id_vecino            TEXT,
                numero_caso          TEXT UNIQUE NOT NULL,
                nombre_vecino        TEXT DEFAULT 'Desconocido',
                telefono_vecino      TEXT DEFAULT '',
                num_identificacion   TEXT DEFAULT '',
                direccion_vecino     TEXT DEFAULT '',
                gps_latitud          REAL,
                gps_longitud         REAL,
                direccion_aproximada TEXT DEFAULT '',
                estatus              TEXT DEFAULT 'ACTIVA',
                notas_operador       TEXT,
                fecha_creacion       TEXT NOT NULL,
                fecha_atencion       TEXT
            );

            CREATE TABLE IF NOT EXISTS contactos_emergencia (
                id_contacto     SERIAL PRIMARY KEY,
                id_vecino       TEXT NOT NULL REFERENCES vecinos(id_vecino) ON DELETE CASCADE,
                nombre          TEXT DEFAULT '',
                telefono        TEXT NOT NULL,
                posicion        INTEGER DEFAULT 1
            );

            CREATE TABLE IF NOT EXISTS agentes (
                num_identificacion TEXT NOT NULL,
                id_institucion     TEXT NOT NULL REFERENCES instituciones(id_institucion),
                nombre             TEXT NOT NULL,
                telefono           TEXT DEFAULT '',
                edad               INTEGER DEFAULT 0,
                sexo               TEXT DEFAULT '',
                pais               TEXT DEFAULT '',
                puesto             TEXT DEFAULT '',
                jefe_inmediato     TEXT DEFAULT '',
                codigo_agente      TEXT DEFAULT '',
                activo             BOOLEAN DEFAULT TRUE,
                fecha_registro     TEXT NOT NULL,
                PRIMARY KEY (id_institucion, num_identificacion)
            );
            """)
        else:
            conn.executescript("""
            CREATE TABLE IF NOT EXISTS instituciones (
                id_institucion    TEXT PRIMARY KEY,
                nombre_institucion TEXT NOT NULL,
                nombre_admin      TEXT NOT NULL,
                telefono          TEXT DEFAULT '',
                correo            TEXT DEFAULT '',
                direccion         TEXT DEFAULT '',
                clave_acceso      TEXT NOT NULL,
                activo            INTEGER DEFAULT 1,
                fecha_registro    TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS claves_vecinos (
                id_clave        INTEGER PRIMARY KEY AUTOINCREMENT,
                clave           TEXT NOT NULL,
                id_institucion  TEXT NOT NULL,
                descripcion     TEXT DEFAULT '',
                usada           INTEGER DEFAULT 0,
                id_vecino       TEXT,
                fecha_creacion  TEXT NOT NULL,
                FOREIGN KEY (id_institucion) REFERENCES instituciones(id_institucion)
            );

            CREATE TABLE IF NOT EXISTS vecinos (
                id_vecino          TEXT PRIMARY KEY,
                id_institucion     TEXT NOT NULL,
                nombre             TEXT NOT NULL,
                telefono           TEXT NOT NULL,
                num_identificacion TEXT NOT NULL,
                direccion          TEXT DEFAULT '',
                sexo               TEXT DEFAULT '',
                edad               INTEGER DEFAULT 0,
                correo             TEXT DEFAULT '',
                codigo_vecino      TEXT DEFAULT '',
                clave_acceso       TEXT DEFAULT '',
                activo             INTEGER DEFAULT 1,
                fecha_registro     TEXT NOT NULL,
                fam_nombre_1       TEXT DEFAULT '',
                fam_tel_1          TEXT DEFAULT '',
                fam_nombre_2       TEXT DEFAULT '',
                fam_tel_2          TEXT DEFAULT '',
                fam_nombre_3       TEXT DEFAULT '',
                fam_tel_3          TEXT DEFAULT '',
                fam_nombre_4       TEXT DEFAULT '',
                fam_tel_4          TEXT DEFAULT '',
                fam_nombre_5       TEXT DEFAULT '',
                fam_nombre_5       TEXT DEFAULT '',
                fam_tel_5          TEXT DEFAULT '',
                voz_alerta         TEXT DEFAULT '',
                FOREIGN KEY (id_institucion) REFERENCES instituciones(id_institucion),
                UNIQUE (id_institucion, num_identificacion)
            );

            CREATE TABLE IF NOT EXISTS emergencias (
                id_emergencia        TEXT PRIMARY KEY,
                id_institucion       TEXT NOT NULL,
                id_vecino            TEXT,
                numero_caso          TEXT UNIQUE NOT NULL,
                nombre_vecino        TEXT DEFAULT 'Desconocido',
                telefono_vecino      TEXT DEFAULT '',
                num_identificacion   TEXT DEFAULT '',
                direccion_vecino     TEXT DEFAULT '',
                gps_latitud          REAL,
                gps_longitud         REAL,
                direccion_aproximada TEXT DEFAULT '',
                estatus              TEXT DEFAULT 'ACTIVA',
                notas_operador       TEXT,
                fecha_creacion       TEXT NOT NULL,
                fecha_atencion       TEXT,
                FOREIGN KEY (id_institucion) REFERENCES instituciones(id_institucion)
            );

            CREATE TABLE IF NOT EXISTS contactos_emergencia (
                id_contacto     INTEGER PRIMARY KEY AUTOINCREMENT,
                id_vecino       TEXT NOT NULL,
                nombre          TEXT DEFAULT '',
                telefono        TEXT NOT NULL,
                posicion        INTEGER DEFAULT 1,
                FOREIGN KEY (id_vecino) REFERENCES vecinos(id_vecino)
            );

            CREATE TABLE IF NOT EXISTS agentes (
                num_identificacion TEXT NOT NULL,
                id_institucion     TEXT NOT NULL,
                nombre             TEXT NOT NULL,
                telefono           TEXT DEFAULT '',
                edad               INTEGER DEFAULT 0,
                sexo               TEXT DEFAULT '',
                pais               TEXT DEFAULT '',
                puesto             TEXT DEFAULT '',
                jefe_inmediato     TEXT DEFAULT '',
                codigo_agente      TEXT DEFAULT '',
                activo             INTEGER DEFAULT 1,
                fecha_registro     TEXT NOT NULL,
                PRIMARY KEY (id_institucion, num_identificacion),
                FOREIGN KEY (id_institucion) REFERENCES instituciones(id_institucion)
            );
            """)

        # Demo seed
        count = _fetchone(conn, "SELECT COUNT(*) as cnt FROM instituciones")
        if count and count["cnt"] == 0:
            _seed_demo(conn)

    # Migración: agregar columnas de familiares si no existen (para DBs ya creadas)
    _migrar_columnas_familiares()

    # Migración: agregar numero_caso y tabla agentes si no existen
    _migrar_emergencias_y_agentes()

    # Migración: agregar voz_alerta si no existe
    _migrar_columna_voz_alerta()

    # Restaurar instituciones desde env var
    _seed_from_env()

    # Migración: tablas de Empresa de Seguridad
    _migrar_tablas_empresas()

def _migrar_columnas_familiares():
    """Agrega columnas fam_nombre/fam_tel 1-5 a tabla vecinos si no existen."""
    cols = ['fam_nombre_1','fam_tel_1','fam_nombre_2','fam_tel_2',
            'fam_nombre_3','fam_tel_3','fam_nombre_4','fam_tel_4',
            'fam_nombre_5','fam_tel_5']
    with get_conn() as conn:
        for col in cols:
            try:
                if USE_PG:
                    _execute(conn, f"ALTER TABLE vecinos ADD COLUMN IF NOT EXISTS {col} TEXT DEFAULT ''")
                else:
                    # SQLite no soporta IF NOT EXISTS en ALTER TABLE
                    existing = _fetchall(conn, "PRAGMA table_info(vecinos)")
                    col_names = [r['name'] for r in existing]
                    if col not in col_names:
                        _execute(conn, f"ALTER TABLE vecinos ADD COLUMN {col} TEXT DEFAULT ''")
            except Exception:
                pass  # columna ya existe

def _migrar_columna_voz_alerta():
    """Agrega columna voz_alerta a tabla vecinos si no existe."""
    col = 'voz_alerta'
    with get_conn() as conn:
        try:
            if USE_PG:
                _execute(conn, f"ALTER TABLE vecinos ADD COLUMN IF NOT EXISTS {col} TEXT DEFAULT ''")
            else:
                existing = _fetchall(conn, "PRAGMA table_info(vecinos)")
                col_names = [r['name'] for r in existing]
                if col not in col_names:
                    _execute(conn, f"ALTER TABLE vecinos ADD COLUMN {col} TEXT DEFAULT ''")
        except Exception:
            pass


def _migrar_emergencias_y_agentes():
    """Agrega numero_caso a emergencias y crea tabla agentes si no existen."""
    with get_conn() as conn:
        # Agregar numero_caso a emergencias
        try:
            if USE_PG:
                _execute(conn, "ALTER TABLE emergencias ADD COLUMN IF NOT EXISTS numero_caso TEXT DEFAULT ''")
            else:
                existing = _fetchall(conn, "PRAGMA table_info(emergencias)")
                col_names = [r['name'] for r in existing]
                if 'numero_caso' not in col_names:
                    _execute(conn, "ALTER TABLE emergencias ADD COLUMN numero_caso TEXT DEFAULT ''")
        except Exception:
            pass

        # Crear tabla agentes si no existe
        try:
            if USE_PG:
                _execute(conn, """
                    CREATE TABLE IF NOT EXISTS agentes (
                        num_identificacion TEXT NOT NULL,
                        id_institucion     TEXT NOT NULL REFERENCES instituciones(id_institucion),
                        nombre             TEXT NOT NULL,
                        telefono           TEXT DEFAULT '',
                        edad               INTEGER DEFAULT 0,
                        sexo               TEXT DEFAULT '',
                        pais               TEXT DEFAULT '',
                        puesto             TEXT DEFAULT '',
                        jefe_inmediato     TEXT DEFAULT '',
                        codigo_agente      TEXT DEFAULT '',
                        activo             BOOLEAN DEFAULT TRUE,
                        fecha_registro     TEXT NOT NULL,
                        PRIMARY KEY (id_institucion, num_identificacion)
                    )
                """)
            else:
                _execute(conn, """
                    CREATE TABLE IF NOT EXISTS agentes (
                        num_identificacion TEXT NOT NULL,
                        id_institucion     TEXT NOT NULL,
                        nombre             TEXT NOT NULL,
                        telefono           TEXT DEFAULT '',
                        edad               INTEGER DEFAULT 0,
                        sexo               TEXT DEFAULT '',
                        pais               TEXT DEFAULT '',
                        puesto             TEXT DEFAULT '',
                        jefe_inmediato     TEXT DEFAULT '',
                        codigo_agente      TEXT DEFAULT '',
                        activo             INTEGER DEFAULT 1,
                        fecha_registro     TEXT NOT NULL,
                        PRIMARY KEY (id_institucion, num_identificacion),
                        FOREIGN KEY (id_institucion) REFERENCES instituciones(id_institucion)
                    )
                """)
        except Exception:
            pass

        # Crear tabla asignaciones_agentes si no existe
        try:
            if USE_PG:
                _execute(conn, """
                    CREATE TABLE IF NOT EXISTS asignaciones_agentes (
                        id_emergencia      TEXT NOT NULL,
                        id_institucion     TEXT NOT NULL,
                        num_identificacion TEXT NOT NULL,
                        slot               INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 4),
                        fecha_asignacion   TEXT NOT NULL,
                        PRIMARY KEY (id_emergencia, slot)
                    )
                """)
            else:
                _execute(conn, """
                    CREATE TABLE IF NOT EXISTS asignaciones_agentes (
                        id_emergencia      TEXT NOT NULL,
                        id_institucion     TEXT NOT NULL,
                        num_identificacion TEXT NOT NULL,
                        slot               INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 4),
                        fecha_asignacion   TEXT NOT NULL,
                        PRIMARY KEY (id_emergencia, slot)
                    )
                """)
        except Exception:
            pass


def _migrar_tablas_empresas():
    """Crea las tablas del módulo Empresa de Seguridad (pilotos, alertas, agentes)."""
    with get_conn() as conn:
        if USE_PG:
            _execute(conn, """
                CREATE TABLE IF NOT EXISTS empresas_seguridad (
                    id_empresa         TEXT PRIMARY KEY,
                    nombre_empresa     TEXT NOT NULL,
                    nombre_admin       TEXT NOT NULL,
                    telefono           TEXT DEFAULT '',
                    correo             TEXT DEFAULT '',
                    direccion          TEXT DEFAULT '',
                    clave_acceso       TEXT NOT NULL,
                    activo             BOOLEAN DEFAULT TRUE,
                    fecha_registro     TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS pilotos (
                    id_piloto          TEXT PRIMARY KEY,
                    id_empresa         TEXT NOT NULL REFERENCES empresas_seguridad(id_empresa),
                    nombre             TEXT NOT NULL,
                    telefono           TEXT NOT NULL,
                    num_identificacion TEXT NOT NULL,
                    num_licencia       TEXT DEFAULT '',
                    empresa_labora     TEXT DEFAULT '',
                    placas_vehiculo    TEXT DEFAULT '',
                    tipo_vehiculo      TEXT DEFAULT '',
                    color_vehiculo     TEXT DEFAULT '',
                    foto_vehiculo      TEXT DEFAULT '',
                    direccion          TEXT DEFAULT '',
                    sexo               TEXT DEFAULT '',
                    edad               INTEGER DEFAULT 0,
                    correo             TEXT DEFAULT '',
                    codigo_piloto      TEXT DEFAULT '',
                    clave_acceso       TEXT DEFAULT '',
                    activo             BOOLEAN DEFAULT TRUE,
                    fecha_registro     TEXT NOT NULL,
                    fam_nombre_1 TEXT DEFAULT '', fam_tel_1 TEXT DEFAULT '',
                    fam_nombre_2 TEXT DEFAULT '', fam_tel_2 TEXT DEFAULT '',
                    fam_nombre_3 TEXT DEFAULT '', fam_tel_3 TEXT DEFAULT '',
                    fam_nombre_4 TEXT DEFAULT '', fam_tel_4 TEXT DEFAULT '',
                    fam_nombre_5 TEXT DEFAULT '', fam_tel_5 TEXT DEFAULT '',
                    voz_alerta         TEXT DEFAULT '',
                    UNIQUE (id_empresa, num_identificacion)
                );

                CREATE TABLE IF NOT EXISTS alertas_empresa (
                    id_alerta            TEXT PRIMARY KEY,
                    id_empresa           TEXT NOT NULL REFERENCES empresas_seguridad(id_empresa),
                    id_piloto            TEXT,
                    numero_caso          TEXT UNIQUE NOT NULL,
                    nombre_piloto        TEXT DEFAULT 'Desconocido',
                    telefono_piloto      TEXT DEFAULT '',
                    num_identificacion   TEXT DEFAULT '',
                    placas_vehiculo      TEXT DEFAULT '',
                    tipo_vehiculo        TEXT DEFAULT '',
                    color_vehiculo       TEXT DEFAULT '',
                    direccion_piloto     TEXT DEFAULT '',
                    gps_latitud          REAL,
                    gps_longitud         REAL,
                    direccion_aproximada TEXT DEFAULT '',
                    estatus              TEXT DEFAULT 'ACTIVA',
                    notas_operador       TEXT,
                    fecha_creacion       TEXT NOT NULL,
                    fecha_atencion       TEXT
                );

                CREATE TABLE IF NOT EXISTS agentes_empresa (
                    num_identificacion TEXT NOT NULL,
                    id_empresa         TEXT NOT NULL REFERENCES empresas_seguridad(id_empresa),
                    nombre             TEXT NOT NULL,
                    telefono           TEXT DEFAULT '',
                    edad               INTEGER DEFAULT 0,
                    sexo               TEXT DEFAULT '',
                    pais               TEXT DEFAULT '',
                    puesto             TEXT DEFAULT '',
                    jefe_inmediato     TEXT DEFAULT '',
                    codigo_agente      TEXT DEFAULT '',
                    activo             BOOLEAN DEFAULT TRUE,
                    fecha_registro     TEXT NOT NULL,
                    PRIMARY KEY (id_empresa, num_identificacion)
                );

                CREATE TABLE IF NOT EXISTS asignaciones_agentes_empresa (
                    id_alerta          TEXT NOT NULL,
                    id_empresa         TEXT NOT NULL,
                    num_identificacion TEXT NOT NULL,
                    slot               INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 4),
                    fecha_asignacion   TEXT NOT NULL,
                    PRIMARY KEY (id_alerta, slot)
                );
            """)
        else:
            # SQLite
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS empresas_seguridad (
                    id_empresa         TEXT PRIMARY KEY,
                    nombre_empresa     TEXT NOT NULL,
                    nombre_admin       TEXT NOT NULL,
                    telefono           TEXT DEFAULT '',
                    correo             TEXT DEFAULT '',
                    direccion          TEXT DEFAULT '',
                    clave_acceso       TEXT NOT NULL,
                    activo             INTEGER DEFAULT 1,
                    fecha_registro     TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS pilotos (
                    id_piloto          TEXT PRIMARY KEY,
                    id_empresa         TEXT NOT NULL,
                    nombre             TEXT NOT NULL,
                    telefono           TEXT NOT NULL,
                    num_identificacion TEXT NOT NULL,
                    num_licencia       TEXT DEFAULT '',
                    empresa_labora     TEXT DEFAULT '',
                    placas_vehiculo    TEXT DEFAULT '',
                    tipo_vehiculo      TEXT DEFAULT '',
                    color_vehiculo     TEXT DEFAULT '',
                    foto_vehiculo      TEXT DEFAULT '',
                    direccion          TEXT DEFAULT '',
                    sexo               TEXT DEFAULT '',
                    edad               INTEGER DEFAULT 0,
                    correo             TEXT DEFAULT '',
                    codigo_piloto      TEXT DEFAULT '',
                    clave_acceso       TEXT DEFAULT '',
                    activo             INTEGER DEFAULT 1,
                    fecha_registro     TEXT NOT NULL,
                    fam_nombre_1 TEXT DEFAULT '', fam_tel_1 TEXT DEFAULT '',
                    fam_nombre_2 TEXT DEFAULT '', fam_tel_2 TEXT DEFAULT '',
                    fam_nombre_3 TEXT DEFAULT '', fam_tel_3 TEXT DEFAULT '',
                    fam_nombre_4 TEXT DEFAULT '', fam_tel_4 TEXT DEFAULT '',
                    fam_nombre_5 TEXT DEFAULT '', fam_tel_5 TEXT DEFAULT '',
                    voz_alerta         TEXT DEFAULT '',
                    FOREIGN KEY (id_empresa) REFERENCES empresas_seguridad(id_empresa),
                    UNIQUE (id_empresa, num_identificacion)
                );

                CREATE TABLE IF NOT EXISTS alertas_empresa (
                    id_alerta            TEXT PRIMARY KEY,
                    id_empresa           TEXT NOT NULL,
                    id_piloto            TEXT,
                    numero_caso          TEXT UNIQUE NOT NULL,
                    nombre_piloto        TEXT DEFAULT 'Desconocido',
                    telefono_piloto      TEXT DEFAULT '',
                    num_identificacion   TEXT DEFAULT '',
                    placas_vehiculo      TEXT DEFAULT '',
                    tipo_vehiculo        TEXT DEFAULT '',
                    color_vehiculo       TEXT DEFAULT '',
                    direccion_piloto     TEXT DEFAULT '',
                    gps_latitud          REAL,
                    gps_longitud         REAL,
                    direccion_aproximada TEXT DEFAULT '',
                    estatus              TEXT DEFAULT 'ACTIVA',
                    notas_operador       TEXT,
                    fecha_creacion       TEXT NOT NULL,
                    fecha_atencion       TEXT,
                    FOREIGN KEY (id_empresa) REFERENCES empresas_seguridad(id_empresa)
                );

                CREATE TABLE IF NOT EXISTS agentes_empresa (
                    num_identificacion TEXT NOT NULL,
                    id_empresa         TEXT NOT NULL,
                    nombre             TEXT NOT NULL,
                    telefono           TEXT DEFAULT '',
                    edad               INTEGER DEFAULT 0,
                    sexo               TEXT DEFAULT '',
                    pais               TEXT DEFAULT '',
                    puesto             TEXT DEFAULT '',
                    jefe_inmediato     TEXT DEFAULT '',
                    codigo_agente      TEXT DEFAULT '',
                    activo             INTEGER DEFAULT 1,
                    fecha_registro     TEXT NOT NULL,
                    PRIMARY KEY (id_empresa, num_identificacion),
                    FOREIGN KEY (id_empresa) REFERENCES empresas_seguridad(id_empresa)
                );

                CREATE TABLE IF NOT EXISTS asignaciones_agentes_empresa (
                    id_alerta          TEXT NOT NULL,
                    id_empresa         TEXT NOT NULL,
                    num_identificacion TEXT NOT NULL,
                    slot               INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 4),
                    fecha_asignacion   TEXT NOT NULL,
                    PRIMARY KEY (id_alerta, slot)
                );
            """)
            
            # ALTER TABLE si ya existen
            try:
                _execute(conn, "ALTER TABLE instituciones ADD COLUMN pais TEXT DEFAULT '502'")
            except Exception:
                pass
            try:
                _execute(conn, "ALTER TABLE empresas_seguridad ADD COLUMN pais TEXT DEFAULT '502'")
            except Exception:
                pass


def _seed_demo(conn):
    inst_id = str(uuid.uuid4())
    clave   = generar_clave_6("Colonia Demo")
    now     = datetime.now().isoformat()
    _execute(conn, _ph("""
        INSERT INTO instituciones
        (id_institucion, nombre_institucion, nombre_admin, telefono, correo, direccion, pais, clave_acceso, activo, fecha_registro)
        VALUES (?,?,?,?,?,?,?,?,?,?)
    """), (inst_id, "Colonia Demo", "Admin Demo", "5550000000", "demo@sisdel.mx", "Calle Principal #1", "502", clave, True if USE_PG else 1, now))


def _seed_from_env():
    raw = os.environ.get("SEED_INSTITUCIONES", "")
    if not raw:
        return
    try:
        items = json.loads(raw)
    except Exception:
        return

    now = datetime.now().isoformat()
    with get_conn() as conn:
        for item in items:
            nombre = item.get("nombre", "")
            clave  = item.get("clave") or generar_clave_6(nombre)
            exists = _fetchone(conn, _ph(
                "SELECT 1 FROM instituciones WHERE nombre_institucion=?"
            ), (nombre,))
            if not exists:
                _execute(conn, _ph("""
                    INSERT INTO instituciones
                    (id_institucion,nombre_institucion,nombre_admin,telefono,correo,direccion,clave_acceso,activo,fecha_registro)
                    VALUES (?,?,?,?,?,?,?,?,?)
                """), (str(uuid.uuid4()), nombre,
                       item.get("admin","Admin"),
                       item.get("tel",""),
                       item.get("correo",""),
                       item.get("dir",""),
                       clave, True if USE_PG else 1, now))


class Database:
    """Interfaz de acceso a datos — PostgreSQL o SQLite."""

    # ── INSTITUCIONES ────────────────────────────────────────

    def crear_institucion(self, data: dict) -> dict:
        inst = {
            "id_institucion":    str(uuid.uuid4()),
            "nombre_institucion": data["nombre_institucion"],
            "nombre_admin":       data["nombre_admin"],
            "telefono":           data.get("telefono", ""),
            "correo":             data.get("correo", ""),
            "direccion":          data.get("direccion", ""),
            "pais":               data.get("pais", "502"),
            "clave_acceso":       generar_clave_6(data["nombre_institucion"]),
            "activo":             True,
            "fecha_registro":     datetime.now().isoformat(),
        }
        with get_conn() as conn:
            _execute(conn, _ph("""
                INSERT INTO instituciones
                (id_institucion, nombre_institucion, nombre_admin, telefono, correo, direccion, pais, clave_acceso, activo, fecha_registro)
                VALUES (?,?,?,?,?,?,?,?,?,?)
            """), (inst["id_institucion"], inst["nombre_institucion"], inst["nombre_admin"],
                   inst["telefono"], inst["correo"], inst["direccion"], inst["pais"], inst["clave_acceso"],
                   True if USE_PG else 1, inst["fecha_registro"]))
        return inst

    def listar_instituciones(self) -> List[dict]:
        with get_conn() as conn:
            rows = _fetchall(conn, "SELECT * FROM instituciones ORDER BY fecha_registro")
        return [r | {"activo": bool(r["activo"])} for r in rows]

    def obtener_institucion(self, id_inst: str) -> Optional[dict]:
        with get_conn() as conn:
            row = _fetchone(conn, _ph("SELECT * FROM instituciones WHERE id_institucion=?"), (id_inst,))
        if not row: return None
        return row | {"activo": bool(row["activo"])}

    def obtener_institucion_por_clave(self, clave: str) -> Optional[dict]:
        with get_conn() as conn:
            row = _fetchone(conn, _ph(
                "SELECT * FROM instituciones WHERE UPPER(clave_acceso)=UPPER(?) AND activo=?"
            ), (clave, True if USE_PG else 1))
        if not row: return None
        return row | {"activo": True}

    def toggle_institucion(self, id_inst: str) -> Optional[dict]:
        with get_conn() as conn:
            if USE_PG:
                _execute(conn, "UPDATE instituciones SET activo = NOT activo WHERE id_institucion=%s", (id_inst,))
            else:
                _execute(conn, "UPDATE instituciones SET activo = CASE WHEN activo=1 THEN 0 ELSE 1 END WHERE id_institucion=?", (id_inst,))
            row = _fetchone(conn, _ph("SELECT * FROM instituciones WHERE id_institucion=?"), (id_inst,))
        if not row: return None
        return row | {"activo": bool(row["activo"])}

    def regenerar_clave_institucion(self, id_inst: str) -> Optional[dict]:
        row = self.obtener_institucion(id_inst)
        if not row: return None
        nueva = generar_clave_6(row["nombre_institucion"])
        with get_conn() as conn:
            _execute(conn, _ph("UPDATE instituciones SET clave_acceso=? WHERE id_institucion=?"), (nueva, id_inst))
        row["clave_acceso"] = nueva
        return row

    def editar_institucion(self, id_inst: str, campos: dict) -> Optional[dict]:
        row = self.obtener_institucion(id_inst)
        if not row: return None
        allowed = {"nombre_institucion","nombre_admin","telefono","correo","direccion"}
        sets, vals = [], []
        for k, v in campos.items():
            if k in allowed and v is not None:
                sets.append(f"{k}={PH}")
                vals.append(v)
        if not sets: return row
        vals.append(id_inst)
        with get_conn() as conn:
            _execute(conn, f"UPDATE instituciones SET {', '.join(sets)} WHERE id_institucion={PH}", vals)
        return self.obtener_institucion(id_inst)

    def eliminar_institucion(self, id_inst: str) -> bool:
        with get_conn() as conn:
            cur = _execute(conn, _ph("DELETE FROM instituciones WHERE id_institucion=?"), (id_inst,))
        return cur.rowcount > 0

    # ── CLAVES VECINOS ───────────────────────────────────────

    def generar_clave_vecino(self, id_institucion: str, descripcion: str = "") -> dict:
        clave_data = {
            "clave":          generar_clave_6(),
            "id_institucion": id_institucion,
            "descripcion":    descripcion,
            "usada":          False,
            "id_vecino":      None,
            "fecha_creacion": datetime.now().isoformat(),
        }
        with get_conn() as conn:
            if USE_PG:
                cur = conn.cursor()
                cur.execute("""
                    INSERT INTO claves_vecinos (clave, id_institucion, descripcion, usada, id_vecino, fecha_creacion)
                    VALUES (%s,%s,%s,FALSE,NULL,%s) RETURNING id_clave
                """, (clave_data["clave"], clave_data["id_institucion"], clave_data["descripcion"], clave_data["fecha_creacion"]))
                clave_data["id_clave"] = cur.fetchone()[0]
                cur.close()
            else:
                cur = conn.execute("""
                    INSERT INTO claves_vecinos (clave, id_institucion, descripcion, usada, id_vecino, fecha_creacion)
                    VALUES (?,?,?,0,NULL,?)
                """, (clave_data["clave"], clave_data["id_institucion"], clave_data["descripcion"], clave_data["fecha_creacion"]))
                clave_data["id_clave"] = cur.lastrowid
        return clave_data

    def validar_clave_vecino(self, clave: str, id_institucion: str = None) -> Optional[dict]:
        sql = _ph("SELECT * FROM claves_vecinos WHERE UPPER(clave)=UPPER(?)")
        params = [clave]
        if id_institucion:
            sql += f" AND id_institucion={PH}"
            params.append(id_institucion)
        with get_conn() as conn:
            row = _fetchone(conn, sql, params)
        if not row: return None
        return row | {"usada": bool(row["usada"])}

    def listar_claves_vecinos(self, id_institucion: str) -> List[dict]:
        with get_conn() as conn:
            rows = _fetchall(conn, _ph("SELECT * FROM claves_vecinos WHERE id_institucion=? ORDER BY id_clave"), (id_institucion,))
        return [r | {"usada": bool(r["usada"])} for r in rows]

    def eliminar_clave_vecino(self, id_clave: int) -> bool:
        with get_conn() as conn:
            cur = _execute(conn, _ph("DELETE FROM claves_vecinos WHERE id_clave=?"), (id_clave,))
        return cur.rowcount > 0

    # ── VECINOS ──────────────────────────────────────────────

    def registrar_vecino(self, data: dict) -> dict:
        existente = self.buscar_vecino_por_identificacion(data["num_identificacion"], data["id_institucion"])
        FAM_COLS = ['fam_nombre_1','fam_tel_1','fam_nombre_2','fam_tel_2',
                    'fam_nombre_3','fam_tel_3','fam_nombre_4','fam_tel_4',
                    'fam_nombre_5','fam_tel_5']
        if existente:
            # Actualizar datos + familiares + voz
            campos_editar = {k: data[k] for k in
                ("nombre","telefono","direccion","sexo","edad","correo","voz_alerta") + tuple(FAM_COLS)
                if k in data}
            sets = [f"{k}={PH}" for k in campos_editar]
            vals = list(campos_editar.values()) + [existente["id_vecino"]]
            if sets:
                with get_conn() as conn:
                    _execute(conn, f"UPDATE vecinos SET {', '.join(sets)} WHERE id_vecino={PH}", vals)
            return self.buscar_vecino_por_identificacion(data["num_identificacion"], data["id_institucion"])

        vecino = {
            "id_vecino":          str(uuid.uuid4()),
            "id_institucion":     data["id_institucion"],
            "nombre":             data["nombre"],
            "telefono":           data["telefono"],
            "num_identificacion": data["num_identificacion"],
            "direccion":          data.get("direccion", ""),
            "sexo":               data.get("sexo", ""),
            "edad":               data.get("edad", 0),
            "correo":             data.get("correo", ""),
            "codigo_vecino":      generar_clave_6(data["nombre"]),
            "clave_acceso":       data.get("clave_acceso", ""),
            "activo":             True,
            "fecha_registro":     datetime.now().isoformat(),
            "voz_alerta":         data.get("voz_alerta", ""),
            # Familiares
            "fam_nombre_1": data.get("fam_nombre_1", ""),
            "fam_tel_1":    data.get("fam_tel_1", ""),
            "fam_nombre_2": data.get("fam_nombre_2", ""),
            "fam_tel_2":    data.get("fam_tel_2", ""),
            "fam_nombre_3": data.get("fam_nombre_3", ""),
            "fam_tel_3":    data.get("fam_tel_3", ""),
            "fam_nombre_4": data.get("fam_nombre_4", ""),
            "fam_tel_4":    data.get("fam_tel_4", ""),
            "fam_nombre_5": data.get("fam_nombre_5", ""),
            "fam_tel_5":    data.get("fam_tel_5", ""),
        }
        with get_conn() as conn:
            _execute(conn, _ph("""
                INSERT INTO vecinos
                (id_vecino,id_institucion,nombre,telefono,num_identificacion,direccion,sexo,edad,correo,codigo_vecino,clave_acceso,activo,fecha_registro,
                 fam_nombre_1,fam_tel_1,fam_nombre_2,fam_tel_2,fam_nombre_3,fam_tel_3,fam_nombre_4,fam_tel_4,fam_nombre_5,fam_tel_5,voz_alerta)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """), (vecino["id_vecino"], vecino["id_institucion"], vecino["nombre"], vecino["telefono"],
                   vecino["num_identificacion"], vecino["direccion"], vecino["sexo"], vecino["edad"],
                   vecino["correo"], vecino["codigo_vecino"], vecino["clave_acceso"],
                   True if USE_PG else 1, vecino["fecha_registro"],
                   vecino["fam_nombre_1"], vecino["fam_tel_1"],
                   vecino["fam_nombre_2"], vecino["fam_tel_2"],
                   vecino["fam_nombre_3"], vecino["fam_tel_3"],
                   vecino["fam_nombre_4"], vecino["fam_tel_4"],
                   vecino["fam_nombre_5"], vecino["fam_tel_5"],
                   vecino["voz_alerta"]))
            if data.get("clave_acceso"):
                _execute(conn, _ph(
                    "UPDATE claves_vecinos SET usada=?, id_vecino=? WHERE UPPER(clave)=UPPER(?)"
                ), (True if USE_PG else 1, vecino["id_vecino"], data["clave_acceso"]))
        return vecino

    def buscar_vecino_por_identificacion(self, num_id: str, id_institucion: str) -> Optional[dict]:
        with get_conn() as conn:
            row = _fetchone(conn, _ph(
                "SELECT * FROM vecinos WHERE id_institucion=? AND UPPER(num_identificacion)=UPPER(?)"
            ), (id_institucion, num_id))
        if not row: return None
        return row | {"activo": bool(row["activo"])}

    def obtener_vecino_por_clave(self, clave: str) -> Optional[dict]:
        with get_conn() as conn:
            row = _fetchone(conn, _ph("SELECT * FROM vecinos WHERE UPPER(clave_acceso)=UPPER(?)"), (clave,))
        if not row: return None
        return row | {"activo": bool(row["activo"])}

    @property
    def vecinos(self):
        with get_conn() as conn:
            rows = _fetchall(conn, "SELECT * FROM vecinos")
        return {r["id_vecino"]: r | {"activo": bool(r["activo"])} for r in rows}

    def listar_vecinos(self, id_institucion: str) -> List[dict]:
        with get_conn() as conn:
            rows = _fetchall(conn, _ph("SELECT * FROM vecinos WHERE id_institucion=? ORDER BY fecha_registro"), (id_institucion,))
        return [r | {"activo": bool(r["activo"])} for r in rows]

    def eliminar_vecino(self, id_vecino: str) -> bool:
        with get_conn() as conn:
            cur = _execute(conn, _ph("DELETE FROM vecinos WHERE id_vecino=?"), (id_vecino,))
        return cur.rowcount > 0

    def actualizar_vecino(self, id_vecino: str, data: dict) -> Optional[dict]:
        campos = ["nombre","telefono","direccion","sexo","edad","correo",
                  "fam_nombre_1","fam_tel_1","fam_nombre_2","fam_tel_2",
                  "fam_nombre_3","fam_tel_3","fam_nombre_4","fam_tel_4",
                  "fam_nombre_5","fam_tel_5", "voz_alerta"]
        sets   = [f"{c}={PH}" for c in campos if c in data]
        vals   = [data[c] for c in campos if c in data]
        if not sets: return None
        vals.append(id_vecino)
        with get_conn() as conn:
            _execute(conn, f"UPDATE vecinos SET {', '.join(sets)} WHERE id_vecino={PH}", vals)
            row = _fetchone(conn, _ph("SELECT * FROM vecinos WHERE id_vecino=?"), (id_vecino,))
        return row | {"activo": bool(row["activo"])} if row else None

    # ── CONTACTOS DE EMERGENCIA (guardados en tabla vecinos) ──

    def guardar_contactos_emergencia(self, id_vecino: str, contactos: list) -> list:
        """Actualiza los familiares directamente en la tabla vecinos."""
        data = {}
        for i in range(5):
            c = contactos[i] if i < len(contactos) else {}
            data[f"fam_nombre_{i+1}"] = c.get("nombre", "")
            data[f"fam_tel_{i+1}"]    = c.get("telefono", "")
        sets = [f"{k}={PH}" for k in data]
        vals = list(data.values()) + [id_vecino]
        with get_conn() as conn:
            _execute(conn, f"UPDATE vecinos SET {', '.join(sets)} WHERE id_vecino={PH}", vals)
        return self.obtener_contactos_emergencia(id_vecino)

    def obtener_contactos_emergencia(self, id_vecino: str) -> list:
        """Lee los familiares desde la tabla vecinos y los devuelve en formato lista."""
        with get_conn() as conn:
            row = _fetchone(conn, _ph("SELECT * FROM vecinos WHERE id_vecino=?"), (id_vecino,))
        if not row:
            return []
        resultado = []
        for i in range(1, 6):
            nombre = row.get(f"fam_nombre_{i}", "") or ""
            tel    = row.get(f"fam_tel_{i}", "") or ""
            if tel.strip():
                resultado.append({"nombre": nombre, "telefono": tel, "posicion": i})
        return resultado

    # ── EMERGENCIAS ──────────────────────────────────────────

    def crear_emergencia(self, data: dict) -> dict:
        # Generar número de caso secuencial
        with get_conn() as conn:
            # Obtener nombre de institución para el prefijo
            inst = _fetchone(conn, _ph("SELECT nombre_institucion FROM instituciones WHERE id_institucion=?"), (data["id_institucion"],))
            prefijo = ''.join(c for c in (inst["nombre_institucion"] if inst else "XXX").upper() if c.isalpha())[:3]
            if len(prefijo) < 3:
                prefijo = prefijo.ljust(3, 'X')
            # Contar emergencias existentes para esta institución
            cnt = _fetchone(conn, _ph("SELECT COUNT(*) as cnt FROM emergencias WHERE id_institucion=?"), (data["id_institucion"],))
            siguiente = (cnt["cnt"] if cnt else 0) + 1
            numero_caso = f"{prefijo}-{siguiente:03d}"

        e = {
            "id_emergencia":        str(uuid.uuid4()),
            "id_institucion":       data["id_institucion"],
            "id_vecino":            data.get("id_vecino"),
            "numero_caso":          numero_caso,
            "nombre_vecino":        data.get("nombre_vecino","Desconocido"),
            "telefono_vecino":      data.get("telefono_vecino",""),
            "num_identificacion":   data.get("num_identificacion",""),
            "direccion_vecino":     data.get("direccion_vecino",""),
            "gps_latitud":          data.get("gps_latitud"),
            "gps_longitud":         data.get("gps_longitud"),
            "direccion_aproximada": data.get("direccion_aproximada",""),
            "estatus":              "ACTIVA",
            "notas_operador":       None,
            "fecha_creacion":       datetime.now().isoformat(),
            "fecha_atencion":       None,
        }
        with get_conn() as conn:
            _execute(conn, _ph("""
                INSERT INTO emergencias
                (id_emergencia,id_institucion,id_vecino,numero_caso,nombre_vecino,telefono_vecino,num_identificacion,
                 direccion_vecino,gps_latitud,gps_longitud,direccion_aproximada,estatus,notas_operador,fecha_creacion,fecha_atencion)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """), (e["id_emergencia"], e["id_institucion"], e["id_vecino"], e["numero_caso"], e["nombre_vecino"],
                   e["telefono_vecino"], e["num_identificacion"], e["direccion_vecino"],
                   e["gps_latitud"], e["gps_longitud"], e["direccion_aproximada"],
                   e["estatus"], e["notas_operador"], e["fecha_creacion"], e["fecha_atencion"]))
        return e

    def listar_emergencias(self, id_institucion: str, estatus: str = None) -> List[dict]:
        sql = _ph("SELECT * FROM emergencias WHERE id_institucion=?")
        params = [id_institucion]
        if estatus:
            sql += f" AND estatus={PH}"
            params.append(estatus)
        sql += " ORDER BY fecha_creacion DESC"
        with get_conn() as conn:
            rows = _fetchall(conn, sql, params)
        return rows

    def actualizar_estatus_emergencia(self, id_emergencia: str, estatus: str, notas: str = None) -> Optional[dict]:
        fecha_atencion = datetime.now().isoformat() if estatus in ("ATENDIDA","FALSA_ALARMA","CANCELADA") else None
        with get_conn() as conn:
            _execute(conn, _ph("""
                UPDATE emergencias SET estatus=?, notas_operador=COALESCE(?,notas_operador), fecha_atencion=COALESCE(?,fecha_atencion)
                WHERE id_emergencia=?
            """), (estatus, notas, fecha_atencion, id_emergencia))
            row = _fetchone(conn, _ph("SELECT * FROM emergencias WHERE id_emergencia=?"), (id_emergencia,))
        return row

    def stats_institucion(self, id_institucion: str) -> dict:
        with get_conn() as conn:
            total   = _fetchone(conn, _ph("SELECT COUNT(*) as cnt FROM emergencias WHERE id_institucion=?"), (id_institucion,))["cnt"]
            activas = _fetchone(conn, _ph("SELECT COUNT(*) as cnt FROM emergencias WHERE id_institucion=? AND estatus='ACTIVA'"), (id_institucion,))["cnt"]
            camino  = _fetchone(conn, _ph("SELECT COUNT(*) as cnt FROM emergencias WHERE id_institucion=? AND estatus='EN_CAMINO'"), (id_institucion,))["cnt"]
            atend   = _fetchone(conn, _ph("SELECT COUNT(*) as cnt FROM emergencias WHERE id_institucion=? AND estatus='ATENDIDA'"), (id_institucion,))["cnt"]
            vecinos = _fetchone(conn, _ph("SELECT COUNT(*) as cnt FROM vecinos WHERE id_institucion=?"), (id_institucion,))["cnt"]
        return {"total": total, "activas": activas, "en_camino": camino, "atendidas": atend, "vecinos_registrados": vecinos}

    def limpiar_emergencias(self, id_institucion: str) -> int:
        """Elimina TODAS las emergencias de una institución. Retorna cuántas se borraron."""
        with get_conn() as conn:
            # Primero borrar asignaciones de agentes relacionadas
            _execute(conn, _ph("""
                DELETE FROM asignaciones_agentes WHERE id_emergencia IN
                (SELECT id_emergencia FROM emergencias WHERE id_institucion=?)
            """), (id_institucion,))
            cur = _execute(conn, _ph("DELETE FROM emergencias WHERE id_institucion=?"), (id_institucion,))
        return cur.rowcount


# Inicializar tablas y objeto global
init_db()
db = Database()


# ── AGENTES CRUD ─────────────────────────────────────────────

def registrar_agente(data: dict, nombre_institucion: str) -> dict:
    with get_conn() as conn:
        # Ver si ya existe
        existing = _fetchone(conn, _ph(
            "SELECT * FROM agentes WHERE id_institucion=? AND num_identificacion=?"
        ), (data["id_institucion"], data["num_identificacion"]))

        codigo = generar_codigo_agente(nombre_institucion, data["nombre"])
        ahora = datetime.utcnow().isoformat()

        if existing:
            # Actualizar
            _execute(conn, _ph("""
                UPDATE agentes SET nombre=?, telefono=?, edad=?, sexo=?, pais=?,
                puesto=?, jefe_inmediato=?, codigo_agente=?
                WHERE id_institucion=? AND num_identificacion=?
            """), (
                data["nombre"], data["telefono"], data.get("edad", 0),
                data.get("sexo", ""), data.get("pais", ""),
                data.get("puesto", ""), data.get("jefe_inmediato", ""), existing["codigo_agente"],
                data["id_institucion"], data["num_identificacion"]
            ))
        else:
            # Insertar nuevo
            _execute(conn, _ph("""
                INSERT INTO agentes (num_identificacion, id_institucion, nombre, telefono,
                    edad, sexo, pais, puesto, jefe_inmediato, codigo_agente, fecha_registro)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """), (
                data["num_identificacion"], data["id_institucion"],
                data["nombre"], data["telefono"],
                data.get("edad", 0), data.get("sexo", ""),
                data.get("pais", ""), data.get("puesto", ""),
                data.get("jefe_inmediato", ""), codigo, ahora
            ))

        row = _fetchone(conn, _ph(
            "SELECT * FROM agentes WHERE id_institucion=? AND num_identificacion=?"
        ), (data["id_institucion"], data["num_identificacion"]))
    return row


def listar_agentes(id_institucion: str) -> list:
    with get_conn() as conn:
        rows = _fetchall(conn, _ph(
            "SELECT * FROM agentes WHERE id_institucion=? ORDER BY nombre"
        ), (id_institucion,))
    return rows


def obtener_agente(id_institucion: str, num_identificacion: str) -> dict:
    with get_conn() as conn:
        row = _fetchone(conn, _ph(
            "SELECT * FROM agentes WHERE id_institucion=? AND num_identificacion=?"
        ), (id_institucion, num_identificacion))
    return row


# ── ASIGNACIONES AGENTES ─────────────────────────────────────

def asignar_agente_emergencia(id_emergencia: str, id_institucion: str, num_identificacion: str, slot: int) -> dict:
    """Asigna un agente a una emergencia en un slot (1-4)."""
    ahora = datetime.utcnow().isoformat()
    with get_conn() as conn:
        # Verificar si ya hay algo en ese slot, reemplazar
        existing = _fetchone(conn, _ph(
            "SELECT * FROM asignaciones_agentes WHERE id_emergencia=? AND slot=?"
        ), (id_emergencia, slot))
        if existing:
            _execute(conn, _ph(
                "UPDATE asignaciones_agentes SET num_identificacion=?, fecha_asignacion=? WHERE id_emergencia=? AND slot=?"
            ), (num_identificacion, ahora, id_emergencia, slot))
        else:
            _execute(conn, _ph("""
                INSERT INTO asignaciones_agentes (id_emergencia, id_institucion, num_identificacion, slot, fecha_asignacion)
                VALUES (?, ?, ?, ?, ?)
            """), (id_emergencia, id_institucion, num_identificacion, slot, ahora))
    return {"id_emergencia": id_emergencia, "slot": slot, "num_identificacion": num_identificacion}


def obtener_asignaciones_emergencia(id_emergencia: str) -> list:
    """Obtiene los agentes asignados a una emergencia con su info."""
    with get_conn() as conn:
        asignaciones = _fetchall(conn, _ph(
            "SELECT * FROM asignaciones_agentes WHERE id_emergencia=? ORDER BY slot"
        ), (id_emergencia,))
        resultado = []
        for a in asignaciones:
            agente = _fetchone(conn, _ph(
                "SELECT * FROM agentes WHERE id_institucion=? AND num_identificacion=?"
            ), (a["id_institucion"], a["num_identificacion"]))
            resultado.append({
                "slot": a["slot"],
                "num_identificacion": a["num_identificacion"],
                "fecha_asignacion": a["fecha_asignacion"],
                "nombre": agente["nombre"] if agente else "Desconocido",
                "telefono": agente["telefono"] if agente else "",
                "puesto": agente["puesto"] if agente else "",
                "codigo_agente": agente["codigo_agente"] if agente else "",
            })
    return resultado


def casos_por_agente(id_institucion: str, identificador: str) -> list:
    """Obtiene los casos asignados a un agente (por doc o código)."""
    with get_conn() as conn:
        # Buscar agente por documento o código
        agente = _fetchone(conn, _ph(
            "SELECT * FROM agentes WHERE id_institucion=? AND (num_identificacion=? OR codigo_agente=?)"
        ), (id_institucion, identificador, identificador.upper()))
        if not agente:
            return []

        asignaciones = _fetchall(conn, _ph(
            "SELECT * FROM asignaciones_agentes WHERE id_institucion=? AND num_identificacion=? ORDER BY fecha_asignacion DESC"
        ), (id_institucion, agente["num_identificacion"]))

        casos = []
        for a in asignaciones:
            emergencia = _fetchone(conn, _ph(
                "SELECT * FROM emergencias WHERE id_emergencia=?"
            ), (a["id_emergencia"],))
            if emergencia:
                casos.append({
                    "id_emergencia": emergencia["id_emergencia"],
                    "numero_caso": emergencia.get("numero_caso", ""),
                    "nombre_vecino": emergencia["nombre_vecino"],
                    "telefono_vecino": emergencia["telefono_vecino"],
                    "direccion_vecino": emergencia.get("direccion_vecino", ""),
                    "direccion_aproximada": emergencia.get("direccion_aproximada", ""),
                    "gps_latitud": emergencia.get("gps_latitud"),
                    "gps_longitud": emergencia.get("gps_longitud"),
                    "estatus": emergencia["estatus"],
                    "fecha_creacion": emergencia["fecha_creacion"],
                    "slot": a["slot"],
                    "fecha_asignacion": a["fecha_asignacion"],
                })
    return {"agente": dict(agente), "casos": casos}


def login_agente_global(identificador: str):
    """Busca un agente por código o documento en TODAS las instituciones."""
    with get_conn() as conn:
        agente = _fetchone(conn, _ph(
            "SELECT * FROM agentes WHERE num_identificacion=? OR codigo_agente=?"
        ), (identificador, identificador.upper()))
        if not agente:
            return None
    # Usar la función existente con la institución encontrada
    return casos_por_agente(agente["id_institucion"], identificador)


# ══════════════════════════════════════════════════════════════
# ██  MÓDULO EMPRESA DE SEGURIDAD — CRUD  ██
# ══════════════════════════════════════════════════════════════

# ── EMPRESAS ─────────────────────────────────────────────────

def crear_empresa(data: dict) -> dict:
    eid = str(uuid.uuid4())
    clave = generar_clave_6(data["nombre_empresa"])
    now = datetime.now().isoformat()
    emp = {
        "id_empresa": eid,
        "nombre_empresa": data["nombre_empresa"],
        "nombre_admin": data["nombre_admin"],
        "telefono": data.get("telefono", ""),
        "correo": data.get("correo", ""),
        "direccion": data.get("direccion", ""),
        "pais": data.get("pais", "502"),
        "clave_acceso": clave,
        "activo": True if USE_PG else 1,
        "fecha_registro": now,
    }
    with get_conn() as conn:
        _execute(conn, _ph("""
            INSERT INTO empresas_seguridad
            (id_empresa,nombre_empresa,nombre_admin,telefono,correo,direccion,pais,clave_acceso,activo,fecha_registro)
            VALUES (?,?,?,?,?,?,?,?,?,?)
        """), (emp["id_empresa"], emp["nombre_empresa"], emp["nombre_admin"],
               emp["telefono"], emp["correo"], emp["direccion"], emp["pais"],
               emp["clave_acceso"], emp["activo"], emp["fecha_registro"]))
    return emp


def listar_empresas() -> list:
    with get_conn() as conn:
        return _fetchall(conn, "SELECT * FROM empresas_seguridad ORDER BY fecha_registro DESC")


def obtener_empresa(id_empresa: str) -> dict:
    with get_conn() as conn:
        return _fetchone(conn, _ph("SELECT * FROM empresas_seguridad WHERE id_empresa=?"), (id_empresa,))


def login_empresa(clave: str) -> dict:
    with get_conn() as conn:
        return _fetchone(conn, _ph(
            "SELECT * FROM empresas_seguridad WHERE clave_acceso=? AND activo=?"
        ), (clave.upper(), True if USE_PG else 1))


def login_piloto_global(clave: str) -> dict:
    """Search all pilotos across all empresas by codigo_piloto or num_identificacion"""
    with get_conn() as conn:
        row = _fetchone(conn, _ph(
            "SELECT * FROM pilotos WHERE UPPER(codigo_piloto)=UPPER(?)"
        ), (clave,))
        if not row:
            row = _fetchone(conn, _ph(
                "SELECT * FROM pilotos WHERE UPPER(num_identificacion)=UPPER(?)"
            ), (clave,))
        return row


def toggle_empresa(id_empresa: str) -> dict:
    with get_conn() as conn:
        row = _fetchone(conn, _ph("SELECT activo FROM empresas_seguridad WHERE id_empresa=?"), (id_empresa,))
        if not row:
            return None
        new_val = not row["activo"] if USE_PG else (0 if row["activo"] else 1)
        _execute(conn, _ph("UPDATE empresas_seguridad SET activo=? WHERE id_empresa=?"), (new_val, id_empresa))
        return _fetchone(conn, _ph("SELECT * FROM empresas_seguridad WHERE id_empresa=?"), (id_empresa,))


def editar_empresa(id_empresa: str, data: dict) -> dict:
    with get_conn() as conn:
        _execute(conn, _ph("""
            UPDATE empresas_seguridad SET nombre_empresa=?, nombre_admin=?, telefono=?, correo=?, direccion=?
            WHERE id_empresa=?
        """), (data["nombre_empresa"], data["nombre_admin"], data.get("telefono",""),
               data.get("correo",""), data.get("direccion",""), id_empresa))
        return _fetchone(conn, _ph("SELECT * FROM empresas_seguridad WHERE id_empresa=?"), (id_empresa,))


def regenerar_clave_empresa(id_empresa: str) -> dict:
    with get_conn() as conn:
        row = _fetchone(conn, _ph("SELECT nombre_empresa FROM empresas_seguridad WHERE id_empresa=?"), (id_empresa,))
        if not row:
            return None
        nueva = generar_clave_6(row["nombre_empresa"])
        _execute(conn, _ph("UPDATE empresas_seguridad SET clave_acceso=? WHERE id_empresa=?"), (nueva, id_empresa))
        return _fetchone(conn, _ph("SELECT * FROM empresas_seguridad WHERE id_empresa=?"), (id_empresa,))


def eliminar_empresa(id_empresa: str):
    with get_conn() as conn:
        _execute(conn, _ph("DELETE FROM asignaciones_agentes_empresa WHERE id_empresa=?"), (id_empresa,))
        _execute(conn, _ph("DELETE FROM agentes_empresa WHERE id_empresa=?"), (id_empresa,))
        _execute(conn, _ph("DELETE FROM alertas_empresa WHERE id_empresa=?"), (id_empresa,))
        _execute(conn, _ph("DELETE FROM pilotos WHERE id_empresa=?"), (id_empresa,))
        _execute(conn, _ph("DELETE FROM empresas_seguridad WHERE id_empresa=?"), (id_empresa,))


# ── PILOTOS ──────────────────────────────────────────────────

def registrar_piloto(data: dict) -> dict:
    pid = str(uuid.uuid4())
    now = datetime.now().isoformat()
    # Código 6 chars: 2 dígitos + primera letra empresa + última letra empresa + 2 dígitos
    emp = obtener_empresa(data["id_empresa"])
    letras_emp = ''.join(c for c in (emp["nombre_empresa"] if emp else "XX").upper() if c.isalpha())
    primera = letras_emp[0] if letras_emp else 'X'
    ultima = letras_emp[-1] if letras_emp else 'X'
    import random
    codigo = f"{random.randint(10,99)}{primera}{ultima}{random.randint(10,99)}"

    with get_conn() as conn:
        # Check existing
        existing = _fetchone(conn, _ph(
            "SELECT * FROM pilotos WHERE id_empresa=? AND num_identificacion=?"
        ), (data["id_empresa"], data["num_identificacion"]))

        if existing:
            _execute(conn, _ph("""
                UPDATE pilotos SET nombre=?,telefono=?,num_licencia=?,empresa_labora=?,
                placas_vehiculo=?,tipo_vehiculo=?,color_vehiculo=?,
                foto_vehiculo=COALESCE(?,foto_vehiculo),direccion=?,sexo=?,edad=?,correo=?,
                fam_nombre_1=?,fam_tel_1=?,fam_nombre_2=?,fam_tel_2=?,
                fam_nombre_3=?,fam_tel_3=?,fam_nombre_4=?,fam_tel_4=?,
                fam_nombre_5=?,fam_tel_5=?
                WHERE id_piloto=?
            """), (
                data["nombre"], data["telefono"],
                data.get("num_licencia",""), data.get("empresa_labora",""),
                data.get("placas_vehiculo",""), data.get("tipo_vehiculo",""),
                data.get("color_vehiculo",""),
                data.get("foto_vehiculo") or None,
                data.get("direccion",""), data.get("sexo",""),
                data.get("edad",0), data.get("correo",""),
                data.get("fam_nombre_1",""), data.get("fam_tel_1",""),
                data.get("fam_nombre_2",""), data.get("fam_tel_2",""),
                data.get("fam_nombre_3",""), data.get("fam_tel_3",""),
                data.get("fam_nombre_4",""), data.get("fam_tel_4",""),
                data.get("fam_nombre_5",""), data.get("fam_tel_5",""),
                existing["id_piloto"],
            ))
            pid = existing["id_piloto"]
        else:
            cols = ("id_piloto,id_empresa,nombre,telefono,num_identificacion,num_licencia,"
                    "empresa_labora,placas_vehiculo,tipo_vehiculo,color_vehiculo,foto_vehiculo,"
                    "direccion,sexo,edad,correo,codigo_piloto,fecha_registro,"
                    "fam_nombre_1,fam_tel_1,fam_nombre_2,fam_tel_2,"
                    "fam_nombre_3,fam_tel_3,fam_nombre_4,fam_tel_4,"
                    "fam_nombre_5,fam_tel_5")
            vals = ",".join(["?"] * 27)
            _execute(conn, _ph(f"INSERT INTO pilotos ({cols}) VALUES ({vals})"), (
                pid, data["id_empresa"], data["nombre"], data["telefono"],
                data["num_identificacion"], data.get("num_licencia",""),
                data.get("empresa_labora",""), data.get("placas_vehiculo",""),
                data.get("tipo_vehiculo",""), data.get("color_vehiculo",""),
                data.get("foto_vehiculo",""), data.get("direccion",""),
                data.get("sexo",""), data.get("edad",0), data.get("correo",""),
                codigo, now,
                data.get("fam_nombre_1",""), data.get("fam_tel_1",""),
                data.get("fam_nombre_2",""), data.get("fam_tel_2",""),
                data.get("fam_nombre_3",""), data.get("fam_tel_3",""),
                data.get("fam_nombre_4",""), data.get("fam_tel_4",""),
                data.get("fam_nombre_5",""), data.get("fam_tel_5",""),
            ))

        row = _fetchone(conn, _ph("SELECT * FROM pilotos WHERE id_piloto=?"), (pid,))
    return row


def listar_pilotos(id_empresa: str) -> list:
    with get_conn() as conn:
        return _fetchall(conn, _ph("SELECT * FROM pilotos WHERE id_empresa=? ORDER BY nombre"), (id_empresa,))


def eliminar_piloto(id_piloto: str) -> bool:
    with get_conn() as conn:
        _execute(conn, _ph("DELETE FROM pilotos WHERE id_piloto=?"), (id_piloto,))
    return True


def obtener_piloto(id_piloto: str) -> dict:
    with get_conn() as conn:
        return _fetchone(conn, _ph("SELECT * FROM pilotos WHERE id_piloto=?"), (id_piloto,))


def actualizar_piloto(id_piloto: str, data: dict) -> dict:
    with get_conn() as conn:
        sets = []
        vals = []
        for k in ("nombre","telefono","num_licencia","empresa_labora","placas_vehiculo",
                   "tipo_vehiculo","color_vehiculo","foto_vehiculo","direccion","sexo","edad",
                   "correo","voz_alerta",
                   "fam_nombre_1","fam_tel_1","fam_nombre_2","fam_tel_2",
                   "fam_nombre_3","fam_tel_3","fam_nombre_4","fam_tel_4",
                   "fam_nombre_5","fam_tel_5"):
            if k in data:
                sets.append(f"{k}={PH}")
                vals.append(data[k])
        if sets:
            vals.append(id_piloto)
            _execute(conn, _ph(f"UPDATE pilotos SET {','.join(sets)} WHERE id_piloto=?"), vals)
        return _fetchone(conn, _ph("SELECT * FROM pilotos WHERE id_piloto=?"), (id_piloto,))


def obtener_contactos_piloto(id_piloto: str) -> list:
    with get_conn() as conn:
        row = _fetchone(conn, _ph("SELECT * FROM pilotos WHERE id_piloto=?"), (id_piloto,))
        if not row:
            return []
    resultado = []
    for i in range(1, 6):
        nombre = row.get(f"fam_nombre_{i}", "") or ""
        tel = row.get(f"fam_tel_{i}", "") or ""
        if tel.strip():
            resultado.append({"nombre": nombre, "telefono": tel, "posicion": i})
    return resultado


def login_piloto(id_empresa: str, identificador: str) -> dict:
    with get_conn() as conn:
        return _fetchone(conn, _ph(
            "SELECT * FROM pilotos WHERE id_empresa=? AND (num_identificacion=? OR codigo_piloto=?)"
        ), (id_empresa, identificador, identificador.upper()))


# ── ALERTAS EMPRESA ──────────────────────────────────────────

def crear_alerta_empresa(data: dict) -> dict:
    with get_conn() as conn:
        emp = _fetchone(conn, _ph("SELECT nombre_empresa FROM empresas_seguridad WHERE id_empresa=?"), (data["id_empresa"],))
        prefijo = ''.join(c for c in (emp["nombre_empresa"] if emp else "XXX").upper() if c.isalpha())[:3]
        if len(prefijo) < 3:
            prefijo = prefijo.ljust(3, 'X')
        cnt = _fetchone(conn, _ph("SELECT COUNT(*) as cnt FROM alertas_empresa WHERE id_empresa=?"), (data["id_empresa"],))
        siguiente = (cnt["cnt"] if cnt else 0) + 1
        numero_caso = f"{prefijo}-A{siguiente:03d}"

    a = {
        "id_alerta": str(uuid.uuid4()),
        "id_empresa": data["id_empresa"],
        "id_piloto": data.get("id_piloto"),
        "numero_caso": numero_caso,
        "nombre_piloto": data.get("nombre_piloto", "Desconocido"),
        "telefono_piloto": data.get("telefono_piloto", ""),
        "num_identificacion": data.get("num_identificacion", ""),
        "placas_vehiculo": data.get("placas_vehiculo", ""),
        "tipo_vehiculo": data.get("tipo_vehiculo", ""),
        "color_vehiculo": data.get("color_vehiculo", ""),
        "direccion_piloto": data.get("direccion_piloto", ""),
        "gps_latitud": data.get("gps_latitud"),
        "gps_longitud": data.get("gps_longitud"),
        "direccion_aproximada": data.get("direccion_aproximada", ""),
        "estatus": "ACTIVA",
        "notas_operador": None,
        "fecha_creacion": datetime.now().isoformat(),
        "fecha_atencion": None,
    }
    with get_conn() as conn:
        _execute(conn, _ph("""
            INSERT INTO alertas_empresa
            (id_alerta,id_empresa,id_piloto,numero_caso,nombre_piloto,telefono_piloto,
             num_identificacion,placas_vehiculo,tipo_vehiculo,color_vehiculo,
             direccion_piloto,gps_latitud,gps_longitud,direccion_aproximada,
             estatus,notas_operador,fecha_creacion,fecha_atencion)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """), tuple(a.values()))
    return a


def listar_alertas_empresa(id_empresa: str) -> list:
    with get_conn() as conn:
        return _fetchall(conn, _ph(
            "SELECT * FROM alertas_empresa WHERE id_empresa=? ORDER BY fecha_creacion DESC"
        ), (id_empresa,))


def actualizar_estatus_alerta_empresa(id_alerta: str, estatus: str, notas: str = None) -> dict:
    fecha_atencion = datetime.now().isoformat() if estatus in ("ATENDIDA","FALSA_ALARMA","CANCELADA") else None
    with get_conn() as conn:
        _execute(conn, _ph("""
            UPDATE alertas_empresa SET estatus=?, notas_operador=COALESCE(?,notas_operador),
            fecha_atencion=COALESCE(?,fecha_atencion) WHERE id_alerta=?
        """), (estatus, notas, fecha_atencion, id_alerta))
        return _fetchone(conn, _ph("SELECT * FROM alertas_empresa WHERE id_alerta=?"), (id_alerta,))


# ── AGENTES EMPRESA ──────────────────────────────────────────

def registrar_agente_empresa(data: dict) -> dict:
    emp = obtener_empresa(data["id_empresa"])
    nombre_emp = emp["nombre_empresa"] if emp else "XX"
    codigo = generar_codigo_agente(nombre_emp, data["nombre"])
    ahora = datetime.utcnow().isoformat()

    with get_conn() as conn:
        existing = _fetchone(conn, _ph(
            "SELECT * FROM agentes_empresa WHERE id_empresa=? AND num_identificacion=?"
        ), (data["id_empresa"], data["num_identificacion"]))

        if existing:
            _execute(conn, _ph("""
                UPDATE agentes_empresa SET nombre=?, telefono=?, edad=?, sexo=?, pais=?,
                puesto=?, jefe_inmediato=?, codigo_agente=?
                WHERE id_empresa=? AND num_identificacion=?
            """), (
                data["nombre"], data["telefono"], data.get("edad",0),
                data.get("sexo",""), data.get("pais",""),
                data.get("puesto",""), data.get("jefe_inmediato",""), existing["codigo_agente"],
                data["id_empresa"], data["num_identificacion"]
            ))
        else:
            _execute(conn, _ph("""
                INSERT INTO agentes_empresa (num_identificacion,id_empresa,nombre,telefono,
                    edad,sexo,pais,puesto,jefe_inmediato,codigo_agente,fecha_registro)
                VALUES (?,?,?,?,?,?,?,?,?,?,?)
            """), (
                data["num_identificacion"], data["id_empresa"],
                data["nombre"], data["telefono"],
                data.get("edad",0), data.get("sexo",""),
                data.get("pais",""), data.get("puesto",""),
                data.get("jefe_inmediato",""), codigo, ahora
            ))

        row = _fetchone(conn, _ph(
            "SELECT * FROM agentes_empresa WHERE id_empresa=? AND num_identificacion=?"
        ), (data["id_empresa"], data["num_identificacion"]))
    return row


def listar_agentes_empresa(id_empresa: str) -> list:
    with get_conn() as conn:
        return _fetchall(conn, _ph("SELECT * FROM agentes_empresa WHERE id_empresa=? ORDER BY nombre"), (id_empresa,))


def login_agente_empresa_global(identificador: str):
    """Busca un agente de empresa por código o documento."""
    with get_conn() as conn:
        agente = _fetchone(conn, _ph(
            "SELECT * FROM agentes_empresa WHERE num_identificacion=? OR codigo_agente=?"
        ), (identificador, identificador.upper()))
        if not agente:
            return None

        asignaciones = _fetchall(conn, _ph(
            "SELECT * FROM asignaciones_agentes_empresa WHERE id_empresa=? AND num_identificacion=? ORDER BY fecha_asignacion DESC"
        ), (agente["id_empresa"], agente["num_identificacion"]))

        casos = []
        for a in asignaciones:
            alerta = _fetchone(conn, _ph("SELECT * FROM alertas_empresa WHERE id_alerta=?"), (a["id_alerta"],))
            if alerta:
                casos.append({**dict(alerta), "slot": a["slot"], "fecha_asignacion": a["fecha_asignacion"]})
    return {"agente": dict(agente), "casos": casos}


def asignar_agente_alerta_empresa(id_alerta: str, id_empresa: str, num_identificacion: str, slot: int) -> dict:
    ahora = datetime.utcnow().isoformat()
    with get_conn() as conn:
        existing = _fetchone(conn, _ph(
            "SELECT * FROM asignaciones_agentes_empresa WHERE id_alerta=? AND slot=?"
        ), (id_alerta, slot))
        if existing:
            _execute(conn, _ph(
                "UPDATE asignaciones_agentes_empresa SET num_identificacion=?, fecha_asignacion=? WHERE id_alerta=? AND slot=?"
            ), (num_identificacion, ahora, id_alerta, slot))
        else:
            _execute(conn, _ph("""
                INSERT INTO asignaciones_agentes_empresa (id_alerta,id_empresa,num_identificacion,slot,fecha_asignacion)
                VALUES (?,?,?,?,?)
            """), (id_alerta, id_empresa, num_identificacion, slot, ahora))
    return {"id_alerta": id_alerta, "slot": slot, "num_identificacion": num_identificacion}


def obtener_asignaciones_alerta_empresa(id_alerta: str) -> list:
    with get_conn() as conn:
        asignaciones = _fetchall(conn, _ph(
            "SELECT * FROM asignaciones_agentes_empresa WHERE id_alerta=? ORDER BY slot"
        ), (id_alerta,))
        resultado = []
        for a in asignaciones:
            agente = _fetchone(conn, _ph(
                "SELECT * FROM agentes_empresa WHERE id_empresa=? AND num_identificacion=?"
            ), (a["id_empresa"], a["num_identificacion"]))
            resultado.append({
                "slot": a["slot"],
                "num_identificacion": a["num_identificacion"],
                "fecha_asignacion": a["fecha_asignacion"],
                "nombre": agente["nombre"] if agente else "Desconocido",
                "telefono": agente["telefono"] if agente else "",
                "puesto": agente["puesto"] if agente else "",
                "codigo_agente": agente["codigo_agente"] if agente else "",
            })
    return resultado
