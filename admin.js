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

  async function loadDashboard(){
    const [overviewRes,clubsRes,supportRes,visitorRes]=await Promise.all([
      sb.rpc("admin_overview"),
      sb.rpc("admin_clubs"),
      sb.rpc("admin_support_requests"),
      sb.rpc("admin_visitor_days",{p_days:14})
    ]);

    const firstError=overviewRes.error||clubsRes.error||supportRes.error||visitorRes.error;
    if(firstError) throw firstError;

    const o=overviewRes.data||{};
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

    const clubs=clubsRes.data||[];
    $("#adminClubRows").innerHTML=clubs.length?clubs.map(row=>
      '<div class="admin-club-row">'+
        '<div><strong>'+esc(row.club_name)+'</strong><span>angelegt '+esc(dateText(row.created_at))+'</span></div>'+
        '<span><b>'+esc(row.members_active)+'</b> aktiv<br><small>'+esc(row.members_total)+' gesamt</small></span>'+
        '<span><b>'+esc(row.team_size)+'</b><small>Team</small></span>'+
        '<span class="admin-billing '+esc(row.subscription_status)+'">'+esc(billingLabel(row))+'</span>'+
      '</div>'
    ).join(""):'<div class="team-empty">Noch keine Vereine vorhanden.</div>';

    const tickets=supportRes.data||[];
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
        const {error}=await sb.rpc("admin_set_support_status",{p_id:select.dataset.ticketStatus,p_status:select.value});
        select.disabled=false;
        if(error){
          console.error(error);
          alert("Status konnte nicht gespeichert werden.");
        }else{
          await loadDashboard();
        }
      });
    });

    const days=visitorRes.data||[];
    const max=Math.max(1,...days.map(x=>Number(x.unique_visitors||0)));
    $("#adminVisitorDays").innerHTML=days.map(row=>{
      const value=Number(row.unique_visitors||0);
      const width=Math.max(value?6:0,Math.round(value/max*100));
      return '<div class="admin-visitor-day"><span>'+esc(new Date(row.day+"T00:00:00").toLocaleDateString("de-DE",{day:"2-digit",month:"2-digit"}))+'</span><div><i style="width:'+width+'%"></i></div><b>'+value+'</b><small>'+esc(row.pageviews||0)+' Aufrufe</small></div>';
    }).join("");
  }

  async function verifyAndLoad(){
    const {data:{session}}=await sb.auth.getSession();
    if(!session){
      $("#adminLoginPanel").hidden=false;
      $("#adminDashboard").hidden=true;
      return;
    }

    $("#adminLoginPanel").hidden=true;
    $("#adminDashboard").hidden=false;
    $("#adminAccount").textContent=session.user.email||"";

    try{
      await loadDashboard();
    }catch(error){
      console.error("Admin laden",error);
      $("#adminDashboard").hidden=true;
      $("#adminDenied").hidden=false;
    }
  }

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

  verifyAndLoad();
})();