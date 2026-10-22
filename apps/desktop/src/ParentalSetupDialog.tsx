import { useEffect, useState } from "react";
import AppDialog from "./AppDialog";
import { loadParentalState, saveParentalPolicy } from "./parentalControl";
import { useNewParentalPassword, useParentalState } from "./ParentalControlSection";
import { useI18n } from "./i18n";
import { notify } from "./toasts";

/**
 * First launch with parental control on (the installer's default): ask for the password that will protect it.
 * "Not now" is remembered and the control stays on; Escape only hides the question until the next launch.
 */
export default function ParentalSetupDialog() {
  const { loaded, setUp, policy } = useParentalState();
  const [hidden, setHidden] = useState(false);
  useEffect(() => { void loadParentalState(); }, []);
  if (!loaded || setUp || !policy.enabled || hidden) return null;
  return <SetupQuestion onDone={() => setHidden(true)} />;
}

function SetupQuestion({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const form = useNewParentalPassword(undefined, () => { onDone(); notify(t("parentalPasswordSaved"), { tone: "success" }); }, true);
  const later = async () => {
    onDone();
    try {
      await saveParentalPolicy({});
    } catch (error) {
      notify(t("parentalSaveFailed", { error: error instanceof Error ? error.message : String(error) }), { tone: "error" });
    }
  };
  return <AppDialog title={t("parentalSetupTitle")} message={t("parentalSetupMessage")} onClose={onDone}
    onConfirm={() => void form.save()} confirmLabel={t("parentalSavePassword")} confirmDisabled={!form.ready}
    cancelLabel={t("parentalSetupLater")} onCancelAction={() => void later()} initialAction="confirm">
    <div className="ga-parental-password ga-parental-setup">{form.fields}</div>
  </AppDialog>;
}
