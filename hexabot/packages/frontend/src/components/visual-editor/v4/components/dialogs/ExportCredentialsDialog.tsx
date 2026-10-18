/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { isStrongWorkflowCredentialPassword } from "@hexabot-ai/types";
import { Button, Dialog, DialogActions, DialogContent } from "@mui/material";
import { useState } from "react";

import { DialogTitle } from "@/app-components/dialogs";
import { useTranslate } from "@/hooks/useTranslate";
import type { DialogProps } from "@/types/common/dialogs.types";

import { ExportCredentialsDialogBody } from "./ExportCredentialsDialogBody";

export const ExportCredentialsDialog = ({
  open,
  onClose,
}: DialogProps<undefined, string | null | undefined>) => {
  const { t } = useTranslate();
  const [includeCredentials, setIncludeCredentials] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const canExport =
    !includeCredentials ||
    (isStrongWorkflowCredentialPassword(password) &&
      password === passwordConfirmation);

  return (
    <Dialog
      open={open}
      maxWidth="sm"
      fullWidth
      onClose={() => void onClose(undefined)}
    >
      <DialogTitle onClose={() => void onClose(undefined)}>
        {t("title.workflow_export_credentials")}
      </DialogTitle>
      <DialogContent>
        <ExportCredentialsDialogBody
          includeCredentials={includeCredentials}
          onIncludeCredentialsChange={setIncludeCredentials}
          password={password}
          passwordConfirmation={passwordConfirmation}
          onPasswordChange={setPassword}
          onPasswordConfirmationChange={setPasswordConfirmation}
        />
      </DialogContent>
      <DialogActions sx={{ p: 1 }}>
        <Button
          color={includeCredentials ? "warning" : "primary"}
          variant="contained"
          disabled={!canExport}
          onClick={() => void onClose(includeCredentials ? password : null)}
        >
          {t("button.export")}
        </Button>
        <Button variant="outlined" onClick={() => void onClose(undefined)}>
          {t("button.cancel")}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
