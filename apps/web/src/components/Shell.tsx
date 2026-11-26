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
 * Quatre onglets de même taille, en icône seule : l'actif sur un rond citron. Le libellé reste en texte masqué
 * (lecteurs d'écran, tests) plutôt qu'en aria-label : « Pièces » ne doit pas répondre à un libellé de champ « Pièce ».
 * Position basse : la barre empiète sur la zone de sécurité (34 px en PWA iOS) et s'arrête juste au-dessus de la barre
 * d'accueil (16 px du bord) ; 12 px du bord dans un navigateur sans zone de sécurité.
 */
export function Shell({ children }: { children: ReactNode }) {
  const [path] = useLocation();
  return (
    <>
      <PullToRefresh />
      <div className="pb-28">{children}</div>
      <nav
        aria-label="Navigation principale"
        className="fixed inset-x-4 bottom-[max(12px,calc(var(--safe-bottom)-18px))] z-40 mx-auto max-w-[26rem] rounded-full bg-glass p-2 shadow-float backdrop-blur-xl"
      >
        <ul className="flex items-center justify-around">
          {TABS.map((t) => {
            const active = t.match(path);
            return (
              <li key={t.href}>
                <Link
                  href={t.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex size-12 items-center justify-center rounded-full ${
                    active ? "bg-accent text-on-accent" : "text-ink-muted active:bg-surface-sunken"
                  }`}
                >
                  <Icon name={t.icon} size={22} />
                  <span className="sr-only">{t.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
