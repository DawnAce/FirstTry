interface FormErrorField {
  name: Array<string | number>;
  errors: string[];
}

export function extractFormValidation(error: unknown): {
  fields: FormErrorField[];
  messages: string[];
} {
  const fields =
    error && typeof error === 'object' && Array.isArray((error as { errorFields?: unknown }).errorFields)
      ? (error as { errorFields: FormErrorField[] }).errorFields
      : [];
  return { fields, messages: fields.flatMap((field) => field.errors) };
}
