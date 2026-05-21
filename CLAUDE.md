# PostVenta Silko — Contexto del Proyecto

Panel web para gestionar campañas de postventa por WhatsApp, consultando ventas desde la API de Gestion Moda y registrando el progreso de contacto por cliente.

---

## Stack tecnológico

| Capa | Tecnología |
|---|---|
| Frontend | React 18 + Vite 5 |
| Backend | Node.js + Express 4 (CommonJS) |
| Base de datos | JSON file (`postventa.json`) — sin ORM, sin SQLite |
| HTTP client (backend) | Axios |
| Deploy | Railway (cloud) |
| Repositorio | https://github.com/silkoindumentaria-ai/PostVenta |

---

## Estructura de archivos

```
PostVenta-Online/
├── CLAUDE.md                        ← este archivo
├── package.json                     ← raíz: scripts build/start para Railway
├── nixpacks.toml                    ← configuración de build para Railway
├── .gitignore
│
├── backend/
│   ├── server.js                    ← servidor Express + toda la lógica API
│   ├── package.json                 ← deps: express, axios, cors, dotenv
│   ├── .env                         ← GM_TOKEN, PORT (no va a git)
│   └── postventa.json               ← base de datos (no va a git, en volumen Railway)
│
└── frontend/
    ├── index.html
    ├── package.json                 ← deps: react, react-dom + vite
    ├── vite.config.js               ← proxy /api → localhost:3001, build → ../backend/public
    └── src/
        ├── main.jsx
        ├── App.jsx                  ← estado global, tabs, routing entre sesiones
        ├── App.css                  ← todos los estilos del proyecto
        ├── index.css                ← variables CSS y reset
        └── components/
            ├── ContactsTable.jsx    ← tabla principal con filtros, progreso, links WSP
            └── NewSessionModal.jsx  ← modal para crear nueva sesión de postventa
```

---

## Cómo correr localmente

```bash
# Terminal 1 — backend (puerto 3001)
cd backend
npm run dev        # usa nodemon

# Terminal 2 — frontend (puerto 5173)
cd frontend
npm run dev
# → abrir http://localhost:5173
```

El frontend en dev proxea `/api/*` automáticamente al backend en 3001 (configurado en `vite.config.js`).

## Deploy a producción

```bash
# Build del frontend → genera backend/public/
cd frontend && npm run build

# O simplemente pushear a GitHub — Railway redespliega automáticamente
git add .
git commit -m "descripción"
git push
```

Railway detecta el push, ejecuta `nixpacks.toml` (instala deps, buildea frontend, arranca backend) y redespliega en ~2 minutos.

---

## Variables de entorno

| Variable | Dónde | Descripción |
|---|---|---|
| `GM_TOKEN` | Railway + `.env` local | Bearer token para API Gestion Moda |
| `DB_PATH` | Railway | Ruta del JSON de datos. En Railway: `/data/postventa.json` |
| `PORT` | Railway (auto) | Puerto del servidor. Railway lo inyecta automáticamente |

En local, `DB_PATH` no hace falta — usa `backend/postventa.json` por defecto.

---

## API de Gestion Moda

**Base URL:** `https://gestion.moda/api/v1`  
**Auth:** `Authorization: Bearer <GM_TOKEN>` en cada request  
**Timeout:** 30 segundos

### Endpoints usados

#### `GET /ventas/obtener`
Devuelve ventas paginadas.

Parámetros relevantes:
| Param | Tipo | Descripción |
|---|---|---|
| `from` | string | Fecha desde (YYYY-MM-DD) |
| `to` | string | Fecha hasta (YYYY-MM-DD) |
| `channel_id` | integer | Filtrar por canal de venta |
| `store_id` | integer | Filtrar por tienda/local |
| `per_page` | integer | Máximo 200 |
| `page` | integer | Paginación |
| `include_details` | 0/1 | Incluir líneas de detalle |
| `include_payments` | 0/1 | Incluir pagos |

Campos relevantes de cada venta en la respuesta:
```json
{
  "id": 1247695,
  "date_sale": "2026-05-21",
  "client_id": 587350,
  "client_name": "Luis Emiliano Arce",
  "client_phone": "",
  "channel_id": 883,
  "channel": "Whatsapp",
  "store_id": 4736,
  "store": "Local - Galeria Florida",
  "client": {
    "id": 587350,
    "phone_number": "",
    "cellphone_number": ""
  },
  "meta": { "has_more_pages": true, "last_page": 50 }
}
```

**Importante:** `client_phone` (= `phone_number`) suele estar vacío. El teléfono real puede estar en `cellphone_number` del endpoint de clientes.

#### `GET /clientes`
Lista/busca clientes.

Parámetros:
| Param | Descripción |
|---|---|
| `q` | Búsqueda por nombre, email, teléfono, CUIT/DNI |
| `per_page` | Máximo 200 |

**No existe `GET /clientes/{id}`** — para buscar un cliente específico se usa `q={nombre}` y se verifica que el `id` del resultado coincida con el `client_id` de la venta.

Campos relevantes de cada cliente:
```json
{
  "id": 502026,
  "name": "Gustavo Rene Moreno",
  "phone_number": "",
  "cellphone_number": "+549299 5736820"
}
```

---

## Base de datos local (postventa.json)

Estructura del archivo JSON:

```json
{
  "sessions": [...],
  "contacts": [...],
  "nextSessionId": 5,
  "nextContactId": 312
}
```

### Modelo Session

```js
{
  id: 1,                          // auto-incremental
  name: "PostVenta Mayo Florida", // nombre de la sesión
  channel_id: 883,                // null = todos los canales
  channel_name: "Whatsapp",
  store_id: 4736,                 // null = todas las tiendas
  store_name: "Local - Galeria Florida",
  date_from: "2026-05-01",
  date_to: "2026-05-21",
  whatsapp_message: "Hola [Nombre], ...", // [Nombre] se reemplaza con el primer nombre
  status: "active",               // "active" | "finished"
  created_at: "2026-05-21T14:00:00.000Z"
}
```

### Modelo Contact

```js
{
  id: 1,                          // auto-incremental
  session_id: 1,                  // FK a sessions.id
  sale_id: 1247695,               // ID de la venta en Gestion Moda
  client_id: 587350,              // ID del cliente en Gestion Moda
  client_name: "Luis Emiliano Arce",
  client_phone: "+5491123456789", // null si no tiene teléfono
  date_sale: "2026-05-21",
  contacted: false,               // true cuando se marca el checkbox
  contacted_at: null              // ISO string cuando contacted=true
}
```

---

## API del backend (endpoints propios)

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/api/channels-stores` | Canales y tiendas disponibles (últimos 6 meses) |
| `GET` | `/api/sessions` | Sesiones activas con conteos de progreso |
| `POST` | `/api/sessions` | Crear sesión (fetcha ventas de GM, guarda contactos) |
| `GET` | `/api/sessions/:id/contacts` | Sesión + lista de contactos |
| `PATCH` | `/api/sessions/:id/finish` | Archivar sesión (status → "finished") |
| `PATCH` | `/api/contacts/:id` | Toggle contacted (true/false) |

### POST /api/sessions — body esperado
```json
{
  "name": "PostVenta Mayo",
  "channel_id": 883,
  "store_id": 4736,
  "date_from": "2026-05-01",
  "date_to": "2026-05-21",
  "whatsapp_message": "Hola [Nombre], ..."
}
```

---

## Frontend — componentes

### App.jsx
Estado global de la app:
- `sessions` — array de sesiones activas con `total_contacts` y `contacted_count`
- `activeId` — ID de la sesión en la pestaña activa
- `sessionData` — `{ session, contacts }` de la sesión activa

Funciones principales:
- `fetchSessions()` — carga sesiones al montar
- `handleSessionCreated(session)` — agrega nueva sesión a las tabs
- `handleFinishSession(id)` — archiva sesión y la saca de las tabs
- `handleContactToggle(contactId, contacted)` — actualiza checkbox y actualiza contadores en tabs

### ContactsTable.jsx
Recibe: `{ session, contacts, onToggle, onFinish }`

Funciones internas:
- `formatPhoneForWhatsApp(raw)` — normaliza número argentino al formato `549XXXXXXXXXX`
- `buildWhatsAppUrl(phone, message, clientName)` — genera URL `https://wa.me/...?text=...` reemplazando `[Nombre]` con el primer nombre del cliente
- Filtros locales: búsqueda por texto + tabs "Todos / Pendientes / Contactados"

### NewSessionModal.jsx
- Al abrirse, fetcha `/api/channels-stores` para poblar los dropdowns
- Fechas default: última semana
- Mensaje default hardcodeado en el componente
- Al crear, llama `POST /api/sessions` que puede tardar 30-60s (fetcha todas las páginas de GM + enriquece teléfonos)

---

## WhatsApp — formato de URL

```
https://wa.me/549XXXXXXXXXX?text=Mensaje%20URL-encoded
```

Normalización de teléfonos argentinos en `ContactsTable.jsx`:
1. Eliminar todo lo que no sea dígito
2. Si empieza en `0` y tiene más de 10 dígitos → sacar el `0`
3. Si empieza en `54` pero no en `549` → insertar `9` después del `54`
4. Si no empieza en `54` → anteponer `549`

---

## Railway — configuración de deploy

**nixpacks.toml** (en raíz):
```toml
[phases.install]
cmds = [
  "npm --prefix backend install --omit=dev",
  "npm --prefix frontend install"
]

[phases.build]
cmds = ["npm --prefix frontend run build"]

[start]
cmd = "node backend/server.js"
```

**Volumen:** montado en `/data` → `DB_PATH=/data/postventa.json`

**El frontend buildeado** queda en `backend/public/` y es servido como archivos estáticos por Express.

---

## Decisiones de diseño importantes

- **Sin SQLite/base de datos nativa:** se usa JSON file para evitar compilación nativa (`better-sqlite3` no tiene binarios para Node 24 en Windows sin Visual Studio).
- **Persistencia en Railway:** el JSON vive en un volumen montado en `/data`, separado del código de la app.
- **Teléfonos:** la API de GM no expone `/clientes/{id}`. Se busca por nombre (`GET /clientes?q={nombre}`) y se verifica cruzando el `id`. Si el cliente no tiene teléfono en GM, queda como `null` (sin solución desde la app).
- **Sesiones finalizadas:** se marcan con `status: "finished"` pero los datos NO se borran del JSON. Solo desaparecen de la vista.
- **Sin autenticación:** acceso abierto por diseño inicial. Se puede agregar en el futuro.
