import type { ReactNode } from "react";
import type { CareSheet } from "@plantes/shared";
import { Icon, type IconName } from "./Icon";
import { Card, Notice, Pill } from "./ui";

export const LIGHT_LABELS: Record<CareSheet["light"]["need"], string> = {
  ombre: "Peu de lumière",
  "mi-ombre": "Lumière douce",
  "lumiere-indirecte-vive": "Très lumineux, sans soleil direct",
  "soleil-direct": "Plein soleil",
};

const DIFFICULTY: Record<CareSheet["difficulty"], string> = {
  facile: "Facile",
  moyenne: "Moyenne",
  difficile: "Difficile",
};

function Row({ icon, title, children }: { icon: IconName; title: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-sm bg-surface-sunken text-ink">
        <Icon name={icon} />
      </span>
      <div className="min-w-0">
        <dt className="text-label text-ink">{title}</dt>
        <dd className="mt-0.5 text-body-sm text-ink-muted">{children}</dd>
      </div>
    </div>
  );
}

export function CareSheetView({ s }: { s: CareSheet }) {
  const x = s.extras;
  return (
    <Card>
      <div className="flex flex-col gap-2">
        <h2 className="text-title text-ink">
          {s.commonName} <span className="text-body font-normal text-ink-muted italic">{s.scientificName}</span>
        </h2>
        <Pill tone="leaf" icon="leaf">
          Difficulté : {DIFFICULTY[s.difficulty] ?? s.difficulty}
        </Pill>
      </div>
      {!s.nameMatchesPhoto && <Notice kind="error">La photo ne semble pas correspondre : {s.identificationNote}</Notice>}
      {s.observedCondition && <p className="text-body text-ink">{s.observedCondition}</p>}
      <dl className="flex flex-col gap-4">
        <Row icon="drop" title="Arrosage">
          Tous les <b className="text-ink">{s.watering.intervalDaysSummer} jours</b> l'été, <b className="text-ink">{s.watering.intervalDaysWinter} jours</b> l'hiver.
          <br />
          {s.watering.method}
          <small className="mt-1 block text-caption">{s.watering.signs}</small>
        </Row>
        <Row icon="sun" title={`Lumière : ${LIGHT_LABELS[s.light.need] ?? s.light.need}`}>
          {s.light.details}
        </Row>
        <Row icon="wind" title="Humidité">
          {x.humidity}
        </Row>
        <Row icon="thermometer" title="Température">
          {x.temperature}
        </Row>
        <Row icon="sprout" title="Engrais">
          {x.fertilizer}
        </Row>
        <Row icon="pot" title="Rempotage">
          {x.repotting}
        </Row>
        <Row icon="layers" title="Terre">
          {x.substrate}
        </Row>
        <Row icon="bulb" title="À retenir">
          <ul className="list-disc pl-5">
            {s.tips.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </Row>
      </dl>
    </Card>
  );
}
