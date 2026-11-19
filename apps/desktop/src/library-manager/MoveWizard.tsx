import { GaButton } from "../components/ga/Buttons";
import { ChevronDown, ChevronRight, Cog, FilePlus, PackageOpen, Pencil, Search, ShieldCheck, Trash2 } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import GaWizard from "../components/ga/Wizard";
import { useI18n } from "../i18n";
import CircularScrollbar from "../CircularScrollbar";
import type { LibraryPlan } from "../catalog/DigitalProcessManager";
import type { LibraryCopy } from "./copy";
import { formatBytes } from "./format";

const icons: Record<string, ReactNode> = {
  create_log: <FilePlus className="size-4 text-info" />, extract: <PackageOpen className="size-4 text-info" />, setup: <Cog className="size-4 text-info" />,
  delete_source: <Trash2 className="size-4 text-warning" />, remove_empty: <Trash2 className="size-4 text-warning" />, find_executable: <Search className="size-4 text-info" />,
  keep: <ShieldCheck className="size-4 text-success" />, rename: <Pencil className="size-4 text-info" />,
};

/**
 * Moving games into the library ("Fix automatically", Seba 2026-11-17): a one-time process, so a wizard over the whole
 * window (GaWizard) instead of a tab. Review exactly what will happen, then it runs, then what was done.
 * `run` does the work and gives back the games it moved.
 */
export function MoveWizard({ plans, c, run, onClose }: { plans: LibraryPlan[]; c: LibraryCopy; run: () => Promise<number[]>; onClose: () => void }) {
  const { t } = useI18n();
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [moved, setMoved] = useState<number[]>([]);
  const freed = plans.reduce((sum, plan) => sum + (plan.freed_bytes ?? 0), 0);
  const deletes = plans.some(plan => plan.actions.some(action => action.code === "delete_source"));
  const [open, setOpen] = useState<Set<number>>(() => new Set(plans.length === 1 ? [plans[0].app_id] : []));
  const scrollRef = useRef<HTMLDivElement>(null);
  const toggle = (id: number) => setOpen(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const start = async () => { setStep(1); setMoved(await run()); setStep(2); };
  const failed = plans.length - moved.length;
  const steps = [t("moveWzStepReview"), t("moveWzStepWork"), t("moveWzStepDone")];
  if (step === 1) return <GaWizard className="ga-manager-scope" process={t("moveWzProcess")} steps={steps} step={1} title={t("moveWzWorkTitle")} locked onClose={onClose}>
    <p role="status" className="ga-wizard-working"><Loader2 className="animate-spin" aria-hidden="true" />{t("moveWzWorking", { count: plans.length })}</p>
  </GaWizard>;
  if (step === 2) return <GaWizard className="ga-manager-scope" process={t("moveWzProcess")} steps={steps} step={2} title={t("moveWzDoneTitle")}
    lead={failed ? t("moveWzDoneSome", { ok: moved.length, failed }) : t("moveWzDoneAll", { ok: moved.length })} onClose={onClose}
    actions={<GaButton variant="primary" data-dialog-initial onClick={onClose}>{t("close")}</GaButton>}>
    <ul className="ga-wizard-results">{plans.map(plan => <li key={plan.app_id} className={moved.includes(plan.app_id) ? "is-ok" : "is-failed"}>{plan.name}</li>)}</ul>
  </GaWizard>;
  return (
    <GaWizard className="ga-manager-scope" process={t("moveWzProcess")} steps={steps} step={0} title={c.planTitle} lead={c.planIntro} onClose={onClose}
      back={<GaButton onClick={onClose}>{c.cancel}</GaButton>}
      actions={<GaButton variant="primary" data-dialog-initial disabled={plans.length === 0} onClick={() => void start()}>{t("moveWzRun", { count: plans.length })}</GaButton>}>
      <div className="relative min-h-0 rounded-md border border-border">
        <div ref={scrollRef} className="max-h-[52vh] overflow-y-auto pr-8 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="grid gap-1 p-2">
            {plans.length === 0 ? <p className="ga-hint p-2">{c.planNothing}</p> : plans.map(plan => {
              const expanded = open.has(plan.app_id);
              return (
                <section key={plan.app_id} className="rounded-md bg-background/40">
                  <button type="button" aria-expanded={expanded} onClick={() => toggle(plan.app_id)} className="flex w-full items-center gap-2 border-0 bg-transparent px-3 py-2 text-left font-sans text-base font-bold text-foreground">
                    {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                    <span className="flex-1 truncate">{plan.name}</span>
                    <span className="text-sm font-normal text-muted-foreground">{plan.actions.length} {c.steps}</span>
                    {plan.freed_bytes ? <b className="text-sm tabular-nums text-success">{formatBytes(plan.freed_bytes)}</b> : null}
                  </button>
                  {expanded ? <div className="grid gap-2 px-3 pb-3 pl-9">
                    {plan.error ? <p className="ga-status is-error">{plan.error}</p> : null}
                    <ul className="m-0 grid list-none gap-1.5 p-0">
                      {plan.actions.map((action, index) => (
                        <li key={`${action.code}-${index}`} className="flex items-start gap-2 text-base">
                          <span className="mt-1">{icons[action.code]}</span>
                          <span className="flex-1">{action.label}</span>
                          {action.bytes ? <b className="text-sm tabular-nums text-muted-foreground">{formatBytes(action.bytes)}</b> : null}
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
      {deletes ? <p className="ga-hint">{c.planSources}</p> : null}
      {freed > 0 ? <p className="ga-status is-ok">{c.planFree(formatBytes(freed))}</p> : null}
    </GaWizard>
  );
}
