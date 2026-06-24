/**
 * lib/services/content-studio.ts
 *
 * DB wrappers for ContentStudioProject (the shared NOUR OS memory for
 * the Instagram Carousel and Faceless Reel studios).
 *
 * Operations return flat views/explicit shapes so they can be consumed
 * directly by TRPC routers.
 */

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export interface CreateStudioProjectInput {
  contentType: string;
  topic: string;
  briefJson: Prisma.InputJsonValue;
  status?: string;
}

export interface UpdateStudioProjectInput {
  topic?: string;
  briefJson?: Prisma.InputJsonValue;
  status?: string;
}

/**
 * Creates a new content studio project draft.
 */
export async function createStudioProject(input: CreateStudioProjectInput) {
  return await prisma.contentStudioProject.create({
    data: {
      contentType: input.contentType,
      topic: input.topic,
      briefJson: input.briefJson,
      status: input.status ?? "draft",
    },
  });
}

/**
 * Updates an existing content studio project.
 */
export async function updateStudioProject(
  id: string,
  input: UpdateStudioProjectInput
) {
  return await prisma.contentStudioProject.update({
    where: { id },
    data: {
      topic: input.topic,
      briefJson: input.briefJson,
      status: input.status,
    },
  });
}

/**
 * Lists content studio projects, optionally filtered by content type.
 * Ordered by most recently updated.
 */
export async function listStudioProjects(
  contentType?: string,
  limit: number = 50
) {
  return await prisma.contentStudioProject.findMany({
    where: contentType ? { contentType } : undefined,
    orderBy: { updatedAt: "desc" },
    take: limit,
  });
}

/**
 * Retrieves a single content studio project by ID.
 */
export async function getStudioProject(id: string) {
  return await prisma.contentStudioProject.findUnique({
    where: { id },
  });
}

/**
 * Deletes a content studio project.
 */
export async function deleteStudioProject(id: string) {
  return await prisma.contentStudioProject.delete({
    where: { id },
  });
}
