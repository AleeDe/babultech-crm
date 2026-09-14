import { describe, it, expect } from "vitest";
import {
  extractMentions, mentionsToPlain, parseNoteSegments, buildMentionToken,
} from "@/lib/mentions";

const HASSAN = "37f25e81-37ec-4973-a720-8eeaf96cb639";
const ALI = "b8d9ac55-72b4-4f9b-a108-d69bcce9a2d0";
const tok = (id: string, name: string) => `@[${name}](user:${id})`;

describe("extractMentions", () => {
  it("finds one mention", () => {
    expect(extractMentions(`Please look at this ${tok(HASSAN, "Hassan Shamsi")}`)).toEqual([
      { id: HASSAN, name: "Hassan Shamsi" },
    ]);
  });

  it("finds several", () => {
    const c = `${tok(HASSAN, "Hassan Shamsi")} and ${tok(ALI, "Muhammad Ali")} please`;
    expect(extractMentions(c).map((m) => m.id)).toEqual([HASSAN, ALI]);
  });

  it("deduplicates, so one person is never emailed twice for one note", () => {
    const c = `${tok(HASSAN, "Hassan Shamsi")} ... and again ${tok(HASSAN, "Hassan Shamsi")}`;
    expect(extractMentions(c)).toHaveLength(1);
  });

  it("ignores anything that is not a well-formed token", () => {
    for (const c of [
      "plain @Hassan with no token",
      "@[Hassan](user:not-a-uuid)",
      "@[Hassan](user:)",
      "@[](user:" + HASSAN + ")",
      "@[Hassan]{user:" + HASSAN + "}",
      "[Hassan](user:" + HASSAN + ")",
      "@[Hassan](admin:" + HASSAN + ")",
    ]) {
      expect(extractMentions(c)).toEqual([]);
    }
  });

  it("handles empty input", () => {
    expect(extractMentions(null)).toEqual([]);
    expect(extractMentions(undefined)).toEqual([]);
    expect(extractMentions("")).toEqual([]);
  });

  it("is case-insensitive on the uuid and normalises it", () => {
    const upper = HASSAN.toUpperCase();
    expect(extractMentions(tok(upper, "Hassan"))[0].id).toBe(HASSAN);
  });
});

describe("mentionsToPlain", () => {
  it("replaces tokens with readable names", () => {
    expect(mentionsToPlain(`Ping ${tok(HASSAN, "Hassan Shamsi")} today`)).toBe(
      "Ping @Hassan Shamsi today",
    );
  });

  it("leaves text with no mentions alone", () => {
    expect(mentionsToPlain("nothing here")).toBe("nothing here");
  });
});

describe("parseNoteSegments", () => {
  it("splits text and mentions in order", () => {
    const segs = parseNoteSegments(`before ${tok(HASSAN, "Hassan")} after`);
    expect(segs).toEqual([
      { kind: "text", value: "before " },
      { kind: "mention", id: HASSAN, name: "Hassan" },
      { kind: "text", value: " after" },
    ]);
  });

  it("handles a mention at either end", () => {
    expect(parseNoteSegments(tok(ALI, "Ali"))).toEqual([
      { kind: "mention", id: ALI, name: "Ali" },
    ]);
  });

  it("never loses the surrounding text", () => {
    const content = `a ${tok(HASSAN, "H")} b ${tok(ALI, "A")} c`;
    const rebuilt = parseNoteSegments(content)
      .map((s) => (s.kind === "text" ? s.value : `@${s.name}`))
      .join("");
    expect(rebuilt).toBe("a @H b @A c");
  });

  it("returns a single text segment when there are no mentions", () => {
    expect(parseNoteSegments("just words")).toEqual([{ kind: "text", value: "just words" }]);
  });
});

describe("buildMentionToken", () => {
  it("round-trips through extractMentions", () => {
    const t = buildMentionToken(HASSAN, "Hassan Shamsi");
    expect(extractMentions(t)).toEqual([{ id: HASSAN, name: "Hassan Shamsi" }]);
  });

  it("strips brackets that would break the token", () => {
    // A name containing ] or ) would otherwise terminate the token early and
    // leave the rest of it as visible junk in the note.
    const t = buildMentionToken(HASSAN, "Hassan [the] (boss)");
    expect(t).toBe(`@[Hassan the boss](user:${HASSAN})`);
    expect(extractMentions(t)).toHaveLength(1);
  });

  it("caps a very long name", () => {
    const t = buildMentionToken(HASSAN, "x".repeat(400));
    expect(extractMentions(t)).toHaveLength(1);
    expect(extractMentions(t)[0].name.length).toBeLessThanOrEqual(120);
  });
});

describe("a crafted note cannot become markup", () => {
  it("keeps script-looking text as plain text segments", () => {
    // Notes render as text nodes, never innerHTML. This asserts the parser
    // hands such content back as text rather than treating it as a mention.
    const nasty = `<script>alert(1)</script> ${tok(HASSAN, "Hassan")}`;
    const segs = parseNoteSegments(nasty);
    expect(segs[0]).toEqual({ kind: "text", value: "<script>alert(1)</script> " });
    expect(segs[1].kind).toBe("mention");
  });

  it("does not treat an injected token with a fake id as a mention", () => {
    expect(extractMentions("@[Admin](user:00000000-0000-0000-0000-00000000000z)")).toEqual([]);
  });

  it("a token naming a real-looking uuid still only yields an id to check", () => {
    // The parser's job ends at "here is an id"; the server decides whether that
    // id is a real, active user before writing a row or sending mail.
    const fake = "11111111-2222-3333-4444-555555555555";
    expect(extractMentions(tok(fake, "Nobody"))).toEqual([{ id: fake, name: "Nobody" }]);
  });
});
