import { create } from "zustand";
import { persist } from "zustand/middleware";

export type UiProfile = "terminal" | "friendly" | "sleek" | "bloomberg";
export type Colorway = "signal" | "amber" | "aqua" | "violet";

type ThemeState = {
  uiProfile: UiProfile;
  colorway: Colorway;
  setUiProfile: (profile: UiProfile) => void;
  setColorway: (colorway: Colorway) => void;
};

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      uiProfile: "terminal",
      colorway: "signal",
      setUiProfile: (profile) => set({ uiProfile: profile }),
      setColorway: (colorway) => set({ colorway }),
    }),
    {
      name: "tc-theme-preferences",
    }
  )
);
