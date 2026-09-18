import { describe, expect, it } from "vitest";
import { pakistanInputToIso, pakistanDayEnd, callQueueBucket, callSchema } from "@/lib/calling";

describe("calling follow-up times", () => {
  it("converts Pakistan wall-clock time independently of browser timezone", () => {
    expect(pakistanInputToIso("2026-09-19T00:30")).toBe("2026-09-18T19:30:00.000Z");
  });
  it("rejects invalid calendar dates and timezone-bearing input", () => {
    expect(pakistanInputToIso("2026-02-30T12:00")).toBeNull();
    expect(pakistanInputToIso("2026-09-18T12:00Z")).toBeNull();
  });
  it("uses the next local calendar day after 19:00 UTC", () => {
    expect(pakistanDayEnd(new Date("2026-09-18T20:00:00Z"))).toBe("2026-09-19T18:59:59.999Z");
  });
  it("separates unscheduled, due, today and later leads", () => {
    const now = new Date("2026-09-18T10:00:00Z");
    expect(callQueueBucket(null, now)).toBe("unscheduled");
    expect(callQueueBucket(now.toISOString(), now)).toBe("due");
    expect(callQueueBucket("2026-09-18T18:59:00Z", now)).toBe("today");
    expect(callQueueBucket("2026-09-18T19:00:00Z", now)).toBe("upcoming");
  });
  it("requires a real outcome, notes and a future follow-up", () => {
    const valid = { requestId: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", leadId: "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb", outcome: "CONNECTED", notes: "Discuss requirements", followUpAt: new Date(Date.now() + 86400000).toISOString() };
    expect(callSchema.safeParse(valid).success).toBe(true);
    for (const change of [{ outcome: "QUALIFIED" }, { notes: " " }, { followUpAt: "2020-01-01T00:00:00Z" }]) expect(callSchema.safeParse({ ...valid, ...change }).success).toBe(false);
  });
});
