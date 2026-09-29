const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const sb = window.vaSupabase;
const currentYear = new Date().getFullYear();
let vaSession = null;
let vaClub = null;

function esc(value = "") {
  return String(value).replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[ch]));
}

function money(value) {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(Number(value || 0));
}

function normalizeIbanValue(value) {
  return String(value || "").replace(/\s+/g, "").toUpperCase();
}

function isValidIbanValue(value) {
  const iban = normalizeIbanValue(value);
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  if (iban.startsWith("DE") && iban.length !== 22) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const part = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const digit of part) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

function bindIbanValidation(input) {
  if (!input || input.dataset.ibanBound) return;
  input.dataset.ibanBound = "1";

  const validate = () => {
    const value = normalizeIbanValue(input.value);
    input.value = value.replace(/(.{4})/g, "$1 ").trim();
    const invalid = Boolean(value) && !isValidIbanValue(value);
    input.classList.toggle("input-invalid", invalid);
    input.setCustomValidity(invalid ? "Bitte eine gültige IBAN eingeben." : "");

    let note = input.parentElement?.querySelector(".iban-inline-error");
    if (invalid && !note) {
      note = document.createElement("span");
      note.className = "iban-inline-error";
      note.textContent = "Diese IBAN ist ungültig und kann nicht gespeichert werden.";
      input.insertAdjacentElement("afterend", note);
    } else if (!invalid && note) {
      note.remove();
    }
  };

  input.addEventListener("blur", validate);
  input.addEventListener("input", () => {
    const value = normalizeIbanValue(input.value);
    if (!value || isValidIbanValue(value)) {
      input.classList.remove("input-invalid");
      input.setCustomValidity("");
      input.parentElement?.querySelector(".iban-inline-error")?.remove();
    }
  });
}

function memberSepaProblem(member) {
  if (!member?.iban) return "IBAN fehlt";
  if (!isValidIbanValue(member.iban)) return "IBAN ungültig";
  if (!member.mandate_reference) return "Mandatsreferenz fehlt";
  if (!member.mandate_signed_at) return "Mandatsdatum fehlt";
  return "";
}

function initials(first = "", last = "") {
  return ((first.trim()[0] || "") + (last.trim()[0] || "")).toUpperCase() || "VA";
}

function memberFullName(member) {
  return [member?.first_name, member?.last_name].filter(Boolean).join(" ") || "Mitglied";
}

function setMessage(form, message, type = "info") {
  if (!form) return;
  let box = $(".auth-message", form);
  if (!box) {
    box = document.createElement("div");
    box.className = "auth-message";
    form.insertBefore(box, $(".secondary-link", form) || null);
  }
  box.className = "auth-message " + type;
  box.textContent = message;
}

function showToast(message) {
  const toast = $("#toast");
  if (!toast) return;
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(window.__vaToast);
  window.__vaToast = setTimeout(() => { toast.hidden = true; }, 2600);
}

function openBackdrop(el) {
  if (!el) return;
  el.hidden = false;
  document.body.style.overflow = "hidden";
}

function closeBackdrop(el) {
  if (!el) return;
  el.hidden = true;
  document.body.style.overflow = "";
}

function finishAppLoad() {
  requestAnimationFrame(() => {
    document.body.classList.remove("app-data-loading");
    document.body.classList.add("app-data-ready");
  });
}

async function getSession() {
  const { data, error } = await sb.auth.getSession();
  if (error) throw error;
  return data.session;
}

async function requireSession() {
  vaSession = await getSession();
  if (!vaSession) {
    location.replace("login.html");
    return null;
  }
  return vaSession;
}

async function getClub() {
  const { data, error } = await sb
    .from("clubs")
    .select("*")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  vaClub = data;
  return data;
}

function clubLogoPublicUrl(path) {
  if (!path) return "";
  const { data } = sb.storage.from("club-logos").getPublicUrl(path);
  return data?.publicUrl || "";
}

function applyClubBrand(club) {
  if (!club) return;
  if (club.color) document.documentElement.style.setProperty("--green", club.color);

  const shortName = (club.short_name || "VA").slice(0, 4).toUpperCase();
  $$("#clubTitle").forEach(el => { el.textContent = club.name || "Mein Verein"; });

  $$(".club-logo-fallback").forEach(el => {
    el.textContent = shortName;
    el.hidden = Boolean(club.logo_path);
    if (club.color) el.style.background = club.color;
  });

  $$("#clubBadge").forEach(el => {
    el.textContent = shortName;
    el.hidden = Boolean(club.logo_path);
    if (club.color) el.style.background = club.color;
  });

  const logoUrl = clubLogoPublicUrl(club.logo_path);
  $$(".club-logo-img").forEach(img => {
    if (logoUrl) {
      img.src = logoUrl;
      img.alt = (club.name || "Verein") + " Logo";
      img.hidden = false;
    } else {
      img.removeAttribute("src");
      img.alt = "";
      img.hidden = true;
    }
  });
}


function hasPaidAccess(club) {
  return ["active_monthly", "active_yearly"].includes(club?.subscription_status);
}

function trialDaysRemaining(club) {
  if (!club?.trial_ends_at) return 0;
  const ms = new Date(club.trial_ends_at).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86400000));
}

function applyTrialUI(club) {
  if (!club) return;
  const paid = hasPaidAccess(club);
  const days = trialDaysRemaining(club);
  const expired = !paid && new Date(club.trial_ends_at).getTime() <= Date.now();

  document.body.classList.toggle("trial-expired", expired);

  const endDate = club.trial_ends_at
    ? new Date(club.trial_ends_at).toLocaleDateString("de-DE")
    : "";

  const side = $("#trialStatusSide");
  if (side) {
    if (paid) {
      side.innerHTML = '<strong>Abo aktiv</strong><span>VEREINSANKER ist freigeschaltet.</span>';
      side.className = "trial-side-status paid";
    } else if (expired) {
      side.innerHTML = '<strong>Test beendet</strong><span>Deine Daten bleiben erhalten.</span>';
      side.className = "trial-side-status expired";
    } else {
      side.innerHTML = '<strong>Noch ' + days + (days === 1 ? ' Tag' : ' Tage') + '</strong><span>Test endet am ' + esc(endDate) + ' automatisch.</span>';
      side.className = "trial-side-status";
    }
  }

  let mobile = $("#trialMobileStatus");
  if (!mobile && $(".app-shell")) {
    mobile = document.createElement("div");
    mobile.id = "trialMobileStatus";
    mobile.className = "trial-mobile-status";
    $(".app-shell").before(mobile);
  }
  if (mobile) {
    if (paid) {
      mobile.hidden = true;
    } else if (expired) {
      mobile.hidden = false;
      mobile.textContent = "Test beendet · Daten bleiben erhalten";
      mobile.className = "trial-mobile-status expired";
    } else {
      mobile.hidden = false;
      mobile.textContent = "Kostenloser Test · noch " + days + (days === 1 ? " Tag" : " Tage");
      mobile.className = "trial-mobile-status";
    }
  }

  const main = $(".app-main");
  let banner = $("#trialExpiredBanner");
  if (expired && main) {
    if (!banner) {
      banner = document.createElement("section");
      banner.id = "trialExpiredBanner";
      banner.className = "trial-expired-banner";
      main.insertBefore(banner, main.firstChild);
    }
    banner.innerHTML = '<div><strong>Dein 14-Tage-Test ist beendet.</strong><span>Deine Daten bleiben erhalten. Zum Weiterbearbeiten kannst du VEREINSANKER freischalten.</span></div><a href="index.html#preis">Tarife ansehen</a>';
  } else if (banner) {
    banner.remove();
  }
}

async function initSignup() {
  const existingSession = await getSession();
  if (existingSession) {
    vaSession = existingSession;
    const club = await getClub();
    location.replace(club ? "app.html" : "onboarding.html");
    return;
  }
  const form = $("#startForm");
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const button = $("button[type='submit']", form);
    const email = $("#email").value.trim();
    const password = $("#password").value;
    button.disabled = true;
    button.textContent = "Konto wird angelegt …";
    setMessage(form, "", "info");

    const redirectTo = new URL("login.html", location.href).href;
    const { data, error } = await sb.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: redirectTo }
    });

    if (error) {
      setMessage(form, error.message || "Registrierung nicht möglich.", "error");
      button.disabled = false;
      button.textContent = "Weiter zur Einrichtung →";
      return;
    }

    if (data.session) {
      location.href = "onboarding.html";
      return;
    }

    setMessage(
      form,
      "Bestätigungs-E-Mail ist unterwegs. Link anklicken und danach hier anmelden.",
      "success"
    );
    button.textContent = "E-Mail gesendet ✓";
  });
}

async function initLogin() {
  const existingSession = await getSession();
  if (existingSession) {
    vaSession = existingSession;
    const club = await getClub();
    location.replace(club ? "app.html" : "onboarding.html");
    return;
  }
  const form = $("#loginForm");
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const button = $("button[type='submit']", form);
    button.disabled = true;
    button.textContent = "Anmelden …";

    const { error } = await sb.auth.signInWithPassword({
      email: $("#loginEmail").value.trim(),
      password: $("#loginPassword").value
    });

    if (error) {
      setMessage(form, "E-Mail oder Passwort stimmen nicht.", "error");
      button.disabled = false;
      button.textContent = "Anmelden →";
      return;
    }

    const club = await getClub();
    location.href = club ? "app.html" : "onboarding.html";
  });
}


async function initForgotPassword() {
  const form = $("#forgotPasswordForm");
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const button = $("button[type='submit']", form);
    const email = $("#forgotEmail").value.trim();

    button.disabled = true;
    button.textContent = "E-Mail wird gesendet …";

    const redirectTo = new URL("reset-password.html", location.href).href;
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });

    if (error) {
      setMessage(form, "Reset-Link konnte nicht gesendet werden. Bitte versuche es erneut.", "error");
      button.disabled = false;
      button.textContent = "Reset-Link senden →";
      return;
    }

    setMessage(form, "Wenn die E-Mail-Adresse registriert ist, erhältst du jetzt einen Reset-Link.", "success");
    button.textContent = "Reset-Link gesendet ✓";
  });
}

async function initResetPassword() {
  const form = $("#resetPasswordForm");
  const button = $("button[type='submit']", form);

  const params = new URLSearchParams(location.hash.startsWith("#") ? location.hash.slice(1) : location.search);
  if (params.get("error")) {
    setMessage(form, "Der Reset-Link ist ungültig oder abgelaufen. Bitte fordere einen neuen an.", "error");
    button.disabled = true;
    return;
  }

  await new Promise(resolve => setTimeout(resolve, 250));
  const session = await getSession();
  if (!session) {
    setMessage(form, "Dieser Reset-Link ist ungültig oder abgelaufen. Bitte fordere einen neuen an.", "error");
    button.disabled = true;
    return;
  }

  form.addEventListener("submit", async e => {
    e.preventDefault();
    const password = $("#newPassword").value;
    const confirmPassword = $("#newPasswordConfirm").value;

    if (password.length < 8) {
      setMessage(form, "Das Passwort muss mindestens 8 Zeichen haben.", "error");
      return;
    }
    if (password !== confirmPassword) {
      setMessage(form, "Die beiden Passwörter stimmen nicht überein.", "error");
      return;
    }

    button.disabled = true;
    button.textContent = "Passwort wird gespeichert …";

    const { error } = await sb.auth.updateUser({ password });
    if (error) {
      if (error.code === "same_password") {
        setMessage(form, "Das neue Passwort darf nicht dem bisherigen Passwort entsprechen.", "error");
      } else if (error.code === "weak_password") {
        setMessage(form, "Das neue Passwort erfüllt die Sicherheitsanforderungen noch nicht. Bitte wähle ein stärkeres Passwort.", "error");
      } else if (error.code === "session_not_found" || error.code === "session_expired") {
        setMessage(form, "Der Reset-Link ist abgelaufen. Bitte fordere einen neuen an.", "error");
      } else {
        setMessage(form, "Das Passwort konnte nicht geändert werden. Bitte versuche es erneut.", "error");
      }
      button.disabled = false;
      button.textContent = "Passwort speichern →";
      return;
    }

    await sb.auth.signOut();
    setMessage(form, "Passwort geändert. Du kannst dich jetzt anmelden.", "success");
    button.textContent = "Passwort geändert ✓";
    setTimeout(() => location.replace("login.html"), 1200);
  });
}

function showStep(n) {
  $$(".step").forEach(s => s.classList.toggle("active", Number(s.dataset.step) === n));
  if ($("#stepNo")) $("#stepNo").textContent = n;
  if ($("#progressBar")) $("#progressBar").style.width = (n / 3 * 100) + "%";
}

async function initOnboarding() {
  const existing = await getClub();
  if (existing) {
    $("#clubName").value = existing.name || "";
    $("#clubShort").value = existing.short_name || "";
    $("#fee").value = Number(existing.standard_fee || 0);
    $("#due").value = existing.due_date || "";
    $("#creditor").value = existing.creditor_id || "";
    $$(".color-choice").forEach(btn => btn.classList.toggle("active", btn.dataset.color === existing.color));
  }

  $$(".color-choice").forEach(btn => btn.addEventListener("click", () => {
    $$(".color-choice").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
  }));

  $$("[data-next]").forEach(btn => btn.addEventListener("click", () => showStep(Number(btn.dataset.next))));
  $$("[data-back]").forEach(btn => btn.addEventListener("click", () => showStep(Number(btn.dataset.back))));

  $("#finishSetup").addEventListener("click", async () => {
    const name = $("#clubName").value.trim();
    if (!name) {
      showStep(1);
      $("#clubName").focus();
      return;
    }

    const button = $("#finishSetup");
    button.disabled = true;
    button.textContent = "Wird eingerichtet …";

    const activeColor = $(".color-choice.active")?.dataset.color || "#237a55";
    const payload = {
      owner_id: vaSession.user.id,
      name,
      short_name: ($("#clubShort").value.trim() || "VA").toUpperCase(),
      color: activeColor,
      standard_fee: Number($("#fee").value || 0),
      due_date: $("#due").value || null,
      creditor_id: $("#creditor").value.trim() || null,
      updated_at: new Date().toISOString()
    };

    const saveQuery = existing
      ? sb.from("clubs").update({
          name: payload.name,
          short_name: payload.short_name,
          color: payload.color,
          standard_fee: payload.standard_fee,
          due_date: payload.due_date,
          creditor_id: payload.creditor_id,
          updated_at: payload.updated_at
        }).eq("id", existing.id)
      : sb.from("clubs").insert(payload);

    const { data, error } = await saveQuery.select().single();

    if (error) {
      button.disabled = false;
      button.textContent = "Verein öffnen →";
      alert("Einrichtung konnte nicht gespeichert werden: " + error.message);
      return;
    }

    vaClub = data;
    if (window.vaOnboardingImportState && window.importPreparedMembers) {
      const state = window.vaOnboardingImportState;
      const mappingOkay = state.mapping.full_name || (state.mapping.first_name && state.mapping.last_name);
      if (mappingOkay) {
        try { await window.importPreparedMembers(state.rows, state.mapping, data); } catch (importError) { console.error(importError); }
      }
    }
    location.href = "app.html";
  });
}

async function loadMembers() {
  const { data, error } = await sb
    .from("members")
    .select("*")
    .eq("active", true)
    .order("last_name", { ascending: true })
    .order("first_name", { ascending: true });
  if (error) throw error;
  return data || [];
}

async function loadContributions(year = currentYear) {
  const { data, error } = await sb
    .from("contributions")
    .select("id,club_id,member_id,contribution_year,amount,due_date,status,paid_at,note,members(id,first_name,last_name,group_name,email,iban,member_number,annual_fee,mandate_reference,mandate_signed_at)")
    .eq("contribution_year", year)
    .order("due_date", { ascending: true });
  if (error) throw error;
  return data || [];
}

async function initDashboard() {
  const club = await getClub();
  if (!club) {
    location.replace("onboarding.html");
    return;
  }
  applyClubBrand(club);
  applyTrialUI(club);

  const [members, contributions] = await Promise.all([loadMembers(), loadContributions()]);
  const total = contributions.reduce((sum, c) => sum + Number(c.amount || 0), 0);
  const paid = contributions.filter(c => c.status === "paid").reduce((sum, c) => sum + Number(c.amount || 0), 0);
  const open = contributions.filter(c => c.status !== "paid");
  const percent = total > 0 ? Math.round((paid / total) * 100) : 0;

  $("#dashboardYear").textContent = currentYear;
  $("#dashPercent").textContent = percent + " %";
  $("#dashMembers").textContent = members.length;
  $("#dashPaid").textContent = contributions.filter(c => c.status === "paid").length;
  $("#dashOpen").textContent = open.length;
  $("#dashProgress").style.width = percent + "%";

  const openList = $("#dashboardOpenRows");
  if (!open.length) {
    openList.innerHTML = '<div class="empty-row"><strong>Alles erledigt ✓</strong><span>Aktuell sind keine Beiträge offen.</span></div>';
  } else {
    openList.innerHTML = open.slice(0, 3).map(c => {
      const m = c.members || {};
      return '<div class="member-row"><i class="avatar">' + esc(initials(m.first_name, m.last_name)) + '</i><div class="member-name"><strong>' + esc(memberFullName(m)) + '</strong><span>' + esc(m.group_name || "Ohne Gruppe") + '</span></div><span>Jahresbeitrag</span><span class="status">' + esc(money(c.amount)) + ' offen</span></div>';
    }).join("");
  }
}

function renderMemberRows(members, contributionMap) {
  const rows = $("#memberRows");
  if (!rows) return;

  if (!members.length) {
    rows.innerHTML = '<div class="empty-row"><strong>Noch keine Mitglieder</strong><span>Mit „Mitglied hinzufügen“ oder dem Import starten.</span></div>';
    $("#visibleCount").textContent = "0";
    return;
  }

  rows.innerHTML = members.map(m => {
    const c = contributionMap.get(m.id);
    const status = c?.status === "paid" ? "Bezahlt" : "Offen";
    return '<button class="members-row" type="button" data-member-id="' + esc(m.id) + '">' +
      '<span class="member-main"><i>' + esc(initials(m.first_name, m.last_name)) + '</i><b>' + esc(memberFullName(m)) + '<small>' + esc(m.member_number || "ohne Mitgliedsnummer") + '</small></b></span>' +
      '<span>' + esc(m.group_name || "Ohne Gruppe") + '</span>' +
      '<span>' + esc(money(m.annual_fee)) + '</span>' +
      '<em class="' + (status === "Bezahlt" ? "status-paid" : "status-open") + '">' + status + '</em>' +
    '</button>';
  }).join("");

  $("#visibleCount").textContent = members.length;
}

async function initMembers() {
  const club = await getClub();
  if (!club) return location.replace("onboarding.html");
  applyClubBrand(club);
  applyTrialUI(club);

  bindIbanValidation($("#memberIban"));
  let members = await loadMembers();
  let contributions = await loadContributions();
  let contributionMap = new Map(contributions.map(c => [c.member_id, c]));
  renderMemberRows(members, contributionMap);

  const memberSheet = $("#memberSheet");
  const addMemberSheet = $("#addMemberSheet");

  $("#addMemberBtn")?.addEventListener("click", () => openBackdrop(addMemberSheet));
  $("#closeSheet")?.addEventListener("click", () => closeBackdrop(memberSheet));
  $("#closeAddMember")?.addEventListener("click", () => closeBackdrop(addMemberSheet));
  memberSheet?.addEventListener("click", e => { if (e.target === memberSheet) closeBackdrop(memberSheet); });
  addMemberSheet?.addEventListener("click", e => { if (e.target === addMemberSheet) closeBackdrop(addMemberSheet); });

  $("#memberRows").addEventListener("click", e => {
    const row = e.target.closest(".members-row");
    if (!row) return;
    const member = members.find(m => m.id === row.dataset.memberId);
    if (!member) return;
    const c = contributionMap.get(member.id);

    $("#detailInitials").textContent = initials(member.first_name, member.last_name);
    $("#sheetTitle").textContent = memberFullName(member);
    $("#detailGroup").textContent = member.group_name || "Ohne Gruppe";
    $("#detailEmail").textContent = member.email || "–";
    $("#detailIban").textContent = member.iban || "–";
    $("#detailFee").textContent = money(member.annual_fee);
    $("#detailStatus").textContent = c?.status === "paid" ? "Bezahlt" : "Offen";
    openBackdrop(memberSheet);
  });

  $("#memberSearch").addEventListener("input", e => {
    const q = e.target.value.trim().toLowerCase();
    let count = 0;
    $$(".members-row").forEach(row => {
      const member = members.find(m => m.id === row.dataset.memberId);
      const text = member ? (memberFullName(member) + " " + (member.group_name || "") + " " + (member.email || "")).toLowerCase() : "";
      const hit = text.includes(q);
      row.hidden = !hit;
      if (hit) count++;
    });
    $("#visibleCount").textContent = count;
  });

  $("#addMemberForm").addEventListener("submit", async e => {
    e.preventDefault();
    const form = e.currentTarget;
    const button = $("button[type='submit']", form);
    const fee = Number($("#memberFee").value || club.standard_fee || 0);
    const memberNumber = String(1001 + members.length);
    const memberIban = normalizeIbanValue($("#memberIban").value);

    if (memberIban && !isValidIbanValue(memberIban)) {
      bindIbanValidation($("#memberIban"));
      $("#memberIban").classList.add("input-invalid");
      $("#memberIban").focus();
      showToast("IBAN ungültig – Mitglied wurde nicht gespeichert.");
      return;
    }

    button.disabled = true;
    button.textContent = "Wird gespeichert …";

    let createdMemberId = null;
    try {
      const memberPayload = {
        club_id: club.id,
        member_number: memberNumber,
        first_name: $("#firstName").value.trim(),
        last_name: $("#lastName").value.trim(),
        group_name: $("#memberGroup").value.trim() || null,
        email: $("#memberEmail").value.trim() || null,
        iban: memberIban || null,
        annual_fee: fee,
        mandate_reference: $("#memberMandate")?.value.trim() || null,
        mandate_signed_at: $("#memberMandateDate")?.value || null,
        updated_at: new Date().toISOString()
      };

      const { data: member, error } = await sb.from("members").insert(memberPayload).select().single();
      if (error) throw error;
      createdMemberId = member.id;

      const dueDate = club.due_date
        ? currentYear + club.due_date.slice(4)
        : currentYear + "-03-01";

      const { error: contributionError } = await sb.from("contributions").insert({
        club_id: club.id,
        member_id: member.id,
        contribution_year: currentYear,
        amount: fee,
        due_date: dueDate,
        status: "open"
      });
      if (contributionError) throw contributionError;

      closeBackdrop(addMemberSheet);
      showToast("Mitglied gespeichert ✓");
      setTimeout(() => location.reload(), 250);
    } catch (error) {
      console.error("Mitglied speichern:", error);
      if (createdMemberId) {
        await sb.from("members").delete().eq("id", createdMemberId);
      }
      const invalidIban = String(error?.message || "").includes("INVALID_IBAN");
      showToast(invalidIban
        ? "IBAN ungültig – Mitglied wurde nicht gespeichert."
        : "Mitglied konnte nicht gespeichert werden. Bitte erneut versuchen.");
      button.disabled = false;
      button.textContent = "Mitglied speichern";
    }
  });

}

function contributionMember(c) {
  return c.members || {};
}

async function initContributions() {
  const club = await getClub();
  if (!club) return location.replace("onboarding.html");
  applyClubBrand(club);
  applyTrialUI(club);

  let contributions = await loadContributions();
  const total = contributions.reduce((s, c) => s + Number(c.amount || 0), 0);
  const paid = contributions.filter(c => c.status === "paid").reduce((s, c) => s + Number(c.amount || 0), 0);
  const open = contributions.filter(c => c.status !== "paid");

  $("#contribYear").textContent = currentYear;
  $("#contribTotal").textContent = money(total);
  $("#contribPaid").textContent = money(paid);
  $("#contribOpen").textContent = money(total - paid);

  const paymentList = $("#paymentList");
  const openList = $("#openContributions");

  const render = () => {
    if (!contributions.length) {
      paymentList.innerHTML = '<div class="empty-row"><strong>Noch keine Beiträge</strong><span>Lege zuerst Mitglieder an.</span></div>';
      openList.innerHTML = '<div class="empty-row"><strong>Nichts offen</strong><span>Noch keine Beiträge vorhanden.</span></div>';
      $("#openCount").textContent = "0";
      return;
    }

    paymentList.innerHTML = contributions.map(c => {
      const m = contributionMember(c);
      return '<div class="payment-row" data-search="' + esc((memberFullName(m) + " " + (m.group_name || "")).toLowerCase()) + '">' +
        '<span class="member-main"><i>' + esc(initials(m.first_name, m.last_name)) + '</i><b>' + esc(memberFullName(m)) + '<small>' + esc(m.group_name || "Ohne Gruppe") + '</small>' + (c.status !== "paid" && memberSepaProblem(m) ? '<small class="sepa-row-warning">SEPA nicht möglich: ' + esc(memberSepaProblem(m)) + '</small>' : '') + '</b></span>' +
        '<strong>' + esc(money(c.amount)) + '</strong>' +
        (c.status === "paid"
          ? '<span class="paid-check">✓ Bezahlt</span>'
          : '<button class="mark-paid" data-id="' + esc(c.id) + '">Als bezahlt markieren</button>') +
      '</div>';
    }).join("");

    const openRows = contributions.filter(c => c.status !== "paid");
    $("#openCount").textContent = openRows.length;
    openList.innerHTML = openRows.length ? openRows.map(c => {
      const m = contributionMember(c);
      return '<div class="open-row"><span class="member-main"><i>' + esc(initials(m.first_name, m.last_name)) + '</i><b>' + esc(memberFullName(m)) + '<small>' + esc((m.group_name || "Ohne Gruppe") + " · Jahresbeitrag") + '</small></b></span><strong>' + esc(money(c.amount)) + '</strong><span>' + (c.due_date ? "Fällig " + new Date(c.due_date + "T00:00:00").toLocaleDateString("de-DE") : "Keine Fälligkeit") + '</span><button class="tiny-action">Erinnern</button></div>';
    }).join("") : '<div class="empty-row"><strong>Alles erledigt ✓</strong><span>Keine offenen Beiträge.</span></div>';
  };

  render();

  $("#paymentSearch")?.addEventListener("input", e => {
    const q = e.target.value.trim().toLowerCase();
    $$(".payment-row").forEach(row => { row.hidden = !row.dataset.search.includes(q); });
  });

  paymentList.addEventListener("click", async e => {
    const button = e.target.closest(".mark-paid");
    if (!button) return;
    button.disabled = true;
    const { error } = await sb.from("contributions").update({
      status: "paid",
      paid_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }).eq("id", button.dataset.id);
    if (error) {
      button.disabled = false;
      showToast("Zahlung konnte nicht gespeichert werden");
      return;
    }
    contributions = await loadContributions();
    showToast("Zahlung als bezahlt markiert ✓");
    location.reload();
  });



  const sepaSheet = $("#sepaSheet");
  const sepaAction = $("#openSepa");
  const openContributions = contributions.filter(c => c.status !== "paid");

  if (sepaAction && !openContributions.length) {
    sepaAction.classList.add("no-sepa-needed");
    const sub = $("span", sepaAction);
    if (sub) sub.textContent = "Alle Beiträge sind bereits bezahlt.";
  }

  sepaAction?.addEventListener("click", () => {
    if (!openContributions.length) {
      showToast("Aktuell nichts einzuziehen: Alle Beiträge sind bereits bezahlt.");
      return;
    }

    const invalidIban = openContributions.filter(c => {
      const m = contributionMember(c);
      return m.iban && !isValidIbanValue(m.iban);
    });
    const missingIban = openContributions.filter(c => !contributionMember(c).iban);
    const missingMandate = openContributions.filter(c => {
      const m = contributionMember(c);
      return !m.mandate_reference || !m.mandate_signed_at;
    });
    const ready = openContributions.filter(c => {
      const m = contributionMember(c);
      return isValidIbanValue(m.iban) && m.mandate_reference && m.mandate_signed_at;
    });

    $("#sepaReadyCount").textContent = ready.length + (ready.length === 1 ? " Mitglied" : " Mitglieder");
    $("#sepaReadySum").textContent = money(ready.reduce((s, c) => s + Number(c.amount || 0), 0));

    const issues = [];
    if (!club.iban) issues.push("Vereins-IBAN fehlt.");
    else if (!isValidIbanValue(club.iban)) issues.push("Vereins-IBAN ist ungültig.");
    if (!club.creditor_id) issues.push("Gläubiger-ID fehlt.");
    if (missingIban.length) issues.push(missingIban.length + " Mitglied(er) ohne IBAN.");
    if (invalidIban.length) issues.push(invalidIban.length + " Mitglied(er) mit ungültiger IBAN.");
    if (missingMandate.length) issues.push(missingMandate.length + " Mitglied(er) ohne vollständiges SEPA-Mandat.");

    $("#sepaMissing").textContent = issues.length
      ? issues.join(" ")
      : "Alles vollständig. Die Datei kann erstellt werden.";

    openBackdrop(sepaSheet);
  });
  $("#closeSepa")?.addEventListener("click", () => closeBackdrop(sepaSheet));
  sepaSheet?.addEventListener("click", e => { if (e.target === sepaSheet) closeBackdrop(sepaSheet); });

}

async function initSettings() {
  let club = await getClub();
  if (!club) return location.replace("onboarding.html");
  applyClubBrand(club);
  applyTrialUI(club);

  const logoInput = $("#clubLogoInput");
  const removeLogoButton = $("#removeClubLogo");

  function updateLogoControls() {
    if (removeLogoButton) removeLogoButton.disabled = !club.logo_path;
  }

  logoInput?.addEventListener("change", async e => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const allowedTypes = ["image/png", "image/jpeg", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      showToast("Bitte PNG, JPG oder WebP auswählen.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      showToast("Das Logo darf maximal 2 MB groß sein.");
      return;
    }

    const oldPath = club.logo_path;
    const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const newPath = club.id + "/logo-" + Date.now() + "." + ext;

    showToast("Logo wird hochgeladen …");

    const { error: uploadError } = await sb.storage
      .from("club-logos")
      .upload(newPath, file, {
        cacheControl: "3600",
        contentType: file.type,
        upsert: false
      });

    if (uploadError) {
      showToast("Logo konnte nicht hochgeladen werden.");
      return;
    }

    const { data, error: saveError } = await sb
      .from("clubs")
      .update({ logo_path: newPath, updated_at: new Date().toISOString() })
      .eq("id", club.id)
      .select()
      .single();

    if (saveError) {
      await sb.storage.from("club-logos").remove([newPath]);
      showToast("Logo konnte nicht gespeichert werden.");
      return;
    }

    if (oldPath) await sb.storage.from("club-logos").remove([oldPath]);

    club = data;
    vaClub = data;
    applyClubBrand(data);
    updateLogoControls();
    showToast("Vereinslogo gespeichert ✓");
  });

  removeLogoButton?.addEventListener("click", async () => {
    if (!club.logo_path) return;
    const oldPath = club.logo_path;

    const { data, error } = await sb
      .from("clubs")
      .update({ logo_path: null, updated_at: new Date().toISOString() })
      .eq("id", club.id)
      .select()
      .single();

    if (error) {
      showToast("Logo konnte nicht entfernt werden.");
      return;
    }

    await sb.storage.from("club-logos").remove([oldPath]);
    club = data;
    vaClub = data;
    applyClubBrand(data);
    updateLogoControls();
    showToast("Vereinslogo entfernt ✓");
  });

  updateLogoControls();

  bindIbanValidation($("#settingsIban"));
  $("#settingsClub").value = club.name || "";
  $("#settingsShort").value = club.short_name || "";
  $("#settingsCreditor").value = club.creditor_id || "";
  $("#settingsIban").value = club.iban || "";
  $("#settingsFee").value = Number(club.standard_fee || 0);
  $("#settingsDue").value = club.due_date || "";
  $$(".color-choice").forEach(btn => btn.classList.toggle("active", btn.dataset.color === club.color));

  $$(".color-choice").forEach(btn => btn.addEventListener("click", () => {
    $$(".color-choice").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
  }));

  $("#settingsForm").addEventListener("submit", async e => {
    e.preventDefault();
    const button = $("button[type='submit']", e.currentTarget);
    const clubIban = normalizeIbanValue($("#settingsIban").value);

    if (clubIban && !isValidIbanValue(clubIban)) {
      $("#settingsIban").focus();
      showToast("Die Vereins-IBAN ist ungültig. Bitte IBAN prüfen.");
      return;
    }

    button.disabled = true;
    button.textContent = "Wird gespeichert …";

    const { data, error } = await sb.from("clubs").update({
      name: $("#settingsClub").value.trim(),
      short_name: $("#settingsShort").value.trim().toUpperCase(),
      color: $(".color-choice.active")?.dataset.color || club.color,
      creditor_id: $("#settingsCreditor").value.trim() || null,
      iban: clubIban || null,
      standard_fee: Number($("#settingsFee").value || 0),
      due_date: $("#settingsDue").value || null,
      updated_at: new Date().toISOString()
    }).eq("id", club.id).select().single();

    button.disabled = false;
    button.textContent = "Änderungen speichern";
    if (error) {
      showToast("Speichern fehlgeschlagen");
      return;
    }
    club = data;
    vaClub = data;
    applyClubBrand(data);
    updateLogoControls();
    showToast("Einstellungen gespeichert ✓");
  });
}


function setupMobileNavigation() {
  if (!$(".app-shell") || $(".mobile-bottom-nav")) return;
  const page = location.pathname.split("/").pop() || "app.html";
  const items = [
    ["app.html", "⌂", "Übersicht"],
    ["members.html", "♙", "Mitglieder"],
    ["contributions.html", "€", "Beiträge"],
    ["settings.html", "⚙", "Einstellungen"]
  ];
  const nav = document.createElement("nav");
  nav.className = "mobile-bottom-nav";
  nav.setAttribute("aria-label", "App-Navigation");
  nav.innerHTML = items.map(([href, icon, label]) =>
    '<a href="' + href + '" class="' + (page === href ? "active" : "") + '"><i>' + icon + '</i><span>' + label + '</span></a>'
  ).join("");
  document.body.appendChild(nav);
}

function setupLogout() {
  const sideBottom = $(".side-bottom");
  if (!sideBottom) return;
  sideBottom.innerHTML = '<div id="trialStatusSide" class="trial-side-status"><strong>Test wird geladen …</strong></div><button class="logout-button" id="logoutButton" type="button">Abmelden</button>';
  $("#logoutButton").addEventListener("click", async () => {
    await sb.auth.signOut();
    location.replace("login.html");
  });
}

(async function boot() {
  try {
    if ($("#startForm")) {
      await initSignup();
      return;
    }
    if ($("#loginForm")) {
      await initLogin();
      return;
    }
    if ($("#forgotPasswordForm")) {
      await initForgotPassword();
      return;
    }
    if ($("#resetPasswordForm")) {
      await initResetPassword();
      return;
    }

    const session = await requireSession();
    if (!session) return;
    setupLogout();
    setupMobileNavigation();

    if ($("#finishSetup")) {
      await initOnboarding();
      finishAppLoad();
      return;
    }
    if ($("#dashboardPage")) {
      await initDashboard();
      finishAppLoad();
      return;
    }
    if ($("#membersPage")) {
      await initMembers();
      finishAppLoad();
      return;
    }
    if ($("#contributionsPage")) {
      await initContributions();
      finishAppLoad();
      return;
    }
    if ($("#settingsForm")) {
      await initSettings();
      finishAppLoad();
      return;
    }
  } catch (error) {
    console.error(error);
    finishAppLoad();
    showToast("Etwas ist schiefgelaufen. Bitte Seite neu laden.");
  }
})();
