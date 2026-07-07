import * as Sentry from "@sentry/nextjs";

const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    tracesSampleRate: 0.1,
    beforeSend(event, hint) {
      return filterSensitiveData(event as any) as any;
    },
  });
}

function filterSensitiveData(event: any): any {
  const sensitiveKeys = ["password", "token", "secret", "authorization", "cookie"];

  if (event.request?.headers_fields) {
    Object.keys(event.request.headers_fields).forEach((key) => {
      if (sensitiveKeys.some((sensitive) => key.toLowerCase().includes(sensitive))) {
        event.request.headers_fields[key] = "[Filtered]";
      }
    });
  }

  if (event.user) {
    const { ip, ...safeUser } = event.user;
    event.user = safeUser;
  }

  return event;
}
