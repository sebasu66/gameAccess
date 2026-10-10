import { useEffect, useSyncExternalStore } from "react";
import { getPluginStatuses, subscribePluginStatuses, monitorPluginRuntime } from "./catalog/PluginRuntime";

export function PluginIndicator() {
  const plugins = useSyncExternalStore(subscribePluginStatuses, getPluginStatuses, getPluginStatuses);
  useEffect(() => monitorPluginRuntime(), []);

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
