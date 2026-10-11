// Pilots' words the language file does not have: what they say after winning, on the victory screen (the remaster's
// words: the original game has no victory screen), and the ending of a mod pilot that brings none. A mod pilot brings
// its own (pilot.json "quotes" and "ending"); OMF Studio copies these into a copy of an original.
import { trKey } from '../i18n/i18n';

/** Three lines for each of the eleven pilots (after their biographies), and some for anybody else. */
export const WIN_QUOTES: string[][] = [
  [trKey('I did not come this far to lose to you.'), trKey('Every win brings me closer to the truth.'), trKey('Get up. I have fought worse on my own.')],
  [trKey('Young? Sure. Slow? Never.'), trKey('Did you think the kid would be easy?'), trKey('Tell the veterans I am coming for them next.')],
  [trKey('Too slow. Way too slow.'), trKey('One, two, down. That is kickboxing.'), trKey('You blinked. I did not.')],
  [trKey('Sorry about your robot. And your pride.'), trKey('Attack, attack, attack. It never fails.'), trKey('Smile for the cameras. They came to see me.')],
  [trKey('Ha! These old bones still have some fight in them.'), trKey('Power comes with patience, young one.'), trKey('Come back after a few more birthdays.')],
  [trKey('Everything went exactly as I planned.'), trKey('You fought fair. That was your mistake.'), trKey('I knew every move before you made it.')],
  [trKey('A good fight. Learn from it, and come back stronger.'), trKey('Endurance wins the long race, my friend.'), trKey('Rest now. We train again tomorrow.')],
  [trKey('...'), trKey('You will not remember my name. Only the defeat.'), trKey('Leave me be.')],
  [trKey('The arena took my legs. It will not take my wins.'), trKey('Careful fighters live longer. Remember that.'), trKey('Hope was your first mistake.')],
  [trKey('Crawl back to wherever you came from.'), trKey('Kreissack sends his regards.'), trKey('That was not a fight. That was a lesson.')],
  [trKey('The future belongs to WAR.'), trKey('Flesh is weak. Steel endures.'), trKey('You were never a threat. Only a test.')],
];
export const ANY_WIN_QUOTES = [trKey('Victory!'), trKey('Another one for the record books.'), trKey('Next!'), trKey('Is that all you had?')];

/** A mod pilot's ending when it brings none: the story, and the last line. */
export const MOD_ENDING: [string, string] = [
  trKey('Ganymede and everything WAR built on it now answer to you. The crowds chant your name as you leave the arena, no longer a challenger.\nSomewhere in the stands, the next one is already watching you.'),
  trKey('As you fly towards the moon, you wonder what comes next. Whatever it is, you will be ready.'),
];
