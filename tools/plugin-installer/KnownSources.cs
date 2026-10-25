namespace GameAccessPluginInstaller;

public record CommunitySource(string Id, string Name, string Url, string Description, string Type);

public static class KnownSources
{
    public static readonly IReadOnlyList<CommunitySource> List = new List<CommunitySource>
    {
        new("onlinefix", "Online-Fix", "https://hydralinks.cloud/sources/onlinefix.json", "Multiplayer fixes & online co-op releases", "Online Fixes / Torrent"),
        new("steamrip", "SteamRIP", "https://hydralinks.cloud/sources/steamrip.json", "Pre-installed games with direct downloads", "Direct Download"),
        new("steamgg", "SteamGG", "https://wkeynhk.online/steamgg.json", "Clean Steam files & pre-installed releases", "Direct Download"),
        new("gog", "GOG Games", "https://hydralinks.cloud/sources/gog.json", "DRM-free GOG installers & extras", "DRM-Free / Direct"),
        new("fitgirl", "FitGirl Repacks", "https://hydralinks.cloud/sources/fitgirl.json", "Lossless ultra-compressed repacks", "Repack / Torrent"),
        new("dodi", "DODI Repacks", "https://hydralinks.cloud/sources/dodi.json", "Fast compressed repacks", "Repack / Torrent"),
        new("kaoskrew", "KaOs Krew", "https://hydralinks.cloud/sources/kaoskrew.json", "Lossless compact game releases", "Repack / Torrent"),
        new("xatab", "Xatab Repacks", "https://hydralinks.cloud/sources/xatab.json", "Classic gaming repack catalog", "Repack / Torrent"),
        new("tinyrepacks", "Tiny Repacks", "https://hydralinks.cloud/sources/tinyrepacks.json", "Minimal size repacks", "Repack / Direct"),
        new("empress", "Empress", "https://hydralinks.cloud/sources/empress.json", "Denuvo releases catalog", "Torrent"),
        new("anadius", "Anadius", "https://hydralinks.cloud/sources/anadius.json", "Sims 4 tools & game content", "Direct Download"),
    };
}
