import type { HTMLAttributes, ReactNode } from "react"
import { useState } from "react"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"

import type { MemoryAction, MemoryEntry, MemoryScope, MemoryState, MemorySummary } from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { vscode } from "@src/utils/vscode"
import { cn } from "@src/lib/utils"
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	Button,
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
	Input,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@src/components/ui"

import { Section } from "./Section"
import { SectionHeader } from "./SectionHeader"
import { SearchableSetting } from "./SearchableSetting"
import { SetCachedStateField } from "./types"

type MemorySettingsProps = HTMLAttributes<HTMLDivElement> & {
	memoryEnabled?: boolean
	memoryWorkspaceEnabled?: boolean
	memoryGlobalEnabled?: boolean
	memoryMistakeMemoryEnabled?: boolean
	memoryMaxCharacters?: number
	memoryMaxEntries?: number
	memoryPendingCandidateLimit?: number
	memoryState?: MemoryState
	memorySummary?: MemorySummary
	setCachedStateField: SetCachedStateField<
		| "memoryEnabled"
		| "memoryWorkspaceEnabled"
		| "memoryGlobalEnabled"
		| "memoryMistakeMemoryEnabled"
		| "memoryMaxCharacters"
		| "memoryMaxEntries"
		| "memoryPendingCandidateLimit"
	>
}

type PendingMemoryAction = {
	memoryAction: MemoryAction
	memoryId?: string
	memoryScope?: MemoryScope
}

const postMemoryAction = ({ memoryAction, memoryId, memoryScope }: PendingMemoryAction) => {
	vscode.postMessage({
		type: "memoryAction",
		memoryAction,
		...(memoryId ? { memoryId } : {}),
		...(memoryScope ? { memoryScope } : {}),
	})
}

const destructiveMemoryActions = new Set<MemoryAction>([
	"archiveWorkspace",
	"clearWorkspace",
	"archiveGlobal",
	"clearGlobal",
	"deleteMemory",
])

type MemoryCollapsibleSectionProps = {
	title: string
	description: string
	testId: string
	defaultOpen?: boolean
	children: ReactNode
}

const MemoryCollapsibleSection = ({
	title,
	description,
	testId,
	defaultOpen = false,
	children,
}: MemoryCollapsibleSectionProps) => {
	const [isOpen, setIsOpen] = useState(defaultOpen)

	return (
		<Collapsible
			open={isOpen}
			onOpenChange={setIsOpen}
			className="min-w-0 max-w-full overflow-hidden rounded-md border border-vscode-panel-border bg-vscode-editor-background"
			data-testid={`${testId}-section`}>
			<CollapsibleTrigger
				type="button"
				aria-expanded={isOpen}
				data-testid={`${testId}-trigger`}
				onClick={(event) => {
					event.preventDefault()
					setIsOpen((open) => !open)
				}}
				className="flex w-full min-w-0 max-w-full items-start gap-2 px-3 py-2 text-left hover:bg-vscode-list-hoverBackground">
				<span
					className={cn(
						"codicon codicon-chevron-right mt-0.5 shrink-0 text-vscode-descriptionForeground transition-transform",
						isOpen && "rotate-90",
					)}
				/>
				<span className="min-w-0 max-w-full">
					<span className="block break-words font-medium text-vscode-foreground">{title}</span>
					<span className="block break-words text-sm text-vscode-descriptionForeground">{description}</span>
				</span>
			</CollapsibleTrigger>
			<CollapsibleContent forceMount className="data-[state=closed]:hidden">
				<div className="min-w-0 max-w-full space-y-3 overflow-hidden px-3 pb-3 pt-1">{children}</div>
			</CollapsibleContent>
		</Collapsible>
	)
}

const statusTone: Record<MemoryEntry["status"], string> = {
	active: "border-vscode-charts-green text-vscode-charts-green",
	pending: "border-vscode-charts-yellow text-vscode-charts-yellow",
	stale: "border-vscode-descriptionForeground text-vscode-descriptionForeground",
	superseded: "border-vscode-descriptionForeground text-vscode-descriptionForeground",
	archived: "border-vscode-descriptionForeground text-vscode-descriptionForeground",
}

const formatTimestamp = (timestamp?: number): string | undefined => {
	if (!timestamp) {
		return undefined
	}

	return new Intl.DateTimeFormat(undefined, {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(new Date(timestamp))
}

const MemoryPill = ({ children, className, title }: { children: ReactNode; className?: string; title?: string }) => (
	<span
		className={cn(
			"inline-flex min-w-0 max-w-full items-center rounded-full border border-vscode-panel-border px-2 py-0.5 text-xs",
			className,
		)}
		title={title ?? (typeof children === "string" ? children : undefined)}>
		<span className="min-w-0 max-w-full truncate">{children}</span>
	</span>
)

const MemoryDetailValue = ({ children, className }: { children: ReactNode; className?: string }) => (
	<div className={cn("mt-1 min-w-0 max-w-full whitespace-pre-wrap break-words [overflow-wrap:anywhere]", className)}>
		{children}
	</div>
)

const MemoryDetailField = ({ label, children }: { label: string; children: ReactNode }) => (
	<div className="min-w-0 max-w-full">
		<div className="text-xs uppercase text-vscode-descriptionForeground">{label}</div>
		<MemoryDetailValue>{children}</MemoryDetailValue>
	</div>
)

const MemoryRecordCard = ({ memory, onRemove }: { memory: MemoryEntry; onRemove: (memory: MemoryEntry) => void }) => {
	const { t } = useAppTranslation()
	const createdAt = formatTimestamp(memory.createdAt)
	const updatedAt = formatTimestamp(memory.updatedAt)
	const lastUsedAt = formatTimestamp(memory.lastUsedAt)

	return (
		<details
			className="group min-w-0 max-w-full overflow-hidden rounded-md border border-vscode-panel-border bg-vscode-editor-background text-sm"
			data-testid={`memory-record-${memory.id}`}>
			<summary
				className="flex min-w-0 cursor-pointer list-none items-start gap-2 px-2 py-2 [&::-webkit-details-marker]:hidden"
				data-testid={`memory-record-${memory.id}-summary`}>
				<span className="codicon codicon-chevron-right mt-0.5 shrink-0 text-vscode-descriptionForeground transition-transform group-open:rotate-90" />
				<div className="grid min-w-0 flex-1 gap-1">
					<div className="flex min-w-0 flex-wrap items-center gap-1.5">
						<span
							className="min-w-0 flex-1 basis-32 truncate font-medium text-vscode-foreground"
							title={memory.title || memory.lesson}
							data-testid={`memory-record-${memory.id}-title`}>
							{memory.title || memory.lesson}
						</span>
						<MemoryPill className={cn("shrink-0", statusTone[memory.status])}>
							{t(`settings:memory.status.${memory.status}`)}
						</MemoryPill>
						<MemoryPill className="shrink-0">{t(`settings:memory.scope.${memory.scope}`)}</MemoryPill>
						<MemoryPill className="shrink-0">{t(`settings:memory.kind.${memory.kind}`)}</MemoryPill>
					</div>
					<p
						className="min-w-0 truncate text-vscode-descriptionForeground"
						title={memory.lesson}
						data-testid={`memory-record-${memory.id}-lesson-preview`}>
						{memory.lesson}
					</p>
				</div>
			</summary>

			<div
				className="min-w-0 max-w-full space-y-3 border-t border-vscode-panel-border px-2 pb-2 pt-3"
				data-testid={`memory-record-${memory.id}-details`}>
				<MemoryDetailField label={t("settings:memory.records.lesson")}>{memory.lesson}</MemoryDetailField>

				{memory.mistakeSignature && (
					<MemoryDetailField label={t("chat:memory.fields.signature")}>
						{memory.mistakeSignature}
					</MemoryDetailField>
				)}

				{(memory.mode || memory.toolName) && (
					<div className="grid min-w-0 max-w-full gap-2 text-xs text-vscode-descriptionForeground sm:grid-cols-2">
						{memory.mode && (
							<div className="min-w-0 max-w-full">
								<span className="font-medium text-vscode-foreground">
									{t("chat:memory.fields.mode")}:{" "}
								</span>
								<span className="break-words [overflow-wrap:anywhere]">{memory.mode}</span>
							</div>
						)}
						{memory.toolName && (
							<div className="min-w-0 max-w-full">
								<span className="font-medium text-vscode-foreground">
									{t("chat:memory.fields.tool")}:{" "}
								</span>
								<span className="break-words [overflow-wrap:anywhere]">{memory.toolName}</span>
							</div>
						)}
					</div>
				)}

				{memory.tags.length > 0 && (
					<div className="min-w-0 max-w-full">
						<div className="text-xs uppercase text-vscode-descriptionForeground">
							{t("settings:memory.records.tags")}
						</div>
						<div className="mt-1 flex min-w-0 max-w-full flex-wrap gap-1">
							{memory.tags.map((tag) => (
								<MemoryPill key={tag}>{tag}</MemoryPill>
							))}
						</div>
					</div>
				)}

				{memory.pathTags.length > 0 && (
					<div className="min-w-0 max-w-full">
						<div className="text-xs uppercase text-vscode-descriptionForeground">
							{t("settings:memory.records.pathHints")}
						</div>
						<div className="mt-1 flex min-w-0 max-w-full flex-wrap gap-1">
							{memory.pathTags.map((pathTag) => (
								<MemoryPill key={pathTag}>{pathTag}</MemoryPill>
							))}
						</div>
					</div>
				)}

				<div className="grid min-w-0 max-w-full gap-2 text-xs text-vscode-descriptionForeground sm:grid-cols-2 lg:grid-cols-3">
					{createdAt && (
						<div className="min-w-0 break-words [overflow-wrap:anywhere]">
							<span className="font-medium text-vscode-foreground">
								{t("settings:memory.records.created")}:{" "}
							</span>
							{createdAt}
						</div>
					)}
					{updatedAt && (
						<div className="min-w-0 break-words [overflow-wrap:anywhere]">
							<span className="font-medium text-vscode-foreground">
								{t("settings:memory.records.updated")}:{" "}
							</span>
							{updatedAt}
						</div>
					)}
					{lastUsedAt && (
						<div className="min-w-0 break-words [overflow-wrap:anywhere]">
							<span className="font-medium text-vscode-foreground">
								{t("settings:memory.records.lastUsed")}:{" "}
							</span>
							{lastUsedAt}
						</div>
					)}
				</div>

				<div className="flex min-w-0 max-w-full flex-wrap justify-end gap-2 border-t border-vscode-panel-border pt-2">
					<Button
						type="button"
						data-testid={`memory-record-${memory.id}-remove-button`}
						variant="destructive"
						onClick={() => onRemove(memory)}>
						{t("common:answers.remove")}
					</Button>
				</div>
			</div>
		</details>
	)
}

const MemoryRecordList = ({
	scope,
	records,
	onRemove,
}: {
	scope: MemoryScope
	records: MemoryEntry[]
	onRemove: (memory: MemoryEntry) => void
}) => {
	const { t } = useAppTranslation()

	return (
		<div className="min-w-0 max-w-full space-y-2 overflow-hidden" data-testid={`memory-record-list-${scope}`}>
			<div className="flex min-w-0 items-center justify-between gap-2">
				<div className="min-w-0 truncate font-medium">{t(`settings:memory.scope.${scope}`)}</div>
				<div className="shrink-0 text-xs text-vscode-descriptionForeground">
					{t("settings:memory.records.count", { count: records.length })}
				</div>
			</div>

			{records.length > 0 ? (
				<div className="min-w-0 max-w-full space-y-2">
					{records.map((memory) => (
						<MemoryRecordCard key={memory.id} memory={memory} onRemove={onRemove} />
					))}
				</div>
			) : (
				<div className="min-w-0 max-w-full rounded-md border border-dashed border-vscode-panel-border p-3 text-sm text-vscode-descriptionForeground">
					{t("settings:memory.records.empty")}
				</div>
			)}
		</div>
	)
}

const SummaryCard = ({ title, summary }: { title: string; summary?: MemorySummary["workspace"] }) => {
	const { t } = useAppTranslation()

	return (
		<div className="min-w-0 max-w-full overflow-hidden rounded-md border border-vscode-panel-border bg-vscode-editor-background p-3">
			<div className="mb-2 min-w-0 break-words font-medium">{title}</div>
			<div className="grid min-w-0 grid-cols-2 gap-2 text-sm sm:grid-cols-4">
				<div className="min-w-0">
					<div className="truncate text-vscode-descriptionForeground">
						{t("settings:memory.summary.active")}
					</div>
					<div>{summary?.active ?? 0}</div>
				</div>
				<div className="min-w-0">
					<div className="truncate text-vscode-descriptionForeground">
						{t("settings:memory.summary.pending")}
					</div>
					<div>{summary?.pending ?? 0}</div>
				</div>
				<div className="min-w-0">
					<div className="truncate text-vscode-descriptionForeground">
						{t("settings:memory.summary.archived")}
					</div>
					<div>{summary?.archived ?? 0}</div>
				</div>
				<div className="min-w-0">
					<div className="truncate text-vscode-descriptionForeground">
						{t("settings:memory.summary.total")}
					</div>
					<div>{summary?.total ?? 0}</div>
				</div>
			</div>
		</div>
	)
}

export const MemorySettings = ({
	memoryEnabled,
	memoryWorkspaceEnabled,
	memoryGlobalEnabled,
	memoryMistakeMemoryEnabled,
	memoryMaxCharacters,
	memoryMaxEntries,
	memoryPendingCandidateLimit,
	memoryState,
	memorySummary,
	setCachedStateField,
	className,
	...props
}: MemorySettingsProps) => {
	const { t } = useAppTranslation()
	const [pendingAction, setPendingAction] = useState<PendingMemoryAction>()
	const modeValue = memoryEnabled === undefined ? "auto" : memoryEnabled ? "enabled" : "disabled"
	const summary = memoryState?.summary ?? memorySummary
	const workspaceRecords = memoryState?.workspace ?? []
	const globalRecords = memoryState?.global ?? []

	const requestMemoryAction = (memoryAction: MemoryAction | PendingMemoryAction) => {
		const action = typeof memoryAction === "string" ? { memoryAction } : memoryAction
		if (destructiveMemoryActions.has(action.memoryAction)) {
			setPendingAction(action)
			return
		}

		postMemoryAction(action)
	}

	const requestRemoveMemory = (memory: MemoryEntry) => {
		requestMemoryAction({ memoryAction: "deleteMemory", memoryId: memory.id, memoryScope: memory.scope })
	}

	const confirmPendingAction = () => {
		if (pendingAction) {
			postMemoryAction(pendingAction)
		}
		setPendingAction(undefined)
	}

	return (
		<div className={cn("flex min-w-0 max-w-full flex-col gap-2 overflow-x-hidden", className)} {...props}>
			<SectionHeader description={t("settings:memory.description")}>
				{t("settings:sections.memory")}
			</SectionHeader>

			<Section className="min-w-0 max-w-full gap-3 overflow-x-hidden">
				<MemoryCollapsibleSection
					testId="memory-core"
					defaultOpen
					title={t("settings:memory.sections.coreBehavior.title")}
					description={t("settings:memory.sections.coreBehavior.description")}>
					<SearchableSetting settingId="memory-mode" section="memory" label={t("settings:memory.mode.label")}>
						<label className="block font-medium mb-1">{t("settings:memory.mode.label")}</label>
						<Select
							value={modeValue}
							onValueChange={(value) => {
								setCachedStateField("memoryEnabled", value === "auto" ? undefined : value === "enabled")
							}}>
							<SelectTrigger className="w-full">
								<SelectValue placeholder={t("settings:memory.mode.label")} />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="auto">{t("settings:memory.mode.options.auto")}</SelectItem>
								<SelectItem value="enabled">{t("settings:memory.mode.options.enabled")}</SelectItem>
								<SelectItem value="disabled">{t("settings:memory.mode.options.disabled")}</SelectItem>
							</SelectContent>
						</Select>
						<div className="text-vscode-descriptionForeground text-sm mt-1">
							{t("settings:memory.mode.description")}
						</div>
					</SearchableSetting>

					<SearchableSetting
						settingId="memory-workspace-enabled"
						section="memory"
						label={t("settings:memory.workspaceEnabled.label")}>
						<VSCodeCheckbox
							data-testid="memory-workspace-enabled-checkbox"
							checked={memoryWorkspaceEnabled ?? true}
							onChange={(e: any) => setCachedStateField("memoryWorkspaceEnabled", e.target.checked)}>
							<span className="font-medium">{t("settings:memory.workspaceEnabled.label")}</span>
						</VSCodeCheckbox>
						<div className="text-vscode-descriptionForeground text-sm">
							{t("settings:memory.workspaceEnabled.description")}
						</div>
					</SearchableSetting>

					<SearchableSetting
						settingId="memory-global-enabled"
						section="memory"
						label={t("settings:memory.globalEnabled.label")}>
						<VSCodeCheckbox
							data-testid="memory-global-enabled-checkbox"
							checked={memoryGlobalEnabled ?? true}
							onChange={(e: any) => setCachedStateField("memoryGlobalEnabled", e.target.checked)}>
							<span className="font-medium">{t("settings:memory.globalEnabled.label")}</span>
						</VSCodeCheckbox>
						<div className="text-vscode-descriptionForeground text-sm">
							{t("settings:memory.globalEnabled.description")}
						</div>
					</SearchableSetting>

					<SearchableSetting
						settingId="memory-mistake-enabled"
						section="memory"
						label={t("settings:memory.mistakeMemoryEnabled.label")}>
						<VSCodeCheckbox
							data-testid="memory-mistake-enabled-checkbox"
							checked={memoryMistakeMemoryEnabled ?? true}
							onChange={(e: any) => setCachedStateField("memoryMistakeMemoryEnabled", e.target.checked)}>
							<span className="font-medium">{t("settings:memory.mistakeMemoryEnabled.label")}</span>
						</VSCodeCheckbox>
						<div className="text-vscode-descriptionForeground text-sm">
							{t("settings:memory.mistakeMemoryEnabled.description")}
						</div>
					</SearchableSetting>
				</MemoryCollapsibleSection>

				<MemoryCollapsibleSection
					testId="memory-retrieval"
					title={t("settings:memory.sections.retrievalLimits.title")}
					description={t("settings:memory.sections.retrievalLimits.description")}>
					<SearchableSetting
						settingId="memory-max-characters"
						section="memory"
						label={t("settings:memory.maxCharacters.label")}>
						<label className="block font-medium mb-1">{t("settings:memory.maxCharacters.label")}</label>
						<Input
							data-testid="memory-max-characters-input"
							type="number"
							min={0}
							max={20_000}
							value={memoryMaxCharacters ?? 2400}
							onChange={(e) =>
								setCachedStateField(
									"memoryMaxCharacters",
									Math.min(20_000, Math.max(0, Number(e.target.value) || 0)),
								)
							}
						/>
						<div className="text-vscode-descriptionForeground text-sm mt-1">
							{t("settings:memory.maxCharacters.description")}
						</div>
					</SearchableSetting>

					<SearchableSetting
						settingId="memory-max-entries"
						section="memory"
						label={t("settings:memory.maxEntries.label")}>
						<label className="block font-medium mb-1">{t("settings:memory.maxEntries.label")}</label>
						<Input
							data-testid="memory-max-entries-input"
							type="number"
							min={0}
							max={50}
							value={memoryMaxEntries ?? 8}
							onChange={(e) =>
								setCachedStateField(
									"memoryMaxEntries",
									Math.min(50, Math.max(0, Number(e.target.value) || 0)),
								)
							}
						/>
						<div className="text-vscode-descriptionForeground text-sm mt-1">
							{t("settings:memory.maxEntries.description")}
						</div>
					</SearchableSetting>
				</MemoryCollapsibleSection>

				<MemoryCollapsibleSection
					testId="memory-management"
					defaultOpen
					title={t("settings:memory.sections.management.title")}
					description={t("settings:memory.sections.management.description")}>
					<SearchableSetting
						settingId="memory-management"
						section="memory"
						label={t("settings:memory.management.title")}>
						<div className="mb-3 flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
							<div className="min-w-0 max-w-full">
								<div className="break-words font-medium">{t("settings:memory.management.title")}</div>
								<div className="break-words text-vscode-descriptionForeground text-sm">
									{t("settings:memory.management.description")}
								</div>
							</div>
							<Button
								data-testid="memory-refresh-button"
								variant="secondary"
								onClick={() => requestMemoryAction("refresh")}>
								{t("settings:memory.actions.refresh")}
							</Button>
						</div>

						<div className="grid min-w-0 max-w-full gap-3 sm:grid-cols-2 [&>*]:min-w-0">
							<SummaryCard title={t("settings:memory.summary.workspace")} summary={summary?.workspace} />
							<SummaryCard title={t("settings:memory.summary.global")} summary={summary?.global} />
						</div>

						<div className="mt-4 grid min-w-0 max-w-full gap-3 lg:grid-cols-2 [&>*]:min-w-0">
							<MemoryRecordList
								scope="workspace"
								records={workspaceRecords}
								onRemove={requestRemoveMemory}
							/>
							<MemoryRecordList scope="global" records={globalRecords} onRemove={requestRemoveMemory} />
						</div>

						<div className="mt-4 grid min-w-0 max-w-full gap-4 sm:grid-cols-2 [&>*]:min-w-0">
							<div className="flex min-w-0 flex-col gap-2">
								<div className="break-words font-medium">{t("settings:memory.summary.workspace")}</div>
								<div className="flex min-w-0 flex-wrap gap-2">
									<Button
										data-testid="memory-archive-workspace-button"
										variant="secondary"
										onClick={() => requestMemoryAction("archiveWorkspace")}>
										{t("settings:memory.actions.archiveAll")}
									</Button>
									<Button
										data-testid="memory-clear-workspace-button"
										variant="destructive"
										onClick={() => requestMemoryAction("clearWorkspace")}>
										{t("settings:memory.actions.clear")}
									</Button>
								</div>
							</div>

							<div className="flex min-w-0 flex-col gap-2">
								<div className="break-words font-medium">{t("settings:memory.summary.global")}</div>
								<div className="flex min-w-0 flex-wrap gap-2">
									<Button
										data-testid="memory-archive-global-button"
										variant="secondary"
										onClick={() => requestMemoryAction("archiveGlobal")}>
										{t("settings:memory.actions.archiveAll")}
									</Button>
									<Button
										data-testid="memory-clear-global-button"
										variant="destructive"
										onClick={() => requestMemoryAction("clearGlobal")}>
										{t("settings:memory.actions.clear")}
									</Button>
								</div>
							</div>
						</div>
					</SearchableSetting>
				</MemoryCollapsibleSection>

				<MemoryCollapsibleSection
					testId="memory-advanced"
					title={t("settings:memory.sections.advanced.title")}
					description={t("settings:memory.sections.advanced.description")}>
					<SearchableSetting
						settingId="memory-pending-limit"
						section="memory"
						label={t("settings:memory.pendingCandidateLimit.label")}>
						<label className="block font-medium mb-1">
							{t("settings:memory.pendingCandidateLimit.label")}
						</label>
						<Input
							data-testid="memory-pending-limit-input"
							type="number"
							min={0}
							max={1000}
							value={memoryPendingCandidateLimit ?? 100}
							onChange={(e) =>
								setCachedStateField(
									"memoryPendingCandidateLimit",
									Math.min(1000, Math.max(0, Number(e.target.value) || 0)),
								)
							}
						/>
						<div className="text-vscode-descriptionForeground text-sm mt-1">
							{t("settings:memory.pendingCandidateLimit.description")}
						</div>
					</SearchableSetting>
				</MemoryCollapsibleSection>
			</Section>

			<AlertDialog open={Boolean(pendingAction)} onOpenChange={(open) => !open && setPendingAction(undefined)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{t("settings:memory.confirm.title")}</AlertDialogTitle>
						<AlertDialogDescription>{t("settings:memory.confirm.description")}</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel onClick={() => setPendingAction(undefined)}>
							{t("settings:memory.confirm.cancel")}
						</AlertDialogCancel>
						<AlertDialogAction onClick={confirmPendingAction}>
							{t("settings:memory.confirm.confirm")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	)
}
