"use client";

import { createContext, useContext } from "react";
import { holds } from "@/lib/nav-permissions";

/**
 * The signed-in person's permissions, for client components that decide
 * whether to show a control (a Delete link) without each page passing a flag
 * down. The server still decides every action; this only hides what would be
 * refused.
 */
const PermissionsContext = createContext<string[]>([]);

export function PermissionsProvider({ value, children }: { value: string[]; children: React.ReactNode }) {
  return <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>;
}

export function useCan(permission: string): boolean {
  return holds(useContext(PermissionsContext), permission);
}
