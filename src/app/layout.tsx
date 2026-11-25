import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RemitSol · WhatsApp remittance on Solana",
  description:
    "Send money from South Africa to Nigeria over WhatsApp. USDC settles on Solana Devnet; NGN payout is simulated.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
