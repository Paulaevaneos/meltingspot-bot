# MeltingSpot Slack Bot

Bot de Slack que consulta la actividad de los agentes de una agencia en MeltingSpot.

## Uso en Slack

```
/agencia ID_AGENCIA
/agencia ID_AGENCIA 2025-01-01 2025-03-31
```

El bot responde con:
- Última conexión de cada agente
- Módulos de formación completados
- Lives vistos (directo o replay)
- Páginas vistas

---

## Instalación paso a paso

### 1. Subir el código a GitHub

1. Crea una cuenta en https://github.com (gratis)
2. Crea un repositorio nuevo llamado `meltingspot-bot`
3. Sube todos estos archivos al repositorio

### 2. Desplegar en Vercel

1. Crea una cuenta en https://vercel.com (gratis, con tu cuenta de GitHub)
2. Click en "Add New Project"
3. Selecciona tu repositorio `meltingspot-bot`
4. En "Environment Variables" añade las tres variables del archivo `.env.example`:
   - `MELTINGSPOT_API_KEY` → tu API key de MeltingSpot
   - `SLACK_SIGNING_SECRET` → lo obtienes en el paso 3
   - `GOOGLE_SHEET_ID` → `16nfPbwCwA2BgA5K7wPjjqkT5ks_1Z5PN-tUAasxgxvg`
5. Click en "Deploy"
6. Vercel te dará una URL pública, por ejemplo: `https://meltingspot-bot.vercel.app`

### 3. Crear la Slack App

1. Ve a https://api.slack.com/apps
2. Click en "Create New App" → "From scratch"
3. Ponle nombre: `MeltingSpot Bot`
4. Selecciona tu workspace de Slack
5. En el menú lateral, ve a **Slash Commands** → "Create New Command"
   - Command: `/agencia`
   - Request URL: `https://TU-URL-VERCEL.vercel.app/api/agencia`
   - Short description: `Consulta actividad MeltingSpot por agencia`
   - Usage hint: `ID_AGENCIA [fecha_inicio] [fecha_fin]`
6. En **OAuth & Permissions** → Scopes → añade: `commands`, `chat:write`
7. En **Basic Information** copia el "Signing Secret" → ponlo en Vercel como `SLACK_SIGNING_SECRET`
8. Click en "Install to Workspace"

¡Listo! Ya puedes usar `/agencia` en Slack.

---

## Estructura del proyecto

```
meltingspot-bot/
├── api/
│   └── agencia.js      ← Función serverless principal
├── package.json
├── vercel.json
├── .env.example
└── README.md
```
