import fs from 'node:fs';
import { describe, it } from 'vitest';
import { parseAF } from '../../formats/af';
import { getFile } from '../../resources/files';
import { hasGameData, loadGameData } from '../../test/harness';

describe.skipIf(!process.env.MOVE_DUMP || !hasGameData)('move dump', () => {
  it('dumps', () => {
    loadGameData();
    const lines: string[] = [];
    for (let h = 0; h < 11; h++) {
      const af = parseAF(getFile(`FIGHTR${h}.AF`));
      lines.push(`==== HAR ${h} health ${af.health} end ${af.endurance} fwd ${af.forwardSpeed} rev ${af.reverseSpeed} jump ${af.jumpSpeed} fall ${af.fallSpeed} ujfl ${af.upwardsJumpFrameLimit} fid ${af.fighterId} ew ${af.execWindow}`);
      lines.push(`sounds ${[...af.soundTable].join(',')}`);
      af.moves.forEach((m, id) => {
        if (!m || id < 15 || id === 48 || id === 49 || id >= 55) return;
        lines.push(`${id} cat ${m.category} "${m.moveString}" dmg ${m.damageAmount} bs ${m.blockStun} succ ${m.successorId} next ${m.playIfHit} thr ${m.throwDuration} ess ${m.extraStringSelector} pos ${m.posConstraint}`);
        lines.push(`   ${m.animation.animString}`);
        if (m.footerString) lines.push(`   F: ${m.footerString}`);
      });
    }
    fs.writeFileSync(process.env.MOVE_DUMP!, lines.join('\n'));
  });
});
