import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const MAX_NEW_CODES_PER_DAY = 50;
const MAX_NEW_DIAGRAMS_PER_DAY = 50;

/* =====================================================
   UTILIDADES
===================================================== */

function text(value, fallback = "") {
  if (value === null || value === undefined) return fallback;

  if (typeof value === "object") {
    if (value.message) return String(value.message);
    if (value.error) return String(value.error);

    try {
      return JSON.stringify(value);
    } catch {
      return fallback;
    }
  }

  return String(value).trim() || fallback;
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

function sendError(res, status, error, extra = {}) {
  return res.status(status).json({
    success: false,
    error: text(error, "Error desconocido."),
    ...extra
  });
}

function parseAI(content) {
  if (!content) {
    throw new Error("La IA no devolvió contenido.");
  }

  if (typeof content === "object") {
    return content;
  }

  let value = String(content).trim();

  value = value
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const first = value.indexOf("{");
  const last = value.lastIndexOf("}");

  if (first !== -1 && last !== -1 && last > first) {
    value = value.slice(first, last + 1);
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    console.error("JSON IA INVALIDO:", value);

    throw new Error(
      "La IA devolvió información que no es JSON válido."
    );
  }
}

/* =====================================================
   OPENROUTER
===================================================== */

async function askAI(prompt) {
  const key = process.env.OPENROUTER_API_KEY;

  if (!key) {
    throw new Error(
      "Falta configurar OPENROUTER_API_KEY en Vercel."
    );
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
              "Eres especialista automotriz. Responde siempre en español y devuelve JSON válido."
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
    let message = "OpenRouter rechazó la solicitud.";

    try {
      const errorJSON = JSON.parse(raw);

      message =
        errorJSON?.error?.message ||
        errorJSON?.error ||
        message;
    } catch {}

    throw new Error(text(message));
  }

  let json;

  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(
      "OpenRouter devolvió una respuesta inválida."
    );
  }

  let content =
    json?.choices?.[0]?.message?.content;

  if (Array.isArray(content)) {
    content = content
      .map(item =>
        typeof item === "string"
          ? item
          : item?.text || ""
      )
      .join("");
  }

  if (!content) {
    throw new Error(
      "OpenRouter no devolvió contenido."
    );
  }

  return parseAI(content);
}

/* =====================================================
   CONTAR REGISTROS DEL DÍA
===================================================== */

async function countToday(table) {
  const start = new Date();

  start.setHours(0, 0, 0, 0);

  const result = await supabase
    .from(table)
    .select("id", {
      count: "exact",
      head: true
    })
    .gte("created_at", start.toISOString());

  if (result.error) {
    console.error("COUNT ERROR:", result.error);

    throw new Error(
      "No se pudo comprobar el límite diario: " +
      text(result.error)
    );
  }

  return result.count || 0;
}

/* =====================================================
   DEVOLVER DTC
===================================================== */

function dtcResponse(res, item, source) {
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

    vehicle_years:
      item.vehicle_years || "No especificado",

    system:
      item.system || "No especificado"
  });
}

/* =====================================================
   BUSCAR / CREAR DTC
===================================================== */

async function handleDTC(req, res) {
  const code = upper(req.query.code);
  const make = lower(req.query.make);

  if (!code) {
    return sendError(
      res,
      400,
      "Falta el código DTC."
    );
  }

  if (!/^[PBCU][0-9A-F]{4}$/.test(code)) {
    return sendError(
      res,
      400,
      "Código DTC inválido. Ejemplos válidos: P2122, P2123 o P0300."
    );
  }

  /* BUSCAR EN SUPABASE */

  const result = await supabase
    .from("dtc_codes")
    .select("*")
    .eq("code", code)
    .limit(1);

  if (result.error) {
    console.error("DTC SEARCH:", result.error);

    return sendError(
      res,
      500,
      "Error consultando Supabase.",
      {
        details: text(result.error)
      }
    );
  }

  if (result.data && result.data.length > 0) {
    return dtcResponse(
      res,
      result.data[0],
      "supabase"
    );
  }

  /* LÍMITE */

  let count;

  try {
    count = await countToday("dtc_codes");
  } catch (error) {
    return sendError(
      res,
      500,
      error
    );
  }

  if (count >= MAX_NEW_CODES_PER_DAY) {
    return sendError(
      res,
      429,
      "Se alcanzó el límite de 50 códigos nuevos por día."
    );
  }

  /* GENERAR */

  const prompt = `
Genera información automotriz para este código DTC.

Código: ${code}
Marca: ${make || "genérica"}

Devuelve SOLO JSON.

{
  "code": "${code}",
  "make": "${make || "genérica"}",
  "title": "string",
  "problem": "string",
  "causes": [],
  "symptoms": [],
  "diagnosis": [],
  "repairs": [],
  "severity": "MEDIA",
  "vehicle_years": "No especificado",
  "system": "string"
}

severity debe ser:
BAJA, MEDIA, ALTA o CRÍTICA.

No inventes números de piezas,
pines, colores de cables ni datos específicos
que no puedas confirmar.
`;

  let dtc;

  try {
    dtc = await askAI(prompt);
  } catch (error) {
    console.error("AI DTC:", error);

    return sendError(
      res,
      502,
      error
    );
  }

  dtc.code = upper(dtc.code || code);
  dtc.make = lower(dtc.make || make || "genérica");

  dtc.title = text(
    dtc.title,
    "Código DTC"
  );

  dtc.problem = text(
    dtc.problem,
    "No hay información disponible."
  );

  dtc.causes = array(dtc.causes);
  dtc.symptoms = array(dtc.symptoms);
  dtc.diagnosis = array(dtc.diagnosis);
  dtc.repairs = array(dtc.repairs);

  const severities = [
    "BAJA",
    "MEDIA",
    "ALTA",
    "CRÍTICA"
  ];

  const severity =
    upper(dtc.severity);

  dtc.severity =
    severities.includes(severity)
      ? severity
      : "MEDIA";

  dtc.vehicle_years = text(
    dtc.vehicle_years,
    "No especificado"
  );

  dtc.system = text(
    dtc.system,
    "No especificado"
  );

  /* GUARDAR */

  const saved = await supabase
    .from("dtc_codes")
    .insert({
      code: dtc.code,
      make: dtc.make,

      title: dtc.title,
      problem: dtc.problem,

      causes: dtc.causes,
      symptoms: dtc.symptoms,
      diagnosis: dtc.diagnosis,
      repairs: dtc.repairs,

      severity: dtc.severity,

      vehicle_years:
        dtc.vehicle_years,

      system:
        dtc.system,

      source: "openrouter"
    })
    .select()
    .limit(1);

  if (saved.error) {
    console.error(
      "DTC INSERT:",
      saved.error
    );

    /*
    Puede haber sido guardado
    simultáneamente.
    */

    const again = await supabase
      .from("dtc_codes")
      .select("*")
      .eq("code", code)
      .limit(1);

    if (
      again.data &&
      again.data.length > 0
    ) {
      return dtcResponse(
        res,
        again.data[0],
        "supabase"
      );
    }

    return sendError(
      res,
      500,
      "La IA generó el código, pero Supabase no pudo guardarlo.",
      {
        details: text(saved.error)
      }
    );
  }

  return dtcResponse(
    res,
    saved.data?.[0] || dtc,
    "openrouter"
  );
}

/* =====================================================
   DEVOLVER DIAGRAMA
===================================================== */

function diagramResponse(
  res,
  item,
  source
) {
  return res.status(200).json({
    success: true,

    source,

    saved: true,

    make: item.make,
    model: item.model,

    year: item.vehicle_year,

    system: item.system,

    title: item.title,

    description:
      item.description,

    components:
      array(item.components),

    connections:
      array(item.connections),

    warnings:
      array(item.warnings)
  });
}

/* =====================================================
   BUSCAR / CREAR DIAGRAMA
===================================================== */

async function handleDiagram(req, res) {
  const make =
    text(req.query.make);

  const model =
    text(req.query.model);

  const year =
    text(req.query.year);

  const system =
    text(req.query.system);

  if (!make || !model || !year || !system) {
    return sendError(
      res,
      400,
      "Completa marca, modelo, año y sistema."
    );
  }

  /* BUSCAR */

  const result = await supabase
    .from("dtc_diagrams")
    .select("*")
    .eq("make", make)
    .eq("model", model)
    .eq("vehicle_year", year)
    .eq("system", system)
    .limit(1);

  if (result.error) {
    console.error(
      "DIAGRAM SEARCH:",
      result.error
    );

    return sendError(
      res,
      500,
      "Error buscando el diagrama.",
      {
        details: text(result.error)
      }
    );
  }

  if (
    result.data &&
    result.data.length > 0
  ) {
    return diagramResponse(
      res,
      result.data[0],
      "supabase"
    );
  }

  /* LÍMITE */

  let count;

  try {
    count =
      await countToday(
        "dtc_diagrams"
      );
  } catch (error) {
    return sendError(
      res,
      500,
      error
    );
  }

  if (
    count >=
    MAX_NEW_DIAGRAMS_PER_DAY
  ) {
    return sendError(
      res,
      429,
      "Se alcanzó el límite de 50 diagramas nuevos por día."
    );
  }

  /* PROMPT */

  const prompt = `
Crea un diagrama automotriz educativo.

Marca: ${make}
Modelo: ${model}
Año: ${year}
Sistema: ${system}

Devuelve SOLO JSON válido.

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
    "string"
  ]
}

Debe haber entre 3 y 12 componentes.

Tipos permitidos:

control
sensor
actuator
power
ground
connector
module
other

Las conexiones deben usar IDs
existentes en components.

No inventes colores de cables,
números de pines ni voltajes específicos.
El diagrama es educativo y orientativo.
Responde en español.
`;

  let diagram;

  try {
    diagram =
      await askAI(prompt);
  } catch (error) {
    console.error(
      "AI DIAGRAM:",
      error
    );

    return sendError(
      res,
      502,
      error
    );
  }

  diagram.title =
    text(
      diagram.title,
      `Diagrama ${system}`
    );

  diagram.description =
    text(
      diagram.description,
      `Diagrama orientativo del sistema ${system}.`
    );

  diagram.components =
    array(
      diagram.components
    );

  diagram.connections =
    array(
      diagram.connections
    );

  diagram.warnings =
    array(
      diagram.warnings
    );

  /* GUARDAR */

  const saved =
    await supabase
      .from("dtc_diagrams")
      .insert({
        make,
        model,

        vehicle_year:
          year,

        system,

        title:
          diagram.title,

        description:
          diagram.description,

        components:
          diagram.components,

        connections:
          diagram.connections,

        warnings:
          diagram.warnings,

        source:
          "openrouter"
      })
      .select()
      .limit(1);

  if (saved.error) {
    console.error(
      "DIAGRAM INSERT:",
      saved.error
    );

    /*
    Si otro proceso lo guardó,
    intentar recuperarlo.
    */

    const again =
      await supabase
        .from("dtc_diagrams")
        .select("*")
        .eq("make", make)
        .eq("model", model)
        .eq("vehicle_year", year)
        .eq("system", system)
        .limit(1);

    if (
      again.data &&
      again.data.length > 0
    ) {
      return diagramResponse(
        res,
        again.data[0],
        "supabase"
      );
    }

    return sendError(
      res,
      500,
      "La IA generó el diagrama, pero Supabase no pudo guardarlo.",
      {
        details:
          text(saved.error)
      }
    );
  }

  const item =
    saved.data?.[0] || {
      make,
      model,
      vehicle_year: year,
      system,
      ...diagram
    };

  return diagramResponse(
    res,
    item,
    "openrouter"
  );
}

/* =====================================================
   HANDLER PRINCIPAL
===================================================== */

export default async function handler(req, res) {
  try {

    if (req.method !== "GET") {
      return sendError(
        res,
        405,
        "Método no permitido."
      );
    }

    /*
    DIAGRAMA

    El HTML manda:

    /api/dtc?diagram=1&make=...
    */

    if (
      String(req.query.diagram)
        .toLowerCase() === "1"
    ) {
      return await handleDiagram(
        req,
        res
      );
    }

    /*
    DTC

    El HTML manda:

    /api/dtc?code=P2122
    */

    return await handleDTC(
      req,
      res
    );

  } catch (error) {

    console.error(
      "API ERROR:",
      error
    );

    return sendError(
      res,
      500,
      error?.message ||
      error
    );
  }
}
