let vaImportState = null;

function normalizeHeader(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9]/g, "");
}

function parseDateValue(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === "number" && window.XLSX?.SSF?.parse_date_code) {
    const d = XLSX.SSF.parse_date_code(value);
    if (d) return [d.y, String(d.m).padStart(2, "0"), String(d.d).padStart(2, "0")].join("-");
  }
  const raw = String(value).trim();
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return iso[1] + "-" + iso[2].padStart(2, "0") + "-" + iso[3].padStart(2, "0");
  const de = raw.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/);
  if (de) return de[3] + "-" + de[2].padStart(2, "0") + "-" + de[1].padStart(2, "0");
  return null;
}

function autoMapColumns(columns) {
  const map = {};
  const aliases = {
    first_name: ["vorname", "firstname", "first"],
    last_name: ["nachname", "lastname", "surname", "familienname"],
    full_name: ["name", "mitglied", "vollstaendigername", "fullname"],
    group_name: ["gruppe", "abteilung", "mannschaft", "team", "bereich"],
    email: ["email", "emailadresse", "mail"],
    iban: ["iban", "kontoiban"],
    annual_fee: ["beitrag", "jahresbeitrag", "mitgliedsbeitrag", "betrag"],
    member_number: ["mitgliedsnummer", "mitgliednr", "nummer", "membernumber"],
    mandate_reference: ["mandatsreferenz", "mandat", "mandate", "mandatref"],
    mandate_signed_at: ["mandatsdatum", "mandatdatum", "unterschriftsdatum", "mandatesigned"]
  };

  for (const [field, names] of Object.entries(aliases)) {
    const found = columns.find(col => names.includes(normalizeHeader(col)));
    if (found) map[field] = found;
  }
  return map;
}

function splitFullName(value) {
  const parts = String(value || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { first_name: parts[0] || "", last_name: "" };
  return { first_name: parts.slice(0, -1).join(" "), last_name: parts.at(-1) };
}

function parseFee(value, fallback = 0) {
  if (typeof value === "number") return Math.max(0, value);
  const raw = String(value ?? "").trim();
  const normalized = raw.includes(",")
    ? raw.replace(/\./g, "").replace(",", ".").replace(/[^0-9.-]/g, "")
    : raw.replace(/[^0-9.-]/g, "");
  const n = Number(normalized);
  return Number.isFinite(n) ? Math.max(0, n) : Number(fallback || 0);
}

function mapImportRow(row, mapping, fallbackFee) {
  let first = mapping.first_name ? String(row[mapping.first_name] || "").trim() : "";
  let last = mapping.last_name ? String(row[mapping.last_name] || "").trim() : "";
  if ((!first || !last) && mapping.full_name) {
    const split = splitFullName(row[mapping.full_name]);
    first ||= split.first_name;
    last ||= split.last_name;
  }
  return {
    first_name: first,
    last_name: last,
    group_name: mapping.group_name ? String(row[mapping.group_name] || "").trim() || null : null,
    email: mapping.email ? String(row[mapping.email] || "").trim() || null : null,
    iban: mapping.iban ? String(row[mapping.iban] || "").replace(/\s+/g, "").toUpperCase() || null : null,
    annual_fee: mapping.annual_fee ? parseFee(row[mapping.annual_fee], fallbackFee) : Number(fallbackFee || 0),
    member_number: mapping.member_number ? String(row[mapping.member_number] || "").trim() || null : null,
    mandate_reference: mapping.mandate_reference ? String(row[mapping.mandate_reference] || "").trim() || null : null,
    mandate_signed_at: mapping.mandate_signed_at ? parseDateValue(row[mapping.mandate_signed_at]) : null
  };
}

function importMappingHtml(columns, mapping) {
  const fields = [
    ["first_name", "Vorname", true],
    ["last_name", "Nachname", true],
    ["full_name", "Name komplett", false],
    ["group_name", "Gruppe / Abteilung", false],
    ["email", "E-Mail", false],
    ["iban", "IBAN", false],
    ["annual_fee", "Jahresbeitrag", false],
    ["member_number", "Mitgliedsnummer", false],
    ["mandate_reference", "Mandatsreferenz", false],
    ["mandate_signed_at", "Mandatsdatum", false]
  ];
  const opts = col => '<option value="' + esc(col) + '">' + esc(col) + '</option>';
  return '<div class="mapping-grid">' + fields.map(([key, label, required]) => {
    const selected = mapping[key] || "";
    const options = ['<option value="">— nicht übernehmen —</option>'].concat(columns.map(opts)).join("");
    const select = options.replace('value="' + esc(selected) + '"', 'value="' + esc(selected) + '" selected');
    return '<label><span>' + label + (required ? ' *' : '') + '</span><select data-map="' + key + '">' + select + '</select></label>';
  }).join("") + '</div><p class="mapping-note">Für Namen reicht entweder Vorname + Nachname oder „Name komplett“.</p>';
}

function importPreviewHtml(rows, mapping, fallbackFee) {
  const mapped = rows.slice(0, 4).map(row => mapImportRow(row, mapping, fallbackFee));
  if (!mapped.length) return "";
  return '<strong>Vorschau</strong><div class="preview-table">' + mapped.map(m =>
    '<div><span>' + esc(memberFullName(m)) + '</span><small>' + esc(m.group_name || "Ohne Gruppe") + ' · ' + esc(money(m.annual_fee)) + '</small></div>'
  ).join("") + '</div>';
}

async function importPreparedMembers(rows, mapping, club) {
  const existing = await loadMembers();
  const existingKeys = new Set(existing.flatMap(m => [
    m.member_number ? "n:" + String(m.member_number).toLowerCase() : null,
    m.email ? "e:" + m.email.toLowerCase() : null,
    "x:" + (memberFullName(m) + "|" + (m.group_name || "")).toLowerCase()
  ].filter(Boolean)));

  const prepared = [];
  let autoNumber = 1001 + existing.length;

  for (const row of rows) {
    const m = mapImportRow(row, mapping, club.standard_fee);
    if (!m.first_name || !m.last_name) continue;
    if (!m.member_number) m.member_number = String(autoNumber++);
    const keys = [
      m.member_number ? "n:" + m.member_number.toLowerCase() : null,
      m.email ? "e:" + m.email.toLowerCase() : null,
      "x:" + (memberFullName(m) + "|" + (m.group_name || "")).toLowerCase()
    ].filter(Boolean);
    if (keys.some(k => existingKeys.has(k))) continue;
    keys.forEach(k => existingKeys.add(k));
    prepared.push({ ...m, club_id: club.id, active: true, updated_at: new Date().toISOString() });
  }

  if (!prepared.length) return { inserted: 0, skipped: rows.length };

  const { data: created, error } = await sb.from("members").insert(prepared).select();
  if (error) throw error;

  const dueDate = club.due_date ? currentYear + club.due_date.slice(4) : currentYear + "-03-01";
  const contributionRows = created.map(m => ({
    club_id: club.id,
    member_id: m.id,
    contribution_year: currentYear,
    amount: Number(m.annual_fee || 0),
    due_date: dueDate,
    status: "open"
  }));
  if (contributionRows.length) {
    const { error: contributionError } = await sb.from("contributions").insert(contributionRows);
    if (contributionError) throw contributionError;
  }
  return { inserted: created.length, skipped: rows.length - created.length };
}
window.importPreparedMembers = importPreparedMembers;

async function readImportFile(file) {
  if (!window.XLSX) throw new Error("Excel-Import ist noch nicht geladen.");
  const data = await file.arrayBuffer();
  const wb = XLSX.read(data, { type: "array", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: "", raw: true });
  if (!rows.length) throw new Error("Die Datei enthält keine Daten.");
  const columns = Object.keys(rows[0]);
  return { file, rows, columns, mapping: autoMapColumns(columns) };
}

async function enhanceMemberPage() {
  const fileInput = $("#memberImport");
  const importSheet = $("#importSheet");
  const mappingBox = $("#importMapping");
  const preview = $("#importPreview");
  const runImport = $("#runImport");
  const importHint = $("#importHint");

  $("#exportMembers")?.addEventListener("click", async () => {
    const members = await loadMembers();
    const lines = [
      ["Mitgliedsnummer","Vorname","Nachname","Gruppe","E-Mail","IBAN","Jahresbeitrag","Mandatsreferenz","Mandatsdatum"],
      ...members.map(m => [m.member_number||"",m.first_name,m.last_name,m.group_name||"",m.email||"",m.iban||"",m.annual_fee||0,m.mandate_reference||"",m.mandate_signed_at||""])
    ];
    const csv = lines.map(row => row.map(v => '"' + String(v).replace(/"/g,'""') + '"').join(";")).join("\r\n");
    downloadBlob("\uFEFF" + csv, "VEREINSANKER_Mitglieder.csv", "text/csv;charset=utf-8");
  });

  fileInput?.addEventListener("change", async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      vaImportState = await readImportFile(file);
      mappingBox.innerHTML = importMappingHtml(vaImportState.columns, vaImportState.mapping);
      preview.innerHTML = importPreviewHtml(vaImportState.rows, vaImportState.mapping, vaClub?.standard_fee || 0);
      importHint.textContent = vaImportState.rows.length + " Zeilen erkannt · Duplikate werden automatisch übersprungen.";
      runImport.disabled = false;
      openBackdrop(importSheet);

      $$("[data-map]", mappingBox).forEach(select => select.addEventListener("change", () => {
        vaImportState.mapping[select.dataset.map] = select.value || null;
        preview.innerHTML = importPreviewHtml(vaImportState.rows, vaImportState.mapping, vaClub?.standard_fee || 0);
      }));
    } catch (error) {
      showToast(error.message || "Datei konnte nicht gelesen werden");
    } finally {
      e.target.value = "";
    }
  });

  $("#closeImport")?.addEventListener("click", () => closeBackdrop(importSheet));
  importSheet?.addEventListener("click", e => { if (e.target === importSheet) closeBackdrop(importSheet); });

  runImport?.addEventListener("click", async () => {
    if (!vaImportState) return;
    const m = vaImportState.mapping;
    if (!(m.full_name || (m.first_name && m.last_name))) {
      showToast("Bitte Namen-Spalten zuordnen");
      return;
    }
    runImport.disabled = true;
    runImport.textContent = "Wird importiert …";
    try {
      const club = vaClub || await getClub();
      const result = await importPreparedMembers(vaImportState.rows, vaImportState.mapping, club);
      closeBackdrop(importSheet);
      showToast(result.inserted + " Mitglieder importiert ✓");
      setTimeout(() => location.reload(), 650);
    } catch (error) {
      console.error(error);
      showToast("Import fehlgeschlagen");
      runImport.disabled = false;
      runImport.textContent = "Mitglieder importieren";
    }
  });

  const memberSheet = $("#memberSheet");
  const editSheet = $("#editMemberSheet");

  $("#memberRows")?.addEventListener("click", async e => {
    const row = e.target.closest(".members-row");
    if (!row) return;
    memberSheet.dataset.memberId = row.dataset.memberId || "";
    const { data } = await sb.from("members").select("*").eq("id", row.dataset.memberId).maybeSingle();
    if (!data) return;
    $("#detailMandate").textContent = data.mandate_reference || "–";
    $("#detailMandateDate").textContent = data.mandate_signed_at ? new Date(data.mandate_signed_at + "T00:00:00").toLocaleDateString("de-DE") : "–";
  });

  $("#editMemberBtn")?.addEventListener("click", async () => {
    const id = memberSheet.dataset.memberId;
    if (!id) return;
    const { data, error } = await sb.from("members").select("*").eq("id", id).single();
    if (error) return showToast("Mitglied konnte nicht geladen werden");
    $("#editMemberId").value = data.id;
    $("#editMemberTitle").textContent = memberFullName(data);
    $("#editFirstName").value = data.first_name || "";
    $("#editLastName").value = data.last_name || "";
    $("#editMemberGroup").value = data.group_name || "";
    $("#editMemberEmail").value = data.email || "";
    $("#editMemberFee").value = Number(data.annual_fee || 0);
    $("#editMemberIban").value = data.iban || "";
    $("#editMemberMandate").value = data.mandate_reference || "";
    $("#editMemberMandateDate").value = data.mandate_signed_at || "";
    closeBackdrop(memberSheet);
    openBackdrop(editSheet);
  });

  $("#closeEditMember")?.addEventListener("click", () => closeBackdrop(editSheet));
  editSheet?.addEventListener("click", e => { if (e.target === editSheet) closeBackdrop(editSheet); });

  $("#editMemberForm")?.addEventListener("submit", async e => {
    e.preventDefault();
    const id = $("#editMemberId").value;
    const amount = Number($("#editMemberFee").value || 0);
    const editIban = normalizeIban($("#editMemberIban").value);
    if (editIban && !validIban(editIban)) {
      $("#editMemberIban").focus();
      showToast("Die IBAN des Mitglieds ist ungültig. Bitte Eingabe prüfen.");
      return;
    }
    const payload = {
      first_name: $("#editFirstName").value.trim(),
      last_name: $("#editLastName").value.trim(),
      group_name: $("#editMemberGroup").value.trim() || null,
      email: $("#editMemberEmail").value.trim() || null,
      annual_fee: amount,
      iban: editIban || null,
      mandate_reference: $("#editMemberMandate").value.trim() || null,
      mandate_signed_at: $("#editMemberMandateDate").value || null,
      updated_at: new Date().toISOString()
    };
    const { error } = await sb.from("members").update(payload).eq("id", id);
    if (error) return showToast("Änderung konnte nicht gespeichert werden");
    await sb.from("contributions").update({ amount, updated_at: new Date().toISOString() }).eq("member_id", id).eq("contribution_year", currentYear).neq("status", "paid");
    showToast("Mitglied aktualisiert ✓");
    closeBackdrop(editSheet);
    setTimeout(() => location.reload(), 500);
  });

  $("#deleteMemberBtn")?.addEventListener("click", async () => {
    const id = memberSheet.dataset.memberId;
    if (!id || !confirm("Mitglied aus der aktiven Mitgliederliste entfernen? Vergangene Beitragsdaten bleiben erhalten.")) return;
    const { error } = await sb.from("members").update({ active: false, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) return showToast("Mitglied konnte nicht entfernt werden");
    await sb.from("contributions").delete().eq("member_id", id).eq("contribution_year", currentYear).neq("status", "paid");
    closeBackdrop(memberSheet);
    showToast("Mitglied entfernt ✓");
    setTimeout(() => location.reload(), 500);
  });
}

function normalizeIban(value) {
  return String(value || "").replace(/\s+/g, "").toUpperCase();
}

function validIban(value) {
  const iban = normalizeIban(value);
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0,4);
  let remainder = 0;
  for (const ch of rearranged) {
    const part = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const digit of part) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

function xmlEscape(value) {
  return String(value ?? "").replace(/[<>&'"]/g, ch => ({
    "<":"&lt;", ">":"&gt;", "&":"&amp;", "'":"&apos;", '"':"&quot;"
  }[ch]));
}

function safeSepaText(value, max = 70) {
  return String(value || "")
    .replace(/Ä/g,"Ae").replace(/Ö/g,"Oe").replace(/Ü/g,"Ue")
    .replace(/ä/g,"ae").replace(/ö/g,"oe").replace(/ü/g,"ue").replace(/ß/g,"ss")
    .replace(/[^A-Za-z0-9 .,'+?/:()\-]/g, " ")
    .replace(/\s+/g, " ").trim().slice(0, max);
}

function compactId(value, max = 35) {
  return String(value || "").replace(/[^A-Za-z0-9+?/:().,'\-]/g, "-").slice(0, max);
}

function downloadBlob(content, filename, type = "application/octet-stream") {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function buildSepaXml(club, rows, collectionDate) {
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const msgId = compactId("VA-" + stamp);
  const pmtId = compactId("VA-DD-" + currentYear + "-" + stamp.slice(-6));
  const total = rows.reduce((sum, c) => sum + Number(c.amount || 0), 0).toFixed(2);
  const creditorIban = normalizeIban(club.iban);
  const creditorName = safeSepaText(club.name, 70);

  const txs = rows.map((c, index) => {
    const m = c.members || {};
    const endToEnd = compactId("VA-" + (m.member_number || String(index + 1)) + "-" + currentYear);
    return `<DrctDbtTxInf>
< PmtId><EndToEndId>${xmlEscape(endToEnd)}</EndToEndId></PmtId>
<InstdAmt Ccy="EUR">${Number(c.amount || 0).toFixed(2)}</InstdAmt>
<DrctDbtTx><MndtRltdInf><MndtId>${xmlEscape(safeSepaText(m.mandate_reference, 35))}</MndtId><DtOfSgntr>${xmlEscape(m.mandate_signed_at)}</DtOfSgntr></MndtRltdInf></DrctDbtTx>
<DbtrAgt><FinInstnId><Othr><Id>NOTPROVIDED</Id></Othr></FinInstnId></DbtrAgt>
<Dbtr><Nm>${xmlEscape(safeSepaText(memberFullName(m), 70))}</Nm></Dbtr>
<DbtrAcct><Id><IBAN>${xmlEscape(normalizeIban(m.iban))}</IBAN></Id></DbtrAcct>
<RmtInf><Ustrd>${xmlEscape(safeSepaText("Mitgliedsbeitrag " + currentYear, 140))}</Ustrd></RmtInf>
</DrctDbtTx>`.replace("< PmtId>", "<PmtId>");
  }).join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.008.001.08" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<CstmrDrctDbtInitn>
<GrpHdr><MsgId>${xmlEscape(msgId)}</MsgId><CreDtTm>${now.toISOString()}</CreDtTm><NbOfTxs>${rows.length}</NbOfTxs><CtrlSum>${total}</CtrlSum><InitgPty><Nm>${xmlEscape(creditorName)}</Nm></InitgPty></GrpHdr>
<PmtInf>
<PmtInfId>${xmlEscape(pmtId)}</PmtInfId><PmtMtd>DD</PmtMtd><NbOfTxs>${rows.length}</NbOfTxs><CtrlSum>${total}</CtrlSum>
<PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl><LclInstrm><Cd>CORE</Cd></LclInstrm><SeqTp>RCUR</SeqTp></PmtTpInf>
<ReqdColltnDt>${xmlEscape(collectionDate)}</ReqdColltnDt>
<Cdtr><Nm>${xmlEscape(creditorName)}</Nm></Cdtr>
<CdtrAcct><Id><IBAN>${xmlEscape(creditorIban)}</IBAN></Id></CdtrAcct>
<CdtrAgt><FinInstnId><Othr><Id>NOTPROVIDED</Id></Othr></FinInstnId></CdtrAgt>
<ChrgBr>SLEV</ChrgBr>
<CdtrSchmeId><Id><PrvtId><Othr><Id>${xmlEscape(safeSepaText(club.creditor_id, 35))}</Id><SchmeNm><Prtry>SEPA</Prtry></SchmeNm></Othr></PrvtId></Id></CdtrSchmeId>
${txs}
</PmtInf>
</CstmrDrctDbtInitn>
</Document>`;
}

function friendlyReminder(c) {
  const m = c.members || {};
  const due = c.due_date ? new Date(c.due_date + "T00:00:00").toLocaleDateString("de-DE") : "";
  return `Hallo ${memberFullName(m)},

bei unserem Mitgliedsbeitrag für ${currentYear} ist noch ein Betrag von ${money(c.amount)} offen${due ? ", fällig seit " + due : ""}.

Falls die Zahlung bereits unterwegs ist, kannst du diese Nachricht einfach ignorieren.

Viele Grüße
${vaClub?.name || "Euer Verein"}`;
}

async function enhanceContributionPage() {
  const club = vaClub || await getClub();
  const [members, contributions] = await Promise.all([loadMembers(), loadContributions()]);
  const existingIds = new Set(contributions.map(c => c.member_id));
  const missing = members.filter(m => !existingIds.has(m.id));

  if (missing.length) {
    $("#yearSetup").hidden = false;
    $("#yearSetupText").textContent = missing.length + " aktive Mitglieder haben noch keinen Beitrag für " + currentYear + ".";
  } else {
    $("#yearSetup").hidden = true;
  }

  $("#createYearContributions")?.addEventListener("click", async () => {
    const btn = $("#createYearContributions");
    btn.disabled = true;
    btn.textContent = "Wird angelegt …";
    const dueDate = club.due_date ? currentYear + club.due_date.slice(4) : currentYear + "-03-01";
    const rows = missing.map(m => ({
      club_id: club.id, member_id: m.id, contribution_year: currentYear,
      amount: Number(m.annual_fee || club.standard_fee || 0), due_date: dueDate, status: "open"
    }));
    const { error } = rows.length ? await sb.from("contributions").insert(rows) : { error: null };
    if (error) {
      showToast("Beiträge konnten nicht angelegt werden");
      btn.disabled = false;
      btn.textContent = "Fehlende Beiträge anlegen";
      return;
    }
    showToast(rows.length + " Beiträge angelegt ✓");
    setTimeout(() => location.reload(), 500);
  });

  const date = $("#collectionDate");
  if (date && !date.value) {
    const d = new Date();
    d.setDate(d.getDate() + 5);
    date.value = d.toISOString().slice(0, 10);
  }

  $("#prepareSepa")?.addEventListener("click", async () => {
    const currentClub = await getClub();
    const all = await loadContributions();
    const ready = all.filter(c => {
      const m = c.members || {};
      return c.status !== "paid" && validIban(m.iban) && m.mandate_reference && m.mandate_signed_at;
    });
    const collectionDate = $("#collectionDate")?.value;
    const openRows = all.filter(c => c.status !== "paid");

    if (!openRows.length) return showToast("Aktuell nichts einzuziehen: Alle Beiträge sind bereits bezahlt.");
    if (!currentClub.creditor_id) return showToast("Gläubiger-ID fehlt. Bitte in Einstellungen → SEPA eintragen.");
    if (!currentClub.iban) return showToast("Vereins-IBAN fehlt. Bitte in Einstellungen → SEPA eintragen.");
    if (!validIban(currentClub.iban)) return showToast("Die gespeicherte Vereins-IBAN ist ungültig. Bitte in Einstellungen → SEPA korrigieren.");
    if (!collectionDate) return showToast("Bitte Einzugsdatum wählen");
    if (collectionDate < new Date().toISOString().slice(0,10)) return showToast("Einzugsdatum darf nicht in der Vergangenheit liegen");
    if (!ready.length) return showToast("Kein offener Beitrag mit vollständigem SEPA-Mandat");

    const xml = buildSepaXml(currentClub, ready, collectionDate);
    downloadBlob(xml, "VEREINSANKER_SEPA_" + collectionDate + ".xml", "application/xml;charset=utf-8");
    showToast("SEPA-XML erstellt ✓");
  });

  const reminderSheet = $("#reminderSheet");
  $("#closeReminder")?.addEventListener("click", () => closeBackdrop(reminderSheet));
  reminderSheet?.addEventListener("click", e => { if (e.target === reminderSheet) closeBackdrop(reminderSheet); });

  $("#openContributions")?.addEventListener("click", async e => {
    const button = e.target.closest(".tiny-action");
    if (!button) return;
    const buttons = $$(".tiny-action", $("#openContributions"));
    const index = buttons.indexOf(button);
    const openRows = (await loadContributions()).filter(c => c.status !== "paid");
    const contribution = openRows[index];
    if (!contribution) return;

    const m = contribution.members || {};
    const text = friendlyReminder(contribution);
    $("#reminderText").value = text;
    $("#reminderTitle").textContent = memberFullName(m) + " erinnern";
    $("#mailReminder").href = m.email
      ? "mailto:" + encodeURIComponent(m.email) + "?subject=" + encodeURIComponent("Mitgliedsbeitrag " + currentYear) + "&body=" + encodeURIComponent(text)
      : "#";
    $("#mailReminder").classList.toggle("disabled-link", !m.email);
    openBackdrop(reminderSheet);
  });

  $("#copyReminder")?.addEventListener("click", async () => {
    await navigator.clipboard.writeText($("#reminderText").value);
    showToast("Text kopiert ✓");
  });

  $("#mailReminder")?.addEventListener("click", e => {
    if (e.currentTarget.classList.contains("disabled-link")) {
      e.preventDefault();
      showToast("Für dieses Mitglied ist keine E-Mail hinterlegt");
    }
  });

  $("#remindAll")?.addEventListener("click", async () => {
    const openRows = (await loadContributions()).filter(c => c.status !== "paid");
    if (!openRows.length) return showToast("Keine offenen Beiträge");
    const csvRows = [["Name","E-Mail","Betrag","Fälligkeit","Erinnerung"], ...openRows.map(c => {
      const m = c.members || {};
      return [memberFullName(m),m.email||"",Number(c.amount||0).toFixed(2),c.due_date||"",friendlyReminder(c)];
    })];
    const csv = csvRows.map(row => row.map(v => '"' + String(v).replace(/"/g,'""') + '"').join(";")).join("\r\n");
    downloadBlob("\uFEFF" + csv, "VEREINSANKER_Zahlungserinnerungen_" + currentYear + ".csv", "text/csv;charset=utf-8");
    showToast("Erinnerungsliste erstellt ✓");
  });
}

async function enhanceOnboardingImport() {
  const input = $("#memberFile");
  if (!input || !window.XLSX) return;
  input.addEventListener("change", async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const state = await readImportFile(file);
      window.vaOnboardingImportState = state;
      const drop = $(".drop");
      if (drop) {
        const mappingOkay = state.mapping.full_name || (state.mapping.first_name && state.mapping.last_name);
        $("strong", drop).textContent = file.name;
        $("span", drop).textContent = mappingOkay
          ? state.rows.length + " Zeilen erkannt ✓"
          : "Namensspalten nicht sicher erkannt – später im Import zuordnen";
      }
    } catch (error) {
      showToast?.(error.message || "Liste konnte nicht gelesen werden");
    }
  });
}

(async function enhanceVereinsanker() {
  try {
    const needsAuth = $("#membersPage") || $("#contributionsPage") || $("#memberFile");
    if (needsAuth) {
      const session = await requireSession();
      if (!session) return;
    }
    if ($("#membersPage")) await enhanceMemberPage();
    if ($("#contributionsPage")) await enhanceContributionPage();
    if ($("#memberFile")) await enhanceOnboardingImport();
  } catch (error) {
    console.error("VEREINSANKER features:", error);
  }
})();