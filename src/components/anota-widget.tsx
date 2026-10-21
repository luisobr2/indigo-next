"use client";

import { useEffect } from "react";
import Script from "next/script";
import { useQuery } from "@tanstack/react-query";
import type { AnotaConfig } from "@/app/api/anota/route";

/**
 * Team notes (Anota, 21-oct-2026). When it's on in Settings, every staff
 * screen loads the Anota widget: anyone on the team can point at something,
 * write a note and it lands in the Anota inbox with a screenshot. The name
 * on the note is the person signed in. Off (the default) loads nothing.
 */
export function AnotaWidget() {
  const q = useQuery<{ data: AnotaConfig }>({
    queryKey: ["anota"],
    queryFn: async () => {
      const r = await fetch("/api/anota");
      if (!r.ok) throw new Error("anota");
      return r.json();
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
  const cfg = q.data?.data;
  const on = !!cfg?.enabled && !!cfg.projectKey;

  // The widget remembers the reporter in localStorage: put who is signed in.
  useEffect(() => {
    if (!on || !cfg) return;
    try {
      window.localStorage.setItem("anota:reporter", JSON.stringify(cfg.reporter));
    } catch {
      // Without storage the widget asks for the name itself.
    }
  }, [on, cfg]);

  if (!on || !cfg) return null;
  return (
    <Script
      id="anota-widget"
      src={`${cfg.url}/w.js`}
      data-project={cfg.projectKey ?? ""}
      data-lang="en"
      strategy="afterInteractive"
    />
  );
}
