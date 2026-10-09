"use server";

import { revalidatePath } from "next/cache";
import { requireLiveWorkspace } from "@/lib/data";
import { createSupabaseServer } from "@/lib/supabase/server";

export interface ActionState {
  ok: boolean;
  message: string;
}

/** Anotação manual de ação (ex.: "aumentei orçamento 20%") para correlacionar com resultados. */
export async function addNote(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { ctx, userId } = await requireLiveWorkspace();
    const text = String(form.get("text") ?? "").trim();
    const campaignId = String(form.get("campaignId") ?? "");
    const date = String(form.get("date") ?? "");
    if (!text) return { ok: false, message: "Escreva a anotação." };
    const supabase = await createSupabaseServer();
    const { error } = await supabase.from("user_notes").insert({
      workspace_id: ctx.workspace.id,
      campaign_id: campaignId || null,
      note_date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined,
      text: text.slice(0, 1000),
      created_by: userId,
    });
    if (error) return { ok: false, message: error.message };
    revalidatePath(`/campanhas/${campaignId}`);
    return { ok: true, message: "Anotação salva." };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
