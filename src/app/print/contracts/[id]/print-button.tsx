"use client";

export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white">
      Print or save as PDF
    </button>
  );
}
