// All of these active titles were checked against the local GameAccess catalog.
// The access gate cannot fetch the protected catalog before a key is redeemed.
const featuredGames = [
  { appId: 2669320, name: "EA SPORTS FC 25" },
  { appId: 292030, name: "The Witcher 3" },
  { appId: 2483190, name: "Forza Horizon 6", imageUrl: "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/2483190/a3f1465050b6103274991a29b7462d3f28918b5d/header_alt_assets_4.jpg?t=1788887415" },
  { appId: 418370, name: "Resident Evil 7" },
  { appId: 275850, name: "No Man's Sky" },
  { appId: 1086940, name: "Baldur's Gate 3" },
  { appId: 1091500, name: "Cyberpunk 2077" },
  { appId: 1174180, name: "Red Dead Redemption 2" },
  { appId: 1245620, name: "Elden Ring" },
  { appId: 934700, name: "Dead Island 2" },
  { appId: 1551360, name: "Forza Horizon 5" },
  { appId: 381210, name: "Dead by Daylight" },
  { appId: 990080, name: "Hogwarts Legacy" },
  { appId: 108600, name: "Project Zomboid" },
  { appId: 1888930, name: "The Last of Us Part I" },
  { appId: 534380, name: "Dying Light 2" },
  { appId: 870780, name: "Control" },
  { appId: 1593500, name: "God of War" },
  { appId: 1716740, name: "Starfield" },
  { appId: 814380, name: "Sekiro" },
];

const showcaseGames = Array.from({ length: 6 }, () => featuredGames).flat();

export default function GameCoverBackdrop() {
 return <div className="activation-showcase" aria-hidden="true"><div className="activation-showcase-grid">
  {showcaseGames.map((game,index) => <div className="activation-showcase-cover" key={index}>
   <img src={"imageUrl" in game ? game.imageUrl : `https://cdn.akamai.steamstatic.com/steam/apps/${game.appId}/library_600x900.jpg`} alt="" draggable={false} />
  </div>)}
 </div></div>;
}
