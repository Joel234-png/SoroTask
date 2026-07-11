"use client";

import TaskCreationForm from "@/app/components/TaskCreationForm";
import { WalletButton } from "@/app/components/WalletButton";
import { WalletGate } from "@/app/components/WalletGate";
import { WalletProvider } from "@/app/context/WalletContext";

export default function CreateTaskPage() {
  return (
    <WalletProvider>
      <main className="min-h-screen bg-neutral-950 px-6 py-8 text-neutral-100">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
          <header className="flex flex-col gap-4 border-b border-neutral-800 pb-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-3xl font-bold">Create Automation Task</h1>
              <p className="mt-2 text-sm text-neutral-400">
                Connect a wallet, then register a recurring Soroban task.
              </p>
            </div>
            <WalletButton />
          </header>

          <section className="rounded-xl border border-neutral-800 bg-neutral-900/70 p-6">
            <WalletGate message="Connect your Freighter wallet to create a task.">
              <TaskCreationForm />
            </WalletGate>
          </section>
        </div>
      </main>
    </WalletProvider>
  );
}
