import type { WorkflowMetadata, WorkflowParameterValue } from '../types/api';

export function getWorkflowOptions(
  metadata: WorkflowMetadata | undefined,
  values: Record<string, WorkflowParameterValue>,
): Record<string, WorkflowParameterValue> {
  if (!metadata) return {};
  return Object.fromEntries(
    metadata.parameters
      .filter(parameter => parameter.type === 'select')
      .map(parameter => {
        const current = values[parameter.name];
        const valid = current !== undefined
          && (!parameter.options || parameter.options.includes(String(current)));
        return [parameter.name, valid ? current : parameter.default];
      }),
  );
}
