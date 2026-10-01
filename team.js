(async function(){
  const sb = window.vaSupabase;
  if (!sb) return;

  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const esc = value => String(value || "").replace(/[&<>"']/g, ch => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[ch]));

  function roleLabel(role){
    if(role==="owner") return "Inhaber";
    if(role==="admin") return "Vorstand / Admin";
    if(role==="treasurer") return "Kassierer";
    return "Team";
  }

  async function functionPayload(error){
    try{
      if(error?.context && typeof error.context.json==="function") return await error.context.json();
    }catch{}
    return null;
  }

  function teamMessage(text, type="info"){
    const box=$("#teamMessage");
    if(!box) return;
    box.textContent=text;
    box.className="team-message "+type;
    box.hidden=!text;
  }

  async function loadTeam(club){
    const rows=$("#teamRows");
    if(!rows) return;

    rows.innerHTML='<div class="team-empty">Team wird geladen …</div>';
    const {data,error}=await sb
      .from("club_memberships")
      .select("id,user_id,email,role,created_at")
      .eq("club_id",club.id)
      .order("created_at",{ascending:true});

    if(error){
      console.error("Team laden:",error);
      rows.innerHTML='<div class="team-empty">Team konnte nicht geladen werden.</div>';
      return;
    }

    rows.innerHTML=(data||[]).map(member=>{
      const owner=member.role==="owner";
      const roleControl=owner
        ? '<span class="team-role-badge owner">Inhaber</span>'
        : '<select class="team-role-select" data-team-role="'+esc(member.id)+'">'+
            '<option value="admin"'+(member.role==="admin"?" selected":"")+'>Vorstand / Admin</option>'+
            '<option value="treasurer"'+(member.role==="treasurer"?" selected":"")+'>Kassierer</option>'+
          '</select>';
      const remove=owner
        ? '<span class="team-owner-note">Hauptzugang</span>'
        : '<button class="team-remove" type="button" data-team-remove="'+esc(member.id)+'" data-team-email="'+esc(member.email)+'">Entfernen</button>';
      return '<div class="team-row">'+
        '<div class="team-person"><strong>'+esc(member.email)+'</strong><span>'+esc(roleLabel(member.role))+'</span></div>'+
        roleControl+remove+
      '</div>';
    }).join("") || '<div class="team-empty">Noch keine weiteren Teammitglieder.</div>';

    $$("[data-team-role]",rows).forEach(select=>select.addEventListener("change",async e=>{
      const el=e.currentTarget;
      el.disabled=true;
      teamMessage("Rolle wird geändert …");
      const {error}=await sb.functions.invoke("manage-team",{body:{
        action:"update_role",
        membership_id:el.dataset.teamRole,
        role:el.value
      }});
      if(error){
        console.error("Teamrolle:",error);
        teamMessage("Rolle konnte nicht geändert werden.","error");
        await loadTeam(club);
        return;
      }
      teamMessage("Rolle gespeichert ✓","success");
      el.disabled=false;
      await loadTeam(club);
    }));

    $$("[data-team-remove]",rows).forEach(button=>button.addEventListener("click",async e=>{
      const el=e.currentTarget;
      const email=el.dataset.teamEmail||"dieses Teammitglied";
      if(!confirm(email+" wirklich aus dem Verein entfernen? Der VEREINSANKER-Zugang zu diesem Verein endet sofort.")) return;
      el.disabled=true;
      teamMessage("Teamzugang wird entfernt …");
      const {error}=await sb.functions.invoke("manage-team",{body:{
        action:"remove",
        membership_id:el.dataset.teamRemove
      }});
      if(error){
        console.error("Team entfernen:",error);
        teamMessage("Teamzugang konnte nicht entfernt werden.","error");
        el.disabled=false;
        return;
      }
      teamMessage("Teamzugang entfernt ✓","success");
      await loadTeam(club);
    }));
  }

  async function initOwnerTeam(club){
    const card=$("#teamSettingsCard");
    if(!card) return;
    card.hidden=false;

    const form=$("#teamInviteForm");
    form?.addEventListener("submit",async e=>{
      e.preventDefault();
      const email=$("#teamInviteEmail").value.trim().toLowerCase();
      const role=$("#teamInviteRole").value;
      const button=$("button[type='submit']",form);
      if(!email){
        teamMessage("Bitte eine E-Mail-Adresse eintragen.","error");
        return;
      }

      button.disabled=true;
      button.textContent="Einladung wird gesendet …";
      teamMessage("");

      const {data,error}=await sb.functions.invoke("manage-team",{body:{action:"invite",email,role}});
      if(error){
        const payload=await functionPayload(error);
        const code=payload?.error||"";
        const messages={
          ALREADY_MEMBER:"Diese Person gehört bereits zu eurem Team.",
          ALREADY_IN_OTHER_CLUB:"Dieser VEREINSANKER-Account ist bereits einem anderen Verein zugeordnet.",
          SELF_INVITE:"Du bist bereits der Inhaber dieses Vereins.",
          INVALID_EMAIL:"Bitte eine gültige E-Mail-Adresse eingeben.",
          INVITE_EMAIL_FAILED:"Die Einladungs-E-Mail konnte nicht versendet werden."
        };
        teamMessage(messages[code]||"Einladung konnte nicht erstellt werden.","error");
        button.disabled=false;
        button.textContent="Teammitglied einladen";
        return;
      }

      form.reset();
      teamMessage(
        data?.status==="existing_user_added"
          ? "Bestehender VEREINSANKER-Account freigeschaltet. Die Person kann sich direkt anmelden ✓"
          : "Einladung wurde per E-Mail verschickt ✓",
        "success"
      );
      button.disabled=false;
      button.textContent="Teammitglied einladen";
      await loadTeam(club);
    });

    await loadTeam(club);
  }

  function hideOwnerOnly(){
    $("#teamSettingsCard")?.setAttribute("hidden","");
    $("#ownerDangerZone")?.setAttribute("hidden","");
    $(".billing-settings-card")?.setAttribute("hidden","");
    const hideBilling=()=>{
      $("#billingSideAction")?.setAttribute("hidden","");
      $("#billingActionLink")?.setAttribute("hidden","");
    };
    hideBilling();
    const observer=new MutationObserver(hideBilling);
    observer.observe(document.body,{childList:true,subtree:true});
    setTimeout(()=>observer.disconnect(),5000);
  }

  try{
    const {data:sessionData}=await sb.auth.getSession();
    if(!sessionData?.session) return;
    const {data:userData,error:userError}=await sb.auth.getUser();
    if(userError||!userData?.user) return;
    const user=userData.user;

    const {data:club,error:clubError}=await sb.from("clubs").select("id,owner_id,name").limit(1).maybeSingle();
    if(clubError||!club) return;

    const {data:membership,error:membershipError}=await sb
      .from("club_memberships")
      .select("id,user_id,email,role")
      .eq("club_id",club.id)
      .eq("user_id",user.id)
      .maybeSingle();
    if(membershipError||!membership) return;

    window.vaTeamMembership=membership;
    document.body.dataset.clubRole=membership.role;

    const owner=membership.role==="owner"||club.owner_id===user.id;
    const page=location.pathname.split("/").pop()||"app.html";

    if(!owner){
      hideOwnerOnly();
      if(page==="billing.html"||page==="billing-success.html"){
        location.replace("app.html");
        return;
      }
    }

    const sideRole=()=>{
      const bottom=$(".side-bottom");
      if(!bottom||$(".team-role-inline",bottom)) return;
      const role=document.createElement("div");
      role.className="team-role-inline";
      role.innerHTML='<strong>'+esc(roleLabel(membership.role))+'</strong><span>'+esc(user.email||membership.email||"")+'</span>';
      bottom.prepend(role);
    };
    sideRole();
    const roleObserver=new MutationObserver(sideRole);
    roleObserver.observe(document.body,{childList:true,subtree:true});
    setTimeout(()=>roleObserver.disconnect(),5000);

    if(owner) await initOwnerTeam(club);
  }catch(error){
    console.error("VEREINSANKER Team:",error);
  }
})();