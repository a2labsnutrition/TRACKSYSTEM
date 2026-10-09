"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createSupabaseBrowser } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

export function LoginForm() {
  const router = useRouter();
  const [mode, setMode] = useState<"entrar" | "criar" | "link">("entrar");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const supabase = createSupabaseBrowser();
    const redirectTo = `${location.origin}/auth/callback`;
    try {
      if (mode === "entrar") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.push("/");
        router.refresh();
      } else if (mode === "criar") {
        const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo } });
        if (error) throw error;
        if (data.session) {
          router.push("/onboarding");
          router.refresh();
        } else setMsg({ ok: true, text: "Conta criada. Confirme pelo link enviado ao seu e-mail." });
      } else {
        const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } });
        if (error) throw error;
        setMsg({ ok: true, text: "Link de acesso enviado para o seu e-mail." });
      }
    } catch (err) {
      const m = (err as Error).message;
      setMsg({ ok: false, text: m === "Invalid login credentials" ? "E-mail ou senha incorretos." : m });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="flex rounded-lg border border-border bg-bg p-0.5 text-xs">
        {(["entrar", "criar", "link"] as const).map((m) => (
          <button key={m} type="button" onClick={() => setMode(m)} className={`flex-1 rounded-md py-1.5 ${mode === m ? "bg-panel-2 text-text" : "text-muted"}`}>
            {m === "entrar" ? "Entrar" : m === "criar" ? "Criar conta" : "Link por e-mail"}
          </button>
        ))}
      </div>
      <div>
        <Label>E-mail</Label>
        <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
      </div>
      {mode !== "link" ? (
        <div>
          <Label>Senha</Label>
          <Input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "criar" ? "new-password" : "current-password"} />
        </div>
      ) : null}
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {mode === "entrar" ? "Entrar" : mode === "criar" ? "Criar conta" : "Enviar link"}
      </Button>
      {msg ? <p className={`text-xs ${msg.ok ? "text-good" : "text-bad"}`}>{msg.text}</p> : null}
    </form>
  );
}
