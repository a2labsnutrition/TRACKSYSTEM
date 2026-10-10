"use server";

import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";

export async function createWorkspace(_: { message: string }, form: FormData): Promise<{ message: string }> {
  const supabase = await createSupabaseServer();
  const name = String(form.get("name") ?? "").trim() || "Meu negócio";
  const tz = String(form.get("timezone") ?? "America/Cuiaba");
  const { error } = await supabase.rpc("create_workspace", { p_name: name, p_timezone: tz });
  if (error) {
    // Função/tabelas ausentes: o SQL de instalação não foi rodado neste projeto Supabase
    if (error.code === "PGRST202" || /schema cache|does not exist/i.test(error.message)) redirect(`/erro-banco?m=${encodeURIComponent(error.message.slice(0, 300))}`);
    return { message: error.message };
  }
  redirect("/conexoes");
}
