import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  try {
    const code = String(req.query.code || "").toUpperCase().trim();

    if (!code) {
      return res.status(400).json({
        success: false,
        error: "Falta el código DTC"
      });
    }

    const { data, error } = await supabase
      .from("dtc_codes")
      .select("*")
      .eq("code", code)
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error(error);

      return res.status(500).json({
        success: false,
        error: "Error consultando la base de datos"
      });
    }

    if (!data) {
      return res.status(404).json({
        success: false,
        error: "Código no encontrado",
        code
      });
    }

    return res.status(200).json({
      success: true,
      code: data.code,
      make: data.make,
      title: data.title,
      problem: data.problem,
      causes: data.causes || [],
      symptoms: data.symptoms || [],
      diagnosis: data.diagnosis || [],
      repairs: data.repairs || [],
      severity: data.severity,
      vehicle_years: data.vehicle_years
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      error: "Error interno del servidor"
    });
  }
}
