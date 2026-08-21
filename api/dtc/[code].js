import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);


/*
=================================================
FUNCIÓN PRINCIPAL
=================================================
*/

export default async function handler(req, res) {

  try {

    /*
    =========================================
    OBTENER CÓDIGO
    =========================================
    */

    const code = String(req.query.code || "")
      .toUpperCase()
      .trim();


    const make = String(req.query.make || "")
      .toLowerCase()
      .trim();


    /*
    =========================================
    VALIDAR CÓDIGO
    =========================================
    */

    if (!code) {

      return res.status(400).json({

        success: false,

        error: "Falta el código DTC"

      });

    }


    /*
    =========================================
    BUSCAR PRIMERO EN SUPABASE
    =========================================
    */

    const { data, error } = await supabase

      .from("dtc_codes")

      .select("*")

      .eq("code", code)

      .limit(1);


    /*
    =========================================
    ERROR SUPABASE
    =========================================
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
    =========================================
    SI YA EXISTE
    =========================================
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
    =========================================
    SI NO EXISTE:
    USAR GEMINI
    =========================================
    */

    const geminiKey =
      process.env.GEMINI_API_KEY;


    if (!geminiKey) {

      console.error(
        "FALTA GEMINI_API_KEY"
      );

      return res.status(500).json({

        success: false,

        error:
          "El código no está en la base de datos y falta configurar GEMINI_API_KEY."

      });

    }


    /*
    =========================================
    ESQUEMA JSON
    =========================================
    */

    const schema = {

      type: "object",

      properties: {

        code: {
          type: "string"
        },

        make: {
          type: "string"
        },

        title: {
          type: "string"
        },

        problem: {
          type: "string"
        },

        causes: {

          type: "array",

          items: {
            type: "string"
          }

        },

        symptoms: {

          type: "array",

          items: {
            type: "string"
          }

        },

        diagnosis: {

          type: "array",

          items: {
            type: "string"
          }

        },

        repairs: {

          type: "array",

          items: {
            type: "string"
          }

        },

        severity: {

          type: "string"
        },

        vehicle_years: {

          type: "string"
        }

      },

      required: [

        "code",
        "make",
        "title",
        "problem",
        "causes",
        "symptoms",
        "diagnosis",
        "repairs",
        "severity",
        "vehicle_years"

      ]

    };


    /*
    =========================================
    PROMPT PARA GEMINI
    =========================================
    */

    const prompt = `

Eres un especialista en diagnóstico automotriz.

Necesito información técnica sobre este código DTC:

Código: ${code}

Marca seleccionada por el usuario:
${make || "genérica"}

Investiga el significado del código y proporciona
información automotriz útil y prudente.

IMPORTANTE:

- No inventes especificaciones.
- Si la información depende del fabricante,
  indícalo claramente.
- Distingue entre causas posibles y una causa
  confirmada.
- No afirmes que una pieza está defectuosa sin
  diagnóstico.
- La información debe ser comprensible para una
  persona que utiliza un escáner DTC.
- Devuelve exclusivamente la estructura JSON
  solicitada.

Organiza la información en:

code
make
title
problem
causes
symptoms
diagnosis
repairs
severity
vehicle_years

El campo causes debe ser una lista.

El campo symptoms debe ser una lista.

El campo diagnosis debe ser una lista ordenada
con los pasos generales de diagnóstico.

El campo repairs debe ser una lista de posibles
reparaciones.

severity debe indicar una gravedad general como
BAJA, MEDIA, ALTA o CRÍTICA.

vehicle_years debe contener los años/modelos
si existe información confiable. Si no se pueden
determinar, utiliza "No especificado".

`;


    /*
    =========================================
    CONSULTAR GEMINI
    =========================================
    */

    const geminiResponse = await fetch(

      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" +
      encodeURIComponent(geminiKey),

      {

        method: "POST",

        headers: {

          "Content-Type":
            "application/json"

        },

        body: JSON.stringify({

          contents: [

            {

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

          ],

          generationConfig: {

            responseMimeType:
              "application/json",

            responseSchema:
              schema

          }

        })

      }

    );


    /*
    =========================================
    ERROR GEMINI
    =========================================
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
    =========================================
    OBTENER RESPUESTA
    =========================================
    */

    const geminiData =
      await geminiResponse.json();


    const generatedText =
      geminiData
        ?.candidates?.[0]
        ?.content
        ?.parts?.[0]
        ?.text;


    if (!generatedText) {

      console.error(
        "GEMINI RESPUESTA:",
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
    =========================================
    CONVERTIR JSON
    =========================================
    */

    let dtc;

    try {

      dtc =
        JSON.parse(
          generatedText
        );

    } catch (jsonError) {

      console.error(
        "JSON GEMINI ERROR:",
        jsonError
      );

      console.error(
        "RESPUESTA GEMINI:",
        generatedText
      );


      return res.status(502).json({

        success: false,

        error:
          "Gemini devolvió información que no pudo convertirse a JSON."

      });

    }


    /*
    =========================================
    NORMALIZAR DATOS
    =========================================
    */

    dtc.code =
      String(
        dtc.code || code
      )
      .toUpperCase()
      .trim();


    dtc.make =
      String(
        dtc.make || make || "genérica"
      );


    dtc.title =
      String(
        dtc.title || "Código DTC"
      );


    dtc.problem =
      String(
        dtc.problem || "No especificado."
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
        dtc.severity || "MEDIA"
      );


    dtc.vehicle_years =
      String(
        dtc.vehicle_years ||
        "No especificado"
      );


    /*
    =========================================
    GUARDAR EN SUPABASE
    =========================================

    Así la próxima consulta no necesita
    volver a llamar a Gemini.
    */

    const { error: insertError } =
      await supabase

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

          vehicle_years:
            dtc.vehicle_years

        });


    /*
    =========================================
    ERROR AL GUARDAR
    =========================================
    */

    if (insertError) {

      console.error(
        "SUPABASE INSERT ERROR:",
        insertError
      );

      /*
      Aunque no se haya podido guardar,
      devolvemos la información generada
      para que el usuario pueda verla.
      */

    }


    /*
    =========================================
    DEVOLVER RESULTADO
    =========================================
    */

    return res.status(200).json({

      success: true,

      source: "gemini",

      code: dtc.code,

      make: dtc.make,

      title: dtc.title,

      problem: dtc.problem,

      causes: dtc.causes,

      symptoms: dtc.symptoms,

      diagnosis: dtc.diagnosis,

      repairs: dtc.repairs,

      severity: dtc.severity,

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

      error: error.message

    });

  }

            }
