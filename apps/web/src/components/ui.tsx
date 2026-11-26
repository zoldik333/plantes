import { useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

/*
 * Composants de base du design system « Plantes ». Règles :
 * - un seul Button `primary` (citron) par écran, posé sur une Card (surface ou deep), jamais directement sur le fond ;
 * - une seule Card `deep` (sombre) par écran, pour ce qui demande une action ;
 * - les couleurs de sens (Pill, Notice) toujours avec un mot ou une icône ; aucun emoji.
 */

/** Page : remplit exactement l'écran sous la zone de sécurité haute (pas de défilement si le contenu tient). */
export function Page({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-[calc(100dvh-var(--safe-top))] w-full max-w-md flex-col gap-4 px-4 pt-3 pb-[var(--page-pb)]">
      {children}
    </main>
  );
}

/** En-tête de page : sur-titre facultatif, titre (h1) et action à droite. */
export function PageHeader({ overline, title, action }: { overline?: ReactNode; title: ReactNode; action?: ReactNode }) {
  return (
    <header className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        {overline && <p className="text-overline text-ink-muted uppercase">{overline}</p>}
        <h1 className="text-heading text-ink">{title}</h1>
      </div>
      {action}
    </header>
  );
}

/** Sur-titre de section, en capitales (« PROCHAINS ARROSAGES »). */
export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="mt-2 text-overline text-ink-muted uppercase">{children}</h2>;
}

export function Card({ title, tone = "default", children }: { title?: ReactNode; tone?: "default" | "deep"; children: ReactNode }) {
  const styles = tone === "deep" ? "rounded-xl bg-surface-deep p-6 text-on-deep" : "rounded-lg bg-surface p-5 text-ink shadow-card";
  return (
    <section className={styles}>
      {title && <h2 className="mb-3 text-title">{title}</h2>}
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

export type ButtonVariant = "primary" | "secondary" | "dark" | "danger" | "on-deep" | "ghost";

export const buttonStyles: Record<ButtonVariant, string> = {
  primary: "bg-accent text-on-accent active:bg-accent-pressed",
  secondary: "bg-surface-sunken text-ink active:opacity-80",
  dark: "bg-ink text-bg active:opacity-85",
  danger: "bg-danger-soft text-danger active:opacity-80",
  "on-deep": "bg-white/10 text-on-deep active:bg-white/20",
  ghost: "bg-transparent text-ink underline underline-offset-2 active:opacity-70",
};

/** Classes d'un bouton, pour un lien qui en a l'apparence (`<Link className={buttonClass("dark")}>`). */
export const buttonClass = (variant: ButtonVariant = "primary", extra = "") =>
  `inline-flex min-h-12 items-center justify-center gap-2 whitespace-nowrap rounded-full px-5 text-button transition-colors disabled:opacity-50 ${buttonStyles[variant]} ${extra}`;

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; icon?: IconName };

export function Button({ variant = "secondary", icon, className = "", children, type = "button", ...props }: ButtonProps) {
  return (
    <button {...props} type={type} className={buttonClass(variant, className)}>
      {icon && <Icon name={icon} />}
      {children}
    </button>
  );
}

/** Classes d'un champ de saisie (input, select, textarea) : bordure forte, 16 px minimum (pas de zoom iOS). */
export const inputClass =
  "min-h-12 w-full rounded-md border border-border-strong bg-surface px-4 text-body text-ink placeholder:text-ink-muted disabled:bg-surface-sunken";

/** Libellé de champ. */
export const labelClass = "flex flex-col gap-1.5 text-label text-ink";

export function Field({ label, className = "", ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className={labelClass}>
      {label}
      <input {...props} className={`${inputClass} ${className}`} />
    </label>
  );
}

/** Lien dans un texte. */
export const linkClass = "font-semibold underline underline-offset-2";

export type NoticeKind = "info" | "error" | "ok" | "warning";

const NOTICE: Record<NoticeKind, { style: string; icon: IconName }> = {
  info: { style: "bg-surface-sunken text-ink", icon: "info" },
  error: { style: "bg-danger-soft text-danger", icon: "alert" },
  ok: { style: "bg-success-soft text-success", icon: "check" },
  warning: { style: "bg-warning-soft text-warning", icon: "alert" },
};

export function Notice({ kind = "info", icon, children }: { kind?: NoticeKind; icon?: IconName; children: ReactNode }) {
  const n = NOTICE[kind];
  return (
    <div className={`flex gap-3 rounded-md px-4 py-3 text-body-sm ${n.style}`}>
      <Icon name={icon ?? n.icon} className="mt-0.5" />
      <p className="min-w-0 break-words whitespace-pre-line">{children}</p>
    </div>
  );
}

export type PillTone = "water" | "success" | "warning" | "danger" | "leaf" | "neutral";

const PILL: Record<PillTone, string> = {
  water: "bg-water-soft text-water",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  leaf: "bg-leaf-soft text-leaf",
  neutral: "bg-surface-sunken text-ink-muted",
};

/** Pastille d'état (« À arroser », « Fiche en cours »). Toujours un mot, l'icône est un plus. */
export function Pill({ tone = "neutral", icon, children }: { tone?: PillTone; icon?: IconName; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 self-start rounded-full px-2.5 py-1 text-caption font-semibold ${PILL[tone]}`}>
      {icon && <Icon name={icon} size={14} />}
      {children}
    </span>
  );
}

/** Puce de filtre (aria-pressed). */
export function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`min-h-10 shrink-0 rounded-full px-4 text-label ${active ? "bg-accent text-on-accent" : "bg-surface text-ink shadow-card"}`}
    >
      {children}
    </button>
  );
}

/** Contrôle segmenté : un choix parmi 2 à 4 options. */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1 rounded-full bg-surface-sunken p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={`min-h-10 flex-1 rounded-full px-3 text-label ${o.value === value ? "bg-surface text-ink shadow-card" : "text-ink-muted"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Tuile de mesure : grand chiffre, unité, libellé. */
export function StatTile({ label, value, unit, icon }: { label: string; value: ReactNode; unit?: string; icon?: IconName }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-surface p-5 shadow-card">
      <span className="flex items-center gap-1.5 text-caption font-semibold text-water">
        {icon && <Icon name={icon} size={16} />}
        {label}
      </span>
      <span className="flex items-baseline gap-1">
        <span className="text-numeral text-ink">{value}</span>
        {unit && <span className="text-caption text-ink-muted">{unit}</span>}
      </span>
    </div>
  );
}

/** Emplacement d'une plante sans photo. */
export function PlantPlaceholder({ className = "", size = 28 }: { className?: string; size?: number }) {
  return (
    <div className={`flex items-center justify-center bg-leaf-soft text-leaf ${className}`}>
      <Icon name="leaf" size={size} />
    </div>
  );
}

/** Exécute une action asynchrone en suivant son état (en cours / erreur). */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, setError, run };
}

/** Lien copiable / partageable (invitation, réinitialisation). */
export function LinkBox({ url, hint }: { url: string; hint: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      /* le champ reste sélectionnable à la main */
    }
  };
  return (
    <div className="flex flex-col gap-3 rounded-md bg-surface-sunken p-4">
      <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} className={`${inputClass} text-body-sm`} />
      <div className="flex gap-2">
        <Button variant="dark" icon={copied ? "check" : "copy"} onClick={copy} className="flex-1">
          {copied ? "Copié" : "Copier"}
        </Button>
        {typeof navigator.share === "function" && (
          <Button variant="secondary" icon="share" onClick={() => navigator.share({ url }).catch(() => {})} className="flex-1 bg-surface">
            Partager
          </Button>
        )}
      </div>
      <p className="text-caption text-ink-muted">{hint}</p>
    </div>
  );
}
