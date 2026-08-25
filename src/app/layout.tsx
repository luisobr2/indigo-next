import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";
import { QueryProvider } from "./query-provider";
import { ThemeProvider } from "next-themes";
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
        // suppressHydrationWarning es obligatorio: next-themes escribe la clase
    // del tema en <html> antes de que React hidrate, asi que el servidor y el
    // cliente NUNCA coinciden en ese atributo. Sin esto, React avisa en cada
    // carga.
    <html
      lang="en"
      suppressHydrationWarning
      className={cn("h-full", "antialiased", "font-sans", geist.variable)}
    >
      <body className="min-h-full">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <QueryProvider>{children}</QueryProvider>
        </ThemeProvider>
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
