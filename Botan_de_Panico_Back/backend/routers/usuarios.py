"""
Router: Usuarios — CRUD de ciudadanos.
"""

from fastapi import APIRouter, HTTPException
from models import UsuarioCreate, UsuarioResponse, UsuarioBase
from database import db

router = APIRouter(prefix="/api/usuarios", tags=["Usuarios"])


@router.get("/", response_model=list[UsuarioResponse])
async def listar_usuarios():
    """Listar todos los usuarios registrados."""
    return db.listar_usuarios()


@router.post("/", response_model=UsuarioResponse, status_code=201)
async def crear_usuario(usuario: UsuarioCreate):
    """Registrar un nuevo ciudadano."""
    id_usuario = db.crear_usuario(usuario.model_dump())
    return db.obtener_usuario(id_usuario)


@router.get("/{id_usuario}", response_model=UsuarioResponse)
async def obtener_usuario(id_usuario: str):
    """Obtener perfil completo de un usuario."""
    usuario = db.obtener_usuario(id_usuario)
    if not usuario:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    return usuario


@router.put("/{id_usuario}", response_model=UsuarioResponse)
async def actualizar_usuario(id_usuario: str, data: UsuarioBase):
    """Actualizar perfil de un usuario."""
    usuario = db.actualizar_usuario(id_usuario, data.model_dump(exclude_unset=True))
    if not usuario:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    return usuario


@router.delete("/{id_usuario}")
async def eliminar_usuario(id_usuario: str):
    """Eliminar un usuario y todos sus datos asociados."""
    if not db.eliminar_usuario(id_usuario):
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    return {"message": "Usuario eliminado exitosamente"}
