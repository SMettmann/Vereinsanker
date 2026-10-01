(function(){
const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const sb=window.vaSupabase;
let club=null,settings=null,currentFilter="pending";

const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
const fmtDate=v=>v?new Date(v).toLocaleDateString("de-DE"):"–";

async function refreshFormSource(){
  const preview=$("#joinFormPreview");
  const remove=$("#removeJoinPdf");
  const status=$("#joinPdfStatus");
  const hint=$("#joinPdfHint");
  if(settings?.form_pdf_path){
    const signed=await sb.storage.from("membership-forms").createSignedUrl(settings.form_pdf_path,3600);
    status.textContent="Eigene Beitrittserklärung aktiv ✓";
    hint.textContent="Die eigene PDF ersetzt die VEREINSANKER-Standarderklärung.";
    preview.textContent="Eigene PDF ansehen →";
    preview.href=signed.error?"#":(signed.data?.signedUrl||"#");
    remove.hidden=false;
  }else{
    const std=new URL("standard-beitritt.html",location.href);
    std.searchParams.set("t",settings.public_token);
    status.textContent="VEREINSANKER-Standard wird verwendet.";
    hint.textContent="Eigene PDF optional · maximal 5 MB";
    preview.textContent="Standard ansehen / herunterladen →";
    preview.href=std.href;
    remove.hidden=true;
  }
}

async function ensureSettings(){
  let {data,error}=await sb.from("membership_join_settings").select("*").eq("club_id",club.id).maybeSingle();
  if(error) throw error;
  if(!data){
    const created=await sb.from("membership_join_settings").insert({club_id:club.id,enabled:true}).select("*").single();
    if(created.error) throw created.error;
    data=created.data;
  }
  settings=data;
  const url=new URL("beitritt.html",location.href);
  url.searchParams.set("t",settings.public_token);
  $("#joinPublicUrl").value=url.href;
  await refreshFormSource();
}

async function uploadPdf(file){
  if(!file||file.type!=="application/pdf") return showToast("Bitte eine PDF-Datei auswählen.");
  if(file.size>5*1024*1024) return showToast("Die PDF darf maximal 5 MB groß sein.");
  const path=club.id+"/beitrittserklaerung.pdf";
  const up=await sb.storage.from("membership-forms").upload(path,file,{upsert:true,contentType:"application/pdf"});
  if(up.error) throw up.error;
  const save=await sb.from("membership_join_settings").update({form_pdf_path:path,updated_at:new Date().toISOString()}).eq("club_id",club.id);
  if(save.error) throw save.error;
  settings.form_pdf_path=path;
  await refreshFormSource();
  showToast("Eigene Beitrittserklärung gespeichert.");
}

async function removePdf(){
  if(!settings?.form_pdf_path) return;
  const del=await sb.storage.from("membership-forms").remove([settings.form_pdf_path]);
  if(del.error) throw del.error;
  const save=await sb.from("membership_join_settings").update({form_pdf_path:null,updated_at:new Date().toISOString()}).eq("club_id",club.id);
  if(save.error) throw save.error;
  settings.form_pdf_path=null;
  await refreshFormSource();
  showToast("Eigene PDF entfernt – VEREINSANKER-Standard ist wieder aktiv.");
}

function applicationCard(a){
  const address=[a.street,[a.postal_code,a.city].filter(Boolean).join(" ")].filter(Boolean).join(", ")||"–";
  const status=a.status==="pending"
    ? '<span class="join-status pending">Offen</span>'
    : a.status==="accepted"
      ? '<span class="join-status accepted">Übernommen</span>'
      : '<span class="join-status rejected">Abgelehnt</span>';
  const actions=a.status==="pending"
    ? '<div class="join-app-actions"><button class="primary" data-accept-join="'+esc(a.id)+'" type="button">Als Mitglied übernehmen</button><button class="danger-link" data-reject-join="'+esc(a.id)+'" type="button">Ablehnen</button></div>'
    : "";
  return '<article class="join-app-card">'+
    '<div class="join-app-head"><div><strong>'+esc(a.first_name+" "+a.last_name)+'</strong><span>'+esc(a.email)+'</span></div>'+status+'</div>'+
    '<div class="join-app-grid">'+
      '<div><span>Eingegangen</span><b>'+fmtDate(a.submitted_at)+'</b></div>'+
      '<div><span>Geburtsdatum</span><b>'+fmtDate(a.birth_date)+'</b></div>'+
      '<div><span>Telefon</span><b>'+esc(a.phone||"–")+'</b></div>'+
      '<div><span>Adresse</span><b>'+esc(address)+'</b></div>'+
      '<div><span>Gruppe/Wunsch</span><b>'+esc(a.group_name||"–")+'</b></div>'+
      '<div><span>Jahresbeitrag</span><b>'+Number(a.annual_fee||0).toLocaleString("de-DE",{style:"currency",currency:"EUR"})+'</b></div>'+
      '<div><span>IBAN</span><b>'+esc(a.iban||"–")+'</b></div>'+
      '<div><span>SEPA</span><b>'+(a.sepa_consent?"Zustimmung erteilt":"Nein")+'</b></div>'+
    '</div>'+actions+'</article>';
}

async function loadApplications(){
  const q=await sb.from("membership_applications").select("*").eq("club_id",club.id).eq("status",currentFilter).order("submitted_at",{ascending:false});
  if(q.error) throw q.error;
  const count=await sb.from("membership_applications").select("id",{count:"exact",head:true}).eq("club_id",club.id).eq("status","pending");
  if(!count.error) $("#joinPendingCount").textContent=count.count||0;
  $("#joinApplicationRows").innerHTML=(q.data||[]).map(applicationCard).join("")||'<div class="team-empty">Keine Einträge.</div>';
  $$("[data-accept-join]").forEach(b=>b.addEventListener("click",async e=>{
    const btn=e.currentTarget; btn.disabled=true; btn.textContent="Wird übernommen …";
    const r=await sb.rpc("accept_membership_application",{p_application_id:btn.dataset.acceptJoin});
    if(r.error){btn.disabled=false;btn.textContent="Als Mitglied übernehmen";return handleAppError(r.error,"Beitritt konnte nicht übernommen werden.");}
    showToast("Als Mitglied übernommen ✓");
    await loadApplications();
  }));
  $$("[data-reject-join]").forEach(b=>b.addEventListener("click",async e=>{
    if(!confirm("Diesen Beitrittsantrag ablehnen?")) return;
    const r=await sb.from("membership_applications").update({status:"rejected",reviewed_at:new Date().toISOString(),reviewed_by:vaSession.user.id}).eq("id",e.currentTarget.dataset.rejectJoin).eq("status","pending");
    if(r.error) return handleAppError(r.error,"Antrag konnte nicht abgelehnt werden.");
    showToast("Antrag abgelehnt.");
    await loadApplications();
  }));
}

window.initJoinsPage=async function(){
  club=vaClub||await getClub();
  if(!club) return location.replace("onboarding.html");
  applyClubBrand(club);
  applyTrialUI(club);
  await ensureSettings();
  await loadApplications();

  $("#copyJoinLink").addEventListener("click",async()=>{
    await navigator.clipboard.writeText($("#joinPublicUrl").value);
    showToast("Beitrittslink kopiert ✓");
  });
  $("#openJoinMail").addEventListener("click",()=>{
    const recipient=$("#joinMailRecipient").value.trim();
    if(!recipient) return showToast("Bitte zuerst eine E-Mail-Adresse eintragen.");
    const subject="Beitritt zu "+club.name;
    const body="Hallo,%0D%0A%0D%0Ahier kannst du deinen Beitritt zu "+encodeURIComponent(club.name)+" direkt online ausfüllen:%0D%0A"+encodeURIComponent($("#joinPublicUrl").value)+"%0D%0A%0D%0AViele Grüße";
    location.href="mailto:"+encodeURIComponent(recipient)+"?subject="+encodeURIComponent(subject)+"&body="+body;
  });
  $("#joinPdfInput").addEventListener("change",async e=>{try{await uploadPdf(e.target.files?.[0]);}catch(err){await handleAppError(err,"PDF konnte nicht gespeichert werden.");}finally{e.target.value="";}});
  $("#removeJoinPdf").addEventListener("click",async()=>{try{await removePdf();}catch(err){await handleAppError(err,"PDF konnte nicht entfernt werden.");}});
  $$("[data-join-filter]").forEach(b=>b.addEventListener("click",async e=>{
    $$("[data-join-filter]").forEach(x=>x.classList.remove("active"));e.currentTarget.classList.add("active");
    currentFilter=e.currentTarget.dataset.joinFilter;await loadApplications();
  }));
};})();