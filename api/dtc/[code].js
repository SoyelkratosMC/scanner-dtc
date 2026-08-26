import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const OPENROUTER_URL =
  "https://openrouter.ai/api/v1/chat/completions";

/* ================= UTILIDADES ================= */

function clean(value){
  return String(value ?? "").trim();
}

function array(value){
  return Array.isArray(value) ? value : [];
}

function errorText(error){

  if(!error){
    return "Error desconocido.";
  }

  if(typeof error === "string"){
    return error;
  }

  if(error.message){
    return String(error.message);
  }

  if(error.error){

    if(typeof error.error === "string"){
      return error.error;
    }

    try{
      return JSON.stringify(error.error);
    }catch{}
  }

  try{
    return JSON.stringify(error);
  }catch{
    return String(error);
  }
}

function send(res,status,data){

  return res
    .status(status)
    .json(data);
}

/* ================= IA ================= */

async function askAI(prompt){

  const key =
    process.env.OPENROUTER_API_KEY;

  if(!key){

    throw new Error(
      "Falta OPENROUTER_API_KEY en las variables de Vercel."
    );
  }

  const response =
    await fetch(
      OPENROUTER_URL,
      {
        method:"POST",

        headers:{
          "Authorization":
            "Bearer " + key,

          "Content-Type":
            "application/json",

          "HTTP-Referer":
            "https://scanner-dtc.vercel.app",

          "X-Title":
            "Scanner DTC"
        },

        body:JSON.stringify({

          model:"openrouter/free",

          messages:[

            {
              role:"system",

              content:
                "Eres especialista en diagnóstico automotriz. Responde en español. Devuelve únicamente JSON válido, sin markdown."
            },

            {
              role:"user",
              content:prompt
            }

          ],

          temperature:0.2,

          max_tokens:2500
        })
      }
    );

  const raw =
    await response.text();

  if(!response.ok){

    let message =
      "Error de OpenRouter.";

    try{

      const data =
        JSON.parse(raw);

      message =
        data?.error?.message ||
        data?.error ||
        message;

    }catch{}

    throw new Error(
      errorText(message)
    );
  }

  let data;

  try{

    data =
      JSON.parse(raw);

  }catch{

    throw new Error(
      "OpenRouter no devolvió JSON."
    );
  }

  let content =
    data?.choices?.[0]?.message?.content;

  if(Array.isArray(content)){

    content =
      content
        .map(item =>
          item?.text || ""
        )
        .join("");
  }

  if(!content){

    throw new Error(
      "La IA no devolvió contenido."
    );
  }

  content =
    String(content)
      .replace(/^```json\s*/i,"")
      .replace(/^```\s*/i,"")
      .replace(/\s*```$/i,"")
      .trim();

  const start =
    content.indexOf("{");

  const end =
    content.lastIndexOf("}");

  if(start >= 0 && end > start){

    content =
      content.slice(
        start,
        end + 1
      );
  }

  try{

    return JSON.parse(content);

  }catch{

    throw new Error(
      "La IA devolvió JSON inválido."
    );
  }
}

/* ================= DTC ================= */

async function getDTC(req,res){

  let code =
    clean(req.query.code)
      .replace(/\s+/g,"")
      .toUpperCase();

  const make =
    clean(req.query.make)
      .toLowerCase();

  /*
    Ejemplos aceptados:

    P2122
    P2123
    P0300
    P0456
    B1234
    C1234
    U0100
  */

  if(!/^[PBCU][0-9A-F]{4}$/i.test(code)){

    return send(
      res,
      400,
      {
        success:false,

        error:
          "Código DTC inválido. Usa por ejemplo P2122."
      }
    );
  }

  /* BUSCAR EN SUPABASE */

  const result =
    await supabase
      .from("dtc_codes")
      .select("*")
      .eq("code",code)
      .limit(1);

  if(result.error){

    return send(
      res,
      500,
      {
        success:false,

        error:
          "Error consultando Supabase.",

        details:
          errorText(result.error)
      }
    );
  }

  /* ENCONTRADO */

  if(result.data?.length){

    const d =
      result.data[0];

    return send(
      res,
      200,
      {
        success:true,

        source:"supabase",

        saved:true,

        code:d.code,

        make:d.make,

        title:d.title,

        problem:d.problem,

        causes:array(d.causes),

        symptoms:array(d.symptoms),

        diagnosis:array(d.diagnosis),

        repairs:array(d.repairs),

        severity:
          d.severity || "MEDIA",

        vehicle_years:
          d.vehicle_years ||
          "No especificado",

        system:
          d.system ||
          "No especificado"
      }
    );
  }

  /* GENERAR CON IA */

  let d;

  try{

    d =
      await askAI(`

Genera información técnica educativa
para el código DTC ${code}.

Marca:
${make || "genérica"}

Devuelve exactamente este JSON:

{
  "code":"${code}",
  "make":"${make || "genérica"}",
  "title":"",
  "problem":"",
  "causes":[],
  "symptoms":[],
  "diagnosis":[],
  "repairs":[],
  "severity":"MEDIA",
  "vehicle_years":"No especificado",
  "system":""
}

severity solamente puede ser:

BAJA
MEDIA
ALTA
CRÍTICA

No inventes:
- números de piezas
- pines
- colores de cables
- voltajes específicos

Si un dato no es seguro,
usa información general.

`);
  
  }catch(error){

    return send(
      res,
      502,
      {
        success:false,
        error:errorText(error)
      }
    );
  }

  /* LIMPIAR */

  d.code =
    clean(d.code || code)
      .replace(/\s+/g,"")
      .toUpperCase();

  d.make =
    clean(
      d.make ||
      make ||
      "genérica"
    ).toLowerCase();

  d.title =
    clean(
      d.title ||
      "Código DTC"
    );

  d.problem =
    clean(
      d.problem ||
      "Sin información."
    );

  d.causes =
    array(d.causes);

  d.symptoms =
    array(d.symptoms);

  d.diagnosis =
    array(d.diagnosis);

  d.repairs =
    array(d.repairs);

  const severity =
    clean(d.severity)
      .toUpperCase();

  d.severity =
    ["BAJA","MEDIA","ALTA","CRÍTICA"]
      .includes(severity)
      ? severity
      : "MEDIA";

  d.vehicle_years =
    clean(
      d.vehicle_years ||
      "No especificado"
    );

  d.system =
    clean(
      d.system ||
      "No especificado"
    );

  /* GUARDAR */

  const saved =
    await supabase
      .from("dtc_codes")
      .insert({

        code:d.code,

        make:d.make,

        title:d.title,

        problem:d.problem,

        causes:d.causes,

        symptoms:d.symptoms,

        diagnosis:d.diagnosis,

        repairs:d.repairs,

        severity:d.severity,

        vehicle_years:
          d.vehicle_years,

        system:d.system,

        source:"openrouter"

      })
      .select()
      .limit(1);

  if(saved.error){

    /*
      Si otro proceso ya lo guardó,
      intentamos recuperarlo.
    */

    if(saved.error.code === "23505"){

      const again =
        await supabase
          .from("dtc_codes")
          .select("*")
          .eq("code",d.code)
          .limit(1);

      if(!again.error &&
         again.data?.length){

        const x =
          again.data[0];

        return send(
          res,
          200,
          {
            success:true,
            source:"supabase",
            saved:true,
            code:x.code,
            make:x.make,
            title:x.title,
            problem:x.problem,
            causes:array(x.causes),
            symptoms:array(x.symptoms),
            diagnosis:array(x.diagnosis),
            repairs:array(x.repairs),
            severity:x.severity || "MEDIA",
            vehicle_years:
              x.vehicle_years ||
              "No especificado",
            system:
              x.system ||
              "No especificado"
          }
        );
      }
    }

    return send(
      res,
      500,
      {
        success:false,

        error:
          "La IA respondió, pero Supabase no pudo guardar el DTC.",

        details:
          errorText(saved.error)
      }
    );
  }

  return send(
    res,
    200,
    {
      success:true,
      source:"openrouter",
      saved:true,
      ...d
    }
  );
}

/* ================= DIAGRAMA ================= */

async function getDiagram(req,res){

  const make =
    clean(req.query.make);

  const model =
    clean(req.query.model);

  const year =
    clean(req.query.year);

  const system =
    clean(req.query.system);

  if(
    !make ||
    !model ||
    !year ||
    !system
  ){

    return send(
      res,
      400,
      {
        success:false,

        error:
          "Completa marca, modelo, año y sistema."
      }
    );
  }

  /* BUSCAR */

  const result =
    await supabase
      .from("dtc_diagrams")
      .select("*")
      .eq("make",make)
      .eq("model",model)
      .eq("vehicle_year",year)
      .eq("system",system)
      .limit(1);

  if(result.error){

    return send(
      res,
      500,
      {
        success:false,

        error:
          "Error consultando diagramas.",

        details:
          errorText(result.error)
      }
    );
  }

  if(result.data?.length){

    const d =
      result.data[0];

    return send(
      res,
      200,
      {
        success:true,

        source:"supabase",

        saved:true,

        make:d.make,

        model:d.model,

        year:d.vehicle_year,

        system:d.system,

        title:d.title,

        description:d.description,

        components:
          array(d.components),

        connections:
          array(d.connections),

        warnings:
          array(d.warnings)
      }
    );
  }

  /* IA */

  let d;

  try{

    d =
      await askAI(`

Crea un diagrama automotriz EDUCATIVO.

Marca: ${make}
Modelo: ${model}
Año: ${year}
Sistema: ${system}

Devuelve solamente JSON:

{
  "title":"",
  "description":"",
  "components":[
    {
      "id":"ecu",
      "name":"ECU / PCM",
      "type":"control"
    }
  ],
  "connections":[
    {
      "from":"ecu",
      "to":"sensor",
      "label":"Señal"
    }
  ],
  "warnings":[]
}

Usa entre 3 y 10 componentes.

Tipos permitidos:

control
sensor
actuator
power
ground
connector
module
other

Las conexiones deben utilizar
IDs existentes.

No inventes:
- colores de cables
- números de pines
- voltajes exactos

Es un diagrama educativo.

`);

  }catch(error){

    return send(
      res,
      502,
      {
        success:false,
        error:errorText(error)
      }
    );
  }

  d.title =
    clean(
      d.title ||
      `Diagrama ${system}`
    );

  d.description =
    clean(
      d.description ||
      `Diagrama educativo del sistema ${system}.`
    );

  d.components =
    array(d.components);

  d.connections =
    array(d.connections);

  d.warnings =
    array(d.warnings);

  /* GUARDAR */

  const saved =
    await supabase
      .from("dtc_diagrams")
      .insert({

        make,

        model,

        vehicle_year:year,

        system,

        title:d.title,

        description:d.description,

        components:d.components,

        connections:d.connections,

        warnings:d.warnings,

        source:"openrouter"

      })
      .select()
      .limit(1);

  if(saved.error){

    if(saved.error.code === "23505"){

      const again =
        await supabase
          .from("dtc_diagrams")
          .select("*")
          .eq("make",make)
          .eq("model",model)
          .eq("vehicle_year",year)
          .eq("system",system)
          .limit(1);

      if(!again.error &&
         again.data?.length){

        const x =
          again.data[0];

        return send(
          res,
          200,
          {
            success:true,
            source:"supabase",
            saved:true,
            make:x.make,
            model:x.model,
            year:x.vehicle_year,
            system:x.system,
            title:x.title,
            description:x.description,
            components:array(x.components),
            connections:array(x.connections),
            warnings:array(x.warnings)
          }
        );
      }
    }

    return send(
      res,
      500,
      {
        success:false,

        error:
          "La IA respondió, pero Supabase no pudo guardar el diagrama.",

        details:
          errorText(saved.error)
      }
    );
  }

  return send(
    res,
    200,
    {
      success:true,

      source:"openrouter",

      saved:true,

      make,

      model,

      year,

      system,

      title:d.title,

      description:d.description,

      components:d.components,

      connections:d.connections,

      warnings:d.warnings
    }
  );
}

/* ================= API ================= */

export default async function handler(req,res){

  try{

    if(req.method !== "GET"){

      return send(
        res,
        405,
        {
          success:false,
          error:"Método no permitido."
        }
      );
    }

    /*
      DIAGRAMA:
      /api/dtc?diagram=1&make=...
    */

    if(
      String(req.query.diagram) === "1"
    ){

      return await getDiagram(
        req,
        res
      );
    }

    /*
      DTC:
      /api/dtc?code=P2122
    */

    return await getDTC(
      req,
      res
    );

  }catch(error){

    console.error(
      "API ERROR:",
      error
    );

    return send(
      res,
      500,
      {
        success:false,

        error:
          errorText(error)
      }
    );
  }
                          }
