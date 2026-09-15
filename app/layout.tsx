import type { Metadata } from "next";
import { Toaster } from "sonner";
import "./globals.css";

const appName = process.env.NEXT_PUBLIC_APP_NAME || "PharmaPOS";

export const metadata: Metadata = {
  title: appName,
  description: "Aplikasi POS apotek multi-cabang dan multi-user.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id">
      <body>
        {children}
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
