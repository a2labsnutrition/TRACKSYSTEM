"use server";

import { revalidatePath } from "next/cache";
import { createParecer } from "@/lib/advisor/service";
import { getRepository } from "@/lib/data";
import { isSupabaseConfigured } from "@/lib/env";
import { periodFrom } from "@/lib/page";
import { createSupabaseServer } from "@/lib/supabase/server";

export interface ParecerState {
  ok: boolean;
  message: string;
}

export async function generateParecer(_: ParecerState, form: FormData): Promise<ParecerState> {
  try {
    const campaignId = String(form.get("campaignId") ?? "");
    const params = Object.fromEntries(["p", "from", "to"].map((k) => [k, String(form.get(k) ?? "")]).filter(([, v]) => v));
    const repo = await getRepository();
    const ctx = await repo.context();
    let userId: string | null = null;
    if (isSupabaseConfigured() && ctx.mode === "live") {
      const supabase = await createSupabaseServer();
      userId = (await supabase.auth.getUser()).data.user?.id ?? null;
    }
    const r = await createParecer(repo, campaignId, periodFrom(params, ctx.workspace.timezone), {
      userId,
      forceFallback: form.get("fallback") === "1",
    });
    revalidatePath(`/campanhas/${campaignId}`);
    return { ok: true, message: r.warning ?? (r.usedAi ? "Parecer gerado pela IA." : "Parecer automático gerado.") };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
