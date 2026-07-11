import * as Sentry from "@sentry/nextjs";

const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    // Performance Monitoring
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

    // Session Replay (uncomment to enable)
    // replaysSessionSampleRate: 0.1,
    // replaysOnErrorSampleRate: 1.0,

    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],

    beforeSend(event, hint) {
      return filterSensitiveData(event as any) as any;
    },

    ignoreErrors: [
      "top.GLOBALS",
      "iframe.*",
      "Non-Error promise rejection captured",
      "chrome-extension://*",
      "Warning:.*",
    ],

    debug: process.env.NODE_ENV === "development" && process.env.SENTRY_DEBUG === "true",
  });
}

function filterSensitiveData(event: any): any {
  const sensitiveKeys = [
    "password",
    "token",
    "secret",
    "authorization",
    "cookie",
    "x-csrf-token",
    "x-xsrf-token",
    "credit_card",
    "cvv",
    "ssn",
    "social_security",
  ];

  if (event.request?.headers_fields) {
    Object.keys(event.request.headers_fields).forEach((key) => {
      if (sensitiveKeys.some((sensitive) => key.toLowerCase().includes(sensitive))) {
        event.request.headers_fields[key] = "[Filtered]";
      }
    });
  }

  if (event.extra) {
    Object.keys(event.extra).forEach((key) => {
      if (sensitiveKeys.some((sensitive) => key.toLowerCase().includes(sensitive))) {
        event.extra[key] = "[Filtered]";
      }
    });
  }

  if (event.user) {
    const { ip, email, username, ...safeUser } = event.user;
    event.user = safeUser;
  }

  return event;
}
