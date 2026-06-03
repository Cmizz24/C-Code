import { cleanup, render, screen } from "@/utils/test-utils"

describe("ExtensionStateContext HMR stability", () => {
	afterEach(() => {
		cleanup()
		vi.resetModules()
	})

	it("keeps providers and hooks compatible when the context module is re-evaluated", async () => {
		vi.resetModules()
		const providerModule = await import("@src/context/ExtensionStateContext")
		const Provider = providerModule.ExtensionStateContextProvider

		vi.resetModules()
		const hookModule = await import("@src/context/ExtensionStateContext")

		const Consumer = () => {
			const { allowedCommands } = hookModule.useExtensionState()

			return <div data-testid="allowed-commands">{JSON.stringify(allowedCommands)}</div>
		}

		expect(() => {
			render(
				<Provider>
					<Consumer />
				</Provider>,
			)
		}).not.toThrow("useExtensionState must be used within an ExtensionStateContextProvider")

		expect(JSON.parse(screen.getByTestId("allowed-commands").textContent ?? "null")).toEqual([])
	})
})
