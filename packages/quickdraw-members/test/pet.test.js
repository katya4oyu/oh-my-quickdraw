import { describe, it, expect } from 'vitest'
import { PET_ROWS, PET_SHEET, PET_CELL, PET_COLUMNS, petState } from '../src/pet.js'

describe('Codex pets', () => {
  it('plays the rows as Codex does: 8 × 9 cells of 192 × 208, so many frames each', () => {
    expect([PET_SHEET.w / PET_CELL.w, PET_SHEET.h / PET_CELL.h]).toEqual([PET_COLUMNS, 9])
    expect(Object.entries(PET_ROWS).map(([name, r]) => [r.row, name, r.times.length])).toEqual([
      [0, 'idle', 6], [1, 'running-right', 8], [2, 'running-left', 8], [3, 'waving', 4], [4, 'jumping', 5],
      [5, 'failed', 8], [6, 'waiting', 6], [7, 'running', 6], [8, 'review', 6],
    ])
    expect(PET_ROWS.idle.times).toEqual([280, 110, 110, 140, 140, 320])
    expect(PET_ROWS.running.times.at(-1)).toBe(220) // the last frame lingers
  })

  it('shows what the agent does', () => {
    expect(petState({ activity: 'thinking' })).toBe('review')
    expect(petState({ activity: 'searching' })).toBe('review')
    expect(petState({ activity: 'running' })).toBe('running')
    expect(petState({ activity: 'drawing', dx: 40 })).toBe('running-right')
    expect(petState({ activity: 'drawing', dx: -40 })).toBe('running-left')
    expect(petState({ activity: 'drawing' })).toBe('running')
    expect(petState({ activity: 'waiting' })).toBe('waving')
    expect(petState({ activity: 'done' })).toBe('jumping')
    expect(petState({ activity: 'available', status: 'idle' })).toBe('idle')
    expect(petState({ status: 'working' })).toBe('review')
    expect(petState({ activity: 'thinking', failed: true })).toBe('failed')
  })
})
