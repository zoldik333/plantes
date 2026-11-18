import { useState } from "react";
import { Link } from "wouter";
import type { PlantSummary, Room } from "@plantes/shared";
import { Notice, Page } from "../components/ui";
import { useFetch, usePoll } from "../lib/fetch";
import { photoUrl } from "../lib/photos";

const NO_ROOM = "none";

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`min-h-9 shrink-0 rounded-full px-3 text-sm font-medium ${active ? "bg-leaf-700 text-white" : "bg-white text-stone-700 ring-1 ring-black/10"}`}
    >
      {children}
    </button>
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

  return (
    <Page>
      <header className="flex items-center justify-between pt-2">
        <h1 className="text-2xl font-bold text-leaf-800">Mes plantes</h1>
        <Link href="/plants/new" className="flex min-h-11 items-center rounded-xl bg-leaf-700 px-4 font-medium text-white active:bg-leaf-800">
          + Ajouter
        </Link>
      </header>

      {(rooms.data?.length ?? 0) > 0 && (
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
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
      {plants.data?.length === 0 && (
        <Notice>
          Aucune plante pour l'instant. Appuie sur « + Ajouter » pour commencer.
        </Notice>
      )}

      {(plants.data?.length ?? 0) > 0 && shown.length === 0 && <Notice>Aucune plante dans cette pièce.</Notice>}

      <ul className="grid grid-cols-2 gap-3">
        {shown.map((p) => (
          <li key={p.id}>
            <Link href={`/plants/${p.id}`} className="block overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/5 active:opacity-80">
              {p.coverPhotoId ? (
                <img src={photoUrl(p.coverPhotoId, true)} alt="" loading="lazy" className="aspect-square w-full object-cover" />
              ) : (
                <div className="flex aspect-square w-full items-center justify-center bg-leaf-50 text-5xl">🪴</div>
              )}
              <div className="p-3">
                <p className="truncate font-semibold text-stone-900">{p.name}</p>
                <p className="truncate text-sm text-stone-500">{roomName(p.roomId) ?? "Sans pièce"}</p>
                {p.job && p.job.status !== "error" && <p className="mt-1 text-xs font-medium text-leaf-700">⏳ Fiche en cours…</p>}
                {p.job?.status === "error" && <p className="mt-1 text-xs font-medium text-red-700">⚠️ Fiche à relancer</p>}
                {!p.job && !p.hasSheet && <p className="mt-1 text-xs text-stone-400">Pas de fiche</p>}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </Page>
  );
}
