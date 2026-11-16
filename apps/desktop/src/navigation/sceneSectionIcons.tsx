import type { ReactNode } from "react";

/** The 24×24 section drawings from the Escena prototype (SIC), mapped to the real navigation tree. */
const icon = (children: ReactNode) => <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">{children}</svg>;

export const SCENE_SECTION_ICONS: Record<string, ReactNode> = {
  explore: icon(<><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></>),
  smartSearch: icon(<><path d="M11 3.5l1.9 4.9 4.9 1.9-4.9 1.9L11 17.1l-1.9-4.9-4.9-1.9 4.9-1.9z" /><path d="M18.5 15v5M16 17.5h5" /></>),
  aiSuggestions: icon(<><path d="M9.5 18h5M10.5 21h3" /><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.1v.1h5v-.1c0-.8.4-1.6 1.1-2.1A6 6 0 0 0 12 3z" /></>),
  newGames: icon(<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />),
  tasteProfile: icon(<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.1a4.3 4.3 0 0 1 7.5 2.7C19.5 15.4 12 20 12 20z" />),
  play: icon(<path d="M8.5 5.5v13l10.5-6.5z" />),
  downloads: icon(<path d="M12 3.5v11.5M7 10l5 5 5-5M5 20h14" />),
  manager: icon(<><rect x="3.5" y="4.5" width="17" height="15" /><path d="M3.5 9.5h17M3.5 14.5h17M8.5 4.5v15" /></>),
  news: icon(<><path d="M4 10v4h3l6 4V6L7 10z" /><path d="M16.5 9a4 4 0 0 1 0 6M19 6.5a7.5 7.5 0 0 1 0 11" /></>),
  support: icon(<><circle cx="12" cy="12" r="8.5" /><path d="M9.6 9.3a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .9-1 1.6v.4M12 16.8h.01" /></>),
  subscription: icon(<path d="M3.5 8l4.3 4 4.2-6.5 4.2 6.5 4.3-4-2 11h-13z" />),
  general: icon(<><path d="M4 7h10M18 7h2M4 12h4M12 12h8M4 17h12" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="17" r="2" /></>),
  appearance: icon(<><path d="M12 3.5a8.5 8.5 0 1 0 0 17c1 0 1.5-.7 1.5-1.5 0-1.1-1-1.5-1-2.6 0-1 .8-1.5 1.7-1.5h2.3a4 4 0 0 0 4-4c0-4-3.8-7.4-8.5-7.4z" /><circle cx="7.6" cy="11.2" r=".9" /><circle cx="10" cy="7.4" r=".9" /><circle cx="14.6" cy="7.4" r=".9" /></>),
  plugins: icon(<path d="M9 3.5V8M15 3.5V8M6 8h12v3a6 6 0 0 1-12 0zM12 17v3.5" />),
  parental: icon(<path d="M12 3.5l7.5 2.8v5.5c0 4.7-3.2 7.6-7.5 8.7-4.3-1.1-7.5-4-7.5-8.7V6.3z" />),
};
