import { useState, type ReactNode } from "react";

import { FormFields, initialValues, toPayload, type FieldDef } from "@/components/admin/crud";
import { Button } from "@/components/ui";
import { Modal, useAction } from "@/components/ui-client";
import { api } from "@/lib/api";

/** A modal form built from field definitions that submits to one endpoint. */
export function SimpleForm({
  title,
  fields,
  endpoint,
  onClose,
  onDone,
  method = "POST",
  submitLabel = "Save",
  transform,
  initial,
  wide,
  intro,
}: {
  title: string;
  fields: FieldDef[];
  endpoint: string;
  onClose: () => void;
  onDone: (r: any) => void;
  method?: string;
  submitLabel?: string;
  transform?: (body: Record<string, any>) => unknown;
  initial?: Record<string, any>;
  wide?: boolean;
  intro?: ReactNode;
}) {
  const [values, setValues] = useState(() => initialValues(fields, initial));
  const { busy, run } = useAction();
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      wide={wide}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="simple-form" disabled={busy}>{submitLabel}</Button>
        </>
      }
    >
      {intro && <div className="mb-4">{intro}</div>}
      <form
        id="simple-form"
        onSubmit={(e) => {
          e.preventDefault();
          const body = toPayload(fields, values);
          run(async () => onDone(await api(endpoint, { method, body: transform ? transform(body) : body })), "Saved");
        }}
      >
        <FormFields fields={fields} values={values} setValues={setValues} />
      </form>
    </Modal>
  );
}
