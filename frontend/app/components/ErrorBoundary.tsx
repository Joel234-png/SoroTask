"use client";

import { Component, type ReactNode } from "react";
import * as Sentry from "@sentry/nextjs";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  section?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    const { section } = this.props;

    // Log to console for local debugging
    console.error("[ErrorBoundary]", {
      section: section ?? "unknown",
      message: error.message,
      componentStack: info.componentStack,
    });

    // Report to Sentry with context
    Sentry.captureException(error, {
      tags: {
        section: section ?? "unknown",
        component: "ErrorBoundary",
      },
      extra: {
        componentStack: info.componentStack,
        section: section ?? "unknown",
      },
    });
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    const { children, fallback } = this.props;

    if (!error) return children;

    if (fallback) return fallback;

    return (
      <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-6 text-sm text-red-400 space-y-3">
        <p className="font-medium">Something went wrong in this section.</p>
        <p className="text-neutral-500 text-xs font-mono">{error.message}</p>
        <button
          onClick={this.reset}
          className="text-xs px-3 py-1.5 rounded-md bg-neutral-800 hover:bg-neutral-700 text-neutral-300 transition-colors"
        >
          Try again
        </button>
      </div>
    );
  }
}
