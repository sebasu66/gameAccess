(() => {
 const appId = __APP_ID__, expected = __GAME_NAME__;
 const normalize = s => s.normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
 let finished = false;
 const send = data => { if(finished)return; finished=true; location.href="gameaccess-coop://result?data="+encodeURIComponent(JSON.stringify({app_id:appId,source:"co-optimus",...data})); };
 const scan = () => {
  if(finished)return;
  if(location.pathname.startsWith("/game/")) {
   const steam = Array.from(document.querySelectorAll('a[href]')).some(a=>{try{const u=new URL(a.href);return u.hostname==="store.steampowered.com"&&u.pathname.split("/")[2]===String(appId);}catch{return false;}});
   if(!steam){if(document.readyState==="complete")send({state:"unverified"});return;}
   const text=(document.querySelector("#page-content")?.textContent||"").replace(/\s+/g," ");
   const data={state:"ready",source_url:location.href};
   for(const [label,key] of [["Local Co-Op","local_players_max"],["Online Co-Op","online_players_max"],["Combo Co-Op (Local + Online)","combo_players_max"],["LAN Play or System Link","lan_players_max"]]) {
    const escaped=label.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
    const match=text.match(new RegExp(escaped+"\\s*(?:(\\d+) Players?|Not Supported)","i"));
    if(match)data[key]=match[1]?Number(match[1]):0;
   }
   for(const [label,key] of [["Co-Op Campaign","coop_campaign"],["Co-Op Modes","coop_modes"],["Splitscreen","shared_split_screen"],["Drop In/Drop Out","drop_in_out"]])data[key]=text.includes(label);
   if(Object.keys(data).length>3)send(data);
  } else if(location.pathname==="/games.php") {
   const links=Array.from(document.querySelectorAll('#search_table a[href*="/game/"]'));
   const matches=links.filter(a=>a.href.includes("/pc/")&&normalize(a.closest(".result_row")?.getAttribute("title")||a.textContent||a.querySelector("img")?.alt||"")===normalize(expected));
   if(matches.length===1)location.href=matches[0].href.replace(/^http:/,"https:");
   else if(links.length || /No games matched/i.test(document.querySelector("#search_table")?.textContent||""))send({state:"unverified"});
  }
 };
 new MutationObserver(scan).observe(document.documentElement,{childList:true,subtree:true});
 document.addEventListener("DOMContentLoaded",scan);setInterval(scan,500);scan();
})();