import AppDialog from "./AppDialog";
import AdminKeyField, { useForgotAdminKey } from "./AdminKeyField";
import { useI18n } from "./i18n";
import { settleKeyRequest, useAdminKey, useKeyRequest } from "./accessRole";

/**
 * The parent's key before parental control (vault/Modo niño.md, 2026-10-31): a dialog with the gate's LCD field, open
 * while `requestParentKey` waits. The right key lets the parent in; Cancel, Escape or the backdrop keep it shut.
 */
export default function ParentKeyDialog() {
  const { t } = useI18n();
  const asking = useKeyRequest();
  const key = useAdminKey();
  const forgot = useForgotAdminKey();
  if (!asking) return null;
  return <AppDialog title={t("parentKeyTitle")} message={t("parentKeyText")} onClose={() => settleKeyRequest(false)} closeLabel={t("noticeCancel")}>
    <AdminKeyField length={key.length} onSuccess={() => settleKeyRequest(true)} onForgot={forgot} />
  </AppDialog>;
}
