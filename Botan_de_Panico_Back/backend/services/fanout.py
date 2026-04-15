"""
Servicio: Fan-out — Dispersión masiva de alertas a N contactos simultáneamente.

Utiliza asyncio.gather() para enviar a los 10 contactos en paralelo,
cada uno con su propio Failover (Internet → SMS).
"""

import asyncio
from typing import List
from services.failover import ejecutar_failover


def construir_mensaje_emergencia(emergencia: dict, nombre_usuario: str) -> str:
    """
    Construye el mensaje de emergencia que se enviará a los contactos.
    Formato compacto para caber en un SMS (160 chars).
    """
    tipo = emergencia.get("tipo_emergencia", "EMERGENCIA")
    lat = emergencia.get("gps_latitud", "N/A")
    lon = emergencia.get("gps_longitud", "N/A")

    if tipo == "VIOLENCIA":
        emoji = "🚨"
        tipo_texto = "VIOLENCIA"
    else:
        emoji = "🚑"
        tipo_texto = "SALUD"

    # Mensaje principal (cabe en SMS)
    mensaje = (
        f"{emoji} ALERTA DE {tipo_texto}\n"
        f"Persona: {nombre_usuario}\n"
        f"GPS: {lat},{lon}\n"
        f"maps.google.com/?q={lat},{lon}\n"
        f"Hora: {emergencia.get('fecha_creacion', 'N/A')}"
    )

    return mensaje


async def ejecutar_fanout(
    emergencia: dict,
    contactos: List[dict],
    nombre_usuario: str
) -> List[dict]:
    """
    Ejecuta el Fan-out: envía la alerta a TODOS los contactos en paralelo.
    
    Cada contacto tiene su propio canal de Failover independiente:
    - Si el contacto tiene notificar_sms=True y notificar_push=True,
      se intenta por internet primero, SMS si falla.
    - Todos los envíos son concurrentes (asyncio.gather).
    
    Returns:
        Lista de resultados de notificación por cada contacto.
    """
    mensaje = construir_mensaje_emergencia(emergencia, nombre_usuario)

    # Crear tareas de envío para cada contacto
    tareas = []
    for contacto in contactos:
        tarea = ejecutar_failover(contacto, mensaje)
        tareas.append(tarea)

    # Ejecutar TODAS las tareas en paralelo
    resultados = await asyncio.gather(*tareas, return_exceptions=True)

    # Procesar resultados
    notificaciones = []
    for i, resultado in enumerate(resultados):
        if isinstance(resultado, Exception):
            notificaciones.append({
                "contacto": contactos[i]["nombre_contacto"],
                "telefono": contactos[i]["telefono"],
                "canal": "ERROR",
                "estatus": "FALLIDO",
                "error": str(resultado)
            })
        else:
            notificaciones.append(resultado)

    return notificaciones
