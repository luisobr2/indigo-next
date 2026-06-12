"use client";

import dynamic from "next/dynamic";

// three.js touches WebGL/window at module scope — keep it client-only.
const DoorCustomizer = dynamic(
  () => import("@/components/door-customizer"),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[60vh] items-center justify-center text-sm text-muted-foreground">
        Loading 3D viewer…
      </div>
    ),
  }
);

export default function CustomizerPage() {
  return <DoorCustomizer />;
}
