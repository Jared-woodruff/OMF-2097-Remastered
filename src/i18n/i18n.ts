// The language the game speaks: the player's choice (settings.language), or by default the first language of their
// system the game has (the browser's languages on the web, Windows' display languages in the desktop app).
//
// Two kinds of text are translated:
// - The original game's texts (its language file, 1013 of them: menus, help, the news, the pilots' words...). English
//   and German are the game's own files (ENGLISH.DAT, GERMAN.DAT); the other languages are public/lang/<code>.json,
//   arrays of the same 1013 texts (an empty one falls back to English).
// - The remaster's own texts, written in English in the code as tr('ONE PLAYER GAME'), tr('{name} WINS', { name }).
//   public/lang/ui/<code>.json has each language's translations by their English text (tools/i18n.mjs lists them and
//   checks the files); a text without a translation stays English.
import { languageInfo, pickLanguage, isLangCode, type LangCode, type Language } from './languages';

/** A text in a language's plural forms (Intl.PluralRules categories: one, few, many, other...). */
export type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };

export type Catalogue = Record<string, string | PluralForms>;

export type Params = Record<string, string | number>;

let current: LangCode = 'en';
let catalogue: Catalogue = {};
let trnCatalogue: Record<string, string> = {};
let plurals: Intl.PluralRules | null = null;
const listeners = new Set<(code: LangCode) => void>();

/** The language the game speaks now. */
export function lang(): LangCode {
  return current;
}

export function langInfo(): Language {
  return languageInfo(current);
}

function fill(text: string, params?: Params): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
}

/**
 * A key's context: 'key|DELETE' is the text DELETE as a key's name, translated apart from the menu entry DELETE (the
 * English shows without it).
 */
const CONTEXT = /^[a-z]+\|/;

/**
 * A remaster text in the game's language: its translation (else the English), with its {placeholders} filled in.
 * The English text is the key: tools/i18n.mjs finds every tr('...') in the code. A key may start with a context
 * ('key|DELETE', 'clip|START') where one English word has to read differently in some places.
 */
export function tr(english: string, params?: Params): string {
  const t = catalogue[english];
  if (t === undefined) return fill(english.replace(CONTEXT, ''), params);
  if (typeof t === 'string') return fill(t, params);
  const n = Number(params?.n ?? 0);
  return fill(t[plurals?.select(n) ?? 'other'] ?? t.other, params);
}

/** A text with a number in it, by the number's plural form: trn(n, '{n} WIN', '{n} WINS') (the key: the second). */
export function trn(n: number, one: string, other: string, params?: Params): string {
  const p = { ...params, n };
  const t = catalogue[other];
  if (t === undefined) return fill((n === 1 ? one : other).replace(CONTEXT, ''), p);
  return tr(other, p);
}

/**
 * A text of the original tournaments (a description, an ending page, a pilot's words) in the game's language: the
 * file's own German in German, else its translation (public/lang/trn/<code>.json, by the English), else the English.
 */
export function trnText(english: string, german?: string): string {
  if (current === 'de' && german) return german;
  return trnCatalogue[english] ?? english;
}

let graphemes: Intl.Segmenter | null | undefined;

/**
 * A text cut to its first `n` letters (grapheme clusters: a Hindi or Bengali letter with its vowel signs is one, it is
 * never cut apart). English and the other texts of single code units are cut as slice() would.
 */
export function clip(s: string, n: number): string {
  if (s.length <= n) return s;
  if (!/[^\u0000-\u02ff]/.test(s)) return s.slice(0, n);
  graphemes ??= typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
  const parts = graphemes ? [...graphemes.segment(s)].map((g) => g.segment) : [...s];
  return parts.length <= n ? s : parts.slice(0, n).join('');
}

/** Marks an English text for translation without translating it yet (tables made before the language is known). */
export function trKey(english: string): string {
  return english;
}

/** Calls back after each change of language (menus rebuild, pages redraw). Returns the unsubscribe. */
export function onLanguageChange(cb: (code: LangCode) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** The system's languages, most preferred first: the desktop app asks Windows; browsers know their own. */
export async function systemLanguages(): Promise<string[]> {
  const out: string[] = [];
  const tauri = typeof window === 'undefined' ? undefined
    : (window as Window & { __TAURI__?: { core?: { invoke<T>(cmd: string): Promise<T> } } }).__TAURI__;
  if (tauri?.core) {
    try {
      out.push(...(await tauri.core.invoke<string[]>('os_languages')));
    } catch {
      /* an older desktop app: the browser's languages (WebView2 takes Windows') */
    }
  }
  if (typeof navigator !== 'undefined') out.push(...(navigator.languages?.length ? navigator.languages : [navigator.language ?? '']));
  return out.filter(Boolean);
}

let systemPick: LangCode | null = null;

/** The language a setting means ('auto': the system's). */
export function resolveLanguage(setting: string, system: readonly string[] = []): LangCode {
  if (isLangCode(setting)) return setting;
  systemPick ??= pickLanguage(system);
  return systemPick;
}

/** The language the system prefers (known once initLanguage ran; English before). */
export function systemLanguage(): LangCode {
  return systemPick ?? 'en';
}

type Fetcher = (path: string) => Promise<unknown>;

let fetchJson: Fetcher = async (path) => {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
};

/** Where the language files come from (tests read them from the disk). */
export function setLanguageFetcher(f: Fetcher): void {
  fetchJson = f;
}

/** A language's files: its remaster texts, the original game's texts (null: the game's own file), its tournaments'. */
export interface LanguageData {
  ui: Catalogue;
  original: string[] | null;
  /** The original tournaments' texts (descriptions, endings, the pilots' words) by their English. */
  trn?: Record<string, string>;
}

const loaded = new Map<LangCode, LanguageData>();

/** Loads a language's files (once; English needs none). A file that cannot be had leaves those texts in English. */
export async function loadLanguageData(code: LangCode): Promise<LanguageData> {
  const have = loaded.get(code);
  if (have) return have;
  const data: LanguageData = { ui: {}, original: null };
  if (code !== 'en') {
    const [ui, original, trn] = await Promise.all([
      fetchJson(`lang/ui/${code}.json`).catch(() => null),
      code === 'de' ? null : fetchJson(`lang/${code}.json`).catch(() => null),
      code === 'de' ? null : fetchJson(`lang/trn/${code}.json`).catch(() => null),
    ]);
    if (ui && typeof ui === 'object' && !Array.isArray(ui)) data.ui = ui as Catalogue;
    if (Array.isArray(original)) data.original = original.map((s) => (typeof s === 'string' ? s : ''));
    if (trn && typeof trn === 'object' && !Array.isArray(trn)) data.trn = trn as Record<string, string>;
  }
  loaded.set(code, data);
  return data;
}

/** What else changes with the language: the original game's texts (resources.ts), set from main.ts. */
let applyOriginal: (code: LangCode, original: string[] | null) => void = () => undefined;

/** Sets how the original texts are put in place (once the game's files are there), and puts them in place. */
export function setOriginalTextsLoader(f: (code: LangCode, original: string[] | null) => void): void {
  applyOriginal = f;
  f(current, loaded.get(current)?.original ?? null);
}

/** Speaks a language from now on (its files loaded), and tells the listeners. */
export function useLanguage(code: LangCode, data: LanguageData): void {
  current = code;
  catalogue = data.ui;
  trnCatalogue = data.trn ?? {};
  plurals = typeof Intl !== 'undefined' && Intl.PluralRules ? new Intl.PluralRules(code) : null;
  applyOriginal(code, data.original);
  // (the page's own texts: its language picks the right letter forms, Japanese or Chinese)
  if (typeof document !== 'undefined') document.documentElement.lang = code;
  for (const cb of [...listeners]) cb(code);
}

/** Speaks the language a setting means ('auto' or a code), once its files are loaded. */
export async function setLanguage(setting: string): Promise<LangCode> {
  const code = resolveLanguage(setting, await systemLanguages());
  useLanguage(code, await loadLanguageData(code));
  return code;
}
