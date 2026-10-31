/**
 * People W4 S3 (2026-10-30): the people on a goal, from its tasks (Task.personId).
 * Each live person once, sorted by name; a soft-deleted person is left out.
 */
export function peopleOnGoal(
  tasks: ReadonlyArray<{ person?: { id: string; name: string; deletedAt: Date | null } | null }>,
): Array<{ id: string; name: string }> {
  const byId = new Map<string, string>();
  for (const t of tasks) if (t.person && !t.person.deletedAt) byId.set(t.person.id, t.person.name);
  return [...byId].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}
