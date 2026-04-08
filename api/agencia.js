// api/agencia.js
// Bot de Slack para consultar actividad en MeltingSpot por agencia
// Desplegado en Vercel (serverless)

const axios = require("axios");

// ─── Configuración (variables de entorno en Vercel) ───────────────────────────
const MELTINGSPOT_API_KEY = process.env.MELTINGSPOT_API_KEY;
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;

// ─── Leer agentes desde Google Sheets (acceso público de solo lectura) ────────
async function getAgentesDeAgencia(agencyId) {
  // Usamos la API pública de Google Sheets (CSV export, sin autenticación)
  const url = `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/gviz/tq?tqx=out:csv`;
  const response = await axios.get(url);
  const rows = parseCSV(response.data);

  // Filtrar por ID de agencia (columna ID_agencia)
  const agentes = rows.filter(
    (row) => row.ID_agencia && row.ID_agencia.trim().toLowerCase() === agencyId.trim().toLowerCase()
  );
  return agentes;
}

// ─── Parser simple de CSV ─────────────────────────────────────────────────────
function parseCSV(csvText) {
  const lines = csvText.trim().split("\n");
  if (lines.length < 2) return [];

  // Extraer cabeceras (primera fila), quitando comillas
  const headers = lines[0].split(",").map((h) => h.replace(/"/g, "").trim());

  return lines.slice(1).map((line) => {
    const values = line.split(",").map((v) => v.replace(/"/g, "").trim());
    const row = {};
    headers.forEach((h, i) => {
      row[h] = values[i] || "";
    });
    return row;
  });
}

// ─── Obtener actividad de MeltingSpot por email ───────────────────────────────
async function getActividadMeltingSpot(fechaInicio, fechaFin) {
  try {
    const params = {};
    if (fechaInicio) params.from = fechaInicio;
    if (fechaFin) params.to = fechaFin;

    const response = await axios.get(
      "https://openapi.meltingspot.io/v1/activities~export",
      {
        headers: {
          Authorization: `Bearer ${MELTINGSPOT_API_KEY}`,
          "Content-Type": "application/json",
        },
        params,
      }
    );
    return response.data;
  } catch (error) {
    console.error("Error MeltingSpot API:", error.response?.data || error.message);
    return null;
  }
}

// ─── Cruzar datos: filtrar actividad por email del agente ─────────────────────
function filtrarActividadPorEmail(actividades, email) {
  if (!actividades || !Array.isArray(actividades)) return null;

  // Buscar en el array de actividades el registro correspondiente a ese email
  return actividades.filter(
    (a) => a.email && a.email.toLowerCase() === email.toLowerCase()
  );
}

// ─── Formatear respuesta para Slack ──────────────────────────────────────────
function formatearRespuestaSlack(nombreAgencia, agentes, actividadTotal) {
  const bloques = [];

  // Cabecera
  bloques.push({
    type: "header",
    text: {
      type: "plain_text",
      text: `📊 Actividad en MeltingSpot — ${nombreAgencia}`,
      emoji: true,
    },
  });

  bloques.push({ type: "divider" });

  if (agentes.length === 0) {
    bloques.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "⚠️ No se encontraron agentes para esta agencia.",
      },
    });
    return { blocks: bloques };
  }

  // Sección por cada agente
  for (const agente of agentes) {
    const actividad = filtrarActividadPorEmail(actividadTotal, agente.email);

    // Calcular métricas del agente
    const metricas = calcularMetricas(actividad);

    bloques.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*👤 ${agente.nombre_agente || agente.email}*\n_${agente.email}_`,
      },
    });

    bloques.push({
      type: "section",
      fields: [
        {
          type: "mrkdwn",
          text: `*Última conexión*\n${metricas.ultimaConexion}`,
        },
        {
          type: "mrkdwn",
          text: `*Módulos completados*\n${metricas.modulosCompletados}`,
        },
        {
          type: "mrkdwn",
          text: `*Lives (directo + replay)*\n${metricas.lives}`,
        },
        {
          type: "mrkdwn",
          text: `*Páginas vistas*\n${metricas.paginasVistas}`,
        },
      ],
    });

    bloques.push({ type: "divider" });
  }

  // Resumen total
  bloques.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `Total agentes en la agencia: *${agentes.length}*`,
      },
    ],
  });

  return { blocks: bloques };
}

// ─── Calcular métricas a partir de los datos de actividad ────────────────────
function calcularMetricas(actividades) {
  if (!actividades || actividades.length === 0) {
    return {
      ultimaConexion: "Sin actividad",
      modulosCompletados: "0",
      lives: "0",
      paginasVistas: "0",
    };
  }

  // Última conexión: la fecha más reciente de cualquier actividad
  const fechas = actividades
    .map((a) => new Date(a.created_at || a.date || a.timestamp))
    .filter((d) => !isNaN(d));
  const ultimaFecha =
    fechas.length > 0
      ? new Date(Math.max(...fechas)).toLocaleDateString("es-ES")
      : "Desconocida";

  // Módulos completados
  const modulos = actividades.filter(
    (a) =>
      a.type === "module_completed" ||
      a.activity_type === "module_completed" ||
      (a.type || "").toLowerCase().includes("module")
  );

  // Lives vistos (directo o replay)
  const lives = actividades.filter(
    (a) =>
      a.type === "live_attended" ||
      a.type === "live_replay" ||
      a.activity_type === "live_attended" ||
      a.activity_type === "live_replay" ||
      (a.type || "").toLowerCase().includes("live")
  );

  // Páginas vistas
  const paginas = actividades.filter(
    (a) =>
      a.type === "page_view" ||
      a.activity_type === "page_view" ||
      (a.type || "").toLowerCase().includes("page")
  );

  return {
    ultimaConexion: ultimaFecha,
    modulosCompletados: modulos.length.toString(),
    lives: lives.length.toString(),
    paginasVistas: paginas.length.toString(),
  };
}

// ─── Parsear fecha desde texto libre ─────────────────────────────────────────
function parsearFecha(texto) {
  if (!texto) return null;
  // Acepta formatos: 2025-01-01, 01/01/2025, enero-2025, etc.
  const fecha = new Date(texto);
  if (!isNaN(fecha)) return fecha.toISOString().split("T")[0];
  return null;
}

// ─── Handler principal de Vercel ─────────────────────────────────────────────
module.exports = async function handler(req, res) {
  // Solo aceptar POST de Slack
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  try {
    const body = req.body;

    // Slack envía los datos como form-urlencoded
    // Vercel los parsea automáticamente si configuramos el Content-Type
    const agencyId = body.text ? body.text.trim().split(" ")[0] : null;
    const fechaInicioRaw = body.text ? body.text.trim().split(" ")[1] : null;
    const fechaFinRaw = body.text ? body.text.trim().split(" ")[2] : null;

    if (!agencyId) {
      return res.status(200).json({
        response_type: "ephemeral",
        text: "⚠️ Uso: `/agencia ID_AGENCIA [fecha_inicio] [fecha_fin]`\nEjemplo: `/agencia AG001 2025-01-01 2025-03-31`",
      });
    }

    // Respuesta inmediata a Slack (debe responder en < 3 segundos)
    // Usamos response_url para enviar la respuesta real después
    const responseUrl = body.response_url;

    // Enviar mensaje de "cargando" inmediatamente
    res.status(200).json({
      response_type: "in_channel",
      text: `⏳ Buscando actividad de la agencia *${agencyId}*...`,
    });

    // Procesar en background
    const fechaInicio = parsearFecha(fechaInicioRaw);
    const fechaFin = parsearFecha(fechaFinRaw);

    // 1. Obtener agentes de la agencia desde Google Sheets
    const agentes = await getAgentesDeAgencia(agencyId);

    if (agentes.length === 0) {
      await axios.post(responseUrl, {
        response_type: "in_channel",
        text: `❌ No se encontró ninguna agencia con ID *${agencyId}*. Revisa el ID en la hoja de agentes.`,
      });
      return;
    }

    const nombreAgencia = agentes[0].nombre_agencia || agencyId;

    // 2. Obtener toda la actividad de MeltingSpot para el periodo
    const actividadTotal = await getActividadMeltingSpot(fechaInicio, fechaFin);

    // 3. Formatear y enviar respuesta a Slack
    const respuesta = formatearRespuestaSlack(nombreAgencia, agentes, actividadTotal);
    respuesta.response_type = "in_channel";
    respuesta.replace_original = true;

    await axios.post(responseUrl, respuesta);
  } catch (error) {
    console.error("Error en el handler:", error);
    res.status(200).json({
      response_type: "ephemeral",
      text: "❌ Error interno al procesar la solicitud. Inténtalo de nuevo.",
    });
  }
};
