(function(){
const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const sb=window.vaSupabase;
let club=null,settings=null,currentFilter="pending",joinContributionTypes=[],joinDepartments=[],joinApplications=[],activeJoinApplication=null;

const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
const fmtDate=v=>v?new Date(v).toLocaleDateString("de-DE"):"–";

const fmtMoney=v=>Number(v||0).toLocaleString("de-DE",{style:"currency",currency:"EUR"});

function todayIso(){
  const d=new Date();
  return [d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-");
}

function addDaysIso(value,days){
  const d=new Date(String(value||todayIso())+"T12:00:00");
  if(Number.isNaN(d.getTime())) return todayIso();
  d.setDate(d.getDate()+Number(days||0));
  return [d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-");
}

function prorataAmount(annualFee,entryDate){
  const d=new Date(String(entryDate||todayIso())+"T12:00:00");
  if(Number.isNaN(d.getTime())) return Number(annualFee||0);
  const months=12-d.getMonth();
  return Math.round((Number(annualFee||0)*months/12)*100)/100;
}

function entryAmount(mode,annualFee,entryDate,custom){
  if(mode==="none") return 0;
  if(mode==="custom") return Number(custom||0);
  if(mode==="prorata") return prorataAmount(annualFee,entryDate);
  return Number(annualFee||0);
}

function entryMonth(entryDate){
  const d=new Date(String(entryDate||todayIso())+"T12:00:00");
  return Number.isNaN(d.getTime())?"":d.toLocaleDateString("de-DE",{month:"long"});
}

function refreshAcceptJoinContribution(){
  if(!activeJoinApplication) return;
  const annualFee=Number(activeJoinApplication.annual_fee||0);
  const entryDate=$("#acceptJoinEntryDate")?.value||todayIso();
  const mode=$("#acceptJoinMode")?.value||"full";
  const custom=$("#acceptJoinCustomAmount");
  const due=$("#acceptJoinDueDate");
  const customWrap=$("#acceptJoinCustomWrap");
  const dueWrap=$("#acceptJoinDueWrap");
  const summary=$("#acceptJoinSummary");

  const fullOption=$("#acceptJoinMode")?.querySelector('option[value="full"]');
  const prorataOption=$("#acceptJoinMode")?.querySelector('option[value="prorata"]');
  if(fullOption) fullOption.textContent="Voller Jahresbeitrag – "+fmtMoney(annualFee);
  if(prorataOption) prorataOption.textContent="Anteilig ab "+(entryMonth(entryDate)||"Eintritt")+" – "+fmtMoney(prorataAmount(annualFee,entryDate));

  if(customWrap) customWrap.hidden=mode!=="custom";
  if(dueWrap) dueWrap.hidden=mode==="none";
  if(mode==="custom"&&custom&&!custom.value) custom.value=String(annualFee||"");
  if(mode!=="none"&&due&&!due.value) due.value=addDaysIso(entryDate,14);

  const amount=entryAmount(mode,annualFee,entryDate,custom?.value);
  if(summary){
    const year=new Date(entryDate+"T12:00:00").getFullYear();
    summary.textContent=mode==="none"
      ?"Für "+year+" wird kein Beitrag angelegt. Ab "+(year+1)+" gilt der normale Jahresbeitrag von "+fmtMoney(annualFee)+"."
      :"Beitrag "+year+": "+fmtMoney(amount)+" · fällig "+(due?.value?new Date(due.value+"T12:00:00").toLocaleDateString("de-DE"):"nach Festlegung")+". Ab "+(year+1)+": "+fmtMoney(annualFee)+" / Jahr.";
  }
}

function openAcceptJoinSheet(application){
  activeJoinApplication=application;
  $("#acceptJoinName").textContent=application.first_name+" "+application.last_name;
  $("#acceptJoinAnnualInfo").textContent=(application.contribution_label||"Jahresbeitrag")+" · "+fmtMoney(application.annual_fee)+" / Jahr";
  $("#acceptJoinEntryDate").value=todayIso();
  $("#acceptJoinMode").value="full";
  $("#acceptJoinCustomAmount").value="";
  $("#acceptJoinDueDate").value=addDaysIso(todayIso(),14);
  refreshAcceptJoinContribution();
  openBackdrop($("#acceptJoinSheet"));
}

function buildPreparedJoinUrl(){
  const url=new URL("beitritt.html",location.href);
  url.searchParams.set("t",settings.public_token);

  const group=$("#joinPresetGroup")?.value.trim()||"";
  const contribution=$("#joinPresetContribution")?.value||"";

  if(group) url.searchParams.set("gruppe",group);
  if(contribution) url.searchParams.set("beitrag",contribution);

  return url;
}

function refreshPreparedJoinUrl(){
  if(!settings) return;
  const prepared=buildPreparedJoinUrl();
  $("#joinPublicUrl").value=prepared.href;

  if(!settings.form_pdf_path){
    const std=new URL("standard-beitritt.html",location.href);
    std.searchParams.set("t",settings.public_token);
    const group=$("#joinPresetGroup")?.value.trim()||"";
    const contribution=$("#joinPresetContribution")?.value||"";
    if(group) std.searchParams.set("gruppe",group);
    if(contribution) std.searchParams.set("beitrag",contribution);
    const preview=$("#joinFormPreview");
    if(preview) preview.href=std.href;
  }
}

function loadJoinDepartments(){
  joinDepartments=Array.isArray(club?.departments)
    ? club.departments.map(value=>String(value||"").trim()).filter(Boolean)
    : [];

  const select=$("#joinPresetGroup");
  if(!select) return;

  select.innerHTML='<option value="">Interessent wählt selbst</option>'+
    joinDepartments.map(name=>'<option value="'+esc(name)+'">'+esc(name)+'</option>').join("");

  select.disabled=!joinDepartments.length;
  if(!joinDepartments.length){
    select.innerHTML='<option value="">Keine Abteilungen / Gruppen angelegt</option>';
  }
}

async function loadJoinContributionTypes(){
  const {data,error}=await sb
    .from("contribution_types")
    .select("id,name,annual_fee,is_default,sort_order,created_at")
    .eq("club_id",club.id)
    .eq("active",true)
    .order("sort_order",{ascending:true})
    .order("created_at",{ascending:true});

  if(error) throw error;
  joinContributionTypes=data||[];

  const select=$("#joinPresetContribution");
  if(!select) return;

  select.innerHTML='<option value="">Interessent wählt selbst</option>'+
    joinContributionTypes.map(item=>
      '<option value="'+esc(item.id)+'">'+
      esc(item.name)+' – '+
      Number(item.annual_fee||0).toLocaleString("de-DE",{style:"currency",currency:"EUR"})+
      ' / Jahr</option>'
    ).join("");

  if(!joinContributionTypes.length){
    select.innerHTML='<option value="">Standardbeitrag wird verwendet</option>';
    select.disabled=true;
  }else{
    select.disabled=false;
  }
}

async function refreshFormSource(){
  const preview=$("#joinFormPreview");
  const remove=$("#removeJoinPdf");
  const status=$("#joinPdfStatus");
  const hint=$("#joinPdfHint");
  if(settings?.form_pdf_path){
    const signed=await sb.storage.from("membership-forms").createSignedUrl(settings.form_pdf_path,3600);
    status.textContent="Eigene Beitrittserklärung aktiv ✓";
    hint.textContent="Die eigene PDF ersetzt die VEREINSFACH-Standarderklärung.";
    preview.textContent="Eigene PDF ansehen →";
    preview.href=signed.error?"#":(signed.data?.signedUrl||"#");
    remove.hidden=false;
  }else{
    const std=new URL("standard-beitritt.html",location.href);
    std.searchParams.set("t",settings.public_token);
    status.textContent="VEREINSFACH-Standard wird verwendet.";
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
  loadJoinDepartments();
  await loadJoinContributionTypes();
  refreshPreparedJoinUrl();
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
  const oldPath=settings.form_pdf_path;
  const save=await sb.from("membership_join_settings").update({form_pdf_path:null,updated_at:new Date().toISOString()}).eq("club_id",club.id);
  if(save.error) throw save.error;
  settings.form_pdf_path=null;
  const del=await sb.storage.from("membership-forms").remove([oldPath]);
  if(del.error) console.warn("Alte Beitritts-PDF konnte nicht entfernt werden:",del.error);
  await refreshFormSource();
  showToast("Eigene PDF entfernt – VEREINSFACH-Standard ist wieder aktiv.");
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
      '<div><span>Abteilung / Gruppe</span><b>'+esc(a.group_name||"–")+'</b></div>'+
      '<div><span>Beitragsart</span><b>'+esc(a.contribution_label||"Standardbeitrag")+'</b></div>'+
      '<div><span>Jahresbeitrag</span><b>'+Number(a.annual_fee||0).toLocaleString("de-DE",{style:"currency",currency:"EUR"})+'</b></div>'+
      '<div><span>Kontoinhaber</span><b>'+esc(a.account_holder||"–")+'</b></div>'+
      '<div><span>IBAN</span><b>'+esc(a.iban||"–")+'</b></div>'+
      '<div><span>SEPA</span><b>'+(a.sepa_consent?"Zustimmung erteilt":"Nein")+'</b></div>'+
    '</div>'+actions+'</article>';
}

async function loadApplications(){
  const q=await sb.from("membership_applications").select("*").eq("club_id",club.id).eq("status",currentFilter).order("submitted_at",{ascending:false});
  if(q.error) throw q.error;
  const count=await sb.from("membership_applications").select("id",{count:"exact",head:true}).eq("club_id",club.id).eq("status","pending");
  if(!count.error) $("#joinPendingCount").textContent=count.count||0;
  joinApplications=q.data||[];
  $("#joinApplicationRows").innerHTML=joinApplications.map(applicationCard).join("")||'<div class="team-empty">Keine Einträge.</div>';
  $("[data-accept-join]").forEach(b=>b.addEventListener("click",e=>{
    const application=joinApplications.find(item=>item.id===e.currentTarget.dataset.acceptJoin);
    if(application) openAcceptJoinSheet(application);
  }));
  $("[data-reject-join]").forEach(b=>b.addEventListener("click",async e=>{
    if(!confirm("Diesen Beitrittsantrag ablehnen?")) return;
    const r=await sb.rpc("reject_membership_application",{p_application_id:e.currentTarget.dataset.rejectJoin});
    if(r.error){
      const message=String(r.error?.message||"");
      if(message.includes("APPLICATION_NOT_FOUND_OR_ALREADY_REVIEWED")) return showToast("Dieser Antrag wurde bereits von jemandem bearbeitet.");
      return handleAppError(r.error,"Antrag konnte nicht abgelehnt werden.");
    }
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

  $("#closeAcceptJoin")?.addEventListener("click",()=>{activeJoinApplication=null;closeBackdrop($("#acceptJoinSheet"));});
  $("#acceptJoinSheet")?.addEventListener("click",e=>{if(e.target===$("#acceptJoinSheet")){activeJoinApplication=null;closeBackdrop($("#acceptJoinSheet"));}});
  $("#acceptJoinEntryDate")?.addEventListener("change",()=>{
    const due=$("#acceptJoinDueDate");
    if(due) due.value=addDaysIso($("#acceptJoinEntryDate").value,14);
    refreshAcceptJoinContribution();
  });
  $("#acceptJoinMode")?.addEventListener("change",refreshAcceptJoinContribution);
  $("#acceptJoinCustomAmount")?.addEventListener("input",refreshAcceptJoinContribution);
  $("#acceptJoinDueDate")?.addEventListener("change",refreshAcceptJoinContribution);
  $("#confirmAcceptJoin")?.addEventListener("click",async e=>{
    if(!activeJoinApplication) return;
    const button=e.currentTarget;
    const entryDate=$("#acceptJoinEntryDate").value;
    const mode=$("#acceptJoinMode").value;
    const createContribution=mode!=="none";
    const amount=entryAmount(mode,activeJoinApplication.annual_fee,entryDate,$("#acceptJoinCustomAmount").value);
    const dueDate=createContribution?$("#acceptJoinDueDate").value:null;
    const year=new Date(entryDate+"T12:00:00").getFullYear();

    if(year!==new Date().getFullYear()) return showToast("Das Eintrittsdatum muss im aktuellen Jahr liegen.");
    if(createContribution&&amount<=0) return showToast("Bitte einen gültigen Beitrag fürs Eintrittsjahr eintragen.");
    if(createContribution&&!dueDate) return showToast("Bitte ein Fälligkeitsdatum festlegen.");
    if(createContribution&&dueDate<entryDate) return showToast("Die Fälligkeit darf nicht vor dem Eintritt liegen.");

    button.disabled=true;
    button.textContent="Wird übernommen …";
    const result=await sb.rpc("accept_membership_application_with_entry_contribution",{
      p_application_id:activeJoinApplication.id,
      p_entry_date:entryDate,
      p_entry_amount:createContribution?amount:0,
      p_entry_due_date:dueDate,
      p_create_entry_contribution:createContribution
    });
    if(result.error){
      button.disabled=false;
      button.textContent="Als Mitglied übernehmen";
      const message=String(result.error?.message||"")+" "+String(result.error?.details||"");
      if(message.includes("MEMBER_ALREADY_EXISTS")) return showToast("Dieses Mitglied scheint bereits vorhanden zu sein. Bitte Mitgliederliste prüfen.");
      if(message.includes("APPLICATION_NOT_FOUND_OR_ALREADY_REVIEWED")) return showToast("Dieser Antrag wurde bereits von jemandem bearbeitet.");
      if(message.includes("ENTRY_DUE_DATE_BEFORE_ENTRY")) return showToast("Die Fälligkeit darf nicht vor dem Eintritt liegen.");
      return handleAppError(result.error,"Beitritt konnte nicht übernommen werden.");
    }

    closeBackdrop($("#acceptJoinSheet"));
    activeJoinApplication=null;
    button.disabled=false;
    button.textContent="Als Mitglied übernehmen";
    showToast("Als Mitglied übernommen ✓");
    await loadApplications();
  });

  $("#joinPresetGroup")?.addEventListener("change",refreshPreparedJoinUrl);
  $("#joinPresetContribution")?.addEventListener("change",refreshPreparedJoinUrl);

  $("#copyJoinLink").addEventListener("click",async()=>{
    refreshPreparedJoinUrl();
    await navigator.clipboard.writeText($("#joinPublicUrl").value);
    showToast("Beitrittslink kopiert ✓");
  });
  $("#openJoinMail").addEventListener("click",()=>{
    const recipient=$("#joinMailRecipient").value.trim();
    if(!recipient) return showToast("Bitte zuerst eine E-Mail-Adresse eintragen.");
    refreshPreparedJoinUrl();
    const subject="Beitritt zu "+club.name;
    const group=$("#joinPresetGroup")?.value.trim()||"";
    const selectedId=$("#joinPresetContribution")?.value||"";
    const selectedType=joinContributionTypes.find(item=>item.id===selectedId);
    const prepLines=[
      group?"Abteilung / Gruppe: "+group:"",
      selectedType?"Beitragsart: "+selectedType.name+" – "+Number(selectedType.annual_fee||0).toLocaleString("de-DE",{style:"currency",currency:"EUR"})+" / Jahr":""
    ].filter(Boolean);
    const bodyText=[
      "Hallo,",
      "",
      "hier kannst du deinen Beitritt zu "+club.name+" direkt online ausfüllen:",
      $("#joinPublicUrl").value,
      prepLines.length?"":"",
      ...prepLines,
      "",
      "Viele Grüße"
    ].join("\r\n");
    location.href="mailto:"+encodeURIComponent(recipient)+"?subject="+encodeURIComponent(subject)+"&body="+encodeURIComponent(bodyText);
  });
  $("#joinPdfInput").addEventListener("change",async e=>{try{await uploadPdf(e.target.files?.[0]);}catch(err){await handleAppError(err,"PDF konnte nicht gespeichert werden.");}finally{e.target.value="";}});
  $("#removeJoinPdf").addEventListener("click",async()=>{try{await removePdf();}catch(err){await handleAppError(err,"PDF konnte nicht entfernt werden.");}});
  $$("[data-join-filter]").forEach(b=>b.addEventListener("click",async e=>{
    $$("[data-join-filter]").forEach(x=>x.classList.remove("active"));e.currentTarget.classList.add("active");
    currentFilter=e.currentTarget.dataset.joinFilter;await loadApplications();
  }));
};})();