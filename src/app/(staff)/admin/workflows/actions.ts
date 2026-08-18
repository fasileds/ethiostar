'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { withAction } from '@server/actions/with-action'
import { createWorkflowDefinition, type WorkflowStepDefinition } from '@modules/workflow'

const stepSchema = z.object({
  stepNo: z.number().int().positive(),
  name: z.string().trim().min(1),
  approverRole: z.string().trim().min(1),
  minThresholdKg: z.number().optional(),
  maxThresholdKg: z.number().optional(),
})

/** Drops explicit `undefined` values `exactOptionalPropertyTypes` does not allow. */
function toStepDefinition(step: z.infer<typeof stepSchema>): WorkflowStepDefinition {
  return {
    stepNo: step.stepNo,
    name: step.name,
    approverRole: step.approverRole,
    ...(step.minThresholdKg !== undefined ? { minThresholdKg: step.minThresholdKg } : {}),
    ...(step.maxThresholdKg !== undefined ? { maxThresholdKg: step.maxThresholdKg } : {}),
  }
}

const stepsField = z
  .string()
  .trim()
  .min(1, 'Enter the steps as JSON.')
  .transform((value, ctx) => {
    try {
      return JSON.parse(value) as unknown
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Not valid JSON.' })
      return z.NEVER
    }
  })
  .pipe(z.array(stepSchema).min(1, 'At least one step is required.'))
  .transform((steps) => steps.map(toStepDefinition))

const createSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, 'Enter a code.')
    .max(80)
    .regex(/^[A-Z0-9_]+$/, 'Use upper-case letters, digits and underscores only.'),
  name: z.string().trim().min(1, 'Enter a name.').max(200),
  entityType: z.string().trim().min(1, 'Enter the entity type.').max(60),
  steps: stepsField,
})

export const createWorkflowDefinitionAction = withAction({
  name: 'workflow.createWorkflowDefinition',
  permission: 'workflow:manage_definitions',
  schema: createSchema,
  handler: async (input, ctx) => {
    await createWorkflowDefinition(ctx.claims, {
      code: input.code,
      name: input.name,
      entityType: input.entityType,
      steps: input.steps,
      actorId: ctx.actor.userId,
    })
    revalidatePath('/admin/workflows')
  },
})
