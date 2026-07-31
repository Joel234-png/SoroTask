"use client";

import { useEffect, useState } from "react";
import { getAvailableLocales, saveLocale, getStoredLocale, Locale } from "@/i18n/index";

export function LanguageSelector() {
  const [mounted, setMounted] = useState(false);
  const [currentLocale, setCurrentLocale] = useState<Locale>("en");
  const locales = getAvailableLocales();

  useEffect(() => {
    setCurrentLocale(getStoredLocale());
    setMounted(true);
  }, []);

  if (!mounted) {
    return null;
  }

  const handleLanguageChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const locale = event.target.value as Locale;
    saveLocale(locale);
    setCurrentLocale(locale);
    // Reload to apply the new language across the app (in a real setup with next-intl, 
    // you would use the router or update a global state context if dynamic).
    window.location.reload();
  };

  return (
    <div className="relative inline-block">
      <select
        value={currentLocale}
        onChange={handleLanguageChange}
        className="appearance-none bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 text-sm font-medium py-2 pl-3 pr-8 rounded-md border border-neutral-300 dark:border-neutral-700 hover:border-neutral-400 dark:hover:border-neutral-600 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
        aria-label="Select language"
      >
        {locales.map((locale) => (
          <option key={locale.code} value={locale.code}>
            {locale.flag} {locale.name}
          </option>
        ))}
      </select>
      <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-neutral-500 dark:text-neutral-400">
        <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
          <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" />
        </svg>
      </div>
    </div>
  );
}
