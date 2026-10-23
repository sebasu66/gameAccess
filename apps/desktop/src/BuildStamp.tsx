import { useI18n } from "./i18n";
declare const __BUILD_TIMESTAMP__: string;
export default function BuildStamp() {
 const { locale } = useI18n();
 const timestamp = typeof __BUILD_TIMESTAMP__ === "string" ? __BUILD_TIMESTAMP__ : "desarrollo";
 return <small className="ga-build-stamp" title={locale === "es" ? "Hora de compilación (UTC)" : "Build time (UTC)"}>{locale === "es" ? "Compilación:" : "Build:"} {timestamp}</small>;
}
