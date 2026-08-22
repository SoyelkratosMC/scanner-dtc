import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const OPENROUTER = process.env.OPENROUTER_API_KEY;

function text(v) {
  return String(v ?? "").trim();
}

function arr(v) {
  return Array.isArray(v) ? v : [];
}

async function ai(prompt) {
  if (!OPENROUTER) {
    throw new Error("Falta OPENROUTER_API_KEY");
  }

  const r = await fetch(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "openrouter/free",
        messages: [
          {
            role: "system",
            content:
              "Eres un especialista automotriz. Responde únicamente JSON válido y en español."
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

  const raw = await r.text();

  if (!r.ok) {
    console.error(raw);
    throw new Error("OpenRouter no pudo generar la información.");
  }

  const json = JSON.parse(raw);
  let content = json?.choices?.[0]?.message?.content;

  if (Array.isArray(content)) {
    content = content.map(x => x?.text || "").join("");
  }

  if (!content) {
    throw new Error("OpenRouter no devolvió información.");
  }

  content = String(content)
    .replace(/^```json/i, "")
    .replace(/^```/, "")
    .replace(/```$/, "")
    .trim();

  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");

  if (start >= 0 && end > start) {
    content = content.slice(start, end + 1);
  }

  return JSON.parse(content);
}


/* =========================
   DTC
========================= */

async function dtc(req, res) {
  const code = text(req.query.code).toUpperCase();
  const make = text(req.query.make).toLowerCase();

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
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }

  if (data?.length) {
    return res.json({
      success: true,
      source: "supabase",
      ...data[0]
    });
  }

  let result;

  try {
    result = await ai(`
Genera información técnica para el código DTC ${code}.

Marca: ${make || "genérica"}

Devuelve SOLO JSON:

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

No inventes números de piezas, pines, colores de cables ni datos específicos no confirmados.
Las causas y reparaciones deben ser posibles, no afirmaciones absolutas.
severity debe ser BAJA, MEDIA, ALTA o CRÍTICA.
`);
  } catch (e) {
    return res.status(502).json({
      success: false,
      error: e.message
    });
  }

  result.code = code;
  result.make = text(result.make || make || "genérica");
  result.title = text(result.title || "Código DTC");
  result.problem = text(result.problem || "No disponible");
  result.causes = arr(result.causes);
  result.symptoms = arr(result.symptoms);
  result.diagnosis = arr(result.diagnosis);
  result.repairs = arr(result.repairs);
  result.severity = [
    "BAJA",
    "MEDIA",
    "ALTA",
    "CRÍTICA"
  ].includes(String(result.severity).toUpperCase())
    ? String(result.severity).toUpperCase()
    : "MEDIA";
  result.vehicle_years = text(
    result.vehicle_years || "No especificado"
  );
  result.system = text(
    result.system || "No especificado"
  );

  const { data: saved, error: saveError } = await supabase
    .from("dtc_codes")
    .insert(result)
    .select()
    .limit(1);

  if (saveError) {
    console.error(saveError);

    return res.status(500).json({
      success: false,
      error: "No se pudo guardar el DTC.",
      details: saveError.message
    });
  }

  return res.json({
    success: true,
    source: "openrouter",
    ...(saved?.[0] || result)
  });
}


/* =========================
   DIAGRAMA
========================= */

async function diagram(req, res) {
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
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }

  if (data?.length) {
    return res.json({
      success: true,
      source: "supabase",
      ...data[0]
    });
  }

  let result;

  try {
    result = await ai(`
Crea un diagrama automotriz EDUCATIVO.

Marca: ${make}
Modelo: ${model}
Año: ${year}
Sistema: ${system}

Devuelve SOLO JSON:

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

Usa entre 3 y 12 componentes.

Tipos permitidos:
control
sensor
actuator
power
ground
connector
module
other

No inventes colores de cables, números de pines ni voltajes.
Si hay diferencias entre versiones, indícalo.
El diagrama es orientativo y educativo.
`);
  } catch (e) {
    return res.status(502).json({
      success: false,
      error: e.message
    });
  }

  result.title = text(result.title || `Diagrama ${system}`);
  result.description = text(
    result.description || `Diagrama educativo de ${system}.`
  );
  result.components = arr(result.components);
  result.connections = arr(result.connections);
  result.warnings = arr(result.warnings);

  const { data: saved, error: saveError } = await supabase
    .from("dtc_diagrams")
    .insert({
      make,
      model,
      vehicle_year: year,
      system,
      title: result.title,
      description: result.description,
      components: result.components,
      connections: result.connections,
      warnings: result.warnings
    })
    .select()
    .limit(1);

  if (saveError) {
    return res.status(500).json({
      success: false,
      error: "No se pudo guardar el diagrama.",
      details: saveError.message
    });
  }

  return res.json({
    success: true,
    source: "openrouter",
    ...(saved?.[0] || {
      make,
      model,
      vehicle_year: year,
      system,
      ...result
    })
  });
}


/* =========================
   ROUTER
========================= */

export default async function handler(req, res) {
  try {
    const path = req.url.split("?")[0];

    if (path.includes("/diagram")) {
      return diagram(req, res);
    }

    return dtc(req, res);

  } catch (e) {
    console.error(e);

    return res.status(500).json({
      success: false,
      error: "Error interno del servidor."
    });
  }
    }
