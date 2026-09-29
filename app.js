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
