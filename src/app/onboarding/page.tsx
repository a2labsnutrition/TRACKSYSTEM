"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { createWorkspace } from "./actions";

export default function Onboarding() {
  const [state, action, pending] = useActionState(createWorkspace, { message: "" });
  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <form action={action} className="w-full max-w-md space-y-4 rounded-2xl border border-border bg-panel p-6">
        <div>
          <h1 className="text-lg font-semibold">Vamos começar</h1>
          <p className="text-sm text-muted">Crie seu espaço de trabalho. Em seguida: conectar Meta → instalar o script → conectar Cakto → cadastrar produto.</p>
        </div>
        <div>
          <Label>Nome do negócio</Label>
          <Input name="name" placeholder="Ex.: Academia da Ana" />
        </div>
        <div>
          <Label>Fuso horário</Label>
          <Select name="timezone" defaultValue="America/Cuiaba" className="w-full">
            <option value="America/Cuiaba">Cuiabá (UTC−4)</option>
            <option value="America/Sao_Paulo">Brasília (UTC−3)</option>
            <option value="America/Manaus">Manaus (UTC−4)</option>
            <option value="America/Fortaleza">Fortaleza (UTC−3)</option>
            <option value="America/Rio_Branco">Rio Branco (UTC−5)</option>
          </Select>
        </div>
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Criando..." : "Criar e ir para Conexões"}
        </Button>
        {state.message ? <p className="text-xs text-bad">{state.message}</p> : null}
      </form>
    </div>
  );
}
