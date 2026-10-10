import { AlertOctagon, AlertTriangle, ArrowRight, Info } from "lucide-react";
import Link from "next/link";
import { notifyChannelsAvailable } from "@/lib/alerts/notify";
import { currentAlerts } from "@/lib/alerts/run";
import { getRepository } from "@/lib/data";
import type { AlertRecord } from "@/lib/data/types";
import { fmtDateTime, fmtRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ActionButton, ActionForm } from "@/components/action-form";
import { ResolveButton } from "@/components/resolve-button";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Label, Select } from "@/components/ui/input";
import { checkAlertsNow, saveNotify, testNotify } from "./actions";

export const metadata = { title: "Alertas" };
export const maxDuration = 60;

type Row = { key: string; severity: AlertRecord["severity"]; title: string; message: string; href: string | null; when: string | null; id: string | null; notified: boolean };

export default async function Alertas() {
  const repo = await getRepository();
  const ctx = await repo.context();
  const live = ctx.mode === "live";
  const channels = notifyChannelsAvailable();

  let open: Row[] = [];
  let history: AlertRecord[] = [];
  if (live) {
    const all = await repo.alerts({ status: "all", limit: 200 });
    open = all
      .filter((a) => a.status === "open")
      .map((a) => ({ key: a.id, id: a.id, severity: a.severity, title: a.title, message: a.message, href: a.href, when: a.createdAt, notified: Boolean(a.notifiedAt) }));
    history = all.filter((a) => a.status === "resolved").slice(0, 30);
  } else {
    open = (await currentAlerts(repo)).map((a) => ({ key: a.dedupeKey, id: null, severity: a.severity, title: a.title, message: a.message, href: a.href, when: null, notified: false }));
  }

  return (
    <>
      <PageHeader
        title="Alertas"
        description="CPA acima da meta, ROAS baixo, gasto sem venda, frequência, fadiga, queda de entrega, anúncio reprovado, conta com problema e tracking parado. Recalculados a cada sincronização."
        actions={live ? <ActionButton action={checkAlertsNow} label="Verificar agora" /> : null}
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title={`Abertos (${open.length})`} description={live ? "Ficam abertos até a condição sumir — ou marque como resolvido." : "Modo demo: calculados na hora, sem histórico."} />
          {open.length ? (
            <ul className="divide-y divide-border">
              {open.map((a) => {
                const Icon = a.severity === "critico" ? AlertOctagon : a.severity === "atencao" ? AlertTriangle : Info;
                return (
                  <li key={a.key} className="flex items-start gap-3 px-4 py-3">
                    <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", a.severity === "critico" ? "text-bad" : a.severity === "atencao" ? "text-warn" : "text-info")} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{a.title}</p>
                      <p className="text-xs text-muted">{a.message}</p>
                      <p className="mt-1 flex flex-wrap gap-2 text-[11px] text-faint">
                        {a.when ? <span>{fmtRelative(a.when)}</span> : null}
                        {a.notified ? <Badge tone="good">notificado</Badge> : null}
                      </p>
                    </div>
                    {a.href ? (
                      <Link href={a.href} className="text-faint hover:text-text" aria-label="Abrir">
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    ) : null}
                    {a.id ? <ResolveButton id={a.id} /> : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState title="Nenhum alerta aberto" description="Tudo dentro do esperado por enquanto." />
          )}
        </Card>

        <Card>
          <CardHeader title="Notificações" description="Receba alertas novos fora do painel" />
          <CardBody className="space-y-4">
            <ActionForm action={saveNotify} submitLabel="Salvar" disabled={!live} disabledReason="Disponível com dados reais (fora do modo demo).">
              <div>
                <Label>E-mails (separados por vírgula)</Label>
                <Input name="emails" defaultValue={ctx.workspace.notify.emails.join(", ")} placeholder="voce@exemplo.com" />
                {!channels.email ? <p className="mt-1 text-[11px] text-warn">Servidor sem RESEND_API_KEY/ALERTS_FROM_EMAIL: e-mail desativado.</p> : null}
              </div>
              <div>
                <Label>Chat do Telegram (opcional)</Label>
                <Input name="telegramChatId" defaultValue={ctx.workspace.notify.telegramChatId ?? ""} placeholder="123456789" />
                <p className="mt-1 text-[11px] text-faint">
                  Fale com o bot do app no Telegram e use o @userinfobot para descobrir seu chat id.
                  {!channels.telegram ? " Servidor sem TELEGRAM_BOT_TOKEN: Telegram desativado." : ""}
                </p>
              </div>
              <div>
                <Label>Notificar a partir de</Label>
                <Select name="minSeverity" defaultValue={ctx.workspace.notify.minSeverity} className="w-full">
                  <option value="atencao">Atenção e crítico</option>
                  <option value="critico">Só crítico</option>
                </Select>
              </div>
            </ActionForm>
            <ActionButton action={testNotify} label="Enviar teste" disabled={!live} />
            <p className="text-[11px] text-faint">WhatsApp exige a API oficial do WhatsApp Business (aprovação da Meta); por isso a opção de celular é o Telegram.</p>
          </CardBody>
        </Card>
      </div>

      {history.length ? (
        <Card className="mt-5">
          <CardHeader title="Resolvidos recentemente" />
          <ul className="divide-y divide-border">
            {history.map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-4 py-2 text-xs">
                <Badge tone={a.severity === "critico" ? "bad" : "warn"}>{a.severity}</Badge>
                <span className="min-w-0 flex-1 truncate text-muted">
                  {a.title} — {a.message}
                </span>
                <span className="shrink-0 text-faint">{a.resolvedAt ? fmtDateTime(a.resolvedAt, ctx.workspace.timezone) : ""}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );
}
