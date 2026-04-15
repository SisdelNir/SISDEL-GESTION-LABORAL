"""Router: Administradores"""
from fastapi import APIRouter
from models import AdminCreate, AdminResponse, LoginAdminRequest, LoginAdminResponse
from database import db
import secrets

router = APIRouter(prefix="/api/admin", tags=["Administradores"])


@router.post("/login", response_model=LoginAdminResponse)
async def login(data: LoginAdminRequest):
    admin = db.login_admin(data.clave)
    if not admin:
        return LoginAdminResponse(success=False, message="Clave inválida", admin=None, token=None)
    token = secrets.token_hex(32)
    return LoginAdminResponse(success=True, message="Acceso concedido", admin=AdminResponse(**admin), token=token)


@router.post("/", response_model=AdminResponse, status_code=201)
async def crear_admin(data: AdminCreate):
    admin = db.crear_administrador(data.model_dump())
    return admin


@router.get("/", response_model=list[AdminResponse])
async def listar_admins():
    return db.listar_administradores()


@router.post("/{id_admin}/regenerar-clave", response_model=AdminResponse)
async def regenerar_clave(id_admin: str):
    admin = db.regenerar_clave_admin(id_admin)
    if not admin:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Administrador no encontrado")
    return admin
