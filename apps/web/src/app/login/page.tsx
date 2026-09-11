import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Connexion — facture.gn" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const params = await searchParams;
  const returnTo = Array.isArray(params.returnTo) ? params.returnTo[0] : params.returnTo;

  return (
    <div className="flex min-h-full flex-col">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-16 sm:px-6">
        <h1 className="mb-6 text-center font-display text-2xl font-bold text-navy-950">Connexion</h1>
        <LoginForm returnTo={returnTo} />
      </main>
    </div>
  );
}
