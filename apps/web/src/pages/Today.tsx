import { useEffect, useState } from "react";
import { Link } from "wouter";
import type { PlantSummary, Room, TodayResponse } from "@plantes/shared";
import { AiStatusBanner } from "../components/AiStatusBanner";
import { Icon } from "../components/Icon";
import { Button, Card, Notice, Page, PageHeader, Pill, PlantPlaceholder, SectionTitle, linkClass, useAction } from "../components/ui";
import { api } from "../lib/api";
import { longDate, relativeDays } from "../lib/dates";
import { useFetch, useFocusReload } from "../lib/fetch";
import { photoUrl } from "../lib/photos";

type Undo = { plantId: string; eventId: string; label: string };

function Thumb({ p }: { p: PlantSummary }) {
  return p.coverPhotoId ? (
    <img src={photoUrl(p.coverPhotoId, true)} alt="" className="size-16 shrink-0 rounded-sm object-cover" />
  ) : (
    <PlantPlaceholder className="size-16 shrink-0 rounded-sm" />
  );
}

export default function Today() {
  const today = useFetch<TodayResponse>("/api/today");
  const rooms = useFetch<Room[]>("/api/rooms");
  const plants = useFetch<PlantSummary[]>("/api/plants");
  const { busy, error, run } = useAction();
  const [undo, setUndo] = useState<Undo | null>(null);
  useFocusReload(today.reload);

  // Le bandeau « Annuler » disparaît seul au bout de 10 s.
  useEffect(() => {
    if (!undo) return;
    const id = setTimeout(() => setUndo(null), 10_000);
    return () => clearTimeout(id);
  }, [undo]);

  const roomName = (id: string | null) => rooms.data?.find((r) => r.id === id)?.name;

  const act = (p: PlantSummary, type: "watered" | "still_wet") =>
    void run(async () => {
      const ev = await api<{ id: string }>(`/api/plants/${p.id}/events`, { method: "POST", json: { type } });
      setUndo({ plantId: p.id, eventId: ev.id, label: `${p.name} : ${type === "watered" ? "arrosée" : "rappel repoussé"}` });
      await today.reload();
    });

  const cancel = () =>
    undo &&
    void run(async () => {
      await api(`/api/plants/${undo.plantId}/events/${undo.eventId}`, { method: "DELETE" });
      setUndo(null);
      await today.reload();
    });

  const data = today.data;
  const noPlants = plants.data?.length === 0;
  const askNotifications = "Notification" in window && Notification.permission === "default";

  const [first, ...others] = data?.due ?? [];

  return (
    <Page>
      <PageHeader overline={data ? longDate(data.date) : undefined} title="Aujourd'hui" />

      <AiStatusBanner />
      {askNotifications && (
        <Notice icon="bell">
          Active les notifications pour être prévenu quand une plante a soif.{" "}
          <Link href="/settings" className={linkClass}>
            Réglages
          </Link>
        </Notice>
      )}
      {today.error && <Notice kind="error">{today.error}</Notice>}
      {error && <Notice kind="error">{error}</Notice>}
      {!data && !today.error && <Notice>Chargement…</Notice>}

      {undo && (
        <div className="flex items-center justify-between gap-3 rounded-md bg-surface-deep py-2 pr-2 pl-4 text-body-sm text-on-deep shadow-float">
          <span className="flex min-w-0 items-center gap-2">
            <Icon name="check" className="text-accent" />
            <span className="min-w-0 break-words">{undo.label}</span>
          </span>
          <Button variant="on-deep" disabled={busy} onClick={cancel}>
            Annuler
          </Button>
        </div>
      )}

      {noPlants && (
        <Notice icon="leaf">
          Tu n'as pas encore de plante.{" "}
          <Link href="/plants/new" className={linkClass}>
            Ajoute la première
          </Link>{" "}
          : une fiche avec le rythme d'arrosage sera générée.
        </Notice>
      )}

      {data && data.due.length === 0 && !noPlants && (
        <Card>
          <div className="flex items-center gap-4">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-success-soft text-success">
              <Icon name="check" size={24} />
            </span>
            <div className="flex flex-col">
              <p className="text-title text-ink">Rien à arroser aujourd'hui</p>
              <p className="text-body-sm text-ink-muted">Toutes les plantes sont à jour.</p>
            </div>
          </div>
        </Card>
      )}

      {data && first && (
        <section className="flex flex-col gap-3">
          <SectionTitle>À arroser · {data.due.length}</SectionTitle>
          <ul className="flex flex-col gap-3">
            <li>
              <Card tone="deep">
                <p className="flex items-baseline gap-2">
                  <span className="text-numeral">{data.due.length}</span>
                  <span className="text-title text-on-deep-muted">plante{data.due.length > 1 ? "s" : ""} à arroser</span>
                </p>
                <Link href={`/plants/${first.id}`} className="flex items-center gap-3 rounded-md active:opacity-80">
                  <Thumb p={first} />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-title text-on-deep">{first.name}</span>
                    <span className="truncate text-body-sm text-on-deep-muted">{roomName(first.roomId) ?? "Sans pièce"}</span>
                    <span className="flex items-center gap-1 text-label text-accent">
                      <Icon name="clock" size={16} />
                      {relativeDays(first.water!.daysUntil)}
                    </span>
                  </span>
                </Link>
                <div className="mt-1 flex gap-2">
                  <Button variant="primary" icon="drop" className="flex-1" disabled={busy} onClick={() => act(first, "watered")}>
                    Arrosée
                  </Button>
                  <Button variant="on-deep" className="flex-none" disabled={busy} onClick={() => act(first, "still_wet")}>
                    Encore humide
                  </Button>
                </div>
              </Card>
            </li>
            {others.map((p) => (
              <li key={p.id}>
                <Card>
                  <Link href={`/plants/${p.id}`} className="flex items-center gap-3 rounded-md active:opacity-80">
                    <Thumb p={p} />
                    <span className="flex min-w-0 flex-col gap-1">
                      <span className="truncate text-title text-ink">{p.name}</span>
                      <span className="truncate text-body-sm text-ink-muted">{roomName(p.roomId) ?? "Sans pièce"}</span>
                      <Pill tone="water" icon="drop">
                        {relativeDays(p.water!.daysUntil)}
                      </Pill>
                    </span>
                  </Link>
                  <div className="flex gap-2">
                    <Button variant="dark" icon="drop" className="flex-1" disabled={busy} onClick={() => act(p, "watered")}>
                      Arrosée
                    </Button>
                    <Button variant="secondary" className="flex-none" disabled={busy} onClick={() => act(p, "still_wet")}>
                      Encore humide
                    </Button>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data && data.upcoming.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionTitle>Dans les 7 prochains jours</SectionTitle>
          <ul className="flex flex-col divide-y divide-line rounded-lg bg-surface px-5 shadow-card">
            {data.upcoming.map((p) => (
              <li key={p.id}>
                <Link href={`/plants/${p.id}`} className="flex min-h-14 items-center justify-between gap-3 py-2 active:opacity-70">
                  <span className="truncate text-body font-semibold text-ink">{p.name}</span>
                  <span className="flex shrink-0 items-center gap-1 text-body-sm text-ink-muted">
                    {relativeDays(p.water!.daysUntil)}
                    <Icon name="chevron" size={16} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data && data.withoutSheet > 0 && (
        <Notice>
          {data.withoutSheet} plante{data.withoutSheet > 1 ? "s n'ont" : " n'a"} pas de fiche : aucun rappel pour {data.withoutSheet > 1 ? "elles" : "elle"}.{" "}
          <Link href="/plants" className={linkClass}>
            Voir mes plantes
          </Link>
        </Notice>
      )}
    </Page>
  );
}
