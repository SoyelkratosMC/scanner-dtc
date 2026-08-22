import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  try {
    const MAX_NEW_CODES_PER_DAY = 50;

    const code = String(req.query.code || "")
      .toUpperCase()
      .trim();

    const make = String(req.query.make || "")
      .toLowerCase()
      .trim();

    if (!code) {
      return res.status(400).json({
        success: false,
        error: "Falta el código DTC"
      });
    }

    if (!/^[PBCU][0-9A-F]{4}$/.test(code)) {
      return res.status(400).json({
        success: false,
        error: "Código DTC inválido"
      });
    }

    // ============================================
    // BUSCAR EN SUPABASE
    // ============================================

    const {
      data,
      error
    } = await supabase
      .from("dtc_codes")
      .select("*")
      .eq("code", code)
      .limit(1);

    if (error) {
      console.error("SUPABASE SEARCH ERROR:", error);

      return res.status(500).json({
        success: false,
        error: "Error consultando Supabase",
        details: error.message
      });
    }

    // ============================================
    // COMPROBAR SI EXISTE Y ESTÁ COMPLETO
    // ============================================

    if (data && data.length > 0) {
      const existing = data[0];

      const complete =
        Array.isArray(existing.causes) &&
        existing.causes.length > 0 &&
        Array.isArray(existing.symptoms) &&
        existing.symptoms.length > 0 &&
        Array.isArray(existing.diagnosis) &&
        existing.diagnosis.length > 0 &&
        Array.isArray(existing.repairs) &&
        existing.repairs.length > 0;

      // ==========================================
      // SI ESTÁ COMPLETO → RESPUESTA INSTANTÁNEA
      // ==========================================

      if (complete) {
        return res.status(200).json({
          success: true,
          source: "supabase",
          saved: true,

          code: existing.code,
          make: existing.make,
          title: existing.title,
          problem: existing.problem,

          causes: Array.isArray(existing.causes)
            ? existing.causes
            : [],

          symptoms: Array.isArray(existing.symptoms)
            ? existing.symptoms
            : [],

          diagnosis: Array.isArray(existing.diagnosis)
            ? existing.diagnosis
            : [],

          repairs: Array.isArray(existing.repairs)
            ? existing.repairs
            : [],

          severity:
            existing.severity || "MEDIA",

          vehicle_years:
            existing.vehicle_years || "No especificado",

          system:
            existing.system || "Sistema no especificado",

          diagram_title:
            existing.diagram_title || "",

          diagram_components:
            Array.isArray(existing.diagram_components)
              ? existing.diagram_components
              : [],

          diagram_connections:
            Array.isArray(existing.diagram_connections)
              ? existing.diagram_connections
              : []
        });
      }

      console.log(
        `DTC ${code} incompleto. Regenerando...`
      );
    }

    // ============================================
    // OPENROUTER
    // ============================================

    const openRouterKey =
      process.env.OPENROUTER_API_KEY;

    if (!openRouterKey) {
      return res.status(500).json({
        success: false,
        error: "Falta configurar OPENROUTER_API_KEY."
      });
    }

    // ============================================
    // PROMPT
    // ============================================

    const prompt = `
Eres un especialista profesional en diagnóstico automotriz.

Genera información para este código DTC:

Código: ${code}

Marca: ${make || "genérica"}

La información debe estar en español.

REGLAS:

1. No inventes fallas confirmadas.
2. Las causas son posibles causas.
3. No afirmes que una pieza está dañada sin diagnóstico.
4. Si el significado depende del fabricante, indícalo.
5. No inventes años específicos.
6. No inventes números de piezas.
7. No inventes valores eléctricos específicos.
8. La información debe ser útil para un scanner automotriz.
9. Todos los arrays deben tener información.
10. Genera también un diagrama ORIENTATIVO del sistema.

IMPORTANTE SOBRE EL DIAGRAMA:

El diagrama NO debe inventar un pinout específico.

Debe representar solamente la relación general entre componentes.

Devuelve SOLAMENTE JSON válido.

FORMATO:

{
  "code": "${code}",
  "make": "${make || "genérica"}",
  "title": "string",
  "problem": "string",
  "causes": [
    "string",
    "string",
    "string"
  ],
  "symptoms": [
    "string",
    "string",
    "string"
  ],
  "diagnosis": [
    "string",
    "string",
    "string"
  ],
  "repairs": [
    "string",
    "string",
    "string"
  ],
  "severity": "MEDIA",
  "vehicle_years": "No especificado",
  "system": "string",
  "diagram_title": "string",
  "diagram_components": [
    "string",
    "string",
    "string"
  ],
  "diagram_connections": [
    "Componente A → Componente B",
    "Componente B → Componente C"
  ]
}

severity solamente puede ser:

BAJA
MEDIA
ALTA
CRÍTICA

No dejes vacíos:

causes
symptoms
diagnosis
repairs
diagram_components
diagram_connections
`;

    // ============================================
    // LLAMAR A OPENROUTER
    // ============================================

    const openRouterResponse = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",

        headers: {
          "Authorization":
            `Bearer ${openRouterKey}`,

          "Content-Type":
            "application/json",

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
                "Eres especialista en diagnóstico automotriz. Devuelve solamente JSON válido."
            },

            {
              role: "user",
              content: prompt
            }
          ],

          response_format: {
            type: "json_object"
          },

          temperature: 0.2,

          max_tokens: 2200
        })
      }
    );

    if (!openRouterResponse.ok) {
      const errorText =
        await openRouterResponse.text();

      console.error(
        "OPENROUTER ERROR:",
        errorText
      );

      return res.status(502).json({
        success: false,
        error:
          "OpenRouter no pudo generar la información.",
        details:
          errorText
      });
    }

    const openRouterData =
      await openRouterResponse.json();

    let generatedText =
      openRouterData
        ?.choices?.[0]
        ?.message
        ?.content;

    if (!generatedText) {
      return res.status(502).json({
        success: false,
        error:
          "OpenRouter no devolvió información válida."
      });
    }

    // ============================================
    // LIMPIAR POSIBLES BLOQUES MARKDOWN
    // ============================================

    if (typeof generatedText === "string") {
      generatedText = generatedText
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();
    }

    // ============================================
    // CONVERTIR JSON
    // ============================================

    let dtc;

    try {
      dtc =
        typeof generatedText === "string"
          ? JSON.parse(generatedText)
          : generatedText;

    } catch (error) {
      console.error(
        "JSON PARSE ERROR:",
        error
      );

      console.error(
        "RESPUESTA IA:",
        generatedText
      );

      return res.status(502).json({
        success: false,
        error:
          "OpenRouter devolvió información que no pudo convertirse a JSON.",
        details:
          String(generatedText)
      });
    }

    // ============================================
    // NORMALIZAR
    // ============================================

    dtc.code =
      String(dtc.code || code)
        .toUpperCase()
        .trim();

    dtc.make =
      String(
        dtc.make ||
        make ||
        "genérica"
      );

    dtc.title =
      String(
        dtc.title ||
        "Código DTC"
      );

    dtc.problem =
      String(
        dtc.problem ||
        "No hay información disponible."
      );

    dtc.causes =
      Array.isArray(dtc.causes)
        ? dtc.causes.filter(Boolean)
        : [];

    dtc.symptoms =
      Array.isArray(dtc.symptoms)
        ? dtc.symptoms.filter(Boolean)
        : [];

    dtc.diagnosis =
      Array.isArray(dtc.diagnosis)
        ? dtc.diagnosis.filter(Boolean)
        : [];

    dtc.repairs =
      Array.isArray(dtc.repairs)
        ? dtc.repairs.filter(Boolean)
        : [];

    dtc.severity =
      String(
        dtc.severity ||
        "MEDIA"
      );

    const validSeverities = [
      "BAJA",
      "MEDIA",
      "ALTA",
      "CRÍTICA"
    ];

    if (
      !validSeverities.includes(
        dtc.severity
      )
    ) {
      dtc.severity = "MEDIA";
    }

    dtc.vehicle_years =
      String(
        dtc.vehicle_years ||
        "No especificado"
      );

    dtc.system =
      String(
        dtc.system ||
        "Sistema no especificado"
      );

    dtc.diagram_title =
      String(
        dtc.diagram_title ||
        `Diagrama orientativo - ${dtc.system}`
      );

    dtc.diagram_components =
      Array.isArray(dtc.diagram_components)
        ? dtc.diagram_components.filter(Boolean)
        : [];

    dtc.diagram_connections =
      Array.isArray(dtc.diagram_connections)
        ? dtc.diagram_connections.filter(Boolean)
        : [];

    // ============================================
    // VALIDAR INFORMACIÓN
    // ============================================

    if (
      dtc.causes.length === 0 ||
      dtc.symptoms.length === 0 ||
      dtc.diagnosis.length === 0 ||
      dtc.repairs.length === 0 ||
      dtc.diagram_components.length === 0 ||
      dtc.diagram_connections.length === 0
    ) {
      return res.status(502).json({
        success: false,
        error:
          "OpenRouter devolvió información incompleta. No se guardó el código.",
        details: dtc
      });
    }

    // ============================================
    // SI EXISTÍA → UPDATE
    // ============================================

    if (data && data.length > 0) {
      const existingId = data[0].id;

      const {
        data: updatedData,
        error: updateError
      } = await supabase
        .from("dtc_codes")
        .update({
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

          diagram_title:
            dtc.diagram_title,

          diagram_components:
            dtc.diagram_components,

          diagram_connections:
            dtc.diagram_connections,

          source: "openrouter"
        })
        .eq("id", existingId)
        .select();

      if (updateError) {
        console.error(
          "SUPABASE UPDATE ERROR:",
          updateError
        );

        return res.status(500).json({
          success: false,
          error:
            "OpenRouter generó la información, pero Supabase no pudo actualizarla.",
          details:
            updateError.message,
          supabase_code:
            updateError.code
        });
      }

      return res.status(200).json({
        success: true,
        source: "openrouter",
        saved: true,
        updated: true,

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

        diagram_title:
          dtc.diagram_title,

        diagram_components:
          dtc.diagram_components,

        diagram_connections:
          dtc.diagram_connections
      });
    }

    // ============================================
    // CONTAR NUEVOS DEL DÍA
    // ============================================

    const now = new Date();

    const startOfDay = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      0,
      0,
      0,
      0
    );

    const {
      count: todayCount,
      error: countError
    } = await supabase
      .from("dtc_codes")
      .select("id", {
        count: "exact",
        head: true
      })
      .gte(
        "created_at",
        startOfDay.toISOString()
      );

    if (countError) {
      return res.status(500).json({
        success: false,
        error:
          "No se pudo comprobar el límite diario.",
        details:
          countError.message
      });
    }

    if (
      todayCount !== null &&
      todayCount >= MAX_NEW_CODES_PER_DAY
    ) {
      return res.status(429).json({
        success: false,
        error:
          "Se alcanzó el límite de 50 códigos nuevos por día.",
        limit:
          MAX_NEW_CODES_PER_DAY,
        used:
          todayCount
      });
    }

    // ============================================
    // INSERTAR NUEVO DTC
    // ============================================

    const {
      error: insertError
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

        severity:
          dtc.severity,

        vehicle_years:
          dtc.vehicle_years,

        system:
          dtc.system,

        diagram_title:
          dtc.diagram_title,

        diagram_components:
          dtc.diagram_components,

        diagram_connections:
          dtc.diagram_connections,

        source:
          "openrouter"
      });

    if (insertError) {
      console.error(
        "SUPABASE INSERT ERROR:",
        insertError
      );

      return res.status(500).json({
        success: false,
        error:
          "OpenRouter generó la información, pero Supabase no pudo guardarla.",
        details:
          insertError.message,
        supabase_code:
          insertError.code
      });
    }

    // ============================================
    // RESPUESTA FINAL
    // ============================================

    return res.status(200).json({
      success: true,
      source: "openrouter",
      saved: true,

      code: dtc.code,
      make: dtc.make,
      title: dtc.title,
      problem: dtc.problem,

      causes: dtc.causes,
      symptoms: dtc.symptoms,
      diagnosis: dtc.diagnosis,
      repairs: dtc.repairs,

      severity:
        dtc.severity,

      vehicle_years:
        dtc.vehicle_years,

      system:
        dtc.system,

      diagram_title:
        dtc.diagram_title,

      diagram_components:
        dtc.diagram_components,

      diagram_connections:
        dtc.diagram_connections
    });

  } catch (error) {
    console.error(
      "SERVER ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      error:
        error.message
    });
  }
      }
