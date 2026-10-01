(async function(){
const $=s=>document.querySelector(s),sb=window.vaSupabase;
const query=new URLSearchParams(location.search);
const token=query.get("t")||"";
const presetGroup=(query.get("gruppe")||"").trim();
const presetContribution=(query.get("beitrag")||"").trim();
const r=await sb.functions.invoke("membership-join-public",{body:{action:"get",token}});
if(r.error||!r.data?.ok){
  $("#standardJoinPaper").hidden=true;
  $("#stdLoadError").hidden=false;
  $(".standard-join-actions").hidden=true;
  return;
}
const c=r.data.club;
$("#stdClubName").textContent=c.name||"Verein";
$("#stdClubNameInline").textContent=c.name||"den Verein";
$("#stdClubFallback").textContent=(c.short_name||c.name||"VF").slice(0,4).toUpperCase();
const contributionTypes=Array.isArray(r.data.contribution_types)?r.data.contribution_types:[];
if(contributionTypes.length){
  $("#stdContributionFallback").hidden=true;
  $("#stdContributionTypes").hidden=false;
  $("#stdContributionTypes").innerHTML=contributionTypes.map(item=>{
    const selected=item.id===presetContribution;
    return '<div class="paper-contribution-row'+(selected?' selected':'')+'"><i>'+(selected?'✓':'')+'</i><span><strong>'+String(item.name||"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[ch]))+'</strong><b>'+Number(item.annual_fee||0).toLocaleString("de-DE",{style:"currency",currency:"EUR"})+' / Jahr</b></span></div>';
  }).join("");
}else{
  $("#stdContributionFallback").hidden=false;
  $("#stdContributionTypes").hidden=true;
}
$("#stdGeneratedDate").textContent="Stand "+new Date().toLocaleDateString("de-DE");
if(presetGroup) $("#stdGroupValue").textContent=presetGroup;
if(c.logo_url){$("#stdClubLogo").src=c.logo_url;$("#stdClubLogo").hidden=false;$("#stdClubFallback").hidden=true;}
$("#standardJoinPaper").hidden=false;
$(".standard-join-actions").hidden=false;
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