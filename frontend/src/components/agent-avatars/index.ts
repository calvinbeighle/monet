/**
 * components/agent-avatars/index.ts
 * Barrel export for all agent avatar components.
 * Also provides a lookup function to get the right avatar by agent ID.
 */

export { EmailAvatar } from './EmailAvatar';
export { CodeAvatar } from './CodeAvatar';
export { PlanningAvatar } from './PlanningAvatar';

import { EmailAvatar } from './EmailAvatar';
import { CodeAvatar } from './CodeAvatar';
import { PlanningAvatar } from './PlanningAvatar';
import type { Agent } from '@/types';
import type { ComponentType } from 'react';

interface AvatarProps {
  status: Agent['status'];
  hasDecisions?: boolean;
}

/**
 * Returns the animated SVG avatar component for a given agent ID.
 * Falls back to EmailAvatar for unknown agent IDs.
 *
 * @param agentId - The agent's string identifier (e.g. 'email', 'code', 'planning')
 * @returns The corresponding React avatar component
 */
export function getAgentAvatar(agentId: string): ComponentType<AvatarProps> {
  switch (agentId) {
    case 'email': return EmailAvatar;
    case 'code': return CodeAvatar;
    case 'planning': return PlanningAvatar;
    default: return EmailAvatar;
  }
}
