import { useState, type FormEvent } from "react";
import { Link, useLocation } from "wouter";
import type { PlantSummary, Room } from "@plantes/shared";
import { Icon } from "../components/Icon";
import { Button, Card, Field, Notice, Page, PageHeader, PlantPlaceholder, inputClass, labelClass, linkClass, useAction } from "../components/ui";
import { api } from "../lib/api";
import { useFetch } from "../lib/fetch";
import { uploadPhoto } from "../lib/photos";

export default function PlantNew() {
  const [, navigate] = useLocation();
  const rooms = useFetch<Room[]>("/api/rooms");
  const { busy, error, run } = useAction();
  const [name, setName] = useState("");
  const [roomId, setRoomId] = useState("");
  const [withSheet, setWithSheet] = useState(true);
  const [watered, setWatered] = useState("0");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const plant = await api<PlantSummary>("/api/plants", { method: "POST", json: { name, roomId: roomId || null } });
      if (file) {
        try {
          await uploadPhoto(plant.id, file);
        } catch {
          /* la plante existe déjà : on pourra rajouter la photo depuis sa fiche */
        }
      }
      // Dernier arrosage : sans lui, le premier rappel n'arriverait qu'un intervalle complet après l'ajout.
      await api(`/api/plants/${plant.id}/events`, { method: "POST", json: { type: "watered", daysAgo: Number(watered) } }).catch(() => {});
      // La génération démarre après l'envoi de la photo, pour que l'IA la voie.
      if (withSheet) await api(`/api/plants/${plant.id}/care-sheet`, { method: "POST" }).catch(() => {});
      navigate(`/plants/${plant.id}`);
    });
  };

  return (
    <Page>
      <Link href="/plants" className="-ml-1 inline-flex min-h-12 items-center gap-1 self-start pr-2 text-label text-ink-muted active:opacity-70">
        <Icon name="back" />
        Mes plantes
      </Link>
      <PageHeader title="Nouvelle plante" />
      <Card>
        <form onSubmit={submit} className="flex flex-col gap-5">
          <Field label="Nom" placeholder="ex. Calathea du salon" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
          <div className="flex flex-col gap-1.5">
            <label className={labelClass}>
              Pièce
              <select value={roomId} onChange={(e) => setRoomId(e.target.value)} className={inputClass}>
                <option value="">Sans pièce</option>
                {rooms.data?.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            {rooms.data?.length === 0 && (
              <p className="text-body-sm text-ink-muted">
                Tu n'as pas encore de pièce.{" "}
                <Link href="/rooms" className={linkClass}>
                  En créer une
                </Link>
              </p>
            )}
          </div>
          <label className="flex items-center gap-4 rounded-md bg-surface-sunken p-3 text-ink focus-within:outline-2 focus-within:outline-focus-ring active:opacity-80">
            {preview ? (
              <img src={preview} alt="Aperçu" className="size-20 shrink-0 rounded-sm object-cover" />
            ) : (
              <PlantPlaceholder className="size-20 shrink-0 rounded-sm" />
            )}
            <span className="flex min-w-0 flex-col gap-1">
              <span className="text-label">Photo (facultatif)</span>
              <span className="flex items-center gap-1.5 text-body-sm text-ink-muted">
                <Icon name="camera" size={18} />
                {file ? "Changer la photo" : "Prendre ou choisir une photo"}
              </span>
            </span>
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                setPreview(f ? URL.createObjectURL(f) : null);
              }}
            />
          </label>
          <label className={labelClass}>
            Dernier arrosage
            <select value={watered} onChange={(e) => setWatered(e.target.value)} className={inputClass}>
              <option value="0">Aujourd'hui</option>
              <option value="2">Il y a 2 ou 3 jours</option>
              <option value="7">Il y a environ une semaine</option>
              <option value="14">Il y a plus de deux semaines (ou je ne sais pas)</option>
            </select>
            <span className="text-caption text-ink-muted">Le rappel d'arrosage s'en déduit.</span>
          </label>
          <label className="flex items-start gap-3 text-body-sm text-ink">
            <input type="checkbox" checked={withSheet} onChange={(e) => setWithSheet(e.target.checked)} className="mt-0.5 size-5 shrink-0 accent-leaf" />
            <span>
              <span className="flex items-center gap-1.5 font-semibold">
                <Icon name="sparkle" size={16} className="text-leaf" />
                Générer la fiche d'entretien avec Claude
              </span>
              <span className="block text-ink-muted">Prête en 15 à 30 secondes ; tu peux la corriger ensuite.</span>
            </span>
          </label>
          {error && <Notice kind="error">{error}</Notice>}
          <Button type="submit" variant="primary" icon="plus" disabled={busy || !name.trim()}>
            {busy ? "Création…" : "Ajouter la plante"}
          </Button>
        </form>
      </Card>
    </Page>
  );
}
