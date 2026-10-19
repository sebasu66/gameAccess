import { useEffect, useId, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { ArrowUpRight, KeyRound, Loader2, Sparkles, X } from "lucide-react";
import { ACTIVATION_CHANGED_EVENT, ActivationConnectionError, getActivationTier, redeemActivation } from "./activation";
import { useI18n } from "./i18n";
import {
  DEFAULT_PREMIUM_CONTENT, PREMIUM_ACTIVATED_EVENT, fetchPremiumContent, methodsFor,
  type Lang, type PremiumContent, type PremiumSource,
} from "./premiumContent";
import "./premium.css";

const copy = {
  es: {
    button: "Activar premium", close: "Cerrar", haveKey: "Ya tengo una llave", keyLabel: "Tu llave",
    keyPlaceholder: "Pegá tu llave acá", submit: "Activar", checking: "Verificando…",
    how: "Cómo conseguir premium", loading: "Cargando información…", saved: "Sin conexión: mostrando la última información guardada.",
    noServer: "No se pudo conectar con el servidor. Probá de nuevo en un momento.", failed: "No se pudo activar la llave.",
    region: "Zona de pago", done: "¡Listo! Premium activado.",
  },
  en: {
    button: "Activate premium", close: "Close", haveKey: "I already have a key", keyLabel: "Your key",
    keyPlaceholder: "Paste your key here", submit: "Activate", checking: "Checking…",
    how: "How to get premium", loading: "Loading information…", saved: "Offline: showing the last saved information.",
    noServer: "Could not reach the server. Try again in a moment.", failed: "The key could not be activated.",
    region: "Payment region", done: "Done! Premium is on.",
  },
} satisfies Record<Lang, Record<string, string>>;

const subscribe = (listener: () => void) => {
  window.addEventListener(ACTIVATION_CHANGED_EVENT, listener);
  return () => window.removeEventListener(ACTIVATION_CHANGED_EVENT, listener);
};

/** Footer button that exists only while the person is on the free mode, plus the dialog it opens. */
export default function PremiumEntry() {
  const { locale } = useI18n();
  const lang: Lang = locale === "es" ? "es" : "en";
  const c = copy[lang];
  const tier = useSyncExternalStore(subscribe, getActivationTier, () => null);
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState<PremiumContent>(DEFAULT_PREMIUM_CONTENT);
  const [source, setSource] = useState<PremiumSource | "loading">("loading");
  const [region, setRegion] = useState("default");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const titleId = useId();
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setSource("loading");
    void fetchPremiumContent(controller.signal).then(result => {
      if (controller.signal.aborted) return;
      setContent(result.content);
      setRegion(result.content.region);
      setSource(result.source);
    });
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", close);
    return () => { controller.abort(); window.removeEventListener("keydown", close); };
  }, [open]);

  useEffect(() => { if (open) input.current?.focus(); }, [open, source]);

  // Once premium is on there is nothing left to activate: the access pass takes over.
  if (tier && !done) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!key.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      await redeemActivation(key);
      setKey("");
      setDone(true);
      window.dispatchEvent(new Event(PREMIUM_ACTIVATED_EVENT));
      window.setTimeout(() => { setOpen(false); setDone(false); }, 1400);
    } catch (reason) {
      setError(reason instanceof ActivationConnectionError ? c.noServer : reason instanceof Error ? reason.message : c.failed);
    } finally { setBusy(false); }
  };

  const regionCodes = Object.keys(content.regions);
  const methods = methodsFor(content, region);

  return <>
    {!tier ? <button type="button" className="ga-premium-button" onClick={() => setOpen(true)}>
      <Sparkles size={15} aria-hidden="true" />{c.button}
    </button> : null}
    {open ? createPortal(<div className="ga-premium-overlay" onMouseDown={event => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section className="ga-premium-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header>
          <h2 id={titleId}><Sparkles size={20} aria-hidden="true" />{content.title[lang]}</h2>
          <button type="button" className="ga-close" onClick={() => setOpen(false)} aria-label={c.close}><X size={20} /></button>
        </header>
        {source === "loading" ? <p className="ga-premium-note"><Loader2 className="spin" size={16} aria-hidden="true" /> {c.loading}</p> : <>
          <p>{content.intro[lang]}</p>
          {source !== "server" ? <p className="ga-premium-note">{c.saved}</p> : null}
          {content.plans.length ? <ul className="ga-premium-plans">
            {content.plans.map(plan => <li key={plan.id}>
              <strong>{plan.name[lang]}</strong><span className="ga-premium-price">{plan.price[lang]}</span>
              <ul>{plan.perks[lang].map(perk => <li key={perk}>{perk}</li>)}</ul>
            </li>)}
          </ul> : null}
          <h3>{c.how}</h3>
          {regionCodes.length > 1 ? <div className="ga-premium-regions" role="group" aria-label={c.region}>
            {regionCodes.map(code => <button type="button" key={code} aria-pressed={code === region}
              onClick={() => setRegion(code)}>{content.regions[code].label[lang]}</button>)}
          </div> : null}
          <div className="ga-premium-methods">
            {methods.map(method => <a key={method.url + method.label.es} href={method.url} target="_blank" rel="noopener noreferrer">
              <span>{method.label[lang]}{method.note ? <small>{method.note[lang]}</small> : null}</span><ArrowUpRight size={18} aria-hidden="true" />
            </a>)}
          </div>
        </>}
        <form onSubmit={event => void submit(event)} className="ga-premium-key">
          <h3>{c.haveKey}</h3>
          <label htmlFor={titleId + "-key"}>{c.keyLabel}</label>
          <div className="ga-premium-key-row">
            <KeyRound size={18} aria-hidden="true" />
            <input id={titleId + "-key"} ref={input} value={key} onChange={event => setKey(event.target.value)}
              autoComplete="off" spellCheck={false} placeholder={c.keyPlaceholder} disabled={busy || done}
              aria-describedby={error ? titleId + "-error" : undefined} />
            <button type="submit" className="primary ga-btn-primary" disabled={busy || done || !key.trim()}>
              {busy ? <Loader2 className="spin" size={16} aria-hidden="true" /> : null}{busy ? c.checking : c.submit}
            </button>
          </div>
          {error ? <p id={titleId + "-error"} role="alert" className="ga-premium-error">{error}</p> : null}
          {done ? <p role="status" className="ga-premium-ok">{c.done}</p> : null}
        </form>
      </section>
    </div>, document.body) : null}
  </>;
}
