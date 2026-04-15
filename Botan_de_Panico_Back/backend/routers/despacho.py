"""
Router: Despacho de Unidades — Asignación de patrullas y ambulancias.
"""

from fastapi import APIRouter, HTTPException
from models import DespachoCreate, DespachoResponse, DespachoUpdate
from database import db

router = APIRouter(prefix="/api/despacho", tags=["Despacho de Unidades"])


@router.post("/", response_model=DespachoResponse, status_code=201)
async def crear_despacho(data: DespachoCreate):
    """Despachar una unidad (patrulla/ambulancia) a una emergencia."""
    # Validar emergencia
    emergencia = db.obtener_emergencia(data.id_emergencia)
    if not emergencia:
        raise HTTPException(status_code=404, detail="Emergencia no encontrada")
    if emergencia["estatus"] in ["RESUELTA", "FALSA_ALARMA", "CANCELADA"]:
        raise HTTPException(status_code=400, detail="No se puede despachar a una emergencia cerrada")

    return db.crear_despacho(data.model_dump())


@router.get("/{id_emergencia}", response_model=list[DespachoResponse])
async def listar_despachos(id_emergencia: str):
    """Listar unidades despachadas a una emergencia."""
    return db.obtener_despachos_emergencia(id_emergencia)


@router.put("/{id_despacho}")
async def actualizar_despacho(id_despacho: int, data: DespachoUpdate):
    """Actualizar estatus de una unidad despachada."""
    despacho = db.actualizar_despacho(id_despacho, data.model_dump(exclude_unset=True))
    if not despacho:
        raise HTTPException(status_code=404, detail="Despacho no encontrado")
    return despacho
