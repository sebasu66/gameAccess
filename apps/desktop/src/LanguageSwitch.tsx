import { Globe2 } from "lucide-react";
import { useI18n } from "./i18n";
import { GaIconButton } from "./components/ga/Buttons";

export default function LanguageSwitch() {
  const { locale, setLocale, t } = useI18n();
  return (
    <div className="app-language-switch" role="group" aria-label={t("language")}>
      <button type="button" className={locale === "es" ? "active" : ""} onClick={() => setLocale("es")} aria-pressed={locale === "es"}>ES</button>
      <button type="button" className={locale === "en" ? "active" : ""} onClick={() => setLocale("en")} aria-pressed={locale === "en"}>EN</button>
    </div>
  );
}

/** Footer language control: a globe cube; the selector opens above it on hover or focus. */
export function FooterLanguage() {
  const { locale, setLocale, t } = useI18n();
  return (
    <div className="ga-footer-language">
      <GaIconButton icon={<Globe2 size={19} aria-hidden="true" />} label={t(locale === "es" ? "languageNameEs" : "languageNameEn")} aria-haspopup="true" aria-label={t("language")} />
      <div className="ga-footer-language-pop" role="group" aria-label={t("language")}>
        <button type="button" aria-pressed={locale === "es"} onClick={() => setLocale("es")}>{t("languageNameEs")}</button>
        <button type="button" aria-pressed={locale === "en"} onClick={() => setLocale("en")}>{t("languageNameEn")}</button>
      </div>
    </div>
  );
}
