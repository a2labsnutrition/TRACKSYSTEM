"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select } from "@/components/ui/input";

/** Select que grava a escolha na URL (searchParams). */
export function ParamSelect({
  name,
  value,
  options,
  resetKeys = [],
  className,
}: {
  name: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  resetKeys?: string[];
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <Select
      className={className}
      value={value}
      onChange={(e) => {
        const p = new URLSearchParams(params.toString());
        if (e.target.value) p.set(name, e.target.value);
        else p.delete(name);
        for (const k of resetKeys) p.delete(k);
        router.push(`${pathname}?${p.toString()}`);
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </Select>
  );
}
