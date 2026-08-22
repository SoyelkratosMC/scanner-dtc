import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const MAX_NEW_CODES_PER_DAY = 50;
const MAX_NEW_DIAGRAMS_PER_DAY = 50;

/*
=========================================================
UTILIDADES
=========================================================
*/

function cleanText(value) {
  return String(value ?? "").trim();
}

function cleanLower(value) {
  return cleanText(value).toLowerCase();
}

function cleanUpper(value) {
  return cleanText(value).toUpperCase();
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

/*
=========================================================
CONVERTIR RESPUESTA DE OPENROUTER A JSON
=========================================================
*/

function parseAIJson(content) {
  if (!content) {
    throw new Error("OpenRouter no devolvió contenido.");
  }

  if (typeof content === "object") {
    return content;
  }

  let text = String(content).trim();

  // Quitar markdown si el modelo lo agregó
  text = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  // Buscar el objeto JSON
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");

  if (first !== -1 && last !== -1 && last > first) {
    text = text.substring(first, last + 1);
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    console.error("JSON IA INVALIDO:", text);

    throw new Error(
      "OpenRouter devolvió información que no pudo convertirse a JSON."
    );
  }
}

/*
=========================================================
OPENROUTER
=========================================================
*/

async function askOpenRouter(prompt) {
  const key = process.env.OPENROUTER_API_KEY;

  if (!key) {
    throw new Error(
      "Falta configurar OPENROUTER_API_KEY."
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
              "Eres un especialista en diagnóstico automotriz. Responde siempre en español y sigue exactamente el formato solicitado."
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
    console.error("OPENROUTER ERROR:", raw);

    throw new Error(
      "OpenRouter no pudo generar la información."
    );
  }

  let json;

  try {
    json = JSON.parse(raw);
  } catch {
    console.error(
      "RESPUESTA OPENROUTER NO JSON:",
      raw
    );

    throw new Error(
      "OpenRouter devolvió una respuesta inválida."
    );
  }

  let content =
    json?.choices?.[0]?.message?.content;

  /*
  Algunos modelos pueden devolver content
  como array.
  */

  if (Array.isArray(content)) {
    content = content
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }

        return item?.text || "";
      })
      .join("");
  }

  if (!content) {
    console.error(
      "OPENROUTER SIN CONTENT:",
      JSON.stringify(json)
    );

    throw new Error(
      "OpenRouter no devolvió información válida."
    );
  }

  return parseAIJson(content);
}

/*
=========================================================
CONTAR REGISTROS CREADOS HOY
=========================================================
*/

async function countToday(table) {
  const now = new Date();

  const start = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    0,
    0,
    0,
    0
  );

  const {
    count,
    error
  } = await supabase
    .from(table)
    .select("id", {
      count: "exact",
      head: true
    })
    .gte(
      "created_at",
      start.toISOString()
    );

  if (error) {
    console.error(
      `COUNT ERROR ${table}:`,
      error
    );

    throw new Error(
      `No se pudo comprobar el límite diario de ${table}.`
    );
  }

  return count || 0;
}

/*
=========================================================
CONVERTIR DTC DE SUPABASE A RESPUESTA
=========================================================
*/

function dtcResponse(dtc, source = "supabase") {
  return {
    success: true,
    source,
    saved: true,

    code: dtc.code,
    make: dtc.make,
    title: dtc.title,
    problem: dtc.problem,

    causes: normalizeArray(dtc.causes),
    symptoms: normalizeArray(dtc.symptoms),
    diagnosis: normalizeArray(dtc.diagnosis),
    repairs: normalizeArray(dtc.repairs),

    severity: dtc.severity || "MEDIA",

    vehicle_years:
      dtc.vehicle_years ||
      "No especificado",

    system:
      dtc.system ||
      "Sistema no especificado"
  };
}

/*
=========================================================
BUSCAR / GENERAR DTC
=========================================================
*/

async function handleDTC(req, res, codeFromUrl) {
  const code = cleanUpper(
    codeFromUrl || req.query.code
  );

  const make = cleanLower(
    req.query.make
  );

  /*
  VALIDAR CÓDIGO
  */

  if (!code) {
    return res.status(400).json({
      success: false,
      error: "Falta el código DTC."
    });
  }

  if (!/^[PBCU][0-9A-F]{4}$/.test(code)) {
    return res.status(400).json({
      success: false,
      error: "Código DTC inválido."
    });
  }

  /*
  =======================================================
  BUSCAR PRIMERO EN SUPABASE
  =======================================================
  */

  const {
    data,
    error
  } = await supabase
    .from("dtc_codes")
    .select("*")
    .eq("code", code)
    .limit(1);

  if (error) {
    console.error(
      "SUPABASE SEARCH ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      error: "Error consultando Supabase.",
      details: error.message
    });
  }

  /*
  =======================================================
  SI YA EXISTE
  =======================================================
  */

  if (data && data.length > 0) {
    return res.status(200).json(
      dtcResponse(data[0], "supabase")
    );
  }

  /*
  =======================================================
  LÍMITE DE 50 DTC NUEVOS AL DÍA
  =======================================================
  */

  let todayCount;

  try {
    todayCount = await countToday(
      "dtc_codes"
    );
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }

  if (todayCount >= MAX_NEW_CODES_PER_DAY) {
    return res.status(429).json({
      success: false,
      error:
        "Se alcanzó el límite de 50 códigos nuevos por día.",
      limit: MAX_NEW_CODES_PER_DAY,
      used: todayCount
    });
  }

  /*
  =======================================================
  GENERAR DTC CON IA
  =======================================================
  */

  const prompt = `
Eres especialista en diagnóstico automotriz.

Genera información para este código DTC:

Código:
${code}

Marca:
${make || "genérica"}

REGLAS:

- Responde en español.
- Devuelve únicamente JSON válido.
- No uses bloques Markdown.
- No inventes una falla confirmada.
- Las causas son posibles causas.
- Los síntomas deben ser razonables.
- El diagnóstico debe indicar comprobaciones.
- Las reparaciones deben ser posibles soluciones.
- No inventes números de piezas.
- No inventes valores eléctricos específicos.
- No inventes años específicos.
- Si depende del fabricante, indícalo.
- La información debe ser útil para un scanner automotriz.

ESTRUCTURA EXACTA:

{
  "code": "${code}",
  "make": "${make || "genérica"}",
  "title": "string",
  "problem": "string",
  "causes": ["string"],
  "symptoms": ["string"],
  "diagnosis": ["string"],
  "repairs": ["string"],
  "severity": "MEDIA",
  "vehicle_years": "No especificado",
  "system": "string"
}

severity solamente puede ser:

BAJA
MEDIA
ALTA
CRÍTICA
`;

  let dtc;

  try {
    dtc = await askOpenRouter(prompt);
  } catch (error) {
    return res.status(502).json({
      success: false,
      error: error.message
    });
  }

  /*
  =======================================================
  NORMALIZAR DTC
  =======================================================
  */

  dtc.code = cleanUpper(
    dtc.code || code
  );

  // Siempre respetar el código que pidió el usuario
  dtc.code = code;

  dtc.make = cleanLower(
    dtc.make ||
    make ||
    "genérica"
  );

  dtc.title = cleanText(
    dtc.title ||
    "Código DTC"
  );

  dtc.problem = cleanText(
    dtc.problem ||
    "No hay información disponible."
  );

  dtc.causes = normalizeArray(
    dtc.causes
  );

  dtc.symptoms = normalizeArray(
    dtc.symptoms
  );

  dtc.diagnosis = normalizeArray(
    dtc.diagnosis
  );

  dtc.repairs = normalizeArray(
    dtc.repairs
  );

  const validSeverity = [
    "BAJA",
    "MEDIA",
    "ALTA",
    "CRÍTICA"
  ];

  const receivedSeverity =
    cleanUpper(
      dtc.severity
    );

  dtc.severity =
    validSeverity.includes(
      receivedSeverity
    )
      ? receivedSeverity
      : "MEDIA";

  dtc.vehicle_years =
    cleanText(
      dtc.vehicle_years ||
      "No especificado"
    );

  dtc.system =
    cleanText(
      dtc.system ||
      "Sistema no especificado"
    );

  /*
  =======================================================
  GUARDAR DTC
  =======================================================
  */

  const {
    data: saved,
    error: saveError
  } = await supabase
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
      vehicle_years: dtc.vehicle_years,
      system: dtc.system,
      source: "openrouter"
    })
    .select()
    .limit(1);

  if (saveError) {
    console.error(
      "SUPABASE INSERT ERROR:",
      saveError
    );

    /*
    Si otro proceso ya lo guardó,
    recuperarlo.
    */

    const {
      data: existing
    } = await supabase
      .from("dtc_codes")
      .select("*")
      .eq("code", dtc.code)
      .limit(1);

    if (
      existing &&
      existing.length > 0
    ) {
      return res.status(200).json(
        dtcResponse(
          existing[0],
          "supabase"
        )
      );
    }

    return res.status(500).json({
      success: false,

      error:
        "OpenRouter generó la información, pero Supabase no pudo guardarla.",

      details:
        saveError.message,

      supabase_code:
        saveError.code,

      generated:
        dtc
    });
  }

  /*
  =======================================================
  RESPUESTA DTC NUEVO
  =======================================================
  */

  return res.status(200).json(
    dtcResponse(
      saved?.[0] || dtc,
      "openrouter"
    )
  );
}

/*
=========================================================
RESPUESTA DE DIAGRAMA
=========================================================
*/

function diagramResponse(
  diagram,
  source = "supabase"
) {
  return {
    success: true,

    source,

    saved: true,

    make: diagram.make,
    model: diagram.model,
    year: diagram.vehicle_year,
    system: diagram.system,

    title: diagram.title,

    description:
      diagram.description,

    components:
      normalizeArray(
        diagram.components
      ),

    connections:
      normalizeArray(
        diagram.connections
      ),

    warnings:
      normalizeArray(
        diagram.warnings
      )
  };
}

/*
=========================================================
BUSCAR / GENERAR DIAGRAMA
=========================================================
*/

async function handleDiagram(req, res) {
  const make = cleanText(
    req.query.make
  );

  const model = cleanText(
    req.query.model
  );

  const year = cleanText(
    req.query.year
  );

  const system = cleanText(
    req.query.system
  );

  /*
  =======================================================
  VALIDACIÓN
  =======================================================
  */

  if (
    !make ||
    !model ||
    !year ||
    !system
  ) {
    return res.status(400).json({
      success: false,
      error:
        "Debes indicar marca, modelo, año y sistema."
    });
  }

  /*
  =======================================================
  BUSCAR DIAGRAMA GUARDADO
  =======================================================
  */

  const {
    data: existing,
    error: searchError
  } = await supabase
    .from("dtc_diagrams")
    .select("*")
    .eq("make", make)
    .eq("model", model)
    .eq("vehicle_year", year)
    .eq("system", system)
    .limit(1);

  if (searchError) {
    console.error(
      "DIAGRAM SEARCH ERROR:",
      searchError
    );

    return res.status(500).json({
      success: false,
      error:
        "Error buscando el diagrama.",
      details:
        searchError.message
    });
  }

  /*
  =======================================================
  YA EXISTE
  =======================================================
  */

  if (
    existing &&
    existing.length > 0
  ) {
    return res.status(200).json(
      diagramResponse(
        existing[0],
        "supabase"
      )
    );
  }

  /*
  =======================================================
  LÍMITE DE 50 DIAGRAMAS NUEVOS
  =======================================================
  */

  let todayCount;

  try {
    todayCount =
      await countToday(
        "dtc_diagrams"
      );
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }

  if (
    todayCount >=
    MAX_NEW_DIAGRAMS_PER_DAY
  ) {
    return res.status(429).json({
      success: false,
      error:
        "Se alcanzó el límite de 50 diagramas nuevos por día.",
      limit:
        MAX_NEW_DIAGRAMS_PER_DAY,
      used:
        todayCount
    });
  }

  /*
  =======================================================
  GENERAR DIAGRAMA
  =======================================================
  */

  const prompt = `
Eres un especialista en sistemas eléctricos y diagnóstico automotriz.

Necesito crear un DIAGRAMA AUTOMOTRIZ EDUCATIVO.

Vehículo:

Marca:
${make}

Modelo:
${model}

Año:
${year}

Sistema:
${system}

IMPORTANTE:

- Responde en español.
- Devuelve únicamente JSON válido.
- No uses Markdown.
- El diagrama es orientativo y educativo.
- No inventes colores de cables.
- No inventes números de pines.
- No inventes voltajes específicos.
- No presentes conexiones no verificadas como confirmadas.
- Si existe una variación importante según versión, indícala en warnings.
- Utiliza entre 3 y 12 componentes.
- Cada componente debe tener un ID único.
- Cada conexión debe utilizar IDs existentes.

ESTRUCTURA EXACTA:

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

TIPOS PERMITIDOS:

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
    diagram =
      await askOpenRouter(
        prompt
      );
  } catch (error) {
    return res.status(502).json({
      success: false,
      error: error.message
    });
  }

  /*
  =======================================================
  NORMALIZAR DIAGRAMA
  =======================================================
  */

  diagram.title =
    cleanText(
      diagram.title ||
      `Diagrama ${system}`
    );

  diagram.description =
    cleanText(
      diagram.description ||
      `Diagrama orientativo del sistema ${system}.`
    );

  diagram.components =
    normalizeArray(
      diagram.components
    );

  diagram.connections =
    normalizeArray(
      diagram.connections
    );

  diagram.warnings =
    normalizeArray(
      diagram.warnings
    );

  /*
  =======================================================
  VALIDAR COMPONENTES
  =======================================================
  */

  const allowedTypes = [
    "control",
    "sensor",
    "actuator",
    "power",
    "ground",
    "connector",
    "module",
    "other"
  ];

  diagram.components =
    diagram.components
      .map((component, index) => {

        const id =
          cleanText(
            component?.id
          ) ||
          `component_${index + 1}`;

        const name =
          cleanText(
            component?.name
          ) ||
          `Componente ${index + 1}`;

        const type =
          cleanText(
            component?.type
          );

        return {
          id,
          name,
          type:
            allowedTypes.includes(type)
              ? type
              : "other"
        };
      });

  /*
  =======================================================
  VALIDAR CONEXIONES
  =======================================================
  */

  const componentIds =
    new Set(
      diagram.components.map(
        component =>
          component.id
      )
    );

  diagram.connections =
    diagram.connections
      .filter(connection => {

        if (!connection) {
          return false;
        }

        const from =
          cleanText(
            connection.from
          );

        const to =
          cleanText(
            connection.to
          );

        return (
          componentIds.has(from) &&
          componentIds.has(to)
        );
      })
      .map(connection => ({
        from:
          cleanText(
            connection.from
          ),

        to:
          cleanText(
            connection.to
          ),

        label:
          cleanText(
            connection.label
          ) || "Conexión"
      }));

  /*
  =======================================================
  GUARDAR DIAGRAMA
  =======================================================
  */

  const {
    data: savedDiagram,
    error: diagramSaveError
  } = await supabase
    .from("dtc_diagrams")
    .insert({
      make,
      model,
      vehicle_year: year,
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

  /*
  =======================================================
  ERROR AL GUARDAR
  =======================================================
  */

  if (diagramSaveError) {
    console.error(
      "DIAGRAM INSERT ERROR:",
      diagramSaveError
    );

    /*
    Intentar recuperar si ya existe.
    */

    const {
      data: existingAfterError
    } = await supabase
      .from("dtc_diagrams")
      .select("*")
      .eq("make", make)
      .eq("model", model)
      .eq("vehicle_year", year)
      .eq("system", system)
      .limit(1);

    if (
      existingAfterError &&
      existingAfterError.length > 0
    ) {
      return res.status(200).json(
        diagramResponse(
          existingAfterError[0],
          "supabase"
        )
      );
    }

    return res.status(500).json({
      success: false,

      error:
        "OpenRouter generó el diagrama, pero Supabase no pudo guardarlo.",

      details:
        diagramSaveError.message,

      supabase_code:
        diagramSaveError.code,

      generated:
        diagram
    });
  }

/*
=========================================================
RESPUESTA FINAL DIAGRAMA
=========================================================
*/

const finalDiagram =
  savedDiagram?.[0] || {
    make,
    model,
    vehicle_year: year,
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
      diagram.warnings
  };

return res.status(200).json(
  diagramResponse(
    finalDiagram,
    "openrouter"
  )
);

}


/*
=========================================================
HANDLER PRINCIPAL
=========================================================
*/

export default async function handler(req, res) {

  try {

    /*
    =====================================================
    OBTENER RUTA
    =====================================================
    */

    const pathname =
      String(
        req.url || ""
      ).split("?")[0];


    /*
    =====================================================
    DIAGRAMAS
    =====================================================
    */

    if (
      pathname.includes("/diagram")
    ) {

      return await handleDiagram(
        req,
        res
      );

    }


    /*
    =====================================================
    DTC
    =====================================================
    */

    let code =
      req.query.code;


    /*
    Vercel puede entregar
    el parámetro como array.
    */

    if (
      Array.isArray(code)
    ) {

      code =
        code[0];

    }


    /*
    Si no viene en query,
    obtenerlo desde la URL.

    Ejemplo:

    /api/dtc/P0300
    */

    if (!code) {

      const parts =
        pathname
          .split("/")
          .filter(Boolean);


      const last =
        parts[parts.length - 1];


      if (
        last &&
        /^[PBCU][0-9A-F]{4}$/i.test(
          last
        )
      ) {

        code =
          last;

      }

    }


    /*
    =====================================================
    EJECUTAR DTC
    =====================================================
    */

    return await handleDTC(
      req,
      res,
      code
    );


  } catch (error) {

    console.error(
      "SERVER ERROR:",
      error
    );


    return res.status(500).json({

      success: false,

      error:
        error.message ||
        "Error interno del servidor."

    });

  }

}
