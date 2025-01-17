import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'EIP-7702 Wallet Demo',
  description: 'A simple demo for creating and upgrading EOA wallets using EIP-7702',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="bg-background dark">
        {children}
      </body>
    </html>
  );
}
