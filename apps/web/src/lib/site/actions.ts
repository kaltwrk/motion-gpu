import {
	OpenAIIcon,
	AnthropicIcon,
	GrokIcon,
	PerplexityIcon,
	MetaAIIcon,
	CursorIcon,
	ZedIcon,
	BoltIcon,
	LovableIcon,
	type IconComponent
} from '$lib/icons';

export type DocsActionGroup = {
	label: string;
	documentPromptTemplate: string;
	items: {
		id: string;
		enabled: boolean;
		label: string;
		hrefTemplate: string;
		icon: IconComponent;
		opensNewTab?: boolean;
	}[];
};

/** Add, remove or reorder providers here. URL template values are encoded by the renderer. */
export const docsActionGroups: DocsActionGroup[] = [
	{
		label: 'LLM',
		documentPromptTemplate:
			'I am reading {title} in the {product} documentation at {url}. Use this page as the source of truth and help me apply its guidance to a production interface, including relevant integration or performance tradeoffs. If you cannot access the URL, ask me to paste the Markdown instead of guessing. Do not invent packages, registry commands, or APIs that the page does not document.',
		items: [
			{
				id: 'chatgpt',
				enabled: true,
				label: 'Open in ChatGPT',
				hrefTemplate: 'https://chatgpt.com/?hints=search&prompt={prompt}',
				icon: OpenAIIcon
			},
			{
				id: 'claude',
				enabled: true,
				label: 'Open in Claude',
				hrefTemplate: 'https://claude.ai/new?q={prompt}',
				icon: AnthropicIcon
			},
			{
				id: 'grok',
				enabled: true,
				label: 'Open in Grok',
				hrefTemplate: 'https://grok.com/?q={prompt}',
				icon: GrokIcon
			},
			{
				id: 'perplexity',
				enabled: true,
				label: 'Open in Perplexity',
				hrefTemplate: 'https://www.perplexity.ai/search?q={prompt}',
				icon: PerplexityIcon
			},
			{
				id: 'metaAi',
				enabled: true,
				label: 'Open in Meta AI',
				hrefTemplate: 'https://www.meta.ai/?prompt={prompt}',
				icon: MetaAIIcon
			}
		]
	},
	{
		label: 'IDE',
		documentPromptTemplate:
			'Read {title} in the {product} documentation at {url}. Apply the documented guidance to the current project while preserving its existing stack and conventions. Explain any relevant integration or performance tradeoffs. Do not invent packages, registry commands, or APIs that the page does not document.',
		items: [
			{
				id: 'cursor',
				enabled: true,
				label: 'Open in Cursor',
				hrefTemplate: 'https://cursor.com/link/prompt?text={prompt}',
				icon: CursorIcon
			},
			{
				id: 'zed',
				enabled: true,
				label: 'Open in Zed',
				hrefTemplate: 'zed://agent?prompt={prompt}',
				icon: ZedIcon,
				opensNewTab: false
			}
		]
	},
	{
		label: 'BUILDER',
		documentPromptTemplate:
			'Build a production-ready interface that follows {title} in the {product} documentation at {url}. Use the page as the source of truth and preserve any documented integration and performance constraints. Do not invent packages, registry commands, or APIs that the page does not document.',
		items: [
			{
				id: 'bolt',
				enabled: true,
				label: 'Open in Bolt',
				hrefTemplate: 'https://bolt.new/?prompt={prompt}',
				icon: BoltIcon
			},
			{
				id: 'lovable',
				enabled: true,
				label: 'Open in Lovable',
				hrefTemplate: 'https://lovable.dev/?autosubmit=true#prompt={prompt}',
				icon: LovableIcon
			}
		]
	}
];
