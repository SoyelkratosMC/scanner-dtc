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
    SI YA EXISTE EN SUPABASE
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
    NO EXISTE EN SUPABASE
    → CONSULTAR GEMINI
    =================================================
    */

    const geminiKey =
      process.env.GEMINI_API_KEY;


    if (!geminiKey) {

      return res.status(500).json({

        success: false,

        error:
          "El código no está en la base de datos y falta configurar GEMINI_API_KEY."

      });

    }


    /*
    =================================================
    PROMPT
    =================================================
    */

    const prompt = `

Eres un especialista en diagnóstico automotriz.

Necesito información técnica sobre este código DTC:

Código: ${code}

Marca seleccionada:
${make || "genérica"}

Genera información útil para un scanner
automotriz.

IMPORTANTE:

- No inventes una falla confirmada.
- Explica que las causas son posibles causas.
- Si el significado puede variar según fabricante,
  indícalo.
- No inventes años específicos si no tienes
  información confiable.
- La información debe ser clara y técnica.
- Devuelve ÚNICAMENTE JSON válido.
- No uses Markdown.
- No agregues explicaciones fuera del JSON.

Necesito exactamente estos campos:

{
  "code": "string",
  "make": "string",
  "title": "string",
  "problem": "string",
  "causes": ["string"],
  "symptoms": ["string"],
  "diagnosis": ["string"],
  "repairs": ["string"],
  "severity": "BAJA | MEDIA | ALTA | CRÍTICA",
  "vehicle_years": "string"
}

Código DTC:
${code}

Marca:
${make || "genérica"}

`;


    /*
    =================================================
    LLAMAR A GEMINI
    =================================================
    */

    const geminiResponse = await fetch(

      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent",

      {

        method: "POST",

        headers: {

          "Content-Type":
            "application/json",

          "x-goog-api-key":
            geminiKey

        },

        body: JSON.stringify({

          contents: [

            {

              role: "user",

              parts: [

                {
                  text: prompt
                }

              ]

            }

          ],

          tools: [

            {
              google_search: {}
            }

          ]

        })

      }

    );


    /*
    =================================================
    ERROR GEMINI
    =================================================
    */

    if (!geminiResponse.ok) {

      const errorText =
        await geminiResponse.text();

      console.error(
        "GEMINI ERROR:",
        errorText
      );

      return res.status(502).json({

        success: false,

        error:
          "Gemini no pudo generar la información.",

        details:
          errorText

      });

    }


    /*
    =================================================
    LEER RESPUESTA GEMINI
    =================================================
    */

    const geminiData =
      await geminiResponse.json();


    const parts =
      geminiData
        ?.candidates?.[0]
        ?.content?.parts || [];


    const generatedText =
      parts
        .map(part => part.text || "")
        .join("")
        .trim();


    if (!generatedText) {

      console.error(
        "GEMINI RESPONSE:",
        JSON.stringify(
          geminiData
        )
      );

      return res.status(502).json({

        success: false,

        error:
          "Gemini no devolvió información válida."

      });

    }


    /*
    =================================================
    LIMPIAR JSON
    =================================================
    */

    let cleanText =
      generatedText
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();


    /*
    =================================================
    CONVERTIR RESPUESTA A JSON
    =================================================
    */

    let dtc;

    try {

      dtc =
        JSON.parse(
          cleanText
        );

    } catch (jsonError) {

      console.error(
        "JSON GEMINI ERROR:",
        jsonError
      );

      console.error(
        "GEMINI TEXT:",
        generatedText
      );

      return res.status(502).json({

        success: false,

        error:
          "Gemini devolvió una respuesta que no es JSON válido.",

        details:
          generatedText

      });

    }


    /*
    =================================================
    NORMALIZAR DATOS
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
    GUARDAR AUTOMÁTICAMENTE EN SUPABASE
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
    SI NO PUDO GUARDAR
    =================================================
    */

    if (insertError) {

      console.error(
        "SUPABASE INSERT ERROR:",
        insertError
      );

      /*
      No detenemos la respuesta.
      La información de Gemini todavía
      puede mostrarse al usuario.
      */

    }


    /*
    =================================================
    DEVOLVER RESULTADO
    =================================================
    */

    return res.status(200).json({

      success: true,

      source: "gemini",

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
