import type { ReactNode } from "react";
import { Link, useLocation } from "wouter";

const TABS = [
  { href: "/", icon: "💧", label: "Aujourd'hui", match: (p: string) => p === "/" },
  { href: "/plants", icon: "🌿", label: "Plantes", match: (p: string) => p.startsWith("/plants") },
  { href: "/rooms", icon: "🏠", label: "Pièces", match: (p: string) => p.startsWith("/rooms") },
  { href: "/settings", icon: "⚙️", label: "Réglages", match: (p: string) => p.startsWith("/settings") },
];

/** Cadre des pages connectées : contenu + barre d'onglets en bas (pouce de l'utilisateur). */
export function Shell({ children }: { children: ReactNode }) {
  const [path] = useLocation();
  return (
    <>
      <div className="pb-24">{children}</div>
      <nav className="fixed inset-x-0 bottom-0 border-t border-black/10 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <ul className="mx-auto flex max-w-md">
          {TABS.map((t) => (
            <li key={t.href} className="flex-1">
              <Link
                href={t.href}
                className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-medium ${
                  t.match(path) ? "text-leaf-700" : "text-stone-500"
                }`}
              >
                <span className="text-xl leading-none">{t.icon}</span>
                {t.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
