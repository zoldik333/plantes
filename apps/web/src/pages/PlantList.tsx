import { useState } from "react";
import { Link } from "wouter";
import type { PlantSummary, Room } from "@plantes/shared";
import { Icon } from "../components/Icon";
import { Chip, Notice, Page, PageHeader, Pill, PlantPlaceholder, buttonClass } from "../components/ui";
import { useFetch, usePoll } from "../lib/fetch";
import { photoUrl } from "../lib/photos";

const NO_ROOM = "none";

function PlantStatus({ p }: { p: PlantSummary }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {p.water && p.water.daysUntil <= 0 && (
        <Pill tone="water" icon="drop">
          À arroser
        </Pill>
      )}
      {p.job && p.job.status !== "error" && (
        <Pill tone="warning" icon="clock">
          Fiche en cours
        </Pill>
      )}
      {p.job?.status === "error" && (
        <Pill tone="danger" icon="alert">
          Fiche à relancer
        </Pill>
      )}
      {!p.job && !p.hasSheet && <Pill>Pas de fiche</Pill>}
    </div>
  );
}

export default function PlantList() {
  const plants = useFetch<PlantSummary[]>("/api/plants");
  const rooms = useFetch<Room[]>("/api/rooms");
  const [filter, setFilter] = useState<string | null>(null);
  usePoll((plants.data ?? []).some((p) => p.job && p.job.status !== "error"), () => void plants.reload(), 4000);

  const roomName = (id: string | null) => rooms.data?.find((r) => r.id === id)?.name;
  const shown = (plants.data ?? []).filter((p) => (filter === null ? true : filter === NO_ROOM ? p.roomId === null : p.roomId === filter));
  const hasUnassigned = (plants.data ?? []).some((p) => p.roomId === null);
  const count = plants.data?.length;

  return (
    <Page>
      <PageHeader
        overline={count !== undefined ? `${count} plante${count > 1 ? "s" : ""}` : undefined}
        title="Mes plantes"
        action={
          <Link href="/plants/new" className={buttonClass("dark", "shrink-0")}>
            <Icon name="plus" />
            Ajouter
          </Link>
        }
      />

      {(rooms.data?.length ?? 0) > 0 && (
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 py-1">
          <Chip active={filter === null} onClick={() => setFilter(null)}>
            Toutes
          </Chip>
          {rooms.data!.map((r) => (
            <Chip key={r.id} active={filter === r.id} onClick={() => setFilter(r.id)}>
              {r.name} · {r.plantCount}
            </Chip>
          ))}
          {hasUnassigned && (
            <Chip active={filter === NO_ROOM} onClick={() => setFilter(NO_ROOM)}>
              Sans pièce
            </Chip>
          )}
        </div>
      )}

      {plants.error && <Notice kind="error">{plants.error}</Notice>}
      {plants.loading && !plants.data && <Notice>Chargement…</Notice>}
      {plants.data?.length === 0 && <Notice>Aucune plante pour l'instant. Appuie sur « Ajouter » pour commencer.</Notice>}

      {(plants.data?.length ?? 0) > 0 && shown.length === 0 && <Notice>Aucune plante dans cette pièce.</Notice>}

      <ul className="grid grid-cols-2 gap-3">
        {shown.map((p) => (
          <li key={p.id}>
            <Link href={`/plants/${p.id}`} className="flex h-full flex-col overflow-hidden rounded-lg bg-surface shadow-card active:opacity-80">
              {p.coverPhotoId ? (
                <img src={photoUrl(p.coverPhotoId, true)} alt="" loading="lazy" className="aspect-square w-full object-cover" />
              ) : (
                <PlantPlaceholder className="aspect-square w-full" size={40} />
              )}
              <div className="flex flex-col gap-2 p-3">
                <div className="min-w-0">
                  <p className="truncate text-body font-bold text-ink">{p.name}</p>
                  <p className="truncate text-body-sm text-ink-muted">{roomName(p.roomId) ?? "Sans pièce"}</p>
                </div>
                <PlantStatus p={p} />
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </Page>
  );
}
