// New pilot name entry dashboard. Port of the reference mechlab/lab_dash_newplayer.c.
import { bkGetInfo, langGet } from '../../../resources/resources';
import { componentSelect } from '../../gui/sizer';
import { SpriteImage } from '../../gui/spriteImage';
import { FontSize, HAlign } from '../../gui/text';
import { TextInput } from '../../gui/textinput';
import { Label } from '../../gui/widgets';
import { XYSizer } from '../../gui/xySizer';
import type { MechlabScene } from '../mechlab';

/** newplayer_widgets */
export interface NewplayerWidgets {
  input: TextInput | null;
}

/** lab_dash_newplayer_textinput_filter(): no dots (they would end up in the save file name). */
function labDashNewplayerTextinputFilter(c: string): boolean {
  return c !== '.';
}

/** lab_dash_newplayer_create() */
export function labDashNewplayerCreate(s: MechlabScene, nw: NewplayerWidgets): XYSizer {
  const xy = new XYSizer();

  // Background name box
  const mainSheets = bkGetInfo(s.bk, 1)!.ani;
  const msprite = mainSheets.getSprite(5)!;
  xy.attachAt(new SpriteImage(msprite.surface), msprite.posX, msprite.posY, -1, -1);

  // Dialog text
  const label = new Label(langGet(192));
  label.font = FontSize.SMALL;
  xy.attachAt(label, 110, 43, 100, 50);

  // Input field
  const input = new TextInput(16, 'Name', '');
  input.setFont(FontSize.SMALL);
  input.setHorizontalAlign(HAlign.LEFT);
  input.setFilterCb(labDashNewplayerTextinputFilter);
  input.setWheelCharset(' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');
  input.setEditByDefault(true);
  componentSelect(input, true);
  input.enableBackground(false);
  xy.attachAt(input, 114, 62, 120, 8);
  nw.input = input;

  return xy;
}
