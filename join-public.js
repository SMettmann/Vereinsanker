(async function(){
const $=s=>document.querySelector(s),sb=window.vaSupabase;
const query=new URLSearchParams(location.search);
const token=query.get("t")||"";
const presetGroup=(query.get("gruppe")||"").trim();
const presetContribution=(query.get("beitrag")||"").trim();
const form=$("#publicJoinForm");
function msg(text){let b=form.querySelector(".auth-message");if(!b){b=document.createElement("div");b.className="auth-message error";form.insertBefore(b,$("#submitJoin"));}b.textContent=text;}
const get=await sb.functions.invoke("membership-join-public",{body:{action:"get",token}});
if(get.error||!get.data?.ok){
      $(".join-public-brand").hidden=true;
      $("#publicJoinForm").hidden=true;
      $("#publicJoinPdf").hidden=true;
      $("#joinLoadError").hidden=false;
      return;
    }
const data=get.data,c=data.club;
$("#publicClubName").textContent=c.name;
$("#publicJoinIntro").textContent=c.intro_text||"Fülle deine Daten aus. Der Verein prüft den Antrag anschließend.";
const departments=Array.isArray(data.departments)
  ? data.departments.map(value=>String(value||"").trim()).filter(Boolean)
  : [];
const groupSelect=$("#joinGroup");
if(groupSelect){
  groupSelect.innerHTML='<option value="">Keine / bitte auswählen</option>'+
    departments.map(name=>'<option value="'+String(name).replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[ch]))+'">'+String(name).replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[ch]))+'</option>').join("");
  groupSelect.disabled=!departments.length;
  const presetMatch=departments.find(name=>name.toLocaleLowerCase("de-DE")===presetGroup.toLocaleLowerCase("de-DE"));
  if(presetMatch) groupSelect.value=presetMatch;
}
const contributionTypes=Array.isArray(data.contribution_types)?data.contribution_types:[];
if(contributionTypes.length){
  $("#publicStandardFee").hidden=true;
  $("#joinContributionChoice").hidden=false;
  const presetType=contributionTypes.find(item=>item.id===presetContribution)||null;
  const selectedDefault=presetType||contributionTypes.find(item=>item.is_default)||contributionTypes[0];
  $("#joinContributionOptions").innerHTML=contributionTypes.map(item=>
    '<label class="join-contribution-option">'+
      '<input type="radio" name="joinContributionType" value="'+item.id+'"'+(item.id===selectedDefault.id?' checked':'')+'>'+
      '<span><strong>'+String(item.name||"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[ch]))+'</strong>'+
      '<b>'+(Number(item.annual_fee||0)/(item.billing_interval==="monthly"?12:1)).toLocaleString("de-DE",{style:"currency",currency:"EUR"})+' / Jahr</b></span>'+
    '</label>'
  ).join("");
}else{
  $("#joinContributionChoice").hidden=true;
  $("#publicStandardFee").hidden=false;
  $("#publicAnnualFee").textContent=Number(c.annual_fee||0).toLocaleString("de-DE",{style:"currency",currency:"EUR"});
}
$("#publicClubFallback").textContent=(c.short_name||c.name||"VF").slice(0,4).toUpperCase();
if(c.logo_url){$("#publicClubLogo").src=c.logo_url;$("#publicClubLogo").hidden=false;$("#publicClubFallback").hidden=true;}
if(data.form_pdf_url){
  $("#publicJoinPdf").href=data.form_pdf_url;
  $("#publicJoinPdf").textContent="Beitrittserklärung des Vereins ansehen →";
  $("#publicJoinPdf").hidden=false;
}else{
  const std=new URL("standard-beitritt.html",location.href);
  std.searchParams.set("t",token);
  if(presetGroup) std.searchParams.set("gruppe",presetGroup);
  if(presetContribution) std.searchParams.set("beitrag",presetContribution);
  $("#publicJoinPdf").href=std.href;
  $("#publicJoinPdf").textContent="Standard-Beitrittserklärung ansehen / herunterladen →";
  $("#publicJoinPdf").hidden=false;
}
if(c.creditor_id){
  $("#sepaJoinBox").hidden=false;
  $("#joinSepaText").textContent=c.sepa_mandate_text||"SEPA-Lastschriftmandat für "+c.name;
}
const syncSepaFields=()=>{
  const checked=$("#joinSepa").checked;
  $("#sepaDetails").hidden=!checked;
  $("#joinIban").required=checked;
  $("#joinAccountHolder").required=checked;
  $("#joinSignature").required=checked;
  if(checked&&!$("#joinAccountHolder").value.trim()){
    $("#joinAccountHolder").value=[$("#joinFirst").value,$("#joinLast").value].filter(Boolean).join(" ").trim();
  }
};
$("#joinSepa").addEventListener("change",syncSepaFields);
syncSepaFields();
form.hidden=false;
form.addEventListener("submit",async e=>{
 e.preventDefault();const btn=$("#submitJoin");btn.disabled=true;btn.textContent="Wird übermittelt …";
 const selectedContribution=document.querySelector('input[name="joinContributionType"]:checked');
 const sepaConsent=$("#joinSepa").checked;
 const payload={action:"submit",token,first_name:$("#joinFirst").value,last_name:$("#joinLast").value,email:$("#joinEmail").value,phone:$("#joinPhone").value,birth_date:$("#joinBirth").value,street:$("#joinStreet").value,postal_code:$("#joinPostal").value,city:$("#joinCity").value,group_name:$("#joinGroup").value,contribution_type_id:selectedContribution?.value||"",iban:sepaConsent?$("#joinIban").value:"",account_holder:sepaConsent?$("#joinAccountHolder").value:"",sepa_consent:sepaConsent,applicant_signature:sepaConsent?$("#joinSignature").value:"",privacy_consent:$("#joinPrivacy").checked,website:$("#joinWebsite").value};
 const r=await sb.functions.invoke("membership-join-public",{body:payload});
 if(r.error||!r.data?.ok){let code="";try{code=(await r.error?.context?.json?.())?.error||"";}catch{}const map={NAME_REQUIRED:"Bitte Vorname und Nachname eintragen.",INVALID_EMAIL:"Bitte eine gültige E-Mail-Adresse eingeben.",INVALID_BIRTH_DATE:"Das Geburtsdatum ist ungültig.",INVALID_IBAN:"Die IBAN ist ungültig.",PRIVACY_REQUIRED:"Bitte dem Datenschutz-Hinweis zustimmen.",SEPA_NOT_AVAILABLE:"Für SEPA werden Kontoinhaber, gültige IBAN und die Gläubiger-ID des Vereins benötigt.",SIGNATURE_REQUIRED:"Bitte den Kontoinhaber zur SEPA-Bestätigung erneut eintragen.",SIGNATURE_MISMATCH:"Die SEPA-Bestätigung muss mit dem Kontoinhaber übereinstimmen.",CONTRIBUTION_TYPE_REQUIRED:"Bitte eine Beitragsart auswählen.",INVALID_CONTRIBUTION_TYPE:"Die ausgewählte Beitragsart ist nicht mehr verfügbar. Bitte Seite neu laden.",INVALID_DEPARTMENT:"Die ausgewählte Abteilung ist nicht mehr verfügbar. Bitte Seite neu laden.",DUPLICATE_PENDING:"Für diese Person liegt bereits ein offener Beitrittsantrag vor.",RATE_LIMITED:"Der Beitrittslink erhält gerade ungewöhnlich viele Anfragen. Bitte später erneut versuchen."};msg(map[code]||"Der Antrag konnte nicht übermittelt werden. Bitte erneut versuchen.");btn.disabled=false;btn.textContent="Beitritt absenden →";return;}
 form.hidden=true;$("#joinSuccess").hidden=false;window.scrollTo({top:0,behavior:"smooth"});
});
})();