"use client";

import { AuthProvider } from "@/context/AuthContext";
import { RbacSettingsPanel } from "@/src/components/RbacSettingsPanel";
import { RbacUiEngineProvider } from "@/src/lib/rbac/RbacUiEngineProvider";

export default function RbacSettingsPage() {
  return (
    <AuthProvider>
      <div className="min-h-screen bg-neutral-900 text-neutral-100 px-6 py-10">
        <div className="mx-auto max-w-5xl">
          <RbacUiEngineProvider>
            <RbacSettingsPanel />
          </RbacUiEngineProvider>
        </div>
      </div>
    </AuthProvider>
  );
}
