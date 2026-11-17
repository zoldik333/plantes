import { useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";

export function Page({ children }: { children: ReactNode }) {
  return <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 px-4 py-6">{children}</main>;
}

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
      {title && <h2 className="mb-3 text-lg font-semibold text-leaf-800">{title}</h2>}
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" };

export function Button({ variant = "primary", className = "", ...props }: ButtonProps) {
  const styles = {
    primary: "bg-leaf-700 text-white active:bg-leaf-800",
    secondary: "bg-leaf-50 text-leaf-800 ring-1 ring-leaf-100 active:bg-leaf-100",
    danger: "bg-red-50 text-red-700 ring-1 ring-red-100 active:bg-red-100",
  }[variant];
  return (
    <button
      {...props}
      className={`min-h-11 rounded-xl px-4 py-2 text-base font-medium disabled:opacity-50 ${styles} ${className}`}
    />
  );
}

export function Field({ label, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium text-stone-700">
      {label}
      <input
        {...props}
        className="min-h-11 rounded-xl border border-stone-300 bg-white px-3 text-base text-stone-900 focus:border-leaf-600 focus:outline-none focus:ring-2 focus:ring-leaf-600/30"
      />
    </label>
  );
}

export function Notice({ kind = "info", children }: { kind?: "info" | "error" | "ok"; children: ReactNode }) {
  const styles = {
    info: "bg-stone-100 text-stone-700",
    error: "bg-red-50 text-red-700",
    ok: "bg-leaf-50 text-leaf-800",
  }[kind];
  return <p className={`rounded-xl px-3 py-2 text-sm whitespace-pre-line ${styles}`}>{children}</p>;
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
    <div className="flex flex-col gap-2 rounded-xl bg-leaf-50 p-3">
      <input
        readOnly
        value={url}
        onFocus={(e) => e.currentTarget.select()}
        className="w-full rounded-lg border border-leaf-100 bg-white px-2 py-2 text-sm"
      />
      <div className="flex gap-2">
        <Button variant="secondary" onClick={copy} className="flex-1">
          {copied ? "Copié ✓" : "Copier"}
        </Button>
        {typeof navigator.share === "function" && (
          <Button variant="secondary" onClick={() => navigator.share({ url }).catch(() => {})} className="flex-1">
            Partager
          </Button>
        )}
      </div>
      <p className="text-xs text-stone-600">{hint}</p>
    </div>
  );
}
