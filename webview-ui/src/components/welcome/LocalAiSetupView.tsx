import { useCallback, useEffect, useMemo, useState } from "react"
import {
	AlertTriangle,
	ArrowLeft,
	CheckCircle2,
	Download,
	ExternalLink,
	RefreshCcw,
	Server,
	ShieldCheck,
} from "lucide-react"

import type {
	ExtensionMessage,
	LocalAiHardwareProbe,
	LocalAiProviderPreference,
	LocalAiQuestionnaire,
	LocalAiRecommendation,
	LocalAiRuntimeStatus,
	LocalAiSetupProgress,
	LocalAiSetupResult,
} from "@roo-code/types"

import { Button } from "@src/components/ui"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { vscode } from "@src/utils/vscode"

const OLLAMA_INSTALL_URL = "https://ollama.com/download"
const LM_STUDIO_DOWNLOAD_URL = "https://lmstudio.ai/download"
const LM_STUDIO_SERVER_DOCS_URL = "https://lmstudio.ai/docs/basics/server"

const DEFAULT_QUESTIONNAIRE: LocalAiQuestionnaire = {
	usageProfile: "daily",
	preference: "balanced",
	privacy: "local-only",
	diskBudgetGb: 8,
	runtimeChoice: "ollama",
	providerPreference: "ollama",
}

type LocalAiStep = "questionnaire" | "recommendation" | "progress" | "success" | "manual"

interface LocalAiSetupViewProps {
	onBack: () => void
	onApiProviderSetup: () => void
}

const formatGb = (value?: number) => {
	if (typeof value !== "number" || Number.isNaN(value)) {
		return "—"
	}

	return `${Math.round(value * 10) / 10} GB`
}

const getRuntimeSummary = (probe?: LocalAiHardwareProbe) => {
	if (!probe) {
		return []
	}

	return [probe.runtimes.ollama, probe.runtimes.lmStudio]
}

const getProgressPercent = (progress?: LocalAiSetupProgress) => progress?.percent ?? 0

const getRuntimeModels = (runtime?: LocalAiRuntimeStatus) => runtime?.models?.filter(Boolean) ?? []

const LocalAiSetupView = ({ onBack, onApiProviderSetup }: LocalAiSetupViewProps) => {
	const { t } = useAppTranslation()
	const [step, setStep] = useState<LocalAiStep>("questionnaire")
	const [probe, setProbe] = useState<LocalAiHardwareProbe>()
	const [probeError, setProbeError] = useState<string>()
	const [isProbing, setIsProbing] = useState(true)
	const [isRecommending, setIsRecommending] = useState(false)
	const [questionnaire, setQuestionnaire] = useState<LocalAiQuestionnaire>(DEFAULT_QUESTIONNAIRE)
	const [recommendation, setRecommendation] = useState<LocalAiRecommendation>()
	const [progress, setProgress] = useState<LocalAiSetupProgress>()
	const [setupResult, setSetupResult] = useState<LocalAiSetupResult>()
	const [setupError, setSetupError] = useState<string>()

	const detectedRuntimes = useMemo(() => getRuntimeSummary(probe), [probe])
	const lmStudioRuntime = probe?.runtimes.lmStudio
	const lmStudioModels = useMemo(() => getRuntimeModels(lmStudioRuntime), [lmStudioRuntime])
	const isLmStudioReady = lmStudioRuntime?.status === "running" && lmStudioModels.length > 0
	const isLmStudioSelected =
		questionnaire.runtimeChoice === "lmstudio" || questionnaire.providerPreference === "lmstudio"

	const updateQuestionnaire = useCallback(
		<K extends keyof LocalAiQuestionnaire>(field: K, value: LocalAiQuestionnaire[K]) => {
			setQuestionnaire((current) => ({ ...current, [field]: value }))
		},
		[],
	)

	const selectProvider = useCallback(
		(provider: LocalAiProviderPreference) => {
			setQuestionnaire((current) => ({
				...current,
				runtimeChoice: provider,
				providerPreference: provider,
				selectedModel: provider === "lmstudio" ? (current.selectedModel ?? lmStudioModels[0]) : undefined,
			}))
		},
		[lmStudioModels],
	)

	const requestProbe = useCallback(() => {
		setIsProbing(true)
		setProbeError(undefined)
		vscode.postMessage({ type: "localAiProbe" })
	}, [])

	useEffect(() => {
		requestProbe()
	}, [requestProbe])

	useEffect(() => {
		const handleMessage = (event: MessageEvent<ExtensionMessage>) => {
			const message = event.data

			switch (message.type) {
				case "localAiProbeResult": {
					setIsProbing(false)
					if (message.error) {
						setProbeError(message.error)
						return
					}
					const nextProbe = message.payload as LocalAiHardwareProbe
					setProbe(nextProbe)
					const nextLmStudioModels = getRuntimeModels(nextProbe.runtimes.lmStudio)
					if (nextLmStudioModels.length > 0) {
						setQuestionnaire((current) => ({
							...current,
							selectedModel: current.selectedModel ?? nextLmStudioModels[0],
						}))
					}
					break
				}
				case "localAiRecommendationResult": {
					setIsRecommending(false)
					if (message.error) {
						setSetupError(message.error)
						return
					}

					setRecommendation(message.payload as LocalAiRecommendation)
					setSetupError(undefined)
					setStep("recommendation")
					break
				}
				case "localAiSetupProgress": {
					const nextProgress = message.payload as LocalAiSetupProgress
					setProgress(nextProgress)
					if (nextProgress.stage === "error") {
						setSetupError(nextProgress.error ?? nextProgress.message)
					}
					break
				}
				case "localAiSetupResult": {
					const result = (message.payload ?? {
						success: message.success,
						error: message.error,
					}) as LocalAiSetupResult
					setSetupResult(result)
					if (result.success) {
						setSetupError(undefined)
						setStep("success")
					} else {
						setSetupError(result.error ?? message.error)
					}
					break
				}
			}
		}

		window.addEventListener("message", handleMessage)
		return () => window.removeEventListener("message", handleMessage)
	}, [])

	const handleRecommendationRequest = useCallback(() => {
		if (questionnaire.runtimeChoice === "manual") {
			setStep("manual")
			return
		}

		if (!probe) {
			return
		}

		setIsRecommending(true)
		setSetupError(undefined)
		vscode.postMessage({
			type: "localAiRecommend",
			payload: { probe, questionnaire },
		})
	}, [probe, questionnaire])

	const handleStartSetup = useCallback(() => {
		if (!recommendation || recommendation.recommendedSetup === "api-provider") {
			return
		}

		setStep("progress")
		setSetupError(undefined)
		setSetupResult(undefined)
		setProgress({
			stage: "runtime",
			message: t("welcome:localSetup.progress.starting"),
			modelTag: recommendation.model.tag,
		})
		vscode.postMessage({
			type: "localAiStartSetup",
			payload: { recommendation, questionnaire },
		})
	}, [questionnaire, recommendation, t])

	const handleCancelSetup = useCallback(() => {
		vscode.postMessage({ type: "localAiCancelSetup" })
	}, [])

	const handleOpenInstall = useCallback((url = OLLAMA_INSTALL_URL) => {
		if (url === LM_STUDIO_DOWNLOAD_URL) {
			vscode.postMessage({ type: "localAiOpenDownload" })
			return
		}

		vscode.postMessage({ type: "openExternal", url })
	}, [])

	const handleRuntimeChoiceChange = useCallback(
		(value: LocalAiQuestionnaire["runtimeChoice"]) => {
			if (value === "ollama" || value === "lmstudio") {
				selectProvider(value)
				return
			}

			setQuestionnaire((current) => ({
				...current,
				runtimeChoice: value,
				providerPreference:
					value === "existing"
						? isLmStudioReady
							? "lmstudio"
							: (current.providerPreference ?? "ollama")
						: current.providerPreference,
			}))
		},
		[isLmStudioReady, selectProvider],
	)

	const getInstallActionLabel = useCallback(
		(url?: string) =>
			url?.includes("lmstudio.ai")
				? t("welcome:localSetup.actions.openLmStudioDownload")
				: t("welcome:localSetup.actions.openOllamaDownload"),
		[t],
	)

	const renderLmStudioGuidance = () => {
		if (!lmStudioRuntime) {
			return null
		}

		const statusText = t(`welcome:localSetup.runtimeStatus.${lmStudioRuntime.status}`)
		const guidanceKey = isLmStudioReady
			? "ready"
			: lmStudioRuntime.status === "running"
				? "noModels"
				: lmStudioRuntime.status === "installed-not-running"
					? "serverStopped"
					: lmStudioRuntime.status === "detection-failed"
						? "detectionFailed"
						: "missing"

		return (
			<div
				data-testid="lm-studio-guidance"
				className="rounded border border-vscode-foreground/20 p-3 text-sm space-y-2">
				<div className="font-medium">
					{t("welcome:localSetup.lmStudio.statusHeading", { status: statusText })}
				</div>
				<div>
					{t(`welcome:localSetup.lmStudio.${guidanceKey}`, {
						error: lmStudioRuntime.error ?? t("welcome:localSetup.lmStudio.unknownError"),
						models: lmStudioModels.length,
					})}
				</div>
				{isLmStudioReady && (
					<label className="flex flex-col gap-1">
						<span>{t("welcome:localSetup.lmStudio.modelLabel")}</span>
						<select
							data-testid="lm-studio-model-select"
							className="rounded border border-vscode-foreground/20 bg-vscode-input-background p-2 text-vscode-input-foreground"
							value={questionnaire.selectedModel ?? lmStudioModels[0]}
							onChange={(event) => updateQuestionnaire("selectedModel", event.target.value)}>
							{lmStudioModels.map((model) => (
								<option key={model} value={model}>
									{model}
								</option>
							))}
						</select>
					</label>
				)}
				{!isLmStudioReady && (
					<div className="flex flex-wrap gap-2">
						<Button variant="secondary" size="sm" onClick={() => handleOpenInstall(LM_STUDIO_DOWNLOAD_URL)}>
							<ExternalLink className="size-4" />
							{t("welcome:localSetup.actions.openLmStudioDownload")}
						</Button>
						<Button
							variant="secondary"
							size="sm"
							onClick={() => handleOpenInstall(LM_STUDIO_SERVER_DOCS_URL)}>
							<ExternalLink className="size-4" />
							{t("welcome:localSetup.actions.openLmStudioServerDocs")}
						</Button>
					</div>
				)}
			</div>
		)
	}

	const renderProviderChoices = () => (
		<div className="space-y-2">
			<div className="text-sm font-medium">{t("welcome:localSetup.form.provider.label")}</div>
			<div className="grid gap-3 md:grid-cols-2">
				<button
					type="button"
					data-testid="local-ai-provider-ollama"
					aria-pressed={questionnaire.providerPreference !== "lmstudio"}
					onClick={() => selectProvider("ollama")}
					className={`cursor-pointer rounded-md border p-3 text-left text-vscode-foreground ${
						questionnaire.providerPreference !== "lmstudio"
							? "border-vscode-button-background bg-vscode-foreground/10"
							: "border-vscode-foreground/20 bg-transparent hover:bg-vscode-foreground/5"
					}`}>
					<div className="font-medium">{t("welcome:localSetup.form.provider.ollamaTitle")}</div>
					<div className="mt-1 text-sm">{t("welcome:localSetup.form.provider.ollamaDescription")}</div>
				</button>
				<button
					type="button"
					data-testid="local-ai-provider-lmstudio"
					aria-pressed={questionnaire.providerPreference === "lmstudio"}
					onClick={() => selectProvider("lmstudio")}
					className={`cursor-pointer rounded-md border p-3 text-left text-vscode-foreground ${
						questionnaire.providerPreference === "lmstudio"
							? "border-vscode-button-background bg-vscode-foreground/10"
							: "border-vscode-foreground/20 bg-transparent hover:bg-vscode-foreground/5"
					}`}>
					<div className="flex items-center justify-between gap-2 font-medium">
						<span>{t("welcome:localSetup.form.provider.lmStudioTitle")}</span>
						{isLmStudioReady && (
							<span className="rounded bg-vscode-button-background px-2 py-0.5 text-xs text-vscode-button-foreground">
								{t("welcome:localSetup.form.provider.readyBadge")}
							</span>
						)}
					</div>
					<div className="mt-1 text-sm">
						{isLmStudioReady
							? t("welcome:localSetup.form.provider.lmStudioReadyDescription", {
									models: lmStudioModels.length,
								})
							: t("welcome:localSetup.form.provider.lmStudioDescription")}
					</div>
				</button>
			</div>
			{isLmStudioSelected && renderLmStudioGuidance()}
		</div>
	)

	const renderProbeSummary = () => (
		<div className="rounded-md border border-vscode-foreground/20 p-3 text-sm space-y-2">
			<div className="font-medium">{t("welcome:localSetup.hardware.heading")}</div>
			{isProbing ? (
				<div>{t("welcome:localSetup.hardware.detecting")}</div>
			) : probe ? (
				<div className="space-y-1">
					<div>
						{t("welcome:localSetup.hardware.system", {
							os: probe.os,
							arch: probe.arch,
							cores: probe.cpu.count,
							ram: formatGb(probe.memory.totalGb),
						})}
					</div>
					<div>
						{t("welcome:localSetup.hardware.disk", {
							free: formatGb(probe.disk.freeGb),
						})}
					</div>
					<div>
						{probe.gpu.status === "detected"
							? t("welcome:localSetup.hardware.gpuDetected", { gpu: probe.gpu.names.join(", ") })
							: t("welcome:localSetup.hardware.gpuUnknown")}
					</div>
					<div className="pt-1">
						{detectedRuntimes.map((runtime) => (
							<div key={runtime.provider}>
								{t("welcome:localSetup.hardware.runtime", {
									runtime: runtime.displayName,
									status: t(`welcome:localSetup.runtimeStatus.${runtime.status}`),
								})}
							</div>
						))}
					</div>
				</div>
			) : (
				<div className="text-vscode-errorForeground">{probeError}</div>
			)}
			<div className="flex gap-2">
				<Button variant="secondary" size="sm" onClick={requestProbe} disabled={isProbing}>
					<RefreshCcw className="size-4" />
					{t("welcome:localSetup.hardware.refresh")}
				</Button>
			</div>
		</div>
	)

	const renderQuestionnaire = () => (
		<div className="space-y-4">
			{renderProbeSummary()}

			<div className="grid gap-3 md:grid-cols-2">
				<label className="flex flex-col gap-1 text-sm">
					<span>{t("welcome:localSetup.form.usage.label")}</span>
					<select
						className="rounded border border-vscode-foreground/20 bg-vscode-input-background p-2 text-vscode-input-foreground"
						value={questionnaire.usageProfile}
						onChange={(event) =>
							updateQuestionnaire(
								"usageProfile",
								event.target.value as LocalAiQuestionnaire["usageProfile"],
							)
						}>
						<option value="light">{t("welcome:localSetup.form.usage.light")}</option>
						<option value="daily">{t("welcome:localSetup.form.usage.daily")}</option>
						<option value="agentic">{t("welcome:localSetup.form.usage.agentic")}</option>
					</select>
				</label>

				<label className="flex flex-col gap-1 text-sm">
					<span>{t("welcome:localSetup.form.preference.label")}</span>
					<select
						className="rounded border border-vscode-foreground/20 bg-vscode-input-background p-2 text-vscode-input-foreground"
						value={questionnaire.preference}
						onChange={(event) =>
							updateQuestionnaire("preference", event.target.value as LocalAiQuestionnaire["preference"])
						}>
						<option value="speed">{t("welcome:localSetup.form.preference.speed")}</option>
						<option value="balanced">{t("welcome:localSetup.form.preference.balanced")}</option>
						<option value="quality">{t("welcome:localSetup.form.preference.quality")}</option>
					</select>
				</label>

				<label className="flex flex-col gap-1 text-sm">
					<span>{t("welcome:localSetup.form.privacy.label")}</span>
					<select
						className="rounded border border-vscode-foreground/20 bg-vscode-input-background p-2 text-vscode-input-foreground"
						value={questionnaire.privacy}
						onChange={(event) =>
							updateQuestionnaire("privacy", event.target.value as LocalAiQuestionnaire["privacy"])
						}>
						<option value="local-only">{t("welcome:localSetup.form.privacy.localOnly")}</option>
						<option value="local-preferred">{t("welcome:localSetup.form.privacy.localPreferred")}</option>
					</select>
				</label>

				<label className="flex flex-col gap-1 text-sm">
					<span>{t("welcome:localSetup.form.diskBudget")}</span>
					<input
						className="rounded border border-vscode-foreground/20 bg-vscode-input-background p-2 text-vscode-input-foreground"
						type="number"
						min={1}
						max={128}
						value={questionnaire.diskBudgetGb}
						onChange={(event) => updateQuestionnaire("diskBudgetGb", Number(event.target.value))}
					/>
				</label>

				<label className="flex flex-col gap-1 text-sm">
					<span>{t("welcome:localSetup.form.runtime.label")}</span>
					<select
						className="rounded border border-vscode-foreground/20 bg-vscode-input-background p-2 text-vscode-input-foreground"
						value={questionnaire.runtimeChoice}
						onChange={(event) =>
							handleRuntimeChoiceChange(event.target.value as LocalAiQuestionnaire["runtimeChoice"])
						}>
						<option value="existing">{t("welcome:localSetup.form.runtime.existing")}</option>
						<option value="ollama">{t("welcome:localSetup.form.runtime.ollama")}</option>
						<option value="lmstudio">{t("welcome:localSetup.form.runtime.lmStudio")}</option>
						<option value="manual">{t("welcome:localSetup.form.runtime.manual")}</option>
					</select>
				</label>
			</div>

			{renderProviderChoices()}

			{setupError && (
				<div className="rounded border border-vscode-errorForeground/40 p-2 text-sm text-vscode-errorForeground">
					{setupError}
				</div>
			)}

			<div className="flex flex-wrap gap-2">
				<Button variant="secondary" onClick={onBack}>
					<ArrowLeft className="size-4" />
					{t("welcome:providerSignup.goBack")}
				</Button>
				<Button variant="secondary" onClick={() => setStep("manual")}>
					{t("welcome:localSetup.actions.manual")}
				</Button>
				<Button
					variant="primary"
					onClick={handleRecommendationRequest}
					disabled={!probe || isProbing || isRecommending}>
					{isRecommending
						? t("welcome:localSetup.actions.recommending")
						: t("welcome:localSetup.actions.recommend")}
				</Button>
			</div>
		</div>
	)

	const renderRecommendation = () => {
		if (!recommendation) {
			return null
		}

		const recommendsApiProvider = recommendation.recommendedSetup === "api-provider"
		const recommendsLmStudio = recommendation.provider === "lmstudio"
		const needsManualLmStudioSetup = recommendsLmStudio && recommendation.recommendedSetup === "manual"
		const hasWeakHardwareWarning = recommendation.hasWeakHardwareWarning === true

		return (
			<div className="space-y-4">
				{recommendsApiProvider && (
					<div
						data-testid="local-ai-api-recommendation"
						className="rounded-md border border-vscode-inputValidation-warningBorder bg-vscode-inputValidation-warningBackground p-4 text-sm space-y-2">
						<div className="flex items-center gap-2 font-medium">
							<AlertTriangle className="size-4" />
							{t("welcome:localSetup.recommendation.apiHeading")}
						</div>
						<p className="m-0">{t("welcome:localSetup.recommendation.apiDescription")}</p>
						<p className="m-0">{t("welcome:localSetup.recommendation.manualStillAvailable")}</p>
					</div>
				)}

				{hasWeakHardwareWarning && !recommendsApiProvider && (
					<div
						data-testid="local-ai-weak-hardware-warning"
						className="rounded-md border border-vscode-inputValidation-warningBorder bg-vscode-inputValidation-warningBackground p-3 text-sm">
						<div className="flex items-center gap-2">
							<AlertTriangle className="size-4" />
							<span>{t("welcome:localSetup.recommendation.weakHardwareWarning")}</span>
						</div>
					</div>
				)}

				<div className="rounded-md border border-vscode-foreground/20 p-4 space-y-3">
					<div className="flex items-start gap-3">
						<Download className="mt-1 size-5" />
						<div>
							<h3 className="m-0 text-base">{t("welcome:localSetup.recommendation.heading")}</h3>
							<div className="font-medium">{recommendation.model.displayName}</div>
							<div className="text-sm">{recommendation.model.tag}</div>
						</div>
					</div>

					<div className="grid gap-2 text-sm md:grid-cols-2">
						<div>
							{t("welcome:localSetup.recommendation.size", {
								size: formatGb(recommendation.model.approximateSizeGb),
							})}
						</div>
						<div>
							{t("welcome:localSetup.recommendation.disk", { free: formatGb(recommendation.freeDiskGb) })}
						</div>
						<div>
							{t("welcome:localSetup.recommendation.runtime", {
								runtime: recommendation.runtimeDisplayName,
							})}
						</div>
						<div>
							{t("welcome:localSetup.recommendation.confidence", {
								confidence: t(`welcome:localSetup.confidence.${recommendation.confidence}`),
							})}
						</div>
					</div>

					<p className="m-0 text-sm">{recommendation.model.description}</p>

					<div className="rounded border border-vscode-foreground/20 p-2 text-sm">
						<div className="flex items-center gap-2 font-medium">
							<ShieldCheck className="size-4" />
							{t("welcome:localSetup.recommendation.privacyHeading")}
						</div>
						<div>{recommendation.privacyNote}</div>
					</div>

					<ul className="m-0 pl-5 text-sm">
						{recommendation.reasons.map((reason) => (
							<li key={reason}>{reason}</li>
						))}
					</ul>

					{recommendation.warnings.length > 0 && (
						<div className="rounded border border-vscode-errorForeground/40 p-2 text-sm text-vscode-errorForeground">
							<div className="flex items-center gap-2 font-medium">
								<AlertTriangle className="size-4" />
								{t("welcome:localSetup.recommendation.warnings")}
							</div>
							<ul className="m-0 pl-5">
								{recommendation.warnings.map((warning) => (
									<li key={warning}>{warning}</li>
								))}
							</ul>
						</div>
					)}
				</div>

				<div className="flex flex-wrap gap-2">
					<Button variant="secondary" onClick={() => setStep("questionnaire")}>
						<ArrowLeft className="size-4" />
						{t("welcome:localSetup.actions.adjust")}
					</Button>
					{recommendsApiProvider ? (
						<>
							<Button variant="secondary" onClick={() => setStep("manual")}>
								{t("welcome:localSetup.actions.manual")}
							</Button>
							<Button variant="primary" onClick={() => onApiProviderSetup()}>
								{t("welcome:localSetup.actions.useApiProvider")}
							</Button>
						</>
					) : needsManualLmStudioSetup ? (
						<>
							<Button variant="secondary" onClick={() => handleOpenInstall(LM_STUDIO_DOWNLOAD_URL)}>
								<ExternalLink className="size-4" />
								{t("welcome:localSetup.actions.openLmStudioDownload")}
							</Button>
							<Button variant="secondary" onClick={() => handleOpenInstall(LM_STUDIO_SERVER_DOCS_URL)}>
								<ExternalLink className="size-4" />
								{t("welcome:localSetup.actions.openLmStudioServerDocs")}
							</Button>
							<Button variant="primary" onClick={requestProbe}>
								<RefreshCcw className="size-4" />
								{t("welcome:localSetup.hardware.refresh")}
							</Button>
						</>
					) : (
						<>
							{hasWeakHardwareWarning && (
								<Button variant="secondary" onClick={() => onApiProviderSetup()}>
									{t("welcome:localSetup.actions.useApiProvider")}
								</Button>
							)}
							<Button
								variant="secondary"
								onClick={() =>
									handleOpenInstall(
										recommendsLmStudio ? LM_STUDIO_SERVER_DOCS_URL : OLLAMA_INSTALL_URL,
									)
								}>
								<ExternalLink className="size-4" />
								{recommendsLmStudio
									? t("welcome:localSetup.actions.openLmStudioServerDocs")
									: t("welcome:localSetup.actions.installHelp")}
							</Button>
							<Button variant="primary" onClick={handleStartSetup}>
								{recommendsLmStudio
									? t("welcome:localSetup.actions.useLmStudio")
									: t("welcome:localSetup.actions.confirmDownload")}
							</Button>
						</>
					)}
				</div>
			</div>
		)
	}

	const renderProgress = () => (
		<div className="space-y-4">
			<div className="rounded-md border border-vscode-foreground/20 p-4 space-y-3">
				<div className="flex items-center gap-2 font-medium">
					<Server className="size-5" />
					{t("welcome:localSetup.progress.heading")}
				</div>
				<div>{progress?.message ?? t("welcome:localSetup.progress.starting")}</div>
				{progress?.modelTag && (
					<div className="text-sm">
						{t("welcome:localSetup.progress.model", { model: progress.modelTag })}
					</div>
				)}
				<progress
					className="h-2 w-full overflow-hidden rounded"
					value={getProgressPercent(progress)}
					max={100}
				/>
				<div className="text-sm">
					{progress?.percent !== undefined
						? t("welcome:localSetup.progress.percent", { percent: progress.percent })
						: t("welcome:localSetup.progress.waiting")}
				</div>
				{setupError && (
					<div className="rounded border border-vscode-errorForeground/40 p-2 text-sm text-vscode-errorForeground">
						{setupError}
					</div>
				)}
				{setupResult?.installUrl && (
					<Button variant="secondary" onClick={() => handleOpenInstall(setupResult.installUrl)}>
						<ExternalLink className="size-4" />
						{getInstallActionLabel(setupResult.installUrl)}
					</Button>
				)}
			</div>

			<div className="flex flex-wrap gap-2">
				<Button variant="secondary" onClick={handleCancelSetup}>
					{t("welcome:localSetup.actions.cancel")}
				</Button>
				{setupError && recommendation && (
					<Button variant="primary" onClick={handleStartSetup}>
						{t("welcome:localSetup.actions.retry")}
					</Button>
				)}
			</div>
		</div>
	)

	const renderManual = () => (
		<div className="space-y-4">
			<div className="rounded-md border border-vscode-foreground/20 p-4 space-y-3">
				<h3 className="m-0 text-base">{t("welcome:localSetup.manual.heading")}</h3>
				<p className="m-0 text-sm">{t("welcome:localSetup.manual.description")}</p>
				<ol className="m-0 pl-5 text-sm space-y-1">
					<li>{t("welcome:localSetup.manual.stepInstall")}</li>
					<li>{t("welcome:localSetup.manual.stepStart")}</li>
					<li>{t("welcome:localSetup.manual.stepRetry")}</li>
				</ol>
			</div>
			<div className="flex flex-wrap gap-2">
				<Button variant="secondary" onClick={() => setStep("questionnaire")}>
					<ArrowLeft className="size-4" />
					{t("welcome:providerSignup.goBack")}
				</Button>
				<Button variant="secondary" onClick={() => handleOpenInstall()}>
					<ExternalLink className="size-4" />
					{t("welcome:localSetup.actions.openOllamaDownload")}
				</Button>
				<Button variant="secondary" onClick={() => handleOpenInstall(LM_STUDIO_DOWNLOAD_URL)}>
					<ExternalLink className="size-4" />
					{t("welcome:localSetup.actions.openLmStudioDownload")}
				</Button>
				<Button variant="primary" onClick={requestProbe}>
					{t("welcome:localSetup.hardware.refresh")}
				</Button>
			</div>
		</div>
	)

	const renderSuccess = () => (
		<div className="space-y-4">
			<div className="rounded-md border border-vscode-foreground/20 p-4 space-y-3">
				<div className="flex items-center gap-2 font-medium">
					<CheckCircle2 className="size-5" />
					{t("welcome:localSetup.success.heading")}
				</div>
				<p className="m-0 text-sm">
					{t("welcome:localSetup.success.description", {
						model: setupResult?.modelTag ?? recommendation?.model.tag ?? "Ollama",
					})}
				</p>
				<p className="m-0 text-sm">
					{t(
						recommendation?.provider === "lmstudio"
							? "welcome:localSetup.success.lmStudioProfile"
							: "welcome:localSetup.success.profile",
					)}
				</p>
			</div>
		</div>
	)

	return (
		<div data-testid="local-ai-setup-page" className="flex flex-col gap-4">
			<Server className="size-8" strokeWidth={1.5} />
			<div data-testid="local-ai-setup-header">
				<h2 data-testid="local-ai-setup-heading" className="mt-0 mb-1 text-xl">
					{t("welcome:localSetup.heading")}
				</h2>
				<p className="m-0 text-base text-vscode-foreground">{t("welcome:localSetup.subtitle")}</p>
			</div>

			{step === "questionnaire" && renderQuestionnaire()}
			{step === "recommendation" && renderRecommendation()}
			{step === "progress" && renderProgress()}
			{step === "manual" && renderManual()}
			{step === "success" && renderSuccess()}
		</div>
	)
}

export default LocalAiSetupView
