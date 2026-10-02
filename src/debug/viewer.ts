// Developer asset viewer: browse BK scenes and AF fighter animations with the real renderer.
// Open with ?viewer in the URL. Keys: n/p change scene, h changes HAR, j/k change move, space pauses.
import { parseAF, type AfFile } from '../formats/af';
import { parseBK, type BkFile } from '../formats/bk';
import type { AnimationData } from '../formats/animation';
import { getFile } from '../resources/files';
import { getScript } from '../script/script';
import { drawList, video } from '../video/draw';
import type { GLRenderer } from '../video/gl/renderer';
import { Surface } from '../video/surface';
import { setMenuColors, vga } from '../video/vga';

const BKS = ['ARENA0.BK', 'ARENA1.BK', 'ARENA2.BK', 'ARENA3.BK', 'ARENA4.BK', 'INTRO.BK', 'MAIN.BK', 'MELEE.BK', 'VS.BK',
  'MECHLAB.BK', 'NEWSROOM.BK', 'END.BK', 'END1.BK', 'END2.BK', 'CREDITS.BK', 'NORTH_AM.BK', 'KATUSHAI.BK', 'WAR.BK', 'WORLD.BK'];

export function startViewer(renderer: GLRenderer): void {
  let bkIdx = 0;
  let harIdx = 0;
  let moveIdx = 10;
  let bk: BkFile = parseBK(getFile(BKS[0]));
  let af: AfFile = parseAF(getFile('FIGHTR0.AF'));
  const surfCache = new Map<object, Surface>();
  const surf = (key: object, make: () => Surface) => {
    let s = surfCache.get(key);
    if (!s) surfCache.set(key, (s = make()));
    return s;
  };
  let tick = 0;
  let paused = false;
  const hud = document.getElementById('boot')!;

  const loadBk = () => {
    bk = parseBK(getFile(BKS[bkIdx]));
    vga.setBasePalette(bk.palettes[0]);
    vga.setRemaps(bk.remaps[0]);
    setMenuColors();
    vga.setBaseIndex(0, 0, 0, 0);
    renderer.resetAtlas();
  };
  const loadAf = () => {
    af = parseAF(getFile(`FIGHTR${harIdx}.AF`));
    renderer.resetAtlas();
  };
  loadBk();

  const moves = () => af.moves.map((m, i) => (m ? i : -1)).filter((i) => i >= 0);

  window.addEventListener('keydown', (e) => {
    if (e.key === 'n') { bkIdx = (bkIdx + 1) % BKS.length; loadBk(); }
    if (e.key === 'p') { bkIdx = (bkIdx + BKS.length - 1) % BKS.length; loadBk(); }
    if (e.key === 'k') { const m = moves(); moveIdx = m[(m.indexOf(moveIdx) + 1) % m.length]; tick = 0; }
    if (e.key === 'j') { const m = moves(); moveIdx = m[(m.indexOf(moveIdx) + m.length - 1) % m.length]; tick = 0; }
    if (e.key === 'h') { harIdx = (harIdx + 1) % 11; loadAf(); tick = 0; }
    if (e.key === ' ') paused = !paused;
  });

  const drawAnim = (anim: AnimationData, x: number, y: number, t: number) => {
    const script = getScript(anim.animString);
    if (script.totalTicks <= 0) return;
    const frame = script.frameAt(t % script.totalTicks);
    if (!frame) return;
    const sp = anim.sprites[frame.sprite];
    if (!sp) return;
    const s = surf(sp, () => Surface.fromSprite(sp));
    video.draw(s, x + sp.posX, y + sp.posY);
  };

  const bgSurf = () => surf(bk, () => new Surface(bk.width, bk.height, bk.background, -1));

  const loop = () => {
    if (!paused) tick++;
    drawList.begin();
    video.draw(bgSurf(), 0, 0);
    bk.anims.forEach((a) => {
      if (a) drawAnim(a.animation, a.animation.startX, a.animation.startY, tick);
    });
    const mv = af.moves[moveIdx];
    if (mv) {
      // HAR colors: player 1 uses palette indices 0..47 (copied from altpal 0 by the game).
      drawAnim(mv.animation, 160, 190, tick);
    }
    vga.render();
    renderer.render();
    const mvs = mv ? `${moveIdx} "${mv.moveString}" ${mv.animation.animString.slice(0, 60)}` : '-';
    hud.textContent = `${BKS[bkIdx]} | FIGHTR${harIdx}.AF move ${mvs}`;
    hud.style.cssText = 'position:fixed;left:8px;top:8px;right:auto;bottom:auto;display:block;background:none;color:#fff;font:12px monospace;text-shadow:1px 1px #000;pointer-events:none';
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
