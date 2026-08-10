"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function CertificationLookupForm() {
  const router = useRouter();
  const [value, setValue] = useState("");

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = value.trim();
    if (trimmed) {
      router.push(`/${encodeURIComponent(trimmed)}`);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row">
      <input
        type="text"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="GN-XXXXXXXX-2026-XXXXXX"
        className="flex-1 rounded-xl border border-ink-300 bg-white px-4 py-3 font-mono text-sm text-ink-950 placeholder:text-ink-300 focus:border-trust-500 focus:ring-2 focus:ring-trust-500/20 focus:outline-none"
        aria-label="Identifiant de vérification"
      />
      <button
        type="submit"
        className="rounded-xl bg-trust-700 px-6 py-3 text-sm font-semibold text-white transition hover:bg-trust-600"
      >
        Vérifier
      </button>
    </form>
  );
}
