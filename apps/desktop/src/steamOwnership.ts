export interface SteamOwnerAccount {
  label: string;
  account_name?: string;
  app_ids: number[];
  accessible_app_ids?: number[];
  active?: boolean;
}

export function resolveSteamInstallOwner(accounts: SteamOwnerAccount[], appId: number): string {
  if (!Number.isInteger(appId) || appId <= 0) {
    throw new Error("Steam AppID inválido.");
  }

  const owners = accounts.filter((account) => account.app_ids.includes(appId));
  const owner = owners.find((account) => account.active) ?? owners[0];
  if (!owner) {
    throw new Error(
      `No verified original owner was found for AppID ${appId}. Accessible/Family-visible accounts are not accepted as owners.`,
    );
  }

  const accountLabel = (owner.account_name || owner.label || "").trim();
  if (!accountLabel) {
    throw new Error(`The verified owner for AppID ${appId} has no remembered Steam account label.`);
  }
  return accountLabel;
}
