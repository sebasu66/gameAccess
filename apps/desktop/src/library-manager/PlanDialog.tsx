import { Cog, FilePlus, PackageOpen, Pencil, Search, ShieldCheck, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../components/ui/alert-dialog";
import { ScrollArea } from "../components/ui/scroll-area";
import type { LibraryPlan } from "../catalog/DigitalProcessManager";
import type { LibraryCopy } from "./copy";
import { formatBytes } from "./format";

const icons: Record<string, ReactNode> = {
  create_log: <FilePlus className="size-4 text-info" />, extract: <PackageOpen className="size-4 text-info" />, setup: <Cog className="size-4 text-info" />,
  delete_source: <Trash2 className="size-4 text-warning" />, remove_empty: <Trash2 className="size-4 text-warning" />, find_executable: <Search className="size-4 text-info" />,
  keep: <ShieldCheck className="size-4 text-success" />, rename: <Pencil className="size-4 text-info" />,
};

/** The review step of "Fix automatically": exactly what will happen, before anything runs. */
export function PlanDialog({ plans, c, busy, onConfirm, onCancel }: { plans: LibraryPlan[]; c: LibraryCopy; busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  const freed = plans.reduce((sum, plan) => sum + (plan.freed_bytes ?? 0), 0);
  const deletes = plans.some(plan => plan.actions.some(action => action.code === "delete_source"));
  return (
    <AlertDialog open onOpenChange={open => { if (!open && !busy) onCancel(); }}>
      <AlertDialogContent className="w-[min(720px,94vw)]">
        <AlertDialogHeader>
          <AlertDialogTitle>{c.planTitle}</AlertDialogTitle>
          <AlertDialogDescription>{c.planIntro}</AlertDialogDescription>
        </AlertDialogHeader>
        <ScrollArea className="max-h-[52vh] rounded-md border border-border">
          <div className="grid gap-4 p-4">
            {plans.length === 0 ? <p className="m-0 text-sm text-muted-foreground">{c.planNothing}</p> : plans.map(plan => (
              <section key={plan.app_id} className="grid gap-2">
                <h4 className="m-0 text-sm font-bold">{plan.name}</h4>
                {plan.error ? <p className="m-0 text-xs text-[#ff6b75]">{plan.error}</p> : null}
                <ul className="m-0 grid list-none gap-1.5 p-0">
                  {plan.actions.map((action, index) => (
                    <li key={`${action.code}-${index}`} className="flex items-start gap-2 text-sm">
                      <span className="mt-0.5">{icons[action.code]}</span>
                      <span className="flex-1">{action.label}</span>
                      {action.bytes ? <b className="text-xs tabular-nums text-muted-foreground">{formatBytes(action.bytes)}</b> : null}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </ScrollArea>
        {deletes ? <p className="m-0 text-xs text-muted-foreground">{c.planSources}</p> : null}
        {freed > 0 ? <p className="m-0 text-sm font-bold text-success">{c.planFree(formatBytes(freed))}</p> : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{c.cancel}</AlertDialogCancel>
          <AlertDialogAction disabled={busy || plans.length === 0} onClick={event => { event.preventDefault(); onConfirm(); }}>{busy ? c.working : c.confirm}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
