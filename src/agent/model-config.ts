// ken sends the project's code to the model's provider, so it has no default model (plan, "Default chat model"). The
// person names the model, its OpenAI-compatible endpoint, and the variable that holds the key. Flags win over KEN_*.

export type ModelConfig = { model: string; baseUrl: string; apiKeyEnv: string }

export type ModelFlags = { model?: string | undefined; baseUrl?: string | undefined; apiKeyEnv?: string | undefined }

const EXAMPLE = 'For example: KEN_MODEL=gpt-oss:120b KEN_BASE_URL=https://ollama.com/v1 KEN_API_KEY_ENV=OLLAMA_API_KEY'

export function readModelConfig(
	flags: ModelFlags,
	env: Record<string, string | undefined>,
): { kind: 'ok'; config: ModelConfig } | { kind: 'unset'; message: string } {
	const model = flags.model || env.KEN_MODEL
	const baseUrl = flags.baseUrl || env.KEN_BASE_URL
	const apiKeyEnv = flags.apiKeyEnv || env.KEN_API_KEY_ENV
	if (!model || !baseUrl || !apiKeyEnv) {
		const missing = [
			model ? '' : 'KEN_MODEL or --model: the model to ask',
			baseUrl ? '' : 'KEN_BASE_URL or --base-url: the address of its OpenAI-compatible endpoint',
			apiKeyEnv ? '' : 'KEN_API_KEY_ENV or --api-key-env: the name of the variable that holds the key',
		].filter((line) => line !== '')
		const lines = [
			"ken sends your project's code to the model you choose, so it has no default model. Set these:",
			...missing.map((line) => `  ${line}`),
			EXAMPLE,
		]
		return { kind: 'unset', message: lines.join('\n') }
	}
	if (!URL.canParse(baseUrl)) return { kind: 'unset', message: `The base URL "${baseUrl}" is not a URL.` }
	if (!env[apiKeyEnv]) {
		return {
			kind: 'unset',
			message: `KEN_API_KEY_ENV names ${apiKeyEnv}, but ${apiKeyEnv} is not set. Put the key in it.`,
		}
	}
	return { kind: 'ok', config: { model, baseUrl, apiKeyEnv } }
}
