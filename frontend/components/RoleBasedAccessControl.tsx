/**
 * LocaleSwitcher Component
 * Allows users to change the application language
 */
'use client';

import React, { useId } from 'react';
import { useLocale } from '@/hooks/useI18n';
import { getAvailableLocales, type Locale } from '@/i18n';

interface LocaleSwitcherProps {
  className?: string;
  showLabel?: boolean;
  compact?: boolean;
}

export default function LocaleSwitcher({
  className = '',
  showLabel = true,
  compact = false,
}: LocaleSwitcherProps) {
  const { locale, setLocale } = useLocale();
  const locales = getAvailableLocales();
  const labelId = useId();

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {showLabel && (
        <span
          id={labelId}
          className={`text-xs font-medium text-neutral-400 ${
            compact ? 'hidden sm:block' : ''
          }`}
        >
          Language:
        </span>
      )}

      {compact ? (
        <LocaleDropdown
          locale={locale}
          locales={locales}
          onChange={setLocale}
          labelledBy={showLabel ? labelId : undefined}
        />
      ) : (
        <LocaleButtonGroup
          locale={locale}
          locales={locales}
          onChange={setLocale}
          labelledBy={showLabel ? labelId : undefined}
        />
      )}
    </div>
  );
}

type LocaleListProps = {
  locale: string;
  locales: ReturnType<typeof getAvailableLocales>;
  onChange: (code: Locale) => void;
  labelledBy?: string;
};

function LocaleDropdown({ locale, locales, onChange, labelledBy }: LocaleListProps) {
  return (
    <select
      value={locale}
      onChange={(e) => onChange(e.target.value as Locale)}
      aria-label={labelledBy ? undefined : 'Select language'}
      aria-labelledby={labelledBy}
      className="bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-sm text-neutral-200 hover:bg-neutral-700 transition-colors focus:ring-2 focus:ring-blue-500 outline-none cursor-pointer"
    >
      {locales.map((loc) => (
        <option key={loc.code} value={loc.code}>
          {loc.flag} {loc.nativeName}
        </option>
      ))}
    </select>
  );
}

function LocaleButtonGroup({ locale, locales, onChange, labelledBy }: LocaleListProps) {
  return (
    <div
      role="group"
      aria-label={labelledBy ? undefined : 'Select language'}
      aria-labelledby={labelledBy}
      className="flex items-center gap-1 bg-neutral-800/50 border border-neutral-700/50 rounded-lg p-1"
    >
      {locales.map((loc) => {
        const isActive = locale === loc.code;
        return (
          <button
            key={loc.code}
            type="button"
            onClick={() => onChange(loc.code)}
            aria-label={`Switch to ${loc.nativeName}`}
            aria-pressed={isActive}
            title={loc.nativeName}
            className={`px-2 py-1 rounded transition-all text-sm font-medium ${
              isActive
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
                : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-700/50'
            }`}
          >
            {loc.flag}
          </button>
        );
      })}
    </div>
  );
}
