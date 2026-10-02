// Tournament selection dashboard. Port of the reference mechlab/lab_dash_trnselect.c.
import type { TournamentFile } from '../../../formats/tournament';
import { TrnSelect } from '../../gui/trnSelect';
import type { Component } from '../../gui/widgets';
import { XYSizer } from '../../gui/xySizer';
import type { MechlabScene } from '../mechlab';

/** trnselect_widgets */
export interface TrnselectWidgets {
  trnselect: TrnSelect | null;
}

/** lab_dash_trnselect_select() */
export function labDashTrnselectSelect(_c: Component, _tw: TrnselectWidgets): boolean {
  return true;
}

/** lab_dash_trnselect_left() */
export function labDashTrnselectLeft(_c: Component, tw: TrnselectWidgets): boolean {
  tw.trnselect?.prev();
  return true;
}

/** lab_dash_trnselect_right() */
export function labDashTrnselectRight(_c: Component, tw: TrnselectWidgets): boolean {
  tw.trnselect?.next();
  return true;
}

/** lab_dash_trnselect_selected() */
export function labDashTrnselectSelected(tw: TrnselectWidgets): TournamentFile | null {
  return tw.trnselect?.getSelected() ?? null;
}

/** lab_dash_trnselect_create() */
export function labDashTrnselectCreate(_s: MechlabScene, tw: TrnselectWidgets): XYSizer {
  const xy = new XYSizer();
  tw.trnselect = new TrnSelect();
  xy.attachAt(tw.trnselect, -1, -1, -1, -1);
  return xy;
}
