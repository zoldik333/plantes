import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import type { ChatHistory, ChatMessage, ChatReply, PlantDetail } from "@plantes/shared";
import { AiStatusBanner } from "../components/AiStatusBanner";
import { Icon } from "../components/Icon";
import { Button, Chip, Notice, Page, inputClass } from "../components/ui";
import { api } from "../lib/api";
import { shortDateTime } from "../lib/dates";
import { useFetch, useFocusReload } from "../lib/fetch";

const SUGGESTIONS = ["Pourquoi les feuilles jaunissent ?", "Dois-je l'arroser maintenant ?", "Quelle lumière lui faut-il ?"];

/** Bulle de message : texte BRUT (jamais de HTML), retours à la ligne conservés. */
function Bubble({ m }: { m: ChatMessage }) {
  const mine = m.role === "user";
  return (
    <li className={`flex flex-col gap-1 ${mine ? "items-end" : "items-start"}`}>
      <p className="px-1 text-caption text-ink-muted">
        {mine ? (m.userName ?? "Quelqu'un") : "Claude"} · {shortDateTime(m.createdAt)}
      </p>
      <p
        data-role={m.role}
        className={`max-w-[85%] rounded-lg px-4 py-3 text-body break-words whitespace-pre-wrap ${mine ? "rounded-br-sm bg-ink text-bg" : "rounded-bl-sm bg-surface text-ink shadow-card"}`}
      >
        {m.content}
      </p>
    </li>
  );
}

export default function PlantChat({ id }: { id: string }) {
  const plant = useFetch<PlantDetail>(`/api/plants/${id}`);
  const history = useFetch<ChatHistory>(`/api/plants/${id}/chat`);
  useFocusReload(history.reload);

  const [text, setText] = useState("");
  /** Question en cours d'envoi, affichée tout de suite (non enregistrée tant que l'IA n'a pas répondu). */
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  const messages = history.data?.messages ?? [];
  const waiting = pending !== null;

  // Toujours montrer le dernier message ; le clavier iOS réduit la zone visible : on y revient aussi.
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end" });
  }, [messages.length, waiting]);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => end.current?.scrollIntoView?.({ block: "end" });
    vv.addEventListener("resize", onResize);
    return () => vv.removeEventListener("resize", onResize);
  }, []);

  async function send(raw: string) {
    const message = raw.trim();
    if (!message || waiting) return;
    setError(null);
    setPending(message);
    setText("");
    try {
      await api<ChatReply>(`/api/plants/${id}/chat`, { method: "POST", json: { message } });
      await history.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setText((t) => t || message); // la question n'est pas perdue : on la remet dans la zone de saisie
    } finally {
      setPending(null);
    }
  }

  async function clear() {
    if (!window.confirm("Effacer toute la conversation sur cette plante pour tout le foyer ?")) return;
    setClearing(true);
    setError(null);
    try {
      await api(`/api/plants/${id}/chat`, { method: "DELETE" });
      await history.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setClearing(false);
    }
  }

  const empty = !history.loading && messages.length === 0 && !waiting;

  return (
    <Page>
      <Link href={`/plants/${id}`} className="-ml-1 inline-flex min-h-12 items-center gap-1 self-start pr-3 text-label text-ink-muted active:opacity-70">
        <Icon name="back" />
        Retour
      </Link>
      <AiStatusBanner />
      <header className="flex flex-col gap-1">
        <p className="text-overline text-ink-muted uppercase">Poser une question</p>
        <h1 className="text-heading break-words text-ink">{plant.data?.name ?? "Ma plante"}</h1>
      </header>

      {plant.error && <Notice kind="error">{plant.error}</Notice>}
      {history.error && !history.data && <Notice kind="error">{history.error}</Notice>}

      {empty && (
        <div className="flex flex-col gap-3">
          <p className="text-body-sm text-ink-muted">Claude connaît la fiche, l'arrosage et le journal de cette plante. Par exemple :</p>
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <Chip key={s} active={false} onClick={() => void send(s)}>
                {s}
              </Chip>
            ))}
          </div>
        </div>
      )}

      <ol className="flex flex-1 flex-col gap-4" aria-label="Conversation">
        {messages.map((m) => (
          <Bubble key={m.id} m={m} />
        ))}
        {pending !== null && (
          <>
            <li className="flex flex-col items-end gap-1">
              <p className="max-w-[85%] rounded-lg rounded-br-sm bg-ink px-4 py-3 text-body break-words whitespace-pre-wrap text-bg">{pending}</p>
            </li>
            <li className="flex items-center gap-2 text-body-sm text-ink-muted" aria-live="polite">
              <Icon name="sparkle" />
              Claude réfléchit…
            </li>
          </>
        )}
      </ol>

      {error && (
        <div role="alert">
          <Notice kind="error">{error}</Notice>
        </div>
      )}

      <div className="sticky bottom-[var(--nav-space)] -mx-4 flex flex-col gap-2 bg-bg px-4 pt-2 pb-3">
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send(text);
          }}
        >
          <textarea
            aria-label="Ta question"
            placeholder="Ta question…"
            rows={2}
            maxLength={2000}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onFocus={() => setTimeout(() => end.current?.scrollIntoView?.({ block: "end" }), 300)}
            className={`${inputClass} resize-none py-3`}
          />
          <Button type="submit" variant="dark" disabled={waiting || !text.trim()}>
            Envoyer
          </Button>
        </form>
        <p className="text-caption text-ink-muted">Claude voit le journal d'entretien et la dernière photo de la plante. La conversation est partagée avec le foyer.</p>
        {messages.length > 0 && (
          <Button variant="ghost" icon="trash" className="self-start" disabled={clearing || waiting} onClick={() => void clear()}>
            Effacer la conversation
          </Button>
        )}
      </div>
    </Page>
  );
}
