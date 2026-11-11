import { useCallback, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { CircleHelp, Copy, Send } from "lucide-react";
import { useI18n } from "./i18n";
import { useDialogFocus } from "./dialogFocus";
import { GaButton, GaClose, GaIconButton } from "./components/ga/Buttons";
import { sendSupportMessage, type SupportResult } from "./supportMessage";

const SUPPORT_EMAIL = "game-access-contacto@proton.me";

/** Where support messages go: the build's address, overridable on this computer, or the project's own. */
export function supportEmail(): string {
 try { const saved = localStorage.getItem("gameaccess:support-email")?.trim(); if (saved) return saved; } catch { /* storage may be blocked */ }
 return String(import.meta.env.VITE_GAMEACCESS_SUPPORT_EMAIL ?? "").trim() || SUPPORT_EMAIL;
}

const RESULT_TEXT = { sent: "contactSent", offline: "contactOffline", too_many: "contactTooMany", invalid_email: "contactInvalidEmail", failed: "contactFailed" } as const;

/** The contact form (vault/Tareas.md L2): the message goes to the server, which keeps it and mails it to Seba. */
function ContactForm() {
 const { t, locale } = useI18n();
 const [subject, setSubject] = useState("");
 const [message, setMessage] = useState("");
 const [email, setEmail] = useState("");
 const [attachLog, setAttachLog] = useState(true);
 const [sending, setSending] = useState(false);
 const [result, setResult] = useState<SupportResult | null>(null);
 const ready = subject.trim() !== "" && message.trim() !== "" && !sending;
 const submit = async (event: FormEvent) => {
  event.preventDefault();
  if (!ready) return;
  setSending(true); setResult(null);
  const outcome = await sendSupportMessage({ subject, message, email, language: locale, attachLog });
  setSending(false); setResult(outcome);
  if (outcome === "sent") { setSubject(""); setMessage(""); }
 };
 return <form className="ga-help-form ga-stack" data-no-autofocus onSubmit={submit}>
  <label className="ga-field"><span>{t("contactSubject")}</span>
   <input value={subject} maxLength={120} placeholder={t("contactSubjectPlaceholder")} onChange={event => setSubject(event.target.value)} /></label>
  <label className="ga-field"><span>{t("contactMessage")}</span>
   <textarea value={message} maxLength={5000} rows={5} placeholder={t("contactMessagePlaceholder")} onChange={event => setMessage(event.target.value)} /></label>
  <label className="ga-field"><span>{t("contactEmail")}</span>
   <input type="email" value={email} maxLength={254} autoComplete="email" onChange={event => setEmail(event.target.value)} /></label>
  <label className="ga-help-check"><input type="checkbox" tabIndex={-1} checked={attachLog} onChange={event => setAttachLog(event.target.checked)} />{t("contactAttachLog")}</label>
  <div className="ga-actions">
   <GaButton type="submit" variant="primary" icon={<Send size={16} aria-hidden="true" />} disabled={!ready}>{t(sending ? "contactSending" : "contactSend")}</GaButton>
  </div>
  {result ? <p className={result === "sent" ? "ga-status is-ok" : "ga-status is-error"} role="status">{t(RESULT_TEXT[result])}</p> : null}
 </form>;
}

type Topic = { title: string; steps: string[] };
const copy = {
 es: {
  title: "Ayuda", subtitle: "Cómo se hacen las cosas", close: "Cerrar", contact: "Contacto", contactText: "¿Algo no funciona o tenés una pregunta? Escribinos y te respondemos por correo.",
  copyMail: "Copiar dirección", copied: "¡Copiada!",
  topics: [
   { title: "Sumar juegos", steps: ["Abrí «Administrar biblioteca» (abajo a la derecha).", "Los que ya tenés en la PC: «Importar juegos» o «Importar biblioteca de Steam».", "Para bajar uno con un enlace o un magnet: «Agregar un link», elegí de qué juego es y pegá el enlace.", "Se descarga y se prepara solo; después lo encontrás en tu Librería con «Jugar»."] },
   { title: "Mi Librería", steps: ["Tocá el botón de la biblioteca sobre la portada para sumar un juego a tu Librería.", "El pulgar arriba o abajo solo cuenta tu gusto; no cambia lo que hay en la Librería.", "Con Tab pasás rápido entre Catálogo y Librería."] },
   { title: "Atajos del teclado", steps: ["Flechas: moverte entre portadas.", "Enter: abrir el juego seleccionado.", "Ctrl + F: buscar. Esc: volver atrás.", "Tab: cambiar entre Catálogo y Librería."] },
   { title: "Mi acceso (BASE y PLUS)", steps: ["El modo BASE es gratis y no vence: catálogo, Librería, descargas y jugar.", "PLUS es la suscripción mensual: descargas completas sin esperar, varias a la vez, y el modo niños.", "Si PLUS vence, Game Access sigue funcionando en BASE; no se borra nada."] },
   { title: "Si una descarga no avanza", steps: ["Mirá el avance y el mensaje de estado en el panel de descargas.", "Si dice error, cancelá la descarga y volvé a agregar el link: a veces el enlace venció o no tiene fuentes.", "Si sigue igual, escribinos desde «Contacto» contando el nombre del juego."] },
  ] as Topic[],
 },
 en: {
  title: "Help", subtitle: "How to do things", close: "Close", contact: "Contact", contactText: "Something not working, or a question? Write to us and we'll answer by email.",
  copyMail: "Copy address", copied: "Copied!",
  topics: [
   { title: "Add games", steps: ["Open “Manage library” (bottom right).", "Games already on this PC: “Import games” or “Import Steam library”.", "To download one from a link or a magnet: “Add a link”, pick which game it is and paste the link.", "It downloads and gets ready by itself; then you'll find it in your Library with “Play”."] },
   { title: "My Library", steps: ["Press the library button over a cover to add a game to your Library.", "Thumbs up or down only record your taste; they don't change what is in the Library.", "Tab switches quickly between Catalog and Library."] },
   { title: "Keyboard shortcuts", steps: ["Arrows: move between covers.", "Enter: open the selected game.", "Ctrl + F: search. Esc: go back.", "Tab: switch between Catalog and Library."] },
   { title: "My access (BASE and PLUS)", steps: ["BASE mode is free and never expires: catalog, Library, downloads and playing.", "PLUS is the monthly subscription: full downloads without waiting, several at a time, and kid mode.", "If PLUS ends, Game Access keeps working on BASE; nothing is deleted."] },
   { title: "If a download doesn't move", steps: ["Check the progress and the status message in the downloads panel.", "If it says error, cancel the download and add the link again: sometimes the link expired or has no sources.", "If it stays the same, write to us from “Contact” with the game's name."] },
  ] as Topic[],
 },
};

/** The help's topics and the contact: in the help dialog and in Home (docs/GUI_DESIGN.md §0b). */
/** Help topics and contact; `part` draws only one of them (the new shell's Help › FAQ / Contact us). */
export function HelpContent({ part }: { part?: "faq" | "contact" } = {}) {
 const { locale, t } = useI18n(); const c = copy[locale];
 const email = supportEmail();
 const [copied, setCopied] = useState(false);
 const copyMail = () => { void navigator.clipboard?.writeText(email).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1800); }).catch(() => undefined); };
 return <>
  {part === "contact" ? null : c.topics.map((topic, index) => <details key={topic.title} className="ga-settings-group ga-help-topic" open={index === 0}>
   <summary>{topic.title}</summary>
   <ol>{topic.steps.map(step => <li key={step}>{step}</li>)}</ol>
  </details>)}
  {part === "faq" ? null : <div className="ga-help-contact" aria-labelledby="ga-help-contact-title">
   <h3 id="ga-help-contact-title">{c.contact}</h3>
   <p>{c.contactText}</p>
   <ContactForm />
   <div className="ga-help-actions">
    <span className="ga-hint">{t("contactOrMail", { email })}</span>
    <GaButton icon={<Copy size={16} aria-hidden="true" />} onClick={copyMail}>{copied ? c.copied : c.copyMail}</GaButton>
   </div>
  </div>}
 </>;
}

function HelpPanel({ onClose }: { onClose: () => void }) {
 const { locale } = useI18n(); const c = copy[locale];
 const panel = useDialogFocus(onClose);
 return <div className="ga-settings-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
  <section ref={panel} className="ga-settings-panel ga-help-panel" role="dialog" aria-modal="true" aria-labelledby="ga-help-title">
   <header><div><span className="eyebrow">GAME ACCESS</span><h2 id="ga-help-title">{c.title}</h2><p>{c.subtitle}</p></div><GaClose label={c.close} onClick={onClose} data-dialog-initial /></header>
   <div className="ga-settings-content"><HelpContent /></div>
  </section>
 </div>;
}

export default function AppHelp({ dockTarget = null }: { dockTarget?: HTMLElement | null }) {
 const { locale } = useI18n(); const c = copy[locale];
 const [open, setOpen] = useState(false);
 const trigger = useRef<HTMLButtonElement>(null);
 const close = useCallback(() => { setOpen(false); trigger.current?.focus({ preventScroll: true }); }, []);
 const button = <GaIconButton ref={trigger} className="ga-help-fab" icon={<CircleHelp size={20} aria-hidden="true" />} label={c.title} onClick={() => setOpen(true)} />;
 return <>
  {dockTarget ? createPortal(button, dockTarget) : button}
  {open ? <HelpPanel onClose={close} /> : null}</>;
}
