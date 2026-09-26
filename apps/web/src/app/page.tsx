import { BuyJourney } from '@/components/BuyJourney';

/**
 * Server Component shell. It renders the static chrome on the server and hands
 * the interactive wizard to the client, so the first paint needs no JS.
 */
export default function HomePage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-16">
      <header className="mb-10">
        <p className="text-sm font-semibold uppercase tracking-wider text-brand-600">
          Health insurance
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-ink sm:text-4xl">
          CareShield Max
        </h1>
        <p className="mt-3 max-w-prose text-base leading-relaxed text-muted">
          Comprehensive hospitalisation cover with cashless treatment at 10,000+ network hospitals.
          Get your premium, declare your health, and get covered - in one sitting.
        </p>
      </header>

      <BuyJourney />
    </main>
  );
}
