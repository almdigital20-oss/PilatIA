import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "./redesign.css";
import "./enterprise.css";
import "./auth.css";
import "./profile.css";
import "./operations.css";
import "./accessibility.css";
import "./ai-settings.css";
import "./business-segments.css";
import "./tutorials.css";
import "./mobile-fixes.css";
import "./operations-enhancements.css";
import "./pilatia-design-system.css";
import "./pilatia-shell-v2.css";
import "./pilatia-dashboard-v2.css";
import "./pilatia-crm-v2.css";
import "./pilatia-chat-v2.css";
import "./pilatia-secondary-v2.css";
import "./staging.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "PilatIA — Pré-atendimento inteligente",
  description: "Atendimento inteligente que qualifica e prepara seus leads pelo WhatsApp.",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body></html>;
}
