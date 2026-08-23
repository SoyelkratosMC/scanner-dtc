import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const MAX_DTC_PER_DAY = 50;
const MAX_DIAGRAMS_PER_DAY = 50;

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

function jsonFromAI(content) {
  if (!content) {
    throw new Error("La IA no devolvió información.");
  }

  let result = String(content).trim();

  result = result
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const first = result.indexOf("{");
  const last = result.lastIndexOf("}");

  if (first !== -1 && last !== -1) {
    result = result.slice(first, last + 1);
  }

  try {
    return JSON.parse(result);
  } catch {
    console.error("JSON IA:", result);
    throw new Error("La IA devolvió JSON inválido.");
  }
}

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
              "Eres especialista automotriz. Responde siempre en español."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.2,
        max_tokens: 2200
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

  return jsonFromAI(content);
}

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
    console.error("COUNT:", error);
    throw new Error("No se pudo comprobar el límite diario.");
  }

  return count || 0;
}

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

async function handleDTC(req, res) {
  const code = upper(req.query.code);
  const make = lower(req.query.make || "genérica");

  if (!/^[PBCU][0-9A-F]{4}$/.test(code)) {
    return res.status(400).json({
      success: false,
      error: "Código DTC inválido."
    });
  }

  const { data, error } = await supabase
    .from("dtc_codes")
    .select("*")
    .eq("code", code)
    .limit(1);

  if (error) {
    console.error("SUPABASE DTC:", error);

    return res.status(500).json({
      success: false,
      error: "Error consultando Supabase.",
      details: error.message
    });
  }

  if (data?.length) {
    return sendDTC(res, data[0], "supabase");
  }

  const used = await countToday("dtc_codes");

  if (used >= MAX_DTC_PER_DAY) {
    return res.status(429).json({
      success: false,
      error: "Se alcanzó el límite de 50 códigos nuevos hoy."
    });
  }

  const prompt = `
Genera información automotriz para el código DTC ${code}.

Marca: ${make}

Devuelve SOLO JSON válido:

{
  "code": "${code}",
  "make": "${make}",
  "title": "nombre del código",
  "problem": "explicación",
  "causes": ["causa 1", "causa 2"],
  "symptoms": ["síntoma 1", "síntoma 2"],
  "diagnosis": ["prueba 1", "prueba 2"],
  "repairs": ["reparación 1", "reparación 2"],
  "severity": "MEDIA",
  "vehicle_years": "No especificado",
  "system": "sistema"
}

severity solamente:
BAJA, MEDIA, ALTA, CRÍTICA.

No inventes números de piezas, pines, voltajes ni años específicos.
Si depende del fabricante, indícalo.
Responde en español.
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

  const severity = upper(item.severity);

  item.severity = [
    "BAJA",
    "MEDIA",
    "ALTA",
    "CRÍTICA"
  ].includes(severity)
    ? severity
    : "MEDIA";

  item.vehicle_years = text(
    item.vehicle_years || "No especificado"
  );

  item.system = text(
    item.system || "No especificado"
  );

  const { error: insertError } = await supabase
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

  if (insertError) {
    console.error("INSERT DTC:", insertError);

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
      error: "No se pudo guardar el código.",
      details: insertError.message
    });
  }

  return sendDTC(res, item, "openrouter");
}

function sendDiagram(res, item, source) {
  return res.status(200).json({
    success: true,
    source,
    saved: true,
    make: item.make,
    model: item.model,
    year: item.vehicle_year,
    system: item.system,
    title: item.title,
    description: item.description,
    components: array(item.components),
    connections: array(item.connections),
    warnings: array(item.warnings)
  });
}

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

  const { data, error } = await supabase
    .from("dtc_diagrams")
    .select("*")
    .eq("make", make)
    .eq("model", model)
    .eq("vehicle_year", year)
    .eq("system", system)
    .limit(1);

  if (error) {
    console.error("SUPABASE DIAGRAM:", error);

    return res.status(500).json({
      success: false,
      error: "Error buscando el diagrama.",
      details: error.message
    });
  }

  if (data?.length) {
    return sendDiagram(res, data[0], "supabase");
  }

  const used = await countToday("dtc_diagrams");

  if (used >= MAX_DIAGRAMS_PER_DAY) {
    return res.status(429).json({
      success: false,
      error: "Se alcanzó el límite de 50 diagramas nuevos hoy."
    });
  }

  const prompt = `
Crea un diagrama automotriz EDUCATIVO.

Marca: ${make}
Modelo: ${model}
Año: ${year}
Sistema: ${system}

Devuelve SOLO JSON válido:

{
  "title": "Diagrama del sistema",
  "description": "Descripción educativa",
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
    "Verificar el diagrama específico del vehículo."
  ]
}

Entre 3 y 12 componentes.

Tipos permitidos:
control
sensor
actuator
power
ground
connector
module
other

Las conexiones deben utilizar IDs existentes.

NO inventes colores de cables, números de pines,
voltajes exactos ni números de piezas.

Responde en español.
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

  item.title = text(
    item.title || `Diagrama ${system}`
  );

  item.description = text(
    item.description ||
    `Diagrama educativo del sistema ${system}.`
  );

  item.components = array(item.components);
  item.connections = array(item.connections);
  item.warnings = array(item.warnings);

  const { error: insertError } = await supabase
    .from("dtc_diagrams")
    .insert({
      make,
      model,
      vehicle_year: year,
      system,
      title: item.title,
      description: item.description,
      components: item.components,
      connections: item.connections,
      warnings: item.warnings,
      source: "openrouter"
    });

  if (insertError) {
    console.error("INSERT DIAGRAM:", insertError);

    return res.status(500).json({
      success: false,
      error: "No se pudo guardar el diagrama.",
      details: insertError.message
    });
  }

  return sendDiagram(
    res,
    {
      ...item,
      make,
      model,
      vehicle_year: year,
      system
    },
    "openrouter"
  );
}

export default async function handler(req, res) {
  try {
    const action = text(req.query.action).toLowerCase();

    if (action === "diagram") {
      return await handleDiagram(req, res);
    }

    return await handleDTC(req, res);

  } catch (error) {
    console.error("API ERROR:", error);

    return res.status(500).json({
      success: false,
      error: error.message || "Error interno del servidor."
    });
  }
}
