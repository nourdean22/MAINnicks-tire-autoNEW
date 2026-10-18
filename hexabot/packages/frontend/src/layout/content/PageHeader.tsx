/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Box } from "@mui/material";
import { LucideIcon } from "lucide-react";
import { PropsWithChildren, ReactNode } from "react";

import { Title } from "./Title";

export const PageHeader = ({
  title,
  description,
  icon,
  chip,
  headerLeftButtons,
  children,
}: PropsWithChildren<{
  title?: string;
  description?: string;
  icon?: LucideIcon;
  chip?: ReactNode;
  headerLeftButtons?: React.ReactElement;
}>) => (
  <Box>
    {headerLeftButtons && <Box alignItems="start">{headerLeftButtons}</Box>}
    <Box
      sx={{
        display: "flex",
        justifyContent: { xs: "center", md: "space-between" },
        alignItems: "flex-end",
        flexWrap: "wrap",
        gap: 2,
      }}
    >
      {(title || icon) && (
        <Box alignSelf="flex-start">
          <Title
            title={title || ""}
            description={description}
            Icon={icon}
            chip={chip}
          />
        </Box>
      )}
      {children}
    </Box>
  </Box>
);
