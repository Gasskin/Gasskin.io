import { describe, expect, it } from 'vitest'
import {
  beginConversationGeneration,
  endConversationGeneration,
  getConversationGenerationState,
  markGenerationRequestRemoved,
  pruneRemovedGenerationIndexesByRunId
} from './generation-state'

describe('conversation generation state', () => {
  it('tracks generation per conversation', () => {
    expect(getConversationGenerationState('a', { a: 2 }, { a: 1000 })).toEqual({
      generating: true,
      startedAt: 1000,
      activeCount: 2
    })
    expect(getConversationGenerationState('b', { a: 2 }, { a: 1000 })).toEqual({
      generating: false,
      startedAt: null,
      activeCount: 0
    })
  })

  it('increments and decrements without resetting removed indexes', () => {
    const started = beginConversationGeneration('c1', {
      generatingByConversation: {},
      startedAtByConversation: {},
      removedIndexesByRunId: { 'run-1': [1] }
    }, 1000)

    expect(started.generatingByConversation.c1).toBe(1)
    expect(started.startedAtByConversation.c1).toBe(1000)

    const second = beginConversationGeneration('c1', started, 2000)
    expect(second.generatingByConversation.c1).toBe(2)
    expect(second.startedAtByConversation.c1).toBe(1000)
    expect(endConversationGeneration('c1', endConversationGeneration('c1', second)).removedIndexesByRunId['run-1']).toEqual([1])
  })

  it('marks and prunes removed request indexes', () => {
    const state = markGenerationRequestRemoved('run-1', 2, {
      generatingByConversation: {},
      startedAtByConversation: {},
      removedIndexesByRunId: { 'run-1': [1], 'run-2': [0] }
    })

    expect(state.removedIndexesByRunId['run-1']).toEqual([1, 2])
    expect(pruneRemovedGenerationIndexesByRunId(['run-2'], state).removedIndexesByRunId).toEqual({ 'run-2': [0] })
  })
})
