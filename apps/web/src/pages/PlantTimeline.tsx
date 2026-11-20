import { useState } from "react";
import { Link } from "wouter";
import type { PlantDetail, PlantTimeline as Timeline } from "@plantes/shared";
import { Icon } from "../components/Icon";
import { TimelineCompare } from "../components/TimelineCompare";
import { TimelineViewer } from "../components/TimelineViewer";
import { Button, Card, Notice, Page, PageHeader, SectionTitle, buttonClass, useAction } from "../components/ui";
import { shortDateTime } from "../lib/dates";
import { useFetch } from "../lib/fetch";
import { photoUrl, uploadPhoto } from "../lib/photos";
import { EVENT_LABELS, ago, dayLabel, groupByMonth } from "../lib/timeline";

/** Évolution d'une plante : photos et soins du journal sur une frise verticale, groupée par mois. */
export default function PlantTimeline({ id }: { id: string }) {
  const timeline = useFetch<Timeline>(`/api/plants/${id}/timeline`);
  const plant = useFetch<PlantDetail>(`/api/plants/${id}`);
  const { busy, error, run } = useAction();
  const [comparing, setComparing] = useState(false);
  const [viewing, setViewing] = useState<{ id: string; createdAt: string } | null>(null);

  const entries = timeline.data?.entries ?? [];
  const photos = entries.flatMap((e) => (e.kind === "photo" ? [{ id: e.id, createdAt: e.createdAt }] : []));
  const add = (file: File) =>
    run(async () => {
      await uploadPhoto(id, file);
      await timeline.reload();
    });

  const addButton = (variant: "primary" | "secondary") => (
    <label className={buttonClass(variant, "cursor-pointer")}>
      <Icon name="camera" />
      Ajouter une photo
      <input
        type="file"
        accept="image/*"
        className="hidden"
        disabled={busy}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void add(f);
        }}
      />
    </label>
  );

  return (
    <Page>
      <Link href={`/plants/${id}`} className="-ml-1 inline-flex min-h-12 items-center gap-1 self-start pr-3 text-label text-ink-muted active:opacity-70">
        <Icon name="back" />
        {plant.data?.name ?? "Retour"}
      </Link>
      <PageHeader overline={plant.data?.name} title="Évolution" />

      {timeline.loading && !timeline.data && <p className="text-body-sm text-ink-muted">Chargement…</p>}
      {timeline.error && !timeline.data && <Notice kind="error">{timeline.error}</Notice>}
      {error && <Notice kind="error">{error}</Notice>}

      {timeline.data && (
        <>
          {photos.length < 2 && (
            <Card title={photos.length === 0 ? "Aucune photo pour l'instant" : "Une seule photo pour l'instant"}>
              <p className="text-body-sm text-ink-muted">
                {photos.length === 0
                  ? "Ajoute une première photo : elle servira de point de départ pour voir ta plante évoluer."
                  : "Ajoute une deuxième photo dans quelques semaines pour voir la différence et comparer."}
              </p>
              {addButton("primary")}
            </Card>
          )}

          {photos.length >= 2 && (
            <div className="flex gap-2">
              <Button variant="secondary" icon="layers" aria-pressed={comparing} className="flex-1" onClick={() => setComparing((c) => !c)}>
                {comparing ? "Fermer la comparaison" : "Comparer"}
              </Button>
              {addButton("secondary")}
            </div>
          )}

          {comparing && photos.length >= 2 && <TimelineCompare photos={photos} />}

          {entries.length === 0 ? (
            <Notice>Rien à afficher : les arrosages et les soins apparaîtront ici.</Notice>
          ) : (
            groupByMonth(entries).map((g) => (
              <section key={g.month} aria-label={g.month} className="flex flex-col gap-2">
                <SectionTitle>{g.month}</SectionTitle>
                <ol className="ml-5 flex flex-col gap-3 border-l-2 border-line pl-4">
                  {g.entries.map((e) =>
                    e.kind === "photo" ? (
                      <li key={`p-${e.id}`} className="flex items-center gap-3">
                        <button
                          type="button"
                          aria-label={`Voir la photo du ${dayLabel(e.createdAt)} en grand`}
                          onClick={() => setViewing({ id: e.id, createdAt: e.createdAt })}
                          className="shrink-0 rounded-md active:opacity-70"
                        >
                          <img
                            src={photoUrl(e.id, true)}
                            alt={`Photo du ${dayLabel(e.createdAt)}`}
                            loading="lazy"
                            width={112}
                            height={112}
                            className="size-28 rounded-md bg-surface-sunken object-cover"
                          />
                        </button>
                        <span className="min-w-0">
                          <span className="block text-label text-ink">Photo</span>
                          <time dateTime={e.createdAt} title={shortDateTime(e.createdAt)} className="block text-caption text-ink-muted">
                            {ago(e.createdAt)} · {dayLabel(e.createdAt)}
                          </time>
                        </span>
                      </li>
                    ) : (
                      <li key={`e-${e.event.id}`} className="flex items-start gap-3">
                        <span
                          className={`flex size-10 shrink-0 items-center justify-center rounded-sm bg-surface-sunken ${e.event.type === "watered" ? "text-water" : "text-ink"}`}
                        >
                          <Icon name={EVENT_LABELS[e.event.type].icon} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-label text-ink">{EVENT_LABELS[e.event.type].label}</span>
                          <time dateTime={e.event.createdAt} title={shortDateTime(e.event.createdAt)} className="block text-caption text-ink-muted">
                            {ago(e.event.createdAt)} · {dayLabel(e.event.createdAt)} · {e.event.userName ?? "quelqu'un"}
                          </time>
                          {e.event.note && <span className="block text-body-sm break-words text-ink">{e.event.note}</span>}
                        </span>
                      </li>
                    ),
                  )}
                </ol>
              </section>
            ))
          )}

          {photos.length >= 2 && <p className="text-caption text-ink-muted">Une photo toutes les 2 semaines suffit pour bien voir la plante évoluer.</p>}
        </>
      )}

      {viewing && (
        <TimelineViewer
          photoId={viewing.id}
          alt={`Photo du ${dayLabel(viewing.createdAt)}`}
          caption={`${dayLabel(viewing.createdAt)} (${ago(viewing.createdAt)})`}
          onClose={() => setViewing(null)}
        />
      )}
    </Page>
  );
}
