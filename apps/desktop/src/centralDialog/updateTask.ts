import { translate } from "../i18n";
import { centralDialog, type TaskHandle } from "./centralDialog";
import { runUpdate, type UpdateDeps } from "../appUpdate";

/**
 * The mandatory self-update as a task of the central dialog: it appears only when a newer version exists,
 * shows the download and the install, and the app restarts. A failure lets the player retry or keep this version.
 */
/** A new version was found: say so in the news dialog before downloading it (Windows then asks to install it). */
export function announceUpdate(version: string): Promise<void> {
  return new Promise(resolve => centralDialog.showAnnouncements(
    [{ id: `update-${version}`, title: translate("updateFoundTitle", { version }), body: translate("updateFoundBody", { version }) }], () => resolve()));
}

export async function runAppUpdateTask(deps: UpdateDeps): Promise<void> {
  const withNotice: UpdateDeps = { announce: announceUpdate, ...deps };
  for (;;) {
    let handle: Promise<TaskHandle> | null = null;
    let failure: string | null = null;
    const task = (version: string) => handle ??= centralDialog.beginTask(translate("updateTaskTitle", { version }), [
      { id: "download", label: translate("updateStepDownload") },
      { id: "install", label: translate("updateStepInstall") },
    ]).then(started => { started.start("download"); return started; });
    await runUpdate(withNotice, phase => {
      if (phase.kind === "downloading") void task(phase.version).then(h => h.progress("download", phase.done, phase.total || undefined, undefined, "bytes"));
      else if (phase.kind === "installing") void task(phase.version).then(h => { h.finish("download"); h.start("install"); });
      else if (phase.kind === "failed") failure = phase.error;
    });
    // Both are set from the phase callback, which TypeScript does not follow.
    const pending = handle as Promise<TaskHandle> | null;
    const failed = failure as string | null;
    if (!pending) return; // no update, or the check could not run: this version goes on
    const started = await pending;
    if (failed === null) { started.finish("install"); return; } // the app is restarting
    const choice = await started.fail(translate("updateFailedBody", { error: failed }), true);
    started.end();
    if (choice === "continue") return;
  }
}
