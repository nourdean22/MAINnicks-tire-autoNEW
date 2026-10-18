/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Button, Dialog, DialogActions, DialogContent } from "@mui/material";
import { useState } from "react";

import { DialogTitle } from "@/app-components/dialogs";
import { PasswordInput } from "@/app-components/inputs/PasswordInput";
import { useTranslate } from "@/hooks/useTranslate";
import type { DialogProps } from "@/types/common/dialogs.types";

export const ImportCredentialsDialog = ({
  open,
  onClose,
}: DialogProps<undefined, string | undefined>) => {
  const { t } = useTranslate();
  const [password, setPassword] = useState("");

  return (
    <Dialog
      open={open}
      maxWidth="sm"
      fullWidth
      onClose={() => void onClose(undefined)}
    >
      <DialogTitle onClose={() => void onClose(undefined)}>
        {t("title.workflow_import_credentials")}
      </DialogTitle>
      <DialogContent sx={{ pt: 1 }}>
        <PasswordInput
          autoFocus
          fullWidth
          required
          label={t("label.password")}
          helperText={t("message.workflow_import_password_hint")}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && password) {
              void onClose(password);
            }
          }}
        />
      </DialogContent>
      <DialogActions sx={{ p: 1 }}>
        <Button
          variant="contained"
          disabled={!password}
          onClick={() => void onClose(password)}
        >
          {t("button.import")}
        </Button>
        <Button variant="outlined" onClick={() => void onClose(undefined)}>
          {t("button.cancel")}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
