import type { Metadata } from 'next';
import '../globals.css';

export const metadata: Metadata = {
  title: 'CareShield Max - Buy health cover online',
  description:
    'Get a locked premium for CareShield Max health insurance in minutes, declare your health, and get covered instantly.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body className="min-h-dvh antialiased">
        {/* Keyboard users can jump straight past the header. */}
        <a
          href="#buy-journey"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:shadow-lg"
        >
          Skip to the application form
        </a>
        {children}
      </body>
    </html>
  );
}
