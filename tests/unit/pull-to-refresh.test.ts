// Logique du geste « tirer pour actualiser » et abonnements au rafraîchissement global (sans DOM).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PULL_MAX, PULL_THRESHOLD, isOurGesture, pullDistance, shouldRefresh } from "../../apps/web/src/lib/pull.js";
import { onRefresh, refreshAll } from "../../apps/web/src/lib/refresh.js";

describe("geste", () => {
  it("la distance tirée est freinée (moitié du doigt), jamais négative, plafonnée", () => {
    assert.equal(pullDistance(100), 50);
    assert.equal(pullDistance(-30), 0);
    assert.equal(pullDistance(10_000), PULL_MAX);
  });
  it("le seuil est atteint à 120 px de doigt, pas avant", () => {
    assert.equal(shouldRefresh(pullDistance(119)), false);
    assert.equal(shouldRefresh(pullDistance(120)), true);
    assert.equal(PULL_THRESHOLD, 60);
  });
  const base = { touches: 1, scrollY: 0, startsInField: false, dx: 4, dy: 40 };
  it("un geste vertical vers le bas, depuis le haut de la page, est le nôtre", () => assert.equal(isOurGesture(base), true));
  it("pas le nôtre : plusieurs doigts, page défilée, champ de saisie, vers le haut, plutôt horizontal", () => {
    assert.equal(isOurGesture({ ...base, touches: 2 }), false);
    assert.equal(isOurGesture({ ...base, scrollY: 1 }), false);
    assert.equal(isOurGesture({ ...base, startsInField: true }), false);
    assert.equal(isOurGesture({ ...base, dy: -40 }), false);
    assert.equal(isOurGesture({ ...base, dx: 60, dy: 40 }), false, "défilement horizontal des listes");
  });
});

describe("rafraîchissement global", () => {
  it("recharge tous les abonnés, et un abonné qui échoue n'empêche pas les autres", async () => {
    const seen: string[] = [];
    const off = [
      onRefresh(() => void seen.push("a")),
      onRefresh(async () => {
        throw new Error("panne");
      }),
      onRefresh(async () => void seen.push("c")),
    ];
    await refreshAll();
    assert.deepEqual(seen.sort(), ["a", "c"]);
    off.forEach((f) => f());
  });
  it("un abonné désabonné n'est plus appelé", async () => {
    let n = 0;
    const off = onRefresh(() => void n++);
    await refreshAll();
    off();
    await refreshAll();
    assert.equal(n, 1);
  });
});
