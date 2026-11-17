import { useState, type FormEvent } from "react";
import { Link, useLocation } from "wouter";
import type { PlantSummary, Room } from "@plantes/shared";
import { Button, Card, Field, Notice, Page, useAction } from "../components/ui";
import { api } from "../lib/api";
import { useFetch } from "../lib/fetch";
import { uploadPhoto } from "../lib/photos";

export default function PlantNew() {
  const [, navigate] = useLocation();
  const rooms = useFetch<Room[]>("/api/rooms");
  const { busy, error, run } = useAction();
  const [name, setName] = useState("");
  const [roomId, setRoomId] = useState("");
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
      navigate(`/plants/${plant.id}`);
    });
  };

  return (
    <Page>
      <Link href="/" className="pt-2 text-sm font-medium text-leaf-700">
        ← Mes plantes
      </Link>
      <Card title="Nouvelle plante">
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Field label="Nom" placeholder="ex. Calathea du salon" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
          <label className="flex flex-col gap-1 text-sm font-medium text-stone-700">
            Pièce
            <select
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
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
          {rooms.data?.length === 0 && (
            <p className="text-sm text-stone-500">
              Tu n'as pas encore de pièce. <Link href="/rooms" className="underline">En créer une</Link>
            </p>
          )}
          <label className="flex flex-col gap-1 text-sm font-medium text-stone-700">
            Photo (facultatif)
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                setPreview(f ? URL.createObjectURL(f) : null);
              }}
            />
          </label>
          {preview && <img src={preview} alt="Aperçu" className="max-h-60 rounded-xl object-cover" />}
          {error && <Notice kind="error">{error}</Notice>}
          <Button type="submit" disabled={busy || !name.trim()}>
            {busy ? "Création…" : "Ajouter la plante"}
          </Button>
        </form>
      </Card>
    </Page>
  );
}
