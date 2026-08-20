export default async function handler(req, res) {
  try {
    const code = String(req.query.code || "")
      .trim()
      .toUpperCase();

    const make = String(req.query.make || "")
      .trim()
      .toLowerCase();

    if (!code) {
      return res.status(400).json({
        error: "Falta el código DTC"
      });
    }

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

    const baseURL =
      `${process.env.SUPABASE_URL}/rest/v1/dtc_codes`;

    const headers = {
      "apikey": process.env.SUPABASE_KEY,
      "Authorization": `Bearer ${process.env.SUPABASE_KEY}`,
      "Content-Type": "application/json"
    };


    // ==========================================
    // 1. BUSCAR CÓDIGO + MARCA
    // ==========================================

    if (make) {

      const marcaURL =
        `${baseURL}?code=eq.${encodeURIComponent(code)}` +
        `&make=eq.${encodeURIComponent(make)}` +
        `&select=*`;

      const marcaResponse =
        await fetch(marcaURL, {
          headers
        });

      const marcaData =
        await marcaResponse.json();

      if (!marcaResponse.ok) {
        return res.status(500).json({
          error: "Error consultando Supabase",
          details: marcaData
        });
      }

      if (marcaData.length > 0) {
        return res.status(200).json({
          success: true,
          type: "manufacturer",
          ...marcaData[0]
        });
      }
    }


    // ==========================================
    // 2. BUSCAR CÓDIGO GENÉRICO
    // ==========================================

    const genericURL =
      `${baseURL}?code=eq.${encodeURIComponent(code)}` +
      `&make=is.null&select=*`;

    const genericResponse =
      await fetch(genericURL, {
        headers
      });

    const genericData =
      await genericResponse.json();

    if (!genericResponse.ok) {
      return res.status(500).json({
        error: "Error consultando códigos genéricos",
        details: genericData
      });
    }

    if (genericData.length > 0) {
      return res.status(200).json({
        success: true,
        type: "generic",
        ...genericData[0]
      });
    }


    // ==========================================
    // 3. CÓDIGO NO ENCONTRADO
    // ==========================================

    return res.status(404).json({
      error: "Código no encontrado",
      code,
      make
    });


  } catch (error) {

    console.error(error);

    return res.status(500).json({
      error: "Error interno del servidor",
      details: error.message
    });

  }
}
