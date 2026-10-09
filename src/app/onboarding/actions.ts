"use server";

import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";

export async function createWorkspace(_: { message: string }, form: FormData): Promise<{ message: string }> {
  const supabase = await createSupabaseServer();
  const name = String(form.get("name") ?? "").trim() || "Meu negócio";
  const tz = String(form.get("timezone") ?? "America/Cuiaba");
  const { error } = await supabase.rpc("create_workspace", { p_name: name, p_timezone: tz });
  if (error) return { message: error.message };
  redirect("/conexoes");
}
