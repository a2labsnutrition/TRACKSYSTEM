import type {
  Ad,
  AdSet,
  Campaign,
  CapiLog,
  InsightDaily,
  Level,
  Order,
  Product,
  TrackingEvent,
  TrackingHealth,
  TrackingSite,
  UserNote,
  WorkspaceContext,
} from "./types";

/** Leitura de dados para as telas. Implementações: demo e Supabase. */
export interface Repository {
  context(): Promise<WorkspaceContext>;
  campaigns(): Promise<Campaign[]>;
  adsets(campaignId?: string): Promise<AdSet[]>;
  ads(campaignId?: string): Promise<Ad[]>;
  insights(q: { level: Level; from: string; to: string; campaignId?: string }): Promise<InsightDaily[]>;
  /** Pedidos criados entre [from, to] (datas no fuso do workspace). */
  orders(q: { from: string; to: string }): Promise<Order[]>;
  products(): Promise<Product[]>;
  sites(): Promise<TrackingSite[]>;
  recentEvents(limit: number): Promise<TrackingEvent[]>;
  capiLogs(limit: number): Promise<CapiLog[]>;
  health(): Promise<TrackingHealth>;
  notes(campaignId?: string): Promise<UserNote[]>;
}
