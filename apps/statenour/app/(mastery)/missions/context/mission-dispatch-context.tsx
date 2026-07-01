import { createContext, useContext } from "react";
import type { useMissionActions } from "../hooks/use-mission-actions";

type MissionActions = ReturnType<typeof useMissionActions>;

const MissionDispatchContext = createContext<MissionActions | null>(null);

export function MissionDispatchProvider({
  children,
  actions,
}: {
  children: React.ReactNode;
  actions: MissionActions;
}) {
  return (
    <MissionDispatchContext.Provider value={actions}>
      {children}
    </MissionDispatchContext.Provider>
  );
}

export function useMissionDispatch() {
  const context = useContext(MissionDispatchContext);
  if (!context) {
    throw new Error("useMissionDispatch must be used within a MissionDispatchProvider");
  }
  return context;
}
