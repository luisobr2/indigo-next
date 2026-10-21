import { ReactNode } from "react";
import { ImpersonationBar } from "@/components/impersonation-bar";
import { AnotaWidget } from "@/components/anota-widget";

export default function InstallerLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <ImpersonationBar />
      {children}
      <AnotaWidget />
    </div>
  );
}
