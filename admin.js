(function(){
  const sb=window.vaSupabase;
  const $=(s,r=document)=>r.querySelector(s);
  const esc=value=>String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[ch]));

  function dateText(value,withTime=false){
    if(!value) return "–";
    return new Date(value).toLocaleString("de-DE",withTime
      ? {day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}
      : {day:"2-digit",month:"2-digit",year:"numeric"});
  }

  function billingLabel(row){
    const status=row.subscription_status;
    if(status==="active_monthly") return "Monat aktiv";
    if(status==="active_yearly") return "Jahr aktiv";
    if(status==="payment_failed") return "Zahlung offen";
    if(status==="canceled") return "Beendet";
    if(status==="trial"){
      return new Date(row.trial_ends_at||0)>new Date()?"Test aktiv":"Test beendet";
    }
    return status||"–";
  }

  function statusLabel(value){
    return value==="done"?"Erledigt":value==="in_review"?"In Prüfung":"Neu";
  }

  function categoryLabel(value){
    return value==="idea"?"Verbesserung":"Support";
  }

  function euroFromCents(value){
    return (Number(value||0)/100).toLocaleString("de-DE",{style:"currency",currency:"EUR"});
  }

  async function loadDashboard(){
    const response=await sb.functions.invoke("admin-dashboard",{body:{action:"overview"}});
    if(response.error||!response.data?.ok) throw response.error||new Error(response.data?.error||"ADMIN_LOAD_FAILED");

    const payload=response.data;
    const o=payload.overview||{};
    const cards=[
      ["adminVisitorsToday",o.visitors_today||0],
      ["adminVisitors7d",o.visitors_7d||0],
      ["adminVisitors30d",o.visitors_30d||0],
      ["adminClubs",o.clubs_total||0],
      ["adminMembers",o.members_active||0],
      ["adminPaidClubs",o.paid_clubs||0],
      ["adminHandbook",o.handbook_downloads||0],
      ["adminSupportOpen",o.support_open||0]
    ];
    cards.forEach(([id,value])=>{const el=$("#"+id);if(el)el.textContent=String(value);});

    const donations=payload.donations||{};
    const donationOpen=Number(donations.open_total_cents||0);
    const donationMonthEntries=Number(donations.month_entries||0);

    $("#adminDonationMonth").textContent=euroFromCents(donations.month_cents);
    $("#adminDonationMonthEntries").textContent=donationMonthEntries+" "+(donationMonthEntries===1?"Zahlung":"Zahlungen");
    $("#adminDonationAccrued").textContent=euroFromCents(donations.accrued_total_cents);
    $("#adminDonationTransferred").textContent=euroFromCents(donations.transferred_total_cents);
    $("#adminDonationOpen").textContent=euroFromCents(donationOpen);
    $("#adminDonationMonthlyCount").textContent=String(donations.monthly_entries_total||0);
    $("#adminDonationYearlyCount").textContent=String(donations.yearly_entries_total||0);

    const transferInput=$("#adminDonationTransferAmount");
    const transferButton=$("#adminDonationTransferButton");
    if(transferInput && document.activeElement!==transferInput){
      transferInput.value=donationOpen>0?(donationOpen/100).toFixed(2):"";
    }
    if(transferButton) transferButton.disabled=donationOpen<=0;

    const transferRows=donations.recent_transfers||[];
    $("#adminDonationTransfers").innerHTML=transferRows.length?transferRows.map(row=>
      '<div class="admin-donation-history-row">'+
        '<div><strong>'+esc(euroFromCents(row.amount_cents))+'</strong><span>'+esc(row.note||"Kindernothilfe e.V.")+'</span></div>'+
        '<time>'+esc(dateText(row.transferred_at||row.created_at))+'</time>'+
      '</div>'
    ).join(""):'<div class="team-empty">Noch keine Überweisung verbucht.</div>';

    if(transferButton){
      transferButton.onclick=async()=>{
        const message=$("#adminDonationTransferMessage");
        const raw=String(transferInput?.value||"").replace(",",".");
        const euros=Number(raw);
        const cents=Math.round(euros*100);

        if(!Number.isFinite(euros)||cents<=0){
          message.textContent="Bitte einen gültigen Betrag eingeben.";
          return;
        }
        if(cents>donationOpen){
          message.textContent="Der Betrag ist höher als die aktuell offene Spendensumme.";
          return;
        }
        if(!confirm("Hast du "+euroFromCents(cents)+" wirklich an die Kindernothilfe überwiesen?")){
          return;
        }

        transferButton.disabled=true;
        message.textContent="Wird verbucht …";
        const result=await sb.functions.invoke("admin-dashboard",{body:{
          action:"mark_donation_transferred",
          amount_cents:cents,
          note:$("#adminDonationTransferNote")?.value.trim()||"Kindernothilfe e.V."
        }});

        if(result.error||!result.data?.ok){
          console.error("Spendenüberweisung",result.error||result.data);
          message.textContent="Die Überweisung konnte nicht verbucht werden.";
          transferButton.disabled=false;
          return;
        }

        if($("#adminDonationTransferNote")) $("#adminDonationTransferNote").value="";
        message.textContent="Überweisung wurde verbucht ✓";
        await loadDashboard();
      };
    }

    const clubs=payload.clubs||[];
    $("#adminClubRows").innerHTML=clubs.length?clubs.map(row=>
      '<div class="admin-club-row">'+
        '<div><strong>'+esc(row.club_name)+'</strong><span>angelegt '+esc(dateText(row.created_at))+'</span></div>'+
        '<span class="admin-owner-email">'+esc(row.owner_email||"–")+'</span>'+
        '<span><b>'+esc(row.members_active)+'</b> aktiv<br><small>'+esc(row.members_total)+' gesamt</small></span>'+
        '<span><b>'+esc(row.team_size)+'</b><small>Team</small></span>'+
        '<span class="admin-billing '+esc(row.subscription_status)+'">'+esc(billingLabel(row))+'</span>'+
      '</div>'
    ).join(""):'<div class="team-empty">Noch keine Vereine vorhanden.</div>';

    const tickets=payload.support||[];
    $("#adminSupportRows").innerHTML=tickets.length?tickets.map(row=>
      '<article class="admin-ticket">'+
        '<div class="admin-ticket-head"><div><span class="support-type '+esc(row.category)+'">'+esc(categoryLabel(row.category))+'</span><strong>'+esc(row.subject)+'</strong></div><span>'+esc(dateText(row.created_at,true))+'</span></div>'+
        '<p>'+esc(row.message).replace(/\n/g,"<br>")+'</p>'+
        '<div class="admin-ticket-meta"><span>'+esc(row.club_name)+'</span><span>'+esc(row.user_email)+'</span><span>'+esc(row.page_path||"–")+'</span>'+
          '<select data-ticket-status="'+esc(row.id)+'"><option value="new" '+(row.status==="new"?"selected":"")+'>Neu</option><option value="in_review" '+(row.status==="in_review"?"selected":"")+'>In Prüfung</option><option value="done" '+(row.status==="done"?"selected":"")+'>Erledigt</option></select>'+
        '</div>'+
      '</article>'
    ).join(""):'<div class="team-empty">Keine Supportanfragen vorhanden.</div>';

    document.querySelectorAll("[data-ticket-status]").forEach(select=>{
      select.addEventListener("change",async()=>{
        select.disabled=true;
        const result=await sb.functions.invoke("admin-dashboard",{body:{action:"set_status",id:select.dataset.ticketStatus,status:select.value}});
        select.disabled=false;
        if(result.error||!result.data?.ok){
          console.error("Supportstatus",result.error||result.data);
          alert("Status konnte nicht gespeichert werden.");
        }else{
          await loadDashboard();
        }
      });
    });

    const days=payload.visitor_days||[];
    const max=Math.max(1,...days.map(x=>Number(x.unique_visitors||0)));
    $("#adminVisitorDays").innerHTML=days.map(row=>{
      const value=Number(row.unique_visitors||0);
      const width=Math.max(value?6:0,Math.round(value/max*100));
      return '<div class="admin-visitor-day"><span>'+esc(new Date(row.day+"T00:00:00").toLocaleDateString("de-DE",{day:"2-digit",month:"2-digit"}))+'</span><div><i style="width:'+width+'%"></i></div><b>'+value+'</b><small>'+esc(row.pageviews||0)+' Aufrufe</small></div>';
    }).join("");
  }

  async function verifyAndLoad(){
    const {data:{session}}=await sb.auth.getSession();
    const loginPanel=$("#adminLoginPanel");
    const denied=$("#adminDenied");
    const loadError=$("#adminLoadError");
    const dashboard=$("#adminDashboard");

    if(loginPanel) loginPanel.hidden=true;
    if(denied) denied.hidden=true;
    if(loadError) loadError.hidden=true;
    if(dashboard) dashboard.hidden=true;

    if(!session){
      if(loginPanel) loginPanel.hidden=false;
      return;
    }

    const email=String(session.user.email||"").trim().toLowerCase();
    $("#adminAccount").textContent=session.user.email||"";

    if(email!=="s.mettmann@softwaremanufaktur-mettmann.de"){
      if(denied) denied.hidden=false;
      return;
    }

    try{
      await loadDashboard();
      if(dashboard) dashboard.hidden=false;
    }catch(error){
      console.error("Admin laden",error);
      if(loadError) loadError.hidden=false;
    }
  }

  $("#adminCreateButton")?.addEventListener("click",async()=>{
    const email=$("#adminEmail").value.trim();
    const password=$("#adminPassword").value;
    const message=$("#adminLoginMessage");
    const button=$("#adminCreateButton");

    if(email.toLowerCase()!=="s.mettmann@softwaremanufaktur-mettmann.de"){
      message.textContent="Diese E-Mail-Adresse ist nicht für die Administration freigeschaltet.";
      return;
    }
    if(password.length<12){
      message.textContent="Das Passwort muss mindestens 12 Zeichen haben.";
      return;
    }

    button.disabled=true;
    button.textContent="Zugang wird angelegt …";
    message.textContent="";

    const redirectTo=new URL("admin.html",location.href).href;
    const {data,error}=await sb.auth.signUp({
      email,
      password,
      options:{emailRedirectTo:redirectTo}
    });

    if(error){
      console.error("Admin anlegen",error);
      message.textContent=error.code==="user_already_exists"
        ?"Der Adminzugang existiert bereits. Bitte normal anmelden."
        :"Adminzugang konnte nicht angelegt werden.";
      button.disabled=false;
      button.textContent="Adminzugang einmalig anlegen";
      return;
    }

    if(data.session){
      await verifyAndLoad();
      return;
    }

    message.textContent="Bestätigungs-Mail ist unterwegs. Link öffnen – danach ist der Adminzugang bereit.";
    button.textContent="Bestätigungs-Mail gesendet ✓";
  });

  $("#adminLoginForm")?.addEventListener("submit",async event=>{
    event.preventDefault();
    const button=$("#adminLoginButton");
    const message=$("#adminLoginMessage");
    button.disabled=true;
    button.textContent="Anmelden …";
    message.textContent="";

    const {error}=await sb.auth.signInWithPassword({
      email:$("#adminEmail").value.trim(),
      password:$("#adminPassword").value
    });

    if(error){
      message.textContent="Anmeldung nicht möglich.";
      button.disabled=false;
      button.textContent="Admin anmelden";
      return;
    }
    await verifyAndLoad();
  });

  document.querySelectorAll("[data-admin-logout]").forEach(button=>button.addEventListener("click",async()=>{
    button.disabled=true;
    await sb.auth.signOut();
    location.reload();
  }));

  $("#adminReload")?.addEventListener("click",async()=>{
    const button=$("#adminReload");
    button.disabled=true;
    await loadDashboard().finally(()=>button.disabled=false);
  });

  $("#adminRetry")?.addEventListener("click",verifyAndLoad);

  verifyAndLoad();
})();