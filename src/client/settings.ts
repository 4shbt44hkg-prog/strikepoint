// Player settings, persisted to localStorage.

export interface Settings {
  sens: number;     // mouse sensitivity multiplier
  autoFire: boolean;
  aimAssist: boolean; // magnetized aim toward enemies near the crosshair
  volume: number;   // 0..1
}

const KEY = "strikepoint_settings";

export const settings: Settings = {
  sens: 1,
  autoFire: true,
  aimAssist: true,
  volume: 0.7,
  ...((): Partial<Settings> => {
    try {
      return JSON.parse(localStorage.getItem(KEY) ?? "{}");
    } catch {
      return {};
    }
  })(),
};

export function saveSettings(): void {
  localStorage.setItem(KEY, JSON.stringify(settings));
}
