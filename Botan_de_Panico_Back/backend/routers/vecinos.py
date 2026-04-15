"""Router: Vecinos — claves y registro (scoped por institución)"""
from fastapi import APIRouter, HTTPException
from models import (ClaveVecinoCreate, ClaveVecinoResponse,
                    ValidarClaveVecinoRequest, ValidarClaveVecinoResponse,
                    VecinoCreate, VecinoResponse)
from database import db

router = APIRouter(prefix="/api/vecinos", tags=["Vecinos"])


# ── CLAVES ──────────────────────────────────────────────────

@router.post("/claves", response_model=ClaveVecinoResponse, status_code=201)
async def generar_clave(data: ClaveVecinoCreate):
    if not db.obtener_institucion(data.id_institucion):
        raise HTTPException(404, "Institución no encontrada")
    return db.generar_clave_vecino(data.id_institucion, data.descripcion)


@router.post("/claves/validar", response_model=ValidarClaveVecinoResponse)
async def validar_clave(data: ValidarClaveVecinoRequest):
    clave_obj = db.validar_clave_vecino(data.clave, data.id_institucion)
    if not clave_obj:
        return ValidarClaveVecinoResponse(valida=False, mensaje="Clave inválida")
    vecino = db.obtener_vecino_por_clave(data.clave)
    return ValidarClaveVecinoResponse(valida=True, mensaje="Clave válida", vecino=vecino)


@router.get("/claves/{id_institucion}", response_model=list[ClaveVecinoResponse])
async def listar_claves(id_institucion: str):
    return db.listar_claves_vecinos(id_institucion)


@router.delete("/claves/{id_clave}")
async def eliminar_clave(id_clave: int):
    if not db.eliminar_clave_vecino(id_clave):
        raise HTTPException(404, "Clave no encontrada")
    return {"mensaje": "Clave eliminada"}


# ── VECINOS ─────────────────────────────────────────────────

@router.get("/buscar/{id_institucion}/{num_identificacion}")
async def buscar_vecino(id_institucion: str, num_identificacion: str):
    """Busca un vecino por su número de identificación dentro de una institución."""
    vecino = db.buscar_vecino_por_identificacion(num_identificacion, id_institucion)
    if not vecino:
        raise HTTPException(404, "Vecino no encontrado")
    return vecino


@router.post("/registro", response_model=VecinoResponse, status_code=201)
async def registrar_vecino(data: VecinoCreate):
    # Si tiene clave, validarla solo si el vecino no está registrado aún
    existing = db.buscar_vecino_por_identificacion(data.num_identificacion, data.id_institucion)
    if not existing:
        if data.clave_acceso:
            clave_obj = db.validar_clave_vecino(data.clave_acceso, data.id_institucion)
            if not clave_obj:
                raise HTTPException(403, "Clave de acceso inválida para esta institución")
    return db.registrar_vecino(data.model_dump())


@router.get("/{id_institucion}", response_model=list[VecinoResponse])
async def listar_vecinos(id_institucion: str):
    return db.listar_vecinos(id_institucion)


@router.put("/{id_vecino}")
async def actualizar_vecino(id_vecino: str, data: dict):
    resultado = db.actualizar_vecino(id_vecino, data)
    if not resultado:
        raise HTTPException(404, "Vecino no encontrado o sin cambios")
    return resultado


@router.delete("/{id_vecino}")
async def eliminar_vecino(id_vecino: str):
    if not db.eliminar_vecino(id_vecino):
        raise HTTPException(404, "Vecino no encontrado")
    return {"mensaje": "Vecino eliminado correctamente"}


# ── CONTACTOS DE EMERGENCIA ────────────────────────────────

@router.post("/{id_vecino}/contactos")
async def guardar_contactos(id_vecino: str, contactos: list[dict]):
    """Guarda/actualiza los contactos de emergencia de un vecino."""
    return db.guardar_contactos_emergencia(id_vecino, contactos)


@router.get("/{id_vecino}/contactos")
async def obtener_contactos(id_vecino: str):
    return db.obtener_contactos_emergencia(id_vecino)
