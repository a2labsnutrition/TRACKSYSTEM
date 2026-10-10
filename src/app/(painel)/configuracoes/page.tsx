import { getRepository } from "@/lib/data";
import { configFromProduct, DEFAULT_DECISION_CONFIG } from "@/lib/decision/rules";
import { fmtBRL, fmtDec, fmtRoas } from "@/lib/format";
import { ActionForm } from "@/components/action-form";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { linkCampaigns, saveAdAccountFx, saveProduct, saveWorkspace } from "./actions";
import type { Product } from "@/lib/data/types";

export const metadata = { title: "Configurações" };

const KIND_LABEL: Record<string, string> = { principal: "produto principal", order_bump: "order bump", upsell: "upsell" };

const TIMEZONES = ["America/Cuiaba", "America/Sao_Paulo", "America/Campo_Grande", "America/Manaus", "America/Belem", "America/Fortaleza", "America/Recife", "America/Bahia", "America/Porto_Velho", "America/Rio_Branco", "America/Noronha"];

export default async function Configuracoes() {
  const repo = await getRepository();
  const ctx = await repo.context();
  const [products, campaigns] = await Promise.all([repo.products(), repo.campaigns()]);
  const disabled = ctx.mode !== "live";
  const reason = "Disponível com dados reais (fora do modo demo).";
  const fmtPctInput = (v: number) => fmtDec(v * 100, 2);

  return (
    <>
      <PageHeader title="Configurações" description="Fuso, impostos, câmbio, custos e metas por produto. Tudo em R$." />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader title="Workspace" description="O fuso define o que é “hoje” no painel e a data das vendas." />
          <CardBody>
            <ActionForm action={saveWorkspace} submitLabel="Salvar" disabled={disabled} disabledReason={reason}>
              <div>
                <Label>Nome</Label>
                <Input name="name" defaultValue={ctx.workspace.name} />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <Label>Fuso horário</Label>
                  <Select name="timezone" defaultValue={ctx.workspace.timezone} className="w-full">
                    {[...new Set([ctx.workspace.timezone, ...TIMEZONES])].map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label>Impostos sobre o faturamento (%)</Label>
                  <Input name="taxRate" defaultValue={fmtPctInput(ctx.workspace.taxRate)} inputMode="decimal" />
                </div>
                <div>
                  <Label>Taxa Cakto padrão (%)</Label>
                  <Input name="feeRate" defaultValue={fmtPctInput(ctx.workspace.defaultFeeRate)} inputMode="decimal" />
                </div>
              </div>
              <p className="text-xs text-faint">A taxa padrão só é usada quando o webhook não informa o valor líquido (o pedido fica marcado como “estimado”).</p>
            </ActionForm>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Novo produto"
            description="Se vazio, o CPA máximo é o CPA de equilíbrio (líquido − impostos − custos variáveis) e o alvo é 70% dele. Order bumps e upsells não contam como compra."
          />
          <CardBody>
            <ProductForm disabled={disabled} reason={reason} />
          </CardBody>
        </Card>
      </div>

      {products.length ? (
        <Card className="mt-5">
          <CardHeader title="Produtos e metas" description="Metas efetivas usadas pelo motor de decisão" />
          <CardBody className="space-y-5">
            {products.map((p) => {
              const c = configFromProduct(p, ctx.workspace);
              return (
                <details key={p.id} className="rounded-lg border border-border p-3">
                  <summary className="cursor-pointer text-sm">
                    <b>{p.name}</b> · {KIND_LABEL[p.kind ?? "principal"]} · {fmtBRL(p.price)}
                    {(p.kind ?? "principal") === "principal" ? (
                      <>
                        {" "}
                        · equilíbrio {fmtBRL(c.breakevenCpa ?? null)} · CPA máx. {fmtBRL(c.maxCpa)} ({c.breakevenSource === "configurado" ? "definido por você" : "automático"}) · alvo {fmtBRL(c.targetCpa)} · ROAS mín. {fmtRoas(c.minRoas)}
                      </>
                    ) : null}
                  </summary>
                  <div className="mt-3">
                    <ProductForm product={p} disabled={disabled} reason={reason} />
                  </div>
                </details>
              );
            })}
          </CardBody>
        </Card>
      ) : null}

      {ctx.adAccounts.length ? (
        <Card className="mt-5">
          <CardHeader
            title="Contas de anúncio e câmbio"
            description="O Meta informa gasto e orçamento na moeda da conta. Conta em outra moeda é convertida para R$ (cotação PTAX do Banco Central do dia ou taxa manual) + IOF/spread do cartão — e todo valor convertido aparece como estimado."
          />
          <CardBody className="space-y-4">
            {ctx.adAccounts.map((a) => (
              <div key={a.id} className="rounded-lg border border-border p-3">
                <p className="mb-2 text-sm">
                  <b>{a.name}</b> <span className="text-faint">· {a.metaAccountId} · moeda {a.currency} · fuso {a.timezone}</span>
                </p>
                {a.currency.toUpperCase() === "BRL" ? (
                  <p className="text-xs text-muted">Conta em R$: sem conversão.</p>
                ) : (
                  <ActionForm action={saveAdAccountFx} submitLabel="Salvar câmbio" disabled={disabled} disabledReason={reason} variant="secondary">
                    <input type="hidden" name="id" value={a.id} />
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <div>
                        <Label>Cotação</Label>
                        <Select name="fxMode" defaultValue={a.fxMode ?? "auto"} className="w-full">
                          <option value="auto">PTAX do dia (Banco Central)</option>
                          <option value="manual">Taxa manual fixa</option>
                        </Select>
                      </div>
                      <div>
                        <Label>Taxa manual (R$ por {a.currency})</Label>
                        <Input name="fxManualRate" defaultValue={a.fxManualRate ? fmtDec(a.fxManualRate, 4) : ""} placeholder="ex.: 5,4500" inputMode="decimal" />
                      </div>
                      <div>
                        <Label>IOF + spread do cartão (%)</Label>
                        <Input name="fxSpreadPct" defaultValue={fmtPctInput(a.fxSpreadPct ?? 0.035)} inputMode="decimal" />
                      </div>
                    </div>
                    <p className="text-xs text-faint">
                      No modo PTAX, a taxa manual é usada só se a cotação do dia (ou dos 10 dias anteriores) não estiver disponível. Sem nenhuma cotação, o gasto é excluído das somas e o painel avisa — nunca somamos {a.currency} como R$.
                    </p>
                  </ActionForm>
                )}
              </div>
            ))}
          </CardBody>
        </Card>
      ) : null}

      {campaigns.length && products.length ? (
        <Card className="mt-5">
          <CardHeader title="Campanha → produto" description="Define quais metas valem para cada campanha" />
          <CardBody>
            <ActionForm action={linkCampaigns} submitLabel="Salvar vínculos" disabled={disabled} disabledReason={reason}>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {campaigns.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate" title={c.name}>{c.name}</span>
                    <Select name={`c_${c.id}`} defaultValue={c.productId ?? ""} className="w-48">
                      <option value="">— sem produto —</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </Select>
                  </label>
                ))}
              </div>
            </ActionForm>
          </CardBody>
        </Card>
      ) : null}
    </>
  );
}

function ProductForm({ product, disabled, reason }: { product?: Product; disabled: boolean; reason: string }) {
  const v = (n: number | null | undefined) => (n == null ? "" : fmtDec(n, 2));
  const r = product?.rules;
  return (
    <ActionForm action={saveProduct} submitLabel={product ? "Salvar produto" : "Criar produto"} disabled={disabled} disabledReason={reason} variant={product ? "secondary" : "primary"}>
      {product ? <input type="hidden" name="id" value={product.id} /> : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label>Nome</Label>
          <Input name="name" defaultValue={product?.name} placeholder="Curso X" />
        </div>
        <div>
          <Label>Preço (R$)</Label>
          <Input name="price" defaultValue={v(product?.price)} placeholder="97,00" inputMode="decimal" />
        </div>
        <div>
          <Label>Líquido por venda após taxa da Cakto (R$)</Label>
          <Input name="netPerSale" defaultValue={v(product?.netPerSale)} placeholder="automático (taxa padrão)" inputMode="decimal" />
        </div>
        <div>
          <Label>Papel no funil</Label>
          <Select name="kind" defaultValue={product?.kind ?? "principal"} className="w-full">
            <option value="principal">Produto principal (conta como compra)</option>
            <option value="order_bump">Order bump</option>
            <option value="upsell">Upsell</option>
          </Select>
        </div>
        <div>
          <Label>Custo variável por venda (R$)</Label>
          <Input name="costPerSale" defaultValue={v(product?.costPerSale)} placeholder="0,00" inputMode="decimal" />
        </div>
        <div>
          <Label>Custo variável sobre a venda (%)</Label>
          <Input name="costPct" defaultValue={product?.costPct ? fmtDec(product.costPct * 100, 2) : ""} placeholder="0 (ex.: coprodução, afiliado)" inputMode="decimal" />
        </div>
        <div>
          <Label>IDs do produto na Cakto</Label>
          <Input name="caktoIds" defaultValue={product?.caktoProductIds.join(", ")} placeholder="abc123, def456" />
        </div>
        <div>
          <Label>CPA alvo (R$) — opcional</Label>
          <Input name="targetCpa" defaultValue={v(product?.targetCpa)} placeholder="automático" inputMode="decimal" />
        </div>
        <div>
          <Label>CPA máximo tolerável (R$) — vazio = equilíbrio</Label>
          <Input name="maxCpa" defaultValue={v(product?.maxCpa)} placeholder="automático" inputMode="decimal" />
        </div>
        <div>
          <Label>ROAS mínimo</Label>
          <Input name="minRoas" defaultValue={v(product?.minRoas)} placeholder="automático" inputMode="decimal" />
        </div>
      </div>
      <details className="rounded-lg border border-border p-3">
        <summary className="cursor-pointer text-xs font-medium text-muted">Regras de decisão (avançado — vazio usa o padrão)</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div>
            <Label>Sinal forte sem venda (× CPA máximo)</Label>
            <Input name="killSpendMultiple" defaultValue={v(r?.killSpendMultiple)} placeholder={`${fmtDec(DEFAULT_DECISION_CONFIG.killSpendMultiple, 1)} (≈ 5% de chance)`} inputMode="decimal" />
          </div>
          <div>
            <Label>Frequência máxima</Label>
            <Input name="frequencyMax" defaultValue={v(r?.frequencyMax)} placeholder={fmtDec(DEFAULT_DECISION_CONFIG.frequencyMax, 1)} inputMode="decimal" />
          </div>
          <div>
            <Label>Vendas mínimas p/ escalar (7d)</Label>
            <Input name="minPurchasesToScale" defaultValue={r?.minPurchasesToScale ?? ""} placeholder={String(DEFAULT_DECISION_CONFIG.minPurchasesToScale)} inputMode="numeric" />
          </div>
          <div>
            <Label>Cliques mínimos p/ veredito</Label>
            <Input name="minLinkClicks" defaultValue={r?.minLinkClicks ?? ""} placeholder={String(DEFAULT_DECISION_CONFIG.minLinkClicks)} inputMode="numeric" />
          </div>
          <div>
            <Label>Connect rate mínimo (%)</Label>
            <Input name="connectRateMin" defaultValue={r?.connectRateMin != null ? fmtDec(r.connectRateMin * 100, 0) : ""} placeholder={fmtDec(DEFAULT_DECISION_CONFIG.connectRateMin * 100, 0)} inputMode="decimal" />
          </div>
          <div>
            <Label>Orçamento mínimo de teste (R$)</Label>
            <Input name="minTestBudget" defaultValue={v(r?.minTestBudget)} placeholder="sem mínimo (só estatística)" inputMode="decimal" />
          </div>
        </div>
      </details>
    </ActionForm>
  );
}
