(async function(){
  const sb=window.vaSupabase;
  if(!sb) return;

  const $=(s,root=document)=>root.querySelector(s);
  const $$=(s,root=document)=>[...root.querySelectorAll(s)];
  const esc=value=>String(value||"").replace(/[&<>"']/g,ch=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[ch]));

  async function functionPayload(error){
    try{
      if(error?.context&&typeof error.context.json==="function") return await error.context.json();
    }catch{}
    return null;
  }

  function teamMessage(text,type="info"){
    const box=$("#teamMessage");
    if(!box) return;
    box.textContent=text;
    box.className="team-message "+type;
    box.hidden=!text;
  }

  async function loadTeam(club,currentUserId){
    const rows=$("#teamRows");
    if(!rows) return;

    rows.innerHTML='<div class="team-empty">Team wird geladen …</div>';
    const {data,error}=await sb.functions.invoke("manage-team",{body:{action:"list"}});

    if(error||!data?.ok){
      console.error("Team laden:",error,data);
      rows.innerHTML='<div class="team-empty">Team konnte nicht geladen werden.</div>';
      return;
    }

    const team=Array.isArray(data.team)?data.team:[];
    const count=$("#teamCount");
    if(count) count.textContent=team.length+" / "+Number(data.max||10)+" Zugänge";

    rows.innerHTML=team.map(member=>{
      const self=member.user_id===currentUserId;
      const owner=member.role==="owner";
      const pending=member.state==="pending";
      const badge=owner?"Hauptkonto":(pending?"Einladung offen":"Teammitglied");
      const sub=owner
        ?"Vereinsinhaber · volle Arbeitsrechte"
        :(pending?"Einladung noch nicht angenommen":"Volle Arbeitsrechte in VEREINSFACH");
      let action="";
      if(owner&&self&&team.length>1){
        action='<button class="team-remove" type="button" data-team-remove="'+esc(member.id)+'" data-team-email="'+esc(member.email)+'" data-team-self="1" data-team-owner="1">Mich entfernen</button>';
      }else if(!owner){
        action='<button class="team-remove" type="button" data-team-remove="'+esc(member.id)+'" data-team-email="'+esc(member.email)+'" data-team-self="'+(self?"1":"0")+'" data-team-pending="'+(pending?"1":"0")+'">'+(self?"Mich entfernen":(pending?"Einladung zurückziehen":"Entfernen"))+'</button>';
      }
      return '<div class="team-row'+(pending?' pending':'')+'">'+
        '<div class="team-person"><strong>'+esc(member.email)+'</strong><span>'+esc(sub)+'</span></div>'+
        '<span class="team-role-badge'+(owner?' owner':(pending?' pending':''))+'">'+esc(badge)+'</span>'+
        action+
      '</div>';
    }).join("")||'<div class="team-empty">Noch keine Teamzugänge vorhanden.</div>';

    $$("[data-team-remove]",rows).forEach(button=>button.addEventListener("click",async e=>{
      const el=e.currentTarget;
      const email=el.dataset.teamEmail||"dieses Teammitglied";
      const self=el.dataset.teamSelf==="1";
      const owner=el.dataset.teamOwner==="1";
      const pending=el.dataset.teamPending==="1";
      const wording=owner
        ? "Dich als Hauptkonto wirklich entfernen? Die Eigentümerschaft wird automatisch an das älteste verbleibende Teammitglied übertragen und dein Zugriff endet sofort."
        : self
          ? "Dich selbst wirklich aus diesem Verein entfernen? Dein Zugriff endet sofort."
          : pending
            ? "Offene Einladung für "+email+" wirklich zurückziehen?"
            : email+" wirklich aus dem Verein entfernen? Der Zugriff endet sofort.";
      if(!confirm(wording)) return;

      el.disabled=true;
      teamMessage("Teamzugang wird entfernt …");
      const {data,error}=await sb.functions.invoke("manage-team",{body:{
        action:"remove",
        membership_id:el.dataset.teamRemove
      }});

      if(error){
        const payload=await functionPayload(error);
        const code=payload?.error||"";
        const messages={
          LAST_MEMBER_USE_CLUB_DELETE:"Du bist der letzte Zugang. Wenn der Verein beendet werden soll, nutze unten „Verein & Konto löschen“.",
          TRANSFER_FAILED:"Der Teamzugang konnte gerade nicht sauber übertragen werden.",
          NOT_FOUND:"Dieser Teamzugang existiert nicht mehr.",
          CANNOT_REMOVE_OWNER:"Das Hauptkonto kann nur sich selbst entfernen und die Eigentümerschaft dabei übertragen."
        };
        teamMessage(messages[code]||"Teamzugang konnte nicht entfernt werden.","error");
        el.disabled=false;
        return;
      }

      if(data?.removed_self){
        try{await sb.auth.signOut();}catch{}
        location.replace("login.html");
        return;
      }

      teamMessage("Teamzugang entfernt ✓","success");
      await loadTeam(club,currentUserId);
    }));
  }

  async function initTeam(club,user){
    const card=$("#teamSettingsCard");
    if(!card) return;
    card.hidden=false;

    const form=$("#teamInviteForm");
    form?.addEventListener("submit",async e=>{
      e.preventDefault();
      const email=$("#teamInviteEmail").value.trim().toLowerCase();
      const button=$("button[type='submit']",form);

      if(!email){
        teamMessage("Bitte eine E-Mail-Adresse eintragen.","error");
        return;
      }

      button.disabled=true;
      button.textContent="Einladung wird gesendet …";
      teamMessage("");

      const {data,error}=await sb.functions.invoke("manage-team",{body:{action:"invite",email}});
      if(error){
        const payload=await functionPayload(error);
        const code=payload?.error||"";
        const messages={
          ALREADY_MEMBER:"Diese Person gehört bereits zu eurem Team.",
          ALREADY_IN_OTHER_CLUB:"Dieser VEREINSFACH-Account ist bereits einem anderen Verein zugeordnet.",
          SELF_INVITE:"Du bist bereits in diesem Verein.",
          INVALID_EMAIL:"Bitte eine gültige E-Mail-Adresse eingeben.",
          INVITE_EMAIL_FAILED:"Die Einladungs-E-Mail konnte nicht versendet werden.",
          TEAM_LIMIT_REACHED:"Maximal 10 Teamzugänge pro Verein sind möglich."
        };
        teamMessage(messages[code]||"Einladung konnte nicht erstellt werden.","error");
        button.disabled=false;
        button.textContent="Teammitglied einladen";
        return;
      }

      form.reset();
      teamMessage(
        data?.status==="existing_user_added"
          ?"Bestehender VEREINSFACH-Account freigeschaltet. Die Person kann sich direkt anmelden ✓"
          :"Einladung wurde per E-Mail verschickt ✓",
        "success"
      );
      button.disabled=false;
      button.textContent="Teammitglied einladen";
      await loadTeam(club,user.id);
    });

    await loadTeam(club,user.id);
  }

  try{
    const {data:sessionData}=await sb.auth.getSession();
    if(!sessionData?.session) return;

    const {data:userData,error:userError}=await sb.auth.getUser();
    if(userError||!userData?.user) return;
    const user=userData.user;

    const {data:club,error:clubError}=await sb
      .from("clubs")
      .select("id,owner_id,name")
      .limit(1)
      .maybeSingle();
    if(clubError||!club) return;

    const {data:membership,error:membershipError}=await sb
      .from("club_memberships")
      .select("id,user_id,email,role")
      .eq("club_id",club.id)
      .eq("user_id",user.id)
      .maybeSingle();
    if(membershipError||!membership) return;

    window.vaTeamMembership=membership;

    const dangerZone=$("#ownerDangerZone");
    if(dangerZone) dangerZone.hidden=membership.role!=="owner";

    const sideRole=()=>{
      const bottom=$(".side-bottom");
      if(!bottom||$(".team-role-inline",bottom)) return;
      const role=document.createElement("div");
      role.className="team-role-inline";
      role.innerHTML='<strong>'+(membership.role==="owner"?"Hauptkonto":"Teamzugang")+' · volle Arbeitsrechte</strong><span>'+esc(user.email||membership.email||"")+'</span>';
      const joinsShortcut=$(".joins-side-action",bottom);
      if(joinsShortcut) joinsShortcut.insertAdjacentElement("afterend",role);
      else bottom.prepend(role);
    };

    sideRole();
    const observer=new MutationObserver(sideRole);
    observer.observe(document.body,{childList:true,subtree:true});
    setTimeout(()=>observer.disconnect(),5000);

    await initTeam(club,user);
  }catch(error){
    console.error("VEREINSFACH Team:",error);
  }
})();