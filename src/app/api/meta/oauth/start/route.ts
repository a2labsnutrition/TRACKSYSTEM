import { NextResponse } from "next/server";
import { requireLiveWorkspace } from "@/lib/data";
import { isMetaAppConfigured } from "@/lib/env";
import { publicOrigin } from "@/lib/http";
import { oauthDialogUrl } from "@/lib/integrations/meta/oauth";
import { randomId } from "@/lib/utils";

/** Inicia o "Entrar com Facebook". */
export async function GET(req: Request) {
  if (!isMetaAppConfigured()) {
    return NextResponse.redirect(new URL("/conexoes?meta=sem_app", req.url));
  }
  try {
    await requireLiveWorkspace();
  } catch (e) {
    return NextResponse.redirect(new URL(`/conexoes?meta=erro&msg=${encodeURIComponent((e as Error).message)}`, req.url));
  }
  const state = randomId(16);
  const redirectUri = `${publicOrigin(req)}/api/meta/oauth/callback`;
  const res = NextResponse.redirect(oauthDialogUrl(state, redirectUri));
  res.cookies.set("cc_meta_state", state, { httpOnly: true, sameSite: "lax", secure: true, maxAge: 600, path: "/" });
  return res;
}
