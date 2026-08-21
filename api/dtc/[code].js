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
      .limit(1);

    if (error) {
      console.error("SUPABASE ERROR:", error);

      return res.status(500).json({
        success: false,
        error: error.message
      });
    }

    if (!data || data.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Código no encontrado",
        code
      });
    }

    const dtc = data[0];

    return res.status(200).json({
      success: true,
      code: dtc.code,
      make: dtc.make,
      title: dtc.title,
      problem: dtc.problem,
      causes: dtc.causes || [],
      symptoms: dtc.symptoms || [],
      diagnosis: dtc.diagnosis || [],
      repairs: dtc.repairs || [],
      severity: dtc.severity,
      vehicle_years: dtc.vehicle_years
    });

  } catch (error) {
    console.error("SERVER ERROR:", error);

    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}
