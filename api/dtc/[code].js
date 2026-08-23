import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const AI_URL =
  "https://openrouter.ai/api/v1/chat/completions";

function clean(v){
  return String(v ?? "").trim();
}

function arr(v){
  return Array.isArray(v) ? v : [];
}

function errorText(e){
  if(!e) return "Error desconocido.";

  if(typeof e === "string"){
    return e;
  }

  return (
    e.message ||
    e.error ||
    JSON.stringify(e)
  );
}

function json(res,status,data){
  return res.status(status).json(data);
}

async function ai(prompt){

  const key=process.env.OPENROUTER_API_KEY;

  if(!key){
    throw new Error(
      "Falta OPENROUTER_API_KEY en Vercel."
    );
  }

  const r=await fetch(AI_URL,{
    method:"POST",

    headers:{
      Authorization:"Bearer "+key,
      "Content-Type":"application/json",
      "HTTP-Referer":"https://scanner-dtc.vercel.app",
      "X-Title":"Scanner DTC"
    },

    body:JSON.stringify({
      model:"openrouter/free",

      messages:[
        {
          role:"system",
          content:
            "Especialista automotriz. Responde en español y solamente JSON."
        },
        {
          role:"user",
          content:prompt
        }
      ],

      temperature:0.2,
      max_tokens:2000
    })
  });

  const raw=await r.text();

  if(!r.ok){

    let msg="Error de OpenRouter.";

    try{
      const x=JSON.parse(raw);

      msg=
        x?.error?.message ||
        x?.error ||
        msg;

    }catch{}

    throw new Error(errorText(msg));
  }

  let x;

  try{
    x=JSON.parse(raw);
  }catch{
    throw new Error(
      "OpenRouter no devolvió JSON."
    );
  }

  let content=
    x?.choices?.[0]?.message?.content;

  if(Array.isArray(content)){
    content=content.map(x=>x?.text || x).join("");
  }

  if(!content){
    throw new Error(
      "OpenRouter no devolvió contenido."
    );
  }

  content=String(content)
    .replace(/^```json/i,"")
    .replace(/^```/,"")
    .replace(/```$/,"")
    .trim();

  const a=content.indexOf("{");
  const b=content.lastIndexOf("}");

  if(a>=0 && b>a){
    content=content.slice(a,b+1);
  }

  try{
    return JSON.parse(content);
  }catch{
    throw new Error(
      "La IA devolvió JSON inválido."
    );
  }
}

/* =====================================================
   DTC
===================================================== */

async function dtc(req,res){

  const code=clean(req.query.code).toUpperCase();
  const make=clean(req.query.make).toLowerCase();

  if(!/^[PBCU][0-9A-F]{4}$/.test(code)){

    return json(res,400,{
      success:false,
      error:"Código DTC inválido. Usa por ejemplo P2122."
    });
  }

  const found=await supabase
    .from("dtc_codes")
    .select("*")
    .eq("code",code)
    .limit(1);

  if(found.error){

    return json(res,500,{
      success:false,
      error:"Error consultando Supabase.",
      details:errorText(found.error)
    });
  }

  if(found.data?.length){

    const d=found.data[0];

    return json(res,200,{
      success:true,
      source:"supabase",
      saved:true,
      code:d.code,
      make:d.make,
      title:d.title,
      problem:d.problem,
      causes:arr(d.causes),
      symptoms:arr(d.symptoms),
      diagnosis:arr(d.diagnosis),
      repairs:arr(d.repairs),
      severity:d.severity || "MEDIA",
      vehicle_years:d.vehicle_years || "No especificado",
      system:d.system || "No especificado"
    });
  }

  let d;

  try{

    d=await ai(`
Genera información del DTC ${code}.
Marca: ${make || "genérica"}.

Devuelve exactamente:

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

severity: BAJA, MEDIA, ALTA o CRÍTICA.

No inventes números de piezas,
pines, colores de cables ni datos
que no puedas asegurar.
`);

  }catch(e){

    return json(res,502,{
      success:false,
      error:errorText(e)
    });
  }

  d.code=clean(d.code || code).toUpperCase();
  d.make=clean(d.make || make || "genérica").toLowerCase();

  d.title=clean(d.title || "Código DTC");
  d.problem=clean(d.problem || "Sin información.");

  d.causes=arr(d.causes);
  d.symptoms=arr(d.symptoms);
  d.diagnosis=arr(d.diagnosis);
  d.repairs=arr(d.repairs);

  d.severity=
    ["BAJA","MEDIA","ALTA","CRÍTICA"]
      .includes(String(d.severity).toUpperCase())
      ? String(d.severity).toUpperCase()
      : "MEDIA";

  d.vehicle_years=
    clean(d.vehicle_years || "No especificado");

  d.system=
    clean(d.system || "No especificado");

  const saved=await supabase
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
      vehicle_years:d.vehicle_years,
      system:d.system,
      source:"openrouter"
    })
    .select()
    .limit(1);

  if(saved.error){

    return json(res,500,{
      success:false,
      error:"La IA respondió pero Supabase no pudo guardar el DTC.",
      details:errorText(saved.error)
    });
  }

  return json(res,200,{
    success:true,
    source:"openrouter",
    saved:true,
    ...d
  });
}

/* =====================================================
   DIAGRAMA
===================================================== */

async function diagram(req,res){

  const make=clean(req.query.make);
  const model=clean(req.query.model);
  const year=clean(req.query.year);
  const system=clean(req.query.system);

  if(!make || !model || !year || !system){

    return json(res,400,{
      success:false,
      error:"Completa marca, modelo, año y sistema."
    });
  }

  const found=await supabase
    .from("dtc_diagrams")
    .select("*")
    .eq("make",make)
    .eq("model",model)
    .eq("vehicle_year",year)
    .eq("system",system)
    .limit(1);

  if(found.error){

    return json(res,500,{
      success:false,
      error:"Error consultando diagramas.",
      details:errorText(found.error)
    });
  }

  if(found.data?.length){

    const d=found.data[0];

    return json(res,200,{
      success:true,
      source:"supabase",
      saved:true,
      make:d.make,
      model:d.model,
      year:d.vehicle_year,
      system:d.system,
      title:d.title,
      description:d.description,
      components:arr(d.components),
      connections:arr(d.connections),
      warnings:arr(d.warnings)
    });
  }

  let d;

  try{

    d=await ai(`
Crea un diagrama automotriz EDUCATIVO.

Marca: ${make}
Modelo: ${model}
Año: ${year}
Sistema: ${system}

Devuelve:

{
"title":"",
"description":"",
"components":[
{"id":"ecu","name":"ECU / PCM","type":"control"},
{"id":"sensor","name":"Sensor","type":"sensor"},
{"id":"ground","name":"Tierra","type":"ground"}
],
"connections":[
{"from":"ecu","to":"sensor","label":"Señal"}
],
"warnings":[]
}

Usa entre 3 y 10 componentes.

Tipos:
control
sensor
actuator
power
ground
connector
module
other

Las conexiones deben usar IDs existentes.

No inventes colores de cables,
pines ni voltajes específicos.
El resultado es educativo.
`);

  }catch(e){

    return json(res,502,{
      success:false,
      error:errorText(e)
    });
  }

  d.title=clean(d.title || `Diagrama ${system}`);
  d.description=clean(
    d.description ||
    `Diagrama educativo del sistema ${system}.`
  );

  d.components=arr(d.components);
  d.connections=arr(d.connections);
  d.warnings=arr(d.warnings);

  const saved=await supabase
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

    return json(res,500,{
      success:false,
      error:"La IA respondió pero Supabase no pudo guardar el diagrama.",
      details:errorText(saved.error)
    });
  }

  return json(res,200,{
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
  });
}

/* =====================================================
   API
===================================================== */

export default async function handler(req,res){

  try{

    if(req.method!=="GET"){

      return json(res,405,{
        success:false,
        error:"Método no permitido."
      });
    }

    if(String(req.query.diagram)==="1"){

      return await diagram(req,res);
    }

    return await dtc(req,res);

  }catch(e){

    console.error("API:",e);

    return json(res,500,{
      success:false,
      error:errorText(e)
    });
  }
    }
