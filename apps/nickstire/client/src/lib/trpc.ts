import { createTRPCReact } from "@trpc/react-query";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";

export const trpc = createTRPCReact<AppRouter>();

/**
 * Types inferred from the tRPC AppRouter — use these instead of `any` when
 * referring to a procedure's output (e.g. inside a `.map(item => ...)`).
 *
 * Examples:
 *   type DispatchLoad = RouterOutputs["dispatch"]["load"];
 *   type Tech = DispatchLoad["techs"][number];
 *   type WorkOrder = RouterOutputs["workOrders"]["list"][number];
 */
export type RouterInputs = inferRouterInputs<AppRouter>;
export type RouterOutputs = inferRouterOutputs<AppRouter>;
