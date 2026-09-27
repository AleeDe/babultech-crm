/**
 * The app's half of the duplicate rule: the same keys the database compares,
 * and the reading of its refusal into something a form can point at.
 *
 * The keys matter most. The import checks a file against itself with them before
 * anything is sent, so a key that disagreed with the database's would let a
 * repeated person through the file check and then fail the whole import on the
 * trigger - or skip somebody the database would have let in.
 */
import { describe, it, expect } from "vitest";
import {
  emailKey, phoneKey, duplicateFromError, duplicateRef, describeDuplicate, duplicateFailure,
  type DuplicateMatch,
} from "@/lib/duplicates";

describe("emailKey", () => {
  it("ignores case and surrounding spaces", () => {
    expect(emailKey("  Zara.Iqbal@Example.COM ")).toBe("zara.iqbal@example.com");
  });

  it("treats a blank address as none", () => {
    expect(emailKey("   ")).toBeNull();
    expect(emailKey(null)).toBeNull();
    expect(emailKey(undefined)).toBeNull();
  });
});

describe("phoneKey", () => {
  it("makes the international and local forms of a number the same key", () => {
    // +92 replaces the trunk zero, so the two forms differ in length but share
    // their last nine digits.
    expect(phoneKey("+92 300 7654321")).toBe("007654321");
    expect(phoneKey("+92 300 7654321")).toBe(phoneKey("03007654321"));
    expect(phoneKey("0300-765 4321")).toBe(phoneKey("923007654321"));
  });

  it("ignores every kind of formatting", () => {
    expect(phoneKey("(0300) 765-4321")).toBe(phoneKey("0300.765.4321"));
  });

  it("does not match on a number too short to be distinctive", () => {
    expect(phoneKey("7654321")).toBeNull();
    expect(phoneKey("")).toBeNull();
    expect(phoneKey(null)).toBeNull();
  });
});

const leadMatch: DuplicateMatch = {
  hidden: false, field: "email", entity: "lead", id: "11111111-1111-1111-1111-111111111111",
  number: "LEAD-2026-00012", name: "Zara Iqbal", company: "Iqbal Textiles",
};
const contactMatch: DuplicateMatch = {
  hidden: false, field: "whatsapp", entity: "contact", id: "22222222-2222-2222-2222-222222222222",
  number: null, name: "Kamran Ali", company: "Meridian Foods", accountId: "33333333-3333-3333-3333-333333333333",
};
const hiddenMatch: DuplicateMatch = { hidden: true, field: "phone" };

describe("duplicateFromError", () => {
  it("reads the match out of the database's refusal", () => {
    const error = {
      message: "This lead already exists: Zara Iqbal (LEAD-2026-00012) is a lead with the same email address.",
      code: "23505",
      hint: "duplicate_person",
      details: JSON.stringify(leadMatch),
    };
    expect(duplicateFromError(error)).toEqual(leadMatch);
  });

  it("ignores a unique violation that is not about a person", () => {
    expect(duplicateFromError({ code: "23505", hint: null, details: "Key (name)=(x) already exists." })).toBeNull();
  });

  it("does not throw on a detail it cannot read", () => {
    expect(duplicateFromError({ hint: "duplicate_person", details: "not json" })).toBeNull();
    expect(duplicateFromError(null)).toBeNull();
    expect(duplicateFromError("a string")).toBeNull();
  });
});

describe("duplicateRef", () => {
  it("links a lead by its number", () => {
    expect(duplicateRef(leadMatch)).toEqual({
      href: "/leads/11111111-1111-1111-1111-111111111111",
      label: "LEAD-2026-00012 · Zara Iqbal",
    });
  });

  it("links a contact by name and company", () => {
    expect(duplicateRef(contactMatch)).toEqual({
      href: "/contacts/22222222-2222-2222-2222-222222222222",
      label: "Kamran Ali at Meridian Foods",
    });
  });

  it("gives a partner no way to a record that is not theirs", () => {
    expect(duplicateRef(hiddenMatch)).toBeUndefined();
  });
});

describe("describeDuplicate", () => {
  it("says who and on what, for staff", () => {
    expect(describeDuplicate(leadMatch)).toBe(
      "Already a lead: Zara Iqbal (LEAD-2026-00012) at Iqbal Textiles, same email address",
    );
    expect(describeDuplicate(contactMatch)).toBe(
      "Already a contact: Kamran Ali at Meridian Foods, same WhatsApp number",
    );
  });

  it("says only what matched, for a partner", () => {
    expect(describeDuplicate(hiddenMatch)).toBe(
      "Someone with this phone number is already in our records",
    );
  });
});

describe("duplicateFailure", () => {
  it("keeps the database's sentence, marks the field and links the record", () => {
    const failure = duplicateFailure({
      message: "This person is already a contact: Kamran Ali at Meridian Foods has the same WhatsApp number.",
      hint: "duplicate_person",
      details: JSON.stringify(contactMatch),
    });
    expect(failure).toEqual({
      ok: false,
      error: "This person is already a contact: Kamran Ali at Meridian Foods has the same WhatsApp number.",
      fieldErrors: { whatsapp: ["Already on file"] },
      duplicate: { href: "/contacts/22222222-2222-2222-2222-222222222222", label: "Kamran Ali at Meridian Foods" },
    });
  });

  it("reads an Error thrown by the write helpers the same way", () => {
    const thrown = Object.assign(new Error("This lead already exists."), {
      hint: "duplicate_person",
      details: JSON.stringify(leadMatch),
    });
    expect(duplicateFailure(thrown)?.error).toBe("This lead already exists.");
  });

  it("leaves any other failure to the caller", () => {
    expect(duplicateFailure(new Error("Lead not found."))).toBeNull();
  });
});
