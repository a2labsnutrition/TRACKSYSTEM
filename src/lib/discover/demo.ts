import { addDays } from "@/lib/tz";
import { MemoryDiscoverStore } from "./store";
import type { ReferenceInput } from "./types";

/** Referências FICTÍCIAS do modo demo (anunciantes inventados, sem ligação com anúncios reais). */
export function seedDemoStore(store: MemoryDiscoverStore, today: string) {
  const refs: ReferenceInput[] = [
    { nicheSlug: "tecnologia-ia", subnicheSlug: "servicos-com-ia", advertiser: "Exemplo Academia IA", format: "video", firstSeen: addDays(today, -64), variations: 9, price: 19.9, hook: "Você usa IA só para perguntar coisas?", angle: "serviços para pequenos negócios", cta: "Saiba mais", landingType: "página curta com vídeo", copy: "8 projetos práticos para transformar IA em serviços que você pode oferecer.", tags: ["ebook", "ticket baixo"] },
    { nicheSlug: "tecnologia-ia", subnicheSlug: "prompts-prontos", advertiser: "Exemplo Prompts BR", format: "carousel", firstSeen: addDays(today, -41), variations: 5, price: 27, hook: "100 prompts que eu uso todo dia", angle: "economia de tempo", cta: "Comprar agora", landingType: "página curta", tags: ["ebook"] },
    { nicheSlug: "tecnologia-ia", subnicheSlug: "servicos-com-ia", advertiser: "Exemplo Freela Digital", format: "video", firstSeen: addDays(today, -35), variations: 6, price: 47, hook: "Meu primeiro cliente de IA veio do Instagram", angle: "serviços para pequenos negócios", cta: "Saiba mais", landingType: "VSL curta" },
    { nicheSlug: "tecnologia-ia", subnicheSlug: "ia-para-iniciantes", advertiser: "Exemplo Escola Tech", format: "image", firstSeen: addDays(today, -9), variations: 2, price: 97, hook: "IA do zero em 7 dias", angle: "aprender do zero", cta: "Inscreva-se" },
    { nicheSlug: "culinaria", subnicheSlug: "doces-para-vender", advertiser: "Exemplo Doces da Ana", format: "video", firstSeen: addDays(today, -88), variations: 12, price: 37, hook: "Esse brigadeiro paga minhas contas", angle: "renda com doces", cta: "Saiba mais", landingType: "VSL longa", tags: ["renda extra"] },
    { nicheSlug: "culinaria", subnicheSlug: "marmitas", advertiser: "Exemplo Marmita Fit", format: "video", firstSeen: addDays(today, -52), variations: 7, price: 47, hook: "Marmitas da semana em 2 horas", angle: "praticidade", cta: "Comprar agora", landingType: "página curta com vídeo" },
    { nicheSlug: "emagrecimento", subnicheSlug: "receitas-fit", advertiser: "Exemplo Receitas Leves", format: "image", firstSeen: addDays(today, -23), variations: 3, price: 29.9, hook: "Receitas leves para a semana toda", angle: "praticidade", cta: "Saiba mais", landingType: "página curta" },
  ];
  for (const r of refs) void store.addReference({ ...r, notes: "Exemplo fictício do modo demo." });
}
