# 🚨 Botón de Pánico — Sistema de Emergencia Ciudadana

Sistema de emergencia ciudadana con **botón de pánico**, **centro de monitoreo en tiempo real**, gestión de evidencias cifradas y módulo de **salud inteligente** para paramédicos.

---

## 📦 Estructura del Proyecto

```
BOTON DE PANICO/
├── README.md
├── backend/
│   ├── main.py              ← Servidor FastAPI
│   ├── models.py             ← Schemas Pydantic
│   ├── database.py           ← Base de datos en memoria
│   ├── database/
│   │   └── schema.sql        ← DDL PostgreSQL (referencia)
│   ├── routers/
│   │   ├── usuarios.py       ← CRUD de ciudadanos
│   │   ├── contactos.py      ← Contactos de emergencia
│   │   ├── emergencias.py    ← 🚨 Disparo de alertas
│   │   ├── salud.py          ← Perfil médico
│   │   ├── operadores.py     ← Login y gestión
│   │   └── despacho.py       ← Despacho de unidades
│   └── services/
│       ├── failover.py       ← Algoritmo Internet → SMS
│       └── fanout.py         ← Dispersión masiva
└── dashboard/
    ├── index.html            ← Centro de Monitoreo
    ├── css/styles.css        ← Tema oscuro "Centro de Mando"
    └── js/
        ├── auth.js           ← Login de operadores
        └── app.js            ← Mapa, alertas, despacho
```

---

## 🚀 Instalación y Ejecución

### 1. Instalar dependencias

```bash
pip install fastapi uvicorn pydantic
```

### 2. Iniciar el servidor

```bash
cd backend
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### 3. Acceder al sistema

| Recurso | URL |
|---|---|
| 📖 Documentación API | http://localhost:8000/docs |
| 🗺️ Dashboard | http://localhost:8000/dashboard/index.html |
| 💚 Health Check | http://localhost:8000/health |

### 4. Login del Dashboard

| Campo | Valor |
|---|---|
| Usuario | `admin` |
| Contraseña | `1122` |

---

## 🔥 API Endpoints

### Usuarios
| Método | Endpoint | Descripción |
|---|---|---|
| GET | `/api/usuarios` | Listar usuarios |
| POST | `/api/usuarios` | Registrar ciudadano |
| GET | `/api/usuarios/{id}` | Obtener perfil |
| PUT | `/api/usuarios/{id}` | Actualizar perfil |
| DELETE | `/api/usuarios/{id}` | Eliminar usuario |

### Contactos de Emergencia
| Método | Endpoint | Descripción |
|---|---|---|
| GET | `/api/contactos/{user_id}` | Listar contactos |
| POST | `/api/contactos` | Agregar contacto (máx 10) |
| PUT | `/api/contactos/{id}` | Actualizar contacto |
| DELETE | `/api/contactos/{id}` | Eliminar contacto |

### 🚨 Emergencias
| Método | Endpoint | Descripción |
|---|---|---|
| POST | `/api/emergencias/disparar` | **DISPARAR ALERTA** |
| GET | `/api/emergencias` | Listar emergencias |
| GET | `/api/emergencias/activas` | Solo activas (Dashboard) |
| GET | `/api/emergencias/{id}` | Detalle completo |
| PUT | `/api/emergencias/{id}/estatus` | Cambiar estatus |

### 🚑 Salud
| Método | Endpoint | Descripción |
|---|---|---|
| GET | `/api/salud/{user_id}` | Perfil médico |
| POST | `/api/salud` | Crear perfil |
| PUT | `/api/salud/{user_id}` | Actualizar perfil |
| GET | `/api/salud/{user_id}/resumen` | **Resumen para paramédicos** |

### Operadores
| Método | Endpoint | Descripción |
|---|---|---|
| POST | `/api/operadores/login` | Login |
| GET | `/api/operadores` | Listar operadores |
| POST | `/api/operadores` | Crear operador |

### 🚓 Despacho
| Método | Endpoint | Descripción |
|---|---|---|
| POST | `/api/despacho` | Despachar unidad |
| GET | `/api/despacho/{emergency_id}` | Listar despachos |
| PUT | `/api/despacho/{id}` | Actualizar despacho |

---

## 🧪 Datos de Demostración

El sistema pre-carga datos de prueba al iniciar:

- **Usuario:** María González López (Tel: 5551234567)
- **3 Contactos de emergencia** con prioridad
- **Perfil médico:** O+, Hipertensión, Enalapril
- **Operador admin** para el dashboard
