import { Film, ImageIcon } from "lucide-react";
import { campaignIdeasAction, pastedIdeasAction } from "@/app/(painel)/criativos/actions";
import { ASSERTIVENESS_LABEL, type Assertiveness } from "@/lib/creative/assertiveness";
import { manualCampaignPrompt, type CampaignBrief, type CampaignIdeas } from "@/lib/creative/campaign-ideas";
import { fmtBRL, fmtDateTime, fmtInt, fmtPct } from "@/lib/format";
import { ActionForm } from "@/components/action-form";
import { Markdown } from "@/components/discover/markdown";
import { Badge, type Tone } from "@/components/ui/badge";
import { CopyButton } from "@/components/ui/copy-button";
import { Input, Textarea } from "@/components/ui/input";

const LEVEL_TONE: Record<Assertiveness, Tone> = { vendendo_acima: "good", promissor: "info", na_media: "neutral", fraco: "bad", sem_dados: "neutral" };

type SavedAnalysis = { data: unknown; createdAt: string } | null;

function Saved({ saved, tz }: { saved: SavedAnalysis; tz: string }) {
  if (!saved) return null;
  const d = saved.data as Partial<CampaignIdeas> & { source?: string; markdown?: string; sawImages?: number };
  return (
    <div className="space-y-3 rounded-lg border border-violet/30 bg-violet/5 p-3 text-sm">
      <p className="text-xs font-medium text-violet">
        Última análise · {fmtDateTime(saved.createdAt, tz)} · {d.source === "manual" ? "colada da IA grátis" : `IA${d.sawImages ? `, viu ${d.sawImages} miniatura(s)` : ""}`}
      </p>
      {d.source === "manual" && d.markdown ? <Markdown text={d.markdown} /> : null}
      {d.sobre ? <p>{d.sobre}</p> : null}
      {d.avaliacao?.length ? (
        <div>
          <p className="mb-1 text-xs font-medium text-muted">Leitura de cada anúncio</p>
          <ul className="space-y-1 text-xs">
            {d.avaliacao.map((a, i) => (
              <li key={i}>
                <b>{a.anuncio}:</b> {a.leitura}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {d.ideias?.length ? (
        <div>
          <p className="mb-1 text-xs font-medium text-muted">Ideias (os prompts já estão na lista de espera)</p>
          <ul className="space-y-2 text-xs">
            {d.ideias.map((i, k) => (
              <li key={k} className="rounded border border-border p-2">
                <span className="font-medium">{i.angulo}</span> <Badge tone={/novo/i.test(i.tipo) ? "violet" : "primary"}>{i.tipo}</Badge>
                <p className="mt-1">Gancho: “{i.gancho}”</p>
                <p className="text-muted">{i.por_que}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function CampaignAnalysis({ brief, saved, hasAi, tz }: { brief: CampaignBrief; saved: SavedAnalysis; hasAi: boolean; tz: string }) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-bg/40 p-3">
        <p className="mb-1 text-xs font-medium text-muted">O que o sistema identificou</p>
        <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted">
          {brief.summary.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </div>

      <div>
        <p className="mb-2 text-xs font-medium text-muted">Seus anúncios nesta campanha (últimos 30 dias)</p>
        {brief.ads.length ? (
          <ul className="grid gap-3 md:grid-cols-2">
            {brief.ads.map((a) => (
              <li key={a.id} className="min-w-0 space-y-2 rounded-lg border border-border p-3">
                <div className="flex gap-3">
                  {a.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.thumbnailUrl} alt="" className="h-20 w-20 shrink-0 rounded-md bg-black object-cover" loading="lazy" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-md bg-panel-2 text-faint">
                      {a.format === "video" ? <Film className="h-5 w-5" /> : <ImageIcon className="h-5 w-5" />}
                    </div>
                  )}
                  <div className="min-w-0 space-y-1">
                    <p className="break-words text-xs font-medium">{a.name}</p>
                    <div className="flex flex-wrap gap-1">
                      <Badge tone={LEVEL_TONE[a.level]}>{ASSERTIVENESS_LABEL[a.level]}</Badge>
                      <Badge>{a.format === "video" ? "vídeo" : a.format === "image" ? "imagem" : a.format === "carousel" ? "carrossel" : "formato ?"}</Badge>
                      {a.active ? <Badge tone="good">ativo</Badge> : <Badge>pausado</Badge>}
                    </div>
                    <p className="text-[11px] text-muted">
                      {fmtBRL(a.spend)} · {fmtInt(a.impressions)} impr. · {a.purchases} venda(s){a.cpa != null ? ` · CPA ${fmtBRL(a.cpa)}` : ""}
                    </p>
                    <p className="text-[11px] text-muted">
                      {a.hookRate != null ? `gancho ${fmtPct(a.hookRate)} · ` : ""}
                      {a.holdRate != null ? `retenção ${fmtPct(a.holdRate)} · ` : ""}
                      {a.ctrLink != null ? `CTR ${fmtPct(a.ctrLink, 2)}` : ""}
                    </p>
                  </div>
                </div>
                {a.assessment?.strengths.length ? (
                  <ul className="space-y-0.5 text-[11px] text-good">
                    {a.assessment.strengths.map((s) => (
                      <li key={s}>+ {s}</li>
                    ))}
                  </ul>
                ) : null}
                {a.assessment?.weaknesses.length ? (
                  <ul className="space-y-0.5 text-[11px] text-bad">
                    {a.assessment.weaknesses.map((s) => (
                      <li key={s}>− {s}</li>
                    ))}
                  </ul>
                ) : null}
                {a.verdictLabel ? <p className="text-[11px] text-faint">Vendas: {a.verdictLabel}{a.reasons[0] ? ` — ${a.reasons[0]}` : ""}</p> : null}
                {a.texts.length || a.headlines.length ? (
                  <details className="text-[11px]">
                    <summary className="cursor-pointer text-muted">Texto do anúncio{a.texts.length > 1 ? ` (${a.texts.length} variações)` : ""}</summary>
                    {a.headlines.length ? <p className="mt-1 font-medium">{a.headlines.join(" | ")}</p> : null}
                    {a.texts.map((t, i) => (
                      <p key={i} className="mt-1 whitespace-pre-line text-muted">
                        {t}
                      </p>
                    ))}
                  </details>
                ) : (
                  <p className="text-[11px] text-warn">Texto ainda não sincronizado.</p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted">Nenhum anúncio sincronizado nesta campanha.</p>
        )}
      </div>

      <Saved saved={saved} tz={tz} />

      <div className="space-y-3 rounded-lg border border-border p-3">
        <p className="text-sm font-medium">Analisar e criar novos criativos</p>
        <p className="text-xs text-muted">
          A análise lê os anúncios acima (textos, números e{hasAi ? " as miniaturas" : " o que você anexar"}) e a página, explica o que funciona e cria variações do que tem melhor sinal + ângulos que a campanha ainda não testou, com os prompts prontos.
        </p>
        {hasAi ? (
          <ActionForm action={campaignIdeasAction} submitLabel="Analisar campanha e gerar criativos (IA)">
            <input type="hidden" name="campaignId" value={brief.campaignId} />
            <Input name="focus" placeholder="Foco opcional (ex.: depoimentos, bastidores, Black Friday)" />
          </ActionForm>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <CopyButton text={manualCampaignPrompt(brief, null)} label="Copiar prompt (IA grátis)" />
          <span className="text-xs text-faint">Cole no ChatGPT, Claude.ai ou Gemini (anexe prints dos anúncios se puder) e traga a resposta abaixo.</span>
        </div>
        <ActionForm action={pastedIdeasAction} submitLabel="Colar análise e ideias" variant="secondary">
          <input type="hidden" name="campaignId" value={brief.campaignId} />
          <Textarea name="text" rows={5} placeholder="Cole aqui a resposta completa da IA" />
        </ActionForm>
      </div>
    </div>
  );
}
