import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";

/** Retorno do link mágico / confirmação de e-mail do Supabase. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  if (code) {
    const supabase = await createSupabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return NextResponse.redirect(new URL(`/login?erro=${encodeURIComponent(error.message)}`, req.url));
  }
  return NextResponse.redirect(new URL("/", req.url));
}
