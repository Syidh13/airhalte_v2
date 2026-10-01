import type { Metadata } from "next";
import { Inter, Fraunces } from "next/font/google";
import "./globals.css";
// Stylesheet per fitur (diimpor SETELAH globals.css supaya bisa menimpa):
import "@/styles/brand.css";
import "@/styles/map.css";
import "@/styles/commerce.css";
import "@/styles/portal.css";
import AuthBootstrap from "@/components/AuthBootstrap";
import FavoriteToaster from "@/components/FavoriteToaster";
import { NETWORK_TOTAL, fmtCount } from "@/lib/network";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
  weight: ["400", "500", "600", "700", "800"],
});

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
  style: ["normal", "italic"],
  axes: ["opsz"],
});

export const metadata: Metadata = {
  title: "AirHalte — by Transjakarta · Peta Penamaan Halte Jakarta",
  description: `Marketplace penamaan resmi ${fmtCount(NETWORK_TOTAL)} titik Transjakarta: peta interaktif, lelang, dan langganan.`,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="id"
      className={`${inter.variable} ${fraunces.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/*
          Apply the persisted theme BEFORE first paint so the page never
          flashes light-then-dark. Read from localStorage and set the `dark`
          class on <html> synchronously. Wrapped in try/catch because
          private-browsing storage access can throw.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('airhalte_theme')||'light';if(t==='dark'){document.documentElement.classList.add('dark');}}catch(e){}})();`,
          }}
        />
      </head>
      <body suppressHydrationWarning>
        <AuthBootstrap />
        {children}
        <FavoriteToaster />
      </body>
    </html>
  );
}
