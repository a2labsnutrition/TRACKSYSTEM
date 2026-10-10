import { miniMarkdown } from "@/lib/discover/landing-html";
import { BUY_BUTTON } from "@/lib/discover/markdown";
import { cn } from "@/lib/utils";

/** Exibe markdown simples. O HTML sai de miniMarkdown, que escapa todo o texto. */
export function Markdown({ text, className }: { text: string; className?: string }) {
  const html = miniMarkdown(text, { cta: `<p class="cta-wrap"><span class="cta">${BUY_BUTTON.slice(1, -1)}</span></p>` });
  return <div className={cn("md", className)} dangerouslySetInnerHTML={{ __html: html }} />;
}
