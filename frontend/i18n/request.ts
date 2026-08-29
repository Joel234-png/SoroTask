import {getRequestConfig} from 'next-intl/server';
import {getLocale} from 'next-intl/server';
import en from './translations/en.json';

export default getRequestConfig(async () => {
  const locale = (await getLocale()) || 'en';
  return {
    locale,
    messages: en,
  };
});
