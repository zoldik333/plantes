import { useEffect, useRef, useState } from "react";
import { LABELS, PULL_THRESHOLD, isOurGesture, pullDistance, shouldRefresh, type PullMode } from "../lib/pull";
import { refreshAll } from "../lib/refresh";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * « Tirer vers le bas pour actualiser » : depuis le haut de la page, un geste vers le bas recharge les données
 * affichées (plantes, foyer, journal…) sans recharger l'application. Un petit indicateur suit le doigt.
 * Écoute `window` : aucun écran n'a rien à faire.
 */
export function PullToRefresh() {
  const bar = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<PullMode>("idle");

  useEffect(() => {
    let current: PullMode = "idle";
    const setBoth = (m: PullMode) => {
      current = m;
      setMode(m);
    };
    let tracking = false;
    let startX = 0;
    let startY = 0;
    let pull = 0;

    // Position de l'indicateur : écrite directement dans le style (pas de re-rendu à chaque pixel).
    const paint = (distance: number, animate: boolean) => {
      const el = bar.current;
      if (!el) return;
      el.style.transition = animate ? "transform 200ms ease-out, opacity 200ms ease-out" : "none";
      el.style.transform = `translateY(${distance - 56}px)`;
      el.style.opacity = String(Math.min(1, distance / PULL_THRESHOLD));
    };

    const onStart = (e: TouchEvent) => {
      if (current === "refreshing") return;
      const t = e.touches[0];
      const target = e.target as Element | null;
      tracking =
        e.touches.length === 1 &&
        window.scrollY <= 0 &&
        !target?.closest("input, textarea, select, [contenteditable='true']");
      startX = t?.clientX ?? 0;
      startY = t?.clientY ?? 0;
      pull = 0;
    };

    const onMove = (e: TouchEvent) => {
      if (!tracking) return;
      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (pull === 0 && !isOurGesture({ touches: e.touches.length, scrollY: window.scrollY, startsInField: false, dx, dy })) {
        // Vers le haut, horizontal ou page déjà défilée : ce n'est pas notre geste, on laisse faire le navigateur.
        if (Math.abs(dx) > 8 || dy < -8 || window.scrollY > 0) tracking = false;
        return;
      }
      pull = pullDistance(dy);
      if (e.cancelable) e.preventDefault(); // empêche le « rebond » natif d'iOS pendant qu'on tire
      paint(pull, false);
      setBoth(shouldRefresh(pull) ? "ready" : "pulling");
    };

    const onEnd = async () => {
      if (!tracking) return;
      tracking = false;
      if (shouldRefresh(pull)) {
        setBoth("refreshing");
        paint(PULL_THRESHOLD, true);
        await Promise.all([refreshAll(), wait(600)]); // 600 ms minimum : on voit que quelque chose s'est passé
      }
      pull = 0;
      paint(0, true);
      setBoth("idle");
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  return (
    <div
      ref={bar}
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-0 z-50 flex -translate-y-14 justify-center pt-[calc(env(safe-area-inset-top)+0.5rem)] opacity-0"
    >
      <div className="flex items-center gap-2 rounded-full bg-leaf-700 px-4 py-2 text-sm font-medium text-white shadow-md">
        <span className={`inline-block size-4 rounded-full border-2 border-white/40 border-t-white ${mode === "refreshing" ? "animate-spin" : ""}`} />
        {LABELS[mode] || LABELS.pulling}
      </div>
    </div>
  );
}
