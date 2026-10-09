import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { saveCredential } from "@/lib/credentials";
import { safeEqual } from "@/lib/crypto";
import { requireLiveWorkspace } from "@/lib/data";
import { publicOrigin } from "@/lib/http";
import { debugToken, exchangeCodeForToken, exchangeForLongLived } from "@/lib/integrations/meta/oauth";
import { supabaseAdmin } from "@/lib/supabase/admin";

/** Retorno do OAuth do Meta: troca o código por token de longa duração e salva criptografado. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const back = (q: string) => NextResponse.redirect(new URL(`/conexoes?${q}`, req.url));
  const jar = await cookies();
  const expected = jar.get("cc_meta_state")?.value ?? "";
  const state = url.searchParams.get("state") ?? "";
  if (url.searchParams.get("error")) return back(`meta=erro&msg=${encodeURIComponent(url.searchParams.get("error_description") ?? "Login cancelado")}`);
  if (!expected || !safeEqual(expected, state)) return back("meta=erro&msg=Sessão%20de%20login%20expirada%2C%20tente%20de%20novo");
  const code = url.searchParams.get("code");
  if (!code) return back("meta=erro&msg=Código%20ausente");
  try {
    const { ctx } = await requireLiveWorkspace();
    const short = await exchangeCodeForToken(code, `${publicOrigin(req)}/api/meta/oauth/callback`);
    const long = await exchangeForLongLived(short);
    let scopes: string[] = [];
    let expiresAt = long.expiresAt;
    try {
      const info = await debugToken(long.token);
      scopes = info.scopes;
      expiresAt = info.expiresAt ?? expiresAt;
    } catch {
      /* segue */
    }
    await saveCredential(supabaseAdmin(), ctx.workspace.id, "meta", long.token, { expiresAt, meta: { scopes, source: "oauth" } });
    const res = back("meta=ok");
    res.cookies.delete("cc_meta_state");
    return res;
  } catch (e) {
    return back(`meta=erro&msg=${encodeURIComponent((e as Error).message)}`);
  }
}
