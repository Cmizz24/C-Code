import type OpenAI from "openai"

import askForContext from "../ask_for_context"
import { getNativeTools } from "../index"

type FunctionTool = OpenAI.Chat.ChatCompletionTool & { type: "function" }

const getFunctionDef = (tool: OpenAI.Chat.ChatCompletionTool) => (tool as FunctionTool).function

describe("ask_for_context native tool", () => {
	it("defines the cold-context retrieval tool schema", () => {
		const functionDef = getFunctionDef(askForContext)
		const schema = functionDef.parameters as any

		expect(functionDef.name).toBe("ask_for_context")
		expect(functionDef.strict).toBe(true)
		expect(functionDef.description).toContain("up to three matching context chunks verbatim")
		expect(schema.required).toContain("query")
		expect(schema.properties.query.type).toBe("string")
		expect(schema.properties.filePath.type).toEqual(["string", "null"])
		expect(schema.additionalProperties).toBe(false)
	})

	it("is included in the default native tools list", () => {
		const nativeToolNames = getNativeTools().map((tool) => getFunctionDef(tool).name)

		expect(nativeToolNames).toContain("ask_for_context")
	})
})
