// Helpers shared by the main menu and its submenus (small pieces of the reference GUI/menu glue).
import { app } from '../../../app';
import { langGet } from '../../../resources/resources';
import type { Component, Menu } from '../../gui/widgets';
import { saveSettings } from '../../settings';

/** `sizer_get_obj(c->parent)`: the menu a widget is attached to. */
export function parentMenu(c: Component): Menu {
  return c.parent as Menu;
}

/** The common DONE button callback of the reference submenus (`m->finished = 1`). */
export function menuDone(c: Component): void {
  parentMenu(c).finished = true;
}

/** `lang_get()`: the reference strips the trailing newline of every string when it loads the language file. */
export function lang(id: number): string {
  return langGet(id).replace(/\n$/, '');
}

/**
 * Called whenever a menu changes a setting. The reference only saves when the main menu is freed; we also save
 * immediately (a browser tab can be closed at any time) and let the host apply video/audio changes.
 */
export function settingsChanged(): void {
  saveSettings();
  app.settingsChanged();
}

/**
 * Port of `menu_link_menu()`: shows `linked` as the submenu of `parent`, laid out in its own frame rectangle
 * instead of the parent's. Unlike `menu_set_submenu()` the linked menu is not flagged as a submenu, so ESC first
 * selects its last entry (DONE) and only a second ESC leaves it.
 */
export function menuLinkMenu(parent: Menu, linked: Menu, x: number, y: number, w: number, h: number): void {
  parent.setSubmenu(linked); // frees the previous submenu, resets the done state, inits with the parent's theme
  linked.isSubmenu = false;
  linked.layout(x, y, w, h);
}

/** The innermost menu that currently receives input (following active submenus). */
export function activeMenu(m: Menu): Menu {
  let cur = m;
  for (let sub = cur.activeSubmenu(); sub; sub = cur.activeSubmenu()) cur = sub;
  return cur;
}
