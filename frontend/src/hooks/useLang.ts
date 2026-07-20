import { useCallback, useMemo, useState } from 'react';
import { detectLang, t, type Lang, type TranslationKey } from '../lib/i18n';
import { setLang as persistLang } from '../lib/storage';

export function useLang() {
  const [lang, setLangState] = useState<Lang>(() => detectLang());

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    persistLang(l);
  }, []);

  const toggleLang = useCallback(() => {
    setLang(lang === 'id' ? 'en' : 'id');
  }, [lang, setLang]);

  const tr = useCallback((key: TranslationKey) => t(lang, key), [lang]);

  return useMemo(() => ({ lang, setLang, toggleLang, t: tr }), [lang, setLang, toggleLang, tr]);
}
