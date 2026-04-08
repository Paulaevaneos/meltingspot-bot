// api/agencia.js
const axios = require("axios");

const MELTINGSPOT_API_KEY = process.env.MELTINGSPOT_API_KEY;
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;

async function getAgentesDeAgencia(agencyId) {
  const url = `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/gviz/tq?tqx=out:csv`;
  const response = await axios.get(url, { timeout: 8000 });
  const rows = parseCSV(response.data);
  return rows.filter(
    (row) => row.ID_agencia && row.ID_agencia.trim().toLowerCase() === agencyId.trim().toLowerCase()
  );
}

function parseCSV(csvText) {
  const lines = csvText.trim().split("\n");
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.replace(/"/g, "").trim());
  return lines.slice(1).map((line) => {
    const values = line.split(",").map((v) => v.replace(/"/g, "").trim());
    const row = {};
    headers.forEach((h, i) => { row[h] = values[i] || ""; });
    return row;
  });
}

async function getActividadMeltingSpot(fromTimestamp) {
  try {
    const response = await axios.get(
      "https://openapi.meltingspot.io/v1/activities~export",
      {
        headers: { Authorization: `Bearer ${MELTINGSPOT_API_KEY}` },
        // fromDate debe ser un timestamp Unix (número entero en segundos)
        params: { fromDate: fromTimestamp },
        timeout: 20000,
      }
    );
    const data = response.data;
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.data)) return data.data;
    if (data && Array.isArray(data.activities)) return data.activities;
    return [];
  } catch (error) {
    console.error("Error MeltingSpot:", error.response?.status, JSON.stringify(error.response?.data), error.message);
    return null;
  }
}

function filtrarPorEmail(actividades, email) {
  if (!actividades || !Array.isArray(actividades)) return [];
  return actividades.filter((a) => a.email && a.email.toLowerCase() === email.toLowerCase());
}

function calcularMetricas(actividades) {
  if (!actividades || actividades.length === 0) {
    return { ultimaConexion: "Sin actividad", modulos: 0, lives: 0, paginas: 0 };
  }
  const fechas = actividades
    .map((a) => new Date(a.created_at || a.date || a.timestamp || a.createdAt))
    .filter((d) => !isNaN(d));
  const ultimaConexion = fechas.length > 0
    ? new Date(Math.max(...fechas)).toLocaleDateString("es-ES")
    : "Desconocida";
  const modulos = actividades.filter((a) =>
    (a.type || a.activity_type || a.eventType || "").toLowerCase().includes("module")
  ).length;
  const lives = actividades.filter((a) =>
    (a.type || a.activity_type || a.eventType || "").toLowerCase().includes("live")
  ).length;
  const paginas = actividades.filter((a) =>
    (a.type || a.activity_type || a.eventType || "").toLowerCase().includes("page")
  ).length;
  return { ultimaConexion, modulos, lives, paginas };
}

function construirRespuesta(nombreAgencia, agencyId, agentes, actividadTotal) {
  const bloques = [];
  bloques.push({ type: "header", text: { type: "plain_text", text: `📊 MeltingSpot — ${nombreAgencia}`, emoji: true } });
  bloques.push({ type: "divider" });

  if (agentes.length === 0) {
    bloques.push({ type: "section", text: { type: "mrkdwn", text: `⚠️ No se encontraron agentes para el ID *${agencyId}*.\nRevisa el ID en la Google Sheet.` } });
    return { blocks: bloques };
  }

  if (!actividadTotal) {
    bloques.push({ type: "section", text: { type: "mrkdwn", text: `⚠️ No se pudieron obtener datos de MeltingSpot. Inténtalo de nuevo.` } });
    return { blocks: bloques };
  }

  for (const agente of agentes) {
    const actividad = filtrarPorEmail(actividadTotal, agente.email);
    const m = calcularMetricas(actividad);
    bloques.push({ type: "section", text: { type: "mrkdwn", text: `*👤 ${agente.nombre_agente || agente.email}*\n_${agente.email}_` } });
    bloques.push({
      type: "section", fields: [
        { type: "mrkdwn", text: `*Última conexión*\n${m.ultimaConexion}` },
        { type: "mrkdwn", text: `*Módulos completados*\n${m.modulos}` },
        { type: "mrkdwn", text: `*Lives vistos*\n${m.lives}` },
        { type: "mrkdwn", text: `*Páginas vistas*\n${m.paginas}` },
      ]
    });
    bloques.push({ type: "divider" });
  }

  bloques.push({ type: "context", elements: [{ type: "mrkdwn", text: `Total agentes: *${agentes.length}* | ID agencia: ${agencyId}` }] });
  return { blocks: bloques };
}

// Convierte YYYY-MM-DD o texto libre a timestamp Unix en segundos
function parsearATimestamp(texto) {
  if (!texto) return null;
  const fecha = new Date(texto);
  if (!isNaN(fecha)) return Math.floor(fecha.getTime() / 1000);
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  let body = req.body;
  if (typeof body === "string") {
    body = Object.fromEntries(new URLSearchParams(body));
  }

  const text = (body.text || "").trim();
  const parts = text.split(/\s+/);
  const agencyId = parts[0];
  const responseUrl = body.response_url;

  // Por defecto: últimos 3 meses en timestamp Unix
  let fromTimestamp;
  if (parts[1]) {
    fromTimestamp = parsearATimestamp(parts[1]);
  }
  if (!fromTimestamp) {
    const hace3meses = new Date();
    hace3meses.setMonth(hace3meses.getMonth() - 3);
    fromTimestamp = Math.floor(hace3meses.getTime() / 1000);
  }

  if (!agencyId) {
    return res.status(200).json({
      response_type: "ephemeral",
      text: "⚠️ Uso: `/agencia ID_AGENCIA [fecha_inicio]`\nEjemplo: `/agencia 69237 2025-01-01`\nSi no pones fecha, se usan los últimos 3 meses.",
    });
  }

  // Responder a Slack inmediatamente (obligatorio en < 3 seg)
  res.status(200).json({
    response_type: "in_channel",
    text: `⏳ Buscando actividad de la agencia *${agencyId}*...`,
  });

  // Procesar y enviar resultado via response_url
  try {
    const [agentes, actividadTotal] = await Promise.all([
      getAgentesDeAgencia(agencyId),
      getActividadMeltingSpot(fromTimestamp),
    ]);

    const nombreAgencia = agentes.length > 0 ? agentes[0].nombre_agencia : agencyId;
    const respuesta = construirRespuesta(nombreAgencia, agencyId, agentes, actividadTotal);

    await axios.post(responseUrl, { response_type: "in_channel", replace_original: true, ...respuesta });
  } catch (error) {
    console.error("Error general:", error.message);
    try {
      await axios.post(responseUrl, {
        response_type: "in_channel",
        replace_original: true,
        text: `❌ Error al obtener datos de *${agencyId}*. Inténtalo de nuevo.`,
      });
    } catch (e) {}
  }
};
