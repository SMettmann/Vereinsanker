window.initFinancesPage = async function () {
  let club = await getClub();
  if (!club) {
    location.replace("onboarding.html");
    return;
  }
  applyClubBrand(club);
  applyTrialUI(club);

  const incomeCategories = ["Spende","Zuschuss","Sponsoring","Veranstaltung","Verkauf","Mieteinnahme","Sonstiges"];
  const expenseCategories = ["Verbandsgebühr","Versicherung","Material","Miete","Trainer / Übungsleiter","Fahrtkosten","Veranstaltung","Verwaltung","Sonstiges"];
  const yearSelect = $("#financeYearSelect");
  const typeFilter = $("#financeTypeFilter");
  const categoryFilter = $("#financeCategoryFilter");
  const searchInput = $("#financeSearch");
  const sheet = $("#financeSheet");
  const form = $("#financeForm");
  let selectedYear = currentYear;
  let manualRows = [];
  let contributionRows = [];
  let openContributions = [];

  function yearStart(year) { return year + "-01-01T00:00:00"; }
  function nextYearStart(year) { return (year + 1) + "-01-01T00:00:00"; }
  function dateOnly(value) { return value ? String(value).slice(0, 10) : ""; }
  function dateLabel(value) {
    if (!value) return "–";
    const parts = String(value).slice(0,10).split("-");
    return parts.length === 3 ? parts[2] + "." + parts[1] + "." + parts[0] : value;
  }
  function paymentLabel(value) { return value === "cash" ? "Kasse" : "Bank"; }

  function setCategoryOptions(type, selected) {
    const list = type === "expense" ? expenseCategories : incomeCategories;
    $("#financeCategory").innerHTML = list.map(function (cat) {
      return '<option value="' + esc(cat) + '"' + (cat === selected ? ' selected' : '') + '>' + esc(cat) + '</option>';
    }).join("");
  }

  async function loadYears() {
    const [financeResult, contributionResult] = await Promise.all([
      sb.from("finance_transactions").select("transaction_date").order("transaction_date", { ascending: false }),
      sb.from("contributions").select("paid_at").eq("status", "paid").not("paid_at", "is", null).order("paid_at", { ascending: false })
    ]);
    if (financeResult.error) throw financeResult.error;
    if (contributionResult.error) throw contributionResult.error;

    const years = new Set([currentYear]);
    (financeResult.data || []).forEach(function (row) {
      const y = Number(String(row.transaction_date || "").slice(0,4));
      if (y) years.add(y);
    });
    (contributionResult.data || []).forEach(function (row) {
      const y = Number(String(row.paid_at || "").slice(0,4));
      if (y) years.add(y);
    });
    for (let y = currentYear - 2; y <= currentYear + 1; y++) years.add(y);
    const sorted = Array.from(years).sort(function (a,b) { return b-a; });
    yearSelect.innerHTML = sorted.map(function (y) {
      return '<option value="' + y + '"' + (y === selectedYear ? ' selected' : '') + '>' + y + '</option>';
    }).join("");
  }

  async function loadData() {
    const start = yearStart(selectedYear);
    const end = nextYearStart(selectedYear);
    const results = await Promise.all([
      sb.from("finance_transactions").select("*").gte("transaction_date", selectedYear + "-01-01").lte("transaction_date", selectedYear + "-12-31").order("transaction_date", { ascending: false }).order("created_at", { ascending: false }),
      sb.from("contributions").select("id,amount,paid_at,contribution_year,members(first_name,last_name)").eq("status","paid").gte("paid_at", start).lt("paid_at", end).order("paid_at", { ascending: false }),
      sb.from("contributions").select("id,amount,status,contribution_year").eq("contribution_year", selectedYear).neq("status","paid")
    ]);
    if (results[0].error) throw results[0].error;
    if (results[1].error) throw results[1].error;
    if (results[2].error) throw results[2].error;
    manualRows = results[0].data || [];
    contributionRows = results[1].data || [];
    openContributions = results[2].data || [];
    render();
  }

  function combinedRows() {
    const manual = manualRows.map(function (r) {
      return {
        source: "manual",
        id: r.id,
        transaction_date: r.transaction_date,
        type: r.type,
        category: r.category,
        description: r.description || "",
        amount: Number(r.amount || 0),
        payment_method: r.payment_method || "bank",
        receipt_path: r.receipt_path || ""
      };
    });
    const contributions = contributionRows.map(function (r) {
      const m = r.members || {};
      return {
        source: "contribution",
        id: r.id,
        transaction_date: dateOnly(r.paid_at),
        type: "income",
        category: "Mitgliedsbeitrag",
        description: memberFullName(m),
        amount: Number(r.amount || 0),
        payment_method: "bank",
        receipt_path: ""
      };
    });
    return manual.concat(contributions).sort(function (a,b) {
      return String(b.transaction_date).localeCompare(String(a.transaction_date));
    });
  }

  function renderSummary() {
    const manualIncome = manualRows.filter(function (r) { return r.type === "income"; }).reduce(function (s,r) { return s + Number(r.amount || 0); }, 0);
    const contributionIncome = contributionRows.reduce(function (s,r) { return s + Number(r.amount || 0); }, 0);
    const expenses = manualRows.filter(function (r) { return r.type === "expense"; }).reduce(function (s,r) { return s + Number(r.amount || 0); }, 0);
    const income = manualIncome + contributionIncome;
    const balance = income - expenses;
    const open = openContributions.reduce(function (s,r) { return s + Number(r.amount || 0); }, 0);

    $("#financeBalance").textContent = money(balance);
    $("#financeBalance").classList.toggle("negative", balance < 0);
    $("#financeIncome").textContent = money(income);
    $("#financeExpenses").textContent = money(expenses);
    $("#financeOpen").textContent = money(open);
  }

  function renderCategoryFilter(rows) {
    const current = categoryFilter.value;
    const categories = Array.from(new Set(rows.map(function (r) { return r.category; }).filter(Boolean))).sort();
    categoryFilter.innerHTML = '<option value="">Alle Kategorien</option>' + categories.map(function (cat) {
      return '<option value="' + esc(cat) + '"' + (cat === current ? ' selected' : '') + '>' + esc(cat) + '</option>';
    }).join("");
  }

  function renderRows() {
    const rows = combinedRows();
    renderCategoryFilter(rows);
    const q = String(searchInput.value || "").trim().toLowerCase();
    const type = typeFilter.value;
    const category = categoryFilter.value;
    const filtered = rows.filter(function (r) {
      if (type && r.type !== type) return false;
      if (category && r.category !== category) return false;
      const hay = (r.category + " " + r.description + " " + paymentLabel(r.payment_method)).toLowerCase();
      return !q || hay.indexOf(q) >= 0;
    });

    const host = $("#financeRows");
    if (!filtered.length) {
      host.innerHTML = '<div class="empty-row"><strong>Keine Buchungen gefunden</strong><span>Für dieses Jahr oder den Filter gibt es keine Einträge.</span></div>';
      return;
    }

    host.innerHTML = filtered.map(function (r) {
      const actions = r.source === "manual"
        ? '<div class="finance-row-actions"><button type="button" data-finance-edit="' + esc(r.id) + '">Bearbeiten</button>' + (r.receipt_path ? '<button type="button" data-finance-receipt="' + esc(r.receipt_path) + '">Beleg</button>' : '') + '</div>'
        : '<div class="finance-row-actions"><span class="finance-readonly">aus Beiträge</span></div>';
      return '<div class="finance-row ' + esc(r.type) + '">' +
        '<span>' + esc(dateLabel(r.transaction_date)) + '</span>' +
        '<div class="finance-row-main"><strong>' + esc(r.category) + '</strong><span>' + esc(r.description || "Ohne Beschreibung") + '</span></div>' +
        '<span>' + esc(paymentLabel(r.payment_method)) + '</span>' +
        '<span class="finance-amount">' + (r.type === "expense" ? "− " : "+ ") + esc(money(r.amount)) + '</span>' +
        actions +
      '</div>';
    }).join("");
  }

  function render() {
    renderSummary();
    renderRows();
  }

  function resetForm(type) {
    form.reset();
    $("#financeId").value = "";
    $("#financeOldReceipt").value = "";
    $("#financeType").value = type || "income";
    $("#financeDate").value = new Date().toISOString().slice(0,10);
    $("#financePayment").value = "bank";
    setCategoryOptions($("#financeType").value);
    $("#financeSheetTitle").textContent = $("#financeType").value === "expense" ? "Ausgabe erfassen" : "Einnahme erfassen";
    $("#deleteFinance").hidden = true;
    $("#financeExistingReceipt").hidden = true;
  }

  function openNew(type) {
    resetForm(type);
    openBackdrop(sheet);
  }

  function openEdit(id) {
    const row = manualRows.find(function (r) { return r.id === id; });
    if (!row) return;
    resetForm(row.type);
    $("#financeId").value = row.id;
    $("#financeOldReceipt").value = row.receipt_path || "";
    $("#financeType").value = row.type;
    $("#financeDate").value = row.transaction_date;
    setCategoryOptions(row.type, row.category);
    $("#financeAmount").value = Number(row.amount || 0);
    $("#financePayment").value = row.payment_method || "bank";
    $("#financeDescription").value = row.description || "";
    $("#financeSheetTitle").textContent = "Buchung bearbeiten";
    $("#deleteFinance").hidden = false;
    $("#financeExistingReceipt").hidden = !row.receipt_path;
    if (row.receipt_path) $("#financeExistingReceipt").dataset.path = row.receipt_path;
    openBackdrop(sheet);
  }

  async function openReceipt(path) {
    if (!path) return;
    const result = await sb.storage.from("finance-receipts").createSignedUrl(path, 120);
    if (result.error) {
      await handleAppError(result.error, "Beleg konnte nicht geöffnet werden.");
      return;
    }
    window.open(result.data.signedUrl, "_blank", "noopener");
  }

  async function uploadReceipt(transactionId, file, oldPath) {
    if (!file) return oldPath || null;
    if (file.size > 10485760) throw new Error("Beleg ist größer als 10 MB.");
    const allowed = ["application/pdf","image/png","image/jpeg","image/webp"];
    if (allowed.indexOf(file.type) < 0) throw new Error("Dieses Belegformat wird nicht unterstützt.");
    const safeName = String(file.name || "beleg").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-90);
    const path = club.id + "/" + transactionId + "/" + Date.now() + "-" + safeName;
    const upload = await sb.storage.from("finance-receipts").upload(path, file, { upsert:false, contentType:file.type });
    if (upload.error) throw upload.error;
    const update = await sb.from("finance_transactions").update({ receipt_path:path, updated_at:new Date().toISOString() }).eq("id", transactionId);
    if (update.error) {
      await sb.storage.from("finance-receipts").remove([path]);
      throw update.error;
    }
    if (oldPath && oldPath !== path) await sb.storage.from("finance-receipts").remove([oldPath]);
    return path;
  }

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    const button = $("#saveFinance");
    const id = $("#financeId").value;
    const amount = Number($("#financeAmount").value || 0);
    if (!(amount > 0)) {
      $("#financeAmount").focus();
      showToast("Bitte einen Betrag größer als 0 eingeben.");
      return;
    }
    button.disabled = true;
    button.textContent = "Wird gespeichert …";
    try {
      const payload = {
        club_id: club.id,
        transaction_date: $("#financeDate").value,
        type: $("#financeType").value,
        category: $("#financeCategory").value,
        description: $("#financeDescription").value.trim() || null,
        amount: amount,
        payment_method: $("#financePayment").value,
        updated_at: new Date().toISOString()
      };
      let saved;
      if (id) {
        const result = await sb.from("finance_transactions").update(payload).eq("id", id).select().single();
        if (result.error) throw result.error;
        saved = result.data;
      } else {
        const result = await sb.from("finance_transactions").insert(payload).select().single();
        if (result.error) throw result.error;
        saved = result.data;
      }
      $("#financeId").value = saved.id;
      $("#financeOldReceipt").value = saved.receipt_path || $("#financeOldReceipt").value || "";
      const file = $("#financeReceipt").files[0];
      if (file) await uploadReceipt(saved.id, file, $("#financeOldReceipt").value || saved.receipt_path);
      closeBackdrop(sheet);
      showToast("Buchung gespeichert ✓");
      await loadData();
      await loadYears();
    } catch (error) {
      await handleAppError(error, error && error.message ? error.message : "Buchung konnte nicht gespeichert werden.");
    } finally {
      button.disabled = false;
      button.textContent = "Buchung speichern";
    }
  });

  $("#deleteFinance").addEventListener("click", async function () {
    const id = $("#financeId").value;
    const row = manualRows.find(function (r) { return r.id === id; });
    if (!row || !confirm("Diese Buchung wirklich löschen?")) return;
    const result = await sb.from("finance_transactions").delete().eq("id", id);
    if (result.error) {
      await handleAppError(result.error, "Buchung konnte nicht gelöscht werden.");
      return;
    }
    if (row.receipt_path) await sb.storage.from("finance-receipts").remove([row.receipt_path]);
    closeBackdrop(sheet);
    showToast("Buchung gelöscht");
    await loadData();
  });

  $$("[data-finance-new]").forEach(function (button) {
    button.addEventListener("click", function () { openNew(button.dataset.financeNew); });
  });
  $("#closeFinanceSheet").addEventListener("click", function () { closeBackdrop(sheet); });
  sheet.addEventListener("click", function (e) { if (e.target === sheet) closeBackdrop(sheet); });
  $("#financeType").addEventListener("change", function () {
    setCategoryOptions($("#financeType").value);
    if (!$("#financeId").value) $("#financeSheetTitle").textContent = $("#financeType").value === "expense" ? "Ausgabe erfassen" : "Einnahme erfassen";
  });
  $("#financeRows").addEventListener("click", function (e) {
    const edit = e.target.closest("[data-finance-edit]");
    const receipt = e.target.closest("[data-finance-receipt]");
    if (edit) openEdit(edit.dataset.financeEdit);
    if (receipt) openReceipt(receipt.dataset.financeReceipt);
  });
  $("#financeExistingReceipt").addEventListener("click", function () { openReceipt($("#financeExistingReceipt").dataset.path); });
  searchInput.addEventListener("input", renderRows);
  typeFilter.addEventListener("change", renderRows);
  categoryFilter.addEventListener("change", renderRows);
  yearSelect.addEventListener("change", async function () {
    selectedYear = Number(yearSelect.value) || currentYear;
    await loadData();
  });
  $("#financePrint").addEventListener("click", function () { window.print(); });
  $("#financeExport").addEventListener("click", function () {
    const rows = combinedRows();
    const header = ["Datum","Art","Kategorie","Beschreibung","Zahlungsart","Betrag"];
    const table = [header].concat(rows.map(function (r) {
      return [r.transaction_date, r.type === "income" ? "Einnahme" : "Ausgabe", r.category, r.description || "", paymentLabel(r.payment_method), (r.type === "expense" ? -1 : 1) * Number(r.amount || 0)];
    }));
    const html = '<html><head><meta charset="UTF-8"></head><body><table border="1">' + table.map(function (row) {
      return '<tr>' + row.map(function (cell) { return '<td>' + esc(cell) + '</td>'; }).join("") + '</tr>';
    }).join("") + '</table></body></html>';
    const blob = new Blob(["\ufeff" + html], { type:"application/vnd.ms-excel;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "VEREINSANKER-Finanzen-" + selectedYear + ".xls";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  await loadYears();
  await loadData();
};