"""
Servicio: Failover — Algoritmo de respaldo Internet → SMS.

Paso 1: Intenta enviar por Internet (API/Push Notification)
Paso 2: Si falla en 3s, dispara SMS de emergencia
Paso 3: Encola evidencias multimedia para subida posterior
"""

import asyncio
from datetime import datetime
from typing import Optional


async def enviar_por_internet(contacto: dict, mensaje: str) -> dict:
    """
    Simula el envío de notificación por internet (Push/MQTT).
    En producción: integrar con Firebase Cloud Messaging o servicio MQTT.
    """
    # Simular latencia de red (0.1 - 0.5s)
    await asyncio.sleep(0.2)

    return {
        "contacto": contacto["nombre_contacto"],
        "telefono": contacto["telefono"],
        "canal": "INTERNET",
        "estatus": "ENVIADO",
        "timestamp": datetime.now().isoformat()
    }


async def enviar_por_sms(contacto: dict, mensaje: str) -> dict:
    """
    Simula el envío de SMS de emergencia.
    En producción: integrar con Twilio, Vonage, o gateway SMS local.
    
    El SMS contiene solo texto plano: Nombre + GPS + Tipo de emergencia.
    """
    await asyncio.sleep(0.1)

    return {
        "contacto": contacto["nombre_contacto"],
        "telefono": contacto["telefono"],
        "canal": "SMS",
        "estatus": "ENVIADO",
        "mensaje_sms": mensaje[:160],  # Límite de 160 chars por SMS
        "timestamp": datetime.now().isoformat()
    }


async def ejecutar_failover(contacto: dict, mensaje: str, timeout: float = 3.0) -> dict:
    """
    Algoritmo de Failover para un contacto individual.
    
    1. Intenta enviar por internet con timeout de 3 segundos
    2. Si falla, dispara SMS automáticamente
    3. Retorna el resultado del canal que tuvo éxito
    """
    try:
        # Paso 1: Intentar por internet con timeout
        resultado = await asyncio.wait_for(
            enviar_por_internet(contacto, mensaje),
            timeout=timeout
        )
        resultado["failover"] = False
        return resultado

    except asyncio.TimeoutError:
        # Paso 2: Failover a SMS
        print(f"⚠️ Timeout de {timeout}s para {contacto['nombre_contacto']}. Activando SMS...")
        resultado = await enviar_por_sms(contacto, mensaje)
        resultado["failover"] = True
        return resultado

    except Exception as e:
        # Paso 2b: Cualquier error → SMS
        print(f"❌ Error enviando a {contacto['nombre_contacto']}: {e}. Activando SMS...")
        resultado = await enviar_por_sms(contacto, mensaje)
        resultado["failover"] = True
        resultado["error_original"] = str(e)
        return resultado
