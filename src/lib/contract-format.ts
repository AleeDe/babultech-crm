/**
 * The one piece of formatting a contract has: **double asterisks** for bold.
 * Splits text into plain and bold runs; components render them as elements,
 * never as HTML, so nothing typed into a contract can run as a page.
 */
export function boldParts(text: string): { text: string; bold: boolean }[] {
  return text
    .split(/(\*\*[^*\n][^*]*?\*\*)/g)
    .filter((part) => part !== "")
    .map((part) =>
      /^\*\*[^*\n][^*]*?\*\*$/.test(part) ? { text: part.slice(2, -2), bold: true } : { text: part, bold: false },
    );
}
