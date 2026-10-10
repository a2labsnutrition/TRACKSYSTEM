import { NextResponse } from "next/server";
import { DEMO_COOKIE, SCENARIO_COOKIE } from "@/lib/data";

const COOKIE = { path: "/", httpOnly: true, sameSite: "lax" as const, maxAge: 60 * 60 * 24 * 30 };

/** Liga/desliga o modo demo e escolhe o cenário (cookies). */
export async function POST(req: Request) {
  const form = await req.formData();
  const res = NextResponse.redirect(new URL("/", req.url), 303);
  const scenario = form.get("cenario");
  if (scenario != null) {
    if (scenario === "caso-real") res.cookies.set(SCENARIO_COOKIE, "caso-real", COOKIE);
    else res.cookies.delete(SCENARIO_COOKIE);
    return res;
  }
  const on = form.get("on") === "1";
  if (on) res.cookies.set(DEMO_COOKIE, "1", COOKIE);
  else res.cookies.delete(DEMO_COOKIE);
  return res;
}
