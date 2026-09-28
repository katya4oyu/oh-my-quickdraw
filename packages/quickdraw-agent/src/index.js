// What agents can do on a Quickdraw board, over a core Store: read it, change
// it in undoable operations, and the same as tools for any agent runtime.
// Runs in browsers and in Node (installMeasure stands in for text measuring).
export { describeBoard, boardToMarkdown, textOf, runOp, applySteps, undoDiff, parseRatio } from './ops.js'
export { BOARD_TOOLS } from './tools.js'
export { createAgentPanel, agentTools, AGENT_ICON, buildAgentRequest, agentOptions, feedbackToSend, limitText, limitLevel, detectAgentMention, updateAgentThread, undoAgentRequest } from './panel.js'
export { hasAgentThreadForAnchor } from './panel.js'
export { installMeasure, estimateWidth } from './measure.js'
