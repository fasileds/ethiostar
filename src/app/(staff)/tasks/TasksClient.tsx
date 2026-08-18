'use client'

import { useState } from 'react'
import { Textarea } from '@ui/primitives/Field'
import { Button } from '@ui/primitives/Button'
import { Alert } from '@ui/primitives/Alert'
import type { InboxTaskRow } from '@modules/workflow'
import { decideTaskAction } from './actions'

export function TasksClient({ tasks }: { readonly tasks: readonly InboxTaskRow[] }) {
  return (
    <ul className="divide-y divide-[var(--border-subtle)] rounded-[var(--radius-md)] ring-1 ring-[var(--border-subtle)]">
      {tasks.map((task) => (
        <TaskRow key={task.id} task={task} />
      ))}
    </ul>
  )
}

type Mode = 'idle' | 'REJECT' | 'RETURN'

function TaskRow({ task }: { readonly task: InboxTaskRow }) {
  const [mode, setMode] = useState<Mode>('idle')
  const [comment, setComment] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function decide(decision: 'APPROVE' | 'REJECT' | 'RETURN') {
    setPending(true)
    setError(null)

    const formData = new FormData()
    formData.set('taskId', task.id)
    formData.set('decision', decision)
    if (comment) formData.set('comment', comment)

    const result = await decideTaskAction(formData)
    setPending(false)

    if (!result.ok) {
      setError(result.error.message)
      return
    }

    setMode('idle')
    setComment('')
  }

  return (
    <li className="space-y-3 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{task.definitionName}</p>
          <p className="text-xs text-[var(--text-tertiary)]">
            {task.entityType} · step {task.stepNo}
            {task.assignedRole ? ` · ${task.assignedRole}` : ''}
          </p>
        </div>

        {mode === 'idle' ? (
          <div className="flex shrink-0 gap-2">
            <Button size="sm" onClick={() => decide('APPROVE')} disabled={pending}>
              Approve
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setMode('RETURN')}
              disabled={pending}
            >
              Return
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => setMode('REJECT')}
              disabled={pending}
            >
              Reject
            </Button>
          </div>
        ) : null}
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {mode !== 'idle' ? (
        <div className="space-y-2">
          <Textarea
            label={mode === 'REJECT' ? 'Why is this rejected?' : 'What needs to change?'}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            rows={2}
            required
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={mode === 'REJECT' ? 'danger' : 'secondary'}
              onClick={() => decide(mode)}
              disabled={pending || comment.trim().length === 0}
            >
              {pending
                ? 'Submitting…'
                : mode === 'REJECT'
                  ? 'Confirm reject'
                  : 'Confirm return'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setMode('idle')
                setComment('')
                setError(null)
              }}
              disabled={pending}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  )
}
