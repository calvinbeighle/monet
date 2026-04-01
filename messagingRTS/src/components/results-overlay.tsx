// Results overlay per Spec 06
// Shows agent proposals after deployment completion. Each proposal has approve/reject buttons.
// Does not auto-dismiss - user must act on all proposals or manually close.
// After all proposals resolved: agent enters cooldown, deployment transitions to "resolved".

import { useState } from "react";
import { useAgentStore } from "../lib/stores/agent-store";
import { useDeploymentStore } from "../lib/stores/deployment-store";
import { AGENT_DEFINITIONS } from "../lib/types";
import type { AgentRole, AgentProposal } from "../lib/types";

// Extract tone label from proposal content if present (Drafter tone variants per Spec 07)
// Content format from output parser: "[tone_label] actual content"
function extractToneLabel(content: string): { toneLabel: string | null; cleanContent: string } {
  const match = content.match(/^\[([^\]]+)\]\s*/);
  if (match) {
    return { toneLabel: match[1], cleanContent: content.slice(match[0].length) };
  }
  return { toneLabel: null, cleanContent: content };
}

// Group proposals by threadId for tone variant display
function groupProposalsByThread(proposals: AgentProposal[]): Map<string, AgentProposal[]> {
  const groups = new Map<string, AgentProposal[]>();
  for (const p of proposals) {
    const existing = groups.get(p.threadId) ?? [];
    existing.push(p);
    groups.set(p.threadId, existing);
  }
  return groups;
}

function ProposalItem({ proposal, agentRole }: { proposal: AgentProposal; agentRole: AgentRole }) {
  const resolve = useAgentStore((s) => s.resolve);

  const isPending = proposal.status === "pending";

  return (
    <div
      className="border border-gray-700 rounded p-3 mb-2"
      data-testid={`proposal-${proposal.id}`}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-gray-400 uppercase">{proposal.outputType}</span>
        {!isPending && (
          <span
            className={`text-xs px-2 py-0.5 rounded ${
              proposal.status === "approved"
                ? "bg-green-900/40 text-green-400"
                : "bg-red-900/40 text-red-400"
            }`}
            data-testid={`proposal-${proposal.id}-status`}
          >
            {proposal.status}
          </span>
        )}
      </div>
      <p className="text-xs text-gray-300 mb-2 whitespace-pre-wrap">{proposal.content}</p>
      <div className="text-[10px] text-gray-500 mb-2">Thread: {proposal.threadId}</div>
      {isPending && (
        <div className="flex gap-2">
          <button
            className="flex-1 rounded bg-green-700 px-2 py-1 text-xs text-white hover:bg-green-600 transition-colors"
            onClick={() => resolve(agentRole, proposal.id, "approved")}
            data-testid={`approve-${proposal.id}`}
          >
            Approve
          </button>
          <button
            className="flex-1 rounded bg-red-700 px-2 py-1 text-xs text-white hover:bg-red-600 transition-colors"
            onClick={() => resolve(agentRole, proposal.id, "rejected")}
            data-testid={`reject-${proposal.id}`}
          >
            Reject
          </button>
        </div>
      )}
    </div>
  );
}

// Tone variant group: shows tabs when multiple proposals target the same thread (Spec 07 Drafter)
function ToneVariantGroup({
  proposals,
  agentRole,
}: {
  proposals: AgentProposal[];
  agentRole: AgentRole;
}) {
  const [activeVariantIndex, setActiveVariantIndex] = useState(0);

  // Extract tone labels for all proposals in the group
  const variants = proposals.map((p) => ({
    proposal: p,
    ...extractToneLabel(p.content),
  }));

  const hasToneLabels = variants.some((v) => v.toneLabel !== null);

  // If there is only one proposal or no tone labels, just render them directly
  if (proposals.length <= 1 || !hasToneLabels) {
    return (
      <>
        {proposals.map((p) => (
          <ProposalItem key={p.id} proposal={p} agentRole={agentRole} />
        ))}
      </>
    );
  }

  const activeVariant = variants[activeVariantIndex];

  return (
    <div
      className="border border-gray-700 rounded mb-2"
      data-testid={`tone-variant-group-${proposals[0].threadId}`}
    >
      {/* Tone variant tabs */}
      <div className="flex border-b border-gray-700" data-testid="tone-variant-tabs">
        {variants.map((v, idx) => (
          <button
            key={v.proposal.id}
            className={`flex-1 px-2 py-1.5 text-xs transition-colors ${
              idx === activeVariantIndex
                ? "bg-gray-700 text-gray-200"
                : "bg-transparent text-gray-500 hover:text-gray-400"
            }`}
            onClick={() => setActiveVariantIndex(idx)}
            data-testid={`tone-tab-${v.proposal.id}`}
          >
            {v.toneLabel ?? `Variant ${idx + 1}`}
          </button>
        ))}
      </div>

      {/* Active variant content */}
      {activeVariant && <ProposalItem proposal={activeVariant.proposal} agentRole={agentRole} />}
    </div>
  );
}

export function ResultsOverlay({ agentRole }: { agentRole: AgentRole }) {
  const agent = useAgentStore((s) => s.agents.get(agentRole));
  const beginCooldown = useAgentStore((s) => s.beginCooldown);
  const resolveDeployment = useDeploymentStore((s) => s.resolveDeployment);
  const getCompletedDeployment = useDeploymentStore((s) => s.getCompletedDeploymentForRole);

  if (!agent || agent.status !== "completed" || agent.proposals.length === 0) {
    return null;
  }

  const def = AGENT_DEFINITIONS[agentRole];
  const colorHex = `#${def.color.toString(16).padStart(6, "0")}`;

  const pendingCount = agent.proposals.filter((p) => p.status === "pending").length;
  const totalCount = agent.proposals.length;
  const allResolved = pendingCount === 0;

  const handleDone = () => {
    // Transition deployment to resolved
    const deployment = getCompletedDeployment(agentRole);
    if (deployment) {
      resolveDeployment(deployment.id);
    }
    // Agent enters cooldown per Spec 05/06
    beginCooldown(agentRole);
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40"
      data-testid="results-overlay"
    >
      <div
        className="w-96 max-h-[80vh] flex flex-col rounded-lg border border-gray-700 bg-[#14142a] shadow-xl"
        data-testid="results-overlay-panel"
      >
        {/* Header */}
        <div className="flex items-center gap-3 p-4 border-b border-gray-700">
          <div className="h-4 w-4 rounded-full" style={{ backgroundColor: colorHex }} />
          <h3 className="text-sm font-medium text-gray-200">{def.name} Results</h3>
          <span className="ml-auto text-xs text-gray-500">
            {allResolved ? `${totalCount} resolved` : `${pendingCount} of ${totalCount} pending`}
          </span>
        </div>

        {/* Proposals list - grouped by thread for Drafter tone variants per Spec 07 */}
        <div className="flex-1 overflow-y-auto p-4" data-testid="results-proposals-list">
          {agentRole === "drafter"
            ? (() => {
                const groups = groupProposalsByThread(agent.proposals);
                return [...groups.entries()].map(([threadId, proposals]) => (
                  <ToneVariantGroup key={threadId} proposals={proposals} agentRole={agentRole} />
                ));
              })()
            : agent.proposals.map((proposal) => (
                <ProposalItem key={proposal.id} proposal={proposal} agentRole={agentRole} />
              ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-gray-700">
          <div className="text-xs text-gray-500">
            {agent.approvedCount} approved, {agent.rejectedCount} rejected
          </div>
          <button
            className={`rounded px-4 py-1.5 text-xs transition-colors ${
              allResolved
                ? "bg-blue-600 text-white hover:bg-blue-500"
                : "bg-gray-700 text-gray-400 cursor-not-allowed"
            }`}
            onClick={handleDone}
            disabled={!allResolved}
            data-testid="results-done-button"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
