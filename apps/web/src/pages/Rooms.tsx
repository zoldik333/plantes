import { useState, type FormEvent } from "react";
import type { Room } from "@plantes/shared";
import { Icon } from "../components/Icon";
import { Button, Card, Field, Notice, Page, PageHeader, useAction } from "../components/ui";
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
      <PageHeader title="Pièces" />
      <Card>
        <form onSubmit={add} className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <Field label="Nouvelle pièce" placeholder="ex. Salon, Cuisine…" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
          </div>
          <Button type="submit" variant="primary" icon="plus" disabled={busy || !name.trim()}>
            Ajouter
          </Button>
        </form>
        {error && <Notice kind="error">{error}</Notice>}
      </Card>

      {rooms.data?.length === 0 && <Notice icon="home">Aucune pièce. Crée celles où tu as des plantes pour les retrouver facilement.</Notice>}
      <ul className="flex flex-col gap-3">
        {rooms.data?.map((r) => (
          <li key={r.id}>
            <Card>
              {editing?.id === r.id ? (
                <>
                  <Field label="Nom" value={editing.name} onChange={(e) => setEditing({ id: r.id, name: e.target.value })} maxLength={40} />
                  <div className="flex gap-2">
                    <Button variant="dark" icon="check" className="flex-1" disabled={busy || !editing.name.trim()} onClick={rename}>
                      OK
                    </Button>
                    <Button variant="secondary" className="flex-1" onClick={() => setEditing(null)}>
                      Annuler
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-3">
                    <span className="flex size-12 shrink-0 items-center justify-center rounded-sm bg-leaf-soft text-leaf">
                      <Icon name="home" />
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-title text-ink">{r.name}</span>
                      <span className="text-body-sm text-ink-muted">
                        {r.plantCount} plante{r.plantCount > 1 ? "s" : ""}
                      </span>
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="secondary" icon="pencil" className="flex-1" onClick={() => setEditing({ id: r.id, name: r.name })}>
                      Renommer
                    </Button>
                    <Button variant="danger" icon="trash" className="flex-1" disabled={busy} onClick={() => remove(r)}>
                      Supprimer
                    </Button>
                  </div>
                </>
              )}
            </Card>
          </li>
        ))}
      </ul>
    </Page>
  );
}
