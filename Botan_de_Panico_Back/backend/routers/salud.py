"""
Router: Salud — Perfil médico y resumen ejecutivo para paramédicos.
"""

from fastapi import APIRouter, HTTPException
from models import PerfilMedicoCreate, PerfilMedicoResponse, PerfilMedicoBase, ResumenMedico
from database import db

router = APIRouter(prefix="/api/salud", tags=["Perfil Médico"])


@router.get("/{id_usuario}", response_model=PerfilMedicoResponse)
async def obtener_perfil_medico(id_usuario: str):
    """Obtener perfil médico de un usuario."""
    perfil = db.obtener_perfil_medico(id_usuario)
    if not perfil:
        raise HTTPException(status_code=404, detail="Perfil médico no encontrado")
    return perfil


@router.post("/", response_model=PerfilMedicoResponse, status_code=201)
async def crear_perfil_medico(data: PerfilMedicoCreate):
    """Crear perfil médico para un usuario."""
    if not db.obtener_usuario(data.id_usuario):
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    if db.obtener_perfil_medico(data.id_usuario):
        raise HTTPException(status_code=400, detail="El usuario ya tiene un perfil médico. Use PUT para actualizar.")
    return db.crear_perfil_medico(data.model_dump())


@router.put("/{id_usuario}", response_model=PerfilMedicoResponse)
async def actualizar_perfil_medico(id_usuario: str, data: PerfilMedicoBase):
    """Actualizar perfil médico de un usuario."""
    perfil = db.actualizar_perfil_medico(id_usuario, data.model_dump(exclude_unset=True))
    if not perfil:
        raise HTTPException(status_code=404, detail="Perfil médico no encontrado")
    return perfil


@router.get("/{id_usuario}/resumen", response_model=ResumenMedico)
async def obtener_resumen_medico(id_usuario: str):
    """
    🚑 Genera el resumen ejecutivo de salud para paramédicos.
    
    Este endpoint produce un resumen compacto con la información
    vital del paciente: tipo de sangre, condiciones crónicas,
    medicamentos, alergias y contacto médico.
    """
    resumen = db.generar_resumen_medico(id_usuario)
    if not resumen:
        raise HTTPException(status_code=404, detail="No se encontró perfil médico para este usuario")
    return resumen
