const http = require("http");
const axios = require("axios");

const MELTINGSPOT_API_KEY = process.env.MELTINGSPOT_API_KEY;
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const PORT = process.env.PORT || 3000;

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
    const url = `https://openapi.meltingspot.io/v1/activities~export?fromDate[eq]=${fromTimestamp}&limit=500`;
    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${MELTINGSPOT_API_KEY}` },
      timeout: 25000,
    });
    const data = response.data;
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.data)) return data.data;
    if (data && Array.isArray(data.items)) return data.items;
    if (data && Array.isArray(data.activities)) return data.activities;
    return [];
  } catch (error) {
    console.error("Error MeltingSpot:", error.response?.status, JSON.stringify(error.response?.data), error.message);
    return null;
  }
}

function filtrarPorEmail(actividades, email) {
  if (!actividades || !Array.isArray(actividades)) return [];
  return actividades.filter((a) =>
    (a.member_email || a.email || "").toLowerCase() === email.toLowerCase()
  );
}

function calcularMetricas(actividades) {
  if (!actividades || actividades.length === 0) {
    return { ultimaConexion: "Sin actividad", modulos: 0, lives: 0, paginas: 0 };
  }
  const fechas = actividades
    .map((a) => new Date(a.occurred_at_tz || a.created_at || a.date || a.timestamp))
    .filter((d) => !isNaN(d));
  const ultimaConexion = fechas.length > 0
    ? new Date(Math.max(...fechas)).toLocaleDateString("es-ES")
    : "Desconocida";
  const modulos = actividades.filter((a) =>
    ["CourseCompleted", "CourseStepCompleted", "LearningPathCompleted"].includes(a.type || a.eventType || "")
  ).length;
  const lives = actividades.filter((a) =>
    ["LiveAttended", "LiveReplayWatched"].includes(a.type || a.eventType || "")
  ).length;
  const paginas = actividades.filter((a) =>
    ["DocumentPageViewed"].includes(a.type || a.eventType || "")
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
    bloques.push({ type: "section", text: { type: "mrkdwn", text: `⚠️ No se pudieron obtener datos de MeltingSpot.` } });
    return { blocks: bloques };
  }
  for (const agente of agentes) {
    const actividad = filtrarPorEmail(actividadTotal, agente.email);
    const m = calcularMetricas(actividad);
    bloques.push({ type: "section", text: { type: "mrkdwn", text: `*👤 ${agente.nombre_agente || agente.email}*\n_${agente.email}_` } });
    bloques.push({ type: "section", fields: [
      { type: "mrkdwn", text: `*Última conexión*\n${m.ultimaConexion}` },
      { type: "mrkdwn", text: `*Módulos completados*\n${m.modulos}` },
      { type: "mrkdwn", text: `*Lives vistos*\n${m.lives}` },
      { type: "mrkdwn", text: `*Páginas vistas*\n${m.paginas}` },
    ]});
    bloques.push({ type: "divider" });
  }
  bloques.push({ type: "context", elements: [{ type: "mrkdwn", text: `Total agentes: *${agentes.length}* | ID: ${agencyId}` }] });
  return { blocks: bloques };
}

function parseBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk.toString(); });
    req.on("end", () => {
      resolve(Object.fromEntries(new URLSearchParams(body)));
    });
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", message: "MeltingSpot Bot funcionando" }));
    return;
  }

  if (req.method !== "POST" || req.url !== "/api/agencia") {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Método no permitido" }));
    return;
  }

  const body = await parseBody(req);
  const text = (body.text || "").trim();
  const parts = text.split(/\s+/);
  const agencyId = parts[0];
  const responseUrl = body.response_url;

  let fromTimestamp;
  if (parts[1]) {
    const fecha = new Date(parts[1]);
    if (!isNaN(fecha)) fromTimestamp = Math.floor(fecha.getTime() / 1000);
  }
  if (!fromTimestamp) {
    const hace3meses = new Date();
    hace3meses.setMonth(hace3meses.getMonth() - 3);
    fromTimestamp = Math.floor(hace3meses.getTime() / 1000);
  }

  if (!agencyId) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      response_type: "ephemeral",
      text: "⚠️ Uso: `/agencia ID_AGENCIA [fecha_inicio]`\nEjemplo: `/agencia 69237 2025-01-01`",
    }));
    return;
  }

  // Responder a Slack inmediatamente
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({
    response_type: "in_channel",
    text: `⏳ Buscando actividad de la agencia *${agencyId}*...`,
  }));

  // Procesar en background y enviar resultado via response_url
  try {
    const [agentes, actividadTotal] = await Promise.all([
      getAgentesDeAgencia(agencyId),
      getActividadMeltingSpot(fromTimestamp),
    ]);
    console.log(`Agentes: ${agentes.length}, Actividades: ${actividadTotal ? actividadTotal.length : 0}`);
    const nombreAgencia = agentes.length > 0 ? agentes[0].nombre_agencia : agencyId;
    const respuesta = construirRespuesta(nombreAgencia, agencyId, agentes, actividadTotal);
    await axios.post(responseUrl, { response_type: "in_channel", replace_original: true, ...respuesta });
  } catch (error) {
    console.error("Error:", error.message);
    try {
      await axios.post(responseUrl, {
        response_type: "in_channel",
        replace_original: true,
        text: `❌ Error al obtener datos de *${agencyId}*. Inténtalo de nuevo.`,
      });
    } catch (e) {}
  }
});

server.listen(PORT, () => {
  console.log(`Bot escuchando en puerto ${PORT}`);
});
