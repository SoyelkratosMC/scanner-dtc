import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

export default async function handler(req, res) {

  try {

    const MAX_NEW_CODES_PER_DAY = 50;

    /*
    =================================================
    OBTENER CÓDIGO Y MARCA
    =================================================
    */

    const code = String(req.query.code || "")
      .toUpperCase()
      .trim();

    const make = String(req.query.make || "")
      .toLowerCase()
      .trim();


    /*
    =================================================
    VALIDAR
    =================================================
    */

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

      console.error(
        "SUPABASE SEARCH ERROR:",
        error
      );

      return res.status(500).json({

        success: false,

        error:
          "Error consultando Supabase.",

        details: {
          message: error.message,
          code: error.code,
          hint: error.hint,
          details: error.details
        }

      });

    }


    /*
    =================================================
    SI YA EXISTE → RESPUESTA INMEDIATA
    =================================================
    */

    if (data && data.length > 0) {

      const dtc = data[0];

      return res.status(200).json({

        success: true,

        source: "supabase",

        saved: true,

        code: dtc.code,

        make: dtc.make,

        title: dtc.title,

        problem: dtc.problem,

        causes:
          Array.isArray(dtc.causes)
            ? dtc.causes
            : [],

        symptoms:
          Array.isArray(dtc.symptoms)
            ? dtc.symptoms
            : [],

        diagnosis:
          Array.isArray(dtc.diagnosis)
            ? dtc.diagnosis
            : [],

        repairs:
          Array.isArray(dtc.repairs)
            ? dtc.repairs
            : [],

        severity:
          dtc.severity || "MEDIA",

        vehicle_years:
          dtc.vehicle_years ||
          "No especificado",

        system:
          dtc.system ||
          "No especificado"

      });

    }


    /*
    =================================================
    CONTAR CÓDIGOS NUEVOS DEL DÍA
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

        details: {
          message: countError.message,
          code: countError.code,
          hint: countError.hint,
          details: countError.details
        }

      });

    }


    /*
    =================================================
    LÍMITE DE 50
    =================================================
    */

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

        error:
          "Falta configurar OPENROUTER_API_KEY."

      });

    }


    /*
    =================================================
    PROMPT
    =================================================
    */

    const prompt = `

Eres un especialista en diagnóstico automotriz.

Genera información para este código DTC:

Código:
${code}

Marca:
${make || "genérica"}

IMPORTANTE:

1. No inventes una falla confirmada.
2. Las causas son POSIBLES causas.
3. No afirmes que una pieza está dañada sin pruebas.
4. Si el significado cambia según fabricante, indícalo.
5. No inventes años específicos.
6. No inventes números de piezas.
7. No inventes valores eléctricos específicos si no son confiables.
8. La información debe ser útil para un scanner automotriz.
9. Responde en español.
10. Devuelve ÚNICAMENTE JSON.
11. No uses Markdown.
12. No escribas texto antes ni después del JSON.

ESTRUCTURA EXACTA:

{
  "code": "string",
  "make": "string",
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

severity solamente puede ser:

BAJA
MEDIA
ALTA
CRÍTICA

Si no conoces los años:

"No especificado"

Código:
${code}

Marca:
${make || "genérica"}

`;


    /*
    =================================================
    LLAMAR A OPENROUTER
    =================================================
    */

    const openRouterResponse =
      await fetch(
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

            model:
              "openrouter/free",

            messages: [

              {
                role: "system",

                content:
                  "Eres especialista en diagnóstico automotriz. Devuelve únicamente JSON válido, sin Markdown."
              },

              {
                role: "user",

                content:
                  prompt
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


    /*
    =================================================
    LEER RESPUESTA
    =================================================
    */

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
          "OpenRouter no devolvió información válida.",

        details:
          openRouterData

      });

    }


    /*
    =================================================
    CONVERTIR RESPUESTA A JSON
    =================================================
    */

    let dtc;

    try {

      if (
        typeof generatedText === "object" &&
        generatedText !== null
      ) {

        dtc = generatedText;

      } else {

        let cleanText =
          String(generatedText)
            .trim();


        /*
        QUITAR MARKDOWN
        */

        cleanText =
          cleanText
            .replace(/^```json\s*/i, "")
            .replace(/^```\s*/i, "")
            .replace(/\s*```$/i, "")
            .trim();


        /*
        BUSCAR OBJETO JSON
        */

        const firstBrace =
          cleanText.indexOf("{");

        const lastBrace =
          cleanText.lastIndexOf("}");


        if (
          firstBrace === -1 ||
          lastBrace === -1 ||
          lastBrace <= firstBrace
        ) {

          throw new Error(
            "No se encontró un objeto JSON en la respuesta."
          );

        }


        cleanText =
          cleanText.substring(
            firstBrace,
            lastBrace + 1
          );


        dtc =
          JSON.parse(cleanText);

      }

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
      String(
        dtc.code || code
      )
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
        ? dtc.causes
        : [];


    dtc.symptoms =
      Array.isArray(dtc.symptoms)
        ? dtc.symptoms
        : [];


    dtc.diagnosis =
      Array.isArray(dtc.diagnosis)
        ? dtc.diagnosis
        : [];


    dtc.repairs =
      Array.isArray(dtc.repairs)
        ? dtc.repairs
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

      dtc.severity =
        "MEDIA";

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
    ASEGURAR QUE JSONB SEA VÁLIDO
    =================================================
    */

    const causes =
      JSON.parse(
        JSON.stringify(dtc.causes)
      );

    const symptoms =
      JSON.parse(
        JSON.stringify(dtc.symptoms)
      );

    const diagnosis =
      JSON.parse(
        JSON.stringify(dtc.diagnosis)
      );

    const repairs =
      JSON.parse(
        JSON.stringify(dtc.repairs)
      );


    /*
    =================================================
    GUARDAR EN SUPABASE
    =================================================
    */

    const {
      data: savedData,
      error: saveError
    } = await supabase

      .from("dtc_codes")

      .insert({

        code:
          dtc.code,

        make:
          dtc.make,

        title:
          dtc.title,

        problem:
          dtc.problem,

        causes:
          causes,

        symptoms:
          symptoms,

        diagnosis:
          diagnosis,

        repairs:
          repairs,

        severity:
          dtc.severity,

        vehicle_years:
          dtc.vehicle_years,

        system:
          dtc.system,

        source:
          "openrouter"

      })

      .select();


    /*
    =================================================
    ERROR REAL DE SUPABASE
    =================================================
    */

    if (saveError) {

      console.error(
        "SUPABASE INSERT ERROR:",
        saveError
      );

      return res.status(500).json({

        success: false,

        error:
          "OpenRouter generó la información, pero Supabase no pudo guardarla.",

        details: {

          message:
            saveError.message || null,

          code:
            saveError.code || null,

          hint:
            saveError.hint || null,

          details:
            saveError.details || null

        },

        generated: dtc

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

      .eq(
        "code",
        dtc.code
      )

      .limit(1);


    if (verifyError) {

      console.error(
        "SUPABASE VERIFY ERROR:",
        verifyError
      );

      return res.status(500).json({

        success: false,

        error:
          "El código se guardó, pero no se pudo verificar.",

        details: {

          message:
            verifyError.message,

          code:
            verifyError.code,

          hint:
            verifyError.hint,

          details:
            verifyError.details

        },

        code:
          dtc.code

      });

    }


    if (
      !verifyData ||
      verifyData.length === 0
    ) {

      return res.status(500).json({

        success: false,

        error:
          "El código fue generado pero no se encontró después de guardarlo.",

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

      source:
        "openrouter",

      saved:
        true,

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
        error.message,

      details:
        error.stack

    });

  }

}
