import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 text-center">
      <p className="text-lg font-semibold">Página não encontrada</p>
      <Link href="/" className="text-sm text-primary">Voltar para a visão geral</Link>
    </div>
  );
}
