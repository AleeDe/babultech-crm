"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { changeUserTeam, createUserTeam, type getUserTeams } from "@/server/user-teams";
import { Button, Card, CardContent, Input, Select, Alert } from "@/components/ui";

export function TeamEditor({ userId, data }: { userId: string; data: Awaited<ReturnType<typeof getUserTeams>> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const selected = new Set(data.memberships.map(m => m.teamId));
  function run(action: () => Promise<{ error: string | null }>) {
    start(async () => { try { const result = await action(); setError(result.error); if (!result.error) router.refresh(); } catch { setError("Could not save. Refresh and check your access."); } });
  }
  return <div className="mt-4 space-y-4">
    {error && <Alert tone="danger">{error}</Alert>}
    <Card><CardContent className="space-y-3 p-4">
      <h2 className="font-semibold">Team membership</h2>
      <p className="text-sm text-muted-foreground">Removing membership removes that team's access path. Other roles, ownership and assignments may still grant access.</p>
      {data.teams.length === 0 && <p>No teams yet. Create one below.</p>}
      {data.teams.map(team => <div key={team.id} className="flex flex-wrap items-center justify-between gap-2 border-b py-2">
        <span>{team.name} · {team.teamType}{!team.active && " · Inactive"}</span>
        <Button disabled={pending || (!selected.has(team.id) && (!team.active || data.user.status !== "ACTIVE" || Boolean(data.user.partnerId)))} variant="outline" onClick={() => run(() => changeUserTeam({ userId, teamId: team.id, operation: selected.has(team.id) ? "remove" : "add" }))}>{selected.has(team.id) ? "Remove" : "Add"}</Button>
      </div>)}
    </CardContent></Card>
    <Card><CardContent className="p-4"><h2 className="mb-3 font-semibold">Create team</h2>
      <form className="flex flex-wrap gap-3" onSubmit={event => { event.preventDefault(); const values = new FormData(event.currentTarget); run(() => createUserTeam({ name: String(values.get("name")), teamType: String(values.get("teamType")) })); }}>
        <Input name="name" aria-label="Team name" required minLength={2} maxLength={100} placeholder="Content delivery" />
        <Select name="teamType" aria-label="Team type">{["SALES", "SUPPORT", "PROJECT", "FINANCE", "MARKETING"].map(t => <option key={t}>{t}</option>)}</Select>
        <Button disabled={pending}>Create team</Button>
      </form>
    </CardContent></Card>
  </div>;
}
