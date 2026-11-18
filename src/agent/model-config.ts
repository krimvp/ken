// ken sends the project's code to the model's provider, so it has no default model (plan, "Default chat model"). The
// person names the model, its OpenAI-compatible endpoint, and the variable that holds the key. Flags win over KEN_*.

export type ModelConfig = { model: string; baseUrl: string; apiKeyEnv: string }

export type ModelFlags = { model?: string | undefined; baseUrl?: string | undefined; apiKeyEnv?: string | undefined }

export type ModelSetting = { name: string; flag: string; means: string }

const MODEL: ModelSetting = { name: 'KEN_MODEL', flag: '--model', means: 'the model to ask' }
const BASE_URL: ModelSetting = {
	name: 'KEN_BASE_URL',
	flag: '--base-url',
	means: 'the address of its OpenAI-compatible endpoint',
}
const API_KEY_ENV: ModelSetting = {
	name: 'KEN_API_KEY_ENV',
	flag: '--api-key-env',
	means: 'the name of the environment variable that holds your API key (not the key itself)',
}

const MIN_KEY_LENGTH = 8

export const MODEL_EXAMPLE = 'KEN_MODEL=glm-5.3 KEN_BASE_URL=https://ollama.com/v1 KEN_API_KEY_ENV=OLLAMA_API_KEY'

const SETUPS = [
	{ setup: 'Ollama Cloud. Put your key in OLLAMA_API_KEY.', line: MODEL_EXAMPLE },
	{
		setup:
			'An OpenAI-compatible proxy such as LiteLLM. Put its key in LITELLM_API_KEY, and change KEN_MODEL to a model it serves.',
		line: 'KEN_MODEL=gpt-5 KEN_BASE_URL=http://localhost:4000/v1 KEN_API_KEY_ENV=LITELLM_API_KEY',
	},
	{
		setup:
			'Claude through Claude Code on this machine, with no API key. Run ken-claude-endpoint in another terminal first.',
		line: 'KEN_MODEL=opus KEN_BASE_URL=http://127.0.0.1:4141/v1 KEN_API_KEY_ENV=KEN_LOCAL_KEY KEN_LOCAL_KEY=not-a-key',
	},
]

// missing lists the settings that are not given at all. It is empty when a setting is given but does not work.
export type ModelUnset = { kind: 'unset'; message: string; missing: ModelSetting[] }

export function readModelConfig(
	flags: ModelFlags,
	env: Record<string, string | undefined>,
): { kind: 'ok'; config: ModelConfig } | ModelUnset {
	const model = flags.model || env.KEN_MODEL
	const baseUrl = flags.baseUrl || env.KEN_BASE_URL
	const apiKeyEnv = flags.apiKeyEnv || env.KEN_API_KEY_ENV
	if (!model || !baseUrl || !apiKeyEnv) {
		const missing = [model ? null : MODEL, baseUrl ? null : BASE_URL, apiKeyEnv ? null : API_KEY_ENV].filter(
			(setting) => setting !== null,
		)
		const lines = [
			"ken sends your project's code to the model you choose, so it has no default model. Set these:",
			...missing.map((setting) => `  ${setting.name} or ${setting.flag}: ${setting.means}`),
			'Add the line for your setup to your shell startup file, such as ~/.zshrc or ~/.bashrc, then open a new terminal.',
			...SETUPS.flatMap(({ setup, line }) => ['', `  ${setup}`, `    export ${line}`]),
		]
		return { kind: 'unset', message: lines.join('\n'), missing }
	}
	if (!URL.canParse(baseUrl)) {
		return { kind: 'unset', message: `The base URL "${baseUrl}" is not a URL.`, missing: [] }
	}
	const key = env[apiKeyEnv]
	if (!key) {
		return {
			kind: 'unset',
			message: `KEN_API_KEY_ENV names ${apiKeyEnv}, but ${apiKeyEnv} is not set. Put the key in it.`,
			missing: [],
		}
	}
	// aigent hides the key wherever it appears in text, so it refuses a key short enough to match ordinary words.
	if (key.length < MIN_KEY_LENGTH) {
		return {
			kind: 'unset',
			message: `${apiKeyEnv} holds ${key.length} characters, and an API key has at least ${MIN_KEY_LENGTH}. Check that ${apiKeyEnv} holds the whole key.`,
			missing: [],
		}
	}
	return { kind: 'ok', config: { model, baseUrl, apiKeyEnv } }
}
