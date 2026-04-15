"""Router: Emergencias (scoped por institución)"""
from fastapi import APIRouter, HTTPException
from models import EmergenciaCreate, EmergenciaResponse, EstatusUpdate, StatsResponse
from database import db
from services.notificaciones import enviar_alerta_contacto, construir_mensaje_vecino

router = APIRouter(prefix="/api/emergencias", tags=["Emergencias"])


@router.post("/", response_model=EmergenciaResponse, status_code=201)
async def crear(data: EmergenciaCreate):
    # 1. Validar institución
    if not db.obtener_institucion(data.id_institucion):
        raise HTTPException(404, "Institución no encontrada")
    
    # 2. Registrar la emergencia en BD
    print(f"🚨 Recibida alerta de pánico. id_vecino: {data.id_vecino}")
    nueva_emergencia = db.crear_emergencia(data.model_dump())
    
    # 3. Disparar notificaciones WhatsApp a familiares
    if data.id_vecino:
        contactos = db.obtener_contactos_emergencia(data.id_vecino)
        print(f"🔍 Buscando familiares para {data.id_vecino}. Encontrados: {len(contactos)}")
        
        nombre = data.nombre_vecino or "Vecino Desconocido"
        ubicacion = data.direccion_aproximada or data.direccion_vecino or "Ubicación desconocida"
        lat = data.gps_latitud if hasattr(data, 'gps_latitud') else None
        lon = data.gps_longitud if hasattr(data, 'gps_longitud') else None

        mensaje = construir_mensaje_vecino(nombre, ubicacion, lat, lon)
        
        for c in contactos:
            tel = c.get("telefono")
            if tel:
                resultado = enviar_alerta_contacto(tel, mensaje)
                print(f"   → {c.get('nombre_contacto', '?')}: {resultado['canal']} ({'✅' if resultado['exito'] else '❌'})")
    else:
        print("⚠️ No se pudo enviar notificaciones: id_vecino es nulo.")
    
    return nueva_emergencia


@router.get("/{id_institucion}", response_model=list[EmergenciaResponse])
async def listar(id_institucion: str, estatus: str = None):
    return db.listar_emergencias(id_institucion, estatus)


@router.get("/{id_institucion}/stats", response_model=StatsResponse)
async def stats(id_institucion: str):
    return db.stats_institucion(id_institucion)


@router.patch("/{id_emergencia}/estatus", response_model=EmergenciaResponse)
async def actualizar_estatus(id_emergencia: str, data: EstatusUpdate):
    e = db.actualizar_estatus_emergencia(id_emergencia, data.estatus, data.notas)
    if not e:
        raise HTTPException(404, "Emergencia no encontrada")
    return e


@router.delete("/{id_institucion}/limpiar")
async def limpiar_emergencias(id_institucion: str):
    """Elimina TODAS las emergencias de una institución."""
    if not db.obtener_institucion(id_institucion):
        raise HTTPException(404, "Institución no encontrada")
    count = db.limpiar_emergencias(id_institucion)
    return {"mensaje": f"Se eliminaron {count} emergencia(s)", "eliminadas": count}
