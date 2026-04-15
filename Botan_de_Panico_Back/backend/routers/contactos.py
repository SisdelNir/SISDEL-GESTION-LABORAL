"""
Router: Contactos de Emergencia — CRUD con límite de 10 por usuario.
"""

from fastapi import APIRouter, HTTPException
from models import ContactoCreate, ContactoResponse, ContactoBase
from database import db

router = APIRouter(prefix="/api/contactos", tags=["Contactos de Emergencia"])


@router.get("/{id_usuario}", response_model=list[ContactoResponse])
async def listar_contactos(id_usuario: str):
    """Listar contactos de emergencia de un usuario (ordenados por prioridad)."""
    if not db.obtener_usuario(id_usuario):
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    return db.obtener_contactos_usuario(id_usuario)


@router.post("/", response_model=ContactoResponse, status_code=201)
async def crear_contacto(contacto: ContactoCreate):
    """Agregar un contacto de emergencia (máximo 10 por usuario)."""
    if not db.obtener_usuario(contacto.id_usuario):
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    try:
        return db.crear_contacto(contacto.model_dump())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/{id_contacto}", response_model=ContactoResponse)
async def actualizar_contacto(id_contacto: int, data: ContactoBase):
    """Actualizar un contacto de emergencia."""
    contacto = db.actualizar_contacto(id_contacto, data.model_dump(exclude_unset=True))
    if not contacto:
        raise HTTPException(status_code=404, detail="Contacto no encontrado")
    return contacto


@router.delete("/{id_contacto}")
async def eliminar_contacto(id_contacto: int):
    """Eliminar un contacto de emergencia."""
    if not db.eliminar_contacto(id_contacto):
        raise HTTPException(status_code=404, detail="Contacto no encontrado")
    return {"message": "Contacto eliminado exitosamente"}
