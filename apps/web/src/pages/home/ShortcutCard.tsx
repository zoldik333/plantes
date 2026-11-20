import { Card, Notice } from "../../components/ui";

/** Socle : carte vide, déjà affichée dans Réglages. L'agent « raccourci iOS » la remplit. */
export function ShortcutCard() {
  return (
    <Card title="Raccourci iOS">
      <Notice>Bientôt disponible.</Notice>
    </Card>
  );
}
