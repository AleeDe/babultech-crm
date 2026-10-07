import { describe, expect, it } from "vitest";
import { renderDocumentEmail, type EmailBranding } from "@/lib/email-template";
import { withTitle } from "@/lib/utils";

const branding: EmailBranding = {
  companyName: "BabulTech", logoUrl: "https://example.com/logo.png", websiteUrl: "https://www.babultech.com",
  brandColor: "#00B8A4", brandColorDark: "#0F172A", textColor: "#1A2233", mutedColor: "#64748B", backgroundColor: "#F1F5F9",
  supportEmail: null, supportPhone: null, addressLine: null, emailFooter: "Confidential.",
} as EmailBranding;

describe("branding", () => {
  it("signs with the designation in brackets", () => {
    expect(withTitle("Hasan Shamsi", "CEO")).toBe("Hasan Shamsi (CEO)");
    expect(withTitle("Babul Tech", null)).toBe("Babul Tech");
    expect(withTitle("Babul Tech", "  ")).toBe("Babul Tech");
  });

  it("puts a small square icon beside the company name, and signs off with the title", () => {
    const { html, text } = renderDocumentEmail({ branding, documentTitle: "Quotation QUO-1", message: "Hello", summary: [], senderName: "Hasan Shamsi", senderTitle: "CEO" });
    expect(html).toContain('width="36" height="36"');
    expect(html).toContain(">BabulTech</span>");
    expect(html).toContain("<strong>Hasan Shamsi (CEO)</strong>");
    expect(text).toContain("Hasan Shamsi (CEO)");
  });

  it("signs with the name alone when there is no title", () => {
    const { html } = renderDocumentEmail({ branding, documentTitle: "T", message: "Hi", summary: [], senderName: "Babul Tech" });
    expect(html).toContain("<strong>Babul Tech</strong>");
  });
});
