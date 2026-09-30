import {
  selectEligibleLanes,
  type CapabilityLane,
  type RoutingRequest,
} from "@nour/ai-capabilities";

interface OracleInput {
  request: RoutingRequest;
  lanes: CapabilityLane[];
}

function main() {
  const raw = process.argv[2] ?? "";
  let input: OracleInput;
  try {
    input = JSON.parse(raw) as OracleInput;
  } catch (error) {
    console.error(
      `invalid oracle input: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(2);
  }

  const selected = selectEligibleLanes(input.lanes, input.request);
  process.stdout.write(
    JSON.stringify({
      selected: selected.map((lane) => ({
        id: lane.id,
        costClass: lane.costClass,
        health: lane.health,
        quota: lane.quota,
      })),
      selectedIds: selected.map((lane) => lane.id),
      selectedCostClasses: selected.map((lane) => lane.costClass),
    }),
  );
}

main();
