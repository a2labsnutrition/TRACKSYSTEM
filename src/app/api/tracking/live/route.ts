import { NextResponse } from "next/server";
import { getRepository } from "@/lib/data";

/** Últimos eventos recebidos do script (para o painel em tempo real). */
export async function GET() {
  const repo = await getRepository();
  const events = await repo.recentEvents(30);
  return NextResponse.json({ events }, { headers: { "cache-control": "no-store" } });
}
