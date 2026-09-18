"use client";

import { createContext, useContext, type ReactNode } from "react";

const ProjectManagementContext = createContext(false);
const ProjectRatesContext = createContext(false);

export function ProjectManagementProvider({ allowed, ratesAllowed, children }: { allowed: boolean; ratesAllowed: boolean; children: ReactNode }) {
  return <ProjectManagementContext.Provider value={allowed}><ProjectRatesContext.Provider value={ratesAllowed}>{children}</ProjectRatesContext.Provider></ProjectManagementContext.Provider>;
}

export function useProjectRates() { return useContext(ProjectRatesContext); }

export function useProjectManagement() {
  return useContext(ProjectManagementContext);
}
