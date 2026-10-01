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
    first_name: ["vorname", "firstname", "first", "rufname"],
    last_name: ["nachname", "lastname", "surname", "familienname"],
    full_name: ["name", "mitglied", "mitgliedname", "vollstaendigername", "vollername", "fullname", "namevorname"],
    group_name: ["gruppe", "abteilung", "mannschaft", "team", "bereich", "sektion", "sparte"],
    email: ["email", "emailadresse", "mail", "emailprivat", "emailkontakt"],
    iban: ["iban", "kontoiban", "bankiban"],
    annual_fee: ["beitrag", "jahresbeitrag", "mitgliedsbeitrag", "betrag", "beitrageuro", "beitragjahr"],
    member_number: ["mitgliedsnummer", "mitgliednr", "mitgliedsnr", "nummer", "membernumber", "mitgliedid"],
    mandate_reference: ["mandatsreferenz", "mandat", "mandate", "mandatref", "sepamandat", "referenz"],
    mandate_signed_at: ["mandatsdatum", "mandatdatum", "unterschriftsdatum", "mandatesigned", "mandatunterschriebenam"]
  };

  for (const [field, names] of Object.entries(aliases)) {
    const found = columns.find(col => names.includes(normalizeHeader(col)));
    if (found) map[field] = found;
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
  return errors;
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
  const mapped = rows.slice(0, 5).map((row, index) => {
    const member = mapImportRow(row, mapping, fallbackFee);
    return { member, errors: validateImportedMember(member), rowNo: index + 2 };
  });
  if (!mapped.length) return "";
  return '<strong>Vorschau</strong><div class="preview-table">' + mapped.map(item =>
    '<div class="' + (item.errors.length ? 'preview-error' : '') + '"><span>' +
    esc(memberFullName(item.member)) +
    (item.errors.length ? '<em>Zeile ' + item.rowNo + ': ' + esc(item.errors.join(", ")) + '</em>' : '') +
    '</span><small>' + esc(item.member.group_name || "Ohne Gruppe") + ' · ' + esc(money(item.member.annual_fee)) + '</small></div>'
  ).join("") + '</div>';
}

async function importPreparedMembers(rows, mapping, club) {
  const existing = await loadAllMembersForImport();
  const existingKeys = new Set(existing.flatMap(m => [
    m.member_number ? "n:" + String(m.member_number).toLowerCase() : null,
    m.email ? "e:" + m.email.toLowerCase() : null,
    "x:" + (memberFullName(m) + "|" + (m.group_name || "")).toLowerCase()
  ].filter(Boolean)));

  const usedNumbers = new Set(existing.map(m => String(m.member_number || "")).filter(Boolean));
  rows.forEach(row => {
    const mapped = mapImportRow(row, mapping, club.standard_fee);
    if (mapped.member_number) usedNumbers.add(String(mapped.member_number));
  });

  let nextNumber = 1001;
  const nextFreeNumber = () => {
    while (usedNumbers.has(String(nextNumber))) nextNumber++;
    const value = String(nextNumber++);
    usedNumbers.add(value);
    return value;
  };

  const prepared = [];
  const errors = [];
  const duplicates = [];

  rows.forEach((row, index) => {
    const rowNo = index + 2;
    const m = mapImportRow(row, mapping, club.standard_fee);
    const rowErrors = validateImportedMember(m);

    if (rowErrors.length) {
      errors.push({ row: rowNo, name: memberFullName(m), reasons: rowErrors, member: { ...m } });
      return;
    }

    if (!m.member_number) m.member_number = nextFreeNumber();

    const keys = [
      m.member_number ? "n:" + m.member_number.toLowerCase() : null,
      m.email ? "e:" + m.email.toLowerCase() : null,
      "x:" + (memberFullName(m) + "|" + (m.group_name || "")).toLowerCase()
    ].filter(Boolean);

    if (keys.some(k => existingKeys.has(k))) {
      duplicates.push({ row: rowNo, name: memberFullName(m), reasons: ["Dublette"], member: { ...m } });
      return;
    }

    keys.forEach(k => existingKeys.add(k));
    if (m.member_number) usedNumbers.add(String(m.member_number));

    prepared.push({
      ...m,
      club_id: club.id,
      active: true,
      updated_at: new Date().toISOString()
    });
  });

  if (!prepared.length) {
    return {
      inserted: 0,
      errors,
      duplicates,
      total: rows.length
    };
  }

  const { data: created, error } = await sb.from("members").insert(prepared).select();
  if (error) throw error;

  const dueDate = dueDateForContributionYear(club, currentYear);
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
    if (contributionError) {
      await sb.from("members").delete().in("id", created.map(m => m.id));
      throw contributionError;
    }
  }

  return {
    inserted: created.length,
    errors,
    duplicates,
    total: rows.length
  };
}
window.importPreparedMembers = importPreparedMembers;

async function importCorrectedMembers(members, club) {
  const existing = await loadAllMembersForImport();
  const existingKeys = new Set(existing.flatMap(m => [
    m.member_number ? "n:" + String(m.member_number).toLowerCase() : null,
    m.email ? "e:" + m.email.toLowerCase() : null,
    "x:" + (memberFullName(m) + "|" + (m.group_name || "")).toLowerCase()
  ].filter(Boolean)));

  const usedNumbers = new Set(existing.map(m => String(m.member_number || "")).filter(Boolean));
  members.forEach(m => { if (m.member_number) usedNumbers.add(String(m.member_number)); });

  let nextNumber = 1001;
  const nextFreeNumber = () => {
    while (usedNumbers.has(String(nextNumber))) nextNumber++;
    const value = String(nextNumber++);
    usedNumbers.add(value);
    return value;
  };

  const prepared = [];
  const errors = [];
  const duplicates = [];

  members.forEach((source, index) => {
    const m = {
      first_name: String(source.first_name || "").trim(),
      last_name: String(source.last_name || "").trim(),
      group_name: String(source.group_name || "").trim() || null,
      email: String(source.email || "").trim() || null,
      iban: normalizeIban(source.iban) || null,
      annual_fee: parseFee(source.annual_fee, club.standard_fee),
      member_number: String(source.member_number || "").trim() || null,
      mandate_reference: String(source.mandate_reference || "").trim() || null,
      mandate_signed_at: source.mandate_signed_at ? parseDateValue(source.mandate_signed_at) : null
    };

    const rowNo = source.__row || index + 1;
    const rowErrors = validateImportedMember(m);
    if (source.mandate_signed_at && !m.mandate_signed_at) rowErrors.push("Mandatsdatum ungültig");

    if (rowErrors.length) {
      errors.push({ row: rowNo, name: memberFullName(m), reasons: [...new Set(rowErrors)], member: { ...m, __row: rowNo } });
      return;
    }

    if (!m.member_number) m.member_number = nextFreeNumber();

    const keys = [
      m.member_number ? "n:" + m.member_number.toLowerCase() : null,
      m.email ? "e:" + m.email.toLowerCase() : null,
      "x:" + (memberFullName(m) + "|" + (m.group_name || "")).toLowerCase()
    ].filter(Boolean);

    if (keys.some(k => existingKeys.has(k))) {
      duplicates.push({ row: rowNo, name: memberFullName(m), reasons: ["Dublette"], member: { ...m, __row: rowNo } });
      return;
    }

    keys.forEach(k => existingKeys.add(k));
    prepared.push({ ...m, club_id: club.id, active: true, updated_at: new Date().toISOString() });
  });

  if (!prepared.length) return { inserted: 0, errors, duplicates };

  const { data: created, error } = await sb.from("members").insert(prepared).select();
  if (error) throw error;

  const dueDate = dueDateForContributionYear(club, currentYear);
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
    if (contributionError) {
      await sb.from("members").delete().in("id", created.map(m => m.id));
      throw contributionError;
    }
  }

  return { inserted: created.length, errors, duplicates };
}

async function applyDuplicateActions(actions, club) {
  if (!actions?.length) return { updated: 0, created: 0, renumbered: 0 };

  let existing = await loadAllMembersForImport();
  const usedNumbers = new Set(existing.map(m => String(m.member_number || "")).filter(Boolean));
  let nextNumber = 1001;

  const nextFreeNumber = () => {
    while (usedNumbers.has(String(nextNumber))) nextNumber++;
    const value = String(nextNumber++);
    usedNumbers.add(value);
    return value;
  };

  let updated = 0;
  let created = 0;
  let renumbered = 0;
  const dueDate = dueDateForContributionYear(club, currentYear);

  for (const action of actions) {
    const source = action.member || {};
    const member = {
      first_name: String(source.first_name || "").trim(),
      last_name: String(source.last_name || "").trim(),
      group_name: String(source.group_name || "").trim() || null,
      email: String(source.email || "").trim() || null,
      iban: normalizeIban(source.iban) || null,
      annual_fee: parseFee(source.annual_fee, club.standard_fee),
      member_number: String(source.member_number || "").trim() || null,
      mandate_reference: String(source.mandate_reference || "").trim() || null,
      mandate_signed_at: source.mandate_signed_at ? parseDateValue(source.mandate_signed_at) : null
    };

    const errors = validateImportedMember(member);
    if (errors.length) throw new Error("Importzeile " + action.row + ": " + errors.join(", "));

    if (action.action === "update") {
      const target = existing.find(m => m.id === action.target_id);
      if (!target) throw new Error("Bestehendes Mitglied für Zeile " + action.row + " wurde nicht gefunden.");

      if (member.member_number) {
        const numberOwner = existing.find(m =>
          m.id !== target.id &&
          String(m.member_number || "").toLowerCase() === member.member_number.toLowerCase()
        );
        if (numberOwner) {
          member.member_number = target.member_number || nextFreeNumber();
          renumbered++;
        }
      } else {
        member.member_number = target.member_number || nextFreeNumber();
      }

      const { error } = await sb.from("members").update({
        ...member,
        active: true,
        updated_at: new Date().toISOString()
      }).eq("id", target.id);
      if (error) throw error;

      const { data: currentContribution, error: contributionLoadError } = await sb
        .from("contributions")
        .select("id,status")
        .eq("member_id", target.id)
        .eq("contribution_year", currentYear)
        .maybeSingle();
      if (contributionLoadError) throw contributionLoadError;

      if (currentContribution) {
        if (currentContribution.status !== "paid") {
          const { error: amountError } = await sb.from("contributions").update({
            amount: Number(member.annual_fee || 0),
            updated_at: new Date().toISOString()
          }).eq("id", currentContribution.id);
          if (amountError) throw amountError;
        }
      } else {
        const { error: contributionError } = await sb.from("contributions").insert({
          club_id: club.id,
          member_id: target.id,
          contribution_year: currentYear,
          amount: Number(member.annual_fee || 0),
          due_date: dueDate,
          status: "open"
        });
        if (contributionError) throw contributionError;
      }

      updated++;
      existing = existing.map(m => m.id === target.id ? { ...m, ...member, active: true } : m);
      usedNumbers.add(String(member.member_number || ""));
      continue;
    }

    if (action.action === "create") {
      if (!member.member_number || usedNumbers.has(String(member.member_number))) {
        member.member_number = nextFreeNumber();
        renumbered++;
      } else {
        usedNumbers.add(String(member.member_number));
      }

      const { data: createdMember, error } = await sb.from("members").insert({
        ...member,
        club_id: club.id,
        active: true,
        updated_at: new Date().toISOString()
      }).select().single();
      if (error) throw error;

      const { error: contributionError } = await sb.from("contributions").insert({
        club_id: club.id,
        member_id: createdMember.id,
        contribution_year: currentYear,
        amount: Number(member.annual_fee || 0),
        due_date: dueDate,
        status: "open"
      });

      if (contributionError) {
        await sb.from("members").delete().eq("id", createdMember.id);
        throw contributionError;
      }

      existing.push(createdMember);
      created++;
    }
  }

  return { updated, created, renumbered };
}

function correctionValue(member, key) {
  const value = member?.[key];
  return value == null ? "" : String(value);
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
          '<label><span>Gruppe / Abteilung</span><input data-correct="group_name" value="' + esc(correctionValue(m,"group_name")) + '"></label>' +
          '<label><span>E-Mail</span><input data-correct="email" value="' + esc(correctionValue(m,"email")) + '"></label>' +
          '<label><span>IBAN</span><input data-correct="iban" value="' + esc(correctionValue(m,"iban")) + '"></label>' +
          '<label><span>Jahresbeitrag</span><input data-correct="annual_fee" value="' + esc(correctionValue(m,"annual_fee")) + '"></label>' +
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

async function readImportFile(file) {
  if (!window.XLSX) throw new Error("Excel-Import ist noch nicht geladen.");
  const name = String(file?.name || "").toLowerCase();
  if (!/\.(csv|xlsx|xls)$/.test(name)) throw new Error("Bitte eine CSV-, XLSX- oder XLS-Datei auswählen.");
  if (file.size > 8 * 1024 * 1024) throw new Error("Die Datei ist zu groß. Maximal 8 MB.");
  const data = await file.arrayBuffer();
  const wb = XLSX.read(data, { type: "array", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: "", raw: true });
  if (!rows.length) throw new Error("Die Datei enthält keine Daten.");
  const columns = Object.keys(rows[0]);
  return { file, rows, columns, mapping: autoMapColumns(columns) };
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

    const m = {
      first_name: String(source.first_name || "").trim(),
      last_name: String(source.last_name || "").trim(),
      group_name: String(source.group_name || "").trim() || null,
      email: String(source.email || "").trim() || null,
      iban: normalizeIban(source.iban) || null,
      annual_fee: parseFee(source.annual_fee, club.standard_fee),
      member_number: String(source.member_number || "").trim() || null,
      mandate_reference: String(source.mandate_reference || "").trim() || null,
      mandate_signed_at: parsedDate
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
    const lines = [
      ["Mitgliedsnummer","Vorname","Nachname","Gruppe","E-Mail","Beitragsart","IBAN","Jahresbeitrag","Mandatsreferenz","Mandatsdatum"],
      ...members.map(m => [m.member_number||"",m.first_name,m.last_name,m.group_name||"",m.email||"",m.contribution_label||"",m.iban||"",m.annual_fee||0,m.mandate_reference||"",m.mandate_signed_at||""])
    ];
    const csv = lines.map(row => row.map(v => '"' + String(v).replace(/"/g,'""') + '"').join(";")).join("\r\n");
    downloadBlob("\uFEFF" + csv, "VEREINSANKER_Mitglieder.csv", "text/csv;charset=utf-8");
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

      runImport.textContent = "Wird importiert …";

      const result = candidates.length
        ? await importCorrectedMembers(candidates, club)
        : { inserted: 0, errors: [], duplicates: [] };

      if (result.errors.length || result.duplicates.length) {
        vaImportState.valid = [];
        vaImportState.duplicateActions = [];
        vaImportState.corrections = [...result.errors, ...result.duplicates];
        renderImportCorrections(vaImportState.corrections);
        importHint.innerHTML =
          '<strong>Import gestoppt.</strong> ' +
          vaImportState.corrections.length + ' Zeile(n) müssen nochmals geprüft werden.';
        runImport.disabled = false;
        runImport.textContent = "Korrekturen prüfen";
        return;
      }

      const duplicateResult = await applyDuplicateActions(duplicateActions, club);
      const messages = [];
      if (result.inserted) messages.push(result.inserted + " neu importiert");
      if (duplicateResult.updated) messages.push(duplicateResult.updated + " aktualisiert");
      if (duplicateResult.created) messages.push(duplicateResult.created + " zusätzlich neu angelegt");

      closeBackdrop(importSheet);
      showToast((messages.join(" · ") || "Import abgeschlossen") + " ✓");
      setTimeout(() => location.reload(), 700);
    } catch (error) {
      await handleAppError(error, error?.message || "Import fehlgeschlagen. Es wurden keine weiteren Daten gespeichert.");
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
    $("#editMemberGroup").value = data.group_name || "";
    $("#editMemberEmail").value = data.email || "";
    setupMemberContributionSelect(
      $("#editMemberContributionType"),
      $("#editMemberFee"),
      memberContributionTypes,
      memberClub,
      data
    );
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
    const payload = {
      member_number: $("#editMemberNumber").value.trim() || null,
      first_name: $("#editFirstName").value.trim(),
      last_name: $("#editLastName").value.trim(),
      group_name: $("#editMemberGroup").value.trim() || null,
      email: $("#editMemberEmail").value.trim() || null,
      annual_fee: amount,
      contribution_type_id: selectedContribution.contribution_type_id,
      contribution_label: selectedContribution.contribution_label,
      iban: editIban || null,
      mandate_reference: editMandate || null,
      mandate_signed_at: $("#editMemberMandateDate").value || null,
      updated_at: new Date().toISOString()
    };
    const { error } = await sb.from("members").update(payload).eq("id", id);
    if (error) {
      const message = String(error?.message || "") + " " + String(error?.details || "");
      if (error.code === "23505" && /mandate_reference|members_club_mandate_reference_uidx/i.test(message)) {
        return showToast("Diese Mandatsreferenz ist bereits vergeben.");
      }
      if (error.code === "23505") return showToast("Diese Mitgliedsnummer ist bereits vergeben.");
      await handleAppError(error, "Änderung konnte nicht gespeichert werden.");
      return;
    }

    const { error: contributionError } = await sb
      .from("contributions")
      .update({ amount, updated_at: new Date().toISOString() })
      .eq("member_id", id)
      .eq("contribution_year", currentYear)
      .neq("status", "paid");

    if (contributionError) {
      await handleAppError(contributionError, "Mitglied wurde gespeichert, der offene Beitrag konnte aber nicht angepasst werden.");
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

  const today = new Date().toISOString().slice(0,10);
  if (validSepaDate(collectionDate) && collectionDate < today) {
    errors.push("Einzugsdatum darf nicht in der Vergangenheit liegen.");
  }

  rows.forEach((c, index) => {
    const m = c.members || {};
    const label = memberFullName(m) || ("Zeile " + (index + 1));
    const amount = Number(c.amount || 0);
    const mandate = safeSepaText(m.mandate_reference, 35);
    const debtorName = safeSepaText(memberFullName(m), 70);

    if (!Number.isFinite(amount) || amount < 0.01 || amount > 999999999.99) {
      errors.push(label + ": Betrag muss zwischen 0,01 € und 999.999.999,99 € liegen.");
    }
    if (!validIban(m.iban)) errors.push(label + ": IBAN ungültig.");
    if (!debtorName) errors.push(label + ": Name ist für SEPA nicht verwendbar.");
    if (!mandate) errors.push(label + ": Mandatsreferenz fehlt oder enthält keine zulässigen Zeichen.");
    if (!validSepaDate(m.mandate_signed_at)) errors.push(label + ": Mandatsdatum ungültig.");
    else if (m.mandate_signed_at > today) errors.push(label + ": Mandatsdatum liegt in der Zukunft.");
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

function buildSepaXml(club, rows, collectionDate) {
  const now = new Date();
  const contributionYear = Number(rows?.[0]?.contribution_year || contributionYearFromUrl() || currentYear);
  const stamp = now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const msgId = compactId("VA-" + stamp);
  const pmtId = compactId("VA-DD-" + contributionYear + "-" + stamp.slice(-6));
  const total = rows.reduce((sum, c) => sum + Number(c.amount || 0), 0).toFixed(2);
  const creditorIban = normalizeIban(club.iban);
  const creditorName = safeSepaText(club.name, 70);
  const creditorId = normalizeCreditorIdValue(club.creditor_id);

  const txs = rows.map((c, index) => {
    const m = c.members || {};
    const endToEnd = compactId("VA-" + (m.member_number || String(index + 1)) + "-" + contributionYear);
    const mandateId = safeSepaText(m.mandate_reference, 35);
    const debtorName = safeSepaText(memberFullName(m), 70);

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

  return `Hallo ${memberFullName(m)},

für deinen Mitgliedsbeitrag ${contributionYear} sind noch ${money(c.amount)} offen${dueText}.

Wir möchten dich freundlich daran erinnern, den Beitrag zu überweisen bzw. den Zahlungseingang zu prüfen.

Falls die Zahlung bereits unterwegs ist, kannst du diese Nachricht einfach ignorieren.

Viele Grüße
${vaClub?.name || "Euer Verein"}`;
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
    ? members.filter(m => !existingIds.has(m.id))
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
    const freshMissing = freshMembers.filter(m => !freshExistingIds.has(m.id));

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
  if (date && !date.value) {
    const d = new Date();
    d.setDate(d.getDate() + 5);
    date.value = d.toISOString().slice(0, 10);
  }

  $("#prepareSepa")?.addEventListener("click", async () => {
    const currentClub = await getClub();
    const all = await loadContributions(selectedYear);
    const collectionDate = $("#collectionDate")?.value;
    const openRows = all.filter(c => c.status !== "paid");

    if (!openRows.length) {
      showToast("Aktuell nichts einzuziehen: Alle Beiträge sind bereits bezahlt.");
      return;
    }

    const exportRows = openRows.filter(c => Number(c.amount || 0) >= 0.01);
    const errors = validateSepaRows(currentClub, exportRows, collectionDate);

    if (errors.length) {
      const first = errors[0];
      console.warn("SEPA-Prüfung:", errors);
      showToast(first + (errors.length > 1 ? " +" + (errors.length - 1) + " weitere Fehler." : ""));
      return;
    }

    try {
      const xml = buildSepaXml(currentClub, exportRows, collectionDate);
      validateGeneratedSepaXml(xml, exportRows);

      downloadBlob(
        xml,
        "VEREINSANKER_SEPA_" + selectedYear + "_" + collectionDate + ".xml",
        "application/xml;charset=utf-8"
      );
      showToast("SEPA-Datei für " + selectedYear + " geprüft und erstellt ✓");
    } catch (error) {
      console.error("SEPA-Datei:", error);
      showToast("SEPA-Datei konnte nicht sicher erstellt werden: " + (error?.message || "Prüfung fehlgeschlagen"));
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
      .find(row => row.id === id && row.status !== "paid");

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
      .filter(c => c.status !== "paid");

    if (!openRows.length) {
      showToast("Keine offenen Beiträge.");
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
      .find(c => c.id === button.dataset.batchReminderId && c.status !== "paid");

    if (!contribution) {
      showToast("Dieser Beitrag ist nicht mehr offen.");
      return;
    }

    closeBackdrop(reminderBatchSheet);
    openReminderForContribution(contribution);
  });

  $("#downloadReminderCsv")?.addEventListener("click", async () => {
    const openRows = (await loadContributions(selectedYear))
      .filter(c => c.status !== "paid");

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
      "VEREINSANKER_Zahlungserinnerungen_" + selectedYear + ".csv",
      "text/csv;charset=utf-8"
    );

    showToast("Erinnerungsliste für " + selectedYear + " heruntergeladen ✓");
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
      const mappingOkay = state.mapping.full_name || (state.mapping.first_name && state.mapping.last_name);
      const mapped = mappingOkay
        ? state.rows.map(row => mapImportRow(row, state.mapping, 0))
        : [];
      const errorCount = mapped.filter(member => validateImportedMember(member).length).length;

      state.blocked = !mappingOkay || errorCount > 0;
      window.vaOnboardingImportState = state;

      const drop = $(".drop");
      if (drop) {
        $("strong", drop).textContent = file.name;
        if (!mappingOkay) {
          $("span", drop).textContent = "Namensspalten nicht erkannt · Liste nach der Einrichtung unter „Mitglieder“ importieren.";
        } else if (errorCount) {
          $("span", drop).textContent = errorCount + " Zeile(n) mit Fehlern · bitte nach der Einrichtung unter „Mitglieder“ prüfen.";
        } else {
          $("span", drop).textContent = state.rows.length + " Mitglieder erkannt und geprüft ✓";
        }
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