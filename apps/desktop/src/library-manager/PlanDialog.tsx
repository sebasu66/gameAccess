import { GaButton } from "../components/ga/Buttons";
import { ChevronDown, ChevronRight, Cog, FilePlus, PackageOpen, Pencil, Search, ShieldCheck, Trash2 } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import CircularScrollbar from "../CircularScrollbar";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../components/ui/alert-dialog";
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
  const [open, setOpen] = useState<Set<number>>(() => new Set(plans.length === 1 ? [plans[0].app_id] : []));
  const scrollRef = useRef<HTMLDivElement>(null);
  const toggle = (id: number) => setOpen(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  return (
    <AlertDialog open onOpenChange={value => { if (!value && !busy) onCancel(); }}>
      <AlertDialogContent className="w-[min(960px,94vw)] max-h-[min(78vh,620px)]">
        <AlertDialogHeader>
          <AlertDialogTitle>{c.planTitle}</AlertDialogTitle>
          <AlertDialogDescription>{c.planIntro}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="relative min-h-0 flex-1 rounded-md border border-border">
          <div ref={scrollRef} className="h-full max-h-[min(44vh,380px)] overflow-y-auto pr-8 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="grid gap-1 p-2">
              {plans.length === 0 ? <p className="m-0 p-2 text-sm text-muted-foreground">{c.planNothing}</p> : plans.map(plan => {
                const expanded = open.has(plan.app_id);
                return (
                  <section key={plan.app_id} className="rounded-md bg-background/40">
                    <button type="button" aria-expanded={expanded} onClick={() => toggle(plan.app_id)} className="flex w-full items-center gap-2 border-0 bg-transparent px-3 py-2 text-left font-sans text-sm font-bold text-foreground">
                      {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                      <span className="flex-1 truncate">{plan.name}</span>
                      <span className="text-xs font-normal text-muted-foreground">{plan.actions.length} {c.steps}</span>
                      {plan.freed_bytes ? <b className="text-xs tabular-nums text-success">{formatBytes(plan.freed_bytes)}</b> : null}
                    </button>
                    {expanded ? <div className="grid gap-2 px-3 pb-3 pl-9">
                      {plan.error ? <p className="m-0 text-xs text-[#e1898f]">{plan.error}</p> : null}
                      <ul className="m-0 grid list-none gap-1.5 p-0">
                        {plan.actions.map((action, index) => (
                          <li key={`${action.code}-${index}`} className="flex items-start gap-2 text-sm">
                            <span className="mt-0.5">{icons[action.code]}</span>
                            <span className="flex-1">{action.label}</span>
                            {action.bytes ? <b className="text-xs tabular-nums text-muted-foreground">{formatBytes(action.bytes)}</b> : null}
                          </li>
                        ))}
                      </ul>
                    </div> : null}
                  </section>
                );
              })}
            </div>
          </div>
          <CircularScrollbar targetRef={scrollRef} label={c.planTitle} />
        </div>
        {deletes ? <p className="m-0 text-xs text-muted-foreground">{c.planSources}</p> : null}
        {freed > 0 ? <p className="m-0 text-sm font-bold text-success">{c.planFree(formatBytes(freed))}</p> : null}
        <AlertDialogFooter>
          <GaButton disabled={busy} onClick={onCancel}>{c.cancel}</GaButton>
          <GaButton variant="primary" disabled={busy || plans.length === 0} onClick={onConfirm}>{busy ? c.working : c.confirm}</GaButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
