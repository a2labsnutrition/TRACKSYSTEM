import { Bot } from "lucide-react";
import { getRepository } from "@/lib/data";
import { env } from "@/lib/env";
import { fmtBRL, fmtInt } from "@/lib/format";
import { DEFAULT_MONTHLY_GOAL, PACING_LABEL } from "@/lib/strategist/goal";
import { buildClaudinhoSnapshot, CLAUDINHO_SYSTEM, listPlans } from "@/lib/strategist/service";
import { cn } from "@/lib/utils";
import { ChatPanel } from "@/components/advisor/chat-panel";
import { PageHeader } from "@/components/layout/page-header";
import { PlanForm } from "@/components/strategist/plan-form";
import { PlanView } from "@/components/strategist/plan-view";
import { Badge, type Tone } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";

export const metadata = { title: "Claudinho" };
// O plano com esforço alto pode levar alguns minutos.
export const maxDuration = 300;

const STATUS_TONE: Record<string, Tone> = { meta_batida: "good", no_ritmo: "good", abaixo: "warn", muito_abaixo: "bad", sem_dados: "neutral" };
const ROLE: Record<string, { label: string; tone: Tone }> = {
  motor: { label: "Motor de lucro", tone: "good" },
  positiva: { label: "Dá lucro", tone: "info" },
  negativa: { label: "Dá prejuízo", tone: "bad" },
  sem_dados: { label: "Poucos dados", tone: "neutral" },
};

const SUGGESTIONS = [
  "O que eu faço hoje para chegar mais perto dos 10k?",
  "Posso subir o orçamento da campeã agora?",
  "Qual oferta eu devo cortar e por quê?",
  "Quantas vendas por dia eu preciso e com qual CPA?",
];

export default async function Claudinho() {
  const repo = await getRepository();
  const ctx = await repo.context();
  const plans = await listPlans(repo, 6);
  const latest = plans[0] ?? null;
  const goal = latest?.goal ?? DEFAULT_MONTHLY_GOAL;
  const s = await buildClaudinhoSnapshot(repo, goal);
  const rp = s.ritmo_da_meta;
  const hasAi = Boolean(env.anthropicApiKey);
  const progress = Math.max(0, Math.min(1, rp.liquido_no_mes_rs / goal));
  const prompt = `${CLAUDINHO_SYSTEM}\n\nDados da conta (JSON):\n${JSON.stringify(s)}\n\nMonte o plano para bater a meta de ${fmtBRL(goal)} líquidos neste mês: situação, diagnóstico, papel de cada oferta, até 6 ações para hoje (campanha, valor atual → novo na moeda da conta, quando, motivo, quando desfazer), plano de 7 dias, alavancas de ticket, 3 a 5 criativos novos, regras de escala, o que não fazer e dados faltando.`;

  return (
    <>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" /> Claudinho
          </span>
        }
        description={`Seu estrategista de tráfego. Uma missão: ${fmtBRL(goal)} líquidos no mês. Lê todas as campanhas, as vendas reais da Cakto e o câmbio, segue um manual de regras profissional e diz exatamente o que fazer — você executa.`}
        actions={
          <ChatPanel
            enabled={hasAi}
            endpoint="/api/claudinho/chat"
            title="Falar com o Claudinho"
            subtitle="Responde com os dados da conta inteira"
            placeholder="Pergunte ao Claudinho…"
            suggestions={SUGGESTIONS}
            buttonVariant="primary"
          />
        }
      />

      {/* -------- Meta do mês -------- */}
      <Card className="mb-5">
        <CardHeader
          title={`Meta de ${rp.mes.slice(5)}/${rp.mes.slice(0, 4)}: ${fmtBRL(goal)} líquidos`}
          description="Líquido = vendas aprovadas na Cakto − reembolsos − taxas − impostos − custos − anúncios (todas as vendas, com ou sem origem). Não inclui custos fixos."
          action={<Badge tone={STATUS_TONE[rp.status]}>{PACING_LABEL[rp.status]}</Badge>}
        />
        <CardBody>
          <div className="mb-3 h-3 w-full overflow-hidden rounded-full bg-panel-2">
            <div className={cn("h-full rounded-full", rp.liquido_no_mes_rs < 0 ? "bg-bad" : "bg-good")} style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {[
              ["Líquido no mês", fmtBRL(rp.liquido_no_mes_rs), rp.liquido_no_mes_rs < 0],
              ["Ritmo (média 7 dias)", rp.liquido_medio_por_dia_7d_rs == null ? "—" : `${fmtBRL(rp.liquido_medio_por_dia_7d_rs)}/dia`, (rp.liquido_medio_por_dia_7d_rs ?? 0) < 0],
              ["Projeção do mês", fmtBRL(rp.projecao_fim_do_mes_rs), (rp.projecao_fim_do_mes_rs ?? 0) < goal],
              ["Falta", fmtBRL(rp.falta_rs), false],
              ["Precisa por dia", `${fmtBRL(rp.liquido_por_dia_necessario_rs)}/dia`, false],
            ].map(([label, value, bad]) => (
              <div key={label as string} className="rounded-lg border border-border p-3">
                <p className="text-xs text-muted">{label}</p>
                <p className={cn("mt-1 text-lg font-semibold tabular", bad && "text-bad")}>{value}</p>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-faint">
            {rp.dias_fechados} dia(s) fechado(s) · {rp.dias_restantes_contando_hoje} dia(s) restantes contando hoje. Gasto em dólar convertido com câmbio estimado (PTAX + IOF/spread).
          </p>
        </CardBody>
      </Card>

      {/* -------- Economia das ofertas -------- */}
      <Card className="mb-5">
        <CardHeader
          title="Quanto cada oferta deixa por cliente (últimos 7 dias)"
          description="Só vendas com origem nas campanhas vinculadas ao produto (Configurações → Campanha → produto). Inclui bump e upsell do mesmo pedido."
        />
        {s.ofertas_7d.length ? (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Oferta</Th>
                  <Th>Papel</Th>
                  <Th className="text-right">Gasto</Th>
                  <Th className="text-right">Clientes</Th>
                  <Th className="text-right">Ticket médio</Th>
                  <Th className="text-right">Líquido/cliente</Th>
                  <Th className="text-right">CPA</Th>
                  <Th className="text-right">Lucro/cliente</Th>
                  <Th className="text-right">Lucro 7d</Th>
                  <Th className="text-right">Vendas/dia p/ meta</Th>
                </tr>
              </thead>
              <tbody>
                {s.ofertas_7d.map((o) => (
                  <tr key={o.produto}>
                    <Td className="max-w-[16rem] truncate font-medium" title={o.produto}>
                      {o.produto}
                    </Td>
                    <Td>
                      <Badge tone={ROLE[o.papel_calculado].tone}>{ROLE[o.papel_calculado].label}</Badge>
                    </Td>
                    <Td className="text-right">{fmtBRL(o.gasto_rs)}</Td>
                    <Td className="text-right">{fmtInt(o.clientes_com_origem)}</Td>
                    <Td className="text-right">{fmtBRL(o.ticket_medio_rs)}</Td>
                    <Td className="text-right">{fmtBRL(o.liquido_por_cliente_antes_do_anuncio_rs)}</Td>
                    <Td className="text-right">{fmtBRL(o.cpa_rs)}</Td>
                    <Td className={cn("text-right font-medium", (o.lucro_por_cliente_rs ?? 0) < 0 ? "text-bad" : "text-good")}>{fmtBRL(o.lucro_por_cliente_rs)}</Td>
                    <Td className={cn("text-right", o.lucro_contribuicao_rs < 0 ? "text-bad" : "")}>{fmtBRL(o.lucro_contribuicao_rs)}</Td>
                    <Td className="text-right">{o.vendas_dia_para_bater_a_meta_sozinha ?? "—"}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        ) : (
          <CardBody>
            <p className="text-sm text-muted">Cadastre os produtos e vincule cada campanha ao seu produto em Configurações para ver a economia por oferta.</p>
          </CardBody>
        )}
      </Card>

      {/* -------- Plano -------- */}
      <Card className="mb-5">
        <CardHeader
          title="Plano do Claudinho"
          description={hasAi ? "Diagnóstico, ações de hoje com valores na moeda da conta, plano de 7 dias, ticket e criativos." : "Sem ANTHROPIC_API_KEY: plano automático das regras, ou copie o prompt e cole numa IA grátis."}
          action={<PlanForm goal={goal} hasAi={hasAi} prompt={prompt} label={latest ? "Gerar plano novo" : "Gerar plano"} />}
        />
        <CardBody>
          {latest ? (
            <PlanView plan={latest.content} createdAt={latest.createdAt} model={latest.model} tz={ctx.workspace.timezone} />
          ) : (
            <p className="text-sm text-muted">Nenhum plano ainda. Clique em “Gerar plano” — o Claudinho lê a conta inteira e monta o caminho para a meta.</p>
          )}
          {plans.length > 1 ? (
            <details className="mt-6 rounded-lg border border-border p-3">
              <summary className="cursor-pointer text-sm font-medium">Planos anteriores ({plans.length - 1})</summary>
              <div className="mt-4 space-y-8">
                {plans.slice(1).map((p) => (
                  <div key={p.id} className="border-t border-border pt-4">
                    <PlanView plan={p.content} createdAt={p.createdAt} model={p.model} tz={ctx.workspace.timezone} />
                  </div>
                ))}
              </div>
            </details>
          ) : null}
        </CardBody>
      </Card>
    </>
  );
}
