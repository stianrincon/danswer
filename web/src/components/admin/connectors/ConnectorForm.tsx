"use client";

import React, { useState } from "react";
import { Formik, Form } from "formik";
import * as Yup from "yup";
import { Popup, usePopup } from "./Popup";
import {
  Connector,
  ConnectorBase,
  ValidInputTypes,
  ValidSources,
} from "@/lib/types";
import { deleteConnectorIfExistsAndIsUnlinked } from "@/lib/connector";
import { FormBodyBuilder, RequireAtLeastOne } from "./types";
import { BooleanFormField, TextFormField } from "./Field";
import { createCredential, linkCredential } from "@/lib/credential";
import { useSWRConfig } from "swr";
import { Button, Divider } from "@tremor/react";
import IsPublicField from "./IsPublicField";
import { usePaidEnterpriseFeaturesEnabled } from "@/components/settings/usePaidEnterpriseFeaturesEnabled";
import { HidableSection } from "@/app/admin/assistants/HidableSection";
import { useConnectorAdvancedSettings } from "./hooks";

const BASE_CONNECTOR_URL = "/api/manage/admin/connector";

export async function submitConnector<T>(
  connector: ConnectorBase<T>,
  connectorId?: number
): Promise<{ message: string; isSuccess: boolean; response?: Connector<T> }> {
  const isUpdate = connectorId !== undefined;

  try {
    const response = await fetch(
      BASE_CONNECTOR_URL + (isUpdate ? `/${connectorId}` : ""),
      {
        method: isUpdate ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(connector),
      }
    );

    if (response.ok) {
      const responseJson = await response.json();
      return { message: "Success!", isSuccess: true, response: responseJson };
    } else {
      const errorData = await response.json();
      return { message: `Error: ${errorData.detail}`, isSuccess: false };
    }
  } catch (error) {
    return { message: `Error: ${error}`, isSuccess: false };
  }
}

const CCPairNameHaver = Yup.object().shape({
  cc_pair_name: Yup.string().required("Please enter a name for the connector"),
});

interface BaseProps<T extends Yup.AnyObject> {
  nameBuilder: (values: T) => string;
  ccPairNameBuilder?: (values: T) => string | null;
  source: ValidSources;
  inputType: ValidInputTypes;
  // if specified, will automatically try and link the credential
  credentialId?: number;
  // If both are specified, will render formBody and then formBodyBuilder
  formBody?: JSX.Element | null;
  formBodyBuilder?: FormBodyBuilder<T>;
  validationSchema: Yup.ObjectSchema<T>;
  initialValues: T;
  onSubmit?: (
    isSuccess: boolean,
    responseJson: Connector<T> | undefined
  ) => void;
  refreshFreq?: number;
  pruneFreq?: number;
  // If specified, then we will create an empty credential and associate
  // the connector with it. If credentialId is specified, then this will be ignored
  shouldCreateEmptyCredentialForConnector?: boolean;
}

type ConnectorFormProps<T extends Yup.AnyObject> = RequireAtLeastOne<
  BaseProps<T>,
  "formBody" | "formBodyBuilder"
>;

export function ConnectorForm<T extends Yup.AnyObject>({
  nameBuilder,
  ccPairNameBuilder,
  source,
  inputType,
  credentialId,
  formBody,
  formBodyBuilder,
  validationSchema,
  initialValues,
  refreshFreq,
  pruneFreq,
  onSubmit,
  shouldCreateEmptyCredentialForConnector,
}: ConnectorFormProps<T>): JSX.Element {
  const { mutate } = useSWRConfig();
  const { popup, setPopup } = usePopup();

  // only show this option for EE, since groups are not supported in CE
  const showNonPublicOption = usePaidEnterpriseFeaturesEnabled();
  const displayAdvancedSettings = useConnectorAdvancedSettings();

  // Define common fields
  const commonFields = {
    embedding_size: "",
    chunk_overlap: ""
  };

  const shouldHaveNameInput = credentialId !== undefined && !ccPairNameBuilder;

  const ccPairNameInitialValue = shouldHaveNameInput
    ? { cc_pair_name: "" }
    : {};
  const publicOptionInitialValue = showNonPublicOption
    ? { is_public: false }
    : {};

  let finalValidationSchema =
    validationSchema as Yup.ObjectSchema<Yup.AnyObject>;
  if (shouldHaveNameInput) {
    finalValidationSchema = finalValidationSchema.concat(CCPairNameHaver);
  }
  if (showNonPublicOption) {
    finalValidationSchema = finalValidationSchema.concat(
      Yup.object().shape({
        is_public: Yup.boolean(),
      })
    );
  }

  finalValidationSchema = finalValidationSchema.concat(Yup.object().shape({
    embedding_size: Yup.string(),
    chunk_overlap: Yup.string()
  }));

  const formInitialValues = {
    ...publicOptionInitialValue,
    ...ccPairNameInitialValue,
    ...initialValues,
    ...commonFields,
  };

  return (
    <>
      {popup}
      <Formik
        initialValues={formInitialValues}
        validationSchema={finalValidationSchema}
        onSubmit={async (values, formikHelpers) => {
          formikHelpers.setSubmitting(true);
          const connectorName = nameBuilder(values);
          const connectorConfig = Object.fromEntries(
            Object.keys(initialValues)
              .filter((key) => key !== "embedding_size" && key !== "chunk_overlap")
              .map((key) => [key, values[key]])
          ) as T;

          // best effort check to see if existing connector exists
          // delete it if:
          //   1. it exists
          //   2. AND it has no credentials linked to it
          // If the ^ are true, that means things have gotten into a bad
          // state, and we should delete the connector to recover
          const errorMsg = await deleteConnectorIfExistsAndIsUnlinked({
            source,
            name: connectorName,
          });
          if (errorMsg) {
            setPopup({
              message: `Unable to delete existing connector - ${errorMsg}`,
              type: "error",
            });
            return;
          }
          const { message, isSuccess, response } = await submitConnector<T>({
            name: connectorName,
            source,
            input_type: inputType,
            connector_specific_config: connectorConfig,
            refresh_freq: refreshFreq || 0,
            prune_freq: pruneFreq ?? null,
            disabled: false,
            embedding_size: values.embedding_size ? parseInt(values.embedding_size) : undefined,
            chunk_overlap: values.chunk_overlap ? parseInt(values.chunk_overlap) : undefined,
          });

          if (!isSuccess || !response) {
            setPopup({ message, type: "error" });
            formikHelpers.setSubmitting(false);
            return;
          }

          let credentialIdToLinkTo = credentialId;
          // create empty credential if specified
          if (
            shouldCreateEmptyCredentialForConnector &&
            credentialIdToLinkTo === undefined
          ) {
            const createCredentialResponse = await createCredential({
              credential_json: {},
              admin_public: true,
            });
            if (!createCredentialResponse.ok) {
              const errorMsg = await createCredentialResponse.text();
              setPopup({
                message: `Error creating credential for CC Pair - ${errorMsg}`,
                type: "error",
              });
              formikHelpers.setSubmitting(false);
              return;
            }
            credentialIdToLinkTo = (await createCredentialResponse.json()).id;
          }

          if (credentialIdToLinkTo !== undefined) {
            const ccPairName = ccPairNameBuilder
              ? ccPairNameBuilder(values) || undefined
              : values.cc_pair_name;
            const linkCredentialResponse = await linkCredential(
              response.id,
              credentialIdToLinkTo,
              ccPairName as string,
              values.is_public
            );
            if (!linkCredentialResponse.ok) {
              const linkCredentialErrorMsg =
                await linkCredentialResponse.text();
              setPopup({
                message: `Error linking credential - ${linkCredentialErrorMsg}`,
                type: "error",
              });
              formikHelpers.setSubmitting(false);
              return;
            }
          }

          mutate("/api/manage/admin/connector/indexing-status");
          setPopup({ message, type: isSuccess ? "success" : "error" });
          formikHelpers.setSubmitting(false);
          if (isSuccess) {
            formikHelpers.resetForm();
          }
          if (onSubmit) {
            onSubmit(isSuccess, response);
          }
        }}
      >
        {({ isSubmitting, values }) => (
          <Form>
            {shouldHaveNameInput && (
              <TextFormField
                name="cc_pair_name"
                label="Connector Name"
                autoCompleteDisabled={true}
                subtext={`A descriptive name for the connector. This will just be used to identify the connector in the Admin UI.`}
              />
            )}
            {formBody && formBody}
            {formBodyBuilder && formBodyBuilder(values)}
            {showNonPublicOption && (
              <>
                <Divider />
                <IsPublicField />
                <Divider />
              </>
            )}

            {displayAdvancedSettings && 
            <>
              <Divider />
              <HidableSection sectionTitle="Advanced Settings" defaultHidden>
                  <>
                    <TextFormField
                      name="embedding_size"
                      label="Embedding Size"
                      autoCompleteDisabled={true}
                      subtext="The number of tokens to use when chunking the document. If not specified, the default value 512 will be used."
                    />
                    <TextFormField
                      name="chunk_overlap"
                      label="Chunk Overlap"
                      autoCompleteDisabled={true}
                      subtext="The number of tokens to overlap when chunking the document. If not specified, the default value 0 will be used."
                    />
                  </>
              </HidableSection>
              <Divider />
            </>
            }
            

            <div className="flex">
              <Button
                type="submit"
                size="xs"
                color="green"
                disabled={isSubmitting}
                className="mx-auto w-64"
              >
                Connect
              </Button>
            </div>
          </Form>
        )}
      </Formik>
    </>
  );
}

interface UpdateConnectorBaseProps<T extends Yup.AnyObject> {
  nameBuilder?: (values: T) => string;
  existingConnector: Connector<T>;
  // If both are specified, uses formBody
  formBody?: JSX.Element | null;
  formBodyBuilder?: FormBodyBuilder<T>;
  validationSchema: Yup.ObjectSchema<T>;
  onSubmit?: (isSuccess: boolean, responseJson?: Connector<T>) => void;
}

type UpdateConnectorFormProps<T extends Yup.AnyObject> = RequireAtLeastOne<
  UpdateConnectorBaseProps<T>,
  "formBody" | "formBodyBuilder"
>;

export function UpdateConnectorForm<T extends Yup.AnyObject>({
  nameBuilder,
  existingConnector,
  formBody,
  formBodyBuilder,
  validationSchema,
  onSubmit,
}: UpdateConnectorFormProps<T>): JSX.Element {
  const [popup, setPopup] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);

  return (
    <>
      {popup && <Popup message={popup.message} type={popup.type} />}
      <Formik
        initialValues={existingConnector.connector_specific_config}
        validationSchema={validationSchema}
        onSubmit={async (values, formikHelpers) => {
          formikHelpers.setSubmitting(true);

          const { message, isSuccess, response } = await submitConnector<T>(
            {
              name: nameBuilder ? nameBuilder(values) : existingConnector.name,
              source: existingConnector.source,
              input_type: existingConnector.input_type,
              connector_specific_config: values,
              refresh_freq: existingConnector.refresh_freq,
              prune_freq: existingConnector.prune_freq,
              disabled: false,
            },
            existingConnector.id
          );

          setPopup({ message, type: isSuccess ? "success" : "error" });
          formikHelpers.setSubmitting(false);
          if (isSuccess) {
            formikHelpers.resetForm();
          }
          setTimeout(() => {
            setPopup(null);
          }, 4000);
          if (onSubmit) {
            onSubmit(isSuccess, response);
          }
        }}
      >
        {({ isSubmitting, values }) => (
          <Form>
            {formBody ? formBody : formBodyBuilder && formBodyBuilder(values)}
            <div className="flex">
              <Button
                type="submit"
                color="green"
                size="xs"
                disabled={isSubmitting}
                className="mx-auto w-64"
              >
                Update
              </Button>
            </div>
          </Form>
        )}
      </Formik>
    </>
  );
}

