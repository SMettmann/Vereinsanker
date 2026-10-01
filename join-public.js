(async function(){
const $=s=>document.querySelector(s),sb=window.vaSupabase;
const token=new URLSearchParams(location.search).get("t")||"";
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
const contributionTypes=Array.isArray(data.contribution_types)?data.contribution_types:[];
if(contributionTypes.length){
  $("#publicStandardFee").hidden=true;
  $("#joinContributionChoice").hidden=false;
  const selectedDefault=contributionTypes.find(item=>item.is_default)||contributionTypes[0];
  $("#joinContributionOptions").innerHTML=contributionTypes.map(item=>
    '<label class="join-contribution-option">'+
      '<input type="radio" name="joinContributionType" value="'+item.id+'"'+(item.id===selectedDefault.id?' checked':'')+'>'+
      '<span><strong>'+String(item.name||"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[ch]))+'</strong>'+
      '<b>'+Number(item.annual_fee||0).toLocaleString("de-DE",{style:"currency",currency:"EUR"})+' / Jahr</b></span>'+
    '</label>'
  ).join("");
}else{
  $("#joinContributionChoice").hidden=true;
  $("#publicStandardFee").hidden=false;
  $("#publicAnnualFee").textContent=Number(c.annual_fee||0).toLocaleString("de-DE",{style:"currency",currency:"EUR"});
}
$("#publicClubFallback").textContent=(c.short_name||c.name||"VA").slice(0,4).toUpperCase();
if(c.logo_url){$("#publicClubLogo").src=c.logo_url;$("#publicClubLogo").hidden=false;$("#publicClubFallback").hidden=true;}
if(data.form_pdf_url){
  $("#publicJoinPdf").href=data.form_pdf_url;
  $("#publicJoinPdf").textContent="Beitrittserklärung des Vereins ansehen →";
  $("#publicJoinPdf").hidden=false;
}else{
  const std=new URL("standard-beitritt.html",location.href);
  std.searchParams.set("t",token);
  $("#publicJoinPdf").href=std.href;
  $("#publicJoinPdf").textContent="Standard-Beitrittserklärung ansehen / herunterladen →";
  $("#publicJoinPdf").hidden=false;
}
if(c.creditor_id){$("#sepaJoinBox").hidden=false;$("#joinSepaText").textContent="Ich ermächtige "+c.name+" (Gläubiger-ID "+c.creditor_id+"), fällige Mitgliedsbeiträge per SEPA-Lastschrift von meinem Konto einzuziehen.";}
$("#joinSepa").addEventListener("change",e=>{$("#signatureBox").hidden=!e.target.checked;});
form.hidden=false;
form.addEventListener("submit",async e=>{
 e.preventDefault();const btn=$("#submitJoin");btn.disabled=true;btn.textContent="Wird übermittelt …";
 const selectedContribution=document.querySelector('input[name="joinContributionType"]:checked');
 const payload={action:"submit",token,first_name:$("#joinFirst").value,last_name:$("#joinLast").value,email:$("#joinEmail").value,phone:$("#joinPhone").value,birth_date:$("#joinBirth").value,street:$("#joinStreet").value,postal_code:$("#joinPostal").value,city:$("#joinCity").value,group_name:$("#joinGroup").value,contribution_type_id:selectedContribution?.value||"",iban:$("#joinIban").value,sepa_consent:$("#joinSepa").checked,applicant_signature:$("#joinSignature").value,privacy_consent:$("#joinPrivacy").checked,website:$("#joinWebsite").value};
 const r=await sb.functions.invoke("membership-join-public",{body:payload});
 if(r.error||!r.data?.ok){let code="";try{code=(await r.error?.context?.json?.())?.error||"";}catch{}const map={INVALID_EMAIL:"Bitte eine gültige E-Mail-Adresse eingeben.",INVALID_IBAN:"Die IBAN ist ungültig.",PRIVACY_REQUIRED:"Bitte dem Datenschutz-Hinweis zustimmen.",SIGNATURE_REQUIRED:"Bitte den Namen zur SEPA-Bestätigung eintragen.",CONTRIBUTION_TYPE_REQUIRED:"Bitte eine Beitragsart auswählen.",INVALID_CONTRIBUTION_TYPE:"Die ausgewählte Beitragsart ist nicht mehr verfügbar. Bitte Seite neu laden.",DUPLICATE_RECENT:"Dieser Antrag wurde gerade bereits übermittelt."};msg(map[code]||"Der Antrag konnte nicht übermittelt werden. Bitte erneut versuchen.");btn.disabled=false;btn.textContent="Beitritt absenden →";return;}
 form.hidden=true;$("#joinSuccess").hidden=false;window.scrollTo({top:0,behavior:"smooth"});
});
})();