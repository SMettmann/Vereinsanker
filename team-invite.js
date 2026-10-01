(async function(){
  const sb=window.vaSupabase;
  const $=s=>document.querySelector(s);
  const form=$("#teamInvitePasswordForm");
  const status=$("#teamInviteStatus");

  function message(text,type="info"){
    let box=form?.querySelector(".auth-message");
    if(!box&&form){
      box=document.createElement("div");
      box.className="auth-message";
      form.insertBefore(box,form.querySelector("button"));
    }
    if(box){
      box.className="auth-message "+type;
      box.textContent=text;
    }
  }

  await new Promise(resolve=>setTimeout(resolve,180));
  const {data:sessionData}=await sb.auth.getSession();
  const session=sessionData?.session;

  if(!session){
    if(status) status.textContent="Der Einladungslink ist abgelaufen oder wurde bereits verwendet. Falls du deinen Zugang schon eingerichtet hast, kannst du dich normal anmelden. Sonst bitte den Verein um eine neue Einladung.";
    if(form) form.hidden=true;
    $("#teamInviteLoginLink")?.removeAttribute("hidden");
    return;
  }

  const {data:userData,error:userError}=await sb.auth.getUser();
  if(userError||!userData?.user){
    if(status) status.textContent="Die Einladung konnte nicht bestätigt werden.";
    if(form) form.hidden=true;
    return;
  }

  const {data:club,error:clubError}=await sb.from("clubs").select("id,name").limit(1).maybeSingle();
  if(clubError||!club){
    if(status) status.textContent="Für diese Einladung wurde kein Vereinszugang gefunden.";
    if(form) form.hidden=true;
    return;
  }

  const {data:membership}=await sb
    .from("club_memberships")
    .select("email,role,accepted_at")
    .eq("club_id",club.id)
    .eq("user_id",userData.user.id)
    .maybeSingle();

  if(!membership){
    if(status) status.textContent="Diese Teameinladung ist nicht mehr aktiv.";
    if(form) form.hidden=true;
    return;
  }

  if(membership.accepted_at){
    if(status) status.textContent="Dieser Teamzugang ist bereits vollständig eingerichtet.";
    if(form) form.hidden=true;
    const link=$("#teamInviteLoginLink");
    if(link){
      link.href="app.html";
      link.textContent="VEREINSFACH öffnen";
      link.removeAttribute("hidden");
    }
    return;
  }

  $("#teamInviteClub").textContent=club.name||"Verein";
  $("#teamInviteEmail").textContent=userData.user.email||membership.email||"";
  $("#teamInviteRole").textContent="Volle Rechte";
  if(status) status.textContent="Einladung angenommen. Lege jetzt dein persönliches Passwort fest.";

  form?.addEventListener("submit",async e=>{
    e.preventDefault();
    const password=$("#teamInvitePassword").value;
    const repeat=$("#teamInvitePasswordRepeat").value;
    const button=form.querySelector("button[type='submit']");

    if(password.length<12){
      message("Das Passwort muss mindestens 12 Zeichen haben.","error");
      return;
    }
    if(password!==repeat){
      message("Die beiden Passwörter stimmen nicht überein.","error");
      return;
    }

    button.disabled=true;
    button.textContent="Passwort wird gespeichert …";
    const {error}=await sb.auth.updateUser({password});
    if(error&&error.code!=="same_password"){
      console.error("Team-Passwort:",error);
      const text=error.code==="weak_password"
        ?"Das Passwort erfüllt die Sicherheitsanforderungen noch nicht. Bitte wähle ein stärkeres Passwort."
        : error.code==="session_not_found"||error.code==="session_expired"
          ?"Die Einladungssitzung ist abgelaufen. Bitte den Verein um eine neue Einladung."
          :"Passwort konnte nicht gespeichert werden. Bitte erneut versuchen.";
      message(text,"error");
      button.disabled=false;
      button.textContent="Zugang fertig einrichten →";
      return;
    }

    const accepted=await sb.functions.invoke("manage-team",{body:{action:"accept"}});
    if(accepted.error||!accepted.data?.ok){
      console.error("Teameinladung bestätigen:",accepted.error,accepted.data);
      message("Der Zugang wurde eingerichtet, konnte aber noch nicht als angenommen markiert werden. Bitte Seite neu laden.","error");
      button.disabled=false;
      button.textContent="Erneut bestätigen →";
      return;
    }

    location.replace("app.html");
  });
})();