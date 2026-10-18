/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  iconButtonClasses,
  listClasses,
  listItemIconClasses,
  menuItemClasses,
  paperClasses,
} from "@mui/material";
import { checkboxClasses } from "@mui/material/Checkbox";
import { alpha, Components, Theme } from "@mui/material/styles";
import { tablePaginationClasses } from "@mui/material/TablePagination";
import { gridClasses } from "@mui/x-data-grid";

import { gray } from "../themePrimitives";

export const datagridCustomizations: Components<Theme> = {
  MuiDataGrid: {
    defaultProps: { columnHeaderHeight: 56, rowHeight: 64 },
    styleOverrides: {
      root: ({ theme }) => {
        const p = theme.vars || theme;
        const {
          divider,
          text,
          action,
          background,
          primary: pPrimary,
        } = p.palette;
        // Use standard theme.palette for alpha() to avoid var() parsing errors
        const { primary, common } = theme.palette;
        const st = alpha(primary.main, 0.02);
        const bdr = `1px solid ${divider}`;

        return {
          "--DataGrid-overlayHeight": "300px",
          minWidth: 0,
          overflow: "clip",
          borderRadius: theme.spacing(1),
          borderColor: divider,
          backgroundColor: background.default,
          boxShadow: `0 2px 6px ${alpha(common.black, 0.12)}`,
          ...theme.applyStyles("dark", {
            boxShadow: `0 0 0 1px ${alpha(common.white, 0.08)}, 0 2px 8px ${alpha(common.white, 0.12)}`,
          }),
          [`& .${gridClasses.columnHeaders}, & .${gridClasses.columnHeader}`]: {
            color: text.secondary,
            backgroundColor: st,
          },
          [`& .${gridClasses.columnHeader}`]: {
            paddingInline: theme.spacing(3),
          },
          [`& .${gridClasses.columnHeaderTitle}`]: {
            fontSize: theme.typography.pxToRem(16),
            fontWeight: theme.typography.fontWeightMedium,
          },
          [`& .${gridClasses.footerContainer}`]: {
            minHeight: theme.spacing(9),
            paddingInline: theme.spacing(2),
            backgroundColor: st,
          },
          [`& .${checkboxClasses.root}`]: {
            padding: theme.spacing(0.5),
            "& > svg": { fontSize: "1rem" },
          },
          [`& .${tablePaginationClasses.root}`]: {
            flex: 1,
            marginRight: 0,
            [`& .${tablePaginationClasses.toolbar}`]: { padding: 0 },
            [`& .${tablePaginationClasses.spacer}`]: { order: 2 },
            [`& .${tablePaginationClasses.selectLabel}`]: {
              order: 0,
              marginLeft: theme.spacing(0.75),
            },
            [`& .${tablePaginationClasses.selectRoot}`]: {
              order: 1,
              minWidth: theme.spacing(9),
              minHeight: theme.spacing(5),
              marginLeft: theme.spacing(1),
              marginRight: theme.spacing(2),
              border: bdr,
              borderRadius: p.shape.borderRadius,
            },
            [`& .${tablePaginationClasses.displayedRows}`]: { order: 3 },
            [`& .${tablePaginationClasses.actions}`]: {
              order: 4,
              "& .MuiPaginationItem-root": {
                width: theme.spacing(5),
                height: theme.spacing(5),
                border: bdr,
                "&.Mui-selected": {
                  fontWeight: "bold",
                  color: pPrimary.main,
                  backgroundColor: action.selected,
                },
                "&:hover": {
                  color: pPrimary.dark,
                  backgroundColor: action.hover,
                },
              },
              "& li:last-of-type > .MuiPaginationItem-root": { marginRight: 0 },
            },
            "& .MuiIconButton-root": {
              maxHeight: theme.spacing(5),
              maxWidth: theme.spacing(5),
              "& > svg": { fontSize: "1rem" },
            },
          },
          "& .MuiDataGrid-cell": {
            display: "flex",
            alignItems: "center",
            paddingInline: theme.spacing(3),
            fontSize: theme.typography.pxToRem(16),
          },
          "& .MuiDataGrid-cell[data-field='actions']": {
            alignContent: "center",
            "& .MuiIconButton-root": {
              width: theme.spacing(5),
              height: theme.spacing(5),
              color: text.primary,
              backgroundColor: background.paper,
              border: bdr,
              borderRadius: p.shape.borderRadius,
              boxShadow: "none",
              textTransform: "none",
              letterSpacing: 0,
              transition: theme.transitions.create(
                ["background-color", "border-color", "color"],
                { duration: theme.transitions.duration.shortest },
              ),
              "&:hover": {
                backgroundColor: action.hover,
                borderColor: text.secondary,
              },
              "&:active": { backgroundColor: action.selected },
              "&:focus-visible": {
                outline: `2px solid ${alpha(primary.main, 0.35)}`,
                outlineOffset: 2,
              },
            },
            "& .MuiStack-root": {
              flexDirection: "row",
              display: "flex",
              gap: theme.spacing(0.5),
            },
          },
        };
      },
      cell: ({ theme }) => ({
        borderTopColor: (theme.vars || theme).palette.divider,
      }),
      menu: ({ theme }) => {
        const p = theme.vars || theme;

        return {
          borderRadius: p.shape.borderRadius,
          backgroundImage: "none",
          [`& .${paperClasses.root}`]: {
            border: `1px solid ${p.palette.divider}`,
          },
          [`& .${menuItemClasses.root}`]: { margin: "0 4px" },
          [`& .${listItemIconClasses.root}`]: { marginRight: 0 },
          [`& .${listClasses.root}`]: { padding: 0 },
        };
      },
      row: ({ theme }) => {
        const { action, divider } = (theme.vars || theme).palette;

        return {
          "&:last-of-type": { borderBottom: `1px solid ${divider}` },
          "&:hover": { backgroundColor: action.hover },
          "&.Mui-selected": {
            background: action.selected,
            "&:hover": { backgroundColor: action.hover },
          },
        };
      },
      iconButtonContainer: ({ theme }) => ({
        [`& .${iconButtonClasses.root}`]: {
          border: "none",
          backgroundColor: "transparent",
          "&:hover": {
            backgroundColor: alpha(theme.palette.action.selected, 0.3),
          },
          "&:active": { backgroundColor: gray[200] },
          ...theme.applyStyles("dark", {
            color: gray[50],
            "&:hover": { backgroundColor: gray[800] },
            "&:active": { backgroundColor: gray[900] },
          }),
        },
      }),
      menuIconButton: ({ theme }) => ({
        border: "none",
        backgroundColor: "transparent",
        "&:hover": { backgroundColor: gray[100] },
        "&:active": { backgroundColor: gray[200] },
        ...theme.applyStyles("dark", {
          color: gray[50],
          "&:hover": { backgroundColor: gray[800] },
          "&:active": { backgroundColor: gray[900] },
        }),
      }),
      filterForm: ({ theme }) => ({
        gap: theme.spacing(1),
        alignItems: "flex-end",
      }),
      columnsManagementHeader: ({ theme }) => ({
        paddingInline: theme.spacing(3),
      }),
      columnHeaderTitleContainer: {
        flexGrow: 1,
        justifyContent: "space-between",
      },
      columnHeaderDraggableContainer: { paddingRight: 2 },
    },
  },
};
