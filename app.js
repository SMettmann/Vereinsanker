const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const sb = window.vaSupabase;
const currentYear = new Date().getFullYear();
const VA_AVV_VERSION = "2026-09-30-v1";

function contributionYearFromUrl() {
  const raw = Number(new URLSearchParams(location.search).get("year"));
  return Number.isInteger(raw) && raw >= 2000 && raw <= 2100 ? raw : currentYear;
}

function dueDateForContributionYear(club, year) {
  const raw = String(club?.due_date || "");
  let month = Number(raw.slice(5, 7)) || 3;
  let day = Number(raw.slice(8, 10)) || 1;

  month = Math.min(12, Math.max(1, month));
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  day = Math.min(lastDay, Math.max(1, day));

  return String(year) + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
}

async function loadContributionYears() {
  const { data, error } = await sb
    .from("contributions")
    .select("contribution_year")
    .order("contribution_year", { ascending: false });
  if (error) throw error;

  const years = [...new Set((data || []).map(row => Number(row.contribution_year)).filter(Number.isInteger))];
  if (!years.includes(currentYear)) years.push(currentYear);
  return years.sort((a, b) => b - a);
}

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

function normalizeCreditorIdValue(value) {
  return String(value || "").replace(/\s+/g, "").toUpperCase();
}

function isValidCreditorIdValue(value) {
  const id = normalizeCreditorIdValue(value);
  if (!id) return false;

  // VEREINSANKER richtet sich an deutsche Vereine.
  if (!/^DE[0-9]{2}[A-Z0-9]{3}[A-Z0-9]{11}$/.test(id)) return false;

  // Die Geschäftsbereichskennung (Stellen 5-7) wird bei der Prüfziffer ignoriert.
  const checkBase = id.slice(7) + id.slice(0, 2) + "00";
  let remainder = 0;
  for (const ch of checkBase) {
    const part = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const digit of part) remainder = (remainder * 10 + Number(digit)) % 97;
  }

  const expected = String(98 - remainder).padStart(2, "0");
  return expected === id.slice(2, 4);
}

function isValidSepaReferenceValue(value, max = 35) {
  const raw = String(value || "").trim();
  if (!raw) return true;
  if (raw.length > max) return false;
  if (!/^[A-Za-z0-9 .,'+?/:()\-]+$/.test(raw)) return false;
  if (raw.startsWith("/") || raw.endsWith("/") || raw.includes("//")) return false;
  return true;
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

function appErrorText(error) {
  return [
    error?.code,
    error?.message,
    error?.details,
    error?.hint,
    error?.status,
    error?.statusCode
  ].filter(Boolean).join(" ");
}

function isNetworkAppError(error) {
  const text = appErrorText(error);
  return !navigator.onLine || /failed to fetch|networkerror|network request failed|load failed|fetch failed|connection/i.test(text);
}

function isSessionAppError(error) {
  const text = appErrorText(error);
  return error?.status === 401 ||
    ["session_not_found","session_expired","refresh_token_not_found","refresh_token_already_used","PGRST301","PGRST303"].includes(error?.code) ||
    /jwt expired|invalid jwt|refresh token|session.*expired|not authenticated/i.test(text);
}

function showNetworkStatus(online) {
  let banner = $("#networkStatus");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "networkStatus";
    banner.className = "network-status";
    document.body.prepend(banner);
  }

  banner.hidden = false;
  banner.classList.toggle("online", online);
  banner.textContent = online
    ? "Verbindung wieder da ✓"
    : "Keine Internetverbindung – Änderungen können gerade nicht gespeichert werden.";

  clearTimeout(window.__vaNetworkStatus);
  if (online) {
    window.__vaNetworkStatus = setTimeout(() => { banner.hidden = true; }, 1800);
  }
}

function setupNetworkStatus() {
  window.addEventListener("offline", () => showNetworkStatus(false));
  window.addEventListener("online", () => {
    showNetworkStatus(true);
    if (document.body.dataset.loadFailed === "1") {
      setTimeout(() => location.reload(), 700);
    }
  });

  if (!navigator.onLine) showNetworkStatus(false);
}

function showPageLoadError(message) {
  document.body.dataset.loadFailed = "1";
  const main = $(".app-main");
  if (!main || $("#appLoadError")) return;

  const card = document.createElement("section");
  card.id = "appLoadError";
  card.className = "app-load-error";
  card.innerHTML =
    '<strong>Daten konnten nicht geladen werden</strong>' +
    '<span>' + esc(message || "Bitte Verbindung prüfen und erneut versuchen.") + '</span>' +
    '<button type="button">Erneut versuchen</button>';

  card.querySelector("button").addEventListener("click", () => location.reload());
  main.insertBefore(card, main.firstChild);
}

async function handleAppError(error, fallback = "Aktion konnte nicht ausgeführt werden.") {
  console.error("VEREINSANKER:", error);

  if (isNetworkAppError(error)) {
    showNetworkStatus(false);
    showToast("Keine Internetverbindung. Es wurde nichts gespeichert.");
    return "network";
  }

  if (isSessionAppError(error)) {
    showToast("Deine Sitzung ist abgelaufen. Bitte erneut anmelden.");
    try { await sb.auth.signOut({ scope: "local" }); } catch {}
    setTimeout(() => location.replace("login.html?reason=session"), 650);
    return "session";
  }

  if (error?.code === "42501" || error?.status === 403) {
    try {
      const club = await getClub();
      if (club) {
        applyTrialUI(club);
        if (accessIsBlocked(club)) {
          showToast("Bearbeiten ist aktuell gesperrt. Bitte Tarif- oder Zahlungsstatus prüfen.");
          return "access";
        }
      }
    } catch {}
    showToast("Diese Aktion ist aktuell nicht erlaubt.");
    return "permission";
  }

  showToast(fallback);
  return "error";
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
  if (!data.session) return null;

  // getSession() reads from browser storage. Verify the identity against Supabase
  // before the app trusts the embedded user object.
  const { data: userData, error: userError } = await sb.auth.getUser();
  if (userError) {
    if (isSessionAppError(userError)) {
      try { await sb.auth.signOut({ scope: "local" }); } catch {}
      return null;
    }
    throw userError;
  }
  if (!userData?.user) return null;

  return { ...data.session, user: userData.user };
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

function hasCurrentAvv(club) {
  return Boolean(
    club &&
    club.avv_version === VA_AVV_VERSION &&
    club.avv_accepted_at
  );
}

function clubEntryPage(club) {
  if (!club) return "onboarding.html";
  return hasCurrentAvv(club) ? "app.html" : "avv-accept.html";
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

function formatBillingDate(value) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("de-DE");
}

function trialDaysRemaining(club) {
  if (!club?.trial_ends_at) return 0;
  const ms = new Date(club.trial_ends_at).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86400000));
}

function portalUrl() {
  const url = new URL(VA_PORTAL_LOGIN_URL);
  const email = vaSession?.user?.email;
  if (email) url.searchParams.set("prefilled_email", email);
  return url.toString();
}

function accessIsBlocked(club) {
  if (hasPaidAccess(club)) return false;
  if (["payment_failed", "canceled"].includes(club?.subscription_status)) return true;
  return new Date(club?.trial_ends_at || 0).getTime() <= Date.now();
}

function applyBillingCard(club) {
  const title = $("#settingsBillingTitle");
  const detail = $("#settingsBillingDetail");
  const action = $("#billingActionLink");
  if (!title || !detail || !action) return;

  const paid = hasPaidAccess(club);
  const periodEnd = formatBillingDate(club.stripe_current_period_end);

  if (paid) {
    const yearly = club.subscription_status === "active_yearly";
    title.textContent = yearly ? "Jahresabo aktiv" : "Monatsabo aktiv";
    if (club.stripe_cancel_at_period_end) {
      detail.textContent = periodEnd
        ? "Gekündigt zum " + periodEnd + " · Zugriff bleibt bis dahin bestehen."
        : "Kündigung vorgemerkt · Zugriff bleibt bis zum Laufzeitende bestehen.";
    } else {
      detail.textContent = periodEnd
        ? "Aktiv · nächste Verlängerung am " + periodEnd + "."
        : "Aktiv · VEREINSANKER ist freigeschaltet.";
    }
    action.href = portalUrl();
    action.textContent = "Abo verwalten →";
    action.target = "_blank";
    action.rel = "noopener";
    return;
  }

  action.removeAttribute("target");
  action.removeAttribute("rel");

  if (club.subscription_status === "payment_failed") {
    title.textContent = "Zahlung fehlgeschlagen";
    detail.textContent = "Bitte Zahlungsart im Stripe-Kundenbereich aktualisieren.";
    action.href = portalUrl();
    action.textContent = "Zahlung korrigieren →";
    action.target = "_blank";
    action.rel = "noopener";
  } else if (club.subscription_status === "canceled") {
    title.textContent = "Abo beendet";
    detail.textContent = "Deine Daten bleiben erhalten. Du kannst jederzeit neu freischalten.";
    action.href = "billing.html";
    action.textContent = "Neu aktivieren →";
  } else {
    const days = trialDaysRemaining(club);
    title.textContent = "Kostenloser Test";
    detail.textContent = "Noch " + days + (days === 1 ? " Tag" : " Tage") + " · keine automatische Verlängerung.";
    action.href = "billing.html";
    action.textContent = "Tarif wählen →";
  }
}

function applyTrialUI(club) {
  if (!club) return;

  const paid = hasPaidAccess(club);
  const status = club.subscription_status || "trial";
  const days = trialDaysRemaining(club);
  const blocked = accessIsBlocked(club);
  const trialEnd = formatBillingDate(club.trial_ends_at);
  const periodEnd = formatBillingDate(club.stripe_current_period_end);

  document.body.classList.toggle("trial-expired", blocked);
  applyBillingCard(club);

  const side = $("#trialStatusSide");
  if (side) {
    if (paid && club.stripe_cancel_at_period_end) {
      side.innerHTML = '<strong>Gekündigt zum ' + esc(periodEnd || "Laufzeitende") + '</strong><span>Zugang bleibt bis dahin aktiv.</span>';
      side.className = "trial-side-status warning";
    } else if (paid) {
      side.innerHTML = '<strong>Abo aktiv</strong><span>' + (status === "active_yearly" ? "Jahrestarif" : "Monatstarif") + ' · VEREINSANKER freigeschaltet.</span>';
      side.className = "trial-side-status paid";
    } else if (status === "payment_failed") {
      side.innerHTML = '<strong>Zahlung fehlgeschlagen</strong><span>Bitte Zahlungsart aktualisieren.</span>';
      side.className = "trial-side-status expired";
    } else if (status === "canceled") {
      side.innerHTML = '<strong>Abo beendet</strong><span>Deine Daten bleiben erhalten.</span>';
      side.className = "trial-side-status expired";
    } else if (blocked) {
      side.innerHTML = '<strong>Test beendet</strong><span>Deine Daten bleiben erhalten.</span>';
      side.className = "trial-side-status expired";
    } else {
      side.innerHTML = '<strong>Noch ' + days + (days === 1 ? ' Tag' : ' Tage') + '</strong><span>Test endet am ' + esc(trialEnd) + ' automatisch.</span>';
      side.className = "trial-side-status";
    }
  }

  const billingSideAction = $("#billingSideAction");
  if (billingSideAction) {
    billingSideAction.hidden = false;
    billingSideAction.removeAttribute("target");
    billingSideAction.removeAttribute("rel");

    if (paid) {
      billingSideAction.href = portalUrl();
      billingSideAction.textContent = "Abo verwalten →";
      billingSideAction.target = "_blank";
      billingSideAction.rel = "noopener";
    } else if (status === "payment_failed") {
      billingSideAction.href = portalUrl();
      billingSideAction.textContent = "Zahlung korrigieren →";
      billingSideAction.target = "_blank";
      billingSideAction.rel = "noopener";
    } else if (status === "canceled") {
      billingSideAction.href = "billing.html";
      billingSideAction.textContent = "Neu aktivieren →";
    } else {
      billingSideAction.href = "billing.html";
      billingSideAction.textContent = "Tarif wählen →";
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
    if (paid && club.stripe_cancel_at_period_end) {
      mobile.hidden = false;
      mobile.textContent = "Abo gekündigt · Zugriff bis " + (periodEnd || "Laufzeitende");
      mobile.className = "trial-mobile-status warning";
    } else if (paid) {
      mobile.hidden = true;
    } else if (status === "payment_failed") {
      mobile.hidden = false;
      mobile.innerHTML = '<span>Zahlung fehlgeschlagen</span><a href="' + esc(portalUrl()) + '" target="_blank" rel="noopener">Zahlung korrigieren →</a>';
      mobile.className = "trial-mobile-status expired trial-mobile-with-action";
    } else if (status === "canceled") {
      mobile.hidden = false;
      mobile.innerHTML = '<span>Abo beendet · Daten bleiben erhalten</span><a href="billing.html">Neu aktivieren →</a>';
      mobile.className = "trial-mobile-status expired trial-mobile-with-action";
    } else if (blocked) {
      mobile.hidden = false;
      mobile.textContent = "Test beendet · Daten bleiben erhalten";
      mobile.className = "trial-mobile-status expired";
    } else {
      mobile.hidden = false;
      mobile.innerHTML = '<span>Kostenloser Test · noch ' + days + (days === 1 ? ' Tag' : ' Tage') + '</span><a href="billing.html">Tarif wählen →</a>';
      mobile.className = "trial-mobile-status trial-mobile-with-action";
    }
  }

  const main = $(".app-main");
  let banner = $("#trialExpiredBanner");

  if (blocked && main) {
    if (!banner) {
      banner = document.createElement("section");
      banner.id = "trialExpiredBanner";
      banner.className = "trial-expired-banner";
      main.insertBefore(banner, main.firstChild);
    }

    if (status === "payment_failed") {
      banner.innerHTML = '<div><strong>Zahlung fehlgeschlagen.</strong><span>Bitte aktualisiere deine Zahlungsart. Sobald Stripe die Zahlung bestätigt, wird VEREINSANKER automatisch wieder freigeschaltet.</span></div><a href="' + esc(portalUrl()) + '" target="_blank" rel="noopener">Zahlung korrigieren</a>';
    } else if (status === "canceled") {
      banner.innerHTML = '<div><strong>Dein Abo ist beendet.</strong><span>Deine Daten bleiben erhalten. Du kannst VEREINSANKER jederzeit wieder freischalten.</span></div><a href="billing.html">Neu aktivieren</a>';
    } else {
      banner.innerHTML = '<div><strong>Dein 14-Tage-Test ist beendet.</strong><span>Deine Daten bleiben erhalten. Zum Weiterbearbeiten kannst du VEREINSANKER freischalten.</span></div><a href="billing.html">Tarif wählen</a>';
    }
  } else if (banner) {
    banner.remove();
  }
}

async function initSignup() {
  const existingSession = await getSession();
  if (existingSession) {
    vaSession = existingSession;
    const club = await getClub();
    location.replace(clubEntryPage(club));
    return;
  }
  const form = $("#startForm");
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const button = $("button[type='submit']", form);
    const email = $("#email").value.trim();
    const password = $("#password").value;

    if (password.length < 12) {
      setMessage(form, "Das Passwort muss mindestens 12 Zeichen haben.", "error");
      return;
    }

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
      console.error("Registrierung:", error);
      setMessage(
        form,
        isNetworkAppError(error)
          ? "Keine Internetverbindung. Konto wurde nicht angelegt."
          : (error.code === "user_already_exists"
              ? "Für diese E-Mail-Adresse gibt es bereits ein Konto."
              : "Registrierung ist gerade nicht möglich. Bitte versuche es erneut."),
        "error"
      );
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
  const form = $("#loginForm");
  if (new URLSearchParams(location.search).get("reason") === "session") {
    setMessage(form, "Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.", "error");
    history.replaceState(null, "", "login.html");
  }

  const existingSession = await getSession();
  if (existingSession) {
    vaSession = existingSession;
    const club = await getClub();
    location.replace(clubEntryPage(club));
    return;
  }
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
      console.error("Anmeldung:", error);
      setMessage(
        form,
        isNetworkAppError(error)
          ? "Keine Internetverbindung. Bitte Verbindung prüfen."
          : error.code === "email_not_confirmed"
            ? "Bitte bestätige zuerst deine E-Mail-Adresse."
            : "E-Mail oder Passwort stimmen nicht.",
        "error"
      );
      button.disabled = false;
      button.textContent = "Anmelden →";
      return;
    }

    const club = await getClub();
    location.href = clubEntryPage(club);
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
      console.error("Passwort-Reset:", error);
      setMessage(
        form,
        isNetworkAppError(error)
          ? "Keine Internetverbindung. Reset-Link wurde nicht angefordert."
          : "Reset-Link konnte nicht gesendet werden. Bitte versuche es erneut.",
        "error"
      );
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

    if (password.length < 12) {
      setMessage(form, "Das Passwort muss mindestens 12 Zeichen haben.", "error");
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
      console.error("Passwort ändern:", error);
      if (isNetworkAppError(error)) {
        setMessage(form, "Keine Internetverbindung. Passwort wurde nicht geändert.", "error");
      } else if (error.code === "same_password") {
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
  $(".step").forEach(s => s.classList.toggle("active", Number(s.dataset.step) === n));
  if ($("#stepNo")) $("#stepNo").textContent = n;
  if ($("#progressBar")) $("#progressBar").style.width = (n / 4 * 100) + "%";
}

async function initOnboarding() {
  const existing = await getClub();
  if (existing) {
    $("#clubName").value = existing.name || "";
    $("#clubShort").value = existing.short_name || "";
    $("#fee").value = Number(existing.standard_fee || 0);
    $("#due").value = existing.due_date || "";
    $("#creditor").value = existing.creditor_id || "";
    $("#controllerAddress").value = existing.controller_address || "";
    $("#controllerContact").value = existing.controller_contact_name || "";
    $$(".color-choice").forEach(btn => btn.classList.toggle("active", btn.dataset.color === existing.color));
  }
  if ($("#controllerEmail")) $("#controllerEmail").value = vaSession?.user?.email || "";

  $$$(".color-choice").forEach(btn => btn.addEventListener("click", () => {
    $$$(".color-choice").forEach(b => b.classList.remove("active"));
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

    const creditorId = normalizeCreditorIdValue($("#creditor").value);
    const controllerAddress = $("#controllerAddress").value.trim();
    const controllerContact = $("#controllerContact").value.trim();
    const avvAccepted = $("#acceptAvv")?.checked;

    if (creditorId && !isValidCreditorIdValue(creditorId)) {
      showStep(3);
      $("#creditor").focus();
      showToast("Die Gläubiger-ID ist ungültig. Deutsche Gläubiger-IDs haben 18 Stellen und eine gültige Prüfziffer.");
      return;
    }

    if (controllerAddress.length < 5) {
      showStep(4);
      $("#controllerAddress").focus();
      showToast("Bitte die Vereinsanschrift eintragen.");
      return;
    }

    if (controllerContact.length < 2) {
      showStep(4);
      $("#controllerContact").focus();
      showToast("Bitte einen Ansprechpartner eintragen.");
      return;
    }

    if (!avvAccepted) {
      showStep(4);
      showToast("Bitte den AV-Vertrag bestätigen.");
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
      creditor_id: creditorId || null,
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

    const { error: avvError } = await sb.rpc("accept_current_avv", {
      p_club_id: data.id,
      p_version: VA_AVV_VERSION,
      p_controller_address: controllerAddress,
      p_controller_contact_name: controllerContact
    });

    if (avvError) {
      button.disabled = false;
      button.textContent = "Verein öffnen →";
      await handleAppError(avvError, "AV-Vertrag konnte nicht gespeichert werden.");
      return;
    }

    data.controller_address = controllerAddress;
    data.controller_contact_name = controllerContact;
    data.avv_version = VA_AVV_VERSION;
    data.avv_accepted_at = new Date().toISOString();
    vaClub = data;

    if (window.vaOnboardingImportState && window.importPreparedMembers) {
      const state = window.vaOnboardingImportState;
      const mappingOkay = state.mapping.full_name || (state.mapping.first_name && state.mapping.last_name);
      if (mappingOkay && !state.blocked) {
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

async function nextMemberNumber(clubId) {
  const { data, error } = await sb
    .from("members")
    .select("member_number")
    .eq("club_id", clubId);
  if (error) throw error;

  const used = new Set(
    (data || [])
      .map(row => String(row.member_number || "").trim())
      .filter(Boolean)
  );

  let number = 1001;
  while (used.has(String(number))) number++;
  return String(number);
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

async function loadFinanceTransactions(year = currentYear) {
  const { data, error } = await sb
    .from("finance_transactions")
    .select("*")
    .gte("transaction_date", year + "-01-01")
    .lte("transaction_date", year + "-12-31");
  if (error) throw error;
  return data || [];
}

async function loadPaidContributionsForFinance(year = currentYear) {
  const start = year + "-01-01T00:00:00";
  const end = (year + 1) + "-01-01T00:00:00";
  const { data, error } = await sb
    .from("contributions")
    .select("id,amount,paid_at")
    .eq("status", "paid")
    .gte("paid_at", start)
    .lt("paid_at", end);
  if (error) throw error;
  return data || [];
}

async function initAvvAccept() {
  const club = await getClub();
  if (!club) return location.replace("onboarding.html");
  if (hasCurrentAvv(club)) return location.replace("app.html");

  if ($("#avvClubName")) $("#avvClubName").textContent = club.name || "Euer Verein";
  if ($("#avvAccountEmail")) $("#avvAccountEmail").textContent = vaSession?.user?.email || "–";
  if ($("#avvControllerAddress")) $("#avvControllerAddress").value = club.controller_address || "";
  if ($("#avvControllerContact")) $("#avvControllerContact").value = club.controller_contact_name || "";

  const form = $("#avvAcceptForm");
  form?.addEventListener("submit", async e => {
    e.preventDefault();

    const address = $("#avvControllerAddress").value.trim();
    const contact = $("#avvControllerContact").value.trim();
    const accepted = $("#avvAcceptCheckbox").checked;
    const button = $("button[type='submit']", form);

    if (address.length < 5) {
      $("#avvControllerAddress").focus();
      setMessage(form, "Bitte die Vereinsanschrift eintragen.", "error");
      return;
    }
    if (contact.length < 2) {
      $("#avvControllerContact").focus();
      setMessage(form, "Bitte einen Ansprechpartner eintragen.", "error");
      return;
    }
    if (!accepted) {
      setMessage(form, "Bitte den AV-Vertrag bestätigen.", "error");
      return;
    }

    button.disabled = true;
    button.textContent = "AV-Vertrag wird gespeichert …";

    const { error } = await sb.rpc("accept_current_avv", {
      p_club_id: club.id,
      p_version: VA_AVV_VERSION,
      p_controller_address: address,
      p_controller_contact_name: contact
    });

    if (error) {
      button.disabled = false;
      button.textContent = "AV-Vertrag abschließen →";
      setMessage(form, "Der AV-Vertrag konnte nicht gespeichert werden. Bitte erneut versuchen.", "error");
      console.error("AVV:", error);
      return;
    }

    location.replace("app.html");
  });
}

async function initDashboard() {
  const club = await getClub();
  if (!club) {
    location.replace("onboarding.html");
    return;
  }
  applyClubBrand(club);
  applyTrialUI(club);

  const [members, contributions, pendingJoinsResult] = await Promise.all([
    loadMembers(),
    loadContributions(),
    sb.from("membership_applications").select("id", { count: "exact", head: true }).eq("club_id", club.id).eq("status", "pending")
  ]);

  const paid = contributions.filter(c => c.status === "paid");
  const open = contributions.filter(c => c.status !== "paid");
  const completedPercent = contributions.length
    ? Math.round((paid.length / contributions.length) * 100)
    : 0;

  $("#dashboardYear").textContent = currentYear;
  $("#dashMembers").textContent = String(members.length);
  $("#dashPaid").textContent = String(paid.length);
  $("#dashOpen").textContent = String(open.length);
  if ($("#dashJoinCount")) $("#dashJoinCount").textContent = String(pendingJoinsResult.error ? 0 : (pendingJoinsResult.count || 0));
  $("#dashPercent").textContent = completedPercent + " %";
  $("#dashProgress").style.width = completedPercent + "%";

  const openList = $("#dashboardOpenRows");
  if (members.length && !contributions.length) {
    openList.innerHTML = '<div class="empty-row"><strong>Beitragsjahr ' + currentYear + ' noch nicht angelegt</strong><span><a href="contributions.html">Beiträge für ' + currentYear + ' anlegen →</a></span></div>';
  } else if (!open.length) {
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
    const status = !c ? "Kein Beitrag" : (c.status === "paid" ? "Bezahlt" : "Offen");
    return '<button class="members-row" type="button" data-member-id="' + esc(m.id) + '">' +
      '<span class="member-main"><i>' + esc(initials(m.first_name, m.last_name)) + '</i><b>' + esc(memberFullName(m)) + '<small>' + esc(m.member_number || "ohne Mitgliedsnummer") + '</small></b></span>' +
      '<span>' + esc(m.group_name || "Ohne Gruppe") + '</span>' +
      '<span>' + esc(money(m.annual_fee)) + '</span>' +
      '<em class="' + (status === "Bezahlt" ? "status-paid" : status === "Offen" ? "status-open" : "status-none") + '">' + status + '</em>' +
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
    $("#detailMemberNumber").textContent = member.member_number || "–";
    $("#detailEmail").textContent = member.email || "–";
    if ($("#detailPhone")) $("#detailPhone").textContent = member.phone || "–";
    if ($("#detailBirthDate")) $("#detailBirthDate").textContent = member.birth_date ? new Date(member.birth_date + "T00:00:00").toLocaleDateString("de-DE") : "–";
    if ($("#detailAddress")) $("#detailAddress").textContent = [member.street, [member.postal_code, member.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") || "–";
    $("#detailIban").textContent = member.iban || "–";
    $("#detailFee").textContent = money(member.annual_fee);
    $("#detailStatus").textContent = !c ? "Kein Beitrag" : (c.status === "paid" ? "Bezahlt" : "Offen");
    openBackdrop(memberSheet);
  });

  $("#memberSearch").addEventListener("input", e => {
    const q = e.target.value.trim().toLowerCase();
    let count = 0;
    $$(".members-row").forEach(row => {
      const member = members.find(m => m.id === row.dataset.memberId);
      const text = member ? (memberFullName(member) + " " + (member.member_number || "") + " " + (member.group_name || "") + " " + (member.email || "")).toLowerCase() : "";
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
    const memberIban = normalizeIbanValue($("#memberIban").value);
    const memberMandate = $("#memberMandate")?.value.trim() || "";

    if (memberIban && !isValidIbanValue(memberIban)) {
      bindIbanValidation($("#memberIban"));
      $("#memberIban").classList.add("input-invalid");
      $("#memberIban").focus();
      showToast("IBAN ungültig – Mitglied wurde nicht gespeichert.");
      return;
    }

    if (memberMandate && !isValidSepaReferenceValue(memberMandate)) {
      $("#memberMandate").focus();
      showToast("Mandatsreferenz ungültig: maximal 35 Zeichen, kein / am Anfang oder Ende und kein //.");
      return;
    }

    button.disabled = true;
    button.textContent = "Wird gespeichert …";

    try {
      const memberNumber = await nextMemberNumber(club.id);
      const dueDate = dueDateForContributionYear(club, currentYear);

      const { error } = await sb.rpc("create_member_with_contribution", {
        p_club_id: club.id,
        p_member_number: memberNumber,
        p_first_name: $("#firstName").value.trim(),
        p_last_name: $("#lastName").value.trim(),
        p_group_name: $("#memberGroup").value.trim() || null,
        p_email: $("#memberEmail").value.trim() || null,
        p_iban: memberIban || null,
        p_annual_fee: fee,
        p_mandate_reference: memberMandate || null,
        p_mandate_signed_at: $("#memberMandateDate")?.value || null,
        p_contribution_year: currentYear,
        p_due_date: dueDate
      });
      if (error) throw error;

      closeBackdrop(addMemberSheet);
      showToast("Mitglied gespeichert ✓");
      setTimeout(() => location.reload(), 250);
    } catch (error) {
      const message = appErrorText(error);
      const invalidIban = message.includes("INVALID_IBAN");
      const duplicateMandate = error?.code === "23505" && /mandate_reference|members_club_mandate_reference_uidx/i.test(message);
      const duplicateNumber = error?.code === "23505" && !duplicateMandate;

      if (invalidIban) showToast("IBAN ungültig – Mitglied wurde nicht gespeichert.");
      else if (duplicateMandate) showToast("Diese Mandatsreferenz ist bereits vergeben.");
      else if (duplicateNumber) showToast("Mitgliedsnummer bereits vergeben. Bitte erneut speichern.");
      else await handleAppError(error, "Mitglied konnte nicht gespeichert werden. Es wurde nichts angelegt.");

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

  const selectedYear = contributionYearFromUrl();
  window.vaContributionYear = selectedYear;
  let contributions = await loadContributions(selectedYear);
  const total = contributions.reduce((s, c) => s + Number(c.amount || 0), 0);
  const paid = contributions.filter(c => c.status === "paid").reduce((s, c) => s + Number(c.amount || 0), 0);
  const open = contributions.filter(c => c.status !== "paid");

  const yearSelect = $("#contribYearSelect");
  if (yearSelect) {
    const years = await loadContributionYears();
    yearSelect.innerHTML = years.map(year =>
      '<option value="' + year + '"' + (year === selectedYear ? ' selected' : '') + '>' + year + '</option>'
    ).join("");
    yearSelect.addEventListener("change", () => {
      const year = Number(yearSelect.value);
      const url = new URL(location.href);
      if (year === currentYear) url.searchParams.delete("year");
      else url.searchParams.set("year", String(year));
      location.href = url.toString();
    });
  }

  $("#contribTotal").textContent = money(total);
  $("#contribPaid").textContent = money(paid);
  $("#contribOpen").textContent = money(total - paid);

  const paymentList = $("#paymentList");
  const openList = $("#openContributions");

  const formatPaidDate = value => {
    if (!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("de-DE");
  };

  const localDateValue = value => {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) return "";
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0")
    ].join("-");
  };

  const paymentDateToIso = value => {
    const date = new Date(value + "T12:00:00");
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  };

  const refreshSummary = () => {
    const newTotal = contributions.reduce((sum, c) => sum + Number(c.amount || 0), 0);
    const newPaid = contributions
      .filter(c => c.status === "paid")
      .reduce((sum, c) => sum + Number(c.amount || 0), 0);

    $("#contribTotal").textContent = money(newTotal);
    $("#contribPaid").textContent = money(newPaid);
    $("#contribOpen").textContent = money(newTotal - newPaid);
  };

  const render = () => {
    if (!contributions.length) {
      paymentList.innerHTML = '<div class="empty-row"><strong>Noch keine Beiträge</strong><span>Lege zuerst Mitglieder an.</span></div>';
      openList.innerHTML = '<div class="empty-row"><strong>Nichts offen</strong><span>Noch keine Beiträge vorhanden.</span></div>';
      $("#openCount").textContent = "0";
      return;
    }

    const openRows = contributions.filter(c => c.status !== "paid");
    $("#openCount").textContent = openRows.length;

    openList.innerHTML = openRows.length ? openRows.map(c => {
      const m = contributionMember(c);
      return '<div class="open-row">' +
        '<span class="member-main"><i>' + esc(initials(m.first_name, m.last_name)) + '</i><b>' +
        esc(memberFullName(m)) +
        '<small>' + esc((m.group_name || "Ohne Gruppe") + " · Jahresbeitrag") + '</small>' +
        (memberSepaProblem(m) ? '<small class="sepa-row-warning">SEPA nicht möglich: ' + esc(memberSepaProblem(m)) + '</small>' : '') +
        '</b></span>' +
        '<strong>' + esc(money(c.amount)) + '</strong>' +
        '<span>' + (c.due_date ? "Fällig " + new Date(c.due_date + "T00:00:00").toLocaleDateString("de-DE") : "Keine Fälligkeit") + '</span>' +
        '<span class="open-actions"><button class="mark-paid" data-id="' + esc(c.id) + '">Als bezahlt markieren</button><button class="tiny-action" data-id="' + esc(c.id) + '">Erinnern</button></span>' +
      '</div>';
    }).join("") : '<div class="empty-row"><strong>Alles erledigt ✓</strong><span>Keine offenen Beiträge.</span></div>';

    paymentList.innerHTML = contributions.map(c => {
      const m = contributionMember(c);
      const paidDate = c.status === "paid" ? formatPaidDate(c.paid_at) : "";
      return '<div class="payment-row" data-search="' + esc((memberFullName(m) + " " + (m.group_name || "")).toLowerCase()) + '">' +
        '<span class="member-main"><i>' + esc(initials(m.first_name, m.last_name)) + '</i><b>' +
        esc(memberFullName(m)) +
        '<small>' + esc(m.group_name || "Ohne Gruppe") + '</small></b></span>' +
        '<strong>' + esc(money(c.amount)) + '</strong>' +
        (c.status === "paid"
          ? '<span class="paid-check paid-with-date"><b>✓ Bezahlt</b><small>' + esc(paidDate ? "am " + paidDate : "Zahlungsdatum fehlt") + '</small><button class="payment-edit" data-id="' + esc(c.id) + '" type="button">Ändern</button></span>'
          : '<span class="payment-open-status">Offen</span>') +
      '</div>';
    }).join("");
  };

  const paymentSheet = $("#paymentSheet");
  const paymentDate = $("#paymentDate");
  if (paymentDate) paymentDate.max = localDateValue();

  const openPaymentSheet = contribution => {
    if (!contribution) return;
    const m = contributionMember(contribution);
    const paid = contribution.status === "paid";

    $("#paymentContributionId").value = contribution.id;
    $("#paymentMemberName").textContent = memberFullName(m);
    $("#paymentAmount").textContent = money(contribution.amount);
    $("#paymentSheetTitle").textContent = paid ? "Zahlung ändern" : "Zahlung verbuchen";
    $("#paymentSheetIntro").textContent = paid
      ? "Zahlungsdatum korrigieren oder die Verbuchung zurücknehmen."
      : "Zahlungsdatum prüfen und Beitrag als bezahlt markieren.";
    paymentDate.value = paid ? localDateValue(contribution.paid_at) : localDateValue();
    $("#savePayment").textContent = paid ? "Änderung speichern" : "Zahlung verbuchen";
    $("#undoPayment").hidden = !paid;
    paymentSheet.dataset.mode = paid ? "edit" : "new";
    openBackdrop(paymentSheet);
  };

  const reloadPayments = async () => {
    contributions = await loadContributions(selectedYear);
    refreshSummary();
    render();
    updateSepaAction();
  };

  render();

  $("#paymentSearch")?.addEventListener("input", e => {
    const q = e.target.value.trim().toLowerCase();
    $$(".payment-row").forEach(row => { row.hidden = !row.dataset.search.includes(q); });
  });

  openList.addEventListener("click", e => {
    const button = e.target.closest(".mark-paid");
    if (!button) return;
    const contribution = contributions.find(c => c.id === button.dataset.id);
    openPaymentSheet(contribution);
  });

  paymentList.addEventListener("click", e => {
    const button = e.target.closest(".payment-edit");
    if (!button) return;
    const contribution = contributions.find(c => c.id === button.dataset.id);
    openPaymentSheet(contribution);
  });

  $("#closePayment")?.addEventListener("click", () => closeBackdrop(paymentSheet));
  paymentSheet?.addEventListener("click", e => {
    if (e.target === paymentSheet) closeBackdrop(paymentSheet);
  });

  $("#savePayment")?.addEventListener("click", async () => {
    const id = $("#paymentContributionId").value;
    const contribution = contributions.find(c => c.id === id);
    const dateValue = paymentDate?.value;
    if (!contribution || !dateValue) return showToast("Bitte Zahlungsdatum auswählen");

    const today = localDateValue();
    if (dateValue > today) return showToast("Das Zahlungsdatum darf nicht in der Zukunft liegen");

    const paidAt = paymentDateToIso(dateValue);
    if (!paidAt) return showToast("Zahlungsdatum ist ungültig");

    const button = $("#savePayment");
    button.disabled = true;
    button.textContent = "Wird gespeichert …";

    let query = sb.from("contributions").update({
      status: "paid",
      paid_at: paidAt,
      updated_at: new Date().toISOString()
    }).eq("id", id);

    if (paymentSheet.dataset.mode === "new") {
      query = query.neq("status", "paid");
    }

    const { data, error } = await query.select("id").maybeSingle();

    button.disabled = false;
    button.textContent = paymentSheet.dataset.mode === "edit" ? "Änderung speichern" : "Zahlung verbuchen";

    if (error) {
      await handleAppError(error, "Zahlung konnte nicht gespeichert werden.");
      return;
    }

    if (!data && paymentSheet.dataset.mode === "new") {
      await reloadPayments();
      closeBackdrop(paymentSheet);
      showToast("Diese Zahlung war bereits verbucht.");
      return;
    }

    await reloadPayments();
    closeBackdrop(paymentSheet);
    showToast(paymentSheet.dataset.mode === "edit"
      ? "Zahlungsdatum aktualisiert ✓"
      : "Zahlung verbucht ✓");
  });

  $("#undoPayment")?.addEventListener("click", async () => {
    const id = $("#paymentContributionId").value;
    const contribution = contributions.find(c => c.id === id);
    if (!contribution || contribution.status !== "paid") return;

    if (!confirm("Zahlung wirklich zurücknehmen? Der Beitrag wird wieder als offen geführt.")) return;

    const button = $("#undoPayment");
    button.disabled = true;
    button.textContent = "Wird zurückgesetzt …";

    const { error } = await sb.from("contributions").update({
      status: "open",
      paid_at: null,
      updated_at: new Date().toISOString()
    }).eq("id", id).eq("status", "paid");

    button.disabled = false;
    button.textContent = "Zahlung wieder auf offen setzen";

    if (error) {
      await handleAppError(error, "Zahlung konnte nicht zurückgenommen werden.");
      return;
    }

    await reloadPayments();
    closeBackdrop(paymentSheet);
    showToast("Zahlung wieder als offen markiert ✓");
  });



  const sepaSheet = $("#sepaSheet");
  const sepaAction = $("#openSepa");

  const updateSepaAction = () => {
    if (!sepaAction) return;
    const openRows = contributions.filter(c => c.status !== "paid");
    sepaAction.classList.toggle("no-sepa-needed", !openRows.length);
    const sub = $("span", sepaAction);
    if (sub) sub.textContent = openRows.length
      ? "Beiträge für den Bankeinzug vorbereiten."
      : "Alle Beiträge sind bereits bezahlt.";
  };

  updateSepaAction();

  sepaAction?.addEventListener("click", () => {
    const openContributions = contributions.filter(c => c.status !== "paid");
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
      return !String(m.mandate_reference || "").trim() || !m.mandate_signed_at;
    });
    const invalidAmount = openContributions.filter(c => {
      const amount = Number(c.amount || 0);
      return !Number.isFinite(amount) || amount < 0.01 || amount > 999999999.99;
    });
    const ready = openContributions.filter(c => {
      const m = contributionMember(c);
      const amount = Number(c.amount || 0);
      return amount >= 0.01 &&
        amount <= 999999999.99 &&
        isValidIbanValue(m.iban) &&
        String(m.mandate_reference || "").trim() &&
        m.mandate_signed_at;
    });

    $("#sepaReadyCount").textContent = ready.length + (ready.length === 1 ? " Mitglied" : " Mitglieder");
    $("#sepaReadySum").textContent = money(ready.reduce((s, c) => s + Number(c.amount || 0), 0));

    const issues = [];
    if (!club.iban) issues.push("Vereins-IBAN fehlt.");
    else if (!isValidIbanValue(club.iban)) issues.push("Vereins-IBAN ist ungültig.");
    if (!club.creditor_id) issues.push("Gläubiger-ID fehlt.");
    else if (!isValidCreditorIdValue(club.creditor_id)) issues.push("Gläubiger-ID ist ungültig.");
    if (invalidAmount.length) issues.push(invalidAmount.length + " Beitrag/Beiträge mit ungültigem Betrag.");
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

async function cleanupOrphanClubLogos(club) {
  if (!club?.id || accessIsBlocked(club)) return;

  const { data, error } = await sb.storage
    .from("club-logos")
    .list(club.id, { limit: 100, sortBy: { column: "created_at", order: "desc" } });

  if (error) {
    console.warn("Alte Logos konnten nicht geprüft werden:", error);
    return;
  }

  const keep = club.logo_path ? club.logo_path.split("/").pop() : null;
  const stale = (data || [])
    .filter(file => file?.name && file.name !== keep)
    .map(file => club.id + "/" + file.name);

  if (!stale.length) return;

  const { error: removeError } = await sb.storage.from("club-logos").remove(stale);
  if (removeError) console.warn("Alte Logos konnten nicht vollständig entfernt werden:", removeError);
}

async function initSettings() {
  let club = await getClub();
  if (!club) return location.replace("onboarding.html");
  applyClubBrand(club);
  applyTrialUI(club);
  cleanupOrphanClubLogos(club);

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
      await handleAppError(uploadError, "Logo konnte nicht hochgeladen werden.");
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
      await handleAppError(saveError, "Logo konnte nicht gespeichert werden.");
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
      await handleAppError(error, "Logo konnte nicht entfernt werden.");
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
  if ($("#settingsAvvState")) {
    $("#settingsAvvState").textContent = hasCurrentAvv(club) ? "AV-Vertrag abgeschlossen ✓" : "AV-Vertrag fehlt";
  }
  if ($("#settingsAvvDetail")) {
    const acceptedDate = club.avv_accepted_at ? new Date(club.avv_accepted_at).toLocaleString("de-DE") : "–";
    $("#settingsAvvDetail").textContent = hasCurrentAvv(club)
      ? "Version " + club.avv_version + " · angenommen am " + acceptedDate
      : "Vor der Verarbeitung von Mitgliederdaten muss der aktuelle AV-Vertrag abgeschlossen werden.";
  }
  $$(".color-choice").forEach(btn => btn.classList.toggle("active", btn.dataset.color === club.color));

  $$$(".color-choice").forEach(btn => btn.addEventListener("click", () => {
    $$$(".color-choice").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
  }));

  $("#exportAllData")?.addEventListener("click", async e => {
    const button = e.currentTarget;
    button.disabled = true;
    button.textContent = "Export wird erstellt …";

    try {
      if (!window.XLSX) throw new Error("Excel-Export ist noch nicht geladen.");

      const [membersResult, contributionsResult, financeResult, legalResult, applicationsResult] = await Promise.all([
        sb.from("members").select("*").eq("club_id", club.id).order("last_name").order("first_name"),
        sb.from("contributions").select("*").eq("club_id", club.id).order("contribution_year", { ascending: false }),
        sb.from("finance_transactions").select("*").eq("club_id", club.id).order("transaction_date", { ascending: false }),
        sb.from("legal_acceptances").select("document_type,document_version,accepted_at,controller_name,controller_address,controller_contact_name,controller_contact_email").eq("club_id", club.id).order("accepted_at", { ascending: false }),
        sb.from("membership_applications").select("*").eq("club_id", club.id).order("submitted_at", { ascending: false })
      ]);

      if (membersResult.error) throw membersResult.error;
      if (contributionsResult.error) throw contributionsResult.error;
      if (financeResult.error) throw financeResult.error;
      if (legalResult.error) throw legalResult.error;
      if (applicationsResult.error) throw applicationsResult.error;

      const members = membersResult.data || [];
      const contributions = contributionsResult.data || [];
      const finances = financeResult.data || [];
      const legalAcceptances = legalResult.data || [];
      const applications = applicationsResult.data || [];
      const memberById = new Map(members.map(member => [member.id, member]));

      const workbook = XLSX.utils.book_new();

      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{
        "Vereinsname": club.name || "",
        "Kürzel": club.short_name || "",
        "Vereinsfarbe": club.color || "",
        "Gläubiger-ID": club.creditor_id || "",
        "IBAN": club.iban || "",
        "Standardbeitrag": Number(club.standard_fee || 0),
        "Fälligkeit": club.due_date || "",
        "Vereinsanschrift": club.controller_address || "",
        "Datenschutz-Ansprechpartner": club.controller_contact_name || "",
        "AVV-Version": club.avv_version || "",
        "AVV angenommen am": club.avv_accepted_at || "",
        "Erstellt am": club.created_at || ""
      }]), "Verein");

      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(members.map(member => ({
        "Mitgliedsnummer": member.member_number || "",
        "Vorname": member.first_name || "",
        "Nachname": member.last_name || "",
        "Gruppe": member.group_name || "",
        "E-Mail": member.email || "",
        "Telefon": member.phone || "",
        "Geburtsdatum": member.birth_date || "",
        "Straße": member.street || "",
        "PLZ": member.postal_code || "",
        "Ort": member.city || "",
        "IBAN": member.iban || "",
        "Jahresbeitrag": Number(member.annual_fee || 0),
        "Mandatsreferenz": member.mandate_reference || "",
        "Mandat unterschrieben am": member.mandate_signed_at || "",
        "Aktiv": member.active ? "Ja" : "Nein",
        "Erstellt am": member.created_at || ""
      }))), "Mitglieder");

      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(contributions.map(entry => {
        const member = memberById.get(entry.member_id) || {};
        return {
          "Mitgliedsnummer": member.member_number || "",
          "Vorname": member.first_name || "",
          "Nachname": member.last_name || "",
          "Jahr": entry.contribution_year,
          "Betrag": Number(entry.amount || 0),
          "Fälligkeit": entry.due_date || "",
          "Status": entry.status || "",
          "Bezahlt am": entry.paid_at || "",
          "Notiz": entry.note || ""
        };
      })), "Beiträge");

      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(finances.map(entry => ({
        "Datum": entry.transaction_date || "",
        "Typ": entry.type === "income" ? "Einnahme" : "Ausgabe",
        "Kategorie": entry.category || "",
        "Beschreibung": entry.description || "",
        "Betrag": Number(entry.amount || 0),
        "Zahlungsart": entry.payment_method === "cash" ? "Bar" : "Bank",
        "Beleg vorhanden": entry.receipt_path ? "Ja" : "Nein"
      }))), "Finanzen");

      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(applications.map(entry => ({
        "Vorname": entry.first_name || "",
        "Nachname": entry.last_name || "",
        "E-Mail": entry.email || "",
        "Telefon": entry.phone || "",
        "Geburtsdatum": entry.birth_date || "",
        "Straße": entry.street || "",
        "PLZ": entry.postal_code || "",
        "Ort": entry.city || "",
        "Gruppe/Wunsch": entry.group_name || "",
        "IBAN": entry.iban || "",
        "SEPA-Zustimmung": entry.sepa_consent ? "Ja" : "Nein",
        "Jahresbeitrag": Number(entry.annual_fee || 0),
        "Status": entry.status || "",
        "Eingegangen am": entry.submitted_at || "",
        "Bearbeitet am": entry.reviewed_at || ""
      }))), "Beitrittsanträge");

      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(legalAcceptances.map(entry => ({
        "Dokument": entry.document_type === "avv" ? "AV-Vertrag" : entry.document_type || "",
        "Version": entry.document_version || "",
        "Angenommen am": entry.accepted_at || "",
        "Verantwortlicher / Verein": entry.controller_name || "",
        "Vereinsanschrift": entry.controller_address || "",
        "Ansprechpartner": entry.controller_contact_name || "",
        "Account-E-Mail": entry.controller_contact_email || ""
      }))), "AVV-Nachweis");

      const stamp = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(workbook, "VEREINSANKER_Datenexport_" + stamp + ".xlsx");
      showToast("Kompletter Datenexport erstellt ✓");
    } catch (error) {
      await handleAppError(error, "Datenexport konnte nicht erstellt werden.");
    } finally {
      button.disabled = false;
      button.textContent = "Alle Vereinsdaten herunterladen";
    }
  });

  const stripeDeletionBlocked = Boolean(
    club.stripe_subscription_id &&
    !club.stripe_cancel_at_period_end &&
    !["canceled", "incomplete_expired"].includes(String(club.stripe_status || "").toLowerCase())
  );

  const deleteBlockedBox = $("#deleteAccountBlocked");
  const prepareDeleteButton = $("#prepareDeleteAccount");
  const deletePanel = $("#deleteAccountPanel");
  const deletePortalLink = $("#deletePortalLink");
  const deletionStatus = $("#deleteAccountStatus");

  if (deletePortalLink) deletePortalLink.href = portalUrl();

  if (stripeDeletionBlocked) {
    if (deleteBlockedBox) deleteBlockedBox.hidden = false;
    if (prepareDeleteButton) prepareDeleteButton.hidden = true;
  } else {
    if (deleteBlockedBox) deleteBlockedBox.hidden = true;
    if (prepareDeleteButton) prepareDeleteButton.hidden = false;
    if (club.stripe_subscription_id && club.stripe_cancel_at_period_end && deletionStatus) {
      deletionStatus.textContent = "Dein Abo ist bereits zur Kündigung vorgemerkt. Wenn du jetzt löschst, endet der Zugang sofort und eine verbleibende Restlaufzeit wird nicht weiter genutzt.";
    }
  }

  $("#exportBeforeDelete")?.addEventListener("click", () => {
    $("#exportAllData")?.click();
  });

  prepareDeleteButton?.addEventListener("click", () => {
    if (deletePanel) deletePanel.hidden = false;
    prepareDeleteButton.hidden = true;
    $("#deletePassword")?.focus();
  });

  $("#cancelDeleteAccount")?.addEventListener("click", () => {
    if (deletePanel) deletePanel.hidden = true;
    if (prepareDeleteButton) prepareDeleteButton.hidden = false;
    if ($("#deletePassword")) $("#deletePassword").value = "";
    if ($("#deleteConfirmation")) $("#deleteConfirmation").value = "";
    if ($("#deleteAccountError")) $("#deleteAccountError").textContent = "";
  });

  $("#confirmDeleteAccount")?.addEventListener("click", async e => {
    const button = e.currentTarget;
    const password = $("#deletePassword")?.value || "";
    const confirmation = $("#deleteConfirmation")?.value.trim() || "";
    const errorBox = $("#deleteAccountError");

    if (!password) {
      if (errorBox) errorBox.textContent = "Bitte dein aktuelles Passwort eingeben.";
      $("#deletePassword")?.focus();
      return;
    }
    if (confirmation !== "VEREIN LÖSCHEN") {
      if (errorBox) errorBox.textContent = 'Bitte exakt „VEREIN LÖSCHEN“ eingeben.';
      $("#deleteConfirmation")?.focus();
      return;
    }

    if (!confirm("Letzte Bestätigung: Verein, Mitglieder, Beiträge, Finanzen, Belege, Logo und dein VEREINSANKER-Konto werden unwiderruflich gelöscht.")) return;

    button.disabled = true;
    button.textContent = "Wird endgültig gelöscht …";
    if (errorBox) errorBox.textContent = "";

    const { data, error } = await sb.functions.invoke("delete-account", {
      body: { password, confirmation }
    });

    if (error) {
      let payload = null;
      try {
        if (error.context && typeof error.context.json === "function") payload = await error.context.json();
      } catch {}

      const code = payload?.error || "";
      if (code === "INVALID_PASSWORD") {
        if (errorBox) errorBox.textContent = "Das aktuelle Passwort stimmt nicht.";
      } else if (code === "ACTIVE_SUBSCRIPTION") {
        if (errorBox) errorBox.textContent = "Das Abo verlängert sich noch. Bitte zuerst im Stripe-Kundenbereich kündigen.";
        if (deleteBlockedBox) deleteBlockedBox.hidden = false;
        if (prepareDeleteButton) prepareDeleteButton.hidden = true;
        if (deletePanel) deletePanel.hidden = true;
      } else {
        if (errorBox) errorBox.textContent = "Die Löschung konnte nicht vollständig abgeschlossen werden. Bitte erneut versuchen.";
        console.error("Kontolöschung:", error, payload);
      }

      button.disabled = false;
      button.textContent = "Verein & Konto endgültig löschen";
      return;
    }

    if (!data?.deleted) {
      if (errorBox) errorBox.textContent = "Die Löschung wurde nicht bestätigt. Bitte erneut versuchen.";
      button.disabled = false;
      button.textContent = "Verein & Konto endgültig löschen";
      return;
    }

    try { await sb.auth.signOut({ scope: "local" }); } catch {}
    location.replace("konto-geloescht.html");
  });

  $("#settingsForm").addEventListener("submit", async e => {
    e.preventDefault();
    const button = $("button[type='submit']", e.currentTarget);
    const clubIban = normalizeIbanValue($("#settingsIban").value);
    const creditorId = normalizeCreditorIdValue($("#settingsCreditor").value);

    if (clubIban && !isValidIbanValue(clubIban)) {
      $("#settingsIban").focus();
      showToast("Die Vereins-IBAN ist ungültig. Bitte IBAN prüfen.");
      return;
    }

    if (creditorId && !isValidCreditorIdValue(creditorId)) {
      $("#settingsCreditor").focus();
      showToast("Die Gläubiger-ID ist ungültig. Eine deutsche Gläubiger-ID hat 18 Stellen und eine gültige Prüfziffer.");
      return;
    }

    button.disabled = true;
    button.textContent = "Wird gespeichert …";

    const { data, error } = await sb.from("clubs").update({
      name: $("#settingsClub").value.trim(),
      short_name: $("#settingsShort").value.trim().toUpperCase(),
      color: $(".color-choice.active")?.dataset.color || club.color,
      creditor_id: creditorId || null,
      iban: clubIban || null,
      standard_fee: Number($("#settingsFee").value || 0),
      due_date: $("#settingsDue").value || null,
      updated_at: new Date().toISOString()
    }).eq("id", club.id).select().single();

    button.disabled = false;
    button.textContent = "Änderungen speichern";
    if (error) {
      await handleAppError(error, "Einstellungen konnten nicht gespeichert werden.");
      return;
    }
    club = data;
    vaClub = data;
    applyClubBrand(data);
    updateLogoControls();
    showToast("Einstellungen gespeichert ✓");
  });
}



const VA_PAYMENT_LINKS = {
  monthly: "https://buy.stripe.com/aFa3cx643dWg9sPh1res001",
  yearly: "https://buy.stripe.com/5kQ7sNakj6tO34r6mNes002"
};

const VA_PORTAL_LOGIN_URL = "https://billing.stripe.com/p/login/28EbJ3dwv9G0fRd6mNes000";

async function initBilling() {
  const club = await getClub();
  if (!club) return location.replace("onboarding.html");
  applyClubBrand(club);
  applyTrialUI(club);

  const choiceWrap = $(".billing-choice-wrap");
  const billingNote = $(".billing-note");

  if (hasPaidAccess(club) || club.subscription_status === "payment_failed") {
    if (choiceWrap) choiceWrap.hidden = true;

    const current = document.createElement("section");
    current.className = "billing-current-card";

    if (club.subscription_status === "payment_failed") {
      current.innerHTML = '<span class="billing-state bad">Zahlung fehlgeschlagen</span><h2>Zahlungsart aktualisieren</h2><p>Öffne den sicheren Stripe-Kundenbereich. Sobald Stripe die Zahlung bestätigt, wird VEREINSANKER automatisch wieder freigeschaltet.</p><a href="' + esc(portalUrl()) + '" target="_blank" rel="noopener">Stripe-Kundenbereich öffnen →</a>';
    } else if (club.stripe_cancel_at_period_end) {
      current.innerHTML = '<span class="billing-state warning">Kündigung vorgemerkt</span><h2>Zugang bleibt aktiv</h2><p>Das Abo läuft noch bis ' + esc(formatBillingDate(club.stripe_current_period_end) || "zum Laufzeitende") + '. Im Stripe-Kundenbereich kannst du Zahlungsart, Rechnungen und Kündigung verwalten.</p><a href="' + esc(portalUrl()) + '" target="_blank" rel="noopener">Abo verwalten →</a>';
    } else {
      current.innerHTML = '<span class="billing-state good">Abo aktiv</span><h2>' + (club.subscription_status === "active_yearly" ? "79 € / Jahr" : "7,90 € / Monat") + '</h2><p>VEREINSANKER ist freigeschaltet. Zahlungsart, Rechnungen und Kündigung verwaltest du sicher bei Stripe.</p><a href="' + esc(portalUrl()) + '" target="_blank" rel="noopener">Abo verwalten →</a>';
    }

    if (billingNote) billingNote.before(current);
    return;
  }

  $$("[data-checkout]").forEach(button => button.addEventListener("click", () => {
    if (hasPaidAccess(club)) {
      location.href = portalUrl();
      return;
    }

    const plan = button.dataset.checkout;
    const base = VA_PAYMENT_LINKS[plan];
    if (!base) return;

    const url = new URL(base);
    url.searchParams.set("client_reference_id", club.id);
    if (vaSession?.user?.email) url.searchParams.set("locked_prefilled_email", vaSession.user.email);
    url.searchParams.set("utm_source", "vereinsanker_app");
    url.searchParams.set("utm_medium", "upgrade");
    url.searchParams.set("utm_campaign", plan);

    button.disabled = true;
    button.textContent = "Stripe wird geöffnet …";
    location.href = url.toString();
  }));
}

async function initBillingSuccess() {
  const club = await getClub();
  if (!club) return location.replace("onboarding.html");

  const title = $("#billingSuccessTitle");
  const text = $("#billingSuccessText");
  const note = $("#billingSuccessNote");
  const icon = $("#billingSuccessIcon");

  const showState = (current) => {
    if (hasPaidAccess(current)) {
      if (icon) icon.textContent = "✓";
      if (title) title.textContent = "VEREINSANKER ist freigeschaltet";
      if (text) text.textContent = current.subscription_status === "active_yearly"
        ? "Dein Jahresabo ist aktiv."
        : "Dein Monatsabo ist aktiv.";
      if (note) note.textContent = "Die Zahlung wurde von Stripe bestätigt.";
      return true;
    }

    if (current.subscription_status === "payment_failed") {
      if (icon) icon.textContent = "!";
      if (title) title.textContent = "Zahlung konnte nicht abgeschlossen werden";
      if (text) text.textContent = "Bitte prüfe deine Zahlungsart im Stripe-Kundenbereich.";
      if (note) note.textContent = "VEREINSANKER wird nach erfolgreicher Zahlung automatisch freigeschaltet.";
      return true;
    }

    return false;
  };

  if (showState(club)) return;

  if (title) title.textContent = "Zahlung wird bestätigt …";
  if (text) text.textContent = "Stripe meldet die Zahlung gerade an VEREINSANKER zurück.";

  for (let i = 0; i < 8; i++) {
    await new Promise(resolve => setTimeout(resolve, 1250));
    const fresh = await getClub();
    if (fresh && showState(fresh)) return;
  }

  if (title) title.textContent = "Zahlung wird noch verarbeitet";
  if (text) text.textContent = "Das kann je nach Zahlungsart etwas länger dauern. Du musst nichts erneut bezahlen.";
  if (note) note.textContent = "Sobald Stripe die Zahlung bestätigt, wird der Zugang automatisch freigeschaltet.";
}

function setupMobileNavigation() {
  if (!$(".app-shell") || $(".mobile-bottom-nav")) return;
  const page = location.pathname.split("/").pop() || "app.html";
  const items = [
    ["app.html", "⌂", "Übersicht"],
    ["members.html", "♙", "Mitglieder"],
    ["joins.html", "✦", "Beitritte"],
    ["contributions.html", "€", "Beiträge"],
    ["finances.html", "€", "Finanzen"],
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
  const doLogout = async button => {
    if (button) {
      button.disabled = true;
      button.textContent = "Wird abgemeldet …";
    }

    const { error } = await sb.auth.signOut();
    if (error) {
      if (button) {
        button.disabled = false;
        button.textContent = "Abmelden";
      }
      await handleAppError(error, "Abmelden konnte nicht abgeschlossen werden.");
      return;
    }

    location.replace("login.html");
  };

  const sideBottom = $(".side-bottom");
  if (sideBottom) {
    sideBottom.innerHTML = '<div id="trialStatusSide" class="trial-side-status"><strong>Test wird geladen …</strong></div><a id="billingSideAction" class="billing-side-action" href="billing.html">Tarif wählen →</a><div class="legal-side-links"><a href="impressum.html">Impressum</a><a href="datenschutz.html">Datenschutz</a><a href="av-vertrag.html">AV-Vertrag</a></div><button class="logout-button" id="logoutButton" type="button">Abmelden</button>';
    $("#logoutButton")?.addEventListener("click", e => doLogout(e.currentTarget));
  }

  $("#mobileLogoutButton")?.addEventListener("click", e => doLogout(e.currentTarget));
}

(async function boot() {
  setupNetworkStatus();
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

    if ($("#avvAcceptPage")) {
      await initAvvAccept();
      finishAppLoad();
      return;
    }

    if ($("#finishSetup")) {
      await initOnboarding();
      finishAppLoad();
      return;
    }

    const guardedClub = await getClub();
    if (!guardedClub) {
      location.replace("onboarding.html");
      return;
    }
    if (!hasCurrentAvv(guardedClub)) {
      location.replace("avv-accept.html");
      return;
    }

    setupLogout();
    setupMobileNavigation();

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
    if ($("#joinsPage")) {
      if (typeof window.initJoinsPage !== "function") throw new Error("Beitrittsmodul konnte nicht geladen werden.");
      await window.initJoinsPage();
      finishAppLoad();
      return;
    }
    if ($("#contributionsPage")) {
      await initContributions();
      finishAppLoad();
      return;
    }
    if ($("#financesPage")) {
      if (typeof window.initFinancesPage !== "function") throw new Error("Finanzmodul konnte nicht geladen werden.");
      await window.initFinancesPage();
      finishAppLoad();
      return;
    }
    if ($("#settingsForm")) {
      await initSettings();
      finishAppLoad();
      return;
    }
    if ($("#billingPage")) {
      await initBilling();
      finishAppLoad();
      return;
    }
    if ($("#billingSuccessPage")) {
      await initBillingSuccess();
      finishAppLoad();
      return;
    }
  } catch (error) {
    finishAppLoad();
    const type = await handleAppError(error, "Daten konnten nicht geladen werden.");
    if (type !== "session") {
      showPageLoadError(type === "network"
        ? "Keine Verbindung zum Server. Sobald du wieder online bist, lädt die Seite automatisch neu."
        : "Bitte erneut versuchen. Wenn der Fehler bleibt, Seite neu laden.");
    }
  }
})();
