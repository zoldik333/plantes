/**
 * Créneau d'IA unique, partagé par la file des fiches et par le chat : l'abonnement Claude est partagé par tout le
 * foyer et la machine est modeste (un sous-processus Claude à la fois). Une génération de fiche, une question de
 * chat : jamais deux appels en parallèle.
 */
let held = false;
const waiters: { grant: () => void; cancel: () => void }[] = [];
const idleListeners: (() => void)[] = [];

/** Prend le créneau s'il est libre (utilisé par la file des fiches, qui ne bloque jamais). */
export function tryAcquire(): boolean {
  if (held) return false;
  held = true;
  return true;
}

/** Attend le créneau au plus `timeoutMs` (ordre d'arrivée) ; faux si le délai est dépassé. */
export function acquire(timeoutMs: number): Promise<boolean> {
  if (tryAcquire()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const w = {
      grant: () => {
        clearTimeout(timer);
        resolve(true);
      },
      cancel: () => resolve(false),
    };
    const timer = setTimeout(() => {
      const i = waiters.indexOf(w);
      if (i >= 0) waiters.splice(i, 1);
      w.cancel();
    }, timeoutMs);
    waiters.push(w);
  });
}

/** Rend le créneau : au premier qui attend (chat), sinon prévient la file des fiches. */
export function release(): void {
  const next = waiters.shift();
  if (next) return next.grant(); // le créneau reste pris, il passe de main en main
  held = false;
  for (const l of idleListeners) l();
}

/** Appelée chaque fois que le créneau devient libre sans demandeur en attente. */
export const onIdle = (listener: () => void): void => {
  idleListeners.push(listener);
};

/** Pour les tests de diagnostic : nombre d'appels en attente. */
export const waitingCount = () => waiters.length;
