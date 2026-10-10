import Link from "next/link";
import { env } from "@/lib/env";

export const metadata = { title: "Banco de dados não configurado" };

/**
 * Mostrada quando o projeto Supabase ligado ao app não tem as tabelas/funções
 * (SQL não rodado, rodado pela metade ou em OUTRO projeto). Sem segredos aqui:
 * só o identificador público do projeto e a mensagem do banco.
 */
export default async function ErroBanco({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const detail = typeof sp.m === "string" ? sp.m.slice(0, 300) : null;
  const ref = env.supabaseUrl.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1] ?? null;
  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-lg space-y-4 rounded-2xl border border-bad/30 bg-panel p-6 text-sm">
        <h1 className="text-lg font-semibold">O banco de dados ainda não está pronto</h1>
        <p className="text-muted">
          O app está ligado ao projeto Supabase {ref ? <b className="text-text">{ref}</b> : "configurado na Vercel"}, mas não encontrou as tabelas
          dele. Isso acontece quando o SQL de instalação não foi rodado, foi rodado pela metade ou foi rodado em outro projeto.
        </p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>
            No Supabase, abra o projeto <b>{ref ?? "que aparece na variável NEXT_PUBLIC_SUPABASE_URL"}</b> → <b>SQL Editor</b> → <b>New query</b>.
          </li>
          <li>
            Cole o conteúdo de <code>supabase/setup_completo.sql</code> (no GitHub do projeto, botão “Copy raw file”) e clique em <b>Run</b>. Pode
            rodar de novo sem problema.
          </li>
          <li>Volte aqui e recarregue a página.</li>
        </ol>
        {detail ? <p className="rounded-lg border border-border bg-bg/40 px-3 py-2 text-xs text-faint">Mensagem do banco: {detail}</p> : null}
        <Link href="/" className="inline-block text-primary hover:underline">
          Tentar de novo
        </Link>
      </div>
    </div>
  );
}
