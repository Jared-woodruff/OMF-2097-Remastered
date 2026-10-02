// Pilots' words the language file does not have: what they say after winning, on the victory screen (the remaster's
// words: the original game has no victory screen), and the ending of a mod pilot that brings none. A mod pilot brings
// its own (pilot.json "quotes" and "ending"); OMF Studio copies these into a copy of an original.

/** Three lines for each of the eleven pilots (after their biographies), and some for anybody else. */
export const WIN_QUOTES: string[][] = [
  ['I did not come this far to lose to you.', 'Every win brings me closer to the truth.', 'Get up. I have fought worse on my own.'],
  ['Young? Sure. Slow? Never.', 'Did you think the kid would be easy?', 'Tell the veterans I am coming for them next.'],
  ['Too slow. Way too slow.', 'One, two, down. That is kickboxing.', 'You blinked. I did not.'],
  ['Sorry about your robot. And your pride.', 'Attack, attack, attack. It never fails.', 'Smile for the cameras. They came to see me.'],
  ['Ha! These old bones still have some fight in them.', 'Power comes with patience, young one.', 'Come back after a few more birthdays.'],
  ['Everything went exactly as I planned.', 'You fought fair. That was your mistake.', 'I knew every move before you made it.'],
  ['A good fight. Learn from it, and come back stronger.', 'Endurance wins the long race, my friend.', 'Rest now. We train again tomorrow.'],
  ['...', 'You will not remember my name. Only the defeat.', 'Leave me be.'],
  ['The arena took my legs. It will not take my wins.', 'Careful fighters live longer. Remember that.', 'Hope was your first mistake.'],
  ['Crawl back to wherever you came from.', 'Kreissack sends his regards.', 'That was not a fight. That was a lesson.'],
  ['The future belongs to WAR.', 'Flesh is weak. Steel endures.', 'You were never a threat. Only a test.'],
];
export const ANY_WIN_QUOTES = ['Victory!', 'Another one for the record books.', 'Next!', 'Is that all you had?'];

/** A mod pilot's ending when it brings none: the story, and the last line. */
export const MOD_ENDING: [string, string] = [
  'Ganymede and everything WAR built on it now answer to you. The crowds chant your name as you leave the arena, ' +
    'no longer a challenger.\nSomewhere in the stands, the next one is already watching you.',
  'As you fly towards the moon, you wonder what comes next. Whatever it is, you will be ready.',
];
