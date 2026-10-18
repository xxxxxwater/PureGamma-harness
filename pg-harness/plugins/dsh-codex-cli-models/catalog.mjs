/** Build selectable Codex models from the CLI's visible catalog. */
export function materializeModels(rows, builtinModels, provider) {
  const codexModels = builtinModels.filter(model => model.api === 'openai-codex-responses')
  if (!codexModels.length) throw new Error('Harness Codex Responses adapter has no compatible model profile')

  const known = new Map(codexModels.map(model => [model.id, model]))
  const fallback = codexModels[0]
  return rows.filter(row => !row.hidden).map(row => {
    const base = known.get(row.model) ?? fallback
    return {
      ...base,
      id: row.model,
      provider,
      name: row.displayName ?? row.model,
      ...(Number.isInteger(row.contextWindow) && row.contextWindow > 0 ? {contextWindow: row.contextWindow} : {}),
      ...(Number.isInteger(row.maxOutputTokens) && row.maxOutputTokens > 0 ? {maxTokens: row.maxOutputTokens} : {}),
    }
  })
}
