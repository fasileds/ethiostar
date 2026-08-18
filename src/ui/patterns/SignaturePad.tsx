'use client'

import * as React from 'react'
import { Input } from '@ui/primitives/Field'
import { Button } from '@ui/primitives/Button'

/**
 * Signature capture — typed name or drawn mark.
 *
 * Plain DOM pointer events on a `<canvas>`, no drawing library: the mark itself carries no
 * evidentiary weight on its own (a mouse squiggle proves nothing forensically), the record
 * that matters is `document_signature` — who, when, from where, against which content hash.
 * This component's only job is producing `signatureData` for that row.
 */

export type SignatureMethod = 'DRAWN' | 'TYPED'

export interface CapturedSignature {
  readonly method: SignatureMethod
  readonly signatureData: string
}

export interface SignaturePadProps {
  readonly onCapture: (data: CapturedSignature) => void
  readonly disabled?: boolean
}

const TABS: ReadonlyArray<{ value: SignatureMethod; label: string }> = [
  { value: 'TYPED', label: 'Type name' },
  { value: 'DRAWN', label: 'Draw signature' },
]

export function SignaturePad({ onCapture, disabled = false }: SignaturePadProps) {
  const [method, setMethod] = React.useState<SignatureMethod>('TYPED')
  const [typedName, setTypedName] = React.useState('')
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const drawingRef = React.useRef(false)
  const hasStrokeRef = React.useRef(false)
  const [hasStroke, setHasStroke] = React.useState(false)

  function canvasContext(): CanvasRenderingContext2D | null {
    return canvasRef.current?.getContext('2d') ?? null
  }

  function pointFromEvent(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  function startStroke(event: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled) return
    const ctx = canvasContext()
    if (!ctx) return
    drawingRef.current = true
    const { x, y } = pointFromEvent(event)
    ctx.beginPath()
    ctx.moveTo(x, y)
  }

  function continueStroke(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return
    const ctx = canvasContext()
    if (!ctx) return
    const { x, y } = pointFromEvent(event)
    ctx.lineTo(x, y)
    ctx.strokeStyle = '#111827'
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.stroke()
    if (!hasStrokeRef.current) {
      hasStrokeRef.current = true
      setHasStroke(true)
    }
  }

  function endStroke() {
    drawingRef.current = false
  }

  function clearCanvas() {
    const canvas = canvasRef.current
    const ctx = canvasContext()
    if (!canvas || !ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    hasStrokeRef.current = false
    setHasStroke(false)
  }

  function submitTyped() {
    const name = typedName.trim()
    if (!name) return
    onCapture({ method: 'TYPED', signatureData: name })
  }

  function submitDrawn() {
    const canvas = canvasRef.current
    if (!canvas || !hasStroke) return
    onCapture({ method: 'DRAWN', signatureData: canvas.toDataURL('image/png') })
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-1.5 rounded-md bg-[var(--surface-sunken)] p-1">
        {TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => setMethod(tab.value)}
            disabled={disabled}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-[var(--duration-base)] ${
              method === tab.value
                ? 'bg-[var(--surface-raised)] text-[var(--text-primary)] shadow-xs'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {method === 'TYPED' ? (
        <div className="space-y-3">
          <Input
            label="Signer's full name"
            value={typedName}
            onChange={(event) => setTypedName(event.target.value)}
            placeholder="Type the name as a signature"
            disabled={disabled}
          />
          <Button
            type="button"
            variant="primary"
            onClick={submitTyped}
            disabled={disabled || !typedName.trim()}
          >
            Capture signature
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <canvas
            ref={canvasRef}
            width={480}
            height={160}
            className="w-full touch-none rounded-md bg-white ring-1 ring-[var(--border-default)]"
            onPointerDown={startStroke}
            onPointerMove={continueStroke}
            onPointerUp={endStroke}
            onPointerLeave={endStroke}
          />
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={clearCanvas} disabled={disabled}>
              Clear
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={submitDrawn}
              disabled={disabled || !hasStroke}
            >
              Capture signature
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
