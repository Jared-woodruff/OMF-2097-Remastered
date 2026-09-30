// The GitHub pages' pictures, in the game's look (docs/media): the README's hero, buttons, navigation, section
// banners, feature icons and footer, the docs' headers, the repository's social preview, and pictures of the game in
// the menus' frames (the arenas, the new robots and arenas, the manual) when footage of it is there (.captures/readme2). Each is HTML in the
// style of the game's menus (the blue grid panels in their bright blue frames, the menus' green and gold Orbitron, the
// painted main menu), shot at twice its size by Microsoft Edge in headless mode (Windows); GIF frames are decoded in
// the page. `npm run github` makes them all; `npm run github -- hero banner-features` only those (file names without
// their extension); `-- --html` writes the page only (tools/github/.build/media.html, to look at in a browser).
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const WORK = path.join(os.tmpdir(), 'omf-github');
const EDGE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find((p) => fs.existsSync(p));
const args = process.argv.slice(2);
const htmlOnly = args.includes('--html');
/** `--out <folder>`: the pictures go there instead of docs/media (to compare them first). */
const outAt = args.indexOf('--out');
const OUT_DIR = outAt >= 0 ? path.resolve(args[outAt + 1]) : null;
const only = new Set(args.filter((a, i) => !a.startsWith('--') && (outAt < 0 || i !== outAt + 1)));

// ---- what the pages show --------------------------------------------------------------------------------------

/** The README's sections: their banners (docs/media/banner-<key>.jpg) and navigation buttons (nav-<key>.png). */
const SECTIONS = [
  { key: 'features', anchor: 'features', nav: 'Features', title: 'The classic, rebuilt',
    line: 'Every robot, arena, mode and quirk of the 1994 original, ported faithfully',
    pic: { gif: 'docs/media/fx-desert.gif', frame: 4, pos: '50% 72%' } },
  { key: 'modes', anchor: 'classic-remastered', nav: 'Classic / Remastered', title: 'Classic / Remastered',
    line: 'Pixel-exact VGA or HD at any resolution: F2 switches between them at any moment',
    pic: { gif: 'docs/media/classic-vs-remastered.gif', frame: 30, pos: '50% 40%' } },
  { key: 'effects', anchor: 'effects', nav: 'Effects', title: 'Fight effects',
    line: 'Sparks, light, shockwaves and arena ambience, purely visual: fights play out the same',
    pic: { gif: 'docs/media/fx-knockout.gif', frame: 14, pos: '60% 94%', zoom: 1.3 } },
  { key: 'gameplay', anchor: 'gameplay', nav: 'Gameplay', title: 'Gameplay additions',
    line: 'A training lab, replays, new modes, a robot workshop and custom tournaments', pic: { src: 'docs/media/lab-frames.jpg', pos: '50% 30%' } },
  { key: 'mods', anchor: 'mods', nav: 'Mods & Studio', title: 'Mods & OMF Studio',
    line: 'Four new robots and four arenas come as a mod: play them, then take them apart in OMF Studio',
    pic: { src: 'docs/media/studio-mod.jpg', pos: '52% 60%', zoom: 1.8 } },
  { key: 'screens', anchor: 'screens', nav: 'Screens', title: 'Every screen, every mode',
    line: 'Tournament, one and two players, demo, scoreboard, intro and endings', pic: { src: 'docs/media/screen-vs.jpg', pos: '50% 20%' } },
  { key: 'artwork', anchor: 'artwork', nav: 'HD artwork', title: 'HD artwork pipeline',
    line: '3,229 images remastered by an image model and mapped through the live palette',
    pic: { gif: 'docs/media/select.gif', frame: 30, pos: '50% 88%' } },
  { key: 'start', anchor: 'get-started', nav: 'Get started', title: 'Get started',
    line: 'Download the free Windows app, or build it and the web version yourself', pic: { menu: true } },
  { key: 'tech', anchor: 'under-the-hood', nav: 'Under the hood', title: 'Under the hood',
    line: 'TypeScript, WebGL2, Web Audio and Tauri, tested headlessly against the original data',
    pic: { src: 'public/hd/scene-ARENA2/wide_1.webp', pos: '50% 62%' } },
  { key: 'credits', anchor: 'credits', nav: 'Credits', title: 'Credits & legal',
    line: 'Diversions Entertainment, Epic MegaGames, the OpenOMF project and friends', pic: { src: 'docs/media/credits-hero.jpg', pos: '50% 38%' } },
];

/** The README's big buttons (docs/media/btn-<key>.png): the ways in. */
const BUTTONS = [
  { key: 'download', kind: 'go', icon: 'download', label: 'Download', sub: 'Free, for Windows' },
  { key: 'trailer', kind: 'menu', icon: 'play', label: 'Trailer', sub: 'Two minutes, sound on' },
  { key: 'manual', kind: 'menu', icon: 'book', label: 'Manual', sub: '32 pages, PDF' },
  { key: 'modding', kind: 'menu', icon: 'robot', label: 'Modding', sub: 'Mods and OMF Studio' },
];

/** The three things the remaster is (the README's first table): their icons (docs/media/icon-<key>.png). */
const PILLARS = ['faithful', 'remastered', 'modern'];

/** The docs' headers (docs/media/doc-<key>.jpg). */
const DOCS = [
  { key: 'modding', title: 'Mods and OMF Studio', line: 'Robots, arenas and pilots in the game\'s own formats, pixel for pixel', pic: { src: 'docs/media/studio.jpg', pos: '12% 8%', zoom: 1.2 } },
  { key: 'building', title: 'Building', line: 'The web version, the Windows app, the HD artwork and the remaster\'s own content', pic: { menu: true } },
  { key: 'architecture', title: 'Architecture', line: 'How the code is organized, and how the C reference maps to it', pic: { src: 'docs/media/lab-frames.jpg', pos: '8% 40%', zoom: 1.9 } },
  { key: 'contributing', title: 'Contributing', line: 'How to work on the remaster: tests, conventions, what belongs in the repository', pic: { src: 'docs/media/workshop.jpg', pos: '50% 30%' } },
  { key: 'notice', title: 'Notice', line: 'The game\'s freeware terms, the remastered artwork and the licenses', pic: { src: 'docs/media/credits-hero.jpg', pos: '50% 38%' } },
];

/** Line icons (24 x 24, stroked like OMF Studio's). */
const ICONS = {
  download: '<path d="M12 3.5v11M7.5 10l4.5 4.5 4.5-4.5M4 15.5v3A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5v-3"/>',
  play: '<path d="M7 4.5v15l13-7.5z" fill="currentColor" stroke="none"/>',
  book: '<path d="M12 6.5C10 5 7 4.5 3.5 5v13c3.5-.5 6.5 0 8.5 1.5 2-1.5 5-2 8.5-1.5V5C17 4.5 14 5 12 6.5zM12 6.5v13"/>',
  robot: '<path d="M8.5 3h7v5.5h-7zM10.6 5.7h.1M13.3 5.7h.1M12 8.5v2M6 10.5h12v7H6zM8.5 17.5V21M15.5 17.5V21M3.5 11.5v4.5M20.5 11.5v4.5"/>',
  faithful: '<path d="M4.5 3.5h12l3 3v14h-15zM8 3.5v5h7v-5M13 5v2M7.5 20.5v-6h9v6"/>',
  remastered: '<path d="M3 4.5h18v12H3zM8.5 20h7M12 16.5V20"/><path d="M7 8v5M7 10.5h3M10 8v5M13 8h1.5a2.5 2.5 0 0 1 0 5H13z"/>',
  modern: '<path d="M7.5 8h9a4.5 4.5 0 0 1 4.3 3.2l1 3.6a2.5 2.5 0 0 1-4.3 2.3L16 15H8l-1.5 2.1a2.5 2.5 0 0 1-4.3-2.3l1-3.6A4.5 4.5 0 0 1 7.5 8zM7.5 10.5v3M6 12h3M15.5 11.5h.1M17.5 13.5h.1"/>',
};
const icon = (name, cls = 'ico') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;

// ---- the main menu's painting (its parallax layers, as the credits show them) ----------------------------------

const MENU = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/hd/menu/layers.json'), 'utf8'));

/** The painted main menu seen through a window of the native screen (x0, y0: its top left corner; s: pixels per native pixel). */
function menuScene(x0, y0, s) {
  const skip = new Set(['robot']);
  return MENU.layers.filter((l) => !skip.has(l.name)).map((l) => {
    const [x, y, w, h] = l.rect;
    return `<img class="layer" src="public/hd/menu/${l.file}" style="left:${((x - x0) * s).toFixed(1)}px;top:${((y - y0) * s).toFixed(1)}px;` +
      `width:${(w * s).toFixed(1)}px;height:${(h * s).toFixed(1)}px">`;
  }).join('');
}

/** A picture in a window: an image (cropped at `pos`, magnified by `zoom`), a GIF's frame, or the painted main menu. */
function picture(pic, w, h) {
  if (pic.menu) return `<div class="scene">${menuScene(-10, 8, h / 150)}</div>`;
  const style = `object-position:${pic.pos ?? '50% 50%'};${pic.zoom ? `transform:scale(${pic.zoom});transform-origin:${pic.pos ?? '50% 50%'}` : ''}`;
  return pic.gif ? `<img data-gif="${pic.gif}" data-frame="${pic.frame}" style="${style}">` : `<img src="${pic.src}" style="${style}">`;
}

// ---- the pictures -------------------------------------------------------------------------------------------------

const shots = [];
const add = (file, html) => shots.push({ file, html });

// The hero: the painted main menu, the remaster's logo, and what the game is in a menu panel.
add('docs/media/hero.jpg', `
<div class="shot hero" data-out="docs/media/hero.jpg">
  <div class="scene">${menuScene(-58, 2, 2.08)}</div>
  <div class="hero-shade"></div>
  <img class="hero-logo" src="public/brand/logo.webp">
  <div class="panel hero-menu">
    <div>THE 1994 ROBOT</div><div>FIGHTING CLASSIC</div><div class="sel">REBUILT IN HD</div><div>FOR WINDOWS AND THE WEB</div>
  </div>
  <div class="hero-foot">ONE MUST FALL 2097 REMASTERED <b>·</b> FREEWARE, NEVER SOLD</div>
  <div class="hero-tech">TYPESCRIPT <b>·</b> WEBGL2 <b>·</b> WEB AUDIO <b>·</b> TAURI</div>
</div>`);

// The repository's social preview (1280 x 640, the size GitHub asks for).
add('docs/media/social-preview.jpg', `
<div class="shot social" data-out="docs/media/social-preview.jpg" data-scale="1">
  <div class="scene">${menuScene(-50, 2, 3.1)}</div>
  <div class="hero-shade"></div>
  <img class="hero-logo" src="public/brand/logo.webp">
  <div class="panel hero-menu">
    <div>THE 1994 ROBOT</div><div>FIGHTING CLASSIC</div><div class="sel">REBUILT IN HD</div><div>FOR WINDOWS AND THE WEB</div>
  </div>
  <div class="hero-foot">ONE MUST FALL 2097 REMASTERED <b>·</b> FREEWARE, NEVER SOLD</div>
</div>`);

for (const b of BUTTONS) {
  add(`docs/media/btn-${b.key}.png`, `
<div class="shot btn ${b.kind}" data-out="docs/media/btn-${b.key}.png">${icon(b.icon)}<div><b>${b.label}</b><small>${b.sub}</small></div></div>`);
}

SECTIONS.forEach((s, i) => {
  const num = String(i + 1).padStart(2, '0');
  add(`docs/media/nav-${s.key}.png`, `<div class="shot nav" data-out="docs/media/nav-${s.key}.png"><i>${num}</i>${s.nav}</div>`);
  add(`docs/media/banner-${s.key}.jpg`, `
<div class="shot banner" data-out="docs/media/banner-${s.key}.jpg">
  <div class="panel fill">
    <div class="text"><div class="num">${num}<span></span></div><div class="title">${s.title}</div><div class="line">${s.line}</div></div>
    <div class="window">${picture(s.pic, 300, 122)}</div>
  </div>
</div>`);
});

for (const d of DOCS) {
  add(`docs/media/doc-${d.key}.jpg`, `
<div class="shot banner doc" data-out="docs/media/doc-${d.key}.jpg">
  <div class="panel fill">
    <div class="text"><div class="num">ONE MUST FALL 2097 REMASTERED<span></span></div><div class="title">${d.title}</div><div class="line">${d.line}</div></div>
    <div class="window">${picture(d.pic, 250, 92)}</div>
  </div>
</div>`);
}

for (const p of PILLARS) add(`docs/media/icon-${p}.png`, `<div class="shot pillar" data-out="docs/media/icon-${p}.png">${icon(p)}</div>`);

// ---- pictures of the game, framed ---------------------------------------------------------------------------------
// Made from footage taken of the game (1920 x 1080 frames in .captures/readme2: .captures/readme-media/rec/readme2.mjs
// records them from the dev server; the manual's pages rendered from its PDF), which is not in the repository: without
// it these pictures stay as they are.

const CAPS = '.captures/readme2';
const hasCaps = fs.existsSync(path.join(ROOT, CAPS, 'arena-0.jpg'));

/** Part of a 1920 x 1080 frame in a window of w x h (CSS pixels): centered on x `cx`, from y `y0`, `sh` frame pixels high. */
function part(file, w, h, cx = 960, y0 = 0, sh = 1080) {
  const k = h / sh;
  return `<img src="${CAPS}/${file}" style="position:absolute;width:${(1920 * k).toFixed(2)}px;height:${(1080 * k).toFixed(2)}px;` +
    `left:${(w / 2 - cx * k).toFixed(2)}px;top:${(-y0 * k).toFixed(2)}px">`;
}

/** A window onto the game with its name under it (a frame's windows fill its 852 pixels inside, 10 apart). */
const framed = (w, h, img, name, sub = '') => `<figure style="width:${w}px"><div class="gwin" style="width:${w}px;height:${h}px">${img}</div>` +
  `<figcaption><b>${name}</b>${sub ? `<span>${sub}</span>` : ''}</figcaption></figure>`;

if (hasCaps) {
  // The five arenas of the original game, a moment of a fight in each (without the fight's HUD).
  const ARENAS = [['arena-0.jpg', 480, 'STADIUM'], ['arena-1.jpg', 690, 'DANGER ROOM'], ['arena-2.jpg', 1360, 'POWER PLANT'],
    ['arena-3.jpg', 1400, 'FIRE PIT'], ['arena-4.jpg', 660, 'THE DESERT']];
  add('docs/media/arenas.jpg', `
<div class="shot gframe" data-out="docs/media/arenas.jpg" style="width:880px">
  <div class="panel grow">${ARENAS.map(([f, cx, name]) => framed(162, 214, part(f, 162, 214, cx, 80, 1000), name)).join('')}</div>
</div>`);
  // The new robots and arenas: the four arenas (fights, with their HUD), the robots on the VS screen.
  const NEW_ARENAS = [['newarena-5.jpg', 'ORBITAL', 'GLACIER VS HELIX'], ['newarena-6.jpg', 'ICE CAVE', 'GLACIER VS TEMPEST'],
    ['newarena-7.jpg', 'ROOFTOP', 'SPECTRE VS TEMPEST'], ['newarena-8.jpg', 'ABYSS', 'HELIX VS SPECTRE']];
  add('docs/media/new-arenas.jpg', `
<div class="shot gframe" data-out="docs/media/new-arenas.jpg" style="width:880px">
  <div class="panel grow wrap">${NEW_ARENAS.map(([f, name, sub]) => framed(421, 237, part(f, 421, 237), name, sub)).join('')}</div>
</div>`);
  add('docs/media/new-robots.jpg', `
<div class="shot gframe" data-out="docs/media/new-robots.jpg" style="width:880px">
  <div class="panel grow">${[['vsnew0.jpg', 'GLACIER VS TEMPEST'], ['vsnew1.jpg', 'HELIX VS SPECTRE']]
    .map(([f, name]) => framed(421, 316, part(f, 421, 316, 960, 0, 1080), name)).join('')}</div>
</div>`);
  // The manual: its cover and two spreads (the robots, the pilots), on the menus' navy.
  const page = (n) => `<img class="mpage" src="${CAPS}/manual-p${String(n).padStart(2, '0')}.png">`;
  add('docs/media/manual.jpg', `
<div class="shot gframe" data-out="docs/media/manual.jpg" style="width:880px">
  <div class="panel grow manual"><div class="book cover">${page(1)}</div><div class="book">${page(12)}${page(13)}</div><div class="book">${page(20)}${page(21)}</div></div>
</div>`);
}

add('docs/media/footer.jpg', `
<div class="shot footer" data-out="docs/media/footer.jpg">
  <div class="hazard"></div>
  <div class="panel foot-panel"><img src="public/brand/logo.webp"><div><b>FREEWARE SINCE 1999</b><small>SHARED FREE OF CHARGE, NEVER SOLD</small></div></div>
  <div class="hazard"></div>
</div>`);

// ---- the look -----------------------------------------------------------------------------------------------------

const CSS = `
@font-face { font-family: 'OMF'; src: url('public/fonts/Orbitron.ttf') format('truetype'); font-weight: 400 900; }
:root {
  --navy: #04061f; --grid: rgba(10, 16, 170, .55); --grid-soft: rgba(30, 44, 230, .16); --edge: #0000f3; --edge-dk: #000059;
  --green: #00ff00; --green2: #00d200; --green-dk: #005800; --gold: #ffc840; --yellow: #ffff00; --pale: #9fd0ff; --text: #e7eaf3;
  --ui: 'Segoe UI', system-ui, sans-serif;
}
* { box-sizing: border-box; }
body { margin: 0; padding: 40px; background: #0d1117; display: flex; flex-wrap: wrap; gap: 40px; align-items: flex-start; }
.shot { position: relative; overflow: hidden; flex: none; }
.panel { background-color: var(--navy); border: 2px solid var(--edge); box-shadow: 0 0 0 1px var(--edge-dk), inset 0 0 0 1px var(--edge-dk);
  background-image: linear-gradient(90deg, var(--grid) 1px, transparent 1px), linear-gradient(180deg, var(--grid) 1px, transparent 1px);
  background-size: 16px 16px; background-position: -1px -1px; }
.scene { position: absolute; inset: 0; background: #02030f; }
.layer { position: absolute; max-width: none; }

/* the hero: 880 x 420 (1760 x 840) */
.hero { width: 880px; height: 420px; }
.hero-shade { position: absolute; inset: 0; background: linear-gradient(90deg, transparent 38%, rgba(2, 3, 20, .55) 62%, rgba(2, 3, 20, .72) 100%),
  linear-gradient(180deg, transparent 70%, rgba(2, 3, 16, .6)); }
.hero-logo { position: absolute; left: 468px; top: 18px; width: 392px; filter: drop-shadow(0 10px 24px rgba(0, 0, 0, .75)); }
.hero-menu { position: absolute; left: 494px; top: 222px; width: 346px; padding: 12px 0 13px; display: flex; flex-direction: column; align-items: center;
  gap: 4px; font: 900 15.5px OMF; letter-spacing: .12em; color: #00b800; background-color: rgba(4, 6, 31, .86); white-space: nowrap; }
.hero-menu .sel { color: var(--green); text-shadow: 0 0 12px rgba(0, 255, 0, .55); }
.hero-foot { position: absolute; left: 16px; bottom: 11px; font: 700 9.5px OMF; letter-spacing: .16em; color: #dfe6ff; text-shadow: 1px 1px 0 #000; }
.hero-tech { position: absolute; right: 16px; bottom: 11px; font: 700 9.5px OMF; letter-spacing: .16em; color: var(--pale); text-shadow: 1px 1px 0 #000; }
.hero-foot b, .hero-tech b { color: var(--edge); text-shadow: none; filter: brightness(1.6); }

/* the social preview: 1280 x 640 */
.social { width: 1280px; height: 640px; }
.social .hero-logo { left: 670px; top: 30px; width: 560px; }
.social .hero-menu { left: 706px; top: 330px; width: 494px; gap: 6px; padding: 16px 0 18px; font-size: 22px; }
.social .hero-foot { font-size: 13px; left: 24px; bottom: 18px; }

/* the big buttons: 56 high */
.btn { height: 56px; display: inline-flex; align-items: center; gap: 12px; padding: 0 22px 0 16px; border: 2px solid var(--edge);
  font: 800 14px OMF; letter-spacing: .1em; text-transform: uppercase; box-shadow: 0 0 0 1px var(--edge-dk); }
.btn .ico { width: 24px; height: 24px; flex: none; }
.btn div { display: flex; flex-direction: column; gap: 3px; }
.btn small { font: 600 11px var(--ui); letter-spacing: .02em; text-transform: none; }
.btn.menu { color: var(--green); background-color: var(--navy); text-shadow: 2px 2px 0 var(--green-dk);
  background-image: linear-gradient(90deg, var(--grid) 1px, transparent 1px), linear-gradient(180deg, var(--grid) 1px, transparent 1px);
  background-size: 16px 16px; background-position: -1px -1px; }
.btn.menu small { color: #c4cbe0; text-shadow: none; }
.btn.go { border-color: #ffb54a; color: #1f0b00; text-shadow: 0 1px 0 rgba(255, 255, 255, .35); box-shadow: 0 0 0 1px #5a2600, 0 0 16px rgba(255, 120, 20, .3);
  background: linear-gradient(180deg, #ffe58a 0%, #ffb431 46%, #ff7414 100%); }
.btn.go small { color: #4a1c00; text-shadow: none; }

/* the section buttons: 30 high */
.nav { height: 30px; display: inline-flex; align-items: center; gap: 8px; padding: 0 12px 0 10px; border: 2px solid var(--edge); box-shadow: 0 0 0 1px var(--edge-dk);
  font: 800 11px OMF; letter-spacing: .12em; text-transform: uppercase; color: var(--gold); text-shadow: 1px 1px 0 #2a1a00; background-color: var(--navy);
  background-image: linear-gradient(90deg, var(--grid) 1px, transparent 1px), linear-gradient(180deg, var(--grid) 1px, transparent 1px);
  background-size: 16px 16px; background-position: -1px -1px; }
.nav i { font-style: normal; color: var(--green2); text-shadow: none; opacity: .9; }

/* the section banners: 880 x 150 */
.banner { width: 880px; height: 150px; }
.banner .fill { position: absolute; inset: 0; }
.banner .text { position: absolute; left: 26px; top: 0; bottom: 0; right: 340px; display: flex; flex-direction: column; justify-content: center; gap: 7px; }
.banner .num { display: flex; align-items: center; gap: 12px; font: 800 13px OMF; letter-spacing: .3em; color: var(--gold); text-shadow: 1px 1px 0 #2a1a00; }
.banner .num span { width: 70px; height: 2px; background: linear-gradient(90deg, var(--gold), transparent); }
.banner .title { font: 900 31px/1.08 OMF; letter-spacing: .07em; text-transform: uppercase; color: var(--green);
  text-shadow: 3px 3px 0 var(--green-dk), 0 0 18px rgba(0, 255, 0, .25); white-space: nowrap; }
.banner .line { font: 500 14px/1.35 var(--ui); color: #c4cbe0; text-shadow: 1px 1px 0 #000; text-wrap: balance; }
.banner .window { position: absolute; right: 14px; top: 12px; bottom: 12px; width: 300px; overflow: hidden; border: 2px solid var(--edge);
  box-shadow: 0 0 0 1px var(--edge-dk), 0 0 22px rgba(0, 0, 243, .35); background: #000; }
.banner .window img, .banner .window canvas { width: 100%; height: 100%; object-fit: cover; display: block; }
.banner .window::after { content: ''; position: absolute; inset: 0; box-shadow: inset 0 0 26px rgba(0, 0, 40, .75);
  background: repeating-linear-gradient(180deg, rgba(0, 0, 0, .12) 0 1px, transparent 1px 3px); }

/* the docs' headers: 880 x 116 */
.banner.doc { height: 116px; }
.banner.doc .num { font-size: 10px; letter-spacing: .24em; }
.banner.doc .title { font-size: 27px; }
.banner.doc .window { width: 250px; }
.banner.doc .text { right: 290px; }

/* the feature icons: 44 x 44 */
.pillar { width: 44px; height: 44px; display: grid; place-items: center; color: var(--green); border: 2px solid var(--edge);
  box-shadow: 0 0 0 1px var(--edge-dk); background-color: var(--navy);
  background-image: linear-gradient(90deg, var(--grid) 1px, transparent 1px), linear-gradient(180deg, var(--grid) 1px, transparent 1px);
  background-size: 11px 11px; background-position: -1px -1px; }
.pillar .ico { width: 26px; height: 26px; filter: drop-shadow(0 0 5px rgba(0, 255, 0, .45)); }

/* pictures of the game in the menus' frames */
.gframe .grow { display: flex; justify-content: space-between; gap: 10px; padding: 12px; }
.gframe .grow.wrap { flex-wrap: wrap; row-gap: 12px; }
.gframe figure { margin: 0; display: flex; flex-direction: column; gap: 6px; }
.gframe .gwin { position: relative; overflow: hidden; border: 2px solid var(--edge); box-shadow: 0 0 0 1px var(--edge-dk), 0 0 18px rgba(0, 0, 243, .3); background: #000; }
.gframe .gwin img { max-width: none; }
.gframe figcaption { display: flex; flex-direction: column; align-items: center; gap: 2px; }
.gframe figcaption b { font: 800 11.5px OMF; letter-spacing: .14em; color: var(--gold); text-shadow: 1px 1px 0 #2a1a00; white-space: nowrap; }
.gframe figcaption span { font: 700 8.5px OMF; letter-spacing: .16em; color: var(--pale); opacity: .85; white-space: nowrap; }
.gframe .manual { align-items: center; padding: 16px 18px; }
.gframe .book { display: flex; box-shadow: 0 10px 24px rgba(0, 0, 0, .7), 0 0 0 1px rgba(0, 0, 0, .6); }
.gframe .mpage { height: 250px; display: block; }

/* the footer: 880 x 64 */
.footer { width: 880px; height: 64px; display: flex; align-items: center; background: #0a0a0a; }
.footer .hazard { flex: 1; align-self: stretch; background: repeating-linear-gradient(-45deg, #f5c400 0 14px, #0b0b0b 14px 28px); opacity: .92; }
.foot-panel { height: 64px; display: flex; align-items: center; gap: 18px; padding: 0 22px; }
.foot-panel img { height: 44px; }
.foot-panel div { display: flex; flex-direction: column; gap: 3px; }
.foot-panel b { font: 900 14px OMF; letter-spacing: .14em; color: var(--green); text-shadow: 2px 2px 0 var(--green-dk); }
.foot-panel small { font: 700 9px OMF; letter-spacing: .16em; color: #c4cbe0; }
`;

// (GIF frames drawn into canvases, the same frame every time)
const SCRIPT = `
window.ready = (async () => {
  await document.fonts.ready;
  for (const img of document.querySelectorAll('img[data-gif]')) {
    const data = await (await fetch(img.dataset.gif)).arrayBuffer();
    const dec = new ImageDecoder({ data, type: 'image/gif' });
    const { image } = await dec.decode({ frameIndex: Number(img.dataset.frame) });
    const c = document.createElement('canvas');
    c.width = image.displayWidth;
    c.height = image.displayHeight;
    c.getContext('2d').drawImage(image, 0, 0);
    image.close();
    img.src = c.toDataURL('image/png');
  }
  await Promise.all([...document.images].map((i) => (i.complete ? null : new Promise((r) => { i.onload = r; i.onerror = r; }))));
  // (a long title is set smaller, to fit beside its picture)
  for (const t of document.querySelectorAll('.banner .title')) {
    let size = parseFloat(getComputedStyle(t).fontSize);
    while (t.scrollWidth > t.clientWidth && size > 16) t.style.fontSize = (--size) + 'px';
  }
  return true;
})();`;

const html = `<!doctype html><html><head><meta charset="utf-8"><base href="${pathToFileURL(ROOT).href}/">
<style>${CSS}</style></head><body>${shots.map((s) => s.html).join('\n')}<script>${SCRIPT}</script></body></html>`;

const htmlFile = path.join(HERE, '.build', 'media.html');
fs.mkdirSync(path.dirname(htmlFile), { recursive: true });
fs.writeFileSync(htmlFile, html);
fs.writeFileSync(path.join(HERE, '.build', 'README.txt'), 'Generated by tools/github/build.mjs (not committed).\n');
if (htmlOnly) {
  console.log(`github: ${path.relative(ROOT, htmlFile)}`);
  process.exit(0);
}
if (!EDGE) throw new Error('Microsoft Edge was not found (the pictures are shot by it in headless mode).');

// ---- shooting them ------------------------------------------------------------------------------------------------

const port = 9369;
const profile = path.join(WORK, 'profile');
const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--allow-file-access-from-files',
  '--hide-scrollbars', '--disable-sync', '--disable-extensions', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
  '--disable-features=msImplicitSignin,msEdgeSyncConsent,EdgeCollections,msEdgeShopping', '--inprivate', 'about:blank'],
{ stdio: 'ignore' });
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
let target;
for (let i = 0; i < 100 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page'); } catch {}
  if (!target) await sleep(100);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res) => (ws.onopen = res));
let id = 0;
const pending = new Map();
const events = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else if (m.method) events.push(m);
};
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
try {
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 2, mobile: false });
  await send('Page.navigate', { url: pathToFileURL(htmlFile).href });
  for (let i = 0; i < 100 && !events.some((m) => m.method === 'Page.loadEventFired'); i++) await sleep(100);
  await evaluate('window.ready');
  await sleep(300);
  const rects = await evaluate(`[...document.querySelectorAll('.shot')].map((e) => { const r = e.getBoundingClientRect();
    return { out: e.dataset.out, scale: Number(e.dataset.scale || 2) / 2, x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height }; })`);
  let made = 0;
  for (const r of rects) {
    const name = path.basename(r.out).replace(/\.\w+$/, '');
    if (only.size && !only.has(name)) continue;
    const png = r.out.endsWith('.png');
    const shot = await send('Page.captureScreenshot', {
      format: png ? 'png' : 'jpeg', ...(png ? {} : { quality: 88 }), captureBeyondViewport: true,
      clip: { x: r.x, y: r.y, width: r.width, height: r.height, scale: r.scale },
    });
    const file = OUT_DIR ? path.join(OUT_DIR, path.basename(r.out)) : path.join(ROOT, r.out);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(shot.result.data, 'base64'));
    made++;
  }
  console.log(`github: ${made} pictures in ${OUT_DIR ?? 'docs/media'}`);
} finally {
  ws.close();
  try {
    const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    const bws = new WebSocket(webSocketDebuggerUrl);
    await new Promise((res, rej) => { bws.onopen = res; bws.onerror = rej; });
    bws.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
    await sleep(800);
  } catch {}
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(edge.pid), '/T', '/F'], { stdio: 'ignore' });
  else edge.kill();
  await sleep(500);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
}
