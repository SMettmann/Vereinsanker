let vaImportState = null;

function normalizeHeader(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9]/g, "");
}

function realDateIso(year, month, day) {
  const y = Number(year), m = Number(month), d = Number(day);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
  ) return null;
  return String(y).padStart(4, "0") + "-" + String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0");
}

function parseDateValue(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return realDateIso(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }
  if (typeof value === "number" && window.XLSX?.SSF?.parse_date_code) {
    const d = XLSX.SSF.parse_date_code(value);
    if (d) return realDateIso(d.y, d.m, d.d);
  }
  const raw = String(value).trim();
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return realDateIso(iso[1], iso[2], iso[3]);
  const de = raw.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/);
  if (de) return realDateIso(de[3], de[2], de[1]);
  return null;
}

function autoMapColumns(columns) {
  const map = {};
  const aliases = {
    first_name: ["vorname", "vornamen", "firstname", "first", "rufname"],
    last_name: ["nachname", "lastname", "surname", "familienname", "familiennamegeburtsname"],
    full_name: ["mitglied", "mitgliedname", "vollstaendigername", "vollername", "fullname", "namevorname", "nachnamevorname"],
    group_name: ["gruppe", "abteilung", "mannschaft", "team", "bereich", "sektion", "sparte", "sportart"],
    email: ["email", "emailadresse", "mail", "emailprivat", "emailkontakt", "mailadresse"],
    iban: ["iban", "kontoiban", "bankiban", "kontonummeriban"],
    account_holder: ["kontoinhaber", "kontoinhaberin", "kontoinhabername", "accountowner", "accountholder"],
    annual_fee: ["beitrag", "jahresbeitrag", "mitgliedsbeitrag", "betrag", "beitrageuro", "beitragjahr", "jahresbeitrag2026"],
    member_number: ["mitgliedsnummer", "mitgliednr", "mitgliedsnr", "nummer", "membernumber", "mitgliedid", "mitgliederid"],
    mandate_reference: ["mandatsreferenz", "mandat", "mandate", "mandatref", "sepamandat", "referenz"],
    mandate_signed_at: ["mandatsdatum", "mandatdatum", "unterschriftsdatum", "mandatesigned", "mandatunterschriebenam"],
    contribution_status: ["beitragsstatus", "zahlstatus", "statusbeitrag", "bezahlt", "bezahltstatus", "zahlungstatus"],
    paid_at: ["bezahltam", "zahlungsdatum", "bezahldatum", "zahlungam", "eingangam", "zahlungseingang"],
    birth_date: ["geburtsdatum", "geburtstag", "dateofbirth"],
    phone: ["telefon", "telefonnummer", "handy", "mobil", "mobilnummer", "phone"],
    street: ["strasse", "straße", "anschrift", "street", "strassehausnummer"],
    postal_code: ["plz", "postleitzahl", "zipcode"],
    city: ["ort", "wohnort", "stadt", "city"],
    joined_at: ["eintritt", "eintrittsdatum", "mitgliedseit", "beigetretenam", "joinedat"],
    contribution_label: ["beitragsart", "beitragstyp", "tarif", "bezeichnungbeitrag"]
  };

  for (const [field, names] of Object.entries(aliases)) {
    const found = columns.find(col => names.includes(normalizeHeader(col)));
    if (found) map[field] = found;
  }

  const genericName = columns.find(col => normalizeHeader(col) === "name");
  if (genericName) {
    if (map.first_name && !map.last_name) map.last_name = genericName;
    else if (!map.first_name && !map.last_name && !map.full_name) map.full_name = genericName;
  }

  return map;
}

function splitFullName(value) {
  const raw = String(value || "").trim();
  if (raw.includes(",")) {
    const [last, ...rest] = raw.split(",");
    const first = rest.join(",").trim();
    if (last.trim() && first) return { first_name: first, last_name: last.trim() };
  }
  const parts = raw.split(/\s+/).filter(Boolean);
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

function parseContributionStatus(value) {
  const raw = normalizeHeader(value);
  if (!raw) return null;
  if (["bezahlt","paid","erledigt","ja","yes","ok","x","beglichen","true","1"].includes(raw)) return "paid";
  if (["offen","open","unbezahlt","faellig","fallig","nein","no","false","0"].includes(raw)) return "open";
  if (["keinbeitrag","keiner","none","nichtfaellig","nichtfallig","entfaellt","entfallt"].includes(raw)) return "none";
  return null;
}

function importDateValue(value) {
  return parseDateValue(value);
}

function mapImportRow(row, mapping, fallbackFee) {
  let first = mapping.first_name ? String(row[mapping.first_name] || "").trim() : "";
  let last = mapping.last_name ? String(row[mapping.last_name] || "").trim() : "";
  if ((!first || !last) && mapping.full_name) {
    const split = splitFullName(row[mapping.full_name]);
    first ||= split.first_name;
    last ||= split.last_name;
  }

  const statusRaw = mapping.contribution_status ? String(row[mapping.contribution_status] || "").trim() : "";
  const paidAtRaw = mapping.paid_at ? row[mapping.paid_at] : "";
  const birthRaw = mapping.birth_date ? row[mapping.birth_date] : "";
  const joinedRaw = mapping.joined_at ? row[mapping.joined_at] : "";

  return {
    first_name: first,
    last_name: last,
    group_name: mapping.group_name ? String(row[mapping.group_name] || "").trim() || null : null,
    email: mapping.email ? String(row[mapping.email] || "").trim() || null : null,
    iban: mapping.iban ? String(row[mapping.iban] || "").replace(/\s+/g, "").toUpperCase() || null : null,
    account_holder: mapping.account_holder ? String(row[mapping.account_holder] || "").trim() || null : null,
    annual_fee: mapping.annual_fee ? parseFee(row[mapping.annual_fee], fallbackFee) : Number(fallbackFee || 0),
    member_number: mapping.member_number ? String(row[mapping.member_number] || "").trim() || null : null,
    mandate_reference: mapping.mandate_reference ? String(row[mapping.mandate_reference] || "").trim() || null : null,
    mandate_signed_at: mapping.mandate_signed_at ? parseDateValue(row[mapping.mandate_signed_at]) : null,
    contribution_status: statusRaw ? parseContributionStatus(statusRaw) : null,
    contribution_status_raw: statusRaw || null,
    paid_at: paidAtRaw ? importDateValue(paidAtRaw) : null,
    paid_at_raw: paidAtRaw ? String(paidAtRaw).trim() : null,
    birth_date: birthRaw ? importDateValue(birthRaw) : null,
    birth_date_raw: birthRaw ? String(birthRaw).trim() : null,
    phone: mapping.phone ? String(row[mapping.phone] || "").trim() || null : null,
    street: mapping.street ? String(row[mapping.street] || "").trim() || null : null,
    postal_code: mapping.postal_code ? String(row[mapping.postal_code] || "").trim() || null : null,
    city: mapping.city ? String(row[mapping.city] || "").trim() || null : null,
    joined_at: joinedRaw ? importDateValue(joinedRaw) : null,
    joined_at_raw: joinedRaw ? String(joinedRaw).trim() : null,
    contribution_label: mapping.contribution_label ? String(row[mapping.contribution_label] || "").trim() || null : null
  };
}

function validEmail(value) {
  if (!value) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim());
}

function validateImportedMember(member) {
  const errors = [];
  if (!member.first_name) errors.push("Vorname fehlt");
  if (!member.last_name) errors.push("Nachname fehlt");
  if (member.email && !validEmail(member.email)) errors.push("E-Mail ungültig");
  if (member.iban && !validIban(member.iban)) errors.push("IBAN ungültig");
  if (member.mandate_reference && !isValidSepaReferenceValue(member.mandate_reference)) errors.push("Mandatsreferenz ungültig");
  if (member.mandate_reference && !member.mandate_signed_at) errors.push("Mandatsdatum fehlt/ungültig");
  if (member.mandate_signed_at && !member.mandate_reference) errors.push("Mandatsreferenz fehlt");
  if (member.contribution_status_raw && !member.contribution_status) errors.push("Beitragsstatus unbekannt");
  if (member.paid_at_raw && !member.paid_at) errors.push("Zahlungsdatum ungültig");
  if (member.birth_date_raw && !member.birth_date) errors.push("Geburtsdatum ungültig");
  if (member.joined_at_raw && !member.joined_at) errors.push("Eintrittsdatum ungültig");
  return errors;
}

function importMappingHtml(columns, mapping) {
  const fields = [
    ["first_name", "Vorname", true],
    ["last_name", "Nachname", true],
    ["full_name", "Name komplett", false],
    ["member_number", "Mitgliedsnummer", false],
    ["group_name", "Abteilung / Gruppe", false],
    ["email", "E-Mail", false],
    ["birth_date", "Geburtsdatum", false],
    ["phone", "Telefon", false],
    ["street", "Straße / Anschrift", false],
    ["postal_code", "PLZ", false],
    ["city", "Ort", false],
    ["joined_at", "Eintrittsdatum", false],
    ["annual_fee", "Jahresbeitrag", false],
    ["contribution_label", "Beitragsart", false],
    ["contribution_status", "Beitragsstatus", false],
    ["paid_at", "Bezahlt am", false],
    ["iban", "IBAN", false],
    ["account_holder", "Kontoinhaber/in", false],
    ["mandate_reference", "Mandatsreferenz", false],
    ["mandate_signed_at", "Mandatsdatum", false]
  ];
  const opts = col => '<option value="' + esc(col) + '">' + esc(col) + '</option>';
  return '<div class="mapping-grid">' + fields.map(([key, label, required]) => {
    const selected = mapping[key] || "";
    const options = ['<option value="">— nicht übernehmen —</option>'].concat(columns.map(opts)).join("");
    const select = options.replace('value="' + esc(selected) + '"', 'value="' + esc(selected) + '" selected');
    return '<label><span>' + label + (required ? ' *' : '') + '</span><select data-map="' + key + '">' + select + '</select></label>';
  }).join("") + '</div><p class="mapping-note">Für Namen reicht entweder Vorname + Nachname oder „Name komplett“. Bei „Name“ + „Vorname“ erkennt VEREINSFACH „Name“ automatisch als Nachname.</p>';
}

function importPreviewHtml(rows, mapping, fallbackFee) {
  const mapped = rows.slice(0, 5).map((row, index) => {
    const member = mapImportRow(row, mapping, fallbackFee);
    return { member, errors: validateImportedMember(member), rowNo: index + 2 };
  });
  if (!mapped.length) return "";
  return '<strong>Vorschau</strong><div class="preview-table">' + mapped.map(item => {
    const status = item.member.contribution_status === "paid"
      ? " · bezahlt"
      : item.member.contribution_status === "none"
        ? " · kein Beitrag"
        : item.member.contribution_status === "open"
          ? " · offen"
          : "";
    return '<div class="' + (item.errors.length ? 'preview-error' : '') + '"><span>' +
      esc(memberFullName(item.member)) +
      (item.errors.length ? '<em>Zeile ' + item.rowNo + ': ' + esc(item.errors.join(", ")) + '</em>' : '') +
      '</span><small>' + esc(item.member.group_name || "Nicht zugeordnet") + ' · ' + esc(money(item.member.annual_fee)) + esc(status) + '</small></div>';
  }).join("") + '</div>';
}


function correctionValue(member, key) {
  const value = member?.[key];
  return value == null ? "" : String(value);
}

function renderImportCorrections(items) {
  const box = $("#importCorrections");
  if (!box) return;

  if (!items.length) {
    box.hidden = true;
    box.innerHTML = "";
    return;
  }

  box.hidden = false;
  box.innerHTML =
    '<div class="correction-head"><div><strong>' + items.length + ' Zeile(n) brauchen deine Hilfe</strong><span>Fehler korrigieren oder bei Dubletten bewusst entscheiden.</span></div></div>' +
    '<div class="correction-list">' +
    items.map((item, index) => {
      const m = item.member || {};
      const isDuplicate = item.kind === "duplicate";
      const existing = item.existing_member || null;
      const duplicateInfo = isDuplicate
        ? (existing
          ? '<div class="duplicate-found"><strong>Bereits vorhanden:</strong><span>' +
              esc(memberFullName(existing)) +
              (existing.member_number ? ' · Nr. ' + esc(existing.member_number) : '') +
              (existing.email ? ' · ' + esc(existing.email) : '') +
            '</span></div>'
          : '<div class="duplicate-found"><strong>Dublette erkannt:</strong><span>' +
              (item.duplicate_source === "file"
                ? 'Dieser Datensatz kommt in der Importdatei bereits vor.'
                : 'Mehrere vorhandene Mitglieder passen zu dieser Zeile.') +
            '</span></div>')
        : '';

      const duplicateActions = isDuplicate
        ? '<div class="duplicate-actions">' +
            (item.existing_member_id
              ? '<button type="button" class="duplicate-choice' + (item.resolution === "update" ? ' active' : '') + '" data-duplicate-action="update" data-correction-index="' + index + '">Bestehendes Mitglied aktualisieren</button>'
              : '') +
            '<button type="button" class="duplicate-choice skip' + (item.resolution === "skip" ? ' active' : '') + '" data-duplicate-action="skip" data-correction-index="' + index + '">Überspringen</button>' +
            '<button type="button" class="duplicate-choice create' + (item.resolution === "create" ? ' active' : '') + '" data-duplicate-action="create" data-correction-index="' + index + '">Trotzdem neu anlegen</button>' +
          '</div>' +
          '<p class="duplicate-note">' +
            (item.existing_member_id
              ? 'Beim Aktualisieren werden die Angaben aus dieser Zeile übernommen. Ein noch offener Jahresbeitrag wird auf den neuen Betrag angepasst.'
              : 'Bei „Trotzdem neu anlegen“ wird eine kollidierende Mitgliedsnummer automatisch durch eine freie Nummer ersetzt.') +
          '</p>'
        : '<button type="button" class="correction-skip" data-skip-correction="' + index + '">Zeile überspringen</button>';

      return '<section class="correction-card' + (isDuplicate ? ' duplicate-card' : '') + '" data-correction-index="' + index + '">' +
        '<div class="correction-card-head"><div><strong>Zeile ' + esc(item.row) + ' · ' + esc(memberFullName(m)) + '</strong><span>' + esc((item.reasons || []).join(" · ")) + '</span></div>' +
          (!isDuplicate ? duplicateActions : '') +
        '</div>' +
        duplicateInfo +
        '<div class="correction-grid">' +
          '<label><span>Vorname</span><input data-correct="first_name" value="' + esc(correctionValue(m,"first_name")) + '"></label>' +
          '<label><span>Nachname</span><input data-correct="last_name" value="' + esc(correctionValue(m,"last_name")) + '"></label>' +
          '<label><span>Mitgliedsnummer</span><input data-correct="member_number" value="' + esc(correctionValue(m,"member_number")) + '"></label>' +
          '<label><span>Abteilung / Gruppe</span><input data-correct="group_name" value="' + esc(correctionValue(m,"group_name")) + '"></label>' +
          '<label><span>E-Mail</span><input data-correct="email" value="' + esc(correctionValue(m,"email")) + '"></label>' +
          '<label><span>IBAN</span><input data-correct="iban" value="' + esc(correctionValue(m,"iban")) + '"></label>' +
          '<label><span>Kontoinhaber/in</span><input data-correct="account_holder" value="' + esc(correctionValue(m,"account_holder")) + '"></label>' +
          '<label><span>Jahresbeitrag</span><input data-correct="annual_fee" value="' + esc(correctionValue(m,"annual_fee")) + '"></label>' +
          '<label><span>Beitragsart</span><input data-correct="contribution_label" value="' + esc(correctionValue(m,"contribution_label")) + '"></label>' +
          '<label><span>Beitragsstatus</span><select data-correct="contribution_status"><option value=""' + (!m.contribution_status ? ' selected' : '') + '>nicht vorgegeben</option><option value="open"' + (m.contribution_status === "open" ? ' selected' : '') + '>offen</option><option value="paid"' + (m.contribution_status === "paid" ? ' selected' : '') + '>bezahlt</option><option value="none"' + (m.contribution_status === "none" ? ' selected' : '') + '>kein Beitrag</option></select></label>' +
          '<label><span>Bezahlt am</span><input data-correct="paid_at" placeholder="TT.MM.JJJJ" value="' + esc(correctionValue(m,"paid_at_raw") || correctionValue(m,"paid_at")) + '"></label>' +
          '<label><span>Geburtsdatum</span><input data-correct="birth_date" placeholder="TT.MM.JJJJ" value="' + esc(correctionValue(m,"birth_date_raw") || correctionValue(m,"birth_date")) + '"></label>' +
          '<label><span>Telefon</span><input data-correct="phone" value="' + esc(correctionValue(m,"phone")) + '"></label>' +
          '<label><span>Straße / Anschrift</span><input data-correct="street" value="' + esc(correctionValue(m,"street")) + '"></label>' +
          '<label><span>PLZ</span><input data-correct="postal_code" value="' + esc(correctionValue(m,"postal_code")) + '"></label>' +
          '<label><span>Ort</span><input data-correct="city" value="' + esc(correctionValue(m,"city")) + '"></label>' +
          '<label><span>Eintrittsdatum</span><input data-correct="joined_at" placeholder="TT.MM.JJJJ" value="' + esc(correctionValue(m,"joined_at_raw") || correctionValue(m,"joined_at")) + '"></label>' +
          '<label><span>Mandatsreferenz</span><input data-correct="mandate_reference" value="' + esc(correctionValue(m,"mandate_reference")) + '"></label>' +
          '<label><span>Mandatsdatum</span><input data-correct="mandate_signed_at" placeholder="TT.MM.JJJJ" value="' + esc(correctionValue(m,"mandate_signed_at")) + '"></label>' +
        '</div>' +
        (isDuplicate ? duplicateActions : '') +
      '</section>';
    }).join("") +
    '</div>';
}

function collectImportCorrections() {
  return $$(".correction-card").map(card => {
    const index = Number(card.dataset.correctionIndex);
    const item = vaImportState.corrections[index];
    const result = {
      __row: item.row,
      __resolution: item.resolution || null,
      __existing_member_id: item.existing_member_id || null,
      __kind: item.kind || "error"
    };
    $$("[data-correct]", card).forEach(input => {
      result[input.dataset.correct] = input.value;
    });
    return result;
  });
}

function importHeaderScore(values) {
  const known = new Set([
    "name","vorname","vornamen","nachname","familienname","email","emailadresse","mail",
    "iban","jahresbeitrag","mitgliedsbeitrag","beitrag","betrag","mitgliedsnummer","mitgliednr",
    "abteilung","gruppe","mannschaft","team","geburtsdatum","telefon","handy","strasse","plz",
    "ort","eintritt","eintrittsdatum","beitragsstatus","bezahlt","zahlungsdatum",
    "mandatsreferenz","mandatsdatum","beitragsart"
  ]);
  return values.reduce((score, value) => {
    const key = normalizeHeader(value);
    if (!key) return score;
    if (known.has(key)) return score + 3;
    if (/^(jahresbeitrag|mitgliedsbeitrag|beitrag)\d{4}$/.test(key)) return score + 3;
    if (/^(email|mitglied|mandat|beitrag|zahlung|geburt|telefon|strasse|adresse)/.test(key)) return score + 1;
    return score;
  }, 0);
}

async function readImportFile(file) {
  if (!window.XLSX) throw new Error("Excel-Import ist noch nicht geladen.");
  const name = String(file?.name || "").toLowerCase();
  if (!/\.(csv|xlsx|xls)$/.test(name)) throw new Error("Bitte eine CSV-, XLSX- oder XLS-Datei auswählen.");
  if (file.size > 8 * 1024 * 1024) throw new Error("Die Datei ist zu groß. Maximal 8 MB.");

  const data = await file.arrayBuffer();
  const wb = XLSX.read(data, { type: "array", cellDates: true });

  let best = null;
  wb.SheetNames.forEach(sheetName => {
    const ws = wb.Sheets[sheetName];
    const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: true, blankrows: false });
    const limit = Math.min(matrix.length, 12);
    for (let i = 0; i < limit; i++) {
      const row = Array.isArray(matrix[i]) ? matrix[i] : [];
      const score = importHeaderScore(row);
      if (!best || score > best.score) best = { sheetName, ws, matrix, headerIndex: i, score };
    }
  });

  if (!best?.ws || !best.matrix?.length) throw new Error("Die Datei enthält keine Daten.");

  const headerRow = best.matrix[best.headerIndex] || [];
  const columns = headerRow.map((value, index) => {
    const text = String(value ?? "").trim();
    return text || "Spalte " + (index + 1);
  });

  const rows = XLSX.utils.sheet_to_json(best.ws, {
    header: columns,
    range: best.headerIndex + 1,
    defval: "",
    raw: true,
    blankrows: false
  }).filter(row => Object.values(row).some(value => String(value ?? "").trim() !== ""));

  if (!rows.length) throw new Error("Unter den Spaltenüberschriften wurden keine Mitgliedsdaten gefunden.");

  const mapping = autoMapColumns(columns);
  if (!mapping.annual_fee) {
    const feeColumn = columns.find(col => /^(jahresbeitrag|mitgliedsbeitrag|beitrag)\d{4}$/.test(normalizeHeader(col)));
    if (feeColumn) mapping.annual_fee = feeColumn;
  }

  return {
    file,
    rows,
    columns,
    mapping,
    sheetName: best.sheetName,
    headerRow: best.headerIndex + 1
  };
}


async function loadAllMembersForImport() {
  const { data, error } = await sb
    .from("members")
    .select("*")
    .order("last_name", { ascending: true })
    .order("first_name", { ascending: true });
  if (error) throw error;
  return data || [];
}

function importDuplicateKeys(member) {
  return [
    member?.member_number ? "n:" + String(member.member_number).trim().toLowerCase() : null,
    member?.email ? "e:" + String(member.email).trim().toLowerCase() : null,
    member?.mandate_reference ? "m:" + String(member.mandate_reference).trim().toLowerCase() : null,
    member?.first_name && member?.last_name
      ? "x:" + (memberFullName(member) + "|" + (member.group_name || "")).toLowerCase()
      : null
  ].filter(Boolean);
}

function buildDuplicateIndex(members) {
  const index = new Map();
  members.forEach(member => {
    importDuplicateKeys(member).forEach(key => {
      if (!index.has(key)) index.set(key, []);
      index.get(key).push(member);
    });
  });
  return index;
}

function findExistingDuplicateMatches(member, index) {
  const found = new Map();
  importDuplicateKeys(member).forEach(key => {
    (index.get(key) || []).forEach(existing => found.set(existing.id, existing));
  });
  return [...found.values()];
}

function duplicateCorrectionItem(rowNo, member, matches = [], source = "existing") {
  const one = matches.length === 1 ? matches[0] : null;
  const reason = source === "file"
    ? "Dublette innerhalb der Datei"
    : matches.length > 1
      ? "Dublette: Angaben passen zu mehreren bestehenden Mitgliedern"
      : "Dublette: Mitglied bereits vorhanden";

  return {
    row: rowNo,
    name: memberFullName(member),
    reasons: [reason],
    kind: "duplicate",
    duplicate_source: source,
    existing_member_id: one?.id || null,
    existing_member: one ? { ...one } : null,
    existing_matches: matches.map(m => ({
      id: m.id,
      first_name: m.first_name,
      last_name: m.last_name,
      member_number: m.member_number,
      email: m.email,
      group_name: m.group_name
    })),
    resolution: null,
    member: { ...member, __row: rowNo }
  };
}

async function prepareImportReview(rows, mapping, club) {
  const existing = await loadAllMembersForImport();
  const existingIndex = buildDuplicateIndex(existing);
  const seenImport = new Map();

  const valid = [];
  const corrections = [];

  rows.forEach((row, index) => {
    const rowNo = index + 2;
    const m = mapImportRow(row, mapping, club.standard_fee);
    const reasons = validateImportedMember(m);

    if (mapping.mandate_signed_at && row[mapping.mandate_signed_at] && !m.mandate_signed_at) {
      if (!reasons.includes("Mandatsdatum fehlt/ungültig")) reasons.push("Mandatsdatum ungültig");
      m.mandate_signed_at = String(row[mapping.mandate_signed_at]).trim();
    }

    const existingMatches = findExistingDuplicateMatches(m, existingIndex);
    const fileMatch = importDuplicateKeys(m).map(key => seenImport.get(key)).find(Boolean);

    if (reasons.length) {
      corrections.push({
        row: rowNo,
        name: memberFullName(m),
        reasons: [...new Set(reasons)],
        kind: "error",
        member: { ...m, __row: rowNo }
      });
      return;
    }

    if (existingMatches.length) {
      corrections.push(duplicateCorrectionItem(rowNo, m, existingMatches, "existing"));
      return;
    }

    if (fileMatch) {
      const item = duplicateCorrectionItem(rowNo, m, [], "file");
      item.matched_import_row = fileMatch.__row || null;
      corrections.push(item);
      return;
    }

    valid.push({ ...m, __row: rowNo });
    importDuplicateKeys(m).forEach(key => seenImport.set(key, { ...m, __row: rowNo }));
  });

  return { valid, corrections };
}

async function reviewCorrectedCandidates(sources, club) {
  const existing = await loadAllMembersForImport();
  const existingIndex = buildDuplicateIndex(existing);
  const seenImport = new Map();

  const valid = [];
  const corrections = [];
  const duplicateActions = [];

  sources.forEach((source, index) => {
    const rawDate = String(source.mandate_signed_at || "").trim();
    const parsedDate = rawDate ? parseDateValue(rawDate) : null;

    const contributionStatusRaw = String(source.contribution_status_raw || source.contribution_status || "").trim();
    const paidRaw = String(source.paid_at_raw || source.paid_at || "").trim();
    const birthRaw = String(source.birth_date_raw || source.birth_date || "").trim();
    const joinedRaw = String(source.joined_at_raw || source.joined_at || "").trim();

    const m = {
      first_name: String(source.first_name || "").trim(),
      last_name: String(source.last_name || "").trim(),
      group_name: String(source.group_name || "").trim() || null,
      email: String(source.email || "").trim() || null,
      iban: normalizeIban(source.iban) || null,
      account_holder: String(source.account_holder || "").trim() || null,
      annual_fee: parseFee(source.annual_fee, club.standard_fee),
      member_number: String(source.member_number || "").trim() || null,
      mandate_reference: String(source.mandate_reference || "").trim() || null,
      mandate_signed_at: parsedDate,
      contribution_status: contributionStatusRaw ? (["open","paid","none"].includes(contributionStatusRaw) ? contributionStatusRaw : parseContributionStatus(contributionStatusRaw)) : null,
      contribution_status_raw: contributionStatusRaw || null,
      paid_at: paidRaw ? parseDateValue(paidRaw) : null,
      paid_at_raw: paidRaw || null,
      birth_date: birthRaw ? parseDateValue(birthRaw) : null,
      birth_date_raw: birthRaw || null,
      phone: String(source.phone || "").trim() || null,
      street: String(source.street || "").trim() || null,
      postal_code: String(source.postal_code || "").trim() || null,
      city: String(source.city || "").trim() || null,
      joined_at: joinedRaw ? parseDateValue(joinedRaw) : null,
      joined_at_raw: joinedRaw || null,
      contribution_label: String(source.contribution_label || "").trim() || null
    };

    const rowNo = source.__row || index + 1;
    const reasons = validateImportedMember(m);
    if (rawDate && !parsedDate && !reasons.includes("Mandatsdatum fehlt/ungültig")) {
      reasons.push("Mandatsdatum ungültig");
    }

    if (reasons.length) {
      corrections.push({
        row: rowNo,
        name: memberFullName(m),
        reasons: [...new Set(reasons)],
        kind: "error",
        member: { ...m, mandate_signed_at: rawDate || "", __row: rowNo }
      });
      return;
    }

    const existingMatches = findExistingDuplicateMatches(m, existingIndex);
    const fileMatch = importDuplicateKeys(m).map(key => seenImport.get(key)).find(Boolean);
    const resolution = source.__resolution || null;
    const targetId = source.__existing_member_id || null;

    if (resolution === "update") {
      const target = targetId
        ? existing.find(x => x.id === targetId)
        : (existingMatches.length === 1 ? existingMatches[0] : null);

      if (!target) {
        const item = duplicateCorrectionItem(rowNo, m, existingMatches, "existing");
        item.reasons = ["Bestehendes Mitglied konnte nicht eindeutig erkannt werden"];
        item.resolution = null;
        corrections.push(item);
        return;
      }

      duplicateActions.push({
        action: "update",
        row: rowNo,
        target_id: target.id,
        member: { ...m }
      });
      return;
    }

    if (resolution === "create") {
      duplicateActions.push({
        action: "create",
        row: rowNo,
        member: { ...m }
      });
      return;
    }

    if (existingMatches.length) {
      corrections.push(duplicateCorrectionItem(rowNo, m, existingMatches, "existing"));
      return;
    }

    if (fileMatch) {
      const item = duplicateCorrectionItem(rowNo, m, [], "file");
      item.matched_import_row = fileMatch.__row || null;
      corrections.push(item);
      return;
    }

    valid.push({ ...m, __row: rowNo });
    importDuplicateKeys(m).forEach(key => seenImport.set(key, { ...m, __row: rowNo }));
  });

  return { valid, corrections, duplicateActions };
}

async function enhanceMemberPage() {
  const memberClub = vaClub || await getClub();
  const memberContributionTypes = await loadContributionTypes(memberClub.id);
  const fileInput = $("#memberImport");
  const importSheet = $("#importSheet");
  const mappingBox = $("#importMapping");
  const preview = $("#importPreview");
  const correctionsBox = $("#importCorrections");
  const runImport = $("#runImport");
  const importHint = $("#importHint");

  $("#exportMembers")?.addEventListener("click", async () => {
    const members = await loadMembers();
    const contributions = await loadContributions();
    const contributionMap = new Map(contributions.map(row => [row.member_id, row]));
    const statusText = row => !row ? "Kein Beitrag" : row.status === "paid" ? "Bezahlt" : "Offen";

    const lines = [
      ["Mitgliedsnummer","Vorname","Nachname","Abteilung / Gruppe","E-Mail","Geburtsdatum","Telefon","Straße","PLZ","Ort","Eintrittsdatum","Beitragsart","IBAN","Kontoinhaber/in","Jahresbeitrag","Beitragsstatus","Bezahlt am","Mandatsreferenz","Mandatsdatum"],
      ...members.map(m => {
        const contribution = contributionMap.get(m.id);
        return [
          m.member_number||"",m.first_name,m.last_name,m.group_name||"",m.email||"",
          m.birth_date||"",m.phone||"",m.street||"",m.postal_code||"",m.city||"",m.joined_at||"",
          m.contribution_label||"",m.iban||"",m.account_holder||"",m.annual_fee||0,statusText(contribution),
          contribution?.paid_at ? String(contribution.paid_at).slice(0,10) : "",
          m.mandate_reference||"",m.mandate_signed_at||""
        ];
      })
    ];
    const csv = lines.map(row => row.map(v => '"' + String(v).replace(/"/g,'""') + '"').join(";")).join("\r\n");
    downloadBlob("\uFEFF" + csv, "VEREINSFACH_Mitglieder.csv", "text/csv;charset=utf-8");
  });

  const refreshImportReview = async () => {
    if (!vaImportState) return;
    const m = vaImportState.mapping;

    if (!(m.full_name || (m.first_name && m.last_name))) {
      vaImportState.valid = [];
      vaImportState.corrections = [];
      preview.innerHTML = "";
      renderImportCorrections([]);
      importHint.textContent = "Bitte zuerst Vorname + Nachname oder „Name komplett“ zuordnen.";
      runImport.disabled = true;
      return;
    }

    const club = vaClub || await getClub();
    const review = await prepareImportReview(vaImportState.rows, m, club);
    vaImportState.valid = review.valid;
    vaImportState.corrections = review.corrections;

    preview.innerHTML = importPreviewHtml(vaImportState.rows, m, club.standard_fee || 0);
    renderImportCorrections(review.corrections);

    const ready = review.valid.length;
    const problem = review.corrections.length;

    importHint.innerHTML = problem
      ? '<strong>' + ready + ' bereit · ' + problem + ' müssen korrigiert oder übersprungen werden.</strong>'
      : '<strong>' + ready + ' Mitglieder geprüft · alles bereit zum Import.</strong>';

    runImport.disabled = ready === 0 && problem === 0;
    runImport.textContent = problem ? "Korrekturen prüfen" : ready + " Mitglieder importieren";
  };

  fileInput?.addEventListener("change", async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      vaImportState = await readImportFile(file);
      vaImportState.valid = [];
      vaImportState.corrections = [];
      mappingBox.innerHTML = importMappingHtml(vaImportState.columns, vaImportState.mapping);
      openBackdrop(importSheet);
      await refreshImportReview();

      $$("[data-map]", mappingBox).forEach(select => select.addEventListener("change", async () => {
        vaImportState.mapping[select.dataset.map] = select.value || null;
        await refreshImportReview();
      }));
    } catch (error) {
      console.error(error);
      showToast(error.message || "Datei konnte nicht gelesen werden.");
    } finally {
      e.target.value = "";
    }
  });

  $("#closeImport")?.addEventListener("click", () => closeBackdrop(importSheet));
  importSheet?.addEventListener("click", e => { if (e.target === importSheet) closeBackdrop(importSheet); });

  correctionsBox?.addEventListener("input", e => {
    const input = e.target.closest("[data-correct]");
    const card = e.target.closest(".correction-card");
    if (!input || !card || !vaImportState?.corrections) return;

    const index = Number(card.dataset.correctionIndex);
    const item = vaImportState.corrections[index];
    if (!item) return;
    item.member = item.member || {};
    item.member[input.dataset.correct] = input.value;
  });

  correctionsBox?.addEventListener("click", e => {
    if (!vaImportState?.corrections) return;

    const duplicateChoice = e.target.closest("[data-duplicate-action]");
    if (duplicateChoice) {
      const index = Number(duplicateChoice.dataset.correctionIndex);
      const item = vaImportState.corrections[index];
      if (!item) return;

      const action = duplicateChoice.dataset.duplicateAction;

      if (action === "skip") {
        vaImportState.corrections.splice(index, 1);
      } else {
        item.resolution = action;
      }

      renderImportCorrections(vaImportState.corrections);

      const ready = vaImportState.valid?.length || 0;
      const unresolved = vaImportState.corrections.filter(item =>
        item.kind !== "duplicate" || !item.resolution
      ).length;
      const decidedDuplicates = vaImportState.corrections.filter(item =>
        item.kind === "duplicate" && ["update","create"].includes(item.resolution)
      ).length;

      importHint.innerHTML = unresolved
        ? '<strong>' + ready + ' bereit · ' + unresolved + ' Entscheidung/Korrektur noch offen.</strong>'
        : '<strong>' + ready + ' neue Zeile(n) bereit · ' + decidedDuplicates + ' Dublette(n) entschieden.</strong>';

      runImport.disabled = ready === 0 && vaImportState.corrections.length === 0;
      runImport.textContent = vaImportState.corrections.length ? "Korrekturen prüfen" : ready + " Mitglieder importieren";
      return;
    }

    const skip = e.target.closest("[data-skip-correction]");
    if (!skip) return;

    const index = Number(skip.dataset.skipCorrection);
    vaImportState.corrections.splice(index, 1);
    renderImportCorrections(vaImportState.corrections);

    const ready = vaImportState.valid?.length || 0;
    const remaining = vaImportState.corrections.length;
    importHint.innerHTML = remaining
      ? '<strong>' + ready + ' bereit · ' + remaining + ' müssen noch korrigiert oder übersprungen werden.</strong>'
      : '<strong>' + ready + ' Mitglieder bereit. Fehlerzeilen wurden übersprungen.</strong>';
    runImport.textContent = remaining ? "Korrekturen prüfen" : ready + " Mitglieder importieren";
    runImport.disabled = ready === 0 && remaining === 0;
  });

  runImport?.addEventListener("click", async () => {
    if (!vaImportState) return;

    runImport.disabled = true;

    try {
      const club = vaClub || await getClub();
      const hasCorrections = Array.isArray(vaImportState.corrections) && vaImportState.corrections.length > 0;

      if (hasCorrections) {
        runImport.textContent = "Korrekturen werden geprüft …";

        const corrected = collectImportCorrections();
        const review = await reviewCorrectedCandidates(
          [...(vaImportState.valid || []), ...corrected],
          club
        );

        vaImportState.valid = review.valid;
        vaImportState.corrections = review.corrections;
        vaImportState.duplicateActions = review.duplicateActions || [];
        renderImportCorrections(review.corrections);

        if (review.corrections.length) {
          importHint.innerHTML =
            '<strong>' + review.valid.length + ' bereit · ' +
            review.corrections.length + ' müssen noch korrigiert oder entschieden werden.</strong>';
          runImport.disabled = false;
          runImport.textContent = "Korrekturen prüfen";
          return;
        }

        preview.innerHTML = "";
        const creates = vaImportState.duplicateActions.filter(x => x.action === "create").length;
        const updates = vaImportState.duplicateActions.filter(x => x.action === "update").length;
        const parts = [review.valid.length + " neu"];
        if (updates) parts.push(updates + " aktualisieren");
        if (creates) parts.push(creates + " zusätzlich neu");

        importHint.innerHTML =
          '<strong>Alles geprüft ✓ · ' + esc(parts.join(" · ")) + '.</strong>';
        runImport.disabled = false;
        runImport.textContent = "Import jetzt durchführen";
        return;
      }

      const candidates = vaImportState.valid || [];
      const duplicateActions = vaImportState.duplicateActions || [];

      if (!candidates.length && !duplicateActions.length) {
        showToast("Keine Mitglieder zum Importieren vorhanden");
        runImport.disabled = false;
        runImport.textContent = "Mitglieder importieren";
        return;
      }

      runImport.textContent = "Wird vollständig importiert …";

      const batchRows = [
        ...candidates.map(member => ({ ...member, action: "create" })),
        ...duplicateActions.map(action => ({
          ...action.member,
          action: action.action,
          target_id: action.target_id || null
        }))
      ].map(row => {
        const clean = { ...row };
        delete clean.__row;
        delete clean.__kind;
        delete clean.__resolution;
        delete clean.__existing_member_id;
        delete clean.contribution_status_raw;
        delete clean.paid_at_raw;
        delete clean.birth_date_raw;
        delete clean.joined_at_raw;
        return clean;
      });

      const { data: result, error } = await sb.rpc("import_members_batch", {
        p_club_id: club.id,
        p_rows: batchRows,
        p_contribution_year: currentYear,
        p_due_date: dueDateForContributionYear(club, currentYear)
      });
      if (error) throw error;

      try { await syncDepartmentsFromMembers(club); }
      catch (err) { console.warn("Abteilungen konnten nicht synchronisiert werden:", err); }

      const messages = [];
      if (Number(result?.created || 0)) messages.push(result.created + " neu importiert");
      if (Number(result?.updated || 0)) messages.push(result.updated + " aktualisiert");
      if (Number(result?.renumbered || 0)) messages.push(result.renumbered + " Nummer(n) automatisch vergeben");

      closeBackdrop(importSheet);
      showToast((messages.join(" · ") || "Import abgeschlossen") + " ✓");
      vaImportState = null;
      setTimeout(() => location.reload(), 500);
    } catch (error) {
      console.error("Mitgliederimport", error);
      const message = String(error?.message || "") + " " + String(error?.details || "");
      const friendly =
        message.includes("members_club_mandate_reference_uidx")
          ? "Eine Mandatsreferenz ist bereits vergeben. Bitte die betroffene Zeile korrigieren."
          : message.includes("INVALID_IMPORT_CONTRIBUTION_STATUS")
            ? "Ein Beitragsstatus ist ungültig. Erlaubt sind offen, bezahlt oder kein Beitrag."
            : message.includes("ACCESS_BLOCKED")
              ? "Der Verein ist derzeit nur lesbar. Bitte Tarif/Teststatus prüfen."
              : "Import fehlgeschlagen. Es wurde nichts gespeichert.";

      await handleAppError(error, friendly);
      runImport.disabled = false;
      runImport.textContent = vaImportState?.corrections?.length
        ? "Korrekturen prüfen"
        : "Import jetzt durchführen";
    }
  });

  const memberSheet = $("#memberSheet");
  const editSheet = $("#editMemberSheet");
  bindIbanValidation($("#editMemberIban"));

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
    $("#editMemberNumber").value = data.member_number || "";
    $("#editFirstName").value = data.first_name || "";
    $("#editLastName").value = data.last_name || "";
    setupDepartmentSelect($("#editMemberGroup"), memberClub, data.group_name || "");
    $("#editMemberEmail").value = data.email || "";
    $("#editMemberBirthDate").value = data.birth_date || "";
    $("#editMemberPhone").value = data.phone || "";
    $("#editMemberStreet").value = data.street || "";
    $("#editMemberPostalCode").value = data.postal_code || "";
    $("#editMemberCity").value = data.city || "";
    setupMemberContributionSelect(
      $("#editMemberContributionType"),
      $("#editMemberFee"),
      memberContributionTypes,
      memberClub,
      data
    );
    $("#editMemberIban").value = data.iban || "";
    $("#editMemberAccountHolder").value = data.account_holder || "";
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
    const amount = annualizedMemberFee($("#editMemberFee").value,billingPeriodForSelection($("#editMemberContributionType"),memberContributionTypes));
    const selectedContribution = memberContributionSelection($("#editMemberContributionType"), memberContributionTypes);
    const editIban = normalizeIban($("#editMemberIban").value);
    const editMandate = $("#editMemberMandate").value.trim();
    if (editIban && !validIban(editIban)) {
      $("#editMemberIban").focus();
      showToast("Die IBAN des Mitglieds ist ungültig. Bitte Eingabe prüfen.");
      return;
    }
    if (editMandate && !isValidSepaReferenceValue(editMandate)) {
      $("#editMemberMandate").focus();
      showToast("Mandatsreferenz ungültig: maximal 35 Zeichen, kein / am Anfang oder Ende und kein //.");
      return;
    }
    const { error } = await sb.rpc("update_member_full_with_open_contribution", {
      p_member_id: id,
      p_member_number: $("#editMemberNumber").value.trim() || null,
      p_first_name: $("#editFirstName").value.trim(),
      p_last_name: $("#editLastName").value.trim(),
      p_group_name: $("#editMemberGroup").value.trim() || null,
      p_email: $("#editMemberEmail").value.trim() || null,
      p_annual_fee: amount,
      p_contribution_type_id: selectedContribution.contribution_type_id,
      p_contribution_label: selectedContribution.contribution_label,
      p_iban: editIban || null,
      p_account_holder: $("#editMemberAccountHolder").value.trim() || null,
      p_mandate_reference: editMandate || null,
      p_mandate_signed_at: $("#editMemberMandateDate").value || null,
      p_contribution_year: currentYear,
      p_birth_date: $("#editMemberBirthDate").value || null,
      p_phone: $("#editMemberPhone").value.trim() || null,
      p_street: $("#editMemberStreet").value.trim() || null,
      p_postal_code: $("#editMemberPostalCode").value.trim() || null,
      p_city: $("#editMemberCity").value.trim() || null
    });

    if (error) {
      const message = String(error?.message || "") + " " + String(error?.details || "");
      if (message.includes("INVALID_BIRTH_DATE")) return showToast("Das Geburtsdatum ist ungültig.");
      if (message.includes("INVALID_DEPARTMENT")) return showToast("Diese Abteilung / Gruppe ist nicht mehr verfügbar. Bitte Auswahl neu öffnen.");
      if (error.code === "23505" && /mandate_reference|members_club_mandate_reference_uidx/i.test(message)) {
        return showToast("Diese Mandatsreferenz ist bereits vergeben.");
      }
      if (error.code === "23505") return showToast("Diese Mitgliedsnummer ist bereits vergeben.");
      await handleAppError(error, "Änderung konnte nicht gespeichert werden.");
      return;
    }

    showToast("Mitglied aktualisiert ✓");
    closeBackdrop(editSheet);
    setTimeout(() => location.reload(), 500);
  });

  $("#deleteMemberBtn")?.addEventListener("click", async () => {
    const id = memberSheet.dataset.memberId;
    if (!id || !confirm("Mitglied aus der aktiven Mitgliederliste entfernen? Vergangene bezahlte Beitragsdaten bleiben erhalten.")) return;

    const button = $("#deleteMemberBtn");
    button.disabled = true;
    button.textContent = "Wird entfernt …";

    const { error } = await sb.rpc("remove_member_from_active_list", {
      p_member_id: id,
      p_contribution_year: currentYear
    });

    if (error) {
      button.disabled = false;
      button.textContent = "Mitglied entfernen";
      await handleAppError(error, "Mitglied konnte nicht entfernt werden. Es wurde nichts verändert.");
      return;
    }

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
  if (iban.startsWith("DE") && iban.length !== 22) return false;
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
  let id = String(value || "")
    .replace(/[^A-Za-z0-9+?/:().,'\-]/g, "-")
    .replace(/\/{2,}/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .slice(0, max);

  id = id.replace(/\/+$/g, "");
  return id || "NOTPROVIDED";
}

function validSepaDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const d = new Date(String(value) + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0,10) === value;
}

function validateSepaRows(club, rows, collectionDate) {
  const errors = [];
  const creditorName = safeSepaText(club?.name, 70);

  if (!creditorName) errors.push("Vereinsname ist für SEPA nicht verwendbar.");
  if (!validIban(club?.iban)) errors.push("Vereins-IBAN ist ungültig.");
  if (!isValidCreditorIdValue(club?.creditor_id)) errors.push("Gläubiger-ID ist ungültig.");
  if (!validSepaDate(collectionDate)) errors.push("Einzugsdatum ist ungültig.");
  if (!rows.length) errors.push("Keine Lastschriften vorhanden.");
  if (rows.length > 100000) errors.push("Eine SEPA-Datei darf höchstens 100.000 Lastschriften enthalten.");

  const localToday = (() => {
    const d = new Date();
    return [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, "0"),
      String(d.getDate()).padStart(2, "0")
    ].join("-");
  })();

  if (validSepaDate(collectionDate) && collectionDate <= localToday) {
    errors.push("Einzugsdatum muss mindestens morgen sein.");
  }

  rows.forEach((c, index) => {
    const m = c.members || {};
    const label = memberFullName(m) || ("Zeile " + (index + 1));
    const amount = Number(c.amount || 0);
    const mandateRaw = String(m.mandate_reference || "").trim();
    const mandate = safeSepaText(mandateRaw, 35);
    const debtorName = safeSepaText(m.account_holder || memberFullName(m), 70);

    if (!Number.isFinite(amount) || amount < 0.01 || amount > 999999999.99) {
      errors.push(label + ": Betrag muss zwischen 0,01 € und 999.999.999,99 € liegen.");
    }
    if (!validIban(m.iban)) errors.push(label + ": IBAN ungültig.");
    if (!debtorName) errors.push(label + ": Name ist für SEPA nicht verwendbar.");
    if (!mandateRaw) errors.push(label + ": Mandatsreferenz fehlt.");
    else if (!isValidSepaReferenceValue(mandateRaw)) errors.push(label + ": Mandatsreferenz ist ungültig.");
    else if (!mandate) errors.push(label + ": Mandatsreferenz enthält keine verwendbaren Zeichen.");
    if (!validSepaDate(m.mandate_signed_at)) errors.push(label + ": Mandatsdatum ungültig.");
    else if (m.mandate_signed_at > localToday) errors.push(label + ": Mandatsdatum liegt in der Zukunft.");
  });

  return [...new Set(errors)];
}

function validateGeneratedSepaXml(xml, rows) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("XML ist syntaktisch ungültig.");

  const ns = "urn:iso:std:iso:20022:tech:xsd:pain.008.001.08";
  if (doc.documentElement?.localName !== "Document" || doc.documentElement?.namespaceURI !== ns) {
    throw new Error("Falscher pain.008.001.08-Namespace.");
  }

  const getAll = name => Array.from(doc.getElementsByTagNameNS(ns, name));
  const txs = getAll("DrctDbtTxInf");
  if (txs.length !== rows.length) throw new Error("Anzahl der Lastschriften stimmt nicht.");

  const expectedTotal = rows.reduce((sum, c) => sum + Number(c.amount || 0), 0).toFixed(2);

  for (const node of getAll("NbOfTxs")) {
    if (Number(node.textContent) !== rows.length) throw new Error("NbOfTxs stimmt nicht.");
  }
  for (const node of getAll("CtrlSum")) {
    if (Number(node.textContent).toFixed(2) !== expectedTotal) throw new Error("CtrlSum stimmt nicht.");
  }
  for (const node of getAll("InstdAmt")) {
    if (node.getAttribute("Ccy") !== "EUR") throw new Error("Lastschriftbetrag ist nicht in EUR.");
    const amount = Number(node.textContent);
    if (!Number.isFinite(amount) || amount < 0.01 || amount > 999999999.99) {
      throw new Error("Ungültiger Lastschriftbetrag in der XML.");
    }
  }

  if (getAll("PmtId").length !== rows.length) throw new Error("Payment-ID fehlt.");
  if (getAll("MndtId").some(node => !String(node.textContent || "").trim())) throw new Error("Leere Mandatsreferenz.");
  if (getAll("EndToEndId").some(node => !String(node.textContent || "").trim())) throw new Error("Leere End-to-End-ID.");

  return true;
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

function buildSepaXml(club, rows, collectionDate, batchId = "") {
  const now = new Date();
  const contributionYear = Number(rows?.[0]?.contribution_year || contributionYearFromUrl() || currentYear);
  const stamp = now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const msgId = compactId(batchId || ("VF-" + stamp));
  const pmtId = compactId((batchId || ("VF-DD-" + contributionYear + "-" + stamp.slice(-6))) + "-P");
  const total = rows.reduce((sum, c) => sum + Number(c.amount || 0), 0).toFixed(2);
  const creditorIban = normalizeIban(club.iban);
  const creditorName = safeSepaText(club.name, 70);
  const creditorId = normalizeCreditorIdValue(club.creditor_id);

  const txs = rows.map((c, index) => {
    const m = c.members || {};
    const endToEnd = compactId("VF-" + (m.member_number || String(index + 1)) + "-" + contributionYear + "-" + String(r.contribution_month||0).padStart(2,"0"));
    const mandateId = safeSepaText(m.mandate_reference, 35);
    const debtorName = safeSepaText(m.account_holder || memberFullName(m), 70);

    return `<DrctDbtTxInf>
<PmtId><EndToEndId>${xmlEscape(endToEnd)}</EndToEndId></PmtId>
<InstdAmt Ccy="EUR">${Number(c.amount).toFixed(2)}</InstdAmt>
<DrctDbtTx><MndtRltdInf><MndtId>${xmlEscape(mandateId)}</MndtId><DtOfSgntr>${xmlEscape(m.mandate_signed_at)}</DtOfSgntr></MndtRltdInf></DrctDbtTx>
<DbtrAgt><FinInstnId><Othr><Id>NOTPROVIDED</Id></Othr></FinInstnId></DbtrAgt>
<Dbtr><Nm>${xmlEscape(debtorName)}</Nm></Dbtr>
<DbtrAcct><Id><IBAN>${xmlEscape(normalizeIban(m.iban))}</IBAN></Id></DbtrAcct>
<RmtInf><Ustrd>${xmlEscape(safeSepaText("Mitgliedsbeitrag " + contributionYear, 140))}</Ustrd></RmtInf>
</DrctDbtTxInf>`;
  }).join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.008.001.08">
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
<CdtrSchmeId><Id><PrvtId><Othr><Id>${xmlEscape(creditorId)}</Id><SchmeNm><Prtry>SEPA</Prtry></SchmeNm></Othr></PrvtId></Id></CdtrSchmeId>
${txs}
</PmtInf>
</CstmrDrctDbtInitn>
</Document>`;
}

function reminderTodayIso() {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0")
  ].join("-");
}

function reminderDueText(c) {
  if (!c?.due_date) return "";
  const formatted = new Date(c.due_date + "T00:00:00").toLocaleDateString("de-DE");
  const today = reminderTodayIso();

  if (c.due_date < today) return ", fällig seit " + formatted;
  if (c.due_date === today) return ", heute fällig";
  return ", fällig am " + formatted;
}

function reminderSubject(c) {
  const year = Number(c?.contribution_year || contributionYearFromUrl() || currentYear);
  return "Mitgliedsbeitrag " + year + " – " + (vaClub?.name || "Verein");
}

function friendlyReminder(c) {
  const m = c.members || {};
  const contributionYear = Number(c.contribution_year || contributionYearFromUrl() || currentYear);
  const dueText = reminderDueText(c);
  const clubName = String(vaClub?.name || "Euer Verein").trim();
  const clubIban = String(vaClub?.iban || "").trim();
  const groupName = String(m.group_name || "").trim();
  const memberNumber = String(m.member_number || "").trim();
  const memberName = memberFullName(m);
  const purpose = [
    "Mitgliedsbeitrag " + contributionYear,
    memberName,
    memberNumber ? "Mitglied " + memberNumber : ""
  ].filter(Boolean).join(" · ");

  const paymentDetails = [
    "Zahlungsdaten:",
    "Verein / Kontoinhaber: " + clubName,
    groupName ? "Abteilung / Gruppe: " + groupName : "",
    "Offener Betrag: " + money(c.amount),
    clubIban ? "IBAN: " + clubIban : "",
    "Verwendungszweck: " + purpose
  ].filter(Boolean).join("\n");

  return `Hallo ${memberName},

für deinen Mitgliedsbeitrag ${contributionYear} sind noch ${money(c.amount)} offen${dueText}.

Wir möchten dich freundlich daran erinnern, den offenen Betrag zu überweisen bzw. den Zahlungseingang zu prüfen.

${paymentDetails}

Falls die Zahlung bereits unterwegs ist, kannst du diese Nachricht einfach ignorieren.

Viele Grüße
${clubName}`;
}

function memberIsContributionExempt(member, year) {
  return Array.isArray(member?.contribution_exempt_years) &&
    member.contribution_exempt_years.map(Number).includes(Number(year));
}

async function enhanceContributionPage() {
  const club = vaClub || await getClub();
  const selectedYear = contributionYearFromUrl();
  const [members, contributions] = await Promise.all([
    loadMembers(),
    loadContributions(selectedYear)
  ]);

  const existingIds = new Set(contributions.map(c => c.member_id));
  const missing = selectedYear === currentYear
    ? members.filter(m => !existingIds.has(m.id) && !memberIsContributionExempt(m, selectedYear))
    : [];

  if (selectedYear === currentYear && missing.length) {
    $("#yearSetup").hidden = false;
    $("#yearSetupText").textContent =
      missing.length + " aktive Mitglieder haben noch keinen Beitrag für " + selectedYear + ".";
  } else {
    $("#yearSetup").hidden = true;
  }

  $("#createYearContributions")?.addEventListener("click", async () => {
    if (selectedYear !== currentYear) {
      showToast("Vergangene Beitragsjahre werden nicht neu angelegt.");
      return;
    }

    const btn = $("#createYearContributions");
    btn.disabled = true;
    btn.textContent = "Wird angelegt …";

    const [freshMembers, freshContributions] = await Promise.all([
      loadMembers(),
      loadContributions(selectedYear)
    ]);
    const freshExistingIds = new Set(freshContributions.map(c => c.member_id));
    const freshMissing = freshMembers.filter(
      m => !freshExistingIds.has(m.id) && !memberIsContributionExempt(m, selectedYear)
    );

    if (!freshMissing.length) {
      showToast("Alle Beiträge für " + selectedYear + " sind bereits angelegt.");
      setTimeout(() => location.reload(), 350);
      return;
    }

    const dueDate = dueDateForContributionYear(club, selectedYear);
    const rows = freshMissing.map(m => ({
      club_id: club.id,
      member_id: m.id,
      contribution_year: selectedYear,
      amount: Number(m.annual_fee || club.standard_fee || 0),
      due_date: dueDate,
      status: "open"
    }));

    const { error } = await sb.from("contributions").insert(rows);

    if (error) {
      if (error.code === "23505") {
        showToast("Einige Beiträge waren bereits vorhanden. Seite wird aktualisiert.");
        setTimeout(() => location.reload(), 450);
        return;
      }
      await handleAppError(error, "Beiträge konnten nicht angelegt werden.");
      btn.disabled = false;
      btn.textContent = "Fehlende Beiträge anlegen";
      return;
    }

    showToast(rows.length + " Beiträge für " + selectedYear + " angelegt ✓");
    setTimeout(() => location.reload(), 500);
  });

  const date = $("#collectionDate");
  if (date) {
    const dateOffsetIso = days => {
      const d = new Date();
      d.setHours(12, 0, 0, 0);
      d.setDate(d.getDate() + days);
      return [
        d.getFullYear(),
        String(d.getMonth() + 1).padStart(2, "0"),
        String(d.getDate()).padStart(2, "0")
      ].join("-");
    };
    date.min = dateOffsetIso(1);
    if (!date.value) date.value = dateOffsetIso(14);
  }

  $("#prepareSepa")?.addEventListener("click", async () => {
    const button = $("#prepareSepa");
    const currentClub = await getClub();
    const all = await loadContributions(selectedYear);
    const collectionDate = $("#collectionDate")?.value;
    const candidates = all.filter(c => c.status === "open" && !c.sepa_exported_at && (!c.due_date || c.due_date<=collectionDate));

    if (!candidates.length) {
      const prepared = all.filter(c => c.status === "open" && c.sepa_exported_at);
      showToast(prepared.length
        ? "Alle offenen Beiträge sind bereits als SEPA vorbereitet."
        : "Aktuell nichts einzuziehen: Alle Beiträge sind bereits bezahlt.");
      return;
    }

    const errors = validateSepaRows(currentClub, candidates, collectionDate);
    if (errors.length) {
      const first = errors[0];
      console.warn("SEPA-Prüfung:", errors);
      showToast(first + (errors.length > 1 ? " +" + (errors.length - 1) + " weitere Fehler." : ""));
      return;
    }

    button.disabled = true;
    button.textContent = "SEPA-Datei wird sicher vorbereitet …";

    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
    const suffix = globalThis.crypto?.randomUUID
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()
      : Math.random().toString(36).slice(2, 8).toUpperCase();
    const batchId = compactId("VF-" + selectedYear + "-" + stamp + "-" + suffix);

    try {
      const xml = buildSepaXml(currentClub, candidates, collectionDate, batchId);
      validateGeneratedSepaXml(xml, candidates);

      const ids = candidates.map(c => c.id);
      const { data: markedCount, error: markError } = await sb.rpc("mark_sepa_exported", {
        p_club_id: currentClub.id,
        p_contribution_ids: ids,
        p_collection_date: collectionDate,
        p_batch_id: batchId
      });

      if (markError) {
        const msg = String(markError.message || "");
        if (msg.includes("SEPA_ROWS_CHANGED")) {
          throw new Error("Beiträge wurden zwischenzeitlich verändert. Bitte Seite neu laden und erneut prüfen.");
        }
        if (msg.includes("INVALID_COLLECTION_DATE")) {
          throw new Error("Einzugsdatum muss mindestens morgen sein.");
        }
        throw markError;
      }

      if (Number(markedCount || 0) !== ids.length) {
        throw new Error("Nicht alle Lastschriften konnten sicher vorbereitet werden.");
      }

      downloadBlob(
        xml,
        "VEREINSFACH_SEPA_" + selectedYear + "_" + collectionDate + ".xml",
        "application/xml;charset=utf-8"
      );

      showToast(
        candidates.length + (candidates.length === 1
          ? " Lastschrift vorbereitet und heruntergeladen ✓"
          : " Lastschriften vorbereitet und heruntergeladen ✓")
      );

      setTimeout(() => location.reload(), 900);
    } catch (error) {
      console.error("SEPA-Datei:", error);
      showToast("SEPA-Datei konnte nicht sicher erstellt werden: " + (error?.message || "Prüfung fehlgeschlagen"));
      button.disabled = false;
      button.textContent = "SEPA-Datei fürs Online-Banking herunterladen";
    }
  });

  const reminderSheet = $("#reminderSheet");
  const reminderBatchSheet = $("#reminderBatchSheet");
  let activeReminderContribution = null;

  const openReminderForContribution = contribution => {
    if (!contribution) return;

    activeReminderContribution = contribution;
    const m = contribution.members || {};
    const text = friendlyReminder(contribution);
    const email = String(m.email || "").trim();

    $("#reminderText").value = text;
    $("#reminderTitle").textContent = memberFullName(m) + " erinnern";
    $("#reminderRecipient").textContent = email
      ? "E-Mail: " + email
      : "Keine E-Mail hinterlegt – Text kann kopiert werden.";
    $("#reminderContributionInfo").textContent =
      money(contribution.amount) + reminderDueText(contribution);

    const mail = $("#mailReminder");
    mail.href = "#";
    mail.classList.toggle("disabled-link", !email);
    mail.textContent = email ? "E-Mail öffnen" : "Keine E-Mail hinterlegt";

    openBackdrop(reminderSheet);
  };

  $("#closeReminder")?.addEventListener("click", () => {
    activeReminderContribution = null;
    closeBackdrop(reminderSheet);
  });

  reminderSheet?.addEventListener("click", e => {
    if (e.target === reminderSheet) {
      activeReminderContribution = null;
      closeBackdrop(reminderSheet);
    }
  });

  $("#openContributions")?.addEventListener("click", async e => {
    const button = e.target.closest(".tiny-action");
    if (!button) return;

    const id = button.dataset.id;
    const contribution = (await loadContributions(selectedYear))
      .find(row => row.id === id && row.status === "open" && !row.sepa_exported_at);

    if (!contribution) {
      showToast("Dieser Beitrag ist nicht mehr offen.");
      return;
    }

    openReminderForContribution(contribution);
  });

  $("#copyReminder")?.addEventListener("click", async () => {
    const textarea = $("#reminderText");
    const value = textarea.value;

    try {
      await navigator.clipboard.writeText(value);
    } catch {
      textarea.focus();
      textarea.select();
      document.execCommand("copy");
      textarea.setSelectionRange(0, 0);
    }

    showToast("Erinnerungstext kopiert ✓");
  });

  $("#mailReminder")?.addEventListener("click", e => {
    e.preventDefault();

    const contribution = activeReminderContribution;
    const m = contribution?.members || {};
    const email = String(m.email || "").trim();

    if (!contribution || !email) {
      showToast("Für dieses Mitglied ist keine E-Mail hinterlegt.");
      return;
    }

    const subject = reminderSubject(contribution);
    const body = $("#reminderText").value;
    location.href =
      "mailto:" + encodeURIComponent(email) +
      "?subject=" + encodeURIComponent(subject) +
      "&body=" + encodeURIComponent(body);
  });

  const renderReminderBatch = openRows => {
    const withEmail = openRows.filter(c => String(c.members?.email || "").trim());
    const withoutEmail = openRows.filter(c => !String(c.members?.email || "").trim());

    $("#reminderBatchCount").textContent = openRows.length;
    $("#reminderBatchEmailCount").textContent = withEmail.length;
    $("#reminderBatchMissingCount").textContent = withoutEmail.length;

    $("#reminderBatchList").innerHTML = openRows.map(c => {
      const m = c.members || {};
      const email = String(m.email || "").trim();

      return '<div class="reminder-batch-row">' +
        '<div><strong>' + esc(memberFullName(m)) + '</strong>' +
        '<span>' + esc(money(c.amount) + reminderDueText(c)) + '</span></div>' +
        '<div class="reminder-batch-contact">' +
          (email
            ? '<span class="reminder-email-ok">' + esc(email) + '</span>'
            : '<span class="reminder-email-missing">E-Mail fehlt</span>') +
          '<button type="button" data-batch-reminder-id="' + esc(c.id) + '">Öffnen</button>' +
        '</div>' +
      '</div>';
    }).join("");
  };

  $("#remindAll")?.addEventListener("click", async () => {
    const openRows = (await loadContributions(selectedYear))
      .filter(c => c.status === "open" && !c.sepa_exported_at);

    if (!openRows.length) {
      showToast("Keine unbehandelten offenen Beiträge. Bereits vorbereitete SEPA-Einzüge werden nicht erinnert.");
      return;
    }

    renderReminderBatch(openRows);
    openBackdrop(reminderBatchSheet);
  });

  $("#closeReminderBatch")?.addEventListener("click", () => closeBackdrop(reminderBatchSheet));

  reminderBatchSheet?.addEventListener("click", async e => {
    if (e.target === reminderBatchSheet) {
      closeBackdrop(reminderBatchSheet);
      return;
    }

    const button = e.target.closest("[data-batch-reminder-id]");
    if (!button) return;

    const contribution = (await loadContributions(selectedYear))
      .find(c => c.id === button.dataset.batchReminderId && c.status === "open" && !c.sepa_exported_at);

    if (!contribution) {
      showToast("Dieser Beitrag ist nicht mehr offen.");
      return;
    }

    closeBackdrop(reminderBatchSheet);
    openReminderForContribution(contribution);
  });

  $("#downloadReminderCsv")?.addEventListener("click", async () => {
    const openRows = (await loadContributions(selectedYear))
      .filter(c => c.status === "open" && !c.sepa_exported_at);

    if (!openRows.length) {
      closeBackdrop(reminderBatchSheet);
      showToast("Keine offenen Beiträge.");
      return;
    }

    const csvRows = [
      ["Name","E-Mail","Betrag","Fälligkeit","Betreff","Erinnerung"],
      ...openRows.map(c => {
        const m = c.members || {};
        return [
          memberFullName(m),
          m.email || "",
          Number(c.amount || 0).toFixed(2).replace(".", ","),
          c.due_date || "",
          reminderSubject(c),
          friendlyReminder(c)
        ];
      })
    ];

    const csv = csvRows
      .map(row => row.map(v => '"' + String(v).replace(/"/g,'""') + '"').join(";"))
      .join("\r\n");

    downloadBlob(
      "\uFEFF" + csv,
      "VEREINSFACH_Zahlungserinnerungen_" + selectedYear + ".csv",
      "text/csv;charset=utf-8"
    );

    showToast("Erinnerungsliste für " + selectedYear + " heruntergeladen ✓");
  });

}

(async function enhanceVereinsfach() {
  try {
    const needsAuth = $("#membersPage") || $("#contributionsPage");
    if (needsAuth) {
      const session = await requireSession();
      if (!session) return;
    }
    if ($("#membersPage")) await enhanceMemberPage();
    if ($("#contributionsPage")) await enhanceContributionPage();
  } catch (error) {
    console.error("VEREINSFACH features:", error);
  }
})();