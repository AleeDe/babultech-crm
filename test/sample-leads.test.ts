/**
 * The shipped sample file, run through the real parser.
 *
 * A fixture that nobody parses is a fixture that quietly rots — this pins that
 * sample-leads.csv still demonstrates what it claims to: quoted commas, an
 * embedded newline, messy money, and a deliberately invalid rating.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseDelimited, guessMapping } from "@/lib/parse-delimited";

const text = readFileSync("sample-leads.csv", "utf8");

const FIELDS = [
  { key: "firstName", aliases: ["first", "first name", "given name", "fname", "forename"] },
  { key: "lastName", aliases: ["last", "last name", "surname", "lname", "family name"] },
  { key: "companyName", aliases: ["company", "company name", "organisation", "organization", "account", "business"] },
  { key: "jobTitle", aliases: ["title", "job title", "designation", "position", "role"] },
  { key: "email", aliases: ["email", "email address", "e-mail", "mail"] },
  { key: "phone", aliases: ["phone", "phone number", "mobile", "contact number", "tel", "telephone"] },
  { key: "industry", aliases: ["industry", "sector", "vertical"] },
  { key: "leadSource", aliases: ["source", "lead source", "channel", "origin"] },
  { key: "estimatedValue", aliases: ["value", "estimated value", "deal size", "amount", "budget", "potential"] },
  { key: "rating", aliases: ["rating", "temperature", "priority"] },
  { key: "description", aliases: ["notes", "description", "comment", "comments", "remarks"] },
];

describe("sample-leads.csv", () => {
  // Parsed per-test rather than at collection time: the suite is loaded before
  // the environment is ready, and reading it then fails.
  const parse = () => parseDelimited(text);

  it("is comma separated with 11 columns", () => {
    const { headers, delimiter } = parse();
    expect(delimiter).toBe(",");
    expect(headers).toHaveLength(11);
  });

  it("holds 10 leads, despite one containing a line break", () => {
    const { rows } = parse();
    expect(rows).toHaveLength(10);
  });

  it("keeps a comma that lives inside a company name", () => {
    const { rows } = parse();
    expect(rows[0][2]).toBe("Sultana Medical, Inc");
  });

  it("keeps a newline that lives inside a note", () => {
    const { rows } = parse();
    expect(rows[7][10]).toContain("12 Mall Road\nGulberg III, Lahore");
  });

  it("keeps a comma inside a longer note", () => {
    const { rows } = parse();
    expect(rows[4][10]).toContain("route tracking, and about invoicing");
  });

  it("uses headings that nothing matches literally, so mapping is exercised", () => {
    const { headers } = parse();
    // None of these are our field names — the point of the fixture.
    expect(headers.slice(0, 3)).toEqual(["Full Name", "Surname", "Organisation"]);
  });

  it("still auto-maps every field except the deliberately odd first column", () => {
    const { headers } = parse();
    const m = guessMapping(headers, FIELDS);
    expect(m.lastName).toBe("Surname");
    expect(m.companyName).toBe("Organisation");
    expect(m.jobTitle).toBe("Designation");
    expect(m.email).toBe("E-mail");
    expect(m.phone).toBe("Mobile");
    expect(m.industry).toBe("Sector");
    expect(m.leadSource).toBe("Origin");
    expect(m.estimatedValue).toBe("Deal Size");
    expect(m.rating).toBe("Temperature");
    expect(m.description).toBe("Remarks");

    // "Full Name" is not an alias of firstName, so it stays unmapped and the
    // person has to choose it — which is exactly the step being demonstrated.
    expect(m.firstName).toBeUndefined();
  });

  it("carries money in three different shapes", () => {
    const { rows } = parse();
    expect(rows[0][8]).toBe("Rs 1,250,000");  // symbol and separators
    expect(rows[1][8]).toBe("850,000");        // separators only
    expect(rows[2][8]).toBe("450000");         // bare digits
  });

  it("includes a blank rating and an invalid one", () => {
    const { rows } = parse();
    expect(rows[5][9]).toBe("");          // Ayesha — no rating
    expect(rows[6][9]).toBe("Lukewarm");  // Kamran — not Hot/Warm/Cold
  });

  it("includes a row with no value, to prove the field is optional", () => {
    const { rows } = parse();
    expect(rows[6][8]).toBe("");
  });
});
