/** The few strings shown before the UI's i18n is available (loading/error screen). */
const TEXT = {
  'pt-BR': {
    title: 'MERIDIANO — Comando Global',
    loading: 'Carregando dados do mundo…',
    indexing: 'Montando índices espaciais…',
    error: 'Falha ao iniciar',
    ready: 'Dados carregados',
  },
  en: {
    title: 'MERIDIANO — Global Command',
    loading: 'Loading world data…',
    indexing: 'Building spatial indices…',
    error: 'Startup failed',
    ready: 'Data loaded',
  },
} as const;

export type BootKey = keyof (typeof TEXT)['pt-BR'];

export function bootText(key: BootKey): string {
  const lang = typeof navigator !== 'undefined' && navigator.language && !navigator.language.startsWith('pt') ? 'en' : 'pt-BR';
  return TEXT[lang][key];
}
