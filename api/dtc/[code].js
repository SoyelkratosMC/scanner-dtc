import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

export default async function handler(req, res) {

  try {

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
    VALIDAR CÓDIGO
    =================================================
    */

    if (!code) {

      return res.status(400).json({
        success: false,
        error: "Falta el código DTC"
      });

    }


    /*
    =================================================
    BUSCAR PRIMERO EN SUPABASE
    =================================================
    */

    const { data, error } = await supabase
      .from("dtc_codes")
      .select("*")
      .eq("code", code)
      .limit(1);


    /*
    =================================================
    ERROR SUPABASE
    =================================================
    */

    if (error) {

      console.error(
        "SUPABASE ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        error: error.message
      });

    }


    /*
    =================================================
    SI YA EXISTE
    =================================================
    */

    if (data && data.length > 0) {

      const dtc = data[0];

      return res.status(200).json({

        success: true,

        source: "supabase",

        code: dtc.code,

        make: dtc.make,

        title: dtc.title,

        problem: dtc.problem,

        causes: dtc.causes || [],

        symptoms: dtc.symptoms || [],

        diagnosis: dtc.diagnosis || [],

        repairs: dtc.repairs || [],

        severity: dtc.severity,

        vehicle_years:
          dtc.vehicle_years

      });

    }


    /*
    =================================================
    NO EXISTE
    → OPENROUTER
    =================================================
    */

    const openRouterKey =
      process.env.OPENROUTER_API_KEY;


    if (!openRouterKey) {

      return res.status(500).json({

        success: false,

        error:
          "El código no está en la base de datos y falta configurar OPENROUTER_API_KEY."

      });

    }


    /*
    =================================================
    PROMPT
    =================================================
    */

    const prompt = `

Eres un especialista en diagnóstico automotriz.

Necesito información sobre este código DTC:

Código:
${code}

Marca seleccionada:
${make || "genérica"}

Tu trabajo es generar información útil,
clara y prudente para un scanner automotriz.

IMPORTANTE:

1. No inventes una falla confirmada.
2. Las causas son POSIBLES causas.
3. No afirmes que una pieza está dañada sin
   pruebas de diagnóstico.
4. Si el significado puede variar entre fabricantes,
   indícalo.
5. No inventes años específicos de vehículos.
6. No inventes números de piezas.
7. No inventes voltajes o valores de prueba
   específicos si no son confiables.
8. Explica el diagnóstico de forma general.
9. La respuesta debe estar en español.
10. Devuelve solamente JSON válido.

El JSON debe tener EXACTAMENTE esta estructura:

{
  "code": "string",
  "make": "string",
  "title": "string",
  "problem": "string",
  "causes": [
    "string"
  ],
  "symptoms": [
    "string"
  ],
  "diagnosis": [
    "string"
  ],
  "repairs": [
    "string"
  ],
  "severity": "BAJA",
  "vehicle_years": "No especificado"
}

severity solamente puede ser:

BAJA
MEDIA
ALTA
CRÍTICA

Si no conoces los años/modelos exactos,
utiliza:

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

    openrouter/free selecciona automáticamente
    un modelo gratuito disponible.
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

          model:
            "openrouter/free",

          messages: [

            {

              role: "system",

              content:
                "Eres un especialista en diagnóstico automotriz. Responde únicamente con JSON válido."

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
    OBTENER RESPUESTA
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
        JSON.stringify(
          openRouterData
        )
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
        "JSON OPENROUTER ERROR:",
        jsonError
      );

      console.error(
        "RESPUESTA:",
        generatedText
      );

      return res.status(502).json({

        success: false,

        error:
          "La IA devolvió información que no pudo convertirse a JSON.",

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
      Array.isArray(
        dtc.causes
      )
      ? dtc.causes
      : [];


    dtc.symptoms =
      Array.isArray(
        dtc.symptoms
      )
      ? dtc.symptoms
      : [];


    dtc.diagnosis =
      Array.isArray(
        dtc.diagnosis
      )
      ? dtc.diagnosis
      : [];


    dtc.repairs =
      Array.isArray(
        dtc.repairs
      )
      ? dtc.repairs
      : [];


    dtc.severity =
      String(
        dtc.severity ||
        "MEDIA"
      );


    dtc.vehicle_years =
      String(
        dtc.vehicle_years ||
        "No especificado"
      );


    /*
    =================================================
    GUARDAR EN SUPABASE
    =================================================
    */

    const { error: insertError } =
      await supabase
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
            dtc.vehicle_years

        });


    /*
    =================================================
    ERROR AL GUARDAR
    =================================================
    */

    if (insertError) {

      console.error(
        "SUPABASE INSERT ERROR:",
        insertError
      );

      /*
      No detenemos el resultado.
      El usuario todavía puede recibir
      la información generada por la IA.
      */

    }


    /*
    =================================================
    RESPUESTA FINAL
    =================================================
    */

    return res.status(200).json({

      success: true,

      source: "openrouter",

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
        dtc.vehicle_years

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
