import { useState, type FormEvent, type ReactNode } from "react";
import { useLocation } from "wouter";
import { Icon } from "../components/Icon";
import { Button, Field, Notice, Page, useAction } from "../components/ui";
import { api } from "../lib/api";
import { useMe } from "../lib/me";

/** Cadre des écrans sans compte (connexion, installation, invitation, réinitialisation) : logo, titre, contenu centré. */
export function WelcomePage({ children }: { children: ReactNode }) {
  return (
    <Page>
      <div className="my-auto flex flex-col gap-6 py-4">
        <header className="flex flex-col items-center gap-3">
          <span className="flex size-16 items-center justify-center rounded-full bg-surface-deep text-accent">
            <Icon name="leaf" size={32} />
          </span>
          <h1 className="text-display text-ink">Plantes</h1>
        </header>
        {children}
      </div>
    </Page>
  );
}

/** Formulaire de création de compte, partagé entre l'installation (clé) et l'invitation (jeton). */
export function SignupForm({ extra, extraField }: { extra: Record<string, string>; extraField?: ReactNode }) {
  const [, navigate] = useLocation();
  const { refresh } = useMe();
  const { busy, error, run } = useAction();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await api("/api/signup", { method: "POST", json: { name, email, password, ...extra } });
      await refresh();
      navigate("/");
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label="Prénom" autoComplete="given-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} />
      <Field label="E-mail" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <Field
        label="Mot de passe (10 caractères minimum)"
        type="password"
        autoComplete="new-password"
        minLength={10}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      {extraField}
      {error && <Notice kind="error">{error}</Notice>}
      <Button type="submit" variant="primary" className="w-full" disabled={busy}>
        Créer mon compte
      </Button>
    </form>
  );
}
