/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Stack, Typography } from "@mui/material";
import {
  GridColDef,
  GridRenderCellParams,
  GridValidRowModel,
} from "@mui/x-data-grid";
import { useMemo } from "react";

import { useTranslate } from "@/hooks/useTranslate";
import { TTranslationKeys } from "@/i18n/i18n.types";
import { normalizeDate } from "@/utils/date";

type TimestampField = "createdAt" | "updatedAt";

export const useTimestampColumns = <T extends GridValidRowModel>(
  filter?: TimestampField,
  headerI18nTitles?: Partial<Record<TimestampField, TTranslationKeys>>,
): GridColDef<T>[] => {
  const { i18n, t } = useTranslate();
  const { createdAt, updatedAt } = headerI18nTitles ?? {};

  return useMemo<GridColDef<T>[]>(
    () =>
      (["createdAt", "updatedAt"] as const)
        .filter((f) => !filter || f === filter)
        .map((field) => ({
          width: 150,
          field,
          disableColumnMenu: true,
          resizable: false,
          headerAlign: "left",
          headerName: t(headerI18nTitles?.[field] ?? `label.${field}`),
          renderCell: ({ value }: GridRenderCellParams<T, Date | string>) => (
            <Stack>
              <Typography>
                {normalizeDate(i18n.language, value, {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                })}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {normalizeDate(i18n.language, value, {
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false,
                })}
              </Typography>
            </Stack>
          ),
        })),
    [i18n.language, t, filter, createdAt, updatedAt],
  );
};
