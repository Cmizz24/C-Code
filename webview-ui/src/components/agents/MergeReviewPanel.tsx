import { useMemo, useState } from "react"
import type { MergeReviewEntry } from "@roo-code/types"

import DiffView from "@/components/common/DiffView"
import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { cn } from "@/lib/utils"
import { vscode } from "@/utils/vscode"

import { getAgentModeLabel } from "./agentDisplay"

interface MergeReviewPanelProps {
	entries: MergeReviewEntry[]
	failedAgentId?: string
	gitOutput?: string
	onClose: () => void
}

export const MergeReviewPanel = ({ entries, failedAgentId, gitOutput, onClose }: MergeReviewPanelProps) => {
	const { customModes } = useExtensionState()
	const [approvedAgentIds, setApprovedAgentIds] = useState<Set<string>>(() => new Set())

	const approvedIds = useMemo(() => [...approvedAgentIds], [approvedAgentIds])

	const toggleApproval = (agentId: string) => {
		setApprovedAgentIds((current) => {
			const next = new Set(current)
			if (next.has(agentId)) {
				next.delete(agentId)
			} else {
				next.add(agentId)
			}
			return next
		})
	}

	const discardAgent = (agentId: string) => {
		setApprovedAgentIds((current) => {
			const next = new Set(current)
			next.delete(agentId)
			return next
		})
	}

	const mergeApproved = () => {
		vscode.postMessage({ type: "mergeApprovedAgents", ids: approvedIds })
	}

	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="max-h-[92vh] max-w-[min(1100px,96vw)] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>Review agent changes</DialogTitle>
					<DialogDescription>
						Approve agent branches to merge back into the repository, or discard unapproved worktrees.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4">
					{entries.map((entry) => {
						const approved = approvedAgentIds.has(entry.agentId)
						const failed = failedAgentId === entry.agentId
						const agentLabel = getAgentModeLabel(entry.mode, customModes)

						return (
							<section
								key={entry.agentId}
								className={cn(
									"rounded-md border bg-vscode-sideBar-background p-3",
									failed ? "border-vscode-errorForeground" : "border-vscode-panel-border",
								)}>
								<div className="mb-3 flex flex-wrap items-start justify-between gap-3">
									<div>
										<h3 className="text-sm font-semibold text-vscode-foreground">{agentLabel}</h3>
										<div className="mt-1 text-xs text-vscode-descriptionForeground">
											{entry.task}
										</div>
										<div className="mt-1 grid gap-1 font-mono text-[11px] text-vscode-descriptionForeground">
											<span title="Agent ID">{entry.agentId}</span>
											<span>{entry.branch}</span>
											<span>{entry.worktreePath}</span>
										</div>
									</div>
									<div className="flex flex-wrap gap-2">
										<Button
											variant={approved ? "primary" : "secondary"}
											size="sm"
											onClick={() => toggleApproval(entry.agentId)}>
											{approved ? "Approved" : "Approve & Merge"}
										</Button>
										<Button
											variant="destructive"
											size="sm"
											onClick={() => discardAgent(entry.agentId)}>
											Discard
										</Button>
									</div>
								</div>

								{failed && gitOutput && (
									<pre className="mb-3 max-h-40 overflow-auto whitespace-pre-wrap rounded border border-vscode-errorForeground/60 bg-vscode-errorForeground/10 p-2 text-xs text-vscode-errorForeground">
										{gitOutput}
									</pre>
								)}

								{entry.diff.trim() ? (
									<DiffView source={entry.diff} />
								) : (
									<pre className="rounded bg-vscode-editor-background p-3 text-xs text-vscode-descriptionForeground">
										No diff available for this agent.
									</pre>
								)}
							</section>
						)
					})}
				</div>

				<DialogFooter>
					<Button variant="secondary" onClick={onClose}>
						Close
					</Button>
					<Button variant="primary" disabled={approvedIds.length === 0} onClick={mergeApproved}>
						Merge All Approved
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
