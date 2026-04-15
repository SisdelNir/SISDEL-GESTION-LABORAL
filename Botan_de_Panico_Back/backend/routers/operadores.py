"""
Router: Operadores — Login y gestión del Centro de Monitoreo.
"""

from fastapi import APIRouter, HTTPException
from models import OperadorCreate, OperadorResponse, LoginRequest, LoginResponse
from database import db
import hashlib
import secrets

router = APIRouter(prefix="/api/operadores", tags=["Operadores"])


@router.post("/login", response_model=LoginResponse)
async def login(data: LoginRequest):
    """Login de operadores del Centro de Monitoreo."""
    operador = db.login_operador(data.usuario_acceso, data.password)
    if not operador:
        return LoginResponse(
            success=False,
            message="Credenciales inválidas",
            operador=None,
            token=None
        )
    # Token simple para esta versión (en producción usar JWT)
    token = secrets.token_hex(32)
    return LoginResponse(
        success=True,
        message="Login exitoso",
        operador=OperadorResponse(**operador),
        token=token
    )


@router.get("/", response_model=list[OperadorResponse])
async def listar_operadores():
    """Listar todos los operadores (solo ADMIN)."""
    return db.listar_operadores()


@router.post("/", response_model=OperadorResponse, status_code=201)
async def crear_operador(data: OperadorCreate):
    """Registrar un nuevo operador del Centro de Monitoreo."""
    operador = db.crear_operador(data.model_dump())
    return {k: v for k, v in operador.items() if k != "password_hash"}
