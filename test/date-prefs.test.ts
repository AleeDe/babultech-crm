import { describe, it, expect, afterEach } from "vitest";
import { formatDate, formatDateTime } from "@/lib/utils";
import { setClientDatePrefs } from "@/lib/date-prefs";

// The browser path: vitest runs with jsdom-less node, so give it a window.
const g = globalThis as unknown as { window?: unknown };

describe("dates in the reader's own format and time zone", () => {
  afterEach(() => {
    setClientDatePrefs(null);
    delete g.window;
  });

  const as = (timeZone: string | null, dateFormat: "DMY" | "MDY" | "YMD") => {
    g.window = {};
    setClientDatePrefs({ timeZone, dateFormat });
  };

  it("shows a moment in the reader's zone", () => {
    as("Asia/Karachi", "DMY");
    expect(formatDateTime("2026-10-01T09:30:00Z")).toBe("01 Oct 2026, 14:30");
    as("America/Toronto", "DMY");
    expect(formatDateTime("2026-10-01T09:30:00Z")).toBe("01 Oct 2026, 05:30");
  });

  it("moves the day when the zone does", () => {
    as("America/Toronto", "DMY");
    expect(formatDate("2026-10-01T02:00:00Z")).toBe("30 Sep 2026");
  });

  it("never moves a calendar day", () => {
    as("America/Toronto", "DMY");
    expect(formatDate("2026-10-01")).toBe("01 Oct 2026");
    as("Pacific/Auckland", "DMY");
    expect(formatDate("2026-10-01")).toBe("01 Oct 2026");
  });

  it("uses the chosen date format", () => {
    as("UTC", "MDY");
    expect(formatDate("2026-10-01")).toBe("Oct 01, 2026");
    as("UTC", "YMD");
    expect(formatDate("2026-10-01")).toBe("2026-10-01");
    expect(formatDateTime("2026-10-01T09:05:00Z")).toBe("2026-10-01, 09:05");
  });

  it("shows a dash for nothing", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDateTime("not a date")).toBe("—");
  });
});
