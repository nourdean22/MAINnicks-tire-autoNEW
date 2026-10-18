/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Chip, useMediaQuery } from "@mui/material";
import Grid from "@mui/material/Grid";
import type { Theme } from "@mui/material/styles";
import {
  DataGridProps,
  GridColDef,
  GridRowSelectionModel,
} from "@mui/x-data-grid";
import snakeCase from "lodash/snakeCase";
import { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { useDataGridProps } from "@/hooks/useDataGridProps";
import { useTranslate } from "@/hooks/useTranslate";
import { TTranslationKeys } from "@/i18n/i18n.types";
import { PageHeader } from "@/layout/content/PageHeader";
import { IFindConfigProps, THook } from "@/types/base.types";
import {
  SearchHookOptions,
  SearchPayload,
  TParamItem,
} from "@/types/search.types";

import {
  ButtonActionsGroup,
  ButtonActionsGroupProps,
} from "../buttons/ButtonActionsGroup";
import { FilterTextfield } from "../inputs/FilterTextfield";

import { DataGrid } from "./DataGrid";
import { type Filter, ResponsiveGenericFilters } from "./GenericFilters";

export const GenericDataGrid = <
  TP extends THook["params"],
  TE extends TP["entity"],
  F extends TP["format"],
>({
  entity,
  buttons,
  columns,
  headerIcon,
  searchParams,
  initialSortState,
  initialPaginationState = { page: 0, pageSize: 10 },
  format,
  headerI18nTitle,
  headerI18nDescription,
  headerTitleChip,
  headerLeftButtons,
  footerControls,
  selectionChangeHandler,
  filters,
  hasTextFilter = true,
  ...restDataGridProps
}: {
  entity: TE;
  buttons?: ButtonActionsGroupProps["buttons"];
  headerIcon?: LucideIcon;
  searchParams: TParamItem<TE> &
    SearchHookOptions & {
      getFindParams?: (searchPayload: SearchPayload<TE>) => SearchPayload<TE>;
    };
  format?: F;
  columns: GridColDef<THook<{ entity: TE; format: F }>["current"]>[];
  headerI18nTitle?: TTranslationKeys;
  headerI18nDescription?: TTranslationKeys;
  headerTitleChip?: string;
  headerLeftButtons?: React.ReactElement;
  footerControls?: ReactNode;
  selectionChangeHandler?: (selection: GridRowSelectionModel) => void;
  filters?: Filter[];
  hasTextFilter?: boolean;
} & Pick<IFindConfigProps<TE>, "initialSortState" | "initialPaginationState"> &
  DataGridProps) => {
  const { t } = useTranslate();
  const isSmallView = useMediaQuery(
    (theme: Theme) => theme.breakpoints.down("md"),
    { noSsr: true },
  );
  const { dataGridProps, onSearch, searchText } = useDataGridProps(
    { entity, format: format as any },
    { searchParams, initialSortState, initialPaginationState },
  );
  const descriptionKey =
    headerI18nDescription ??
    (`message.page_description.${snakeCase(entity)}` as TTranslationKeys);

  return (
    <Grid width="100%" minWidth={0}>
      <Grid
        container={!!headerI18nTitle}
        flexDirection="column"
        gap={3}
        minWidth={0}
      >
        <PageHeader
          icon={headerIcon}
          title={headerI18nTitle && t(headerI18nTitle)}
          description={headerI18nTitle && t(descriptionKey)}
          chip={
            headerTitleChip && <Chip label={headerTitleChip} size="medium" />
          }
          headerLeftButtons={headerLeftButtons}
        >
          <Grid
            gap={1}
            container
            flexWrap="nowrap"
            flexGrow={isSmallView ? 1 : 0}
            width="auto"
            justifyContent="end"
            alignItems="flex-end"
            sx={{ "& .MuiInputLabel-root.MuiInputLabel-root": { mb: 0.25 } }}
          >
            {hasTextFilter && (
              <FilterTextfield
                onChange={onSearch}
                defaultValue={searchText}
                sx={{
                  minWidth: { xs: 0, sm: 280 },
                  ...(isSmallView ? { flex: 1 } : { width: "auto" }),
                }}
              />
            )}
            {filters?.length && <ResponsiveGenericFilters filters={filters} />}
            {buttons && (
              <Grid size="auto" alignContent="end">
                <ButtonActionsGroup entity={entity} buttons={buttons} />
              </Grid>
            )}
          </Grid>
        </PageHeader>
        <Grid
          container
          flexDirection="column"
          gap={1}
          width="100%"
          minWidth={0}
        >
          <DataGrid
            columns={columns}
            {...dataGridProps}
            checkboxSelection={!!selectionChangeHandler}
            onRowSelectionModelChange={selectionChangeHandler}
            {...restDataGridProps}
          />
          {footerControls && (
            <Grid container justifyContent="flex-end">
              {footerControls}
            </Grid>
          )}
        </Grid>
      </Grid>
    </Grid>
  );
};
