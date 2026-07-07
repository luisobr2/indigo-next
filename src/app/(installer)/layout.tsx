import { ReactNode } from "react";
import { ImpersonationBar } from "@/components/impersonation-bar";

export default function InstallerLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <ImpersonationBar />
      {children}
    </div>
  );
}
