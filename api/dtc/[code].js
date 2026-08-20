export default async function handler(req, res) {
  const code = req.query.code?.toUpperCase();
  const make = req.query.make?.toLowerCase();

  if (!code) {
    return res.status(400).json({
      error: "Falta el código DTC"
    });
  }

  const url = `${process.env.SUPABASE_URL}/rest/v1/dtc_codes?code=eq.${encodeURIComponent(code)}&select=*`;

  try {
    const response = await fetch(url, {
      headers: {
        "apikey": process.env.SUPABASE_KEY,
        "Authorization": `Bearer ${process.env.SUPABASE_KEY}`,
        "Content-Type": "application/json"
      }
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: "Error de Supabase",
        details: data
      });
    }

    if (!data.length) {
      return res.status(404).json({
        error: "Código no encontrado"
      });
    }

    let resultado = data;

    if (make) {
      const porMarca = data.filter(
        item => item.make?.toLowerCase() === make
      );

      if (porMarca.length) {
        resultado = porMarca;
      }
    }

    return res.status(200).json(resultado[0]);

  } catch (error) {
    return res.status(500).json({
      error: "Error interno",
      details: error.message
    });
  }
}
