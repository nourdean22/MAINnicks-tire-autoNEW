/**
 * /api/skills — Skill library curation endpoint.
 *
 * Apr 18. Pairs with SkillLibraryPanel in /settings.
 *
 *   GET  → { active: StoredSkill[], pending: StoredSkill[] }
 *   PATCH { key, action, note?, kind? }
 *         action = "promote" | "drop" | "graduate" | "ungraduate"
 *         kind   = "skill" | "skill_pending" (default matches action)
 *
 * Session-guarded (owner) so only Nour can curate.
 */
import { apiHandler, readRequestJson } from "@/lib/utils/http";
import {
  loadActiveSkills,
  loadPendingSkills,
  promoteSkill,
  dropSkill,
  setGraduated,
  editSkill,
  extractSkillsFromTasks,
} from "@/lib/brain/skill-extractor";
import { ServiceError } from "@/lib/utils/service-error";

export const GET = apiHandler(
  async () => {
    const [active, pending] = await Promise.all([
      loadActiveSkills(),
      loadPendingSkills(),
    ]);
    return { active, pending };
  },
  { auth: "owner" },
);

interface PatchBody {
  key?: string;
  action?: "promote" | "drop" | "graduate" | "ungraduate" | "edit" | "extract_now";
  note?: string;
  kind?: "skill" | "skill_pending";
  trigger?: string;
  actionText?: string;
}

export const PATCH = apiHandler(
  async (req) => {
    const body = await readRequestJson<PatchBody>(req);
    if (!body.action) throw new ServiceError("action required", 400);

    // ── Non-key actions ──
    if (body.action === "extract_now") {
      const result = await extractSkillsFromTasks();
      return { ok: true, result };
    }

    if (!body.key) throw new ServiceError("key required", 400);

    if (body.action === "promote") {
      const promoted = await promoteSkill(body.key, body.note);
      if (!promoted) throw new ServiceError("candidate not found", 404);
      return { ok: true, skill: promoted };
    }

    if (body.action === "drop") {
      const kind = body.kind ?? "skill_pending";
      const dropped = await dropSkill(body.key, kind);
      if (!dropped) throw new ServiceError("skill not found", 404);
      return { ok: true, dropped: true, kind };
    }

    if (body.action === "graduate" || body.action === "ungraduate") {
      const updated = await setGraduated(body.key, body.action === "graduate");
      if (!updated) throw new ServiceError("active skill not found", 404);
      return { ok: true, skill: updated };
    }

    if (body.action === "edit") {
      const kind = body.kind ?? "skill_pending";
      const updated = await editSkill(body.key, kind, {
        trigger: body.trigger,
        action: body.actionText,
        reviewNote: body.note,
      });
      if (!updated) throw new ServiceError("skill not found", 404);
      return { ok: true, skill: updated };
    }

    throw new ServiceError("unknown action", 400);
  },
  { auth: "owner" },
);
