export default async function handler(req, res) {
  try {
    // ==============================
    // OBTENER DATOS DE LA URL
    // ==============================

    const code = String(req.query.code || "")
      .trim()
      .toUpperCase();

    const make = String(req.query.make || "")
      .trim()
      .toLowerCase();


    // ==============================
    // COMPROBAR CÓDIGO
    // ==============================

    if (!code) {
      return res.status(400).json({
        error: "Falta el código DTC"
      });
    }


    // ==============================
    // COMPROBAR VARIABLES
    // ==============================

    if (!process.env.SUPABASE_URL) {
      return res.status(500).json({
        error: "Falta SUPABASE_URL en Vercel"
      });
    }

    if (!process.env.SUPABASE_KEY) {
      return res.status(500).json({
        error: "Falta SUPABASE_KEY en Vercel"
      });
    }


    // ==============================
    // URL DE SUPABASE
    // ==============================

    const supabaseURL =
      process.env.SUPABASE_URL;

    const supabaseKey =
      process.env.SUPABASE_KEY;


    // ==============================
    // CONSULTAR DTC
    // ==============================

    const url =
      `${supabaseURL}/rest/v1/dtc_codes` +
      `?code=eq.${encodeURIComponent(code)}` +
      `&select=*`;


    console.log("Consultando:", url);


    const response = await fetch(url, {
      method: "GET",

      headers: {
        "apikey": supabaseKey,

        "Authorization":
          `Bearer ${supabaseKey}`,

        "Content-Type":
          "application/json"
      }
    });


    // ==============================
    // LEER RESPUESTA
    // ==============================

    const data =
      await response.json();


    // ==============================
    // ERROR SUPABASE
    // ==============================

    if (!response.ok) {

      console.error(
        "Supabase:",
        data
      );

      return res.status(500).json({
        error: "Error de Supabase",
        details: data
      });
    }


    // ==============================
    // NO ENCONTRADO
    // ==============================

    if (!Array.isArray(data) || data.length === 0) {

      return res.status(404).json({
        error: "Código no encontrado",
        code: code,
        make: make
      });
    }


    // ==============================
    // BUSCAR MARCA
    // ==============================

    let resultado = data[0];


    if (make) {

      const mismoFabricante =
        data.find(item =>
          String(item.make || "")
            .toLowerCase() === make
        );


      if (mismoFabricante) {

        resultado =
          mismoFabricante;

      }

    }


    // ==============================
    // RESPUESTA
    // ==============================

    return res.status(200).json({

      success: true,

      code:
        resultado.code,

      make:
        resultado.make,

      title:
        resultado.title,

      problem:
        resultado.problem,

      causes:
        resultado.causes || [],

      symptoms:
        resultado.symptoms || [],

      diagnosis:
        resultado.diagnosis || [],

      repairs:
        resultado.repairs || [],

      severity:
        resultado.severity || null

    });


  } catch (error) {

    console.error(error);

    return res.status(500).json({

      error:
        "Error interno del servidor",

      details:
        error.message

    });

  }
      }
