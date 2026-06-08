import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tokio Machine",
  description: "Máquinas de entretenimento"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
