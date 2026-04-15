"""Botón de Pánico SISDEL — Modelos Pydantic"""

from pydantic import BaseModel, Field
from typing import Optional


# ── INSTITUCIONES ────────────────────────────────────────────

class InstitucionCreate(BaseModel):
    nombre_institucion: str = Field(..., min_length=2, max_length=150)
    nombre_admin:       str = Field(..., min_length=2, max_length=150)
    telefono:           str = Field(default="", max_length=20)
    correo:             str = Field(default="", max_length=150)
    direccion:          str = Field(default="", max_length=250)
    pais:               str = Field(default="502", max_length=10)

class InstitucionResponse(BaseModel):
    id_institucion:    str
    nombre_institucion: str
    nombre_admin:      str
    telefono:          str
    correo:            str
    direccion:         str
    pais:              str = "502"
    clave_acceso:      str
    activo:            bool
    fecha_registro:    str
    class Config: from_attributes = True

class InstitucionUpdate(BaseModel):
    nombre_institucion: Optional[str] = Field(default=None, min_length=2, max_length=150)
    nombre_admin:       Optional[str] = Field(default=None, min_length=2, max_length=150)
    telefono:           Optional[str] = Field(default=None, max_length=20)
    correo:             Optional[str] = Field(default=None, max_length=150)
    direccion:          Optional[str] = Field(default=None, max_length=250)
    pais:               Optional[str] = Field(default=None, max_length=10)

class LoginInstRequest(BaseModel):
    clave: str = Field(..., min_length=1, max_length=20)

class LoginInstResponse(BaseModel):
    success:       bool
    message:       str
    tipo:          Optional[str] = None  # "programador" | "institucion" | "vecino"
    institucion:   Optional[InstitucionResponse] = None
    id_institucion: Optional[str] = None   # para vecinos
    num_identificacion: Optional[str] = None  # para vecinos


# ── CLAVES VECINOS ───────────────────────────────────────────

class ClaveVecinoCreate(BaseModel):
    id_institucion: str
    descripcion:    str = ""

class ClaveVecinoResponse(BaseModel):
    id_clave:       int
    clave:          str
    id_institucion: str
    descripcion:    str
    usada:          bool
    id_vecino:      Optional[str]
    fecha_creacion: str
    class Config: from_attributes = True

class ValidarClaveVecinoRequest(BaseModel):
    clave:          str = Field(..., min_length=6, max_length=6)
    id_institucion: Optional[str] = None

class ValidarClaveVecinoResponse(BaseModel):
    valida:  bool
    mensaje: str
    vecino:  Optional[dict] = None


# ── VECINOS ──────────────────────────────────────────────────

class VecinoCreate(BaseModel):
    id_institucion:    str
    nombre:            str = Field(..., min_length=1, max_length=150)
    telefono:          str = Field(..., min_length=1, max_length=20)
    num_identificacion:str = Field(..., min_length=1, max_length=30)
    direccion:         str = ""
    sexo:              str = Field(default="", max_length=1)   # M o F
    edad:              int = Field(default=0, ge=0, le=150)
    correo:            str = Field(default="", max_length=150)
    clave_acceso:      str = Field(default="", max_length=6)   # opcional (link directo)
    # Familiares de emergencia (directamente en el vecino)
    fam_nombre_1:      str = ""
    fam_tel_1:         str = ""
    fam_nombre_2:      str = ""
    fam_tel_2:         str = ""
    fam_nombre_3:      str = ""
    fam_tel_3:         str = ""
    fam_nombre_4:      str = ""
    fam_tel_4:         str = ""
    fam_nombre_5:      str = ""
    fam_tel_5:         str = ""
    voz_alerta:        Optional[str] = ""

class VecinoResponse(BaseModel):
    id_vecino:         str
    id_institucion:    str
    nombre:            str
    telefono:          str
    num_identificacion:str
    direccion:         str
    sexo:              str = ""
    edad:              int = 0
    correo:            str = ""
    codigo_vecino:     str = ""
    activo:            bool
    fecha_registro:    str
    # Familiares de emergencia
    fam_nombre_1:      str = ""
    fam_tel_1:         str = ""
    fam_nombre_2:      str = ""
    fam_tel_2:         str = ""
    fam_nombre_3:      str = ""
    fam_tel_3:         str = ""
    fam_nombre_4:      str = ""
    fam_tel_4:         str = ""
    fam_nombre_5:      str = ""
    fam_tel_5:         str = ""
    voz_alerta:        Optional[str] = ""
    class Config: from_attributes = True


# ── EMERGENCIAS ──────────────────────────────────────────────

class EmergenciaCreate(BaseModel):
    id_institucion:    str
    id_vecino:         Optional[str] = None
    nombre_vecino:     str
    telefono_vecino:   str
    num_identificacion:str
    direccion_vecino:  str = ""
    gps_latitud:       Optional[float] = None
    gps_longitud:      Optional[float] = None
    direccion_aproximada: str = ""

class EmergenciaResponse(BaseModel):
    id_emergencia:     str
    id_institucion:    str
    id_vecino:         Optional[str]
    numero_caso:       str = ""
    nombre_vecino:     str
    telefono_vecino:   str
    num_identificacion:str
    direccion_vecino:  str
    gps_latitud:       Optional[float]
    gps_longitud:      Optional[float]
    direccion_aproximada: str
    estatus:           str
    notas_operador:    Optional[str]
    fecha_creacion:    str
    fecha_atencion:    Optional[str]
    class Config: from_attributes = True

class EstatusUpdate(BaseModel):
    estatus: str
    notas:   Optional[str] = None

class StatsResponse(BaseModel):
    total: int
    activas: int
    en_camino: int
    atendidas: int
    vecinos_registrados: int


# ── AGENTES DE SEGURIDAD ─────────────────────────────────────

class AgenteCreate(BaseModel):
    id_institucion:     str
    nombre:             str = Field(..., min_length=1, max_length=150)
    telefono:           str = Field(..., min_length=1, max_length=20)
    num_identificacion: str = Field(..., min_length=1, max_length=30)
    edad:               int = Field(default=0, ge=0, le=150)
    sexo:               str = Field(default="", max_length=1)
    pais:               str = Field(default="", max_length=60)
    puesto:             str = Field(default="", max_length=100)
    jefe_inmediato:     str = Field(default="", max_length=150)

class AgenteResponse(BaseModel):
    id_institucion:     str
    nombre:             str
    telefono:           str
    num_identificacion: str
    edad:               int = 0
    sexo:               str = ""
    pais:               str = ""
    puesto:             str = ""
    jefe_inmediato:     str = ""
    codigo_agente:      str = ""
    activo:             bool = True
    fecha_registro:     str = ""
    class Config: from_attributes = True


# ── EMPRESA DE SEGURIDAD ─────────────────────────────────────

class EmpresaCreate(BaseModel):
    nombre_empresa: str = Field(..., min_length=2, max_length=150)
    nombre_admin:   str = Field(..., min_length=2, max_length=150)
    telefono:       str = Field(default="", max_length=20)
    correo:         str = Field(default="", max_length=150)
    direccion:      str = Field(default="", max_length=250)
    pais:           str = Field(default="502", max_length=10)

class EmpresaResponse(BaseModel):
    id_empresa:     str
    nombre_empresa: str
    nombre_admin:   str
    telefono:       str
    correo:         str
    direccion:      str
    pais:           str
    clave_acceso:   str
    activo:         bool
    fecha_registro: str
    class Config: from_attributes = True

class EmpresaUpdate(BaseModel):
    nombre_empresa: Optional[str] = None
    nombre_admin:   Optional[str] = None
    telefono:       Optional[str] = None
    correo:         Optional[str] = None
    direccion:      Optional[str] = None
    pais:           Optional[str] = None


# ── PILOTOS ──────────────────────────────────────────────────

class PilotoCreate(BaseModel):
    id_empresa:         str
    nombre:             str = Field(..., min_length=1, max_length=150)
    telefono:           str = Field(..., min_length=1, max_length=20)
    num_identificacion: str = Field(..., min_length=1, max_length=30)
    num_licencia:       str = ""
    empresa_labora:     str = ""
    placas_vehiculo:    str = ""
    tipo_vehiculo:      str = ""
    color_vehiculo:     str = ""
    foto_vehiculo:      Optional[str] = ""
    direccion:          str = ""
    sexo:               str = ""
    edad:               int = 0
    correo:             str = ""
    fam_nombre_1: str = ""; fam_tel_1: str = ""
    fam_nombre_2: str = ""; fam_tel_2: str = ""
    fam_nombre_3: str = ""; fam_tel_3: str = ""
    fam_nombre_4: str = ""; fam_tel_4: str = ""
    fam_nombre_5: str = ""; fam_tel_5: str = ""
    voz_alerta:   Optional[str] = ""


# ── ALERTAS EMPRESA ──────────────────────────────────────────

class AlertaEmpresaCreate(BaseModel):
    id_empresa:         str
    id_piloto:          Optional[str] = None
    nombre_piloto:      str = "Desconocido"
    telefono_piloto:    str = ""
    num_identificacion: str = ""
    placas_vehiculo:    str = ""
    tipo_vehiculo:      str = ""
    color_vehiculo:     str = ""
    direccion_piloto:   str = ""
    gps_latitud:        Optional[float] = None
    gps_longitud:       Optional[float] = None
    direccion_aproximada: str = ""


# ── AGENTES EMPRESA ─────────────────────────────────────────

class AgenteEmpresaCreate(BaseModel):
    id_empresa:         str
    nombre:             str = Field(..., min_length=1, max_length=150)
    telefono:           str = Field(..., min_length=1, max_length=20)
    num_identificacion: str = Field(..., min_length=1, max_length=30)
    edad:               int = Field(default=0, ge=0, le=150)
    sexo:               str = Field(default="", max_length=1)
    pais:               str = Field(default="", max_length=60)
    puesto:             str = Field(default="", max_length=100)
    jefe_inmediato:     str = Field(default="", max_length=150)
