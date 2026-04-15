"""
Botón de Pánico SISDEL — Servidor Principal
Ejecutar: uvicorn main:app --reload --host 0.0.0.0 --port 8000
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os

from routers import programador, vecinos, emergencias, agentes, pilotos, alertas_empresa

app = FastAPI(
    title="🚨 Botón de Pánico SISDEL",
    description="Sistema de Emergencia Ciudadana Multi-Institucional",
    version="2.0.0",
    docs_url="/docs"
)

app.add_middleware(CORSMiddleware, allow_origins=["*"],
                   allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

app.include_router(programador.router)
app.include_router(vecinos.router)
app.include_router(emergencias.router)
app.include_router(agentes.router)
app.include_router(pilotos.router)
app.include_router(alertas_empresa.router)

@app.get("/health", tags=["Sistema"])
async def health():
    return {"status": "ok", "sistema": "Botón de Pánico SISDEL", "version": "2.0.0"}


@app.post("/api/test-whatsapp", tags=["Sistema"])
async def test_whatsapp(data: dict):
    """Envía un mensaje de prueba de WhatsApp para verificar la configuración."""
    from services.notificaciones import enviar_alerta_contacto
    telefono = data.get("telefono", "")
    mensaje = (
        "✅ *PRUEBA EXITOSA — SISDEL* ✅\n\n"
        "Si recibes este mensaje, la integración de WhatsApp "
        "con tu plataforma de Botón de Pánico está funcionando correctamente.\n\n"
        f"📱 Enviado a: {telefono}\n"
        "_Central de Monitoreo SISDEL_"
    )
    resultado = enviar_alerta_contacto(telefono, mensaje)
    return resultado


# Servir dashboard estático (DEBE ir al final — catch-all)
dashboard_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "dashboard")
if os.path.exists(dashboard_path):
    app.mount("/", StaticFiles(directory=dashboard_path, html=True), name="static")
