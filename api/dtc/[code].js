import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const MAX_NEW_CODES_PER_DAY = 50;
const MAX_NEW_DIAGRAMS_PER_DAY = 50;

function text(value) {
  return String(value ?? "").trim();
}

function lower(value) {
  return text(value).toLowerCase();
}

function upper(value) {
  return text(value).toUpperCase();
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

/* =========================
   OPENROUTER
========================= */

async function askAI(prompt) {
  const key = process.env.OPENROUTER_API_KEY;

  if (!key) {
    throw new Error("Falta OPENROUTER_API_KEY en Vercel.");
  }

  const response = await fetch(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://scanner-dtc.vercel.app",
        "X-Title": "Scanner DTC Automotriz"
      },
      body: JSON.stringify({
        model: "openrouter/free",
        messages: [
          {
            role: "system",
            content:
              "Eres especialista en diagnóstico automotriz. Responde siempre en español."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.2,
        max_tokens: 2500
      })
    }
  );

  const raw = await response.text();

  if (!response.ok) {
    console.error("OPENROUTER:", raw);
    throw new Error("OpenRouter no pudo generar la información.");
  }

  let data;

  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("OpenRouter devolvió una respuesta inválida.");
  }

  let content = data?.choices?.[0]?.message?.content;

  if (Array.isArray(content)) {
    content = content
      .map(x => typeof x === "string" ? x : x?.text || "")
      .join("");
  }

  if (!content) {
    throw new Error("La IA no devolvió información.");
  }

  content = String(content)
    .replace(/^```json/i, "")
    .replace(/^```/i, "")
    .replace(/```$/i, "")
    .trim();

  const first = content.indexOf("{");
  const last = content.lastIndexOf("}");

  if (first !== -1 && last !== -1) {
    content = content.substring(first, last + 1);
  }

  try {
    return JSON.parse(content);
  } catch {
    console.error("JSON IA:", content);
    throw new Error("La IA devolvió JSON inválido.");
  }
}

/* =========================
   CONTAR REGISTROS DE HOY
========================= */

async function countToday(table) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  const { count, error } = await supabase
    .from(table)
    .select("id", {
      count: "exact",
      head: true
    })
    .gte("created_at", start.toISOString());

  if (error) {
    console.error(error);
    throw new Error("No se pudo comprobar el límite diario.");
  }

  return count || 0;
}

/* =========================
   RESPUESTA DTC
========================= */

function sendDTC(res, item, source) {
  return res.status(200).json({
    success: true,
    source,
    saved: true,
    code: item.code,
    make: item.make,
    title: item.title,
    problem: item.problem,
    causes: array(item.causes),
    symptoms: array(item.symptoms),
    diagnosis: array(item.diagnosis),
    repairs: array(item.repairs),
    severity: item.severity || "MEDIA",
    vehicle_years: item.vehicle_years || "No especificado",
    system: item.system || "No especificado"
  });
}

/* =========================
   DTC
========================= */

async function handleDTC(req, res) {
  const code = upper(req.query.code);
  const make = lower(req.query.make || "genérica");

  if (!code) {
    return res.status(400).json({
      success: false,
      error: "Falta el código DTC."
    });
  }

  if (!/^[PBCU][0-9A-F]{4}$/.test(code)) {
    return res.status(400).json({
      success: false,
      error: "Código DTC inválido. Ejemplo: P0300."
    });
  }

  /* Buscar primero */

  const { data, error } = await supabase
    .from("dtc_codes")
    .select("*")
    .eq("code", code)
    .limit(1);

  if (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      error: "Error consultando Supabase.",
      details: error.message
    });
  }

  if (data?.length) {
    return sendDTC(res, data[0], "supabase");
  }

  /* Límite */

  const used = await countToday("dtc_codes");

  if (used >= MAX_NEW_CODES_PER_DAY) {
    return res.status(429).json({
      success: false,
      error: "Se alcanzó el límite de 50 códigos nuevos por día."
    });
  }

  /* Generar */

  const prompt = `
Genera información técnica automotriz para:

Código DTC: ${code}
Marca: ${make}

Devuelve ÚNICAMENTE JSON válido.

{
  "code": "${code}",
  "make": "${make}",
  "title": "nombre del código",
  "problem": "explicación clara del problema",
  "causes": ["causa 1", "causa 2"],
  "symptoms": ["síntoma 1", "síntoma 2"],
  "diagnosis": ["paso 1", "paso 2"],
  "repairs": ["reparación 1", "reparación 2"],
  "severity": "MEDIA",
  "vehicle_years": "No especificado",
  "system": "sistema relacionado"
}

Reglas:
- Responde en español.
- No inventes números de piezas.
- No inventes pines.
- No inventes colores de cables.
- Las causas son posibles causas.
- El diagnóstico debe ser razonable.
- severity solamente puede ser BAJA, MEDIA, ALTA o CRÍTICA.
`;

  let item;

  try {
    item = await askAI(prompt);
  } catch (error) {
    return res.status(502).json({
      success: false,
      error: error.message
    });
  }

  item.code = upper(item.code || code);
  item.make = lower(item.make || make);
  item.title = text(item.title || "Código DTC");
  item.problem = text(
    item.problem || "No hay información disponible."
  );

  item.causes = array(item.causes);
  item.symptoms = array(item.symptoms);
  item.diagnosis = array(item.diagnosis);
  item.repairs = array(item.repairs);

  const severities = [
    "BAJA",
    "MEDIA",
    "ALTA",
    "CRÍTICA"
  ];

  item.severity = severities.includes(
    upper(item.severity)
  )
    ? upper(item.severity)
    : "MEDIA";

  item.vehicle_years = text(
    item.vehicle_years || "No especificado"
  );

  item.system = text(
    item.system || "No especificado"
  );

  /* Guardar */

  const { error: saveError } = await supabase
    .from("dtc_codes")
    .insert({
      code: item.code,
      make: item.make,
      title: item.title,
      problem: item.problem,
      causes: item.causes,
      symptoms: item.symptoms,
      diagnosis: item.diagnosis,
      repairs: item.repairs,
      severity: item.severity,
      vehicle_years: item.vehicle_years,
      system: item.system,
      source: "openrouter"
    });

  if (saveError) {
    console.error("DTC SAVE:", saveError);

    /* Puede haberse guardado mientras se generaba */

    const { data: existing } = await supabase
      .from("dtc_codes")
      .select("*")
      .eq("code", item.code)
      .limit(1);

    if (existing?.length) {
      return sendDTC(res, existing[0], "supabase");
    }

    return res.status(500).json({
      success: false,
      error: "La información se generó pero no pudo guardarse.",
      details: saveError.message
    });
  }

  return sendDTC(res, item, "openrouter");
}

/* =========================
   DIAGRAMA
========================= */

async function handleDiagram(req, res) {
  const make = text(req.query.make);
  const model = text(req.query.model);
  const year = text(req.query.year);
  const system = text(req.query.system);

  if (!make || !model || !year || !system) {
    return res.status(400).json({
      success: false,
      error: "Completa marca, modelo, año y sistema."
    });
  }

  /* Buscar */

  const { data, error } = await supabase
    .from("dtc_diagrams")
    .select("*")
    .eq("make", make)
    .eq("model", model)
    .eq("vehicle_year", year)
    .eq("system", system)
    .limit(1);

  if (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      error: "Error buscando el diagrama.",
      details: error.message
    });
  }

  if (data?.length) {
    return res.status(200).json({
      success: true,
      source: "supabase",
      saved: true,
      make: data[0].make,
      model: data[0].model,
      year: data[0].vehicle_year,
      system: data[0].system,
      title: data[0].title,
      description: data[0].description,
      components: array(data[0].components),
      connections: array(data[0].connections),
      warnings: array(data[0].warnings)
    });
  }

  /* Límite */

  const used = await countToday("dtc_diagrams");

  if (used >= MAX_NEW_DIAGRAMS_PER_DAY) {
    return res.status(429).json({
      success: false,
      error: "Se alcanzó el límite de 50 diagramas nuevos por día."
    });
  }

  /* IA */

  const prompt = `
Crea un DIAGRAMA AUTOMOTRIZ EDUCATIVO.

Vehículo:
Marca: ${make}
Modelo: ${model}
Año: ${year}
Sistema: ${system}

Devuelve ÚNICAMENTE JSON válido:

{
  "title": "string",
  "description": "string",
  "components": [
    {
      "id": "ecu",
      "name": "ECU / PCM",
      "type": "control"
    }
  ],
  "connections": [
    {
      "from": "ecu",
      "to": "sensor",
      "label": "Señal"
    }
  ],
  "warnings": [
    "Información orientativa."
  ]
}

Reglas:
- Español.
- Entre 3 y 12 componentes.
- Los IDs de connections deben existir en components.
- No inventes colores de cables.
- No inventes números de pines.
- No inventes voltajes específicos.
- No presentes información no confirmada como exacta.
- El diagrama es educativo y orientativo.

Tipos permitidos:
control
sensor
actuator
power
ground
connector
module
other
`;

  let diagram;

  try {
    diagram = await askAI(prompt);
  } catch (error) {
    return res.status(502).json({
      success: false,
      error: error.message
    });
  }

  diagram.title = text(
    diagram.title || `Diagrama ${system}`
  );

  diagram.description = text(
    diagram.description ||
    `Diagrama orientativo del sistema ${system}.`
  );

  diagram.components = array(diagram.components);
  diagram.connections = array(diagram.connections);
  diagram.warnings = array(diagram.warnings);

  const { error: saveError } = await supabase
    .from("dtc_diagrams")
    .insert({
      make,
      model,
      vehicle_year: year,
      system,
      title: diagram.title,
      description: diagram.description,
      components: diagram.components,
      connections: diagram.connections,
      warnings: diagram.warnings,
      source: "openrouter"
    });

  if (saveError) {
    console.error("DIAGRAM SAVE:", saveError);

    return res.status(500).json({
      success: false,
      error: "El diagrama se generó pero no pudo guardarse.",
      details: saveError.message
    });
  }

  return res.status(200).json({
    success: true,
    source: "openrouter",
    saved: true,
    make,
    model,
    year,
    system,
    title: diagram.title,
    description: diagram.description,
    components: diagram.components,
    connections: diagram.connections,
    warnings: diagram.warnings
  });
}

/* =========================
   HANDLER
========================= */

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({
        success: false,
        error: "Método no permitido."
      });
    }

    /*
      /api/dtc?type=diagram
      = DIAGRAMA

      /api/dtc?code=P0300
      = DTC
    */

    if (String(req.query.type).toLowerCase() === "diagram") {
      return await handleDiagram(req, res);
    }

    return await handleDTC(req, res);

  } catch (error) {
    console.error("API ERROR:", error);

    return res.status(500).json({
      success: false,
      error: "Error interno del servidor.",
      details: error.message
    });
  }
  }
