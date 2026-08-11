import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Connexion — facture.gn" };

export default function LoginPage() {
  return (
    <div className="flex min-h-full flex-col">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-16 sm:px-6">
        <h1 className="mb-6 text-center font-display text-2xl font-bold text-navy-950">Connexion</h1>
        <LoginForm />
      </main>
    </div>
  );
}
