// The remaster's own texts in every language (src/i18n): lists the texts the code marks for translation, and checks
// the translations (public/lang/ui/<code>.json).
//
//   node tools/i18n.mjs keys [file]       every text the game shows (tr, trn, trKey in src/), as JSON: key -> where
//   node tools/i18n.mjs check [code...]   each language's translations: missing and stale texts, placeholders that
//                                         differ, plural forms (exit code 1 on an error)
//   node tools/i18n.mjs todo <code> [file] the texts a language does not translate yet, as JSON (for translators)
//
// A key is the English text itself; a plural text (trn(n, one, other)) is keyed by its plural form and translated as
// an object of the language's plural categories ({ "one": "...", "other": "..." }, Intl.PluralRules). OMF Studio
// (src/studio) is not translated.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'package.json'));
// (a file URL: Windows paths are not URLs to import())
const { parseAst } = await import(pathToFileURL(require.resolve('rolldown/parseAst')).href);
const UI_DIR = path.join(ROOT, 'public/lang/ui');
const CODES = ['de', 'ja', 'zh', 'ko', 'hi', 'bn', 'es', 'pt', 'fr', 'ar', 'ru', 'da', 'sv'];

function sources() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!['studio', 'test', 'dev'].includes(e.name)) walk(p);
      } else if (p.endsWith('.ts') && !p.endsWith('.test.ts') && !p.endsWith('.d.ts')) {
        out.push(p);
      }
    }
  };
  walk(path.join(ROOT, 'src'));
  return out;
}

const strOf = (n) => {
  if (!n) return null;
  if (n.type === 'Literal' && typeof n.value === 'string') return n.value;
  if (n.type === 'TemplateLiteral' && n.expressions.length === 0) return n.quasis[0].value.cooked;
  return null;
};

/** key -> { files: Set, one?: string } */
export function collectKeys() {
  const keys = new Map();
  const add = (key, where, one) => {
    let k = keys.get(key);
    if (!k) keys.set(key, (k = { files: new Set() }));
    k.files.add(where);
    if (one !== undefined) k.one = one;
  };
  for (const file of sources()) {
    const src = fs.readFileSync(file, 'utf8');
    if (!/\b(tr|trn|trKey)\(/.test(src)) continue;
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    const visit = (n) => {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) return n.forEach(visit);
      if (n.type === 'CallExpression' && n.callee.type === 'Identifier') {
        const name = n.callee.name;
        const line = src.slice(0, n.start).split('\n').length;
        if (name === 'tr' || name === 'trKey') {
          const key = strOf(n.arguments[0]);
          if (key !== null) add(key, `${rel}:${line}`);
        } else if (name === 'trn') {
          const one = strOf(n.arguments[1]), other = strOf(n.arguments[2]);
          if (other !== null) add(other, `${rel}:${line}`, one ?? undefined);
        }
      }
      for (const k of Object.keys(n)) if (k !== 'start' && k !== 'end') visit(n[k]);
    };
    visit(parseAst(src, { lang: 'ts' }, file));
  }
  return keys;
}

const placeholders = (s) => [...new Set(s.match(/\{\w+\}/g) ?? [])].sort().join(' ');

function load(code) {
  const file = path.join(UI_DIR, `${code}.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

/** Problems of a language's translations: { errors, missing, stale }. */
export function checkLanguage(code, keys = collectKeys()) {
  const t = load(code) ?? {};
  const errors = [];
  const missing = [];
  const rules = new Intl.PluralRules(code).resolvedOptions().pluralCategories;
  for (const [key, info] of keys) {
    const v = t[key];
    if (v === undefined) {
      missing.push(key);
      continue;
    }
    const want = placeholders(key);
    if (info.one !== undefined) {
      if (typeof v !== 'object' || v === null || typeof v.other !== 'string') {
        errors.push(`${key}: a plural text needs an object of plural forms (${rules.join(', ')})`);
        continue;
      }
      for (const [cat, s] of Object.entries(v)) {
        if (!rules.includes(cat)) errors.push(`${key}: "${cat}" is not a plural form of ${code} (${rules.join(', ')})`);
        // (the one form may leave the number out: "un combat")
        const have = placeholders(s);
        if (have !== want && !(cat !== 'other' && have === want.replace(/\{n\}/, '').trim())) errors.push(`${key} [${cat}]: placeholders ${have || '-'} (should be ${want || '-'})`);
      }
    } else if (typeof v !== 'string') {
      errors.push(`${key}: should be a text`);
    } else if (placeholders(v) !== want) {
      errors.push(`${key}: placeholders ${placeholders(v) || '-'} (should be ${want || '-'})`);
    }
  }
  const stale = Object.keys(t).filter((k) => !keys.has(k));
  return { errors, missing, stale };
}

const [cmd, ...args] = process.argv.slice(2);
const cli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (!cli) {
  // (imported: the tests use collectKeys and checkLanguage)
} else if (cmd === 'keys') {
  const keys = collectKeys();
  const out = {};
  for (const [k, v] of [...keys].sort((a, b) => a[0].localeCompare(b[0]))) out[k] = { where: [...v.files].sort(), ...(v.one !== undefined ? { one: v.one } : {}) };
  const json = JSON.stringify(out, null, 2);
  if (args[0]) fs.writeFileSync(args[0], json + '\n');
  else console.log(json);
  console.error(`${keys.size} texts`);
} else if (cmd === 'check') {
  const keys = collectKeys();
  let failed = false;
  for (const code of args.length ? args : CODES) {
    const { errors, missing, stale } = checkLanguage(code, keys);
    console.log(`${code}: ${keys.size - missing.length}/${keys.size} translated, ${errors.length} errors, ${stale.length} stale`);
    for (const e of errors) console.log(`  ERROR ${e}`);
    if (args.length) for (const s of stale) console.log(`  stale: ${s}`);
    if (errors.length) failed = true;
  }
  process.exit(failed ? 1 : 0);
} else if (cmd === 'todo') {
  const [code, file] = args;
  const keys = collectKeys();
  const { missing } = checkLanguage(code, keys);
  const out = {};
  for (const k of missing) out[k] = keys.get(k).one !== undefined ? { one: keys.get(k).one, other: k } : k;
  const json = JSON.stringify(out, null, 2);
  if (file) fs.writeFileSync(file, json + '\n');
  else console.log(json);
  console.error(`${missing.length} texts to translate`);
} else {
  console.log('usage: node tools/i18n.mjs keys [file] | check [code...] | todo <code> [file]');
}
