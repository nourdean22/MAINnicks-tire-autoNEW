/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import Grid from "@mui/material/Grid";
import {
  DataGridProps,
  GridColDef,
  GridSlotsComponent,
  GridValidRowModel,
  DataGrid as MuiDataGrid,
} from "@mui/x-data-grid";
import { useMemo } from "react";

import { styledPaginationSlots } from "./DataGridStyledPagination";
import { ErrorOverlay } from "./ErrorOverlay";
import { NoDataOverlay } from "./NoDataOverlay";

const DEFAULT_COLUMN_MIN_WIDTH = 100;
const EMPTY_ROWS: never[] = [];

export const DataGrid = <T extends GridValidRowModel = any>({
  columns,
  rows = EMPTY_ROWS,
  disableRowSelectionOnClick = true,
  slots,
  showCellVerticalBorder = false,
  showColumnVerticalBorder = false,
  error,
  ...rest
}: DataGridProps<T> & { error?: boolean }) => {
  const styledColumns = useMemo<GridColDef<T>[]>(
    () =>
      columns.map((col) => ({
        disableColumnMenu: true,
        headerAlign: "left",
        ...(col.width
          ? { flex: 0 }
          : {
              flex: 1,
              minWidth: Math.min(
                DEFAULT_COLUMN_MIN_WIDTH,
                col.maxWidth ?? Infinity,
              ),
            }),
        ...col,
      })),
    [columns],
  );
  const normalizedSlots = useMemo(
    () =>
      slots ||
      ({
        noRowsOverlay: error ? ErrorOverlay : NoDataOverlay,
        noResultsOverlay: error ? ErrorOverlay : NoDataOverlay,
        ...styledPaginationSlots,
      } as Partial<GridSlotsComponent> | undefined),
    [slots, error],
  );

  return (
    <Grid size={12} minWidth={0}>
      <MuiDataGrid<T>
        disableRowSelectionOnClick={disableRowSelectionOnClick}
        slots={normalizedSlots}
        slotProps={{
          loadingOverlay: {
            variant: "skeleton",
            noRowsVariant: "skeleton",
          },
        }}
        showCellVerticalBorder={showCellVerticalBorder}
        showColumnVerticalBorder={showColumnVerticalBorder}
        columns={styledColumns}
        rows={rows}
        {...rest}
      />
    </Grid>
  );
};
