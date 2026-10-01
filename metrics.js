(function(){
  const sb=window.vaSupabase;
  if(!sb) return;

  const KEY="vereinsfach_visitor_id";

  function visitorId(){
    try{
      let id=sessionStorage.getItem(KEY);
      if(!id){
        id=crypto.randomUUID();
        sessionStorage.setItem(KEY,id);
      }
      return id;
    }catch{
      return crypto.randomUUID();
    }
  }

  function pageName(){
    if(location.pathname.endsWith("/")) return "index.html";
    const raw=location.pathname.split("/").filter(Boolean).pop()||"index.html";
    return raw.includes(".")?raw.toLowerCase():"index.html";
  }

  async function track(type,path){
    try{
      await sb.rpc("track_site_event",{
        p_event_type:type,
        p_path:path||pageName(),
        p_visitor_id:visitorId()
      });
    }catch(error){
      console.debug("VEREINSFACH metric skipped",error);
    }
  }

  window.trackVereinsfachEvent=track;

  if(document.documentElement.dataset.trackPublic==="1"){
    track("page_view",pageName());
  }
})();