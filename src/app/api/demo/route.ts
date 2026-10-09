import { NextResponse } from "next/server";
import { DEMO_COOKIE } from "@/lib/data";

/** Liga/desliga o modo demo (cookie). */
export async function POST(req: Request) {
  const form = await req.formData();
  const on = form.get("on") === "1";
  const res = NextResponse.redirect(new URL("/", req.url), 303);
  if (on) res.cookies.set(DEMO_COOKIE, "1", { path: "/", httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 30 });
  else res.cookies.delete(DEMO_COOKIE);
  return res;
}
