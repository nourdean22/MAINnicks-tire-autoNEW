/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  CONTENT_TYPE_READ_ONLY_PROPERTY_KEYS,
  DEFAULT_CONTENT_TYPE_SCHEMA,
  type ContentType,
} from "@hexabot-ai/types";
import { FormHelperText, TextField } from "@mui/material";
import { FC, Fragment, useEffect, useMemo } from "react";
import { FormProvider, useForm, useWatch } from "react-hook-form";

import { ContentContainer, ContentItem } from "@/app-components/dialogs";
import {
  fromJsonSchema,
  JsonSchemaObjectBuilder,
  toJsonSchema,
} from "@/app-components/inputs/JsonSchemaObjectBuilder";
import { useCreate } from "@/hooks/crud/useCreate";
import { useUpdate } from "@/hooks/crud/useUpdate";
import { useToast } from "@/hooks/useToast";
import { useTranslate } from "@/hooks/useTranslate";
import { EntityType } from "@/services/types";
import type { EntityAttributes } from "@/types/base.types";
import { ComponentFormProps } from "@/types/common/dialogs.types";
import { validateJsonSchema } from "@/utils/jsonSchemaValidation";

const CONTEXT = "fieldInput" as const;

type ContentTypeAttributes = EntityAttributes<EntityType.CONTENT_TYPE>;

export const ContentTypeForm: FC<ComponentFormProps<ContentType>> = ({
  data: { defaultValues: contentType },
  Wrapper = Fragment,
  WrapperProps,
  ...rest
}) => {
  const { toast } = useToast();
  const { t } = useTranslate();
  const defaultValues = useMemo<ContentTypeAttributes>(
    () => ({
      name: contentType?.name ?? "",
      schema: fromJsonSchema(
        contentType?.schema ?? DEFAULT_CONTENT_TYPE_SCHEMA,
        "object",
        CONTEXT,
      ),
    }),
    [contentType],
  );
  const form = useForm<ContentTypeAttributes>({
    defaultValues,
  });
  const {
    control,
    register,
    setValue,
    setError,
    clearErrors,
    formState: { errors },
    handleSubmit,
  } = form;
  const schemaError = errors.schema as { message?: string } | undefined;
  const schemaValue = useWatch({ control, name: "schema" });
  const nameRegister = register("name", {
    required: t("message.name_is_required"),
  });
  const options = {
    onError: (error: Error) => {
      rest.onError?.();
      toast.error(error);
    },
    onSuccess: (data: ContentType) => {
      rest.onSuccess?.(data);
      toast.success(t("message.success_save"));
    },
  };
  const { mutate: createContentType } = useCreate(
    EntityType.CONTENT_TYPE,
    options,
  );
  const { mutate: updateContentType } = useUpdate(
    EntityType.CONTENT_TYPE,
    options,
  );
  const onSubmitForm = (params: ContentTypeAttributes) => {
    const name = params.name.trim();
    const schemaNode = { ...params.schema, title: name };
    const jsonSchema = toJsonSchema(schemaNode);
    const invalidSchemaMessage = t("message.schema_is_invalid", {
      defaultValue: "Invalid JSON schema.",
    });
    let schemaErrorMessage: string | undefined;

    try {
      const schemaValidation = validateJsonSchema(jsonSchema, CONTEXT);

      schemaErrorMessage = schemaValidation.valid
        ? undefined
        : (schemaValidation.errors[0]?.stack ?? invalidSchemaMessage);
    } catch (error) {
      schemaErrorMessage =
        error instanceof Error ? error.message : invalidSchemaMessage;
    }

    if (schemaErrorMessage) {
      setError("schema", { type: "manual", message: schemaErrorMessage });
      toast.error(invalidSchemaMessage);

      return;
    }

    clearErrors("schema");
    const payload: ContentTypeAttributes = {
      name,
      schema: jsonSchema as any,
    };

    if (contentType?.id) {
      updateContentType({ id: contentType.id, params: payload });
    } else {
      createContentType(payload);
    }
  };

  useEffect(() => {
    if (schemaError?.message) {
      clearErrors("schema");
    }
  }, [schemaValue, schemaError?.message, clearErrors]);

  return (
    <FormProvider {...form}>
      <Wrapper onSubmit={handleSubmit(onSubmitForm)} {...WrapperProps}>
        <form onSubmit={handleSubmit(onSubmitForm)}>
          <ContentContainer>
            <ContentItem>
              <TextField
                label={t("label.name")}
                error={!!errors.name}
                {...nameRegister}
                helperText={errors.name ? errors.name.message : null}
                required
                autoFocus
                onChange={(event) => {
                  nameRegister.onChange(event);
                  setValue("schema.title", event.target.value, {
                    shouldDirty: true,
                  });
                }}
              />
            </ContentItem>
            <ContentItem>
              <JsonSchemaObjectBuilder
                name="schema"
                label={t("label.schema")}
                context={CONTEXT}
                readOnlyPropertyKeys={CONTENT_TYPE_READ_ONLY_PROPERTY_KEYS}
              />
              {schemaError?.message && (
                <FormHelperText error>{schemaError.message}</FormHelperText>
              )}
            </ContentItem>
          </ContentContainer>
        </form>
      </Wrapper>
    </FormProvider>
  );
};
