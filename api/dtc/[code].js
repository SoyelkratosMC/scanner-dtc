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

    /*
    =================================================
    BUSCAR EN SUPABASE
    =================================================
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
      console.error("SUPABASE SEARCH ERROR:", error);

      return res.status(500).json({
        success: false,
        error: "Error consultando Supabase",
        details: error.message
      });
    }

    /*
    =================================================
    SI EXISTE
    =================================================
    */

    if (data && data.length > 0) {
      const dtc = data[0];

      /*
      Detectar si la información guardada está incompleta.
      */

      const incomplete =
        !Array.isArray(dtc.causes) ||
        dtc.causes.length === 0 ||
        !Array.isArray(dtc.symptoms) ||
        dtc.symptoms.length === 0 ||
        !Array.isArray(dtc.diagnosis) ||
        dtc.diagnosis.length === 0 ||
        !Array.isArray(dtc.repairs) ||
        dtc.repairs.length === 0;

      /*
      =================================================
      SI ESTÁ COMPLETO → DEVOLVER INSTANTÁNEAMENTE
      =================================================
      */

      if (!incomplete) {
        return res.status(200).json({
          success: true,
          source: "supabase",
          saved: true,

          code: dtc.code,
          make: dtc.make,
          title: dtc.title,
          problem: dtc.problem,

          causes: Array.isArray(dtc.causes)
            ? dtc.causes
            : [],

          symptoms: Array.isArray(dtc.symptoms)
            ? dtc.symptoms
            : [],

          diagnosis: Array.isArray(dtc.diagnosis)
            ? dtc.diagnosis
            : [],

          repairs: Array.isArray(dtc.repairs)
            ? dtc.repairs
            : [],

          severity: dtc.severity || "MEDIA",

          vehicle_years:
            dtc.vehicle_years || "No especificado",

          system:
            dtc.system || "No especificado"
        });
      }

      /*
      =================================================
      EXISTE PERO ESTÁ INCOMPLETO
      → VOLVER A GENERAR
      =================================================
      */

      console.log(
        `DTC ${code} encontrado pero incompleto. Regenerando información...`
      );
    }

    /*
    =================================================
    OPENROUTER
    =================================================
    */

    const openRouterKey =
      process.env.OPENROUTER_API_KEY;

    if (!openRouterKey) {
      return res.status(500).json({
        success: false,
        error: "Falta configurar OPENROUTER_API_KEY."
      });
    }

    /*
    =================================================
    PROMPT
    =================================================
    */

    const prompt = `
Eres un especialista profesional en diagnóstico automotriz.

Genera información clara y útil sobre este código DTC.

Código:
${code}

Marca:
${make || "genérica"}

IMPORTANTE:

- No inventes una falla confirmada.
- Las causas deben ser POSIBLES causas.
- No afirmes que una pieza está dañada sin pruebas.
- Si el significado cambia según fabricante, indícalo.
- No inventes años específicos.
- No inventes números de piezas.
- No inventes valores eléctricos específicos si no son confiables.
- La información debe ser útil para un scanner automotriz.
- Responde en español.
- Todos los arreglos deben ser acciones razonables de diagnóstico/reparación.
- NO dejes causes, symptoms, diagnosis ni repairs vacíos.
- Cada uno debe contener varias opciones útiles.
- Devuelve solamente JSON válido.

La estructura EXACTA debe ser:

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
  "system": "string"
}

severity solamente puede ser:

BAJA
MEDIA
ALTA
CRÍTICA

Si no conoces los años/modelos exactos:

"No especificado"

IMPORTANTE:
causes, symptoms, diagnosis y repairs NO pueden ser arrays vacíos.
`;

    /*
    =================================================
    LLAMAR A OPENROUTER
    =================================================
    */

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
                "Eres especialista en diagnóstico automotriz. Devuelve solamente JSON válido y nunca dejes vacíos causes, symptoms, diagnosis o repairs."
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

          max_tokens: 1800
        })
      }
    );

    /*
    =================================================
    ERROR OPENROUTER
    =================================================
    */

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

    const generatedText =
      openRouterData
        ?.choices?.[0]
        ?.message
        ?.content;

    if (!generatedText) {
      console.error(
        "OPENROUTER RESPONSE:",
        JSON.stringify(openRouterData)
      );

      return res.status(502).json({
        success: false,
        error:
          "OpenRouter no devolvió información válida."
      });
    }

    /*
    =================================================
    CONVERTIR JSON
    =================================================
    */

    let dtc;

    try {
      dtc =
        typeof generatedText === "string"
          ? JSON.parse(generatedText)
          : generatedText;

    } catch (jsonError) {
      console.error(
        "JSON PARSE ERROR:",
        jsonError
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

    /*
    =================================================
    NORMALIZAR
    =================================================
    */

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

    /*
    =================================================
    COMPROBAR QUE LA IA REALMENTE GENERÓ TODO
    =================================================
    */

    if (
      dtc.causes.length === 0 ||
      dtc.symptoms.length === 0 ||
      dtc.diagnosis.length === 0 ||
      dtc.repairs.length === 0
    ) {
      console.error(
        "OPENROUTER INCOMPLETE:",
        JSON.stringify(dtc)
      );

      return res.status(502).json({
        success: false,
        error:
          "OpenRouter devolvió información incompleta. No se guardó el código.",
        details: dtc
      });
    }

    /*
    =================================================
    GUARDAR / ACTUALIZAR SUPABASE
    =================================================
    */

    let savedData;
    let saveError;

    /*
    Si el código ya existía pero estaba incompleto,
    hacemos UPDATE.

    Si no existía, hacemos INSERT.
    */

    if (data && data.length > 0) {
      const existingId = data[0].id;

      const result = await supabase
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
          source: "openrouter"
        })
        .eq("id", existingId)
        .select();

      savedData = result.data;
      saveError = result.error;

    } else {

      /*
      =================================================
      CONTAR NUEVOS DEL DÍA
      =================================================
      */

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
        .select(
          "id",
          {
            count: "exact",
            head: true
          }
        )
        .gte(
          "created_at",
          startOfDay.toISOString()
        );

      if (countError) {
        console.error(
          "COUNT ERROR:",
          countError
        );

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

      const result = await supabase
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
        .select();

      savedData = result.data;
      saveError = result.error;
    }

    /*
    =================================================
    ERROR SUPABASE
    =================================================
    */

    if (saveError) {
      console.error(
        "SUPABASE SAVE ERROR:",
        saveError
      );

      return res.status(500).json({
        success: false,

        error:
          "OpenRouter generó la información, pero Supabase no pudo guardarla.",

        details:
          saveError.message,

        supabase_code:
          saveError.code,

        code:
          dtc.code
      });
    }

    /*
    =================================================
    VERIFICAR GUARDADO
    =================================================
    */

    const {
      data: verifyData,
      error: verifyError
    } = await supabase
      .from("dtc_codes")
      .select(
        "id, code, source, created_at"
      )
      .eq("code", dtc.code)
      .limit(1);

    if (verifyError) {
      console.error(
        "VERIFY ERROR:",
        verifyError
      );
    }

    if (
      !verifyData ||
      verifyData.length === 0
    ) {
      return res.status(500).json({
        success: false,

        error:
          "La información fue generada pero no se encontró después de guardarla.",

        code:
          dtc.code
      });
    }

    /*
    =================================================
    RESPUESTA FINAL
    =================================================
    */

    return res.status(200).json({
      success: true,

      source: "openrouter",

      saved: true,

      updated:
        data && data.length > 0,

      code:
        dtc.code,

      make:
        dtc.make,

      title:
        dtc.title,

      problem:
        dtc.problem,

      causes:
        dtc.causes,

      symptoms:
        dtc.symptoms,

      diagnosis:
        dtc.diagnosis,

      repairs:
        dtc.repairs,

      severity:
        dtc.severity,

      vehicle_years:
        dtc.vehicle_years,

      system:
        dtc.system
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
