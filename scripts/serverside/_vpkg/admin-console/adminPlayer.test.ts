import { describe, it, expect } from "vici/test";

// Standalone smoke test for the VSCode "Vici Tests" panel (spec3 test-UX).
//
// It does NOT import adminPlayer.ts: that file is an *equipped script*
// (top-level functions, no `export`s, references the db/player engine
// globals), so it can't be imported as a module. Instead this re-implements
// adminPlayer's tiny permission-string parse so the test is fully
// self-contained and always runnable on a fresh server.
//
// Uses only the `toBe` matcher so a first smoke can't trip on an
// unsupported matcher. To see a RED result in the panel, uncomment the
// "intentional failure" block at the bottom.

function parseFilePermission(perm: string): { access: string; path: string } | null {
  // Mirror of adminPlayer.parseFilePermission — format: files:<access>:<path>
  if (!perm.startsWith("files:")) return null;
  const rest: string = perm.substring(6);
  const colonIdx: number = rest.indexOf(":");
  if (colonIdx < 0) return null;
  const access: string = rest.substring(0, colonIdx);
  const path: string = rest.substring(colonIdx + 1);
  if (access !== "read" && access !== "write" && access !== "rw") return null;
  return { access: access, path: path };
}

describe("adminPlayer permission strings", () => {
  it("parses a read permission", () => {
    const p = parseFilePermission("files:read:/scripts");
    expect(p === null).toBe(false);
    expect(p!.access).toBe("read");
    expect(p!.path).toBe("/scripts");
  });

  it("parses a rw permission with a nested path", () => {
    const p = parseFilePermission("files:rw:/scripts/serverside");
    expect(p!.access).toBe("rw");
    expect(p!.path).toBe("/scripts/serverside");
  });

  it("rejects malformed permissions", () => {
    expect(parseFilePermission("nonsense")).toBe(null);
    expect(parseFilePermission("files:bogus:/x")).toBe(null);
  });

  it("sanity math (panel smoke)", () => {
    // Streams into the test's output peek so you can see live output in the
    // panel. (Without a print/console.log, a passing test shows
    // "The test run did not record any output" — that's expected, not a bug.)
    console.log("[adminPlayer.test] output streaming works ✔");
    // eslint-disable-next-line no-console
    if (typeof console !== "undefined" && console.log) console.log("console.log also captured");
    expect(1 + 1).toBe(2);
  });

  // --- Uncomment to watch a FAILING test render (red ✗ + stack) ---
  // it("intentional failure (demo)", () => {
  //   expect(parseFilePermission("files:read:/a")!.access).toBe("write");
  // });
});
