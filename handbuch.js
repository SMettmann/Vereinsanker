(function(){
  const button=document.getElementById("downloadHandbookPdf");
  const status=document.getElementById("downloadHandbookStatus");

  button?.addEventListener("click",async function(){
    if(typeof html2pdf!=="function"){
      status.textContent="PDF-Download konnte nicht geladen werden. Bitte Seite neu laden.";
      return;
    }

    button.disabled=true;
    button.textContent="PDF wird erstellt …";
    status.textContent="Einen Moment – das Handbuch wird lokal im Browser erzeugt.";

    try{
      await html2pdf().set({
        margin:[8,8,9,8],
        filename:"VEREINSFACH_Handbuch.pdf",
        image:{type:"jpeg",quality:0.96},
        html2canvas:{scale:2,useCORS:true,backgroundColor:"#ffffff"},
        jsPDF:{unit:"mm",format:"a4",orientation:"portrait"},
        pagebreak:{mode:["css","legacy"],avoid:[".chapter"]}
      }).from(document.getElementById("handbookContent")).save();

      status.textContent="PDF wurde erstellt.";
      window.trackVereinsfachEvent?.("handbook_download","handbuch.html");
    }catch(error){
      console.error(error);
      status.textContent="PDF konnte nicht erstellt werden. Du kannst das Handbuch weiterhin online lesen.";
    }finally{
      button.disabled=false;
      button.textContent="Handbuch als PDF herunterladen";
    }
  });
})();