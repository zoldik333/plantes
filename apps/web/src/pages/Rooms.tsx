import { useState, type FormEvent } from "react";
import type { Room } from "@plantes/shared";
import { Button, Card, Field, Notice, Page, useAction } from "../components/ui";
import { api } from "../lib/api";
import { useFetch } from "../lib/fetch";

export default function Rooms() {
  const rooms = useFetch<Room[]>("/api/rooms");
  const { busy, error, run } = useAction();
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);

  const add = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await api("/api/rooms", { method: "POST", json: { name } });
      setName("");
      await rooms.reload();
    });
  };

  const rename = () =>
    editing &&
    void run(async () => {
      await api(`/api/rooms/${editing.id}`, { method: "PATCH", json: { name: editing.name } });
      setEditing(null);
      await rooms.reload();
    });

  const remove = (r: Room) => {
    const extra = r.plantCount > 0 ? ` Ses ${r.plantCount} plante${r.plantCount > 1 ? "s" : ""} ne seront pas supprimée${r.plantCount > 1 ? "s" : ""} : elles passeront « sans pièce ».` : "";
    if (!window.confirm(`Supprimer la pièce « ${r.name} » ?${extra}`)) return;
    void run(async () => {
      await api(`/api/rooms/${r.id}`, { method: "DELETE" });
      await rooms.reload();
    });
  };

  return (
    <Page>
      <h1 className="pt-2 text-2xl font-bold text-leaf-800">Pièces</h1>
      <Card>
        <form onSubmit={add} className="flex items-end gap-2">
          <div className="flex-1">
            <Field label="Nouvelle pièce" placeholder="ex. Salon, Cuisine…" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
          </div>
          <Button type="submit" disabled={busy || !name.trim()}>
            Ajouter
          </Button>
        </form>
        {error && <Notice kind="error">{error}</Notice>}
      </Card>

      {rooms.data?.length === 0 && <Notice>Aucune pièce. Crée celles où tu as des plantes pour les retrouver facilement.</Notice>}
      <ul className="flex flex-col gap-2">
        {rooms.data?.map((r) => (
          <li key={r.id} className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-black/5">
            {editing?.id === r.id ? (
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Field label="Nom" value={editing.name} onChange={(e) => setEditing({ id: r.id, name: e.target.value })} maxLength={40} />
                </div>
                <Button disabled={busy || !editing.name.trim()} onClick={rename}>
                  OK
                </Button>
                <Button variant="secondary" onClick={() => setEditing(null)}>
                  Annuler
                </Button>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2">
                <span>
                  <span className="font-semibold">{r.name}</span>
                  <span className="block text-sm text-stone-500">
                    {r.plantCount} plante{r.plantCount > 1 ? "s" : ""}
                  </span>
                </span>
                <span className="flex gap-2">
                  <Button variant="secondary" className="min-h-9 px-3 py-1 text-sm" onClick={() => setEditing({ id: r.id, name: r.name })}>
                    Renommer
                  </Button>
                  <Button variant="danger" className="min-h-9 px-3 py-1 text-sm" disabled={busy} onClick={() => remove(r)}>
                    Supprimer
                  </Button>
                </span>
              </div>
            )}
          </li>
        ))}
      </ul>
    </Page>
  );
}
