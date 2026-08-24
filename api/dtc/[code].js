import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const OPENROUTER_URL =
  "https://openrouter.ai/api/v1/chat/completions";

function clean(value) {
  return String(value ?? "").trim();
}

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function errorText(error) {
  if (!error) return "Error desconocido.";

  if (typeof error === "string") {
    return error;
  }

  if (error.message) {
    return error.message;
  }

  if (error.error) {
    if (typeof error.error === "string") {
      return error.error;
    }

    if (error.error.message) {
      return error.error.message;
    }
  }

  try {
    return JSON.stringify(error);
  } catch {
    return "Error desconocido.";
  }
}

function send(res, status, data) {
  return res.status(status).json(data);
}

/* =====================================================
   OPENROUTER
===================================================== */

async function askAI(prompt) {
  const key = process.env.OPENROUTER_API_KEY;

  if (!key) {
    throw new Error(
      "Falta OPENROUTER_API_KEY en Vercel."
    );
  }

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",

    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer":
        "https://scanner-dtc.vercel.app",
      "X-Title":
        "Scanner DTC Automotriz"
    },

    body: JSON.stringify({
      model: "openrouter/free",

      messages: [
        {
          role: "system",
          content:
            "Eres un especialista automotriz. Responde en español. Devuelve únicamente JSON válido."
        },
        {
          role: "user",
          content: prompt
        }
      ],

      temperature: 0.2,
      max_tokens: 2500
    })
  });

  const raw = await response.text();

  if (!response.ok) {
    let message = "Error de OpenRouter.";

    try {
      const data = JSON.parse(raw);

      message =
        data?.error?.message ||
        data?.error ||
        message;
    } catch {}

    throw new Error(errorText(message));
  }

  let data;

  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(
      "OpenRouter no devolvió JSON."
    );
  }

  let content =
    data?.choices?.[0]?.message?.content;

  if (Array.isArray(content)) {
    content = content
      .map(item => item?.text || "")
      .join("");
  }

  if (!content) {
    throw new Error(
      "La IA no devolvió contenido."
    );
  }

  content = String(content)
    .replace(/^```json/i, "")
    .replace(/^```/i, "")
    .replace(/```$/i, "")
    .trim();

  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");

  if (start >= 0 && end > start) {
    content = content.slice(start, end + 1);
  }

  try {
    return JSON.parse(content);
  } catch {
    throw new Error(
      "La IA devolvió JSON inválido."
    );
  }
}

/* =====================================================
   DTC
===================================================== */

async function getDTC(req, res) {
  const code = clean(
    req.query.code
  ).toUpperCase();

  const make = clean(
    req.query.make
  ).toLowerCase();

  if (!/^[PBCU][0-9A-F]{4}$/.test(code)) {
    return send(res, 400, {
      success: false,
      error:
        "Código DTC inválido. Ejemplo: P2122."
    });
  }

  /* Buscar en Supabase */

  const result = await supabase
    .from("dtc_codes")
    .select("*")
    .eq("code", code)
    .limit(1);

  if (result.error) {
    return send(res, 500, {
      success: false,
      error:
        "Error consultando dtc_codes.",
      details:
        errorText(result.error)
    });
  }

  /* Si existe, devolverlo */

  if (result.data?.length > 0) {
    const d = result.data[0];

    return send(res, 200, {
      success: true,
      source: "supabase",
      saved: true,

      code: d.code,
      make: d.make || make || "Genérica",
      title: d.title || "Código DTC",
      problem:
        d.problem ||
        "Sin información disponible.",

      causes: arr(d.causes),
      symptoms: arr(d.symptoms),
      diagnosis: arr(d.diagnosis),
      repairs: arr(d.repairs),

      severity:
        d.severity || "MEDIA",

      vehicle_years:
        d.vehicle_years ||
        "No especificado",

      system:
        d.system ||
        "No especificado"
    });
  }

  /* Generar código nuevo */

  let d;

  try {
    d = await askAI(`
Analiza el código DTC ${code}.

Marca:
${make || "Genérica"}

Devuelve EXACTAMENTE este JSON:

{
  "code": "${code}",
  "make": "${make || "genérica"}",
  "title": "",
  "problem": "",
  "causes": [],
  "symptoms": [],
  "diagnosis": [],
  "repairs": [],
  "severity": "MEDIA",
  "vehicle_years": "No especificado",
  "system": ""
}

Reglas:

- Responde en español.
- causes debe tener varias causas posibles.
- symptoms debe tener varios síntomas.
- diagnosis debe tener pasos generales.
- repairs debe tener posibles reparaciones.
- severity solamente puede ser BAJA, MEDIA, ALTA o CRÍTICA.
- No inventes números de piezas.
- No inventes pines.
- No inventes colores de cables.
- No inventes voltajes específicos.
- Devuelve solamente JSON.
`);
  } catch (error) {
    return send(res, 502, {
      success: false,
      error: errorText(error)
    });
  }

  d.code =
    clean(d.code || code).toUpperCase();

  d.make =
    clean(
      d.make ||
      make ||
      "genérica"
    );

  d.title =
    clean(
      d.title ||
      "Código DTC"
    );

  d.problem =
    clean(
      d.problem ||
      "Sin información disponible."
    );

  d.causes = arr(d.causes);
  d.symptoms = arr(d.symptoms);
  d.diagnosis = arr(d.diagnosis);
  d.repairs = arr(d.repairs);

  const severity =
    String(
      d.severity || "MEDIA"
    ).toUpperCase();

  d.severity =
    [
      "BAJA",
      "MEDIA",
      "ALTA",
      "CRÍTICA"
    ].includes(severity)
      ? severity
      : "MEDIA";

  d.vehicle_years =
    clean(
      d.vehicle_years ||
      "No especificado"
    );

  d.system =
    clean(
      d.system ||
      "No especificado"
    );

  /* Guardar */

  const saved = await supabase
    .from("dtc_codes")
    .insert({
      code: d.code,
      make: d.make,
      title: d.title,
      problem: d.problem,
      causes: d.causes,
      symptoms: d.symptoms,
      diagnosis: d.diagnosis,
      repairs: d.repairs,
      severity: d.severity,
      vehicle_years: d.vehicle_years,
      system: d.system,
      source: "openrouter"
    })
    .select()
    .limit(1);

  if (saved.error) {
    return send(res, 500, {
      success: false,
      error:
        "La IA respondió, pero Supabase no pudo guardar el DTC.",
      details:
        errorText(saved.error)
    });
  }

  return send(res, 200, {
    success: true,
    source: "openrouter",
    saved: true,
    ...d
  });
}

/* =====================================================
   DIAGRAMA
===================================================== */

async function getDiagram(req, res) {
  const make = clean(
    req.query.make
  );

  const model = clean(
    req.query.model
  );

  const year = clean(
    req.query.year
  );

  const system = clean(
    req.query.system
  );

  if (
    !make ||
    !model ||
    !year ||
    !system
  ) {
    return send(res, 400, {
      success: false,
      error:
        "Completa marca, modelo, año y sistema."
    });
  }

  /* Buscar diagrama guardado */

  const result = await supabase
    .from("dtc_diagrams")
    .select("*")
    .eq("make", make)
    .eq("model", model)
    .eq("vehicle_year", year)
    .eq("system", system)
    .limit(1);

  if (result.error) {
    return send(res, 500, {
      success: false,
      error:
        "Error consultando dtc_diagrams.",
      details:
        errorText(result.error)
    });
  }

  if (result.data?.length > 0) {
    const d = result.data[0];

    return send(res, 200, {
      success: true,
      source: "supabase",
      saved: true,

      make: d.make,
      model: d.model,
      year: d.vehicle_year,
      system: d.system,

      title:
        d.title ||
        `Diagrama ${d.system}`,

      description:
        d.description || "",

      components:
        arr(d.components),

      connections:
        arr(d.connections),

      warnings:
        arr(d.warnings)
    });
  }

  /* Generar diagrama */

  let d;

  try {
    d = await askAI(`
Crea un diagrama automotriz EDUCATIVO.

Marca: ${make}
Modelo: ${model}
Año: ${year}
Sistema: ${system}

Devuelve EXACTAMENTE:

{
  "title": "",
  "description": "",
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
  "warnings": []
}

Usa entre 3 y 10 componentes.

Tipos permitidos:

control
sensor
actuator
power
ground
connector
module
other

Todas las conexiones deben utilizar IDs existentes.

No inventes:
- colores de cables
- números de pines
- voltajes
- números de piezas

Es un diagrama educativo, no un manual de reparación.

Devuelve solamente JSON.
`);
  } catch (error) {
    return send(res, 502, {
      success: false,
      error: errorText(error)
    });
  }

  d.title =
    clean(
      d.title ||
      `Diagrama ${system}`
    );

  d.description =
    clean(
      d.description ||
      `Diagrama educativo del sistema ${system}.`
    );

  d.components =
    arr(d.components);

  d.connections =
    arr(d.connections);

  d.warnings =
    arr(d.warnings);

  /* Guardar */

  const saved = await supabase
    .from("dtc_diagrams")
    .insert({
      make,
      model,
      vehicle_year: year,
      system,
      title: d.title,
      description: d.description,
      components: d.components,
      connections: d.connections,
      warnings: d.warnings,
      source: "openrouter"
    })
    .select()
    .limit(1);

  if (saved.error) {
    return send(res, 500, {
      success: false,
      error:
        "La IA respondió, pero Supabase no pudo guardar el diagrama.",
      details:
        errorText(saved.error)
    });
  }

  return send(res, 200, {
    success: true,
    source: "openrouter",
    saved: true,

    make,
    model,
    year,
    system,

    title: d.title,
    description: d.description,

    components:
      d.components,

    connections:
      d.connections,

    warnings:
      d.warnings
  });
}

/* =====================================================
   HANDLER
===================================================== */

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return send(res, 405, {
        success: false,
        error:
          "Método no permitido."
      });
    }

    /* DIAGRAMA */

    if (
      String(req.query.diagram) === "1"
    ) {
      return await getDiagram(
        req,
        res
      );
    }

    /* DTC */

    return await getDTC(
      req,
      res
    );

  } catch (error) {
    console.error(
      "API ERROR:",
      error
    );

    return send(res, 500, {
      success: false,
      error:
        errorText(error)
    });
  }
}
