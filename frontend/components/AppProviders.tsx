'use client';

import React from 'react';
import { Toaster } from 'sonner';

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <Toaster
        position="bottom-right"
        theme="dark"
        closeButton
        richColors
        toastOptions={{
          style: {
            background: '#1e293b',
            borderColor: '#334155',
            color: '#f8fafc',
          },
        }}
      />
    </>
  );
}