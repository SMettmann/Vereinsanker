(function(){
  const sb=window.vaSupabase;
  const $=(s,r=document)=>r.querySelector(s);
  const esc=value=>String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[ch]));

  function dateText(value){
    if(!value) return "–";
    return new Date(value).toLocaleDateString("de-DE",{day:"2-digit",month:"2-digit",year:"numeric"});
  }

  function statusLabel(value){
    return value==="done"?"Erledigt":value==="in_review"?"In Prüfung":"Neu";
  }

  function categoryLabel(value){
    return value==="idea"?"Verbesserung":"Support";
  }

  async function loadHistory(clubId){
    const target=$("#supportHistory");
    if(!target) return;

    const {data,error}=await sb
      .from("support_requests")
      .select("id,category,subject,status,created_at")
      .eq("club_id",clubId)
      .order("created_at",{ascending:false})
      .limit(10);

    if(error){
      console.error("Supportverlauf",error);
      target.innerHTML='<div class="team-empty">Bisherige Anfragen konnten nicht geladen werden.</div>';
      return;
    }

    if(!(data||[]).length){
      target.innerHTML='<div class="team-empty">Noch keine Supportanfragen oder Vorschläge gesendet.</div>';
      return;
    }

    target.innerHTML=data.map(row=>
      '<div class="support-history-row">'+
        '<div><span class="support-type '+esc(row.category)+'">'+esc(categoryLabel(row.category))+'</span><strong>'+esc(row.subject)+'</strong><small>'+esc(dateText(row.created_at))+'</small></div>'+
        '<span class="support-status '+esc(row.status)+'">'+esc(statusLabel(row.status))+'</span>'+
      '</div>'
    ).join("");
  }

  window.initSupportPage=async function(club,session){
    if(!club||!session?.user) throw new Error("SUPPORT_CONTEXT_MISSING");

    const form=$("#supportForm");
    const category=$("#supportCategory");
    const subject=$("#supportSubject");
    const message=$("#supportMessage");
    const feedback=$("#supportMessageState");
    const button=$("#sendSupport");

    const ref=document.referrer;
    let pagePath="";
    try{
      const u=new URL(ref);
      if(u.origin===location.origin) pagePath=u.pathname.split("/").pop()||"";
    }catch{}

    $("#supportClubName").textContent=club.name||"Verein";
    $("#supportAccountEmail").textContent=session.user.email||"–";

    form.addEventListener("submit",async event=>{
      event.preventDefault();

      const subjectValue=subject.value.trim();
      const messageValue=message.value.trim();
      if(subjectValue.length<3||messageValue.length<10){
        feedback.textContent="Bitte Betreff und Nachricht etwas genauer ausfüllen.";
        feedback.className="support-message error";
        return;
      }

      button.disabled=true;
      button.textContent="Wird gesendet …";
      feedback.textContent="";

      const {error}=await sb.from("support_requests").insert({
        club_id:club.id,
        user_id:session.user.id,
        user_email:session.user.email||"",
        category:category.value==="idea"?"idea":"support",
        subject:subjectValue.slice(0,160),
        message:messageValue.slice(0,5000),
        page_path:pagePath||location.pathname.split("/").pop()||null
      });

      if(error){
        console.error("Support senden",error);
        feedback.textContent="Nachricht konnte gerade nicht gespeichert werden. Bitte erneut versuchen.";
        feedback.className="support-message error";
        button.disabled=false;
        button.textContent="Absenden";
        return;
      }

      feedback.textContent=category.value==="idea"
        ?"Verbesserungsvorschlag ist angekommen. Danke!"
        :"Supportanfrage ist angekommen.";
      feedback.className="support-message success";
      subject.value="";
      message.value="";
      category.value="support";
      button.disabled=false;
      button.textContent="Absenden";
      await loadHistory(club.id);
    });

    $("#supportCategory")?.addEventListener("change",()=>{
      $("#supportFormTitle").textContent=category.value==="idea"?"Verbesserung vorschlagen":"Support kontaktieren";
      $("#supportIntro").textContent=category.value==="idea"
        ?"Was würde euren Vereinsalltag mit VEREINSFACH einfacher machen?"
        :"Beschreibe kurz, wobei du Unterstützung brauchst.";
    });

    await loadHistory(club.id);
  };
})();