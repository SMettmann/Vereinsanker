import { createSupabaseContext } from "npm:@supabase/server";

const corsHeaders={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":"POST, OPTIONS"
};

function json(body:Record<string,unknown>,status=200){
  return new Response(JSON.stringify(body),{
    status,
    headers:{...corsHeaders,"Content-Type":"application/json"}
  });
}

function clean(value:unknown,max=200){
  return String(value??"").trim().slice(0,max);
}

const PRIVACY_NOTICE_VERSION="2026-10-02-v1";
const SEPA_MANDATE_VERSION="2026-10-02-v1";

function validEmail(value:string){
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)&&value.length<=254;
}

function normalizedPerson(value:string){
  return value.trim().replace(/\s+/g," ").toLocaleLowerCase("de-DE");
}

function sepaMandateText(clubName:string,creditorId:string,creditorAddress:string){
  const creditor=clubName+
    (creditorAddress?", "+creditorAddress:"")+
    " (Gläubiger-ID "+creditorId+")";
  return "SEPA-Lastschriftmandat: Ich ermächtige "+creditor+
    ", fällige Mitgliedsbeiträge von meinem Konto mittels SEPA-Basislastschrift einzuziehen. "+
    "Zugleich weise ich mein Kreditinstitut an, die von "+clubName+
    " auf mein Konto gezogenen Lastschriften einzulösen. Hinweis: Ich kann innerhalb von acht Wochen, beginnend mit dem Belastungsdatum, "+
    "die Erstattung des belasteten Betrages verlangen. Es gelten dabei die mit meinem Kreditinstitut vereinbarten Bedingungen. "+
    "Meine Rechte sind in einer Erklärung erläutert, die ich von meinem Kreditinstitut erhalten kann.";
}

function normalizeIban(value:string){
  return value.replace(/\s+/g,"").toUpperCase();
}

function validIban(value:string){
  const iban=normalizeIban(value);
  if(!iban) return true;
  if(!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  if(iban.startsWith("DE")&&iban.length!==22) return false;
  const rearranged=iban.slice(4)+iban.slice(0,4);
  let remainder=0;
  for(const ch of rearranged){
    const part=/[A-Z]/.test(ch)?String(ch.charCodeAt(0)-55):ch;
    for(const digit of part) remainder=(remainder*10+Number(digit))%97;
  }
  return remainder===1;
}

function validDate(value:string){
  if(!value) return true;
  const d=new Date(value+"T00:00:00Z");
  if(Number.isNaN(d.getTime())) return false;
  const now=new Date();
  const min=new Date(Date.UTC(now.getUTCFullYear()-120,0,1));
  return d<=now&&d>=min;
}

export default {
  fetch: async(req:Request)=>{
    if(req.method==="OPTIONS") return new Response("ok",{headers:corsHeaders});
    if(req.method!=="POST") return json({error:"METHOD_NOT_ALLOWED"},405);

    const {data:ctx,error:ctxError}=await createSupabaseContext(req,{auth:"none"});
    if(ctxError||!ctx?.supabaseAdmin){
      console.error("membership-join-public context",ctxError);
      return json({error:"SERVER_CONTEXT"},500);
    }

    const admin=ctx.supabaseAdmin;

    let body:any;
    try{body=await req.json();}catch{return json({error:"BAD_JSON"},400);}

    const action=clean(body?.action,20);
    const token=clean(body?.token,80);
    if(!/^[0-9a-fA-F-]{36}$/.test(token)) return json({error:"INVALID_LINK"},404);

    const {data:settings,error:settingsError}=await admin
      .from("membership_join_settings")
      .select("club_id,enabled,form_pdf_path,intro_text")
      .eq("public_token",token)
      .maybeSingle();

    if(settingsError){
      console.error("join settings",settingsError);
      return json({error:"DATABASE_ERROR"},500);
    }
    if(!settings?.club_id||!settings.enabled) return json({error:"JOIN_DISABLED"},404);

    const {data:club,error:clubError}=await admin
      .from("clubs")
      .select("id,name,short_name,color,logo_path,standard_fee,creditor_id,controller_address,trial_ends_at,subscription_status,departments")
      .eq("id",settings.club_id)
      .maybeSingle();

    if(clubError){
      console.error("join club",clubError);
      return json({error:"DATABASE_ERROR"},500);
    }
    if(!club) return json({error:"JOIN_DISABLED"},404);

    const subscriptionStatus=String(club.subscription_status||"");
    const active=["active_monthly","active_yearly"].includes(subscriptionStatus)||
      (["trial","payment_failed"].includes(subscriptionStatus)&&new Date(club.trial_ends_at||0).getTime()>Date.now());
    if(!active) return json({error:"JOIN_DISABLED"},404);

    const {data:contributionTypes,error:typesError}=await admin
      .from("contribution_types")
      .select("id,name,annual_fee,billing_interval,is_default,sort_order")
      .eq("club_id",club.id)
      .eq("active",true)
      .order("sort_order",{ascending:true})
      .order("created_at",{ascending:true});

    if(typesError){
      console.error("join contribution types",typesError);
      return json({error:"DATABASE_ERROR"},500);
    }

    if(action==="get"){
      let formUrl="";
      if(settings.form_pdf_path){
        const {data:signed,error:signedError}=await admin.storage
          .from("membership-forms")
          .createSignedUrl(settings.form_pdf_path,3600);
        if(signedError) console.error("join form signed url",signedError);
        else formUrl=signed?.signedUrl||"";
      }

      const supabaseUrl=Deno.env.get("SUPABASE_URL")||"";
      const logoUrl=club.logo_path
        ? supabaseUrl+"/storage/v1/object/public/club-logos/"+encodeURI(club.logo_path)
        : "";

      return json({
        ok:true,
        club:{
          name:club.name,
          short_name:club.short_name,
          logo_url:logoUrl,
          annual_fee:Number(club.standard_fee||0),
          creditor_id:club.creditor_id||"",
          creditor_address:club.controller_address||"",
          sepa_mandate_text:club.creditor_id?sepaMandateText(clean(club.name,120),clean(club.creditor_id,80),clean(club.controller_address,200)):"",
          privacy_notice_version:PRIVACY_NOTICE_VERSION,
          sepa_mandate_version:SEPA_MANDATE_VERSION,
          intro_text:settings.intro_text||""
        },
        contribution_types:(contributionTypes||[]).map((item:any)=>({
          id:item.id,
          name:item.name,
          annual_fee:Number(item.annual_fee||0),
          billing_interval:item.billing_interval||"yearly",
          is_default:Boolean(item.is_default)
        })),
        departments:Array.isArray(club.departments)
          ? club.departments.map((value:any)=>clean(value,80)).filter(Boolean)
          : [],
        form_pdf_url:formUrl
      });
    }

    if(action==="submit"){
      if(clean(body?.website,200)) return json({ok:true});

      const firstName=clean(body?.first_name,80);
      const lastName=clean(body?.last_name,80);
      const email=clean(body?.email,254).toLowerCase();
      const phone=clean(body?.phone,60);
      const birthDate=clean(body?.birth_date,10);
      const street=clean(body?.street,160);
      const postalCode=clean(body?.postal_code,20);
      const city=clean(body?.city,100);
      const groupName=clean(body?.group_name,120);
      const departments=Array.isArray(club.departments)
        ? club.departments.map((value:any)=>clean(value,80)).filter(Boolean)
        : [];
      const contributionTypeId=clean(body?.contribution_type_id,80);
      const iban=normalizeIban(clean(body?.iban,50));
      const accountHolder=clean(body?.account_holder,160);
      const signature=clean(body?.applicant_signature,160);
      const privacyConsent=body?.privacy_consent===true;
      const sepaConsent=body?.sepa_consent===true;

      if(firstName.length<1||lastName.length<1) return json({error:"NAME_REQUIRED"},400);
      if(!validEmail(email)) return json({error:"INVALID_EMAIL"},400);
      if(!privacyConsent) return json({error:"PRIVACY_REQUIRED"},400);
      if(!validDate(birthDate)) return json({error:"INVALID_BIRTH_DATE"},400);
      if(!validIban(iban)) return json({error:"INVALID_IBAN"},400);
      if(groupName&&!departments.some((name:string)=>name.toLocaleLowerCase("de-DE")===groupName.toLocaleLowerCase("de-DE"))) return json({error:"INVALID_DEPARTMENT"},400);
      if(sepaConsent&&(!iban||!club.creditor_id||!accountHolder)) return json({error:"SEPA_NOT_AVAILABLE"},400);
      if(sepaConsent&&signature.length<2) return json({error:"SIGNATURE_REQUIRED"},400);
      if(sepaConsent&&normalizedPerson(signature)!==normalizedPerson(accountHolder)) return json({error:"SIGNATURE_MISMATCH"},400);

      let selectedContributionType:any=null;
      if((contributionTypes||[]).length){
        if(!contributionTypeId) return json({error:"CONTRIBUTION_TYPE_REQUIRED"},400);
        selectedContributionType=(contributionTypes||[]).find((item:any)=>item.id===contributionTypeId)||null;
        if(!selectedContributionType) return json({error:"INVALID_CONTRIBUTION_TYPE"},400);
      }

      const applicationFee=selectedContributionType
        ? Number(selectedContributionType.annual_fee||0)
        : Number(club.standard_fee||0);
      const applicationLabel=selectedContributionType
        ? clean(selectedContributionType.name,120)
        : "";

      const tenMinutesAgo=new Date(Date.now()-10*60*1000).toISOString();

      const {count:recentCount,error:rateError}=await admin
        .from("membership_applications")
        .select("id",{count:"exact",head:true})
        .eq("club_id",club.id)
        .gte("submitted_at",tenMinutesAgo);

      if(rateError){
        console.error("join rate check",rateError);
        return json({error:"DATABASE_ERROR"},500);
      }
      if(Number(recentCount||0)>=30) return json({error:"RATE_LIMITED"},429);

      const {data:pendingSameEmail,error:recentError}=await admin
        .from("membership_applications")
        .select("id,first_name,last_name")
        .eq("club_id",club.id)
        .eq("email",email)
        .eq("status","pending")
        .limit(50);

      if(recentError){
        console.error("join duplicate check",recentError);
        return json({error:"DATABASE_ERROR"},500);
      }

      const duplicate=(pendingSameEmail||[]).some((row:any)=>
        normalizedPerson(String(row.first_name||""))===normalizedPerson(firstName)&&
        normalizedPerson(String(row.last_name||""))===normalizedPerson(lastName)
      );
      if(duplicate) return json({error:"DUPLICATE_PENDING"},409);

      const {data:application,error:insertError}=await admin
        .from("membership_applications")
        .insert({
          club_id:club.id,
          first_name:firstName,
          last_name:lastName,
          email,
          phone:phone||null,
          birth_date:birthDate||null,
          street:street||null,
          postal_code:postalCode||null,
          city:city||null,
          group_name:groupName||null,
          contribution_type_id:selectedContributionType?.id||null,
          contribution_label:applicationLabel||null,
          iban:sepaConsent?(iban||null):null,
          account_holder:sepaConsent?(accountHolder||null):null,
          sepa_consent:sepaConsent,
          privacy_consent:true,
          privacy_notice_version:PRIVACY_NOTICE_VERSION,
          sepa_mandate_version:sepaConsent?SEPA_MANDATE_VERSION:null,
          sepa_mandate_text:sepaConsent?sepaMandateText(clean(club.name,120),clean(club.creditor_id,80),clean(club.controller_address,200)):null,
          applicant_signature:sepaConsent?(signature||null):null,
          annual_fee:applicationFee,
          billing_interval:selectedContributionType?.billing_interval||"yearly",
          status:"pending"
        })
        .select("id")
        .single();

      if(insertError){
        console.error("join insert",insertError);
        return json({error:"SUBMIT_FAILED"},500);
      }

      return json({ok:true,application_id:application.id});
    }

    return json({error:"UNKNOWN_ACTION"},400);
  }
};