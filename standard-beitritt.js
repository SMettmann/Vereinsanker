(async function(){
const $=s=>document.querySelector(s),sb=window.vaSupabase;
const token=new URLSearchParams(location.search).get("t")||"";
const r=await sb.functions.invoke("membership-join-public",{body:{action:"get",token}});
if(r.error||!r.data?.ok){
  $("#standardJoinPaper").hidden=true;
  $("#stdLoadError").hidden=false;
  $(".standard-join-actions").hidden=true;
  return;
}
const c=r.data.club;
document.documentElement.style.setProperty("--green",c.color||"#237a55");
$("#stdClubName").textContent=c.name||"Verein";
$("#stdClubNameInline").textContent=c.name||"den Verein";
$("#stdClubFallback").textContent=(c.short_name||c.name||"VA").slice(0,4).toUpperCase();
$("#stdAnnualFee").textContent=Number(c.annual_fee||0).toLocaleString("de-DE",{style:"currency",currency:"EUR"});
$("#stdGeneratedDate").textContent="Stand "+new Date().toLocaleDateString("de-DE");
if(c.logo_url){$("#stdClubLogo").src=c.logo_url;$("#stdClubLogo").hidden=false;$("#stdClubFallback").hidden=true;}
if(c.creditor_id){
  $("#stdCreditor").textContent="Gläubiger-ID: "+c.creditor_id+".";
}else{
  $("#stdSepaIntro").textContent="Der Verein hat noch keine Gläubiger-ID hinterlegt. Dieser Abschnitt kann bei Bedarf später ergänzt werden.";
}
$("#downloadStandardJoin").addEventListener("click",async()=>{
 const btn=$("#downloadStandardJoin");
 btn.disabled=true;btn.textContent="PDF wird erstellt …";
 try{
   await html2pdf().set({
     margin:[7,8,8,8],
     filename:"Beitrittserklaerung_"+String(c.short_name||c.name||"Verein").replace(/[^a-z0-9_-]+/gi,"_")+".pdf",
     image:{type:"jpeg",quality:.98},
     html2canvas:{scale:2,useCORS:true,backgroundColor:"#ffffff"},
     jsPDF:{unit:"mm",format:"a4",orientation:"portrait"},
     pagebreak:{mode:["css","legacy"]}
   }).from($("#standardJoinPaper")).save();
 }finally{
   btn.disabled=false;btn.textContent="Als PDF herunterladen";
 }
});
})();