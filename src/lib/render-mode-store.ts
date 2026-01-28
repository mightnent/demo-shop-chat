export type RenderMode = "classic" | "mcp-apps";

let currentMode: RenderMode = "classic";
const listeners: Set<() => void> = new Set();

export const renderModeStore = {
  getMode: () => currentMode,
  setMode: (mode: RenderMode) => {
    currentMode = mode;
    listeners.forEach((listener) => listener());
  },
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
