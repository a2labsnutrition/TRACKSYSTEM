# Como continuar este projeto (passagem de bastão)

Leia este arquivo inteiro antes de mexer no código. Responda ao usuário sempre em **português do Brasil**.

## O que é
Central de Comando de Meta Ads: tracking + inteligência + criação para infoprodutor (Meta Ads + Cakto).
Stack: Next.js 16 (App Router, `proxy.ts`), React 19, TypeScript, Tailwind v4, Supabase (RLS), API da Anthropic, Vercel (plano Hobby).
Produção: https://tracksystem-eta.vercel.app — deploy automático a cada push na branch abaixo.

## Branch e commits
- Trabalhar e dar push em `claude/meta-ads-command-center-o5jc6h` (a Vercel publica sozinha).
- Antes de commitar: `npx tsc --noEmit && npx eslint src tests && npx vitest run && npm run build`.
- Não abrir PR sem o usuário pedir.

## Regras do usuário (não quebrar)
- Sistema **consultivo**: nunca cria/altera campanhas, orçamentos ou anúncios no Meta.
- Não inventar endpoints/campos de API; adaptadores isolados em `src/lib/integrations/<servico>` com parser tolerante.
- Não expor tokens em logs nem na tela; nunca pedir chaves no chat (o usuário cola na Vercel).
- Não inventar dados: IA recebe números já calculados; "vencedor" só com teste estatístico.
- Sempre ter alternativa sem a chave da Anthropic: botão "Copiar prompt (IA grátis)" + colar a resposta.
- Plano Hobby da Vercel: cron no máximo diário (já há auto-sync ao abrir o painel); funções até 300 s.
- Leia `node_modules/next/dist/docs/` antes de usar APIs do Next (ver `AGENTS.md`).

## Fases
- [x] Fase 1 — Tracking (Meta, script `t.js`, webhook Cakto, CAPI, saúde)
- [x] Fase 2 — Inteligência (breakdowns, motor de decisão, parecer, alertas, chat, anotações). Auditoria em `docs/AUDITORIA.md`.
- [x] Fase 3 — Descobrir & Criar (`/descobrir`, `/kits`): nichos com score, referências/swipe, kit completo, prompt Lovable, HTML, Lançar no Tracking.
- [x] Fase 4 — Criativos (`/criativos`) e Estúdio de PDF (`/pdf`).
- [ ] Fase 5 — Refino (PRÓXIMO PASSO):
  1. Comparação "parecer vs. resultado": para cada parecer salvo (`advisor_reports`), mostrar o que foi sugerido e o que aconteceu nos dias seguintes (CPA/ROAS/vendas), e medir acerto das regras.
  2. Relatório semanal por e-mail (já existe envio de alertas por e-mail/Telegram em `src/lib/alerts/notify.ts`; cron só diário no Hobby → enviar quando for o dia configurado).
  3. Multi-usuário e permissões no workspace (convite por e-mail, papéis dono/editor/leitor, respeitando RLS `is_workspace_member`).

## Mapa rápido do código
- Dados: `src/lib/data` (repositório Supabase + modo demo em memória).
- Meta: `src/lib/integrations/meta` (`sync.ts`, `creative-parse.ts` lê criativo dinâmico/Advantage+/post).
- Análises: `src/lib/analytics.ts`, `src/lib/decision`, `src/lib/creative/intelligence.ts` (veredictos), `src/lib/stats`.
- IA: `src/lib/ai/structured.ts` (saída estruturada Zod; aceita imagens), parecer em `src/lib/advisor`.
- Descobrir/Kits: `src/lib/discover/*`.
- Criativos: `src/lib/creative/*` (fila do Flow, plataformas, envio ao Storage, ciclo de aprendizado, `assertiveness.ts`, `campaign-ideas.ts`, `landing-snapshot.ts`).
- PDF: `src/lib/pdf/*` (blocos markdown → react-pdf, fontes em `src/lib/pdf/fonts`, prompts em `prompts.ts`).
- Banco: `supabase/setup_completo.sql` (todas as tabelas já existem; as Fases 3–4 não precisaram de migração).

## Pendências conhecidas / a verificar com o usuário
- Geração com IA nunca foi testada ao vivo (depende de `ANTHROPIC_API_KEY` na Vercel).
- Envio de arquivos ao Supabase Storage (buckets `criativos` e `pdfs`, criados pelo servidor) não testado em produção.
- Depois do deploy da análise de criativos, o usuário precisa clicar em Conexões → Sincronizar agora para puxar textos/vídeos no novo formato.
- API da Cakto (conciliação): token agora no formato da documentação; confirmar com o usuário se conectou.
