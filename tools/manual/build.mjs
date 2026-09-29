// Builds the game manual: docs/manual/OMF-2097-Remastered-Manual.pdf, a 32-page booklet in the style of a 1990s game
// manual. `npm run manual` (Windows: the PDF is printed by Microsoft Edge in headless mode; the fonts are Orbitron from
// public/fonts and the Windows fonts Georgia, Verdana, Arial Black and Courier New).
// 1) the game facts (tools/manual/facts.test.ts: texts, pilot stats, the robots' command lists),
// 2) the pages (HTML + manual.css, pictures from tools/manual/img, made by prepare.py),
// 3) printed to PDF; pages whose content does not fit are reported.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const WORK = path.join(os.tmpdir(), 'omf-manual');
const OUT = path.join(ROOT, 'docs', 'manual', 'OMF-2097-Remastered-Manual.pdf');
const EDGE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find((p) => fs.existsSync(p));

fs.mkdirSync(WORK, { recursive: true });
const factsFile = path.join(WORK, 'facts.json');
const r = spawnSync('npx', ['vitest', 'run', 'tools/manual/facts.test.ts'], {
  cwd: ROOT, shell: true, stdio: 'inherit', env: { ...process.env, OMF_MANUAL_FACTS: factsFile },
});
if (r.status !== 0) process.exit(r.status ?? 1);
const facts = JSON.parse(fs.readFileSync(factsFile, 'utf8'));
const L = facts.lang;

// ---- helpers ---------------------------------------------------------------------------------------------------------

const img = (name) => pathToFileURL(path.join(HERE, 'img', name)).href;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const ROT = { 1: 225, 2: 180, 3: 135, 4: 270, 6: 90, 7: 315, 8: 0, 9: 45 };
const dir = (d) => (d === '5'
  ? '<svg class="dir" viewBox="0 0 12 12"><circle cx="6" cy="6" r="2" fill="#1a1a1f"/></svg>'
  : `<svg class="dir" viewBox="0 0 12 12"><rect x=".6" y=".6" width="10.8" height="10.8" rx="2.4" fill="#fbf8f0" stroke="#1a1a1f" stroke-width=".9"/><path d="M6 2.2 L9.3 6.2 H7.1 V9.7 H4.9 V6.2 H2.7 Z" fill="#1a1a1f" transform="rotate(${ROT[d]} 6 6)"/></svg>`);
const cmd = (inputs, button) => inputs.map(dir).join('') + `<span class="btn ${button}">${button}</span>`;
const key = (k) => `<span class="key">${esc(k)}</span>`;
const title = (small, big) => `<h1><small>${small}</small>${big}</h1><div class="rule"></div>`;

let pageNo = 0;
const pages = [];
function page(chapter, body, cls = '') {
  pageNo++;
  const side = pageNo % 2 ? 'odd' : 'even';
  pages.push(`<section class="page ${side} ${cls}">
  <div class="head"><span>One Must Fall 2097 &middot; Remastered</span><span>${chapter}</span></div>
  <div class="tab"><span>${chapter}</span></div>
  <div class="body">${body}</div>
  <div class="foot"><span>${side === 'even' ? 'Remastered Edition' : ''}</span><div class="num">${pageNo}</div><span>${side === 'odd' ? 'Game Manual' : ''}</span></div>
</section>`);
}
function raw(html) {
  pageNo++;
  pages.push(html);
}

// ---- the robots --------------------------------------------------------------------------------------------------------

const ROBOTS = [
  ['jaguar', 'All-rounder', 'The robot most pilots learn on, and the one many never leave. Tall and athletic, with boxy limbs, a pointed crest, swept fins, gold joints and the jaguar mask on its chest, the Jaguar is quick on its feet and quicker to punish: it leaps across the arena, fires a concussion cannon and throws opponents clean over its head.'],
  ['shadow', 'Trickster', 'A lean ninja of a machine with a smooth hooded head and a wide, riveted torso. The Shadow projects translucent copies of itself, and its shadows strike, slide and grab from where the robot is not. Opponents who watch the robot instead of its shadow do not watch for long.'],
  ['thorn', 'Speed', 'Hunched and spindly, with long red spikes growing from its elbows and knees and a gold cape of armor. Thorn lives on speed and surprise: kicks that come out of nowhere, attacks off the arena walls and a charge that leads with the spikes.'],
  ['pyros', 'Power flyer', 'Its legs are a flared thruster skirt painted with gold flames; its hands are heavy gold blocks. Pyros rides on jets of fire: a spinning ring of flame, a thrust that crosses the arena in an instant and swoops from the air.'],
  ['electra', 'Zoner', 'A slender, spiky robot with a crystalline torso and lightning crackling in its hands. Electra keeps its opponents at a distance with ball lightning, thunder rolling along the floor and a spray of electric shards.'],
  ['katana', 'Swordsman', 'A samurai among robots: a horned red crest, gold chest armor and long red blades along its forearms. Anything that jumps at the Katana meets the rising blade; anything that stays down gets its head stomped.'],
  ['shredder', 'Rushdown', 'Lean and agile, with a red horned crest and clawed hands that can leave its arms and fly at the opponent. Head-butts and flip kicks make the Shredder one of the most aggressive robots in the arena.'],
  ['flail', 'Grappler', 'Top-heavy and unorthodox: a wide armored head-body on a coiled spring, rolling on a spiked wheel and swinging chains with spiked balls. The Flail spins opponents into throws and charges in fists first.'],
  ['gargoyle', 'Air', 'A winged demon of steel, with bat-like mechanical wings, a horned head and red talons. The Gargoyle owns the air: diving claws, flying talons and a charge on its wings.'],
  ['chronos', 'Technical', 'Sleek and tall, with smooth limbs, round gold joints and a red triangle on its chest. Chronos bends the rules of space: it teleports across the arena, phases through solid matter and freezes its enemies in stasis.'],
  ['nova', 'The final machine', 'Major Kreissack\'s own super-robot: bulky angular armor, a gold horn crest across its head and shoulders, and fists that launch grenades and missiles. Nova waits at the end of the road. It is not on the select screen, but pilots have been known to find it anyway.'],
];
const KIND = { THROW: 'Throw', SPECIAL: 'Special', AIR: 'In the air', SCRAP: 'Scrap finisher', DESTRUCT: 'Destruction' };

function robotBlock(i) {
  const [id, cls, text] = ROBOTS[i];
  const name = L[31 + i];
  const specials = L[492 + i].replace(/^SPECIAL MOVES:\s*/, '').split(/\n+/).filter(Boolean);
  const moves = (facts.moves[i] ?? []).map((m) => `<div><span class="k">${KIND[m.kind] ?? m.kind}</span>${cmd(m.inputs, m.button)}</div>`).join('');
  return `<div class="robot">
    <img src="${img(`robot-${id}.jpg`)}">
    <div>
      <h2>${esc(name)}</h2>
      <div class="class">${cls}</div>
      <p>${text}</p>
      <h3>Special moves</h3>
      <div class="names">${specials.map(esc).join(' &middot; ')}</div>
      <h3>Command list</h3>
      <div class="cmds">${moves}</div>
    </div>
  </div>`;
}

// ---- pages ---------------------------------------------------------------------------------------------------------------

// 1. Cover.
raw(`<section class="page cover">
  <img class="art" src="${img('cover.jpg')}">
  <div class="shade"></div>
  <div class="band">THE ROBOT FIGHTING CLASSIC &middot; REMASTERED EDITION</div>
  <img class="logo" src="${img('logo.png')}">
  <div class="year">2097</div>
  <div class="remastered">REMASTERED</div>
  <div class="burst" style="right:.25in; top:4.35in"><span>100%<b>FREE!</b>Never pay for this game</span></div>
  <div class="title">GAME MANUAL</div>
  <div class="sub">FOR WINDOWS AND THE WEB</div>
  <div class="fine">One Must Fall 2097 &copy; 1994 Diversions Entertainment &middot; Freeware since 1999 &middot; Unofficial fan remaster</div>
</section>`);

// 2. Inside cover: the warning, about this manual.
page('Before you play', `
  <div class="warn">
    <h3>WARNING: READ BEFORE PLAYING</h3>
    <p class="small">A very small number of people have seizures when they see flashing lights or patterns, including those
    in video games, even without any history of epilepsy. This game has flashes of light (hits, knockouts, camera flashes,
    lightning). If you or anyone in your family has had a seizure, ask a doctor before playing. Stop playing at once and
    see a doctor if you feel dizzy, see things oddly, twitch, or lose awareness.</p>
    <p class="small">Play in a well-lit room, sit well back from the screen, and take a 10 to 15 minute break every hour.
    The remastered effects (flashes included) can be turned off in <b>Configuration &rsaquo; Video options &rsaquo; Remastered options</b>.</p>
  </div>
  <h2>About this manual</h2>
  <p>Welcome, pilot. This booklet covers everything in <b>One Must Fall 2097 Remastered</b>: the original 1994 game,
  rebuilt to play its original data on today's computers, and everything the remaster adds on top. Read it cover to cover,
  or keep it next to the keyboard and look things up between rounds. That is what the pros do.</p>
  <p>Throughout this manual, keys look like ${key('ENTER')} and moves are written the way the game writes them: joystick
  directions for a robot facing right, then the button. ${cmd(['2', '3', '6'], 'P')} means <i>down, down-forward, forward,
  punch</i>, one smooth motion. Facing left, forward and back swap sides.</p>
  <div class="tip" data-label="THE F1 KEY">
    <p>Stuck? Press ${key('F1')} at any time for the game's own help pages. In a fight, the pause menu's <b>Move list</b>
    shows every command of both robots.</p>
  </div>
  <div class="dark">
    <h3>Quick start</h3>
    <p>1. Run the game. &nbsp;2. At the main menu, press ${key('ENTER')} on <b>One player game</b>. &nbsp;3. Pick a pilot and a
    robot with the arrow keys and ${key('ENTER')}. &nbsp;4. Walk with ${key('←')}${key('→')}, punch with ${key('ENTER')},
    kick with ${key('R-SHIFT')}, block by holding back. &nbsp;5. Win.</p>
  </div>
  <h2>The disk in your hand</h2>
  <p>There is no disk, of course. The whole game is a free download, and so is this manual. One Must Fall 2097 has been
  freeware since 1999: its owners let everyone share it, as long as nobody charges for it. <b>If you paid for this game,
  you were robbed.</b></p>
`);

// 3. Contents.
const TOC = [
  ['Welcome to the year 2097', 4], ['Getting started', 6], ['The main menu', 7], ['Controls', 8], ['Fighting basics', 10],
  ['The robots', 12], ['New challengers', 19], ['The pilots', 20], ['The arenas', 22], ['Tournament play', 23],
  ['Arcade, survival and time attack', 25], ['The training lab', 26], ['Replays and the robot workshop', 27],
  ['The remastered look', 28], ['Tips from the pros', 29], ['Troubleshooting', 30], ['Credits', 31],
];
page('Contents', `
  ${title('What is inside', 'Contents')}
  <ul class="toc">${TOC.map(([t, n]) => `<li>${t}<span></span><b>${n}</b></li>`).join('')}</ul>
  <div class="spacer"></div>
  <figure><img src="${img('shot-firepit.jpg')}"><figcaption><b>THE FIRE PIT</b> &nbsp;Milano's Pyros and Ibrahim's Chronos
  settle it over the lava grate.</figcaption></figure>
`);

// 4-5. Story.
page('The year 2097', `
  ${title('Chapter 1', 'Welcome to the year 2097')}
  <p class="lead">The twenty-first century built the robots. The twenty-second will be won by whoever pilots them best.</p>
  <div class="cols">
    <p>By 2097 the great corporations have outgrown their nations, and the greatest of them is <b>W.A.R.</b>, World
    Aeronautics and Robotics. W.A.R. builds the machines that are colonizing space: <b>HARs</b>, Human Assisted Robots,
    ninety feet of armor and hydraulics controlled by a pilot through a neural link. A HAR moves when its pilot thinks.</p>
    <p>Machines that strong must be tested, and W.A.R. found a way to test them in front of the whole world. In arenas
    built for the purpose, pilots from every corner of the globe fight each other's robots to a standstill, round after
    round, while the cameras roll and the money changes hands.</p>
    <p>For the pilots, the arena is a way out. Some fight for the prize money, some for revenge, some for the glory of a
    title. A few fight because W.A.R. owns their debts. All of them know the rule of the arena, and the name of the game:
    of the two robots in the ring, <b>one must fall</b>.</p>
    <p>Behind it all stands <b>Major Kreissack</b>, the man who runs the tournament circuit for W.A.R., with his bodyguard
    Raven at his side. The winners of the circuit are promised a match with the Major himself, in a machine no one else is
    allowed to pilot.</p>
    <p>Your career begins in the Stadium, where W.A.R.'s new machines get their first public testing. Where it ends is up
    to you.</p>
  </div>
  <figure style="margin-top:6pt"><img src="${img('menu-wide.jpg')}" style="height:1.55in; object-fit:cover"><figcaption><b>OPENING NIGHT</b>
  &nbsp;The crowd waits for the champion.</figcaption></figure>
`);
page('The year 2097', `
  <h2>What's new in the Remastered Edition</h2>
  <p>This is the complete 1994 game, playing its original data files, with its fight engine, computer opponents, music and
  sound reproduced faithfully. On top of it, the remaster adds:</p>
  <ul>
    <li><b>Two looks, one key.</b> Flip between the pixel-exact 1994 graphics and an HD remaster at any moment with ${key('F2')}, even in the middle of a fight.</li>
    <li><b>3,200+ images redrawn in HD</b>, widescreen arenas, live lighting, particles, bloom and smooth motion.</li>
    <li><b>Four new robots and four new arenas</b>, built in the spirit of the originals (off until you turn them on).</li>
    <li><b>A training lab</b> with frame data, hitboxes, dummy recording and combo trials.</li>
    <li><b>Replays</b> of every fight, saved as video or animated GIF clips.</li>
    <li><b>Arcade, survival and time attack</b> modes, records and 20 achievements.</li>
    <li><b>A robot workshop</b> to build your own HARs, and <b>custom tournaments</b>.</li>
    <li>Gamepads with rumble, a modern keyboard layout, touch controls, one-button specials, your own music, two announcers (a male and a female voice).</li>
  </ul>
  <div class="dark">
    <h3>A word from the remaster team</h3>
    <p>We played this game to pieces in 1994. We wanted it to look the way we remembered it, not the way it really looked
    on a 14-inch monitor, without changing a single frame of how it plays. Everything new can be switched off. The original
    is always one key away.</p>
  </div>
  <figure><img src="${img('shot-remastered.jpg')}"><figcaption><b>REMASTERED</b> &nbsp;The Fire Pit in HD. Press ${key('F2')} and the
  same moment appears in its original 320 &times; 200 pixels.</figcaption></figure>
`);

// 6. Getting started.
page('Getting started', `
  ${title('Chapter 2', 'Getting started')}
  <div class="two">
    <div>
      <h2>Windows</h2>
      <p>Download the game from the project's GitHub page (<i>github.com/Jared-woodruff/OMF-2097-Remastered</i>, Releases).
      There are two ways to play:</p>
      <ul>
        <li><b>The installer</b> puts the game in your Start menu, with an uninstaller.</li>
        <li><b>The portable version</b> is one file. Run it from anywhere, even a USB stick.</li>
      </ul>
      <p>Windows may warn you about an unknown publisher the first time: choose <b>More info &rsaquo; Run anyway</b>.</p>
      <h2>The web</h2>
      <p>The game also runs in any modern browser, and keeps working offline after the first visit.</p>
    </div>
    <div>
      <div class="tip" data-label="SYSTEM REQUIREMENTS">
        <ul>
          <li>Windows 10 or 11 (64-bit), or a modern web browser</li>
          <li>A graphics card that speaks WebGL 2 (anything from the last ten years)</li>
          <li>About 200 MB of disk space</li>
          <li>Keyboard, gamepad or touch screen</li>
          <li>A friend to beat (optional)</li>
        </ul>
      </div>
      <h2>Everything included</h2>
      <p>The game's original files come with the download. No CD, no install disks, no serial number, no "insert disk 2".</p>
      <h2>Your saved data</h2>
      <p>Settings, tournament careers, replays and records are saved automatically. Screenshots (${key('F12')} or
      ${key('PRINT SCREEN')}), replays and clips you export go to <b>Downloads\\OMF 2097 Remastered</b>.</p>
    </div>
  </div>
  <figure><img src="${img('shot-menu.jpg')}"><figcaption><b>THE MAIN MENU</b> &nbsp;The Jaguar on its stage, the spotlight sweeping
  over the crowd. Move the mouse and the whole scene leans with you.</figcaption></figure>
`);

// 7. The main menu.
page('The main menu', `
  ${title('Chapter 3', 'The main menu')}
  <p>Use the arrow keys (or the mouse, or a gamepad) to choose, ${key('ENTER')} to select and ${key('ESC')} to go back.</p>
  <table>
    <tr><th style="width:36%">Entry</th><th>What it does</th></tr>
    <tr><td><b>One player game</b></td><td>You against the computer's pilots, one after another.</td></tr>
    <tr><td><b>Two player game</b></td><td>Two pilots, one keyboard (or pads). The loser buys the pizza.</td></tr>
    <tr><td><b>Tournament play</b></td><td>The career: create a pilot, win prize money, upgrade your robot, climb the circuit (page 23).</td></tr>
    <tr><td><b>Training</b></td><td>The training lab: a dummy to practice on, with frame data and combo trials (page 26).</td></tr>
    <tr><td><b>Configuration</b></td><td>Language, controls for both players, video and audio options (the announcer's voice too), rumble, touch controls.</td></tr>
    <tr><td><b>Gameplay</b></td><td>Game speed, the number of rounds, the computer's skill, advanced rules, the new robots and arenas.</td></tr>
    <tr><td><b>Extras</b></td><td>Replays, arcade, survival and time attack, records, the robot workshop, custom tournaments and the credits.</td></tr>
    <tr><td><b>Help</b></td><td>The game's help pages (also ${key('F1')}, anywhere).</td></tr>
    <tr><td><b>Demo</b></td><td>Sit back and watch the computer fight itself.</td></tr>
    <tr><td><b>Scoreboard</b></td><td>The best one-player scores.</td></tr>
    <tr><td><b>Quit</b></td><td>For the faint of heart.</td></tr>
  </table>
  <figure><img src="${img('shot-select.jpg')}"><figcaption><b>CHOOSE YOUR ROBOT</b> &nbsp;Pick a pilot, then a HAR. Each
  pilot's power, agility and endurance change how a robot hits, moves and holds up.</figcaption></figure>
`);

// 8-9. Controls.
page('Controls', `
  ${title('Chapter 4', 'Controls')}
  <p>The game knows two keyboard layouts (<b>Configuration &rsaquo; Controls</b>): the original <b>classic</b> layout, and a
  <b>modern</b> one for today's keyboards. Every key can be changed.</p>
  <table>
    <tr><th></th><th>Classic P1</th><th>Classic P2</th><th>Modern P1</th></tr>
    <tr><td><b>Move</b></td><td>${key('←')}${key('→')}${key('↑')}${key('↓')}</td><td>${key('A')}${key('D')}${key('W')}${key('X')}</td><td>${key('A')}${key('D')}${key('W')}${key('S')}</td></tr>
    <tr><td><b>Diagonals</b></td><td>${key('HOME')}${key('PG UP')}${key('END')}${key('PG DN')}</td><td>${key('Q')}${key('E')}${key('Z')}${key('C')}</td><td>two keys at once</td></tr>
    <tr><td><b>Punch</b></td><td>${key('ENTER')}</td><td>${key('L-CTRL')}${key('F')}</td><td>${key('J')}</td></tr>
    <tr><td><b>Kick</b></td><td>${key('R-SHIFT')}</td><td>${key('L-SHIFT')}${key('G')}</td><td>${key('K')}</td></tr>
    <tr><td><b>Special</b></td><td>${key('/')}</td><td>${key('H')}</td><td>${key('L')}</td></tr>
  </table>
  <p class="small">The numeric keypad works too for player 1 (${key('8')} jump, ${key('2')} duck, ${key('0')} punch,
  ${key('.')} kick). In the modern layout, player 2 uses the arrow keys with ${key(',')} punch, ${key('.')} kick and ${key('/')} special.</p>
  <h2>Gamepads</h2>
  <p>Plug in an Xbox-style controller and press a button: it takes over the next free player. Two button layouts:</p>
  <table>
    <tr><th></th><th>Modern</th><th>Classic</th></tr>
    <tr><td><b>Punch</b></td><td>${key('X')}${key('Y')}${key('RB')}</td><td>${key('A')}${key('X')}</td></tr>
    <tr><td><b>Kick</b></td><td>${key('A')}${key('B')}${key('RT')}</td><td>${key('B')}${key('Y')}</td></tr>
    <tr><td><b>Move</b></td><td colspan="2">D-pad or left stick (eight directions)</td></tr>
    <tr><td><b>Pause</b></td><td colspan="2">${key('START')}</td></tr>
  </table>
  <div class="tip" data-label="ONE-BUTTON SPECIALS">
    <p>New to fighting games? Turn on <b>Configuration &rsaquo; Special button</b>: the special key (or pad button) fires a
    special move of your robot, a different one for each direction you hold. The motions still work too.</p>
  </div>
`);
page('Controls', `
  <h2>Hotkeys</h2>
  <table>
    <tr><th style="width:30%">Key</th><th>Anywhere in the game</th></tr>
    <tr><td>${key('F1')}</td><td>Help pages</td></tr>
    <tr><td>${key('F2')}</td><td>Switch between the classic and the remastered look</td></tr>
    <tr><td>${key('F3')}</td><td>Next song, when your own music is playing</td></tr>
    <tr><td>${key('F11')} ${key('ALT')}+${key('ENTER')}</td><td>Full screen on and off</td></tr>
    <tr><td>${key('F12')} ${key('PRINT SCREEN')}</td><td>Screenshot</td></tr>
    <tr><td>${key('ESC')}</td><td>Pause in a fight; back in menus</td></tr>
  </table>
  <table>
    <tr><th style="width:30%">Key</th><th>In the training lab</th></tr>
    <tr><td>${key('F4')}</td><td>Reset the robots' positions (and the current trial)</td></tr>
    <tr><td>${key('F5')}</td><td>Take control of the dummy and record what it should do</td></tr>
    <tr><td>${key('F6')}</td><td>Play the recording back (or show a trial's demo)</td></tr>
    <tr><td>${key('F8')}</td><td>Frame data on and off</td></tr>
    <tr><td>${key('F9')}</td><td>Hitboxes on and off</td></tr>
  </table>
  <h2>The mouse</h2>
  <p>Every menu works with the mouse: point and click, right-click to go back. On a touch screen, an on-screen joystick and
  buttons appear for fights.</p>
  <figure><img src="${img('shot-menus.jpg')}"><figcaption><b>CONTROLS</b> &nbsp;Configuration &rsaquo; Controls shows every key
  of both players on a keyboard, and every button on the controller page.</figcaption></figure>
`);

// 10-11. Fighting basics.
page('Fighting basics', `
  ${title('Chapter 5', 'Fighting basics')}
  <div class="cols">
    <h2>The screen</h2>
    <p>Each pilot's <b>health</b> bar sits at the top, with the <b>endurance</b> bar beneath it. Hits take health; every hit
    you take also drains endurance. The round tokens next to the bars show the rounds won. The first to win the rounds the
    match needs takes the fight.</p>
    <h2>Moving</h2>
    <p>Walk with forward and back, jump with up (straight, forward or back), duck with down. Every direction is relative to
    where your robot faces: <b>forward</b> is always toward the opponent.</p>
    <h2>Attacking</h2>
    <p>Two buttons, <b>punch</b> and <b>kick</b>, give a different attack for each direction you hold: standing, walking,
    ducking and jumping. Try them all in the training lab: a robot's low kick, its jumping punch and its standing
    kick are three different tools.</p>
    <h2>Blocking</h2>
    <p>Hold <b>back</b> to block high and <b>down-back</b> to block low. A blocked hit does no damage, but it still pushes
    you back. Some attacks must be blocked low.</p>
    <h2>Throws</h2>
    <p>Close to the opponent, press <b>forward and punch</b> (${cmd(['6'], 'P')}) to grab and throw. Throws cannot be
    blocked, so they are the answer to a pilot who never stops blocking.</p>
    <h2>Stun</h2>
    <p>When the endurance bar runs out, your robot is <b>stunned</b>: it staggers, open to anything. Keep an eye on your
    endurance, and back off to let it recover.</p>
  </div>
  <figure style="margin-top:6pt"><img src="${img('shot-desert.jpg')}"><figcaption><b>THE SCREEN</b> &nbsp;Health on top, endurance
  below it, a round token beside them for every round won, each pilot's name and robot underneath. Steffan's Gargoyle is in trouble.</figcaption></figure>
`);
page('Fighting basics', `
  <div class="cols">
    <h2>Special moves</h2>
    <p>Every robot has special moves: projectiles, charges, flying attacks. They are entered as a quick motion followed by a
    button, like ${cmd(['2', '3', '6'], 'P')} (a quarter circle forward and punch). The original game never listed them:
    pilots found them by watching the computer. This manual lists every robot's commands, and so does the pause menu's
    <b>Move list</b>.</p>
    <h2>Combos</h2>
    <p>Hits that land before the opponent recovers chain into a <b>combo</b>: the game counts the hits on screen. Every
    robot has combos that cannot be escaped once the first hit lands. The training lab's <b>combo trials</b> teach them.</p>
    <h2>Finishing moves</h2>
    <p>Win the deciding round and your opponent's robot stands helpless for a moment. Enter the robot's <b>scrap</b> move
    to rip it apart, or its <b>destruction</b> move for something even more final. The command lists in this manual show
    both. The announcer will notice.</p>
    <h2>Pilots and robots</h2>
    <p>The same robot fights differently in different hands. A pilot's <b>power</b> makes hits stronger, <b>agility</b>
    makes the robot faster, and <b>endurance</b> makes it harder to stun.</p>
  </div>
  <div class="tip" data-label="PRO TIP">
    <p>Watch the demo (main menu &rsaquo; Demo) with the move list in mind. The computer pilots use every special move of
    their robots, and they are not shy about it.</p>
  </div>
  <figure><img src="${img('shot-knockout.jpg')}"><figcaption><b>KNOCKOUT</b> &nbsp;The final blow: a flash, a shockwave and the
  camera closing in.</figcaption></figure>
`);

// 12. The robots: the roster.
page('The robots', `
  ${title('Chapter 6', 'The robots')}
  <p class="lead">Eleven HARs, each built for a different kind of fight. Choose the one that fits the way you think.</p>
  <p>On the following pages, every robot's special moves are named as the game names them, and its <b>command list</b>
  shows how to enter them, as the pause menu's move list does: directions for a robot facing right, then the
  button (${'<span class="btn P">P</span>'} punch, ${'<span class="btn K">K</span>'} kick). A dot means back to neutral
  before the next direction.</p>
  <div style="display:grid; grid-template-columns:repeat(5,1fr); gap:5pt; margin:8pt 0">
    ${ROBOTS.slice(0, 10).map(([id], i) => `<figure style="margin:0"><img src="${img(`face-${id}.jpg`)}" style="height:.78in; object-fit:cover"><figcaption class="center"><b>${esc(L[31 + i].toUpperCase())}</b></figcaption></figure>`).join('')}
  </div>
  <div class="tip" data-label="COLORS">
    <p>In a fight, every robot wears its pilot's colors: the armor, the joints and the accents each take one of the
    pilot's three colors. The pictures in this manual show the robots in their factory paint.</p>
  </div>
  <p class="small">The robots are the same in both looks: the remaster redraws them, it does not change them. Every
  frame, every hit point and every move is the original's.</p>
  <figure style="margin-top:6pt"><img src="${img('shot-powerplant.jpg')}" style="height:1.55in; object-fit:cover"><figcaption><b>THE POWER PLANT</b> &nbsp;Christian's Shadow
  and Angel's Electra, the electrified fences lighting up the hall.</figcaption></figure>
`);
// 13-18: two robots a page (Nova last).
for (let i = 0; i < 11; i += 2) {
  page('The robots', robotBlock(i) + (i + 1 < 11 ? robotBlock(i + 1) : `
    <div class="dark" style="margin-top:.1in">
      <h3>Enhancements</h3>
      <p>In tournament play, a pilot who does well earns <b>enhancements</b> for their robot, which unlock more of its
      moves. The move list shows a move once it is unlocked.</p>
    </div>
    <figure style="margin-top:8pt"><img src="${img('shot-danger.jpg')}"><figcaption><b>THE DANGER ROOM</b> &nbsp;Jean-Paul's Nova
    against Raven's Katana, the wall spikes waiting.</figcaption></figure>`));
}

// 19. New challengers: a band each (the painted robot, its style, its commands with the specials by name).
const NEW = [
  ['glacier', 11, 'Heavyweight', 'A heavy ice juggernaut, slow, strong and hard to put down, crowned with red ice crystals. It throws spears of ice, charges shoulder first on a slide of ice and stomps frost spikes out of the floor.'],
  ['tempest', 12, 'Aerial', 'Light and fast, a wind robot with swept fins streaming back from its head. Its jumps are high and floaty: it throws whirlwinds, rises in a spinning kick that hits again and again, and dives out of the sky before you see it coming.'],
  ['helix', 13, 'Armor breaker', 'An industrial driller with a spiral drill for one arm and a claw for the other, built to break armor and dig in. It charges drill first, drives up in a corkscrew uppercut and fires its drill head across the arena like a missile.'],
  ['spectre', 14, 'Phantom', 'A phantom in a hood and a cloak of blades, with lasers built into its forearms. It fires bolts of light, fades out to reappear behind its opponent and dashes in on a kick that trails afterimages.'],
];
function newBlock([id, har, cls, text]) {
  const label = (m) => (m.kind === 'SPECIAL' || m.kind === 'AIR'
    ? m.label.charAt(0) + m.label.slice(1).toLowerCase() + (m.kind === 'AIR' ? ' (air)' : '')
    : KIND[m.kind] ?? m.kind);
  const moves = (facts.moves[har] ?? []).map((m) => `<div><span class="k">${esc(label(m))}</span>${cmd(m.inputs, m.button)}</div>`).join('');
  return `<div class="newbot">
    <img src="${img(`robot-${id}.jpg`)}">
    <div>
      <h2>${esc(L[31 + har])}</h2>
      <div class="class">${cls}</div>
      <p>${text}</p>
      <div class="cmds">${moves}</div>
    </div>
  </div>`;
}
page('New challengers', `
  ${title('Chapter 7', 'New challengers')}
  <p>Built for the Remastered Edition in the spirit of the originals, and painted in HD like them. Turn them on in
  <b>Gameplay &rsaquo; New content</b>: they join the robot select screen (a third row), the computer's opponents and the
  robots Plug offers to trade.</p>
  ${NEW.map(newBlock).join('')}
`);

// 20-21. Pilots.
const pilotCard = (i) => {
  const p = facts.pilots[i];
  const bio = i === 10
    ? 'The master of the W.A.R. tournament circuit, and its final opponent. Kreissack pilots Nova, and he has never been told no.'
    : L[135 + i];
  const bar = (label, v) => `<div class="stat"><span>${label}</span><div class="bar"><i style="width:${Math.round((v / 20) * 100)}%"></i></div></div>`;
  return `<div class="pilot"><img src="${img(`pilot-${i}.jpg`)}"><div><h3>${esc(L[20 + i])}</h3><p>${esc(bio)}</p>
    ${bar('POWER', p.power)}${bar('AGILITY', p.agility)}${bar('ENDUR.', p.endurance)}</div></div>`;
};
page('The pilots', `
  ${title('Chapter 8', 'The pilots')}
  <p>Ten pilots fight on the W.A.R. circuit. Each brings a body and a mind to the neural link: their <b>power</b>,
  <b>agility</b> and <b>endurance</b> shape every robot they pilot, and the computer plays each of them with their own
  personality.</p>
  <div class="pilots">${[0, 1, 2, 3, 4, 5].map(pilotCard).join('')}</div>
`);
page('The pilots', `
  <div class="pilots">${[6, 7, 8, 9, 10].map(pilotCard).join('')}
    <div class="tip" data-label="TOURNAMENT PILOTS" style="margin:0"><p>Tournament play has its own pilots too: dozens of
    challengers across the circuit, each with a face, a robot and a record.</p></div>
  </div>
  <figure style="width:3.05in; margin:.14in auto 0"><img src="${img('shot-pilotselect.jpg')}"><figcaption><b>CHOOSE YOUR PILOT</b> &nbsp;The
  pilot's stats and story on top, the ten pilots below. Crystal is picked.</figcaption></figure>
`);

// 22. Arenas.
const ARENAS = [
  ['Stadium', 'Where W.A.R.\'s machines get their first public testing: a steel pit under floodlights, the crowd behind the cage net.'],
  ['Danger Room', 'Spikes shoot out of the walls. Keep your opponent against them, and yourself away from them.'],
  ['Power Plant', 'Built inside a lightning-receptive power plant: the walls deliver electric shocks.'],
  ['Fire Pit', 'Holographic spheres ignite fireballs under the fighters, over a grate of glowing lava.'],
  ['The Desert', 'Golden dunes at sunset, and fighter jets strafing anything that stands still.'],
  ['Orbital', 'A space station\'s hangar deck, the Earth in the window, sparks drifting in low gravity.'],
  ['Ice Cave', 'A frozen cavern under the aurora: blowing snow, frost mist, sparkling crystals.'],
  ['Rooftop', 'A skyscraper roof in the rain above a neon city; lightning over the skyline.'],
  ['Abyss', 'A glass dome on the sea floor: rising bubbles, caustics, light from far above.'],
];
page('The arenas', `
  ${title('Chapter 9', 'The arenas')}
  <div class="arenas">${ARENAS.map(([n, t], a) => `<div class="arena"><img src="${img(`arena-${a}.jpg`)}"><h3>${n}${a >= 5 ? '<span class="new">NEW</span>' : ''}</h3><p>${t}</p></div>`).join('')}
    <div class="tip" data-label="HAZARDS" style="margin:0"><p>The arenas' hazards hit both robots alike. The <b>Gameplay</b>
    menu can turn them off.</p></div>
  </div>
`);

// 23-24. Tournament.
page('Tournament play', `
  ${title('Chapter 10', 'Tournament play')}
  <div class="cols">
    <p>The tournament is the heart of One Must Fall 2097: a career on the W.A.R. circuit, from the first qualifying bout
    to the world title.</p>
    <h2>Your pilot</h2>
    <p>Choose <b>Tournament play</b> and create a pilot: a name, a face, a robot and your three colors. Your pilot starts
    with modest skills and a little money. Careers are saved, so you can come back to them.</p>
    <h2>The circuit</h2>
    <p>Each tournament is a ladder of opponents, each with a robot, a pilot and a ranking. Beat them to climb the ladder
    and collect <b>prize money</b>. The later tournaments pay more and hit harder, and the champion of each waits at the
    top of its ladder.</p>
    <h2>The mech lab</h2>
    <p>Between fights, the <b>mech lab</b> is your garage. Spend your winnings on your robot's <b>arm and leg power</b>,
    <b>armor</b>, <b>arm and leg speed</b> and <b>stun resistance</b>, and on training your pilot's power, agility and
    endurance.</p>
    <h2>Trading robots</h2>
    <p>Plug, the mech lab's salesman, will trade your robot for another, for a price. Every robot of the circuit can be
    yours. With the new robots turned on, he sells those too.</p>
    <h2>The news</h2>
    <p>After every fight, the WRDE news tells the world what happened in the arena, and what they think of you. The
    newsreader reads each report aloud in the voice of the announcer you chose.</p>
  </div>
`);
page('Tournament play', `
  <figure><img src="${img('shot-vs.jpg')}"><figcaption><b>THE HOLDING BAY</b> &nbsp;Before every fight, the two robots face
  each other in the holding bay, and so do their pilots.</figcaption></figure>
  <h2>Custom tournaments</h2>
  <p>Make your own circuits from the installed tournaments (<b>Extras &rsaquo; Custom tournaments</b>): fewer opponents
  (spread over the ranks, the champion always among them), their robots as they were or on the new robots, more or less
  prize money. They appear in Tournament play like the others, and can be shared as <b>.omftrn</b> files.</p>
  <div class="tip" data-label="PRO TIP">
    <p>Money is tight early on. Armor and stun resistance keep you in fights you would otherwise lose; power upgrades
    end fights sooner. Do not buy a new robot until you have won with the one you have.</p>
  </div>
`);

// 25. Arcade etc.
page('Arcade modes', `
  ${title('Chapter 11', 'Arcade, survival and time attack')}
  <p>Under <b>Extras</b>, three modes for pilots who want a straight fight and a score to beat:</p>
  <table>
    <tr><th style="width:26%">Mode</th><th>How it works</th></tr>
    <tr><td><b>Arcade</b></td><td>Eight fights, the computer better and better each time. Major Kreissack is last.</td></tr>
    <tr><td><b>Survival</b></td><td>One round against one opponent after another, with only the health you have left.
    How far can you go?</td></tr>
    <tr><td><b>Time attack</b></td><td>Five fights against the clock.</td></tr>
  </table>
  <h2>Records and achievements</h2>
  <p><b>Extras &rsaquo; Records</b> keeps your statistics (fights, wins, knockouts, finishers, your favorite robots) and the
  best results of each mode. Twenty <b>achievements</b> wait to be earned, announced with a banner the moment you get
  them. They are for bragging rights only: nothing in the game is locked behind them.</p>
  <h2>Victory screens</h2>
  <p>After one and two player fights, the winner gets a victory screen: the pilot's portrait, the robot, a line for the
  loser, and the fight in numbers (rounds, time, hits, accuracy, best combo, perfects and finishers).</p>
  <figure><img src="${img('shot-stadium.jpg')}"><figcaption><b>THE STADIUM</b> &nbsp;Shirro's Jaguar and Cossette's Flail open the evening.</figcaption></figure>
`);

// 26. Training lab.
page('The training lab', `
  ${title('Chapter 12', 'The training lab')}
  <p><b>Training</b> puts you against a dummy that never gets knocked out, with health refilling after every combo. The
  pause menu's <b>Training lab</b> holds the tools:</p>
  <ul>
    <li><b>Frame data</b> ${key('F8')}: a frame meter for both robots and the startup, active and recovery frames of your
    last move, with your advantage after it hit or was blocked.</li>
    <li><b>Hitboxes</b> ${key('F9')}: what can be hit and where attacks hit. Hits in this game are pixel exact.</li>
    <li><b>Record the dummy</b> ${key('F5')} / ${key('F6')}: take control of the dummy, record up to 25 seconds, and let it
    play back over and over.</li>
    <li><b>Reversals</b>: the dummy answers on the first possible frame after a hit, a block or a knockdown.</li>
    <li><b>Combo trials</b> for every robot, each with a demo, from its special moves to its hardest combos.</li>
    <li>The <b>input display</b> lists your recent inputs and how long each was held.</li>
  </ul>
  <figure><img src="${img('shot-training.jpg')}"><figcaption><b>THE LAB</b> &nbsp;Frame meter on top, inputs on the left, the
  last hit and the combo at the bottom.</figcaption></figure>
`);

// 27. Replays and workshop.
page('Replays and workshop', `
  ${title('Chapter 13', 'Replays and the robot workshop')}
  <div class="two">
    <div>
      <h2>Replays</h2>
      <p><b>Every fight is saved.</b> Extras &rsaquo; Replays keeps the last 40, plus any you mark to keep. Watch at any
      speed from &frac14; to 4&times;, pause, step frame by frame, jump anywhere on the timeline. Mark a clip and save it as an
      <b>MP4 video</b> with the game's sound, or as an <b>animated GIF</b>. Replays are shared as <b>.rec</b> files, the
      original game's own recording format.</p>
    </div>
    <div>
      <h2>The robot workshop</h2>
      <p>Build your own robots from the new robots' parts: the frame of one, the head of another, the special moves and
      finishers of a third, a size, a weight class and three colors, with a live picture as you go. The game builds a
      complete fighter on the spot, ready to try in training or against the computer. Share them as <b>.omfbot</b> files.</p>
    </div>
  </div>
  <figure><img src="${img('shot-replay.jpg')}" style="height:1.85in; object-fit:cover; object-position:center 70%"><figcaption><b>INSTANT REPLAY</b> &nbsp;Helix against Spectre in the Abyss, with the
  replay controls.</figcaption></figure>
  <figure><img src="${img('shot-workshop.jpg')}" style="height:1.9in; object-fit:cover; object-position:center 30%"><figcaption><b>THE WORKSHOP</b>
  &nbsp;A Spectre frame, a Tempest's moves, orange accents: pick the parts, see the robot.</figcaption></figure>
`);

// 28. The remastered look.
page('The remastered look', `
  ${title('Chapter 14', 'The remastered look')}
  <div class="two" style="gap:.1in">
    <figure><img src="${img('shot-classic.jpg')}"><figcaption><b>CLASSIC</b> &nbsp;320 &times; 200, 256 colors: exactly as in 1994.</figcaption></figure>
    <figure><img src="${img('shot-remastered.jpg')}"><figcaption><b>REMASTERED</b> &nbsp;The same frame, in HD and widescreen.</figcaption></figure>
  </div>
  <p>${key('F2')} switches between the two looks at any time. The <b>classic</b> look is the original drawing pipeline,
  pixel for pixel, with sharp, smooth or CRT scanline scaling. The <b>remastered</b> look draws every picture in high
  definition from 3,200+ redrawn images, and keeps every palette effect of the original working: player colors, fades,
  flashes and tints.</p>
  <h2>Remastered effects</h2>
  <p>Fights get a layer of modern effects driven by what happens in the fight: sparks and flares on hits, light from
  impacts, fire and projectiles, shockwaves, the knockout camera, and each arena's own atmosphere (embers, blowing sand,
  floodlights, snow, rain, bubbles). They never change the fight itself. Each group can be switched off in
  <b>Configuration &rsaquo; Video options &rsaquo; Remastered options</b>, along with bloom, the fight camera, the HUD
  style and the typeface.</p>
  <p>In widescreen the arena reaches past the original screen, but the fight stays inside it: faint <b>energy
  curtains</b> mark its edges, glowing where a robot is held against them and rippling when one is slammed into them.</p>
  <div class="tip" data-label="SLOW COMPUTER?">
    <p>The game lowers its resolution by itself when the graphics card struggles. For the fastest game, press ${key('F2')}:
    the classic look runs on anything.</p>
  </div>
`);

// 29. Tips.
page('Tips from the pros', `
  ${title('Chapter 15', 'Tips from the pros')}
  <div class="cols">
    <h3>1. Learn one robot</h3>
    <p>Every robot plays differently. Pick one, learn its special moves in the training lab, and win with it before you
    try the next.</p>
    <h3>2. Block low</h3>
    <p>Most pilots attack low more than they think. Crouch blocking stops sweeps and low kicks; jump-ins you can see coming.</p>
    <h3>3. Throw the turtle</h3>
    <p>An opponent who blocks everything cannot block a throw. Walk in and grab.</p>
    <h3>4. Watch the endurance bar</h3>
    <p>Yours and theirs. A stunned robot is a free combo: be the one landing it.</p>
    <h3>5. Use the arena</h3>
    <p>Wall spikes, electric fences and jets do not care whose side they are on. Put the other robot between you and them.</p>
    <h3>6. Mind the pilot</h3>
    <p>A quick pilot makes a fast robot faster; a strong one turns a light robot into a hitter. Try the same robot with
    three different pilots.</p>
    <h3>7. Read the frame data</h3>
    <p>If a move leaves you at a disadvantage after it is blocked, stop throwing it out. The training lab's frame meter
    tells you which moves are safe.</p>
    <h3>8. Spend wisely</h3>
    <p>In tournaments, put your first prize money into the upgrades that keep you winning, not into a shiny new robot.</p>
    <h3>9. Watch the computer</h3>
    <p>The computer pilots use every special move of their robots. The demo mode is the oldest strategy guide there is.</p>
  </div>
  <figure style="margin-top:8pt"><img src="${img('shot-icecave.jpg')}"><figcaption><b>THE ICE CAVE</b> &nbsp;Five consecutive
  hits: Ibrahim's Glacier against Milano's Tempest.</figcaption></figure>
`);

// 30. Troubleshooting.
page('Troubleshooting', `
  ${title('Chapter 16', 'Troubleshooting')}
  <table>
    <tr><th style="width:38%">Problem</th><th>Solution</th></tr>
    <tr><td><b>Windows says it protected my PC.</b></td><td>The download is not signed yet. Choose <b>More info</b>, then <b>Run anyway</b>.</td></tr>
    <tr><td><b>The game runs slowly.</b></td><td>Press ${key('F2')} for the classic look, or turn off effects in the remastered options.</td></tr>
    <tr><td><b>My gamepad does nothing.</b></td><td>Press any button on it once: the game only sees a pad after a button press. Check <b>Configuration &rsaquo; Controls</b>.</td></tr>
    <tr><td><b>There is no sound.</b></td><td>Click or press a key once: browsers only start sound after you do. Check the audio options' volumes.</td></tr>
    <tr><td><b>Where are my screenshots?</b></td><td>In <b>Downloads\\OMF 2097 Remastered</b>, with exported replays and clips.</td></tr>
    <tr><td><b>I cannot find Nova.</b></td><td>That is between you and the robot select screen.</td></tr>
  </table>
  <div class="dark">
    <h3>Your monitor's too bright!</h3>
    <p>Pilots of the original game who turned their monitors all the way up found a message hidden in the crowd on the
    main menu. It is still there in the remaster, painted into the front row. Look closely.</p>
  </div>
  <div class="tip" data-label="TRIVIA">
    <p>The game's own text file still holds a placeholder for the final boss's biography, left in by the original
    developers: <i>"Boss guy's description. This really won't be seen, but we'll make space for it anyway."</i> They were
    right: it never appears in the game. It does now, in this manual.</p>
  </div>
`);

// 31. Credits.
page('Credits', `
  ${title('Chapter 17', 'Credits')}
  <h2>One Must Fall 2097</h2>
  <p>&copy; 1994 <b>Diversions Entertainment</b>. Published by <b>Epic MegaGames</b>. Freeware since 1999. The original
  team's credits roll at the end of the game: finish the tournament to see them.</p>
  <h2>The Remastered Edition</h2>
  <table>
    <tr><td style="width:44%"><b>Human coder</b></td><td>Jared Woodruff</td></tr>
    <tr><td><b>AI coder</b></td><td>Claude Opus 5.5 (Max Mode)</td></tr>
    <tr><td><b>AI image rendering</b></td><td>OpenAI GPT6-ASTRA (Ultra Mode)</td></tr>
    <tr><td><b>Credits theme</b></td><td><i>Twenty Ninety-Seven (Remix)</i> by Hadal Static</td></tr>
    <tr><td><b>Announcers</b></td><td>Victor and Kristen, from the ElevenLabs voice library</td></tr>
  </table>
  <h2>Built with</h2>
  <p class="small">The reverse engineering of the <b>OpenOMF</b> project; <b>Orbitron</b> by Matt McInerney and The League
  of Moveable Type; Hyllian's <b>xBR</b> shader; <b>ElevenLabs</b> for the announcers' voices, <b>FFmpeg</b>; <b>Tauri</b>,
  <b>Vite</b>, <b>TypeScript</b> and <b>Vitest</b>. The full list is in the game: <b>Extras &rsaquo; Credits</b>.</p>
  <div class="warn" style="margin-top:8pt">
    <h3>NEVER PAY FOR THIS GAME</h3>
    <p class="small">One Must Fall 2097 is freeware: its owners let everyone share it, as long as nobody charges for it. The
    game's files and the artwork made from them come with this remaster on those terms. The remaster's source code is MIT
    licensed. This is an unofficial fan project, not affiliated with or endorsed by the original authors. All trademarks
    belong to their owners.</p>
  </div>
  <p class="center small" style="margin-top:8pt"><i>github.com/Jared-woodruff/OMF-2097-Remastered</i></p>
  <figure style="margin-top:6pt"><img src="${img('shot-credits.jpg')}" style="height:1.55in; object-fit:cover; object-position:center 42%">
  <figcaption><b>EXTRAS &rsaquo; CREDITS</b> &nbsp;The remaster's credits are fought out: every credit pilots a robot in its own
  colors and wins a quick, brutal fight, to Hadal Static's <i>Twenty Ninety-Seven (Remix)</i>.</figcaption></figure>
`);

// 32. Back cover.
const bars = Array.from({ length: 46 }, (_, i) => `<i style="width:${1 + ((i * 7) % 3)}pt"></i>`).join('');
raw(`<section class="page back">
  <div class="body" style="top:.4in; bottom:.4in">
    <div class="collage">
      <img src="${img('shot-desert.jpg')}" style="left:0; top:.1in; transform:rotate(-4deg)">
      <img src="${img('shot-powerplant.jpg')}" style="right:0; top:.55in; transform:rotate(3deg)">
      <img src="${img('shot-icecave.jpg')}" style="left:.15in; top:1.75in; transform:rotate(2deg)">
      <img src="${img('shot-danger.jpg')}" style="right:.1in; top:2.15in; transform:rotate(-3deg)">
    </div>
    <h1 style="background:none; color:#fff; -webkit-text-fill-color:#fff; margin-top:.15in">Ninety-foot robots.<br>One must fall.</h1>
    <p>The 1994 robot fighting classic, rebuilt for today's computers: the original game, pixel for pixel, and a
    remastered edition in HD, one key apart.</p>
    <div class="feats">
      <div class="feat">15 ROBOTS<small>The original eleven and four new challengers</small></div>
      <div class="feat">9 ARENAS<small>Spikes, electric fences, fireballs and jets</small></div>
      <div class="feat">TOURNAMENT CAREER<small>Prize money, upgrades, the mech lab</small></div>
      <div class="feat">TRAINING LAB<small>Frame data, hitboxes, combo trials</small></div>
      <div class="feat">REPLAYS &amp; CLIPS<small>Every fight saved, MP4 and GIF</small></div>
      <div class="feat">ROBOT WORKSHOP<small>Build your own HARs</small></div>
    </div>
  </div>
  <div class="barcode">${bars}<div>0 97 2097 07 1994</div></div>
  <div class="burst" style="left:.3in; bottom:.3in; width:1.05in; height:1.05in; font-size:6pt"><span><b>FREE</b>Freeware since 1999</span></div>
</section>`);

// ---- print ---------------------------------------------------------------------------------------------------------------

const html = `<!doctype html><html><head><meta charset="utf-8"><title>One Must Fall 2097 Remastered: Game Manual</title>
<meta name="author" content="Jared Woodruff"><meta name="subject" content="The game manual of One Must Fall 2097 Remastered">
<link rel="stylesheet" href="${pathToFileURL(path.join(HERE, 'manual.css')).href}"></head><body>${pages.join('\n')}</body></html>`;
const htmlFile = path.join(HERE, '.build', 'manual.html');
fs.mkdirSync(path.dirname(htmlFile), { recursive: true });
fs.writeFileSync(htmlFile, html);
fs.writeFileSync(path.join(HERE, '.build', 'README.txt'), 'Generated by tools/manual/build.mjs (not committed).\n');
console.log(`manual: ${pages.length} pages`);

const port = 9361;
const profile = path.join(WORK, 'profile');
const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--allow-file-access-from-files', 'about:blank'],
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
await send('Page.enable');
await send('Page.navigate', { url: pathToFileURL(htmlFile).href });
for (let i = 0; i < 100 && !events.some((m) => m.method === 'Page.loadEventFired'); i++) await sleep(100);
await send('Runtime.evaluate', { expression: 'document.fonts.ready.then(() => 1)', awaitPromise: true });
await sleep(500);
// Pages whose content does not fit.
const check = await send('Runtime.evaluate', {
  returnByValue: true,
  expression: `[...document.querySelectorAll('.page')].map((p, i) => { const b = p.querySelector('.body'); if (!b) return null;
    const over = b.scrollHeight - b.clientHeight; const cols = [...b.querySelectorAll('.cols')].some((c) => c.scrollWidth > c.clientWidth + 2);
    return over > 1 || cols ? { page: i + 1, over, cols } : null; }).filter(Boolean)`,
});
const overflow = check.result.result.value;
if (overflow.length) console.log('manual: pages that do not fit:', JSON.stringify(overflow));
// (streamed: a PDF this size is too big for one protocol message)
const pdf = await send('Page.printToPDF', { printBackground: true, preferCSSPageSize: true, marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0,
  displayHeaderFooter: false, transferMode: 'ReturnAsStream' });
if (!pdf.result) throw new Error(`printing failed: ${JSON.stringify(pdf.error)}`);
const chunks = [];
for (;;) {
  const part = await send('IO.read', { handle: pdf.result.stream, size: 1 << 20 });
  chunks.push(Buffer.from(part.result.data, part.result.base64Encoded ? 'base64' : 'utf8'));
  if (part.result.eof) break;
}
await send('IO.close', { handle: pdf.result.stream });
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, Buffer.concat(chunks));
ws.close();
// Close the browser itself (the process we started may already have handed over to another one), then make sure.
try {
  const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const bws = new WebSocket(webSocketDebuggerUrl);
  await new Promise((res, rej) => { bws.onopen = res; bws.onerror = rej; });
  bws.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
  await sleep(800);
} catch {}
if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(edge.pid), '/T', '/F'], { stdio: 'ignore' });
else edge.kill();
console.log(`manual: ${path.relative(ROOT, OUT)} (${Math.round(fs.statSync(OUT).size / 1024)} KB)`);
