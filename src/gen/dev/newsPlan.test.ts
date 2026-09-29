// Development: writes the newsreader's recording plan (src/gen/dev/newsPlan.ts) for tools/make-news.py.
//   NEWS_PLAN=plan.json npx vitest run src/gen/dev/newsPlan.test.ts      (npm run news:voice runs it)
import fs from 'node:fs';
import { it } from 'vitest';
import { hasGameData, loadGameData } from '../../test/harness';
import { buildNewsPlan } from './newsPlan';

it.skipIf(!hasGameData || !process.env.NEWS_PLAN)('newsreader plan', () => {
  loadGameData();
  fs.writeFileSync(process.env.NEWS_PLAN!, JSON.stringify(buildNewsPlan(), null, 1));
});
