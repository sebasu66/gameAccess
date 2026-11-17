using System.Diagnostics;
using Microsoft.Win32;

namespace GameAccessPluginInstaller;

public record DetectionResult(bool IsInstalled, string? InstallPath, string PluginsPath, string AppDataPluginsPath, string Message);

public static class GameAccessDetector
{
    public static DetectionResult Detect()
    {
        string appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        string appDataGa = Path.Combine(appData, "GameAccess");
        string appDataPlugins = Path.Combine(appDataGa, "plugins");

        // 1. Check running processes
        string[] processNames = ["GameAccess-latest", "gameaccess-desktop", "gameAccess", "GameAccess"];
        foreach (var name in processNames)
        {
            var procs = Process.GetProcessesByName(name);
            foreach (var p in procs)
            {
                try
                {
                    string? exePath = p.MainModule?.FileName;
                    if (!string.IsNullOrEmpty(exePath) && File.Exists(exePath))
                    {
                        string? dir = Path.GetDirectoryName(exePath);
                        if (!string.IsNullOrEmpty(dir) && Directory.Exists(dir))
                        {
                            string plugins = Path.Combine(dir, "plugins");
                            return new DetectionResult(true, dir, plugins, appDataPlugins, $"Game Access detectado (en ejecución): {exePath}");
                        }
                    }
                }
                catch { }
            }
        }

        // 2. Check Windows Registry (Uninstall entries)
        string[] registryRoots = [
            @"Software\Microsoft\Windows\CurrentVersion\Uninstall",
            @"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"
        ];

        foreach (var root in registryRoots)
        {
            using var baseKey = Registry.CurrentUser.OpenSubKey(root);
            if (baseKey != null)
            {
                var result = CheckRegistryKeys(baseKey, appDataPlugins);
                if (result != null) return result;
            }

            using var baseKeyLm = Registry.LocalMachine.OpenSubKey(root);
            if (baseKeyLm != null)
            {
                var result = CheckRegistryKeys(baseKeyLm, appDataPlugins);
                if (result != null) return result;
            }
        }

        // 3. Check well-known install paths
        string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        string programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        string programFilesX86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);

        string[] candidateDirs = [
            Path.Combine(programFiles, "gameAccess"),
            Path.Combine(programFiles, "GameAccess"),
            Path.Combine(localAppData, "Programs", "gameAccess"),
            Path.Combine(localAppData, "Programs", "GameAccess"),
            Path.Combine(localAppData, "gameAccess"),
            Path.Combine(programFilesX86, "gameAccess"),
            Path.Combine(programFilesX86, "GameAccess"),
            @"C:\DEV\Game Access Dev",
        ];

        foreach (var dir in candidateDirs)
        {
            if (Directory.Exists(dir) && IsGameAccessDirectory(dir))
            {
                string plugins = Path.Combine(dir, "plugins");
                return new DetectionResult(true, dir, plugins, appDataPlugins, $"Game Access detectado en: {dir}");
            }
        }

        // 4. Check AppData GameAccess config / database presence
        if (Directory.Exists(appDataGa))
        {
            // If user data exists, Game Access is installed on the machine
            string plugins = Path.Combine(appDataGa, "plugins");
            return new DetectionResult(true, appDataGa, plugins, appDataPlugins, $"Game Access detectado por datos de usuario en: {appDataGa}");
        }

        return new DetectionResult(false, null, appDataPlugins, appDataPlugins, "Game Access no se encuentra instalado en este equipo. Se requiere tener Game Access instalado antes de instalar este plugin.");
    }

    public static bool IsGameAccessDirectory(string dir)
    {
        if (!Directory.Exists(dir)) return false;

        string[] signatures = [
            "GameAccess-latest.exe",
            "gameaccess-desktop.exe",
            "gameAccess.exe",
            "GameAccess.exe",
            "tauri.conf.json",
            Path.Combine("apps", "desktop", "src-tauri", "tauri.conf.json")
        ];

        return signatures.Any(sig => File.Exists(Path.Combine(dir, sig)));
    }

    private static DetectionResult? CheckRegistryKeys(RegistryKey parentKey, string appDataPlugins)
    {
        foreach (var subKeyName in parentKey.GetSubKeyNames())
        {
            try
            {
                using var key = parentKey.OpenSubKey(subKeyName);
                if (key == null) continue;

                var displayName = key.GetValue("DisplayName")?.ToString() ?? "";
                if (displayName.Contains("gameAccess", StringComparison.OrdinalIgnoreCase) ||
                    displayName.Contains("Game Access", StringComparison.OrdinalIgnoreCase))
                {
                    var installLocation = key.GetValue("InstallLocation")?.ToString() ?? "";
                    if (!string.IsNullOrEmpty(installLocation) && Directory.Exists(installLocation))
                    {
                        return new DetectionResult(true, installLocation, Path.Combine(installLocation, "plugins"), appDataPlugins, $"Game Access detectado en registro: {installLocation}");
                    }

                    var displayIcon = key.GetValue("DisplayIcon")?.ToString() ?? "";
                    if (!string.IsNullOrEmpty(displayIcon))
                    {
                        string cleanIcon = displayIcon.Split(',')[0].Trim('"');
                        if (File.Exists(cleanIcon))
                        {
                            string? dir = Path.GetDirectoryName(cleanIcon);
                            if (!string.IsNullOrEmpty(dir) && Directory.Exists(dir))
                            {
                                return new DetectionResult(true, dir, Path.Combine(dir, "plugins"), appDataPlugins, $"Game Access detectado: {dir}");
                            }
                        }
                    }
                }
            }
            catch { }
        }
        return null;
    }
}
