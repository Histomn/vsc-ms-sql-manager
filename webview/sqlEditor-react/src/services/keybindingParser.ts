/**
 * Converts keybinding strings such as "ctrl+shift+e" or "f5, ctrl+enter"
 * into Monaco key chords.
 *
 * Modifiers: ctrl, cmd, meta, ctrlcmd (all map to Monaco's CtrlCmd, so
 * "ctrl+enter" becomes Cmd+Enter on macOS), alt, shift.
 * Keys: a-z, 0-9, f1-f12, enter, space, tab, escape, backspace, delete,
 * insert, home, end, pageup, pagedown, up, down, left, right.
 */

export interface MonacoKeyApi {
  KeyCode: Record<string, number>;
  KeyMod: { CtrlCmd: number; Shift: number; Alt: number; WinCtrl: number };
}

const NAMED_KEYS: Record<string, string> = {
  enter: 'Enter',
  return: 'Enter',
  space: 'Space',
  tab: 'Tab',
  escape: 'Escape',
  esc: 'Escape',
  backspace: 'Backspace',
  delete: 'Delete',
  del: 'Delete',
  insert: 'Insert',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  up: 'UpArrow',
  down: 'DownArrow',
  left: 'LeftArrow',
  right: 'RightArrow',
};

function resolveKeyName(key: string): string | null {
  if (/^[a-z]$/.test(key)) return `Key${key.toUpperCase()}`;
  if (/^[0-9]$/.test(key)) return `Digit${key}`;
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(key)) return key.toUpperCase();
  return NAMED_KEYS[key] ?? null;
}

/** Parses one chord, e.g. "ctrl+shift+e". Returns null if it is invalid. */
export function parseKeybinding(input: string, api: MonacoKeyApi): number | null {
  const parts = input
    .toLowerCase()
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;

  let mods = 0;
  let keyCode: number | null = null;

  for (const part of parts) {
    switch (part) {
      case 'ctrl':
      case 'control':
      case 'cmd':
      case 'meta':
      case 'ctrlcmd':
        mods |= api.KeyMod.CtrlCmd;
        break;
      case 'shift':
        mods |= api.KeyMod.Shift;
        break;
      case 'alt':
      case 'option':
        mods |= api.KeyMod.Alt;
        break;
      default: {
        if (keyCode !== null) return null; // more than one non-modifier key
        const name = resolveKeyName(part);
        const code = name ? api.KeyCode[name] : undefined;
        if (code === undefined) return null;
        keyCode = code;
      }
    }
  }

  return keyCode === null ? null : mods | keyCode;
}

/** Parses a comma-separated list of chords, skipping invalid entries. */
export function parseKeybindings(input: string | undefined, api: MonacoKeyApi): number[] {
  if (!input) return [];
  return input
    .split(',')
    .map((s) => parseKeybinding(s, api))
    .filter((v): v is number => v !== null);
}
