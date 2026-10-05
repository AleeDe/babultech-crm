"use client";

import { useState, useTransition } from "react";
import { Alert, Button, Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { updateProfile } from "@/server/people";
import { PersonalFields, BackgroundFields } from "../../person-forms";
import { profileState, type ProfileState } from "@/lib/people-forms";

export function ProfileEditor({ staffId, initial }: { staffId: string; initial: Record<string, unknown> }) {
  const [profile, setProfile] = useState<ProfileState>(() => profileState(initial));
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save() {
    setError(null);
    start(async () => {
      const result = await updateProfile(staffId, profile);
      if (!result.ok) { setError(result.error); setErrors(result.fieldErrors); return; }
      window.location.href = `/people/${staffId}`;
    });
  }

  return (
    <div className="space-y-6">
      {error && <Alert tone="danger">{error}</Alert>}
      <Card>
        <CardHeader><CardTitle>Personal details</CardTitle></CardHeader>
        <CardContent><PersonalFields value={profile} onChange={setProfile} errors={errors} /></CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Education, experience and skills</CardTitle></CardHeader>
        <CardContent><BackgroundFields value={profile} onChange={setProfile} errors={errors} /></CardContent>
      </Card>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => history.back()}>Cancel</Button>
        <Button type="button" disabled={pending} onClick={save}>{pending ? "Saving…" : "Save changes"}</Button>
      </div>
    </div>
  );
}
