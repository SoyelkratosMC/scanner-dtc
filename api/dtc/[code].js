import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

export default async function handler(req, res) {

  try {

    /*
    =================================================
    CONFIGURACIÓN
    =================================================
    */

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
    VALIDAR CÓDIGO
    =================================================
    */

    if (!code) {

      return res.status(400).json({

        success: false,

        error:
          "Falta el código DTC"

      });

    }


    /*
    =================================================
    VALIDAR FORMATO DTC
    =================================================
    */

    if (!/^[PBCU][0-9A-F]{4}$/.test(code)) {

      return res.status(400).json({

        success: false,

        error:
          "Código DTC inválido"

      });

    }


    /*
    =================================================
    BUSCAR EN SUPABASE
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
        "SUPABASE SEARCH ERROR:",
        error
      );

      return res.status(500).json({

        success: false,

        error:
          "Error consultando Supabase",

        details:
          error.message

      });

    }


    /*
    =================================================
    SI YA EXISTE
    =================================================
    */

    if (
      data &&
      data.length > 0
    ) {

      const dtc = data[0];


      return res.status(200).json({

        success: true,

        source:
          "supabase",

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
          dtc.severity,

        vehicle_years:
          dtc.vehicle_years,

        system:
          dtc.system || null

      });

    }


    /*
    =================================================
    CÓDIGO NUEVO
    =================================================
    */

    /*
    Aquí empieza el límite diario.
    */


    const now =
      new Date();


    const startOfDay =
      new Date(

        now.getFullYear(),

        now.getMonth(),

        now.getDate(),

        0,

        0,

        0,

        0

      );


    /*
    =================================================
    CONTAR CÓDIGOS NUEVOS DE HOY
    =================================================
    */

    const {

      count:
        todayCount,

      error:
        countError

    } = await supabase

      .from("dtc_codes")

      .select(
        "id",
        {
          count:
            "exact",
          head:
            true
        }
      )

      .gte(
        "created_at",
        startOfDay.toISOString()
      );


    /*
    =================================================
    SI created_at NO EXISTE
    =================================================
    */

    if (countError) {

      console.error(
        "COUNT ERROR:",
        countError
      );

      /*
      No detenemos el scanner.
      Continuamos con OpenRouter.
      */

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
          "Se alcanzó el límite diario de 50 códigos nuevos.",

        limit:
          MAX_NEW_CODES_PER_DAY,

        used:
          todayCount

      });

    }


    /*
    =================================================
    OPENROUTER API KEY
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

Genera información para el siguiente código DTC:

Código:
${code}

Marca:
${make || "genérica"}

IMPORTANTE:

- No inventes una falla confirmada.
- Las causas deben ser posibles causas.
- No afirmes que una pieza está dañada sin pruebas.
- Si el significado cambia según fabricante,
  indícalo.
- No inventes años específicos.
- No inventes números de piezas.
- No inventes valores eléctricos específicos.
- La información debe ser útil para un scanner automotriz.
- Responde en español.
- Devuelve solamente JSON válido.

Utiliza EXACTAMENTE esta estructura:

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

          method:
            "POST",

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

          body:
            JSON.stringify({

              model:
                "openrouter/free",

              messages: [

                {

                  role:
                    "system",

                  content:
                    "Eres especialista en diagnóstico automotriz. Devuelve solamente JSON válido."

                },

                {

                  role:
                    "user",

                  content:
                    prompt

                }

              ],

              response_format: {

                type:
                  "json_object"

              },

              temperature:
                0.2,

              max_tokens:
                1800

            })

        }

      );


    /*
    =================================================
    ERROR OPENROUTER
    =================================================
    */

    if (
      !openRouterResponse.ok
    ) {

      const errorText =
        await openRouterResponse.text();


      console.error(
        "OPENROUTER ERROR:",
        errorText
      );


      return res.status(502).json({

        success:
          false,

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

      return res.status(502).json({

        success:
          false,

        error:
          "OpenRouter no devolvió información."

      });

    }


    /*
    =================================================
    PARSEAR JSON
    =================================================
    */

    let dtc;


    try {

      dtc =
        typeof generatedText === "string"

          ? JSON.parse(
              generatedText
            )

          : generatedText;

    }

    catch (error) {

      console.error(
        "JSON ERROR:",
        generatedText
      );


      return res.status(502).json({

        success:
          false,

        error:
          "OpenRouter devolvió información inválida.",

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
        dtc.code ||
        code
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


    dtc.system =
      String(
        dtc.system ||
        "Sistema no especificado"
      );


    /*
    =================================================
    GUARDAR EN SUPABASE
    =================================================
    */

    const {

      data:
        savedData,

      error:
        saveError

    } = await supabase

      .from("dtc_codes")

      .upsert(

        {

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
            dtc.system,

          source:
            "openrouter"

        },

        {

          onConflict:
            "code"

        }

      )

      .select();


    /*
    =================================================
    ERROR AL GUARDAR
    =================================================
    */

    if (saveError) {

      console.error(
        "SUPABASE SAVE ERROR:",
        saveError
      );


      /*
      La IA sí generó el resultado,
      pero no fingimos que se guardó.
      */

      return res.status(200).json({

        success:
          true,

        source:
          "openrouter",

        saved:
          false,

        warning:
          "La información fue generada, pero no pudo guardarse en Supabase.",

        save_error:
          saveError.message,

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

    }


    /*
    =================================================
    RESPUESTA FINAL
    =================================================
    */

    return res.status(200).json({

      success:
        true,

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


  }

  catch (error) {

    console.error(
      "SERVER ERROR:",
      error
    );


    return res.status(500).json({

      success:
        false,

      error:
        error.message

    });

  }

}
