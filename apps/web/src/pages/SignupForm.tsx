import { useState, type FormEvent, type ReactNode } from "react";
import { useLocation } from "wouter";
import { Button, Field, Notice, useAction } from "../components/ui";
import { api } from "../lib/api";
import { useMe } from "../lib/me";

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
    <form onSubmit={submit} className="flex flex-col gap-3">
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
      <Button type="submit" disabled={busy}>
        Créer mon compte
      </Button>
    </form>
  );
}
