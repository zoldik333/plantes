import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import type { CareSheet, PlantDetail as Plant, Room } from "@plantes/shared";
import { AiStatusBanner } from "../components/AiStatusBanner";
import { Icon } from "../components/Icon";
import { Button, Card, Field, Notice, Page, PlantPlaceholder, buttonClass, inputClass, labelClass, useAction } from "../components/ui";
import { api } from "../lib/api";
import { useFetch, usePoll } from "../lib/fetch";
import { photoUrl, uploadPhoto } from "../lib/photos";
import { CareCard } from "../components/Journal";
import { CareSheetEditor } from "../components/CareSheetEditor";
import { CareSheetView } from "../components/CareSheetView";
import { SheetStatus } from "../components/SheetStatus";

function BackLink() {
  return (
    <Link href="/plants" className="-ml-1 inline-flex min-h-12 items-center gap-1 self-start pr-3 text-label text-ink-muted active:opacity-70">
      <Icon name="back" />
      Mes plantes
    </Link>
  );
}

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
        <BackLink />
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
      <BackLink />
      <AiStatusBanner />

      {shownPhoto ? (
        <img src={photoUrl(shownPhoto)} alt={p.name} className="max-h-96 w-full rounded-xl object-cover shadow-card" />
      ) : (
        <PlantPlaceholder className="h-48 w-full rounded-xl" size={56} />
      )}

      <div className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 py-1">
        {p.photoIds.map((pid, i) => (
          <button
            key={pid}
            type="button"
            aria-label={`Afficher la photo ${i + 1}`}
            aria-pressed={pid === shownPhoto}
            onClick={() => setSelected(pid)}
            className={`shrink-0 rounded-sm ${pid === shownPhoto ? "ring-2 ring-ink ring-offset-2 ring-offset-bg" : ""}`}
          >
            <img src={photoUrl(pid, true)} alt="" className="size-14 rounded-sm object-cover" />
          </button>
        ))}
        <label className={buttonClass("secondary", "shrink-0 cursor-pointer")}>
          <Icon name="camera" />
          Ajouter
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
          <Button variant="danger" icon="trash" className="shrink-0" disabled={busy} onClick={() => removePhoto(shownPhoto)}>
            Retirer
          </Button>
        )}
      </div>

      <h1 className="text-display break-words text-ink">{p.name}</h1>

      {error && <Notice kind="error">{error}</Notice>}

      <CareCard plantId={id} water={p.water} hasSheet={p.hasSheet} onChange={plant.reload} />

      <Card title="Informations">
        <Field label="Nom" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        {name.trim() && name.trim() !== p.name && (
          <Button variant="dark" icon="check" disabled={busy} onClick={() => void patch({ name })}>
            Enregistrer le nom
          </Button>
        )}
        <label className={labelClass}>
          Pièce
          <select value={p.roomId ?? ""} disabled={busy} onChange={(e) => void patch({ roomId: e.target.value || null })} className={inputClass}>
            <option value="">Sans pièce</option>
            {rooms.data?.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
      </Card>

      {p.job && <SheetStatus job={p.job} busy={busy} onRetry={() => generate(false)} />}

      {editing && p.careSheet ? (
        <CareSheetEditor sheet={p.careSheet} busy={busy} onSave={saveSheet} onCancel={() => setEditing(false)} />
      ) : p.careSheet ? (
        <>
          <CareSheetView s={p.careSheet} />
          {!p.job && (
            <div className="flex gap-2">
              <Button variant="secondary" icon="pencil" className="flex-1" disabled={busy} onClick={() => setEditing(true)}>
                Modifier
              </Button>
              <Button variant="secondary" icon="refresh" className="flex-1" disabled={busy} onClick={() => generate(true)}>
                Régénérer
              </Button>
            </div>
          )}
        </>
      ) : (
        !p.job && (
          <Card title="Fiche d'entretien">
            <p className="text-body-sm text-ink-muted">
              Claude peut rédiger une fiche simple à partir du nom{p.photoIds.length > 0 ? " et de la dernière photo" : ""} : arrosage, lumière, conseils.
            </p>
            {/* Sans fiche, la carte d'arrosage n'a pas de bouton : ce bouton est alors le seul primary de l'écran. */}
            <Button variant="primary" icon="sparkle" disabled={busy} onClick={() => generate(false)}>
              Générer la fiche
            </Button>
          </Card>
        )
      )}

      <Button variant="danger" icon="trash" disabled={busy} onClick={removePlant}>
        Supprimer cette plante
      </Button>
    </Page>
  );
}
