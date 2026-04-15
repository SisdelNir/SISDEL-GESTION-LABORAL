"""Router: Alertas Empresa — emergencias para empresas de seguridad"""
from fastapi import APIRouter, HTTPException, Body
from models import AlertaEmpresaCreate, AgenteEmpresaCreate, EstatusUpdate
from database import (
    crear_alerta_empresa, listar_alertas_empresa, actualizar_estatus_alerta_empresa,
    registrar_agente_empresa, listar_agentes_empresa, login_agente_empresa_global,
    asignar_agente_alerta_empresa, obtener_asignaciones_alerta_empresa,
    obtener_contactos_piloto
)
from services.notificaciones import enviar_alerta_contacto, construir_mensaje_piloto

router = APIRouter(prefix="/api/empresa", tags=["Empresa Seguridad"])


# ── ALERTAS ──────────────────────────────────────────

@router.post("/alertas", status_code=201)
async def crear_alerta(data: AlertaEmpresaCreate):
    alerta = crear_alerta_empresa(data.model_dump())

    # ── AUTO-NOTIFICAR CONTACTOS DEL PILOTO ──
    id_piloto = alerta.get("id_piloto") or data.id_piloto
    if id_piloto:
        contactos = obtener_contactos_piloto(id_piloto)
        print(f"🔍 [Empresa] Buscando contactos del piloto {id_piloto}. Encontrados: {len(contactos)}")

        nombre = alerta.get("nombre_piloto", "Piloto")
        placas = alerta.get("placas_vehiculo", "")
        tipo = alerta.get("tipo_vehiculo", "")
        lat = alerta.get("gps_latitud")
        lon = alerta.get("gps_longitud")

        mensaje = construir_mensaje_piloto(nombre, placas, tipo, lat, lon)

        for c in contactos:
            tel = c.get("telefono")
            if tel:
                resultado = enviar_alerta_contacto(tel, mensaje)
                print(f"   → {c.get('nombre', '?')}: {resultado['canal']} ({'✅' if resultado['exito'] else '❌'})")
    else:
        print("⚠️ [Empresa] Alerta sin id_piloto, no se enviaron notificaciones.")

    return alerta


@router.get("/alertas/{id_empresa}")
async def listar_alertas(id_empresa: str):
    return listar_alertas_empresa(id_empresa)


@router.patch("/alertas/{id_alerta}/estatus")
async def cambiar_estatus(id_alerta: str, data: EstatusUpdate):
    r = actualizar_estatus_alerta_empresa(id_alerta, data.estatus, data.notas)
    if not r:
        raise HTTPException(404, "Alerta no encontrada")
    return r


# ── AGENTES EMPRESA ──────────────────────────────────

@router.post("/agentes/")
async def crear_agente(data: AgenteEmpresaCreate):
    return registrar_agente_empresa(data.model_dump())


@router.get("/agentes/lista/{id_empresa}")
async def listar_agents(id_empresa: str):
    return listar_agentes_empresa(id_empresa)


@router.post("/agentes/asignar")
async def asignar(data: dict = Body(...)):
    return asignar_agente_alerta_empresa(
        data["id_alerta"], data["id_empresa"],
        data["num_identificacion"], data["slot"]
    )


@router.get("/agentes/asignaciones/{id_alerta}")
async def asignaciones(id_alerta: str):
    return obtener_asignaciones_alerta_empresa(id_alerta)


@router.post("/agentes/login")
async def login_agente(data: dict = Body(...)):
    resultado = login_agente_empresa_global(data["identificador"])
    if not resultado:
        raise HTTPException(404, "Agente no encontrado")
    return resultado
