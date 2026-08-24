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

  if(!e){
    return "Error desconocido.";
  }

  if(typeof e === "string"){
    return e;
  }

  if(e.message){
    return e.message;
  }

  if(e.error){

    if(typeof e.error === "string"){
      return e.error;
    }

    if(e.error.message){
      return e.error.message;
    }
  }

  try{
    return JSON.stringify(e);
  }catch{
    return "Error desconocido.";
  }
}


function json(res,status,data){
  return res.status(status).json(data);
}


/* =====================================================
   IA
===================================================== */

async function ai(prompt){

  const key=process.env.OPENROUTER_API_KEY;

  if(!key){

    throw new Error(
      "Falta OPENROUTER_API_KEY en Vercel."
    );
  }


  const response=await fetch(AI_URL,{

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
          content:
            "Eres especialista automotriz. Responde únicamente JSON válido. Nunca uses Markdown."
        },

        {
          role:"user",
          content:prompt
        }

      ],

      temperature:0.2,
      max_tokens:2500

    })

  });


  const raw=await response.text();


  if(!response.ok){

    let message="Error de OpenRouter.";

    try{

      const data=JSON.parse(raw);

      message=
        data?.error?.message ||
        data?.error ||
        message;

    }catch{}

    throw new Error(errorText(message));
  }


  let data;

  try{

    data=JSON.parse(raw);

  }catch{

    throw new Error(
      "OpenRouter no devolvió JSON."
    );
  }


  let content=
    data?.choices?.[0]?.message?.content;


  if(Array.isArray(content)){

    content=
      content
        .map(x=>x?.text || x)
        .join("");
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


  const start=content.indexOf("{");
  const end=content.lastIndexOf("}");


  if(start>=0 && end>start){

    content=
      content.slice(start,end+1);
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

  const code=
    clean(req.query.code)
      .toUpperCase();

  const make=
    clean(req.query.make)
      .toLowerCase();


  if(!/^[PBCU][0-9A-F]{4}$/.test(code)){

    return json(res,400,{

      success:false,

      error:
        "Código DTC inválido. Usa por ejemplo P2122."

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

      error:
        "Error consultando Supabase.",

      details:
        errorText(found.error)

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

      vehicle_years:
        d.vehicle_years ||
        "No especificado",

      system:
        d.system ||
        "No especificado"

    });
  }


  let d;


  try{

    d=await ai(`

Genera información automotriz para el código DTC:

Código: ${code}
Marca: ${make || "genérica"}

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

severity debe ser:
BAJA, MEDIA, ALTA o CRÍTICA.

Escribe información clara en español.

No inventes números de piezas,
pines, colores de cables,
voltajes específicos ni datos
que no puedas asegurar.

`);

  }catch(e){

    return json(res,502,{

      success:false,

      error:errorText(e)

    });
  }


  d.code=
    clean(d.code || code)
      .toUpperCase();

  d.make=
    clean(
      d.make ||
      make ||
      "genérica"
    )
    .toLowerCase();

  d.title=
    clean(
      d.title ||
      "Código DTC"
    );

  d.problem=
    clean(
      d.problem ||
      "Sin información."
    );

  d.causes=arr(d.causes);
  d.symptoms=arr(d.symptoms);
  d.diagnosis=arr(d.diagnosis);
  d.repairs=arr(d.repairs);


  const severity=
    String(d.severity || "MEDIA")
      .toUpperCase();


  d.severity=
    ["BAJA","MEDIA","ALTA","CRÍTICA"]
      .includes(severity)
      ? severity
      : "MEDIA";


  d.vehicle_years=
    clean(
      d.vehicle_years ||
      "No especificado"
    );


  d.system=
    clean(
      d.system ||
      "No especificado"
    );


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

    /*
      Si ya existe por una búsqueda simultánea,
      intentamos devolver el registro existente.
    */

    if(
      String(saved.error.code)==="23505"
    ){

      const again=await supabase
        .from("dtc_codes")
        .select("*")
        .eq("code",d.code)
        .limit(1);

      if(again.data?.length){

        const x=again.data[0];

        return json(res,200,{

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

          severity:x.severity || "MEDIA",

          vehicle_years:
            x.vehicle_years ||
            "No especificado",

          system:
            x.system ||
            "No especificado"

        });
      }
    }


    return json(res,500,{

      success:false,

      error:
        "La IA respondió pero Supabase no pudo guardar el DTC.",

      details:
        errorText(saved.error)

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
   CREAR SVG DEL DIAGRAMA
===================================================== */

function svgEscape(value){

  return String(value ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&apos;");
}


function createDiagramSVG(
  make,
  model,
  year,
  system,
  components,
  connections
){

  const width=1000;
  const height=650;


  const nodes=components.slice(0,10);


  const positions=[];


  nodes.forEach((node,index)=>{

    const column=index%3;
    const row=Math.floor(index/3);

    positions.push({

      x:80+(column*310),
      y:150+(row*150)

    });

  });


  const byId={};


  nodes.forEach((node,index)=>{

    byId[String(node.id)]=positions[index];

  });


  let lines="";


  connections.forEach(connection=>{

    const from=byId[String(connection.from)];
    const to=byId[String(connection.to)];

    if(!from || !to){
      return;
    }


    const x1=from.x+120;
    const y1=from.y+45;

    const x2=to.x+120;
    const y2=to.y+45;


    lines+=`

      <line
        x1="${x1}"
        y1="${y1}"
        x2="${x2}"
        y2="${y2}"
        stroke="#00d9ff"
        stroke-width="3"
        marker-end="url(#arrow)"
      />

      <text
        x="${(x1+x2)/2}"
        y="${(y1+y2)/2-8}"
        fill="#9eefff"
        font-size="13"
        text-anchor="middle"
      >
        ${svgEscape(connection.label || "")}
      </text>

    `;
  });


  let boxes="";


  nodes.forEach((node,index)=>{

    const p=positions[index];


    boxes+=`

      <rect
        x="${p.x}"
        y="${p.y}"
        width="240"
        height="90"
        rx="14"
        fill="#111b28"
        stroke="#00d9ff"
        stroke-width="2"
      />

      <text
        x="${p.x+120}"
        y="${p.y+38}"
        fill="#ffffff"
        font-size="16"
        font-weight="bold"
        text-anchor="middle"
      >
        ${svgEscape(node.name || node.id)}
      </text>

      <text
        x="${p.x+120}"
        y="${p.y+63}"
        fill="#7eeaff"
        font-size="12"
        text-anchor="middle"
      >
        ${svgEscape(node.type || "other")}
      </text>

    `;
  });


  const svg=`

<svg
xmlns="http://www.w3.org/2000/svg"
width="${width}"
height="${height}"
viewBox="0 0 ${width} ${height}"
>

<defs>

<marker
id="arrow"
markerWidth="10"
markerHeight="10"
refX="8"
refY="3"
orient="auto"
markerUnits="strokeWidth"
>

<path
d="M0,0 L0,6 L9,3 z"
fill="#00d9ff"
/>

</marker>

</defs>

<rect
width="100%"
height="100%"
fill="#080c12"
/>

<text
x="500"
y="45"
fill="#00e5ff"
font-size="25"
font-weight="bold"
text-anchor="middle"
>
${svgEscape(make)} ${svgEscape(model)} ${svgEscape(year)}
</text>

<text
x="500"
y="82"
fill="#ffffff"
font-size="20"
text-anchor="middle"
>
Sistema: ${svgEscape(system)}
</text>

${lines}

${boxes}

</svg>
`;


  return "data:image/svg+xml;charset=UTF-8,"+
    encodeURIComponent(svg);
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

      error:
        "Completa marca, modelo, año y sistema."

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

      error:
        "Error consultando diagramas.",

      details:
        errorText(found.error)

    });
  }


  if(found.data?.length){

    const d=found.data[0];


    const components=
      arr(d.components);

    const connections=
      arr(d.connections);


    const image=
      createDiagramSVG(
        d.make,
        d.model,
        d.vehicle_year,
        d.system,
        components,
        connections
      );


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

      components,
      connections,

      warnings:arr(d.warnings),

      image

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

Devuelve SOLO JSON válido:

{
 "title":"",
 "description":"",
 "components":[
   {
     "id":"ecu",
     "name":"ECU / PCM",
     "type":"control"
   },
   {
     "id":"sensor",
     "name":"Sensor",
     "type":"sensor"
   },
   {
     "id":"ground",
     "name":"Tierra",
     "type":"ground"
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

Las conexiones deben utilizar IDs
que realmente existan.

No inventes colores de cables,
pines ni voltajes específicos.

Es un diagrama educativo.

`);

  }catch(e){

    return json(res,502,{

      success:false,

      error:errorText(e)

    });
  }


  d.title=
    clean(
      d.title ||
      `Diagrama ${system}`
    );


  d.description=
    clean(
      d.description ||
      `Diagrama educativo del sistema ${system}.`
    );


  d.components=
    arr(d.components);


  d.connections=
    arr(d.connections);


  d.warnings=
    arr(d.warnings);


  /*
    Si la IA devuelve componentes sin ID,
    les asignamos uno automáticamente.
  */

  d.components=
    d.components.map((component,index)=>({

      id:
        clean(
          component?.id ||
          `component_${index+1}`
        ),

      name:
        clean(
          component?.name ||
          `Componente ${index+1}`
        ),

      type:
        clean(
          component?.type ||
          "other"
        )

    }));


  const validIds=
    new Set(
      d.components.map(x=>x.id)
    );


  d.connections=
    d.connections
      .filter(x=>
        validIds.has(String(x?.from)) &&
        validIds.has(String(x?.to))
      )
      .map(x=>({

        from:String(x.from),

        to:String(x.to),

        label:
          clean(
            x.label ||
            "Conexión"
          )

      }));


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

    if(
      String(saved.error.code)==="23505"
    ){

      const again=await supabase
        .from("dtc_diagrams")
        .select("*")
        .eq("make",make)
        .eq("model",model)
        .eq("vehicle_year",year)
        .eq("system",system)
        .limit(1);


      if(again.data?.length){

        const x=again.data[0];


        return json(res,200,{

          success:true,

          source:"supabase",

          saved:true,

          make:x.make,
          model:x.model,
          year:x.vehicle_year,
          system:x.system,

          title:x.title,
          description:x.description,

          components:arr(x.components),
          connections:arr(x.connections),
          warnings:arr(x.warnings),

          image:createDiagramSVG(
            x.make,
            x.model,
            x.vehicle_year,
            x.system,
            arr(x.components),
            arr(x.connections)
          )

        });
      }
    }


    return json(res,500,{

      success:false,

      error:
        "La IA respondió pero Supabase no pudo guardar el diagrama.",

      details:
        errorText(saved.error)

    });
  }


  const image=
    createDiagramSVG(
      make,
      model,
      year,
      system,
      d.components,
      d.connections
    );


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

    warnings:d.warnings,

    image

  });
}


/* =====================================================
   API PRINCIPAL
===================================================== */

export default async function handler(req,res){

  try{

    if(req.method!=="GET"){

      return json(res,405,{

        success:false,

        error:
          "Método no permitido."

      });
    }


    /*
      /api/dtc?diagram=1
    */

    if(
      String(req.query.diagram)==="1"
    ){

      return await diagram(req,res);
    }


    /*
      /api/dtc?code=P2122
    */

    return await dtc(req,res);


  }catch(e){

    console.error("API:",e);


    return json(res,500,{

      success:false,

      error:errorText(e)

    });
  }
        }
