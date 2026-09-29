const $=(s)=>document.querySelector(s);
const $$=(s)=>[...document.querySelectorAll(s)];

const startForm=$("#startForm");
if(startForm){
  startForm.addEventListener("submit",e=>{
    e.preventDefault();
    localStorage.setItem("va_email",$("#email").value.trim());
    location.href="onboarding.html";
  });
}

function showStep(n){
  $$(".step").forEach(s=>s.classList.toggle("active",Number(s.dataset.step)===n));
  const no=$("#stepNo"),bar=$("#progressBar");
  if(no) no.textContent=n;
  if(bar) bar.style.width=(n/3*100)+"%";
}
$$("[data-next]").forEach(btn=>btn.addEventListener("click",()=>showStep(Number(btn.dataset.next))));
$$("[data-back]").forEach(btn=>btn.addEventListener("click",()=>showStep(Number(btn.dataset.back))));

$$(".color-choice").forEach(btn=>btn.addEventListener("click",()=>{
  $$(".color-choice").forEach(b=>b.classList.remove("active"));
  btn.classList.add("active");
  localStorage.setItem("va_color",btn.dataset.color);
}));

const finish=$("#finishSetup");
if(finish){
  finish.addEventListener("click",()=>{
    const name=$("#clubName")?.value.trim()||localStorage.getItem("va_club")||"Mein Verein";
    const short=$("#clubShort")?.value.trim().toUpperCase()||localStorage.getItem("va_short")||"VA";
    localStorage.setItem("va_club",name);
    localStorage.setItem("va_short",short);
    localStorage.setItem("va_fee",$("#fee")?.value||"60");
    location.href="app.html";
  });
  const name=$("#clubName"),short=$("#clubShort");
  name?.addEventListener("input",()=>localStorage.setItem("va_club",name.value));
  short?.addEventListener("input",()=>localStorage.setItem("va_short",short.value));
}

const clubTitle=$("#clubTitle"),clubBadge=$("#clubBadge");
if(clubTitle){
  clubTitle.textContent=localStorage.getItem("va_club")||"SV Waldheim 1928 e.V.";
  clubBadge.textContent=localStorage.getItem("va_short")||"SV";
  const c=localStorage.getItem("va_color");
  if(c){document.documentElement.style.setProperty("--green",c);clubBadge.style.background=c}
}


function initials(name){
  return name.trim().split(/\s+/).slice(0,2).map(x=>x[0]?.toUpperCase()||"").join("");
}
function showToast(message){
  const toast=$("#toast"); if(!toast) return;
  toast.textContent=message; toast.hidden=false;
  clearTimeout(window.__vaToast);
  window.__vaToast=setTimeout(()=>toast.hidden=true,2600);
}
function openBackdrop(el){ if(el){el.hidden=false;document.body.style.overflow="hidden"} }
function closeBackdrop(el){ if(el){el.hidden=true;document.body.style.overflow=""} }

const memberSheet=$("#memberSheet");
const addMemberSheet=$("#addMemberSheet");
$("#addMemberBtn")?.addEventListener("click",()=>openBackdrop(addMemberSheet));
$("#closeSheet")?.addEventListener("click",()=>closeBackdrop(memberSheet));
$("#closeAddMember")?.addEventListener("click",()=>closeBackdrop(addMemberSheet));
memberSheet?.addEventListener("click",e=>{if(e.target===memberSheet)closeBackdrop(memberSheet)});
addMemberSheet?.addEventListener("click",e=>{if(e.target===addMemberSheet)closeBackdrop(addMemberSheet)});

function bindMemberRow(row){
  row.addEventListener("click",()=>{
    const name=row.dataset.name||"Mitglied";
    $("#detailInitials").textContent=initials(name);
    $("#sheetTitle").textContent=name;
    $("#detailGroup").textContent=row.dataset.group||"–";
    $("#detailEmail").textContent=row.dataset.email||"–";
    $("#detailIban").textContent=row.dataset.iban||"–";
    $("#detailFee").textContent=row.dataset.fee||"–";
    $("#detailStatus").textContent=row.dataset.status||"–";
    openBackdrop(memberSheet);
  });
}
$$(".members-row").forEach(bindMemberRow);

function customMembers(){
  try{return JSON.parse(localStorage.getItem("va_members")||"[]")}catch{return[]}
}
function saveMembers(list){localStorage.setItem("va_members",JSON.stringify(list))}
function addMemberRow(member){
  const rows=$("#memberRows"); if(!rows)return;
  const row=document.createElement("button");
  row.type="button"; row.className="members-row";
  row.dataset.name=member.name; row.dataset.group=member.group||"Ohne Gruppe"; row.dataset.email=member.email||""; row.dataset.iban=member.iban||""; row.dataset.fee=member.fee+" €"; row.dataset.status="Offen";
  const number=1006+customMembers().findIndex(m=>m.id===member.id);
  row.innerHTML='<span class="member-main"><i>'+initials(member.name)+'</i><b>'+member.name+'<small>#'+number+'</small></b></span><span>'+(member.group||"Ohne Gruppe")+'</span><span>'+member.fee+' €</span><em class="status-open">Offen</em>';
  rows.appendChild(row); bindMemberRow(row);
}
customMembers().forEach(addMemberRow);

$("#addMemberForm")?.addEventListener("submit",e=>{
  e.preventDefault();
  const first=$("#firstName").value.trim(),last=$("#lastName").value.trim();
  if(!first||!last)return;
  const member={id:Date.now(),name:first+" "+last,group:$("#memberGroup").value.trim(),email:$("#memberEmail").value.trim(),iban:$("#memberIban").value.trim(),fee:Number($("#memberFee").value||0).toLocaleString("de-DE",{minimumFractionDigits:0,maximumFractionDigits:2})};
  const list=customMembers(); list.push(member); saveMembers(list);
  addMemberRow(member); e.target.reset(); $("#memberFee").value="60";
  closeBackdrop(addMemberSheet); showToast("Mitglied gespeichert ✓");
  $("#memberSearch")?.dispatchEvent(new Event("input"));
});

$("#memberSearch")?.addEventListener("input",e=>{
  const q=e.target.value.trim().toLowerCase(); let count=0;
  $$(".members-row").forEach(row=>{
    const hit=(row.dataset.name+" "+row.dataset.group+" "+row.dataset.email).toLowerCase().includes(q);
    row.hidden=!hit; if(hit)count++;
  });
  if($("#visibleCount"))$("#visibleCount").textContent=count;
});
if($("#visibleCount"))$("#visibleCount").textContent=$$(".members-row").length;

$("#memberImport")?.addEventListener("change",e=>{
  const file=e.target.files?.[0]; if(!file)return;
  showToast(file.name+" ausgewählt ✓");
});
