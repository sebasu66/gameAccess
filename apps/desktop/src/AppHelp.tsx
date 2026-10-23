import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CircleHelp, Copy, Mail } from "lucide-react";
import { useI18n } from "./i18n";
import { useDialogFocus } from "./dialogFocus";
import { GaClose, GaIconButton } from "./components/ga/Buttons";

/** Where support messages go. Build-time default, overridable on this computer. */
export function supportEmail(): string {
 try { const saved = localStorage.getItem("gameaccess:support-email")?.trim(); if (saved) return saved; } catch { /* storage may be blocked */ }
 return String(import.meta.env.VITE_GAMEACCESS_SUPPORT_EMAIL ?? "").trim();
}
export function supportMailto(email: string, subject: string): string {
 return `mailto:${email}?subject=${encodeURIComponent(subject)}`;
}

type Topic = { title: string; steps: string[] };
const copy = {
 es: {
  title: "Ayuda", subtitle: "Cómo se hacen las cosas", close: "Cerrar", contact: "Contacto", contactText: "¿Algo no funciona o tenés una pregunta? Escribinos y te respondemos por correo.",
  write: "Escribir un correo", copyMail: "Copiar dirección", copied: "¡Copiada!", noMail: "Todavía no hay un correo de contacto configurado.", subject: "Ayuda con Game Access",
  topics: [
   { title: "Bajar un juego", steps: ["Entrá al Catálogo y elegí un juego.", "Tocá «Descargar». El juego empieza a prepararse y verás el avance abajo.", "Cuando termina, aparece «Jugar». Lo encontrás también en tu Librería."] },
   { title: "Mi Librería", steps: ["Tocá el botón de la biblioteca sobre la portada para sumar un juego a tu Librería.", "El pulgar arriba o abajo solo cuenta tu gusto; no cambia lo que hay en la Librería.", "Con Tab pasás rápido entre Catálogo y Librería."] },
   { title: "Atajos del teclado", steps: ["Flechas: moverte entre portadas.", "Enter: abrir el juego seleccionado.", "Ctrl + F: buscar. Esc: volver atrás.", "Tab: cambiar entre Catálogo y Librería."] },
   { title: "Mi acceso (BASE y PLUS)", steps: ["Arriba a la derecha ves tu plan. En BASE también ves cuánto tiempo te queda.", "Si se termina, ingresá una llave nueva para seguir.", "PLUS permite descargas completas sin esperar."] },
   { title: "Si una descarga no avanza", steps: ["Mirá el mensaje de estado: a veces el servidor está reuniendo el juego y tarda unos minutos.", "Si dice error, cancelá la descarga y volvé a pedirla.", "Si sigue igual, escribinos desde «Contacto» contando el nombre del juego."] },
  ] as Topic[],
 },
 en: {
  title: "Help", subtitle: "How to do things", close: "Close", contact: "Contact", contactText: "Something not working, or a question? Write to us and we'll answer by email.",
  write: "Write an email", copyMail: "Copy address", copied: "Copied!", noMail: "No contact email is configured yet.", subject: "Help with Game Access",
  topics: [
   { title: "Download a game", steps: ["Open the Catalog and pick a game.", "Press “Download”. The game starts getting ready and you'll see progress at the bottom.", "When it finishes, “Play” appears. You'll also find it in your Library."] },
   { title: "My Library", steps: ["Press the library button over a cover to add a game to your Library.", "Thumbs up or down only record your taste; they don't change what is in the Library.", "Tab switches quickly between Catalog and Library."] },
   { title: "Keyboard shortcuts", steps: ["Arrows: move between covers.", "Enter: open the selected game.", "Ctrl + F: search. Esc: go back.", "Tab: switch between Catalog and Library."] },
   { title: "My access (BASE and PLUS)", steps: ["Your plan is at the top right. On BASE you also see how much time is left.", "When it ends, enter a new key to continue.", "PLUS allows full downloads without waiting."] },
   { title: "If a download doesn't move", steps: ["Read the status message: sometimes the server is gathering the game and it takes a few minutes.", "If it says error, cancel the download and request it again.", "If it stays the same, write to us from “Contact” with the game's name."] },
  ] as Topic[],
 },
};

function HelpPanel({ onClose }: { onClose: () => void }) {
 const { locale } = useI18n(); const c = copy[locale];
 const panel = useDialogFocus(onClose);
 const email = supportEmail();
 const [copied, setCopied] = useState(false);
 const copyMail = () => { void navigator.clipboard?.writeText(email).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1800); }).catch(() => undefined); };
 return <div className="ga-settings-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
  <section ref={panel} className="ga-settings-panel ga-help-panel" role="dialog" aria-modal="true" aria-labelledby="ga-help-title">
   <header><div><span className="eyebrow">GAME ACCESS</span><h2 id="ga-help-title">{c.title}</h2><p>{c.subtitle}</p></div><GaClose label={c.close} onClick={onClose} data-dialog-initial /></header>
   <div className="ga-settings-content">
    {c.topics.map((topic, index) => <details key={topic.title} className="ga-settings-group ga-help-topic" open={index === 0}>
     <summary>{topic.title}</summary>
     <ol>{topic.steps.map(step => <li key={step}>{step}</li>)}</ol>
    </details>)}
    <div className="ga-help-contact" aria-labelledby="ga-help-contact-title">
     <h3 id="ga-help-contact-title">{c.contact}</h3>
     <p>{c.contactText}</p>
     {email
      ? <div className="ga-help-actions">
         <a className="ga-help-write" href={supportMailto(email, c.subject)}><Mail size={16} />{c.write}</a>
         <button type="button" onClick={copyMail}><Copy size={16} />{copied ? c.copied : c.copyMail}</button>
         <span className="ga-help-address">{email}</span>
        </div>
      : <p className="ga-help-missing">{c.noMail}</p>}
    </div>
   </div>
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
