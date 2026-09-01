/**
 * The parser behind the lead import.
 *
 * Quoting is the whole reason this exists rather than a split on commas: real
 * exports carry commas inside company names and newlines inside addresses, and
 * getting either wrong shreds the file silently — every row still "imports",
 * just into the wrong columns.
 */
import { describe, it, expect } from "vitest";
import { parseDelimited, guessMapping } from "@/lib/parse-delimited";

describe("parseDelimited", () => {
  it("reads a plain comma file", () => {
    const { headers, rows } = parseDelimited("First,Last\nAsad,Khan\nSara,Ali");
    expect(headers).toEqual(["First", "Last"]);
    expect(rows).toEqual([["Asad", "Khan"], ["Sara", "Ali"]]);
  });

  it("reads a spreadsheet paste, which is tab separated", () => {
    const { headers, rows, delimiter } = parseDelimited("First\tLast\nAsad\tKhan");
    expect(delimiter).toBe("\t");
    expect(headers).toEqual(["First", "Last"]);
    expect(rows).toEqual([["Asad", "Khan"]]);
  });

  it("keeps a comma that lives inside a quoted cell", () => {
    const { rows } = parseDelimited('Company,City\n"Sultana Medical, Inc",Karachi');
    expect(rows).toEqual([["Sultana Medical, Inc", "Karachi"]]);
  });

  it("keeps a newline that lives inside a quoted cell", () => {
    const { rows } = parseDelimited('Name,Address\nAsad,"12 Mall Road\nLahore"');
    expect(rows).toEqual([["Asad", "12 Mall Road\nLahore"]]);
  });

  it("reads a doubled quote as one literal quote", () => {
    const { rows } = parseDelimited('Name,Note\nAsad,"He said ""yes"" today"');
    expect(rows).toEqual([["Asad", 'He said "yes" today']]);
  });

  it("does not let commas inside quotes choose the delimiter", () => {
    // Three commas inside the quoted header, one between the two cells.
    const { headers } = parseDelimited('"Company, Inc, Ltd",Email\nx,y');
    expect(headers).toEqual(["Company, Inc, Ltd", "Email"]);
  });

  it("pads a short row so column indexes stay valid", () => {
    const { rows } = parseDelimited("A,B,C\n1,2");
    expect(rows).toEqual([["1", "2", ""]]);
  });

  it("drops blank lines rather than importing empty leads", () => {
    const { rows } = parseDelimited("A,B\n1,2\n\n\n3,4\n");
    expect(rows).toEqual([["1", "2"], ["3", "4"]]);
  });

  it("survives a file with a header and nothing else", () => {
    const { headers, rows } = parseDelimited("First,Last");
    expect(headers).toEqual(["First", "Last"]);
    expect(rows).toEqual([]);
  });

  it("returns nothing for empty input", () => {
    expect(parseDelimited("   ")).toEqual({ headers: [], rows: [], delimiter: "," });
  });

  it("reads a CRLF file, which is what Excel and Windows produce", () => {
    const { headers, rows } = parseDelimited("First,Last\r\nAsad,Khan\r\nSara,Ali");
    expect(headers).toEqual(["First", "Last"]);
    expect(rows).toEqual([["Asad", "Khan"], ["Sara", "Ali"]]);
  });

  it("keeps a CRLF that lives inside a quoted cell", () => {
    // The carriage return is part of the cell's own text, not a row
    // separator, so it stays. This is why sample-leads.csv is marked -text
    // in .gitattributes: letting git rewrite the fixture changed the value
    // the fixture test asserts.
    const { rows } = parseDelimited('Name,Address\r\nAsad,"12 Mall Road\r\nLahore"');
    expect(rows).toEqual([["Asad", "12 Mall Road\r\nLahore"]]);
  });

  it("strips a UTF-8 BOM, which Excel exports carry", () => {
    const { headers } = parseDelimited("﻿First,Last\nA,B");
    expect(headers).toEqual(["First", "Last"]);
  });
});

describe("guessMapping", () => {
  const FIELDS = [
    { key: "firstName", aliases: ["first name", "given name"] },
    { key: "lastName", aliases: ["last name", "surname"] },
    { key: "email", aliases: ["email address", "e-mail"] },
  ];

  it("matches regardless of case, spaces and punctuation", () => {
    const m = guessMapping(["First Name", "SURNAME", "e-mail"], FIELDS);
    expect(m).toEqual({ firstName: "First Name", lastName: "SURNAME", email: "e-mail" });
  });

  it("leaves a field unmapped rather than guessing wildly", () => {
    const m = guessMapping(["Company", "Phone"], FIELDS);
    expect(m).toEqual({});
  });

  it("never maps one column to two fields", () => {
    // "Name" is not an alias of either, so neither should claim it.
    const m = guessMapping(["Name"], FIELDS);
    expect(Object.values(m)).toHaveLength(0);
  });
});
