import { getRepository } from "@/lib/data";
import { configFromProduct } from "@/lib/decision/rules";
import { fmtBRL, fmtDec, fmtRoas } from "@/lib/format";
import { ActionForm } from "@/components/action-form";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { linkCampaigns, saveProduct, saveWorkspace } from "./actions";
import type { Product } from "@/lib/data/types";

export const metadata = { title: "Configurações" };

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
      <PageHeader title="Configurações" description="Fuso, impostos e metas por produto. Tudo em R$." />
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
                  <Label>Impostos sobre receita (%)</Label>
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
          <CardHeader title="Novo produto" description="O CPA alvo, se vazio, é calculado como 50% do líquido por venda; o máximo tolerável, 85%." />
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
              const c = configFromProduct(p);
              return (
                <details key={p.id} className="rounded-lg border border-border p-3">
                  <summary className="cursor-pointer text-sm">
                    <b>{p.name}</b> · {fmtBRL(p.price)} · CPA alvo {fmtBRL(c.targetCpa)} · máx. {fmtBRL(c.maxCpa)} · ROAS mín. {fmtRoas(c.minRoas)}
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
          <Label>Líquido por venda (R$)</Label>
          <Input name="netPerSale" defaultValue={v(product?.netPerSale)} placeholder="89,50" inputMode="decimal" />
        </div>
        <div>
          <Label>IDs do produto na Cakto</Label>
          <Input name="caktoIds" defaultValue={product?.caktoProductIds.join(", ")} placeholder="abc123, def456" />
        </div>
        <div>
          <Label>CPA alvo (R$)</Label>
          <Input name="targetCpa" defaultValue={v(product?.targetCpa)} placeholder="automático" inputMode="decimal" />
        </div>
        <div>
          <Label>CPA máximo tolerável (R$)</Label>
          <Input name="maxCpa" defaultValue={v(product?.maxCpa)} placeholder="automático" inputMode="decimal" />
        </div>
        <div>
          <Label>ROAS mínimo</Label>
          <Input name="minRoas" defaultValue={v(product?.minRoas)} placeholder="automático" inputMode="decimal" />
        </div>
      </div>
    </ActionForm>
  );
}
