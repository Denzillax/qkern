"use client";

import { ArrowRight, Check, Eye, EyeOff, LockKeyhole, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isRegister = mode === "register";

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/v1/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const result = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(result?.error ?? "Authentication failed");
      router.push("/console");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Authentication failed");
    } finally {
      setBusy(false);
    }
  }

  return <form className="auth-form" onSubmit={submit}>
    <label>E-Mail-Adresse<input type="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@unternehmen.ch" /></label>
    <label>Passwort<div className="password-input"><input type={visible ? "text" : "password"} autoComplete={isRegister ? "new-password" : "current-password"} required minLength={isRegister ? 12 : 1} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={isRegister ? "Mindestens 12 Zeichen" : "Dein Passwort"}/><button type="button" onClick={() => setVisible(!visible)} aria-label={visible ? "Passwort ausblenden" : "Passwort anzeigen"}>{visible ? <EyeOff size={16}/> : <Eye size={16}/>}</button></div></label>
    {isRegister && <div className="password-rules"><span className={password.length >= 12 ? "valid" : ""}><Check size={12}/> Mindestens 12 Zeichen</span><span><LockKeyhole size={12}/> Argon2id-geschützt</span></div>}
    {error && <div className="auth-error" role="alert">{error}</div>}
    <button className="button auth-submit" disabled={busy}>{busy ? "Bitte warten…" : isRegister ? "Account erstellen" : "Sicher anmelden"}<ArrowRight size={16}/></button>
    <div className="auth-security"><ShieldCheck size={15}/><span>HttpOnly-Session · SameSite Strict · serverseitige Rollenprüfung</span></div>
  </form>;
}
