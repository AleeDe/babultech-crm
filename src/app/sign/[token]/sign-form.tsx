"use client";

import { useState, useTransition } from "react";
import { SignaturePad } from "@/components/signature-pad";
import { signAsEmployee } from "@/server/people";

export function SignForm({ token, fullName }: { token: string; fullName: string }) {
  const [name, setName] = useState(fullName);
  const [signature, setSignature] = useState<string | null>(null);
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      className="mt-6 space-y-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const result = await signAsEmployee(token, { name, signature: signature ?? "", agree });
          if (!result.ok) { setError(result.error); return; }
          window.location.reload();
        });
      }}
    >
      <h2 className="text-lg font-semibold">Sign</h2>
      <label className="block text-sm">
        <span className="font-medium">Your full name</span>
        <input name="signerName" value={name} onChange={(e) => setName(e.target.value)} required
          className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900" />
      </label>
      <div className="text-sm">
        <span className="font-medium">Your signature</span>
        <div className="mt-1"><SignaturePad onChange={setSignature} label="Your signature" /></div>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="agree" className="mt-1" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
        <span>I have read this contract and agree to its terms. I understand that signing here is the same as signing it on paper.</span>
      </label>
      {error && <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900" role="alert">{error}</p>}
      <button type="submit" disabled={pending || !signature || !agree || !name.trim()}
        className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
        {pending ? "Signing…" : "Sign the contract"}
      </button>
      <p className="text-xs text-gray-500">The time, your device and the exact text you signed are recorded with your signature.</p>
    </form>
  );
}
