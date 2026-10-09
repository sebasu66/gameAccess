import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface PluginManifest {
  id: string;
  name: string;
  endpoint: string;
  type: string;
}

export interface PluginStatus extends PluginManifest {
  alive: boolean;
}

export function PluginIndicator() {
  const [plugins, setPlugins] = useState<PluginStatus[]>([]);

  useEffect(() => {
    let active = true;

    async function checkPlugins() {
      try {
        const manifests = await invoke<PluginManifest[]>("get_registered_plugins");
        
        // Heartbeat check for each installed plugin
        const statusPromises = manifests.map(async (plugin) => {
          let alive = false;
          if (plugin.endpoint) {
            try {
              const res = await fetch(`${plugin.endpoint}/api/sources`, { signal: AbortSignal.timeout(2000) });
              alive = res.ok;
            } catch (err) {
              alive = false; // Network error or timeout
            }
          }
          return { ...plugin, alive };
        });

        const statuses = await Promise.all(statusPromises);
        if (active) setPlugins(statuses);
      } catch (err) {
        console.warn("[PluginIndicator] Failed to read plugins:", err);
      }
    }

    void checkPlugins();
    const interval = setInterval(checkPlugins, 10000);
    
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  if (plugins.length === 0) return null;

  return (
    <div className="plugin-indicator-group" style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
      {plugins.slice(0, 3).map(p => (
        <div key={p.id} className="plugin-indicator-item" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#d2d6d9', background: 'rgba(0,0,0,0.3)', padding: '4px 10px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
          <div style={{
            width: '8px', height: '8px', borderRadius: '50%',
            backgroundColor: p.alive ? '#65f0b2' : '#ff4f4f',
            boxShadow: p.alive ? '0 0 8px #65f0b260' : 'none',
            transition: 'background-color 0.3s ease'
          }} />
          {p.name}
        </div>
      ))}
      {plugins.length > 3 && (
        <div style={{ fontSize: '11px', color: '#888' }}>+{plugins.length - 3}</div>
      )}
    </div>
  );
}
