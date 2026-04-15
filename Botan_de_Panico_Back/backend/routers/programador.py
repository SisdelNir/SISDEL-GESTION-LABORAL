"""Router: Programador — gestión de instituciones + empresas (clave maestra 1122)"""
from fastapi import APIRouter, HTTPException
from models import (InstitucionCreate, InstitucionUpdate, InstitucionResponse,
                    LoginInstRequest, LoginInstResponse,
                    EmpresaCreate, EmpresaUpdate, EmpresaResponse)
from database import (db, CLAVE_PROGRAMADOR, login_agente_global,
                      login_empresa, login_piloto, login_agente_empresa_global,
                      login_piloto_global,
                      crear_empresa, listar_empresas, toggle_empresa,
                      editar_empresa, regenerar_clave_empresa, eliminar_empresa,
                      listar_pilotos)

router = APIRouter(prefix="/api/programador", tags=["Programador"])


@router.post("/login", response_model=LoginInstResponse)
async def login(data: LoginInstRequest):
    clave = data.clave.strip()

    # ¿Es clave de programador?
    if clave == CLAVE_PROGRAMADOR:
        return LoginInstResponse(success=True, message="Acceso programador", tipo="programador")

    # ¿Es clave de institución?
    inst = db.obtener_institucion_por_clave(clave)
    if inst:
        return LoginInstResponse(
            success=True, message="Acceso institución", tipo="institucion",
            institucion=InstitucionResponse(**inst)
        )

    # ¿Es código de vecino (codigo_vecino)?
    for v in db.vecinos.values():
        if v.get("codigo_vecino", "").upper() == clave.upper():
            return LoginInstResponse(
                success=True, message="Acceso vecino",
                tipo="vecino", id_institucion=v["id_institucion"],
                num_identificacion=v["num_identificacion"]
            )

    # ¿Es número de identificación de vecino?
    for v in db.vecinos.values():
        if v.get("num_identificacion", "").upper() == clave.upper():
            return LoginInstResponse(
                success=True, message="Acceso vecino",
                tipo="vecino", id_institucion=v["id_institucion"],
                num_identificacion=v["num_identificacion"]
            )

    # ¿Es clave de acceso de vecino (clave_acceso)?
    clave_obj = db.validar_clave_vecino(clave)
    if clave_obj:
        return LoginInstResponse(
            success=True, message="Acceso vecino",
            tipo="vecino", id_institucion=clave_obj["id_institucion"]
        )

    # ¿Es código o documento de agente?
    agente_data = login_agente_global(clave)
    if agente_data:
        ag = agente_data["agente"]
        return LoginInstResponse(
            success=True, message="Acceso agente",
            tipo="agente",
            id_institucion=ag["id_institucion"],
            num_identificacion=ag["num_identificacion"]
        )

    # ¿Es clave de empresa de seguridad?
    emp = login_empresa(clave)
    if emp:
        return LoginInstResponse(
            success=True, message="Acceso empresa",
            tipo="empresa",
            id_institucion=emp["id_empresa"],  # reusamos este campo para el ID
        )

    # ¿Es código de agente de empresa?
    ag_emp = login_agente_empresa_global(clave)
    if ag_emp:
        ag = ag_emp["agente"]
        return LoginInstResponse(
            success=True, message="Acceso agente empresa",
            tipo="agente_empresa",
            id_institucion=ag["id_empresa"],
            num_identificacion=ag["num_identificacion"]
        )

    # ¿Es código de piloto o DPI de piloto?
    piloto = login_piloto_global(clave)
    if piloto:
        return LoginInstResponse(
            success=True, message="Acceso piloto",
            tipo="piloto",
            id_institucion=piloto["id_empresa"],
            num_identificacion=piloto["num_identificacion"]
        )

    return LoginInstResponse(success=False, message="Clave inválida")


@router.get("/instituciones", response_model=list[InstitucionResponse])
async def listar():
    return db.listar_instituciones()


@router.post("/instituciones", response_model=InstitucionResponse, status_code=201)
async def crear(data: InstitucionCreate):
    return db.crear_institucion(data.model_dump())


@router.patch("/instituciones/{id_inst}/toggle", response_model=InstitucionResponse)
async def toggle(id_inst: str):
    inst = db.toggle_institucion(id_inst)
    if not inst:
        raise HTTPException(404, "Institución no encontrada")
    return inst


@router.patch("/instituciones/{id_inst}/regenerar-clave", response_model=InstitucionResponse)
async def regenerar(id_inst: str):
    inst = db.regenerar_clave_institucion(id_inst)
    if not inst:
        raise HTTPException(404, "Institución no encontrada")
    return inst


@router.put("/instituciones/{id_inst}", response_model=InstitucionResponse)
async def editar(id_inst: str, data: InstitucionUpdate):
    inst = db.editar_institucion(id_inst, data.model_dump(exclude_unset=True))
    if not inst:
        raise HTTPException(404, "Institución no encontrada")
    return inst


@router.delete("/instituciones/{id_inst}", status_code=204)
async def eliminar(id_inst: str):
    ok = db.eliminar_institucion(id_inst)
    if not ok:
        raise HTTPException(404, "Institución no encontrada")


# ══ EMPRESAS DE SEGURIDAD ═══════════════════════════════════

@router.get("/empresas")
async def listar_emp():
    return listar_empresas()


@router.post("/empresas", status_code=201)
async def crear_emp(data: EmpresaCreate):
    return crear_empresa(data.model_dump())


@router.patch("/empresas/{id_emp}/toggle")
async def toggle_emp(id_emp: str):
    r = toggle_empresa(id_emp)
    if not r:
        raise HTTPException(404, "Empresa no encontrada")
    return r


@router.patch("/empresas/{id_emp}/regenerar-clave")
async def regen_emp(id_emp: str):
    r = regenerar_clave_empresa(id_emp)
    if not r:
        raise HTTPException(404, "Empresa no encontrada")
    return r


@router.put("/empresas/{id_emp}")
async def editar_emp(id_emp: str, data: EmpresaUpdate):
    r = editar_empresa(id_emp, data.model_dump(exclude_unset=True))
    if not r:
        raise HTTPException(404, "Empresa no encontrada")
    return r


@router.delete("/empresas/{id_emp}", status_code=204)
async def eliminar_emp(id_emp: str):
    eliminar_empresa(id_emp)
