import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeProvider, useTheme } from "../ThemeProvider";
import { initHoudiniThemeEngine } from "@/src/lib/theme/houdiniThemeEngine";

jest.mock("@/src/lib/theme/houdiniThemeEngine", () => ({
  initHoudiniThemeEngine: jest.fn(async () => ({
    usingHoudini: true,
    source: "fallback",
    tokens: {
      background: "#000",
      foreground: "#fff",
      accent: "#3b82f6",
      surface: "#111",
    },
  })),
}));

function Consumer() {
  const { mode, setMode } = useTheme();
  return (
    <div>
      <div data-testid="theme-mode">{mode}</div>
      <button onClick={() => setMode("dark")}>set-dark</button>
    </div>
  );
}

describe("ThemeProvider", () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    window.matchMedia = jest.fn().mockReturnValue({
      matches: false,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    }) as unknown as typeof window.matchMedia;
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    jest.clearAllMocks();
  });

  afterAll(() => {
    window.matchMedia = originalMatchMedia;
  });

  it("initializes Houdini theme engine on mount", () => {
    render(
      <ThemeProvider>
        <Consumer />
      </ThemeProvider>,
    );

    expect(initHoudiniThemeEngine).toHaveBeenCalled();
  });

  it("hydrates mode from localStorage and applies theme", () => {
    localStorage.setItem("theme", "dark");

    render(
      <ThemeProvider>
        <Consumer />
      </ThemeProvider>,
    );

    expect(screen.getByTestId("theme-mode")).toHaveTextContent("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("updates mode and stores selection", () => {
    render(
      <ThemeProvider>
        <Consumer />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByText("set-dark"));

    expect(screen.getByTestId("theme-mode")).toHaveTextContent("dark");
    expect(localStorage.getItem("theme")).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });
});
