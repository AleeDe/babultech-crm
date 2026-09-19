"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui";
import { deleteProject } from "@/server/projects";

/** Delete, with a confirmation, then back to the list. The server refuses invoiced projects. */
export function DeleteProjectButton({ projectId, name }: { projectId: string; name: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    if (!window.confirm(`Delete ${name}? Its tasks and history are kept, but it disappears from the project list and from its deal's costs.`)) return;
    setError(null);
    start(async () => {
      const result = await deleteProject(projectId);
      if (result.ok) {
        router.push("/projects");
        router.refresh();
      } else setError(result.error);
    });
  }

  return (
    <>
      <Button variant="outline" onClick={onClick} disabled={pending} className="text-destructive hover:text-destructive">
        <Trash2 className="h-4 w-4" /> {pending ? "Deleting…" : "Delete"}
      </Button>
      {error && <p role="alert" className="w-full text-right text-sm text-destructive">{error}</p>}
    </>
  );
}
