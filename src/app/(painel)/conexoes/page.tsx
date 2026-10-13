import { ExternalLink, KeyRound, MousePointerClick } from "lucide-react";
import { getRepository } from "@/lib/data";
import { isMetaAppConfigured, isServiceRoleConfigured, isSupabaseConfigured } from "@/lib/env";
import { fmtDate, fmtRelative } from "@/lib/format";
import { DEMO_CAKTO_SECRET, DEMO_SITE_KEY } from "@/lib/ingest";
import { listAdAccounts, listPixels, META_SCOPES, type MetaAdAccountInfo } from "@/lib/integrations/meta/oauth";
import { MetaApiError } from "@/lib/integrations/meta/client";
import { readCredential } from "@/lib/credentials";
import { appOrigin } from "@/lib/origin";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sp, type SearchParams } from "@/lib/page";
import { ActionButton, ActionForm } from "@/components/action-form";
import { LiveEvents } from "@/components/live-events";
import { PageHeader } from "@/components/layout/page-header";
import { PlatformTabs } from "@/components/platform-tabs";
import { VerifyForm } from "@/components/verify-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { LinkButton } from "@/components/ui/button";
import { StatusDot, type Light } from "@/components/ui/status-dot";
import {
  activateAdAccounts,
  createSite,
  reconcileCakto,
  reprocessFailedCakto,
  saveCaktoApi,
  saveCaktoSecret,
  saveMetaToken,
  savePixel,
  sendTestEvent,
  syncNow,
  testCaktoWebhook,
  updateSite,
} from "./actions";

export const metadata = { title: "Conexões" };
// A conciliação com a Cakto pode ler centenas de pedidos.
export const maxDuration = 300;

const UTM_TEMPLATE =
  "utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.name}}|{{campaign.id}}&utm_term={{adset.name}}|{{adset.id}}&utm_content={{ad.name}}|{{ad.id}}";

export default async function Conexoes({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const repo = await getRepository();
  const ctx = await repo.context();
  const live = ctx.mode === "live";
  const origin = await appOrigin();
  const [sites, health, products] = await Promise.all([repo.sites(), repo.health(), repo.products()]);
  const blockedReason = !isSupabaseConfigured()
    ? "Modo demonstração: configure o Supabase no .env para salvar conexões reais."
    : !isServiceRoleConfigured()
      ? "Falta SUPABASE_SERVICE_ROLE_KEY no .env."
      : "Saia do modo demo para conectar contas reais.";
  const canSave = live && isServiceRoleConfigured();

  // ---------- Estado do Meta (modo real) ----------
  let metaCred: Awaited<ReturnType<typeof readCredential>> = null;
  let metaAccounts: MetaAdAccountInfo[] = [];
  let metaError: string | null = null;
  let apiPixels: Array<{ id: string; name: string; last_fired_time?: string }> = [];
  let savedPixels: Array<{ pixel_id: string; test_event_code: string | null; capi_credential_id: string | null }> = [];
  let caktoConfigured = false;
  let caktoApiConfigured = false;
  let recentRaw: Array<{ event_name: string; received_at: string; processed: boolean; process_error: string | null; signature_valid: boolean }> = [];
  if (canSave) {
    const db = supabaseAdmin();
    metaCred = await readCredential(db, ctx.workspace.id, "meta");
    if (metaCred) {
      try {
        metaAccounts = await listAdAccounts(metaCred.secret);
        const firstActive = ctx.adAccounts[0]?.metaAccountId ?? metaAccounts[0]?.id;
        if (firstActive) apiPixels = await listPixels(metaCred.secret, firstActive).catch(() => []);
      } catch (e) {
        metaError = e instanceof MetaApiError ? e.friendly : (e as Error).message;
      }
    }
    const [{ data: px }, cakto, caktoApi, { data: raw }] = await Promise.all([
      db.from("pixels").select("pixel_id, test_event_code, capi_credential_id").eq("workspace_id", ctx.workspace.id),
      readCredential(db, ctx.workspace.id, "cakto"),
      readCredential(db, ctx.workspace.id, "cakto_api"),
      db
        .from("cakto_events_raw")
        .select("event_name, received_at, processed, process_error, signature_valid")
        .eq("workspace_id", ctx.workspace.id)
        .order("received_at", { ascending: false })
        .limit(8),
    ]);
    savedPixels = px ?? [];
    caktoConfigured = Boolean(cakto);
    caktoApiConfigured = Boolean(caktoApi);
    recentRaw = raw ?? [];
  }

  const activeIds = new Set(ctx.adAccounts.map((a) => a.metaAccountId));
  const pixel = savedPixels[0] ?? null;
  const integ = (p: string) => health.integrations.find((i) => i.provider === p);

  const steps: Array<{ n: number; title: string; status: Light; anchor: string }> = live
    ? [
        { n: 1, title: "Meta (Marketing API)", status: !metaCred ? "missing" : metaError ? "error" : activeIds.size ? "ok" : "warning", anchor: "meta" },
        { n: 2, title: "Pixel + API de Conversões", status: pixel ? "ok" : "missing", anchor: "pixel" },
        { n: 3, title: "Script na página", status: (integ("tracking")?.status ?? "missing") as Light, anchor: "script" },
        { n: 4, title: "Cakto (webhook)", status: (integ("cakto")?.status ?? "missing") as Light, anchor: "cakto" },
        { n: 5, title: "Primeiro produto", status: products.length ? "ok" : "missing", anchor: "produto" },
      ]
    : [
        { n: 1, title: "Meta (Marketing API)", status: "missing", anchor: "meta" },
        { n: 2, title: "Pixel + API de Conversões", status: "missing", anchor: "pixel" },
        { n: 3, title: "Script na página", status: "warning", anchor: "script" },
        { n: 4, title: "Cakto (webhook)", status: "warning", anchor: "cakto" },
        { n: 5, title: "Primeiro produto", status: "missing", anchor: "produto" },
      ];

  const metaFlash = sp(params, "meta");
  const site = live ? sites[0] ?? null : { ...sites[0], publicKey: DEMO_SITE_KEY };
  const snippet = site ? `<script src="${origin}/t.js" data-site="${site.publicKey}" async></script>` : "";
  const webhookUrl = `${origin}/api/webhooks/cakto`;

  return (
    <>
      <PageHeader title="Conexões" description="Assistente passo a passo. Cada etapa tem um botão de teste e mensagem clara se algo der errado — não precisa saber programar." />

      {metaFlash === "ok" ? <Flash ok>Meta conectado. Agora ative as contas de anúncio abaixo.</Flash> : null}
      {metaFlash === "erro" ? <Flash>Erro no login com Facebook: {sp(params, "msg")}</Flash> : null}
      {metaFlash === "sem_app" ? <Flash>META_APP_ID/META_APP_SECRET não configurados no servidor. Use a opção de token manual ou configure o app (veja o passo 1).</Flash> : null}

      {/* Checklist */}
      <Card className="mb-5">
        <CardBody className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {steps.map((s) => (
            <a key={s.n} href={`#${s.anchor}`} className="flex items-center gap-2.5 rounded-lg border border-border bg-bg/40 px-3 py-2.5 text-sm hover:border-border-strong">
              <StatusDot status={s.status} />
              <span>
                <span className="text-faint">{s.n}. </span>
                {s.title}
              </span>
            </a>
          ))}
        </CardBody>
      </Card>

      <div className="space-y-5">
        {/* ============ 1. META ============ */}
        <Card id="meta">
          <CardHeader title="1. Meta — Marketing API" description="Lê campanhas, conjuntos, anúncios e métricas diárias. Leitura apenas — o sistema não altera suas campanhas." />
          <CardBody className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="space-y-4">
              <div>
                <p className="mb-2 text-sm font-medium">Opção A — Entrar com Facebook</p>
                {isMetaAppConfigured() ? (
                  <LinkButton href="/api/meta/oauth/start" variant={canSave ? "primary" : "secondary"} aria-disabled={!canSave}>
                    Entrar com Facebook
                  </LinkButton>
                ) : (
                  <p className="text-xs text-muted">Disponível quando META_APP_ID e META_APP_SECRET estiverem no servidor.</p>
                )}
                <p className="mt-2 text-xs text-faint">Gera token de ~60 dias. O painel avisa 7 dias antes de expirar.</p>
              </div>
              <div>
                <p className="mb-2 text-sm font-medium">Opção B (recomendada) — Token de Usuário do Sistema</p>
                <ActionForm action={saveMetaToken} submitLabel="Salvar token" disabled={!canSave} disabledReason={blockedReason}>
                  <Input name="token" type="password" placeholder="EAAB..." autoComplete="off" />
                </ActionForm>
                <p className="mt-2 text-xs text-faint">Não expira. Fica criptografado (AES-256) no banco e nunca vai para o navegador.</p>
              </div>
              {metaCred ? (
                <p className="text-xs text-muted">
                  <KeyRound className="mr-1 inline h-3.5 w-3.5" />
                  Token salvo{metaCred.expiresAt ? ` · expira em ${fmtDate(metaCred.expiresAt.slice(0, 10))}` : " · sem data de expiração"}
                  {metaError ? <span className="text-bad"> · {metaError}</span> : null}
                </p>
              ) : null}
            </div>

            <div className="space-y-3 rounded-lg border border-border bg-bg/40 p-4 text-sm">
              <p className="font-medium">Como criar o acesso (uma vez só, ~5 min)</p>
              <ol className="list-decimal space-y-1.5 pl-5 text-muted">
                <li>
                  Sem app? Em <b>developers.facebook.com → Meus apps → Criar app</b>, escolha o caso de uso de anúncios/Marketing API (ou “Outro” →
                  tipo “Empresa”) e selecione o seu portfólio empresarial.
                </li>
                <li>
                  Em <b>business.facebook.com → Configurações → Usuários do sistema</b> → Adicionar (função Admin).
                </li>
                <li>
                  “Atribuir ativos”: o <b>app</b> (controle total), a <b>conta de anúncios</b> (controle total) e o <b>conjunto de dados</b> — é o novo
                  nome do Pixel no Meta (gerenciar).
                </li>
                <li>
                  “Gerar token” → escolha o app → marque as permissões <code className="text-text">{META_SCOPES.join(", ")}</code> → validade “Nunca”.
                </li>
                <li>Copie o token e cole na Opção B.</li>
              </ol>
              <p className="text-xs text-faint">
                ads_management só é necessário se, no futuro, você quiser criar campanhas como rascunho pelo sistema. Para só ler, ads_read basta.
              </p>
            </div>

            {metaCred && metaAccounts.length ? (
              <div className="lg:col-span-2">
                <p className="mb-2 text-sm font-medium">Contas de anúncio</p>
                <ActionForm action={activateAdAccounts} submitLabel="Salvar contas ativas" disabled={!canSave}>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {metaAccounts.map((a) => (
                      <label key={a.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                        <input type="checkbox" name="account" value={a.id} defaultChecked={activeIds.has(a.id)} />
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{a.name}</span>
                          <span className="text-xs text-faint">
                            {a.id} · {a.currency} · {a.timezone_name}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                </ActionForm>
                <div className="mt-3 flex flex-wrap items-start gap-4">
                  <ActionButton action={syncNow} label="Sincronizar agora" variant="primary" disabled={!activeIds.size} />
                  <p className="max-w-md text-xs text-faint">
                    Depois disso o cron sincroniza sozinho: de hora em hora (hoje/ontem) e reprocessa os últimos 7 dias uma vez por dia. Última sincronização:{" "}
                    {fmtRelative(ctx.adAccounts.map((a) => a.lastSyncedAt).filter(Boolean).sort().at(-1) ?? null)}.
                  </p>
                </div>
              </div>
            ) : null}
          </CardBody>
        </Card>

        {/* ============ 2. PIXEL + CAPI ============ */}
        <Card id="pixel">
          <CardHeader
            title="2. Pixel + API de Conversões (CAPI)"
            description="O script dispara cada evento no Pixel e no servidor com o mesmo event_id (o Meta deduplica). O Purchase é enviado quando a Cakto confirma o pagamento — inclusive Pix."
          />
          <CardBody className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <ActionForm action={savePixel} submitLabel="Salvar Pixel" disabled={!canSave} disabledReason={blockedReason}>
              <div>
                <Label>ID do Pixel (conjunto de dados)</Label>
                {apiPixels.length ? (
                  <Select name="pixelId" defaultValue={pixel?.pixel_id ?? apiPixels[0].id} className="w-full">
                    {apiPixels.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.id}){p.last_fired_time ? ` · último disparo ${fmtDate(p.last_fired_time.slice(0, 10))}` : ""}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Input name="pixelId" defaultValue={pixel?.pixel_id ?? ""} placeholder="123456789012345" inputMode="numeric" />
                )}
              </div>
              <div>
                <Label>Token da API de Conversões (opcional)</Label>
                <Input name="capiToken" type="password" placeholder={pixel?.capi_credential_id ? "•••••• (salvo — deixe vazio para manter)" : "Gerenciador de Eventos → Configurações → Gerar token"} autoComplete="off" />
              </div>
              <div>
                <Label>Código de evento de teste (opcional)</Label>
                <Input name="testEventCode" defaultValue={pixel?.test_event_code ?? ""} placeholder="TEST12345" />
                <p className="mt-1 text-xs text-faint">Enquanto preenchido, TODOS os eventos vão para “Testar eventos”. Apague depois de testar.</p>
              </div>
            </ActionForm>
            <div className="space-y-3 text-sm">
              <ActionButton action={sendTestEvent} label="Enviar evento de teste" disabled={!canSave || !pixel} />
              <ul className="list-disc space-y-1 pl-5 text-xs text-muted">
                <li>Dados do comprador (e-mail, telefone, nome) vão com hash SHA-256 — nunca em texto puro.</li>
                <li>Também enviamos fbp, fbc, IP e user-agent para melhorar a qualidade de correspondência.</li>
                <li>
                  A <b>qualidade de correspondência (EMQ)</b> aparece no Gerenciador de Eventos do Meta; o log de envios fica em{" "}
                  <a href="/saude" className="text-primary">Saúde do tracking</a>.
                </li>
                <li className="text-warn">
                  Se você também configurou o Pixel dentro da Cakto com evento de compra, desative o Purchase lá: os IDs de evento são diferentes e o Meta contaria a venda em dobro.
                </li>
              </ul>
            </div>
          </CardBody>
        </Card>

        {/* ============ 3. SCRIPT ============ */}
        <Card id="script">
          <CardHeader title="3. Script na página de vendas" description="Leve (assíncrono, ~10 KB), não trava a página. Captura UTMs, fbclid, fbp/fbc e repassa um identificador para o checkout da Cakto." />
          <CardBody className="space-y-6">
            {live && !sites.length ? (
              <ActionForm action={createSite} submitLabel="Criar site e gerar snippet" disabled={!canSave} disabledReason={blockedReason}>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <Label>Nome</Label>
                    <Input name="name" placeholder="Página do curso X" />
                  </div>
                  <div>
                    <Label>Domínio</Label>
                    <Input name="domain" placeholder="suapagina.com" />
                  </div>
                </div>
              </ActionForm>
            ) : null}

            {site?.publicKey ? (
              <>
                <div>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">Cole no &lt;head&gt; da página</p>
                    <CopyButton text={snippet} label="Copiar snippet" />
                  </div>
                  <pre className="overflow-x-auto rounded-lg border border-border bg-bg p-3 text-xs text-info">{snippet}</pre>
                  {!live ? <p className="mt-1 text-xs text-warn">Modo demo: este snippet funciona contra este servidor e os eventos aparecem no painel ao vivo (sem gravar no banco).</p> : null}
                </div>
                <PlatformTabs />

                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                  <div>
                    <p className="mb-2 text-sm font-medium">Verificador de instalação</p>
                    <VerifyForm siteKey={site.publicKey} pixelId={site.pixelId ?? pixel?.pixel_id ?? null} defaultUrl={site.domain ? `https://${site.domain}` : undefined} />
                    <p className="mt-3 flex items-start gap-1.5 text-xs text-muted">
                      <MousePointerClick className="mt-px h-3.5 w-3.5 shrink-0" />
                      <span>
                        Botão não detectado? Abra sua página com <code className="text-text">?cc_pick=1</code> no fim da URL, clique no botão e copie o seletor gerado para o campo
                        “Botões de checkout extras”.
                      </span>
                    </p>
                  </div>
                  {live && sites[0] ? (
                    <div>
                      <p className="mb-2 text-sm font-medium">Configuração do script</p>
                      <ActionForm action={updateSite} submitLabel="Salvar configuração" variant="secondary">
                        <input type="hidden" name="siteId" value={sites[0].id} />
                        <div>
                          <Label>Botões de checkout extras (seletores CSS, um por linha)</Label>
                          <Textarea name="selectors" rows={3} defaultValue={sites[0].checkoutSelectors.join("\n")} placeholder=".btn-comprar&#10;#cta-principal" />
                          <p className="mt-1 text-xs text-faint">Links para pay.cakto.com.br e elementos com data-track=&quot;checkout&quot; já são detectados automaticamente.</p>
                        </div>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                          <div>
                            <Label>ID do Pixel (conjunto de dados)</Label>
                            <Input name="pixelId" defaultValue={sites[0].pixelId ?? ""} />
                          </div>
                          <div>
                            <Label>Parâmetro no checkout</Label>
                            <Input name="idParam" defaultValue={sites[0].idParam} />
                          </div>
                          <div>
                            <Label>Consentimento (LGPD)</Label>
                            <Select name="consentMode" defaultValue={sites[0].consentMode} className="w-full">
                              <option value="none">Aviso de privacidade (padrão)</option>
                              <option value="required">Só após aceite</option>
                            </Select>
                          </div>
                        </div>
                        <p className="text-xs text-faint">
                          “Só após aceite”: nada é rastreado até o visitante aceitar. Use data-banner=&quot;1&quot; no snippet para exibir o aviso pronto, ou chame
                          CentralTracker.consent(true) no seu banner.
                        </p>
                      </ActionForm>
                    </div>
                  ) : null}
                </div>

                <div className="rounded-lg border border-border bg-bg/40 p-4">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium">Parâmetros de URL dos anúncios (cole no Gerenciador de Anúncios)</p>
                    <CopyButton text={UTM_TEMPLATE} label="Copiar UTMs" />
                  </div>
                  <pre className="overflow-x-auto whitespace-pre-wrap break-all text-xs text-muted">{UTM_TEMPLATE}</pre>
                  <p className="mt-2 text-xs text-faint">
                    Anúncio → Rastreamento → Parâmetros de URL. Os IDs ({"{{campaign.id}}"} etc.) permitem ligar cada venda ao anúncio exato mesmo que você renomeie a campanha.
                  </p>
                </div>

                <div>
                  <p className="mb-2 text-sm font-medium">Eventos chegando em tempo real</p>
                  <div className="rounded-lg border border-border">
                    <LiveEvents />
                  </div>
                </div>
              </>
            ) : null}
          </CardBody>
        </Card>

        {/* ============ 4. CAKTO ============ */}
        <Card id="cakto">
          <CardHeader title="4. Cakto — vendas reais" description="Cada pagamento aprovado, Pix/boleto gerado, recusa, reembolso, chargeback e abandono chega por webhook e vira venda no painel." />
          <CardBody className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="space-y-4">
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">URL do webhook</p>
                  <CopyButton text={webhookUrl} label="Copiar URL" />
                </div>
                <pre className="overflow-x-auto rounded-lg border border-border bg-bg p-3 text-xs text-info">{webhookUrl}</pre>
              </div>
              <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted">
                <li>
                  Na Cakto: <b>Integrações → Webhooks → Adicionar</b>.
                </li>
                <li>Cole a URL acima, escolha os produtos e marque os eventos: compra aprovada, compra recusada, Pix gerado, boleto gerado, reembolso, chargeback, abandono de checkout (e assinatura, se tiver).</li>
                <li>Copie o <b>segredo</b> (secret) que a Cakto mostra e cole aqui.</li>
                <li>Clique em “Testar webhook” aqui e depois em “Enviar teste” na Cakto.</li>
              </ol>
              {live ? (
                <>
                  <ActionForm action={saveCaktoSecret} submitLabel={caktoConfigured ? "Trocar segredo" : "Salvar segredo"} disabled={!canSave} disabledReason={blockedReason}>
                    <Input name="secret" type="password" placeholder={caktoConfigured ? "•••••• (salvo)" : "segredo do webhook"} autoComplete="off" />
                  </ActionForm>
                  <div className="flex flex-wrap gap-4">
                    <ActionButton action={testCaktoWebhook} label="Testar webhook" disabled={!caktoConfigured} />
                    <ActionButton action={reprocessFailedCakto} label="Reprocessar eventos com erro" disabled={!caktoConfigured} />
                  </div>
                </>
              ) : (
                <p className="rounded-lg border border-warn/30 bg-warn/5 p-3 text-xs text-warn">
                  Modo demo: o endpoint aceita o segredo de teste <code>{DEMO_CAKTO_SECRET}</code> (os pedidos ficam só na memória do servidor).
                </p>
              )}
            </div>
            <div className="space-y-4">
              <div>
                <p className="mb-2 text-sm font-medium">Últimos eventos recebidos</p>
                {recentRaw.length ? (
                  <ul className="divide-y divide-border rounded-lg border border-border text-xs">
                    {recentRaw.map((r, i) => (
                      <li key={i} className="flex items-center gap-2 px-3 py-2">
                        <StatusDot status={!r.signature_valid ? "error" : r.process_error ? "warning" : "ok"} />
                        <span className="font-medium">{r.event_name}</span>
                        <span className="text-faint">{fmtRelative(r.received_at)}</span>
                        <span className="ml-auto truncate text-faint">{!r.signature_valid ? "segredo inválido" : r.process_error ?? "processado"}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted">Nenhum evento ainda.</p>
                )}
              </div>
              <div className="rounded-lg border border-border bg-bg/40 p-4">
                <p className="text-sm font-medium">API da Cakto (opcional) — conciliação</p>
                <p className="mb-3 mt-1 text-xs text-muted">
                  Busca pedidos dos últimos 7 dias pela API para recuperar vendas que o webhook não entregou. Os pedidos passam pelo mesmo processamento (sem duplicar).
                </p>
                {live ? (
                  <>
                    <ActionForm action={saveCaktoApi} submitLabel={caktoApiConfigured ? "Atualizar credenciais" : "Conectar API"} variant="secondary" disabled={!canSave}>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <Input name="clientId" placeholder="client_id" autoComplete="off" />
                        <Input name="clientSecret" type="password" placeholder="client_secret" autoComplete="off" />
                      </div>
                    </ActionForm>
                    <div className="mt-3">
                      <ActionButton action={reconcileCakto} label="Conciliar 7 dias" disabled={!caktoApiConfigured} />
                    </div>
                  </>
                ) : null}
                <p className="mt-2 text-[11px] text-faint">
                  Beta: endpoints da API da Cakto configuráveis (CAKTO_TOKEN_PATH / CAKTO_ORDERS_PATH) — confirme na documentação oficial se a chamada falhar.
                </p>
              </div>
            </div>
          </CardBody>
        </Card>

        {/* ============ 5. PRODUTO ============ */}
        <Card id="produto">
          <CardHeader title="5. Primeiro produto e metas" description="Preço, valor líquido por venda e CPA alvo alimentam o motor de decisão (Escalar / Manter / Otimizar / Pausar)." />
          <CardBody className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted">{products.length ? `${products.length} produto(s) cadastrado(s).` : "Nenhum produto ainda — sem ele, as regras usam metas genéricas."}</p>
            <LinkButton href="/configuracoes" variant="secondary">
              {products.length ? "Editar produtos e metas" : "Cadastrar produto"} <ExternalLink className="h-3.5 w-3.5" />
            </LinkButton>
          </CardBody>
        </Card>
      </div>
    </>
  );
}

function Flash({ ok, children }: { ok?: boolean; children: React.ReactNode }) {
  return <div className={`mb-4 rounded-lg border px-3 py-2 text-sm ${ok ? "border-good/30 bg-good/5 text-good" : "border-bad/30 bg-bad/5 text-bad"}`}>{children}</div>;
}
