// Conventional Commits, with a lower-case subject. The lines an AI coding tool adds to credit itself are refused: a
// commit is its contributor's, and AI use is disclosed in the merge request description instead.
const AI_ATTRIBUTION = [
  /^co-authored-by:.*\b(claude|anthropic|copilot|cursor ?agent|codex|openai|gemini|aider)\b.*$/im,
  /^claude-session:.*$/im,
  /^\S*https:\/\/claude\.ai\/code\/session_.*$/im,
  /^\W*generated (with|by) \[?(claude|anthropic|copilot|cursor|codex|openai|gemini|aider).*$/im,
]

export default {
  extends: ['@commitlint/config-conventional'],
  plugins: [
    {
      rules: {
        'no-ai-attribution': ({ raw }) => {
          const hit = AI_ATTRIBUTION.map((pattern) => (raw || '').match(pattern)).find(Boolean)
          return [!hit, hit && `remove the AI attribution line "${hit[0].trim()}"`]
        },
      },
    },
  ],
  rules: {
    'no-ai-attribution': [2, 'always'],
    'header-max-length': [2, 'always', 100],
    'body-max-line-length': [2, 'always', 100],
  },
}
