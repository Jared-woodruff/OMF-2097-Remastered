// The languages the game speaks, and which of them a player's system prefers.

export type LangCode = 'en' | 'de' | 'ja' | 'zh' | 'ko' | 'hi' | 'bn' | 'es' | 'pt' | 'fr' | 'ar' | 'ru' | 'da' | 'sv';

/** The writing system of a language's texts (the original fonts only have the Latin letters). */
export type Script = 'latin' | 'cyrillic' | 'han' | 'hangul' | 'devanagari' | 'bengali' | 'arabic';

export interface Language {
  code: LangCode;
  /** Its name in English. */
  english: string;
  /** Its name in itself, as the language menu lists it. */
  native: string;
  script: Script;
  /** Written right to left. */
  rtl?: boolean;
}

/** In the language menu's order: the Latin alphabet's languages, then the others. */
export const LANGUAGES: readonly Language[] = [
  { code: 'da', english: 'Danish', native: 'Dansk', script: 'latin' },
  { code: 'de', english: 'German', native: 'Deutsch', script: 'latin' },
  { code: 'en', english: 'English', native: 'English', script: 'latin' },
  { code: 'es', english: 'Spanish', native: 'Español', script: 'latin' },
  { code: 'fr', english: 'French', native: 'Français', script: 'latin' },
  { code: 'pt', english: 'Portuguese', native: 'Português', script: 'latin' },
  { code: 'sv', english: 'Swedish', native: 'Svenska', script: 'latin' },
  { code: 'ru', english: 'Russian', native: 'Русский', script: 'cyrillic' },
  { code: 'ar', english: 'Arabic', native: 'العربية', script: 'arabic', rtl: true },
  { code: 'hi', english: 'Hindi', native: 'हिन्दी', script: 'devanagari' },
  { code: 'bn', english: 'Bengali', native: 'বাংলা', script: 'bengali' },
  { code: 'zh', english: 'Chinese', native: '简体中文', script: 'han' },
  { code: 'ja', english: 'Japanese', native: '日本語', script: 'han' },
  { code: 'ko', english: 'Korean', native: '한국어', script: 'hangul' },
];

const BY_CODE = new Map(LANGUAGES.map((l) => [l.code, l]));

export function languageInfo(code: LangCode): Language {
  return BY_CODE.get(code)!;
}

export function isLangCode(s: unknown): s is LangCode {
  return typeof s === 'string' && BY_CODE.has(s as LangCode);
}

/**
 * The first of a system's preferred languages (BCP 47 tags, most preferred first: "pt-BR", "zh-Hans-CN", "de") that
 * the game speaks, else English. Any variety counts: "es-MX" is Spanish, "zh-TW" Chinese.
 */
export function pickLanguage(preferred: readonly string[]): LangCode {
  for (const tag of preferred) {
    const primary = tag.trim().toLowerCase().split(/[-_]/)[0];
    if (isLangCode(primary)) return primary;
  }
  return 'en';
}
