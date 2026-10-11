// The loading screen's tips (they change every few seconds and stop with the loading screen), and its other words, in
// the game's language (the first start's setup, over the loading screen, can change it).
import { onLanguageChange, tr, trKey } from '../i18n/i18n';

const TIPS = [
  trKey('Press F2 at any time to switch between the original pixels and the remastered graphics.'),
  trKey('Press F1 during a fight for the help pages, and the pause menu for your robot’s move list.'),
  trKey('The special button does a special move in one press: with no direction, forward, back, down or up.'),
  trKey('The training lab shows frame data and hitboxes, and has combo trials for every robot.'),
  trKey('Drop your own music files onto the game window to fight to them. F3 skips to the next song.'),
  trKey('F11 or Alt+Enter switches fullscreen. F12 or Print Screen saves a screenshot.'),
  trKey('Replays of your fights are kept: watch them in slow motion and save clips as MP4 or GIF.'),
  trKey('Build your own robot in the robot workshop, then take it into the ring.'),
  trKey('Four new robots and four new arenas were made for the remaster. Turn them on in Extras › Mods.'),
  trKey('An Xbox controller works right away, for one player or two.'),
  trKey('Hyper mode, in Options › Gameplay, makes every special move stronger.'),
  trKey('Kreissack waits at the end of arcade mode. Bring your best robot.'),
];

/** Starts the tips on the loading screen (and puts its words in the game's language, again when it changes). */
export function startBootTips(boot: HTMLElement): void {
  const label = boot.querySelector<HTMLElement>('.tip b');
  const foot = boot.querySelector<HTMLElement>('.foot span');
  const el = boot.querySelector<HTMLElement>('.tip');
  const text = el?.querySelector<HTMLElement>('.tip-text');
  let i = Math.floor(Math.random() * TIPS.length);
  const words = () => {
    if (label) label.textContent = tr('TIP');
    if (foot) foot.textContent = tr('An unofficial fan remaster · free, always');
    if (text) text.textContent = tr(TIPS[i]);
  };
  words();
  const stopWords = onLanguageChange(words);
  if (!el || !text) return;
  const timer = window.setInterval(() => {
    if (boot.style.display === 'none' || !boot.isConnected) {
      window.clearInterval(timer);
      stopWords();
      return;
    }
    el.classList.add('is-out');
    window.setTimeout(() => {
      i = (i + 1) % TIPS.length;
      text.textContent = tr(TIPS[i]);
      el.classList.remove('is-out');
    }, 450);
  }, 5200);
}
