'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { withAction } from '@server/actions/with-action'
import { decideTask } from '@modules/workflow'

const decideSchema = z
  .object({
    taskId: z.string().uuid(),
    decision: z.enum(['APPROVE', 'REJECT', 'RETURN']),
    comment: z
      .string()
      .trim()
      .max(2000)
      .optional()
      .or(z.literal('').transform(() => undefined)),
  })
  .refine((value) => value.decision === 'APPROVE' || !!value.comment, {
    message: 'A comment is required to reject or return a task.',
    path: ['comment'],
  })

export const decideTaskAction = withAction({
  name: 'workflow.decideTask',
  permission: 'workflow:decide_task',
  schema: decideSchema,
  handler: async (input, ctx) => {
    await decideTask(ctx.claims, {
      taskId: input.taskId,
      decision: input.decision,
      comment: input.comment ?? null,
      actorId: ctx.actor.userId,
    })
    revalidatePath('/tasks')
  },
})
