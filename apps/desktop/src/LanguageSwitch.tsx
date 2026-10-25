import { useI18n } from "./i18n";

/** Language choice, only in Settings → Appearance. The first start picks the system language on its own. */
export default function LanguageSwitch() {
  const { locale, setLocale, t } = useI18n();
  return (
    <div className="ga-settings-language" role="radiogroup" aria-label={t("language")}>
      <button type="button" role="radio" aria-checked={locale === "es"} onClick={() => setLocale("es")}>{t("languageNameEs")}</button>
      <button type="button" role="radio" aria-checked={locale === "en"} onClick={() => setLocale("en")}>{t("languageNameEn")}</button>
    </div>
  );
}
