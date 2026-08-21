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
    VALIDAR FORMATO
    =================================================
    */

    if (!/^[PBCU][0-9A-F]{4}$/.test(code)) {

      return res.status(400).json({
        success: false,
        error: "Código DTC inválido",
        code
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

Eres un especialista profesional en diagnóstico
automotriz.

Necesito información REAL y útil sobre este código DTC.

CÓDIGO:
${code}

MARCA:
${make || "genérica"}

IMPORTANTE:

- Identifica correctamente el significado del código.
- Si el código es genérico OBD-II, explica su significado
  correctamente.
- Si la marca puede cambiar el significado, tenlo en cuenta.
- NO inventes una falla confirmada.
- Las causas deben ser posibilidades razonables.
- Los síntomas deben ser síntomas relacionados con el código.
- El diagnóstico debe indicar pruebas generales que un técnico
  puede realizar.
- Las reparaciones deben ser posibles soluciones después de
  confirmar la causa.
- No inventes números de piezas.
- No inventes años de vehículos.
- No inventes valores de voltaje específicos.
- Responde TODO en español.
- Debes proporcionar información completa.
- NO dejes campos vacíos.
- causes debe tener al menos 3 elementos.
- symptoms debe tener al menos 3 elementos.
- diagnosis debe tener al menos 3 elementos.
- repairs debe tener al menos 3 elementos.

Devuelve ÚNICAMENTE un objeto JSON.

La estructura OBLIGATORIA es:

{
  "code": "${code}",
  "make": "${make || "genérica"}",
  "title": "significado corto y correcto del código",
  "problem": "explicación clara del problema que representa el código",
  "causes": [
    "causa posible 1",
    "causa posible 2",
    "causa posible 3"
  ],
  "symptoms": [
    "síntoma 1",
    "síntoma 2",
    "síntoma 3"
  ],
  "diagnosis": [
    "paso de diagnóstico 1",
    "paso de diagnóstico 2",
    "paso de diagnóstico 3"
  ],
  "repairs": [
    "reparación posible 1",
    "reparación posible 2",
    "reparación posible 3"
  ],
  "severity": "MEDIA",
  "vehicle_years": "No especificado"
}

severity DEBE ser exactamente uno de:

BAJA
MEDIA
ALTA
CRÍTICA

Si no existen años específicos confiables:

"vehicle_years": "No especificado"

NO escribas Markdown.
NO escribas explicaciones fuera del JSON.
NO escribas bloques de código.
SOLO JSON.
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

          model:
            "openrouter/free",

          messages: [

            {

              role: "system",

              content:
                "Eres un especialista profesional en diagnóstico automotriz. Debes responder exclusivamente con JSON válido y completo."

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

          temperature: 0.1,

          max_tokens: 2000

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
    OBTENER RESPUESTA OPENROUTER
    =================================================
    */

    const openRouterData =
      await openRouterResponse.json();


    console.log(
      "OPENROUTER RESPONSE:",
      JSON.stringify(
        openRouterData
      )
    );


    /*
    =================================================
    EXTRAER CONTENIDO
    =================================================
    */

    let generatedText =
      openRouterData
        ?.choices?.[0]
        ?.message
        ?.content;


    /*
    =================================================
    ALGUNOS MODELOS PUEDEN DEVOLVER CONTENIDO
    COMO ARRAY
    =================================================
    */

    if (Array.isArray(generatedText)) {

      generatedText =
        generatedText
          .map(item => {

            if (
              typeof item === "string"
            ) {

              return item;

            }

            if (
              item &&
              typeof item.text === "string"
            ) {

              return item.text;

            }

            return "";

          })
          .join("");

    }


    /*
    =================================================
    VALIDAR RESPUESTA
    =================================================
    */

    if (
      !generatedText ||
      String(generatedText).trim() === ""
    ) {

      console.error(
        "OPENROUTER NO DEVOLVIÓ CONTENT:",
        JSON.stringify(
          openRouterData
        )
      );

      return res.status(502).json({

        success: false,

        error:
          "OpenRouter no devolvió información válida.",

        details:
          JSON.stringify(
            openRouterData
          )

      });

    }


    /*
    =================================================
    LIMPIAR POSIBLE MARKDOWN
    =================================================
    */

    generatedText =
      String(generatedText)
        .trim();


    if (
      generatedText.startsWith("```")
    ) {

      generatedText =
        generatedText
          .replace(
            /^```(?:json)?/i,
            ""
          )
          .replace(
            /```$/i,
            ""
          )
          .trim();

    }


    /*
    =================================================
    CONVERTIR JSON
    =================================================
    */

    let dtc;

    try {

      dtc =
        JSON.parse(
          generatedText
        );

    } catch (jsonError) {

      console.error(
        "JSON OPENROUTER ERROR:",
        jsonError
      );

      console.error(
        "RESPUESTA IA:",
        generatedText
      );

      return res.status(502).json({

        success: false,

        error:
          "La IA devolvió información que no pudo convertirse a JSON.",

        details:
          generatedText

      });

    }


    /*
    =================================================
    NORMALIZAR CÓDIGO
    =================================================
    */

    dtc.code =
      String(
        dtc.code || code
      )
      .toUpperCase()
      .trim();


    /*
    =================================================
    NORMALIZAR MARCA
    =================================================
    */

    dtc.make =
      String(
        dtc.make ||
        make ||
        "genérica"
      )
      .trim();


    /*
    =================================================
    NORMALIZAR TÍTULO
    =================================================
    */

    dtc.title =
      String(
        dtc.title || ""
      )
      .trim();


    /*
    =================================================
    NORMALIZAR PROBLEMA
    =================================================
    */

    dtc.problem =
      String(
        dtc.problem || ""
      )
      .trim();


    /*
    =================================================
    NORMALIZAR LISTAS
    =================================================
    */

    dtc.causes =
      Array.isArray(
        dtc.causes
      )
      ? dtc.causes
          .map(
            item => String(item).trim()
          )
          .filter(Boolean)
      : [];


    dtc.symptoms =
      Array.isArray(
        dtc.symptoms
      )
      ? dtc.symptoms
          .map(
            item => String(item).trim()
          )
          .filter(Boolean)
      : [];


    dtc.diagnosis =
      Array.isArray(
        dtc.diagnosis
      )
      ? dtc.diagnosis
          .map(
            item => String(item).trim()
          )
          .filter(Boolean)
      : [];


    dtc.repairs =
      Array.isArray(
        dtc.repairs
      )
      ? dtc.repairs
          .map(
            item => String(item).trim()
          )
          .filter(Boolean)
      : [];


    /*
    =================================================
    NORMALIZAR SEVERIDAD
    =================================================
    */

    const severidades = [
      "BAJA",
      "MEDIA",
      "ALTA",
      "CRÍTICA"
    ];


    dtc.severity =
      String(
        dtc.severity ||
        "MEDIA"
      )
      .toUpperCase()
      .trim();


    if (
      !severidades.includes(
        dtc.severity
      )
    ) {

      dtc.severity =
        "MEDIA";

    }


    /*
    =================================================
    AÑOS
    =================================================
    */

    dtc.vehicle_years =
      String(
        dtc.vehicle_years ||
        "No especificado"
      )
      .trim();


    /*
    =================================================
    VALIDACIÓN FUERTE
    =================================================

    NO guardamos información incompleta.
    */

    const respuestaIncompleta =
      !dtc.title ||
      !dtc.problem ||
      dtc.causes.length < 3 ||
      dtc.symptoms.length < 3 ||
      dtc.diagnosis.length < 3 ||
      dtc.repairs.length < 3;


    if (respuestaIncompleta) {

      console.error(
        "RESPUESTA IA INCOMPLETA:",
        JSON.stringify(
          dtc
        )
      );

      return res.status(502).json({

        success: false,

        error:
          "OpenRouter devolvió información incompleta. No se guardó el código en Supabase.",

        details:
          dtc

      });

    }


    /*
    =================================================
    ASEGURAR QUE EL CÓDIGO COINCIDA
    =================================================
    */

    if (
      dtc.code !== code
    ) {

      dtc.code =
        code;

    }


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
      Si el código ya fue agregado por otra
      solicitud al mismo tiempo, todavía
      devolvemos la información generada.
      */

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
