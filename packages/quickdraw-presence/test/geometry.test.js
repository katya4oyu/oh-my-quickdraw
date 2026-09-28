import { describe, it, expect } from 'vitest'
import { edgePoint, fitView, centreOn, wellInside, initials } from '../src/geometry.js'
import { presenceLabel, activitySign } from '../src/presence.js'

const box = { w: 800, h: 600 }

describe('edgePoint', () => {
  it('is null while in view', () => {
    expect(edgePoint(box, { x: 10, y: 590 })).toBeNull()
  })
  it('sits on the side the person is past, towards them', () => {
    expect(edgePoint(box, { x: 2000, y: 300 })).toEqual({ x: 776, y: 300, angle: 0 })
    const up = edgePoint(box, { x: 400, y: -500 })
    expect(up.x).toBe(400)
    expect(up.y).toBe(24)
  })
  it('stays inside the screen for a far corner', () => {
    const p = edgePoint(box, { x: -5000, y: -9000 })
    expect(p.x).toBeGreaterThanOrEqual(24)
    expect(p.y).toBeCloseTo(24)
  })
})

describe('fitView', () => {
  it('shows their view whole, centred', () => {
    const cam = fitView(box, { x: 100, y: 100, w: 400, h: 200 }) // wider than tall: width decides
    expect(cam.z).toBe(2)
    // the view's centre (300, 200) lands mid-screen
    expect((300 + cam.x) * cam.z).toBe(400)
    expect((200 + cam.y) * cam.z).toBe(300)
  })
  it('keeps to the zoom the board allows', () => {
    expect(fitView(box, { x: 0, y: 0, w: 1, h: 1 }).z).toBe(8)
  })
})

describe('centreOn and wellInside', () => {
  it('puts a point mid-screen at the zoom asked', () => {
    const cam = centreOn(box, { x: 50, y: 60 }, 0.5)
    expect((50 + cam.x) * 0.5).toBe(400)
    expect((60 + cam.y) * 0.5).toBe(300)
  })
  it('says when a point nears the edge', () => {
    const v = { x: 0, y: 0, w: 1000, h: 1000 }
    expect(wellInside(v, { x: 500, y: 500 })).toBe(true)
    expect(wellInside(v, { x: 100, y: 500 })).toBe(false)
    expect(wellInside(v, { x: 500, y: 1200 })).toBe(false)
  })
})

describe('labels', () => {
  it('initials from a name', () => {
    expect(initials('Ann Lee')).toBe('AL')
    expect(initials('mac')).toBe('MA')
    expect(initials('  ')).toBe('?')
    expect(initials('山田 花子')).toBe('山花')
  })
  it('a person with their status, an agent with what it does', () => {
    expect(presenceLabel({ name: 'Ann' })).toBe('Ann')
    expect(presenceLabel({ name: 'Ann', status: 'away' })).toBe('Ann · away')
    expect(presenceLabel({ name: 'Codex', agent: true, agentStatus: 'working', status: 'x' })).toBe('Codex · working')
    expect(presenceLabel({ name: 'Codex', agent: true })).toBe('Codex')
    // what it is doing just now wins over its status, with what on
    expect(presenceLabel({ name: 'Codex', agent: true, agentStatus: 'working', agentActivity: 'searching', agentNote: 'tldraw pricing' })).toBe('Codex · searching the web: tldraw pricing')
    expect(presenceLabel({ name: 'Codex', agent: true, agentStatus: 'working', agentActivity: 'thinking' })).toBe('Codex · thinking')
    expect(presenceLabel({ name: 'Codex', agent: true, agentStatus: 'working', agentActivity: 'nonsense' })).toBe('Codex · working')
    expect(presenceLabel({ name: 'Ann', agentActivity: 'thinking' })).toBe('Ann') // only agents
    expect(activitySign({ agent: true, agentActivity: 'waiting' })).toBe('✋')
    expect(activitySign({ agent: true })).toBe('')
  })
})
