import type { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Icon, type IconName } from "./Icon";
import { PullToRefresh } from "./PullToRefresh";

const TABS: { href: string; icon: IconName; label: string; match: (p: string) => boolean }[] = [
  { href: "/", icon: "drop", label: "Aujourd'hui", match: (p) => p === "/" },
  { href: "/plants", icon: "leaf", label: "Plantes", match: (p) => p.startsWith("/plants") },
  { href: "/rooms", icon: "home", label: "Pièces", match: (p) => p.startsWith("/rooms") },
  { href: "/settings", icon: "settings", label: "Réglages", match: (p) => p.startsWith("/settings") },
];

/**
 * Cadre des pages connectées : contenu + barre d'onglets flottante en verre (pouce de l'utilisateur).
 * L'onglet actif est en citron avec son libellé ; les autres n'affichent que l'icône (libellé en texte masqué).
 */
export function Shell({ children }: { children: ReactNode }) {
  const [path] = useLocation();
  return (
    <>
      <PullToRefresh />
      <div className="pb-28">{children}</div>
      <nav
        aria-label="Navigation principale"
        className="fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+12px)] z-40 mx-auto max-w-[26rem] rounded-full bg-glass p-2 shadow-float backdrop-blur-xl"
      >
        <ul className="flex items-center justify-between">
          {TABS.map((t) => {
            const active = t.match(path);
            return (
              <li key={t.href}>
                {active ? (
                  <Link
                    href={t.href}
                    aria-current="page"
                    className="flex h-12 items-center gap-2 rounded-full bg-accent px-4 text-label font-bold text-on-accent"
                  >
                    <Icon name={t.icon} size={22} />
                    {t.label}
                  </Link>
                ) : (
                  <Link href={t.href} className="flex size-12 items-center justify-center rounded-full text-ink-muted active:bg-surface-sunken">
                    <Icon name={t.icon} size={22} />
                    {/* Texte masqué plutôt qu'aria-label : « Pièces » ne doit pas répondre à un libellé de champ « Pièce ». */}
                    <span className="sr-only">{t.label}</span>
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
