import { describe, it, expect } from "vitest";
import { sanitizeRichText, richTextToPlain, looksLikeHtml } from "@/lib/rich-text";

/**
 * These are the tests that matter most in this change.
 *
 * Task descriptions are the first field in the system that stores HTML, and the
 * whole point of the feature is that people paste into it from Word, Outlook and
 * web pages. Every assertion below is a payload that must not survive to the
 * database, because anything that does will eventually be rendered.
 */

describe("sanitizeRichText strips anything that can execute", () => {
  const mustNotSurvive = [
    ["a script tag", "<p>hi</p><script>alert(1)</script>"],
    ["an inline handler", `<p onclick="alert(1)">click me</p>`],
    ["an img error handler", `<img src=x onerror="alert(1)">`],
    ["an svg handler", `<svg onload="alert(1)"></svg>`],
    ["an iframe", `<iframe src="https://evil.test"></iframe>`],
    ["an object", `<object data="evil.swf"></object>`],
    ["an embed", `<embed src="evil.swf">`],
    ["a form", `<form action="/steal"><input name="p"></form>`],
    ["a style tag", `<style>body{display:none}</style>`],
    ["a meta refresh", `<meta http-equiv="refresh" content="0;url=https://evil.test">`],
    ["a link tag", `<link rel="stylesheet" href="https://evil.test/x.css">`],
    ["a body handler", `<body onload="alert(1)">x</body>`],
    ["a details handler", `<details open ontoggle="alert(1)">x</details>`],
  ];

  for (const [what, payload] of mustNotSurvive) {
    it(`removes ${what}`, () => {
      const clean = sanitizeRichText(payload) ?? "";
      expect(clean).not.toMatch(/<script/i);
      expect(clean).not.toMatch(/<iframe/i);
      expect(clean).not.toMatch(/<object/i);
      expect(clean).not.toMatch(/<embed/i);
      expect(clean).not.toMatch(/<form/i);
      expect(clean).not.toMatch(/<style/i);
      expect(clean).not.toMatch(/<meta/i);
      expect(clean).not.toMatch(/<link/i);
      // No event handler attribute of any kind.
      expect(clean).not.toMatch(/\son\w+\s*=/i);
      expect(clean).not.toMatch(/alert\(/);
    });
  }

  it("drops inline styles, which can be used to overlay the page", () => {
    const clean = sanitizeRichText(`<p style="position:fixed;inset:0">x</p>`) ?? "";
    expect(clean).not.toMatch(/style\s*=/i);
    expect(clean).toContain("x");
  });

  it("drops data attributes", () => {
    const clean = sanitizeRichText(`<p data-evil="1">x</p>`) ?? "";
    expect(clean).not.toMatch(/data-evil/i);
  });
});

describe("links", () => {
  it("keeps an ordinary https link and makes it safe to open", () => {
    const clean = sanitizeRichText(`<p><a href="https://example.test">docs</a></p>`) ?? "";
    expect(clean).toContain('href="https://example.test"');
    expect(clean).toContain('target="_blank"');
    expect(clean).toMatch(/rel="[^"]*noopener[^"]*"/);
    expect(clean).toMatch(/rel="[^"]*noreferrer[^"]*"/);
  });

  it("keeps mailto and tel, which a description legitimately uses", () => {
    expect(sanitizeRichText(`<a href="mailto:a@b.test">mail</a>`) ?? "").toContain("mailto:a@b.test");
    expect(sanitizeRichText(`<a href="tel:+92000">call</a>`) ?? "").toContain("tel:+92000");
  });

  it("strips a javascript: href but keeps the words", () => {
    const clean = sanitizeRichText(`<p><a href="javascript:alert(1)">click</a></p>`) ?? "";
    expect(clean).not.toMatch(/javascript:/i);
    expect(clean).toContain("click");
  });

  it("strips a data: href, which can open attacker markup in our own origin", () => {
    const clean = sanitizeRichText(`<a href="data:text/html,<script>alert(1)</script>">x</a>`) ?? "";
    expect(clean).not.toMatch(/data:text\/html/i);
    expect(clean).not.toMatch(/<script/i);
  });

  it("strips obfuscated javascript schemes", () => {
    for (const href of [
      "JaVaScRiPt:alert(1)",
      " javascript:alert(1)",
      "java\tscript:alert(1)",
      "vbscript:msgbox(1)",
    ]) {
      const clean = sanitizeRichText(`<a href="${href}">x</a>`) ?? "";
      expect(clean.toLowerCase()).not.toMatch(/javascript:|vbscript:/);
    }
  });
});

describe("formatting that must survive", () => {
  it("keeps the formatting a description actually needs", () => {
    const html =
      "<h3>Scope</h3><p><strong>Bold</strong> and <em>italic</em> and <u>underlined</u>.</p>" +
      "<ul><li>one</li><li>two</li></ul><ol><li>first</li></ol>" +
      "<blockquote>quoted</blockquote><pre><code>code()</code></pre><hr>";
    const clean = sanitizeRichText(html) ?? "";
    for (const tag of ["h3", "strong", "em", "u", "ul", "li", "ol", "blockquote", "pre", "code", "hr"]) {
      expect(clean).toMatch(new RegExp(`<${tag}[ >]`, "i"));
    }
  });

  it("keeps the text inside a stripped wrapper", () => {
    // Pasting from a web page wraps content in divs and spans; losing the
    // words along with the wrapper would be worse than losing the formatting.
    const clean = sanitizeRichText(`<div><section><p>kept</p></section></div>`) ?? "";
    expect(clean).toContain("kept");
  });
});

describe("empty values", () => {
  it("treats a visually empty editor as empty", () => {
    // A rich-text editor posts these rather than "" when nothing was typed.
    for (const empty of ["", "   ", "<p></p>", "<p><br></p>", "<p>&nbsp;</p>", "<p>   </p>"]) {
      expect(sanitizeRichText(empty)).toBeNull();
    }
  });

  it("returns null for non-strings rather than throwing", () => {
    expect(sanitizeRichText(null)).toBeNull();
    expect(sanitizeRichText(undefined)).toBeNull();
    expect(sanitizeRichText(42)).toBeNull();
    expect(sanitizeRichText({})).toBeNull();
  });

  it("keeps content that only looks empty", () => {
    expect(sanitizeRichText("<p>0</p>")).toContain("0");
  });
});

describe("richTextToPlain", () => {
  it("separates blocks with a space rather than running them together", () => {
    expect(richTextToPlain("<p>one</p><p>two</p>")).toBe("one two");
    expect(richTextToPlain("<ul><li>a</li><li>b</li></ul>")).toBe("a b");
    expect(richTextToPlain("one<br>two")).toBe("one two");
  });

  it("decodes the entities a paste introduces", () => {
    expect(richTextToPlain("<p>a&nbsp;b &amp; c</p>")).toBe("a b & c");
    expect(richTextToPlain("<p>&lt;tag&gt;</p>")).toBe("<tag>");
  });

  it("handles empty input", () => {
    expect(richTextToPlain(null)).toBe("");
    expect(richTextToPlain("")).toBe("");
  });
});

describe("looksLikeHtml", () => {
  it("recognises stored markup", () => {
    expect(looksLikeHtml("<p>hi</p>")).toBe(true);
    expect(looksLikeHtml("<ul><li>x</li></ul>")).toBe(true);
  });

  it("leaves plain text written before this feature alone", () => {
    // These must keep rendering as plain text with their newlines intact.
    expect(looksLikeHtml("Just a sentence.")).toBe(false);
    expect(looksLikeHtml("Line one\nLine two")).toBe(false);
    expect(looksLikeHtml("a < b and c > d")).toBe(false);
    expect(looksLikeHtml("")).toBe(false);
    expect(looksLikeHtml(null)).toBe(false);
  });
});
