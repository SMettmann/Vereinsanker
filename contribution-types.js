(function(){
  const sb=window.vaSupabase;
  const $=(s,r=document)=>r.querySelector(s);
  const esc=value=>String(value??"").replace(/[&<>"']/g,ch=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[ch]));
  const euro=value=>Number(value||0).toLocaleString("de-DE",{style:"currency",currency:"EUR"});

  let club=null;
  let types=[];
  let editingId=null;

  function managerMessage(text,type="info"){
    const el=$("#contributionTypeMessage");
    if(!el) return;
    el.textContent=text;
    el.className="contribution-type-message "+type;
    el.hidden=!text;
  }

  function getBillingIntervalField(){
    const existing=$("#contributionTypeInterval");
    if(existing) return existing;
    const editor=$("#contributionTypeEditor");
    if(!editor) return null;
    const field=document.createElement("div");
    field.className="field";
    const label=document.createElement("label");
    label.setAttribute("for","contributionTypeInterval");
    label.textContent="Zahlungsrhythmus";
    const select=document.createElement("select");
    select.id="contributionTypeInterval";
    [["yearly","Jährlich"],["monthly","Monatlich"]].forEach(([value,name])=>{
      const option=document.createElement("option");
      option.value=value;
      option.textContent=name;
      select.appendChild(option);
    });
    field.append(label,select);
    const row=editor.querySelector(".contribution-editor-row");
    if(row) row.insertAdjacentElement("afterend",field);
    else editor.appendChild(field);
    return select;
  }

  function resetEditor(){
    editingId=null;
    $("#contributionTypeName").value="";
    $("#contributionTypeFee").value="";
    const interval=getBillingIntervalField();
    if(interval) interval.value="yearly";
    $("#contributionTypeDefault").checked=false;
    $("#contributionTypeEditor").hidden=true;
    $("#contributionTypeEditor").style.display="none";
    $("#contributionTypeEditorTitle").textContent="Beitragsart hinzufügen";
    $("#saveContributionType").textContent="Speichern";
  }

  function openEditor(item=null){
    const editor=$("#contributionTypeEditor");
    const interval=getBillingIntervalField();
    if(!editor||!interval||!$("#contributionTypeName")||!$("#contributionTypeFee")){
      managerMessage("Das Beitragsformular fehlt. Bitte settings.html und contribution-types.js gemeinsam auf STRATO aktualisieren und mit Strg + F5 neu laden.","error");
      return;
    }
    editingId=item?.id||null;
    $("#contributionTypeName").value=item?.name||"";
    interval.value=item?.billing_interval||"yearly";
    $("#contributionTypeFee").value=item?Number(item.annual_fee||0)/(item.billing_interval==="monthly"?12:1):"";
    $("#contributionTypeDefault").checked=item?.is_default||(!types.length);
    $("#contributionTypeEditorTitle").textContent=item?"Beitragsart bearbeiten":"Beitragsart hinzufügen";
    $("#saveContributionType").textContent=item?"Änderungen speichern":"Beitragsart speichern";
    editor.hidden=false;
    editor.style.display="block";
    editor.scrollIntoView?.({block:"nearest",behavior:"smooth"});
    setTimeout(()=>$("#contributionTypeName")?.focus(),30);
  }

  function render(){
    const rows=$("#contributionTypeRows");
    const mode=$("#contributionTypeMode");
    if(!rows||!mode) return;

    if(!types.length){
      mode.innerHTML='<strong>Einfacher Modus aktiv</strong><span>Beim digitalen Beitritt wird euer Standardbeitrag verwendet. Ihr müsst hier nichts weiter einstellen.</span>';
      rows.innerHTML='<div class="contribution-type-empty">Noch keine zusätzlichen Beitragsarten angelegt.</div>';
      return;
    }

    mode.innerHTML='<strong>Mehrere Beitragsarten aktiv</strong><span>Beim digitalen Beitritt wählt das neue Mitglied eine dieser Varianten aus.</span>';
    rows.innerHTML=types.map(item=>
      '<div class="contribution-type-row">'+
        '<div><strong>'+esc(item.name)+'</strong><span>'+euro(Number(item.annual_fee||0)/(item.billing_interval==='monthly'?12:1))+(item.billing_interval==='monthly'?' / Monat':' / Jahr')+(item.is_default?' · Vorauswahl':'')+'</span></div>'+
        (item.is_default?'<b class="contribution-type-default">Standard</b>':'')+
        '<div class="contribution-type-actions">'+
          '<button type="button" data-edit-contribution-type="'+esc(item.id)+'">Bearbeiten</button>'+
          '<button type="button" class="danger" data-delete-contribution-type="'+esc(item.id)+'">Löschen</button>'+
        '</div>'+
      '</div>'
    ).join("");

    rows.querySelectorAll("[data-edit-contribution-type]").forEach(button=>{
      button.addEventListener("click",()=>{
        const item=types.find(x=>x.id===button.dataset.editContributionType);
        if(item) openEditor(item);
      });
    });

    rows.querySelectorAll("[data-delete-contribution-type]").forEach(button=>{
      button.addEventListener("click",()=>removeType(button.dataset.deleteContributionType));
    });
  }

  async function load(){
    const {data,error}=await sb
      .from("contribution_types")
      .select("id,name,annual_fee,billing_interval,is_default,active,sort_order,created_at")
      .eq("club_id",club.id)
      .eq("active",true)
      .order("sort_order",{ascending:true})
      .order("created_at",{ascending:true});
    if(error) throw error;
    types=data||[];
    render();
  }

  async function saveType(){
    const name=$("#contributionTypeName").value.trim();
    const fee=Number($("#contributionTypeFee").value);
    const interval=getBillingIntervalField()?.value||"yearly";
    let isDefault=$("#contributionTypeDefault").checked;

    if(name.length<2){
      managerMessage("Bitte eine Bezeichnung mit mindestens 2 Zeichen eingeben.","error");
      $("#contributionTypeName").focus();
      return;
    }
    if(!Number.isFinite(fee)||fee<0){
      managerMessage("Bitte einen gültigen Beitrag eingeben.","error");
      $("#contributionTypeFee").focus();
      return;
    }

    if(!types.length) isDefault=true;

    const button=$("#saveContributionType");
    button.disabled=true;
    button.textContent="Wird gespeichert …";
    managerMessage("");

    try{
      if(isDefault){
        const clear=await sb
          .from("contribution_types")
          .update({is_default:false,updated_at:new Date().toISOString()})
          .eq("club_id",club.id)
          .eq("is_default",true);
        if(clear.error) throw clear.error;
      }

      const payload={
        club_id:club.id,
        name,
        annual_fee:Number((fee*(interval==="monthly"?12:1)).toFixed(2)),
        billing_interval:interval,
        is_default:isDefault,
        active:true,
        updated_at:new Date().toISOString()
      };

      const result=editingId
        ? await sb.from("contribution_types").update(payload).eq("id",editingId).eq("club_id",club.id)
        : await sb.from("contribution_types").insert(payload);

      if(result.error) throw result.error;

      resetEditor();
      await load();
      managerMessage("Beitragsarten gespeichert ✓","success");
      if(window.showToast) showToast("Beitragsart gespeichert ✓");
    }catch(error){
      console.error("Beitragsart speichern:",error);
      const text=String(error?.message||"");
      managerMessage(
        text.toLowerCase().includes("duplicate")||text.includes("contribution_types_club_name_unique")
          ?"Diese Beitragsart gibt es bereits."
          :"Beitragsart konnte nicht gespeichert werden.",
        "error"
      );
    }finally{
      button.disabled=false;
      button.textContent=editingId?"Änderungen speichern":"Beitragsart speichern";
    }
  }

  async function removeType(id){
    const item=types.find(x=>x.id===id);
    if(!item) return;
    if(!confirm('Beitragsart „'+item.name+'“ löschen? Bestehende Mitglieder und alte Anträge behalten ihren gespeicherten Beitrag.')) return;

    const {error}=await sb.from("contribution_types").delete().eq("id",id).eq("club_id",club.id);
    if(error){
      console.error("Beitragsart löschen:",error);
      managerMessage("Beitragsart konnte nicht gelöscht werden.","error");
      return;
    }

    const remaining=types.filter(x=>x.id!==id);
    if(item.is_default&&remaining.length){
      const promote=await sb.from("contribution_types")
        .update({is_default:true,updated_at:new Date().toISOString()})
        .eq("id",remaining[0].id)
        .eq("club_id",club.id);
      if(promote.error) console.error("Neue Standard-Beitragsart:",promote.error);
    }

    resetEditor();
    await load();
    managerMessage("Beitragsart gelöscht.","success");
  }

  // Event-Delegation funktioniert auch dann, wenn die Einstellungen später initialisiert werden.
  document.addEventListener("click",event=>{
    if(!event.target?.closest?.("#addContributionType")) return;
    event.preventDefault();
    openEditor();
  });

  window.initContributionTypes=async function(currentClub){
    club=currentClub;
    if(!club||!$("#contributionTypesManager")) return;

    $("#cancelContributionType")?.addEventListener("click",resetEditor);
    $("#saveContributionType")?.addEventListener("click",saveType);

    await load();
  };
})();