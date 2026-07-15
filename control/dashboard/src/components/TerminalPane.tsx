import { useEffect, useRef, useImperativeHandle, forwardRef, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

export interface TerminalPaneHandle {
  /** Clear the terminal and write new content */
  setContent: (text: string) => void;
  /** Append text to the terminal */
  appendContent: (text: string) => void;
  /** Focus the terminal */
  focus: () => void;
}

interface TerminalPaneProps {
  /** Initial content to display */
  content?: string | null;
  /** Minimum height in pixels */
  minHeight?: number;
  /** Maximum height in pixels */
  maxHeight?: number;
  /** Font size */
  fontSize?: number;
}

/**
 * Wraps xterm.js to render terminal output with full ANSI support
 * (colors, bold, italic, backgrounds, etc.)
 */
export const TerminalPane = forwardRef<TerminalPaneHandle, TerminalPaneProps>(
  function TerminalPane({ content, minHeight = 200, maxHeight = 600, fontSize = 13 }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const terminalRef = useRef<Terminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const lastContentRef = useRef<string>('');
    const mountedRef = useRef(false);

    /**
     * Whether the user is "following" output (scrolled to bottom).
     * true = auto-scroll to bottom on new content
     * false = user scrolled up to read history, don't move them
     */
    const userFollowingRef = useRef(true);

    // xterm.js theme matching the dashboard dark palette
    const theme = {
      background: '#0d1117',
      foreground: '#c9d1d9',
      cursor: '#58a6ff',
      cursorAccent: '#0d1117',
      selectionBackground: 'rgba(99, 102, 241, 0.3)',
      selectionForeground: '#f1f5f9',
      // Standard 16 ANSI colors (GitHub-dark inspired)
      black: '#484f58',
      red: '#ff7b72',
      green: '#3fb950',
      yellow: '#d29922',
      blue: '#58a6ff',
      magenta: '#bc8cff',
      cyan: '#39d2c0',
      white: '#c9d1d9',
      brightBlack: '#6e7681',
      brightRed: '#ffa198',
      brightGreen: '#56d364',
      brightYellow: '#e3b341',
      brightBlue: '#79c0ff',
      brightMagenta: '#d2a8ff',
      brightCyan: '#56d4dd',
      brightWhite: '#f0f6fc',
    };

    /**
     * Rewrite terminal content while preserving scroll position.
     *
     * Key insight: terminal.write() is ASYNC in xterm.js v5+.
     * We must use its callback to restore scroll position AFTER
     * the write is fully processed, not via requestAnimationFrame.
     *
     * We also use xterm's own buffer API (viewportY / baseY) rather
     * than DOM scrollTop, since xterm manages its own virtual viewport.
     */
    const rewriteContent = useCallback((terminal: Terminal, text: string) => {
      const wasFollowing = userFollowingRef.current;
      // Save the viewport line position (line number at top of visible area)
      const savedViewportY = terminal.buffer.active.viewportY;

      terminal.reset();
      terminal.write(text, () => {
        // This callback fires AFTER the write is fully processed.
        if (wasFollowing) {
          terminal.scrollToBottom();
        } else {
          // Restore the saved line position. After reset+write, the
          // terminal is at the bottom (viewportY === baseY). We need
          // to scroll back to where the user was reading.
          const newBaseY = terminal.buffer.active.baseY;
          // Clamp to valid range — if buffer is shorter than saved position,
          // scroll to top instead of an invalid position
          const targetY = Math.min(savedViewportY, newBaseY);
          // scrollLines is relative: negative = scroll up
          const scrollAmount = targetY - newBaseY;
          if (scrollAmount < 0) {
            terminal.scrollLines(scrollAmount);
          }
        }
      });
    }, []);

    // Initialize xterm.js
    useEffect(() => {
      if (!containerRef.current || mountedRef.current) return;

      const terminal = new Terminal({
        theme,
        fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', monospace",
        fontSize,
        lineHeight: 1.5,
        cursorBlink: false,
        cursorStyle: 'bar',
        cursorInactiveStyle: 'none',
        disableStdin: true,
        scrollback: 5000,
        convertEol: true,
        allowProposedApi: true,
      });

      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);

      terminal.open(containerRef.current);

      // Use xterm's own onScroll event to track user scroll state.
      // onScroll fires with the new viewportY whenever the viewport scrolls.
      // We use this to detect if the user scrolled away from the bottom.
      terminal.onScroll(() => {
        const buf = terminal.buffer.active;
        userFollowingRef.current = buf.viewportY >= buf.baseY;
      });

      // Also detect mouse wheel scroll-up as "user wants to read history"
      containerRef.current.addEventListener('wheel', (e) => {
        if (e.deltaY < 0) {
          // Scrolling up = user wants to read history
          userFollowingRef.current = false;
        } else {
          // Scrolling down — check if we've reached the bottom
          requestAnimationFrame(() => {
            if (terminalRef.current) {
              const buf = terminalRef.current.buffer.active;
              userFollowingRef.current = buf.viewportY >= buf.baseY;
            }
          });
        }
      }, { passive: true });

      // Small delay to ensure the container has dimensions before fitting
      requestAnimationFrame(() => {
        try {
          fitAddon.fit();
        } catch {
          // Container might not have dimensions yet
        }
      });

      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;
      mountedRef.current = true;

      // Write initial content if provided
      if (content) {
        terminal.write(content);
        lastContentRef.current = content;
      }

      // Handle window resize
      const resizeObserver = new ResizeObserver(() => {
        try {
          fitAddon.fit();
        } catch {
          // Ignore fit errors during rapid resizing
        }
      });
      resizeObserver.observe(containerRef.current);

      return () => {
        resizeObserver.disconnect();
        terminal.dispose();
        terminalRef.current = null;
        fitAddonRef.current = null;
        mountedRef.current = false;
      };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Update content when prop changes
    useEffect(() => {
      const terminal = terminalRef.current;
      if (!terminal || content === null || content === undefined) return;

      if (content !== lastContentRef.current) {
        lastContentRef.current = content;
        rewriteContent(terminal, content);
      }
    }, [content, rewriteContent]);

    // Expose imperative handle for parent components
    const setContent = useCallback((text: string) => {
      const terminal = terminalRef.current;
      if (!terminal) return;
      lastContentRef.current = text;
      rewriteContent(terminal, text);
    }, [rewriteContent]);

    const appendContent = useCallback((text: string) => {
      const terminal = terminalRef.current;
      if (!terminal) return;
      lastContentRef.current += text;
      terminal.write(text, () => {
        if (userFollowingRef.current) {
          terminal.scrollToBottom();
        }
      });
    }, []);

    const focus = useCallback(() => {
      terminalRef.current?.focus();
    }, []);

    useImperativeHandle(ref, () => ({ setContent, appendContent, focus }), [setContent, appendContent, focus]);

    return (
      <div
        ref={containerRef}
        className="terminal-pane-xterm"
        style={{
          minHeight: `${minHeight}px`,
          maxHeight: `${maxHeight}px`,
        }}
      />
    );
  }
);
