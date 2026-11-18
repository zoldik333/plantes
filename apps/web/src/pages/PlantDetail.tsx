import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import type { CareSheet, PlantDetail as Plant, Room } from "@plantes/shared";
import { AiStatusBanner } from "../components/AiStatusBanner";
import { Button, Card, Field, Notice, Page, useAction } from "../components/ui";
import { api } from "../lib/api";
import { useFetch, usePoll } from "../lib/fetch";
import { photoUrl, uploadPhoto } from "../lib/photos";
import { CareCard } from "../components/Journal";
import { CareSheetEditor } from "../components/CareSheetEditor";
import { CareSheetView } from "../components/CareSheetView";
import { SheetStatus } from "../components/SheetStatus";

export default function PlantDetail({ id }: { id: string }) {
  const [, navigate] = useLocation();
  const plant = useFetch<Plant>(`/api/plants/${id}`);
  const rooms = useFetch<Room[]>("/api/rooms");
  const { busy, error, run } = useAction();
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const p = plant.data;
  // Tant qu'une génération est en file ou en cours, on rafraîchit la fiche toutes les 3 s.
  usePoll(!!p?.job && p.job.status !== "error", () => void plant.reload());
  useEffect(() => {
    if (p) setName(p.name);
  }, [p?.name]); // eslint-disable-line react-hooks/exhaustive-deps
  // Photo affichée : celle choisie si elle existe encore, sinon la plus récente.
  const shownPhoto = p && selected && p.photoIds.includes(selected) ? selected : (p?.photoIds[0] ?? null);

  if (plant.error) {
    return (
      <Page>
        <Link href="/plants" className="pt-2 text-sm font-medium text-leaf-700">
          ← Mes plantes
        </Link>
        <Notice kind="error">{plant.error}</Notice>
      </Page>
    );
  }
  if (!p) {
    return (
      <Page>
        <Notice>Chargement…</Notice>
      </Page>
    );
  }

  const patch = (body: object) =>
    run(async () => {
      await api(`/api/plants/${id}`, { method: "PATCH", json: body });
      await plant.reload();
    });

  const addPhoto = (file: File) =>
    run(async () => {
      setSelected(await uploadPhoto(id, file));
      await plant.reload();
    });

  const generate = (replace: boolean) => {
    if (replace && !window.confirm("Générer une nouvelle fiche remplace la fiche actuelle, y compris tes modifications. Continuer ?")) return;
    void run(async () => {
      await api(`/api/plants/${id}/care-sheet`, { method: "POST" });
      await plant.reload();
    });
  };

  const saveSheet = (careSheet: CareSheet) =>
    void run(async () => {
      await api(`/api/plants/${id}`, { method: "PATCH", json: { careSheet } });
      setEditing(false);
      await plant.reload();
    });

  const removePhoto = (photoId: string) => {
    if (!window.confirm("Supprimer cette photo ?")) return;
    void run(async () => {
      await api(`/api/plants/${id}/photos/${photoId}`, { method: "DELETE" });
      setSelected(null);
      await plant.reload();
    });
  };

  const removePlant = () => {
    if (!window.confirm(`Supprimer « ${p.name} » et ses photos ? Cette action est définitive.`)) return;
    void run(async () => {
      await api(`/api/plants/${id}`, { method: "DELETE" });
      navigate("/plants");
    });
  };

  return (
    <Page>
      <Link href="/plants" className="pt-2 text-sm font-medium text-leaf-700">
        ← Mes plantes
      </Link>
      <AiStatusBanner />

      <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
        {shownPhoto ? (
          <img src={photoUrl(shownPhoto)} alt={p.name} className="max-h-96 w-full object-cover" />
        ) : (
          <div className="flex h-48 items-center justify-center bg-leaf-50 text-6xl">🪴</div>
        )}
        <div className="flex items-center gap-2 overflow-x-auto p-2">
          {p.photoIds.map((pid) => (
            <button key={pid} onClick={() => setSelected(pid)} className={`shrink-0 rounded-lg ${pid === shownPhoto ? "ring-2 ring-leaf-600" : ""}`}>
              <img src={photoUrl(pid, true)} alt="" className="h-14 w-14 rounded-lg object-cover" />
            </button>
          ))}
          <label className="flex min-h-14 shrink-0 cursor-pointer items-center rounded-lg bg-leaf-50 px-3 text-sm font-medium text-leaf-800 ring-1 ring-leaf-100">
            📷 Ajouter
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void addPhoto(f);
              }}
            />
          </label>
          {shownPhoto && (
            <Button variant="danger" className="min-h-14 shrink-0 px-3 text-sm" disabled={busy} onClick={() => removePhoto(shownPhoto)}>
              Retirer cette photo
            </Button>
          )}
        </div>
      </div>

      {error && <Notice kind="error">{error}</Notice>}

      <Card title="Informations">
        <Field label="Nom" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        {name.trim() && name.trim() !== p.name && (
          <Button disabled={busy} onClick={() => void patch({ name })}>
            Enregistrer le nom
          </Button>
        )}
        <label className="flex flex-col gap-1 text-sm font-medium text-stone-700">
          Pièce
          <select
            value={p.roomId ?? ""}
            disabled={busy}
            onChange={(e) => void patch({ roomId: e.target.value || null })}
            className="min-h-11 rounded-xl border border-stone-300 bg-white px-3 text-base text-stone-900"
          >
            <option value="">Sans pièce</option>
            {rooms.data?.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
      </Card>

      <CareCard plantId={id} water={p.water} hasSheet={p.hasSheet} onChange={plant.reload} />

      {p.job && <SheetStatus job={p.job} busy={busy} onRetry={() => generate(false)} />}

      {editing && p.careSheet ? (
        <CareSheetEditor sheet={p.careSheet} busy={busy} onSave={saveSheet} onCancel={() => setEditing(false)} />
      ) : p.careSheet ? (
        <>
          <CareSheetView s={p.careSheet} />
          {!p.job && (
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" disabled={busy} onClick={() => setEditing(true)}>
                ✏️ Modifier
              </Button>
              <Button variant="secondary" className="flex-1" disabled={busy} onClick={() => generate(true)}>
                🔄 Régénérer
              </Button>
            </div>
          )}
        </>
      ) : (
        !p.job && (
          <Card title="Fiche d'entretien">
            <p className="text-sm text-stone-600">
              Claude peut rédiger une fiche simple à partir du nom{p.photoIds.length > 0 ? " et de la dernière photo" : ""} : arrosage, lumière, conseils.
            </p>
            <Button disabled={busy} onClick={() => generate(false)}>
              ✨ Générer la fiche
            </Button>
          </Card>
        )
      )}

      <Button variant="danger" disabled={busy} onClick={removePlant}>
        Supprimer cette plante
      </Button>
    </Page>
  );
}
