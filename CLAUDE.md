# PostVenta Silko — Contexto del Proyecto

Panel web para gestionar campañas de postventa por WhatsApp, consultando ventas desde la API de Gestion Moda y registrando el progreso de contacto por cliente.

---

## Stack tecnológico

| Capa | Tecnología |
|---|---|
| Frontend | React 18 + Vite 5 |
| Backend | Node.js + Express 4 (CommonJS) |
| Base de datos | Supabase (Postgres) vía `@supabase/supabase-js` — sin ORM ni drivers nativos |
| HTTP client (backend) | Axios |
| Deploy | Render (plan free, `render.yaml`) |
| Repositorio | https://github.com/silkoindumentaria-ai/PostVenta |

---

## Estructura de archivos

```
PostVenta-Online/
├── CLAUDE.md                        ← este archivo
├── package.json                     ← raíz: scripts build/start
├── render.yaml                      ← blueprint de deploy para Render
├── nixpacks.toml                    ← legacy Railway (ya no se usa)
├── .gitignore
│
├── backend/
│   ├── server.js                    ← servidor Express + toda la lógica API
│   ├── package.json                 ← deps: express, axios, cors, dotenv, @supabase/supabase-js
│   ├── .env                         ← GM_TOKEN, TN_*, SUPABASE_* (no va a git)
│   ├── supabase-schema.sql          ← schema de tablas (ejecutar 1 vez en Supabase SQL Editor)
│   └── migrate-json-to-supabase.js  ← script one-shot: importa postventa.json a Supabase
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
# Pushear a GitHub — Render redespliega automáticamente
git add .
git commit -m "descripción"
git push
```

Render detecta el push, ejecuta el build definido en `render.yaml` (instala deps, buildea frontend a `backend/public/`, arranca backend) y redespliega en unos minutos.

**Ojo (plan free de Render):** el servicio se duerme tras 15 minutos sin tráfico; la primera visita después tarda ~30-60 segundos en responder. Los datos no se pierden (viven en Supabase).

---

## Variables de entorno

| Variable | Dónde | Descripción |
|---|---|---|
| `GM_TOKEN` | Render + `.env` local | Bearer token para API Gestion Moda |
| `TN_ACCESS_TOKEN` | Render + `.env` local | Token de Tienda Nube |
| `TN_STORE_ID` | Render + `.env` local | ID de tienda TN (1406056) |
| `SUPABASE_URL` | Render + `.env` local | URL del proyecto Supabase (`https://xxxx.supabase.co`) |
| `SUPABASE_SERVICE_KEY` | Render + `.env` local | Service role / secret key de Supabase (bypasea RLS; solo backend, nunca al frontend) |
| `PORT` | Render (auto) | Puerto del servidor. Render lo inyecta automáticamente |

El servidor hace `process.exit(1)` al arrancar si faltan `SUPABASE_URL` o `SUPABASE_SERVICE_KEY`.

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

## Base de datos (Supabase / Postgres)

Tres tablas, definidas en `backend/supabase-schema.sql`. Todas con RLS activado **sin políticas**: solo el backend accede, usando la service key (que bypasea RLS). El acceso desde el backend es vía `@supabase/supabase-js` (REST/PostgREST, sin conexión directa a Postgres).

**Límite importante de PostgREST:** máximo 1000 filas por request. `server.js` tiene el helper `fetchAllRows()` que pagina con `.range()` — usarlo para cualquier query que pueda devolver muchas filas (ej. contactos de una sesión).

### Tabla `sessions`

```sql
id bigint identity PK,
name text not null,
source text not null default 'gm',   -- 'gm' | 'tn'
channel_id bigint,                   -- null = todos los canales
channel_name text,
store_id bigint,                     -- null = todas las tiendas
store_name text,
date_from date not null,
date_to date not null,
whatsapp_message text,               -- [Nombre] se reemplaza con el primer nombre
status text not null default 'active',  -- 'active' | 'finished'
created_at timestamptz default now()
```

### Tabla `contacts`

```sql
id bigint identity PK,
session_id bigint not null → sessions(id),
sale_id bigint,                      -- ID de la venta en GM / orden en TN
client_id bigint,                    -- ID del cliente en GM / customer en TN
client_name text not null,
client_phone text,                   -- null si no tiene teléfono
date_sale date,
contacted boolean default false,
contacted_at timestamptz             -- null si no contactado
```

### Tabla `contact_logs` (historial, nunca se borra)

```sql
id bigint identity PK,
contact_id bigint, session_id bigint, session_name text, source text,
client_id bigint, client_name text,
client_phone_raw text, client_phone_normalized text,  -- normalizado a 549XXXXXXXXXX
message text, contacted_at timestamptz
```

Se inserta una fila cada vez que se marca un contacto como contactado. El historial de un cliente se busca por `client_phone_normalized` (o `client_id`+`source` si no hay teléfono), lo que permite cruzar al mismo cliente entre sesiones y fuentes distintas.

---

## API del backend (endpoints propios)

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/api/health` | Health check (Render + monitores de uptime) |
| `GET` | `/api/channels-stores` | Canales y tiendas disponibles (últimos 6 meses) |
| `GET` | `/api/sessions` | Sesiones activas con conteos de progreso |
| `POST` | `/api/sessions` | Crear sesión GM (fetcha ventas, guarda contactos) |
| `POST` | `/api/tn/sessions` | Crear sesión Tienda Nube (fetcha órdenes pagas) |
| `GET` | `/api/sessions/:id/contacts` | Sesión + lista de contactos |
| `POST` | `/api/sessions/:id/refresh-phones` | Re-busca teléfonos faltantes en GM |
| `PATCH` | `/api/sessions/:id/finish` | Archivar sesión (status → "finished") |
| `PATCH` | `/api/contacts/:id` | Toggle contacted; al marcar, registra en `contact_logs` |
| `GET` | `/api/contacts/:id/history` | Historial de contactos del mismo cliente |

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

## Render — configuración de deploy

Definido en **render.yaml** (en raíz): servicio web Node en plan free, build `npm --prefix backend install --omit=dev && npm --prefix frontend install && npm --prefix frontend run build`, start `node backend/server.js`, health check en `/api/health`.

Las env vars (`GM_TOKEN`, `TN_ACCESS_TOKEN`, `TN_STORE_ID`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`) se cargan en el dashboard de Render (están declaradas con `sync: false` en el yaml).

**El frontend buildeado** queda en `backend/public/` y es servido como archivos estáticos por Express.

**Historia:** el proyecto vivió en Railway (volumen `/data` + `postventa.json`) hasta julio 2026; se migró a Render + Supabase cuando terminó el plan gratuito de Railway. `nixpacks.toml` quedó como legacy.

---

## Tienda Nube — integración

**Credenciales (en Render env vars y backend/.env):**
- `TN_ACCESS_TOKEN` — bearer token
- `TN_STORE_ID` — 1406056

**Base URL:** `https://api.tiendanube.com/v1/{TN_STORE_ID}`  
**Auth header:** `Authentication: bearer {TN_ACCESS_TOKEN}`  
**User-Agent:** `SilkoPostVenta (gabrieldecima1028@gmail.com)` — requerido por TN

### Endpoint usado: `GET /orders`

Parámetros:
| Param | Valor fijo/variable |
|---|---|
| `payment_status` | `paid` (solo órdenes pagas) |
| `created_at_min` | date_from del formulario |
| `created_at_max` | date_to + `T23:59:59+0000` |
| `per_page` | 200 (máximo) |
| `page` | paginación |
| `fields` | `id,number,created_at,contact_name,contact_phone,contact_email,customer` |

**La respuesta es un array directo** (no `{data: [...]}` como GM). Paginación: si el array tiene < 200 items, es la última página.

Campos relevantes de cada orden:
```json
{
  "id": 1976331980,
  "number": 18983,
  "created_at": "2026-05-21T17:06:20+0000",
  "contact_name": "Morgan Pereyra",
  "contact_phone": "+543515931246",
  "contact_email": "morganpereyra2@gmail.com",
  "customer": { "id": 216081176, "phone": "+543515931246" }
}
```

**Los teléfonos de TN ya vienen con código de país** (`+549...`), no necesitan normalización adicional.

### Endpoint backend: `POST /api/tn/sessions`

Body igual a GM pero sin `channel_id` ni `store_id`:
```json
{ "name": "...", "date_from": "2026-05-01", "date_to": "2026-05-21", "whatsapp_message": "..." }
```

Las sesiones TN se guardan con `source: "tn"` en la tabla `sessions`.

### UI — selector de fuente

En el header hay dos botones: **Gestion Moda** (verde) y **Tienda Nube** (violeta). Cada uno muestra sus propias pestañas de sesiones. El estado `activeSource` en `App.jsx` controla cuál está visible. `activeId` es un objeto `{ gm: id|null, tn: id|null }` para recordar la pestaña activa de cada fuente independientemente.

El modal `NewSessionModal` recibe `source` como prop y adapta:
- `source === 'tn'`: sin dropdowns de canal/tienda, llama a `POST /api/tn/sessions`
- `source === 'gm'`: comportamiento original

---

## Decisiones de diseño importantes

- **Supabase por REST, sin drivers nativos:** se usa `@supabase/supabase-js` (HTTP puro) en vez de `pg` o SQLite para evitar compilación nativa y problemas de conexión directa a Postgres desde Render.
- **Persistencia:** los datos viven en Supabase (plan free), separados del hosting. Render free no tiene disco persistente — no escribir nada en el filesystem que deba sobrevivir un deploy.
- **IDs preservados:** la migración desde `postventa.json` conservó los IDs originales (`generated by default as identity` + `reset_id_sequences()`).
- **Teléfonos:** la API de GM no expone `/clientes/{id}`. Se busca por nombre (`GET /clientes?q={nombre}`) y se verifica cruzando el `id`. Si el cliente no tiene teléfono en GM, queda como `null` (sin solución desde la app).
- **Sesiones finalizadas:** se marcan con `status: "finished"` pero los datos NO se borran. Solo desaparecen de la vista.
- **Sin autenticación:** acceso abierto por diseño inicial. Se puede agregar en el futuro.
