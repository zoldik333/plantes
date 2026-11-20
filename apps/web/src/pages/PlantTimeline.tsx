import { Link } from "wouter";
import { Icon } from "../components/Icon";
import { Notice, Page } from "../components/ui";

/** Socle : page vide, déjà routée (voir App.tsx). L'agent responsable la remplit. */
export default function PlantTimeline({ id }: { id: string }) {
  return (
    <Page>
      <Link href={`/plants/${id}`} className="-ml-1 inline-flex min-h-12 items-center gap-1 self-start pr-3 text-label text-ink-muted active:opacity-70">
        <Icon name="back" />
        Retour
      </Link>
      <Notice>Bientôt disponible.</Notice>
    </Page>
  );
}
