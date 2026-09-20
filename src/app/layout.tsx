import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/toast";
import { DisplayModeProbe } from "@/components/pwa/display-mode-probe";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Smile Motors",
    template: "%s · Smile Motors",
  },
  description: "Smile Motors — sistema de gestión del concesionario",
  applicationName: "Smile Motors",
  // Aplicación web instalable (ver `app/manifest.ts`): sin esto, el icono de
  // la pantalla de inicio del iPhone abre la app dentro de Safari.
  appleWebApp: {
    capable: true,
    title: "Smile Motors",
    // El contenido llega hasta arriba del todo; las cabeceras, el nav
    // inferior, los modales y los avisos ya reservan el área segura.
    statusBarStyle: "black-translucent",
  },
  other: {
    // Next emite el estándar `mobile-web-app-capable`, que Safari solo
    // entiende desde hace poco; las versiones anteriores de iOS necesitan
    // esta variante de Apple. No la duplica: Next ya no la genera.
    "apple-mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  themeColor: "#090909",
  colorScheme: "dark",
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es"
      className={`theme-dark ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-background text-foreground">
        {children}
        <Toaster />
        <DisplayModeProbe />
      </body>
    </html>
  );
}
