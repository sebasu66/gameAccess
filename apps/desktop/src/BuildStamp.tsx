declare const __BUILD_TIMESTAMP__: string;

export default function BuildStamp() {
  const timestamp = typeof __BUILD_TIMESTAMP__ === "string" ? __BUILD_TIMESTAMP__ : "development";
  return <small title="Compilation time (UTC)" style={{ alignSelf: "center", color: "#cbd5e1", padding: "0 12px", whiteSpace: "nowrap", fontSize: 11 }}>Build: {timestamp}</small>;
}
