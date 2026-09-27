// Tournament chooser: the logo and description of one tournament at a time (port of the reference gui/trnselect.c).
// While it exists, palette colors 128..167 hold the selected tournament's colors; the previous palette is restored
// when it is freed.
import type { TournamentFile, TournamentLocale } from '../../formats/tournament';
import { trnlistInit } from '../../resources/trnmanager';
import { video } from '../../video/draw';
import { Surface } from '../../video/surface';
import { vga } from '../../video/vga';
import { FontSize, HAlign, VAlign } from './text';
import { Component, Label, type GuiTheme } from './widgets';

interface LogoImage {
  surface: Surface;
  posX: number;
  posY: number;
}

function logoImage(trn: TournamentFile): LogoImage {
  const logo = trn.locales[0].logo;
  const surface = Surface.fromSprite(logo);
  surface.source = { kind: 'sprite', key: `${trn.filename}/logo` };
  return { surface, posX: logo.posX, posY: logo.posY };
}

export class TrnSelect extends Component {
  img: LogoImage | null = null;
  tournaments: TournamentFile[] = [];
  label: Label | null = null;
  selectedIndex = 0;

  /** trnselect_create() */
  constructor() {
    super();
    this.supportsDisable = false;
    this.supportsSelect = false;
  }

  override render(): void {
    if (this.img) video.draw(this.img.surface, this.x + this.img.posX, this.y + this.img.posY);
    this.label?.render();
  }

  /** load_description() */
  private loadDescription(theme: GuiTheme, locale: TournamentLocale): void {
    this.label?.free();
    const label = new Label(locale.strippedDescription);
    label.halign = HAlign.CENTER;
    label.valign = VAlign.MIDDLE;
    label.font = FontSize.SMALL;
    label.overrideColor = 0xa5; // WAR invitational seems to use this color, none is specified
    if (locale.descColor >= 0) label.overrideColor = locale.descColor;
    let x = 0;
    if (locale.descCenter !== 0) x = locale.descCenter - Math.trunc(locale.descWidth / 2);
    else if (locale.descWidth !== 320) x = Math.trunc((320 - locale.descWidth) / 2);
    label.init(theme);
    label.layout(x, locale.descVmove, locale.descWidth, 130 - locale.descVmove);
    this.label = label;
  }

  private showSelected(theme: GuiTheme): void {
    const trn = this.getSelected();
    if (!trn || !trn.locales[0]) return;
    vga.setBasePaletteRange(trn.palette, 128, 128, 40);
    this.loadDescription(theme, trn.locales[0]);
    this.img = logoImage(trn);
  }

  /** trnselect_next() */
  next(): void {
    this.selectedIndex++;
    if (this.selectedIndex >= this.tournaments.length) this.selectedIndex = 0;
    this.showSelected(this.theme);
  }

  /** trnselect_prev() */
  prev(): void {
    this.selectedIndex--;
    if (this.selectedIndex < 0) this.selectedIndex = this.tournaments.length - 1;
    this.showSelected(this.theme);
  }

  /** trnselect_selected() */
  getSelected(): TournamentFile | null {
    return this.tournaments[this.selectedIndex] ?? null;
  }

  /** trnselect_init() */
  override init(theme: GuiTheme): void {
    super.init(theme);
    this.tournaments = trnlistInit();
    this.img = null;
    this.label = null;
    vga.pushPalette(); // Backup the current palette
    this.showSelected(theme);
  }

  /** trnselect_free() */
  override free(): void {
    vga.popPalette(); // Recover previous palette
    this.img = null;
    this.label?.free();
    this.label = null;
  }
}
