"use client";

import { useRef, useState, useTransition } from "react";
import { Button, Input } from "@/components/ui";
import { optionKey, similarOption, type ProductOptionKind } from "@/lib/product-options";
import { createProductOption } from "@/server/product-options";

export function ProductOptionPicker({ name, kind, options: initial, defaultValue = "", onChange }: {
  name: string; kind: ProductOptionKind; options: string[]; defaultValue?: string;
  onChange?: (value: string) => void;
}) {
  const [options, setOptions] = useState(initial);
  const [selected, setSelected] = useState(defaultValue);
  const [query, setQuery] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const matches = options.filter((value) => !query || value.toLowerCase().includes(query.toLowerCase()) || similarOption(value, query));
  const similar = options.filter((value) => similarOption(value, query));
  const choose = (value: string) => {
    setSelected(value); setQuery(value); setOpen(false); setError("");
    input.current?.setCustomValidity("");
    onChange?.(value);
  };
  const create = () => start(async () => {
    try {
      const result = await createProductOption(kind, query);
      if (!result.ok) { setError(result.error); return; }
      setOptions((values) => [...new Set([...values, result.name])].sort());
      choose(result.name);
    } catch { setError("Could not create the option. Please try again."); }
  });
  return (
    <div className="relative space-y-2">
      <input type="hidden" name={name} value={selected} />
      <div className="flex gap-2">
        <Input ref={input} aria-label={`Search ${kind}`} aria-expanded={open} autoComplete="off"
          placeholder={`Search or create ${kind}`} value={query} disabled={pending}
          maxLength={kind === "unit" ? 30 : 100}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value); setSelected(""); setOpen(true); setError(""); onChange?.("");
            e.target.setCustomValidity(e.target.value ? "Select an existing option or create a new one." : "");
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
            if (e.key === "Enter" && open) {
              e.preventDefault();
              const exact = options.find((value) => optionKey(value) === optionKey(query));
              if (exact) choose(exact);
            }
          }} />
        {query && <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => choose("")}>Clear</Button>}
      </div>
      {open && (
        <div className="rounded-md border bg-background p-2 shadow-sm">
          <div className="max-h-40 overflow-y-auto">
            {matches.map((value) => <button type="button" key={value} onClick={() => choose(value)} className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-muted focus:bg-muted">{value}{query && similarOption(value, query) && optionKey(value) !== optionKey(query) && <span className="ml-2 text-xs text-muted-foreground">Similar name</span>}</button>)}
            {!matches.length && <p className="p-2 text-xs text-muted-foreground">No matching options.</p>}
          </div>
          {query.trim() && !similar.length && <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={create} className="mt-2 w-full">{pending ? "Creating…" : `Create “${query.trim()}”`}</Button>}
          {similar.length > 0 && <p className="px-3 pt-2 text-xs text-muted-foreground">Choose an existing match to avoid duplicates.</p>}
          <button type="button" onClick={() => setOpen(false)} className="mt-2 px-3 text-xs text-muted-foreground">Close</button>
        </div>
      )}
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
