/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { WORKFLOW_CREDENTIAL_PASSWORD_MIN_LENGTH } from "@hexabot-ai/types";
import { Checkbox, FormControlLabel, Stack, Typography } from "@mui/material";

import { PasswordInput } from "@/app-components/inputs/PasswordInput";
import { PasswordStrengthInput } from "@/app-components/inputs/PasswordStrengthInput";
import { useTranslate } from "@/hooks/useTranslate";

export const ExportCredentialsDialogBody = ({
  includeCredentials,
  onIncludeCredentialsChange,
  password,
  passwordConfirmation,
  onPasswordChange,
  onPasswordConfirmationChange,
}: {
  includeCredentials: boolean;
  onIncludeCredentialsChange: (value: boolean) => void;
  password: string;
  passwordConfirmation: string;
  onPasswordChange: (value: string) => void;
  onPasswordConfirmationChange: (value: string) => void;
}) => {
  const { t } = useTranslate();

  return (
    <Stack spacing={2} pt={1}>
      <Typography>{t("message.workflow_export_credentials")}</Typography>
      <FormControlLabel
        control={
          <Checkbox
            checked={includeCredentials}
            onChange={(event) =>
              onIncludeCredentialsChange(event.target.checked)
            }
          />
        }
        label={t("label.include_credentials")}
      />
      {includeCredentials ? (
        <>
          <Typography>{t("message.workflow_export_password_hint")}</Typography>
          <PasswordStrengthInput
            autoFocus
            fullWidth
            required
            minimumLength={WORKFLOW_CREDENTIAL_PASSWORD_MIN_LENGTH}
            label={t("label.password")}
            value={password}
            onChange={(event) => onPasswordChange(event.target.value)}
          />
          <PasswordInput
            fullWidth
            required
            label={t("label.confirm_password")}
            value={passwordConfirmation}
            error={Boolean(
              passwordConfirmation && passwordConfirmation !== password,
            )}
            helperText={
              passwordConfirmation && passwordConfirmation !== password
                ? t("message.password_match")
                : undefined
            }
            onChange={(event) =>
              onPasswordConfirmationChange(event.target.value)
            }
          />
        </>
      ) : null}
    </Stack>
  );
};
