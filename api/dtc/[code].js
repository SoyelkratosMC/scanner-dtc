import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const MAX_DTC = 50;
const MAX_DIAGRAMS = 50;

function text(v){
  return String(v ?? "").trim();
}

function upper(v){
  return text(v).toUpperCase();
}

function lower(v){
  return text(v).toLowerCase();
}

function arr(v){
  return Array.isArray(v) ? v : [];
}

function jsonAI(content){

  if(typeof content==="object"){
    return content;
  }

  let t=text(content)
    .replace(/^```json/i,"")
    .replace(/^```/,"")
    .replace(/```$/,"")
    .trim();

  const a=t.indexOf("{");
  const b=t.lastIndexOf("}");

  if(a>=0&&b>a){
    t=t.slice(a,b+1);
  }

  try{
    return JSON.parse(t);
  }catch{
    throw new Error("La IA devolvió JSON inválido.");
  }
}

async function askAI(prompt){

  const key=process.env.OPENROUTER_API_KEY;

  if(!key){
    throw new Error("Falta OPENROUTER_API_KEY en Vercel.");
  }

  const r=await fetch(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method:"POST",
      headers:{
        "Authorization":"Bearer "+key,
        "Content-Type":"application/json",
        "HTTP-Referer":"https://scanner-dtc.vercel.app",
        "X-Title":"Scanner DTC"
      },
      body:JSON.stringify({
        model:"openrouter/free",
        messages:[
          {
            role:"system",
            content:"Eres especialista automotriz. Responde en español."
          },
          {
            role:"user",
            content:prompt
          }
        ],
        temperature:0.2,
        max_tokens:2200
      })
    }
  );

  const raw=await r.text();

  if(!r.ok){
    console.error(raw);
    throw new Error("OpenRouter rechazó la solicitud.");
  }

  let data;

  try{
    data=JSON.parse(raw);
  }catch{
    throw new Error("OpenRouter devolvió una respuesta inválida.");
  }

  let content=data?.choices?.[0]?.message?.content;

  if(Array.isArray(content)){
    content=content.map(x=>
      typeof x==="string"?x:(x?.text||"")
    ).join("");
  }

  if(!content){
    throw new Error("OpenRouter no devolvió información.");
  }

  return jsonAI(content);
}

async function countToday(table){

  const start=new Date();
  start.setHours(0,0,0,0);

  const {count,error}=await supabase
    .from(table)
    .select("id",{count:"exact",head:true})
    .gte("created_at",start.toISOString());

  if(error){
    console.error(error);
    throw new Error("No se pudo comprobar el límite diario.");
  }

  return count||0;
}

async function dtc(req,res){

  const code=upper(req.query.code);
  const make=lower(req.query.make||"genérica");

  if(!/^[PBCU][0-9A-F]{4}$/.test(code)){
    return res.status(400).json({
      success:false,
      error:"Código DTC inválido."
    });
  }

  const {data,error}=await supabase
    .from("dtc_codes")
    .select("*")
    .eq("code",code)
    .limit(1);

  if(error){
    return res.status(500).json({
      success:false,
      error:"Error consultando Supabase.",
      details:error.message
    });
  }

  if(data?.length){

    const d=data[0];

    return res.json({
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
      severity:d.severity||"MEDIA",
      vehicle_years:d.vehicle_years||"No especificado",
      system:d.system||"No especificado"
    });
  }

  if(await countToday("dtc_codes")>=MAX_DTC){
    return res.status(429).json({
      success:false,
      error:"Se alcanzó el límite de 50 códigos nuevos hoy."
    });
  }

  let d;

  try{

    d=await askAI(`
Genera información técnica educativa para el código DTC ${code}.

Marca solicitada: ${make}

Devuelve SOLO JSON con esta estructura:

{
 "code":"${code}",
 "make":"${make}",
 "title":"string",
 "problem":"string",
 "causes":["string"],
 "symptoms":["string"],
 "diagnosis":["string"],
 "repairs":["string"],
 "severity":"MEDIA",
 "vehicle_years":"No especificado",
 "system":"string"
}

severity debe ser BAJA, MEDIA, ALTA o CRÍTICA.

No inventes números de piezas, pines, colores de cables ni datos específicos no confirmados.
Las causas y reparaciones deben ser posibles, no afirmaciones absolutas.
`);

  }catch(e){

    return res.status(502).json({
      success:false,
      error:e.message
    });
  }

  d.code=upper(d.code||code);
  d.make=lower(d.make||make);
  d.title=text(d.title||"Código DTC");
  d.problem=text(d.problem||"No hay información disponible.");
  d.causes=arr(d.causes);
  d.symptoms=arr(d.symptoms);
  d.diagnosis=arr(d.diagnosis);
  d.repairs=arr(d.repairs);

  const levels=["BAJA","MEDIA","ALTA","CRÍTICA"];

  d.severity=levels.includes(
    upper(d.severity)
  )?upper(d.severity):"MEDIA";

  d.vehicle_years=text(
    d.vehicle_years||"No especificado"
  );

  d.system=text(
    d.system||"Sistema no especificado"
  );

  const {error:saveError}=await supabase
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
    });

  if(saveError){

    console.error(saveError);

    const {data:again}=await supabase
      .from("dtc_codes")
      .select("*")
      .eq("code",d.code)
      .limit(1);

    if(again?.length){
      const x=again[0];

      return res.json({
        success:true,
        source:"supabase",
        saved:true,
        code:x.code,
        make:x.make,
        title:x.title,
        problem:x.problem,
        causes:arr(x.causes),
        symptoms:arr(x.symptoms),
        diagnosis:arr(x.diagnosis),
        repairs:arr(x.repairs),
        severity:x.severity||"MEDIA",
        vehicle_years:x.vehicle_years||"No especificado",
        system:x.system||"No especificado"
      });
    }

    return res.status(500).json({
      success:false,
      error:"No se pudo guardar el código en Supabase.",
      details:saveError.message
    });
  }

  return res.json({
    success:true,
    source:"openrouter",
    saved:true,
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
    system:d.system
  });
}

async function diagram(req,res){

  const make=text(req.query.make);
  const model=text(req.query.model);
  const year=text(req.query.year);
  const system=text(req.query.system);

  if(!make||!model||!year||!system){
    return res.status(400).json({
      success:false,
      error:"Faltan marca, modelo, año o sistema."
    });
  }

  const {data,error}=await supabase
    .from("dtc_diagrams")
    .select("*")
    .eq("make",make)
    .eq("model",model)
    .eq("vehicle_year",year)
    .eq("system",system)
    .limit(1);

  if(error){
    return res.status(500).json({
      success:false,
      error:"Error consultando diagramas.",
      details:error.message
    });
  }

  if(data?.length){

    const d=data[0];

    return res.json({
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

  if(await countToday("dtc_diagrams")>=MAX_DIAGRAMS){
    return res.status(429).json({
      success:false,
      error:"Se alcanzó el límite de 50 diagramas nuevos hoy."
    });
  }

  let d;

  try{

    d=await askAI(`
Crea un diagrama automotriz EDUCATIVO y orientativo.

Marca: ${make}
Modelo: ${model}
Año: ${year}
Sistema: ${system}

Devuelve SOLO JSON:

{
 "title":"string",
 "description":"string",
 "components":[
   {"id":"ecu","name":"ECU / PCM","type":"control"}
 ],
 "connections":[
   {"from":"ecu","to":"sensor","label":"Señal"}
 ],
 "warnings":["string"]
}

Debe tener entre 3 y 12 componentes.

Tipos permitidos:
control
sensor
actuator
power
ground
connector
module
other

Las conexiones deben usar IDs existentes.

No inventes colores de cables, números de pines, números de piezas ni voltajes específicos.
Si existe variación por versión, indícalo.
`);

  }catch(e){

    return res.status(502).json({
      success:false,
      error:e.message
    });
  }

  d.title=text(d.title||"Diagrama "+system);
  d.description=text(
    d.description||"Diagrama educativo y orientativo."
  );
  d.components=arr(d.components);
  d.connections=arr(d.connections);
  d.warnings=arr(d.warnings);

  const {error:saveError}=await supabase
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
    });

  if(saveError){
    return res.status(500).json({
      success:false,
      error:"No se pudo guardar el diagrama en Supabase.",
      details:saveError.message
    });
  }

  return res.json({
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

export default async function handler(req,res){

  try{

    if(req.method!=="GET"){
      return res.status(405).json({
        success:false,
        error:"Método no permitido."
      });
    }

    if(
      String(req.query.diagram).toLowerCase()==="true"
    ){
      return await diagram(req,res);
    }

    return await dtc(req,res);

  }catch(e){

    console.error(e);

    return res.status(500).json({
      success:false,
      error:e.message||"Error interno del servidor."
    });
  }
      }
