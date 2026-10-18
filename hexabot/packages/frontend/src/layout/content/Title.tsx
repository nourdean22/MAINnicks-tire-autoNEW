/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Typography } from "@mui/material";
import Grid from "@mui/material/Grid";
import { useTheme } from "@mui/material/styles";
import { LucideIcon } from "lucide-react";
import { ReactNode } from "react";

import { Badge } from "@/app-components/displays/Badge";

export const Title = (props: {
  title: string;
  description?: string;
  Icon?: LucideIcon;
  chip?: ReactNode;
  gap?: number;
}) => {
  const theme = useTheme();

  return (
    <Grid container gap={props.gap || 1} alignItems="center">
      {props.Icon ? (
        <Badge
          icon={props.Icon}
          color={(theme.vars || theme).palette.primary.main}
          width={theme.spacing(7)}
          height={theme.spacing(7)}
          radius={theme.spacing(2)}
          padding={theme.spacing(1.75)}
          disableTooltip
        />
      ) : null}
      <Grid>
        <Grid container alignItems="center" gap={1}>
          <Typography
            variant="h5"
            fontWeight={700}
            height="fit-content"
            color="text.secondary"
          >
            {props.title}
            {props.chip ? ":" : ""}
          </Typography>
          {props.chip ? <Grid>{props.chip}</Grid> : null}
        </Grid>
        {props.description ? (
          <Typography color="text.secondary" mt={0.5}>
            {props.description}
          </Typography>
        ) : null}
      </Grid>
    </Grid>
  );
};
