import { publicOrigin } from "@/lib/http";
import { trackerSource } from "@/lib/tracking/script";

/** Script de tracking para colar no <head> da página. */
export async function GET(req: Request) {
  return new Response(trackerSource(publicOrigin(req)), {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "public, max-age=300, s-maxage=300",
      "access-control-allow-origin": "*",
    },
  });
}
