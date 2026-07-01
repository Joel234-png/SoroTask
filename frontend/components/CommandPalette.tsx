"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@/app/context/WalletContext";

// Define the structure of a command
type Command = {
  id: string;
  title: string;
  icon: React.ReactNode;
  perform: () => void;
  group: string;
};

// Simple SVG Icons to avoid external dependencies
const Icons = {
  Home: (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
  ),
  List: (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
  ),
  Activity: (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
  ),
  Wallet: (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></svg>
  ),
  Plus: (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
  ),
  Sun: (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>
  ),
  Search: (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
  ),
  Command: (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3"/></svg>
  )
};

export function CommandPalette() {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const { openConnectModal } = useWallet();

  // Define commands
  const commands: Command[] = useMemo(() => [
    {
      id: "nav-home",
      title: "Go to Home",
      icon: Icons.Home,
      group: "Navigation",
      perform: () => router.push("/"),
    },
    {
      id: "nav-tasks",
      title: "View Tasks",
      icon: Icons.List,
      group: "Navigation",
      perform: () => {
        // Mock navigation or scroll to element
        window.scrollTo({ top: document.body.scrollHeight / 2, behavior: 'smooth' });
      },
    },
    {
      id: "nav-logs",
      title: "Execution Logs",
      icon: Icons.Activity,
      group: "Navigation",
      perform: () => {
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
      },
    },
    {
      id: "action-connect",
      title: "Connect Wallet",
      icon: Icons.Wallet,
      group: "Actions",
      perform: () => openConnectModal(),
    },
    {
      id: "action-create",
      title: "Create New Task",
      icon: Icons.Plus,
      group: "Actions",
      perform: () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        // Can add focus to an input here
      },
    },
    {
      id: "action-theme",
      title: "Toggle Theme",
      icon: Icons.Sun,
      group: "Actions",
      perform: () => alert("Theme toggled!"),
    },
  ], [router, openConnectModal]);

  // Fuzzy search implementation
  function fuzzyMatch(pattern: string, text: string): { matched: boolean; score: number } {
    const lowerPattern = pattern.toLowerCase();
    const lowerText = text.toLowerCase();
    
    if (!pattern) return { matched: true, score: 1 };
    
    let patternIdx = 0;
    let score = 0;
    let consecutiveBonus = 0;
    
    for (let i = 0; i < lowerText.length && patternIdx < lowerPattern.length; i++) {
      if (lowerText[i] === lowerPattern[patternIdx]) {
        score += 1 + consecutiveBonus;
        consecutiveBonus += 1;
        patternIdx++;
      } else {
        consecutiveBonus = 0;
      }
    }
    
    const matched = patternIdx === lowerPattern.length;
    return { matched, score: matched ? score : 0 };
  }

  const recentCommandsKey = "sorotask.command-palette.recent";

  const getRecentCommands = useCallback((): string[] => {
    try {
      const raw = localStorage.getItem(recentCommandsKey);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }, []);

  const [recentIds, setRecentIds] = useState<string[]>([]);

  useEffect(() => {
    setRecentIds(getRecentCommands());
  }, [getRecentCommands]);

  const saveRecentCommand = useCallback((id: string) => {
    try {
      const recent = getRecentCommands().filter((r) => r !== id);
      const updated = [id, ...recent].slice(0, 5);
      localStorage.setItem(recentCommandsKey, JSON.stringify(updated));
      setRecentIds(updated);
    } catch {
      // Ignore storage errors
    }
  }, [getRecentCommands]);

  // Filter and rank commands with fuzzy search
  const { filteredCommands, groupedCommands, recentGroup } = useMemo(() => {
    if (!search) {
      const recentCmds = recentIds
        .map((id) => commands.find((c) => c.id === id))
        .filter(Boolean) as Command[];
      const groups: Record<string, Command[]> = {};
      commands.forEach((cmd) => {
        if (!groups[cmd.group]) groups[cmd.group] = [];
        groups[cmd.group].push(cmd);
      });
      return { filteredCommands: commands, groupedCommands: groups, recentGroup: recentCmds };
    }

    const scored = commands
      .map((cmd) => ({
        cmd,
        score: fuzzyMatch(search, cmd.title).score + fuzzyMatch(search, cmd.group).score * 0.5,
      }))
      .filter(({ cmd, score }) => {
        const titleMatch = fuzzyMatch(search, cmd.title);
        const groupMatch = fuzzyMatch(search, cmd.group);
        return titleMatch.matched || groupMatch.matched;
      })
      .sort((a, b) => b.score - a.score)
      .map(({ cmd }) => cmd);

    const groups: Record<string, Command[]> = {};
    scored.forEach((cmd) => {
      if (!groups[cmd.group]) groups[cmd.group] = [];
      groups[cmd.group].push(cmd);
    });

    return { filteredCommands: scored, groupedCommands: groups, recentGroup: [] };
  }, [search, commands, recentIds]);

  // Handle command execution
  const handleCommand = useCallback(
    (cmd: Command) => {
      saveRecentCommand(cmd.id);
      cmd.perform();
      setIsOpen(false);
    },
    [saveRecentCommand]
  );

  // Keyboard listener for Cmd+K / Ctrl+K
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setIsOpen((open) => !open);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  // Keyboard navigation within the palette
  useEffect(() => {
    if (!isOpen) {
      setSearch("");
      setSelectedIndex(0);
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % filteredCommands.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev === 0 ? filteredCommands.length - 1 : prev - 1
        );
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (filteredCommands[selectedIndex]) {
          handleCommand(filteredCommands[selectedIndex]);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        setIsOpen(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, filteredCommands, selectedIndex, handleCommand]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  // Keep selected item in view
  useEffect(() => {
    if (!isOpen) return;
    requestAnimationFrame(() => {
      const selected = listRef.current?.querySelector('[aria-selected="true"]');
      selected?.scrollIntoView({ block: "nearest" });
    });
  }, [selectedIndex, isOpen]);

  if (!isOpen) return null;

  const hasError = false;
  const isLoading = search.length > 0 && filteredCommands.length === 0;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 sm:pt-32">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
        onClick={() => setIsOpen(false)}
        aria-hidden="true"
      />

      {/* Palette Container */}
      <div
        className="relative w-full max-w-xl overflow-hidden rounded-2xl bg-neutral-900 border border-neutral-700/50 shadow-2xl ring-1 ring-white/10 flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        {/* Search Input */}
        <div className="flex items-center px-4 py-4 border-b border-neutral-800/80 gap-3">
          <div className="text-neutral-400" aria-hidden="true">
            {Icons.Search}
          </div>
          <input
            ref={inputRef}
            type="text"
            className="flex-1 bg-transparent border-none text-neutral-100 placeholder-neutral-500 focus:outline-none focus:ring-0 text-lg"
            placeholder="Type a command or search..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setSelectedIndex(0);
            }}
            aria-autocomplete="list"
            aria-controls="command-list"
            aria-expanded={isOpen}
          />
          <div className="flex items-center gap-1 text-xs text-neutral-500 font-mono bg-neutral-800 px-2 py-1 rounded">
            <span>esc</span>
          </div>
        </div>

        {/* Results List */}
        <div
          ref={listRef}
          id="command-list"
          className="max-h-[60vh] overflow-y-auto p-2 scroll-smooth"
          role="listbox"
        >
          {isLoading ? (
            <div className="py-14 text-center text-sm text-neutral-500" role="status" aria-live="polite">
              Searching...
            </div>
          ) : hasError ? (
            <div className="py-14 text-center text-sm text-red-400" role="alert">
              Failed to load commands. Please try again.
            </div>
          ) : recentGroup.length > 0 && !search ? (
            <>
              <div className="px-3 py-2 text-xs font-semibold text-neutral-500 uppercase tracking-wider">
                Recent
              </div>
              <div className="flex flex-col gap-1 mb-4">
                {recentGroup.map((cmd, idx) => {
                  const globalIdx = idx;
                  const isSelected = globalIdx === selectedIndex;
                  return (
                    <button
                      key={cmd.id}
                      id={`cmd-${cmd.id}`}
                      aria-selected={isSelected}
                      className={`flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium transition-colors w-full text-left ${
                        isSelected
                          ? "bg-blue-600/10 text-blue-400"
                          : "text-neutral-300 hover:bg-neutral-800/60"
                      }`}
                      onClick={() => handleCommand(cmd)}
                      onMouseMove={() => setSelectedIndex(globalIdx)}
                      role="option"
                    >
                      <div className={`flex items-center justify-center ${
                        isSelected ? "text-blue-400" : "text-neutral-500"
                      }`}>
                        {cmd.icon}
                      </div>
                      <span className="flex-1">{cmd.title}</span>
                      {isSelected && (
                        <span className="text-xs text-blue-500/70 font-mono" aria-hidden="true">
                          ↵
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </>
          ) : filteredCommands.length === 0 ? (
            <div className="py-14 text-center text-sm text-neutral-500" role="status">
              No results found.
            </div>
          ) : (
            Object.entries(groupedCommands).map(([group, cmds]) => (
              <div key={group} className="mb-4 last:mb-0">
                <div className="px-3 py-2 text-xs font-semibold text-neutral-500 uppercase tracking-wider" aria-hidden="true">
                  {group}
                </div>
                <div className="flex flex-col gap-1">
                  {cmds.map((cmd, i) => {
                    const globalIdx = filteredCommands.indexOf(cmd);
                    const isSelected = globalIdx === selectedIndex;
                    return (
                      <button
                        key={cmd.id}
                        id={`cmd-${cmd.id}`}
                        aria-selected={isSelected}
                        className={`flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium transition-colors w-full text-left ${
                          isSelected
                            ? "bg-blue-600/10 text-blue-400"
                            : "text-neutral-300 hover:bg-neutral-800/60"
                        }`}
                        onClick={() => handleCommand(cmd)}
                        onMouseMove={() => setSelectedIndex(globalIdx)}
                        role="option"
                      >
                        <div className={`flex items-center justify-center ${
                          isSelected ? "text-blue-400" : "text-neutral-500"
                        }`}>
                          {cmd.icon}
                        </div>
                        <span className="flex-1">{cmd.title}</span>
                        {isSelected && (
                          <span className="text-xs text-blue-500/70 font-mono" aria-hidden="true">
                            ↵
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-neutral-800/80 px-4 py-3 bg-neutral-950/30 flex items-center justify-between text-xs text-neutral-500">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <span className="flex items-center justify-center w-5 h-5 rounded bg-neutral-800 font-mono">↵</span>
              <span>to select</span>
            </div>
            <div className="hidden sm:flex items-center gap-1.5">
              <span className="flex items-center justify-center w-5 h-5 rounded bg-neutral-800 font-mono">↑</span>
              <span className="flex items-center justify-center w-5 h-5 rounded bg-neutral-800 font-mono">↓</span>
              <span>to navigate</span>
            </div>
          </div>
          <div>
            SoroTask Navigation
          </div>
        </div>
      </div>
    </div>
  );
}
