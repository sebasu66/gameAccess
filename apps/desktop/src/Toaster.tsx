import { CheckCircle2, CircleAlert, Info, TriangleAlert, X } from "lucide-react";
import { dismissToast, useToasts, type ToastTone } from "./toasts";
import { useI18n } from "./i18n";
import "./toaster.css";

const ICONS: Record<ToastTone, typeof Info> = { info: Info, success: CheckCircle2, warning: TriangleAlert, error: CircleAlert };

/** The stack of notifications raised with notify(). Mounted once, at the app root. */
export default function Toaster() {
  const { t } = useI18n();
  const toasts = useToasts();
  if (!toasts.length) return null;
  return <div className="ga-toaster" role="region" aria-label={t("toastRegion")}>
    {toasts.map(toast => {
      const Icon = ICONS[toast.tone];
      return <div key={toast.id} className="ga-toast" data-tone={toast.tone} role={toast.tone === "error" ? "alert" : "status"}>
        <Icon size={18} aria-hidden="true" />
        <p>{toast.message}</p>
        <button type="button" onClick={() => dismissToast(toast.id)} aria-label={t("toastDismiss")}><X size={16} aria-hidden="true" /></button>
      </div>;
    })}
  </div>;
}
