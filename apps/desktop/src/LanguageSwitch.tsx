import { useI18n } from "./i18n";

export default function LanguageSwitch() {
  const { locale, setLocale, t } = useI18n();
  return (
    <div className="app-language-switch" role="group" aria-label={t("language")}>
      <button type="button" className={locale === "es" ? "active" : ""} onClick={() => setLocale("es")} aria-pressed={locale === "es"}>ES</button>
      <button type="button" className={locale === "en" ? "active" : ""} onClick={() => setLocale("en")} aria-pressed={locale === "en"}>EN</button>
    </div>
  );
}
