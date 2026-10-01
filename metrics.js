(function(){
  const sb=window.vaSupabase;
  if(!sb) return;

  const KEY="vereinsfach_visitor_id";

  function makeId(){
    if(globalThis.crypto?.randomUUID) return crypto.randomUUID();
    const bytes=new Uint8Array(16);
    globalThis.crypto?.getRandomValues?.(bytes);
    if(!bytes.some(Boolean)){
      for(let i=0;i<bytes.length;i++) bytes[i]=Math.floor(Math.random()*256);
    }
    bytes[6]=(bytes[6]&15)|64;
    bytes[8]=(bytes[8]&63)|128;
    const hex=[...bytes].map(b=>b.toString(16).padStart(2,"0")).join("");
    return hex.slice(0,8)+"-"+hex.slice(8,12)+"-"+hex.slice(12,16)+"-"+hex.slice(16,20)+"-"+hex.slice(20);
  }

  function visitorId(){
    try{
      let id=sessionStorage.getItem(KEY);
      if(!id){
        id=makeId();
        sessionStorage.setItem(KEY,id);
      }
      return id;
    }catch{
      return makeId();
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