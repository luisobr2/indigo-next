import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";
import { QueryProvider } from "./query-provider";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: "Indigo Decors — Production ERP",
  description: "Order management for Indigo Decors workshop",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={cn("h-full", "antialiased", "font-sans", geist.variable)}>
      <body className="min-h-full">
        <QueryProvider>{children}</QueryProvider>
        {/* Global toast outlet — sonner sits above modals (z-50 by default).
            Position bottom-right is less disruptive than top-center. */}
        <Toaster
          position="bottom-right"
          richColors
          closeButton
        />
      </body>
    </html>
  );
}
