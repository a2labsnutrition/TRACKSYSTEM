import { MemoryIngestStore } from "@/lib/ingest/memory-store";
import { sha256 } from "@/lib/crypto";
import type { CapiSender } from "@/lib/ingest/capi-dispatch";

export const WS = "ws-test";
export const SECRET = "segredo-cakto-123";

export function makeStore(opts: { capi?: boolean } = {}) {
  const store = new MemoryIngestStore();
  store.sites.set("site_pub_1", {
    workspaceId: WS,
    site: {
      id: "site-1",
      publicKey: "site_pub_1",
      name: "LP",
      domain: "minhapagina.com",
      pixelId: "111222333",
      checkoutSelectors: [],
      idParam: "sck",
      consentMode: "none",
      createdAt: new Date().toISOString(),
    },
  });
  store.cakto.set(WS, { secret: SECRET, secretHash: sha256(SECRET) });
  if (opts.capi !== false) store.capi.set(WS, { pixelId: "111222333", accessToken: "tok", testEventCode: null });
  return store;
}

export function fakeSender() {
  const calls: Array<{ pixelId: string; events: unknown[] }> = [];
  const sender: CapiSender = async (pixelId, _token, events) => {
    calls.push({ pixelId, events });
    return { ok: true, httpStatus: 200, response: '{"events_received":1}', eventsReceived: 1, fbtraceId: "x" };
  };
  return { sender, calls };
}

export function caktoPayload(event: string, data: Record<string, unknown>, secret = SECRET) {
  return { secret, event, data };
}
