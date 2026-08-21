import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  try {
    const code = String(req.query.code || "")
      .toUpperCase()
      .trim();

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
      .maybeSingle();

    if (error) {
      console.error("SUPABASE ERROR:", error);

      return res.status(500).json({
        success: false,
        error: error.message
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
    console.error("SERVER ERROR:", error);

    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}
